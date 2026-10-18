import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { AccountGate, useAccount, type AccountUser, type AuthService } from '../../state/account';
import { CloudAdapter } from '../../state/cloud';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { FakeServer } from '../../state/__tests__/fake-server';
import { App } from '../App';
import { ToastProvider } from '../components/common';
import { SignIn } from '../screens/SignIn';

const TODAY = '2026-10-11';

function plan(): AppData {
  let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');
  return unwrap(ops.completeOnboarding(d));
}

const stored = (): AppData => JSON.parse(localStorage.getItem(STORAGE_KEY)!);

async function renderAt(route: string, data: AppData) {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = `#/${route}`;
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <DataModeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>,
  );
  return user;
}

async function addAccount(user: ReturnType<typeof userEvent.setup>, name: string, type: string) {
  await user.click(await screen.findByRole('button', { name: 'Add account' }));
  const sheet = screen.getByRole('dialog', { name: 'Add account' });
  await user.type(within(sheet).getByLabelText('Name'), name);
  await user.click(within(sheet).getByRole('radio', { name: type }));
  await user.click(within(sheet).getByRole('button', { name: 'Add account' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add account' })).toBeNull());
}

describe('accounts in Settings and on item forms', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 9, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('adds accounts of each type, lists them, and renames one without losing it', async () => {
    const user = await renderAt('settings', plan());
    await screen.findByRole('heading', { name: 'Accounts' });
    const section = () => screen.getByRole('region', { name: 'Accounts' });
    expect(section()).toHaveTextContent('Optional: name the accounts your money moves through');

    await addAccount(user, 'Paycheck account', 'Income');
    await addAccount(user, 'Bills', 'Payment');
    await addAccount(user, 'Reserves', 'Distribution');
    expect(within(section()).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Paycheck accountIncome', 'BillsPayment', 'ReservesDistribution']);

    // A type is required, and a repeated name is refused.
    await user.click(within(section()).getByRole('button', { name: 'Add account' }));
    let sheet = screen.getByRole('dialog', { name: 'Add account' });
    await user.type(within(sheet).getByLabelText('Name'), 'bills');
    await user.click(within(sheet).getByRole('button', { name: 'Add account' }));
    expect(sheet).toHaveTextContent('Choose a type.');
    await user.click(within(sheet).getByRole('radio', { name: 'Payment' }));
    expect(sheet).toHaveTextContent('Pays bills, subscriptions, liabilities and everyday spending.');
    await user.click(within(sheet).getByRole('button', { name: 'Add account' }));
    expect(sheet).toHaveTextContent('You already have an account with that name.');
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));

    const id = stored().accounts!.find((a) => a.name === 'Bills')!.id;
    await user.click(within(section()).getByRole('button', { name: /^Bills/ }));
    sheet = screen.getByRole('dialog', { name: 'Rename Bills' });
    expect(sheet).toHaveTextContent('Payment account.');
    await user.clear(within(sheet).getByLabelText('Name'));
    await user.type(within(sheet).getByLabelText('Name'), 'Obligations');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(stored().accounts!.find((a) => a.id === id)).toMatchObject({ name: 'Obligations', type: 'payment' }));
    expect(stored().accounts).toHaveLength(3);
  });

  it('an item’s form offers only accounts that suit it, and assigning one changes nothing else', async () => {
    let d = plan();
    const clock = { today: TODAY, now: '2026-10-11T12:00:00.000Z' };
    d = unwrap(ops.addAccount(d, { name: 'Paycheck account', type: 'income' }, clock, 'acct-income'));
    d = unwrap(ops.addAccount(d, { name: 'Bills', type: 'payment' }, clock, 'acct-bills'));
    d = unwrap(ops.addAccount(d, { name: 'Everyday', type: 'payment' }, clock, 'acct-everyday'));
    const user = await renderAt('expenses', d);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit Rent' });
    const select = within(sheet).getByLabelText('Account (optional)');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['No account', 'Bills', 'Everyday']);
    await user.selectOptions(select, 'Bills');
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(stored().sources.find((s) => s.id === 'rent')!.accountId).toBe('acct-bills'));
    const before = d.sources.find((s) => s.id === 'rent')!;
    const after = stored().sources.find((s) => s.id === 'rent')!;
    // Same amount and schedule (an item with no history yet is saved afresh, so its schedule gets a new id).
    const schedule = (v: typeof before.versions) => v.map(({ id: _id, ...rest }) => rest);
    expect(schedule(after.versions)).toEqual(schedule(before.versions));
    expect(stored().records).toEqual(d.records);
  });

  it('with no suitable account, the form has no account choice at all', async () => {
    const user = await renderAt('income', plan());
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog', { name: 'Edit Paycheck' })).queryByLabelText('Account (optional)')).toBeNull();
  });
});

describe('signed in with Firebase', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '#/settings';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('hides accounts, since the account can’t store them yet', async () => {
    const server = new FakeServer();
    const user: AccountUser = { id: 'u1', email: 'alex@example.com' };
    const auth: AuthService = {
      currentUser: async () => user,
      onSignedOut: () => () => {},
      signInWithGoogle: async () => user,
      signOut: async () => {},
      deleteAccount: async () => {},
      adapterFor: (u) => new CloudAdapter(server, u.id, localStorage),
    };
    function WithData() {
      const account = useAccount();
      return (
        <DataModeProvider adapter={account?.adapter}>
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
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('region', { name: 'Accounts' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull();
  });
});
