import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import { previewChange, SKIP_NOTE } from '../../domain/preview';
import type { AppData } from '../../domain/types';
import { MemoryAdapter } from '../../state/storage';
import { StoreProvider, useStore } from '../../state/store';
import { ToastProvider } from '../components/common';
import { ScenarioSheet } from '../components/ScenarioSheet';

/*
 * "See what happens if…" opened on one payment, as a timing gap opens it
 * (formerly the separate What if… sheet). Today is Sun 2026-10-11. Paid
 * $1,000 every 2 weeks from Thu Oct 15. A $1,300 repair on Oct 20 takes the
 * running total to −$300 until the Oct 29 paycheck; tuition of $1,500 is due
 * Nov 30.
 */
const TODAY = '2026-10-11';
const clock = clockAt(TODAY);

function seed(): AppData {
  let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(1300), date: '2026-10-20' }, clock, 'repair'));
  return unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Tuition', amountCents: usd(1500), date: '2026-11-30' }, clock, 'tuition'));
}

let store: ReturnType<typeof useStore>;
let applied = 0;
let closed = 0;
function Harness({ id, through }: { id: string; through?: string }) {
  store = useStore();
  return <ScenarioSheet occurrenceId={id} through={through} onClose={() => closed++} onApplied={() => applied++} />;
}

type User = ReturnType<typeof userEvent.setup>;

async function open(id = 'repair', data = seed(), through?: string) {
  applied = 0;
  closed = 0;
  const adapter = new MemoryAdapter(data);
  render(
    <StoreProvider adapter={adapter} today={TODAY}>
      <ToastProvider>
        <Harness id={id} through={through} />
      </ToastProvider>
    </StoreProvider>,
  );
  await screen.findByRole('dialog', { name: 'See what happens if…' });
  return { adapter, user: userEvent.setup() };
}

const form = () => screen.getByRole('form', { name: 'Change an expected payment' });
const comparison = () => screen.getByRole('region', { name: 'Scenario comparison' });
const rows = () => within(within(comparison()).getByRole('table')).getAllByRole('row').map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent));

/** Picks what to change on the opened payment and adds it. */
async function tryChange(user: User, action: 'Move date' | 'Change amount' | 'Leave it out', value?: string) {
  await user.click(within(form()).getByRole('radio', { name: action }));
  if (action === 'Move date') fireEvent.change(within(form()).getByLabelText('New date'), { target: { value } });
  if (action === 'Change amount') {
    const amount = within(form()).getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, value!);
  }
  await user.click(within(form()).getByRole('button', { name: 'Add to scenario' }));
}

describe('opened on one payment', () => {
  it('starts on that payment with Move date, and compares a move that removes the timing gap', async () => {
    const { user } = await open();
    expect(within(form()).getByLabelText('Payment')).toHaveValue('repair');
    expect(within(form()).getByRole('radio', { name: 'Move date' })).toBeChecked();
    await tryChange(user, 'Move date', '2026-10-30');
    // The same numbers previewChange gives: the two comparisons share one engine.
    const r = previewChange(store.data, { kind: 'move', occurrenceId: 'repair', date: '2026-10-30' }, { today: TODAY, now: '' });
    expect(r.ok && [r.preview.current.lowest?.tallyCents, r.preview.proposed.lowest?.tallyCents]).toEqual([usd(-300), usd(700)]);
    expect(rows()[2]).toEqual(['Lowest running total', '−$300.00 on Oct 20', '$700.00 on Oct 30']);
    expect(comparison()).toHaveTextContent('The timing gap Oct 20 – 28 would be gone.');
  });

  it('a larger amount: the timing gap deepens and a new one appears later', async () => {
    const { user } = await open();
    await tryChange(user, 'Change amount', '2700');
    // Oct 20 −$1,700; Oct 29 −$700; Nov 12 $300; Nov 26 $1,300; Nov 30 tuition −$200 until Dec 10 ($800).
    expect(rows()[2]).toEqual(['Lowest running total', '−$300.00 on Oct 20', '−$1,700.00 on Oct 20']);
    expect(comparison()).toHaveTextContent('Deeper timing gap: Oct 20 – Nov 11, down to −$1,700.00.');
    expect(comparison()).toHaveTextContent('New timing gap: Nov 30 – Dec 9, down to −$200.00, back to $0 or more on Dec 10.');
  });
});

describe('applying one change', () => {
  it('nothing is saved while exploring, and Keep exploring changes nothing', async () => {
    const { user, adapter } = await open();
    const before = store.data;
    await tryChange(user, 'Leave it out');
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    const confirm = screen.getByRole('group', { name: 'Apply this change?' });
    expect(confirm).toHaveTextContent('Leave Repair on Oct 20, 2026 out of your forecast.');
    expect(confirm).toHaveTextContent('This changes your forecast only.');
    await user.click(screen.getByRole('button', { name: 'Keep exploring' }));
    expect(store.data).toBe(before);
    expect((await adapter.load()).records).toEqual(before.records);
    expect(applied).toBe(0);
  });

  it('editing the change after opening the confirmation asks again, for the new change', async () => {
    const { user } = await open();
    await tryChange(user, 'Move date', '2026-10-30');
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    await user.click(screen.getByRole('button', { name: /^Edit Repair/ }));
    fireEvent.change(within(form()).getByLabelText('New date'), { target: { value: '2026-11-02' } });
    await user.click(within(form()).getByRole('button', { name: 'Save change' }));
    expect(screen.queryByRole('group', { name: 'Apply this change?' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    expect(screen.getByRole('group', { name: 'Apply this change?' })).toHaveTextContent('Move Repair from Oct 20, 2026 to Nov 2, 2026.');
  });

  it('applies a confirmed move to that one payment only', async () => {
    const { user, adapter } = await open();
    const original = await adapter.load();
    await tryChange(user, 'Move date', '2026-10-30');
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    expect(screen.getByRole('group', { name: 'Apply this change?' })).toHaveTextContent('Move Repair from Oct 20, 2026 to Oct 30, 2026.');
    await user.click(screen.getByRole('button', { name: 'Apply change' }));
    expect(applied).toBe(1);
    await waitFor(async () => expect((await adapter.load()).records.find((r) => r.id === 'repair')?.scheduledDate).toBe('2026-10-30'));
    const saved = await adapter.load();
    expect(saved.records.find((r) => r.id === 'repair')).toMatchObject({ expectedDate: '2026-10-20', scheduledDate: '2026-10-30', scheduledAmountCents: usd(1300), status: 'scheduled' });
    expect(saved.records.find((r) => r.id === 'tuition')).toEqual(original.records.find((r) => r.id === 'tuition'));
    expect(saved.sources).toEqual(original.sources);
  });

  it('applies a confirmed "leave it out" as a cancellation of that one payment', async () => {
    const { user } = await open();
    await tryChange(user, 'Leave it out');
    expect(comparison()).toHaveTextContent('The timing gap Oct 20 – 28 would be gone.');
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    await user.click(screen.getByRole('button', { name: 'Apply change' }));
    expect(store.data.records.find((r) => r.id === 'repair')).toMatchObject({ status: 'canceled', cancelNote: SKIP_NOTE });
  });

  it('refuses to apply when the data changed after the comparison was made, and shows the updated comparison', async () => {
    const { user } = await open();
    await tryChange(user, 'Move date', '2026-10-30');
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    act(() => {
      store.run((d, c) => ops.addOneTime(d, { kind: 'varied', description: 'Vet', amountCents: usd(90), date: '2026-10-22' }, c, 'vet'));
    });
    await user.click(screen.getByRole('button', { name: 'Apply change' }));
    expect(screen.getByText('Your forecast changed after this preview. Check the updated preview before applying.')).toBeInTheDocument();
    expect(store.data.records.find((r) => r.id === 'repair')!.scheduledDate).toBe('2026-10-20');
    expect(applied).toBe(0);
    expect(rows()[2]).toEqual(['Lowest running total', '−$390.00 on Oct 22', '$610.00 on Oct 30']);
  });

  it('explains instead of comparing when the next payday would move, and offers no Apply', async () => {
    const { user } = await open('pay@2026-10-15');
    await tryChange(user, 'Move date', '2026-10-16');
    expect(comparison()).toHaveTextContent("This scenario moves your next payday from Oct 15, 2026 to Oct 16, 2026, so the running totals start on different days and can't be compared directly.");
    expect(screen.queryByRole('button', { name: 'Apply change…' })).toBeNull();
  });

  it('shows the rule an invalid change breaks, and offers no Apply', async () => {
    const { user } = await open();
    await tryChange(user, 'Move date', '2026-10-05');
    expect(screen.getByRole('region', { name: 'Your changes' })).toHaveTextContent('Hypothetical changes need today or a later date.');
    expect(screen.queryByRole('button', { name: 'Apply change…' })).toBeNull();
  });

  it('several changes, or a hypothetical one, are compared but never applied', async () => {
    const { user } = await open();
    await tryChange(user, 'Move date', '2026-10-30');
    await user.click(screen.getByRole('button', { name: 'Add a change' }));
    await user.click(screen.getByRole('button', { name: /^Unexpected expense/ }));
    const expense = screen.getByRole('form', { name: 'Unexpected expense' });
    await user.type(within(expense).getByLabelText('Amount'), '50');
    fireEvent.change(within(expense).getByLabelText('Date'), { target: { value: '2026-10-25' } });
    await user.click(within(expense).getByRole('button', { name: 'Add to scenario' }));
    expect(comparison()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply change…' })).toBeNull();
    expect(screen.getByText('To apply a change to a payment, make it the only change here.')).toBeInTheDocument();
    // Removing the move leaves only the hypothetical expense: still nothing to apply.
    await user.click(screen.getByRole('button', { name: /^Remove Repair/ }));
    expect(screen.queryByRole('button', { name: 'Apply change…' })).toBeNull();
  });

  it('an overdue payment opened from a timing gap is the one selected, and can be moved', async () => {
    const data = unwrap(ops.addOneTime(seed(), { kind: 'varied', description: 'Old bill', amountCents: usd(200), date: '2026-10-05' }, clockAt('2026-10-01'), 'old'));
    const { user } = await open('old', data);
    expect(within(form()).getByLabelText('Payment')).toHaveValue('old');
    await tryChange(user, 'Move date', '2026-10-30');
    expect(screen.getByRole('region', { name: 'Your changes' })).toHaveTextContent('Old bill on Oct 5, 2026: move to Oct 30, 2026');
    expect(comparison()).toBeInTheDocument();
  });

  it("won't preview a recorded payment", async () => {
    const data = unwrap(ops.recordActual(seed(), 'repair', { amountCents: usd(1300), date: TODAY }, clock));
    await open('repair', data);
    expect(screen.getByText(/already been recorded or changed/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('closing returns without changing anything', async () => {
    const { user } = await open();
    const before = store.data;
    await tryChange(user, 'Move date', '2026-10-30');
    await user.keyboard('{Escape}');
    expect(closed).toBe(1);
    expect(store.data).toBe(before);
  });
});

describe('leaving a payment out, in plain words', () => {
  function withLoan(): AppData {
    return unwrap(ops.addSource(seed(), { kind: 'liability', description: 'Car loan', amountCents: usd(350), startDate: '2026-10-22', rule: { type: 'monthly' }, liabilityType: 'loan' }, clock, 'car'));
  }

  it('a liability payment: says the loan and its payments are unchanged, before and at confirmation', async () => {
    const { user } = await open('car@2026-10-22', withLoan());
    const note = 'This only changes your forecast. Your loan and its payments stay the same.';
    await user.click(within(form()).getByRole('radio', { name: 'Leave it out' }));
    expect(within(form()).getByText(note)).toBeInTheDocument();
    await user.click(within(form()).getByRole('button', { name: 'Add to scenario' }));
    await user.click(screen.getByRole('button', { name: 'Apply change…' }));
    const confirm = screen.getByRole('group', { name: 'Apply this change?' });
    expect(confirm).toHaveTextContent('Leave Car loan on Oct 22, 2026 out of your forecast.');
    expect(confirm).toHaveTextContent(note);
    expect(confirm).toHaveTextContent('Only this one on Oct 22, 2026 changes; later ones keep their schedule.');
    await user.click(screen.getByRole('button', { name: 'Apply change' }));
    expect(store.data.records.find((r) => r.id === 'car@2026-10-22')).toMatchObject({ status: 'canceled', cancelNote: SKIP_NOTE });
    expect(store.data.sources.find((s) => s.id === 'car')).toMatchObject({ active: true, liabilityType: 'loan' });
  });

  it('income: talks about income, not a payment', async () => {
    const { user } = await open('pay@2026-10-29');
    await user.click(within(form()).getByRole('radio', { name: 'Leave it out' }));
    expect(within(form()).getByText('Shows your forecast without this income.')).toBeInTheDocument();
  });

  it('a bill or spending: only the forecast changes', async () => {
    const { user } = await open();
    await user.click(within(form()).getByRole('radio', { name: 'Leave it out' }));
    expect(within(form()).getByText('This only changes your forecast.')).toBeInTheDocument();
  });
});

describe('a timing gap further out than 90 days', () => {
  it('is compared over the period being viewed', async () => {
    // Taxes of $9,500 on Feb 10, 2027 after nine $1,000 paychecks: −$500 until Feb 18.
    const paidOnly = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'biweekly' }, 'pay');
    const data = unwrap(ops.addOneTime(paidOnly, { kind: 'varied', description: 'Taxes', amountCents: usd(9500), date: '2027-02-10' }, clock, 'taxes'));
    const { user } = await open('taxes', data, '2027-02-28');
    expect(within(form()).getByLabelText('Payment')).toHaveValue('taxes');
    await tryChange(user, 'Move date', '2027-02-18');
    expect(comparison()).toHaveTextContent('The timing gap Feb 10 – 17 would be gone.');
  });
});
