// End-to-end smoke test against the production build in Chromium.
// Usage: npm run build && npm run e2e
// Walks through onboarding, then records a late, smaller paycheck and checks
// the dashboard recalculates without changing the next scheduled paycheck.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = new URL('../e2e-screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const viteBin = new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname;
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await playwright.chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });
const step = (msg) => console.log(`• ${msg}`);

try {
  await page.clock.setFixedTime(new Date(2026, 9, 11, 9, 0));
  await page.goto(BASE);

  step('onboarding: welcome');
  await page.getByRole('heading', { name: 'See your cash flow ahead of time' }).waitFor();
  await shot('01-welcome');
  await page.getByRole('button', { name: 'Get started' }).click();

  step('onboarding: income');
  await page.getByLabel('What is this income?').fill('Paycheck');
  await page.getByLabel('Amount you expect to receive').fill('1800');
  await page.getByLabel('Next payment date').fill('2026-10-15');
  await page.getByLabel('How often?').selectOption('biweekly');
  await shot('02-income-form');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Every 2 weeks · next Oct 15, 2026').waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();

  step('onboarding: expenses');
  await page.getByLabel('What is this expense?').fill('Phone');
  await page.getByLabel('Amount you expect to pay').fill('60');
  await page.getByLabel('Next due date').fill('2026-10-25');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: '+ Add another expense' }).click();
  await page.getByLabel('What is this expense?').fill('Rent');
  await page.getByLabel('Amount you expect to pay').fill('1,200');
  await page.getByLabel('Next due date').fill('2026-11-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  step('onboarding: liabilities');
  await page.getByLabel('What is this payment for?').fill('Car loan');
  await page.getByLabel('Payment amount').fill('350');
  await page.getByLabel('Next payment due date').fill('2026-10-20');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  step('onboarding: review');
  await page.getByText('Your next expected payday is').waitFor();
  assert.match(await page.locator('.callout-info').first().innerText(), /Oct 15, 2026[\s\S]*Oct 14, 2026/);
  await shot('03-review');
  await page.getByRole('button', { name: 'See my forecast' }).click();

  step('dashboard: month KPIs');
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
  const kpiText = await page.locator('.kpis').innerText();
  assert.match(kpiText, /Projected income\s+\$3,600\.00/);
  assert.match(kpiText, /Projected expenses\s+\$410\.00/);
  assert.match(kpiText, /Projected cash flow\s+\+\$3,190\.00/);
  await shot('04-dashboard-month');

  step('dashboard: week view KPIs follow the period');
  await page.getByRole('tab', { name: 'Week' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  assert.match(await page.locator('.kpis').innerText(), /Projected income\s+\$0\.00[\s\S]*Projected expenses\s+\$350\.00/);

  step('dashboard: paycheck view keeps the running tally');
  await page.getByRole('tab', { name: 'Paycheck' }).click();
  await page.getByRole('button', { name: 'Next pay period' }).click();
  await page.getByRole('heading', { name: 'Oct 29 – Nov 11' }).waitFor();
  const firstRow = page.locator('.timeline > li').first();
  assert.match(await firstRow.innerText(), /Cash flow\s+\$3,190\.00/);
  await shot('05-dashboard-paycheck');

  step('dashboard: custom range validation');
  await page.getByRole('tab', { name: 'Custom' }).click();
  await page.getByLabel('Start date').fill('2026-11-10');
  await page.getByLabel('End date').fill('2026-11-01');
  await page.getByText('The end date must be on or after the start date.').waitFor();
  await page.getByLabel('End date').fill('2026-11-20');
  // The range starts mid-forecast: the tally carries over from the anchor instead of restarting at $0.
  assert.match(await page.locator('.timeline > li').first().innerText(), /Tue, Nov 10[\s\S]*Cash flow\s+\$1,990\.00/);

  step('a day later: the paycheck is overdue');
  await page.clock.setFixedTime(new Date(2026, 9, 16, 9, 0));
  await page.reload();
  await page.getByRole('heading', { name: '1 transaction needs an update' }).waitFor();
  await shot('06-overdue');
  await page.locator('.panel-warn .entry').first().click();
  const dialog = page.getByRole('dialog', { name: 'Paycheck' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Mark received', exact: true }).click();
  const amount = dialog.getByLabel('Amount received');
  assert.equal(await amount.inputValue(), '1800.00');
  assert.equal(await dialog.getByLabel('Date received').inputValue(), '2026-10-15');
  await amount.fill('1650');
  await dialog.getByLabel('Date received').fill('2026-10-16');
  await shot('07-record-actual');
  await dialog.getByRole('button', { name: 'Save as received' }).click();
  await page.getByText('Recorded Paycheck: $1,650.00 received on Oct 16, 2026.').waitFor();
  assert.equal(await page.getByRole('heading', { name: /needs an update/ }).count(), 0);

  step('timeline reflects the actual date and amount');
  await page.getByRole('tab', { name: 'Month' }).click();
  const tl = await page.locator('.timeline').innerText();
  assert.match(tl, /Fri, Oct 16[\s\S]*?\+\$1,650\.00[\s\S]*?\$1,650\.00/);
  assert.match(tl, /Thu, Oct 29[\s\S]*?\+\$1,800\.00[\s\S]*?\$3,040\.00/);
  assert.doesNotMatch(tl, /Thu, Oct 15/);
  await page.getByRole('button', { name: /^Friday, October 16, 2026/ }).click();
  const day = await page.locator('#day-heading').locator('..').locator('..').innerText();
  assert.match(day, /Received/);
  assert.match(day, /Expected \$1,800\.00 on Oct 15/);
  await shot('08-after-actual');

  step('income screen shows recorded history and keeps the schedule');
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Income' }).click();
  await page.getByRole('button', { name: 'See dates' }).click();
  const dates = await page.locator('.source-occurrences').innerText();
  assert.match(dates, /Oct 16, 2026[\s\S]*Expected \$1,800\.00 on Oct 15, 2026[\s\S]*Received/);
  assert.match(dates, /Oct 29, 2026[\s\S]*\+\$1,800\.00[\s\S]*Expected/);
  await shot('09-income');

  step('data persists across reloads');
  await page.reload();
  await page.getByRole('heading', { name: 'Recurring income' }).waitFor();
  assert.match(await page.locator('.source-card').innerText(), /Next: Oct 29, 2026/);

  step('desktop layout');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}#/dashboard`);
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
  await shot('10-desktop');

  // The clock still reads Oct 16 here, so sample dates are relative to Oct 16.
  step('sample data: separate from real data, shows the three checkpoint behaviors');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Show sample data' }).click();
  await page.getByText('You’re exploring sample data.').waitFor();
  // Unpaid bill: stays visible as overdue.
  await page.getByRole('heading', { name: '1 transaction needs an update' }).waitFor();
  assert.match(await page.locator('.panel-warn').innerText(), /Phone/);
  // Negative tally before a later payday (look ahead with a custom range).
  await page.getByRole('tab', { name: 'Custom' }).click();
  await page.getByLabel('End date').fill('2026-11-30');
  await page.getByText('Timing gap ahead').waitFor();
  assert.match(await page.locator('.callout-danger').innerText(), /Nov 5 – 9, by up to \$600\.00/);
  await shot('11-sample-data');
  // Late paycheck: actual recorded, next one still scheduled.
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Income' }).click();
  await page.getByRole('button', { name: 'See dates' }).click();
  const sampleDates = await page.locator('.source-occurrences').innerText();
  assert.match(sampleDates, /Oct 14, 2026[\s\S]*Expected \$1,800\.00 on Oct 13, 2026[\s\S]*Received/);
  assert.match(sampleDates, /Oct 27, 2026[\s\S]*Expected/);
  await page.getByRole('button', { name: 'Leave sample data' }).click();
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
  assert.equal(await page.getByText('You’re exploring sample data.').count(), 0);
  await page.goto(`${BASE}#/income`);
  assert.match(await page.locator('.source-card').innerText(), /Paycheck[\s\S]*Next: Oct 29, 2026/);

  assert.deepEqual(errors, [], `Console errors: ${errors.join('\n')}`);
  console.log('\nE2E smoke test passed.');
} catch (err) {
  await shot('failure').catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  process.exit(process.exitCode ?? 0);
}
