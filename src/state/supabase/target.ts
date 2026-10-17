/**
 * Which Supabase a Supabase build may use. Two build modes, both left out of
 * every other build (see main.tsx):
 *
 * - `supabase-dev`: the local stack only (an address on this machine).
 * - `supabase-hosted-test`: one approved hosted TEST project only. Its ref
 *   (VITE_SUPABASE_PROJECT_REF) must be listed in
 *   supabase/hosted-test/projects.json, and VITE_SUPABASE_URL must be exactly
 *   https://<ref>.supabase.co. There is no default address and no fallback.
 *
 * Either way only a public (anon or publishable) key: a service-role or
 * secret key must never reach a browser.
 */
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const REF = /^[a-z]{20}$/;

function keyProblem(key: string | undefined, ref: string | null): string | null {
  if (!key) return 'Set VITE_SUPABASE_ANON_KEY to the project’s anon or publishable key.';
  if (key.startsWith('sb_publishable_')) return null;
  if (key.startsWith('sb_secret_')) return 'VITE_SUPABASE_ANON_KEY is a secret key. Use the anon or publishable key.';
  try {
    const claims = JSON.parse(atob(key.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string; ref?: string };
    if (claims.role !== 'anon') return `VITE_SUPABASE_ANON_KEY is a ${claims.role ?? 'unknown'} key. Use the anon or publishable key.`;
    if (ref && claims.ref && claims.ref !== ref) return `VITE_SUPABASE_ANON_KEY belongs to project ${claims.ref}, not ${ref}.`;
    return null;
  } catch {
    return 'VITE_SUPABASE_ANON_KEY isn’t a Supabase key.';
  }
}

/** Local development: why this configuration can't be used, or null. */
export function devConfigProblem(url: string | undefined, key: string | undefined): string | null {
  let host = '';
  try {
    host = new URL(url ?? '').hostname;
  } catch {
    // reported below
  }
  if (!LOOPBACK.includes(host)) return 'VITE_SUPABASE_URL must be a local Supabase stack (127.0.0.1 or localhost).';
  if (!key) return 'Set VITE_SUPABASE_ANON_KEY to the local stack’s anon or publishable key (shown by `supabase status`).';
  return keyProblem(key, null);
}

/** The hosted test project: why this configuration can't be used, or null. `approved` lists the approved project refs. */
export function hostedTestConfigProblem(url: string | undefined, key: string | undefined, ref: string | undefined, approved: readonly string[]): string | null {
  if (!ref || !REF.test(ref)) return 'Set VITE_SUPABASE_PROJECT_REF to the hosted test project’s 20-letter ref.';
  if (!approved.includes(ref)) return `Project ${ref} isn’t an approved test project (supabase/hosted-test/projects.json).`;
  if ((url ?? '').replace(/\/$/, '') !== `https://${ref}.supabase.co`) return `VITE_SUPABASE_URL must be exactly https://${ref}.supabase.co.`;
  return keyProblem(key, ref);
}

/** The approved refs from projects.json (entries are refs, or objects with a `ref`). */
export function approvedRefs(file: { projects?: unknown[] }): string[] {
  return (file.projects ?? []).map((p) => (typeof p === 'string' ? p : (p as { ref?: string } | null)?.ref ?? '')).filter((r) => REF.test(r));
}
