/**
 * Talking to the test PostgreSQL started by `npm run test:db`, through psql.
 * Each call is a separate session acting as one identity, the way Supabase
 * runs requests: role `authenticated` with the user's id in the JWT claims,
 * role `anon` for a signed-out caller, or the database owner for setup and
 * for checking what is really stored.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fromRows, toRows, type LoadedPlan } from '../rows';
import type { AppData } from '../../../domain/types';

export type Who = { user: string } | 'anon' | 'owner';

export interface SqlResult {
  ok: boolean;
  out: string;
  /** SQLSTATE of the error, when there was one. */
  code: string | null;
  message: string | null;
}

function prelude(who: Who): string {
  if (who === 'owner') return '';
  if (who === 'anon') return `set role anon;\nselect set_config('request.jwt.claims', '{"role":"anon"}', false);\n`;
  return `set role authenticated;\nselect set_config('request.jwt.claims', '${JSON.stringify({ sub: who.user, role: 'authenticated' })}', false);\n`;
}

const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];

function parse(status: number | null, stdout: string, stderr: string): SqlResult {
  const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(stderr);
  return { ok: status === 0, out: stdout.trim(), code: m?.[1] ?? null, message: m?.[2] ?? (status === 0 ? null : stderr.trim()) };
}

/** Runs SQL as `who` in a fresh session. */
export function sql(who: Who, text: string): SqlResult {
  const r = spawnSync('psql', args, { input: `${prelude(who)}${text}\n`, encoding: 'utf8' });
  // The prelude's select prints the claims; drop it.
  const out = who === 'owner' ? r.stdout : r.stdout.split('\n').slice(1).join('\n');
  return parse(r.status, out, r.stderr);
}

/** Starts SQL as `who` without waiting, for overlapping sessions. */
export function sqlAsync(who: Who, text: string): Promise<SqlResult> {
  return new Promise((resolve) => {
    const p = spawn('psql', args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (status) => resolve(parse(status, who === 'owner' ? out : out.split('\n').slice(1).join('\n'), err)));
    p.stdin.end(`${prelude(who)}${text}\n`);
  });
}

/** SQL for a JSON literal, safe for any content. */
export const json = (value: unknown) => `$fo$${JSON.stringify(value)}$fo$::jsonb`;
export const text = (value: string) => `$fo$${value}$fo$`;

/** A new signed-in test user with a workspace. */
export function newUser(): string {
  const id = randomUUID();
  const r = sql('owner', `insert into auth.users (id) values ('${id}');`);
  if (!r.ok) throw new Error(r.message ?? 'could not create user');
  const ws = sql({ user: id }, 'select public.create_workspace();');
  if (!ws.ok) throw new Error(ws.message ?? 'could not create workspace');
  return id;
}

export type SaveMode = 'update' | 'replace' | 'reset';
export interface SaveOutcome extends SqlResult {
  result: { status: 'saved' | 'already_saved'; revision: number; current_revision: number } | null;
}

export function savePlan(user: string, baseRevision: number, payload: unknown, opts: { mode?: SaveMode; saveId?: string } = {}): SaveOutcome {
  const r = sql({ user }, `select public.save_plan(${baseRevision}, '${opts.saveId ?? randomUUID()}', '${opts.mode ?? 'update'}', ${json(payload)});`);
  return { ...r, result: r.ok ? JSON.parse(r.out) : null };
}

export function loadRows(user: string): LoadedPlan | null {
  const r = sql({ user }, 'select public.load_plan();');
  if (!r.ok) throw new Error(r.message ?? 'load failed');
  return r.out === '' ? null : (JSON.parse(r.out) as LoadedPlan);
}

export function load(user: string): AppData {
  const rows = loadRows(user);
  if (!rows) throw new Error('no workspace');
  return fromRows(rows);
}

/** Saves `data` as the app would: the whole plan, based on the revision it was loaded at. */
export function save(user: string, data: AppData, opts: { mode?: SaveMode; saveId?: string } = {}): SaveOutcome {
  return savePlan(user, data.revision, toRows(data), opts);
}

/** Saves, insisting it worked, and returns the plan as stored. */
export function saveOk(user: string, data: AppData, mode: SaveMode = 'update'): AppData {
  const r = save(user, data, { mode });
  if (!r.ok) throw new Error(`save failed: ${r.code} ${r.message}`);
  return load(user);
}

/** A single number from SQL run as the database owner. */
export function count(query: string): number {
  const r = sql('owner', query);
  if (!r.ok) throw new Error(r.message ?? 'query failed');
  return Number(r.out);
}

export const workspaceOf = (user: string) => sql('owner', `select id from public.workspaces where owner_id = '${user}';`).out;
