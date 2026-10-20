import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

const SETUP = '2026-09-01';
const clock = (day: string) => ({ today: day, now: `${day}T12:00:00Z` }) as ops.Clock;

/** Phone is overdue (Oct 5, not recorded); Rent is next on Nov 1; Water has recorded history; Gym is off. */
function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-05', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
  d = source(d, SETUP, 'bill', 'Water', 40, '2026-09-20', { type: 'monthly' }, 'water');
  d = unwrap(ops.recordActual(d, 'water@2026-09-20', { amountCents: 4000, date: '2026-09-20' }, clock('2026-09-20')));
  d = unwrap(ops.recordActual(d, 'water@2026-10-20', { amountCents: 4000, date: '2026-10-12' }, clock('2026-10-12')));
  d = source(d, SETUP, 'subscription', 'Gym', 30, '2026-09-15', { type: 'monthly' }, 'gym');
  d = unwrap(ops.recordActual(d, 'gym@2026-09-15', { amountCents: 3000, date: '2026-09-15' }, clock('2026-09-15')));
  d = unwrap(ops.deactivateSource(d, 'gym', clock('2026-10-01')));
  return unwrap(ops.completeOnboarding(d));
}

const stored = (): AppData => JSON.parse(localStorage.getItem(STORAGE_KEY)!);

async function open(hash: string, data: AppData = plan()) {
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

const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 9, 0));
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

describe('Plan rows', () => {
  it("each item is one row with its schedule and true status: overdue first, otherwise the next date", async () => {
    await open('#/plan/expenses');
    await screen.findByRole('button', { name: /^Phone/ });
    expect(row('Phone')).toHaveTextContent('Monthly on the 5th · Overdue since Oct 5');
    expect(row('Rent')).toHaveTextContent('Monthly on the 1st · Next Nov 1');
    expect(row('Rent')).toHaveAttribute('aria-haspopup', 'dialog');
    // No buttons on the row itself, and active items carry no badge.
    expect(screen.queryByRole('button', { name: 'See dates' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(screen.queryByText('On')).toBeNull();
    expect(row('Rent')).not.toHaveTextContent('Off');
  });

  it('only an item that is off is marked, with the date it went off', async () => {
    const user = await open('#/plan/expenses');
    await user.click(within(await screen.findByRole('tablist', { name: 'Expense type' })).getByRole('tab', { name: 'Subscriptions' }));
    expect(row('Gym')).toHaveTextContent(/Off since Oct 1.*Off$/);
  });
});

describe('the item sheet', () => {
  it('holds the dates, Edit and Turn off; Delete only when nothing has been recorded', async () => {
    const user = await open('#/plan/expenses');
    await user.click(await screen.findByRole('button', { name: /^Rent/ }));
    let sheet = screen.getByRole('dialog', { name: 'Rent' });
    expect(within(sheet).getByRole('region', { name: 'Recent and upcoming dates' })).toHaveTextContent('Nov 1, 2026');
    expect(within(sheet).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(row('Water'));
    sheet = screen.getByRole('dialog', { name: 'Water' });
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('Edit opens the item form', async () => {
    const user = await open('#/plan/expenses');
    await user.click(await screen.findByRole('button', { name: /^Rent/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Rent' })).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog', { name: 'Edit Rent' })).toBeInTheDocument();
  });

  it('Delete asks first, then removes the item from the plan', async () => {
    const user = await open('#/plan/expenses');
    await user.click(await screen.findByRole('button', { name: /^Rent/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Rent' })).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete Rent?' });
    expect(confirm).toHaveTextContent('It leaves your plan and your forecast.');
    await user.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Rent' })).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete Rent?' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Deleted Rent.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Rent/ })).toBeNull();
    await waitFor(() => expect(stored().sources.some((s) => s.id === 'rent')).toBe(false));
  });

  it('a date opened from the sheet returns to the sheet when closed', async () => {
    const user = await open('#/plan/expenses');
    await user.click(await screen.findByRole('button', { name: /^Phone/ }));
    await user.click(within(screen.getByRole('region', { name: 'Recent and upcoming dates' })).getByRole('button', { name: /^Oct 5, 2026/ }));
    const occurrence = screen.getByRole('dialog', { name: 'Phone' });
    expect(within(occurrence).getByRole('button', { name: 'Record paid' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    const sheet = await screen.findByRole('dialog', { name: 'Phone' });
    expect(within(sheet).getByRole('region', { name: 'Recent and upcoming dates' })).toBeInTheDocument();
  });

  it('Turn off asks first, then the sheet shows Turn on and the row is marked off', async () => {
    const user = await open('#/plan/expenses');
    await user.click(await screen.findByRole('button', { name: /^Rent/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Rent' })).getByRole('button', { name: 'Turn off' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Turn off Rent?' })).getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByText('Rent turned off.')).toBeInTheDocument();
    const sheet = screen.getByRole('dialog', { name: 'Rent' });
    expect(within(sheet).getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Off since Oct 13');
    await waitFor(() => expect(stored().sources.find((s) => s.id === 'rent')!.active).toBe(false));
  });
});
