// Runs the Supabase migrations and database tests against a throwaway local
// PostgreSQL cluster: `npm run test:db`.
//
// Needs the PostgreSQL server binaries (initdb, pg_ctl, postgres) and psql.
// The cluster lives in a temporary directory, listens only on a Unix socket,
// and is deleted afterwards. Supabase's auth schema and roles are stood in for
// by supabase/tests/local-supabase-shim.sql; the migrations themselves are the
// files in supabase/migrations, applied unchanged.
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const binDir = ['/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin'].find((d) => existsSync(join(d, 'initdb')));
const which = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).stdout.toString().trim();
const bin = (name) => (binDir ? join(binDir, name) : which(name));
if (!bin('initdb') || !bin('pg_ctl') || !which('psql')) {
  console.error('PostgreSQL server binaries (initdb, pg_ctl) and psql are needed for the database tests; they were not found.');
  process.exit(2);
}

const asRoot = process.getuid?.() === 0;
// initdb refuses to run as root; use the postgres system user when we are root.
const run = (cmd, args, opts = {}) => {
  const [c, a] = asRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args];
  return execFileSync(c, a, { stdio: 'pipe', ...opts });
};

const dir = mkdtempSync(join(tmpdir(), 'fo-pg-'));
if (asRoot) {
  const uid = Number(execFileSync('id', ['-u', 'postgres']).toString());
  const gid = Number(execFileSync('id', ['-g', 'postgres']).toString());
  chownSync(dir, uid, gid);
}
const data = join(dir, 'data');
const port = String(54300 + Math.floor(Math.random() * 90));
let started = false;
let status = 1;
try {
  run(bin('initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-sync', '-E', 'UTF8', '--locale=C']);
  run(bin('pg_ctl'), ['-D', data, '-w', '-l', join(dir, 'log'), '-o', `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off`, 'start']);
  started = true;
  const env = { ...process.env, PGHOST: dir, PGPORT: port, PGUSER: 'postgres', PGDATABASE: 'postgres' };
  const psqlFile = (file) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { env, stdio: 'pipe' });
  psqlFile(join(root, 'supabase/tests/local-supabase-shim.sql'));
  const migrations = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const m of migrations) psqlFile(join(root, 'supabase/migrations', m));
  console.log(`Applied ${migrations.length} migrations to PostgreSQL ${execFileSync('psql', ['-X', '-At', '-c', 'show server_version'], { env }).toString().trim()}.`);
  const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.db.config.ts', ...process.argv.slice(2)], { env, stdio: 'inherit', cwd: root });
  status = r.status ?? 1;
} catch (err) {
  console.error(err.stderr?.toString() || err);
} finally {
  if (started) {
    try {
      run(bin('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
    } catch {
      /* already stopped */
    }
  }
  rmSync(dir, { recursive: true, force: true });
}
process.exit(status);
