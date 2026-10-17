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

const url = process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_TEST_ANON_KEY ?? '';

let host;
try {
  host = new URL(url).hostname;
} catch {
  host = '';
}
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
  console.error(`SUPABASE_TEST_URL must be a local Supabase stack (127.0.0.1 or localhost); got "${host || url}". These tests never run against a hosted project.`);
  process.exit(2);
}
if (!key) {
  console.error('Set SUPABASE_TEST_ANON_KEY to the local stack’s anon or publishable key (shown by `supabase status`).');
  process.exit(2);
}
const role = (() => {
  if (key.startsWith('sb_publishable_')) return 'anon';
  if (key.startsWith('sb_secret_')) return 'secret';
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
  } catch {
    return 'unknown';
  }
})();
if (role !== 'anon') {
  console.error(`SUPABASE_TEST_ANON_KEY must be the public anon or publishable key, not a ${role} key.`);
  process.exit(2);
}

try {
  const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.error(`No Supabase stack answered at ${url} (${err.message}). Start one with \`supabase start\`.`);
  process.exit(2);
}

const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.supabase.config.ts', ...process.argv.slice(2)], {
  env: { ...process.env, SUPABASE_TEST_URL: url, SUPABASE_TEST_ANON_KEY: key },
  stdio: 'inherit',
  cwd: new URL('..', import.meta.url).pathname,
});
process.exit(r.status ?? 1);
