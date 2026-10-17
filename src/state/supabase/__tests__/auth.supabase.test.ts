/**
 * Accounts through the local Supabase stack's real auth server and API: email
 * and password sign-up with email confirmation, sign-in, password recovery,
 * session refresh and sign-out, account deletion, and converting an earlier
 * temporary (anonymous) development identity into a recoverable account.
 * Emails are read from the stack's email-testing server. Run by `npm run
 * test:supabase`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { AppData } from '../../../domain/types';
import { SupabaseStorageAdapter } from '../adapter';
import { canonicalize, toRows } from '../rows';
import { richPlan, smallPlan } from './fixtures';
import { confirmedAccount, latestMail, newEmail, newPassword, openLink } from './local-auth';

const URL = process.env.SUPABASE_TEST_URL!;
const KEY = process.env.SUPABASE_TEST_ANON_KEY!;
const REDIRECT = 'http://localhost:4183/';

const client = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const withToken = (token: string) => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
const TABLES = ['workspaces', 'sources', 'schedule_versions', 'source_pauses', 'occurrence_records'];

async function store(sb: SupabaseClient, plan: AppData) {
  const adapter = new SupabaseStorageAdapter(sb);
  const empty = await adapter.load();
  expect(await adapter.save({ ...plan, revision: 0 }, empty.revision, 'replace')).toEqual({ ok: true, revision: 1 });
  return adapter;
}
/** Tokens from a verify link's redirect (`#access_token=…`). */
const fromRedirect = (location: string) => Object.fromEntries(new URLSearchParams(location.split('#')[1] ?? ''));

describe('creating an account and signing in', () => {
  it('sign-up sends a confirmation email; signing in waits for it; after confirming, sign-in works and the plan starts empty', async () => {
    const sb = client();
    const email = newEmail();
    const password = newPassword();
    const up = await sb.auth.signUp({ email, password, options: { emailRedirectTo: REDIRECT } });
    expect([up.error, up.data.session, up.data.user?.email]).toEqual([null, null, email]);
    const early = await sb.auth.signInWithPassword({ email, password });
    expect(early.error?.code).toBe('email_not_confirmed');

    const mail = await latestMail(email);
    expect(mail.subject).toBe('Confirm your email address');
    const opened = await openLink(mail.link);
    expect(opened.status).toBe(303);
    expect(opened.location.startsWith(REDIRECT)).toBe(true);

    const r = await sb.auth.signInWithPassword({ email, password });
    expect(r.error).toBeNull();
    expect(r.data.user!.email_confirmed_at).toBeTruthy();
    expect(await new SupabaseStorageAdapter(sb).load()).toEqual({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });
  });

  it('a wrong password and an unknown email get the same answer', async () => {
    const { email } = await confirmedAccount(client());
    const wrong = await client().auth.signInWithPassword({ email, password: 'not-the-password' });
    const unknown = await client().auth.signInWithPassword({ email: newEmail(), password: 'not-the-password' });
    expect([wrong.error?.code, wrong.error?.message, wrong.data.session]).toEqual(['invalid_credentials', 'Invalid login credentials', null]);
    expect([unknown.error?.code, unknown.error?.message]).toEqual([wrong.error?.code, wrong.error?.message]);
  });

  it('a returning account on another device finds its plan', async () => {
    const first = client();
    const { email, password } = await confirmedAccount(first);
    const plan = richPlan();
    await store(first, plan);
    const second = client();
    expect((await second.auth.signInWithPassword({ email, password })).error).toBeNull();
    expect(await new SupabaseStorageAdapter(second).load()).toEqual({ ...canonicalize(plan), revision: 1 });
  });
});

describe('password recovery', () => {
  it('the recovery email’s link signs in to set a new password; the old one stops working, the plan is kept', async () => {
    const sb = client();
    const { email, password } = await confirmedAccount(sb);
    await store(sb, smallPlan());
    const sentAt = new Date().toISOString();
    expect((await client().auth.resetPasswordForEmail(email, { redirectTo: REDIRECT })).error).toBeNull();
    const mail = await latestMail(email, sentAt);
    expect(mail.subject).toBe('Reset your password');
    const opened = await openLink(mail.link);
    const tokens = fromRedirect(opened.location);
    expect(tokens.type).toBe('recovery');

    const recovering = client();
    expect((await recovering.auth.setSession({ access_token: tokens.access_token!, refresh_token: tokens.refresh_token! })).error).toBeNull();
    const fresh = newPassword();
    expect((await recovering.auth.updateUser({ password: fresh })).error).toBeNull();

    expect((await client().auth.signInWithPassword({ email, password })).error?.code).toBe('invalid_credentials');
    const back = client();
    expect((await back.auth.signInWithPassword({ email, password: fresh })).error).toBeNull();
    expect((await new SupabaseStorageAdapter(back).load()).sources.map((s) => s.id)).toEqual(['pay', 'rent']);
  });

  it('asking to recover an unknown email answers the same way and sends nothing', async () => {
    const email = newEmail();
    expect((await client().auth.resetPasswordForEmail(email, { redirectTo: REDIRECT })).error).toBeNull();
    await expect(latestMail(email)).rejects.toThrow(`no email to ${email}`);
  });
});

describe('sessions', () => {
  it('a refresh gives a new access token that still reaches the plan', async () => {
    const sb = client();
    const { session } = await confirmedAccount(sb);
    await store(sb, smallPlan());
    const r = await sb.auth.refreshSession();
    expect(r.error).toBeNull();
    expect(r.data.session!.access_token).not.toBe(session.access_token);
    expect((await new SupabaseStorageAdapter(withToken(r.data.session!.access_token)).load()).sources).toHaveLength(2);
  });

  it('signing out ends the session: its refresh token stops working, and the plan stays on the server', async () => {
    const sb = client();
    const { email, password, session } = await confirmedAccount(sb);
    await store(sb, smallPlan());
    expect((await sb.auth.signOut({ scope: 'local' })).error).toBeNull();
    const reuse = client();
    expect((await reuse.auth.refreshSession({ refresh_token: session.refresh_token })).error?.code).toMatch(/refresh_token_not_found|session_not_found|refresh_token_already_used/);
    const again = client();
    await again.auth.signInWithPassword({ email, password });
    expect((await new SupabaseStorageAdapter(again).load()).sources).toHaveLength(2);
  });
});

describe('deleting an account', () => {
  it('after confirming the password: the account and its whole plan are gone, and old credentials reach nothing', async () => {
    const sb = client();
    const { email, password, userId } = await confirmedAccount(sb);
    await store(sb, richPlan());
    const before = (await sb.auth.getSession()).data.session!;
    const other = client();
    await confirmedAccount(other);
    const otherPlan = await (await store(other, smallPlan())).load();

    // Confirm the password (a fresh sign-in), then delete.
    expect((await sb.auth.signInWithPassword({ email, password })).error).toBeNull();
    const del = await sb.rpc('delete_account');
    expect([del.error, del.status]).toEqual([null, 204]);

    // The older token still verifies until it expires, but reaches nothing and can't make a plan.
    const stale = withToken(before.access_token);
    expect((await stale.rpc('load_plan')).data).toBeNull();
    for (const t of TABLES) expect([t, (await stale.from(t).select('*')).data]).toEqual([t, []]);
    expect((await stale.rpc('create_workspace')).error?.code).toBe('23503');
    expect((await stale.rpc('save_plan', { p_base_revision: 1, p_save_id: crypto.randomUUID(), p_mode: 'replace', p_plan: toRows(smallPlan()) })).error?.code).toBe('PT404');
    // Its refresh token is gone, and the account can't sign in.
    expect((await client().auth.refreshSession({ refresh_token: before.refresh_token })).error).not.toBeNull();
    expect((await client().auth.signInWithPassword({ email, password })).error?.code).toBe('invalid_credentials');
    // Another person's plan is untouched.
    expect(await new SupabaseStorageAdapter(other).load()).toEqual(otherPlan);
    expect(userId).toBeTruthy();
  });

  it('without a fresh password check: refused for a signed-out session, a wrong password gets no new session, and nothing is deleted', async () => {
    const sb = client();
    const { email } = await confirmedAccount(sb);
    await store(sb, smallPlan());
    const token = (await sb.auth.getSession()).data.session!.access_token;
    // A wrong password: no new session; the existing one is unchanged.
    const wrong = await client().auth.signInWithPassword({ email, password: 'not-the-password' });
    expect([wrong.error?.code, wrong.data.session]).toEqual(['invalid_credentials', null]);
    // A session that has signed out can't delete, even though its token hasn't expired.
    await sb.auth.signOut({ scope: 'local' });
    const r = await withToken(token).rpc('delete_account');
    expect([r.status, r.error?.code]).toEqual([401, 'PT401']);
    // Signed out entirely: refused.
    expect((await client().rpc('delete_account')).error?.code).toBe('42501');
    const check = client();
    expect((await check.auth.signInWithPassword({ email, password: 'not-the-password' })).error?.code).toBe('invalid_credentials');
  });

  it('only ever deletes the caller', async () => {
    const a = client();
    const b = client();
    await confirmedAccount(a);
    const bAccount = await confirmedAccount(b);
    const bPlan = await (await store(b, smallPlan())).load();
    // There is no way to name another account.
    const named = await a.rpc('delete_account', { p_user: bAccount.userId });
    expect(named.error?.code).toBe('PGRST202');
    expect((await a.rpc('delete_account')).error).toBeNull();
    expect(await new SupabaseStorageAdapter(b).load()).toEqual(bPlan);
    expect((await client().auth.signInWithPassword({ email: bAccount.email, password: bAccount.password })).error).toBeNull();
  });
});

describe('a temporary development identity becomes a recoverable account', () => {
  it('adding a confirmed email and then a password keeps the same identity and the same plan', async () => {
    const anon = client();
    const signedIn = await anon.auth.signInAnonymously();
    expect(signedIn.data.user!.is_anonymous).toBe(true);
    const id = signedIn.data.user!.id;
    const plan = richPlan();
    await store(anon, plan);

    // Step 1: add an email; it must be confirmed.
    const email = newEmail();
    expect((await anon.auth.updateUser({ email }, { emailRedirectTo: REDIRECT })).error).toBeNull();
    const mail = await latestMail(email);
    expect((await openLink(mail.link)).status).toBe(303);
    const refreshed = await anon.auth.refreshSession();
    expect([refreshed.data.user!.id, refreshed.data.user!.email, refreshed.data.user!.is_anonymous]).toEqual([id, email, false]);

    // Step 2: a password.
    const password = newPassword();
    expect((await anon.auth.updateUser({ password })).error).toBeNull();

    // Recoverable: a new device signs in with the email and password and finds the same plan.
    const device = client();
    const r = await device.auth.signInWithPassword({ email, password });
    expect(r.data.user!.id).toBe(id);
    expect(await new SupabaseStorageAdapter(device).load()).toEqual({ ...canonicalize(plan), revision: 1 });
  });
});
