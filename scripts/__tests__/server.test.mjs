// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authOriginFromConfig, createAppServer } from '../../server.mjs';

let base;
let app;
let upstream;
const seen = [];

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), 'fos-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Financial OS</title>');
  writeFileSync(join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  writeFileSync(join(dist, 'manifest.webmanifest'), '{}');
  writeFileSync(join(dist, 'icon.svg'), '<svg/>');
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(tmpdir(), 'secret.txt'), 'outside dist');

  // Stands in for https://<project>.firebaseapp.com.
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, cookie: req.headers.cookie, body });
      res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
      res.writeHead(req.url.startsWith('/__/auth/redirect') ? 302 : 200, {
        'Content-Type': 'text/html',
        ...(req.url.startsWith('/__/auth/redirect') ? { Location: 'https://accounts.google.com/o/oauth2/auth' } : {}),
      });
      res.end(`handled ${req.url}`);
    });
  });
  const upstreamUrl = await listen(upstream);
  app = createAppServer({ distDir: dist, authOrigin: upstreamUrl });
  base = await listen(app);
});

afterAll(() => {
  app?.close();
  upstream?.close();
});

describe('server.mjs', () => {
  it('serves the app with no-cache on the files that must update, and security headers', async () => {
    for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest']) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
    const res = await fetch(base + '/');
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
  });

  it('caches hashed assets for a year and other files briefly', async () => {
    const asset = await fetch(base + '/assets/index-abc123.js');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    expect((await fetch(base + '/icon.svg')).headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('answers app pages with index.html and missing files with 404', async () => {
    const page = await fetch(base + '/settings');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Financial OS');
    expect((await fetch(base + '/missing.js')).status).toBe(404);
  });

  it('never serves files outside dist/', async () => {
    for (const path of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/%00']) {
      const res = await fetch(base + path);
      expect(await res.text()).not.toContain('outside dist');
    }
  });

  it('tells the app that sign-in is forwarded here', async () => {
    const res = await fetch(base + '/__/financial-os/config.json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ authProxy: true });
    expect((await fetch(base + '/__/anything-else')).status).toBe(404);
  });

  it('forwards Firebase sign-in pages, with query, cookies and separate Set-Cookie headers', async () => {
    const res = await fetch(base + '/__/auth/handler?apiKey=k&authType=signInViaPopup', { headers: { cookie: 'x=1' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('handled /__/auth/handler?apiKey=k&authType=signInViaPopup');
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    const last = seen.at(-1);
    expect(last.url).toBe('/__/auth/handler?apiKey=k&authType=signInViaPopup');
    expect(last.host).not.toContain(new URL(base).port);
    expect(last.cookie).toBe('x=1');
    expect(await (await fetch(base + '/__/firebase/init.json')).text()).toBe('handled /__/firebase/init.json');
  });

  it('passes redirects through instead of following them, and forwards POST bodies', async () => {
    const redirect = await fetch(base + '/__/auth/redirect', { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('https://accounts.google.com/o/oauth2/auth');
    await fetch(base + '/__/auth/handler', { method: 'POST', body: 'token=abc' });
    expect(seen.at(-1)).toMatchObject({ method: 'POST', body: 'token=abc' });
  });

  it('refuses other methods on app files', async () => {
    expect((await fetch(base + '/', { method: 'POST' })).status).toBe(405);
  });

  it('builds the sign-in origin from the Firebase settings', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fos-cfg-')), 'config.json');
    writeFileSync(file, JSON.stringify({ projectId: 'financial-os-505002' }));
    expect(authOriginFromConfig(file)).toBe('https://financial-os-505002.firebaseapp.com');
  });
});
