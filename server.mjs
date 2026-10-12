// Production server for Cloud Run (or any Node host). No dependencies.
//
//   npm run build && npm start        (listens on $PORT, default 8080)
//
// - Serves the built app from dist/ (or $DIST_DIR).
// - Tells browsers to always re-check index.html, the service worker and the
//   manifest, so new versions show up; hashed files under /assets are cached
//   for a year.
// - Forwards Firebase's sign-in pages (/__/auth/*, /__/firebase/*) to
//   https://<project>.firebaseapp.com, so Google sign-in runs on the app's own
//   address. Safari and installed iPhone apps block sign-in that runs on a
//   different address.
// - Answers /__/financial-os/config.json so the app knows sign-in is
//   forwarded here and uses this address for it.
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Always re-checked, so a new deploy is picked up on the next visit. */
const NO_CACHE = new Set(['/index.html', '/sw.js', '/registerSW.js', '/manifest.webmanifest']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Google sign-in opens a pop-up that must be able to report back.
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

/** Request headers that describe the connection to this server, not the request itself. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer', 'host', 'content-length']);

export function authOriginFromConfig(configPath) {
  const { projectId } = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!projectId) throw new Error(`No projectId in ${configPath}`);
  return `https://${projectId}.firebaseapp.com`;
}

/**
 * @param {{ distDir: string, authOrigin: string }} options
 */
export function createAppServer({ distDir, authOrigin }) {
  const root = resolve(distDir);

  async function proxy(req, res, pathAndQuery) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) headers[k] = v;
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let upstream;
    try {
      upstream = await fetch(authOrigin + pathAndQuery, {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
      });
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Sign-in is temporarily unavailable.');
      return;
    }
    const out = {};
    upstream.headers.forEach((value, key) => {
      // fetch already decoded the body, so its original encoding and length no longer apply.
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(key)) out[key] = value;
    });
    // Several cookies must stay separate headers, not one comma-joined value.
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(upstream.status, out);
    if (req.method === 'HEAD' || !upstream.body) res.end();
    else Readable.fromWeb(upstream.body).pipe(res);
  }

  async function sendFile(req, res, file, urlPath) {
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const cache = NO_CACHE.has(urlPath) || urlPath === '/'
      ? 'no-cache'
      : urlPath.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    const info = await stat(file);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': cache, ...SECURITY_HEADERS });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  }

  /** The file under dist/ for a URL path, or null if it doesn't exist or would leave dist/. */
  async function findFile(urlPath) {
    let decoded;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) return null;
    const file = normalize(join(root, decoded));
    if (file !== root && !file.startsWith(root + sep)) return null;
    try {
      const info = await stat(file);
      return info.isFile() ? file : null;
    } catch {
      return null;
    }
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (path.startsWith('/__/auth/') || path.startsWith('/__/firebase/')) {
        await proxy(req, res, path + url.search);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
        res.end();
        return;
      }
      if (path === '/__/financial-os/config.json') {
        const body = JSON.stringify({ authProxy: true });
        res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      if (path.startsWith('/__/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        res.end('Not found');
        return;
      }

      const file = await findFile(path === '/' ? '/index.html' : path);
      if (file) {
        await sendFile(req, res, file, path === '/' ? '/index.html' : path);
        return;
      }
      // A missing file with an extension is a real 404; anything else is a page in the app.
      if (extname(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        res.end('Not found');
        return;
      }
      await sendFile(req, res, join(root, 'index.html'), '/index.html');
    } catch (err) {
      console.error('Request failed:', err instanceof Error ? err.message : String(err));
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Something went wrong.');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const distDir = process.env.DIST_DIR ?? join(here, 'dist');
  const authOrigin = process.env.FIREBASE_AUTH_ORIGIN ?? authOriginFromConfig(join(here, 'firebase-applet-config.json'));
  const port = Number(process.env.PORT ?? 8080);
  createAppServer({ distDir, authOrigin }).listen(port, () => {
    console.log(`Financial OS listening on port ${port}`);
  });
}
