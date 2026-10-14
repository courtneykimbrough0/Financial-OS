import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildForecast } from '../../domain/forecast';
import { addSource, correctActual, emptyData } from '../../domain/operations';
import type { AppData, RecurrenceRule, TransactionKind } from '../../domain/types';
import { MemoryAdapter } from '../../state/storage';
import { StoreProvider, useStore } from '../../state/store';
import { ToastProvider } from '../components/common';
import { ReviewSheet } from '../components/ReviewSheet';

/*
 * Set up Sun 2026-10-11, reviewed Wed 2026-10-21 (week ends Sat Oct 24).
 * Overdue: paycheck Oct 15; car loan and gym Oct 20 (same day). Later this week: phone Oct 23.
 */
const SETUP = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };
const TODAY = '2026-10-21';

function seed(): AppData {
  const items: [string, TransactionKind, string, number, string, RecurrenceRule][] = [
    ['pay', 'income', 'Paycheck', 180000, '2026-10-15', { type: 'biweekly' }],
    ['car', 'liability', 'Car loan', 35000, '2026-10-20', { type: 'monthly' }],
    ['gym', 'subscription', 'Gym', 4000, '2026-10-20', { type: 'monthly' }],
    ['phone', 'bill', 'Phone', 6000, '2026-10-23', { type: 'monthly' }],
  ];
  let d = emptyData();
  for (const [id, kind, description, amountCents, startDate, rule] of items) {
    const r = addSource(d, { kind, description, amountCents, startDate, rule, ...(kind === 'liability' ? { liabilityType: 'loan' as const } : {}) }, SETUP, id);
    if (!r.ok) throw new Error(r.error);
    d = r.data;
  }
  return d;
}

let store: ReturnType<typeof useStore>;
let opened: string[] = [];
function Harness() {
  store = useStore();
  return <ReviewSheet forecast={buildForecast(store.data, store.today)} title="Review" onOpen={(id) => opened.push(id)} onClose={() => {}} />;
}

async function renderReview(adapter: MemoryAdapter) {
  opened = [];
  render(
    <StoreProvider adapter={adapter} today={TODAY}>
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </StoreProvider>,
  );
  await screen.findByRole('dialog');
}

const check = (name: RegExp) => screen.getByRole('checkbox', { name });

describe('ReviewSheet', () => {
  it('shows what needs an update first, then later this week, with nothing selected', async () => {
    await renderReview(new MemoryAdapter(seed()));
    const needs = screen.getByRole('region', { name: 'Needs an update' });
    expect(within(needs).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual([
      'Select Paycheck, $1,800.00, overdue since Oct 15, 2026',
      'Select Car loan, $350.00, overdue since Oct 20, 2026',
      'Select Gym, $40.00, overdue since Oct 20, 2026',
    ]);
    expect(within(screen.getByRole('region', { name: 'Later this week' })).getAllByRole('checkbox')).toHaveLength(1);
    // Nothing is marked done just because it was expected: no action until something is selected.
    expect(screen.getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole('button', { name: /^Mark .* done$/ })).toBeNull();
  });

  it('marks only the selected items done, and undoes the batch in one step', async () => {
    const user = userEvent.setup();
    const adapter = new MemoryAdapter(seed());
    await renderReview(adapter);
    const original = await adapter.load();

    await user.click(check(/^Select Paycheck/));
    await user.click(check(/^Select Car loan/));
    await user.click(screen.getByRole('button', { name: 'Mark 2 items done' }));
    await screen.findByText('Marked 2 items done as expected.', { selector: '.review-undo span' });

    await waitFor(async () => expect((await adapter.load()).records).toHaveLength(2));
    const saved = await adapter.load();
    expect(saved.records.map((r) => [r.id, r.status, r.actualDate, r.actualAmountCents])).toEqual([
      ['pay@2026-10-15', 'completed', '2026-10-15', 180000],
      ['car@2026-10-20', 'completed', '2026-10-20', 35000],
    ]);
    // Gym, due the same day as the car loan, is untouched and still listed.
    expect(check(/^Select Gym/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Select Car loan/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await adapter.load()).records).toHaveLength(0));
    const undone = await adapter.load();
    expect({ ...undone, revision: original.revision }).toEqual(original);
    expect(check(/^Select Car loan/)).not.toBeChecked();
  });

  it('refuses an undo that would overwrite a later change, and keeps that change', async () => {
    const user = userEvent.setup();
    const adapter = new MemoryAdapter(seed());
    await renderReview(adapter);
    await user.click(check(/^Select Paycheck/));
    await user.click(check(/^Select Car loan/));
    await user.click(screen.getByRole('button', { name: 'Mark 2 items done' }));
    // The car loan payment is corrected after the batch (as from its own sheet).
    act(() => {
      store.run((d, c) => correctActual(d, 'car@2026-10-20', { amountCents: 36000, date: '2026-10-20' }, c));
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText(/have changed since, so they can’t be undone together/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(store.data.records.map((r) => [r.id, r.status, r.actualAmountCents])).toEqual([
      ['pay@2026-10-15', 'completed', 180000],
      ['car@2026-10-20', 'completed', 36000],
    ]);
    await waitFor(async () => expect((await adapter.load()).records.find((r) => r.id === 'car@2026-10-20')?.actualAmountCents).toBe(36000));
  });

  it('selects a whole group, and moves the selection to a new date', async () => {
    const user = userEvent.setup();
    const adapter = new MemoryAdapter(seed());
    await renderReview(adapter);
    const needs = screen.getByRole('region', { name: 'Needs an update' });
    await user.click(within(needs).getByRole('button', { name: 'Select all' }));
    await user.click(check(/^Select Paycheck/)); // leave the paycheck out
    await user.click(screen.getByRole('button', { name: 'Move to a date' }));
    const date = screen.getByLabelText('New expected date for 2 items');
    await user.clear(date);
    await user.type(date, '2026-10-29');
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(async () => expect((await adapter.load()).records).toHaveLength(2));
    const saved = await adapter.load();
    expect(saved.records.map((r) => [r.id, r.expectedDate, r.scheduledDate, r.status])).toEqual([
      ['car@2026-10-20', '2026-10-20', '2026-10-29', 'scheduled'],
      ['gym@2026-10-20', '2026-10-20', '2026-10-29', 'scheduled'],
    ]);
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Needs an update', 'Later this week']);
  });

  it('opens an item to record a different amount or date', async () => {
    const user = userEvent.setup();
    await renderReview(new MemoryAdapter(seed()));
    await user.click(screen.getByRole('button', { name: /^Gym/ }));
    expect(opened).toEqual(['gym@2026-10-20']);
  });

  it('keeps every change of a batch on screen when the save fails, and saves them together on retry', async () => {
    const user = userEvent.setup();
    const adapter = new MemoryAdapter(seed());
    await renderReview(adapter);
    adapter.failNext = true;
    await user.click(within(screen.getByRole('region', { name: 'Needs an update' })).getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Mark 3 items done' }));
    await waitFor(() => expect(store.saveStatus).toBe('error'));
    expect(store.data.records).toHaveLength(3);
    expect((await adapter.load()).records).toHaveLength(0);
    const savesBefore = adapter.saves;
    await act(async () => store.retrySave());
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect((await adapter.load()).records.map((r) => r.status)).toEqual(['completed', 'completed', 'completed']);
    expect(adapter.saves).toBe(savesBefore + 1);
  });
});
