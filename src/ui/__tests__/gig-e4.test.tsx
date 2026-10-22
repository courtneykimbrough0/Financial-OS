import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

// E4: gig income and sessions in the interface. Tuesday Oct 13, 2026.
const SETUP = '2026-10-01';
const clock = { today: '2026-10-13', now: '2026-10-13T12:00:00.000Z' };

/** "Delivery" paid about $300 every Monday from Oct 5 (a fixed income for now); rent $800 on the 25th. */
function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Delivery', 300, '2026-10-05', { type: 'weekly' }, 'gig');
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

describe('E4 gig income on device storage', () => {
  it('an income becomes gig payouts, then sessions are logged: cash counts on the day, earnings wait for the payout', async () => {
    const user = await openApp('#/plan/income', unwrap(ops.recordActual(plan(), 'gig@2026-10-05', { amountCents: usd(300), date: '2026-10-05' }, clock)));
    await user.click(await screen.findByRole('button', { name: /^Delivery/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delivery' })).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('dialog');
    await user.click(within(within(form).getByRole('group', { name: 'How is it paid?' })).getByRole('radio', { name: 'Gig payouts' }));
    expect(within(form).queryByLabelText('Usual hourly wage (optional)')).toBeNull();
    await user.click(within(form).getByRole('button', { name: /^Save/ }));
    expect(stored().sources.find((s) => s.id === 'gig')).toMatchObject({ incomeType: 'gig' });
    expect(within(screen.getByRole('region', { name: 'Recurring income' })).getByRole('button', { name: /^Delivery/ })).toHaveTextContent('Gig · Every week');

    await user.click(within(screen.getByRole('region', { name: 'Recurring income' })).getByRole('button', { name: /^Delivery/ }));
    let sheet = screen.getByRole('dialog', { name: 'Delivery' });
    const sessions = within(sheet).getByRole('region', { name: 'Sessions' });
    expect(sessions).toHaveTextContent("Optional. Log sessions to see what you earn and what's waiting for payout.");
    await user.click(within(sessions).getByRole('button', { name: 'Log a session' }));
    let log = screen.getByRole('dialog', { name: 'Log a session' });
    expect(within(log).queryByLabelText('Hourly wage (optional)')).toBeNull();
    expect(within(log).queryByLabelText('Card tips (optional)')).toBeNull();
    await user.type(within(log).getByLabelText('Platform (optional)'), 'DoorDash');
    await user.type(within(log).getByLabelText('Hours (optional)'), '3');
    await user.type(within(log).getByLabelText('Earnings on the platform (optional)'), '90');
    await user.type(within(log).getByLabelText('Cash received (optional)'), '15');
    await user.click(within(log).getByRole('button', { name: 'Log session' }));
    expect(await screen.findByText('Session logged. $15.00 cash added to today.')).toBeInTheDocument();

    sheet = screen.getByRole('dialog', { name: 'Delivery' });
    const row = within(within(sheet).getByRole('region', { name: 'Sessions' })).getByRole('button', { name: /^Oct 13, 2026/ });
    expect(row).toHaveTextContent('3 h · DoorDash · $90.00 earnings · $15.00 cash');
    expect(row).toHaveTextContent('Waiting for payout');
    expect(row).toHaveTextContent('$105.00');
    expect(within(sheet).getByText('Waiting for payout', { selector: 'dt' }).nextElementSibling).toHaveTextContent('$90.00');
    expect(stored().workEntries).toEqual([expect.objectContaining({ kind: 'session', minutes: 180, earningsCents: usd(90), cashTipsCents: usd(15), platform: 'DoorDash' })]);
    expect(stored().records.filter((r) => r.sourceId === null)).toEqual([expect.objectContaining({ description: 'Cash · DoorDash', status: 'completed', actualAmountCents: usd(15) })]);

    // A second platform: waiting for payout is split by platform.
    await user.click(within(within(sheet).getByRole('region', { name: 'Sessions' })).getByRole('button', { name: 'Log a session' }));
    log = screen.getByRole('dialog', { name: 'Log a session' });
    await user.type(within(log).getByLabelText('Platform (optional)'), 'Uber');
    await user.type(within(log).getByLabelText('Earnings on the platform (optional)'), '60');
    await user.click(within(log).getByRole('button', { name: 'Log session' }));
    sheet = await screen.findByRole('dialog', { name: 'Delivery' });
    const facts = sheet.querySelector('.details')!;
    expect(facts).toHaveTextContent('Waiting for payout$150.00DoorDash$90.00Uber$60.00');

    // Home: the cash is received once, and its sheet points to the session.
    await user.keyboard('{Escape}');
    await user.click(screen.getAllByRole('link', { name: 'Home' })[0]!);
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    const cash = within(screen.getByRole('region', { name: 'Happened this week' })).getByRole('button', { name: /^Cash · DoorDash/ });
    expect(cash).toHaveTextContent('+$15.00');
    await user.click(cash);
    expect(within(screen.getByRole('dialog', { name: 'Cash · DoorDash' })).getByText(/Cash from your Oct 13, 2026 session for Delivery\./)).toBeInTheDocument();
  });

  it('a session paid by a recorded payout says which one, and can be marked waiting again', async () => {
    let d = unwrap(ops.setIncomeDetails(plan(), 'gig', { incomeType: 'gig', hourlyWageCents: null }, clock));
    d = unwrap(ops.logSession(d, { sourceId: 'gig', date: '2026-10-08', earningsCents: usd(95), platform: 'DoorDash' }, clock, 's1'));
    d = unwrap(ops.recordActual(d, 'gig@2026-10-12', { amountCents: usd(280), date: '2026-10-12' }, clock));
    const user = await openApp('#/plan/income', d);
    await user.click(await screen.findByRole('button', { name: /^Delivery/ }));
    const row = within(screen.getByRole('dialog', { name: 'Delivery' })).getByRole('button', { name: /^Oct 8, 2026/ });
    expect(row).toHaveTextContent('Paid in the Oct 12 payout');
    await user.click(row);
    const edit = screen.getByRole('dialog', { name: 'Session on Oct 8, 2026' });
    expect(within(edit).getByText('Earnings paid out in the Oct 12 payout.')).toBeInTheDocument();
    await user.click(within(edit).getByRole('button', { name: 'Mark not paid yet' }));
    expect(stored().workEntries![0]).not.toHaveProperty('paidByOccurrenceId');
    expect(within(screen.getByRole('dialog', { name: 'Delivery' })).getByText('Waiting for payout', { selector: 'dt' }).nextElementSibling).toHaveTextContent('$95.00');
  });
});
