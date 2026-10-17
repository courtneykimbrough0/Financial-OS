/**
 * Development only: the app on a local Supabase stack, with a temporary
 * anonymous identity. Loaded only by a build in the `supabase-dev` mode
 * (`npm run dev:supabase`, or `vite build --mode supabase-dev`); every other
 * build leaves this file out entirely (see main.tsx). See docs/SUPABASE.md.
 *
 * Anonymous identities are for isolated development: they can't be signed back
 * into from another browser and aren't accounts. The plan is still protected
 * by row-level security: only that identity can read or save it.
 */
import { createClient } from '@supabase/supabase-js';
import { useEffect, useState, type ReactNode } from 'react';
import type { StorageAdapter } from '../storage';
import { SupabaseStorageAdapter } from './adapter';

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

async function start(url: string, key: string): Promise<StorageAdapter> {
  const client = createClient(url, key, { auth: { storageKey: DEV_AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const { data } = await client.auth.getSession();
  if (!data.session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) throw new Error(`Couldn’t start a development session (${error.message}). Anonymous sign-ins must be on in the local stack’s supabase/config.toml.`);
  }
  return new SupabaseStorageAdapter(client);
}

/** Starts the development session, then renders the app with Supabase storage and a notice saying so. */
export function SupabaseDevelopment({ children }: { children: (adapter: StorageAdapter) => ReactNode }) {
  const url = import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const problem = devConfigProblem(url, key);
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [error, setError] = useState<string | null>(problem);

  useEffect(() => {
    if (problem) return;
    start(url, key!).then(setAdapter, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [problem, url, key]);

  if (error) {
    return (
      <div className="load-screen" role="alert">
        <p>Development storage couldn’t start. {error}</p>
      </div>
    );
  }
  if (!adapter) {
    return (
      <div className="load-screen" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>Opening Financial OS…</p>
      </div>
    );
  }
  return (
    <>
      <p className="dev-storage-note" role="note">
        Development storage: local Supabase, temporary anonymous identity. Not a real account; it can’t be recovered.
      </p>
      {children(adapter)}
    </>
  );
}
