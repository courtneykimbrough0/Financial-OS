import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import { buildForecast, dailyTimeline, weekSummaries } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import { periodPlan } from '../../domain/plan';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';
import { agendaItems, dayIsActive, kindsWithActivity, planIsEmpty, weekIsActive } from '../visibility';

const SETUP = '2026-09-01';
const TODAY = '2026-10-13';
const clock = (day: string) => ({ today: day, now: `${day}T12:00:00Z` }) as ops.Clock;

/** Stays above $0: paycheck Oct 16 and 30, reserve Oct 18, music and car loan Oct 20, a repair Oct 24. */
function steady(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'subscription', 'Music', 11, '2026-10-20', { type: 'monthly' }, 'music');
  d = source(d, SETUP, 'liability', 'Car loan', 350, '2026-10-20', { type: 'monthly' }, 'car');
  d = source(d, SETUP, 'reserve', 'Emergency fund', 100, '2026-10-18', { type: 'monthly' }, 'fund');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Car repair', amountCents: 25000, date: '2026-10-24' }, clock(TODAY), 'repair'));
  return unwrap(ops.completeOnboarding(d));
}

/** Below $0 from Oct 20 for the rest of the month: $100 monthly income against $1,200 rent. */
function short(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 100, '2026-10-16', { type: 'monthly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');
  return unwrap(ops.completeOnboarding(d));
}

async function open(hash: string, data: AppData) {
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

describe('visibility rules (pure)', () => {
  it('a day is active with entries, or with nothing scheduled and a running total below $0', () => {
    const rows = dailyTimeline(buildForecast(short(), TODAY), '2026-10-14', '2026-10-21');
    const by = (date: string) => rows.find((r) => r.date === date)!;
    expect(dayIsActive(by('2026-10-14'))).toBe(false); // before the start, nothing scheduled
    expect(dayIsActive(by('2026-10-16'))).toBe(true); // paycheck
    expect(dayIsActive(by('2026-10-17'))).toBe(false); // $100, nothing scheduled
    expect(by('2026-10-21').entries).toHaveLength(0);
    expect(by('2026-10-21').tallyCents).toBe(-110000);
    expect(dayIsActive(by('2026-10-21'))).toBe(true); // negative but empty
  });

  it('folds runs of quiet days, keeping today and every active day', () => {
    const rows = dailyTimeline(buildForecast(steady(), TODAY), '2026-10-11', '2026-10-17');
    expect(agendaItems(rows, TODAY).map((i) => (i.type === 'day' ? i.row.date : `${i.start}..${i.end}`))).toEqual([
      '2026-10-11..2026-10-12',
      '2026-10-13',
      '2026-10-14..2026-10-15',
      '2026-10-16',
      '2026-10-17..2026-10-17',
    ]);
  });

  it('a week opens only when one of its days is active', () => {
    const weeks = weekSummaries(buildForecast(short(), TODAY), '2026-10-01', '2026-10-31');
    expect(weeks.map((w) => [w.start, weekIsActive(w)])).toEqual([
      ['2026-10-01', false],
      ['2026-10-04', false],
      ['2026-10-11', true],
      ['2026-10-18', true],
      ['2026-10-25', true], // nothing scheduled, but below $0 all week
    ]);
  });

  it('reads emptiness and activity by classification from the plan, without new math', () => {
    const f = buildForecast(steady(), TODAY);
    expect(planIsEmpty(periodPlan(f, '2026-10-14', '2026-10-15'))).toBe(true);
    expect(planIsEmpty(periodPlan(f, '2026-10-16', '2026-10-16'))).toBe(false);
    expect(kindsWithActivity(periodPlan(f, '2026-10-16', '2026-10-16'))).toBe(1);
    expect(kindsWithActivity(periodPlan(f, '2026-10-01', '2026-10-31'))).toBe(5);
  });
});

describe('Forecast: the calendar', () => {
  it('a day with nothing scheduled and a running total at or above $0 is a plain cell, not a button', async () => {
    await open('#/forecast', steady());
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    const calendar = screen.getByRole('table');
    expect(within(calendar).queryByRole('button', { name: /^Wednesday, October 14, 2026/ })).toBeNull();
    expect(within(calendar).getByRole('button', { name: /^Friday, October 16, 2026/ })).toHaveAttribute('aria-haspopup', 'dialog');
    for (const cell of calendar.querySelectorAll('.cal-day.inactive')) {
      expect(cell.tagName).toBe('SPAN');
      expect(cell).not.toHaveAttribute('aria-haspopup');
    }
  });

  it('a day below $0 with nothing scheduled stays a button, and its sheet says how short', async () => {
    const user = await open('#/forecast', short());
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: /^Wednesday, October 21, 2026.*below zero/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Wednesday, October 21, 2026' });
    expect(sheet).toHaveTextContent('Short $1,100.00 at the end of this day.');
  });
});

describe('Forecast: week by week', () => {
  it('a week with nothing scheduled has no expand control and no $0.00 money columns, only the running total carried', async () => {
    await open('#/forecast', steady());
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    expect(screen.queryByRole('button', { name: /^Oct 4 – 10/ })).toBeNull();
    const quiet = screen.getByText('Oct 4 – 10').closest('.week-row')!;
    // The month's running total starts Oct 1 at $0, so the quiet week carries $0.00.
    expect(quiet).toHaveTextContent('Oct 4 – 10Nothing scheduledRunning total $0.00');
    expect(quiet).not.toHaveAttribute('aria-expanded');
    expect(quiet).not.toHaveTextContent(/[+−]\$0\.00/);
  });

  it('a week shows only the amounts that are not zero', async () => {
    await open('#/forecast', steady());
    const week = await screen.findByRole('button', { name: /^Oct 11 – 17/ });
    expect(week).toHaveTextContent('+$1,800.00');
    expect(week).not.toHaveTextContent(/−\$0\.00/);
    expect(week).toHaveTextContent('Running total $1,800.00');
  });

  it('an open week folds quiet days into text and keeps today', async () => {
    const user = await open('#/forecast', steady());
    await user.click(await screen.findByRole('button', { name: /^Oct 11 – 17/ }));
    const days = document.querySelector('.week-days .timeline')!;
    expect([...days.children].map((li) => li.textContent)).toEqual([
      'Oct 11 – 12 · nothing scheduled',
      'Tue, Oct 13Running total$0.00', // today: the running total from Oct 1 so far
      'Oct 14 – 15 · nothing scheduled',
      expect.stringMatching(/^Fri, Oct 16.*Running total\$1,800\.00$/),
      'Sat, Oct 17 · nothing scheduled',
    ]);
    expect(within(days as HTMLElement).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Show details for Tuesday, October 13, 2026',
      'Show details for Friday, October 16, 2026',
    ]);
    expect(days).not.toHaveTextContent('Running total—');
  });

  it('a week with nothing scheduled but below $0 still opens, and every day shows', async () => {
    const user = await open('#/forecast', short());
    await user.click(await screen.findByRole('button', { name: /^Oct 25 – 31/ }));
    const rows = within(document.querySelector('.week-days .timeline') as HTMLElement).getAllByRole('button');
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row).toHaveTextContent('Running total−$1,100.00');
  });
});

describe('Forecast: the summary', () => {
  it('when the running total stays above $0, one line says so instead of the lowest running total', async () => {
    await open('#/forecast', steady());
    const hero = (await screen.findByText('Cash flow', { selector: '.hero-label' })).closest('section')!;
    expect(hero).toHaveTextContent('You stay above $0 through Oct 31');
    expect(hero).not.toHaveTextContent('Lowest running total');
  });

  it('when it goes below $0, the lowest running total is always shown', async () => {
    await open('#/forecast', short());
    const hero = (await screen.findByText('Cash flow', { selector: '.hero-label' })).closest('section')!;
    expect(hero).toHaveTextContent('Lowest running total−$1,100.00 · Oct 20');
    expect(hero).not.toHaveTextContent('You stay above $0');
  });

  it('a range with nothing in it shows one line in the summary instead of a $0.00 breakdown', async () => {
    const user = await open('#/forecast', steady());
    const views = await screen.findByRole('tablist', { name: 'Forecast view' });
    await user.click(within(views).getByRole('tab', { name: 'Custom' }));
    const startDate = screen.getByLabelText('Start date');
    const endDate = screen.getByLabelText('End date');
    await user.clear(startDate);
    await user.type(startDate, '2026-10-14');
    await user.clear(endDate);
    await user.type(endDate, '2026-10-15');
    const hero = screen.getByText('Cash flow', { selector: '.hero-label' }).closest('section')!;
    expect(hero).toHaveTextContent('Nothing scheduled in this period.');
    expect(hero.querySelector('.breakdown')).toBeNull();
    expect(hero).not.toHaveTextContent(/Income|Spending/);
  });

  it('with nothing planned, only the setup card shows: no $0.00 summary, calendar or breakdown', async () => {
    const d = unwrap(ops.completeOnboarding(ops.emptyData()));
    await open('#/forecast', d);
    expect(await screen.findByText("Add what you expect to come in and go out to see what's ahead.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Income' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Forecast view' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Breakdown' })).toBeNull();
    expect(screen.queryByText('Cash flow', { selector: '.hero-label' })).toBeNull();
  });
});

describe('Activity: By kind (decision S1), inside the one summary since D4', () => {
  it('is hidden when only one classification has activity, since the summary already says it all', async () => {
    let d = steady();
    d = unwrap(ops.recordActual(d, 'pay@2026-10-16', { amountCents: 180000, date: '2026-10-16' }, clock('2026-10-16')));
    vi.setSystemTime(new Date(2026, 9, 17, 9, 0));
    await open('#/activity', d);
    const summary = await screen.findByRole('region', { name: 'Month summary' });
    expect(screen.queryByRole('region', { name: 'By kind' })).toBeNull();
    expect(summary.querySelector('.breakdown-row.sub')).toBeNull();
    expect(summary).not.toHaveTextContent(/reserves/);
  });

  it('appears once two classifications have activity; Paid $0.00 stays in the summary (decision S2)', async () => {
    let d = steady();
    d = unwrap(ops.recordActual(d, 'pay@2026-10-16', { amountCents: 180000, date: '2026-10-16' }, clock('2026-10-16')));
    d = unwrap(ops.recordActual(d, 'fund@2026-10-18', { amountCents: 10000, date: '2026-10-18' }, clock('2026-10-18')));
    vi.setSystemTime(new Date(2026, 9, 19, 9, 0));
    await open('#/activity', d);
    const summary = await screen.findByRole('region', { name: 'Month summary' });
    expect(summary).toHaveTextContent('Paid$0.00');
    expect(summary).toHaveTextContent(/Received\+\$1,800\.00.*Saved in reserves−\$100\.00/);
  });
});

describe('Plan', () => {
  it('an empty section is one line with its Add button, not an empty card with a heading', async () => {
    await open('#/plan/liabilities', unwrap(ops.completeOnboarding(source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay'))));
    const empty = await screen.findByRole('region', { name: 'Liability payments' });
    expect(within(empty).getByRole('button', { name: /Add liability payment/ })).toBeInTheDocument();
    expect(empty).toHaveTextContent('Add payments like a car loan, student loan, or credit card payment.');
    expect(empty.querySelector('.empty-state')).toBeNull();
    expect(screen.queryByText(/No liability payments yet/)).toBeNull();
  });

  it("a recurring kind's one-time list is absent until it has items, with Add one-time beside the recurring Add", async () => {
    const user = await open('#/plan/income', steady());
    await screen.findByText('Paycheck');
    expect(screen.queryByRole('region', { name: 'One-time income' })).toBeNull();
    const recurring = screen.getByRole('region', { name: 'Recurring income' });
    await user.click(within(recurring).getByRole('button', { name: 'Add one-time' }));
    expect(await screen.findByRole('dialog', { name: 'Add one-time income' })).toBeInTheDocument();
  });

  it('varied spending keeps its list, with one line when empty', async () => {
    const d = unwrap(ops.completeOnboarding(source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay')));
    const user = await open('#/plan/expenses', d);
    await user.click(within(await screen.findByRole('tablist', { name: 'Expense type' })).getByRole('tab', { name: 'Varied' }));
    // Nothing at all on the tab: the intro is the one line, and the Add stays.
    expect(screen.getByText(/Spending that happens once/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add spending' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing one-time yet/)).toBeNull();
  });

  it("an item's sheet lists dates only when the item has dates to show", async () => {
    let d = steady();
    d = source(d, SETUP, 'reserve', 'Next year', 50, '2027-06-01', { type: 'monthly' }, 'later');
    const user = await open('#/plan/reserves', d);
    await user.click(await screen.findByRole('button', { name: /^Emergency fund/ }));
    expect(within(screen.getByRole('dialog', { name: 'Emergency fund' })).getByRole('region', { name: 'Recent and upcoming dates' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /^Next year/ }));
    expect(within(screen.getByRole('dialog', { name: 'Next year' })).queryByRole('region', { name: 'Recent and upcoming dates' })).toBeNull();
  });
});

describe('visibility never changes money', () => {
  it('opening weeks and moving between screens saves nothing', async () => {
    const user = await open('#/forecast', steady());
    const before = localStorage.getItem(STORAGE_KEY);
    await user.click(await screen.findByRole('button', { name: /^Oct 11 – 17/ }));
    await user.click(screen.getByRole('button', { name: /^Oct 18 – 24/ }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});
