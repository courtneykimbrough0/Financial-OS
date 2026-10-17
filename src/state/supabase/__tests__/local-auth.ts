/**
 * Real accounts on the local Supabase stack, for the integration and browser
 * tests: sign-ups confirmed through the stack's own email-testing server
 * (Mailpit, which receives every email the local auth server sends).
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const MAIL_URL = process.env.SUPABASE_TEST_MAIL_URL ?? 'http://127.0.0.1:54324';

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

/** Signs up, confirms the email through its link, and signs in. */
export async function confirmedAccount(sb: SupabaseClient, email = newEmail(), password = newPassword()) {
  const up = await sb.auth.signUp({ email, password });
  if (up.error) throw new Error(`sign-up failed: ${up.error.message}`);
  await openLink((await latestMail(email)).link);
  const r = await sb.auth.signInWithPassword({ email, password });
  if (r.error || !r.data.session) throw new Error(`sign-in failed: ${r.error?.message ?? 'no session'}`);
  return { email, password, userId: r.data.user!.id, session: r.data.session };
}
