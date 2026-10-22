/**
 * The app on Supabase, with email-and-password accounts (Supabase Auth): on a
 * local stack (the `supabase-dev` mode, `npm run dev:supabase`), on an
 * approved hosted test project (`supabase-hosted-test`, `npm run
 * build:hosted-test`), or on the production project (`supabase-production`,
 * `npm run build:supabase`, F2). Every other build leaves this file out
 * entirely (see main.tsx). Which project may be used is checked in target.ts.
 * See docs/SUPABASE.md and docs/SUPABASE-HOSTED.md.
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
import { approvedRefs, devConfigProblem, hostedTestConfigProblem, productionConfigProblem } from './target';
import hostedTestProjects from '../../../supabase/hosted-test/projects.json';

/** Which Supabase this build uses: the local stack, the approved hosted test project, or the production project. */
const target: 'local' | 'hosted-test' | 'production' =
  import.meta.env.MODE === 'supabase-production' ? 'production' : import.meta.env.MODE === 'supabase-hosted-test' ? 'hosted-test' : 'local';

export { devConfigProblem } from './target';

/** Where supabase-js keeps the development session (tokens only; the plan itself is never stored on the device). */
export const DEV_AUTH_KEY = 'financial-os:supabase-dev-auth';
/** The production session, kept apart from any development one. */
export const AUTH_KEY = 'financial-os:supabase-auth';

const slot: AccountSlot = {
  Card: AccountCard,
  Line: AccountLine,
  Guard: SessionGuard,
  dataNote: 'Your data is saved to your account as you make changes, and nothing financial is kept on this device. A change counts as saved only once the server confirms it.',
};

/** Email-and-password accounts on Supabase, then the app with that account's plan. */
export function SupabaseStorage({ children }: { children: (adapter: StorageAdapter) => ReactNode }) {
  // Hosted projects have no default address: they must be named exactly.
  const url = target === 'local' ? (import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321') : import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const ref = import.meta.env.VITE_SUPABASE_PROJECT_REF;
  const problem =
    target === 'production' ? productionConfigProblem(url, key) : target === 'hosted-test' ? hostedTestConfigProblem(url, key, ref, approvedRefs(hostedTestProjects)) : devConfigProblem(url, key);
  const storageKey = target === 'production' ? AUTH_KEY : DEV_AUTH_KEY;
  // PKCE: links in emails return with a one-time code for the browser that asked, never with tokens in the address.
  // ownerGuardFetch: a request bound to one account is never sent under another account's session.
  const client = useMemo(
    () =>
      problem
        ? null
        : createClient(url!, key!, { auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }, global: { fetch: ownerGuardFetch() } }),
    [problem, url, key, storageKey],
  );
  // For checking a password without touching the browser's session: in memory only, never shared with other tabs.
  const verifier = useMemo(
    () => () => createClient(url!, key!, { auth: { storageKey: `${storageKey}:verify`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
    [url, key, storageKey],
  );

  if (!client) {
    return (
      <div className="load-screen" role="alert">
        <p>{target === 'production' ? 'Financial OS isn\'t configured correctly.' : 'Development storage couldn\'t start.'} {problem}</p>
      </div>
    );
  }
  return (
    <>
      {target !== 'production' && (
        <p className="dev-storage-note" role="note">
          {target === 'hosted-test' ? `Development storage: hosted Supabase test project ${ref}. Test accounts only; not for real financial data.` : 'Development storage: local Supabase. For testing only; not for real financial data.'}
        </p>
      )}
      <SupabaseAccountGate client={client} verifier={verifier} screens={{ SignedOut: SignedOutScreen, NewPassword: NewPasswordScreen, Recovery: RecoveryPanel }} slot={slot}>
        {children}
      </SupabaseAccountGate>
    </>
  );
}
