import { beforeEach, describe, expect, it } from 'vitest';
import { activityView, recordedEntries } from '../../domain/activity';
import { clockAt, unwrap, usd } from '../../domain/__tests__/helpers';
import { earningsHistory } from '../../domain/earnings-history';
import { buildForecast, explainTimingGaps } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { cloudCacheKey, CloudAdapter, INCOME_DETAIL_NOT_STORED } from '../cloud';
import { LocalStorageAdapter, migrate } from '../storage';
import { SupabaseStorageAdapter } from '../supabase/adapter';
import { canonicalize, checkForMigration } from '../supabase/rows';
import { FakeSupabase } from '../supabase/__tests__/fake-supabase';
import { incomePlan, TODAY } from '../supabase/__tests__/fixtures';
import { FakeServer } from './fake-server';

// E6: every kind of income at once (fixtures' incomePlan), through every storage. Friday Oct 16, 2026.
const clock = clockAt(TODAY);
const OCT = ['2026-10-01', '2026-10-31'] as const;
const DAYS = [TODAY, '2026-11-15', '2027-01-16'];

/** Everything the app shows from a plan on a day: counted entries, timing gaps, the month's Activity and earnings. */
function outcomes(d: AppData, today: string) {
  const f = buildForecast(d, today, { through: OCT[1] });
  return {
    entries: f.entries.map((e) => [e.occurrence.id, e.date, e.signedCents, e.counts]),
    gaps: explainTimingGaps(f),
    activity: activityView(f, ...OCT).summary,
    earnings: earningsHistory(d, recordedEntries(f, ...OCT), ...OCT, today),
  };
}
const same = (a: AppData, b: AppData) => {
  for (const day of DAYS) expect(outcomes(b, day)).toEqual(outcomes(a, day));
};

beforeEach(() => localStorage.clear());

describe('one plan with every kind of income', () => {
  it('counts each dollar once: earned work stays out of cash flow, and irregular income counts as projected', () => {
    const d = incomePlan();
    const f = buildForecast(d, TODAY, { through: OCT[1] });
    const activity = activityView(f, ...OCT).summary;
    const earnings = earningsHistory(d, recordedEntries(f, ...OCT), ...OCT, TODAY);
    // Received in October is exactly the completed income records dated in it, each once.
    const received = d.records.filter((r) => r.kind === 'income' && r.status === 'completed' && r.actualDate! >= OCT[0] && r.actualDate! <= OCT[1]);
    expect(activity.incomeCents).toBe(received.reduce((n, r) => n + r.actualAmountCents!, 0));
    // Received for work is part of that, never more: the paycheck, payout, cash tips, session cash and job payment.
    expect(earnings.received.map((r) => r.for).sort()).toEqual(['cash-tips', 'job-payment', 'paycheck', 'payout', 'session-cash']);
    expect(earnings.receivedCents).toBe(usd(212.4 + 290 + 42.5 + 12 + 780));
    // Unpaid earnings and done jobs are listed, not counted.
    expect(earnings.notReceived.map((n) => [n.source.id, n.cents])).toEqual([['gig', usd(70)]]);
    expect(earnings.jobs.doneNotPaidCents).toBe(usd(300));
    // Tutoring (every 2 weeks from Oct 20) and the one-time bonus are projections: they count on their dates.
    const projected = f.entries.filter((e) => (e.occurrence.sourceId ?? e.occurrence.id) === 'tutor' || e.occurrence.id === 'bonus').filter((e) => e.date <= OCT[1]);
    expect(projected.map((e) => [e.date, e.signedCents, e.counts, e.occurrence.status])).toEqual([
      ['2026-10-20', usd(120), true, 'scheduled'],
      ['2026-10-30', usd(250), true, 'scheduled'],
    ]);
    // Removing every shift, session and job (keeping their money records) changes no counted figure.
    const bare: AppData = { ...d, workEntries: [], jobs: [], clients: [] };
    const counted = (x: AppData) => buildForecast(x, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);
    expect(counted(bare)).toEqual(counted(d));
  });

  it('device storage: saved, reloaded and backed up, it is the same plan with the same figures', async () => {
    const d = incomePlan();
    expect(await new LocalStorageAdapter().save(d, 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new LocalStorageAdapter().load();
    expect(loaded).toEqual({ ...d, revision: 1 });
    same(d, loaded);
    const restored = readBackup(createBackup(loaded).text).data;
    expect(restored).toEqual(loaded);
    same(d, restored);
  });

  it('Supabase: nothing the database would refuse, and it comes back the same (canonical form)', async () => {
    const d = incomePlan();
    expect(checkForMigration(d).filter((i) => i.level === 'error')).toEqual([]);
    const fake = new FakeSupabase();
    const adapter = new SupabaseStorageAdapter(fake, () => 'save-1');
    await adapter.load();
    expect(await adapter.save(d, 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new SupabaseStorageAdapter(fake, () => 'save-2').load();
    expect(loaded).toEqual({ ...canonicalize(d), revision: 1 });
    same(d, loaded);
  });
});

describe('legacy Firebase accounts refuse income they can’t keep, before anything is written', () => {
  const base = () => unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Pay', amountCents: usd(500), startDate: TODAY, rule: { type: 'weekly' } }, clock, 'pay'));
  const cases: [string, () => AppData, string][] = [
    ['hourly income', () => unwrap(ops.setIncomeDetails(base(), 'pay', { incomeType: 'hourly', hourlyWageCents: 1500 }, clock)), INCOME_DETAIL_NOT_STORED],
    ['gig income', () => unwrap(ops.setIncomeDetails(base(), 'pay', { incomeType: 'gig', hourlyWageCents: null }, clock)), INCOME_DETAIL_NOT_STORED],
    ['a client alone', () => unwrap(ops.addClient(base(), 'Acme', clock)), INCOME_DETAIL_NOT_STORED],
    ['every kind at once', incomePlan, INCOME_DETAIL_NOT_STORED],
  ];
  it.each(cases)('%s', async (_name, plan, message) => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage);
    await adapter.load();
    expect(await adapter.save(plan(), 0)).toEqual({ ok: false, reason: 'error', message });
    expect(server.row).toBeNull();
    expect(localStorage.getItem(cloudCacheKey('user-1'))).toBeNull();
  });

  it('the refusal names gig income and sessions', () => {
    expect(INCOME_DETAIL_NOT_STORED).toMatch(/gig income/);
    expect(INCOME_DETAIL_NOT_STORED).toMatch(/sessions/);
  });
});

describe('restoring or loading damaged income data', () => {
  it('drops broken links and impossible work, keeps the money records, and the figures follow the money', () => {
    const d = incomePlan();
    const raw = JSON.parse(JSON.stringify(d));
    const entry = (id: string) => raw.workEntries.find((e: { id: string }) => e.id === id);
    entry('shift-1').paidByOccurrenceId = 'side@2030-01-04'; // a paycheck that was never recorded
    entry('session-2').cashTipsRecordId = 'missing'; // cash that isn't there
    raw.workEntries.push({ id: 'orphan', sourceId: 'gone', kind: 'shift', date: '2026-10-10', minutes: 60 });
    raw.jobs.find((j: { id: string }) => j.id === 'job-brochure').clientId = 'gone';
    raw.jobs.push({ id: 'twin', description: 'Twin', amountCents: 100, status: 'done', paymentRecordId: d.jobs!.find((j) => j.id === 'job-logo')!.paymentRecordId, createdAt: clock.now, updatedAt: clock.now });
    const read = readBackup(createBackup(raw as AppData).text).data;
    expect(read.workEntries!.find((e) => e.id === 'shift-1')).not.toHaveProperty('paidByOccurrenceId');
    expect(read.workEntries!.some((e) => e.id === 'orphan')).toBe(false);
    expect(read.jobs!.find((j) => j.id === 'job-brochure')).not.toHaveProperty('clientId');
    expect(read.jobs!.filter((j) => j.paymentRecordId === d.jobs!.find((x) => x.id === 'job-logo')!.paymentRecordId).map((j) => j.id)).toEqual(['job-logo']);
    // Every money record survives, so counted figures are the same as before the damage.
    expect(read.records).toEqual(d.records);
    const counted = (x: AppData) => buildForecast(x, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);
    expect(counted(read)).toEqual(counted(d));
    expect(migrate(JSON.parse(JSON.stringify(read)))).toEqual(read);
  });
});

describe('editing an income that hasn’t started yet keeps its logged work (E6 fix)', () => {
  /** A tipped job whose first paycheck is Nov 2, with a shift already worked. Nothing recorded, so the whole item can still be redefined. */
  function newJob() {
    let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'New job', amountCents: usd(600), startDate: '2026-11-02', rule: { type: 'biweekly' }, incomeType: 'tipped', hourlyWageCents: 1500 }, clock, 'job'));
    d = unwrap(ops.logShift(d, { sourceId: 'job', date: TODAY, minutes: 300, wageCents: 1500, cashTipsCents: usd(30) }, clock, 's1'));
    expect(ops.sourceHasNoHistory(d, 'job', TODAY)).toBe(true);
    return d;
  }
  const redefine = (d: AppData, incomeType: 'hourly' | 'gig' | null) =>
    ops.redefineSource(d, 'job', { description: 'New job', amountCents: usd(650), startDate: '2026-11-02', rule: { type: 'biweekly' }, incomeType, hourlyWageCents: incomeType === 'hourly' ? 1550 : null }, clock);

  it('a change to fixed or gig is refused, as it is for an income with history', () => {
    expect(redefine(newJob(), null)).toEqual({ ok: false, error: 'This income has logged shifts, so it stays hourly or tipped.' });
    expect(redefine(newJob(), 'gig')).toEqual({ ok: false, error: 'This income has logged shifts, so it stays hourly or tipped.' });
  });

  it('hourly is allowed, and the shift survives a reload and the Supabase checks', () => {
    const d = unwrap(redefine(newJob(), 'hourly'));
    expect(d.sources[0]).toMatchObject({ incomeType: 'hourly', hourlyWageCents: 1550 });
    expect(migrate(JSON.parse(JSON.stringify(d))).workEntries!.map((e) => e.id)).toEqual(['s1']);
    expect(checkForMigration(d).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('sessions keep a gig income gig', () => {
    let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Deliveries', amountCents: usd(300), startDate: '2026-11-02', rule: { type: 'weekly' }, incomeType: 'gig' }, clock, 'job'));
    d = unwrap(ops.logSession(d, { sourceId: 'job', date: TODAY, earningsCents: usd(40) }, clock, 'g1'));
    expect(redefine(d, 'hourly')).toEqual({ ok: false, error: 'This income has logged sessions, so it stays gig income.' });
    expect(unwrap(redefine(d, 'gig')).workEntries).toHaveLength(1);
  });
});

describe('a paycheck or payout pays only work done before it arrived (E6 fix)', () => {
  // incomePlan: the side job's Oct 17 paycheck, recorded Oct 16, pays shift-1 (Oct 14) and shift-2 (Oct 15);
  // the Oct 12 payout pays session-1 (Oct 8); session-2 (Oct 14) waits.
  const paidBy = (d: AppData) => Object.fromEntries(d.workEntries!.map((e) => [e.id, e.paidByOccurrenceId ?? null]));
  const counted = (x: AppData) => buildForecast(x, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);
  /** The same correction made with no work logged: what cash flow must be either way. */
  const moneyOnly = (d: AppData, id: string, actual: { amountCents: number; date: string }) => counted(unwrap(ops.correctActual({ ...d, workEntries: [] }, id, actual, clock)));

  it('corrected to an earlier date, it no longer pays work done after that date; the payment itself and every figure stay as corrected', () => {
    const d = incomePlan();
    const fixed = unwrap(ops.correctActual(d, 'side@2026-10-17', { amountCents: usd(205), date: '2026-10-14' }, clock));
    expect(paidBy(fixed)).toEqual({ 'shift-1': 'side@2026-10-17', 'shift-2': null, 'session-1': 'gig@2026-10-12', 'session-2': null });
    expect(fixed.records.find((r) => r.id === 'side@2026-10-17')).toMatchObject({ status: 'completed', actualDate: '2026-10-14', actualAmountCents: usd(205) });
    expect(fixed.records.filter((r) => r.id !== 'side@2026-10-17')).toEqual(d.records.filter((r) => r.id !== 'side@2026-10-17'));
    expect(counted(fixed)).toEqual(moneyOnly(d, 'side@2026-10-17', { amountCents: usd(205), date: '2026-10-14' }));
    // A payout moved to before its session was worked lets the session wait again.
    const payout = unwrap(ops.correctActual(d, 'gig@2026-10-12', { amountCents: usd(290), date: '2026-10-07' }, clock));
    expect(paidBy(payout)['session-1']).toBeNull();
    expect(counted(payout)).toEqual(moneyOnly(d, 'gig@2026-10-12', { amountCents: usd(290), date: '2026-10-07' }));
  });

  it('a correction that keeps the work before the payment, or moves it later, keeps every link; undo still unpays all', () => {
    const d = incomePlan();
    for (const date of ['2026-10-15', '2026-10-16']) {
      expect(paidBy(unwrap(ops.correctActual(d, 'side@2026-10-17', { amountCents: usd(212.4), date }, clock)))).toEqual(paidBy(d));
    }
    const moved = unwrap(ops.correctActual(d, 'side@2026-10-17', { amountCents: usd(212.4), date: '2026-10-14' }, clock));
    const undone = unwrap(ops.restoreOccurrence(moved, 'side@2026-10-17', clock));
    expect(paidBy(undone)).toEqual({ 'shift-1': null, 'shift-2': null, 'session-1': 'gig@2026-10-12', 'session-2': null });
  });

  it('moving a paid shift past its paycheck unpays it, and a paycheck that came first can’t be chosen by hand', () => {
    const d = incomePlan();
    const later = unwrap(ops.editShift(d, 'shift-2', { date: '2026-10-16', minutes: 240, wageCents: 1600 }, clock));
    expect(paidBy(later)['shift-2']).toBe('side@2026-10-17');
    // On payday it can still be paid by it; the day after, it can't.
    const after = unwrap(ops.editShift(d, 'shift-1', { date: '2026-10-17', minutes: 330, wageCents: 1600, cashTipsCents: usd(42.5), cardTipsCents: usd(31) }, { today: '2026-10-17', now: '2026-10-17T12:00:00.000Z' }));
    expect(paidBy(after)['shift-1']).toBeNull();
    expect(paidBy(after)['shift-2']).toBe('side@2026-10-17');
    const unpaid = unwrap(ops.correctActual(d, 'side@2026-10-17', { amountCents: usd(212.4), date: '2026-10-14' }, clock));
    expect(ops.setShiftPaid(unpaid, 'shift-2', 'side@2026-10-17', clock)).toEqual({ ok: false, error: 'That paycheck arrived before this work was done, so it could not have paid it.' });
    expect(ops.setShiftPaid(unpaid, 'session-2', 'gig@2026-10-12', clock).ok).toBe(false);
  });

  it('stored links to a paycheck that arrived before the work are dropped on load; valid ones stay', () => {
    const d = incomePlan();
    const raw = JSON.parse(JSON.stringify(d));
    raw.records.find((r: { id: string }) => r.id === 'side@2026-10-17').actualDate = '2026-10-14'; // as data saved before this fix could hold it
    const read = migrate(raw);
    expect(paidBy(read)).toEqual({ 'shift-1': 'side@2026-10-17', 'shift-2': null, 'session-1': 'gig@2026-10-12', 'session-2': null });
    expect(read.records).toEqual(raw.records);
  });

  it('earnings history shows the unpaid work as not received yet, and receipts unchanged', () => {
    const d = incomePlan();
    const fixed = unwrap(ops.correctActual(d, 'side@2026-10-17', { amountCents: usd(205), date: '2026-10-14' }, clock));
    const history = (x: AppData) => {
      const f = buildForecast(x, TODAY, { through: OCT[1] });
      return earningsHistory(x, recordedEntries(f, ...OCT), ...OCT, TODAY);
    };
    // shift-2: 4 h × $16 = $64 in wages, now waiting for a paycheck.
    expect(history(fixed).notReceived.map((n) => [n.source.id, n.cents])).toEqual([['side', usd(64)], ['gig', usd(70)]]);
    expect(history(fixed).received.map((r) => [r.entry.occurrence.id, r.entry.date, r.entry.amountCents])).toContainEqual(['side@2026-10-17', '2026-10-14', usd(205)]);
    expect(history(fixed).work).toEqual(history(d).work);
  });
});
