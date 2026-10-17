/**
 * Development only: the app on a local Supabase stack, with email-and-password
 * accounts (Supabase Auth). Loaded only by a build in the `supabase-dev` mode
 * (`npm run dev:supabase`, or `vite build --mode supabase-dev`); every other
 * build leaves this file out entirely (see main.tsx). See docs/SUPABASE.md.
 *
 * Each account's plan is protected by row-level security: only that account
 * can read or save it. New anonymous identities are never created; one left in
 * this browser by an earlier development build can be turned into an account
 * (Settings) without changing its identity or plan.
 */
import { createClient } from '@supabase/supabase-js';
import { useMemo, type ReactNode } from 'react';
import type { StorageAdapter } from '../storage';
import { AccountCard, AccountLine, SessionGuard } from '../../ui/supabase/AccountControls';
import { NewPasswordScreen, SignedOutScreen } from '../../ui/supabase/AuthScreens';
import type { AccountSlot } from '../slots';
import { SupabaseAccountGate } from './session';

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * Why this configuration can't be used, or null. Only a stack on this machine,
 * and only a public (anon or publishable) key: a service-role or secret key
 * must never reach a browser.
 */
export function devConfigProblem(url: string | undefined, key: string | undefined): string | null {
  let host = '';
  try {
    host = new URL(url ?? '').hostname;
  } catch {
    // reported below
  }
  if (!LOOPBACK.includes(host)) return 'VITE_SUPABASE_URL must be a local Supabase stack (127.0.0.1 or localhost).';
  if (!key) return 'Set VITE_SUPABASE_ANON_KEY to the local stack’s anon or publishable key (shown by `supabase status`).';
  if (key.startsWith('sb_publishable_')) return null;
  if (key.startsWith('sb_secret_')) return 'VITE_SUPABASE_ANON_KEY is a secret key. Use the anon or publishable key.';
  try {
    const role = (JSON.parse(atob(key.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }).role;
    return role === 'anon' ? null : `VITE_SUPABASE_ANON_KEY is a ${role ?? 'unknown'} key. Use the anon or publishable key.`;
  } catch {
    return 'VITE_SUPABASE_ANON_KEY isn’t a Supabase key.';
  }
}

/** Where supabase-js keeps the development session (tokens only; the plan itself is never stored on the device). */
export const DEV_AUTH_KEY = 'financial-os:supabase-dev-auth';

const slot: AccountSlot = {
  Card: AccountCard,
  Line: AccountLine,
  Guard: SessionGuard,
  dataNote: 'Your data is saved to your account as you make changes, and nothing financial is kept on this device. A change counts as saved only once the server confirms it.',
};

/** Development storage: email-and-password accounts on a local Supabase stack, then the app with that account's plan. */
export function SupabaseDevelopment({ children }: { children: (adapter: StorageAdapter) => ReactNode }) {
  const url = import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const problem = devConfigProblem(url, key);
  // PKCE: links in emails return with a one-time code for the browser that asked, never with tokens in the address.
  const client = useMemo(
    () => (problem ? null : createClient(url, key!, { auth: { storageKey: DEV_AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } })),
    [problem, url, key],
  );

  if (!client) {
    return (
      <div className="load-screen" role="alert">
        <p>Development storage couldn’t start. {problem}</p>
      </div>
    );
  }
  return (
    <>
      <p className="dev-storage-note" role="note">
        Development storage: local Supabase. For testing only; not for real financial data.
      </p>
      <SupabaseAccountGate client={client} screens={{ SignedOut: SignedOutScreen, NewPassword: NewPasswordScreen }} slot={slot}>
        {children}
      </SupabaseAccountGate>
    </>
  );
}
