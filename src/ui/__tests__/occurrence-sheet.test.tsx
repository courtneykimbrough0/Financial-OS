import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildForecast, tallyOn } from '../../domain/forecast';
import { addSource, emptyData } from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { MemoryAdapter } from '../../state/storage';
import { StoreProvider, useStore } from '../../state/store';
import { ToastProvider } from '../components/common';
import { OccurrenceSheet } from '../components/OccurrenceSheet';

const clock = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };

function seed(): AppData {
  const r = addSource(emptyData(), { kind: 'income', description: 'Paycheck', amountCents: 180000, startDate: '2026-10-15', rule: { type: 'biweekly' } }, clock, 'pay');
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

let latest: AppData | null = null;
function Spy() {
  latest = useStore().data;
  return null;
}

/** Renders the sheet and waits for the store to finish loading. */
async function renderSheet(adapter: MemoryAdapter, today: string, onClose = () => {}) {
  render(
    <StoreProvider adapter={adapter} today={today}>
      <ToastProvider>
        <Spy />
        <OccurrenceSheet occurrenceId="pay@2026-10-15" onClose={onClose} />
      </ToastProvider>
    </StoreProvider>,
  );
  await screen.findByRole('dialog');
}

/** Waits until the background save has written `count` records. */
async function savedWith(adapter: MemoryAdapter, count: number): Promise<AppData> {
  let saved: AppData | null = null;
  await waitFor(async () => {
    saved = await adapter.load();
    expect(saved.records).toHaveLength(count);
  });
  return saved!;
}

describe('OccurrenceSheet', () => {
  it('records a late, smaller paycheck and preserves the original prediction', async () => {
    const user = userEvent.setup();
    const adapter = new MemoryAdapter(seed());
    let closed = false;
    await renderSheet(adapter, '2026-10-16', () => (closed = true));

    expect(screen.getByText(/hasn’t been marked received/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark received' }));
    const amount = screen.getByLabelText('Amount received');
    const date = screen.getByLabelText('Date received');
    expect(amount).toHaveValue('1800.00');
    expect(date).toHaveValue('2026-10-15');

    await user.clear(amount);
    await user.type(amount, '1650');
    fireEvent.change(date, { target: { value: '2026-10-16' } });
    await user.click(screen.getByRole('button', { name: 'Save as received' }));

    expect(closed).toBe(true);
    const saved = await savedWith(adapter, 1);
    expect(saved.records[0]).toMatchObject({
      expectedAmountCents: 180000,
      expectedDate: '2026-10-15',
      actualAmountCents: 165000,
      actualDate: '2026-10-16',
      status: 'completed',
    });
    const f = buildForecast(saved, '2026-10-16');
    expect(tallyOn(f, '2026-10-16')).toBe(165000);
    expect(tallyOn(f, '2026-10-29')).toBe(345000);
  });

  it('saves only one completion when the save button is tapped twice', async () => {
    const adapter = new MemoryAdapter(seed());
    await renderSheet(adapter, '2026-10-16');
    fireEvent.click(screen.getByRole('button', { name: 'Mark received' }));
    const save = screen.getByRole('button', { name: 'Save as received' });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(latest!.records).toHaveLength(1);
    await savedWith(adapter, 1);
    expect(adapter.saves).toBe(1);
  });

  it('blocks an actual date in the future', async () => {
    const user = userEvent.setup();
    const adapter = new MemoryAdapter(seed());
    await renderSheet(adapter, '2026-10-11');
    await user.click(screen.getByRole('button', { name: 'Mark received' }));
    // Defaults to today because the expected date is still ahead.
    expect(screen.getByLabelText('Date received')).toHaveValue('2026-10-11');
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-10-15' } });
    await user.click(screen.getByRole('button', { name: 'Save as received' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be in the future/);
    expect((await adapter.load()).records).toHaveLength(0);
    expect(adapter.saves).toBe(0);
  });

  it('cancels one occurrence without affecting the next', async () => {
    const user = userEvent.setup();
    const adapter = new MemoryAdapter(seed());
    await renderSheet(adapter, '2026-10-11');
    await user.click(screen.getByRole('button', { name: 'Cancel this one' }));
    await user.type(screen.getByLabelText('Note (optional)'), 'Unpaid leave');
    await user.click(screen.getByRole('button', { name: 'Cancel occurrence' }));
    const saved = await savedWith(adapter, 1);
    expect(saved.records[0]).toMatchObject({ status: 'canceled', cancelNote: 'Unpaid leave', actualAmountCents: null });
    const f = buildForecast(saved, '2026-10-11');
    expect(f.forecastStart).toBe('2026-10-29');
  });
});
