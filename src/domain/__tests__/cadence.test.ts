import { describe, expect, it } from 'vitest';
import { reviewPeriod, reviewStatus, reviewSummary } from '../cadence';
import { todayLocal } from '../dates';
import { buildForecast, periodKpis, tallyOn } from '../forecast';
import * as ops from '../operations';
import type { AppData, ReviewCadence } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

/*
 * Step 5: when a review is due and what it covers. Set up on Sun 2026-10-11.
 *   Paycheck   $1,800 every 2 weeks from Thu Oct 15 (main)
 *   Side job   $200 weekly from Fri Oct 16
 *   Rent       $1,200 monthly from Nov 1
 *   Phone      $60 monthly from Oct 25
 */
const SETUP = '2026-10-11';
function data(): AppData {
  let d = ops.emptyData();
  d = source(d, SETUP, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'income', 'Side job', 200, '2026-10-16', { type: 'weekly' }, 'side');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
  return source(d, SETUP, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, 'phone');
}
const withCadence = (d: AppData, cadence: ReviewCadence) => unwrap(ops.setReviewCadence(d, cadence));
const status = (d: AppData, today: string) => {
  const s = reviewStatus(d, today);
  return { period: s.period && [s.period.start, s.period.end], due: s.due, nextDue: s.nextDue };
};

describe('quiet by default', () => {
  it('nothing is ever due until a rhythm is chosen', () => {
    for (const today of ['2026-10-11', '2026-10-15', '2026-11-01', '2027-01-01']) {
      expect(status(data(), today)).toEqual({ period: null, due: false, nextDue: null });
    }
    expect(status(withCadence(data(), 'off'), '2026-10-15')).toEqual({ period: null, due: false, nextDue: null });
  });
});

describe('weekly', () => {
  it.each([
    ['Sun Oct 11', '2026-10-11', ['2026-10-11', '2026-10-17'], '2026-10-11'],
    ['Sat Oct 17', '2026-10-17', ['2026-10-11', '2026-10-17'], '2026-10-11'],
    ['Sun Oct 18', '2026-10-18', ['2026-10-18', '2026-10-24'], '2026-10-18'],
    ['Wed Dec 30 (week spans the new year)', '2026-12-30', ['2026-12-27', '2027-01-02'], '2026-12-27'],
    ['Sat Jan 2, 2027', '2027-01-02', ['2026-12-27', '2027-01-02'], '2026-12-27'],
    ['Sun Jan 3, 2027', '2027-01-03', ['2027-01-03', '2027-01-09'], '2027-01-03'],
  ])('%s: Sunday to Saturday, due from Sunday', (_name, today, period, due) => {
    expect(status(withCadence(data(), 'weekly'), today)).toEqual({ period, due: true, nextDue: due });
  });

  it('after completing, the next is due the following Sunday', () => {
    const d = unwrap(ops.completeReview(withCadence(data(), 'weekly'), clockAt('2026-12-30')));
    expect(status(d, '2026-12-30')).toEqual({ period: ['2026-12-27', '2027-01-02'], due: false, nextDue: '2027-01-03' });
    expect(status(d, '2027-01-03').due).toBe(true);
  });
});

describe('monthly look-ahead', () => {
  it.each([
    ['2026-10-15', ['2026-10-01', '2026-10-31']],
    ['2026-11-30', ['2026-11-01', '2026-11-30']],
    ['2027-02-14', ['2027-02-01', '2027-02-28']],
    ['2028-02-29', ['2028-02-01', '2028-02-29']],
    ['2026-12-31', ['2026-12-01', '2026-12-31']],
  ])('%s: the calendar month', (today, period) => {
    expect(status(withCadence(data(), 'monthly'), today)).toMatchObject({ period, due: true });
  });

  it('completed in December, next due January 1', () => {
    const d = unwrap(ops.completeReview(withCadence(data(), 'monthly'), clockAt('2026-12-05')));
    expect(status(d, '2026-12-31')).toEqual({ period: ['2026-12-01', '2026-12-31'], due: false, nextDue: '2027-01-01' });
    expect(status(d, '2027-01-01')).toEqual({ period: ['2027-01-01', '2027-01-31'], due: true, nextDue: '2027-01-01' });
  });
});

describe('payday', () => {
  it('runs from the main paycheck to the day before the next one; the weekly side job doesn’t start reviews', () => {
    const d = withCadence(data(), 'payday');
    // Before the first payday there is nothing to review yet.
    expect(status(d, '2026-10-14')).toEqual({ period: null, due: false, nextDue: '2026-10-15' });
    expect(status(d, '2026-10-15')).toEqual({ period: ['2026-10-15', '2026-10-28'], due: true, nextDue: '2026-10-15' });
    // Fri Oct 16 and 23 are side-job paydays: still the same review.
    expect(status(d, '2026-10-23')).toEqual({ period: ['2026-10-15', '2026-10-28'], due: true, nextDue: '2026-10-15' });
    expect(status(d, '2026-10-29').period).toEqual(['2026-10-29', '2026-11-11']);
  });

  it('follows a weekly main paycheck', () => {
    let d = source(ops.emptyData(), SETUP, 'income', 'Wages', 600, '2026-10-16', { type: 'weekly' }, 'wages');
    d = withCadence(d, 'payday');
    expect(status(d, '2026-10-20')).toEqual({ period: ['2026-10-16', '2026-10-22'], due: true, nextDue: '2026-10-16' });
    d = unwrap(ops.completeReview(d, clockAt('2026-10-20')));
    expect(status(d, '2026-10-22')).toEqual({ period: ['2026-10-16', '2026-10-22'], due: false, nextDue: '2026-10-23' });
    expect(status(d, '2026-10-23').due).toBe(true);
  });

  it('switching the main paycheck switches the paydays', () => {
    let d = withCadence(data(), 'payday');
    d = unwrap(ops.setMainPaycheck(d, 'side', clockAt('2026-10-20')));
    // Side job is weekly on Fridays: Oct 16, 23, …
    expect(status(d, '2026-10-20')).toEqual({ period: ['2026-10-16', '2026-10-22'], due: true, nextDue: '2026-10-16' });
  });

  it('uses the actual date of a paycheck that came late', () => {
    let d = withCadence(data(), 'payday');
    d = unwrap(ops.recordActual(d, 'pay@2026-10-15', { amountCents: usd(1800), date: '2026-10-16' }, clockAt('2026-10-16')));
    expect(status(d, '2026-10-16').period).toEqual(['2026-10-16', '2026-10-28']);
  });

  it('with no income there is no payday review, and no error', () => {
    const d = withCadence(source(ops.emptyData(), SETUP, 'bill', 'Rent', 1200, '2026-11-01'), 'payday');
    expect(status(d, '2026-11-05')).toEqual({ period: null, due: false, nextDue: null });
    expectError(ops.completeReview(d, clockAt('2026-11-05')), /no review due/);
  });
});

describe('completing and skipping', () => {
  it('completing clears the review until the next period, and changes nothing else', () => {
    const before = withCadence(data(), 'weekly');
    const d = unwrap(ops.completeReview(before, clockAt('2026-10-14')));
    expect(d.review).toEqual({ cadence: 'weekly', handledOn: '2026-10-14', outcome: 'completed' });
    expect({ ...d, review: undefined }).toEqual({ ...before, review: undefined });
    expect(status(d, '2026-10-17').due).toBe(false);
    expectError(ops.completeReview(d, clockAt('2026-10-15')), /no review due/);
  });

  it('skipping clears it the same way and is remembered as skipped', () => {
    const d = unwrap(ops.skipReview(withCadence(data(), 'weekly'), clockAt('2026-10-14')));
    expect(d.review).toEqual({ cadence: 'weekly', handledOn: '2026-10-14', outcome: 'skipped' });
    expect(status(d, '2026-10-17').due).toBe(false);
    expect(status(d, '2026-10-18').due).toBe(true);
  });

  it('weeks away from the app leave one review due, never a backlog', () => {
    const d = unwrap(ops.completeReview(withCadence(data(), 'weekly'), clockAt('2026-10-14')));
    // Five weeks later: only the current week is due; completing it clears everything.
    expect(status(d, '2026-11-20')).toEqual({ period: ['2026-11-15', '2026-11-21'], due: true, nextDue: '2026-11-15' });
    const caughtUp = unwrap(ops.completeReview(d, clockAt('2026-11-20')));
    expect(status(caughtUp, '2026-11-21').due).toBe(false);
    expectError(ops.completeReview(caughtUp, clockAt('2026-11-21')), /no review due/);
  });

  it('changing the rhythm keeps the latest review, so it isn’t asked for again right away', () => {
    let d = unwrap(ops.completeReview(withCadence(data(), 'weekly'), clockAt('2026-10-14')));
    d = withCadence(d, 'monthly');
    expect(status(d, '2026-10-20')).toEqual({ period: ['2026-10-01', '2026-10-31'], due: false, nextDue: '2026-11-01' });
    expectError(ops.setReviewCadence(d, 'daily' as ReviewCadence), /how often/);
  });
});

describe('dates are calendar days, whatever the time zone', () => {
  it('the weekly period around the end of daylight saving (Sun Nov 1, 2026) is the same in every zone', () => {
    const original = process.env.TZ;
    const results = new Set<string>();
    for (const tz of ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney', 'UTC']) {
      process.env.TZ = tz;
      // 00:30 local on Nov 1: still Sunday Nov 1 on the local calendar.
      const today = todayLocal(new Date(2026, 10, 1, 0, 30));
      const d = withCadence(data(), 'weekly');
      results.add(JSON.stringify([today, status(d, today), reviewPeriod('weekly', '2026-10-31', buildForecast(d, '2026-10-31')).period]));
    }
    process.env.TZ = original;
    expect([...results]).toEqual([JSON.stringify(['2026-11-01', { period: ['2026-11-01', '2026-11-07'], due: true, nextDue: '2026-11-01' }, { start: '2026-10-25', end: '2026-10-31' }])]);
  });
});

describe('the review summary', () => {
  it('comes from the forecast: expected and recorded kept apart, overdue items, cash flow and gaps', () => {
    // Fri Oct 23, weekly review of Oct 18 – 24. The Oct 16 side job was received; the Oct 15 paycheck is still unrecorded.
    const today = '2026-10-23';
    let d = withCadence(data(), 'weekly');
    d = unwrap(ops.recordActual(d, 'side@2026-10-16', { amountCents: usd(200), date: '2026-10-16' }, clockAt('2026-10-16')));
    d = unwrap(ops.recordActual(d, 'side@2026-10-23', { amountCents: usd(210), date: today }, clockAt(today)));
    const s = reviewStatus(d, today);
    const f = buildForecast(d, today, { through: s.period!.end });
    const sum = reviewSummary(f, s.period!);
    const rows = (es: { occurrence: { description: string }; date: string; amountCents: number }[]) => es.map((e) => [e.occurrence.description, e.date, e.amountCents / 100]);
    expect(rows(sum.expectedIncome)).toEqual([]);
    expect(rows(sum.recorded)).toEqual([['Side job', '2026-10-23', 210]]);
    // Overdue is listed whatever its date; it is expected, not assumed paid.
    expect(rows(sum.overdue)).toEqual([['Paycheck', '2026-10-15', 1800]]);
    expect(sum.overdue[0]!.occurrence.status).toBe('scheduled');
    expect(sum.cashFlow).toEqual(periodKpis(f, '2026-10-18', '2026-10-24'));
    expect(sum.cashFlow).toEqual({ incomeCents: usd(210), outflowCents: 0, netCents: usd(210) });
    expect(sum.gaps).toEqual([]);
  });

  it('for a month: every expected item in it, with cash flow and any timing gap', () => {
    // By Nov 1: $1,800 + 3 × $200 − $60 + $1,800 − $1,200 = $2,940. A $3,000 repair on Nov 3 → −$60 until Fri Nov 6 (+$200).
    let d = withCadence(data(), 'monthly');
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Car repair', amountCents: usd(3000), date: '2026-11-03' }, clockAt(SETUP), 'repair'));
    const today = '2026-11-01';
    const s = reviewStatus(d, today);
    const f = buildForecast(d, today, { through: s.period!.end });
    const sum = reviewSummary(f, s.period!);
    const rows = (es: { occurrence: { description: string }; date: string; amountCents: number }[]) => es.map((e) => [e.occurrence.description, e.date, e.amountCents / 100]);
    expect(rows(sum.expectedOutflows)).toEqual([
      ['Rent', '2026-11-01', 1200],
      ['Car repair', '2026-11-03', 3000],
      ['Phone', '2026-11-25', 60],
    ]);
    // Paychecks Nov 12, 26; side job every Friday: Nov 6, 13, 20, 27.
    expect(sum.expectedIncome.map((e) => e.amountCents / 100)).toEqual([200, 1800, 200, 200, 1800, 200]);
    expect(sum.cashFlow).toEqual({ incomeCents: usd(4400), outflowCents: usd(4260), netCents: usd(140) });
    expect(sum.gaps.map((g) => [g.start, g.end, g.lowestCents / 100])).toEqual([['2026-11-03', '2026-11-05', -60]]);
    expect(tallyOn(f, '2026-11-03')).toBe(usd(-60));
  });

  it('never changes the stored data', () => {
    const d = withCadence(data(), 'monthly');
    const snapshot = JSON.stringify(d);
    const s = reviewStatus(d, '2026-11-01');
    reviewSummary(buildForecast(d, '2026-11-01', { through: s.period!.end }), s.period!);
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});
