import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source } from '../../domain/__tests__/helpers';
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
  // Income, then regular payments, then the review.
  for (let i = 0; i < 2; i++) await user.click(screen.getByRole('button', { name: 'Continue' }));
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
    expect(screen.getByText(/Lowest running total before Oct 28:/)).toBeInTheDocument();

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

  it('shows nothing when there are no timing gaps', async () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
    await reachReview(d);
    expect(screen.queryByText(/timing gap/i)).toBeNull();
    expect(screen.getByText(/Lowest running total before Oct 28:/)).toBeInTheDocument();
  });
  it('starts from the earliest income, so the gap before a later paycheck shows (whatever was entered first)', async () => {
    // The Oct 27 paycheck is entered first; the Oct 19 weekend job arrives before it.
    let d = source(ops.emptyData(), TODAY, 'income', 'Restaurant paycheck', 900, '2026-10-27', { type: 'biweekly' }, 'late');
    d = source(d, TODAY, 'income', 'Weekend job', 400, '2026-10-19', { type: 'biweekly' }, 'early');
    d = source(d, TODAY, 'bill', 'Rent', 1000, '2026-10-22', { type: 'monthly' }, 'rent');
    await reachReview(d);

    expect(screen.getByText('Next expected payday').closest('section')).toHaveTextContent('Oct 19in 8 days');
    expect(screen.getByText(/Lowest running total before Nov 1:/).closest('span')).toHaveTextContent('Lowest running total before Nov 1: −$600.00 · Oct 22');
    expect(screen.getByRole('button', { name: /1 timing gap ahead/ })).toBeInTheDocument();
    // Rent comes after the first income, so it isn't described as due before payday.
    expect(screen.queryByText(/due before your next payday/)).toBeNull();
    // Cash flow covers Oct 19 – Nov 1: $400 + $900 − $1,000.
    expect(document.querySelector('.left-to-spend')).toHaveTextContent('Cash flowFirst pay period · Oct 19 – Nov 1+$300.00');
  });
});
