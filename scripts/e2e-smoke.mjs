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

  step('onboarding: income (add in a sheet)');
  await page.getByRole('button', { name: 'Add income' }).click();
  let sheet = page.getByRole('dialog', { name: 'Add income' });
  await sheet.getByLabel('What is this income?').fill('Paycheck');
  await sheet.getByLabel('Amount you expect to receive').fill('1700');
  await sheet.getByLabel('Next payment date').fill('2026-10-16');
  await sheet.getByLabel('How often?').selectOption('biweekly');
  await shot('02-income-form');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Every 2 weeks · next Oct 16, 2026').waitFor();

  step('onboarding: fix a mistake by tapping the item');
  await page.getByRole('button', { name: /^Paycheck/ }).click();
  sheet = page.getByRole('dialog', { name: 'Edit Paycheck' });
  assert.equal(await sheet.getByText('Changes start with the payment on').count(), 0);
  await sheet.getByLabel('Amount you expect to receive').fill('1800');
  await sheet.getByLabel('Next payment date').fill('2026-10-15');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Every 2 weeks · next Oct 15, 2026').waitFor();
  assert.match(await page.locator('.entry-list').innerText(), /\+\$1,800\.00/);
  // Left to spend covers the first pay period, Oct 15 – 28.
  assert.match(await page.locator('.left-to-spend').innerText(), /Left to spend[\s\S]*Oct 15 – 28[\s\S]*\$1,800\.00/);
  await page.getByRole('button', { name: 'Continue' }).click();

  step('onboarding: expenses (bills, subscriptions, liabilities, savings, one-time)');
  await page.getByRole('button', { name: 'Add a bill' }).click();
  sheet = page.getByRole('dialog', { name: 'Add a bill' });
  await sheet.getByLabel('What is this bill?').fill('Phone');
  await sheet.getByLabel('Amount you expect to pay').fill('60');
  await sheet.getByLabel('Next due date').fill('2026-10-25');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add a bill' }).click();
  sheet = page.getByRole('dialog', { name: 'Add a bill' });
  await sheet.getByLabel('What is this bill?').fill('Rent');
  await sheet.getByLabel('Amount you expect to pay').fill('1,200');
  await sheet.getByLabel('Next due date').fill('2026-11-01');
  // Tags are optional and typed by the user.
  await sheet.getByLabel('Tags (optional)').fill('Housing');
  await sheet.getByRole('button', { name: 'Add tag' }).click();
  await sheet.getByRole('button', { name: 'Remove tag Housing' }).waitFor();
  await shot('02b-bill-with-tag');
  await sheet.getByRole('button', { name: 'Save' }).click();
  // Rent is due Nov 1, after the first pay period, so left to spend is unchanged.
  assert.match(await page.locator('.left-to-spend').innerText(), /\$1,740\.00/);
  await page.getByRole('button', { name: 'Add a payment' }).click();
  sheet = page.getByRole('dialog', { name: 'Add a payment' });
  await sheet.getByLabel('What is this payment for?').fill('Car loan');
  await sheet.getByLabel('Payment amount').fill('350');
  await sheet.getByLabel('Next payment due date').fill('2026-10-20');
  // The liability type is required.
  await sheet.getByRole('button', { name: 'Save' }).click();
  await sheet.getByText('Choose card, loan, or line of credit.').waitFor();
  await sheet.getByRole('radio', { name: 'Loan' }).check();
  assert.equal(await sheet.getByText('Choose card, loan, or line of credit.').count(), 0);
  await shot('02d-liability-type');
  await sheet.getByLabel('Next payment due date').fill('2026-10-20');
  await sheet.getByRole('button', { name: 'Save' }).click();
  assert.match(await page.locator('.left-to-spend').innerText(), /\$1,390\.00/);
  await page.getByText('Loan · Monthly on the 20th').waitFor();

  step('onboarding: one-time expenses count in their period');
  await page.getByRole('button', { name: 'Add one-time expense' }).click();
  sheet = page.getByRole('dialog', { name: 'Add one-time expense' });
  await sheet.getByLabel('Description').fill('Car repair');
  await sheet.getByLabel('Expected amount').fill('100');
  await sheet.getByLabel('Expected date').fill('2026-10-26');
  await sheet.getByRole('button', { name: /Add one-time/ }).click();
  assert.match(await page.locator('.left-to-spend').innerText(), /\$1,290\.00/);
  await page.getByText('One time · Oct 26, 2026').waitFor();
  await shot('02c-expenses-step');
  await page.getByRole('button', { name: /^Car repair/ }).click();
  await page.getByRole('dialog', { name: 'Car repair' }).getByRole('button', { name: 'Remove Car repair' }).click();
  assert.match(await page.locator('.left-to-spend').innerText(), /\$1,390\.00/);
  await page.getByRole('button', { name: 'Continue' }).click();

  step('onboarding: review with first pay period breakdown');
  await page.getByText('Next expected payday', { exact: true }).waitFor();
  const hero = await page.locator('.review-hero').innerText();
  assert.match(hero, /Oct 15[\s\S]*in 4 days/);
  assert.match(hero, /Lowest point before Oct 28: \$1,390\.00/);
  // No timing gaps in this setup, so no warning appears.
  assert.equal(await page.locator('.gap-banner').count(), 0);
  const breakdown = await page.locator('section[aria-labelledby="breakdown-period"]').innerText();
  assert.match(breakdown, /Oct 15 – 28/);
  assert.match(breakdown, /Income\s+\+\$1,800\.00/);
  assert.match(breakdown, /Expenses\s+−\$410\.00/);
  assert.match(breakdown, /Bills\s+\$60\.00/);
  assert.match(breakdown, /Liability payments\s+\$350\.00/);
  assert.match(breakdown, /Savings\s+\$0\.00/);
  assert.match(breakdown, /Left to spend\s+\$1,390\.00/);
  const mainText = await page.locator('main').innerText();
  assert.match(mainText, /INCOME[\s\S]*Paycheck[\s\S]*EXPENSES[\s\S]*Phone[\s\S]*Rent[\s\S]*Car loan/i);
  assert.doesNotMatch(mainText, /SPENDING/);
  await shot('03-review');
  await page.getByRole('button', { name: 'See my forecast' }).click();

  step('dashboard: month KPIs');
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
  const kpiText = await page.locator('.kpis').innerText();
  assert.match(kpiText, /Projected income\s+\$3,600\.00/);
  assert.match(kpiText, /Projected expenses[\s\S]*?\$410\.00/);
  assert.match(kpiText, /Left to spend[\s\S]*?\+\$3,190\.00/);
  await shot('04-dashboard-month');

  step('dashboard: week view KPIs follow the period');
  await page.getByRole('tab', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  assert.match(await page.locator('.kpis').innerText(), /Projected income\s+\$0\.00[\s\S]*Projected expenses[\s\S]*?\$350\.00/);

  step('dashboard: paycheck view keeps the running tally');
  await page.getByRole('tab', { name: 'Paycheck', exact: true }).click();
  await page.getByRole('button', { name: 'Next pay period' }).click();
  await page.getByRole('heading', { name: 'Oct 29 – Nov 11' }).waitFor();
  const firstRow = page.locator('.timeline > li').first();
  assert.match(await firstRow.innerText(), /Cash flow\s+\$3,190\.00/);
  await shot('05-dashboard-paycheck');

  step('dashboard: custom range validation');
  await page.getByRole('tab', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Start date').fill('2026-11-10');
  await page.getByLabel('End date').fill('2026-11-01');
  await page.getByText('The end date must be on or after the start date.').waitFor();
  await page.getByLabel('End date').fill('2026-11-20');
  // The range starts mid-forecast: the tally carries over from the anchor instead of restarting at $0.
  assert.match(await page.locator('.timeline > li').first().innerText(), /Tue, Nov 10[\s\S]*Cash flow\s+\$1,990\.00/);

  step('a day later: the paycheck is overdue');
  await page.clock.setFixedTime(new Date(2026, 9, 16, 9, 0));
  await page.reload();
  await page.getByRole('button', { name: '1 transaction needs an update' }).click();
  await shot('06-overdue');
  await page.getByRole('dialog').locator('.entry').first().click();
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
  assert.equal(await page.locator('.overdue-banner').count(), 0);

  step('timeline reflects the actual date and amount');
  await page.getByRole('tab', { name: 'Month', exact: true }).click();
  await page.getByRole('tab', { name: 'Day by day' }).click();
  const tl = await page.locator('.timeline').innerText();
  assert.match(tl, /Fri, Oct 16[\s\S]*?\+\$1,650\.00[\s\S]*?\$1,650\.00/);
  assert.match(tl, /Thu, Oct 29[\s\S]*?\+\$1,800\.00[\s\S]*?\$3,040\.00/);
  assert.doesNotMatch(tl, /Thu, Oct 15/);
  await page.getByRole('button', { name: /^Friday, October 16, 2026/ }).click();
  const day = await page.getByRole('dialog', { name: 'Friday, October 16, 2026' }).innerText();
  assert.match(day, /Received/);
  assert.match(day, /Expected \$1,800\.00 on Oct 15/);
  assert.match(day, /Projected cash flow\s+\$1,650\.00/);
  await shot('08-after-actual');
  await page.keyboard.press('Escape');

  step('week rows open a sheet with that week');
  await page.getByRole('tab', { name: 'Week by week' }).click();
  await page.getByRole('button', { name: /Oct 25 – 31/ }).click();
  const week = await page.getByRole('dialog', { name: /Week of Oct 25 – 31/ }).innerText();
  assert.match(week, /Projected income\s+\+\$1,800\.00/);
  assert.match(week, /Thu, Oct 29[\s\S]*Paycheck/);
  await page.keyboard.press('Escape');

  step('income screen shows recorded history and keeps the schedule');
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Income' }).click();
  await page.getByRole('button', { name: 'See dates' }).click();
  const dates = await page.locator('.source-occurrences').innerText();
  assert.match(dates, /Oct 16, 2026[\s\S]*Expected \$1,800\.00 on Oct 15, 2026[\s\S]*Received/);
  assert.match(dates, /Oct 29, 2026[\s\S]*\+\$1,800\.00[\s\S]*Expected/);
  await shot('09-income');

  step('navigation: Dashboard, Income, Expenses, Liabilities');
  const nav = page.getByRole('navigation', { name: 'Main' }).last();
  assert.deepEqual(await nav.getByRole('link').allInnerTexts(), ['Dashboard', 'Income', 'Expenses', 'Liabilities']);
  await nav.getByRole('link', { name: 'Liabilities' }).click();
  await page.getByRole('heading', { name: 'Liabilities', level: 1 }).waitFor();
  assert.match(await page.locator('.source-card').innerText(), /Car loan[\s\S]*Loan · Monthly on the 20th/);
  await nav.getByRole('link', { name: 'Expenses' }).click();
  await page.getByRole('tab', { name: 'Bills', selected: true }).waitFor();
  assert.deepEqual(await page.getByRole('tablist', { name: 'Expense type' }).getByRole('tab').allInnerTexts(), ['Bills', 'Subscriptions', 'Savings']);
  assert.match(await page.locator('.card-list').innerText(), /Rent[\s\S]*Housing/);
  await page.goto(`${BASE}#/income`);

  step('data persists across reloads');
  await page.reload();
  await page.getByRole('heading', { name: 'Recurring income' }).waitFor();
  assert.match(await page.locator('.source-card').innerText(), /Next: Oct 29, 2026/);

  step('desktop layout');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}#/dashboard`);
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
  await shot('10-desktop');

  step('backup: download, wipe the device, restore');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  assert.equal(download.suggestedFilename(), 'financial-os-backup-2026-10-16.json');
  const backupPath = `${SHOTS}backup.json`;
  await download.saveAs(backupPath);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'See your cash flow ahead of time' }).waitFor();
  await page.locator('input[aria-label="Backup file"]').setInputFiles(backupPath);
  const restoreSheet = page.getByRole('dialog', { name: 'Restore this backup?' });
  assert.match(await restoreSheet.innerText(), /This backup has 4 items, saved Oct 16, 2026/);
  await restoreSheet.getByRole('button', { name: 'Replace with backup' }).click();
  await page.getByText('Backup restored.').waitFor();
  await page.getByRole('heading', { name: /Your cash flow/ }).waitFor();
  await page.goto(`${BASE}#/income`);
  assert.match(await page.locator('.source-card').innerText(), /Paycheck[\s\S]*Next: Oct 29, 2026/);
  await page.goto(`${BASE}#/dashboard`);

  // The clock still reads Oct 16 here, so sample dates are relative to Oct 16.
  step('sample data: separate from real data, shows the three checkpoint behaviors');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Show sample data' }).click();
  await page.getByText('You’re exploring sample data.').waitFor();
  // Unpaid bill: stays visible as overdue.
  await page.getByRole('button', { name: '1 transaction needs an update' }).click();
  assert.match(await page.getByRole('dialog').innerText(), /Phone/);
  await page.keyboard.press('Escape');
  // Negative tally before a later payday (look ahead with a custom range).
  await page.getByRole('tab', { name: 'Custom', exact: true }).click();
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
