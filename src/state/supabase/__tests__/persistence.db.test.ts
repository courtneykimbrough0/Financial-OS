import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clockAt, unwrap, usd } from '../../../domain/__tests__/helpers';
import * as ops from '../../../domain/operations';
import { toRows } from '../rows';
import { richPlan, smallPlan, TODAY } from './fixtures';
import { count, json, load, newUser, save, savePlan, sql, sqlAsync, workspaceOf } from './pg';

const clock = clockAt(TODAY);
const receipts = (user: string) => count(`select count(*) from public.save_receipts where workspace_id = '${workspaceOf(user)}'`);

/** A user whose plan is the small plan at revision 1. */
function started() {
  const user = newUser();
  const r = save(user, smallPlan(), { mode: 'replace' });
  if (!r.ok) throw new Error(r.message!);
  return { user, plan: load(user) };
}

const withBill = (plan: ReturnType<typeof load>, name: string, dollars: number) =>
  unwrap(ops.addOneTime(plan, { kind: 'varied', description: name, amountCents: usd(dollars), date: '2026-11-05' }, clock, `one-${name.toLowerCase()}`));

describe('saving', () => {
  it('1. a normal save applies once and advances the revision by one', () => {
    const { user, plan } = started();
    const r = save(user, withBill(plan, 'Repair', 80));
    expect(r.result).toEqual({ status: 'saved', revision: 2, current_revision: 2 });
    expect(load(user).records.map((x) => x.description)).toEqual(['Repair']);
  });

  it('2. an immediate retry with the same save id is acknowledged, not applied again', () => {
    const { user, plan } = started();
    const changed = withBill(plan, 'Repair', 80);
    const saveId = randomUUID();
    expect(save(user, changed, { saveId }).result).toEqual({ status: 'saved', revision: 2, current_revision: 2 });
    expect(save(user, changed, { saveId }).result).toEqual({ status: 'already_saved', revision: 2, current_revision: 2 });
    expect(load(user).revision).toBe(2);
    expect(load(user).records).toHaveLength(1);
  });

  it('3. a delayed retry gets the same answer', async () => {
    const { user, plan } = started();
    const changed = withBill(plan, 'Repair', 80);
    const saveId = randomUUID();
    save(user, changed, { saveId });
    await new Promise((r) => setTimeout(r, 1200));
    expect(save(user, changed, { saveId }).result).toEqual({ status: 'already_saved', revision: 2, current_revision: 2 });
  });

  it('4. a retry after newer saves says it was saved (as revision 2) and that the plan has moved on, applying nothing', () => {
    const { user, plan } = started();
    const first = withBill(plan, 'Repair', 80);
    const saveId = randomUUID();
    save(user, first, { saveId });
    const later = withBill({ ...load(user) }, 'Dentist', 120);
    expect(save(user, later).result).toEqual({ status: 'saved', revision: 3, current_revision: 3 });
    expect(save(user, first, { saveId }).result).toEqual({ status: 'already_saved', revision: 2, current_revision: 3 });
    expect(load(user).records.map((x) => x.description).sort()).toEqual(['Dentist', 'Repair']);
    expect(load(user).revision).toBe(3);
  });

  it('5. the same save id with different data is refused', () => {
    const { user, plan } = started();
    const saveId = randomUUID();
    save(user, withBill(plan, 'Repair', 80), { saveId });
    const r = save(user, withBill(plan, 'Repair', 95), { saveId });
    expect([r.ok, r.code, r.message]).toEqual([false, 'PT422', 'This save request was already used for a different change.']);
    expect(load(user).records[0]!.scheduledAmountCents).toBe(8000);
  });

  it('6. of two sessions saving at once from the same revision, exactly one succeeds', async () => {
    const { user, plan } = started();
    const a = toRows(withBill(plan, 'Repair', 80));
    const b = toRows(withBill(plan, 'Dentist', 120));
    // Session A saves and holds its transaction open; B starts meanwhile and must wait for A's lock.
    const first = sqlAsync({ user }, `begin;\nselect public.save_plan(1, '${randomUUID()}', 'update', ${json(a)});\nselect pg_sleep(1.5);\ncommit;`);
    await new Promise((r) => setTimeout(r, 400));
    const t0 = Date.now();
    const second = await sqlAsync({ user }, `select public.save_plan(1, '${randomUUID()}', 'update', ${json(b)});`);
    const waited = Date.now() - t0;
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    expect([second.ok, second.code]).toEqual([false, 'PT409']);
    expect(waited).toBeGreaterThan(700);
    expect(load(user).revision).toBe(2);
    expect(load(user).records.map((x) => x.description)).toEqual(['Repair']);
  });

  it('7. a save based on an old revision is refused with a conflict and changes nothing', () => {
    const { user, plan } = started();
    save(user, withBill(plan, 'Repair', 80));
    const stale = save(user, withBill(plan, 'Dentist', 120));
    expect([stale.ok, stale.code, stale.message]).toEqual([false, 'PT409', 'Your plan was changed somewhere else.']);
    expect(load(user).records.map((x) => x.description)).toEqual(['Repair']);
  });

  it('8. a save that fails partway rolls back entirely, receipt included, and can then be made', () => {
    const { user, plan } = started();
    const changed = withBill(plan, 'Repair', 80);
    const rows = toRows(changed);
    // The new source rows are valid; the record row breaks a check, after the sources were written.
    const broken = { ...rows, sources: [...rows.sources, { ...rows.sources[0]!, id: 'gym', position: 2 }], versions: [...rows.versions, { ...rows.versions[0]!, id: 'ver-gym', source_id: 'gym' }], records: rows.records.map((x) => ({ ...x, scheduled_amount_cents: 0 })) };
    const saveId = randomUUID();
    const r = savePlan(user, 1, broken, { saveId });
    expect([r.ok, r.code]).toEqual([false, '23514']);
    expect(load(user)).toEqual(plan);
    expect(receipts(user)).toBe(1);
    // Nothing was recorded for that id, so the corrected change saves under it.
    expect(save(user, changed, { saveId }).result).toEqual({ status: 'saved', revision: 2, current_revision: 2 });
  });

  it('9. when the reply to a successful save is lost, the retry learns it was saved', () => {
    const { user, plan } = started();
    const changed = withBill(plan, 'Repair', 80);
    const saveId = randomUUID();
    // The save commits, but the client never sees the reply.
    sql({ user }, `select public.save_plan(1, '${saveId}', 'update', ${json(toRows(changed))}) is not null;`);
    const retry = save(user, changed, { saveId });
    expect(retry.result).toEqual({ status: 'already_saved', revision: 2, current_revision: 2 });
    expect(load(user).records).toHaveLength(1);
  });

  it('10. repeating a restore with the same id replaces the plan once', () => {
    const { user } = started();
    const backup = richPlan();
    const saveId = randomUUID();
    expect(save(user, { ...backup, revision: 1 }, { mode: 'replace', saveId }).result).toEqual({ status: 'saved', revision: 2, current_revision: 2 });
    expect(save(user, { ...backup, revision: 1 }, { mode: 'replace', saveId }).result).toEqual({ status: 'already_saved', revision: 2, current_revision: 2 });
    expect(load(user).revision).toBe(2);
    expect(load(user).sources.map((s) => s.id)).toEqual(backup.sources.map((s) => s.id));
  });

  it('keeps receipts bounded to the latest 100', () => {
    let { user, plan } = started();
    for (let i = 0; i < 105; i++) {
      const r = save(user, { ...plan, onboardingComplete: true });
      if (!r.ok) throw new Error(r.message!);
      plan = { ...plan, revision: r.result!.revision };
    }
    expect(receipts(user)).toBe(100);
  });
});
