import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../domain/__tests__/helpers';
import { buildForecast } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData, RecurrenceRule, RecurringKind } from '../../domain/types';
import { MemoryAdapter } from '../../state/storage';
import { StoreProvider, useStore } from '../../state/store';
import { SaveStatusBar } from '../components/backup';
import { ToastProvider } from '../components/common';
import { SourcesScreen } from '../screens/SourcesScreen';

/*
 * Today is Fri 2026-10-16. Paid $1,000 every other Friday from Oct 23 (so
 * the running total starts Oct 22); rent $1,500 on the 1st from Nov 1; a
 * one-time $940 car insurance bill on Jan 2. Electricity is estimated at
 * $180 on the 3rd and was paid $210, $215, $220, $205, $225, $210, $210
 * (Apr–Oct): the last six average $214.17, so $215 from Nov 3 is suggested.
 */
const TODAY = '2026-10-16';
const clock = clockAt(TODAY);

function add(d: AppData, kind: RecurringKind, name: string, dollars: number, start: string, id: string, rule: RecurrenceRule = { type: 'monthly' }) {
  return source(d, start, kind, name, dollars, start, rule, id);
}
function pay(d: AppData, id: string, payments: [string, number][]): AppData {
  for (const [date, dollars] of payments) d = unwrap(ops.recordActual(d, `${id}@${date}`, { amountCents: usd(dollars), date }, clock));
  return d;
}

function outlook(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = add(d, 'income', 'Paycheck', 1000, '2026-10-23', 'pay', { type: 'biweekly' });
  d = add(d, 'bill', 'Rent', 1500, '2026-11-01', 'rent');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Car insurance', amountCents: usd(940), date: '2027-01-02' }, clock, 'ins'));
  d = add(d, 'bill', 'Electricity', 180, '2026-04-03', 'elec');
  return pay(d, 'elec', [
    ['2026-04-03', 210],
    ['2026-05-03', 215],
    ['2026-06-03', 220],
    ['2026-07-03', 205],
    ['2026-08-03', 225],
    ['2026-09-03', 210],
    ['2026-10-03', 210],
  ]);
}

let store: ReturnType<typeof useStore>;
function Spy() {
  store = useStore();
  return null;
}

async function mount(data: AppData, kind: RecurringKind = 'bill') {
  const adapter = new MemoryAdapter(data);
  render(
    <StoreProvider adapter={adapter} today={TODAY}>
      <ToastProvider>
        <Spy />
        <SaveStatusBar />
        <SourcesScreen kind={kind} />
      </ToastProvider>
    </StoreProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
  return { adapter, user: userEvent.setup() };
}

const card = (name: string) => screen.getByRole('heading', { name, level: 3 }).closest('li')!;
const reviewButton = (name: string) => screen.queryByRole('button', { name: `Review the suggestion for ${name}` });

async function openSheet(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(reviewButton(name)!);
  return screen.getByRole('dialog', { name: `Suggestion for ${name}` });
}

beforeEach(() => localStorage.clear());

describe('where suggestions appear', () => {
  it('on a bill with enough history, and not on one without', async () => {
    await mount(outlook());
    expect(within(card('Electricity')).getByText(/Suggested estimate/).closest('.callout')).toHaveTextContent('Suggested estimate: $215.00 instead of $180.00 from Nov 3.Review');
    expect(reviewButton('Rent')).toBeNull();
    expect(within(card('Rent')).queryByText(/Suggested estimate/)).toBeNull();
  });

  it('on a subscription', async () => {
    let d = unwrap(ops.completeOnboarding(ops.emptyData()));
    d = add(d, 'subscription', 'Internet', 90, '2026-06-12', 'net');
    d = pay(d, 'net', [
      ['2026-06-12', 90],
      ['2026-07-12', 84],
      ['2026-08-12', 79],
      ['2026-09-12', 75.5],
    ]);
    const { user } = await mount(d, 'subscription');
    expect(card('Internet')).toHaveTextContent('Suggested estimate: $76.00 instead of $90.00 from Nov 12.');
    const sheet = await openSheet(user, 'Internet');
    expect(sheet).toHaveTextContent('Payments going downLimited history');
    expect(sheet).toHaveTextContent('Current estimate$90.00Suggested$76.00Change$14.00 less');
    expect(within(sheet).getByRole('region', { name: 'Keep in mind' })).toHaveTextContent(
      "Keep in mindBased on only 4 payments.Uses the latest amount; it doesn't assume the drop continues.Rounded up to the next whole dollar.",
    );
  });

  it('on a liability payment, counting only payments since its amount last changed', async () => {
    let d = unwrap(ops.completeOnboarding(ops.emptyData()));
    d = add(d, 'liability', 'Car loan', 300, '2026-04-01', 'loan');
    d = pay(d, 'loan', [
      ['2026-04-01', 300],
      ['2026-05-01', 300],
      ['2026-06-01', 300],
    ]);
    d = unwrap(ops.changeSourceSchedule(d, 'loan', { startDate: '2026-07-01', amountCents: usd(250), rule: { type: 'monthly' } }, clockAt('2026-06-20')));
    d = pay(d, 'loan', [
      ['2026-07-01', 270],
      ['2026-08-01', 270],
      ['2026-09-01', 270],
    ]);
    const { user } = await mount(d, 'liability');
    const sheet = await openSheet(user, 'Car loan');
    expect(sheet).toHaveTextContent('Same amount each time');
    expect(sheet).toHaveTextContent('Current estimate$250.00Suggested$270.00Change$20.00 more');
    expect(sheet).toHaveTextContent('Your last 3 Car loan payments were each $270.00. Your current estimate is $250.00. Consider $270.00 from Nov 1, 2026.');
    expect(within(sheet).getByRole('region', { name: 'Keep in mind' })).toHaveTextContent('Counts only payments since your estimate became $250.00 on Jul 1, 2026.');
    expect(within(sheet).getAllByRole('listitem').filter((li) => li.closest('[aria-label="Payments"]')).map((li) => li.textContent)).toEqual([
      'Jul 1, 2026 · Counted$270.00',
      'Aug 1, 2026 · Counted$270.00',
      'Sep 1, 2026 · Counted$270.00',
    ]);
  });

  it('not with too little history', async () => {
    const d = pay(add(unwrap(ops.completeOnboarding(ops.emptyData())), 'bill', 'Water', 60, '2026-08-10', 'water'), 'water', [
      ['2026-08-10', 90],
      ['2026-09-10', 95],
    ]);
    await mount(d);
    expect(reviewButton('Water')).toBeNull();
  });

  it('not for income or reserves, however different their history', async () => {
    let d = unwrap(ops.completeOnboarding(ops.emptyData()));
    d = add(d, 'income', 'Paycheck', 1800, '2026-08-07', 'pay', { type: 'biweekly' });
    d = pay(d, 'pay', [
      ['2026-08-07', 2100],
      ['2026-08-21', 2300],
      ['2026-09-04', 2050],
      ['2026-09-18', 2200],
      ['2026-10-02', 2150],
    ]);
    d = add(d, 'reserve', 'Emergency fund', 100, '2026-07-20', 'save');
    d = pay(d, 'save', [
      ['2026-07-20', 150],
      ['2026-08-20', 150],
      ['2026-09-20', 150],
    ]);
    await mount(d, 'income');
    expect(card('Paycheck')).not.toHaveTextContent('Suggest');
    expect(screen.queryByRole('button', { name: /Review the suggestion/ })).toBeNull();
    cleanup();
    await mount(d, 'reserve');
    expect(card('Emergency fund')).not.toHaveTextContent('Suggest');
    expect(screen.queryByRole('button', { name: /Review the suggestion/ })).toBeNull();
  });
});

describe('what a suggestion shows', () => {
  it('current, suggested and the change, when it starts, the method and the explanation', async () => {
    const { user } = await mount(outlook());
    const sheet = await openSheet(user, 'Electricity');
    expect(sheet).toHaveTextContent('ElectricityAverage of recent payments');
    expect(sheet).not.toHaveTextContent('Limited history');
    expect(sheet).toHaveTextContent('Current estimate$180.00Suggested$215.00Change$35.00 more');
    expect(sheet).toHaveTextContent('From Nov 3, 2026 on');
    expect(sheet).toHaveTextContent('Your last 6 Electricity payments averaged $214.17 and ranged from $205.00 to $225.00. Your current estimate is $180.00. Consider $215.00 from Nov 3, 2026.');
    expect(within(sheet).getByRole('region', { name: 'Keep in mind' })).toHaveTextContent('Keep in mindRounded up to the next whole dollar.');
  });

  it('the payments behind it, folded away until opened', async () => {
    const { user } = await mount(outlook());
    const sheet = await openSheet(user, 'Electricity');
    const details = sheet.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')).toHaveTextContent('Payments behind this suggestion6 counted of 7');
    await user.click(details.querySelector('summary')!);
    expect(details.open).toBe(true);
    expect([...within(details).getAllByRole('listitem')].map((li) => li.textContent)).toEqual([
      'Apr 3, 2026 · Not counted: older than the payments used$210.00',
      'May 3, 2026 · Counted$215.00',
      'Jun 3, 2026 · Counted$220.00',
      'Jul 3, 2026 · Counted$205.00',
      'Aug 3, 2026 · Counted$225.00',
      'Sep 3, 2026 · Counted$210.00',
      'Oct 3, 2026 · Counted$210.00',
    ]);
  });

  it('an unusual payment left out, and why', async () => {
    let d = unwrap(ops.completeOnboarding(ops.emptyData()));
    d = add(d, 'bill', 'Gas', 120, '2026-04-03', 'gas');
    d = pay(d, 'gas', [
      ['2026-04-03', 152],
      ['2026-05-03', 150],
      ['2026-06-03', 149],
      ['2026-07-03', 151],
      ['2026-08-03', 150],
      ['2026-09-03', 400],
    ]);
    const { user } = await mount(d);
    const sheet = await openSheet(user, 'Gas');
    expect(sheet).toHaveTextContent('5 of your last 6 Gas payments averaged $150.40 and ranged from $149.00 to $152.00. Your current estimate is $120.00. Consider $151.00 from Nov 3, 2026.');
    expect(within(sheet).getByRole('region', { name: 'Keep in mind' })).toHaveTextContent('Based on only 5 payments.Left out as unusual: $400.00 (Sep 3, 2026).Rounded up to the next whole dollar.');
    expect(sheet).toHaveTextContent('Limited history');
    const rows = [...within(sheet.querySelector('details')!).getAllByRole('listitem')].map((li) => li.textContent);
    expect(rows.at(-1)).toBe('Sep 3, 2026 · Left out: more than 25% from your typical payment$400.00');
  });

  it('a seasonal one cautiously, for one payment, naming the month behind it', async () => {
    let d = unwrap(ops.completeOnboarding(ops.emptyData()));
    d = add(d, 'bill', 'Electricity', 180, '2025-09-03', 'elec');
    d = pay(d, 'elec', [
      ['2025-09-03', 190],
      ['2025-10-03', 160],
      ['2025-11-03', 240],
      ['2025-12-03', 270],
      ['2026-01-03', 280],
      ['2026-02-03', 250],
      ['2026-03-03', 190],
      ['2026-04-03', 150],
      ['2026-05-03', 140],
      ['2026-06-03', 170],
      ['2026-07-03', 230],
      ['2026-08-03', 240],
      ['2026-09-03', 180],
    ]);
    const { user } = await mount(d);
    expect(card('Electricity')).toHaveTextContent('Possible seasonal increase: $240.00 instead of $180.00 for Nov 3.');
    const sheet = await openSheet(user, 'Electricity');
    expect(sheet).toHaveTextContent('Possible seasonal increaseLimited history');
    expect(sheet).toHaveTextContent('For the Nov 3, 2026 payment only');
    expect(sheet).toHaveTextContent('Electricity may change with the season. Your November 2025 payment was $240.00. Your Nov 3, 2026 payment is expected at $180.00. Consider $240.00 for that payment.');
    expect(within(sheet).getByRole('region', { name: 'Keep in mind' })).toHaveTextContent("Based on one earlier November; one year doesn't show a reliable yearly pattern.For this one payment only; later payments keep $180.00.");
    expect(sheet.querySelector('details summary')).toHaveTextContent('1 counted of 12');
    await user.click(within(sheet).getByRole('button', { name: 'Preview your forecast' }));
    const preview = within(sheet).getByRole('region', { name: 'Forecast preview' });
    expect(within(preview).getByRole('list', { name: 'Payments that change' })).toHaveTextContent('Nov 3, 2026 · before your next payday, outside the running total$180.00 → $240.00');
    expect(within(within(preview).getByRole('list', { name: 'Payments that change' })).getAllByRole('listitem')).toHaveLength(1);
    expect(preview).toHaveTextContent("There's no upcoming payday to start a running total from.");
    expect(preview).not.toHaveTextContent('later payments');

    await user.click(within(sheet).getByRole('button', { name: 'Approve…' }));
    expect(within(sheet).getByRole('group', { name: 'Approve this change?' })).toHaveTextContent('Expect $240.00 for the Nov 3, 2026 Electricity payment instead of $180.00. Later payments stay at their current estimate.');
    await user.click(within(sheet).getByRole('button', { name: 'Approve change' }));
    expect(store.data.sources).toEqual(d.sources);
    expect(store.data.records.find((r) => r.id === 'elec@2026-11-03')).toMatchObject({ expectedAmountCents: 18000, scheduledAmountCents: 24000, scheduledDate: '2026-11-03' });
  });
});

describe('previewing', () => {
  it('shows every later payment that changes, the running totals and timing gaps, and saves nothing', async () => {
    const d = outlook();
    const { adapter, user } = await mount(d);
    const saved = JSON.stringify(await adapter.load());
    const sheet = await openSheet(user, 'Electricity');
    const toggle = within(sheet).getByRole('button', { name: 'Preview your forecast' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(within(sheet).getByRole('button', { name: 'Hide forecast preview' })).toHaveAttribute('aria-expanded', 'true');
    const preview = within(sheet).getByRole('region', { name: 'Forecast preview' });
    expect(preview).toHaveTextContent('Your lowest running total would drop from −$680.00 to −$715.00.');
    expect([...within(within(preview).getByRole('list', { name: 'Payments that change' })).getAllByRole('listitem')].map((li) => li.textContent)).toEqual([
      'Nov 3, 2026 · running total −$680.00 → −$715.00$180.00 → $215.00',
      'Dec 3, 2026 · running total −$360.00 → −$430.00$180.00 → $215.00',
      'Jan 3, 2027 · running total $20.00 → −$85.00$180.00 → $215.00',
    ]);
    expect(preview).toHaveTextContent('New timing gap: Jan 3 – 14, down to −$85.00, back to $0 or more on Jan 15.');
    expect(preview).toHaveTextContent('Deeper timing gap: Nov 1 – 5, down to −$715.00.');
    expect(preview).toHaveTextContent('Deeper timing gap: Dec 1 – 3, down to −$430.00.');
    expect(preview).toHaveTextContent('Compared through Jan 20, 2027; the new estimate also applies to later payments. Nothing is saved until you approve.');
    expect(store.data.sources).toEqual(d.sources);
    expect(store.data.records).toEqual(d.records);
    expect(JSON.stringify(await adapter.load())).toBe(saved);
  });
});

describe('approving, dismissing, and not now', () => {
  it('approve asks first, then changes the estimate from the effective date only', async () => {
    const d = outlook();
    const { adapter, user } = await mount(d);
    const sheet = await openSheet(user, 'Electricity');
    await user.click(within(sheet).getByRole('button', { name: 'Approve…' }));
    expect(store.data.sources).toEqual(d.sources);
    const confirm = within(sheet).getByRole('group', { name: 'Approve this change?' });
    expect(confirm).toHaveTextContent('Change the Electricity estimate from $180.00 to $215.00, starting with the Nov 3, 2026 payment.');
    expect(confirm).toHaveTextContent("Earlier payments and what you've recorded stay as they are. This changes your forecast only.");
    await user.click(within(confirm).getByRole('button', { name: 'Approve change' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Electricity is now expected at $215.00 from Nov 3, 2026.')).toBeInTheDocument();
    const elec = store.data.sources.find((s) => s.id === 'elec')!;
    expect(elec.versions.map((v) => [v.startDate, v.amountCents])).toEqual([
      ['2026-04-03', 18000],
      ['2026-11-03', 21500],
    ]);
    expect(store.data.records).toEqual(d.records);
    expect(store.data.sources.filter((s) => s.id !== 'elec')).toEqual(d.sources.filter((s) => s.id !== 'elec'));
    expect(reviewButton('Electricity')).toBeNull();
    expect(card('Electricity')).toHaveTextContent('Scheduled change: $215.00, monthly on the 3rd, starting Nov 3, 2026.');
    await waitFor(async () => expect((await adapter.load()).sources.find((s) => s.id === 'elec')!.versions).toHaveLength(2));
  });

  it('going back from the confirmation changes nothing', async () => {
    const d = outlook();
    const { user } = await mount(d);
    const sheet = await openSheet(user, 'Electricity');
    await user.click(within(sheet).getByRole('button', { name: 'Approve…' }));
    await user.click(within(sheet).getByRole('button', { name: 'Go back' }));
    expect(within(sheet).getByRole('button', { name: 'Approve…' })).toHaveFocus();
    expect(store.data.sources).toEqual(d.sources);
  });

  it('a stale approval is refused, with nothing changed', async () => {
    const { user } = await mount(outlook());
    const sheet = await openSheet(user, 'Electricity');
    await user.click(within(sheet).getByRole('button', { name: 'Approve…' }));
    // Meanwhile, November's bill is paid early.
    act(() => {
      store.run((d, c) => ops.recordActual(d, 'elec@2026-11-03', { amountCents: usd(230), date: TODAY }, c));
    });
    const versions = store.data.sources.find((s) => s.id === 'elec')!.versions;
    await user.click(within(sheet).getByRole('button', { name: 'Approve change' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('This suggestion is out of date. Look at the latest one before choosing.');
    expect(store.data.sources.find((s) => s.id === 'elec')!.versions).toBe(versions);
  });

  it('dismiss keeps the estimate and the forecast, and hides the suggestion', async () => {
    const d = outlook();
    const { adapter, user } = await mount(d);
    const before = buildForecast(d, TODAY);
    const sheet = await openSheet(user, 'Electricity');
    expect(within(sheet).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Suggestion dismissed. Electricity stays at $180.00.')).toBeInTheDocument();
    expect(buildForecast(store.data, TODAY)).toEqual(before);
    expect(store.data.records).toEqual(d.records);
    expect(store.data.sources.find((s) => s.id === 'elec')!.estimateDismissal).toEqual({ currentCents: 18000, proposedCents: 21500, through: '2026-10-03' });
    expect(reviewButton('Electricity')).toBeNull();
    await waitFor(async () => expect((await adapter.load()).sources.find((s) => s.id === 'elec')!.estimateDismissal).toBeDefined());
  });

  it('not now closes without saving anything, and the suggestion stays', async () => {
    const d = outlook();
    const { adapter, user } = await mount(d);
    const loaded = store.data;
    const sheet = await openSheet(user, 'Electricity');
    await user.click(within(sheet).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.data).toBe(loaded);
    expect((await adapter.load()).revision).toBe(d.revision);
    expect(reviewButton('Electricity')).toBeInTheDocument();
  });
});

describe('keyboard', () => {
  it('opens, approves through the confirmation, and returns focus, without a mouse', async () => {
    const { user } = await mount(outlook());
    reviewButton('Electricity')!.focus();
    await user.keyboard('{Enter}');
    const sheet = screen.getByRole('dialog', { name: 'Suggestion for Electricity' });
    within(sheet).getByRole('button', { name: 'Approve…' }).focus();
    await user.keyboard('{Enter}');
    expect(within(sheet).getByRole('button', { name: 'Go back' })).toHaveFocus();
    await user.tab();
    expect(within(sheet).getByRole('button', { name: 'Approve change' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.data.sources.find((s) => s.id === 'elec')!.versions).toHaveLength(2);
  });

  it('Escape closes it like Not now', async () => {
    const d = outlook();
    const { user } = await mount(d);
    const loaded = store.data;
    reviewButton('Electricity')!.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.data).toBe(loaded);
    expect(reviewButton('Electricity')).toHaveFocus();
  });
});
