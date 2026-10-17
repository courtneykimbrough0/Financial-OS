/**
 * The built app in Chromium, storing its plan in a LOCAL Supabase stack (real
 * Auth, API gateway, PostgREST and the migrations). Run by `npm run
 * e2e:supabase`, which builds and serves the copies used here:
 *   E2E_SUPABASE_BASE  the development copy (`--mode supabase-dev`)
 *   E2E_DEFAULT_BASE   the default copy, as `npm run build` makes it
 *   E2E_LEGACY_BASE    a device-storage copy (as `npm run e2e` uses), for migration
 * What the app shows is read back through its own backup download; what
 * Supabase holds is read with the same anonymous identity's token.
 */
import { createClient } from '@supabase/supabase-js';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../src/domain/dates';
import { buildForecast, explainTimingGaps, paycheckCycles } from '../src/domain/forecast';
import type { AppData } from '../src/domain/types';
import { createBackup, readBackup } from '../src/state/backup';
import { richPlan } from '../src/state/supabase/__tests__/fixtures';
import { canonicalize, checkForMigration, fromRows, toRows, type LoadedPlan } from '../src/state/supabase/rows';

const require = createRequire(import.meta.url);
type Any = any;
let playwright: Any;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const URL = process.env.SUPABASE_TEST_URL!;
const KEY = process.env.SUPABASE_TEST_ANON_KEY!;
const DEV = process.env.E2E_SUPABASE_BASE!;
const DEFAULT = process.env.E2E_DEFAULT_BASE!;
const DEFAULT_DIST = process.env.E2E_DEFAULT_DIST!;
const LEGACY = process.env.E2E_LEGACY_BASE!;
/** Where the development copy keeps its Supabase session (src/state/supabase/dev.tsx). */
const AUTH_KEY = 'financial-os:supabase-dev-auth';
const files = mkdtempSync(join(tmpdir(), 'fo-e2e-'));

const OFFLINE = 'Couldn’t reach the server, so this change isn’t saved yet. Check your connection and try again.';
const SIGNED_OUT = 'You’ve been signed out, so this change isn’t saved. Sign in again, then try again.';
const CONFLICT = 'Your data was changed somewhere else, such as another device. Reload to see the latest version.';
const SAVED_BUT_NEWER = 'Your change was saved, but your data has changed somewhere else since. Reload to see the latest version.';

let browser: Any;
beforeAll(async () => {
  browser = await playwright.chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

/** A browser session at a fixed time (the app's clock; Supabase keeps real time). `like` shares another session's identity. */
async function open(base: string, at: Date, like?: Any) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true, ...(like ? { storageState: await like.context().storageState() } : {}) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(at);
  const saves = track(page);
  await page.goto(base);
  if (base === DEV) await loaded(page);
  return { page, saves };
}

async function loaded(page: Any) {
  await page.getByRole('note').filter({ hasText: 'Development storage: local Supabase' }).waitFor();
  await page.locator('.load-screen').waitFor({ state: 'detached' });
}

/** Every save_plan request: [mode, base revision, HTTP status or 'failed'], and a wait for none in flight. */
function track(page: Any) {
  const log: [string, number, number | string][] = [];
  const ids: string[] = [];
  let pending = 0;
  const body = (r: Any) => (r.url().endsWith('/rest/v1/rpc/save_plan') && r.method() === 'POST' ? JSON.parse(r.postData() ?? 'null') : null);
  page.on('request', (r: Any) => body(r) && pending++);
  page.on('requestfinished', async (r: Any) => {
    const b = body(r);
    if (!b) return;
    const res = await r.response();
    log.push([b.p_mode, b.p_base_revision, res?.status() ?? 'failed']);
    ids.push(b.p_save_id);
    pending--;
  });
  page.on('requestfailed', (r: Any) => {
    const b = body(r);
    if (!b) return;
    log.push([b.p_mode, b.p_base_revision, 'failed']);
    ids.push(b.p_save_id);
    pending--;
  });
  return {
    log,
    ids,
    async idle() {
      for (let quiet = 0; quiet < 4; ) {
        await new Promise((r) => setTimeout(r, 100));
        quiet = pending === 0 ? quiet + 1 : 0;
      }
    },
  };
}

const sessionOf = async (page: Any) => JSON.parse(await page.evaluate((k: string) => localStorage.getItem(k), AUTH_KEY)) as { access_token: string; user: { id: string; is_anonymous?: boolean } };
const asUser = (token: string) => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });

/** The plan Supabase holds for this page's identity. */
async function stored(page: Any): Promise<AppData | null> {
  const { data, error } = await asUser((await sessionOf(page)).access_token).rpc('load_plan');
  if (error) throw new Error(error.message);
  return data ? fromRows(data as LoadedPlan) : null;
}

/**
 * The plan on screen, through the app's own backup download (Settings). Its
 * `revision` is the one last loaded (the store tracks saved revisions apart
 * from the data), so comparisons leave it out (`plan`).
 */
async function onScreen(page: Any, base = DEV): Promise<AppData> {
  await page.goto(`${base}#/settings`);
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  return readBackup(readFileSync(await download.path(), 'utf8')).data;
}

const plan = (d: AppData | null) => (d ? { ...d, revision: 0 } : d);

const DAYS = [0, 30, 90, 180, 365].map((n) => addDays('2026-10-16', n));
function sameForecasts(a: AppData, b: AppData) {
  for (const day of DAYS) {
    const fa = buildForecast(a, day);
    const fb = buildForecast(b, day);
    expect(fb).toEqual(fa);
    expect(explainTimingGaps(fb)).toEqual(explainTimingGaps(fa));
    expect(paycheckCycles(fb)).toEqual(paycheckCycles(fa));
  }
}

/** Waits for saves to finish, checks Supabase holds what's on screen, reloads, and checks the same plan and dashboard come back. */
async function savedAndReloaded(page: Any, saves: ReturnType<typeof track>): Promise<AppData> {
  await saves.idle();
  expect(await page.getByRole('alert').count()).toBe(0);
  const before = await onScreen(page);
  const db = await stored(page);
  expect(plan(db)).toEqual(plan(canonicalize(before)));
  await page.goto(`${DEV}#/dashboard`);
  const dashboard = before.onboardingComplete ? await page.locator('main').innerText() : null;
  await page.reload();
  await loaded(page);
  if (dashboard !== null) expect(await page.locator('main').innerText()).toBe(dashboard);
  const after = await onScreen(page);
  expect(plan(after)).toEqual(plan(before));
  expect(after.revision).toBe(db!.revision);
  sameForecasts(before, db!);
  return after;
}

const nav = (page: Any, name: string) => page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name }).click();
const card = (page: Any, name: string) => page.locator('.source-card', { has: page.getByRole('heading', { name }) });
const recordOf = (d: AppData, sourceDescription: string, expectedDate: string) => {
  const s = d.sources.find((x) => x.description === sourceDescription)!;
  return d.records.find((r) => r.id === `${s.id}@${expectedDate}`);
};

/** A household with seven months of electricity bills above its $180 estimate (as in the device e2e test). */
function householdBackup(): { path: string; data: AppData } {
  const at = '2026-04-01T12:00:00.000Z';
  const src = (id: string, kind: string, description: string, dollars: number, startDate: string, rule: object) => ({
    id, kind, description, tags: [], versions: [{ id: `v-${id}`, startDate, amountCents: dollars * 100, rule }],
    active: true, endDate: null, pausedRanges: [], createdAt: at, updatedAt: at,
  });
  const bill = (date: string, dollars: number) => ({
    id: `elec@${date}`, sourceId: 'elec', kind: 'bill', description: 'Electricity', tags: [],
    expectedDate: date, expectedAmountCents: 18000, scheduledDate: date, scheduledAmountCents: 18000,
    status: 'completed', actualDate: date, actualAmountCents: dollars * 100, completedAt: `${date}T12:00:00.000Z`,
    canceledAt: null, cancelNote: null, createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z`,
  });
  const data = {
    schemaVersion: 2, revision: 0, onboardingComplete: true,
    sources: [
      src('pay', 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }),
      src('rent', 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }),
      src('elec', 'bill', 'Electricity', 180, '2026-04-03', { type: 'monthly' }),
    ],
    records: ([['04', 210], ['05', 215], ['06', 220], ['07', 205], ['08', 225], ['09', 210], ['10', 210]] as const).map(([m, d]) => bill(`2026-${m}-03`, d)),
  };
  const text = JSON.stringify({ format: 'financial-os-backup', exportedAt: '2026-10-16T09:00:00.000Z', data });
  const path = join(files, 'household.json');
  writeFileSync(path, text);
  return { path, data: readBackup(text).data };
}

function backupFile(name: string, data: AppData): string {
  const path = join(files, name);
  writeFileSync(path, createBackup(data, new Date('2026-10-16T09:00:00.000Z')).text);
  return path;
}

async function restore(page: Any, path: string, base = DEV) {
  await page.goto(`${base}#/settings`);
  await page.locator('input[aria-label="Backup file"]').setInputFiles(path);
  const dialog = page.getByRole('dialog', { name: 'Restore this backup?' });
  await dialog.getByRole('button', { name: 'Replace with backup' }).click();
  return dialog;
}

/** A plan saved directly for a page's identity (setup for the conflict tests). */
async function seed(page: Any, plan: AppData) {
  const current = await stored(page);
  const { error } = await asUser((await sessionOf(page)).access_token).rpc('save_plan', { p_base_revision: current!.revision, p_save_id: crypto.randomUUID(), p_mode: 'replace', p_plan: toRows(plan) });
  if (error) throw new Error(error.message);
  await page.reload();
  await loaded(page);
}

describe('the default build', () => {
  it('contains no Supabase code or address, and never contacts Supabase', async () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
    const found = walk(DEFAULT_DIST).filter((f) => /\.(js|html|css|json|webmanifest)$/.test(f) && /supabase|:54321|signInAnonymously|Development storage/i.test(readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
    const { page } = await open(DEFAULT, new Date(2026, 9, 16, 9, 0));
    const requests: string[] = [];
    page.on('request', (r: Any) => requests.push(r.url()));
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(requests.filter((u) => u.includes(':54321') || /supabase/i.test(u))).toEqual([]);
    expect(await page.getByText('Development storage').count()).toBe(0);
    expect(await page.evaluate((k: string) => localStorage.getItem(k), AUTH_KEY)).toBeNull();
    await page.context().close();
  });
});

describe('the development copy on local Supabase', () => {
  it('runs as a temporary anonymous identity whose plan only it can reach', async () => {
    const a = await open(DEV, new Date(2026, 9, 16, 9, 0));
    const b = await open(DEV, new Date(2026, 9, 16, 9, 0));
    const sa = await sessionOf(a.page);
    const sb = await sessionOf(b.page);
    expect(sa.user.is_anonymous).toBe(true);
    expect(sa.user.id).not.toBe(sb.user.id);
    await seed(a.page, richPlan());
    // B is a different identity: an empty plan of its own, and nothing of A's through the API.
    expect(await stored(b.page)).toEqual({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });
    const asB = asUser(sb.access_token);
    const wsA = (await asUser(sa.access_token).from('workspaces').select('id')).data![0]!.id;
    expect((await asB.from('workspaces').select('id').eq('id', wsA)).data).toEqual([]);
    expect((await asB.from('sources').select('id').eq('workspace_id', wsA)).data).toEqual([]);
    expect((await asB.from('sources').update({ description: 'x' }).eq('workspace_id', wsA)).error?.code).toBe('42501');
    // And signed-out callers reach nothing.
    const anon = createClient(URL, KEY, { auth: { persistSession: false } });
    expect((await anon.rpc('load_plan')).error?.code).toBe('42501');
    expect((await anon.from('workspaces').select('id')).error?.code).toBe('42501');
    // The device keeps the session only, never the plan.
    const keys = await a.page.evaluate(() => Object.keys(localStorage));
    expect(keys.filter((k: string) => k.startsWith('financial-os:'))).toEqual([AUTH_KEY]);
    await a.page.context().close();
    await b.page.context().close();
  });

  it('steps 1–15 through the interface: each saved to Supabase, the same after a reload, with identical forecasts', async () => {
    const { page, saves } = await open(DEV, new Date(2026, 9, 11, 9, 0));

    // 1. An empty workspace.
    await page.getByRole('heading', { name: 'See your cash flow ahead of time' }).waitFor();
    expect(await stored(page)).toEqual({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });

    // 2–6. Minimum setup: income, a bill, a one-time expense, a liability payment.
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByRole('button', { name: 'Add income' }).click();
    let sheet = page.getByRole('dialog', { name: 'Add income' });
    await sheet.getByLabel('What is this income?').fill('Paycheck');
    await sheet.getByLabel('Amount you expect to receive').fill('1800');
    await sheet.getByLabel('Next payment date').fill('2026-10-15');
    await sheet.getByLabel('How often?').selectOption('biweekly');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Every 2 weeks · next Oct 15, 2026').waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'What bills do you pay?' }).waitFor();
    await page.getByRole('button', { name: 'Add a bill' }).click();
    sheet = page.getByRole('dialog', { name: 'Add a bill' });
    await sheet.getByLabel('What is this bill?').fill('Rent');
    await sheet.getByLabel('Amount you expect to pay').fill('1,200');
    await sheet.getByLabel('Next due date').fill('2026-11-01');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Add one-time expense' }).click();
    sheet = page.getByRole('dialog', { name: 'Add one-time expense' });
    await sheet.getByLabel('Description').fill('Car repair');
    await sheet.getByLabel('Expected amount').fill('100');
    await sheet.getByLabel('Expected date').fill('2026-10-26');
    await sheet.getByRole('button', { name: /Add one-time/ }).click();
    await page.getByText('One time · Oct 26, 2026').waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'What subscriptions renew?' }).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'What do you pay toward debts?' }).waitFor();
    await page.getByRole('button', { name: 'Add a payment' }).click();
    sheet = page.getByRole('dialog', { name: 'Add a payment' });
    await sheet.getByLabel('What is this payment for?').fill('Car loan');
    await sheet.getByLabel('Payment amount').fill('350');
    await sheet.getByLabel('Next payment due date').fill('2026-10-20');
    await sheet.getByRole('radio', { name: 'Loan' }).check();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Loan · Monthly on the 20th').waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'What do you set aside?' }).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'See my forecast' }).click();
    await page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
    let d = await savedAndReloaded(page, saves);
    expect(d.onboardingComplete).toBe(true);
    expect(d.sources.map((s) => [s.kind, s.description, s.liabilityType ?? null, s.versions.map((v) => [v.startDate, v.amountCents, v.rule.type])])).toEqual([
      ['income', 'Paycheck', null, [['2026-10-15', 180000, 'biweekly']]],
      ['bill', 'Rent', null, [['2026-11-01', 120000, 'monthly']]],
      ['liability', 'Car loan', 'loan', [['2026-10-20', 35000, 'monthly']]],
    ]);
    expect(d.records.map((r) => [r.description, r.sourceId, r.scheduledDate, r.scheduledAmountCents, r.status])).toEqual([['Car repair', null, '2026-10-26', 10000, 'scheduled']]);

    // 7. A day later the paycheck is overdue: record it as received, late and smaller.
    await page.clock.setFixedTime(new Date(2026, 9, 16, 9, 0));
    await page.goto(`${DEV}#/dashboard`);
    await page.reload();
    await loaded(page);
    await page.getByRole('button', { name: '1 transaction needs an update' }).click();
    await page.getByRole('dialog').locator('.entry').first().click();
    let occ = page.getByRole('dialog', { name: 'Paycheck' });
    await occ.getByRole('button', { name: 'Mark received', exact: true }).click();
    await occ.getByLabel('Amount received').fill('1750');
    await occ.getByLabel('Date received').fill('2026-10-16');
    await occ.getByRole('button', { name: 'Save as received' }).click();
    await occ.waitFor({ state: 'detached' }).catch(() => {});
    d = await savedAndReloaded(page, saves);
    const received = recordOf(d, 'Paycheck', '2026-10-15')!;
    expect([received.status, received.expectedDate, received.expectedAmountCents, received.actualDate, received.actualAmountCents]).toEqual(['completed', '2026-10-15', 180000, '2026-10-16', 175000]);

    // 10. Undo it (not received yet), then record it again.
    await nav(page, 'Income');
    await card(page, 'Paycheck').getByRole('button', { name: 'See dates' }).click();
    await card(page, 'Paycheck').getByRole('button', { name: /^Oct 16, 2026/ }).click();
    occ = page.getByRole('dialog', { name: 'Paycheck' });
    await occ.getByRole('button', { name: 'Undo: not received yet' }).click();
    await saves.idle();
    const undone = recordOf((await stored(page))!, 'Paycheck', '2026-10-15');
    expect(undone?.status ?? 'none').not.toBe('completed');
    await page.keyboard.press('Escape');
    await card(page, 'Paycheck').getByRole('button', { name: /^Oct 15, 2026/ }).click();
    occ = page.getByRole('dialog', { name: 'Paycheck' });
    await occ.getByRole('button', { name: 'Mark received', exact: true }).click();
    await occ.getByLabel('Amount received').fill('1750');
    await occ.getByLabel('Date received').fill('2026-10-16');
    await occ.getByRole('button', { name: 'Save as received' }).click();
    d = await savedAndReloaded(page, saves);
    expect(recordOf(d, 'Paycheck', '2026-10-15')!.actualAmountCents).toBe(175000);

    // 8. Change a recurring amount: a raise from the Oct 29 paycheck (it has a recorded payment, so earlier ones keep theirs).
    await nav(page, 'Income');
    await card(page, 'Paycheck').getByRole('button', { name: 'Edit' }).click();
    sheet = page.getByRole('dialog', { name: 'Edit Paycheck' });
    await sheet.getByLabel('Amount you expect to receive').fill('1,900');
    await sheet.getByLabel('Changes start with the payment on').fill('2026-10-29');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await sheet.waitFor({ state: 'detached' });
    d = await savedAndReloaded(page, saves);
    expect(d.sources.find((s) => s.description === 'Paycheck')!.versions.map((v) => [v.startDate, v.amountCents])).toEqual([
      ['2026-10-15', 180000],
      ['2026-10-29', 190000],
    ]);

    // 9. Move the Nov 1 rent to Nov 3.
    await nav(page, 'Expenses');
    await card(page, 'Rent').getByRole('button', { name: 'See dates' }).click();
    await card(page, 'Rent').getByRole('button', { name: /^Nov 1, 2026/ }).click();
    occ = page.getByRole('dialog', { name: 'Rent' });
    await occ.getByRole('button', { name: 'Change just this one' }).click();
    await occ.getByLabel('Expected date').fill('2026-11-03');
    await occ.getByRole('button', { name: 'Save' }).click();
    d = await savedAndReloaded(page, saves);
    const moved = recordOf(d, 'Rent', '2026-11-01')!;
    expect([moved.expectedDate, moved.scheduledDate, moved.scheduledAmountCents, moved.status]).toEqual(['2026-11-01', '2026-11-03', 120000, 'scheduled']);

    // 12–13. A weekly review rhythm, and this week's review marked done.
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('heading', { name: 'Review rhythm' }).waitFor();
    await page.getByRole('radio', { name: /^Off/ }).focus();
    await page.keyboard.press('ArrowDown');
    expect(await page.getByRole('radio', { name: /^Weekly/ }).isChecked()).toBe(true);
    await page.goto(`${DEV}#/dashboard`);
    await page.getByRole('button', { name: 'Your weekly review is ready' }).click();
    await page.getByRole('dialog', { name: 'Weekly review' }).getByRole('button', { name: 'Mark review done' }).click();
    await page.getByText('Review done.').waitFor();
    d = await savedAndReloaded(page, saves);
    expect(d.review).toEqual({ cadence: 'weekly', handledOn: '2026-10-16', outcome: 'completed' });

    // 14. Restore a backup: sent as a replace; the backup's plan exactly.
    const household = householdBackup();
    const restoreDialog = await restore(page, household.path);
    await page.getByText('Backup restored.').waitFor();
    await restoreDialog.waitFor({ state: 'detached' });
    d = await savedAndReloaded(page, saves);
    expect(plan(d)).toEqual(plan(canonicalize(household.data)));

    // 11. Dismiss the electricity estimate suggestion.
    await nav(page, 'Expenses');
    await page.getByRole('button', { name: 'Review the suggestion for Electricity' }).click();
    await page.getByRole('dialog', { name: 'Suggestion for Electricity' }).getByRole('button', { name: 'Dismiss' }).click();
    d = await savedAndReloaded(page, saves);
    expect(d.sources.find((s) => s.id === 'elec')!.estimateDismissal).toEqual({ currentCents: 18000, proposedCents: 21500, through: '2026-10-03' });
    await nav(page, 'Expenses');
    expect(await page.getByRole('button', { name: 'Review the suggestion for Electricity' }).count()).toBe(0);

    // 15. Start over: sent as a reset, back to setup.
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('dialog', { name: 'Start over?' }).getByRole('button', { name: 'Erase and start over' }).click();
    await page.getByText('Your data was erased. Set up again whenever you’re ready.').waitFor();
    await saves.idle();
    const erased = await stored(page);
    expect(erased).toEqual({ schemaVersion: 2, revision: erased!.revision, onboardingComplete: false, sources: [], records: [] });
    await page.reload();
    await loaded(page);
    expect(plan(await onScreen(page))).toEqual(plan(erased));

    // Every save was confirmed, each with the intent of its action, and each on the revision before.
    expect(saves.log.every(([, , status]) => status === 200)).toBe(true);
    const modes = saves.log.map(([m]) => m);
    expect(modes.filter((m) => m !== 'update')).toEqual(['replace', 'reset']);
    expect(saves.log.map(([, base]) => base)).toEqual(saves.log.map((_, i) => i));
    await page.context().close();
  });
});

/** A plan to argue over: paycheck, a $150 phone bill due Oct 15 (overdue on Oct 16), and rent (October's paid). */
function contested(): AppData {
  const at = '2026-10-01T12:00:00.000Z';
  const src = (id: string, kind: 'income' | 'bill', description: string, cents: number, startDate: string, type: 'biweekly' | 'monthly') => ({
    id, kind, description, tags: [], versions: [{ id: `v-${id}`, startDate, amountCents: cents, rule: { type } }],
    active: true, endDate: null, pausedRanges: [], createdAt: at, updatedAt: at,
  });
  return {
    schemaVersion: 2, revision: 0, onboardingComplete: true,
    sources: [src('pay', 'income', 'Paycheck', 180000, '2026-10-23', 'biweekly'), src('phone', 'bill', 'Phone', 15000, '2026-10-15', 'monthly'), src('rent', 'bill', 'Rent', 150000, '2026-10-01', 'monthly')],
    // October's rent is paid, so editing rent changes it from a date on (a new schedule version).
    records: [{ id: 'rent@2026-10-01', sourceId: 'rent', kind: 'bill', description: 'Rent', tags: [], expectedDate: '2026-10-01', expectedAmountCents: 150000, scheduledDate: '2026-10-01', scheduledAmountCents: 150000, status: 'completed', actualDate: '2026-10-01', actualAmountCents: 150000, completedAt: at, canceledAt: null, cancelNote: null, createdAt: at, updatedAt: at }],
  } as AppData;
}

async function payPhone(page: Any, dollars = '150') {
  await page.goto(`${DEV}#/dashboard`);
  await page.getByRole('button', { name: '1 transaction needs an update' }).click();
  await page.getByRole('dialog').locator('.entry').first().click();
  const occ = page.getByRole('dialog', { name: 'Phone' });
  await occ.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await occ.getByLabel('Amount paid').fill(dollars);
  await occ.getByLabel('Date paid').fill('2026-10-16');
  await occ.getByRole('button', { name: 'Save as paid' }).click();
}

async function changeRent(page: Any, amount: string) {
  await nav(page, 'Expenses');
  await card(page, 'Rent').getByRole('button', { name: 'Edit' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit Rent' });
  await sheet.getByLabel('Amount you expect to pay').fill(amount);
  await sheet.getByLabel('Changes start with the payment on').fill('2026-12-01');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await sheet.waitFor({ state: 'detached' });
}

const statusBar = (page: Any) => page.locator('.save-status');
/** The next save_plan reply is lost after the database has committed it. */
const loseNextReply = (page: Any) =>
  page.route(
    '**/rest/v1/rpc/save_plan',
    async (route: Any) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
const phoneRecord = (d: AppData | null) => d!.records.find((r) => r.id === 'phone@2026-10-15');
const rentAmounts = (d: AppData | null) => d!.sources.find((s) => s.id === 'rent')!.versions.map((v) => v.amountCents);

describe('two sessions of the same identity, and saves that go wrong', () => {
  const at = new Date(2026, 9, 16, 9, 0);

  it('both on the same revision: the second save is a conflict, shown as not saved, and nothing is silently lost', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await open(DEV, at, a.page);
    expect((await sessionOf(b.page)).user.id).toBe((await sessionOf(a.page)).user.id);
    const base = (await stored(a.page))!.revision;

    await payPhone(a.page);
    await a.saves.idle();
    expect((await stored(a.page))!.revision).toBe(base + 1);

    await changeRent(b.page, '1,550');
    await statusBar(b.page).waitFor();
    expect(await statusBar(b.page).innerText()).toContain(CONFLICT);
    expect(b.saves.log).toEqual([['update', base, 409]]);
    // Supabase kept A's payment; B's change didn't overwrite it.
    const db = await stored(a.page);
    expect([db!.revision, phoneRecord(db)!.actualAmountCents, rentAmounts(db)]).toEqual([base + 1, 15000, [150000]]);
    // B's change is still on B's screen (unsaved), and can be kept as a backup before reloading.
    const bPlan = await onScreen(b.page);
    expect(rentAmounts(bPlan)).toEqual([150000, 155000]);
    expect(await statusBar(b.page).innerText()).toContain(CONFLICT);
    // Reload shows the latest saved plan, A's payment included.
    await statusBar(b.page).getByRole('button', { name: 'Reload' }).click();
    await b.page.locator('.load-screen').waitFor({ state: 'detached' });
    const reloaded = await onScreen(b.page);
    expect([(await stored(b.page))!.revision, phoneRecord(reloaded)!.actualAmountCents, rentAmounts(reloaded)]).toEqual([base + 1, 15000, [150000]]);
    await a.page.context().close();
    await b.page.context().close();
  });

  it('a reply lost after the database committed: shown as not saved, warns before leaving, and Try again saves it once', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const base = (await stored(a.page))!.revision;
    await loseNextReply(a.page);
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    expect(await statusBar(a.page).innerText()).toMatch(new RegExp(`^Your latest change hasn’t been saved\\. ${OFFLINE.replace(/\./g, '\\.')}\\s+Try again$`));
    expect((await stored(a.page))!.revision).toBe(base + 1);
    // Leaving now asks first.
    const dialog = new Promise<Any>((resolve) => a.page.once('dialog', resolve));
    await a.page.close({ runBeforeUnload: true });
    const prompt = await dialog;
    expect(prompt.type()).toBe('beforeunload');
    await prompt.dismiss();
    // The change is still on screen; Try again is told it was already saved, and nothing is applied twice.
    await statusBar(a.page).getByRole('button', { name: 'Try again' }).click();
    await statusBar(a.page).waitFor({ state: 'detached' });
    await a.saves.idle();
    expect(a.saves.ids[0]).toBe(a.saves.ids[1]);
    const db = await stored(a.page);
    expect([db!.revision, db!.records.filter((r) => r.sourceId === 'phone').length, phoneRecord(db)!.actualAmountCents]).toEqual([base + 1, 1, 15000]);
    await a.page.context().close();
  });

  it('a lost reply, then more edits: the edits are saved on top, nothing twice', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const base = (await stored(a.page))!.revision;
    await loseNextReply(a.page);
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    await changeRent(a.page, '1,600');
    await statusBar(a.page).getByRole('button', { name: 'Try again' }).click();
    await statusBar(a.page).waitFor({ state: 'detached' });
    await a.saves.idle();
    const db = await stored(a.page);
    expect([db!.revision, phoneRecord(db)!.actualAmountCents, rentAmounts(db)]).toEqual([base + 2, 15000, [150000, 160000]]);
    expect(plan(await onScreen(a.page))).toEqual(plan(canonicalize(db!)));
    await a.page.context().close();
  });

  it('a lost save retried after a newer save elsewhere: recognized, not reapplied, no regression, asks for a reload', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const base = (await stored(a.page))!.revision;
    await loseNextReply(a.page);
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    const b = await open(DEV, at, a.page);
    await changeRent(b.page, '1,700');
    await b.saves.idle();
    expect((await stored(b.page))!.revision).toBe(base + 2);
    await statusBar(a.page).getByRole('button', { name: 'Try again' }).click();
    await a.page.getByText(SAVED_BUT_NEWER).waitFor();
    const db = await stored(a.page);
    expect([db!.revision, phoneRecord(db)!.actualAmountCents, rentAmounts(db)]).toEqual([base + 2, 15000, [150000, 170000]]);
    await statusBar(a.page).getByRole('button', { name: 'Reload' }).click();
    await a.page.locator('.load-screen').waitFor({ state: 'detached' });
    expect(rentAmounts(await onScreen(a.page))).toEqual([150000, 170000]);
    await a.page.context().close();
    await b.page.context().close();
  });

  it('the session ends while the app is open: the change stays on screen, marked not saved, and saves once signed in again', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const base = (await stored(a.page))!.revision;
    // An expired session: the API refuses the token.
    await a.page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer expired' } }));
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    expect(await statusBar(a.page).innerText()).toContain(SIGNED_OUT);
    expect(a.saves.log.at(-1)).toEqual(['update', base, 401]);
    expect((await stored(a.page))!.revision).toBe(base);
    await a.page.unroute('**/rest/v1/rpc/save_plan');
    await statusBar(a.page).getByRole('button', { name: 'Try again' }).click();
    await statusBar(a.page).waitFor({ state: 'detached' });
    await a.saves.idle();
    expect(phoneRecord(await stored(a.page))!.actualAmountCents).toBe(15000);
    await a.page.context().close();
  });

  it('a restore the database refuses: the saved plan stays, and Cancel reloads it', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const before = await stored(a.page);
    // A recurring record whose id doesn't match its date: the app reads it, the database refuses it.
    const bad = { ...contested(), records: [{ id: 'rent@2026-10-02', sourceId: 'rent', kind: 'bill', description: 'Rent', tags: [], expectedDate: '2026-11-01', expectedAmountCents: 150000, scheduledDate: '2026-11-01', scheduledAmountCents: 150000, status: 'scheduled', actualDate: null, actualAmountCents: null, completedAt: null, canceledAt: null, cancelNote: null, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' }] } as AppData;
    expect(checkForMigration(bad).filter((i) => i.level === 'error').length).toBeGreaterThan(0);
    const dialog = await restore(a.page, backupFile('refused.json', bad));
    await dialog.getByRole('alert').waitFor();
    expect(await dialog.getByRole('alert').innerText()).toMatch(/^The restore hasn’t been confirmed\. This change couldn’t be saved/);
    expect(await a.page.getByText('Backup restored.').count()).toBe(0);
    expect(await stored(a.page)).toEqual(before);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await a.page.locator('.load-screen').waitFor({ state: 'detached' });
    expect(plan(await onScreen(a.page))).toEqual(plan(before));
    await a.page.context().close();
  });

  it('a double click on Replace with backup sends one save', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    await a.page.goto(`${DEV}#/settings`);
    await a.page.locator('input[aria-label="Backup file"]').setInputFiles(householdBackup().path);
    await a.page.getByRole('dialog', { name: 'Restore this backup?' }).getByRole('button', { name: 'Replace with backup' }).dblclick();
    await a.page.getByText('Backup restored.').waitFor();
    await a.saves.idle();
    expect(a.saves.log.map(([m, , s]) => [m, s])).toEqual([['replace', 200]]);
    await a.page.context().close();
  });
});

describe('moving a plan from device storage to Supabase through a backup', () => {
  it('everything arrives exactly, forecasts match, and the Supabase copy restores back to device storage', async () => {
    const original = richPlan();
    expect(checkForMigration(original).filter((i) => i.level === 'error')).toEqual([]);

    // The plan in the current (device-storage) app, downloaded with its own backup button.
    const legacy = await open(LEGACY, new Date(2026, 9, 16, 9, 0));
    await legacy.page.evaluate((doc: string) => localStorage.setItem('financial-os:data', doc), JSON.stringify(original));
    await legacy.page.reload();
    const exported = await onScreen(legacy.page, LEGACY);
    expect(exported).toEqual(original);
    const exportPath = backupFile('legacy-export.json', exported);

    // A refused migration doesn't touch a valid Supabase plan (see the refused restore above); this one is valid.
    const dev = await open(DEV, new Date(2026, 9, 16, 9, 0));
    await (await restore(dev.page, exportPath)).waitFor({ state: 'detached' });
    await dev.saves.idle();
    expect(dev.saves.log).toEqual([['replace', 0, 200]]);
    const db = (await stored(dev.page))!;
    const want = { ...canonicalize(original), revision: 1 };
    expect(db).toEqual(want);
    // Field by field, for the record.
    expect(db.records.map((r) => r.id)).toEqual(want.records.map((r) => r.id));
    expect(db.sources.map((s) => s.id)).toEqual(want.sources.map((s) => s.id));
    expect(db.records.map((r) => [r.expectedDate, r.expectedAmountCents, r.scheduledDate, r.scheduledAmountCents, r.status, r.actualDate, r.actualAmountCents])).toEqual(
      want.records.map((r) => [r.expectedDate, r.expectedAmountCents, r.scheduledDate, r.scheduledAmountCents, r.status, r.actualDate, r.actualAmountCents]),
    );
    expect(db.sources.map((s) => [s.versions, s.pausedRanges, s.estimateDismissal ?? null])).toEqual(want.sources.map((s) => [s.versions, s.pausedRanges, s.estimateDismissal ?? null]));
    expect([db.review, db.onboardingComplete]).toEqual([original.review, true]);
    sameForecasts(original, db);
    // What the app shows after a reload is the same.
    await dev.page.reload();
    await loaded(dev.page);
    const shown = await onScreen(dev.page);
    expect(shown).toEqual(want);

    // Rollback: the Supabase copy's backup restores into device storage, the same plan.
    const rollbackPath = backupFile('rollback.json', shown);
    await (await restore(legacy.page, rollbackPath, LEGACY)).waitFor({ state: 'detached' });
    const back = await onScreen(legacy.page, LEGACY);
    expect({ ...back, revision: 0 }).toEqual({ ...want, revision: 0 });
    sameForecasts(original, back);
    await legacy.page.context().close();
    await dev.page.context().close();
  });
});
