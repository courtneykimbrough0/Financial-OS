// Runs the Supabase integration tests (`src/**/*.supabase.test.ts`): `npm run test:supabase`.
//
// Against the LOCAL stack by default: start it with the Supabase CLI
// (`supabase start` from the repository, which applies supabase/migrations),
// then pass its public (anon or publishable) key:
//
//   SUPABASE_TEST_ANON_KEY=<key from `supabase status`> npm run test:supabase
//
// Against an approved hosted TEST project only with SUPABASE_TEST_TARGET=hosted
// and the checks in scripts/supabase-target.mjs (allowlist, exact address,
// destructive-test confirmation, in-database marker). The tests sign up and
// delete throwaway accounts, and never accept a service-role or secret key.
import { spawnSync } from 'node:child_process';
import { supabaseTarget, testEnv } from './supabase-target.mjs';

const target = await supabaseTarget();

const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.supabase.config.ts', ...process.argv.slice(2)], {
  env: { ...process.env, ...testEnv(target) },
  stdio: 'inherit',
  cwd: new URL('..', import.meta.url).pathname,
});
process.exit(r.status ?? 1);
