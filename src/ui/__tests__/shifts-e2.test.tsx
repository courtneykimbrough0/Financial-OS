import { render, screen, within } from '@testing-library/react';
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
import { parseHours } from '../components/shifts';
import { SignIn } from '../screens/SignIn';

// E2: hourly and tipped income in the interface. Tuesday Oct 13, 2026; the week is Sun Oct 11 – Sat Oct 17.
const SETUP = '2026-10-01';

/** "Server" paid $600 every 2 weeks from Oct 16 (a fixed income for now); rent $800 on the 25th. */
function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Server', 600, '2026-10-16', { type: 'biweekly' }, 'job');
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

describe('E2 hourly and tipped income on device storage', () => {
  it('an income becomes tipped with a usual wage, then a shift with tips is logged: only the cash tips count, on the shift date', async () => {
    const user = await openApp('#/plan/income', plan());
    await user.click(await screen.findByRole('button', { name: /^Server/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Server' })).getByRole('button', { name: 'Edit' }));
    let form = screen.getByRole('dialog');
    const pay = within(form).getByRole('group', { name: 'How is it paid?' });
    expect(within(pay).getByRole('radio', { name: 'Fixed amount' })).toBeChecked();
    await user.click(within(pay).getByRole('radio', { name: 'Tipped' }));
    await user.type(within(form).getByLabelText('Usual hourly wage (optional)'), '15.25');
    await user.click(within(form).getByRole('button', { name: /^Save/ }));
    expect(stored().sources.find((s) => s.id === 'job')).toMatchObject({ incomeType: 'tipped', hourlyWageCents: 1525 });
    // The expected paycheck is unchanged.
    expect(stored().sources.find((s) => s.id === 'job')!.versions).toHaveLength(1);
    const row = within(screen.getByRole('region', { name: 'Recurring income' })).getByRole('button', { name: /^Server/ });
    expect(row).toHaveTextContent('Tipped · Every 2 weeks');

    await user.click(row);
    let sheet = screen.getByRole('dialog', { name: 'Server' });
    const shifts = within(sheet).getByRole('region', { name: 'Shifts' });
    expect(shifts).toHaveTextContent('Optional. Log hours and tips to see what you earn.');
    await user.click(within(shifts).getByRole('button', { name: 'Log a shift' }));
    form = screen.getByRole('dialog', { name: 'Log a shift' });
    expect(within(form).getByLabelText('Hourly wage (optional)')).toHaveValue('15.25');
    expect(within(form).getByLabelText('Date')).toHaveValue('2026-10-13');
    await user.type(within(form).getByLabelText('Hours (optional)'), '6.5');
    await user.type(within(form).getByLabelText('Cash tips (optional)'), '40');
    await user.type(within(form).getByLabelText('Card tips (optional)'), '55');
    await user.click(within(form).getByRole('button', { name: 'Log shift' }));
    expect(await screen.findByText('Shift logged. $40.00 cash tips added to today.')).toBeInTheDocument();

    // Back on the income's sheet: the shift, its earnings ($99.13 wages + $40 + $55) and what isn't paid yet.
    sheet = screen.getByRole('dialog', { name: 'Server' });
    const listed = within(within(sheet).getByRole('region', { name: 'Shifts' })).getByRole('button', { name: /^Oct 13, 2026/ });
    expect(listed).toHaveTextContent('6.5 h · $40.00 cash · $55.00 card');
    expect(listed).toHaveTextContent('Not paid yet');
    expect(listed).toHaveTextContent('$194.13');
    expect(within(sheet).getByText('Earned, not paid yet', { selector: 'dt' }).nextElementSibling).toHaveTextContent('$154.13');
    const saved = stored();
    expect(saved.workEntries).toEqual([expect.objectContaining({ sourceId: 'job', date: '2026-10-13', minutes: 390, wageCents: 1525, cashTipsCents: 4000, cardTipsCents: 5500 })]);
    expect(saved.records.filter((r) => r.sourceId === null)).toEqual([expect.objectContaining({ kind: 'income', status: 'completed', actualAmountCents: 4000, actualDate: '2026-10-13' })]);

    // Home: October projected is $600 × 2 − $800 = $400, plus the $40 cash tips; wages and card tips aren't in it.
    await user.keyboard('{Escape}');
    await user.click(screen.getAllByRole('link', { name: 'Home' })[0]!);
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    const happened = screen.getByRole('region', { name: 'Happened this week' });
    const tips = within(happened).getByRole('button', { name: /^Cash tips · Server/ });
    expect(tips).toHaveTextContent('+$40.00');
    // The cash tips are the only thing recorded, so they lead; the projected month is $440.
    expect(projected()).toBe('+$40.00');
    expect(document.querySelector('.progress-card')).toHaveTextContent('+$440.00');

    // The tips record points to its shift and changes only through it.
    await user.click(tips);
    const record = screen.getByRole('dialog', { name: 'Cash tips · Server' });
    expect(within(record).getByText(/Cash tips from your Oct 13, 2026 shift for Server\./)).toBeInTheDocument();
    expect(within(record).queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(within(record).queryByRole('button', { name: /Undo received/ })).toBeNull();
  });

  it('a shift is corrected or deleted from its sheet, and its cash tips follow', async () => {
    let d = unwrap(ops.setIncomeDetails(plan(), 'job', { incomeType: 'tipped', hourlyWageCents: 1525 }, { today: '2026-10-13', now: '2026-10-13T12:00:00Z' }));
    d = unwrap(ops.logShift(d, { sourceId: 'job', date: '2026-10-12', minutes: 300, wageCents: 1525, cashTipsCents: 3000 }, { today: '2026-10-13', now: '2026-10-13T12:00:00Z' }, 's1'));
    const user = await openApp('#/plan/income', d);
    await user.click(await screen.findByRole('button', { name: /^Server/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Server' })).getByRole('button', { name: /^Oct 12, 2026/ }));
    let form = screen.getByRole('dialog', { name: 'Shift on Oct 12, 2026' });
    expect(within(form).getByLabelText('Hours (optional)')).toHaveValue('5');
    expect(within(form).getByText('Wages and card tips not paid yet.')).toBeInTheDocument();
    await user.clear(within(form).getByLabelText('Cash tips (optional)'));
    await user.type(within(form).getByLabelText('Cash tips (optional)'), '35');
    await user.click(within(form).getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Shift saved. $35.00 cash tips added to Oct 12.')).toBeInTheDocument();
    const tipsRecords = stored().records.filter((r) => r.sourceId === null);
    expect(tipsRecords.map((r) => r.actualAmountCents)).toEqual([3500]);

    await user.click(within(screen.getByRole('dialog', { name: 'Server' })).getByRole('button', { name: /^Oct 12, 2026/ }));
    form = screen.getByRole('dialog', { name: 'Shift on Oct 12, 2026' });
    await user.click(within(form).getByRole('button', { name: 'Delete shift' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this shift?' });
    expect(confirm).toHaveTextContent('Its cash tips come off your cash flow too.');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(stored().workEntries).toBeUndefined();
    expect(stored().records).toEqual([]);
  });

  it('hours are read as decimals or hours and minutes', () => {
    expect([parseHours('6.5'), parseHours('6,25'), parseHours('6:30'), parseHours(''), parseHours(' 8 ')]).toEqual([390, 375, 390, null, 480]);
    expect([parseHours('six'), parseHours('6:75'), parseHours('-2')].every(Number.isNaN)).toBe(true);
  });

  it('only income has the choice', async () => {
    const user = await openApp('#/plan/expenses', plan());
    await user.click(await screen.findByRole('button', { name: /^Rent/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Rent' })).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'How is it paid?' })).toBeNull();
  });
});

describe('E2 signed in with Firebase (decision D8)', () => {
  it('the pay choice and shift tools are hidden', async () => {
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
    await user.click(await screen.findByRole('button', { name: /^Server/ }));
    expect(within(screen.getByRole('dialog', { name: 'Server' })).queryByRole('region', { name: 'Shifts' })).toBeNull();
    await user.click(within(screen.getByRole('dialog', { name: 'Server' })).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'How is it paid?' })).toBeNull();
  });
});
