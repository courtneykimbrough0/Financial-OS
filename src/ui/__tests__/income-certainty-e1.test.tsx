import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { AccountGate, useAccount, type AccountUser, type AuthService } from '../../state/account';
import { CloudAdapter } from '../../state/cloud';
import { DataModeProvider } from '../../state/mode';
import { AccountSlotContext, type AccountSlot } from '../../state/slots';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { FakeServer } from '../../state/__tests__/fake-server';
import { App } from '../App';
import { ToastProvider } from '../components/common';
import { SignIn } from '../screens/SignIn';

// E1: possible income in the interface. Tuesday Oct 13, 2026; the week is Sun Oct 11 – Sat Oct 17.
const SETUP = '2026-10-01';

/** Paycheck $1,000 every 2 weeks from Oct 16; rent $800 on the 25th. */
function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1000, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 800, '2026-10-25', { type: 'monthly' }, 'rent');
  return unwrap(ops.completeOnboarding(d));
}

async function openApp(hash: string, data: AppData, wrap: (ui: React.ReactNode) => React.ReactNode = (ui) => ui) {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = hash;
  render(
    wrap(
      <DataModeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DataModeProvider>,
    ),
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

describe('E1 possible income on device storage', () => {
  it('a one-time income added as possible is listed apart, counted nowhere, and one tap makes it expected', async () => {
    const user = await openApp('#/plan/income', plan());
    await user.click(await screen.findByRole('button', { name: 'Add one-time' }));
    const sheet = screen.getByRole('dialog', { name: 'Add one-time income' });
    const certainty = within(sheet).getByRole('group', { name: 'How sure is this income?' });
    expect(within(certainty).getByRole('radio', { name: 'Expected' })).toBeChecked();
    await user.click(within(certainty).getByRole('radio', { name: 'Possible' }));
    expect(within(sheet).getByText(/Shown, but not counted in cash flow or the running total/)).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('Description'), 'Invoice');
    await user.type(within(sheet).getByLabelText('Expected amount'), '500');
    await user.clear(within(sheet).getByLabelText('Expected date'));
    await user.type(within(sheet).getByLabelText('Expected date'), '2026-10-15');
    await user.click(within(sheet).getByRole('button', { name: 'Add one-time income' }));
    expect(stored().records.find((r) => r.description === 'Invoice')!.certainty).toBe('possible');
    expect(screen.getByText('Expected and possible')).toHaveClass('subhead');

    // Home: October projected is +$1,000 paychecks (Oct 16 and 30) − $800 rent, with or without the invoice.
    await user.click(screen.getAllByRole('link', { name: 'Home' })[0]!);
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(projected()).toBe('+$1,200.00');
    const possible = screen.getByRole('region', { name: 'Possible' });
    const row = within(possible).getByRole('button', { name: /^Invoice/ });
    expect(within(row).getByText('Possible')).toHaveClass('badge', 'badge-possible');
    expect(within(row).getByText('Not counted until expected or received')).toBeInTheDocument();
    // The amount is muted, not struck through (nothing was canceled).
    const amount = within(row).getByText('+$500.00');
    expect(amount).toHaveClass('amount', 'possible');
    expect(amount.tagName).not.toBe('S');
    expect(within(screen.getByRole('region', { name: 'Coming up' })).queryByText('Invoice')).toBeNull();

    await user.click(row);
    const dialog = screen.getByRole('dialog', { name: 'Invoice' });
    expect(within(dialog).getByText(/Possible income isn't counted in cash flow or the running total/)).toBeInTheDocument();
    expect(dialog.querySelector('.details')).toHaveTextContent('Possible$500.00 on Oct 15, 2026');
    expect(within(dialog).getByRole('button', { name: 'Record received' })).toHaveClass('primary');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as expected' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stored().records.find((r) => r.description === 'Invoice')).not.toHaveProperty('certainty');
    expect(projected()).toBe('+$1,700.00');
    expect(screen.queryByRole('region', { name: 'Possible' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Coming up' })).getByText('Invoice')).toBeInTheDocument();
  });

  it('a recurring income marked possible on its form shows Possible in Plan, and its payments say so', async () => {
    const user = await openApp('#/plan/income', plan());
    await user.click(await screen.findByRole('button', { name: /^Paycheck/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Paycheck' })).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('dialog');
    await user.click(within(within(form).getByRole('group', { name: 'How sure is this income?' })).getByRole('radio', { name: 'Possible' }));
    await user.click(within(form).getByRole('button', { name: /^Save/ }));
    expect(stored().sources.find((s) => s.id === 'pay')!.certainty).toBe('possible');
    // Schedules aren't touched by the mark.
    expect(stored().sources.find((s) => s.id === 'pay')!.versions).toEqual(plan().sources.find((s) => s.id === 'pay')!.versions.map((v) => ({ ...v, id: expect.any(String) })));
    const section = screen.getByRole('region', { name: 'Recurring income' });
    expect(within(within(section).getByRole('button', { name: /^Paycheck/ })).getByText('Possible')).toHaveClass('badge-possible');
  });
});

describe('E1 storage that keeps possible income decides whether it is offered', () => {
  it('signed in with Firebase the choice is hidden (decision D8)', async () => {
    const server = new FakeServer();
    const account: AccountUser = { id: 'u1', email: 'alex@example.com' };
    const auth: AuthService = {
      currentUser: async () => account,
      onSignedOut: () => () => {},
      signInWithGoogle: async () => account,
      signOut: async () => {},
      deleteAccount: async () => {},
      adapterFor: (u) => new CloudAdapter(server, u.id, localStorage),
    };
    server.row = { data: { ...plan(), revision: 1 }, revision: 1 };
    window.location.hash = '#/plan/income';
    function WithData() {
      const a = useAccount();
      return (
        <DataModeProvider adapter={a?.adapter}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </DataModeProvider>
      );
    }
    render(
      <AccountGate auth={auth} signIn={(done) => <SignIn auth={auth} onSignedIn={done} />}>
        <WithData />
      </AccountGate>,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: 'Add one-time' }));
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'How sure is this income?' })).toBeNull();
  });

  it('the Supabase build offers it, since its database keeps it', async () => {
    const slot: AccountSlot = { Card: () => null, Line: () => null, Guard: () => null, dataNote: '' };
    const user = await openApp('#/plan/income', plan(), (ui) => <AccountSlotContext.Provider value={slot}>{ui}</AccountSlotContext.Provider>);
    await user.click(await screen.findByRole('button', { name: 'Add one-time' }));
    expect(within(screen.getByRole('dialog')).getByRole('group', { name: 'How sure is this income?' })).toBeInTheDocument();
  });

  it('only income has the choice', async () => {
    const user = await openApp('#/plan/expenses', plan());
    await user.click(await screen.findByRole('button', { name: /^Rent/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Rent' })).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('What is this bill?')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'How sure is this income?' })).toBeNull();
  });
});
