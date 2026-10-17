/**
 * Real accounts for the integration and browser tests, on the local stack or
 * an approved hosted test project (scripts/supabase-target.mjs checked which).
 * Sign-ups are confirmed through a Mailpit-compatible email-testing server: the
 * local stack's own, or the one behind a hosted test project's test SMTP. A
 * hosted project with no such server must have email confirmation off; tests
 * that need an email then skip themselves (`HAS_MAIL`).
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TARGET = (process.env.SUPABASE_TEST_TARGET ?? 'local') as 'local' | 'hosted';
export const MAIL_URL = process.env.SUPABASE_TEST_MAIL_URL ?? (TARGET === 'local' ? 'http://127.0.0.1:54324' : '');
export const HAS_MAIL = MAIL_URL !== '';
/** Anonymous sign-ins: on in the local stack (to convert earlier development identities), off in a hosted project. */
export const ANONYMOUS_ON = TARGET === 'local';

interface Mail {
  ID: string;
  Subject: string;
  Created: string;
}

/** The newest email to `address` (optionally newer than `after`), waiting up to 10 seconds for it. */
export async function latestMail(address: string, after?: string): Promise<{ subject: string; text: string; link: string }> {
  for (let i = 0; i < 50; i++) {
    const found = (await (await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json()) as { messages: Mail[] };
    const mail = found.messages.find((m) => !after || m.Created > after);
    if (mail) {
      const full = (await (await fetch(`${MAIL_URL}/api/v1/message/${mail.ID}`)).json()) as { Text: string };
      const link = /https?:\/\/\S+\/auth\/v1\/verify\S+/.exec(full.Text)?.[0];
      if (!link) throw new Error(`no link in "${mail.Subject}"`);
      return { subject: mail.Subject, text: full.Text, link };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no email to ${address}`);
}

/** Opens a link from an email the way a browser would, without following the redirect back to the app. */
export async function openLink(link: string): Promise<{ status: number; location: string }> {
  const res = await fetch(link, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

export const newEmail = () => `t-${randomUUID()}@example.test`;
export const newPassword = () => `pw-${randomUUID()}`;

/** Accounts made by the tests, so a hosted test project can be left without them (`deleteTestAccounts`). */
const made: { email: string; password: string }[] = [];

/** Signs up, confirms the email through its link (when the target sends emails), and signs in. */
export async function confirmedAccount(sb: SupabaseClient, email = newEmail(), password = newPassword()) {
  const up = await sb.auth.signUp({ email, password });
  if (up.error) throw new Error(`sign-up failed: ${up.error.message}`);
  made.push({ email, password });
  if (HAS_MAIL) await openLink((await latestMail(email)).link);
  else if (!up.data.session) throw new Error('This project requires email confirmation, but no email-testing server is configured (SUPABASE_TEST_MAIL_URL).');
  const r = await sb.auth.signInWithPassword({ email, password });
  if (r.error || !r.data.session) throw new Error(`sign-in failed: ${r.error?.message ?? 'no session'}`);
  return { email, password, userId: r.data.user!.id, session: r.data.session };
}

/**
 * On a hosted test project: deletes every account these tests made and can
 * still sign in to (through delete_account, after a fresh password sign-in:
 * the same path a person takes). Accounts already deleted, or whose password
 * a test changed, are left for the project's periodic purge.
 */
export async function deleteTestAccounts(url: string, key: string) {
  if (TARGET !== 'hosted') return;
  for (const { email, password } of made.splice(0)) {
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await sb.auth.signInWithPassword({ email, password });
    if (!r.error) await sb.rpc('delete_account');
  }
}
