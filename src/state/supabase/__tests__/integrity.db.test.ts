import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../../domain/__tests__/helpers';
import { buildForecast } from '../../../domain/forecast';
import { variance } from '../../../domain/occurrences';
import * as ops from '../../../domain/operations';
import type { AppData } from '../../../domain/types';
import { toRows } from '../rows';
import { richPlan, TODAY, withJobs, withSessions, withShifts } from './fixtures';
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
    // Overdue and unpaid again: carried to the next payday, once, at the expected amount.
    expect(entries(back, 'elec@2026-10-03')).toEqual([['2026-10-23', 18000, true]]);
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
    // (Sep 3 is still unpaid and carried to the next payday; this looks at October onwards.)
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

  it('the classifications migration converts existing savings and one-time bill rows', () => {
    const { user, data } = stored();
    let d = source(data, TODAY, 'reserve', 'Emergency fund', 100, '2026-10-24', { type: 'biweekly' }, 'res');
    d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(80), date: '2026-11-05' }, clock, 'one-rep'));
    saveOk(user, d);
    const ws = workspaceOf(user);
    // Put the database back as it was before the migration, with rows of the retired kinds. The old checks
    // skip existing rows (not valid) because other tests' workspaces in this database already use the new kinds.
    const restore = sql('owner', `
      alter table public.sources drop constraint sources_kind_check;
      alter table public.occurrence_records drop constraint occurrence_records_kind_check;
      alter table public.occurrence_records drop constraint occurrence_records_one_time_kind;
      update public.sources set kind = 'savings' where workspace_id = '${ws}' and id = 'res';
      update public.occurrence_records set kind = 'bill' where workspace_id = '${ws}' and id = 'one-rep';
      alter table public.sources add constraint sources_kind_check check (kind in ('income', 'bill', 'subscription', 'liability', 'savings')) not valid;
      alter table public.occurrence_records add constraint occurrence_records_kind_check check (kind in ('income', 'bill', 'subscription', 'liability', 'savings')) not valid;
      alter table public.occurrence_records add constraint occurrence_records_one_time_kind check (source_id is not null or kind in ('income', 'bill', 'savings')) not valid;`);
    expect([restore.ok, restore.message ?? null]).toEqual([true, null]);
    const migrated = sql('owner', readFileSync(new URL('../../../../supabase/migrations/20261018000002_financial_classifications.sql', import.meta.url), 'utf8'));
    expect([migrated.ok, migrated.message ?? null]).toEqual([true, null]);
    const back = load(user);
    expect(back.sources.find((s) => s.id === 'res')!.kind).toBe('reserve');
    expect(back.records.find((r) => r.id === 'one-rep')!.kind).toBe('varied');
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

describe('income certainty (E1)', () => {
  const marks = (d: AppData) => [...d.sources.map((s) => [s.id, s.certainty ?? null]), ...d.records.map((r) => [r.id, r.certainty ?? null])];
  const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);

  it('stores possible income, reads it back exactly, and an ordinary save can mark it expected', () => {
    const { user, data } = stored();
    let d = unwrap(ops.addSource(data, { kind: 'income', description: 'Tips', amountCents: usd(200), startDate: '2026-10-17', rule: { type: 'weekly' }, certainty: 'possible' }, clock, 'tips'));
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Invoice', amountCents: usd(500), date: '2026-10-28', certainty: 'possible' }, clock, 'one-inv'));
    const back = saveOk(user, d);
    expect(marks(back)).toEqual([['elec', null], ['pay', null], ['rent', null], ['tips', 'possible'], ['one-inv', 'possible']]);
    expect(counted(back)).toEqual(counted(d));
    expect(counted(back).some(([id]) => id === 'one-inv' || String(id).startsWith('tips@'))).toBe(false);
    // Marking it expected is an ordinary change.
    const expected = saveOk(user, unwrap(ops.setIncomeCertainty(back, 'one-inv', 'expected', clock)));
    expect(expected.records.find((r) => r.id === 'one-inv')).not.toHaveProperty('certainty');
    expect(count(`select count(*) from public.occurrence_records where workspace_id = '${workspaceOf(user)}' and certainty is not null`)).toBe(0);
    expect(count(`select count(*) from public.sources where workspace_id = '${workspaceOf(user)}' and certainty is not null`)).toBe(1);
  });

  it('existing rows stay expected: a plan saved without certainty has none stored', () => {
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
