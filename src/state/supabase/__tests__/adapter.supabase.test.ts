/**
 * The adapter and the database functions through a real Supabase stack: its
 * auth server (real sign-ups and sessions), its API gateway and PostgREST, and
 * the migrations applied by `supabase start`. Run by `npm run test:supabase`,
 * which refuses anything but a local stack. Users are made with email and
 * password sign-ups (a local stack confirms them at once); each test makes its
 * own, so tests never share a plan.
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { usd, unwrap } from '../../../domain/__tests__/helpers';
import { addDays } from '../../../domain/dates';
import { buildForecast, explainTimingGaps, paycheckCycles } from '../../../domain/forecast';
import * as ops from '../../../domain/operations';
import type { AppData } from '../../../domain/types';
import { SupabaseStorageAdapter } from '../adapter';
import { canonicalize, toRows } from '../rows';
import { clock, richPlan, smallPlan, TODAY } from './fixtures';
import { confirmedAccount } from './local-auth';

const URL = process.env.SUPABASE_TEST_URL!;
const KEY = process.env.SUPABASE_TEST_ANON_KEY!;

const OFFLINE = 'Couldn’t reach the server, so this change isn’t confirmed yet. Check your connection and try again.';
const SIGNED_OUT = 'You’ve been signed out, so this change isn’t saved. Sign in again, then try again.';
const CONFLICT = 'Your data was changed somewhere else, such as another device. Reload to see the latest version.';
const SAVED_BUT_NEWER = 'Your change was saved, but your data has changed somewhere else since. Reload to see the latest version.';

const TABLES = ['workspaces', 'sources', 'schedule_versions', 'source_pauses', 'occurrence_records'];

/**
 * A client whose next save_plan reply can be lost after the server answered:
 * the save really runs and commits, but the caller sees a network failure.
 */
function client(): { sb: SupabaseClient; loseNextReply: () => void } {
  let lose = false;
  const fetcher: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    if (lose && String(input instanceof Request ? input.url : input).endsWith('/rpc/save_plan')) {
      lose = false;
      await res.text();
      throw new TypeError('fetch failed');
    }
    return res;
  };
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } });
  return { sb, loseNextReply: () => (lose = true) };
}

/** A new signed-in user with a confirmed email. `devices` more clients sign in as the same person. */
async function signUp(devices = 0) {
  const main = client();
  const { email, password, userId } = await confirmedAccount(main.sb);
  const others = [];
  for (let i = 0; i < devices; i++) {
    const c = client();
    const r = await c.sb.auth.signInWithPassword({ email, password });
    if (r.error) throw new Error(`sign-in failed: ${r.error.message}`);
    others.push(c);
  }
  return { ...main, userId, others };
}

const adapterFor = (sb: SupabaseClient) => new SupabaseStorageAdapter(sb);
const repair = (d: AppData, dollars: number, id = 'one-repair') => unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Repair', amountCents: usd(dollars), date: '2026-11-05' }, clock, id));
/** A plan already stored for a new user, at revision 1, through a replace (as a migration would). */
async function withPlan(plan: AppData, devices = 0) {
  const u = await signUp(devices);
  const adapter = adapterFor(u.sb);
  const empty = await adapter.load();
  expect(await adapter.save({ ...plan, revision: empty.revision }, empty.revision, 'replace')).toEqual({ ok: true, revision: 1 });
  return { ...u, adapter };
}

describe('through real Supabase Auth and API', () => {
  it('signed out: every function call and every table read is refused', async () => {
    const { sb } = client();
    for (const [fn, args] of [
      ['load_plan', undefined],
      ['create_workspace', undefined],
      ['save_plan', { p_base_revision: 0, p_save_id: randomUUID(), p_mode: 'update', p_plan: toRows(smallPlan()) }],
    ] as const) {
      const r = await sb.rpc(fn, args);
      expect([fn, r.status, r.error?.code]).toEqual([fn, 401, '42501']);
    }
    for (const t of [...TABLES, 'save_receipts']) {
      const r = await sb.from(t).select('*');
      expect([t, r.status, r.error?.code]).toEqual([t, 401, '42501']);
    }
    // And the adapter says so plainly.
    await expect(adapterFor(sb).load()).rejects.toThrow(SIGNED_OUT);
  });

  it('a token that isn’t valid is refused as signed out', async () => {
    const bad = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: 'Bearer not-a-real-token' } } });
    const r = await bad.rpc('load_plan');
    expect([r.status, r.error?.code]).toEqual([401, 'PGRST301']);
    await expect(adapterFor(bad).load()).rejects.toThrow(SIGNED_OUT);
  });

  it('a new user: the first load creates the workspace once and returns an empty plan; saves round-trip', async () => {
    const { sb, userId } = await signUp();
    const adapter = adapterFor(sb);
    expect(await adapter.load()).toEqual({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });
    const ws = await sb.from('workspaces').select('id, owner_id, revision');
    expect(ws.data).toHaveLength(1);
    expect(ws.data![0]).toMatchObject({ owner_id: userId, revision: 0 });
    const first = await adapter.load();
    expect(first.revision).toBe(0);
    expect((await sb.from('workspaces').select('id')).data).toEqual([{ id: ws.data![0]!.id }]);

    const plan = { ...smallPlan(), revision: 0 };
    expect(await adapter.save(plan, 0, 'replace')).toEqual({ ok: true, revision: 1 });
    const edited = repair(await adapter.load(), 80);
    expect(await adapter.save(edited, 1)).toEqual({ ok: true, revision: 2 });
    expect(await adapterFor(sb).load()).toEqual({ ...edited, revision: 2 });
  });

  it('a rich plan comes back exactly (in canonical form) with identical forecasts', async () => {
    const plan = richPlan();
    const { sb } = await withPlan(plan);
    const back = await adapterFor(sb).load();
    expect(back).toEqual({ ...canonicalize(plan), revision: 1 });
    for (const day of [0, 30, 90, 180, 365].map((d) => addDays(TODAY, d))) {
      const a = buildForecast(plan, day);
      const b = buildForecast(back, day);
      expect(b).toEqual(a);
      expect(explainTimingGaps(b)).toEqual(explainTimingGaps(a));
      expect(paycheckCycles(b)).toEqual(paycheckCycles(a));
    }
  });

  it('two people: neither can read, write or reach the other’s plan', async () => {
    const planA = richPlan();
    const a = await withPlan(planA);
    const b = await withPlan(smallPlan());
    const wsA = (await a.sb.from('workspaces').select('id')).data![0]!.id as string;
    for (const t of TABLES) {
      const r = await b.sb.from(t).select('*').eq(t === 'workspaces' ? 'id' : 'workspace_id', wsA);
      expect([t, r.error, r.data]).toEqual([t, null, []]);
    }
    expect((await b.sb.from('sources').select('id')).data!.map((s) => s.id).sort()).toEqual(['pay', 'rent']);
    // No direct writes, not even to one's own rows; all writes go through save_plan.
    const wsB = (await b.sb.from('workspaces').select('id')).data![0]!.id as string;
    for (const [label, r] of [
      ['insert into A', await b.sb.from('sources').insert({ workspace_id: wsA, id: 'x', position: 9, kind: 'bill', description: 'x', active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })],
      ['update A', await b.sb.from('sources').update({ description: 'hacked' }).eq('workspace_id', wsA)],
      ['update own', await b.sb.from('sources').update({ description: 'hacked' }).eq('workspace_id', wsB)],
      ['delete A', await b.sb.from('workspaces').delete().eq('id', wsA)],
      ['new workspace', await b.sb.from('workspaces').insert({ owner_id: a.userId })],
    ] as const) {
      expect([label, r.error?.code]).toEqual([label, '42501']);
    }
    // B's save, even carrying A's ids, lands in B's own workspace.
    const rows = { ...toRows(smallPlan()), owner_id: a.userId, workspace_id: wsA };
    const r = await b.sb.rpc('save_plan', { p_base_revision: 1, p_save_id: randomUUID(), p_mode: 'replace', p_plan: rows });
    expect(r.error).toBeNull();
    expect(await adapterFor(a.sb).load()).toEqual({ ...canonicalize(planA), revision: 1 });
  });

  it('a session that ends: the save is refused as signed out, and nothing changes', async () => {
    const u = await withPlan(smallPlan(), 1);
    const loaded = await u.adapter.load();
    await u.sb.auth.signOut({ scope: 'local' });
    expect(await u.adapter.save(repair(loaded, 80), loaded.revision)).toEqual({ ok: false, reason: 'error', message: SIGNED_OUT });
    expect(await adapterFor(u.others[0]!.sb).load()).toEqual(loaded);
  });

  it('two devices saving from the same revision: the second gets a conflict, and reload shows the first', async () => {
    const u = await withPlan(smallPlan(), 1);
    const phone = adapterFor(u.others[0]!.sb);
    const a = await u.adapter.load();
    const b = await phone.load();
    const [r1, r2] = await Promise.all([u.adapter.save(repair(a, 80), 1), phone.save(repair(b, 95, 'one-other'), 1)]);
    // One of them wins; which one depends on which reaches the database first.
    const [won, lost] = r1.ok ? [r1, r2] : [r2, r1];
    expect([won, lost]).toEqual([{ ok: true, revision: 2 }, { ok: false, reason: 'conflict', message: CONFLICT }]);
    const winner = r1.ok ? repair(a, 80) : repair(b, 95, 'one-other');
    expect(await phone.load()).toEqual({ ...winner, revision: 2 });
  });

  it('a lost reply: Try again is told it was saved, and the revision moves once', async () => {
    const u = await withPlan(smallPlan());
    const loaded = await u.adapter.load();
    const edited = repair(loaded, 80);
    u.loseNextReply();
    expect(await u.adapter.save(edited, 1)).toEqual({ ok: false, reason: 'error', message: OFFLINE });
    // It did commit on the server.
    expect((await u.sb.from('workspaces').select('revision')).data).toEqual([{ revision: 2 }]);
    expect(await u.adapter.save(edited, 1)).toEqual({ ok: true, revision: 2 });
    expect((await u.sb.from('workspaces').select('revision')).data).toEqual([{ revision: 2 }]);
    expect((await adapterFor(u.sb).load()).records.map((r) => [r.id, r.scheduledAmountCents])).toEqual([['one-repair', 8000]]);
  });

  it('a lost reply, then more edits: the edits are saved on top, nothing twice', async () => {
    const u = await withPlan(smallPlan());
    const loaded = await u.adapter.load();
    const first = repair(loaded, 80);
    u.loseNextReply();
    expect((await u.adapter.save(first, 1)).ok).toBe(false);
    const second = repair(first, 120, 'one-second');
    expect(await u.adapter.save(second, 1)).toEqual({ ok: true, revision: 3 });
    const back = await adapterFor(u.sb).load();
    expect(back).toEqual({ ...second, revision: 3 });
    expect(back.records.map((r) => [r.id, r.scheduledAmountCents])).toEqual([
      ['one-repair', 8000],
      ['one-second', 12000],
    ]);
  });

  it('an older save retried after newer saves elsewhere: recognized, not reapplied, no regression, asks for a reload', async () => {
    const u = await withPlan(smallPlan(), 1);
    const phone = adapterFor(u.others[0]!.sb);
    const loaded = await u.adapter.load();
    const mine = repair(loaded, 80);
    u.loseNextReply();
    expect((await u.adapter.save(mine, 1)).ok).toBe(false);
    // The other device loads revision 2 (which includes my repair) and saves revision 3.
    const theirs = unwrap(ops.changeSourceSchedule(await phone.load(), 'rent', { startDate: '2026-12-01', amountCents: usd(1550), rule: { type: 'monthly' } }, clock));
    expect(await phone.save(theirs, 2)).toEqual({ ok: true, revision: 3 });
    expect(await u.adapter.save(mine, 1)).toEqual({ ok: false, reason: 'conflict', message: SAVED_BUT_NEWER });
    const back = await adapterFor(u.sb).load();
    expect(back).toEqual({ ...theirs, revision: 3 });
    expect(back.sources.find((s) => s.id === 'rent')!.versions.map((v) => [v.startDate, v.amountCents])).toEqual([
      ['2026-11-01', 150000],
      ['2026-12-01', 155000],
    ]);
  });

  it('a save id reused for different data is refused (422) and nothing changes', async () => {
    const u = await withPlan(smallPlan());
    const id = randomUUID();
    const plan = toRows(repair({ ...smallPlan(), revision: 1 }, 80));
    expect((await u.sb.rpc('save_plan', { p_base_revision: 1, p_save_id: id, p_mode: 'update', p_plan: plan })).data).toEqual({ status: 'saved', revision: 2, current_revision: 2 });
    const again = await u.sb.rpc('save_plan', { p_base_revision: 1, p_save_id: id, p_mode: 'update', p_plan: plan });
    expect(again.data).toEqual({ status: 'already_saved', revision: 2, current_revision: 2 });
    const other = await u.sb.rpc('save_plan', { p_base_revision: 1, p_save_id: id, p_mode: 'update', p_plan: { ...plan, review_cadence: 'weekly' } });
    expect([other.status, other.error?.code]).toEqual([422, 'PT422']);
    expect((await u.sb.from('workspaces').select('revision, review_cadence')).data).toEqual([{ revision: 2, review_cadence: null }]);
  });

  it('a stale revision is a conflict (409)', async () => {
    const u = await withPlan(smallPlan());
    const r = await u.sb.rpc('save_plan', { p_base_revision: 0, p_save_id: randomUUID(), p_mode: 'update', p_plan: toRows(smallPlan()) });
    expect([r.status, r.error?.code]).toEqual([409, 'PT409']);
  });

  it('an ordinary save can’t erase a populated plan; start over (reset) can, and only with an empty plan', async () => {
    const u = await withPlan(richPlan());
    const empty = { ...ops.emptyData(), revision: 1 };
    const wipe = await u.adapter.save(empty, 1);
    expect(wipe.ok).toBe(false);
    expect(wipe).toMatchObject({ reason: 'error' });
    expect((wipe as { message: string }).message).toMatch(/^This change couldn’t be saved: /);
    const notEmpty = await u.adapter.save({ ...smallPlan(), revision: 1 }, 1, 'reset');
    expect(notEmpty).toMatchObject({ ok: false, reason: 'error' });
    expect((await u.sb.from('workspaces').select('revision')).data).toEqual([{ revision: 1 }]);
    expect(await u.adapter.save(empty, 1, 'reset')).toEqual({ ok: true, revision: 2 });
    expect(await adapterFor(u.sb).load()).toEqual({ ...empty, revision: 2 });
  });

  it('a restore (replace) replaces the whole plan, history included', async () => {
    const u = await withPlan(richPlan());
    const backup = { ...smallPlan(), revision: 1 };
    expect(await u.adapter.save(backup, 1, 'replace')).toEqual({ ok: true, revision: 2 });
    expect(await adapterFor(u.sb).load()).toEqual({ ...backup, revision: 2 });
    expect((await u.sb.from('occurrence_records').select('id')).data).toEqual([]);
  });

  it('save_receipts can’t be reached through the API, even by its owner', async () => {
    const u = await withPlan(smallPlan());
    const r = await u.sb.from('save_receipts').select('*');
    expect([r.status, r.error?.code]).toEqual([403, '42501']);
  });
});
