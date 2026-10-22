// Browser check of the production Supabase build (F2) as Vercel would serve it.
// Usage: npm run e2e:production
// Serves the build with the rewrites and headers in vercel.json (no Vercel
// account needed), opens it in Chromium, and checks: the sign-in screen
// appears; the content security policy blocks nothing the app needs; no
// request leaves the app's own address (the Supabase address is a
// placeholder, and nothing is sent to it before sign-in); the service worker
// installs; app routes fall back to index.html but a missing asset is a 404;
// and the caching and security headers are the ones vercel.json sets.
// The screens behind sign-in are the same components in every build, so the
// device build (second argument) is served with the same headers and its
// screens are opened with sample data, to check the policy blocks none of them.
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const dir = (name) => new URL(`../${name}/`, import.meta.url).pathname;
const DIST = dir(process.argv[2] ?? 'dist-e2e-production');
const DEVICE = process.argv[3] ? dir(process.argv[3]) : null;
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

/** A Vercel `source` as a regular expression: literal text, with (...) groups as regex. */
export function sourcePattern(source) {
  let out = '';
  let depth = 0;
  for (const ch of source) {
    if (ch === '(') depth++;
    out += depth === 0 && /[.*+?^${}|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    if (ch === ')') depth--;
  }
  return new RegExp(`^${out}$`);
}

function headersFor(path) {
  const headers = {};
  for (const rule of config.headers) if (sourcePattern(rule.source).test(path)) for (const h of rule.headers) headers[h.key] = h.value;
  return headers;
}

const serve = (root) => createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(root, normalize(path === '/' ? '/index.html' : path));
  const exists = (() => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  })();
  // Vercel serves files first, then rewrites.
  if (!exists) {
    const rewrite = config.rewrites.find((r) => sourcePattern(r.source).test(path));
    if (!rewrite) {
      res.writeHead(404, headersFor(path));
      return res.end('Not found');
    }
    file = join(root, rewrite.destination);
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...headersFor(path) });
  createReadStream(file).pipe(res);
});
async function listen(root) {
  const server = serve(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const { server, base: BASE } = await listen(DIST);

/** A page that records console errors (CSP violations among them) and requests leaving `base`. */
async function watchedPage(context, base) {
  const page = await context.newPage();
  const problems = [];
  const foreign = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`page: ${e.message}`));
  page.on('request', (r) => !r.url().startsWith(base) && !r.url().startsWith('data:') && foreign.push(r.url()));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.violatedDirective}: ${e.blockedURI}`));
  });
  return { page, problems, foreign };
}

const browser = await playwright.chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, problems, foreign } = await watchedPage(context, BASE);

  const response = await page.goto(`${BASE}/`);
  const headers = response.headers();
  assert.match(headers['content-security-policy'], /script-src 'self';/);
  assert.equal(headers['cache-control'], 'no-cache');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');

  // The sign-in screen, in the production build: no development banner.
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
  assert.equal(await page.locator('.dev-storage-note').count(), 0, 'no development banner in production');
  assert.equal(await page.getByText("isn't configured correctly").count(), 0, 'the placeholder configuration is accepted');

  // The service worker installs and the page is controlled after a reload.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const manifest = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href'));
  assert.ok(manifest, 'the PWA manifest is linked');
  const manifestResponse = await page.request.get(`${BASE}/${manifest.replace(/^\//, '')}`);
  assert.equal(manifestResponse.status(), 200);
  assert.equal(manifestResponse.headers()['cache-control'], 'no-cache');

  // App routes fall back to the app; a missing hashed asset is a 404, never the app's page.
  const deep = await page.request.get(`${BASE}/plan/income`);
  assert.equal(deep.status(), 200);
  assert.match(await deep.text(), /<div id="root">/);
  const missing = await page.request.get(`${BASE}/assets/missing-0000.js`);
  assert.equal(missing.status(), 404);
  const asset = (await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/')))) ?? '';
  assert.equal((await page.request.get(asset)).headers()['cache-control'], 'public, max-age=31536000, immutable');

  assert.deepEqual(problems, [], 'no console errors or blocked resources');
  assert.deepEqual(foreign, [], 'no request leaves the app before sign-in');

  if (DEVICE) {
    const device = await listen(DEVICE);
    try {
      const deviceContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const w = await watchedPage(deviceContext, device.base);
      await w.page.goto(`${device.base}/`);
      await w.page.getByRole('button', { name: 'Explore with sample data' }).click();
      await w.page.getByRole('heading', { level: 1, name: /^Home/ }).waitFor();
      for (const hash of ['#/forecast', '#/plan/expenses', '#/plan/liabilities', '#/plan/reserves', '#/activity', '#/settings', '#/plan/income']) {
        await w.page.goto(`${device.base}/${hash}`);
        await w.page.getByRole('heading', { level: 1 }).first().waitFor();
      }
      // A sheet over the income list.
      await w.page.locator('.entry').first().click();
      await w.page.getByRole('dialog').waitFor();
      assert.deepEqual(w.problems, [], 'every screen renders under the content security policy');
      assert.deepEqual(w.foreign, [], 'no screen contacts another address');
    } finally {
      device.server.close();
    }
  }
  console.log(`Production build check passed${DEVICE ? ', with every screen under the same headers' : ''}.`);
} finally {
  await browser.close();
  server.close();
}
