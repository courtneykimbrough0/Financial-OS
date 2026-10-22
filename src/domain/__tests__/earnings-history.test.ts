import { describe, expect, it } from 'vitest';
import { activityView, possibleEntries, recordedEntries } from '../activity';
import { earningsHistory, hasEarningsData } from '../earnings-history';
import { buildForecast } from '../forecast';
import * as ops from '../operations';
import type { AppData } from '../types';
import { earningsPlan as plan } from './earnings-fixture';
import { clockAt, source, unwrap, usd } from './helpers';

// E5: earnings history. Earned, not received yet and received stay apart; received is what Activity counts. Monday Oct 19, 2026.
const TODAY = '2026-10-19';
const clock = clockAt(TODAY);
const OCT = ['2026-10-01', '2026-10-31'] as const;
const SEP = ['2026-09-01', '2026-09-30'] as const;

function history(d: AppData, [start, end]: readonly [string, string], today = TODAY) {
  const forecast = buildForecast(d, today, { through: end });
  return earningsHistory(d, recordedEntries(forecast, start, end), start, end, today);
}
const cashOf = (d: AppData, id: string) => d.workEntries!.find((e) => e.id === id)!.cashTipsRecordId!;
const paymentOf = (d: AppData, id: string) => d.jobs!.find((j) => j.id === id)!.paymentRecordId!;
const receivedRows = (h: ReturnType<typeof history>) => h.received.map((r) => [r.entry.occurrence.id, r.for, r.entry.date, r.entry.amountCents]);

describe('earnings for a month', () => {
  it('hours, wages, cash and card tips, platform earnings and effective hourly from the work dated in it', () => {
    const h = history(plan(), OCT);
    // s1: 6.5 h, wages $99.13 + $40 cash + $55 card = $194.13; s2: 5 h, $76.25 + $30 card = $106.25;
    // g1: 3 h, $90 + $15 cash = $105; g2: 2 h, $60; g3: no hours, $40.
    expect(h.work).toEqual({ shifts: 5, minutes: 990, wagesCents: 17538, cashTipsCents: usd(55), cardTipsCents: usd(85), earningsCents: usd(190), totalCents: 50538, effectiveHourlyCents: 2820 });
    // Effective hourly leaves out g3 (no hours): $465.38 ÷ 16.5 h = $28.204… → $28.20. Server: $300.38 ÷ 11.5 h = $26.12.
    expect(h.bySource.map((s) => [s.source.id, s.kind, s.summary.shifts, s.summary.totalCents, s.summary.effectiveHourlyCents])).toEqual([
      ['job', 'shift', 2, 30038, 2612],
      ['dash', 'session', 3, 20500, 3300],
    ]);
    expect(history(plan(), SEP).work).toMatchObject({ shifts: 1, minutes: 240, wagesCents: 6100, cashTipsCents: usd(20), totalCents: 8100, effectiveHourlyCents: 2025 });
  });

  it('received lists the recorded paychecks, payouts, cash and job payments of the month, never fixed income', () => {
    const d = plan();
    const h = history(d, OCT);
    expect(receivedRows(h)).toEqual([
      ['job@2026-10-16', 'paycheck', '2026-10-16', usd(780)],
      [cashOf(d, 's1'), 'cash-tips', '2026-10-13', usd(40)],
      ['dash@2026-10-12', 'payout', '2026-10-12', usd(85)],
      [paymentOf(d, 'logo'), 'job-payment', '2026-10-09', usd(780)],
      [cashOf(d, 'g1'), 'session-cash', '2026-10-06', usd(15)],
      ['job@2026-10-02', 'paycheck', '2026-10-02', usd(590)],
    ]);
    expect(h.receivedCents).toBe(usd(2290));
    expect(receivedRows(history(d, SEP))).toEqual([
      [cashOf(d, 's3'), 'cash-tips', '2026-09-28', usd(20)],
      [paymentOf(d, 'old'), 'job-payment', '2026-09-20', usd(300)],
    ]);
  });

  it('not received yet: unpaid work today, gig earnings by platform, and done jobs; planned jobs apart', () => {
    const h = history(plan(), OCT);
    // Every shift is paid; g2 and g3 wait for a payout.
    expect(h.notReceived.map((n) => [n.source.id, n.kind, n.cents, n.platforms])).toEqual([
      ['dash', 'session', usd(100), [{ platform: 'DoorDash', cents: usd(40) }, { platform: 'Uber', cents: usd(60) }]],
    ]);
    expect(h.jobs.planned.map((v) => [v.job.id, v.payment, v.amountCents])).toEqual([['copy', 'possible', usd(1200)]]);
    expect(h.jobs.doneNotPaid.map((v) => [v.job.id, v.payment, v.amountCents])).toEqual([['poster', 'pending', usd(150)]]);
    expect(h.jobs.paid.map((v) => [v.job.id, v.date, v.amountCents])).toEqual([['logo', '2026-10-09', usd(780)]]);
    expect([h.jobs.plannedCents, h.jobs.doneNotPaidCents, h.jobs.paidCents]).toEqual([usd(1200), usd(150), usd(780)]);
    expect(history(plan(), SEP).jobs.paid.map((v) => v.job.id)).toEqual(['old']);
  });
});

describe('no double counting', () => {
  it('earned money never reaches cash flow; received is exactly a part of what Activity counts, each once', () => {
    const d = plan();
    const before = JSON.stringify(d);
    const forecast = buildForecast(d, TODAY, { through: OCT[1] });
    const activity = activityView(forecast, ...OCT);
    const h = history(d, OCT);
    // Recorded income: $2,000 salary + $2,290 for work. Unpaid earnings and done jobs aren't in it.
    expect(activity.summary.incomeCents).toBe(usd(2000 + 2290));
    const ids = h.received.map((r) => r.entry.occurrence.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of h.received) expect(activity.items.filter((i) => i.entry.occurrence.id === r.entry.occurrence.id).map((i) => i.entry.amountCents)).toEqual([r.entry.amountCents]);
    // Looking at earnings changes nothing.
    expect(JSON.stringify(d)).toBe(before);
  });

  it('logging more work changes earnings but not the forecast, apart from cash received', () => {
    const d = plan();
    const more = unwrap(ops.logSession(d, { sourceId: 'dash', date: '2026-10-18', minutes: 60, earningsCents: usd(25) }, clock, 'g4'));
    expect(history(more, OCT).work.totalCents - history(d, OCT).work.totalCents).toBe(usd(25));
    expect(buildForecast(more, TODAY).entries.map((e) => [e.occurrence.id, e.signedCents])).toEqual(buildForecast(d, TODAY).entries.map((e) => [e.occurrence.id, e.signedCents]));
    expect(history(more, OCT).receivedCents).toBe(history(d, OCT).receivedCents);
  });
});

describe('corrected and undone payments', () => {
  it('a corrected paycheck is received at its new date and amount; earnings stay the same', () => {
    const d = unwrap(ops.correctActual(plan(), 'job@2026-10-16', { amountCents: usd(800), date: '2026-10-17' }, clock));
    const h = history(d, OCT);
    expect(receivedRows(h)[0]).toEqual(['job@2026-10-16', 'paycheck', '2026-10-17', usd(800)]);
    expect(h.receivedCents).toBe(usd(2310));
    expect(h.work).toEqual(history(plan(), OCT).work);
    expect(h.notReceived.map((n) => n.source.id)).toEqual(['dash']);
  });

  it('an undone paycheck, payout or job payment leaves received, and its work is not received yet again', () => {
    let d = unwrap(ops.restoreOccurrence(plan(), 'job@2026-10-16', clock));
    d = unwrap(ops.restoreOccurrence(d, 'dash@2026-10-12', clock));
    d = unwrap(ops.restoreOccurrence(d, paymentOf(d, 'logo'), clock));
    const h = history(d, OCT);
    expect(h.received.map((r) => r.for)).toEqual(['cash-tips', 'session-cash', 'paycheck']);
    expect(h.receivedCents).toBe(usd(40 + 15 + 590));
    // s1 and s2: wages $99.13 + $76.25 and card tips $85; all three sessions' earnings.
    expect(h.notReceived.map((n) => [n.source.id, n.cents])).toEqual([
      ['job', 9913 + 7625 + usd(85)],
      ['dash', usd(190)],
    ]);
    expect(h.jobs.paid).toEqual([]);
    expect(h.jobs.doneNotPaid.map((v) => [v.job.id, v.payment])).toEqual([['logo', 'overdue'], ['poster', 'pending']]);
    expect(h.work).toEqual(history(plan(), OCT).work);
  });
});

describe('empty and partly filled history', () => {
  it('a plan with no shifts, sessions or jobs has no earnings data, even with recorded income', () => {
    let d = source(ops.emptyData(), '2026-09-01', 'income', 'Salary', 2000, '2026-10-01', { type: 'monthly' }, 'salary');
    d = unwrap(ops.recordActual(d, 'salary@2026-10-01', { amountCents: usd(2000), date: '2026-10-01' }, clock));
    expect(hasEarningsData(d)).toBe(false);
    const h = history(d, OCT);
    expect([h.work.shifts, h.bySource, h.notReceived, h.received, h.jobs.paid]).toEqual([0, [], [], [], []]);
    expect(h.work.effectiveHourlyCents).toBeNull();
  });

  it('an hourly income with no shifts yet lists its paychecks; jobs alone are earnings data', () => {
    let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Cafe', amountCents: usd(500), startDate: '2026-10-02', rule: { type: 'biweekly' }, incomeType: 'hourly' }, clockAt('2026-09-01'), 'cafe'));
    d = unwrap(ops.recordActual(d, 'cafe@2026-10-02', { amountCents: usd(500), date: '2026-10-02' }, clock));
    expect(hasEarningsData(d)).toBe(false);
    expect(receivedRows(history(d, OCT))).toEqual([['cafe@2026-10-02', 'paycheck', '2026-10-02', usd(500)]]);
    const jobs = unwrap(ops.addJob(ops.emptyData(), { description: 'Poster', amountCents: usd(150), status: 'done' }, clock, 'poster'));
    expect(hasEarningsData(jobs)).toBe(true);
    const h = history(jobs, OCT);
    expect([h.work.shifts, h.work.effectiveHourlyCents, h.jobs.doneNotPaidCents, h.receivedCents]).toEqual([0, null, usd(150), 0]);
  });

  it('a month with no work still shows what is not received yet today', () => {
    const h = history(plan(), ['2026-08-01', '2026-08-31']);
    expect([h.work.shifts, h.received.length]).toEqual([0, 0]);
    expect(h.notReceived.map((n) => n.cents)).toEqual([usd(100)]);
  });
});

describe('possible income in Activity', () => {
  it('lists possible income not received in the month, never counted and never recorded', () => {
    const d = plan();
    const forecast = buildForecast(d, TODAY, { through: '2026-11-30' });
    expect(possibleEntries(forecast, '2026-11-01', '2026-11-30').map((e) => [e.occurrence.id, e.date, e.counts, e.signedCents])).toEqual([[paymentOf(d, 'copy'), '2026-11-15', false, 0]]);
    expect(recordedEntries(forecast, '2026-11-01', '2026-11-30').some((e) => e.possible)).toBe(false);
    expect(possibleEntries(forecast, ...OCT)).toEqual([]);
  });
});
