// Browser tests of the app on Supabase: `npm run e2e:supabase`.
//
// The local stack by default, or an approved hosted TEST project with
// SUPABASE_TEST_TARGET=hosted; the target is checked as for
// `npm run test:supabase` (scripts/supabase-target.mjs). Builds three copies of the app:
//   - the Supabase copy (`--mode supabase-dev` for the local stack, or
//     `--mode supabase-hosted-test` for the hosted test project), with
//     email-and-password accounts;
//   - the default copy, exactly as `npm run build` makes it, to check it never
//     loads Supabase;
//   - a device-storage copy (as `npm run e2e` uses), to move a plan from the
//     current storage to Supabase through a backup, and back.
// Serves each with server.mjs (as Cloud Run does) and runs e2e/*.e2e.test.ts in
// Chromium through Playwright.
import { spawn, spawnSync } from 'node:child_process';
import { supabaseTarget, testEnv } from './supabase-target.mjs';

const root = new URL('..', import.meta.url).pathname;
const target = await supabaseTarget();
const { url, key } = target;
// The local stack uses the local development build; an approved hosted test project its own build mode.
const devMode = target.kind === 'hosted' ? 'supabase-hosted-test' : 'supabase-dev';

const build = (outDir, args, env) => {
  const r = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir', ...args], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
// The development copy is the only one given the local stack's address and public key.
build('dist-e2e-supabase', ['--mode', devMode], { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key, VITE_SUPABASE_PROJECT_REF: target.ref ?? '' });
const { VITE_SUPABASE_URL: _u, VITE_SUPABASE_ANON_KEY: _k, VITE_SUPABASE_PROJECT_REF: _r, ...withoutSupabase } = process.env;
for (const [outDir, env] of [['dist-e2e-default', withoutSupabase], ['dist-e2e-legacy', { ...withoutSupabase, VITE_ACCOUNTS: 'off' }]]) {
  const r = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const servers = [];
async function serve(distDir, port) {
  const s = spawn(process.execPath, [`${root}server.mjs`], { stdio: 'pipe', env: { ...process.env, PORT: String(port), DIST_DIR: distDir } });
  servers.push(s);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server for ${distDir} did not start`)), 20000);
    s.stdout.on('data', (d) => String(d).includes(String(port)) && (clearTimeout(t), resolve()));
  });
  return `http://localhost:${port}/`;
}

let status = 1;
try {
  const devBase = await serve('dist-e2e-supabase', 4183);
  const defaultBase = await serve('dist-e2e-default', 4184);
  const legacyBase = await serve('dist-e2e-legacy', 4185);
  const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...testEnv(target), E2E_SUPABASE_BASE: devBase, E2E_DEFAULT_BASE: defaultBase, E2E_LEGACY_BASE: legacyBase, E2E_DEFAULT_DIST: `${root}dist-e2e-default` },
  });
  status = r.status ?? 1;
} finally {
  for (const s of servers) s.kill();
}
process.exit(status);
