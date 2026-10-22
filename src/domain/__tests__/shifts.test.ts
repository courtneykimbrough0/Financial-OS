import { describe, expect, it } from 'vitest';
import { activityView } from '../activity';
import { earnedNotPaid, formatHours, shiftEarnings, shiftsFor, shiftWagesCents, summarize } from '../earnings';
import { buildForecast, dailyTimeline, periodKpis, type Forecast } from '../forecast';
import * as ops from '../operations';
import type { AppData, WorkEntry } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

// E2: hourly and tipped income. Shifts are earnings; only money received counts. Monday Oct 19, 2026.
const TODAY = '2026-10-19';
const clock = clockAt(TODAY);

/** A tipped server: paycheck $600 every 2 weeks from Oct 16 (baseline), $15.25/h; rent $900 on the 25th. */
function job(): AppData {
  let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: "Server at Luigi's", amountCents: usd(600), startDate: '2026-10-16', rule: { type: 'biweekly' }, incomeType: 'tipped', hourlyWageCents: 1525 }, clockAt('2026-10-01'), 'job'));
  d = source(d, '2026-10-01', 'bill', 'Rent', 900, '2026-10-25', { type: 'monthly' }, 'rent');
  return d;
}

const shift = (d: AppData, id: string, date: string, hours: number | null, cash: number | null, card: number | null, at = clock) =>
  unwrap(ops.logShift(d, { sourceId: 'job', date, minutes: hours === null ? null : Math.round(hours * 60), wageCents: 1525, cashTipsCents: cash === null ? null : usd(cash), cardTipsCents: card === null ? null : usd(card) }, at, id));

/** Three shifts: Oct 13 (6.5 h, $40 cash, $55 card), Oct 14 (5 h, card $30), Oct 17 (4 h, $22 cash). */
function worked(): AppData {
  let d = job();
  d = shift(d, 's1', '2026-10-13', 6.5, 40, 55);
  d = shift(d, 's2', '2026-10-14', 5, null, 30);
  d = shift(d, 's3', '2026-10-17', 4, 22, null);
  return d;
}

const counted = (f: Forecast) => f.entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);
const tips = (d: AppData) => d.records.filter((r) => r.description.startsWith('Cash tips'));
const workOf = (d: AppData, id: string) => d.workEntries!.find((e) => e.id === id)!;

describe('earnings calculations', () => {
  it('wages are hours × wage to the nearest cent, and a shift earns wages plus both kinds of tips', () => {
    // 6.5 h × $15.25 = $99.125 → $99.13.
    expect(shiftWagesCents({ minutes: 390, wageCents: 1525 })).toBe(9913);
    expect(shiftWagesCents({ minutes: 390 })).toBe(0);
    expect(shiftWagesCents({ wageCents: 1525 })).toBe(0);
    expect(shiftEarnings(workOf(worked(), 's1'))).toEqual({ wagesCents: 9913, cashTipsCents: 4000, cardTipsCents: 5500, earningsCents: 0, totalCents: 19413, payrollCents: 15413 });
  });

  it('totals count each shift once, and effective hourly uses only shifts with hours', () => {
    let d = worked();
    d = unwrap(ops.logShift(d, { sourceId: 'job', date: '2026-10-18', cashTipsCents: usd(10) }, clock, 's4'));
    const all = summarize(shiftsFor(d, 'job'));
    // Wages: 99.13 + 76.25 + 61.00. Cash: 40 + 22 + 10. Card: 55 + 30.
    expect(all).toEqual({ shifts: 4, minutes: 930, wagesCents: 23638, cashTipsCents: 7200, cardTipsCents: 8500, earningsCents: 0, totalCents: 39338, effectiveHourlyCents: Math.round((38338 * 60) / 930) });
    expect(summarize([])).toEqual({ shifts: 0, minutes: 0, wagesCents: 0, cashTipsCents: 0, cardTipsCents: 0, earningsCents: 0, totalCents: 0, effectiveHourlyCents: null });
    expect(shiftsFor(d, 'job').map((e) => e.id)).toEqual(['s4', 's3', 's2', 's1']);
    expect([formatHours(390), formatHours(45), formatHours(60)]).toEqual(['6.5 h', '45 min', '1 h']);
  });
});

describe('only money received counts', () => {
  it('cash tips are one received income record each, on the shift date; wages and card tips never enter cash flow', () => {
    const d = worked();
    expect(tips(d).map((r) => [r.description, r.status, r.actualDate, r.actualAmountCents, r.expectedAmountCents])).toEqual([
      ["Cash tips · Server at Luigi's", 'completed', '2026-10-13', usd(40), usd(40)],
      ["Cash tips · Server at Luigi's", 'completed', '2026-10-17', usd(22), usd(22)],
    ]);
    expect(workOf(d, 's1').cashTipsRecordId).toBe(tips(d)[0]!.id);
    expect(workOf(d, 's2').cashTipsRecordId).toBeUndefined();
    // The forecast is the baseline plus the two cash-tip records, and nothing else.
    const f = buildForecast(d, TODAY);
    const baseline = buildForecast(job(), TODAY);
    const added = counted(f).filter(([id]) => !counted(baseline).some(([b]) => b === id));
    expect(added).toEqual([
      [tips(d)[0]!.id, '2026-10-13', usd(40)],
      [tips(d)[1]!.id, '2026-10-17', usd(22)],
    ]);
    expect(periodKpis(f, '2026-10-01', '2026-10-31').incomeCents - periodKpis(baseline, '2026-10-01', '2026-10-31').incomeCents).toBe(usd(62));
    // Earned, not paid yet: wages + card tips of the three shifts.
    expect(earnedNotPaid(d, 'job').cents).toBe(9913 + 5500 + 7625 + 3000 + 6100);
  });

  it('shifts without cash tips change nothing in the forecast, and the expected paycheck stays as entered', () => {
    let d = job();
    d = shift(d, 's2', '2026-10-14', 5, null, 30);
    expect(buildForecast(d, TODAY).entries).toEqual(buildForecast(job(), TODAY).entries);
    expect(d.sources.find((s) => s.id === 'job')!.versions).toEqual(job().sources.find((s) => s.id === 'job')!.versions.map((v) => ({ ...v, id: expect.any(String) })));
  });

  it('recording the paycheck pays the shifts worked before it arrived; the paycheck counts once, as recorded, and the tips are not added again', () => {
    const at = clockAt('2026-10-30');
    let d = worked();
    d = shift(d, 's5', '2026-10-30', 3, null, 12, at);
    // The Oct 30 paycheck arrives at $812.40 (wages and card tips, after deductions).
    d = unwrap(ops.recordActual(d, 'job@2026-10-30', { amountCents: 81240, date: '2026-10-30' }, at));
    expect(d.workEntries!.map((e) => [e.id, e.paidByOccurrenceId])).toEqual([
      ['s1', 'job@2026-10-30'],
      ['s2', 'job@2026-10-30'],
      ['s3', 'job@2026-10-30'],
      ['s5', undefined],
    ]);
    // Only the payday's own shift is still earned, not paid.
    expect(earnedNotPaid(d, 'job')).toEqual({ cents: Math.round(180 * 1525 / 60) + 1200, shifts: [workOf(d, 's5')] });
    // October received: the Oct 16 paycheck isn't recorded, so: $812.40 + $40 + $22, each once.
    const f = buildForecast(d, '2026-10-30');
    const activity = activityView(f, '2026-10-01', '2026-10-31');
    expect(activity.items.map((i) => [i.entry.occurrence.description, i.entry.amountCents])).toEqual([
      ["Server at Luigi's", 81240],
      ["Cash tips · Server at Luigi's", usd(22)],
      ["Cash tips · Server at Luigi's", usd(40)],
    ]);
    expect(activity.items.reduce((n, i) => n + i.entry.signedCents, 0)).toBe(81240 + usd(62));
    expect(f.entries.filter((e) => e.counts && e.occurrence.id === 'job@2026-10-30')).toHaveLength(1);
  });

  it('batch "record as expected" pays shifts the same way, and undoing a paycheck makes its shifts unpaid again', () => {
    const at = clockAt('2026-10-17');
    let d = worked();
    d = unwrap(ops.recordAsExpected(d, ['job@2026-10-16'], at));
    // Received Oct 17 (the next day), so Oct 13 and 14 are paid; the Oct 17 shift isn't.
    expect(d.workEntries!.map((e) => e.paidByOccurrenceId)).toEqual(['job@2026-10-16', 'job@2026-10-16', undefined]);
    d = unwrap(ops.restoreOccurrence(d, 'job@2026-10-16', at));
    expect(d.workEntries!.every((e) => e.paidByOccurrenceId === undefined)).toBe(true);
  });

  it('the running total is the baseline plus the cash tips from the day they were received', () => {
    const d = worked();
    const a = dailyTimeline(buildForecast(d, TODAY), '2026-10-20', '2026-11-30');
    const b = dailyTimeline(buildForecast(job(), TODAY), '2026-10-20', '2026-11-30');
    // The running total starts with the overdue Oct 16 paycheck: the Oct 17 tips ($22) are inside it, the Oct 13 tips before it.
    expect(a.map((r, i) => r.tallyCents! - b[i]!.tallyCents!)).toEqual(a.map(() => usd(22)));
  });
});

describe('corrections', () => {
  it('changing cash tips replaces their record, so cash flow follows the correction and counts it once', () => {
    const d = worked();
    const old = workOf(d, 's1').cashTipsRecordId!;
    const fixed = unwrap(ops.editShift(d, 's1', { date: '2026-10-13', minutes: 390, wageCents: 1525, cashTipsCents: usd(45), cardTipsCents: usd(55) }, clock));
    const now = workOf(fixed, 's1').cashTipsRecordId!;
    expect(now).not.toBe(old);
    expect(fixed.records.some((r) => r.id === old)).toBe(false);
    expect(tips(fixed).map((r) => [r.actualDate, r.actualAmountCents])).toEqual([
      ['2026-10-17', usd(22)],
      ['2026-10-13', usd(45)],
    ]);
    expect(periodKpis(buildForecast(fixed, TODAY), '2026-10-01', '2026-10-31').incomeCents - periodKpis(buildForecast(d, TODAY), '2026-10-01', '2026-10-31').incomeCents).toBe(usd(5));
  });

  it('removing cash tips removes the record; adding them later creates one; a new date moves it; hours alone change no record', () => {
    let d = worked();
    d = unwrap(ops.editShift(d, 's3', { date: '2026-10-17', minutes: 240, wageCents: 1525 }, clock));
    expect(workOf(d, 's3').cashTipsRecordId).toBeUndefined();
    expect(tips(d)).toHaveLength(1);
    d = unwrap(ops.editShift(d, 's2', { date: '2026-10-15', minutes: 300, wageCents: 1525, cashTipsCents: usd(18), cardTipsCents: usd(30) }, clock));
    expect(tips(d).find((r) => r.id === workOf(d, 's2').cashTipsRecordId)).toMatchObject({ actualDate: '2026-10-15', actualAmountCents: usd(18) });
    const before = workOf(d, 's1').cashTipsRecordId;
    d = unwrap(ops.editShift(d, 's1', { date: '2026-10-13', minutes: 420, wageCents: 1525, cashTipsCents: usd(40), cardTipsCents: usd(55) }, clock));
    expect(workOf(d, 's1').cashTipsRecordId).toBe(before);
    expect(shiftEarnings(workOf(d, 's1')).wagesCents).toBe(10675);
  });

  it('a shift keeps whether it was paid when corrected, and can be marked paid by another recorded paycheck or not paid', () => {
    const at = clockAt('2026-10-30');
    let d = unwrap(ops.recordActual(worked(), 'job@2026-10-30', { amountCents: 81240, date: '2026-10-30' }, at));
    d = unwrap(ops.editShift(d, 's2', { date: '2026-10-14', minutes: 300, wageCents: 1600, cardTipsCents: usd(30) }, at));
    expect(workOf(d, 's2').paidByOccurrenceId).toBe('job@2026-10-30');
    d = unwrap(ops.setShiftPaid(d, 's2', null, at));
    expect(workOf(d, 's2').paidByOccurrenceId).toBeUndefined();
    expectError(ops.setShiftPaid(d, 's2', 'job@2026-11-13', at), /has been recorded/);
    expectError(ops.setShiftPaid(d, 's2', 'rent@2026-10-25', at), /has been recorded/);
    d = unwrap(ops.setShiftPaid(d, 's2', 'job@2026-10-30', at));
    expect(workOf(d, 's2').paidByOccurrenceId).toBe('job@2026-10-30');
  });

  it("deleting a shift removes its cash tips record and leaves the paycheck that paid it as recorded", () => {
    const at = clockAt('2026-10-30');
    let d = unwrap(ops.recordActual(worked(), 'job@2026-10-30', { amountCents: 81240, date: '2026-10-30' }, at));
    const record = workOf(d, 's1').cashTipsRecordId!;
    d = unwrap(ops.deleteShift(d, 's1'));
    expect(d.records.some((r) => r.id === record)).toBe(false);
    expect(d.records.find((r) => r.id === 'job@2026-10-30')!.actualAmountCents).toBe(81240);
    d = unwrap(ops.deleteShift(unwrap(ops.deleteShift(d, 's2')), 's3'));
    expect(d.workEntries).toBeUndefined();
  });

  it('the cash tips record is changed only through its shift', () => {
    const d = worked();
    const id = workOf(d, 's1').cashTipsRecordId!;
    const message = 'These are the cash tips from your Oct 13 shift. Change or delete the shift instead.';
    expect(ops.deleteOneTime(d, id)).toEqual({ ok: false, error: message });
    expect(ops.restoreOccurrence(d, id, clock)).toEqual({ ok: false, error: message });
    expect(ops.correctActual(d, id, { amountCents: usd(10), date: '2026-10-13' }, clock)).toEqual({ ok: false, error: message });
  });
});

describe('validation and setup', () => {
  it('a shift is for an hourly or tipped income, worked by today, with hours or tips', () => {
    const d = job();
    const base = { sourceId: 'job', date: '2026-10-18', minutes: 300 };
    expectError(ops.logShift(d, { ...base, date: '2026-10-20' }, clock), /once it has been worked/);
    expectError(ops.logShift(d, { ...base, sourceId: 'rent' }, clock), /hourly or tipped income/);
    expectError(ops.logShift(d, { ...base, sourceId: 'gone' }, clock), /no longer exists/);
    expectError(ops.logShift(d, { sourceId: 'job', date: '2026-10-18' }, clock), /hours worked or the tips/);
    expectError(ops.logShift(d, { ...base, minutes: 1441 }, clock), /between 0 and 24/);
    expectError(ops.logShift(d, { ...base, cashTipsCents: -500 }, clock), /Cash tips must be greater than \$0/);
    expectError(ops.logShift(d, { ...base, wageCents: 12.5 }, clock), /Hourly wage/);
    const fixed = source(ops.emptyData(), '2026-10-01', 'income', 'Salary', 2000, '2026-10-30', { type: 'monthly' }, 'salary');
    expectError(ops.logShift(fixed, { ...base, sourceId: 'salary' }, clock), /hourly or tipped income/);
    // Zero means none: nothing is stored as $0.
    const z = unwrap(ops.logShift(d, { ...base, cashTipsCents: 0, cardTipsCents: 0, wageCents: 0 }, clock, 'z'));
    expect(workOf(z, 'z')).toEqual({ id: 'z', sourceId: 'job', kind: 'shift', date: '2026-10-18', minutes: 300, createdAt: clock.now, updatedAt: clock.now });
    expect(z.records).toEqual([]);
  });

  it('income type and wage belong to income; an income with shifts stays hourly or tipped', () => {
    expectError(ops.addSource(ops.emptyData(), { kind: 'bill', description: 'Gym', amountCents: usd(30), startDate: TODAY, rule: { type: 'monthly' }, incomeType: 'hourly' }, clock), /Only income/);
    let d = unwrap(ops.setIncomeDetails(job(), 'job', { incomeType: 'hourly', hourlyWageCents: 1800 }, clock));
    expect(d.sources.find((s) => s.id === 'job')).toMatchObject({ incomeType: 'hourly', hourlyWageCents: 1800 });
    d = unwrap(ops.setIncomeDetails(d, 'job', { incomeType: null, hourlyWageCents: 1800 }, clock));
    const fixed = d.sources.find((s) => s.id === 'job')!;
    expect('incomeType' in fixed || 'hourlyWageCents' in fixed).toBe(false);
    expectError(ops.setIncomeDetails(worked(), 'job', { incomeType: null, hourlyWageCents: null }, clock), /stays hourly or tipped/);
    expect(unwrap(ops.setIncomeDetails(worked(), 'job', { incomeType: 'hourly', hourlyWageCents: null }, clock)).sources[0]).not.toHaveProperty('hourlyWageCents');
    expectError(ops.deleteSource(worked(), 'job'), /logged shifts/);
  });

  it('the forecast never reads income type, wage or shifts', () => {
    const plain = unwrap(ops.setIncomeDetails(job(), 'job', { incomeType: null, hourlyWageCents: null }, clock));
    const withShifts: AppData = { ...job(), workEntries: [{ id: 'x', sourceId: 'job', kind: 'shift', date: '2026-10-12', minutes: 600, wageCents: 99999, cardTipsCents: 99999, createdAt: clock.now, updatedAt: clock.now } satisfies WorkEntry] };
    const strip = (f: Forecast) => counted(f);
    expect(strip(buildForecast(withShifts, TODAY))).toEqual(strip(buildForecast(plain, TODAY)));
  });
});
