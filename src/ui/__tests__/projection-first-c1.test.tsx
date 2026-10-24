import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

// C1 in the interface: no income certainty, projected income counts, and the forecast starts where the person chooses.
// Tuesday Oct 13, 2026.
const SETUP = '2026-10-01';

/** Paycheck $1,000 every 2 weeks from Oct 16; rent $800 on the 25th. */
function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1000, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 800, '2026-10-25', { type: 'monthly' }, 'rent');
  return unwrap(ops.completeOnboarding(d));
}

async function openApp(hash: string, data: AppData) {
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
  vi.setSystemTime(new Date(2026, 9, 13, 9, 0));
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!) as AppData;
const projected = () => document.querySelector('.progress-card .hero-value')!.textContent;

describe('income entry asks no certainty question', () => {
  it('a one-time income has no Expected/Possible choice, and counts on its date as projected', async () => {
    const user = await openApp('#/plan/income', plan());
    await user.click(await screen.findByRole('button', { name: 'Add one-time' }));
    const sheet = screen.getByRole('dialog', { name: 'Add one-time income' });
    expect(within(sheet).queryByRole('group', { name: 'How sure is this income?' })).toBeNull();
    expect(within(sheet).queryByText(/possible/i)).toBeNull();
    await user.type(within(sheet).getByLabelText('Description'), 'Invoice');
    await user.type(within(sheet).getByLabelText('Expected amount'), '500');
    await user.clear(within(sheet).getByLabelText('Expected date'));
    await user.type(within(sheet).getByLabelText('Expected date'), '2026-10-15');
    await user.click(within(sheet).getByRole('button', { name: 'Add one-time income' }));
    expect(JSON.stringify(stored())).not.toContain('certainty');

    // Home: October projected is +$1,000 × 2 paychecks − $800 rent + the $500 invoice.
    await user.click(screen.getAllByRole('link', { name: 'Home' })[0]!);
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(projected()).toBe('+$1,700.00');
    expect(screen.queryByRole('region', { name: 'Possible' })).toBeNull();
    const row = within(screen.getByRole('region', { name: 'Coming up' })).getByRole('button', { name: /^Invoice/ });
    await user.click(row);
    const dialog = screen.getByRole('dialog', { name: 'Invoice' });
    expect(dialog.querySelector('.details')).toHaveTextContent('Expected$500.00 on Oct 15, 2026');
    expect(within(dialog).getByRole('button', { name: 'Record received' })).toHaveClass('primary');
    expect(within(dialog).queryByRole('button', { name: /possible|expected/i })).toBeNull();
  });

  it('a recurring income form has no certainty choice either', async () => {
    const user = await openApp('#/plan/income', plan());
    await user.click(await screen.findByRole('button', { name: /^Paycheck/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Paycheck' })).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'How sure is this income?' })).toBeNull();
  });
});

describe('the forecast starts where the person chooses', () => {
  it('Month view: the running total starts on the 1st, at a stated $0 that is not a bank balance', async () => {
    const user = await openApp('#/forecast', plan());
    const hero = await screen.findByRole('region', { name: 'Cash flow' });
    expect(hero).toHaveTextContent('Running total from Oct 1');
    expect(hero).toHaveTextContent('Starts at $0, not your bank balance.');
    expect(hero).not.toHaveTextContent(/paycheck|payday/i);
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('region', { name: 'Cash flow' })).toHaveTextContent('Running total from Nov 1');
  });

  it('Custom view: the chosen start date is the running total’s first day', async () => {
    const user = await openApp('#/forecast', plan());
    await screen.findByRole('region', { name: 'Cash flow' });
    await user.click(screen.getByRole('tab', { name: 'Custom' }));
    const start = screen.getByLabelText('Start date');
    await user.clear(start);
    await user.type(start, '2026-10-20');
    expect(screen.getByRole('region', { name: 'Cash flow' })).toHaveTextContent('Running total from Oct 20');
  });

  it('a plan with only bills still forecasts: nothing asks for a recurring income first', async () => {
    const d = unwrap(ops.completeOnboarding(source(ops.emptyData(), SETUP, 'bill', 'Rent', 800, '2026-10-25', { type: 'monthly' }, 'rent')));
    await openApp('#/forecast', d);
    const hero = await screen.findByRole('region', { name: 'Cash flow' });
    expect(hero).toHaveTextContent('−$800.00');
    expect(screen.queryByText(/Add a recurring income/)).toBeNull();
  });
});
