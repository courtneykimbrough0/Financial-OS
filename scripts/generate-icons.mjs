// Renders public/icon.svg to the PNG sizes the web app manifest needs.
// Usage: node scripts/generate-icons.mjs  (requires Playwright + Chromium)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await playwright.chromium.launch();
const page = await browser.newPage();
for (const [size, name, inset] of [
  [192, 'icon-192.png', 0],
  [512, 'icon-512.png', 0],
  [180, 'apple-touch-icon.png', 0],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:#1c1c1e"><div style="padding:${inset}px;width:${size}px;height:${size}px;box-sizing:border-box">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: false });
  console.log('wrote', name);
}
await browser.close();
