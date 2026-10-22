import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { richPlan, smallPlan, withShifts } from './fixtures';
import { count, load, newUser, save, sql, workspaceOf } from './pg';

/** A signed-in session for `user`, as Supabase Auth issues it: its id, and when the password was last checked. */
function session(user: string, opts: { live?: boolean; passwordSecondsAgo?: number | null; sessionId?: string } = {}) {
  const id = opts.sessionId ?? randomUUID();
  if (opts.live !== false && !opts.sessionId) sql('owner', `insert into auth.sessions (id, user_id) values ('${id}', '${user}');`);
  const ago = opts.passwordSecondsAgo === undefined ? 10 : opts.passwordSecondsAgo;
  const amr = ago === null ? [{ method: 'anonymous', timestamp: Math.floor(Date.now() / 1000) }] : [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - ago }];
  const claims = JSON.stringify({ sub: user, role: 'authenticated', session_id: id, amr });
  return (q: string) => sql('owner', `set role authenticated; select set_config('request.jwt.claims', '${claims}', false);\n${q}`);
}

/** Rows of every table in a workspace. */
const rowsIn = (ws: string) =>
  ['workspaces where id', 'sources where workspace_id', 'schedule_versions where workspace_id', 'source_pauses where workspace_id', 'occurrence_records where workspace_id', 'work_entries where workspace_id', 'save_receipts where workspace_id'].map((t) =>
    count(`select count(*) from public.${t} = '${ws}'`),
  );

function withPlan(plan = richPlan()) {
  const u = newUser();
  const r = save(u, { ...plan, revision: 0 }, { mode: 'replace' });
  if (!r.ok) throw new Error(r.message!);
  return { u, ws: workspaceOf(u) };
}

describe('deleting an account', () => {
  it("after a recent password sign-in: removes the account and every row of its plan, and nothing of anyone else's", () => {
    const a = withPlan(withShifts(richPlan()));
    const b = withPlan(smallPlan());
    const bBefore = load(b.u);
    expect(rowsIn(a.ws).every((n) => n > 0)).toBe(true);
    const r = session(a.u)('select public.delete_account();');
    expect([r.ok, r.code]).toEqual([true, null]);
    expect(rowsIn(a.ws)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(count(`select count(*) from auth.users where id = '${a.u}'`)).toBe(0);
    expect(count(`select count(*) from auth.sessions where user_id = '${a.u}'`)).toBe(0);
    expect(load(b.u)).toEqual(bBefore);
  });

  it('is refused without a recent password sign-in, with a session that has ended, or for a temporary identity', () => {
    const a = withPlan();
    const before = rowsIn(a.ws);
    const attempts = [
      ['password 6 minutes ago', session(a.u, { passwordSecondsAgo: 360 }), 'PT403'],
      ['no password sign-in (anonymous)', session(a.u, { passwordSecondsAgo: null }), 'PT403'],
      ['a session that signed out', session(a.u, { live: false }), 'PT401'],
    ] as const;
    for (const [label, as, code] of attempts) {
      const r = as('select public.delete_account();');
      expect([label, r.ok, r.code]).toEqual([label, false, code]);
    }
    expect(rowsIn(a.ws)).toEqual(before);
  });

  it("only ever deletes the caller: another person's session id doesn't help, and there is no way to name an account", () => {
    const a = withPlan();
    const b = withPlan(smallPlan());
    const bRows = rowsIn(b.ws);
    const bSession = randomUUID();
    sql('owner', `insert into auth.sessions (id, user_id) values ('${bSession}', '${b.u}');`);
    // A's token carrying B's session id is refused; B is untouched.
    expect(session(a.u, { sessionId: bSession })('select public.delete_account();').code).toBe('PT401');
    // The function takes no arguments.
    expect(session(a.u)(`select public.delete_account('${b.u}');`).code).toBe('42883');
    expect(rowsIn(b.ws)).toEqual(bRows);
    expect(count(`select count(*) from auth.users where id in ('${a.u}', '${b.u}')`)).toBe(2);
  });

  it("a signed-out caller can't run it", () => {
    expect(sql('anon', 'select public.delete_account();').code).toBe('42501');
  });

  it("a token issued before the deletion reaches nothing afterwards, and can't make a new plan", () => {
    const a = withPlan();
    session(a.u)('select public.delete_account();');
    const stale = { user: a.u };
    expect(sql(stale, 'select public.load_plan() is null;').out).toBe('t');
    expect(sql(stale, `select public.save_plan(1, '${randomUUID()}', 'replace', '{}'::jsonb);`).code).toBe('PT404');
    expect(sql(stale, 'select public.create_workspace();').code).toBe('23503');
    for (const t of ['workspaces', 'sources', 'schedule_versions', 'source_pauses', 'occurrence_records', 'work_entries']) expect(sql(stale, `select count(*) from public.${t};`).out).toBe('0');
    expect(count(`select count(*) from public.workspaces where owner_id = '${a.u}'`)).toBe(0);
  });
});
