import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { earningsPlan } from '../../domain/__tests__/earnings-fixture';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

// E5: earnings in Activity. Monday Oct 19, 2026.
const clock = { today: '2026-10-19', now: '2026-10-19T12:00:00.000Z' };

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
  vi.setSystemTime(new Date(2026, 9, 19, 9, 0));
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

const earningsCard = () => screen.getByRole('heading', { name: 'Earnings' }).closest('section')!;
const row = (scope: HTMLElement, label: string) => within(scope).getByText(label, { selector: 'dt' }).nextElementSibling!;

describe('Activity without earnings data', () => {
  it('stays the ordinary Activity: no Earnings or Possible sections', async () => {
    let d = source(ops.emptyData(), '2026-09-01', 'income', 'Salary', 2000, '2026-10-01', { type: 'monthly' }, 'salary');
    d = unwrap(ops.recordActual(d, 'salary@2026-10-01', { amountCents: usd(2000), date: '2026-10-01' }, clock));
    await openApp('#/activity', unwrap(ops.completeOnboarding(d)));
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('+$2,000.00', { selector: '.hero-value' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Earnings' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Possible' })).toBeNull();
  });
});

describe('Activity with earnings', () => {
  it('shows earned, not received yet and received apart; received is already in cash flow and never added again', async () => {
    const data = unwrap(ops.completeOnboarding(earningsPlan()));
    await openApp('#/activity', data);
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    // Cash flow: $2,000 salary + $2,290 received for work. Earned and unpaid money is not in it.
    expect(screen.getByRole('region', { name: 'Month summary' })).toHaveTextContent('+$4,290.00');
    const card = earningsCard();
    expect(row(card, 'Earned from work')).toHaveTextContent('$505.38');
    expect(row(card, 'Hours')).toHaveTextContent('16.5 h');
    expect(row(card, 'Effective hourly')).toHaveTextContent('$28.20/h');
    expect(row(card, 'Jobs paid')).toHaveTextContent('$780.00');
    // $100 waiting for payout + $150 done job.
    expect(row(card, 'Not received yet')).toHaveTextContent('$250.00');
    expect(row(card, 'Received for work')).toHaveTextContent('$2,290.00');
  });

  it('the details sheet is read-only: per income, not received yet and received, and nothing is saved', async () => {
    const user = await openApp('#/activity', unwrap(ops.completeOnboarding(earningsPlan())));
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    const before = localStorage.getItem(STORAGE_KEY);
    await user.click(within(earningsCard()).getByRole('button', { name: 'Details' }));
    const sheet = screen.getByRole('dialog', { name: 'Earnings · October 2026' });
    const work = within(sheet).getByRole('heading', { name: 'Work in October 2026' }).closest('section')!;
    expect(within(work).getByRole('heading', { name: 'Server' }).closest('.card')).toHaveTextContent('Shifts2Hours11.5 hEarned$300.38Wages$175.38Cash tips$40.00Card tips$85.00Effective hourly$26.12/h');
    expect(within(work).getByRole('heading', { name: 'DoorDash payouts' }).closest('.card')).toHaveTextContent('Sessions3Hours5 hEarned$205.00Platform earnings$190.00Cash received$15.00Effective hourly$33.00/h');
    const waiting = within(sheet).getByRole('heading', { name: 'Not received yet' }).closest('section')!;
    expect(waiting).toHaveTextContent('DoorDash payouts · waiting for payout$100.00DoorDash$40.00Uber$60.00');
    expect(waiting).toHaveTextContent('Jobs done, not paid yet$150.00Poster · No payment date · not counted$150.00');
    expect(waiting).toHaveTextContent('Planned job$1,200.00');
    const received = within(sheet).getByRole('list', { name: 'Received in October 2026' });
    expect(within(received).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'ServerPaycheck · Oct 16+$780.00',
      'Cash tips · ServerCash tips · Oct 13+$40.00',
      'DoorDash payoutsPayout · Oct 12+$85.00',
      'LogoJob payment · Oct 9+$780.00',
      'Cash · DoorDashCash from a session · Oct 6+$15.00',
      'ServerPaycheck · Oct 2+$590.00',
    ]);
    // Read-only: the only control is Close.
    expect(within(sheet).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Close']);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(earningsCard()).getByRole('button', { name: 'Details' })).toHaveFocus();
    // Browsing months changes figures, never data.
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(row(earningsCard(), 'Earned from work')).toHaveTextContent('$81.00');
    expect(row(earningsCard(), 'Received for work')).toHaveTextContent('$320.00');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(within(earningsCard()).getByText('No shifts or sessions logged in August 2026.')).toBeInTheDocument();
    expect(row(earningsCard(), 'Not received yet')).toHaveTextContent('$250.00');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('possible income this month is listed apart from the totals, and opens its sheet to resolve it', async () => {
    const d = unwrap(ops.addOneTime(earningsPlan(), { kind: 'income', description: 'Maybe a bonus', amountCents: usd(250), date: '2026-10-25', certainty: 'possible' }, clock, 'bonus'));
    const user = await openApp('#/activity', unwrap(ops.completeOnboarding(d)));
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    const possible = screen.getByRole('heading', { name: 'Possible' }).closest('section')!;
    expect(within(possible).getByRole('button', { name: /^Maybe a bonus/ })).toHaveTextContent('Oct 25');
    expect(within(possible).getByRole('button', { name: /^Maybe a bonus/ })).toHaveTextContent('$250.00');
    expect(screen.getByRole('region', { name: 'Month summary' })).toHaveTextContent('+$4,290.00');
    await user.click(within(possible).getByRole('button', { name: /^Maybe a bonus/ }));
    expect(within(screen.getByRole('dialog', { name: 'Maybe a bonus' })).getByRole('button', { name: /Mark as expected/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.queryByRole('heading', { name: 'Possible' })).toBeNull();
  });

  it('a paycheck corrected to an earlier date no longer shows as paying later shifts, on the income or in Earnings', async () => {
    // The Oct 16 paycheck paid the Oct 13 and Oct 14 shifts; it actually arrived Oct 13.
    const d = unwrap(ops.correctActual(earningsPlan(), 'job@2026-10-16', { amountCents: usd(780), date: '2026-10-13' }, clock));
    const user = await openApp('#/activity', unwrap(ops.completeOnboarding(d)));
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    // Not received yet: $100 waiting for payout + $150 done job + the Oct 14 shift's $76.25 wages and $30 card tips.
    expect(row(earningsCard(), 'Not received yet')).toHaveTextContent('$356.25');
    expect(row(earningsCard(), 'Received for work')).toHaveTextContent('$2,290.00');
    await user.click(screen.getAllByRole('link', { name: 'Plan' })[0]!);
    await user.click(await screen.findByRole('button', { name: /^Server/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'Server' })).getByRole('region', { name: 'Shifts' });
    expect(within(sheet).getByRole('button', { name: /^Oct 14, 2026/ })).toHaveTextContent('Not paid yet');
    expect(within(sheet).getByRole('button', { name: /^Oct 13, 2026/ })).toHaveTextContent('Paid in the Oct 13 paycheck');
  });
});
