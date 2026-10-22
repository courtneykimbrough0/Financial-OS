import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionConfigProblem } from '../target';

// F2: the production Supabase build and how Vercel serves it.
const REF = 'abcdefghijklmnopqrst';
const jwt = (claims: object) => `x.${btoa(JSON.stringify(claims))}.y`;

describe('the production configuration', () => {
  it('accepts the project’s https address with its publishable or anon key', () => {
    expect(productionConfigProblem(`https://${REF}.supabase.co`, 'sb_publishable_abc')).toBeNull();
    expect(productionConfigProblem(`https://${REF}.supabase.co`, jwt({ role: 'anon', ref: REF }))).toBeNull();
    // A custom domain for the project is fine too.
    expect(productionConfigProblem('https://api.example.com', 'sb_publishable_abc')).toBeNull();
  });

  it('refuses a missing, local or unencrypted address, and any privileged or mismatched key', () => {
    expect(productionConfigProblem(undefined, 'sb_publishable_abc')).toMatch(/VITE_SUPABASE_URL/);
    expect(productionConfigProblem('http://127.0.0.1:54321', 'sb_publishable_abc')).toMatch(/https address/);
    expect(productionConfigProblem(`http://${REF}.supabase.co`, 'sb_publishable_abc')).toMatch(/https address/);
    expect(productionConfigProblem('https://localhost', 'sb_publishable_abc')).toMatch(/https address/);
    expect(productionConfigProblem(`https://${REF}.supabase.co`, undefined)).toMatch(/VITE_SUPABASE_ANON_KEY/);
    expect(productionConfigProblem(`https://${REF}.supabase.co`, 'sb_secret_abc')).toMatch(/secret key/);
    expect(productionConfigProblem(`https://${REF}.supabase.co`, jwt({ role: 'service_role', ref: REF }))).toMatch(/service_role key/);
    expect(productionConfigProblem(`https://${REF}.supabase.co`, jwt({ role: 'anon', ref: 'zyxwvutsrqponmlkjihg' }))).toMatch(/belongs to project/);
  });
});

describe('vercel.json', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    buildCommand: string;
    outputDirectory: string;
    rewrites: { source: string; destination: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  const header = (source: string, key: string) => config.headers.find((h) => h.source === source)?.headers.find((h) => h.key === key)?.value;
  const csp = header('/(.*)', 'Content-Security-Policy') ?? '';
  const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

  it('builds the production Supabase build, never the legacy Firebase one', () => {
    expect(config.buildCommand).toBe('npm run build:supabase');
    expect(pkg.scripts['build:supabase']).toContain('--mode supabase-production');
    expect(pkg.scripts['build:supabase']).toContain(`--outDir ${config.outputDirectory}`);
  });

  it('sends app routes to index.html, but never a missing asset', () => {
    expect(config.rewrites).toEqual([{ source: '/((?!assets/).*)', destination: '/index.html' }]);
  });

  it('a strict content security policy: own scripts and styles only, Supabase for data, no framing', () => {
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*;|\* /);
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('style-src')).toBe("style-src 'self'");
    expect(directive('connect-src')).toBe("connect-src 'self' https://*.supabase.co");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
  });

  it('every security header the Cloud Run server sends, and more', () => {
    expect(header('/(.*)', 'X-Content-Type-Options')).toBe('nosniff');
    expect(header('/(.*)', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('/(.*)', 'X-Frame-Options')).toBe('DENY');
    expect(header('/(.*)', 'Strict-Transport-Security')).toMatch(/^max-age=\d{8,}/);
    expect(header('/(.*)', 'Permissions-Policy')).toContain('camera=()');
  });

  it('the same caching as the Cloud Run server: the app shell always re-checked, hashed assets kept a year', () => {
    const server = readFileSync('server.mjs', 'utf8');
    const noCache = JSON.parse(/const NO_CACHE = new Set\((\[[^\]]*\])\)/.exec(server)![1]!.replace(/'/g, '"')) as string[];
    for (const path of ['/', ...noCache]) expect([path, header(path, 'Cache-Control')]).toEqual([path, 'no-cache']);
    expect(header('/assets/(.*)', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
  });
});

describe('the production build at runtime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    localStorage.clear();
  });
  const start = async (url: string, key: string) => {
    vi.stubEnv('MODE', 'supabase-production');
    vi.stubEnv('VITE_SUPABASE_URL', url);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
    vi.resetModules();
    const { SupabaseStorage } = await import('../dev');
    const app = vi.fn(() => <p>app</p>);
    render(<SupabaseStorage>{app}</SupabaseStorage>);
    return app;
  };

  it('refuses to start with a privileged key, and never renders the app', async () => {
    const app = await start(`https://${REF}.supabase.co`, 'sb_secret_abc');
    expect(screen.getByRole('alert')).toHaveTextContent("Financial OS isn't configured correctly. VITE_SUPABASE_ANON_KEY is a secret key. Use the anon or publishable key.");
    expect(app).not.toHaveBeenCalled();
  });

  it('with a valid configuration: the sign-in screen, no development banner, and its own session key', async () => {
    const { AUTH_KEY, DEV_AUTH_KEY } = await import('../dev');
    expect(AUTH_KEY).not.toBe(DEV_AUTH_KEY);
    const app = await start(`https://${REF}.supabase.co`, 'sb_publishable_abc');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/Development storage/)).toBeNull();
    expect(app).not.toHaveBeenCalled();
  });
});
