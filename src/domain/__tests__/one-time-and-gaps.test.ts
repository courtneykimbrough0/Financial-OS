import { describe, expect, it } from 'vitest';
import { buildForecast, dailyTimeline, entriesInRange, monthWeekSummaries, paycheckCycles, periodKpis, tallyOn, timingGapsAhead } from '../forecast';
import * as ops from '../operations';
import { periodPlan } from '../plan';
import { clockAt, source, unwrap, usd } from './helpers';

const TODAY = '2026-10-11';

describe('one-time income and expenses across every view', () => {
  /*
   * Paycheck $1,800 every 2 weeks from Thu Oct 15; phone $60 monthly on the 25th.
   * One-time: gift +$500 on Oct 22, repair −$300 on Oct 27.
   */
  function data() {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, 'phone');
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Gift', amountCents: usd(500), date: '2026-10-22' }, clockAt(TODAY), 'gift'));
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Repair', amountCents: usd(300), date: '2026-10-27' }, clockAt(TODAY), 'repair'));
    return d;
  }

  it('each occurs exactly once, on its date, and never repeats', () => {
    const f = buildForecast(data(), TODAY, { through: '2028-12-31' });
    expect(f.entries.filter((e) => e.occurrence.id === 'gift').map((e) => e.date)).toEqual(['2026-10-22']);
    expect(f.entries.filter((e) => e.occurrence.id === 'repair').map((e) => e.date)).toEqual(['2026-10-27']);
  });

  it('moves the running tally on its day and every day after', () => {
    const f = buildForecast(data(), TODAY);
    expect(tallyOn(f, '2026-10-21')).toBe(usd(1800));
    expect(tallyOn(f, '2026-10-22')).toBe(usd(2300));
    expect(tallyOn(f, '2026-10-25')).toBe(usd(2240));
    expect(tallyOn(f, '2026-10-27')).toBe(usd(1940));
    // Paydays Oct 29, Nov 12, Nov 26; phone Nov 25.
    expect(tallyOn(f, '2026-11-30')).toBe(usd(1940 + 1800 * 3 - 60));
  });

  it('counts in month, week, pay period, and custom views, only where its date falls', () => {
    const f = buildForecast(data(), TODAY);
    // Month
    expect(periodKpis(f, '2026-10-01', '2026-10-31')).toEqual({ incomeCents: usd(4100), outflowCents: usd(360), netCents: usd(3740) });
    expect(periodKpis(f, '2026-11-01', '2026-11-30')).toEqual({ incomeCents: usd(3600), outflowCents: usd(60), netCents: usd(3540) });
    // Weeks (Sunday–Saturday) and the month's weekly summaries
    expect(periodKpis(f, '2026-10-18', '2026-10-24')).toEqual({ incomeCents: usd(500), outflowCents: 0, netCents: usd(500) });
    expect(periodKpis(f, '2026-10-25', '2026-10-31')).toEqual({ incomeCents: usd(1800), outflowCents: usd(360), netCents: usd(1440) });
    const weeks = monthWeekSummaries(f, '2026-10-01');
    expect(weeks.reduce((s, w) => s + w.netCents, 0)).toBe(usd(3740));
    // Pay periods: the one-time gift counts inside the period but does not start a new one.
    const cycles = paycheckCycles(f, 2);
    expect(cycles.map((c) => [c.start, c.end])).toEqual([
      ['2026-10-15', '2026-10-28'],
      ['2026-10-29', '2026-11-11'],
    ]);
    expect(periodKpis(f, cycles[0]!.start, cycles[0]!.end)).toEqual({ incomeCents: usd(2300), outflowCents: usd(360), netCents: usd(1940) });
    expect(periodKpis(f, cycles[1]!.start, cycles[1]!.end)).toEqual({ incomeCents: usd(1800), outflowCents: 0, netCents: usd(1800) });
    // Custom range starting mid-forecast carries the tally including the gift.
    expect(dailyTimeline(f, '2026-10-23', '2026-10-30')[0]!.tallyCents).toBe(usd(2300));
  });

  it('follows a reschedule or recorded outcome to the new date only', () => {
    let d = unwrap(ops.rescheduleOccurrence(data(), 'gift', { date: '2026-11-03', amountCents: usd(500) }, clockAt(TODAY)));
    let f = buildForecast(d, TODAY);
    expect(entriesInRange(f, '2026-10-22', '2026-10-22')).toHaveLength(0);
    expect(periodKpis(f, '2026-10-01', '2026-10-31').incomeCents).toBe(usd(3600));
    expect(periodKpis(f, '2026-11-01', '2026-11-30').incomeCents).toBe(usd(4100));
    d = unwrap(ops.recordActual(d, 'repair', { amountCents: usd(350), date: '2026-10-26' }, clockAt('2026-10-26')));
    f = buildForecast(d, '2026-10-26');
    expect(entriesInRange(f, '2026-10-26', '2026-10-26').map((e) => e.amountCents)).toEqual([usd(350)]);
    expect(entriesInRange(f, '2026-10-27', '2026-10-27')).toHaveLength(0);
  });

  it('counts in left to spend for the period it falls in', () => {
    const f = buildForecast(data(), TODAY);
    expect(periodPlan(f, '2026-10-15', '2026-10-28')).toMatchObject({ incomeCents: usd(2300), expensesCents: usd(360), leftToSpendCents: usd(1940) });
    expect(periodPlan(f, '2026-10-29', '2026-11-11')).toMatchObject({ incomeCents: usd(1800), expensesCents: 0, leftToSpendCents: usd(1800) });
  });

  it('can create a timing gap', () => {
    const d = unwrap(ops.addOneTime(data(), { kind: 'bill', description: 'Medical bill', amountCents: usd(2500), date: '2026-10-20' }, clockAt(TODAY)));
    expect(timingGapsAhead(buildForecast(d, TODAY))).toEqual([{ start: '2026-10-20', end: '2026-10-28', days: 9, lowestCents: usd(-700), lowestDate: '2026-10-20' }]);
  });
});

describe('timing gaps ahead', () => {
  it('lists every stretch below $0 in the next 90 days', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 1600, '2026-10-20', { type: 'monthly' }, 'rent');
    expect(timingGapsAhead(buildForecast(d, TODAY))).toEqual([
      { start: '2026-10-20', end: '2026-10-28', days: 9, lowestCents: usd(-600), lowestDate: '2026-10-20' },
      { start: '2026-11-20', end: '2026-11-25', days: 6, lowestCents: usd(-200), lowestDate: '2026-11-20' },
    ]);
  });

  it('is empty when the tally never goes below $0, or there is no forecast yet', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
    expect(timingGapsAhead(buildForecast(d, TODAY))).toEqual([]);
    const noIncome = source(ops.emptyData(), TODAY, 'bill', 'Rent', 1200, '2026-11-01');
    expect(timingGapsAhead(buildForecast(noIncome, TODAY))).toEqual([]);
  });

  it('treats exactly $0 as not a gap', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'monthly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 1000, '2026-10-16', { type: 'monthly' }, 'rent');
    expect(timingGapsAhead(buildForecast(d, TODAY))).toEqual([]);
  });
});
