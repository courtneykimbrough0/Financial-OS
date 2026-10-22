import { beforeEach, describe, expect, it } from 'vitest';
import { activityView, recordedEntries } from '../../domain/activity';
import { clockAt, unwrap, usd } from '../../domain/__tests__/helpers';
import { earningsHistory } from '../../domain/earnings-history';
import { buildForecast, explainTimingGaps } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { cloudCacheKey, CloudAdapter, INCOME_DETAIL_NOT_STORED, POSSIBLE_INCOME_NOT_STORED } from '../cloud';
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
    entries: f.entries.map((e) => [e.occurrence.id, e.date, e.signedCents, e.counts, e.possible ?? false]),
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
  it('counts each dollar once: earned work and possible income stay out of cash flow', () => {
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
    // Unpaid earnings, done jobs and possible income are listed, not counted.
    expect(earnings.notReceived.map((n) => [n.source.id, n.cents])).toEqual([['gig', usd(70)]]);
    expect(earnings.jobs.doneNotPaidCents).toBe(usd(300));
    const possible = f.entries.filter((e) => e.possible);
    expect(possible.map((e) => e.occurrence.sourceId ?? e.occurrence.id).sort()).toEqual(expect.arrayContaining(['bonus', 'tutor']));
    expect(possible.every((e) => !e.counts && e.signedCents === 0)).toBe(true);
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
    ['possible income', () => unwrap(ops.addOneTime(base(), { kind: 'income', description: 'Maybe', amountCents: usd(50), date: '2026-10-30', certainty: 'possible' }, clock)), POSSIBLE_INCOME_NOT_STORED],
    ['hourly income', () => unwrap(ops.setIncomeDetails(base(), 'pay', { incomeType: 'hourly', hourlyWageCents: 1500 }, clock)), INCOME_DETAIL_NOT_STORED],
    ['gig income', () => unwrap(ops.setIncomeDetails(base(), 'pay', { incomeType: 'gig', hourlyWageCents: null }, clock)), INCOME_DETAIL_NOT_STORED],
    ['a client alone', () => unwrap(ops.addClient(base(), 'Acme', clock)), INCOME_DETAIL_NOT_STORED],
    ['every kind at once', incomePlan, POSSIBLE_INCOME_NOT_STORED],
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
