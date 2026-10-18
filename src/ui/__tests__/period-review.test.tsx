import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../domain/__tests__/helpers';
import { reviewStatus, reviewSummary } from '../../domain/cadence';
import { formatMoney } from '../../domain/money';
import { buildForecast } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData, ReviewCadence } from '../../domain/types';
import { CloudAdapter } from '../../state/cloud';
import { MemoryAdapter, type StorageAdapter } from '../../state/storage';
import { StoreProvider, useStore } from '../../state/store';
import { FakeServer } from '../../state/__tests__/fake-server';
import { SaveStatusBar } from '../components/backup';
import { ToastProvider } from '../components/common';
import { ReviewRhythmSettings } from '../components/rhythm';
import { Dashboard } from '../screens/Dashboard';

/*
 * Set up Sun 2026-10-11: paid $1,800 every 2 weeks from Thu Oct 15; phone $60
 * monthly from Oct 25; rent $1,200 monthly from Nov 1.
 */
const SETUP = '2026-10-11';
function data(cadence?: ReviewCadence): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, SETUP, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
  return cadence ? unwrap(ops.setReviewCadence(d, cadence)) : d;
}

let store: ReturnType<typeof useStore>;
function Spy() {
  store = useStore();
  return null;
}

async function mount(adapter: StorageAdapter, today: string) {
  const view = render(
    <StoreProvider adapter={adapter} today={today}>
      <ToastProvider>
        <Spy />
        <SaveStatusBar />
        <ReviewRhythmSettings />
        <Dashboard />
      </ToastProvider>
    </StoreProvider>,
  );
  await screen.findByRole('heading', { name: 'Review rhythm' });
  return { view, user: userEvent.setup() };
}

const entry = () => screen.queryByRole('button', { name: /review is ready/ });

describe('choosing a review rhythm', () => {
  it('is off by default, with no review on the dashboard', async () => {
    await mount(new MemoryAdapter(data()), '2026-10-15');
    expect(screen.getByRole('radio', { name: /^Off/ })).toBeChecked();
    expect(entry()).toBeNull();
  });

  it('offers all four rhythms, each explained, and saves the choice', async () => {
    const adapter = new MemoryAdapter(data());
    const { user } = await mount(adapter, '2026-10-15');
    const options = screen.getAllByRole('radio');
    expect(options.map((o) => o.closest('label')!.textContent)).toEqual([
      'OffNo reviews. You can still look at your forecast anytime.',
      'WeeklyA short look at the week, each Sunday through Saturday.',
      'On paydayA look at each pay period, starting on your main payday.',
      'Monthly look-aheadA look at the month ahead, from the 1st.',
    ]);
    for (const [name, cadence] of [['Weekly', 'weekly'], ['On payday', 'payday'], ['Monthly look-ahead', 'monthly'], ['Off', 'off']] as const) {
      await user.click(screen.getByRole('radio', { name: new RegExp(`^${name}`) }));
      expect(store.data.review?.cadence).toBe(cadence);
    }
    await waitFor(async () => expect((await adapter.load()).review).toEqual({ cadence: 'off', handledOn: null, outcome: null }));
  });

  it('can be chosen from the keyboard', async () => {
    const { user } = await mount(new MemoryAdapter(data()), '2026-10-15');
    screen.getByRole('radio', { name: /^Off/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(store.data.review?.cadence).toBe('weekly');
    expect(await screen.findByRole('button', { name: 'Your weekly review is ready' })).toBeInTheDocument();
  });

  it('survives a reload, including a completed review', async () => {
    const adapter = new MemoryAdapter(data('weekly'));
    const first = await mount(adapter, '2026-10-15');
    await first.user.click(screen.getByRole('button', { name: 'Your weekly review is ready' }));
    await first.user.click(screen.getByRole('button', { name: 'Mark review done' }));
    await waitFor(async () => expect((await adapter.load()).review?.handledOn).toBe('2026-10-15'));
    first.view.unmount();
    await mount(adapter, '2026-10-17');
    expect(screen.getByRole('radio', { name: /^Weekly/ })).toBeChecked();
    expect(entry()).toBeNull();
  });
});

describe('the review', () => {
  it('appears when due, and completing it clears it without recording anything', async () => {
    const { user } = await mount(new MemoryAdapter(data('weekly')), '2026-10-15');
    const before = store.data.records;
    await user.click(screen.getByRole('button', { name: 'Your weekly review is ready' }));
    const sheet = screen.getByRole('dialog', { name: 'Weekly review' });
    expect(sheet).toHaveTextContent('Oct 11 – 17');
    expect(within(sheet).getByRole('region', { name: 'Expected income' })).toHaveTextContent('PaycheckExpected today+$1,800.00');
    expect(within(sheet).getByRole('region', { name: 'Recorded' })).toHaveTextContent('None.');
    // Nothing goes out this week: an actual zero, without a minus sign.
    expect(sheet).toHaveTextContent('Money out$0.00Cash flow+$1,800.00');
    expect(sheet).not.toHaveTextContent('−$0.00');
    expect(sheet).toHaveTextContent('Marking the review done doesn’t record any payments or income.');
    await user.click(within(sheet).getByRole('button', { name: 'Mark review done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(entry()).toBeNull();
    expect(store.data.records).toBe(before);
    expect(store.data.review).toEqual({ cadence: 'weekly', handledOn: '2026-10-15', outcome: 'completed' });
  });

  it('skipping clears it too, and changes no financial data', async () => {
    const { user } = await mount(new MemoryAdapter(data('monthly')), '2026-10-15');
    const before = { sources: store.data.sources, records: store.data.records };
    await user.click(screen.getByRole('button', { name: 'Your monthly look-ahead review is ready' }));
    await user.click(screen.getByRole('button', { name: 'Skip this one' }));
    expect(entry()).toBeNull();
    expect({ sources: store.data.sources, records: store.data.records }).toEqual(before);
    expect(store.data.review?.outcome).toBe('skipped');
  });

  it('closing without choosing leaves it due', async () => {
    const { user } = await mount(new MemoryAdapter(data('weekly')), '2026-10-15');
    await user.click(screen.getByRole('button', { name: 'Your weekly review is ready' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(entry()).toBeInTheDocument();
    expect(store.data.review?.handledOn).toBeNull();
  });

  it('on payday: the paycheck is expected today, not recorded, and stays that way after the review', async () => {
    const { user } = await mount(new MemoryAdapter(data('payday')), '2026-10-15');
    await user.click(screen.getByRole('button', { name: 'Your on payday review is ready' }));
    const sheet = screen.getByRole('dialog', { name: 'On payday review' });
    expect(sheet).toHaveTextContent('Oct 15 – 28');
    expect(within(sheet).getByRole('region', { name: 'Expected income' })).toHaveTextContent('PaycheckExpected today+$1,800.00');
    await user.click(within(sheet).getByRole('button', { name: 'Mark review done' }));
    expect(store.data.records).toEqual([]);
  });

  it('a received paycheck is listed as recorded, apart from what is still expected', async () => {
    const d = unwrap(ops.recordActual(data('payday'), 'pay@2026-10-15', { amountCents: usd(1750), date: '2026-10-15' }, clockAt('2026-10-15')));
    const { user } = await mount(new MemoryAdapter(d), '2026-10-15');
    await user.click(screen.getByRole('button', { name: 'Your on payday review is ready' }));
    const sheet = screen.getByRole('dialog', { name: 'On payday review' });
    expect(within(sheet).getByRole('region', { name: 'Recorded' })).toHaveTextContent('PaycheckReceived Oct 15, 2026+$1,750.00');
    expect(within(sheet).getByRole('region', { name: 'Expected income' })).toHaveTextContent('None.');
    expect(within(sheet).getByRole('region', { name: 'Expected payments' })).toHaveTextContent('PhoneExpected Oct 25, 2026−$60.00');
  });

  it('an unpaid bill is shown as needing an update and stays unpaid after the review', async () => {
    const { user } = await mount(new MemoryAdapter(data('weekly')), '2026-10-27');
    await user.click(screen.getByRole('button', { name: 'Your weekly review is ready' }));
    const sheet = screen.getByRole('dialog', { name: 'Weekly review' });
    const needs = within(sheet).getByRole('region', { name: 'Needs an update' });
    expect(needs).toHaveTextContent('PhoneExpected Oct 25, 2026 · not recorded−$60.00');
    await user.click(within(sheet).getByRole('button', { name: 'Mark review done' }));
    expect(store.data.records).toEqual([]);
    expect(reviewStatus(store.data, '2026-10-27').due).toBe(false);
  });

  it('shows the cash flow reviewSummary gives, and any timing gap', async () => {
    let d = data('monthly');
    d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Car repair', amountCents: usd(2500), date: '2026-11-03' }, clockAt(SETUP), 'repair'));
    const { user } = await mount(new MemoryAdapter(d), '2026-11-01');
    const period = reviewStatus(d, '2026-11-01').period!;
    const sum = reviewSummary(buildForecast(d, '2026-11-01', { through: period.end }), period);
    await user.click(screen.getByRole('button', { name: 'Your monthly look-ahead review is ready' }));
    const sheet = screen.getByRole('dialog', { name: 'Monthly look-ahead review' });
    expect(sheet).toHaveTextContent(`Money in+${formatMoney(sum.cashFlow.incomeCents)}Money out−${formatMoney(sum.cashFlow.outflowCents)}Cash flow`);
    // Nov: paychecks Nov 12, 26 (+$3,600); rent, repair, phone (−$3,760): −$160.
    expect(sum.cashFlow).toEqual({ incomeCents: usd(3600), outflowCents: usd(3760), reservesCents: 0, operatingCents: usd(-160), netCents: usd(-160) });
    expect(sheet).toHaveTextContent('Cash flow−$160.00');
    expect(sum.gaps.map((g) => g.start)).toEqual(['2026-11-03']);
    expect(within(sheet).getByRole('region', { name: 'Timing gaps' })).toHaveTextContent(`Nov 3 – 11: down to ${formatMoney(sum.gaps[0]!.lowestCents)}, back to $0 or more on Nov 12`);
  });

  it('opens an item’s details from the review', async () => {
    const { user } = await mount(new MemoryAdapter(data('weekly')), '2026-10-27');
    await user.click(screen.getByRole('button', { name: 'Your weekly review is ready' }));
    await user.click(within(screen.getByRole('region', { name: 'Needs an update' })).getByRole('button', { name: /^Phone/ }));
    expect(screen.getByRole('dialog', { name: 'Phone' })).toBeInTheDocument();
  });

  it('a refused save is reported, not shown as saved, and the change stays on screen', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'u1', localStorage, true);
    localStorage.clear();
    server.row = { data: data('weekly'), revision: 1 };
    const { user } = await mount(adapter, '2026-10-15');
    server.refuse = true;
    await user.click(screen.getByRole('button', { name: 'Your weekly review is ready' }));
    await user.click(screen.getByRole('button', { name: 'Mark review done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your latest change hasn’t been saved.');
    expect(store.saveStatus).toBe('error');
    expect(store.data.review?.outcome).toBe('completed');
  });
});
