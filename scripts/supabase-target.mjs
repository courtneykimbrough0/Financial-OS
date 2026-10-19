// Which Supabase the integration and browser tests run against, checked before
// anything runs. Exits with status 2 when the target isn't allowed.
//
//   SUPABASE_TEST_TARGET=local (default)  the local stack: only addresses on
//     this machine, as before.
//   SUPABASE_TEST_TARGET=hosted           an isolated hosted TEST project, and
//     only one that is:
//       - listed in supabase/hosted-test/projects.json (a reviewed commit);
//       - named by SUPABASE_TEST_PROJECT_REF, with SUPABASE_TEST_URL (if set)
//         exactly https://<ref>.supabase.co: no other address, no fallback;
//       - confirmed for destructive tests: SUPABASE_TEST_ALLOW_DESTRUCTIVE must
//         repeat the same ref (the tests create and delete accounts);
//       - marked inside its database as that test project
//         (supabase/hosted-test/marker.sql).
//
// Either way only a public key (anon or publishable) is accepted: the tests use
// only what a browser has. Email confirmation stays on, so the tests read each
// confirmation or recovery email: from the local stack's email-testing server,
// or for a hosted project from its test outbox (SUPABASE_TEST_OUTBOX_SECRET,
// supabase/hosted-test/test-outbox.sql) or a Mailpit-compatible API
// (SUPABASE_TEST_MAIL_URL). A hosted run with neither is refused.
import { readFileSync } from 'node:fs';

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const REF = /^[a-z]{20}$/;
export const MARKER_PREFIX = 'financial-os-hosted-test:';

const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

/** The role a key carries: 'anon' for the public ones; anything else is refused. Also a legacy key's project ref, if it names one. */
export function keyRole(key) {
  if (!key) return { role: 'missing', ref: null };
  if (key.startsWith('sb_publishable_')) return { role: 'anon', ref: null };
  if (key.startsWith('sb_secret_')) return { role: 'secret', ref: null };
  try {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    return { role: claims.role ?? 'unknown', ref: claims.ref ?? null };
  } catch {
    return { role: 'unknown', ref: null };
  }
}

/**
 * The checks that need no network: returns { ok: true, target } or { ok: false, error }.
 * `env` is process.env; `approved` is the list of approved project refs.
 */
export function checkTarget(env, approved) {
  const target = env.SUPABASE_TEST_TARGET ?? 'local';
  const key = env.SUPABASE_TEST_ANON_KEY ?? '';
  const { role, ref: keyRef } = keyRole(key);
  const keyProblem =
    role === 'missing'
      ? 'Set SUPABASE_TEST_ANON_KEY to the project’s anon or publishable key.'
      : role !== 'anon'
        ? `SUPABASE_TEST_ANON_KEY must be the public anon or publishable key, not a ${role} key.`
        : null;

  if (target === 'local') {
    const url = env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321';
    const mailUrl = env.SUPABASE_TEST_MAIL_URL ?? 'http://127.0.0.1:54324';
    if (!LOOPBACK.includes(hostOf(url))) return { ok: false, error: `SUPABASE_TEST_URL must be a local Supabase stack (127.0.0.1 or localhost); got "${hostOf(url) || url}". To test a hosted project, set SUPABASE_TEST_TARGET=hosted.` };
    if (!LOOPBACK.includes(hostOf(mailUrl))) return { ok: false, error: 'SUPABASE_TEST_MAIL_URL must be the local stack’s email-testing server.' };
    if (keyProblem) return { ok: false, error: keyProblem };
    return { ok: true, target: { kind: 'local', url, key, mailUrl, ref: null, outboxSecret: env.SUPABASE_TEST_OUTBOX_SECRET || null } };
  }

  if (target !== 'hosted') return { ok: false, error: `SUPABASE_TEST_TARGET must be "local" or "hosted"; got "${target}".` };
  const ref = env.SUPABASE_TEST_PROJECT_REF ?? '';
  if (!REF.test(ref)) return { ok: false, error: 'Set SUPABASE_TEST_PROJECT_REF to the hosted test project’s 20-letter ref.' };
  if (!approved.includes(ref)) return { ok: false, error: `Project ${ref} isn’t in supabase/hosted-test/projects.json. Only approved test projects can be used.` };
  const url = `https://${ref}.supabase.co`;
  if (env.SUPABASE_TEST_URL !== undefined && env.SUPABASE_TEST_URL.replace(/\/$/, '') !== url) return { ok: false, error: `SUPABASE_TEST_URL must be exactly ${url} for project ${ref}.` };
  if (keyProblem) return { ok: false, error: keyProblem };
  if (keyRef && keyRef !== ref) return { ok: false, error: `SUPABASE_TEST_ANON_KEY belongs to project ${keyRef}, not ${ref}.` };
  if (env.SUPABASE_TEST_ALLOW_DESTRUCTIVE !== ref) return { ok: false, error: `These tests create and delete accounts. Set SUPABASE_TEST_ALLOW_DESTRUCTIVE=${ref} to confirm ${ref} is a disposable test project.` };
  const mailUrl = env.SUPABASE_TEST_MAIL_URL || null;
  if (mailUrl && !hostOf(mailUrl)) return { ok: false, error: 'SUPABASE_TEST_MAIL_URL isn’t a valid address.' };
  const outboxSecret = env.SUPABASE_TEST_OUTBOX_SECRET || null;
  if (!mailUrl && !outboxSecret) {
    return { ok: false, error: 'Email confirmation stays on, so a hosted run needs to read confirmation emails: set SUPABASE_TEST_OUTBOX_SECRET (supabase/hosted-test/test-outbox.sql) or SUPABASE_TEST_MAIL_URL.' };
  }
  return { ok: true, target: { kind: 'hosted', url, key, mailUrl, ref, outboxSecret } };
}

/** The approved hosted test projects (supabase/hosted-test/projects.json). */
export function approvedProjects(path = new URL('../supabase/hosted-test/projects.json', import.meta.url)) {
  const list = JSON.parse(readFileSync(path, 'utf8')).projects ?? [];
  return list.map((p) => (typeof p === 'string' ? p : p.ref)).filter((r) => REF.test(r ?? ''));
}

/** Checks the target, then that it answers (and, for a hosted project, that it is marked as that test project). */
export async function supabaseTarget(env = process.env) {
  const fail = (message) => {
    console.error(message);
    process.exit(2);
  };
  const checked = checkTarget(env, approvedProjects());
  if (!checked.ok) fail(checked.error);
  const t = checked.target;
  try {
    const res = await fetch(`${t.url}/auth/v1/health`, { headers: { apikey: t.key } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    fail(t.kind === 'local' ? `No Supabase stack answered at ${t.url} (${err.message}). Start one with \`supabase start\`.` : `Project ${t.ref} didn’t answer at ${t.url} (${err.message}).`);
  }
  if (t.kind === 'hosted') {
    let marker = null;
    try {
      const res = await fetch(`${t.url}/rest/v1/rpc/financial_os_test_environment`, { method: 'POST', headers: { apikey: t.key, 'Content-Type': 'application/json' }, body: '{}' });
      marker = res.ok ? await res.json() : null;
    } catch {
      marker = null;
    }
    if (marker !== `${MARKER_PREFIX}${t.ref}`) fail(`Project ${t.ref} isn’t marked as the Financial OS test project (supabase/hosted-test/marker.sql), so nothing was run.`);
  }
  if (t.outboxSecret) {
    let answered = false;
    try {
      const res = await fetch(`${t.url}/rest/v1/rpc/financial_os_test_read_outbox`, { method: 'POST', headers: { apikey: t.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_secret: t.outboxSecret, p_email: 'nobody@example.test' }) });
      answered = res.ok;
    } catch {
      answered = false;
    }
    if (!answered) fail('The test outbox didn’t accept SUPABASE_TEST_OUTBOX_SECRET (supabase/hosted-test/test-outbox.sql), so nothing was run.');
  } else if (t.mailUrl) {
    try {
      const res = await fetch(`${t.mailUrl}/api/v1/info`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      fail(`The email-testing server didn’t answer at ${t.mailUrl} (${err.message}).`);
    }
  }
  return t;
}

/** What the test files read: where to connect, and what the target can do. */
export function testEnv(t) {
  return {
    SUPABASE_TEST_TARGET: t.kind,
    SUPABASE_TEST_URL: t.url,
    SUPABASE_TEST_ANON_KEY: t.key,
    SUPABASE_TEST_PROJECT_REF: t.ref ?? '',
    SUPABASE_TEST_MAIL_URL: t.outboxSecret ? '' : (t.mailUrl ?? ''),
    SUPABASE_TEST_OUTBOX_SECRET: t.outboxSecret ?? '',
  };
}
