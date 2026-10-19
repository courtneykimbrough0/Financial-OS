import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvedRefs, devConfigProblem, hostedTestConfigProblem } from '../target';
import { approvedProjects, checkTarget } from '../../../../scripts/supabase-target.mjs';

const REF = 'abcdefghijklmnopqrst';
const OTHER = 'zyxwvutsrqponmlkjihg';
const jwt = (claims: object) => `x.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.y`;

describe('the hosted test project, in the browser build', () => {
  const ok = (url = `https://${REF}.supabase.co`, key = 'sb_publishable_abc', ref = REF, approved = [REF]) => hostedTestConfigProblem(url, key, ref, approved);

  it('accepts only an approved project at exactly its own address, with a public key', () => {
    expect(ok()).toBeNull();
    expect(ok(`https://${REF}.supabase.co/`)).toBeNull();
    expect(ok(undefined, jwt({ role: 'anon', ref: REF }))).toBeNull();
  });

  it('refuses everything else, with no fallback address', () => {
    expect(ok(undefined, undefined, '')).toBe('Set VITE_SUPABASE_PROJECT_REF to the hosted test project’s 20-letter ref.');
    expect(ok(undefined, undefined, 'short')).toBe('Set VITE_SUPABASE_PROJECT_REF to the hosted test project’s 20-letter ref.');
    expect(ok(undefined, undefined, REF, [])).toBe(`Project ${REF} isn’t an approved test project (supabase/hosted-test/projects.json).`);
    expect(ok(undefined, undefined, REF, [OTHER])).toBe(`Project ${REF} isn’t an approved test project (supabase/hosted-test/projects.json).`);
    for (const url of [undefined, '', `http://${REF}.supabase.co`, `https://${OTHER}.supabase.co`, `https://${REF}.supabase.co.evil.test`, `https://${REF}.supabase.co:8443`, `https://${REF}.supabase.co/rest`, 'http://127.0.0.1:54321']) {
      expect([url, hostedTestConfigProblem(url, 'sb_publishable_abc', REF, [REF])]).toEqual([url, `VITE_SUPABASE_URL must be exactly https://${REF}.supabase.co.`]);
    }
    expect(ok(undefined, 'sb_secret_abc')).toBe('VITE_SUPABASE_ANON_KEY is a secret key. Use the anon or publishable key.');
    expect(ok(undefined, jwt({ role: 'service_role', ref: REF }))).toBe('VITE_SUPABASE_ANON_KEY is a service_role key. Use the anon or publishable key.');
    expect(ok(undefined, jwt({ role: 'anon', ref: OTHER }))).toBe(`VITE_SUPABASE_ANON_KEY belongs to project ${OTHER}, not ${REF}.`);
    expect(hostedTestConfigProblem(`https://${REF}.supabase.co`, undefined, REF, [REF])).toBe('Set VITE_SUPABASE_ANON_KEY to the project’s anon or publishable key.');
  });

  it('the local development check is unchanged: this machine only', () => {
    expect(devConfigProblem('http://127.0.0.1:54321', 'sb_publishable_abc')).toBeNull();
    expect(devConfigProblem(`https://${REF}.supabase.co`, 'sb_publishable_abc')).toBe('VITE_SUPABASE_URL must be a local Supabase stack (127.0.0.1 or localhost).');
  });

  it('reads approved refs from the allowlist file, ignoring anything malformed', () => {
    expect(approvedRefs({ projects: [REF, { ref: OTHER, purpose: 'test' }, 'nope', { ref: 42 }, null] })).toEqual([REF, OTHER]);
    expect(approvedRefs({})).toEqual([]);
  });

  it('the committed allowlist approves no project yet', () => {
    expect(approvedProjects(`${process.cwd()}/supabase/hosted-test/projects.json`)).toEqual([]);
  });
});

describe('the test runners’ target', () => {
  const hostedEnv = (over: Record<string, string | undefined> = {}) => ({
    SUPABASE_TEST_TARGET: 'hosted',
    SUPABASE_TEST_PROJECT_REF: REF,
    SUPABASE_TEST_ANON_KEY: 'sb_publishable_abc',
    SUPABASE_TEST_ALLOW_DESTRUCTIVE: REF,
    SUPABASE_TEST_OUTBOX_SECRET: 'a-test-outbox-secret',
    ...over,
  });
  const error = (env: Record<string, string | undefined>, approved = [REF]) => {
    const r = checkTarget(env, approved);
    return r.ok ? null : r.error;
  };

  it('defaults to the local stack and keeps its local-only check', () => {
    expect(checkTarget({ SUPABASE_TEST_ANON_KEY: 'sb_publishable_abc' }, [])).toEqual({ ok: true, target: { kind: 'local', url: 'http://127.0.0.1:54321', key: 'sb_publishable_abc', mailUrl: 'http://127.0.0.1:54324', ref: null, outboxSecret: null } });
    expect(error({ SUPABASE_TEST_ANON_KEY: 'sb_publishable_abc', SUPABASE_TEST_URL: `https://${REF}.supabase.co` }, [REF])).toMatch(/^SUPABASE_TEST_URL must be a local Supabase stack/);
    expect(error({ SUPABASE_TEST_ANON_KEY: 'sb_secret_abc' })).toBe('SUPABASE_TEST_ANON_KEY must be the public anon or publishable key, not a secret key.');
  });

  it('a hosted project only when approved, at its exact address, confirmed for destructive tests', () => {
    expect(checkTarget(hostedEnv(), [REF])).toEqual({ ok: true, target: { kind: 'hosted', url: `https://${REF}.supabase.co`, key: 'sb_publishable_abc', mailUrl: null, ref: REF, outboxSecret: 'a-test-outbox-secret' } });
    // Email confirmation stays on: a hosted run must be able to read confirmation emails.
    expect(error(hostedEnv({ SUPABASE_TEST_OUTBOX_SECRET: undefined }))).toBe('Email confirmation stays on, so a hosted run needs to read confirmation emails: set SUPABASE_TEST_OUTBOX_SECRET (supabase/hosted-test/test-outbox.sql) or SUPABASE_TEST_MAIL_URL.');
    expect(checkTarget(hostedEnv({ SUPABASE_TEST_OUTBOX_SECRET: undefined, SUPABASE_TEST_MAIL_URL: 'https://mail.example.test' }), [REF]).ok).toBe(true);
    expect(error(hostedEnv(), [])).toBe(`Project ${REF} isn’t in supabase/hosted-test/projects.json. Only approved test projects can be used.`);
    expect(error(hostedEnv({ SUPABASE_TEST_PROJECT_REF: undefined }))).toBe('Set SUPABASE_TEST_PROJECT_REF to the hosted test project’s 20-letter ref.');
    expect(error(hostedEnv({ SUPABASE_TEST_URL: `https://${OTHER}.supabase.co` }))).toBe(`SUPABASE_TEST_URL must be exactly https://${REF}.supabase.co for project ${REF}.`);
    expect(error(hostedEnv({ SUPABASE_TEST_URL: 'http://127.0.0.1:54321' }))).toBe(`SUPABASE_TEST_URL must be exactly https://${REF}.supabase.co for project ${REF}.`);
    expect(error(hostedEnv({ SUPABASE_TEST_ALLOW_DESTRUCTIVE: undefined }))).toBe(`These tests create and delete accounts. Set SUPABASE_TEST_ALLOW_DESTRUCTIVE=${REF} to confirm ${REF} is a disposable test project.`);
    expect(error(hostedEnv({ SUPABASE_TEST_ALLOW_DESTRUCTIVE: 'yes' }))).toMatch(/^These tests create and delete accounts/);
    expect(error(hostedEnv({ SUPABASE_TEST_ANON_KEY: jwt({ role: 'service_role' }) }))).toBe('SUPABASE_TEST_ANON_KEY must be the public anon or publishable key, not a service_role key.');
    expect(error(hostedEnv({ SUPABASE_TEST_ANON_KEY: jwt({ role: 'anon', ref: OTHER }) }))).toBe(`SUPABASE_TEST_ANON_KEY belongs to project ${OTHER}, not ${REF}.`);
    expect(error({ SUPABASE_TEST_TARGET: 'production' })).toBe('SUPABASE_TEST_TARGET must be "local" or "hosted"; got "production".');
  });
});

describe('the hosted-test build at runtime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('refuses to start, and never renders the app, for a project that isn’t approved', async () => {
    vi.stubEnv('MODE', 'supabase-hosted-test');
    vi.stubEnv('VITE_SUPABASE_PROJECT_REF', REF);
    vi.stubEnv('VITE_SUPABASE_URL', `https://${REF}.supabase.co`);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_abc');
    vi.resetModules();
    const { SupabaseDevelopment } = await import('../dev');
    const app = vi.fn(() => <p>app</p>);
    render(<SupabaseDevelopment>{app}</SupabaseDevelopment>);
    expect(screen.getByRole('alert')).toHaveTextContent(`Development storage couldn’t start. Project ${REF} isn’t an approved test project (supabase/hosted-test/projects.json).`);
    expect(app).not.toHaveBeenCalled();
  });
});
