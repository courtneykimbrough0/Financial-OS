import { describe, expect, it } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../../domain/__tests__/helpers';
import { activityView, recordedEntries } from '../../../domain/activity';
import { accountBalance } from '../../../domain/balances';
import { earningsHistory } from '../../../domain/earnings-history';
import { buildForecast, explainTimingGaps } from '../../../domain/forecast';
import { variance } from '../../../domain/occurrences';
import * as ops from '../../../domain/operations';
import type { AppData } from '../../../domain/types';
import { canonicalize, toRows } from '../rows';
import { incomePlan, richPlan, TODAY, withAccounts, withJobs, withSessions, withShifts } from './fixtures';
import { count, load, newUser, save, saveOk, savePlan, sql, workspaceOf } from './pg';

const clock = clockAt(TODAY);

/**
 * Electricity $180 on the 3rd from Sep 3, paid $1,000 every other Friday from
 * Oct 23 (so the forecast has a running total), rent $1,500 from Nov 1.
 */
function plan(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, '2026-09-01', 'bill', 'Electricity', 180, '2026-09-03', { type: 'monthly' }, 'elec');
  d = source(d, TODAY, 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  return source(d, TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
}

function stored(d: AppData = plan()) {
  const user = newUser();
  const r = save(user, { ...d, revision: 0 }, { mode: 'replace' });
  if (!r.ok) throw new Error(r.message!);
  return { user, data: load(user) };
}

/** Every forecast entry for one occurrence, as [date, amount, counts]. */
const entries = (d: AppData, id: string, today = TODAY) => buildForecast(d, today).entries.filter((e) => e.occurrence.id === id).map((e) => [e.date, e.amountCents, e.counts]);
const rowsFor = (user: string, id: string) => count(`select count(*) from public.occurrence_records where workspace_id = '${workspaceOf(user)}' and id = '${id}'`);

describe('each event counts once, as itself', () => {
  it('a forecast payment recorded at a different amount counts once, at the actual', () => {
    const { user, data } = stored();
    const back = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(230), date: '2026-10-03' }, clock)));
    expect(entries(back, 'elec@2026-10-03')).toEqual([['2026-10-03', 23000, true]]);
    const r = back.records.find((x) => x.id === 'elec@2026-10-03')!;
    expect([r.expectedAmountCents, r.actualAmountCents]).toEqual([18000, 23000]);
    expect(variance(r)).toEqual({ amountCents: 5000, days: 0 });
    expect(rowsFor(user, 'elec@2026-10-03')).toBe(1);
  });

  it('an early payment counts on its actual date, and not again on the due date', () => {
    const { user, data } = stored();
    const back = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-11-03', { amountCents: usd(180), date: TODAY }, clock)));
    expect(entries(back, 'elec@2026-11-03')).toEqual([[TODAY, 18000, true]]);
    expect(variance(back.records[0]!)).toEqual({ amountCents: 0, days: -18 });
  });

  it('a late payment counts on its actual date', () => {
    const { user, data } = stored();
    const back = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-09-03', { amountCents: usd(180), date: '2026-09-10' }, clock)));
    expect(entries(back, 'elec@2026-09-03')).toEqual([['2026-09-10', 18000, true]]);
  });

  it('a moved payment keeps its identity and counts only on its new date', () => {
    const { user, data } = stored();
    const back = saveOk(user, unwrap(ops.rescheduleOccurrence(data, 'elec@2026-11-03', { date: '2026-11-06', amountCents: usd(180) }, clock)));
    expect(entries(back, 'elec@2026-11-03')).toEqual([['2026-11-06', 18000, true]]);
    expect(back.records[0]).toMatchObject({ id: 'elec@2026-11-03', expectedDate: '2026-11-03', scheduledDate: '2026-11-06' });
  });

  it("a canceled payment is kept and never counts, and isn't an actual", () => {
    const { user, data } = stored();
    const back = saveOk(user, unwrap(ops.cancelOccurrence(data, 'elec@2026-12-03', 'Moved out', clock)));
    expect(entries(back, 'elec@2026-12-03')).toEqual([['2026-12-03', 18000, false]]);
    expect(back.records[0]).toMatchObject({ status: 'canceled', actualDate: null, actualAmountCents: null });
  });

  it('undoing a payment or a cancellation returns it to the schedule without an extra event', () => {
    const { user, data } = stored();
    let back = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(230), date: '2026-10-03' }, clock)));
    back = saveOk(user, unwrap(ops.restoreOccurrence(back, 'elec@2026-10-03', clock)));
    expect(back.records).toEqual([]);
    expect(rowsFor(user, 'elec@2026-10-03')).toBe(0);
    // Overdue and unpaid again: a projection on its own date, once, at the expected amount.
    expect(entries(back, 'elec@2026-10-03')).toEqual([['2026-10-03', 18000, true]]);
    back = saveOk(user, unwrap(ops.cancelOccurrence(back, 'elec@2026-12-03', '', clock)));
    back = saveOk(user, unwrap(ops.restoreOccurrence(back, 'elec@2026-12-03', clock)));
    expect(back.records).toEqual([]);
    expect(entries(back, 'elec@2026-12-03')).toEqual([['2026-12-03', 18000, true]]);
  });

  it("a schedule change after a payment keeps the payment and doesn't bring the occurrence back", () => {
    const { user, data } = stored();
    let back = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(230), date: '2026-10-03' }, clock)));
    back = saveOk(user, unwrap(ops.changeSourceSchedule(back, 'elec', { startDate: '2026-10-20', amountCents: usd(200), rule: { type: 'monthly' } }, clock)));
    expect(entries(back, 'elec@2026-10-03')).toEqual([['2026-10-03', 23000, true]]);
    // (Sep 3 is still unpaid, an overdue projection on its own date; this looks at October onwards.)
    expect(buildForecast(back, TODAY).entries.filter((e) => e.occurrence.sourceId === 'elec' && e.occurrence.expectedDate >= '2026-10-01' && e.date <= '2026-11-30').map((e) => [e.occurrence.id, e.date, e.amountCents])).toEqual([
      ['elec@2026-10-03', '2026-10-03', 23000],
      ['elec@2026-10-20', '2026-10-20', 20000],
      ['elec@2026-11-20', '2026-11-20', 20000],
    ]);
  });

  it('a moved payment the new schedule no longer produces is kept but not counted, and never doubled', () => {
    const { user, data } = stored();
    let back = saveOk(user, unwrap(ops.rescheduleOccurrence(data, 'elec@2026-11-03', { date: '2026-11-06', amountCents: usd(180) }, clock)));
    back = saveOk(user, unwrap(ops.changeSourceSchedule(back, 'elec', { startDate: '2026-10-20', amountCents: usd(200), rule: { type: 'monthly' } }, clock)));
    expect(rowsFor(user, 'elec@2026-11-03')).toBe(1);
    expect(entries(back, 'elec@2026-11-03')).toEqual([]);
    expect(entries(back, 'elec@2026-11-20')).toEqual([['2026-11-20', 20000, true]]);
  });

  it('saving the same completed event again, or with an unrelated change, keeps one record', () => {
    const { user, data } = stored();
    let back = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(230), date: '2026-10-03' }, clock)));
    back = saveOk(user, back);
    back = saveOk(user, unwrap(ops.addOneTime(back, { kind: 'varied', description: 'Repair', amountCents: usd(80), date: '2026-11-05' }, clock, 'one-rep')));
    expect(rowsFor(user, 'elec@2026-10-03')).toBe(1);
    expect(entries(back, 'elec@2026-10-03')).toEqual([['2026-10-03', 23000, true]]);
    expect(back.revision).toBe(4);
  });

  it("refuses a repeated occurrence id, an id that isn't its source and date, and a second record for one occurrence", () => {
    const { user, data } = stored();
    const rows = toRows(unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(230), date: '2026-10-03' }, clock)));
    const twice = savePlan(user, data.revision, { ...rows, records: [rows.records[0]!, { ...rows.records[0]!, position: 1 }] });
    expect([twice.code, twice.message]).toEqual(['PT422', 'The plan has missing or repeated ids.']);
    const wrongId = savePlan(user, data.revision, { ...rows, records: [{ ...rows.records[0]!, id: 'elec@2026-10-04' }] });
    expect(wrongId.code).toBe('23514');
    // Even the database owner can't store two records for one occurrence.
    const ws = workspaceOf(user);
    saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(230), date: '2026-10-03' }, clock)));
    const direct = sql('owner', `insert into public.occurrence_records (workspace_id, id, position, source_id, kind, description, expected_date, expected_amount_cents, scheduled_date, scheduled_amount_cents, status, created_at, updated_at)
      values ('${ws}', 'elec@2026-10-03', 9, 'elec', 'bill', 'Electricity', '2026-10-03', 18000, '2026-10-03', 18000, 'scheduled', now(), now());`);
    expect(direct.code).toBe('23505');
  });
});

describe('the six classifications', () => {
  it('stores reserves and varied spending, and refuses retired kinds, one-time obligations and recurring varied spending', () => {
    const { user, data } = stored();
    let d = source(data, TODAY, 'reserve', 'Emergency fund', 100, '2026-10-24', { type: 'biweekly' }, 'res');
    d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(80), date: '2026-11-05' }, clock, 'one-rep'));
    d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Bonus set aside', amountCents: usd(300), date: '2026-11-06' }, clock, 'one-res'));
    const back = saveOk(user, d);
    expect(back.sources.find((s) => s.id === 'res')!.kind).toBe('reserve');
    expect(back.records.map((r) => [r.id, r.kind])).toEqual([
      ['one-rep', 'varied'],
      ['one-res', 'reserve'],
    ]);
    const rows = toRows(back);
    const one = rows.records.find((r) => r.id === 'one-rep')!;
    // A restore (replace) may write any record, so only the table's own rules can refuse these.
    const rec = (kind: string) => savePlan(user, back.revision, { ...rows, records: rows.records.map((r) => (r.id === one.id ? { ...r, kind } : r)) as never }, { mode: 'replace' });
    for (const kind of ['bill', 'subscription', 'liability', 'savings']) expect([kind, rec(kind).code]).toEqual([kind, '23514']);
    const src = (kind: string) => savePlan(user, back.revision, { ...rows, sources: rows.sources.map((s) => (s.id === 'res' ? { ...s, kind } : s)) as never }, { mode: 'replace' });
    for (const kind of ['varied', 'savings']) expect(src(kind).code).toBe('23514');
    expect(load(user)).toEqual(back);
  });
});

describe('deleting, replacing and starting over', () => {
  it('a batch of due items is saved in one save, and one of them can be undone', () => {
    const { user, data } = stored();
    const ids = ['elec@2026-09-03', 'elec@2026-10-03', 'pay@2026-10-23', 'elec@2026-11-03', 'rent@2026-11-01', 'pay@2026-11-06'];
    const after = unwrap(ops.recordAsExpected(data, ids, clockAt('2026-11-06')));
    const saved = saveOk(user, after);
    expect(saved.records).toHaveLength(6);
    const undone = saveOk(user, unwrap(ops.restoreOccurrence(saved, 'pay@2026-11-06', clockAt('2026-11-06'))));
    expect(undone.records.map((r) => r.id)).not.toContain('pay@2026-11-06');
  });

  it('an item without history can be removed', () => {
    const { user, data } = stored();
    expect(saveOk(user, unwrap(ops.deleteSource(data, 'rent'))).sources.map((s) => s.id)).toEqual(['elec', 'pay']);
  });

  it("an item with recorded history can't be removed by an ordinary save", () => {
    const { user, data } = stored();
    const paid = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(180), date: '2026-10-03' }, clock)));
    // The app refuses (deleteSource); a client that tried anyway is refused by the database.
    const forged: AppData = { ...paid, sources: paid.sources.filter((s) => s.id !== 'elec'), records: [] };
    const r = save(user, forged);
    expect([r.code, r.message]).toEqual(['PT422', 'An item with recorded history can\'t be removed. Turn it off instead.']);
    expect(load(user).records).toHaveLength(1);
  });

  it("an empty or truncated plan can't erase a populated one in an ordinary save", () => {
    const { user, data } = stored(richPlan());
    const empty = save(user, { ...data, sources: [], records: [] });
    expect(empty.code).toBe('PT422');
    const truncated = save(user, { ...data, sources: data.sources.slice(0, 1), records: [] });
    expect(truncated.code).toBe('PT422');
    const noHistory = stored();
    const r = save(noHistory.user, { ...noHistory.data, sources: [] });
    expect([r.code, r.message]).toEqual(['PT422', 'A save can remove one item at a time. Use Restore or Start over to replace a plan.']);
    expect(load(user)).toEqual(data);
  });

  it('a malformed backup is refused and nothing changes; canceling a restore sends nothing', () => {
    const { user, data } = stored();
    for (const bad of [{}, { ...toRows(richPlan()), versions: 'x' }, { ...toRows(richPlan()), versions: [] }, { ...toRows(richPlan()), onboarding_complete: 'yes' }]) {
      const r = savePlan(user, data.revision, bad, { mode: 'replace' });
      expect(r.code).toBe('PT422');
    }
    expect(load(user)).toEqual(data);
  });

  it('an intentional restore replaces the whole plan, history included', () => {
    const { user, data } = stored();
    const backup = richPlan();
    const back = saveOk(user, { ...backup, revision: data.revision }, 'replace');
    expect(back).toEqual({ ...backup, revision: 2 });
  });

  it('a replacement that fails partway leaves the old plan exactly as it was', () => {
    const { user, data } = stored();
    const rows = toRows(richPlan());
    const lastBad = { ...rows, records: rows.records.map((r, i) => (i === rows.records.length - 1 ? { ...r, cancel_note: 'x', status: 'completed' } : r)) };
    const r = savePlan(user, data.revision, lastBad, { mode: 'replace' });
    expect(r.ok).toBe(false);
    expect(load(user)).toEqual(data);
  });

  it('start over empties the plan back to setup; a backup restores it', () => {
    const { user, data } = stored(richPlan());
    const original = data;
    const reset = saveOk(user, unwrap(ops.startOver(original)), 'reset');
    expect(reset).toEqual({ schemaVersion: 2, revision: 2, onboardingComplete: false, sources: [], records: [] });
    // Start over can't be used to replace a plan with something else.
    const sneaky = save(user, { ...original, revision: reset.revision }, { mode: 'reset' });
    expect([sneaky.code, sneaky.message]).toEqual(['PT422', 'Starting over needs an empty plan in setup.']);
    const restored = saveOk(user, { ...original, revision: reset.revision }, 'replace');
    expect(restored).toEqual({ ...original, revision: 3 });
  });
});

describe('history is kept, legitimate corrections still work', () => {
  it('changing a future amount, moving, recording, correcting and undoing all save', () => {
    const { user, data } = stored();
    let d = saveOk(user, unwrap(ops.changeSourceSchedule(data, 'elec', { startDate: '2026-11-03', amountCents: usd(200), rule: { type: 'monthly' } }, clock)));
    expect(d.sources.find((s) => s.id === 'elec')!.versions.map((v) => [v.startDate, v.amountCents])).toEqual([
      ['2026-09-03', 18000],
      ['2026-11-03', 20000],
    ]);
    d = saveOk(user, unwrap(ops.rescheduleOccurrence(d, 'elec@2026-12-03', { date: '2026-12-05', amountCents: usd(210) }, clock)));
    d = saveOk(user, unwrap(ops.recordActual(d, 'elec@2026-10-03', { amountCents: usd(175), date: '2026-10-04' }, clock)));
    d = saveOk(user, unwrap(ops.correctActual(d, 'elec@2026-10-03', { amountCents: usd(185), date: '2026-10-05' }, clock)));
    const r = d.records.find((x) => x.id === 'elec@2026-10-03')!;
    expect([r.expectedDate, r.expectedAmountCents, r.actualDate, r.actualAmountCents]).toEqual(['2026-10-03', 18000, '2026-10-05', 18500]);
    expect(d.records.find((x) => x.id === 'elec@2026-12-03')).toMatchObject({ expectedAmountCents: 20000, scheduledAmountCents: 21000, scheduledDate: '2026-12-05' });
    d = saveOk(user, unwrap(ops.restoreOccurrence(d, 'elec@2026-10-03', clock)));
    expect(d.records.map((x) => x.id)).toEqual(['elec@2026-12-03']);
  });

  it("an ordinary save can't rewrite an original prediction or an existing schedule", () => {
    const { user, data } = stored();
    const paid = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(230), date: '2026-10-03' }, clock)));
    const rewritten: AppData = { ...paid, records: paid.records.map((r) => ({ ...r, expectedAmountCents: 23000 })) };
    expect(save(user, rewritten).message).toBe('A save can\'t change an original prediction.');
    const repriced: AppData = { ...paid, sources: paid.sources.map((s) => (s.id === 'elec' ? { ...s, versions: s.versions.map((v) => ({ ...v, amountCents: 99900 })) } : s)) };
    expect(save(user, repriced).message).toBe('A save can\'t rewrite an existing schedule. Changes start a new schedule from a date.');
    expect(load(user)).toEqual(paid);
  });

  it("a restore can bring back a backup's own predictions and schedules", () => {
    const { user, data } = stored();
    const backup = richPlan();
    const back = saveOk(user, { ...backup, revision: data.revision }, 'replace');
    expect(back.sources.find((s) => s.id === 'pay')!.versions.map((v) => [v.startDate, v.amountCents])).toEqual([
      ['2026-06-05', 100000],
      ['2026-10-30', 108000],
    ]);
    expect(back.records.find((r) => r.id === 'elec@2026-06-03')).toMatchObject({ expectedAmountCents: 18000, actualAmountCents: 20500 });
  });

  it('going back to setup is refused in an ordinary save', () => {
    const { user, data } = stored();
    expect(save(user, { ...data, onboardingComplete: false }).message).toBe('Use Start over to go back to setup.');
  });
});

describe('retired income certainty (C1)', () => {
  const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);
  const marked = (user: string) =>
    count(`select count(*) from public.sources where workspace_id = '${workspaceOf(user)}' and certainty is not null`) +
    count(`select count(*) from public.occurrence_records where workspace_id = '${workspaceOf(user)}' and certainty is not null`);

  it('a row marked possible before C1 loads as projected income that counts, and the next save clears the mark', () => {
    const { user, data } = stored();
    let d = unwrap(ops.addSource(data, { kind: 'income', description: 'Tips', amountCents: usd(200), startDate: '2026-10-17', rule: { type: 'weekly' } }, clock, 'tips'));
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Invoice', amountCents: usd(500), date: '2026-10-28' }, clock, 'one-inv'));
    const saved = saveOk(user, d);
    expect(marked(user)).toBe(0);
    // As a pre-C1 app would have stored them.
    const ws = workspaceOf(user);
    expect(sql('owner', `update public.sources set certainty = 'possible' where workspace_id = '${ws}' and id = 'tips'; update public.occurrence_records set certainty = 'possible' where workspace_id = '${ws}' and id = 'one-inv';`).ok).toBe(true);
    expect(marked(user)).toBe(2);

    const back = load(user);
    expect(JSON.stringify(back)).not.toContain('certainty');
    expect(back).toEqual(saved);
    expect(counted(back)).toEqual(counted(d));
    expect(counted(back).filter(([id]) => id === 'one-inv' || String(id).startsWith('tips@')).length).toBeGreaterThan(1);

    saveOk(user, unwrap(ops.updateSourceDetails(back, 'tips', { description: 'Tips', tags: ['work'] }, clock)));
    expect(marked(user)).toBe(0);
  });

  it('a plan saved now stores no certainty, through every kind of change', () => {
    const { user } = stored(richPlan());
    const ws = workspaceOf(user);
    expect(count(`select count(*) from public.sources where workspace_id = '${ws}' and certainty is not null`)).toBe(0);
    expect(count(`select count(*) from public.occurrence_records where workspace_id = '${ws}' and certainty is not null`)).toBe(0);
  });

  it('the database refuses a certainty on anything but income, on a recurring occurrence, or with another value', () => {
    const { user, data } = stored();
    const d = unwrap(ops.addOneTime(data, { kind: 'income', description: 'Refund', amountCents: usd(40), date: '2026-10-28' }, clock, 'one-ref'));
    const back = saveOk(user, unwrap(ops.recordActual(d, 'elec@2026-10-03', { amountCents: usd(180), date: '2026-10-03' }, clock)));
    const rows = toRows(back);
    const replace = (patch: Partial<typeof rows>) => savePlan(user, back.revision, { ...rows, ...patch } as never, { mode: 'replace' });
    expect(replace({ sources: rows.sources.map((s) => (s.id === 'rent' ? { ...s, certainty: 'possible' as const } : s)) }).code).toBe('23514');
    expect(replace({ records: rows.records.map((r) => (r.id === 'elec@2026-10-03' ? { ...r, certainty: 'possible' as const } : r)) }).code).toBe('23514');
    expect(replace({ records: rows.records.map((r) => (r.id === 'one-ref' ? { ...r, certainty: 'maybe' as never } : r)) }).code).toBe('23514');
    expect(replace({ sources: rows.sources.map((s) => (s.id === 'pay' ? { ...s, certainty: 'expected' as never } : s)) }).code).toBe('23514');
    expect(load(user)).toEqual(back);
  });
});

describe('hourly and tipped income (E2)', () => {
  const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);

  it('stores income type, wage and shifts, reads them back exactly, and the forecast is unchanged by the round trip', () => {
    const plan = withShifts(richPlan());
    const { user, data } = stored(plan);
    expect(data.sources.find((s) => s.id === 'side')).toMatchObject({ incomeType: 'tipped', hourlyWageCents: 1600 });
    expect(data.workEntries).toEqual(plan.workEntries!.map((e) => ({ ...e, createdAt: expect.any(String), updatedAt: expect.any(String) })));
    const tipsId = data.workEntries![0]!.cashTipsRecordId!;
    expect(data.records.find((r) => r.id === tipsId)).toMatchObject({ status: 'completed', actualAmountCents: usd(42.5), actualDate: '2026-10-14' });
    expect(counted(data)).toEqual(counted(plan));
    expect(count(`select count(*) from public.work_entries where workspace_id = '${workspaceOf(user)}'`)).toBe(2);
    // Another person can't read them.
    const other = newUser();
    expect(sql({ user: other }, `select count(*) from public.work_entries where workspace_id = '${workspaceOf(user)}';`).out).toBe('0');
  });

  it('ordinary saves: correcting cash tips replaces their record, recording a paycheck pays shifts, deleting one shift is allowed, two at once is not', () => {
    const { user, data } = stored(withShifts(richPlan()));
    const oldTips = data.workEntries![0]!.cashTipsRecordId!;
    let back = saveOk(user, unwrap(ops.editShift(data, 'shift-1', { date: '2026-10-14', minutes: 330, wageCents: 1600, cashTipsCents: usd(50), cardTipsCents: usd(31) }, clock)));
    expect(back.records.some((r) => r.id === oldTips)).toBe(false);
    expect(back.records.find((r) => r.id === back.workEntries![0]!.cashTipsRecordId)!.actualAmountCents).toBe(usd(50));
    back = saveOk(user, unwrap(ops.recordActual(back, 'side@2026-10-17', { amountCents: usd(140), date: '2026-10-16' }, clock)));
    expect(back.workEntries!.map((e) => e.paidByOccurrenceId)).toEqual(['side@2026-10-17', 'side@2026-10-17']);
    const both = { ...back, workEntries: [] };
    expect(save(user, both).code).toBe('PT422');
    back = saveOk(user, unwrap(ops.deleteShift(back, 'shift-2')));
    expect(back.workEntries!.map((e) => e.id)).toEqual(['shift-1']);
  });

  it('the database refuses malformed shifts and income details, and a save that leaves shifts out', () => {
    const { user, data } = stored(withShifts(richPlan()));
    const rows = toRows(data);
    const replace = (patch: Record<string, unknown>) => savePlan(user, data.revision, { ...rows, ...patch } as never, { mode: 'replace' });
    const shift = (patch: Record<string, unknown>) => replace({ work_entries: rows.work_entries.map((e, i) => (i === 1 ? { ...e, ...patch } : e)) });
    expect(shift({ minutes: 1441 }).code).toBe('23514');
    expect(shift({ cash_tips_cents: 0 }).code).toBe('23514');
    expect(shift({ minutes: null }).code).toBe('23514');
    expect(shift({ kind: 'job' }).code).toBe('23514');
    expect(shift({ source_id: 'nope' }).code).toBe('PT422');
    expect(shift({ paid_by_occurrence_id: 'nope' }).code).toBe('PT422');
    expect(shift({ cash_tips_record_id: rows.work_entries[0]!.cash_tips_record_id }).code).toBe('23514');
    expect(replace({ sources: rows.sources.map((s) => (s.id === 'rent' ? { ...s, income_type: 'hourly' } : s)) }).code).toBe('23514');
    expect(replace({ sources: rows.sources.map((s) => (s.id === 'pay' ? { ...s, hourly_wage_cents: 1500 } : s)) }).code).toBe('23514');
    const { work_entries: _w, ...withoutShifts } = rows;
    void _w;
    expect(savePlan(user, data.revision, withoutShifts, { mode: 'replace' }).code).toBe('PT422');
    expect(load(user)).toEqual(data);
  });
});

describe('freelance income (E3)', () => {
  const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);

  it('stores clients and jobs, reads them back exactly, and the forecast is unchanged by the round trip', () => {
    const plan = withJobs(richPlan());
    const { user, data } = stored(plan);
    expect(data.clients!.map((c) => c.name)).toEqual(['Acme']);
    expect(data.jobs).toEqual(plan.jobs!.map((j) => ({ ...j, createdAt: expect.any(String), updatedAt: expect.any(String) })));
    expect(data.records.find((r) => r.id === data.jobs![0]!.paymentRecordId)).toMatchObject({ status: 'completed', actualAmountCents: usd(780), expectedAmountCents: usd(800) });
    expect(counted(data)).toEqual(counted(plan));
    const ws = workspaceOf(user);
    expect([count(`select count(*) from public.clients where workspace_id = '${ws}'`), count(`select count(*) from public.freelance_jobs where workspace_id = '${ws}'`)]).toEqual([1, 3]);
    const other = newUser();
    for (const t of ['clients', 'freelance_jobs']) expect(sql({ user: other }, `select count(*) from public.${t} where workspace_id = '${ws}';`).out).toBe('0');
  });

  it('ordinary saves: moving a payment, recording one, deleting a job with its payment, deleting a client; two jobs at once is refused', () => {
    const { user, data } = stored(withJobs(richPlan()));
    let back = saveOk(user, unwrap(ops.editJob(data, 'job-copy', { description: 'Website copy', clientId: 'client-acme', amountCents: usd(1300), status: 'planned', expectedDate: '2026-11-20' }, clock)));
    expect(back.records.find((r) => r.id === back.jobs![1]!.paymentRecordId)).toMatchObject({ scheduledAmountCents: usd(1300), scheduledDate: '2026-11-20', expectedAmountCents: usd(1200) });
    back = saveOk(user, unwrap(ops.recordJobPayment(back, 'job-brochure', { amountCents: usd(300), date: TODAY }, clock)));
    expect(back.records.find((r) => r.id === back.jobs![2]!.paymentRecordId)!.status).toBe('completed');
    expect(save(user, { ...back, jobs: back.jobs!.slice(0, 1) }).code).toBe('PT422');
    const copyPayment = back.jobs![1]!.paymentRecordId!;
    back = saveOk(user, unwrap(ops.deleteJob(back, 'job-copy')));
    expect(back.records.some((r) => r.id === copyPayment)).toBe(false);
    back = saveOk(user, unwrap(ops.deleteClient(back, 'client-acme', clock)));
    expect(back.clients).toBeUndefined();
    expect(back.jobs!.every((j) => j.clientId === undefined)).toBe(true);
    expect(back.records.find((r) => r.id === back.jobs![0]!.paymentRecordId)!.description).toBe('Logo design');
  });

  it('the database refuses malformed clients and jobs, a payment that is not one-time income or is shared, and a save that leaves them out', () => {
    const { user, data } = stored(withJobs(withShifts(richPlan())));
    const rows = toRows(data);
    const replace = (patch: Record<string, unknown>) => savePlan(user, data.revision, { ...rows, ...patch } as never, { mode: 'replace' });
    const job = (patch: Record<string, unknown>) => replace({ jobs: rows.jobs.map((j, i) => (i === 2 ? { ...j, ...patch } : j)) });
    expect(job({ amount_cents: 0 }).code).toBe('23514');
    expect(job({ status: 'paid' }).code).toBe('23514');
    expect(job({ description: ' ' }).code).toBe('23514');
    expect(job({ client_id: 'nope' }).code).toBe('PT422');
    expect(job({ payment_record_id: 'pay@2026-10-02' }).code).toBe('PT422');
    expect(job({ payment_record_id: rows.work_entries[0]!.cash_tips_record_id }).code).toBe('PT422');
    expect(job({ payment_record_id: rows.jobs[0]!.payment_record_id }).code).toBe('23505');
    expect(replace({ clients: rows.clients.map((c) => ({ ...c, name: '' })) }).code).toBe('23514');
    for (const key of ['clients', 'jobs'] as const) {
      const { [key]: _gone, ...without } = rows;
      void _gone;
      expect(savePlan(user, data.revision, without, { mode: 'replace' }).code).toBe('PT422');
    }
    expect(load(user)).toEqual(data);
  });
});

describe('gig work and payouts (E4)', () => {
  const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);

  it('stores gig income and sessions, reads them back exactly, and the forecast is unchanged by the round trip', () => {
    const plan = withSessions(withShifts(richPlan()));
    const { data } = stored(plan);
    expect(data.sources.find((s) => s.id === 'gig')).toMatchObject({ incomeType: 'gig' });
    expect(data.workEntries).toEqual(plan.workEntries!.map((e) => ({ ...e, createdAt: expect.any(String), updatedAt: expect.any(String) })));
    expect(data.workEntries!.find((e) => e.id === 'session-1')).toMatchObject({ kind: 'session', earningsCents: usd(95), platform: 'DoorDash', paidByOccurrenceId: 'gig@2026-10-12' });
    expect(counted(data)).toEqual(counted(plan));
  });

  it('ordinary saves: correcting a session replaces its cash record; undoing the payout unpays the session', () => {
    const { user, data } = stored(withSessions(richPlan()));
    let back = saveOk(user, unwrap(ops.editSession(data, 'session-2', { date: '2026-10-14', earningsCents: usd(70), cashTipsCents: usd(15), platform: 'Uber' }, clock)));
    expect(back.records.find((r) => r.id === back.workEntries![1]!.cashTipsRecordId)).toMatchObject({ description: 'Cash · Uber', actualAmountCents: usd(15) });
    back = saveOk(user, unwrap(ops.restoreOccurrence(back, 'gig@2026-10-12', clock)));
    expect(back.workEntries![0]).not.toHaveProperty('paidByOccurrenceId');
  });

  it('the database refuses a session with shift fields, a shift with session fields, and work on the wrong kind of income', () => {
    const { user, data } = stored(withSessions(withShifts(richPlan())));
    const rows = toRows(data);
    const replace = (patch: Record<string, unknown>) => savePlan(user, data.revision, { ...rows, ...patch } as never, { mode: 'replace' });
    const entry = (id: string, patch: Record<string, unknown>) => replace({ work_entries: rows.work_entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    expect(entry('session-1', { wage_cents: 1500 }).code).toBe('23514');
    expect(entry('session-1', { earnings_cents: null, cash_tips_cents: null }).code).toBe('23514');
    expect(entry('session-1', { platform: ' ' }).code).toBe('23514');
    expect(entry('shift-2', { earnings_cents: 500 }).code).toBe('23514');
    expect(entry('shift-2', { kind: 'job' }).code).toBe('23514');
    expect(entry('session-1', { source_id: 'side', kind: 'session' }).code).toBe('PT422');
    expect(replace({ sources: rows.sources.map((s) => (s.id === 'gig' ? { ...s, hourly_wage_cents: 1500 } : s)) }).code).toBe('23514');
    expect(replace({ sources: rows.sources.map((s) => (s.id === 'gig' ? { ...s, income_type: 'tipped' } : s)) }).code).toBe('PT422');
    expect(load(user)).toEqual(data);
  });
});

describe('every kind of income through ordinary saves (E6)', () => {
  const OCT = ['2026-10-01', '2026-10-31'] as const;
  /** Everything the app shows from a plan: counted entries, timing gaps, the month's Activity and earnings. */
  function outcomes(d: AppData) {
    const f = buildForecast(d, TODAY, { through: OCT[1] });
    const recorded = recordedEntries(f, ...OCT);
    return {
      counted: f.entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]),
      gaps: explainTimingGaps(f),
      activity: activityView(f, ...OCT).summary,
      earnings: earningsHistory(d, recorded, ...OCT, TODAY),
    };
  }
  /** Every link from work and jobs to money still points at something that exists, and of the right kind. */
  function linksHold(d: AppData) {
    const record = (id: string) => d.records.find((r) => r.id === id);
    for (const e of d.workEntries ?? []) {
      if (e.cashTipsRecordId) expect(record(e.cashTipsRecordId)).toMatchObject({ sourceId: null, kind: 'income', status: 'completed', actualAmountCents: e.cashTipsCents });
      if (e.paidByOccurrenceId) expect(record(e.paidByOccurrenceId)).toMatchObject({ sourceId: e.sourceId, status: 'completed' });
    }
    for (const j of d.jobs ?? []) {
      if (j.paymentRecordId) expect(record(j.paymentRecordId)).toMatchObject({ sourceId: null, kind: 'income' });
      if (j.clientId) expect(d.clients!.some((c) => c.id === j.clientId)).toBe(true);
    }
  }

  it('each correction, undo, edit and delete is saved, read back exactly, and changes no figure on the way', () => {
    // Checked after every step: no shift or session stays paid by a paycheck that arrived before it was worked.
    const noLateLinks = (d: AppData) => {
      for (const e of d.workEntries ?? []) if (e.paidByOccurrenceId) expect(e.date <= d.records.find((r) => r.id === e.paidByOccurrenceId)!.actualDate!).toBe(true);
    };
    const { user, data } = stored(incomePlan());
    // The fixture as stored: shifts paid by the early side paycheck, one session paid and one waiting.
    expect(data.workEntries!.map((e) => [e.id, e.paidByOccurrenceId ?? null])).toEqual([
      ['shift-1', 'side@2026-10-17'],
      ['shift-2', 'side@2026-10-17'],
      ['session-1', 'gig@2026-10-12'],
      ['session-2', null],
    ]);
    const payment = (d: AppData, job: string) => d.jobs!.find((j) => j.id === job)!.paymentRecordId!;
    const steps: [string, (d: AppData) => ops.Result][] = [
      ['correct the paycheck', (d) => ops.correctActual(d, 'side@2026-10-17', { amountCents: usd(220), date: '2026-10-16' }, clock)],
      ['correct it to before the second shift', (d) => ops.correctActual(d, 'side@2026-10-17', { amountCents: usd(205), date: '2026-10-14' }, clock)],
      ['undo the paycheck', (d) => ops.restoreOccurrence(d, 'side@2026-10-17', clock)],
      ['record it again', (d) => ops.recordActual(d, 'side@2026-10-17', { amountCents: usd(212.4), date: '2026-10-16' }, clock)],
      ['correct a shift’s cash tips', (d) => ops.editShift(d, 'shift-1', { date: '2026-10-14', minutes: 330, wageCents: 1600, cashTipsCents: usd(50), cardTipsCents: usd(31) }, clock)],
      ['delete a shift', (d) => ops.deleteShift(d, 'shift-2')],
      ['mark a paid session not paid', (d) => ops.setShiftPaid(d, 'session-1', null, clock)],
      ['pay it by hand with the payout', (d) => ops.setShiftPaid(d, 'session-1', 'gig@2026-10-12', clock)],
      ['change a session’s platform and cash', (d) => ops.editSession(d, 'session-2', { date: '2026-10-14', earningsCents: usd(70), cashTipsCents: usd(14), platform: 'Lyft' }, clock)],
      ['undo the payout', (d) => ops.restoreOccurrence(d, 'gig@2026-10-12', clock)],
      ['undo a job payment', (d) => ops.restoreOccurrence(d, payment(d, 'job-logo'), clock)],
      ['record it at another amount and date', (d) => ops.recordJobPayment(d, 'job-logo', { amountCents: usd(800), date: '2026-10-16' }, clock)],
      ['give a pending job a payment date', (d) => ops.editJob(d, 'job-brochure', { description: 'Brochure', amountCents: usd(300), status: 'done', expectedDate: '2026-10-28' }, clock)],
      ['delete an unpaid job and its payment', (d) => ops.deleteJob(d, 'job-copy')],
      ['remove the client', (d) => ops.deleteClient(d, 'client-acme', clock)],
    ];
    let current = data;
    for (const [name, step] of steps) {
      const next = unwrap(step(current));
      const back = saveOk(user, next);
      expect([name, back]).toEqual([name, { ...canonicalize(next), revision: back.revision }]);
      expect([name, outcomes(back)]).toEqual([name, outcomes(next)]);
      linksHold(back);
      noLateLinks(back);
      if (name === 'correct it to before the second shift') expect(back.workEntries!.filter((e) => e.sourceId === 'side').map((e) => [e.id, e.paidByOccurrenceId ?? null])).toEqual([['shift-1', 'side@2026-10-17'], ['shift-2', null]]);
      current = back;
    }
    // Where it ended: one shift (its new cash tips received), the paycheck paying it; both sessions waiting; Logo paid at $800.
    expect(current.workEntries!.map((e) => [e.id, e.paidByOccurrenceId ?? null])).toEqual([
      ['shift-1', 'side@2026-10-17'],
      ['session-1', null],
      ['session-2', null],
    ]);
    const end = outcomes(current).earnings;
    expect(end.notReceived.map((n) => [n.source.id, n.cents, n.platforms])).toEqual([
      ['gig', usd(165), [{ platform: 'DoorDash', cents: usd(95) }, { platform: 'Lyft', cents: usd(70) }]],
    ]);
    expect(end.jobs.paid.map((v) => [v.job.id, v.amountCents, v.date])).toEqual([['job-logo', usd(800), '2026-10-16']]);
    expect(current.jobs!.every((j) => j.clientId === undefined)).toBe(true);
  });
});

describe('accounts, transfers and Strategic Reserves (F1)', () => {
  const balances = (d: AppData) => (d.accounts ?? []).map((a) => [a.id, accountBalance(d, a.id, '2026-11-30', TODAY)]);
  const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);

  it('stores accounts, opening balances, assignments, releases and transfers, and reads them back exactly', () => {
    const plan = withAccounts(richPlan());
    const { data } = stored(plan);
    expect(data).toEqual({ ...canonicalize(plan), revision: 1 });
    expect(data.records.find((r) => r.id === 'pay@2026-10-23')).toMatchObject({ status: 'completed', accountId: 'acct-income' });
    expect(data.records.find((r) => r.id === 'release-car')).toMatchObject({ kind: 'reserve', release: true });
    expect(balances(data)).toEqual(balances(plan));
    expect(counted(data)).toEqual(counted(plan));
  });

  it('ordinary saves: every account and transfer operation is saved and read back exactly, with the same balances and figures', () => {
    const { user, data } = stored(withAccounts(richPlan()));
    const steps: [string, (d: AppData) => ops.Result][] = [
      ['rename an account', (d) => ops.renameAccount(d, 'acct-bills', 'Bills and rent', clock)],
      ['change an opening balance', (d) => ops.setOpeningBalance(d, 'acct-bills', { amountCents: usd(12), date: '2026-10-02' }, clock)],
      ['remove an opening balance', (d) => ops.setOpeningBalance(d, 'acct-income', null, clock)],
      ['record the expected transfer', (d) => ops.recordTransfer(d, 'xfer-save', { amountCents: usd(55), date: TODAY }, clock)],
      ['plan another transfer', (d) => ops.addTransfer(d, { fromAccountId: 'acct-income', toAccountId: 'acct-everyday', amountCents: usd(80), date: '2026-10-30' }, 'expected', clock, 'xfer-spend')],
      ['change it', (d) => ops.updateTransfer(d, 'xfer-spend', { fromAccountId: 'acct-income', toAccountId: 'acct-everyday', amountCents: usd(90), date: '2026-10-31' }, clock)],
      ['delete a transfer', (d) => ops.deleteTransfer(d, 'xfer-rent')],
      ['move an item to another account', (d) => ops.assignAccount(d, 'rent', 'acct-everyday', clock)],
      ['unassign an item', (d) => ops.assignAccount(d, 'save', null, clock)],
      ['delete the recorded transfer to reserves', (d) => ops.deleteTransfer(d, 'xfer-save')],
      ['delete an account nothing uses', (d) => ops.deleteAccount(d, 'acct-reserves', clock)],
      ['undo the recorded paycheck', (d) => ops.restoreOccurrence(d, 'pay@2026-10-23', clock)],
      ['delete the release', (d) => ops.deleteOneTime(d, 'release-car')],
    ];
    let current = data;
    for (const [name, step] of steps) {
      const next = unwrap(step(current));
      const back = saveOk(user, next);
      expect([name, back]).toEqual([name, { ...canonicalize(next), revision: back.revision }]);
      expect([name, balances(back)]).toEqual([name, balances(next)]);
      expect([name, counted(back)]).toEqual([name, counted(next)]);
      current = back;
    }
    expect(current.accounts!.map((a) => a.id)).toEqual(['acct-income', 'acct-bills', 'acct-everyday']);
    expect(current.transfers!.map((t) => [t.id, t.status, t.amountCents])).toEqual([['xfer-spend', 'expected', usd(90)]]);
  });

  it('an ordinary save removes at most one account and one transfer; a replace can remove them all', () => {
    const { user, data } = stored(withAccounts(richPlan()));
    const twoAccounts: AppData = { ...data, accounts: data.accounts!.filter((a) => a.id !== 'acct-everyday' && a.id !== 'acct-reserves'), transfers: data.transfers!.filter((t) => t.toAccountId !== 'acct-reserves'), sources: data.sources.map(({ accountId, ...s }) => (accountId === 'acct-reserves' ? s : { ...s, accountId })) as AppData['sources'] };
    expect(save(user, twoAccounts).code).toBe('PT422');
    expect(save(user, { ...data, transfers: [] }).code).toBe('PT422');
    const { accounts: _a, transfers: _t, ...none } = data;
    const bare: AppData = { ...none, sources: data.sources.map(({ accountId: _x, ...s }) => s), records: data.records.filter((r) => !r.release).map(({ accountId: _x, ...r }) => r) };
    expect(save(user, bare, { mode: 'replace' }).ok).toBe(true);
    expect(load(user).accounts).toBeUndefined();
  });

  it('the database refuses an account of the wrong type, a missing account, a transfer within one account, and misplaced releases or balances', () => {
    const { user, data } = stored(withAccounts(richPlan()));
    const rows = toRows(data);
    const replace = (patch: Record<string, unknown>) => savePlan(user, data.revision, { ...rows, ...patch } as never, { mode: 'replace' });
    const source = (id: string, patch: Record<string, unknown>) => replace({ sources: rows.sources.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    const record = (id: string, patch: Record<string, unknown>) => replace({ records: rows.records.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    const transfer = (patch: Record<string, unknown>) => replace({ transfers: rows.transfers.map((x, i) => (i === 0 ? { ...x, ...patch } : x)) });
    const account = (patch: Record<string, unknown>, id = 'acct-income') => replace({ accounts: rows.accounts.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    expect(source('rent', { account_id: 'acct-income' }).code).toBe('PT422');
    expect(source('rent', { account_id: 'gone' }).code).toBe('PT422');
    expect(record('release-car', { account_id: 'acct-bills' }).code).toBe('PT422');
    expect(transfer({ to_account_id: 'acct-income' }).code).toBe('23514');
    expect(transfer({ to_account_id: 'gone' }).code).toBe('PT422');
    expect(transfer({ recorded_at: null }).code).toBe('23514');
    expect(transfer({ amount_cents: 0 }).code).toBe('23514');
    const unrecorded = rows.records.find((r) => r.source_id !== null && r.status !== 'completed')!;
    expect(record(unrecorded.id, { release: true }).code).toBe('23514');
    expect(record(unrecorded.id, { account_id: 'acct-bills' }).code).toBe('23514');
    expect(account({ opening_date: null }).code).toBe('23514');
    expect(account({ type: 'savings' }, 'acct-everyday').code).toBe('23514');
    // Changing the type of an account items use is caught first, as a mismatch.
    expect(account({ type: 'payment' }).code).toBe('PT422');
    expect(replace({ accounts: undefined }).code).toBe('PT422');
    expect(load(user)).toEqual(data);
  });

  it("another person can't read accounts or transfers", () => {
    const { user } = stored(withAccounts(richPlan()));
    const other = newUser();
    expect(save(other, { ...smallPlanLike(), revision: 0 }, { mode: 'replace' }).ok).toBe(true);
    for (const t of ['accounts', 'transfers']) {
      expect(sql({ user: other }, `select count(*) from public.${t} where workspace_id = '${workspaceOf(user)}';`).out).toBe('0');
      expect(sql({ user }, `select count(*) from public.${t};`).out).not.toBe('0');
    }
  });
});

/** A small plan with no accounts, for another person. */
function smallPlanLike(): AppData {
  return source(ops.emptyData(), TODAY, 'income', 'Pay', 500, '2026-10-30', { type: 'monthly' }, 'pay');
}
