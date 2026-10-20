/**
 * Development only: the app on a local Supabase stack, or on an approved
 * hosted test project, with email-and-password accounts (Supabase Auth).
 * Loaded only by a build in the `supabase-dev` mode (`npm run dev:supabase`)
 * or the `supabase-hosted-test` mode (`npm run build:hosted-test`); every
 * other build leaves this file out entirely (see main.tsx). Which project may
 * be used is checked in target.ts. See docs/SUPABASE.md and
 * docs/SUPABASE-HOSTED.md.
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
import { RecoveryPanel } from '../../ui/supabase/RecoveryPanel';
import { ownerGuardFetch } from './adapter';
import type { AccountSlot } from '../slots';
import { SupabaseAccountGate } from './session';
import { approvedRefs, devConfigProblem, hostedTestConfigProblem } from './target';
import hostedTestProjects from '../../../supabase/hosted-test/projects.json';

/** Which Supabase this build uses: the local stack, or (in the `supabase-hosted-test` mode) the approved hosted test project. */
const hosted = import.meta.env.MODE === 'supabase-hosted-test';

export { devConfigProblem } from './target';

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
  // The hosted test project has no default address: it must be named exactly.
  const url = hosted ? import.meta.env.VITE_SUPABASE_URL : (import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const ref = import.meta.env.VITE_SUPABASE_PROJECT_REF;
  const problem = hosted ? hostedTestConfigProblem(url, key, ref, approvedRefs(hostedTestProjects)) : devConfigProblem(url, key);
  // PKCE: links in emails return with a one-time code for the browser that asked, never with tokens in the address.
  // ownerGuardFetch: a request bound to one account is never sent under another account's session.
  const client = useMemo(
    () =>
      problem
        ? null
        : createClient(url!, key!, { auth: { storageKey: DEV_AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }, global: { fetch: ownerGuardFetch() } }),
    [problem, url, key],
  );
  // For checking a password without touching the browser's session: in memory only, never shared with other tabs.
  const verifier = useMemo(
    () => () => createClient(url!, key!, { auth: { storageKey: `${DEV_AUTH_KEY}:verify`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
    [url, key],
  );

  if (!client) {
    return (
      <div className="load-screen" role="alert">
        <p>Development storage couldn't start. {problem}</p>
      </div>
    );
  }
  return (
    <>
      <p className="dev-storage-note" role="note">
        {hosted ? `Development storage: hosted Supabase test project ${ref}. Test accounts only; not for real financial data.` : 'Development storage: local Supabase. For testing only; not for real financial data.'}
      </p>
      <SupabaseAccountGate client={client} verifier={verifier} screens={{ SignedOut: SignedOutScreen, NewPassword: NewPasswordScreen, Recovery: RecoveryPanel }} slot={slot}>
        {children}
      </SupabaseAccountGate>
    </>
  );
}
