import { render, screen, waitFor, within } from '@testing-library/react';
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
    await user.click(within(screen.getByRole('dialog', { name: 'Bills' })).getByRole('button', { name: 'Rename' }));
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

describe('AC2: accounts on items, deleting accounts, balances and transfers', () => {
  const clock = { today: TODAY, now: '2026-10-11T12:00:00.000Z' };
  function withAccounts(): AppData {
    let d = plan();
    d = unwrap(ops.addAccount(d, { name: 'Paycheck account', type: 'income' }, clock, 'acct-income'));
    d = unwrap(ops.addAccount(d, { name: 'Reserves', type: 'distribution' }, clock, 'acct-reserves'));
    d = unwrap(ops.addAccount(d, { name: 'Bills', type: 'payment' }, clock, 'acct-bills'));
    return unwrap(ops.assignAccount(d, 'rent', 'acct-bills', clock));
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 9, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('shows an item’s account on its row', async () => {
    await renderAt('expenses', withAccounts());
    const card = (await screen.findByRole('heading', { name: 'Rent' })).closest('li')!;
    expect(card).toHaveTextContent('Account: Bills');
  });

  it('a one-time item can be given an account when it is added', async () => {
    const user = await renderAt('expenses', withAccounts());
    await user.click(await screen.findByRole('tab', { name: 'Varied' }));
    await user.click(screen.getByRole('button', { name: 'Add spending' }));
    const sheet = screen.getByRole('dialog', { name: 'Add varied spending' });
    await user.type(within(sheet).getByLabelText('Description'), 'Car repair');
    await user.type(within(sheet).getByLabelText('Expected amount'), '700');
    expect(within(within(sheet).getByLabelText('Account (optional)')).getAllByRole('option').map((o) => o.textContent)).toEqual(['No account', 'Bills']);
    await user.selectOptions(within(sheet).getByLabelText('Account (optional)'), 'Bills');
    await user.click(within(sheet).getByRole('button', { name: 'Add spending' }));
    await waitFor(() => expect(stored().records.find((r) => r.description === 'Car repair')).toMatchObject({ kind: 'varied', accountId: 'acct-bills', scheduledAmountCents: 70000 }));
  });

  it('a one-time reserve can set money aside or use it', async () => {
    const user = await renderAt('reserves', withAccounts());
    await user.click(await screen.findByRole('button', { name: 'Add one-time' }));
    const sheet = screen.getByRole('dialog', { name: 'Add one-time reserve' });
    await user.click(within(sheet).getByRole('radio', { name: 'Use reserves' }));
    await user.type(within(sheet).getByLabelText('Description'), 'Toward the repair');
    await user.type(within(sheet).getByLabelText('Expected amount'), '300');
    await user.click(within(sheet).getByRole('button', { name: 'Add release' }));
    await waitFor(() => expect(stored().records.find((r) => r.description === 'Toward the repair')).toMatchObject({ kind: 'reserve', release: true }));
    expect(await screen.findByText('+$300.00')).toBeInTheDocument();
  });

  it('deleting an account with items asks first, keeps the items, and clears their account', async () => {
    const user = await renderAt('settings', withAccounts());
    await user.click(await screen.findByRole('button', { name: /^Bills/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Bills' })).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete Bills?' });
    expect(confirm).toHaveTextContent('1 item is assigned to it. It stays in your plan with no account.');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(stored().accounts!.map((a) => a.id)).toEqual(['acct-income', 'acct-reserves']));
    const rent = stored().sources.find((s) => s.id === 'rent')!;
    expect('accountId' in rent).toBe(false);
    const schedule = (v: typeof rent.versions) => v.map(({ id: _id, ...x }) => x);
    expect(schedule(rent.versions)).toEqual(schedule(withAccounts().sources.find((s) => s.id === 'rent')!.versions));
  });

  it('an opening balance shows the account’s balance; moving money changes two balances and no cash flow', async () => {
    const before = withAccounts();
    const user = await renderAt('settings', before);
    await user.click(await screen.findByRole('button', { name: /^Paycheck account/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Paycheck account' })).getByRole('button', { name: 'Add balance' }));
    let sheet = screen.getByRole('dialog', { name: 'Paycheck account balance' });
    await user.type(within(sheet).getByLabelText('Balance'), '900');
    // At the end of yesterday, so today's transfer comes after it.
    await user.clear(within(sheet).getByLabelText('On'));
    await user.type(within(sheet).getByLabelText('On'), '2026-10-10');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(within(screen.getByRole('dialog', { name: 'Paycheck account' })).getByRole('definition')).toHaveTextContent('$900.00');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Move money' }));
    sheet = screen.getByRole('dialog', { name: 'Move money' });
    await user.selectOptions(within(sheet).getByLabelText('From'), 'Paycheck account');
    await user.selectOptions(within(sheet).getByLabelText('To'), 'Reserves');
    await user.type(within(sheet).getByLabelText('Amount'), '250');
    await user.click(within(sheet).getByRole('button', { name: 'Record transfer' }));
    await waitFor(() => expect(stored().transfers).toHaveLength(1));
    expect(stored().transfers![0]).toMatchObject({ fromAccountId: 'acct-income', toAccountId: 'acct-reserves', amountCents: 25000, date: TODAY, status: 'recorded' });
    expect(within(screen.getByRole('region', { name: 'Accounts' })).getByRole('button', { name: /^Paycheck account/ })).toHaveTextContent('$650.00');
    // Same sources and records: a transfer is never income or spending.
    expect(stored().sources.map((s) => s.versions)).toEqual(before.sources.map((s) => s.versions));
    expect(stored().records).toEqual(before.records);

    // The same account can't be on both sides.
    await user.click(screen.getByRole('button', { name: 'Move money' }));
    sheet = screen.getByRole('dialog', { name: 'Move money' });
    await user.selectOptions(within(sheet).getByLabelText('To'), 'Paycheck account');
    await user.type(within(sheet).getByLabelText('Amount'), '5');
    await user.click(within(sheet).getByRole('button', { name: 'Record transfer' }));
    expect(sheet).toHaveTextContent('Choose two different accounts.');
  });

  it('an account with a transfer can’t be deleted until the transfer is gone', async () => {
    const d = unwrap(ops.addTransfer(withAccounts(), { fromAccountId: 'acct-income', toAccountId: 'acct-bills', amountCents: 10000, date: TODAY }, 'recorded', clock, 't'));
    const user = await renderAt('settings', d);
    await user.click(await screen.findByRole('button', { name: /^Bills/ }));
    const sheet = screen.getByRole('dialog', { name: 'Bills' });
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(sheet).toHaveTextContent('To delete this account, delete or change its transfers first.');
    await user.click(within(sheet).getByRole('button', { name: /Paycheck account → Bills/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Transfer' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(stored().transfers).toBeUndefined());
    expect(within(screen.getByRole('dialog', { name: 'Bills' })).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('a planned transfer whose date has passed waits on the dashboard until it is recorded', async () => {
    let d = unwrap(ops.addTransfer(withAccounts(), { fromAccountId: 'acct-income', toAccountId: 'acct-reserves', amountCents: 10000, date: '2026-10-09' }, 'expected', clock, 'late'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'acct-income', toAccountId: 'acct-bills', amountCents: 120000, date: '2026-10-15' }, 'expected', clock, 'soon'));
    const user = await renderAt('dashboard', d);
    await user.click(await screen.findByRole('button', { name: '1 transfer to record' }));
    let sheet = screen.getByRole('dialog', { name: 'Transfers' });
    expect(within(sheet).getByRole('region', { name: 'Not recorded yet' })).toHaveTextContent('Paycheck account → ReservesOct 9, 2026 · Not recorded$100.00');
    expect(within(sheet).getByRole('region', { name: 'Later this week' })).toHaveTextContent('Paycheck account → BillsOct 15, 2026 · Planned$1,200.00');
    expect(stored().transfers!.find((t) => t.id === 'late')!.status).toBe('expected');
    await user.click(within(sheet).getByRole('button', { name: /Paycheck account → Reserves/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Planned transfer' })).getByRole('button', { name: 'Record as moved' }));
    await waitFor(() => expect(stored().transfers!.find((t) => t.id === 'late')).toMatchObject({ status: 'recorded', date: '2026-10-09', amountCents: 10000 }));
    sheet = screen.getByRole('dialog', { name: 'Transfers' });
    expect(within(sheet).queryByRole('region', { name: 'Not recorded yet' })).toBeNull();
  });
});

describe('regressions', () => {
  const clock = { today: TODAY, now: '2026-10-11T12:00:00.000Z' };
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 9, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('moving money between two income accounts starts with two different accounts', async () => {
    let d = plan();
    d = unwrap(ops.addAccount(d, { name: 'Main pay', type: 'income' }, clock, 'a'));
    d = unwrap(ops.addAccount(d, { name: 'Side pay', type: 'income' }, clock, 'b'));
    const user = await renderAt('settings', d);
    await user.click(await screen.findByRole('button', { name: 'Move money' }));
    const sheet = screen.getByRole('dialog', { name: 'Move money' });
    expect([(within(sheet).getByLabelText('From') as HTMLSelectElement).value, (within(sheet).getByLabelText('To') as HTMLSelectElement).value]).toEqual(['a', 'b']);
    await user.type(within(sheet).getByLabelText('Amount'), '50');
    await user.click(within(sheet).getByRole('button', { name: 'Record transfer' }));
    await waitFor(() => expect(stored().transfers![0]).toMatchObject({ fromAccountId: 'a', toAccountId: 'b', amountCents: 5000 }));
  });

  it('the Supabase development build, which can’t store releases yet, doesn’t offer “Use reserves”', async () => {
    const slot: AccountSlot = { Card: () => null, Line: () => null, Guard: () => null, dataNote: '' };
    await new LocalStorageAdapter().save(plan(), 0);
    window.location.hash = '#/reserves';
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AccountSlotContext.Provider value={slot}>
        <DataModeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </DataModeProvider>
      </AccountSlotContext.Provider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Add one-time' }));
    const sheet = screen.getByRole('dialog', { name: 'Add one-time reserve' });
    expect(within(sheet).queryByRole('radio', { name: 'Use reserves' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Add one-time reserve' })).toBeInTheDocument();
  });

  it('a release shows as money coming back on its item sheet', async () => {
    const d = unwrap(ops.addOneTime(plan(), { kind: 'reserve', description: 'Toward the repair', amountCents: 30000, date: '2026-10-20', release: true }, clock, 'use'));
    const user = await renderAt('reserves', d);
    await user.click(await screen.findByRole('button', { name: /Toward the repair/ }));
    expect(within(screen.getByRole('dialog')).getAllByText('+$300.00').length).toBeGreaterThan(0);
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
