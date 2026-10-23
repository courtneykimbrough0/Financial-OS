/**
 * The focused hosted verification (roadmap F3): what a hosted project adds over
 * the local stack, checked through its real Auth and API. The database rules
 * themselves are the same SQL that `test:db` and the local-stack suites cover;
 * here they are checked as deployed, with the project's own Auth settings and
 * tokens.
 *
 * It signs in as two disposable identities (SUPABASE_TEST_IDENTITY_A and _B,
 * @example.test addresses created confirmed beforehand; see
 * docs/SUPABASE-HOSTED.md) and reads no email. The tests run in order and end
 * by deleting both identities through delete_account(). Run by
 * `npm run test:hosted`, which refuses anything but the approved test project.
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { unwrap } from '../../../domain/__tests__/helpers';
import { activityView, recordedEntries } from '../../../domain/activity';
import { earningsHistory } from '../../../domain/earnings-history';
import { buildForecast, explainTimingGaps } from '../../../domain/forecast';
import * as ops from '../../../domain/operations';
import type { AppData } from '../../../domain/types';
import { SupabaseStorageAdapter } from '../adapter';
import { canonicalize, toRows } from '../rows';
import { clock, incomePlan, smallPlan, TODAY, withAccounts } from './fixtures';

const URL = process.env.SUPABASE_TEST_URL!;
const KEY = process.env.SUPABASE_TEST_ANON_KEY!;
const A = { email: process.env.SUPABASE_TEST_IDENTITY_A!, password: process.env.SUPABASE_TEST_IDENTITY_A_PASSWORD! };
const B = { email: process.env.SUPABASE_TEST_IDENTITY_B!, password: process.env.SUPABASE_TEST_IDENTITY_B_PASSWORD! };

const SIGNED_OUT = "You've been signed out, so this change isn't saved. Sign in again, then try again.";
const CONFLICT = 'Your data was changed on another device. Reload to see the latest.';
const TABLES = ['workspaces', 'sources', 'schedule_versions', 'source_pauses', 'occurrence_records', 'work_entries', 'clients', 'freelance_jobs', 'accounts', 'transfers'];

const client = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const withToken = (token: string) => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
const adapterFor = (sb: SupabaseClient) => new SupabaseStorageAdapter(sb);
const disposable = () => `fos-hosted-${randomUUID()}@example.test`;

async function signIn(who: { email: string; password: string }) {
  const sb = client();
  const r = await sb.auth.signInWithPassword(who);
  if (r.error || !r.data.session) throw new Error(`sign-in failed: ${r.error?.message ?? 'no session'}`);
  return { sb, session: r.data.session, userId: r.data.user!.id };
}

const views = (d: AppData) => {
  const f = buildForecast(d, TODAY, { through: '2026-10-31' });
  return { forecast: f, gaps: explainTimingGaps(f), activity: activityView(f, '2026-10-01', '2026-10-31'), earnings: earningsHistory(d, recordedEntries(f, '2026-10-01', '2026-10-31'), '2026-10-01', '2026-10-31', TODAY) };
};

// Whatever happens, leave no disposable identity that can still sign in.
afterAll(async () => {
  for (const who of [A, B]) {
    const sb = client();
    if (!(await sb.auth.signInWithPassword(who)).error) await sb.rpc('delete_account');
  }
});

describe('the Auth settings, as the project reports them', () => {
  it('email and password only, confirmation required, sign-ups open; anonymous, Google and every other provider off', async () => {
    const s = (await (await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: KEY } })).json()) as { external: Record<string, boolean>; mailer_autoconfirm: boolean; disable_signup: boolean };
    expect({ confirmationRequired: !s.mailer_autoconfirm, signUpsOpen: !s.disable_signup }).toEqual({ confirmationRequired: true, signUpsOpen: true });
    expect(Object.keys(s.external).filter((k) => s.external[k])).toEqual(['email']);
  });

  it('an anonymous sign-in is refused', async () => {
    const r = await client().auth.signInAnonymously();
    expect([r.error?.code, r.data.session]).toEqual(['anonymous_provider_disabled', null]);
  });

  // Hosted Auth refuses @example.test addresses at sign-up, before it looks at the password, so a sign-up
  // here gets no session and creates no account. That confirmation is required comes from the settings
  // above; the minimum password length is checked on a signed-in account below.
  it('a sign-up with a disposable address gets no session, and that address signs nothing in', async () => {
    const who = { email: disposable(), password: `pw-${randomUUID()}` };
    const up = await client().auth.signUp(who);
    expect([up.error?.code, up.data.session]).toEqual(['email_address_invalid', null]);
    const r = await client().auth.signInWithPassword(who);
    expect([r.error?.code, r.data.session]).toEqual(['invalid_credentials', null]);
  });
});

describe('signed out', () => {
  it('every function call and every table read is refused, and a token that is not valid counts as signed out', async () => {
    const sb = client();
    for (const [fn, args] of [
      ['load_plan', undefined],
      ['create_workspace', undefined],
      ['delete_account', undefined],
      ['save_plan', { p_base_revision: 0, p_save_id: randomUUID(), p_mode: 'update', p_plan: toRows(smallPlan()) }],
    ] as const) {
      const r = await sb.rpc(fn, args);
      expect([fn, r.status, r.error?.code]).toEqual([fn, 401, '42501']);
    }
    for (const t of [...TABLES, 'save_receipts']) {
      const r = await sb.from(t).select('*');
      expect([t, r.status, r.error?.code]).toEqual([t, 401, '42501']);
    }
    await expect(adapterFor(sb).load()).rejects.toThrow(SIGNED_OUT);
    const bad = await withToken('not-a-real-token').rpc('load_plan');
    expect([bad.status, bad.error?.code]).toEqual([401, 'PGRST301']);
  });

  it('a wrong password and an unknown email get the same answer', async () => {
    const wrong = await client().auth.signInWithPassword({ email: A.email, password: 'not-the-password' });
    const unknown = await client().auth.signInWithPassword({ email: disposable(), password: 'not-the-password' });
    expect([wrong.error?.code, wrong.data.session]).toEqual(['invalid_credentials', null]);
    expect([unknown.error?.code, unknown.error?.message]).toEqual([wrong.error?.code, wrong.error?.message]);
  });
});

describe("one person's plan (identity A)", () => {
  it('the first load creates the workspace and an empty plan; every kind of data comes back exactly, with identical forecasts, Activity and earnings', async () => {
    const { sb, userId } = await signIn(A);
    const adapter = adapterFor(sb);
    expect(await adapter.load()).toEqual({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });
    expect((await sb.from('workspaces').select('owner_id, revision')).data).toEqual([{ owner_id: userId, revision: 0 }]);
    const plan = withAccounts(incomePlan());
    expect(await adapter.save({ ...plan, revision: 0 }, 0, 'replace')).toEqual({ ok: true, revision: 1 });
    const back = await adapterFor(sb).load();
    expect(back).toEqual({ ...canonicalize(plan), revision: 1 });
    expect(views(back)).toEqual(views(plan));
    // An ordinary save keeps everything it doesn't change.
    const edited = unwrap(ops.restoreOccurrence(back, 'gig@2026-10-12', clock));
    expect(await adapter.save(edited, 1)).toEqual({ ok: true, revision: 2 });
    expect(await adapterFor(sb).load()).toEqual({ ...canonicalize(edited), revision: 2 });
  });

  it('two devices saving from the same revision: one is saved, the other gets a conflict, and reload shows the saved one', async () => {
    const [laptop, phone] = [adapterFor((await signIn(A)).sb), adapterFor((await signIn(A)).sb)];
    const [a, b] = [await laptop.load(), await phone.load()];
    const repair = (d: AppData, cents: number, id: string) => unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: cents, date: '2026-11-05' }, clock, id));
    const [r1, r2] = await Promise.all([laptop.save(repair(a, 8000, 'one-laptop'), a.revision), phone.save(repair(b, 9500, 'one-phone'), b.revision)]);
    const [won, lost] = r1.ok ? [r1, r2] : [r2, r1];
    expect([won, lost]).toEqual([{ ok: true, revision: a.revision + 1 }, { ok: false, reason: 'conflict', message: CONFLICT }]);
    const winner = r1.ok ? repair(a, 8000, 'one-laptop') : repair(b, 9500, 'one-phone');
    expect(await phone.load()).toEqual({ ...winner, revision: a.revision + 1 });
  });

  it('a retried save is answered once, a reused save id with other data is refused, a stale revision is a conflict, and an ordinary save cannot erase the plan', async () => {
    const { sb } = await signIn(A);
    const current = await adapterFor(sb).load();
    const rows = toRows(current);
    const id = randomUUID();
    const saved = await sb.rpc('save_plan', { p_base_revision: current.revision, p_save_id: id, p_mode: 'update', p_plan: rows });
    expect(saved.data).toEqual({ status: 'saved', revision: current.revision + 1, current_revision: current.revision + 1 });
    expect((await sb.rpc('save_plan', { p_base_revision: current.revision, p_save_id: id, p_mode: 'update', p_plan: rows })).data).toEqual({ status: 'already_saved', revision: current.revision + 1, current_revision: current.revision + 1 });
    const reused = await sb.rpc('save_plan', { p_base_revision: current.revision, p_save_id: id, p_mode: 'update', p_plan: { ...rows, review_cadence: 'weekly' } });
    expect([reused.status, reused.error?.code]).toEqual([422, 'PT422']);
    const stale = await sb.rpc('save_plan', { p_base_revision: current.revision, p_save_id: randomUUID(), p_mode: 'update', p_plan: rows });
    expect([stale.status, stale.error?.code]).toEqual([409, 'PT409']);
    const wipe = await adapterFor(sb).save({ ...ops.emptyData(), revision: current.revision + 1 }, current.revision + 1);
    expect(wipe).toMatchObject({ ok: false, reason: 'error' });
    expect((await sb.from('workspaces').select('revision')).data).toEqual([{ revision: current.revision + 1 }]);
    const r = await sb.from('save_receipts').select('*');
    expect([r.status, r.error?.code]).toEqual([403, '42501']);
  });

  it('a new password shorter than 8 characters is refused, and the current one keeps working', async () => {
    const { sb } = await signIn(A);
    const r = await sb.auth.updateUser({ password: 'Short7!' });
    expect(r.error?.code).toBe('weak_password');
    expect((await client().auth.signInWithPassword(A)).error).toBeNull();
  });

  it('sessions: a refresh still reaches the plan; after signing out, its saves are refused and its refresh token stops working', async () => {
    const { sb, session } = await signIn(A);
    const refreshed = await sb.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.session!.access_token).not.toBe(session.access_token);
    const loaded = await adapterFor(withToken(refreshed.data.session!.access_token)).load();
    expect(loaded.sources.length).toBeGreaterThan(0);
    await sb.auth.signOut({ scope: 'local' });
    expect(await adapterFor(sb).save(loaded, loaded.revision)).toEqual({ ok: false, reason: 'error', message: SIGNED_OUT });
    expect((await client().auth.refreshSession({ refresh_token: refreshed.data.session!.refresh_token })).error).not.toBeNull();
    expect(await adapterFor((await signIn(A)).sb).load()).toEqual(loaded);
  });
});

describe('two people (identities A and B)', () => {
  it("raw requests with B's token can't read, write or reach A's workspace; a save carrying A's ids lands in B's own", async () => {
    const a = await signIn(A);
    const aPlan = await adapterFor(a.sb).load();
    const wsA = (await a.sb.from('workspaces').select('id')).data![0]!.id as string;
    const b = await signIn(B);
    const bAdapter = adapterFor(b.sb);
    expect((await bAdapter.load()).revision).toBe(0);
    expect(await bAdapter.save({ ...smallPlan(), revision: 0 }, 0, 'replace')).toEqual({ ok: true, revision: 1 });
    const bPlan = await bAdapter.load();
    const raw = (path: string, init: RequestInit = {}) => fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${b.session.access_token}`, 'Content-Type': 'application/json' } });
    for (const t of TABLES) {
      const res = await raw(`${t}?${t === 'workspaces' ? 'id' : 'workspace_id'}=eq.${wsA}`);
      expect([t, res.status, await res.json()]).toEqual([t, 200, []]);
    }
    const now = new Date().toISOString();
    for (const [label, res] of [
      ['insert into A', await raw('sources', { method: 'POST', body: JSON.stringify({ workspace_id: wsA, id: 'x', position: 9, kind: 'bill', description: 'x', active: true, created_at: now, updated_at: now }) })],
      ['update A', await raw(`sources?workspace_id=eq.${wsA}`, { method: 'PATCH', body: JSON.stringify({ description: 'x' }) })],
      ['delete A', await raw(`workspaces?id=eq.${wsA}`, { method: 'DELETE' })],
      ['a workspace for A', await raw('workspaces', { method: 'POST', body: JSON.stringify({ owner_id: a.userId }) })],
    ] as const) {
      expect([label, res.status, ((await res.json()) as { code: string }).code]).toEqual([label, 403, '42501']);
    }
    const save = await raw('rpc/save_plan', { method: 'POST', body: JSON.stringify({ p_base_revision: 1, p_save_id: randomUUID(), p_mode: 'update', p_plan: { ...toRows(bPlan), workspace_id: wsA, owner_id: a.userId } }) });
    expect(save.status).toBe(200);
    expect(await adapterFor(a.sb).load()).toEqual(aPlan);
    expect((await bAdapter.load()).revision).toBe(2);
  });
});

describe('deleting an account', () => {
  it('there is no way to name another account, and a signed-out session cannot delete', async () => {
    const b = await signIn(B);
    const named = await b.sb.rpc('delete_account', { p_user: randomUUID() });
    expect(named.error?.code).toBe('PGRST202');
    const token = b.session.access_token;
    await b.sb.auth.signOut({ scope: 'local' });
    const r = await withToken(token).rpc('delete_account');
    expect([r.status, r.error?.code]).toEqual([401, 'PT401']);
    expect((await client().auth.signInWithPassword(B)).error).toBeNull();
  });

  it("after a fresh password sign-in, B and B's whole plan are gone; B's earlier token reaches nothing; A's plan is untouched", async () => {
    const aPlan = await adapterFor((await signIn(A)).sb).load();
    const earlier = (await signIn(B)).session.access_token;
    const b = await signIn(B);
    const del = await b.sb.rpc('delete_account');
    expect([del.error, del.status]).toEqual([null, 204]);
    const stale = withToken(earlier);
    expect((await stale.rpc('load_plan')).data).toBeNull();
    for (const t of TABLES) expect([t, (await stale.from(t).select('*')).data]).toEqual([t, []]);
    expect((await stale.rpc('create_workspace')).error?.code).toBe('23503');
    expect((await stale.rpc('save_plan', { p_base_revision: 0, p_save_id: randomUUID(), p_mode: 'replace', p_plan: toRows(smallPlan()) })).error?.code).toBe('PT404');
    expect((await client().auth.signInWithPassword(B)).error?.code).toBe('invalid_credentials');
    expect(await adapterFor((await signIn(A)).sb).load()).toEqual(aPlan);
  });

  it('A deletes its own account too, leaving no disposable identity behind', async () => {
    const a = await signIn(A);
    expect((await a.sb.rpc('delete_account')).error).toBeNull();
    expect((await client().auth.signInWithPassword(A)).error?.code).toBe('invalid_credentials');
  });
});
