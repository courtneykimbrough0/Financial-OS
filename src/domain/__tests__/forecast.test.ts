import { describe, expect, it } from 'vitest';
import {
  buildForecast,
  dailyTimeline,
  entriesInRange,
  lowestPoint,
  monthWeekSummaries,
  negativeStretches,
  overdueEntries,
  paycheckCycles,
  periodKpis,
  tallyOn,
  type Forecast,
} from '../forecast';
import { findOccurrence } from '../occurrences';
import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

/*
 * Baseline scenario. 2026-10-11 is a Sunday.
 *   Paycheck   $1,800 every 2 weeks from Thu Oct 15
 *   Car loan   $350   monthly from Oct 20 (liability)
 *   Phone      $60    monthly from Oct 25
 *   Rent       $1,200 monthly from Nov 1
 */
const TODAY = '2026-10-11';
const PAY = 'income-pay';
const CAR = 'liability-car';
const PHONE = 'expense-phone';
const RENT = 'expense-rent';

function baseline(): AppData {
  let d = ops.emptyData();
  d = source(d, TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, PAY);
  d = source(d, TODAY, 'liability', 'Car loan', 350, '2026-10-20', { type: 'monthly' }, CAR);
  d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, PHONE);
  d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, RENT);
  return d;
}

const id = (sourceId: string, date: string) => `${sourceId}@${date}`;

/** Compact timeline: only days with counted activity, as [date, net, tally]. */
function activity(f: Forecast, start: string, end: string) {
  return dailyTimeline(f, start, end)
    .filter((r) => r.entries.some((e) => e.counts))
    .map((r) => [r.date, r.netCents / 100, r.tallyCents === null ? null : r.tallyCents / 100]);
}

describe('forecast anchor and running tally', () => {
  it('anchors at $0 the day before the next expected payday', () => {
    const f = buildForecast(baseline(), TODAY);
    expect(f.issue).toBeNull();
    expect(f.anchor).toBe('2026-10-14');
    expect(f.forecastStart).toBe('2026-10-15');
    expect(tallyOn(f, '2026-10-14')).toBeNull();
    expect(activity(f, '2026-10-01', '2026-11-12')).toEqual([
      ['2026-10-15', 1800, 1800],
      ['2026-10-20', -350, 1450],
      ['2026-10-25', -60, 1390],
      ['2026-10-29', 1800, 3190],
      ['2026-11-01', -1200, 1990],
      ['2026-11-12', 1800, 3790],
    ]);
  });

  it('uses the earliest upcoming date when there are several income schedules', () => {
    let d = baseline();
    d = source(d, TODAY, 'income', 'Side job', 300, '2026-10-13', { type: 'monthly' }, 'income-side');
    const f = buildForecast(d, TODAY);
    expect(f.anchor).toBe('2026-10-12');
    expect(tallyOn(f, '2026-10-13')).toBe(usd(300));
    expect(tallyOn(f, '2026-10-15')).toBe(usd(2100));
  });

  it('keeps the same anchor and tally in every view', () => {
    const f = buildForecast(baseline(), TODAY);
    const month = dailyTimeline(f, '2026-11-01', '2026-11-30').find((r) => r.date === '2026-11-05')!;
    const week = dailyTimeline(f, '2026-11-01', '2026-11-07').find((r) => r.date === '2026-11-05')!;
    const custom = dailyTimeline(f, '2026-11-05', '2026-11-05')[0]!;
    const cycle = paycheckCycles(f).find((c) => c.start <= '2026-11-05' && c.end >= '2026-11-05')!;
    const cycleRow = dailyTimeline(f, cycle.start, cycle.end).find((r) => r.date === '2026-11-05')!;
    expect(month.tallyCents).toBe(usd(1990));
    expect(week.tallyCents).toBe(usd(1990));
    expect(custom.tallyCents).toBe(usd(1990));
    expect(cycleRow.tallyCents).toBe(usd(1990));
    // Requesting a longer horizon does not change the anchor or the values.
    const longer = buildForecast(baseline(), TODAY, { through: '2028-01-01' });
    expect(longer.anchor).toBe(f.anchor);
    expect(tallyOn(longer, '2026-11-05')).toBe(usd(1990));
  });

  it('custom ranges carry the tally from the anchor instead of restarting at zero', () => {
    const f = buildForecast(baseline(), TODAY);
    const rows = dailyTimeline(f, '2026-10-26', '2026-11-05');
    expect(rows[0]!.date).toBe('2026-10-26');
    expect(rows[0]!.tallyCents).toBe(usd(1390));
    expect(rows.at(-1)!.tallyCents).toBe(usd(1990));
    expect(periodKpis(f, '2026-10-26', '2026-11-05')).toEqual({ incomeCents: usd(1800), outflowCents: usd(1200), netCents: usd(600) });
  });

  it('nets several transactions on the same day and orders them deterministically', () => {
    let d = baseline();
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Groceries', amountCents: usd(150), date: '2026-10-29' }, clockAt(TODAY), 'one-groc'));
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Gas', amountCents: usd(40), date: '2026-10-29' }, clockAt(TODAY), 'one-gas'));
    const f = buildForecast(d, TODAY);
    const row = dailyTimeline(f, '2026-10-29', '2026-10-29')[0]!;
    expect(row.inCents).toBe(usd(1800));
    expect(row.outCents).toBe(usd(190));
    expect(row.netCents).toBe(usd(1610));
    expect(row.tallyCents).toBe(usd(1390 + 1610));
    expect(row.entries.map((e) => e.occurrence.description)).toEqual(['Paycheck', 'Groceries', 'Gas']);
  });

  it('finds the lowest point and negative stretches', () => {
    let d = baseline();
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Car repair', amountCents: usd(2000), date: '2026-10-22' }, clockAt(TODAY)));
    const f = buildForecast(d, TODAY);
    const rows = dailyTimeline(f, '2026-10-01', '2026-11-30');
    expect(lowestPoint(rows)).toEqual({ date: '2026-10-25', tallyCents: usd(-610) });
    // Oct 29 payday recovers to $1,190, then Nov 1 rent dips to −$10 until the Nov 12 payday.
    expect(negativeStretches(rows)).toEqual([
      { start: '2026-10-22', end: '2026-10-28', lowestCents: usd(-610) },
      { start: '2026-11-01', end: '2026-11-11', lowestCents: usd(-10) },
    ]);
  });

  it('explains instead of forecasting when there is no recurring income', () => {
    let d = ops.emptyData();
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01');
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Gift', amountCents: usd(100), date: '2026-10-20' }, clockAt(TODAY)));
    const f = buildForecast(d, TODAY);
    expect(f.issue).toBe('no-recurring-income');
    expect(f.anchor).toBeNull();
    expect(dailyTimeline(f, '2026-10-01', '2026-11-30').every((r) => r.tallyCents === null)).toBe(true);
    expect(paycheckCycles(f)).toEqual([]);
    // Period totals are still available; they do not depend on the anchor.
    expect(periodKpis(f, '2026-10-01', '2026-11-30').outflowCents).toBe(usd(1200));
  });

  it('treats a deactivated income schedule as no recurring income', () => {
    const d = unwrap(ops.deactivateSource(baseline(), PAY, clockAt(TODAY)));
    expect(buildForecast(d, TODAY).issue).toBe('no-recurring-income');
  });
});

describe('expected vs actual outcomes', () => {
  it('late, smaller paycheck: $1,800 expected Oct 15, $1,650 received Oct 16', () => {
    const before = baseline();
    // Oct 16: the paycheck has not arrived. It is overdue and still counted on Oct 15.
    let f = buildForecast(before, '2026-10-16');
    const late = f.entries.find((e) => e.occurrence.id === id(PAY, '2026-10-15'))!;
    expect(late.occurrence.displayStatus).toBe('overdue');
    expect(late.date).toBe('2026-10-15');
    expect(f.anchor).toBe('2026-10-14');
    expect(overdueEntries(f).map((e) => e.occurrence.id)).toEqual([id(PAY, '2026-10-15')]);

    // The user records what actually arrived.
    const after = unwrap(ops.recordActual(before, id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clockAt('2026-10-16')));
    f = buildForecast(after, '2026-10-16');

    const occ = findOccurrence(after, id(PAY, '2026-10-15'), '2026-10-16')!;
    expect(occ.status).toBe('completed');
    expect(occ.expectedAmountCents).toBe(usd(1800));
    expect(occ.expectedDate).toBe('2026-10-15');
    expect(occ.actualAmountCents).toBe(usd(1650));
    expect(occ.actualDate).toBe('2026-10-16');

    // Counted exactly once, on the actual date, with the actual amount.
    const payEntries = f.entries.filter((e) => e.occurrence.id === id(PAY, '2026-10-15'));
    expect(payEntries).toHaveLength(1);
    expect(payEntries[0]!.date).toBe('2026-10-16');
    expect(entriesInRange(f, '2026-10-15', '2026-10-15').filter((e) => e.counts)).toHaveLength(0);
    expect(activity(f, '2026-10-15', '2026-11-01')).toEqual([
      ['2026-10-16', 1650, 1650],
      ['2026-10-20', -350, 1300],
      ['2026-10-25', -60, 1240],
      ['2026-10-29', 1800, 3040],
      ['2026-11-01', -1200, 1840],
    ]);

    // The next paycheck keeps its recurrence and amount; the source is untouched.
    const next = findOccurrence(after, id(PAY, '2026-10-29'), '2026-10-16')!;
    expect(next.virtual).toBe(true);
    expect(next.scheduledAmountCents).toBe(usd(1800));
    expect(after.sources).toEqual(before.sources);
    expect(overdueEntries(f)).toHaveLength(0);
  });

  it('a larger, later liability payment moves and resizes only that payment', () => {
    const today = '2026-10-21';
    const d = unwrap(ops.recordActual(baseline(), id(CAR, '2026-10-20'), { amountCents: usd(375), date: '2026-10-21' }, clockAt(today)));
    const f = buildForecast(d, today);
    // Paycheck still outstanding/overdue keeps the anchor at Oct 14.
    expect(f.anchor).toBe('2026-10-14');
    expect(activity(f, '2026-10-15', '2026-11-20')).toEqual([
      ['2026-10-15', 1800, 1800],
      ['2026-10-21', -375, 1425],
      ['2026-10-25', -60, 1365],
      ['2026-10-29', 1800, 3165],
      ['2026-11-01', -1200, 1965],
      ['2026-11-12', 1800, 3765],
      ['2026-11-20', -350, 3415],
    ]);
  });

  it('an earlier, smaller expense is recognized on its actual date', () => {
    const today = '2026-10-23';
    const d = unwrap(ops.recordActual(baseline(), id(PHONE, '2026-10-25'), { amountCents: usd(55), date: '2026-10-23' }, clockAt(today)));
    const f = buildForecast(d, today);
    const rows = dailyTimeline(f, '2026-10-23', '2026-10-25');
    expect(rows[0]!.outCents).toBe(usd(55));
    expect(rows[2]!.outCents).toBe(0);
  });

  it('rejects duplicate completion (double tap or retried save)', () => {
    const clock = clockAt('2026-10-16');
    const once = unwrap(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clock));
    expectError(ops.recordActual(once, id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clock), /already been recorded/);
    expect(once.records.filter((r) => r.id === id(PAY, '2026-10-15'))).toHaveLength(1);
    const f = buildForecast(once, '2026-10-16');
    expect(f.entries.filter((e) => e.occurrence.id === id(PAY, '2026-10-15'))).toHaveLength(1);
  });

  it('corrects a recorded actual without touching the original prediction', () => {
    const clock = clockAt('2026-10-16');
    let d = unwrap(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clock));
    d = unwrap(ops.correctActual(d, id(PAY, '2026-10-15'), { amountCents: usd(1700), date: '2026-10-15' }, clock));
    const occ = findOccurrence(d, id(PAY, '2026-10-15'), clock.today)!;
    expect([occ.expectedAmountCents, occ.expectedDate, occ.actualAmountCents, occ.actualDate]).toEqual([usd(1800), '2026-10-15', usd(1700), '2026-10-15']);
  });

  it('rejects actual dates in the future and non-positive amounts', () => {
    expectError(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1800), date: '2026-10-15' }, clockAt(TODAY)), /future/);
    expectError(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: 0, date: TODAY }, clockAt(TODAY)), /greater than/);
  });

  it('undoing a recorded outcome restores the outstanding expectation', () => {
    const clock = clockAt('2026-10-16');
    let d = unwrap(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clock));
    d = unwrap(ops.restoreOccurrence(d, id(PAY, '2026-10-15'), clock));
    const f = buildForecast(d, '2026-10-16');
    const e = f.entries.find((x) => x.occurrence.id === id(PAY, '2026-10-15'))!;
    expect(e.occurrence.displayStatus).toBe('overdue');
    expect(e.date).toBe('2026-10-15');
    expect(e.amountCents).toBe(usd(1800));
  });
});

describe('overdue, rescheduled, and canceled occurrences', () => {
  it('overdue items stay visible and counted; they are never auto-completed', () => {
    const f = buildForecast(baseline(), '2026-10-27');
    const statuses = overdueEntries(f).map((e) => [e.occurrence.description, e.occurrence.scheduledDate]);
    expect(statuses).toEqual([
      ['Paycheck', '2026-10-15'],
      ['Car loan', '2026-10-20'],
      ['Phone', '2026-10-25'],
    ]);
    expect(tallyOn(f, '2026-10-27')).toBe(usd(1390));
  });

  it('overdue items dated before the forecast start are carried forward, not dropped', () => {
    let d = baseline();
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Dentist', amountCents: usd(100), date: '2026-10-05' }, clockAt('2026-10-01'), 'one-dentist'));
    const f = buildForecast(d, TODAY);
    const dentist = f.entries.find((e) => e.occurrence.id === 'one-dentist')!;
    expect(dentist.occurrence.displayStatus).toBe('overdue');
    expect(dentist.carriedForward).toBe(true);
    expect(dentist.date).toBe('2026-10-15');
    expect(dentist.occurrence.scheduledDate).toBe('2026-10-05');
    expect(tallyOn(f, '2026-10-15')).toBe(usd(1700));
  });

  it('upcoming items before the next payday are shown but not part of the tally', () => {
    let d = baseline();
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Electric', amountCents: usd(90), date: '2026-10-12' }, clockAt(TODAY)));
    const f = buildForecast(d, TODAY);
    const row = dailyTimeline(f, '2026-10-12', '2026-10-12')[0]!;
    expect(row.outCents).toBe(usd(90));
    expect(row.tallyCents).toBeNull();
    expect(tallyOn(f, '2026-10-15')).toBe(usd(1800));
  });

  it('rescheduling counts the occurrence once, on the new date, and keeps the original', () => {
    const clock = clockAt('2026-10-16');
    const d = unwrap(ops.rescheduleOccurrence(baseline(), id(PAY, '2026-10-15'), { date: '2026-10-17', amountCents: usd(1800) }, clock));
    const f = buildForecast(d, clock.today);
    const matches = f.entries.filter((e) => e.occurrence.id === id(PAY, '2026-10-15'));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.date).toBe('2026-10-17');
    expect(matches[0]!.occurrence.displayStatus).toBe('scheduled');
    expect(matches[0]!.occurrence.expectedDate).toBe('2026-10-15');
    expect(entriesInRange(f, '2026-10-15', '2026-10-15')).toHaveLength(0);
    expect(f.anchor).toBe('2026-10-16');
  });

  it('rescheduling an expense to a new date and amount', () => {
    const d = unwrap(ops.rescheduleOccurrence(baseline(), id(PHONE, '2026-10-25'), { date: '2026-11-02', amountCents: usd(65) }, clockAt(TODAY)));
    const f = buildForecast(d, TODAY);
    expect(entriesInRange(f, '2026-10-25', '2026-10-25')).toHaveLength(0);
    const moved = entriesInRange(f, '2026-11-02', '2026-11-02');
    expect(moved.map((e) => [e.occurrence.description, e.amountCents, e.occurrence.expectedAmountCents])).toEqual([['Phone', usd(65), usd(60)]]);
    // Next month's phone bill is unaffected.
    expect(entriesInRange(f, '2026-11-25', '2026-11-25')[0]!.amountCents).toBe(usd(60));
  });

  it('rejects rescheduling into the past', () => {
    expectError(ops.rescheduleOccurrence(baseline(), id(PHONE, '2026-10-25'), { date: '2026-10-01', amountCents: usd(60) }, clockAt(TODAY)), /today or a later/);
  });

  it('canceling excludes the occurrence from totals but keeps it on record, distinct from completion', () => {
    const d = unwrap(ops.cancelOccurrence(baseline(), id(PHONE, '2026-10-25'), 'Promo month', clockAt(TODAY)));
    const f = buildForecast(d, TODAY);
    const canceled = f.entries.find((e) => e.occurrence.id === id(PHONE, '2026-10-25'))!;
    expect(canceled.counts).toBe(false);
    expect(canceled.occurrence.status).toBe('canceled');
    expect(canceled.occurrence.actualAmountCents).toBeNull();
    expect(canceled.occurrence.cancelNote).toBe('Promo month');
    expect(tallyOn(f, '2026-10-25')).toBe(usd(1450));
    expect(entriesInRange(f, '2026-11-25', '2026-11-25')[0]!.counts).toBe(true);
    expectError(ops.recordActual(d, id(PHONE, '2026-10-25'), { amountCents: usd(60), date: TODAY }, clockAt(TODAY)), /canceled/);
    // Restoring brings it back.
    const restored = unwrap(ops.restoreOccurrence(d, id(PHONE, '2026-10-25'), clockAt(TODAY)));
    expect(tallyOn(buildForecast(restored, TODAY), '2026-10-25')).toBe(usd(1390));
  });
});

describe('recurring schedule changes', () => {
  it('a raise applies from its effective date and leaves earlier occurrences alone', () => {
    let d = unwrap(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clockAt('2026-10-16')));
    d = unwrap(ops.changeSourceSchedule(d, PAY, { startDate: '2026-11-12', amountCents: usd(1900), rule: { type: 'biweekly' } }, clockAt('2026-10-16')));
    const f = buildForecast(d, '2026-10-16');
    const pays = f.entries.filter((e) => e.occurrence.sourceId === PAY && e.date <= '2026-11-26');
    expect(pays.map((e) => [e.date, e.amountCents / 100, e.occurrence.status])).toEqual([
      ['2026-10-16', 1650, 'completed'],
      ['2026-10-29', 1800, 'scheduled'],
      ['2026-11-12', 1900, 'scheduled'],
      ['2026-11-26', 1900, 'scheduled'],
    ]);
    expect(pays[0]!.occurrence.expectedAmountCents).toBe(usd(1800));
  });

  it('switching from every two weeks to twice monthly from an effective date', () => {
    const d = unwrap(ops.changeSourceSchedule(baseline(), PAY, { startDate: '2026-11-15', amountCents: usd(1950), rule: { type: 'twiceMonthly', days: [1, 15] } }, clockAt(TODAY)));
    const f = buildForecast(d, TODAY);
    expect(f.entries.filter((e) => e.occurrence.sourceId === PAY && e.date <= '2026-12-15').map((e) => e.date)).toEqual([
      '2026-10-15', '2026-10-29', '2026-11-12', '2026-11-15', '2026-12-01', '2026-12-15',
    ]);
  });

  it('refuses effective dates in the past so history is not rewritten', () => {
    expectError(ops.changeSourceSchedule(baseline(), PAY, { startDate: '2026-10-01', amountCents: usd(1900), rule: { type: 'biweekly' } }, clockAt(TODAY)), /today or later/);
  });

  it('a stored outcome survives a later schedule change', () => {
    // Pre-pay the Nov 20 car payment, then change the schedule from Nov 1.
    let d = unwrap(ops.recordActual(baseline(), id(CAR, '2026-11-20'), { amountCents: usd(350), date: TODAY }, clockAt(TODAY)));
    d = unwrap(ops.changeSourceSchedule(d, CAR, { startDate: '2026-11-05', amountCents: usd(400), rule: { type: 'monthly' } }, clockAt(TODAY)));
    const f = buildForecast(d, TODAY);
    const car = f.entries.filter((e) => e.occurrence.sourceId === CAR && e.date <= '2026-12-31');
    expect(car.map((e) => [e.date, e.amountCents / 100, e.occurrence.status])).toEqual([
      [TODAY, 350, 'completed'],
      ['2026-10-20', 350, 'scheduled'],
      ['2026-11-05', 400, 'scheduled'],
      ['2026-12-05', 400, 'scheduled'],
    ]);
  });

  it('deactivating stops future occurrences; reactivating resumes without a backlog', () => {
    let d = unwrap(ops.deactivateSource(baseline(), PHONE, clockAt(TODAY)));
    let f = buildForecast(d, TODAY);
    expect(f.entries.some((e) => e.occurrence.sourceId === PHONE)).toBe(false);
    d = unwrap(ops.reactivateSource(d, PHONE, '2026-12-25', clockAt('2026-12-01')));
    f = buildForecast(d, '2026-12-01');
    const phone = f.entries.filter((e) => e.occurrence.sourceId === PHONE && e.date <= '2027-01-31');
    expect(phone.map((e) => e.date)).toEqual(['2026-12-25', '2027-01-25']);
    expect(overdueEntries(f).some((e) => e.occurrence.sourceId === PHONE)).toBe(false);
  });

  it('renaming does not alter amounts or recorded outcomes', () => {
    const clock = clockAt('2026-10-16');
    let d = unwrap(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clock));
    d = unwrap(ops.updateSourceDetails(d, PAY, { description: 'Main job' }, clock));
    const occ = findOccurrence(d, id(PAY, '2026-10-15'), clock.today)!;
    expect(occ.actualAmountCents).toBe(usd(1650));
    expect(findOccurrence(d, id(PAY, '2026-10-29'), clock.today)!.description).toBe('Main job');
  });
});

describe('one-time transactions', () => {
  it('occur exactly once and never repeat', () => {
    const d = unwrap(ops.addOneTime(baseline(), { kind: 'income', description: 'Tax refund', amountCents: usd(500), date: '2026-11-03' }, clockAt(TODAY), 'one-refund'));
    const f = buildForecast(d, TODAY, { through: '2028-12-31' });
    const refunds = f.entries.filter((e) => e.occurrence.description === 'Tax refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.date).toBe('2026-11-03');
    expect(paycheckCycles(f).some((c) => c.start === '2026-11-03')).toBe(false);
  });

  it('can be deleted; recurring occurrences cannot', () => {
    let d = unwrap(ops.addOneTime(baseline(), { kind: 'bill', description: 'Gift', amountCents: usd(50), date: '2026-10-30' }, clockAt(TODAY), 'one-gift'));
    d = unwrap(ops.deleteOneTime(d, 'one-gift'));
    expect(buildForecast(d, TODAY).entries.some((e) => e.occurrence.id === 'one-gift')).toBe(false);
    const withRecord = unwrap(ops.cancelOccurrence(d, id(PHONE, '2026-10-25'), '', clockAt(TODAY)));
    expectError(ops.deleteOneTime(withRecord, id(PHONE, '2026-10-25')));
  });
});

describe('period KPIs and summaries', () => {
  it('KPIs follow the selected period and count liability payments once', () => {
    const f = buildForecast(baseline(), TODAY);
    expect(periodKpis(f, '2026-10-18', '2026-10-24')).toEqual({ incomeCents: 0, outflowCents: usd(350), netCents: usd(-350) });
    expect(periodKpis(f, '2026-10-01', '2026-10-31')).toEqual({ incomeCents: usd(3600), outflowCents: usd(410), netCents: usd(3190) });
    expect(periodKpis(f, '2026-10-15', '2026-11-14')).toEqual({ incomeCents: usd(5400), outflowCents: usd(1610), netCents: usd(3790) });
    expect(entriesInRange(f, '2026-10-20', '2026-10-20')).toHaveLength(1);
  });

  it('KPIs use actual outcomes and never double count completed items', () => {
    const d = unwrap(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clockAt('2026-10-16')));
    const f = buildForecast(d, '2026-10-16');
    expect(periodKpis(f, '2026-10-01', '2026-10-31').incomeCents).toBe(usd(3450));
  });

  it('month weekly summaries use Sunday–Saturday weeks clipped to the month and add up to the month', () => {
    const f = buildForecast(baseline(), TODAY);
    const weeks = monthWeekSummaries(f, '2026-10-11');
    expect(weeks.map((w) => [w.start, w.end])).toEqual([
      ['2026-10-01', '2026-10-03'],
      ['2026-10-04', '2026-10-10'],
      ['2026-10-11', '2026-10-17'],
      ['2026-10-18', '2026-10-24'],
      ['2026-10-25', '2026-10-31'],
    ]);
    expect(weeks.map((w) => w.netCents / 100)).toEqual([0, 0, 1800, -350, 1740]);
    const month = periodKpis(f, '2026-10-01', '2026-10-31');
    expect(weeks.reduce((s, w) => s + w.netCents, 0)).toBe(month.netCents);
    expect(weeks[2]!.days.find((r) => r.date === '2026-10-15')!.tallyCents).toBe(usd(1800));
  });
});

describe('paycheck-to-paycheck cycles', () => {
  it('runs from each payday to the day before the next', () => {
    const f = buildForecast(baseline(), TODAY);
    const cycles = paycheckCycles(f, 3);
    expect(cycles.map((c) => [c.start, c.end])).toEqual([
      ['2026-10-15', '2026-10-28'],
      ['2026-10-29', '2026-11-11'],
      ['2026-11-12', '2026-11-25'],
    ]);
  });

  it('does not reset the tally at the start of each cycle', () => {
    const f = buildForecast(baseline(), TODAY);
    const second = paycheckCycles(f)[1]!;
    const rows = dailyTimeline(f, second.start, second.end);
    expect(rows[0]!.tallyCents).toBe(usd(3190));
    expect(periodKpis(f, second.start, second.end)).toEqual({ incomeCents: usd(1800), outflowCents: usd(1200), netCents: usd(600) });
  });

  it('merges boundaries from several income schedules', () => {
    let d = baseline();
    d = source(d, TODAY, 'income', 'Benefits', 400, '2026-11-03', { type: 'monthly' }, 'income-benefits');
    const cycles = paycheckCycles(buildForecast(d, TODAY), 4);
    expect(cycles.map((c) => [c.start, c.end, c.paydayEntries.map((e) => e.occurrence.description).join('+')])).toEqual([
      ['2026-10-15', '2026-10-28', 'Paycheck'],
      ['2026-10-29', '2026-11-02', 'Paycheck'],
      ['2026-11-03', '2026-11-11', 'Benefits'],
      ['2026-11-12', '2026-11-25', 'Paycheck'],
    ]);
  });

  it('uses the actual date of a late paycheck as the cycle boundary', () => {
    const d = unwrap(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1650), date: '2026-10-16' }, clockAt('2026-10-16')));
    expect(paycheckCycles(buildForecast(d, '2026-10-16'), 1)[0]).toMatchObject({ start: '2026-10-16', end: '2026-10-28' });
  });
});

describe('time zone independence', () => {
  it('produces identical forecasts in every host time zone', () => {
    const original = process.env.TZ;
    const snapshots = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata'].map((tz) => {
      process.env.TZ = tz;
      const f = buildForecast(baseline(), TODAY);
      return JSON.stringify(dailyTimeline(f, '2026-10-01', '2027-03-31').map((r) => [r.date, r.netCents, r.tallyCents]));
    });
    process.env.TZ = original;
    for (const s of snapshots) expect(s).toBe(snapshots[0]);
  });
});

describe('redefining a source with no history', () => {
  it('replaces the schedule entirely, leaving no occurrence on the old date', () => {
    const d = unwrap(ops.redefineSource(baseline(), PAY, { description: 'Paycheck', amountCents: usd(1900), startDate: '2026-10-20', rule: { type: 'biweekly' } }, clockAt(TODAY)));
    const f = buildForecast(d, TODAY);
    const pays = f.entries.filter((e) => e.occurrence.sourceId === PAY && e.date <= '2026-11-30');
    expect(pays.map((e) => [e.date, e.amountCents / 100])).toEqual([
      ['2026-10-20', 1900],
      ['2026-11-03', 1900],
      ['2026-11-17', 1900],
    ]);
    expect(f.anchor).toBe('2026-10-19');
  });

  it('refuses once the source has history', () => {
    const recorded = unwrap(ops.recordActual(baseline(), id(PAY, '2026-10-15'), { amountCents: usd(1800), date: '2026-10-15' }, clockAt('2026-10-15')));
    expect(ops.sourceHasNoHistory(recorded, PAY, '2026-10-15')).toBe(false);
    expectError(ops.redefineSource(recorded, PAY, { description: 'Paycheck', amountCents: usd(1900), startDate: '2026-10-20', rule: { type: 'biweekly' } }, clockAt('2026-10-15')), /already has history/);
    // A past start date also counts as history.
    expect(ops.sourceHasNoHistory(baseline(), PAY, '2026-10-16')).toBe(false);
  });
});
