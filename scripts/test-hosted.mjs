// The focused hosted verification (roadmap F3): `npm run test:hosted`.
//
// Runs `src/**/*.hosted.test.ts` against the approved hosted TEST project only,
// after the same checks as the other hosted runs (scripts/supabase-target.mjs:
// allowlist, exact address, destructive-test confirmation, public key only,
// in-database marker). It reads no email, so it needs no test outbox. Instead
// it signs in as two disposable identities, created confirmed beforehand with
// @example.test addresses (docs/SUPABASE-HOSTED.md), and deletes them through
// delete_account() as it finishes:
//
//   SUPABASE_TEST_TARGET=hosted SUPABASE_TEST_PROJECT_REF=<ref> \
//   SUPABASE_TEST_ANON_KEY=<publishable key> SUPABASE_TEST_ALLOW_DESTRUCTIVE=<ref> \
//   SUPABASE_TEST_IDENTITY_A=<a@example.test> SUPABASE_TEST_IDENTITY_A_PASSWORD=<…> \
//   SUPABASE_TEST_IDENTITY_B=<b@example.test> SUPABASE_TEST_IDENTITY_B_PASSWORD=<…> \
//   npm run test:hosted
import { spawnSync } from 'node:child_process';
import { supabaseTarget, testEnv } from './supabase-target.mjs';

export function identityProblem(env) {
  for (const who of ['A', 'B']) {
    const email = env[`SUPABASE_TEST_IDENTITY_${who}`] ?? '';
    if (!/^[a-z0-9._+-]+@example\.test$/i.test(email)) return `Set SUPABASE_TEST_IDENTITY_${who} to a disposable @example.test address (never a real person's).`;
    if ((env[`SUPABASE_TEST_IDENTITY_${who}_PASSWORD`] ?? '').length < 8) return `Set SUPABASE_TEST_IDENTITY_${who}_PASSWORD (8 characters or more).`;
  }
  if (env.SUPABASE_TEST_IDENTITY_A.toLowerCase() === env.SUPABASE_TEST_IDENTITY_B.toLowerCase()) return 'The two disposable identities must be different.';
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.SUPABASE_TEST_TARGET !== 'hosted') {
    console.error('The focused hosted verification runs only against the hosted test project: set SUPABASE_TEST_TARGET=hosted.');
    process.exit(2);
  }
  const problem = identityProblem(process.env);
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
  const target = await supabaseTarget(process.env, { needsMail: false });
  const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.hosted.config.ts', ...process.argv.slice(2)], {
    env: { ...process.env, ...testEnv(target) },
    stdio: 'inherit',
    cwd: new URL('..', import.meta.url).pathname,
  });
  process.exit(r.status ?? 1);
}
