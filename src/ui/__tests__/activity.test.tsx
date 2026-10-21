import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

const SETUP = '2026-09-01';

function recorded(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-01', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-10-01', { type: 'monthly' }, 'rent');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-15', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'subscription', 'Music', 10.99, '2026-10-10', { type: 'monthly' }, 'music');
  d = source(d, SETUP, 'reserve', 'Savings', 100, '2026-10-05', { type: 'monthly' }, 'save');

  const clock = (day: string) => ({ today: day, now: `${day}T12:00:00Z` } as ops.Clock);
  d = unwrap(ops.recordActual(d, 'pay@2026-10-01', { amountCents: 180000, date: '2026-10-01' }, clock('2026-10-01')));
  d = unwrap(ops.recordActual(d, 'rent@2026-10-01', { amountCents: 120000, date: '2026-10-01' }, clock('2026-10-01')));
  d = unwrap(ops.recordActual(d, 'phone@2026-10-15', { amountCents: 5500, date: '2026-10-16' }, clock('2026-10-16')));
  d = unwrap(ops.recordActual(d, 'music@2026-10-10', { amountCents: 1099, date: '2026-10-10' }, clock('2026-10-10')));
  d = unwrap(ops.recordActual(d, 'save@2026-10-05', { amountCents: 10000, date: '2026-10-05' }, clock('2026-10-05')));
  return unwrap(ops.completeOnboarding(d));
}

function empty(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-01', { type: 'biweekly' }, 'pay');
  return unwrap(ops.completeOnboarding(d));
}

async function open(hash: string, data: AppData) {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = hash;
  render(
    <DataModeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>,
  );
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 19, 9, 0));
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

describe('Activity screen', () => {
  it('renders the summary with received, paid, and cash flow', async () => {
    await open('#/activity', recorded());
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    const summary = screen.getByRole('region', { name: 'Month summary' });
    expect(within(summary).getByText('Received')).toBeInTheDocument();
    expect(within(summary).getByText('Paid')).toBeInTheDocument();
    expect(within(summary).getByText('Cash flow')).toBeInTheDocument();
  });

  it('lists recorded items', async () => {
    await open('#/activity', recorded());
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    expect(screen.getByText('Paycheck')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
  });

  it('shows the by-kind breakdown with recorded labels, inside the one summary', async () => {
    await open('#/activity', recorded());
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    const summary = screen.getByRole('region', { name: 'Month summary' });
    expect(within(summary).getByText('Received', { selector: 'dt' })).toBeInTheDocument();
    expect(within(summary).getByText('Paid', { selector: 'dt' })).toBeInTheDocument();
    expect(within(summary).getByText('Bills', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'By kind' })).toBeNull();
  });

  it('shows kind filter chips and filters the list by kind', async () => {
    const user = await open('#/activity', recorded());
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    const chips = screen.getByRole('group', { name: 'Filter by kind' });
    const billChip = within(chips).getByRole('button', { name: 'Bill' });
    await user.click(billChip);
    expect(billChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.queryByText('Paycheck')).not.toBeInTheDocument();
    expect(screen.queryByText('Music')).not.toBeInTheDocument();
  });

  it('toggles off the filter when clicking the same chip again', async () => {
    const user = await open('#/activity', recorded());
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    const chips = screen.getByRole('group', { name: 'Filter by kind' });
    const billChip = within(chips).getByRole('button', { name: 'Bill' });
    await user.click(billChip);
    expect(screen.queryByText('Paycheck')).not.toBeInTheDocument();
    await user.click(billChip);
    expect(billChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Paycheck')).toBeInTheDocument();
  });

  it('shows empty state when no items are recorded in the month', async () => {
    await open('#/activity', empty());
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    expect(screen.getByText('Payments you record show up here.')).toBeInTheDocument();
  });

  it('shows variance info for items with different actual amounts', async () => {
    await open('#/activity', recorded());
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    expect(screen.getByText(/Expected \$60\.00 on Oct 15/)).toBeInTheDocument();
  });

  it('opens the occurrence sheet when clicking an item', async () => {
    const user = await open('#/activity', recorded());
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    const list = screen.getByRole('list');
    const paycheck = within(list).getAllByRole('button').find((b) => b.textContent?.includes('Paycheck'))!;
    await user.click(paycheck);
    expect(await screen.findByRole('dialog', { name: 'Paycheck' })).toBeInTheDocument();
  });
});
