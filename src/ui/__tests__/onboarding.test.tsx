import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildForecast } from '../../domain/forecast';
import { hasActiveIncome } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { useStore } from '../../state/store';
import { ToastProvider } from '../components/common';
import { Onboarding } from '../screens/Onboarding';

/*
 * Today is Fri 2026-10-16. The minimum setup: paid $1,000 every other Friday
 * from Oct 23, rent $1,500 monthly from Nov 1. First pay period Oct 23 – Nov 5:
 * +$1,000 − $1,500 = −$500. Running totals: Oct 23 1,000; Nov 1 −500; Nov 6
 * 500; Nov 20 1,500; Dec 1 0 (not below $0); so one timing gap, Nov 1 – 5.
 */
const TODAY = '2026-10-16';

let store: ReturnType<typeof useStore>;
function Spy() {
  store = useStore();
  return null;
}

type User = ReturnType<typeof userEvent.setup>;
const cashFlow = () => screen.getByText('Cash flow', { selector: '.lts-label' }).closest('[role="status"]');

async function start() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <DataModeProvider>
      <ToastProvider>
        <Spy />
        <Onboarding />
      </ToastProvider>
    </DataModeProvider>,
  );
  await screen.findByRole('heading', { name: 'When do you get paid?' });
  return user;
}

async function addItem(user: User, addLabel: string | RegExp, fields: [string, string][]) {
  await user.click(screen.getByRole('button', { name: addLabel }));
  const dialog = screen.getByRole('dialog');
  for (const [label, value] of fields) {
    const el = within(dialog).getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
    if (el.tagName === 'SELECT') await user.selectOptions(el, value);
    else if (el.type === 'date') fireEvent.change(el, { target: { value } });
    else {
      await user.clear(el);
      await user.type(el, value);
    }
  }
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(screen.queryByRole('dialog')).toBeNull();
}

const paycheck: [string, string][] = [
  ['What is this income?', 'Paycheck'],
  ['Amount you expect to receive', '1000'],
  ['How often?', 'biweekly'],
  ['Next payment date', '2026-10-23'],
];
const rent: [string, string][] = [
  ['What is this bill?', 'Rent'],
  ['Amount you expect to pay', '1500'],
  ['How often?', 'monthly'],
  ['Next due date', '2026-11-01'],
];

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 16, 9, 0));
});
afterEach(() => vi.useRealTimers());

describe('the minimum useful setup', () => {
  it('three steps: income, then regular payments, then the review and the forecast', async () => {
    const user = await start();
    expect(screen.getByText('Step 1 of 3 · Income')).toBeInTheDocument();
    // No cash flow figure before there's income to base it on.
    expect(screen.queryByText('Cash flow', { selector: '.lts-label' })).toBeNull();
    await addItem(user, 'Add income', paycheck);
    expect(cashFlow()).toHaveTextContent('Cash flowFirst pay period · Oct 23 – Nov 5+$1,000.00');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'What do you pay regularly?' })).toHaveFocus();
    expect(screen.getByText('Step 2 of 3 · Payments')).toBeInTheDocument();
    await addItem(user, 'Add a payment', rent);
    expect(cashFlow()).toHaveTextContent('Cash flowFirst pay period · Oct 23 – Nov 5−$500.00');

    // Subscriptions, liabilities and reserves can wait.
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Check everything over' })).toHaveFocus();
    expect(screen.getByText('Next expected payday').closest('section')).toHaveTextContent('Next expected paydayOct 23in 7 days');
    expect(screen.getByText(/Lowest running total before Nov 5:/).closest('span')).toHaveTextContent('Lowest running total before Nov 5: −$500.00 · Nov 1');
    expect(screen.getByRole('button', { name: /1 timing gap ahead/ })).toBeInTheDocument();
    // Kinds with nothing added collapse into one line, each name a way to add it.
    for (const label of ['Subscriptions', 'Liability payments', 'Strategic Reserves']) expect(screen.queryByRole('region', { name: label })).toBeNull();
    expect(document.querySelector('.review-missing')).toHaveTextContent(/^Not added: subscriptions, liability payments, Strategic Reserves\.$/);
    expect(screen.getByRole('button', { name: 'Add liability payments' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Looks right' }));
    expect(store.data.onboardingComplete).toBe(true);
    expect(store.data.sources.map((s) => [s.kind, s.description, s.versions[0]!.amountCents, s.versions[0]!.startDate])).toEqual([
      ['income', 'Paycheck', 100000, '2026-10-23'],
      ['bill', 'Rent', 150000, '2026-11-01'],
    ]);
    expect(store.data.records).toEqual([]);
    expect(buildForecast(store.data, TODAY)).toMatchObject({ anchor: '2026-10-22', forecastStart: '2026-10-23', issue: null });
  });

  it('the first screen also offers sample data and a restore, and asks for income before continuing', async () => {
    const user = await start();
    expect(screen.getByRole('button', { name: 'Explore with sample data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore a backup' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Add your income to see what's ahead.");
    await user.click(screen.getByRole('button', { name: 'Continue without income' }));
    expect(screen.getByRole('heading', { name: 'What do you pay regularly?' })).toBeInTheDocument();
  });

  it('one list holds bills, subscriptions and liability payments, picked in the add sheet; reserves are optional', async () => {
    const user = await start();
    await addItem(user, 'Add income', paycheck);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Set money aside on a schedule (optional).')).toBeInTheDocument();
    await addItem(user, 'Add a payment', rent);
    await user.click(screen.getByRole('button', { name: 'Add another payment' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a payment' });
    const picker = within(dialog).getByRole('group', { name: 'What kind of payment?' });
    expect(within(picker).getByRole('radio', { name: 'Bill' })).toBeChecked();
    await user.click(within(picker).getByRole('radio', { name: 'Subscription' }));
    expect(within(dialog).getByLabelText('What is this subscription?')).toBeInTheDocument();
    await user.click(within(picker).getByRole('radio', { name: 'Loan or card payment' }));
    for (const [label, value] of [
      ['What is this payment for?', 'Car loan'],
      ['Payment amount', '350'],
      ['Next payment due date', '2026-10-28'],
    ] as [string, string][]) {
      const el = within(dialog).getByLabelText(label) as HTMLInputElement;
      if (el.type === 'date') fireEvent.change(el, { target: { value } });
      else await user.type(el, value);
    }
    await user.click(within(dialog).getByRole('radio', { name: 'Loan' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.data.sources.map((s) => [s.kind, s.description])).toEqual([
      ['income', 'Paycheck'],
      ['bill', 'Rent'],
      ['liability', 'Car loan'],
    ]);
    const list = screen.getByRole('button', { name: /^Rent/ }).closest('ul')!;
    expect(within(list).getByRole('button', { name: /^Car loan/ })).toBeInTheDocument();
  });
});

describe('the review', () => {
  async function reachReview(extra?: (user: User) => Promise<void>) {
    const user = await start();
    await addItem(user, 'Add income', paycheck);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await addItem(user, 'Add a payment', rent);
    if (extra) await extra(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    return user;
  }

  it('says when payments fall before the running total starts', async () => {
    await reachReview((user) => addItem(user, 'Add another payment', [['What is this bill?', 'Phone'], ['Amount you expect to pay', '60'], ['How often?', 'monthly'], ['Next due date', '2026-10-20']]));
    expect(screen.getByRole('note')).toHaveTextContent("1 payment ($60.00) is due before your next payday. Make sure the money you have now covers it.");
  });

  it('says nothing about that when nothing is due before payday', async () => {
    await reachReview();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('a mistake is corrected by tapping it, and the forecast updates', async () => {
    const user = await reachReview();
    await user.click(screen.getByRole('button', { name: /^Rent/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Rent' });
    const amount = within(dialog).getByLabelText('Amount you expect to pay');
    await user.clear(amount);
    await user.type(amount, '1400');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.getByText(/Lowest running total before Nov 5:/).closest('span')).toHaveTextContent('Lowest running total before Nov 5: −$400.00 · Nov 1');
    expect(store.data.sources.find((s) => s.description === 'Rent')!.versions.map((v) => v.amountCents)).toEqual([140000]);
  });

  it('"Change something" goes back to the payments, and "Add" links lead there too', async () => {
    const user = await reachReview();
    await user.click(screen.getByRole('button', { name: 'Add subscriptions' }));
    expect(screen.getByRole('heading', { name: 'What do you pay regularly?' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Change something' }));
    expect(screen.getByRole('heading', { name: 'What do you pay regularly?' })).toHaveFocus();
  });

  it('with two incomes, the earliest one sets the payday', async () => {
    const user = await start();
    await addItem(user, 'Add income', paycheck);
    await addItem(user, 'Add another income', [['What is this income?', 'Side job'], ['Amount you expect to receive', '200'], ['How often?', 'weekly'], ['Next payment date', '2026-10-19']]);
    expect(hasActiveIncome(store.data)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Next expected payday').closest('section')).toHaveTextContent('Next expected paydayOct 19in 3 days');
  });
});

describe('keyboard', () => {
  it('reaches the review from the keyboard', async () => {
    const user = await start();
    await addItem(user, 'Add income', paycheck);
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'What do you pay regularly?' })).toHaveFocus();
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Check everything over' })).toHaveFocus();
  });
});

