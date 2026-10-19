import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../../domain/__tests__/helpers';
import { buildForecast } from '../../../domain/forecast';
import { variance } from '../../../domain/occurrences';
import * as ops from '../../../domain/operations';
import type { AppData } from '../../../domain/types';
import { toRows } from '../rows';
import { richPlan, TODAY } from './fixtures';
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

  it('a canceled payment is kept and never counts, and isn’t an actual', () => {
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

  it('a schedule change after a payment keeps the payment and doesn’t bring the occurrence back', () => {
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

  it('refuses a repeated occurrence id, an id that isn’t its source and date, and a second record for one occurrence', () => {
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

  it('an item with recorded history can’t be removed by an ordinary save', () => {
    const { user, data } = stored();
    const paid = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(180), date: '2026-10-03' }, clock)));
    // The app refuses (deleteSource); a client that tried anyway is refused by the database.
    const forged: AppData = { ...paid, sources: paid.sources.filter((s) => s.id !== 'elec'), records: [] };
    const r = save(user, forged);
    expect([r.code, r.message]).toEqual(['PT422', 'An item with recorded history can\'t be removed. Turn it off instead.']);
    expect(load(user).records).toHaveLength(1);
  });

  it('an empty or truncated plan can’t erase a populated one in an ordinary save', () => {
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

  it('an ordinary save can’t rewrite an original prediction or an existing schedule', () => {
    const { user, data } = stored();
    const paid = saveOk(user, unwrap(ops.recordActual(data, 'elec@2026-10-03', { amountCents: usd(230), date: '2026-10-03' }, clock)));
    const rewritten: AppData = { ...paid, records: paid.records.map((r) => ({ ...r, expectedAmountCents: 23000 })) };
    expect(save(user, rewritten).message).toBe('A save can\'t change an original prediction.');
    const repriced: AppData = { ...paid, sources: paid.sources.map((s) => (s.id === 'elec' ? { ...s, versions: s.versions.map((v) => ({ ...v, amountCents: 99900 })) } : s)) };
    expect(save(user, repriced).message).toBe('A save can\'t rewrite an existing schedule. Changes start a new schedule from a date.');
    expect(load(user)).toEqual(paid);
  });

  it('a restore can bring back a backup’s own predictions and schedules', () => {
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
