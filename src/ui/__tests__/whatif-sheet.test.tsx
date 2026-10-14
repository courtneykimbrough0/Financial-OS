import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import { previewChange } from '../../domain/preview';
import type { AppData } from '../../domain/types';
import { MemoryAdapter } from '../../state/storage';
import { StoreProvider, useStore } from '../../state/store';
import { ToastProvider } from '../components/common';
import { WhatIfSheet } from '../components/WhatIfSheet';

/*
 * Today is Sun 2026-10-11. Paid $1,000 every 2 weeks from Thu Oct 15. A $1,300
 * repair on Oct 20 takes the running total to −$300 until the Oct 29 paycheck;
 * tuition of $1,500 is due Nov 30.
 */
const TODAY = '2026-10-11';
const clock = clockAt(TODAY);

function seed(): AppData {
  let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Repair', amountCents: usd(1300), date: '2026-10-20' }, clock, 'repair'));
  return unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Tuition', amountCents: usd(1500), date: '2026-11-30' }, clock, 'tuition'));
}

let store: ReturnType<typeof useStore>;
let done = 0;
let back = 0;
function Harness({ id }: { id: string }) {
  store = useStore();
  return <WhatIfSheet occurrenceId={id} onBack={() => back++} onDone={() => done++} />;
}

async function open(id = 'repair', data = seed()) {
  done = 0;
  back = 0;
  const adapter = new MemoryAdapter(data);
  render(
    <StoreProvider adapter={adapter} today={TODAY}>
      <ToastProvider>
        <Harness id={id} />
      </ToastProvider>
    </StoreProvider>,
  );
  await screen.findByRole('dialog', { name: 'What if…' });
  return { adapter, user: userEvent.setup() };
}

const preview = () => screen.getByRole('region', { name: 'Preview' });
async function setDate(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = screen.getByLabelText('New date');
  await user.clear(input);
  await user.type(input, value);
}

describe('WhatIfSheet', () => {
  it('shows the transaction, starts on Move date, and previews a move that removes the shortfall', async () => {
    const { user } = await open();
    expect(screen.getByRole('dialog')).toHaveTextContent('RepairExpected −$1,300.00 on Oct 20, 2026');
    expect(screen.getByRole('radio', { name: 'Move date' })).toBeChecked();
    await setDate(user, '2026-10-30');
    // The same numbers previewChange gives.
    const r = previewChange(store.data, { kind: 'move', occurrenceId: 'repair', date: '2026-10-30' }, { today: TODAY, now: '' });
    expect(r.ok && [r.preview.current.lowest?.tallyCents, r.preview.proposed.lowest?.tallyCents]).toEqual([usd(-300), usd(700)]);
    expect(preview()).toHaveTextContent('Move Repair from Oct 20, 2026 to Oct 30, 2026.');
    expect(preview()).toHaveTextContent('Your lowest running total would improve from −$300.00 to $700.00.');
    expect(preview()).toHaveTextContent('Now−$300.00 on Oct 20With this change$700.00 on Oct 30');
    expect(preview()).toHaveTextContent('The timing gap Oct 20 – 28 would be gone.');
  });

  it('a larger amount: the shortfall worsens and a new one appears elsewhere', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('radio', { name: 'Change amount' }));
    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '2700');
    // Oct 20 −$1,700; Oct 29 −$700; Nov 12 $300; Nov 26 $1,300; Nov 30 tuition −$200 until Dec 10 ($800).
    expect(preview()).toHaveTextContent('Your lowest running total would drop from −$300.00 to −$1,700.00.');
    expect(preview()).toHaveTextContent('The timing gap Oct 20 – 28 would be worse: Oct 20 – Nov 11, down to −$1,700.00. Back to $0 or more on Nov 12 instead of Oct 29.');
    expect(preview()).toHaveTextContent('New timing gap: Nov 30 – Dec 9, down to −$200.00, back to $0 or more on Dec 10.');
  });

  it('nothing is saved while exploring, and Keep exploring changes nothing', async () => {
    const { user, adapter } = await open();
    const before = store.data;
    await setDate(user, '2026-10-30');
    await user.click(screen.getByRole('radio', { name: 'Skip this one' }));
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    expect(screen.getByRole('group', { name: 'Apply this change?' })).toHaveTextContent('Leave Repair on Oct 20, 2026 out of your forecast.');
    expect(screen.getByText(/doesn’t change any payment arrangement outside the app/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep exploring' }));
    expect(store.data).toBe(before);
    expect((await adapter.load()).records).toEqual(before.records);
    expect(done).toBe(0);
  });

  it('applies a confirmed move to that one transaction only', async () => {
    const { user, adapter } = await open();
    const original = await adapter.load();
    await setDate(user, '2026-10-30');
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    expect(screen.getByRole('group', { name: 'Apply this change?' })).toHaveTextContent('Move Repair from Oct 20, 2026 to Oct 30, 2026.');
    await user.click(screen.getByRole('button', { name: 'Apply change' }));
    expect(done).toBe(1);
    await waitFor(async () => expect((await adapter.load()).records.find((r) => r.id === 'repair')?.scheduledDate).toBe('2026-10-30'));
    const saved = await adapter.load();
    expect(saved.records.find((r) => r.id === 'repair')).toMatchObject({ expectedDate: '2026-10-20', scheduledDate: '2026-10-30', scheduledAmountCents: usd(1300), status: 'scheduled' });
    expect(saved.records.find((r) => r.id === 'tuition')).toEqual(original.records.find((r) => r.id === 'tuition'));
    expect(saved.sources).toEqual(original.sources);
  });

  it('applies a confirmed skip as a cancellation of that one payment', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('radio', { name: 'Skip this one' }));
    expect(preview()).toHaveTextContent('The timing gap Oct 20 – 28 would be gone.');
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    await user.click(screen.getByRole('button', { name: 'Apply change' }));
    expect(store.data.records.find((r) => r.id === 'repair')).toMatchObject({ status: 'canceled', cancelNote: 'Skipped after a what-if preview' });
  });

  it('refuses to apply a preview when the data changed after it was made', async () => {
    const { user } = await open();
    await setDate(user, '2026-10-30');
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    act(() => {
      store.run((d, c) => ops.addOneTime(d, { kind: 'bill', description: 'Vet', amountCents: usd(90), date: '2026-10-22' }, c, 'vet'));
    });
    await user.click(screen.getByRole('button', { name: 'Apply change' }));
    expect(screen.getByText('Your forecast changed after this preview. Check the updated preview before applying.')).toBeInTheDocument();
    expect(store.data.records.find((r) => r.id === 'repair')!.scheduledDate).toBe('2026-10-20');
    expect(done).toBe(0);
    // The preview is shown again, recalculated with the vet bill.
    expect(preview()).toHaveTextContent('Your lowest running total would improve from −$390.00 to $610.00.');
  });

  it('explains instead of comparing when the next payday would move, and offers no Apply', async () => {
    const { user } = await open('pay@2026-10-15');
    await setDate(user, '2026-10-16');
    expect(preview()).toHaveTextContent('This changes your next payday from Oct 15, 2026 to Oct 16, 2026.');
    expect(preview()).not.toHaveTextContent('lowest running total would');
    expect(screen.queryByRole('button', { name: 'Apply change…' })).toBeNull();
  });

  it('shows the rule an invalid change breaks, and offers no Apply', async () => {
    const { user } = await open();
    await setDate(user, '2026-10-05');
    expect(preview()).toHaveTextContent('Choose today or a later date.');
    expect(screen.queryByRole('button', { name: 'Apply change…' })).toBeNull();
  });

  it('won’t preview a recorded payment', async () => {
    const data = unwrap(ops.recordActual(seed(), 'repair', { amountCents: usd(1300), date: TODAY }, clock));
    await open('repair', data);
    expect(screen.getByText(/already been recorded or changed/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('Back returns without changing anything', async () => {
    const { user } = await open();
    const before = store.data;
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toBe(1);
    expect(store.data).toBe(before);
  });
});
