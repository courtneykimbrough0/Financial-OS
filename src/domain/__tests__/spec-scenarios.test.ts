/**
 * The automated test scenarios A–M from the build specification (§19),
 * one describe block per scenario.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageAdapter } from '../../state/storage';
import { addDays, eachDay, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from '../dates';
import {
  buildForecast,
  dailyTimeline,
  entriesInRange,
  monthWeekSummaries,
  negativeStretches,
  overdueEntries,
  paycheckCycles,
  periodKpis,
  tallyOn,
  totals,
  type Forecast,
} from '../forecast';
import { findOccurrence } from '../occurrences';
import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

const occ = (sourceId: string, date: string) => `${sourceId}@${date}`;

/** [date, net dollars, tally dollars] for days with counted activity. */
function activity(f: Forecast, start: string, end: string) {
  return dailyTimeline(f, start, end)
    .filter((r) => r.entries.some((e) => e.counts))
    .map((r) => [r.date, r.netCents / 100, r.tallyCents === null ? null : r.tallyCents / 100]);
}

describe('A. Basic projection', () => {
  // Income $2,000 on the 15th, rent $1,200 on the 1st, another expense $100 on the 5th.
  const today = '2026-11-01';
  function data() {
    let d = ops.emptyData();
    d = source(d, today, 'income', 'Paycheck', 2000, '2026-11-15', { type: 'monthly' }, 'pay');
    d = source(d, today, 'expense', 'Rent', 1200, '2026-12-01', { type: 'monthly' }, 'rent');
    d = source(d, today, 'expense', 'Internet', 100, '2026-11-05', { type: 'monthly' }, 'net');
    return d;
  }

  it('places transactions on their dates and computes daily changes and the running tally from the anchor', () => {
    const f = buildForecast(data(), today);
    expect(f.anchor).toBe('2026-11-14');
    expect(activity(f, '2026-11-01', '2027-01-15')).toEqual([
      ['2026-11-05', -100, null], // before the anchor: shown, not in the tally
      ['2026-11-15', 2000, 2000],
      ['2026-12-01', -1200, 800],
      ['2026-12-05', -100, 700],
      ['2026-12-15', 2000, 2700],
      ['2027-01-01', -1200, 1500],
      ['2027-01-05', -100, 1400],
      ['2027-01-15', 2000, 3400],
    ]);
  });

  it('computes period totals', () => {
    const f = buildForecast(data(), today);
    expect(periodKpis(f, '2026-11-15', '2026-12-14')).toEqual({ incomeCents: usd(2000), outflowCents: usd(1300), netCents: usd(700) });
    expect(periodKpis(f, '2026-11-01', '2026-11-30')).toEqual({ incomeCents: usd(2000), outflowCents: usd(100), netCents: usd(1900) });
    expect(periodKpis(f, '2026-12-01', '2026-12-31')).toEqual({ incomeCents: usd(2000), outflowCents: usd(1300), netCents: usd(700) });
  });
});

describe('B. Timing gap', () => {
  it('goes negative when an expense comes before the next paycheck, then recovers', () => {
    const today = '2026-11-01';
    let d = ops.emptyData();
    d = source(d, today, 'income', 'Paycheck', 1000, '2026-11-06', { type: 'biweekly' }, 'pay');
    d = source(d, today, 'expense', 'Rent', 1500, '2026-11-10', { type: 'monthly' }, 'rent');
    const f = buildForecast(d, today);
    expect(activity(f, '2026-11-01', '2026-11-30')).toEqual([
      ['2026-11-06', 1000, 1000],
      ['2026-11-10', -1500, -500],
      ['2026-11-20', 1000, 500],
    ]);
    expect(negativeStretches(dailyTimeline(f, '2026-11-01', '2026-11-30'))).toEqual([{ start: '2026-11-10', end: '2026-11-19', lowestCents: usd(-500) }]);
  });
});

describe('C. Actual income differs from expectation', () => {
  it('$1,800 expected on the 15th, $1,650 received on the 16th', () => {
    const setup = '2026-11-01';
    let d = source(ops.emptyData(), setup, 'income', 'Paycheck', 1800, '2026-11-15', { type: 'biweekly' }, 'pay');
    d = source(d, setup, 'expense', 'Groceries', 100, '2026-11-20', { type: 'weekly' }, 'food');
    d = unwrap(ops.recordActual(d, occ('pay', '2026-11-15'), { amountCents: usd(1650), date: '2026-11-16' }, clockAt('2026-11-16')));
    const f = buildForecast(d, '2026-11-16');

    const matches = f.entries.filter((e) => e.occurrence.id === occ('pay', '2026-11-15'));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ date: '2026-11-16', amountCents: usd(1650) });
    expect(matches[0]!.occurrence).toMatchObject({ expectedDate: '2026-11-15', expectedAmountCents: usd(1800), actualDate: '2026-11-16', actualAmountCents: usd(1650), status: 'completed' });
    expect(entriesInRange(f, '2026-11-15', '2026-11-15')).toHaveLength(0);

    const future = f.entries.filter((e) => e.occurrence.sourceId === 'pay' && e.occurrence.status === 'scheduled').slice(0, 3);
    expect(future.map((e) => [e.date, e.amountCents])).toEqual([
      ['2026-11-29', usd(1800)],
      ['2026-12-13', usd(1800)],
      ['2026-12-27', usd(1800)],
    ]);
    expect(activity(f, '2026-11-16', '2026-11-29')).toEqual([
      ['2026-11-16', 1650, 1650],
      ['2026-11-20', -100, 1550],
      ['2026-11-27', -100, 1450],
      ['2026-11-29', 1800, 3250],
    ]);
  });
});

describe('D. Actual expense differs from expectation', () => {
  it('$200 expected on the 10th, $240 paid on the 12th', () => {
    const setup = '2026-10-31';
    let d = source(ops.emptyData(), setup, 'income', 'Paycheck', 2000, '2026-11-01', { type: 'monthly' }, 'pay');
    d = source(d, setup, 'expense', 'Insurance', 200, '2026-11-10', { type: 'monthly' }, 'ins');
    const today = '2026-11-12';
    // Before recording: overdue on the 10th.
    let f = buildForecast(d, today);
    expect(overdueEntries(f).map((e) => e.occurrence.id)).toContain(occ('ins', '2026-11-10'));

    d = unwrap(ops.recordActual(d, occ('ins', '2026-11-10'), { amountCents: usd(240), date: '2026-11-12' }, clockAt(today)));
    f = buildForecast(d, today);
    // The paycheck is still unrecorded (overdue), so the anchor stays at Oct 31.
    expect(f.anchor).toBe('2026-10-31');
    expect(activity(f, '2026-11-01', '2026-12-10')).toEqual([
      ['2026-11-01', 2000, 2000],
      ['2026-11-12', -240, 1760],
      ['2026-12-01', 2000, 3760],
      ['2026-12-10', -200, 3560],
    ]);
    expect(overdueEntries(f).map((e) => e.occurrence.id)).not.toContain(occ('ins', '2026-11-10'));
    expect(f.entries.filter((e) => e.occurrence.id === occ('ins', '2026-11-10'))).toHaveLength(1);
  });
});

describe('E. Late liability payment', () => {
  it('is overdue before completion, lands on the actual date after, and is never duplicated', () => {
    const setup = '2026-11-01';
    let d = source(ops.emptyData(), setup, 'income', 'Paycheck', 1500, '2026-11-02', { type: 'biweekly' }, 'pay');
    d = source(d, setup, 'liability', 'Student loan', 300, '2026-11-05', { type: 'monthly' }, 'loan');
    d = unwrap(ops.recordActual(d, occ('pay', '2026-11-02'), { amountCents: usd(1500), date: '2026-11-02' }, clockAt('2026-11-02')));

    let f = buildForecast(d, '2026-11-06');
    const before = f.entries.find((e) => e.occurrence.id === occ('loan', '2026-11-05'))!;
    expect(before.occurrence.displayStatus).toBe('overdue');
    expect(overdueEntries(f)).toHaveLength(1);

    d = unwrap(ops.recordActual(d, occ('loan', '2026-11-05'), { amountCents: usd(300), date: '2026-11-08' }, clockAt('2026-11-08')));
    f = buildForecast(d, '2026-11-08');
    const loan = f.entries.filter((e) => e.occurrence.sourceId === 'loan' && e.date <= '2026-12-31');
    expect(loan.map((e) => [e.date, e.occurrence.status, e.occurrence.expectedDate])).toEqual([
      ['2026-11-08', 'completed', '2026-11-05'],
      ['2026-12-05', 'scheduled', '2026-12-05'],
    ]);
    expect(entriesInRange(f, '2026-11-05', '2026-11-05')).toHaveLength(0);
    expect(overdueEntries(f)).toHaveLength(0);
  });
});

describe('F. Recurring schedule change', () => {
  it('$100 becomes $120 from a chosen future occurrence; completed records stay as they were', () => {
    const setup = '2026-11-01';
    let d = source(ops.emptyData(), setup, 'income', 'Paycheck', 2000, '2026-11-01', { type: 'monthly' }, 'pay');
    d = source(d, setup, 'expense', 'Gym', 100, '2026-11-10', { type: 'monthly' }, 'gym');
    d = unwrap(ops.recordActual(d, occ('gym', '2026-11-10'), { amountCents: usd(100), date: '2026-11-10' }, clockAt('2026-11-11')));
    const completedBefore = d.records.find((r) => r.id === occ('gym', '2026-11-10'));

    d = unwrap(ops.changeSourceSchedule(d, 'gym', { startDate: '2027-01-10', amountCents: usd(120), rule: { type: 'monthly' } }, clockAt('2026-11-11')));
    const f = buildForecast(d, '2026-11-11');
    const gym = f.entries.filter((e) => e.occurrence.sourceId === 'gym' && e.date <= '2027-03-31');
    expect(gym.map((e) => [e.date, e.amountCents / 100, e.occurrence.status])).toEqual([
      ['2026-11-10', 100, 'completed'],
      ['2026-12-10', 100, 'scheduled'],
      ['2027-01-10', 120, 'scheduled'],
      ['2027-02-10', 120, 'scheduled'],
      ['2027-03-10', 120, 'scheduled'],
    ]);
    expect(d.records.find((r) => r.id === occ('gym', '2026-11-10'))).toEqual(completedBefore);
  });
});

describe('G. One-time transaction', () => {
  it('a one-time $350 expense happens exactly once', () => {
    const today = '2026-11-01';
    let d = source(ops.emptyData(), today, 'income', 'Paycheck', 2000, '2026-11-05', { type: 'biweekly' }, 'pay');
    d = unwrap(ops.addOneTime(d, { kind: 'expense', description: 'Concert tickets', amountCents: usd(350), date: '2026-11-21' }, clockAt(today), 'tickets'));
    const f = buildForecast(d, today, { through: '2028-12-31' });
    const hits = f.entries.filter((e) => e.occurrence.description === 'Concert tickets');
    expect(hits.map((e) => [e.date, e.amountCents])).toEqual([['2026-11-21', usd(350)]]);
    for (let m = '2026-12-01'; m <= '2028-12-01'; m = addDays(endOfMonth(m), 1)) {
      expect(periodKpis(f, startOfMonth(m), endOfMonth(m)).outflowCents).toBe(0);
    }
  });
});

describe('H. Overdue transaction rescheduling', () => {
  it('moves the unpaid expense to the new date only, counted once', () => {
    const setup = '2026-11-01';
    let d = source(ops.emptyData(), setup, 'income', 'Paycheck', 2000, '2026-11-01', { type: 'monthly' }, 'pay');
    d = source(d, setup, 'expense', 'Water bill', 80, '2026-11-05', { type: 'monthly' }, 'water');
    const today = '2026-11-07';
    expect(overdueEntries(buildForecast(d, today)).map((e) => e.occurrence.id)).toContain(occ('water', '2026-11-05'));

    d = unwrap(ops.rescheduleOccurrence(d, occ('water', '2026-11-05'), { date: '2026-11-20', amountCents: usd(80) }, clockAt(today)));
    const f = buildForecast(d, today);
    expect(entriesInRange(f, '2026-11-05', '2026-11-05')).toHaveLength(0);
    expect(entriesInRange(f, '2026-11-20', '2026-11-20').map((e) => [e.occurrence.id, e.occurrence.displayStatus])).toEqual([[occ('water', '2026-11-05'), 'scheduled']]);
    expect(f.entries.filter((e) => e.occurrence.id === occ('water', '2026-11-05'))).toHaveLength(1);
    expect(overdueEntries(f).some((e) => e.occurrence.sourceId === 'water')).toBe(false);
    expect(periodKpis(f, '2026-11-01', '2026-11-30').outflowCents).toBe(usd(80));
    expect(findOccurrence(d, occ('water', '2026-11-05'), today)!.expectedDate).toBe('2026-11-05');
  });
});

describe('I. Canceled transaction', () => {
  it('stops affecting the forecast and is recorded as canceled, not completed', () => {
    const today = '2026-11-01';
    let d = source(ops.emptyData(), today, 'income', 'Paycheck', 2000, '2026-11-02', { type: 'monthly' }, 'pay');
    d = source(d, today, 'expense', 'Streaming', 15, '2026-11-12', { type: 'monthly' }, 'tv');
    d = unwrap(ops.cancelOccurrence(d, occ('tv', '2026-11-12'), 'Paused this month', clockAt(today)));
    const f = buildForecast(d, today);
    const canceled = f.entries.find((e) => e.occurrence.id === occ('tv', '2026-11-12'))!;
    expect(canceled.counts).toBe(false);
    expect(canceled.occurrence).toMatchObject({ status: 'canceled', actualAmountCents: null, actualDate: null, completedAt: null, cancelNote: 'Paused this month' });
    expect(canceled.occurrence.canceledAt).not.toBeNull();
    expect(periodKpis(f, '2026-11-01', '2026-11-30').outflowCents).toBe(0);
    expect(tallyOn(f, '2026-11-30')).toBe(usd(2000));
    expect(periodKpis(f, '2026-12-01', '2026-12-31').outflowCents).toBe(usd(15));
    expectError(ops.recordActual(d, occ('tv', '2026-11-12'), { amountCents: usd(15), date: today }, clockAt(today)), /canceled/);
  });
});

/** A busier dataset for consistency checks: several kinds, a recorded outcome, a cancel, a reschedule. */
function richData(): { d: AppData; today: string } {
  const setup = '2026-11-01';
  let d = ops.emptyData();
  d = source(d, setup, 'income', 'Paycheck', 1800, '2026-11-06', { type: 'biweekly' }, 'pay');
  d = source(d, setup, 'income', 'Benefits', 450, '2026-11-03', { type: 'monthly' }, 'ben');
  d = source(d, setup, 'expense', 'Rent', 1400, '2026-11-01', { type: 'monthly' }, 'rent');
  d = source(d, setup, 'expense', 'Groceries', 120.55, '2026-11-02', { type: 'weekly' }, 'food');
  d = source(d, setup, 'liability', 'Card payment', 75.1, '2026-11-15', { type: 'twiceMonthly', days: [15, 31] }, 'card');
  d = unwrap(ops.addOneTime(d, { kind: 'expense', description: 'Repair', amountCents: usd(350), date: '2026-11-18' }, clockAt(setup)));
  const today = '2026-11-07';
  d = unwrap(ops.recordActual(d, occ('pay', '2026-11-06'), { amountCents: usd(1712.34), date: '2026-11-07' }, clockAt(today)));
  d = unwrap(ops.cancelOccurrence(d, occ('food', '2026-11-23'), '', clockAt(today)));
  d = unwrap(ops.rescheduleOccurrence(d, occ('rent', '2026-12-01'), { date: '2026-12-03', amountCents: usd(1400) }, clockAt(today)));
  return { d, today };
}

describe('J. Dashboard consistency', () => {
  it('daily totals, weekly summaries, monthly totals, KPIs, and tallies agree', () => {
    const { d, today } = richData();
    const f = buildForecast(d, today);
    for (const month of ['2026-11-01', '2026-12-01', '2027-01-01']) {
      const days = dailyTimeline(f, startOfMonth(month), endOfMonth(month));
      const weeks = monthWeekSummaries(f, month);
      const kpis = periodKpis(f, startOfMonth(month), endOfMonth(month));
      const sum = (k: 'inCents' | 'outCents' | 'netCents') => days.reduce((s, r) => s + r[k], 0);
      expect(sum('inCents')).toBe(kpis.incomeCents);
      expect(sum('outCents')).toBe(kpis.outflowCents);
      expect(weeks.reduce((s, w) => s + w.incomeCents, 0)).toBe(kpis.incomeCents);
      expect(weeks.reduce((s, w) => s + w.outflowCents, 0)).toBe(kpis.outflowCents);
      expect(weeks.reduce((s, w) => s + w.netCents, 0)).toBe(kpis.netCents);
      for (const w of weeks) {
        expect(periodKpis(f, w.start, w.end)).toEqual({ incomeCents: w.incomeCents, outflowCents: w.outflowCents, netCents: w.netCents });
        expect(w.days.map((r) => r.date)).toEqual(eachDay(w.start, w.end));
      }
      // Daily rows agree with the entries they list.
      for (const r of days) expect(totals(r.entries)).toEqual({ inCents: r.inCents, outCents: r.outCents, netCents: r.netCents });
    }
    // The tally equals the cumulative sum of daily nets from the anchor.
    const all = dailyTimeline(f, f.forecastStart!, '2027-01-31');
    let running = 0;
    for (const r of all) {
      running += r.netCents;
      expect(r.tallyCents).toBe(running);
    }
    // Every counted entry appears in exactly one day.
    const ids = all.flatMap((r) => r.entries.map((e) => e.occurrence.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('K. View changes', () => {
  it('month, week, paycheck, and custom views share one anchor and never reset the tally', () => {
    const { d, today } = richData();
    const f = buildForecast(d, today);
    const reference = new Map(dailyTimeline(f, f.forecastStart!, '2027-02-28').map((r) => [r.date, r.tallyCents]));
    const check = (rows: ReturnType<typeof dailyTimeline>) => {
      for (const r of rows) if (r.date >= f.forecastStart!) expect(r.tallyCents).toBe(reference.get(r.date));
    };
    for (const date of ['2026-11-20', '2026-12-09', '2027-01-17', '2027-02-14']) {
      check(dailyTimeline(f, startOfMonth(date), endOfMonth(date)));
      check(dailyTimeline(f, startOfWeek(date), endOfWeek(date)));
      check(dailyTimeline(f, date, addDays(date, 9)));
    }
    const cycles = paycheckCycles(f);
    expect(cycles.length).toBeGreaterThan(4);
    for (const c of cycles) check(dailyTimeline(f, c.start, c.end));
    // A later cycle opens with the carried-over tally, not $0 plus its payday.
    const later = cycles[3]!;
    const firstRow = dailyTimeline(f, later.start, later.end)[0]!;
    expect(firstRow.tallyCents).not.toBe(firstRow.netCents);
    // Rebuilding with a longer horizon (as a far-off custom range does) keeps the same anchor and values.
    const far = buildForecast(d, today, { through: '2028-06-30' });
    expect(far.anchor).toBe(f.anchor);
    check(dailyTimeline(far, f.forecastStart!, '2027-02-28'));
  });
});

describe('L. Date and recurrence boundaries', () => {
  it('month-end and leap-year dates', () => {
    const today = '2028-01-01';
    let d = source(ops.emptyData(), today, 'income', 'Paycheck', 1000, '2028-01-31', { type: 'monthly' }, 'pay');
    d = source(d, today, 'expense', 'Rent', 500, '2028-01-30', { type: 'monthly' }, 'rent');
    const f = buildForecast(d, today);
    const pays = f.entries.filter((e) => e.occurrence.sourceId === 'pay' && e.date <= '2028-05-31').map((e) => e.date);
    expect(pays).toEqual(['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31']);
    // Rent (30th) and pay (31st→29th) land on the same day in February.
    const feb29 = dailyTimeline(f, '2028-02-29', '2028-02-29')[0]!;
    expect([feb29.inCents, feb29.outCents, feb29.netCents]).toEqual([usd(1000), usd(500), usd(500)]);
  });

  it('several income schedules and transactions on the same date', () => {
    const today = '2026-11-01';
    let d = source(ops.emptyData(), today, 'income', 'Job A', 900, '2026-11-13', { type: 'biweekly' }, 'a');
    d = source(d, today, 'income', 'Job B', 400, '2026-11-13', { type: 'weekly' }, 'b');
    d = source(d, today, 'expense', 'Car insurance', 150, '2026-11-13', { type: 'monthly' }, 'ins');
    const f = buildForecast(d, today);
    expect(f.anchor).toBe('2026-11-12');
    const row = dailyTimeline(f, '2026-11-13', '2026-11-13')[0]!;
    expect(row.entries.map((e) => e.occurrence.description)).toEqual(['Job A', 'Job B', 'Car insurance']);
    expect(row.netCents).toBe(usd(1150));
    // Cycles from both schedules merge into weekly boundaries.
    expect(paycheckCycles(f, 3).map((c) => [c.start, c.end])).toEqual([
      ['2026-11-13', '2026-11-19'],
      ['2026-11-20', '2026-11-26'],
      ['2026-11-27', '2026-12-03'],
    ]);
  });

  it('split date ranges match the whole range with no duplicates or gaps', () => {
    const { d, today } = richData();
    const f = buildForecast(d, today);
    const whole = dailyTimeline(f, '2026-11-01', '2027-01-31');
    const parts = [
      dailyTimeline(f, '2026-11-01', '2026-11-30'),
      dailyTimeline(f, '2026-12-01', '2026-12-31'),
      dailyTimeline(f, '2027-01-01', '2027-01-31'),
    ].flat();
    const key = (rows: typeof whole) => rows.map((r) => [r.date, r.netCents, r.tallyCents, r.entries.map((e) => e.occurrence.id).join(',')]);
    expect(key(parts)).toEqual(key(whole));
  });
});

describe('M. Persistence', () => {
  beforeEach(() => localStorage.clear());

  it('schedules and recorded outcomes survive a reload without duplicating transactions', () => {
    const { d, today } = richData();
    new LocalStorageAdapter().save(d);
    const reloaded = new LocalStorageAdapter().load();
    expect(reloaded).toEqual(d);

    const before = buildForecast(d, today);
    const after = buildForecast(reloaded, today);
    const snapshot = (f: Forecast) => dailyTimeline(f, '2026-11-01', '2027-01-31').map((r) => [r.date, r.netCents, r.tallyCents]);
    expect(snapshot(after)).toEqual(snapshot(before));
    const ids = after.entries.map((e) => e.occurrence.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findOccurrence(reloaded, occ('pay', '2026-11-06'), today)).toMatchObject({ status: 'completed', actualAmountCents: usd(1712.34), expectedAmountCents: usd(1800) });

    // Reloading and saving again (as each app session does) changes nothing.
    new LocalStorageAdapter().save(reloaded);
    expect(new LocalStorageAdapter().load()).toEqual(d);
  });
});
