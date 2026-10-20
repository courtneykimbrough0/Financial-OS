// End-to-end smoke test against the production build in Chromium.
// Usage: npm run build && npm run e2e
// Walks through onboarding, then records a late, smaller paycheck and checks
// the dashboard recalculates without changing the next scheduled paycheck.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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

// Runs the production server (server.mjs), the same one Cloud Run uses.
const serverScript = new URL('../server.mjs', import.meta.url).pathname;
const server = spawn(process.execPath, [serverScript], {
  stdio: 'pipe',
  env: { ...process.env, PORT: String(PORT), DIST_DIR: process.argv[2] ?? 'dist' },
});
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
  // Cash flow covers the first pay period, Oct 15 – 28.
  assert.match(await page.locator('.left-to-spend').innerText(), /Cash flow[\s\S]*Oct 15 – 28[\s\S]*\+\$1,800\.00/);
  await page.getByRole('button', { name: 'Continue' }).click();

  step('onboarding: bills get their own step');
  await page.getByRole('heading', { name: 'What bills do you pay?' }).waitFor();
  await page.getByRole('button', { name: 'Add a bill' }).click();
  sheet = page.getByRole('dialog', { name: 'Add a bill' });
  await sheet.getByLabel('What is this bill?').fill('Phone');
  await sheet.getByLabel('Amount you expect to pay').fill('60');
  await sheet.getByLabel('Next due date').fill('2026-10-25');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add another bill' }).click();
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
  // Rent is due Nov 1, after the first pay period, so cash flow is unchanged.
  assert.match(await page.locator('.left-to-spend').innerText(), /\$1,740\.00/);

  step('onboarding: varied spending counts in its period');
  await page.getByRole('button', { name: 'Add spending' }).click();
  sheet = page.getByRole('dialog', { name: 'Add varied spending' });
  await sheet.getByLabel('Description').fill('Car repair');
  await sheet.getByLabel('Expected amount').fill('100');
  await sheet.getByLabel('Expected date').fill('2026-10-26');
  await sheet.getByRole('button', { name: 'Add spending' }).click();
  assert.match(await page.locator('.left-to-spend').innerText(), /\$1,640\.00/);
  await page.getByText('One time · Oct 26, 2026').waitFor();
  await shot('02c-bills-step');
  await page.getByRole('button', { name: /^Car repair/ }).click();
  await page.getByRole('dialog', { name: 'Car repair' }).getByRole('button', { name: 'Remove Car repair' }).click();
  assert.match(await page.locator('.left-to-spend').innerText(), /\$1,740\.00/);
  await page.getByRole('button', { name: 'Continue' }).click();

  step('onboarding: subscriptions, then liabilities, each on their own step');
  await page.getByRole('heading', { name: 'What subscriptions renew?' }).waitFor();
  assert.equal(await page.getByText('Phone').count(), 0);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'What do you pay toward debts?' }).waitFor();
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
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'What do you set aside?' }).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();

  step('onboarding: review with first pay period breakdown');
  await page.getByText('Next expected payday', { exact: true }).waitFor();
  const hero = await page.locator('.review-hero').innerText();
  assert.match(hero, /Oct 15[\s\S]*in 4 days/);
  assert.match(hero, /Lowest running total before Oct 28: \$1,390\.00/);
  // No timing gaps in this setup, so no warning appears.
  assert.equal(await page.locator('.gap-banner').count(), 0);
  const breakdown = await page.locator('section[aria-labelledby="breakdown-period"]').innerText();
  assert.match(breakdown, /Oct 15 – 28/);
  assert.match(breakdown, /Income\s+\+\$1,800\.00/);
  assert.match(breakdown, /Spending\s+−\$410\.00/);
  assert.match(breakdown, /Bills\s+\$60\.00/);
  assert.match(breakdown, /Liability payments\s+\$350\.00/);
  // Classifications with nothing in the period are left out.
  assert.doesNotMatch(breakdown, /reserves|Subscriptions/);
  assert.match(breakdown, /Cash flow\s+\+\$1,390\.00/);
  const mainText = await page.locator('main').innerText();
  assert.match(mainText, /INCOME[\s\S]*Paycheck[\s\S]*BILLS[\s\S]*Phone[\s\S]*Rent[\s\S]*LIABILITY PAYMENTS[\s\S]*Car loan/i);
  await shot('03-review');
  await page.getByRole('button', { name: 'See my forecast' }).click();

  step('home: the opening screen is Home, with this week at a glance');
  await page.getByRole('heading', { name: /^Home/ }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Needs attention' }).count(), 0);
  assert.match(await page.locator('.home').innerText(), /Oct 11 – 17[\s\S]*Coming up[\s\S]*Thu, Oct 15[\s\S]*Paycheck/i);
  assert.equal(await page.getByRole('button', { name: /Undo/ }).count(), 0);
  await shot('04a-home');
  await page.getByRole('button', { name: 'Full forecast and calendar' }).click();

  step('forecast: cash flow leads, with a breakdown by category');
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
  const heroText = await page.locator('.hero').innerText();
  assert.match(heroText, /^Cash flow\s+\+\$3,190\.00\s+\+\$3,600\.00 in · −\$410\.00 out/);
  assert.match(heroText, /Lowest running total\s+\$1,390\.00/);
  const monthBreakdown = await page.locator('section[aria-labelledby="breakdown-period"]').innerText();
  assert.match(monthBreakdown, /Bills\s+\$60\.00[\s\S]*Liability payments\s+\$350\.00[\s\S]*Cash flow\s+\+\$3,190\.00/);
  assert.doesNotMatch(monthBreakdown, /Subscriptions|reserves/);
  await shot('04-dashboard-month');

  step('forecast: no separate Week tab (Home has the week); a custom range covers one week, with a running total each day');
  const views = page.getByRole('tablist', { name: 'Forecast view' });
  assert.deepEqual(await views.getByRole('tab').allInnerTexts(), ['Month', 'Custom']);
  await views.getByRole('tab', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Start date').fill('2026-10-18');
  await page.getByLabel('End date').fill('2026-10-24');
  assert.match(await page.locator('.hero').innerText(), /^Cash flow\s+−\$350\.00/);
  const weekBreakdown = await page.locator('section[aria-labelledby="breakdown-period"]').innerText();
  assert.match(weekBreakdown, /Liability payments\s+\$350\.00/);
  assert.doesNotMatch(weekBreakdown, /Bills/);
  await page.getByRole('button', { name: /^Oct 18 – 24/ }).click();
  const weekDays = await page.locator('.week-days .timeline').innerText();
  assert.match(weekDays, /Sun, Oct 18[\s\S]*Running total\s+\$1,800\.00[\s\S]*Tue, Oct 20[\s\S]*Running total\s+\$1,450\.00[\s\S]*Sat, Oct 24/);
  await shot('04b-forecast-week');

  step('forecast: custom range validation');
  await page.getByRole('tab', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Start date').fill('2026-11-10');
  await page.getByLabel('End date').fill('2026-11-01');
  await page.getByText('The end date must be on or after the start date.').waitFor();
  await page.getByLabel('End date').fill('2026-11-20');
  // The range starts mid-forecast: the running total carries over from the anchor instead of restarting at $0.
  await page.locator('.week-row').first().click();
  assert.match(await page.locator('.week-days .timeline > li').first().innerText(), /Tue, Nov 10[\s\S]*Running total\s+\$1,990\.00/);

  step('a day later: the paycheck is overdue');
  await page.clock.setFixedTime(new Date(2026, 9, 16, 9, 0));
  await page.goto(`${BASE}#/home`);
  await page.reload();
  const attention = page.getByRole('region', { name: 'Needs attention' });
  assert.match(await attention.innerText(), /Paycheck[\s\S]*Expected Oct 15 — not recorded/);
  await shot('06-overdue');
  await attention.locator('.entry').first().click();
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
  assert.equal(await page.getByRole('region', { name: 'Needs attention' }).count(), 0);

  step('home: what was recorded appears under Happened this week, and weeks move without changing what is overdue');
  assert.match(await page.getByRole('region', { name: 'Happened this week' }).innerText(), /Paycheck[\s\S]*Expected \$1,800\.00 on Oct 15[\s\S]*\+\$1,650\.00/);
  assert.match(await page.locator('.progress').innerText(), /Cash flow so far in October\s*Recorded[\s\S]*\+\$1,650\.00/i);
  await shot('07b-home-recorded');
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('heading', { name: 'Oct 18 – 24', level: 2 }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Happened this week' }).count(), 0);
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('heading', { name: 'Oct 11 – 17', level: 2 }).waitFor();
  // Phone layout: nothing spills sideways.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.goto(`${BASE}#/forecast`);
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();

  step('tapping a week opens its days, reflecting the actual date and amount');
  await page.getByRole('tab', { name: 'Month', exact: true }).click();
  await page.getByRole('button', { name: /^Oct 11 – 17/ }).click();
  const tl = await page.locator('.week-days .timeline').innerText();
  assert.match(tl, /Thu, Oct 15[\s\S]*?—[\s\S]*?Fri, Oct 16[\s\S]*?\+\$1,650\.00[\s\S]*?Running total\s+\$1,650\.00/);
  assert.doesNotMatch(tl, /\$1,800\.00/);
  await page.getByRole('button', { name: /^Oct 25 – 31/ }).click();
  assert.match(await page.locator('.week-days .timeline').innerText(), /Thu, Oct 29[\s\S]*?\+\$1,800\.00[\s\S]*?Running total\s+\$3,040\.00/);
  await page.getByRole('button', { name: /^Oct 11 – 17/ }).click();
  await page.getByRole('button', { name: /^Friday, October 16, 2026/ }).click();
  const day = await page.getByRole('dialog', { name: 'Friday, October 16, 2026' }).innerText();
  assert.match(day, /Received/);
  assert.match(day, /Expected \$1,800\.00 on Oct 15/);
  assert.match(day, /Running total\s+\$1,650\.00/);
  await shot('08-after-actual');
  await page.keyboard.press('Escape');

  step('a day inside an open week opens that day');
  await page.getByRole('button', { name: /^Oct 25 – 31/ }).click();
  await page.getByRole('button', { name: 'Show details for Thursday, October 29, 2026' }).click();
  assert.match(await page.getByRole('dialog', { name: 'Thursday, October 29, 2026' }).innerText(), /Paycheck/);
  await page.keyboard.press('Escape');

  step('income screen shows recorded history and keeps the schedule');
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'See dates' }).click();
  const dates = await page.locator('.source-occurrences').innerText();
  assert.match(dates, /Oct 16, 2026[\s\S]*Expected \$1,800\.00 on Oct 15, 2026[\s\S]*Received/);
  assert.match(dates, /Oct 29, 2026[\s\S]*\+\$1,800\.00[\s\S]*Expected/);
  await shot('09-income');

  step('navigation: Home, Forecast, Activity and Plan; Plan holds Income, Expenses, Liabilities and Reserves; old addresses still open');
  const nav = page.getByRole('navigation', { name: 'Main' }).last();
  assert.deepEqual(await nav.getByRole('link').allInnerTexts(), ['Home', 'Forecast', 'Activity', 'Plan']);
  const planNav = page.getByRole('navigation', { name: 'Plan' });
  assert.deepEqual(await planNav.getByRole('link').allInnerTexts(), ['Income', 'Expenses', 'Liabilities', 'Reserves']);
  await planNav.getByRole('link', { name: 'Liabilities' }).click();
  await page.getByRole('heading', { name: 'Liabilities', level: 1 }).waitFor();
  assert.match(await page.locator('.source-card').innerText(), /Car loan[\s\S]*Loan · Monthly on the 20th/);
  await planNav.getByRole('link', { name: 'Expenses' }).click();
  await page.getByRole('tab', { name: 'Bills', selected: true }).waitFor();
  assert.deepEqual(await page.getByRole('tablist', { name: 'Expense type' }).getByRole('tab').allInnerTexts(), ['Bills', 'Subscriptions', 'Varied']);
  assert.match(await page.locator('.card-list').innerText(), /Rent[\s\S]*Housing/);
  await planNav.getByRole('link', { name: 'Reserves' }).click();
  await page.getByRole('heading', { name: 'Strategic Reserves', level: 1 }).waitFor();
  await page.goto(`${BASE}#/dashboard`);
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
  assert.equal(new URL(page.url()).hash, '#/forecast');
  await page.goto(`${BASE}#/liabilities`);
  await page.getByRole('heading', { name: 'Liabilities', level: 1 }).waitFor();
  assert.equal(new URL(page.url()).hash, '#/plan/liabilities');
  // Phone layout: the four Plan sections fit without scrolling, and nothing spills sideways.
  assert.equal(await page.evaluate(() => { const n = document.querySelector('.plan-nav'); return n.scrollWidth <= n.clientWidth; }), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.locator('.toast').first().waitFor({ state: 'detached' }).catch(() => {});
  await shot('09b-plan-liabilities');
  await page.goto(`${BASE}#/plan/income`);

  step('data persists across reloads');
  await page.reload();
  await page.getByRole('heading', { name: 'Recurring income' }).waitFor();
  assert.match(await page.locator('.source-card').innerText(), /Next: Oct 29, 2026/);

  step('desktop layout');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}#/forecast`);
  await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
  await shot('10-desktop');

  step('settings: account and data actions live on their own page');
  assert.equal(await page.getByRole('button', { name: 'Download backup' }).count(), 0);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  assert.match(await page.locator('main').innerText(), /YOUR DATA[\s\S]*saved in this browser on this device[\s\S]*SAMPLE DATA/i);
  await shot('10b-settings');

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
  await page.getByRole('heading', { name: /^Home/ }).waitFor();
  await page.goto(`${BASE}#/plan/income`);
  assert.match(await page.locator('.source-card').innerText(), /Paycheck[\s\S]*Next: Oct 29, 2026/);
  await page.goto(`${BASE}#/settings`);

  step('home: mark several due items done in one step (no Undo); items not yet due are recorded one at a time');
  await page.clock.setFixedTime(new Date(2026, 9, 27, 9, 0));
  await page.goto(`${BASE}#/home`);
  await page.reload();
  // Tue Oct 27: the car loan (Oct 20) and phone (Oct 25) are overdue; the paycheck is due Thursday.
  const due = page.getByRole('region', { name: 'Needs attention' });
  assert.equal(await due.getByRole('checkbox').count(), 2);
  assert.equal(await page.getByRole('region', { name: 'Coming up' }).getByRole('checkbox').count(), 0);
  await due.getByRole('button', { name: 'Select all' }).click();
  await shot('08b-home-selected');
  await due.getByRole('button', { name: 'Mark 2 items done' }).click();
  await page.getByText('Marked 2 items done as expected.').waitFor();
  assert.equal(await page.getByRole('region', { name: 'Needs attention' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /Undo/ }).count(), 0);
  await page.clock.setFixedTime(new Date(2026, 9, 16, 9, 0));
  await page.goto(`${BASE}#/settings`);
  await page.reload();
  assert.equal(await page.getByRole('heading', { name: 'Review rhythm' }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });

  // The clock reads Oct 16 again here, so sample dates are relative to Oct 16.
  step('sample data: separate from real data, shows the three checkpoint behaviors');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Show sample data' }).click();
  await page.getByText('You're exploring sample data.').waitFor();
  // Unpaid bill: stays visible as overdue.
  assert.match(await page.getByRole('region', { name: 'Needs attention' }).innerText(), /Phone/);
  await page.getByRole('button', { name: 'Full forecast and calendar' }).click();
  // Negative tally before a later payday (look ahead with a custom range).
  await page.getByRole('tab', { name: 'Custom', exact: true }).click();
  await page.getByLabel('End date').fill('2026-11-30');
  await page.getByText('Timing gap ahead').waitFor();
  assert.match(await page.locator('.callout-danger').innerText(), /Nov 5 – 9, by up to \$600\.00/);
  await shot('11-sample-data');
  // The warning opens an explanation from the same forecast: what leads to the low point and what ends it.
  await page.locator('.callout-danger').click();
  const gapSheet = page.getByRole('dialog', { name: /timing gaps? ahead/ });
  const firstGap = gapSheet.getByRole('group').first();
  assert.match(await firstGap.innerText(), /Nov 5 – 9[\s\S]*Down to −\$600\.00[\s\S]*Leading to the lowest point[\s\S]*Back to \$0 or more/i);
  await shot('11b-gap-explanation');
  // Each gap opens and closes from the keyboard.
  await firstGap.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await firstGap.getAttribute('open'), null);
  // What if… from the explanation: preview, then apply after confirming.
  await page.keyboard.press('Enter');
  await firstGap.getByRole('button', { name: /^What if: Car repair/ }).click();
  const whatIf = page.getByRole('dialog', { name: 'What if…' });
  // Back returns to the explanation, unchanged.
  await whatIf.getByRole('button', { name: 'Back' }).click();
  await gapSheet.getByRole('group').first().getByRole('button', { name: /^What if: Car repair/ }).click();
  // Choose "Skip this one" from the keyboard.
  await whatIf.getByRole('radio', { name: 'Skip this one' }).focus();
  await page.keyboard.press('Space');
  assert.equal(await whatIf.getByRole('radio', { name: 'Skip this one' }).isChecked(), true);
  await whatIf.getByText('The timing gap Nov 5 – 9 would be gone.').waitFor();
  await whatIf.getByRole('radio', { name: 'Move date' }).check();
  await whatIf.getByLabel('New date').fill('2026-11-10');
  await whatIf.getByText('The timing gap Nov 5 – 9 would be gone.').waitFor();
  await shot('11c-what-if');
  await whatIf.getByRole('button', { name: 'Apply change…' }).click();
  await whatIf.getByText('Move Car repair from Nov 5, 2026 to Nov 10, 2026.').waitFor();
  await whatIf.getByRole('button', { name: 'Apply change', exact: true }).click();
  await page.getByText('Moved Car repair to Nov 10, 2026.').waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByText('Timing gap ahead').count(), 0);
  // Late paycheck: actual recorded, next one still scheduled.
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'See dates' }).click();
  const sampleDates = await page.locator('.source-occurrences').innerText();
  assert.match(sampleDates, /Oct 14, 2026[\s\S]*Expected \$1,800\.00 on Oct 13, 2026[\s\S]*Received/);
  assert.match(sampleDates, /Oct 27, 2026[\s\S]*Expected/);
  await page.getByRole('button', { name: 'Leave sample data' }).click();
  await page.getByRole('heading', { name: /^Home/ }).waitFor();
  assert.equal(await page.getByText('You're exploring sample data.').count(), 0);
  await page.goto(`${BASE}#/plan/income`);
  assert.match(await page.locator('.source-card').innerText(), /Paycheck[\s\S]*Next: Oct 29, 2026/);

  step('estimate suggestion: see the evidence, preview the forecast, approve after confirming');
  // A household with seven months of electricity bills above its $180 estimate, restored from a backup.
  // The clock still reads Fri Oct 16. Paid $1,000 every other Friday from Oct 23; rent $1,500 from Nov 1;
  // a one-time $940 car insurance bill on Jan 2. The last six bills average $214.17, so $215 from Nov 3.
  const at = '2026-04-01T12:00:00.000Z';
  const src = (id, kind, description, dollars, startDate, rule) => ({
    id, kind, description, tags: [], versions: [{ id: `v-${id}`, startDate, amountCents: dollars * 100, rule }],
    active: true, endDate: null, pausedRanges: [], createdAt: at, updatedAt: at,
  });
  const bill = (date, dollars) => ({
    id: `elec@${date}`, sourceId: 'elec', kind: 'bill', description: 'Electricity', tags: [],
    expectedDate: date, expectedAmountCents: 18000, scheduledDate: date, scheduledAmountCents: 18000,
    status: 'completed', actualDate: date, actualAmountCents: dollars * 100, completedAt: `${date}T12:00:00.000Z`,
    canceledAt: null, cancelNote: null, createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z`,
  });
  const household = {
    schemaVersion: 2, revision: 0, onboardingComplete: true,
    sources: [
      src('pay', 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }),
      src('rent', 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }),
      src('elec', 'bill', 'Electricity', 180, '2026-04-03', { type: 'monthly' }),
    ],
    records: [
      ...[['04', 210], ['05', 215], ['06', 220], ['07', 205], ['08', 225], ['09', 210], ['10', 210]].map(([m, d]) => bill(`2026-${m}-03`, d)),
      { ...bill('2027-01-02', 940), id: 'ins', sourceId: null, kind: 'varied', description: 'Car insurance', expectedAmountCents: 94000, scheduledAmountCents: 94000,
        status: 'scheduled', actualDate: null, actualAmountCents: null, completedAt: null },
    ],
  };
  const householdPath = `${SHOTS}household-backup.json`;
  writeFileSync(householdPath, JSON.stringify({ format: 'financial-os-backup', exportedAt: '2026-10-16T09:00:00.000Z', data: household }));
  await page.goto(`${BASE}#/settings`);
  await page.locator('input[aria-label="Backup file"]').setInputFiles(householdPath);
  const restoreHousehold = page.getByRole('dialog', { name: 'Restore this backup?' });
  assert.match(await restoreHousehold.innerText(), /This backup has 4 items/);
  await restoreHousehold.getByRole('button', { name: 'Replace with backup' }).click();
  await page.getByText('Backup restored.').waitFor();
  await page.goto(`${BASE}#/plan/expenses`);
  const elecCard = page.locator('.source-card', { has: page.getByRole('heading', { name: 'Electricity' }) });
  assert.match(await elecCard.locator('.estimate-callout').innerText(), /Suggested estimate: \$215\.00 instead of \$180\.00 from Nov 3\./);
  assert.equal(await page.locator('.source-card', { has: page.getByRole('heading', { name: 'Rent' }) }).locator('.estimate-callout').count(), 0);
  await page.getByRole('button', { name: 'Review the suggestion for Electricity' }).click();
  const estimate = page.getByRole('dialog', { name: 'Suggestion for Electricity' });
  const estimateText = await estimate.innerText();
  assert.match(estimateText, /Average of recent payments/);
  assert.match(estimateText, /Current estimate\s*\$180\.00\s*Suggested\s*\$215\.00\s*Change\s*\$35\.00 more/);
  assert.match(estimateText, /From Nov 3, 2026 on/);
  assert.match(estimateText, /Your last 6 Electricity payments averaged \$214\.17 and ranged from \$205\.00 to \$225\.00\./);
  // The payments behind it open from the keyboard.
  await estimate.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await estimate.locator('details').getAttribute('open'), '');
  assert.equal(await estimate.getByRole('list', { name: 'Payments' }).getByRole('listitem').count(), 7);
  assert.match(await estimate.getByRole('list', { name: 'Payments' }).innerText(), /Apr 3, 2026 · Not counted: older than the payments used\s*\$210\.00/);
  await estimate.getByRole('button', { name: 'Preview your forecast' }).click();
  const estimatePreview = estimate.getByRole('region', { name: 'Forecast preview' });
  assert.match(await estimatePreview.innerText(), /Your lowest running total would drop from −\$680\.00 to −\$715\.00\./);
  assert.match(await estimatePreview.innerText(), /New timing gap: Jan 3 – 14, down to −\$85\.00, back to \$0 or more on Jan 15\./);
  assert.equal(await estimatePreview.getByRole('list', { name: 'Payments that change' }).getByRole('listitem').count(), 3);
  // Fits a phone screen: nothing scrolls sideways.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await estimate.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  await estimatePreview.scrollIntoViewIfNeeded();
  await shot('12-estimate-suggestion');
  // Nothing saved by looking and previewing.
  const savedBefore = await page.evaluate(() => localStorage.getItem('financial-os:data'));
  assert.equal(JSON.parse(savedBefore).sources.find((s) => s.id === 'elec').versions.length, 1);
  await estimate.getByRole('button', { name: 'Approve…' }).click();
  const approval = estimate.getByRole('group', { name: 'Approve this change?' });
  assert.match(await approval.innerText(), /Change the Electricity estimate from \$180\.00 to \$215\.00, starting with the Nov 3, 2026 payment\./);
  await shot('12b-estimate-confirm');
  await approval.getByRole('button', { name: 'Approve change' }).click();
  await page.getByText('Electricity is now expected at $215.00 from Nov 3, 2026.').waitFor();
  assert.equal(await elecCard.locator('.estimate-callout').count(), 0);
  assert.match(await elecCard.innerText(), /Scheduled change: \$215\.00, monthly on the 3rd, starting Nov 3, 2026\./);
  // Saved, and still there after a reload; recorded payments untouched.
  await page.reload();
  await page.getByRole('heading', { name: 'Expenses', level: 1 }).waitFor();
  assert.match(await elecCard.innerText(), /Scheduled change: \$215\.00/);
  const savedAfter = JSON.parse(await page.evaluate(() => localStorage.getItem('financial-os:data')));
  assert.deepEqual(savedAfter.sources.find((s) => s.id === 'elec').versions.map((v) => [v.startDate, v.amountCents]), [['2026-04-03', 18000], ['2026-11-03', 21500]]);
  assert.deepEqual(savedAfter.records.filter((r) => r.sourceId === 'elec').map((r) => [r.expectedAmountCents, r.actualAmountCents]), household.records.filter((r) => r.sourceId === 'elec').map((r) => [r.expectedAmountCents, r.actualAmountCents]));

  step('scenario: combine changes, see a hidden shortfall, edit, remove, and leave the plan untouched');
  // The plan from scenarios.test.ts: paid $1,000 every other Friday from Oct 23, rent $1,500 from Nov 1,
  // car loan $300 on the 28th. The clock still reads Fri Oct 16.
  const planPath = `${SHOTS}scenario-plan.json`;
  writeFileSync(planPath, JSON.stringify({
    format: 'financial-os-backup', exportedAt: '2026-10-16T09:00:00.000Z',
    data: { schemaVersion: 2, revision: 0, onboardingComplete: true, records: [], sources: [
      src('pay', 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }),
      src('rent', 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }),
      { ...src('loan', 'liability', 'Car loan', 300, '2026-10-28', { type: 'monthly' }), liabilityType: 'loan' },
    ] },
  }));
  await page.goto(`${BASE}#/settings`);
  await page.locator('input[aria-label="Backup file"]').setInputFiles(planPath);
  await page.getByRole('dialog', { name: 'Restore this backup?' }).getByRole('button', { name: 'Replace with backup' }).click();
  await page.getByText('Backup restored.').waitFor();
  await page.goto(`${BASE}#/forecast`);
  const planBefore = await page.evaluate(() => localStorage.getItem('financial-os:data'));
  // Open from the keyboard.
  await page.getByRole('button', { name: 'Explore a scenario' }).focus();
  await page.keyboard.press('Enter');
  const scenario = page.getByRole('dialog', { name: 'Explore a scenario' });
  const addChange = async (type, fill) => {
    await scenario.getByRole('button', { name: 'Add a change' }).click();
    await scenario.getByRole('button', { name: new RegExp(`^${type}`) }).click();
    const form = scenario.getByRole('form', { name: type });
    await fill(form);
    await form.getByRole('button', { name: 'Add to scenario' }).click();
  };
  await addChange('Additional income', async (f) => {
    await f.getByLabel('Name').fill('Tax refund');
    await f.getByLabel('Amount').fill('2000');
    await f.getByLabel('Date').fill('2027-01-10');
  });
  await addChange('Unexpected expense', async (f) => {
    await f.getByLabel('Name').fill('Dentist');
    await f.getByLabel('Amount').fill('900');
    await f.getByLabel('Date').fill('2026-11-10');
  });
  const scenarioResult = scenario.getByRole('region', { name: 'Scenario comparison' });
  assert.match(await scenarioResult.getByRole('status').innerText(), /Your projected ending total improves by \$1,100\.00, but this scenario creates a \$700\.00 shortfall on Nov 10, back to \$0 or more on Nov 20\./);
  assert.match(await scenarioResult.getByRole('table').innerText(), /Cash flow\s+\+\$1,600\.00\s+\+\$2,700\.00[\s\S]*Lowest running total\s+−\$800\.00 on Nov 1\s+−\$1,500\.00 on Dec 1[\s\S]*Ending running total\s+\$1,600\.00\s+\$2,700\.00/);
  assert.match(await scenarioResult.innerText(), /Includes \$2,000\.00 of hypothetical income\. Without it, cash flow would be \+\$700\.00\./);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await scenario.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  await scenarioResult.getByRole('status').scrollIntoViewIfNeeded();
  await shot('13-scenario');
  // Edit the dentist to $100, then remove it.
  await scenario.getByRole('button', { name: 'Edit Dentist: −$900.00 on Nov 10, 2026' }).click();
  await scenario.getByRole('form', { name: 'Unexpected expense' }).getByLabel('Amount').fill('100');
  await scenario.getByRole('button', { name: 'Save change' }).click();
  assert.match(await scenarioResult.getByRole('status').innerText(), /improves by \$1,900\.00, but this scenario deepens a shortfall to \$700\.00 on Dec 1/);
  await scenario.getByRole('button', { name: 'Remove Dentist: −$100.00 on Nov 10, 2026' }).click();
  assert.equal(await scenarioResult.getByRole('status').count(), 0);
  // Variable income: three hypothetical cases side by side, on top of the $2,000 refund still in the scenario.
  await addChange('Explore variable income', async (f) => {
    await f.getByLabel('Name').fill('Delivery tips');
    await f.getByLabel('Low').fill('0');
    await f.getByLabel('Expected').fill('60');
    await f.getByLabel('High').fill('120');
    await f.getByLabel('How often').selectOption('weekly');
    await f.getByLabel('First date').fill('2026-10-24');
  });
  const incomeCases = scenario.getByRole('region', { name: 'Income cases' });
  assert.match(await incomeCases.getByRole('table').first().innerText(), /Hypothetical income\s+\$2,000\.00\s+\$2,780\.00\s+\$3,560\.00/);
  await incomeCases.scrollIntoViewIfNeeded();
  await shot('13b-scenario-income-cases');
  // Escape closes; the plan and saved data are exactly as before.
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('financial-os:data')), planBefore);
  await page.getByRole('button', { name: 'Explore a scenario' }).click();
  assert.match(await scenario.innerText(), /No changes yet\./);
  await page.keyboard.press('Escape');

  step('start over: back up first, erase, quick setup to the review, then recover from the backup');
  await page.goto(`${BASE}#/settings`);
  const dataBeforeReset = JSON.parse(await page.evaluate(() => localStorage.getItem('financial-os:data')));
  await page.getByRole('button', { name: 'Start over' }).click();
  const startOver = page.getByRole('dialog', { name: 'Start over?' });
  assert.match(await startOver.innerText(), /This erases all 3 items you've entered, with everything recorded for them, and takes you back to setup\./);
  const [resetDownload] = await Promise.all([page.waitForEvent('download'), startOver.getByRole('button', { name: 'Download a backup of your data' }).click()]);
  const resetBackupPath = `${SHOTS}before-start-over.json`;
  await resetDownload.saveAs(resetBackupPath);
  await startOver.getByText('Backup downloaded: financial-os-backup-2026-10-16.json').waitFor();
  await shot('14-start-over');
  await startOver.getByRole('button', { name: 'Erase and start over' }).click();
  await page.getByRole('heading', { name: 'See your cash flow ahead of time' }).waitFor();
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('financial-os:data'))).sources, []);
  // The shortest useful setup: one income, then straight to the review.
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Add income' }).click();
  const quickIncome = page.getByRole('dialog', { name: 'Add income' });
  await quickIncome.getByLabel('What is this income?').fill('Paycheck');
  await quickIncome.getByLabel('Amount you expect to receive').fill('1000');
  await quickIncome.getByLabel('How often?').selectOption('biweekly');
  await quickIncome.getByLabel('Next payment date').fill('2026-10-23');
  await quickIncome.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip to review' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Check everything over' }).waitFor();
  assert.match(await page.locator('.review-hero').innerText(), /Oct 23\s*in 7 days/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  // Changed their mind: reload to the welcome screen and restore the backup taken before starting over.
  await page.reload();
  await page.getByRole('heading', { name: 'See your cash flow ahead of time' }).waitFor();
  await page.locator('input[aria-label="Backup file"]').setInputFiles(resetBackupPath);
  const restoreAfterReset = page.getByRole('dialog', { name: 'Restore this backup?' });
  assert.match(await restoreAfterReset.innerText(), /This backup has 3 items[\s\S]*You have 1 item now/);
  await restoreAfterReset.getByRole('button', { name: 'Replace with backup' }).click();
  await page.getByText('Backup restored.').waitFor();
  const dataAfterRestore = JSON.parse(await page.evaluate(() => localStorage.getItem('financial-os:data')));
  assert.deepEqual(dataAfterRestore.sources, dataBeforeReset.sources);
  assert.deepEqual(dataAfterRestore.records, dataBeforeReset.records);

  step('accounts: add one in Settings, assign an item to it, and it survives a reload without changing the forecast');
  {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('heading', { name: 'Accounts' }).waitFor();
    await page.getByRole('button', { name: 'Add account' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add account' });
    await sheet.getByLabel('Name').fill('Paycheck account');
    await sheet.getByText('Income', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Add account' }).click();
    await page.getByText('Account added.').waitFor();
    const dataBefore = JSON.parse(await page.evaluate(() => localStorage.getItem('financial-os:data')));
    await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Plan' }).click();
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const edit = page.getByRole('dialog', { name: /^Edit / });
    await edit.getByLabel('Account (optional)').selectOption({ label: 'Paycheck account' });
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await edit.waitFor({ state: 'detached' });
    await page.reload();
    await page.getByRole('heading', { name: 'Income', exact: true }).waitFor();
    const dataAfter = JSON.parse(await page.evaluate(() => localStorage.getItem('financial-os:data')));
    const account = dataAfter.accounts.find((a) => a.name === 'Paycheck account');
    assert.equal(account.type, 'income');
    assert.equal(dataAfter.sources.filter((src) => src.accountId === account.id).length, 1);
    // Same items, amounts and records: only the assignment changed.
    assert.deepEqual(dataAfter.records, dataBefore.records);
    // (An item with no history yet is saved afresh, so its schedule gets a new id; the schedule itself is the same.)
    const schedules = (d) => d.sources.map((src) => [src.id, src.versions.map(({ id: _id, ...v }) => v)]);
    assert.deepEqual(schedules(dataAfter), schedules(dataBefore));
  }

  step('transfers: a planned move waits on Home, is recorded there, and changes no cash flow');
  {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Add account' }).click();
    let sheet = page.getByRole('dialog', { name: 'Add account' });
    await sheet.getByLabel('Name').fill('Reserves');
    await sheet.getByText('Distribution', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Add account' }).click();
    await page.getByText('Account added.').waitFor();
    await page.getByRole('button', { name: 'Move money' }).click();
    sheet = page.getByRole('dialog', { name: 'Move money' });
    await sheet.getByText('Planned', { exact: true }).click();
    await sheet.getByLabel('From').selectOption({ label: 'Paycheck account' });
    await sheet.getByLabel('To').selectOption({ label: 'Reserves' });
    await sheet.getByLabel('Amount').fill('100');
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await sheet.getByLabel('Date').fill(today);
    await sheet.getByRole('button', { name: 'Plan transfer' }).click();
    await page.getByText('Transfer planned.').waitFor();
    await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Forecast' }).click();
    const heroBefore = await page.locator('.hero').innerText();
    await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Home' }).click();
    await page.getByRole('region', { name: 'Needs attention' }).getByRole('button', { name: /Paycheck account → Reserves/ }).click();
    await shot('13-planned-transfer');
    await page.getByRole('dialog', { name: 'Planned transfer' }).getByRole('button', { name: 'Record as moved' }).click();
    await page.getByText('Transfer recorded.').waitFor();
    assert.equal(await page.getByRole('region', { name: 'Needs attention' }).count(), 0);
    await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Forecast' }).click();
    assert.equal(await page.locator('.hero').innerText(), heroBefore);
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('financial-os:data')));
    assert.equal(saved.transfers.length, 1);
    assert.equal(saved.transfers[0].status, 'recorded');
  }

  step('forecast start: income entered later but paid earlier starts the running total');
  {
    // A fresh device: the Oct 27 paycheck is entered first, the Oct 19 weekend job second.
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const p2 = await fresh.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.clock.setFixedTime(new Date(2026, 9, 11, 9, 0));
    await p2.goto(BASE);
    await p2.getByRole('button', { name: 'Get started' }).click();
    const addItem = async (button, nameLabel, name, amountLabel, amount, dateLabel, date, freq) => {
      await p2.getByRole('button', { name: button }).first().click();
      const s = p2.getByRole('dialog');
      await s.getByLabel(nameLabel).fill(name);
      await s.getByLabel(amountLabel).fill(amount);
      await s.getByLabel(dateLabel).fill(date);
      await s.getByLabel('How often?').selectOption(freq);
      await s.getByRole('button', { name: 'Save' }).click();
      await s.waitFor({ state: 'detached' });
    };
    await addItem(/^Add (another )?income$/, 'What is this income?', 'Restaurant paycheck', 'Amount you expect to receive', '900', 'Next payment date', '2026-10-27', 'biweekly');
    await addItem(/^Add (another )?income$/, 'What is this income?', 'Weekend job', 'Amount you expect to receive', '400', 'Next payment date', '2026-10-19', 'biweekly');
    await p2.getByRole('button', { name: 'Continue' }).click();
    await addItem(/^Add (a|another) bill$/, 'What is this bill?', 'Rent', 'Amount you expect to pay', '1000', 'Next due date', '2026-10-22', 'monthly');
    await p2.getByRole('button', { name: 'Skip to review' }).click();
    await p2.getByRole('heading', { name: 'Check everything over' }).waitFor();
    assert.match(await p2.locator('.review-hero').innerText(), /Oct 19\s*in 8 days[\s\S]*Lowest running total before Nov 1: −\$600\.00 · Oct 22/);
    await p2.getByRole('button', { name: /1 timing gap ahead/ }).waitFor();
    assert.equal(await p2.getByText(/due before your next payday/).count(), 0);
    await p2.getByRole('button', { name: 'See my forecast' }).click();
    // Setup ends on Home; the forecast has the running total.
    await p2.getByRole('heading', { name: /^Home/ }).waitFor();
    await p2.getByRole('button', { name: 'Full forecast and calendar' }).click();
    await p2.getByRole('heading', { name: 'Your cash flow' }).waitFor();
    assert.match(await p2.locator('.forecast .hero').innerText(), /Lowest running total\s*−\$600\.00 · Oct 22[\s\S]*Timing gap ahead/);
    await fresh.close();
  }

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
