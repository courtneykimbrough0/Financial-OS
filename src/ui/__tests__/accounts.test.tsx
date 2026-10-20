import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addOneTime, addSource, completeOnboarding, emptyData } from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { AccountGate, useAccount, type AccountUser, type AuthService } from '../../state/account';
import { CloudAdapter, hasPendingDeviceChanges } from '../../state/cloud';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { StoreProvider, useStore } from '../../state/store';
import { FakeServer } from '../../state/__tests__/fake-server';
import { App } from '../App';
import { SaveStatusBar } from '../components/backup';
import { ToastProvider } from '../components/common';
import { SignIn } from '../screens/SignIn';

const clock = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };
const USER: AccountUser = { id: 'u1', email: 'alex@example.com' };

class FakeAuth implements AuthService {
  user: AccountUser | null = null;
  deleted = false;
  constructor(readonly server: FakeServer) {}
  async currentUser() {
    return this.user;
  }
  onSignedOut() {
    return () => {};
  }
  /** Set to make the next sign-in fail: 'cancelled' (window closed) or an error message. */
  nextSignIn: 'cancelled' | string | null = null;
  async signInWithGoogle() {
    const outcome = this.nextSignIn;
    this.nextSignIn = null;
    if (outcome === 'cancelled') throw Object.assign(new Error('cancelled'), { cancelled: true });
    if (outcome) throw new Error(outcome);
    this.user = USER;
    return this.user;
  }
  async signOut() {
    this.user = null;
  }
  async deleteAccount() {
    this.deleted = true;
    this.server.row = null;
    this.user = null;
  }
  adapterFor(user: AccountUser) {
    return new CloudAdapter(this.server, user.id, localStorage);
  }
}

function AppWithData() {
  const account = useAccount();
  return (
    <DataModeProvider adapter={account?.adapter}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>
  );
}

function renderApp(auth: FakeAuth) {
  return render(
    <AccountGate auth={auth} signIn={(done) => <SignIn auth={auth} onSignedIn={done} />}>
      <AppWithData />
    </AccountGate>,
  );
}

function forecast(): AppData {
  let r = addSource(emptyData(), { kind: 'income', description: 'Paycheck', amountCents: 180000, startDate: '2026-10-15', rule: { type: 'biweekly' } }, clock, 'pay');
  if (!r.ok) throw new Error(r.error);
  r = completeOnboarding(r.data);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe('accounts', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  it('signs in with Google and saves setup to the account', async () => {
    const user = userEvent.setup();
    const server = new FakeServer();
    const auth = new FakeAuth(server);
    renderApp(auth);

    // Closing the Google window quietly returns to the button.
    auth.nextSignIn = 'cancelled';
    await user.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    auth.nextSignIn = 'Your browser blocked the Google sign-in window. Allow pop-ups for Financial OS, then try again.';
    await user.click(screen.getByRole('button', { name: /Continue with Google/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('blocked the Google sign-in window');
    await user.click(screen.getByRole('button', { name: /Continue with Google/ }));

    expect(await screen.findByText(/Your data stays in your account/)).toBeInTheDocument();
    expect(screen.getByText(/Signed in as alex@example.com/)).toBeInTheDocument();
    // Getting started makes no data change yet; skipping ahead to finish saves to the account.
    await user.click(screen.getByRole('button', { name: 'Get started' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue without income' }));
    // Bills, subscriptions, liabilities, and reserves each have their own step.
    for (const step of ['What bills do you pay?', 'What subscriptions renew?', 'Do you make loan or card payments?', 'What do you save?']) {
      expect(screen.getByRole('heading', { name: step })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Continue' }));
    }
    await user.click(screen.getByRole('button', { name: 'See my forecast' }));
    await waitFor(() => expect(server.row?.data.onboardingComplete).toBe(true));
    expect(server.row?.revision).toBe(1);
    // Account details live on the Settings page.
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByText(/saved to your Financial OS account/)).toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toHaveTextContent('alex@example.com');
  });

  it('offers to move a forecast saved on this device into a new, empty account', async () => {
    const user = userEvent.setup();
    await new LocalStorageAdapter(localStorage).save(forecast(), 0);
    const server = new FakeServer();
    const auth = new FakeAuth(server);
    auth.user = USER;
    renderApp(auth);

    const dialog = await screen.findByRole('dialog', { name: "Move this device's forecast to your account?" });
    expect(dialog).toHaveTextContent('with 1 item');
    await user.click(within(dialog).getByRole('button', { name: 'Move to my account' }));
    await waitFor(() => expect(server.row?.revision).toBe(1));
    expect(server.row!.data.sources.map((s) => s.description)).toEqual(['Paycheck']);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEY}:moved-to-account`)).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("\"Start fresh\" leaves the device forecast alone and doesn't ask again", async () => {
    const user = userEvent.setup();
    await new LocalStorageAdapter(localStorage).save(forecast(), 0);
    const auth = new FakeAuth(new FakeServer());
    auth.user = USER;
    const { unmount } = renderApp(auth);
    await user.click(await screen.findByRole('button', { name: 'Start fresh' }));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    unmount();
    renderApp(auth);
    await screen.findByRole('heading', { name: 'See your cash flow ahead of time' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps working offline and saves when the connection returns', async () => {
    const server = new FakeServer();
    server.row = { data: forecast(), revision: 1 };
    let store!: ReturnType<typeof useStore>;
    function Probe() {
      store = useStore();
      return <p>items:{store.data.records.length}</p>;
    }
    render(
      <StoreProvider adapter={new CloudAdapter(server, USER.id, localStorage)} today="2026-10-11">
        <SaveStatusBar />
        <Probe />
      </StoreProvider>,
    );
    await screen.findByText('items:0');

    server.offline = true;
    act(() => {
      store.run((d, c) => addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: 5000, date: '2026-10-20' }, c, 'rep'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('kept on this device');
    expect(screen.getByText('items:1')).toBeInTheDocument();
    expect(hasPendingDeviceChanges(USER.id, localStorage)).toBe(true);

    server.offline = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(server.row?.revision).toBe(2));
    expect(server.row!.data.records.map((r) => r.description)).toEqual(['Repair']);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(hasPendingDeviceChanges(USER.id, localStorage)).toBe(false);
  });

  it('offers changes set aside after a conflict as a download', async () => {
    const user = userEvent.setup();
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, USER.id, localStorage);
    await adapter.load();
    server.offline = true;
    const mine = addOneTime(forecast(), { kind: 'varied', description: 'Mine', amountCents: 100, date: '2026-10-20' }, clock, 'm');
    if (!mine.ok) throw new Error(mine.error);
    await adapter.save(mine.data, 0);
    server.offline = false;
    server.saveElsewhere(forecast());

    const auth = new FakeAuth(server);
    auth.user = USER;
    window.location.hash = '#/forecast';
    const created: string[] = [];
    URL.createObjectURL = () => {
      created.push('blob');
      return 'blob:x';
    };
    URL.revokeObjectURL = () => {};
    renderApp(auth);
    const dialog = await screen.findByRole('dialog', { name: 'Changes from this device' });
    await user.click(within(dialog).getByRole('button', { name: /Download them/ }));
    expect(created).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(new CloudAdapter(server, USER.id, localStorage).recoveredCopy()).toBeNull();
  });

  it('deletes the account after confirming', async () => {
    const user = userEvent.setup();
    const server = new FakeServer();
    server.row = { data: forecast(), revision: 1 };
    const auth = new FakeAuth(server);
    auth.user = USER;
    window.location.hash = '#/settings';
    renderApp(auth);
    await user.click(await screen.findByRole('button', { name: /Delete account/ }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to Financial OS' })).toBeInTheDocument();
    expect(auth.deleted).toBe(true);
    expect(localStorage.getItem('financial-os:account:u1')).toBeNull();
  });
});
