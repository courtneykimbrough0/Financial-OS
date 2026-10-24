import { describe, expect, it } from 'vitest';
import { activityView } from '../activity';
import { earnedNotPaid, shiftEarnings, summarize, shiftsFor, waitingByPlatform } from '../earnings';
import { buildForecast, periodKpis, type Forecast } from '../forecast';
import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

// E4: gig work and payouts. Sessions are earnings; only cash received and recorded payouts count. Monday Oct 19, 2026.
const TODAY = '2026-10-19';
const clock = clockAt(TODAY);
const SETUP = clockAt('2026-10-05');

/**
 * Two gig incomes and rent:
 * - DoorDash payouts, about $400 every Monday from Oct 12 (the Oct 12 payout recorded at $380);
 * - Uber payouts, about $250 every Wednesday from Oct 14;
 * - rent $900 on the 25th.
 */
function baseline(): AppData {
  let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'DoorDash payouts', amountCents: usd(400), startDate: '2026-10-12', rule: { type: 'weekly' }, incomeType: 'gig' }, SETUP, 'dash'));
  d = unwrap(ops.addSource(d, { kind: 'income', description: 'Uber payouts', amountCents: usd(250), startDate: '2026-10-14', rule: { type: 'weekly' }, incomeType: 'gig' }, SETUP, 'uber'));
  d = source(d, '2026-10-05', 'bill', 'Rent', 900, '2026-10-25', { type: 'monthly' }, 'rent');
  return unwrap(ops.recordActual(d, 'dash@2026-10-12', { amountCents: usd(380), date: '2026-10-12' }, clockAt('2026-10-12')));
}

const session = (d: AppData, id: string, sourceId: string, date: string, hours: number | null, earnings: number | null, cash: number | null, platform?: string) =>
  unwrap(ops.logSession(d, { sourceId, date, minutes: hours === null ? null : hours * 60, earningsCents: earnings === null ? null : usd(earnings), cashTipsCents: cash === null ? null : usd(cash), platform }, clock, id));

/** Four DoorDash sessions (one on Caviar) and one Uber session. */
function worked(): AppData {
  let d = baseline();
  d = session(d, 's1', 'dash', '2026-10-13', 3, 90, 15, 'DoorDash');
  d = session(d, 's2', 'dash', '2026-10-15', 4, 120, null, 'DoorDash');
  d = session(d, 's3', 'uber', '2026-10-16', 2, 60, 10, 'Uber');
  d = session(d, 's4', 'dash', '2026-10-18', null, 80, null, 'Caviar');
  return d;
}

const cash = (d: AppData) => d.records.filter((r) => r.description.startsWith('Cash ·'));
const work = (d: AppData, id: string) => d.workEntries!.find((e) => e.id === id)!;
const counted = (f: Forecast) => f.entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);

describe('cash received immediately', () => {
  it('is one received income record on the session date, counted once; platform earnings never enter cash flow', () => {
    const d = worked();
    expect(cash(d).map((r) => [r.description, r.status, r.actualDate, r.actualAmountCents])).toEqual([
      ['Cash · DoorDash', 'completed', '2026-10-13', usd(15)],
      ['Cash · Uber', 'completed', '2026-10-16', usd(10)],
    ]);
    expect(work(d, 's1')).toMatchObject({ kind: 'session', cashTipsRecordId: cash(d)[0]!.id, earningsCents: usd(90), platform: 'DoorDash' });
    const added = counted(buildForecast(d, TODAY)).filter(([id]) => !counted(buildForecast(baseline(), TODAY)).some(([b]) => b === id));
    expect(added).toEqual([
      [cash(d)[0]!.id, '2026-10-13', usd(15)],
      [cash(d)[1]!.id, '2026-10-16', usd(10)],
    ]);
  });

  it("the cash record changes only through its session, and a new amount, date or platform replaces it", () => {
    const d = worked();
    expect(ops.deleteOneTime(d, cash(d)[0]!.id)).toEqual({ ok: false, error: 'This is the cash from your Oct 13 session. Change or delete the session instead.' });
    const old = work(d, 's1').cashTipsRecordId!;
    const fixed = unwrap(ops.editSession(d, 's1', { date: '2026-10-13', minutes: 180, earningsCents: usd(90), cashTipsCents: usd(18), platform: 'Caviar' }, clock));
    expect(fixed.records.some((r) => r.id === old)).toBe(false);
    expect(fixed.records.find((r) => r.id === work(fixed, 's1').cashTipsRecordId)).toMatchObject({ description: 'Cash · Caviar', actualAmountCents: usd(18) });
    expect(cash(fixed)).toHaveLength(2);
  });
});

describe('platform earnings waiting for payout', () => {
  it('are earned, not received, per income and per platform', () => {
    const d = worked();
    expect(earnedNotPaid(d, 'dash').cents).toBe(usd(90 + 120 + 80));
    expect(earnedNotPaid(d, 'uber').cents).toBe(usd(60));
    expect(waitingByPlatform(d, 'dash')).toEqual([
      { platform: 'Caviar', cents: usd(80) },
      { platform: 'DoorDash', cents: usd(210) },
    ]);
    // A session earns its earnings plus its cash; the payout pays only the earnings.
    expect(shiftEarnings(work(d, 's1'))).toEqual({ wagesCents: 0, cashTipsCents: usd(15), cardTipsCents: 0, earningsCents: usd(90), totalCents: usd(105), payrollCents: usd(90) });
    expect(summarize(shiftsFor(d, 'dash'))).toMatchObject({ shifts: 3, minutes: 420, earningsCents: usd(290), cashTipsCents: usd(15), totalCents: usd(305), effectiveHourlyCents: Math.round((usd(225) * 60) / 420) });
  });

  it('the forecast is the payout schedule plus cash received; sessions without cash change nothing', () => {
    let d = baseline();
    d = session(d, 's2', 'dash', '2026-10-15', 4, 120, null);
    expect(buildForecast(d, TODAY).entries).toEqual(buildForecast(baseline(), TODAY).entries);
    // October income: DoorDash $380 recorded + $400 × 2 projected (Oct 19, 26); Uber $250 × 3 projected (Oct 14, 21, 28).
    expect(periodKpis(buildForecast(d, TODAY), '2026-10-01', '2026-10-31').incomeCents).toBe(usd(380 + 800 + 750));
  });
});

describe('payouts: expected versus actual, linked to the sessions they cover', () => {
  it('recording a payout pays its sessions worked before it arrived, counted once at the recorded amount and date', () => {
    const d = unwrap(ops.recordActual(worked(), 'dash@2026-10-19', { amountCents: usd(287.5), date: '2026-10-19' }, clock));
    expect(d.workEntries!.map((e) => [e.id, e.paidByOccurrenceId])).toEqual([
      ['s1', 'dash@2026-10-19'],
      ['s2', 'dash@2026-10-19'],
      ['s3', undefined],
      ['s4', 'dash@2026-10-19'],
    ]);
    expect(earnedNotPaid(d, 'dash').cents).toBe(0);
    expect(earnedNotPaid(d, 'uber').cents).toBe(usd(60));
    const record = d.records.find((r) => r.id === 'dash@2026-10-19')!;
    expect(record).toMatchObject({ expectedAmountCents: usd(400), expectedDate: '2026-10-19', actualAmountCents: usd(287.5), actualDate: '2026-10-19' });
    // Received in October: $380 + $287.50 payouts and $15 + $10 cash. The $290 of DoorDash earnings isn't added again.
    const received = activityView(buildForecast(d, TODAY), '2026-10-01', '2026-10-31').items;
    expect(received.reduce((n, i) => n + i.entry.signedCents, 0)).toBe(usd(380 + 287.5 + 15 + 10));
    expect(received.filter((i) => i.entry.occurrence.id === 'dash@2026-10-19')).toHaveLength(1);
  });

  it('a late payout counts on the day it arrived; the expected date is kept', () => {
    const at = clockAt('2026-10-21');
    const d = unwrap(ops.recordActual(worked(), 'dash@2026-10-19', { amountCents: usd(300), date: '2026-10-21' }, at));
    const f = buildForecast(d, '2026-10-21');
    expect(f.entries.filter((e) => e.occurrence.id === 'dash@2026-10-19')).toEqual([expect.objectContaining({ date: '2026-10-21', signedCents: usd(300), counts: true })]);
    expect(d.records.find((r) => r.id === 'dash@2026-10-19')!.expectedDate).toBe('2026-10-19');
    // Arrived Oct 21: sessions up to Oct 18 are paid by it.
    expect(work(d, 's4').paidByOccurrenceId).toBe('dash@2026-10-19');
  });

  it('correcting a payout keeps its sessions paid; undoing it makes them wait again; a session can be moved to another payout that came after it', () => {
    let d = unwrap(ops.recordActual(worked(), 'dash@2026-10-19', { amountCents: usd(287.5), date: '2026-10-19' }, clock));
    d = unwrap(ops.correctActual(d, 'dash@2026-10-19', { amountCents: usd(290), date: '2026-10-19' }, clock));
    expect(work(d, 's2').paidByOccurrenceId).toBe('dash@2026-10-19');
    expect(d.records.find((r) => r.id === 'dash@2026-10-19')!.actualAmountCents).toBe(usd(290));
    // Moved by hand: not to a payout that arrived before the session was worked (E6), and not to another income's.
    expectError(ops.setShiftPaid(d, 's1', 'dash@2026-10-12', clock), /arrived before this work was done/);
    expectError(ops.setShiftPaid(d, 's3', 'dash@2026-10-19', clock), /from this income/);
    d = unwrap(ops.setShiftPaid(d, 's1', null, clock));
    expect(work(d, 's1')).not.toHaveProperty('paidByOccurrenceId');
    d = unwrap(ops.setShiftPaid(d, 's1', 'dash@2026-10-19', clock));
    expect(work(d, 's1').paidByOccurrenceId).toBe('dash@2026-10-19');
    d = unwrap(ops.restoreOccurrence(d, 'dash@2026-10-19', clock));
    expect(d.workEntries!.map((e) => e.paidByOccurrenceId)).toEqual([undefined, undefined, undefined, undefined]);
    expect(earnedNotPaid(d, 'dash').cents).toBe(usd(90 + 120 + 80));
  });

  it('a payout not yet received counts as projected; recorded, it counts once at its recorded amount and date', () => {
    let d = worked();
    const f = buildForecast(d, TODAY);
    expect(f.entries.find((e) => e.occurrence.id === 'uber@2026-10-21')).toMatchObject({ counts: true, signedCents: usd(250), date: '2026-10-21' });
    d = unwrap(ops.recordActual(d, 'uber@2026-10-21', { amountCents: usd(55), date: '2026-10-19' }, clock));
    expect(work(d, 's3').paidByOccurrenceId).toBe('uber@2026-10-21');
    expect(buildForecast(d, TODAY).entries.filter((e) => e.occurrence.id === 'uber@2026-10-21' && e.counts).map((e) => e.signedCents)).toEqual([usd(55)]);
  });
});

describe('validation and setup', () => {
  it('a session belongs to gig income, has earnings or cash, and no wage or card tips', () => {
    const d = baseline();
    const base = { sourceId: 'dash', date: '2026-10-18', earningsCents: usd(50) };
    expectError(ops.logSession(d, { ...base, date: '2026-10-20' }, clock), /once it has been worked/);
    expectError(ops.logSession(d, { sourceId: 'dash', date: '2026-10-18', minutes: 120 }, clock), /earnings or the cash/);
    expectError(ops.logShift(d, { ...base, wageCents: 1500 }, clock), /not a wage or card tips/);
    expectError(ops.logSession(d, { ...base, platform: 'x'.repeat(41) }, clock), /platform under 40/);
    expectError(ops.logSession(d, { ...base, sourceId: 'rent' }, clock), /sessions for gig income/);
    const tipped = unwrap(ops.addSource(d, { kind: 'income', description: 'Server', amountCents: usd(600), startDate: TODAY, rule: { type: 'biweekly' }, incomeType: 'tipped' }, clock, 'job'));
    expectError(ops.logSession(tipped, { ...base, sourceId: 'job' }, clock), /not platform earnings/);
    // Zero means none; a blank platform is none.
    const z = unwrap(ops.logSession(d, { ...base, cashTipsCents: 0, platform: '  ' }, clock, 'z'));
    expect(work(z, 'z')).toEqual({ id: 'z', sourceId: 'dash', kind: 'session', date: '2026-10-18', earningsCents: usd(50), createdAt: clock.now, updatedAt: clock.now });
  });

  it('gig income keeps no wage; an income with sessions stays gig, and one with shifts never becomes gig', () => {
    const d = unwrap(ops.setIncomeDetails(baseline(), 'dash', { incomeType: 'gig', hourlyWageCents: 1500 }, clock));
    expect(d.sources.find((s) => s.id === 'dash')).not.toHaveProperty('hourlyWageCents');
    expectError(ops.setIncomeDetails(worked(), 'dash', { incomeType: 'tipped', hourlyWageCents: null }, clock), /stays gig income/);
    expectError(ops.setIncomeDetails(worked(), 'dash', { incomeType: null, hourlyWageCents: null }, clock), /stays gig income/);
    let t = unwrap(ops.addSource(baseline(), { kind: 'income', description: 'Server', amountCents: usd(600), startDate: TODAY, rule: { type: 'biweekly' }, incomeType: 'tipped' }, clock, 'job'));
    t = unwrap(ops.logShift(t, { sourceId: 'job', date: '2026-10-18', minutes: 300 }, clock));
    expectError(ops.setIncomeDetails(t, 'job', { incomeType: 'gig', hourlyWageCents: null }, clock), /stays hourly or tipped/);
    expect(unwrap(ops.setIncomeDetails(t, 'job', { incomeType: 'hourly', hourlyWageCents: null }, clock)).sources.find((s) => s.id === 'job')!.incomeType).toBe('hourly');
  });

  it('deleting a session removes its cash record and leaves the payout that paid it', () => {
    let d = unwrap(ops.recordActual(worked(), 'dash@2026-10-19', { amountCents: usd(287.5), date: '2026-10-19' }, clock));
    const record = work(d, 's1').cashTipsRecordId!;
    d = unwrap(ops.deleteShift(d, 's1'));
    expect(d.records.some((r) => r.id === record)).toBe(false);
    expect(d.records.find((r) => r.id === 'dash@2026-10-19')!.actualAmountCents).toBe(usd(287.5));
  });
});
