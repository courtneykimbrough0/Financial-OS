import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { MemoryAdapter } from '../../state/storage';
import { StoreProvider, useStore } from '../../state/store';
import { ToastProvider } from '../components/common';
import { Forecast } from '../screens/Forecast';

/*
 * The plan from scenarios.test.ts. Today is Fri 2026-10-16. Paid $1,000
 * every other Friday from Oct 23; rent $1,500 on the 1st from Nov 1; car loan
 * $300 on the 28th from Oct 28. Through Jan 20, 2027: cash flow +$1,600,
 * lowest −$800 on Nov 1, ending $1,600, gaps Nov 1–5 (−$800) and Dec 1–3 (−$600).
 */
const TODAY = '2026-10-16';
function plan(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, TODAY, 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
  return source(d, TODAY, 'liability', 'Car loan', 300, '2026-10-28', { type: 'monthly' }, 'loan');
}

let store: ReturnType<typeof useStore>;
function Spy() {
  store = useStore();
  return null;
}

async function mount(data = plan()) {
  const adapter = new MemoryAdapter(data);
  render(
    <StoreProvider adapter={adapter} today={TODAY}>
      <ToastProvider>
        <Spy />
        <Forecast />
      </ToastProvider>
    </StoreProvider>,
  );
  await screen.findByRole('button', { name: 'Explore a scenario' });
  return { adapter, user: userEvent.setup() };
}

type User = ReturnType<typeof userEvent.setup>;
const sheet = () => screen.getByRole('dialog', { name: 'Explore a scenario' });

async function open(user: User) {
  await user.click(screen.getByRole('button', { name: 'Explore a scenario' }));
  return sheet();
}

async function choose(user: User, type: string) {
  await user.click(within(sheet()).getByRole('button', { name: 'Add a change' }));
  await user.click(within(sheet()).getByRole('button', { name: new RegExp(`^${type}`) }));
  return within(sheet()).getByRole('form', { name: type });
}

async function fill(user: User, form: HTMLElement, fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) {
    const el = within(form).getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
    if (el.tagName === 'SELECT') await user.selectOptions(el, value);
    else if (el.type === 'date') fireEvent.change(el, { target: { value } });
    else {
      await user.clear(el);
      await user.type(el, value);
    }
  }
}

async function add(user: User, type: string, fields: Record<string, string>) {
  const form = await choose(user, type);
  await fill(user, form, fields);
  await user.click(within(form).getByRole('button', { name: 'Add to scenario' }));
}

const changes = () => within(within(sheet()).getByRole('region', { name: 'Your changes' })).queryAllByRole('listitem').map((li) => li.textContent);
const comparison = () => within(sheet()).getByRole('region', { name: 'Scenario comparison' });
const rows = (table: HTMLElement) => within(table).getAllByRole('row').map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent));

beforeEach(() => localStorage.clear());

describe('opening and closing', () => {
  it('opens from the dashboard empty, and Done or Escape closes it', async () => {
    const { user } = await mount();
    const s = await open(user);
    expect(s).toHaveTextContent('Try a few what-ifs together and compare them with your forecast. Nothing here changes your plan or is saved.');
    expect(s).toHaveTextContent('No changes yet. Add one to see how it would affect your forecast.');
    await user.click(within(s).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await open(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Explore a scenario' })).toHaveFocus();
  });

  it('offers the seven kinds of change in everyday words', async () => {
    const { user } = await mount();
    await open(user);
    await user.click(within(sheet()).getByRole('button', { name: 'Add a change' }));
    const list = within(sheet()).getByRole('region', { name: 'Choose a change' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Additional incomeMoney that might come in once',
      'Unexpected expenseA cost that might come up once',
      'Move an expected paymentOne upcoming payment on another date',
      'Change an expected amountOne upcoming payment at another amount',
      'Increase a liability paymentA higher payment from a date on',
      'Build reservesAn amount set aside on a schedule',
      'Explore variable incomeLow, expected and high amounts',
      'Cancel',
    ]);
  });
});

describe('one change', () => {
  it('an unexpected expense: the comparison, the shortfall first, and what it assumes', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Unexpected expense', { Name: 'Car repair', Amount: '800', Date: '2026-11-10' });
    expect(changes()).toEqual(['Car repair: −$800.00 on Nov 10, 2026']);
    const c = comparison();
    expect(within(c).getByRole('status')).toHaveTextContent('This scenario creates a $600.00 shortfall on Nov 10, back to $0 or more on Nov 20.');
    expect(rows(within(c).getByRole('table'))).toEqual([
      ['Measure', 'Current forecast', 'With this scenario'],
      ['Cash flow', '+$1,600.00', '+$800.00'],
      ['Lowest running total', '−$800.00 on Nov 1', '−$1,400.00 on Dec 1'],
      ['Ending running total', '$1,600.00', '$800.00'],
      ['Timing gaps', '2', '4'],
    ]);
    expect(c).toHaveTextContent('New timing gap: Nov 10 – 19, down to −$600.00, back to $0 or more on Nov 20.');
    expect(c).toHaveTextContent('New timing gap: Jan 1 – 14, down to −$200.00, back to $0 or more on Jan 15.');
    expect(c).toHaveTextContent('Deeper timing gap: Dec 1 – 17, down to −$1,400.00.');
    const assumes = within(c).getByRole('region', { name: 'What this assumes' });
    expect(within(assumes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Car repair: −$800.00 once on Nov 10, 2026One-time']);
    expect(assumes).toHaveTextContent('Cash flow from Oct 16, 2026 through Jan 20, 2027; running total from Oct 23, 2026, the day of your next payday.');
  });

  it('additional income: shown as hypothetical, apart from your own income', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Additional income', { Name: 'Bonus', Amount: '500', Date: '2026-11-01' });
    const c = comparison();
    expect(within(c).queryByRole('status')).toBeNull();
    expect(rows(within(c).getByRole('table')).slice(1)).toEqual([
      ['Cash flow', '+$1,600.00', '+$2,100.00'],
      ['Lowest running total', '−$800.00 on Nov 1', '−$300.00 on Nov 1'],
      ['Ending running total', '$1,600.00', '$2,100.00'],
      ['Timing gaps', '2', '2'],
    ]);
    expect(c).toHaveTextContent('Includes $500.00 of hypothetical income. Without it, cash flow would be +$1,600.00.');
    expect(c).toHaveTextContent('Smaller timing gap: Nov 1 – 5, down to −$300.00.');
    expect(within(within(c).getByRole('region', { name: 'What this assumes' })).getByRole('listitem')).toHaveTextContent('Bonus: +$500.00 once on Nov 1, 2026 (hypothetical)One-time · Hypothetical income, not in your forecast');
  });

  it('a higher liability payment, from a date chosen from its schedule', async () => {
    const { user } = await mount();
    await open(user);
    const form = await choose(user, 'Increase a liability payment');
    expect((within(form).getByLabelText('New amount') as HTMLInputElement).value).toBe('300.00');
    expect(within(within(form).getByLabelText('Starting with')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Oct 28, 2026', 'Nov 28, 2026', 'Dec 28, 2026', 'Jan 28, 2027', 'Feb 28, 2027', 'Mar 28, 2027']);
    await fill(user, form, { 'New amount': '450', 'Starting with': '2026-11-28' });
    await user.click(within(form).getByRole('button', { name: 'Add to scenario' }));
    expect(changes()).toEqual(['Car loan: $450.00 from Nov 28, 2026']);
    const c = comparison();
    expect(within(c).getByRole('status')).toHaveTextContent('This scenario deepens a shortfall to $750.00 on Dec 1, back to $0 or more on Dec 4.');
    expect(within(within(c).getByRole('region', { name: 'What this assumes' })).getByRole('listitem')).toHaveTextContent('Car loan: $300.00 → $450.00 each time from Nov 28, 2026Recurring · Dates in this period: Nov 28, Dec 28');
    expect(rows(within(c).getByRole('table'))[3]).toEqual(['Ending running total', '$1,600.00', '$1,300.00']);
  });

  it('reserves from each payday', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Build reserves', { 'Amount each time': '100' });
    expect(changes()).toEqual(['Reserves: $100.00 each payday']);
    const c = comparison();
    expect(within(within(c).getByRole('region', { name: 'What this assumes' })).getByRole('listitem')).toHaveTextContent(
      'Reserves: −$100.00 set aside every 2 weeks from Oct 23, 2026Recurring · Dates in this period: Oct 23, Nov 6, Nov 20, Dec 4, Dec 18, Jan 1, Jan 15',
    );
    expect(rows(within(c).getByRole('table')).slice(1)).toEqual([
      ['Cash flow', '+$1,600.00', '+$900.00'],
      ['Lowest running total', '−$800.00 on Nov 1', '−$900.00 on Nov 1'],
      ['Ending running total', '$1,600.00', '$900.00'],
      ['Timing gaps', '2', '2'],
    ]);
  });

  it('moving an existing payment, chosen from what’s already expected', async () => {
    const { user } = await mount();
    await open(user);
    const form = await choose(user, 'Move an expected payment');
    expect(within(within(form).getByLabelText('Payment')).getAllByRole('option').map((o) => o.textContent).slice(0, 3)).toEqual(['Paycheck · Oct 23, 2026 · $1,000.00', 'Car loan · Oct 28, 2026 · $300.00', 'Rent · Nov 1, 2026 · $1,500.00']);
    await fill(user, form, { Payment: 'loan@2026-11-28', 'New date': '2026-12-05' });
    await user.click(within(form).getByRole('button', { name: 'Add to scenario' }));
    expect(changes()).toEqual(['Car loan on Nov 28, 2026: move to Dec 5, 2026']);
    expect(comparison()).toHaveTextContent('Smaller timing gap: Dec 1 – 3, down to −$300.00.');
  });

  it('changing an existing amount, starting from the amount it has now', async () => {
    const { user } = await mount();
    await open(user);
    const form = await choose(user, 'Change an expected amount');
    await fill(user, form, { Payment: 'rent@2026-12-01' });
    expect((within(form).getByLabelText('New amount') as HTMLInputElement).value).toBe('1500.00');
    await fill(user, form, { 'New amount': '1700' });
    await user.click(within(form).getByRole('button', { name: 'Add to scenario' }));
    expect(changes()).toEqual(['Rent on Dec 1, 2026: $1,700.00']);
    expect(within(comparison()).getByRole('status')).toHaveTextContent('This scenario deepens a shortfall to $800.00 on Dec 1, back to $0 or more on Dec 4.');
  });
});

describe('several changes', () => {
  it('a better ending with an earlier shortfall, then editing and removing changes', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Additional income', { Name: 'Tax refund', Amount: '2000', Date: '2027-01-10' });
    await add(user, 'Unexpected expense', { Name: 'Dentist', Amount: '900', Date: '2026-11-10' });
    expect(changes()).toEqual(['Tax refund: +$2,000.00 on Jan 10, 2027', 'Dentist: −$900.00 on Nov 10, 2026']);
    expect(within(comparison()).getByRole('status')).toHaveTextContent('Your projected ending total improves by $1,100.00, but this scenario creates a $700.00 shortfall on Nov 10, back to $0 or more on Nov 20.');

    // Edit: the dentist costs $100. Nov 10 stays at $100; Dec 1 goes to −$700.
    await user.click(within(sheet()).getByRole('button', { name: 'Edit Dentist: −$900.00 on Nov 10, 2026' }));
    const form = within(sheet()).getByRole('form', { name: 'Unexpected expense' });
    expect((within(form).getByLabelText('Amount') as HTMLInputElement).value).toBe('900.00');
    await fill(user, form, { Amount: '100' });
    await user.click(within(form).getByRole('button', { name: 'Save change' }));
    expect(changes()).toEqual(['Tax refund: +$2,000.00 on Jan 10, 2027', 'Dentist: −$100.00 on Nov 10, 2026']);
    expect(within(comparison()).getByRole('status')).toHaveTextContent('Your projected ending total improves by $1,900.00, but this scenario deepens a shortfall to $700.00 on Dec 1, back to $0 or more on Dec 4.');

    await user.click(within(sheet()).getByRole('button', { name: 'Remove Dentist: −$100.00 on Nov 10, 2026' }));
    expect(changes()).toEqual(['Tax refund: +$2,000.00 on Jan 10, 2027']);
    expect(within(comparison()).queryByRole('status')).toBeNull();
    expect(rows(within(comparison()).getByRole('table'))[3]).toEqual(['Ending running total', '$1,600.00', '$3,600.00']);
  });
});

describe('variable income', () => {
  it('low, expected and high side by side, all hypothetical', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Explore variable income', { Name: 'Delivery tips', Low: '0', Expected: '60', High: '120', 'How often': 'weekly', 'First date': '2026-10-24' });
    expect(changes()).toEqual(['Delivery tips: $0.00 / $60.00 / $120.00 (low / expected / high), every week from Oct 24, 2026']);
    const cases = within(sheet()).getByRole('region', { name: 'Income cases' });
    expect(cases).toHaveTextContent('All three are hypothetical. None is added to your forecast.');
    expect(rows(within(cases).getAllByRole('table')[0]!)).toEqual([
      ['Measure', 'Low', 'Expected', 'High'],
      ['Hypothetical income', '$0.00', '$780.00', '$1,560.00'],
      ['Cash flow', '+$1,600.00', '+$2,380.00', '+$3,160.00'],
      ['Lowest running total', '−$800.00 on Nov 1', '−$680.00 on Nov 1', '−$560.00 on Nov 1'],
      ['Timing gaps', '2', '2', '1'],
    ]);
    expect(within(cases).getByRole('radio', { name: 'Expected' })).toBeChecked();
    await user.click(within(cases).getByRole('radio', { name: 'High' }));
    expect(comparison()).toHaveTextContent('The timing gap Dec 1 – 3 would be gone.');
    expect(within(within(comparison()).getByRole('region', { name: 'What this assumes' })).getByRole('listitem')).toHaveTextContent('Delivery tips: +$120.00 every week from Oct 24, 2026 (hypothetical)Recurring · Hypothetical income, not in your forecast');
    // Only one set of income cases at a time.
    await user.click(within(sheet()).getByRole('button', { name: 'Add a change' }));
    expect(within(sheet()).queryByRole('button', { name: /^Explore variable income/ })).toBeNull();
  });
});

describe('problems and limits', () => {
  it('a conflicting change is pointed out on that change', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Move an expected payment', { Payment: 'rent@2026-11-01', 'New date': '2026-11-03' });
    await add(user, 'Change an expected amount', { Payment: 'rent@2026-11-01', 'New amount': '1200' });
    const items = within(within(sheet()).getByRole('region', { name: 'Your changes' })).getAllByRole('listitem');
    expect(items[0]).not.toHaveTextContent('Needs attention');
    expect(items[1]).toHaveTextContent('Needs attention: Change each transaction only once in a scenario.');
    expect(within(sheet()).getByRole('alert')).toHaveTextContent('One change needs attention before the scenario can be compared.');
    expect(within(sheet()).queryByRole('region', { name: 'Scenario comparison' })).toBeNull();
  });

  it('income cases out of order are pointed out on the income', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Explore variable income', { Name: 'Tips', Low: '80', Expected: '60', High: '120', 'How often': 'weekly', 'First date': '2026-10-24' });
    expect(within(within(sheet()).getByRole('region', { name: 'Your changes' })).getByRole('listitem')).toHaveTextContent('Needs attention: The low case can’t be more than expected, and expected can’t be more than high.');
  });

  it('missing amounts are caught in the form', async () => {
    const { user } = await mount();
    await open(user);
    const form = await choose(user, 'Unexpected expense');
    await user.click(within(form).getByRole('button', { name: 'Add to scenario' }));
    expect(form).toHaveTextContent('Enter an amount above $0.');
    expect(within(sheet()).getByRole('form', { name: 'Unexpected expense' })).toBeInTheDocument();
  });

  it('moving the next payday: running totals aren’t compared, and it says why', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Move an expected payment', { Payment: 'pay@2026-10-23', 'New date': '2026-10-26' });
    const c = comparison();
    expect(c).toHaveTextContent('This scenario moves your next payday from Oct 23, 2026 to Oct 26, 2026, so the running totals start on different days and can’t be compared directly.');
    expect(rows(within(c).getByRole('table'))).toEqual([
      ['Measure', 'Current forecast', 'With this scenario'],
      ['Cash flow', '+$1,600.00', '+$1,600.00'],
    ]);
  });

  it('an expense before the next payday is marked as cash flow only', async () => {
    const { user } = await mount();
    await open(user);
    await add(user, 'Unexpected expense', { Name: 'Groceries', Amount: '50', Date: '2026-10-19' });
    const c = comparison();
    expect(c).toHaveTextContent('Groceries: −$50.00 once on Oct 19, 2026: dates before your next payday (Oct 23, 2026) count in cash flow but not in the running total, which starts that day.');
    expect(within(within(c).getByRole('region', { name: 'What this assumes' })).getByRole('listitem')).toHaveTextContent('One-time · Before your next payday: cash flow only');
  });
});

describe('the plan stays as it is', () => {
  it('nothing is saved or changed, before or after closing', async () => {
    const d = plan();
    const { adapter, user } = await mount(d);
    const loaded = store.data;
    const saved = JSON.stringify(await adapter.load());
    await open(user);
    await add(user, 'Unexpected expense', { Name: 'Car repair', Amount: '800', Date: '2026-11-10' });
    await add(user, 'Change an expected amount', { Payment: 'rent@2026-12-01', 'New amount': '1700' });
    await add(user, 'Build reserves', { 'Amount each time': '100' });
    expect(store.data).toBe(loaded);
    await user.click(within(sheet()).getByRole('button', { name: 'Done' }));
    expect(store.data).toBe(loaded);
    expect(JSON.stringify(await adapter.load())).toBe(saved);
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/Car repair|scenario/i);
    // Reopening starts fresh.
    await open(user);
    expect(sheet()).toHaveTextContent('No changes yet.');
  });
});

describe('keyboard', () => {
  it('adds a change and returns focus without a mouse', async () => {
    const { user } = await mount();
    screen.getByRole('button', { name: 'Explore a scenario' }).focus();
    await user.keyboard('{Enter}');
    within(sheet()).getByRole('button', { name: 'Add a change' }).focus();
    await user.keyboard('{Enter}');
    expect(within(sheet()).getByRole('button', { name: /^Additional income/ })).toHaveFocus();
    await user.tab();
    expect(within(sheet()).getByRole('button', { name: /^Unexpected expense/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    const form = within(sheet()).getByRole('form', { name: 'Unexpected expense' });
    expect(within(form).getByLabelText('Name')).toHaveFocus();
    await user.tab();
    expect(within(form).getByLabelText('Amount')).toHaveFocus();
    await user.keyboard('250{Enter}');
    expect(changes()).toEqual(['Unexpected expense: −$250.00 on Oct 16, 2026']);
    expect(within(sheet()).getByRole('button', { name: 'Add a change' })).toHaveFocus();
  });
});
