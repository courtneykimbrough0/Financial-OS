import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
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

// E3: freelance jobs in the interface. Tuesday Oct 13, 2026.
const SETUP = '2026-10-01';
const clock = { today: '2026-10-13', now: '2026-10-13T12:00:00.000Z' };

/** Paycheck $1,000 on the 30th; rent $800 on the 25th. */
function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1000, '2026-10-30', { type: 'monthly' }, 'pay');
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
const jobs = () => screen.getByRole('region', { name: 'Freelance jobs' });

describe('E3 freelance jobs on device storage', () => {
  it('a done job with an expected date is added with a new client; a pending one counts nowhere; paying it records it once', async () => {
    const user = await openApp('#/plan/income', plan());
    await user.click(await screen.findByRole('button', { name: 'Add job' }));
    let sheet = screen.getByRole('dialog', { name: 'Add a job' });
    await user.type(within(sheet).getByLabelText("What's the job?"), 'Logo design');
    await user.selectOptions(within(sheet).getByLabelText('Client (optional)'), 'New client…');
    await user.type(within(sheet).getByLabelText('Client name'), 'Acme');
    await user.type(within(sheet).getByLabelText('Amount'), '800');
    expect(within(within(sheet).getByRole('group', { name: 'The work' })).getByRole('radio', { name: 'Done' })).toBeChecked();
    expect(within(sheet).getByText("Without a date it's pending and isn't counted.")).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('Expected payment date (optional)'), '2026-10-28');
    expect(within(within(sheet).getByRole('group', { name: 'How sure is this income?' })).getByRole('radio', { name: 'Expected' })).toBeChecked();
    await user.click(within(sheet).getByRole('button', { name: 'Add job' }));
    expect(await screen.findByText('Added Logo design.')).toBeInTheDocument();

    const logo = within(jobs()).getByRole('button', { name: /^Logo design/ });
    expect(logo).toHaveTextContent('Acme · Done');
    expect(logo).toHaveTextContent('Payment expected Oct 28');
    expect(logo).toHaveTextContent('+$800.00');
    expect(within(jobs()).getByText('Done, not paid yet', { selector: 'dt' }).nextElementSibling).toHaveTextContent('$800.00');
    // Its payment record is the money, labeled with the client, and it isn't repeated in the one-time list.
    expect(stored().records).toEqual([expect.objectContaining({ description: 'Logo design · Acme', scheduledDate: '2026-10-28', scheduledAmountCents: usd(800), status: 'scheduled' })]);
    expect(screen.queryByRole('region', { name: 'One-time income' })).toBeNull();

    // A pending job (no date): listed, not counted.
    await user.click(within(jobs()).getByRole('button', { name: 'Add job' }));
    sheet = screen.getByRole('dialog', { name: 'Add a job' });
    await user.type(within(sheet).getByLabelText("What's the job?"), 'Brochure');
    await user.selectOptions(within(sheet).getByLabelText('Client (optional)'), 'Acme');
    await user.type(within(sheet).getByLabelText('Amount'), '300');
    await user.click(within(sheet).getByRole('button', { name: 'Add job' }));
    const brochure = within(jobs()).getByRole('button', { name: /^Brochure/ });
    expect(brochure).toHaveTextContent('No payment date · not counted');
    expect(stored().records).toHaveLength(1);
    expect(within(jobs()).getByText('Done, not paid yet', { selector: 'dt' }).nextElementSibling).toHaveTextContent('$1,100.00');

    // Paying the logo job early: recorded once, the job moves to Paid.
    await user.click(within(jobs()).getByRole('button', { name: /^Logo design/ }));
    sheet = screen.getByRole('dialog', { name: 'Logo design' });
    expect(sheet).toHaveTextContent('Done · Payment expected Oct 28');
    await user.click(within(sheet).getByRole('button', { name: 'Record payment' }));
    const pay = screen.getByRole('dialog', { name: 'Record payment for Logo design' });
    await user.clear(within(pay).getByLabelText('Amount received'));
    await user.type(within(pay).getByLabelText('Amount received'), '780');
    await user.click(within(pay).getByRole('button', { name: 'Save as received' }));
    expect(await screen.findByText('Recorded $780.00 received for Logo design.')).toBeInTheDocument();
    expect(stored().records).toEqual([expect.objectContaining({ status: 'completed', actualAmountCents: usd(780), actualDate: '2026-10-13', expectedAmountCents: usd(800), expectedDate: '2026-10-28' })]);
    expect(within(jobs()).getByRole('heading', { name: 'Paid' })).toBeInTheDocument();
    expect(within(jobs()).getByRole('button', { name: /^Logo design/ })).toHaveTextContent('Paid Oct 13');
    expect(within(jobs()).getByText('Done, not paid yet', { selector: 'dt' }).nextElementSibling).toHaveTextContent('$300.00');

    // On Home, the payment is received once, and its sheet points to the job.
    await user.click(screen.getAllByRole('link', { name: 'Home' })[0]!);
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    const received = within(screen.getByRole('region', { name: 'Happened this week' })).getByRole('button', { name: /^Logo design · Acme/ });
    expect(received).toHaveTextContent('+$780.00');
    await user.click(received);
    const record = screen.getByRole('dialog', { name: 'Logo design · Acme' });
    expect(within(record).getByText(/The payment for your Logo design job\./)).toBeInTheDocument();
    expect(within(record).queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('a possible payment says so and is not counted; several clients can be filtered; renaming a client relabels its payments', async () => {
    let d = unwrap(ops.addClient(plan(), 'Acme', clock, 'acme'));
    d = unwrap(ops.addClient(d, 'Birch', clock, 'birch'));
    d = unwrap(ops.addJob(d, { description: 'Website copy', clientId: 'birch', amountCents: usd(1200), status: 'planned', expectedDate: '2026-11-15', certainty: 'possible' }, clock, 'copy'));
    d = unwrap(ops.addJob(d, { description: 'Logo design', clientId: 'acme', amountCents: usd(800), status: 'done', expectedDate: '2026-10-28' }, clock, 'logo'));
    const user = await openApp('#/plan/income', d);
    const copy = within(await screen.findByRole('region', { name: 'Freelance jobs' })).getByRole('button', { name: /^Website copy/ });
    expect(copy).toHaveTextContent('Birch · Planned');
    expect(copy).toHaveTextContent('Payment possible Nov 15 · not counted');
    expect(within(copy).getByText('Possible')).toHaveClass('badge-possible');

    const filter = within(jobs()).getByRole('group', { name: 'Show jobs for' });
    await user.click(within(filter).getByRole('button', { name: 'Birch' }));
    expect(within(jobs()).queryByRole('button', { name: /^Logo design/ })).toBeNull();
    expect(within(jobs()).getByRole('button', { name: /^Website copy/ })).toBeInTheDocument();
    await user.click(within(filter).getByRole('button', { name: 'All clients' }));
    expect(within(jobs()).getByRole('button', { name: /^Logo design/ })).toBeInTheDocument();

    await user.click(within(jobs()).getByRole('button', { name: 'Clients' }));
    const clients = screen.getByRole('dialog', { name: 'Clients' });
    await user.clear(within(clients).getByLabelText('Name for Birch'));
    await user.type(within(clients).getByLabelText('Name for Birch'), 'Birch & Co');
    await user.click(within(clients).getAllByRole('button', { name: 'Rename' })[1]!);
    expect(stored().records.find((r) => r.id === stored().jobs!.find((j) => j.id === 'copy')!.paymentRecordId)!.description).toBe('Website copy · Birch & Co');
  });

  it('an unpaid job is deleted with its expected payment, after confirming', async () => {
    const d = unwrap(ops.addJob(plan(), { description: 'Poster', amountCents: usd(150), status: 'done', expectedDate: '2026-10-20' }, clock, 'poster'));
    const user = await openApp('#/plan/income', d);
    await user.click(within(await screen.findByRole('region', { name: 'Freelance jobs' })).getByRole('button', { name: /^Poster/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Poster' })).getByRole('button', { name: 'Delete job' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete Poster?' });
    expect(confirm).toHaveTextContent('Its expected payment comes off your forecast too.');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(stored().jobs).toBeUndefined();
    expect(stored().records).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Freelance jobs' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add job' })).toBeInTheDocument();
  });
});

describe('E3 signed in with Firebase (decision D8)', () => {
  it('jobs are not offered', async () => {
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
    await screen.findByRole('region', { name: 'Recurring income' });
    expect(screen.queryByRole('button', { name: 'Add job' })).toBeNull();
  });
});
