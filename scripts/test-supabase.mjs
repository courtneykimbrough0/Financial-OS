// Runs the Supabase integration tests (`src/**/*.supabase.test.ts`) against a
// LOCAL Supabase stack: `npm run test:supabase`.
//
// Start the stack first with the Supabase CLI (`supabase start`, which applies
// supabase/migrations), then pass its API URL and its public (anon or
// publishable) key:
//
//   SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_ANON_KEY=<key from `supabase status`> npm run test:supabase
//
// The tests sign up throwaway users, so this refuses any address that isn't
// this machine, and refuses a service-role or secret key: the tests use only
// what a browser would have.
import { spawnSync } from 'node:child_process';
import { localSupabase } from './local-supabase.mjs';

const { url, key, mailUrl } = await localSupabase();

const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.supabase.config.ts', ...process.argv.slice(2)], {
  env: { ...process.env, SUPABASE_TEST_URL: url, SUPABASE_TEST_ANON_KEY: key, SUPABASE_TEST_MAIL_URL: mailUrl },
  stdio: 'inherit',
  cwd: new URL('..', import.meta.url).pathname,
});
process.exit(r.status ?? 1);
