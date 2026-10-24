import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter } from '../../state/storage';
import { ToastProvider } from '../components/common';
import { Onboarding } from '../screens/Onboarding';

const TODAY = '2026-10-11';

async function reachReview(data: AppData) {
  await new LocalStorageAdapter().save(data, 0);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <DataModeProvider>
      <ToastProvider>
        <Onboarding />
      </ToastProvider>
    </DataModeProvider>,
  );
  await screen.findByRole('heading', { name: 'When do you get paid?' });
  // Income, then regular payments, then the review. Without income, setup asks once before moving on.
  for (let i = 0; i < 2; i++) {
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const anyway = screen.queryByRole('button', { name: 'Continue without income' });
    if (anyway) await user.click(anyway);
  }
  await screen.findByRole('heading', { name: 'Check everything over' });
  return user;
}

describe('timing gaps at the end of setup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 9, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('warns and lists every gap when the running total goes below $0', async () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 1600, '2026-10-20', { type: 'monthly' }, 'rent');
    const user = await reachReview(d);

    // The lowest point stays on the summary card.
    expect(screen.getByRole('region', { name: /running total/i })).toHaveTextContent('Lowest running total through Nov 7−$600.00Oct 20');

    await user.click(screen.getByRole('button', { name: /2 timing gaps ahead/ }));
    const sheet = screen.getByRole('dialog', { name: '2 timing gaps ahead' });
    // One expandable section per gap.
    const items = within(sheet).getAllByRole('group');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Oct 20 – 28 · 9 days');
    expect(items[0]).toHaveTextContent('Down to −$600.00 on Oct 20');
    expect(items[1]).toHaveTextContent('Nov 20 – 25 · 6 days');
    expect(items[1]).toHaveTextContent('Down to −$200.00 on Nov 20');
  });

  it('one income: the first look is the next four weeks from today, and shows nothing about gaps when there are none', async () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
    await reachReview(d);
    expect(screen.queryByText(/timing gap/i)).toBeNull();
    // Oct 11 – Nov 7: paychecks Oct 15 and 29, rent Nov 1. $1,800 × 2 − $1,200.
    expect(document.querySelector('.left-to-spend')).toHaveTextContent('Cash flowNext 4 weeks · Oct 11 – Nov 7+$2,400.00');
    const breakdown = screen.getByRole('region', { name: 'Next 4 weeks' });
    // The banner above gives the range and the cash flow; the breakdown lists what makes it up.
    expect(breakdown).toHaveTextContent(/^Next 4 weeksIncome\+\$3,600\.00Spending−\$1,200\.00Bills\$1,200\.00$/);
    // Never below $0: the card gives where the running total ends up (Oct 15 and 29 paychecks, Nov 1 rent).
    expect(screen.getByRole('region', { name: /running total/i })).toHaveTextContent('Running total on Nov 7$2,400.00never below $0');
    expect(screen.queryByText(/First pay period/)).toBeNull();
  });

  it('a payment already recorded in the window counts once, at what actually came in', async () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
    d = unwrap(ops.recordActual(d, 'pay@2026-10-15', { amountCents: 95000, date: TODAY }, { today: TODAY, now: `${TODAY}T12:00:00Z` }));
    await reachReview(d);
    // $950 received today, then $1,800 on Oct 29, less $1,200 rent.
    expect(document.querySelector('.left-to-spend')).toHaveTextContent('Cash flowNext 4 weeks · Oct 11 – Nov 7+$1,550.00');
    expect(screen.getByRole('region', { name: 'Next 4 weeks' })).toHaveTextContent(/Income\+\$2,750\.00/);
  });

  it('no income: bills alone still forecast, showing the shortfall from today', async () => {
    const d = source(ops.emptyData(), TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
    await reachReview(d);
    expect(screen.queryByText(/Add your income/)).toBeNull();
    expect(document.querySelector('.left-to-spend')).toHaveTextContent('Cash flowNext 4 weeks · Oct 11 – Nov 7−$1,200.00');
    expect(screen.getByRole('region', { name: /running total/i })).toHaveTextContent('Lowest running total through Nov 7−$1,200.00Nov 1');
  });

  it('nothing at all: only the prompt to add income or a payment', async () => {
    await reachReview(ops.emptyData());
    expect(screen.getByText("Add your income or a payment to see what's ahead.")).toBeInTheDocument();
    expect(document.querySelector('.left-to-spend')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Next 4 weeks' })).toBeNull();
  });
  it('several incomes: all of them count in the four weeks, and the gap before a later paycheck shows (whatever was entered first)', async () => {
    // The Oct 27 paycheck is entered first; the Oct 19 weekend job arrives before it.
    let d = source(ops.emptyData(), TODAY, 'income', 'Restaurant paycheck', 900, '2026-10-27', { type: 'biweekly' }, 'late');
    d = source(d, TODAY, 'income', 'Weekend job', 400, '2026-10-19', { type: 'biweekly' }, 'early');
    d = source(d, TODAY, 'bill', 'Rent', 1000, '2026-10-22', { type: 'monthly' }, 'rent');
    await reachReview(d);

    expect(screen.queryByText(/payday/i)).toBeNull();
    expect(screen.getByRole('region', { name: /running total/i })).toHaveTextContent('Lowest running total through Nov 7−$600.00Oct 22');
    expect(screen.getByRole('button', { name: /1 timing gap ahead/ })).toBeInTheDocument();
    // Oct 11 – Nov 7: weekend job Oct 19 and Nov 2, restaurant paycheck Oct 27, rent Oct 22. $400 + $900 + $400 − $1,000.
    expect(document.querySelector('.left-to-spend')).toHaveTextContent('Cash flowNext 4 weeks · Oct 11 – Nov 7+$700.00');
  });
});
