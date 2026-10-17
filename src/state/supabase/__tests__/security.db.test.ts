import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toRows } from '../rows';
import { richPlan, smallPlan } from './fixtures';
import { json, load, loadRows, newUser, save, sql, workspaceOf } from './pg';

/** Users A and B, each with a populated plan. */
function twoUsers() {
  const a = newUser();
  const b = newUser();
  for (const [u, plan] of [[a, richPlan()], [b, smallPlan()]] as const) {
    const r = save(u, { ...plan, revision: 0 }, { mode: 'replace' });
    if (!r.ok) throw new Error(r.message!);
  }
  return { a, b, wsA: workspaceOf(a), wsB: workspaceOf(b) };
}

const TABLES = ['workspaces', 'sources', 'schedule_versions', 'source_pauses', 'occurrence_records'];

describe('each person reaches only their own plan', () => {
  it('1. A reads A’s plan', () => {
    const { a, wsA } = twoUsers();
    const rows = loadRows(a)!;
    expect(rows.workspace_id).toBe(wsA);
    expect(rows.sources).toHaveLength(8);
    expect(sql({ user: a }, `select count(*) from public.occurrence_records where workspace_id = '${wsA}';`).out).toBe(String(rows.records.length));
  });

  it('2–4. B can’t read A’s workspace, sources, schedules, pauses or records, even by id', () => {
    const { b, wsA, wsB } = twoUsers();
    for (const t of TABLES) {
      const col = t === 'workspaces' ? 'id' : 'workspace_id';
      expect(sql({ user: b }, `select count(*) from public.${t} where ${col} = '${wsA}';`).out).toBe('0');
    }
    // B's own plan is all B sees anywhere.
    expect(sql({ user: b }, 'select count(*) from public.sources;').out).toBe('2');
    expect(sql({ user: b }, `select count(distinct workspace_id) from public.sources;`).out).toBe('1');
    expect(loadRows(b)!.workspace_id).toBe(wsB);
  });

  it('5. B’s save_plan only ever touches B’s own workspace; A’s plan is unchanged', () => {
    const { a, b } = twoUsers();
    const before = load(a);
    // There is no parameter for whose plan to save: it is always the caller's.
    const r = save(b, { ...before, revision: load(b).revision }, { mode: 'replace' });
    expect(r.ok).toBe(true);
    expect(load(a)).toEqual(before);
  });

  it('6. a plan can’t link to another workspace’s rows', () => {
    const { a, b, wsA } = twoUsers();
    // Rows carry no workspace id in the request; any sent is ignored and the caller's is used.
    const rows = toRows(smallPlan());
    const forged = { ...rows, sources: rows.sources.map((s) => ({ ...s, workspace_id: wsA })), records: [] };
    expect(save(b, { ...smallPlan(), revision: load(b).revision }).ok).toBe(true);
    const r = sql({ user: b }, `select public.save_plan(${load(b).revision}, '${randomUUID()}', 'update', ${json(forged)});`);
    expect(r.ok).toBe(true);
    expect(sql('owner', `select count(*) from public.sources where workspace_id = '${wsA}' and id = 'rent'`).out).toBe('1');
    expect(load(a).sources.find((s) => s.id === 'rent')!.versions[0]!.amountCents).toBe(150000);
    // And the database itself refuses a record pointing at another workspace's source.
    const wsB = workspaceOf(b);
    const cross = sql('owner', `insert into public.occurrence_records (workspace_id, id, position, source_id, kind, description, expected_date, expected_amount_cents, scheduled_date, scheduled_amount_cents, status, created_at, updated_at)
      values ('${wsB}', 'elec@2026-10-03', 0, 'elec', 'bill', 'x', '2026-10-03', 100, '2026-10-03', 100, 'scheduled', now(), now());`);
    expect(cross.code).toBe('23503');
  });

  it('7–9. no one can insert, update or delete rows directly, not even their own', () => {
    const { a, wsA } = twoUsers();
    const attempts = [
      `insert into public.workspaces (owner_id) values ('${a}');`,
      `insert into public.sources (workspace_id, id, position, kind, description, active, created_at, updated_at) values ('${wsA}', 'x', 9, 'bill', 'x', true, now(), now());`,
      `update public.sources set description = 'hacked' where workspace_id = '${wsA}';`,
      `update public.workspaces set revision = 0 where id = '${wsA}';`,
      `delete from public.occurrence_records where workspace_id = '${wsA}';`,
      `delete from public.workspaces where id = '${wsA}';`,
      `select * from public.save_receipts;`,
    ];
    for (const q of attempts) {
      const r = sql({ user: a }, q);
      expect([q, r.ok, r.code]).toEqual([q, false, '42501']);
    }
    expect(load(a).sources.find((s) => s.id === 'pay')!.description).toBe('Paycheck');
  });

  it('10. a signed-out caller can’t run any of the functions or read any table', () => {
    twoUsers();
    for (const q of ['select public.load_plan();', 'select public.create_workspace();', `select public.save_plan(0, '${randomUUID()}', 'update', '{}'::jsonb);`, ...TABLES.map((t) => `select count(*) from public.${t};`)]) {
      const r = sql('anon', q);
      expect([q, r.ok, r.code]).toEqual([q, false, '42501']);
    }
  });

  it('11. ownership can’t be changed through the request', () => {
    const { a, b, wsA } = twoUsers();
    const rows = { ...toRows(smallPlan()), owner_id: a, workspace_id: wsA };
    const r = sql({ user: b }, `select public.save_plan(${load(b).revision}, '${randomUUID()}', 'replace', ${json(rows)});`);
    expect(r.ok).toBe(true);
    expect(sql('owner', `select owner_id from public.workspaces where id = '${wsA}';`).out).toBe(a);
    expect(sql('owner', `select count(*) from public.workspaces where owner_id = '${b}';`).out).toBe('1');
    // create_workspace takes no owner: it only ever returns the caller's own workspace.
    expect(sql({ user: b }, 'select public.create_workspace();').out).toBe(workspaceOf(b));
  });

  it('12. a signed-in caller with no workspace gets no plan, and can’t save one', () => {
    const c = randomUUID();
    sql('owner', `insert into auth.users (id) values ('${c}');`);
    expect(sql({ user: c }, 'select public.load_plan() is null;').out).toBe('t');
    const r = sql({ user: c }, `select public.save_plan(0, '${randomUUID()}', 'update', ${json(toRows(smallPlan()))});`);
    expect(r.code).toBe('PT404');
  });

  it('a request with no signed-in user is refused even if the role allows the call', () => {
    // authenticated role, but no user id in the claims (as with a malformed token).
    const r = sql('owner', `set role authenticated; select set_config('request.jwt.claims', '{}', false); select public.save_plan(0, '${randomUUID()}', 'update', '{}'::jsonb);`);
    expect(r.code).toBe('PT401');
  });

  it('the write functions run with a fixed search path and are not callable by public', () => {
    const r = sql('owner', `select p.proname, p.prosecdef, array_to_string(p.proconfig, ','), has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname;`);
    expect(r.out.split('\n')).toEqual([
      'create_workspace|t|search_path=""|f|t',
      'delete_account|t|search_path=""|f|t',
      'load_plan|f|search_path=""|f|t',
      'save_plan|t|search_path=""|f|t',
    ]);
  });

  it('row-level security is on for every table', () => {
    const r = sql('owner', `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;`);
    expect(r.out.split('\n')).toEqual(['occurrence_records|t', 'save_receipts|t', 'schedule_versions|t', 'source_pauses|t', 'sources|t', 'workspaces|t']);
  });
});
