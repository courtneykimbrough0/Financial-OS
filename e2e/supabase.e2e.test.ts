/**
 * The built app in Chromium, storing its plan in a LOCAL Supabase stack (real
 * Auth, API gateway, PostgREST and the migrations). Run by `npm run
 * e2e:supabase`, which builds and serves the copies used here:
 *   E2E_SUPABASE_BASE  the development copy (`--mode supabase-dev`)
 *   E2E_DEFAULT_BASE   the default copy, as `npm run build` makes it
 *   E2E_LEGACY_BASE    a device-storage copy (as `npm run e2e` uses), for migration
 * People sign in through the app's own sign-in screen, with accounts whose
 * emails are confirmed through the stack's email-testing server. What the app
 * shows is read back through its own backup download; what Supabase holds is
 * read with the same session's token.
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
import { ANONYMOUS_ON, confirmedAccount, deleteTestAccounts, HAS_MAIL, latestMail, subjectIs } from '../src/state/supabase/__tests__/local-auth';
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

const OFFLINE = 'Couldn’t reach the server, so this change isn’t confirmed yet. Check your connection and try again.';
const SIGNED_OUT = 'You’ve been signed out, so this change isn’t saved. Sign in again, then try again.';
const CONFLICT = 'Your data was changed somewhere else, such as another device. Reload to see the latest version.';
const SAVED_BUT_NEWER = 'Your change was saved, but your data has changed somewhere else since. Reload to see the latest version.';

let browser: Any;
beforeAll(async () => {
  browser = await playwright.chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await deleteTestAccounts(URL, KEY);
});

type Account = Awaited<ReturnType<typeof confirmedAccount>>;
/** A new account with a confirmed email (signed up through the API; the app's own sign-up is tested below). */
const newAccount = () => confirmedAccount(createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } }));

/**
 * A browser (its own device) at a fixed time: the app's clock; Supabase keeps
 * real time. The development copy is signed in through its sign-in screen as
 * `as` (a new account by default), unless `signIn` is false.
 */
async function open(base: string, at: Date, opts: { as?: Account; signIn?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(at);
  const saves = track(page);
  await page.goto(base);
  const account = base === DEV && opts.signIn !== false ? (opts.as ?? (await newAccount())) : null;
  if (account) await signIn(page, account.email, account.password);
  return { page, saves, account: account! };
}

const signInForm = (page: Any) => page.getByRole('form', { name: 'Sign in to Financial OS' });
async function signIn(page: Any, email: string, password: string) {
  const form = signInForm(page);
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Password').fill(password);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await loaded(page);
}

/**
 * The app (not the sign-in screen) is open, its plan has loaded, and it has
 * set its route: opened at the bare address it moves to the dashboard or
 * setup just after its first render, which would undo a navigation made
 * before that.
 */
async function loaded(page: Any) {
  await page.getByRole('note').filter({ hasText: 'Development storage:' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.load-screen') && document.querySelector('.app main#main:not(.sign-in)') && window.location.hash.startsWith('#/'));
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

const sessionOf = async (page: Any) => JSON.parse(await page.evaluate((k: string) => localStorage.getItem(k), AUTH_KEY)) as { access_token: string; refresh_token: string; user: { id: string; email?: string; is_anonymous?: boolean } };
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
/** `plan`, for tests with a local named plan. */
const plan_ = plan;

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
  it('two accounts on two devices: each reaches only its own plan, and signed-out callers reach nothing', async () => {
    const a = await open(DEV, new Date(2026, 9, 16, 9, 0));
    const b = await open(DEV, new Date(2026, 9, 16, 9, 0));
    const sa = await sessionOf(a.page);
    const sb = await sessionOf(b.page);
    expect([sa.user.is_anonymous, sa.user.email]).toEqual([false, a.account.email]);
    expect(sa.user.id).not.toBe(sb.user.id);
    await seed(a.page, richPlan());
    // B: an empty plan of its own, and nothing of A's through the API.
    expect(await stored(b.page)).toEqual({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });
    const asB = asUser(sb.access_token);
    const wsA = (await asUser(sa.access_token).from('workspaces').select('id')).data![0]!.id;
    expect((await asB.from('workspaces').select('id').eq('id', wsA)).data).toEqual([]);
    for (const t of ['sources', 'schedule_versions', 'source_pauses', 'occurrence_records']) expect([t, (await asB.from(t).select('*').eq('workspace_id', wsA)).data]).toEqual([t, []]);
    expect((await asB.from('sources').update({ description: 'x' }).eq('workspace_id', wsA)).error?.code).toBe('42501');
    expect((await asB.from('sources').insert({ workspace_id: wsA, id: 'x', position: 0, kind: 'bill', description: 'x', active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })).error?.code).toBe('42501');
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
    await page.getByRole('button', { name: 'Add spending' }).click();
    sheet = page.getByRole('dialog', { name: 'Add varied spending' });
    await sheet.getByLabel('Description').fill('Car repair');
    await sheet.getByLabel('Expected amount').fill('100');
    await sheet.getByLabel('Expected date').fill('2026-10-26');
    await sheet.getByRole('button', { name: 'Add spending' }).click();
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
    await page.getByRole('heading', { name: /^Home/ }).waitFor();
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
    await page.goto(`${DEV}#/home`);
    await page.reload();
    await loaded(page);
    await page.getByRole('region', { name: 'Needs attention' }).locator('.entry').first().click();
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

const TWO_HOURS = 2 * 3600 * 1000;
const appText = (page: Any) => page.locator('body').innerText();
/** Settings → Sign out → confirm. */
async function signOutUi(page: Any, confirm = 'Sign out') {
  await page.goto(`${DEV}#/settings`);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: confirm, exact: true }).click();
  await signInForm(page).waitFor();
}

describe('accounts in the development copy', () => {
  const at = new Date(2026, 9, 16, 9, 0);

  it.skipIf(!HAS_MAIL)('creating an account: confirm the email first, then setup starts on an empty plan', async () => {
    const { page } = await open(DEV, at, { signIn: false });
    const email = `e2e-${crypto.randomUUID()}@example.test`;
    const password = 'a-long-password-1';
    await signInForm(page).waitFor();
    await page.getByRole('button', { name: 'Create an account' }).click();
    const form = page.getByRole('form', { name: 'Create your account' });
    await form.getByLabel('Email').fill(email);
    await form.getByLabel('Password').fill('short');
    await form.getByRole('button', { name: 'Create account' }).click();
    expect(await form.getByRole('alert').innerText()).toBe('Choose a password with at least 8 characters.');
    await form.getByLabel('Password').fill(password);
    await form.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    expect(await page.getByRole('status').innerText()).toContain(`If ${email} can be used for a new account, we’ve sent a link to it.`);
    // Signing in before confirming: told to confirm, with a way to resend.
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await signInForm(page).getByLabel('Email').fill(email);
    await signInForm(page).getByLabel('Password').fill(password);
    await signInForm(page).getByRole('button', { name: 'Sign in' }).click();
    expect(await signInForm(page).getByRole('alert').innerText()).toBe('Confirm your email first: open the link we sent when you created your account.');
    // The local auth server sends at most one email a second to an address.
    await page.waitForTimeout(1100);
    await signInForm(page).getByRole('button', { name: 'Send the confirmation link again' }).click();
    await page.getByText('We sent the link again.').waitFor();
    // The link from the email, opened in this browser, finishes sign-up and opens setup.
    const mail = await latestMail(email);
    expect(subjectIs(mail, 'Confirm your email address')).toBe(true);
    await page.goto(mail.link);
    await loaded(page);
    await page.getByRole('heading', { name: 'See your cash flow ahead of time' }).waitFor();
    expect(new globalThis.URL(page.url()).search).toBe('');
    expect(await page.getByText(`Signed in as ${email}.`).count()).toBe(1);
    expect(await stored(page)).toEqual({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });
    await page.context().close();
  });

  it('wrong credentials: one message for a wrong password or an unknown email, and no plan is shown', async () => {
    const account = await newAccount();
    const { page } = await open(DEV, at, { signIn: false });
    for (const [email, password] of [[account.email, 'not-the-password'], [`nobody-${crypto.randomUUID()}@example.test`, 'not-the-password']]) {
      await signInForm(page).getByLabel('Email').fill(email!);
      await signInForm(page).getByLabel('Password').fill(password!);
      await signInForm(page).getByRole('button', { name: 'Sign in' }).click();
      await signInForm(page).getByRole('alert').waitFor();
      expect(await signInForm(page).getByRole('alert').innerText()).toBe('That email and password don’t match an account. Check them and try again.');
    }
    expect(await page.locator('.app main#main.sign-in').count()).toBe(1);
    await page.context().close();
  });

  it('a returning account finds its plan after a reload, after closing and reopening the app, and on another device', async () => {
    const first = await open(DEV, at);
    await seed(first.page, contested());
    const plan = plan_(await onScreen(first.page));
    await first.page.reload();
    await loaded(first.page);
    expect(plan_(await onScreen(first.page))).toEqual(plan);
    // Close the app and open it again in the same browser: still signed in.
    const ctx = first.page.context();
    await first.page.close();
    const reopened = await ctx.newPage();
    await reopened.clock.setFixedTime(at);
    await reopened.goto(DEV);
    await loaded(reopened);
    expect(plan_(await onScreen(reopened))).toEqual(plan);
    // Another device: sign in, same plan, no setup to repeat.
    const other = await open(DEV, at, { as: first.account });
    await other.page.goto(`${DEV}#/dashboard`);
    await other.page.getByRole('heading', { name: 'Your cash flow' }).waitFor();
    expect(plan_(await onScreen(other.page))).toEqual(plan);
    await ctx.close();
    await other.page.context().close();
  });

  it.skipIf(!HAS_MAIL)('password recovery: the emailed link opens “Choose a new password”; the new one works and the old one doesn’t', async () => {
    const account = await newAccount();
    const { page } = await open(DEV, at, { signIn: false });
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    const form = page.getByRole('form', { name: 'Reset your password' });
    await form.getByLabel('Email').fill(account.email);
    const sentAt = new Date().toISOString();
    await form.getByRole('button', { name: 'Send the link' }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    const mail = await latestMail(account.email, sentAt);
    expect(subjectIs(mail, 'Reset your password')).toBe(true);
    await page.goto(mail.link);
    await page.getByRole('heading', { name: 'Choose a new password' }).waitFor();
    const fresh = 'a-brand-new-password-2';
    await page.getByRole('form', { name: 'Choose a password' }).getByLabel('New password').fill(fresh);
    await page.getByRole('button', { name: 'Save password' }).click();
    await loaded(page);
    await signOutUi(page);
    await signInForm(page).getByLabel('Email').fill(account.email);
    await signInForm(page).getByLabel('Password').fill(account.password);
    await signInForm(page).getByRole('button', { name: 'Sign in' }).click();
    expect(await signInForm(page).getByRole('alert').innerText()).toBe('That email and password don’t match an account. Check them and try again.');
    await signIn(page, account.email, fresh);
    await page.context().close();
  });

  it('session refresh: reopened after the access token expired, the app refreshes it and keeps working', async () => {
    const { page, saves } = await open(DEV, at);
    await seed(page, contested());
    const before = await sessionOf(page);
    await page.clock.setFixedTime(new Date(Date.now() + TWO_HOURS));
    await page.reload();
    await loaded(page);
    const after = await sessionOf(page);
    expect(after.access_token).not.toBe(before.access_token);
    expect(after.user.id).toBe(before.user.id);
    await payPhone(page);
    await saves.idle();
    expect(phoneRecord(await stored(page))!.actualAmountCents).toBe(15000);
    await page.context().close();
  });

  it('an expired session that can’t be refreshed: reopening shows sign-in, and no plan', async () => {
    const { page, account } = await open(DEV, at);
    await seed(page, contested());
    // Signed out everywhere (its refresh tokens revoked), and the access token has since expired.
    await revokeAll(page);
    await page.clock.setFixedTime(new Date(Date.now() + TWO_HOURS));
    await page.reload();
    await signInForm(page).waitFor();
    expect(await appText(page)).not.toContain('Phone');
    await signIn(page, account.email, account.password);
    expect(rentAmounts(await onScreen(page))).toEqual([150000]);
    await page.context().close();
  });

  it('the session expires while the app is open: the save is refused, the change stays, and signing in again saves it', async () => {
    const { page, account, saves } = await open(DEV, at);
    await seed(page, contested());
    const base = (await stored(page))!.revision;
    await revokeAll(page);
    await page.clock.setFixedTime(new Date(Date.now() + TWO_HOURS));
    await payPhone(page);
    const guard = page.getByRole('dialog', { name: 'Sign in again to save' });
    await guard.waitFor();
    expect(await guard.innerText()).toContain('Your session ended, so your latest changes aren’t saved yet. They’re still here.');
    expect(await guard.innerText()).toContain(account.email);
    expect(saves.log.at(-1)).toEqual(['update', base, 401]);
    // Wrong password: still here, still unsaved.
    await guard.getByLabel('Password').fill('not-the-password');
    await guard.getByRole('button', { name: 'Sign in and save' }).click();
    await guard.getByRole('alert').waitFor();
    await guard.getByLabel('Password').fill(account.password);
    await guard.getByRole('button', { name: 'Sign in and save' }).click();
    await guard.waitFor({ state: 'detached' });
    await saves.idle();
    const db = await stored(page);
    expect([db!.revision, phoneRecord(db)!.actualAmountCents]).toEqual([base + 1, 15000]);
    await page.context().close();
  });

  it('offline while signed in: the change is kept and marked not saved; back online, Try again saves it, still signed in', async () => {
    const { page, saves } = await open(DEV, at);
    await seed(page, contested());
    await page.context().setOffline(true);
    await payPhone(page);
    await statusBar(page).waitFor();
    expect(await statusBar(page).innerText()).toContain(OFFLINE);
    // Back online the app tries again by itself (the browser's online event); Try again is there too.
    await page.context().setOffline(false);
    await statusBar(page).getByRole('button', { name: 'Try again' }).click({ timeout: 2000 }).catch(() => undefined);
    await statusBar(page).waitFor({ state: 'detached' });
    await saves.idle();
    expect(phoneRecord(await stored(page))!.actualAmountCents).toBe(15000);
    expect(await signInForm(page).count()).toBe(0);
    await page.context().close();
  });

  it('signing out keeps the plan on the server, and warns first when a change isn’t saved', async () => {
    const { page, account, saves } = await open(DEV, at);
    await seed(page, contested());
    // An unsaved change (the save never arrives).
    await page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.abort('failed'));
    await payPhone(page);
    await statusBar(page).waitFor();
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign out?' });
    expect(await dialog.innerText()).toContain('Some of your changes aren’t saved yet.');
    expect(await dialog.getByRole('button', { name: 'Download a backup' }).count()).toBe(1);
    expect(await dialog.getByRole('button', { name: 'Sign out anyway' }).count()).toBe(1);
    // Save it from here instead.
    await page.unroute('**/rest/v1/rpc/save_plan');
    await dialog.getByRole('button', { name: 'Try saving again' }).click();
    await saves.idle();
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signInForm(page).waitFor();
    expect(await appText(page)).not.toContain('Phone');
    expect(await page.evaluate((k: string) => localStorage.getItem(k), AUTH_KEY)).toBeNull();
    // Still there for the next sign-in.
    await signIn(page, account.email, account.password);
    expect(phoneRecord(await onScreen(page))!.actualAmountCents).toBe(15000);
    await page.context().close();
  });

  it('switching accounts on one device never shows the previous account’s plan', async () => {
    const a = await newAccount();
    const b = await newAccount();
    const { page } = await open(DEV, at, { as: a });
    await seed(page, { ...contested(), sources: contested().sources.map((s) => (s.id === 'phone' ? { ...s, description: 'Alpha phone' } : s)) });
    await page.goto(`${DEV}#/expenses`);
    await page.getByText('Alpha phone').first().waitFor();
    await signOutUi(page);
    // Watch everything B's session renders, from sign-in to the loaded plan.
    const seen: string[] = [];
    const watch = setInterval(() => void appText(page).then((t: string) => seen.push(t)).catch(() => undefined), 20);
    await signIn(page, b.email, b.password);
    await page.waitForTimeout(500);
    clearInterval(watch);
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.filter((t) => t.includes('Alpha phone'))).toEqual([]);
    expect(await onScreen(page)).toMatchObject({ sources: [], records: [] });
    await page.context().close();
  });

  it('start over clears the plan and keeps the account', async () => {
    const { page, account } = await open(DEV, at);
    await seed(page, contested());
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('dialog', { name: 'Start over?' }).getByRole('button', { name: 'Erase and start over' }).click();
    await page.getByText('Your data was erased. Set up again whenever you’re ready.').waitFor();
    await signOutUi(page);
    await signIn(page, account.email, account.password);
    await page.getByRole('heading', { name: 'See your cash flow ahead of time' }).waitFor();
    expect(await stored(page)).toMatchObject({ onboardingComplete: false, sources: [], records: [] });
    await page.context().close();
  });

  it('deleting the account: explained, a backup offered, the password required; a wrong one deletes nothing; the right one deletes everything', async () => {
    const other = await open(DEV, at);
    await seed(other.page, contested());
    const otherPlan = await stored(other.page);
    const { page, account } = await open(DEV, at);
    await seed(page, richPlan());
    const oldToken = (await sessionOf(page)).access_token;
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
    expect(await dialog.innerText()).toContain('This permanently deletes your account and everything in your plan');
    expect(await dialog.innerText()).toContain('To only clear your plan and keep your account, use Start over instead.');
    expect(await dialog.getByRole('button', { name: 'Download a backup first' }).count()).toBe(1);
    const confirm = dialog.getByRole('button', { name: 'Delete account permanently' });
    expect(await confirm.isDisabled()).toBe(true);
    // A wrong password: nothing deleted.
    await dialog.getByLabel('Enter your password to confirm').fill('not-the-password');
    await confirm.click();
    await dialog.getByRole('alert').waitFor();
    expect(await dialog.getByRole('alert').innerText()).toBe('That password isn’t right. Nothing was deleted.');
    expect((await stored(page))!.sources).toHaveLength(8);
    // The right one.
    await dialog.getByLabel('Enter your password to confirm').fill(account.password);
    await confirm.click();
    await signInForm(page).waitFor();
    await page.getByText('Your account and everything in it were deleted.').waitFor();
    expect(await appText(page)).not.toContain('Paycheck');
    // Gone: the old token reaches nothing, and the account can't sign in.
    const stale = asUser(oldToken);
    expect((await stale.rpc('load_plan')).data).toBeNull();
    expect((await stale.from('sources').select('id')).data).toEqual([]);
    await signInForm(page).getByLabel('Email').fill(account.email);
    await signInForm(page).getByLabel('Password').fill(account.password);
    await signInForm(page).getByRole('button', { name: 'Sign in' }).click();
    expect(await signInForm(page).getByRole('alert').innerText()).toBe('That email and password don’t match an account. Check them and try again.');
    // Another account is untouched.
    expect(await stored(other.page)).toEqual(otherPlan);
    await page.context().close();
    await other.page.context().close();
  });

  it('deleting when the reply is lost after the server deleted: checked with the auth server, shown as deleted only then, signed out, nothing shown', async () => {
    const { page, account } = await open(DEV, at);
    await seed(page, contested());
    const oldToken = (await sessionOf(page)).access_token;
    await page.route(
      '**/rest/v1/rpc/delete_account',
      async (route: Any) => {
        await route.fetch();
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
    await dialog.getByLabel('Enter your password to confirm').fill(account.password);
    await dialog.getByRole('button', { name: 'Delete account permanently' }).click();
    await signInForm(page).waitFor();
    await page.getByText('Your account and everything in it were deleted.').waitFor();
    expect(await appText(page)).not.toContain('Phone');
    expect(await page.evaluate((k: string) => localStorage.getItem(k), AUTH_KEY)).toBeNull();
    expect((await asUser(oldToken).rpc('load_plan')).data).toBeNull();
    await page.context().close();
  });

  it('deleting when the request never reached the server: not shown as deleted, nothing deleted, and it isn’t retried by itself', async () => {
    const { page, account } = await open(DEV, at);
    await seed(page, contested());
    let attempts = 0;
    await page.route('**/rest/v1/rpc/delete_account', (route: Any) => {
      attempts++;
      return route.abort('failed');
    });
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
    await dialog.getByLabel('Enter your password to confirm').fill(account.password);
    await dialog.getByRole('button', { name: 'Delete account permanently' }).click();
    await dialog.getByRole('alert').waitFor();
    expect(await dialog.getByRole('alert').innerText()).toBe('Your account wasn’t deleted: the server didn’t answer. Try again.');
    expect(attempts).toBe(1);
    expect(phoneRecord(await stored(page))).toBeUndefined();
    expect((await stored(page))!.sources).toHaveLength(3);
    // A server error that never ran the deletion: also not shown as deleted.
    await page.unroute('**/rest/v1/rpc/delete_account');
    await page.route('**/rest/v1/rpc/delete_account', (route: Any) => route.fulfill({ status: 503, body: '{}' }), { times: 1 });
    await dialog.getByLabel('Enter your password to confirm').fill(account.password);
    await dialog.getByRole('button', { name: 'Delete account permanently' }).click();
    await expect.poll(async () => dialog.getByRole('alert').innerText()).toBe('Your account wasn’t deleted: the server didn’t answer. Try again.');
    expect((await stored(page))!.sources).toHaveLength(3);
    await page.context().close();
  });

  it('deleting is refused while a change isn’t saved', async () => {
    const { page } = await open(DEV, at);
    await seed(page, contested());
    await page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.abort('failed'));
    await payPhone(page);
    await statusBar(page).waitFor();
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
    expect(await dialog.innerText()).toContain('Some of your changes aren’t saved yet.');
    expect(await dialog.getByLabel('Enter your password to confirm').count()).toBe(0);
    expect(await dialog.getByRole('button', { name: 'Delete account permanently' }).isDisabled()).toBe(true);
    await page.context().close();
  });

  it.skipIf(!ANONYMOUS_ON || !HAS_MAIL)('a temporary identity from an earlier development build becomes an account, keeping the same identity and plan', async () => {
    // What the earlier build left in this browser: an anonymous session with a plan.
    const anon = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await anon.auth.signInAnonymously();
    const id = data.user!.id;
    const plan = contested();
    await anon.rpc('create_workspace');
    await anon.rpc('save_plan', { p_base_revision: 0, p_save_id: crypto.randomUUID(), p_mode: 'replace', p_plan: toRows(plan) });
    const { page } = await open(DEV, at, { signIn: false });
    await page.evaluate(([k, v]: string[]) => localStorage.setItem(k!, v!), [AUTH_KEY, JSON.stringify(data.session)]);
    await page.reload();
    await loaded(page);
    await page.goto(`${DEV}#/settings`);
    const keep = page.getByRole('form', { name: 'Keep this plan' });
    const email = `kept-${crypto.randomUUID()}@example.test`;
    await keep.getByLabel('Email').fill(email);
    await keep.getByRole('button', { name: 'Add email' }).click();
    await page.getByText(`We sent a link to ${email}.`).waitFor();
    await page.goto((await latestMail(email)).link);
    await page.getByRole('heading', { name: 'Choose a password' }).waitFor();
    const password = 'a-kept-password-3';
    await page.getByRole('form', { name: 'Choose a password' }).getByLabel('New password').fill(password);
    await page.getByRole('button', { name: 'Save password' }).click();
    await loaded(page);
    const s = await sessionOf(page);
    expect([s.user.id, s.user.email, s.user.is_anonymous]).toEqual([id, email, false]);
    // Recoverable: another device signs in with the email and password and finds the same plan.
    const device = await open(DEV, at, { as: { email, password } as Account });
    expect((await sessionOf(device.page)).user.id).toBe(id);
    expect(plan_(await onScreen(device.page))).toEqual(plan_(canonicalize(plan)));
    await page.context().close();
    await device.page.context().close();
  });
});

/** Another tab in the same browser (it shares the browser's Supabase session). */
async function newTab(page: Any, at: Date) {
  const tab = await page.context().newPage();
  tab.setDefaultTimeout(15000);
  await tab.clock.setFixedTime(at);
  const saves = track(tab);
  await tab.goto(DEV);
  await loaded(tab);
  return { page: tab, saves };
}
/** In `tab`: sign out of whoever is signed in, then sign in as `account`. */
async function switchTo(tab: Any, account: Account) {
  await signOutUi(tab);
  await signIn(tab, account.email, account.password);
}
/** A plan saved for an account through the API (setup for the cross-tab tests). */
async function seedAccount(account: Account, data: AppData, times = 1) {
  const api = asUser(account.session.access_token);
  await api.rpc('create_workspace');
  for (let i = 0; i < times; i++) {
    const current = (await api.rpc('load_plan')).data as LoadedPlan;
    const { error } = await api.rpc('save_plan', { p_base_revision: current.revision, p_save_id: crypto.randomUUID(), p_mode: 'replace', p_plan: toRows(data) });
    if (error) throw new Error(error.message);
  }
}
const planOf = async (account: Account) => fromRows((await asUser(account.session.access_token).rpc('load_plan')).data as LoadedPlan);
const recoveryPanel = (page: Any) => page.getByRole('region', { name: 'Unsaved changes from another account' });
async function unlock(page: Any, account: Account, password = account.password) {
  const panel = recoveryPanel(page);
  await panel.getByLabel(`Password for ${account.email}`).fill(password);
  await panel.getByRole('button', { name: 'Unlock' }).click();
}
/** Holds the next save_plan request in this tab until `release()`; it then goes out as it was (same token). */
async function holdNextSave(page: Any) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let held!: () => void;
  const arrived = new Promise<void>((r) => (held = r));
  await page.route(
    '**/rest/v1/rpc/save_plan',
    async (route: Any) => {
      held();
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  return { arrived, release: () => release() };
}
const emptyPlan = (): AppData => ({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });

describe('two tabs on one device', () => {
  const at = new Date(2026, 9, 16, 9, 0);

  it('the same account in two tabs: both show it, a change in one is there in the other after reload, nothing set aside', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const tab2 = await newTab(a.page, at);
    expect((await sessionOf(tab2.page)).user.id).toBe((await sessionOf(a.page)).user.id);
    await payPhone(a.page);
    await a.saves.idle();
    await tab2.page.reload();
    await loaded(tab2.page);
    expect(phoneRecord(await onScreen(tab2.page))!.actualAmountCents).toBe(15000);
    expect(await recoveryPanel(a.page).count()).toBe(0);
    await a.page.context().close();
  });

  it('another account signs in in the other tab with nothing unsaved: this tab follows it, never showing the first plan, and nothing is set aside', async () => {
    const a = await open(DEV, at);
    await seed(a.page, { ...contested(), sources: contested().sources.map((x) => (x.id === 'phone' ? { ...x, description: 'Alpha phone' } : x)) });
    await a.page.goto(`${DEV}#/expenses`);
    await a.page.getByText('Alpha phone').first().waitFor();
    const b = await newAccount();
    await seedAccount(b, contested());
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    // This tab now shows B's plan (the browser has one session), and never A's.
    await expect.poll(async () => (await sessionOf(a.page)).user.id).toBe(b.userId);
    // This tab follows the other tab's sign-in on its own schedule: wait until it shows B's app, then look.
    await a.page.getByRole('region', { name: 'Needs attention' }).waitFor();
    await loaded(a.page);
    await a.page.goto(`${DEV}#/expenses`);
    await a.page.getByRole('heading', { name: 'Phone' }).waitFor();
    expect(await appText(a.page)).not.toContain('Alpha phone');
    expect(await recoveryPanel(a.page).count()).toBe(0);
    // Tab A leaving A's ended session never signs out B, who is signed in now.
    await a.page.waitForTimeout(500);
    expect((await sessionOf(tab2.page)).user.id).toBe(b.userId);
    expect(await signInForm(tab2.page).count()).toBe(0);
    await a.page.context().close();
  });

  it('an unsaved change (the server failed) when another account signs in: set aside for its own account, unlocked by its password, saved there; the new account untouched', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await seedAccount(b, contested());
    const bBefore = await planOf(b);
    await a.page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.fulfill({ status: 503, body: '{}' }));
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    // Tab A: B's app, with A's change set aside and locked.
    const panel = recoveryPanel(a.page);
    await panel.waitFor();
    expect(await panel.innerText()).toContain(`Changes made as ${a.account.email} weren’t saved`);
    expect(await panel.getByRole('button', { name: /^Save them/ }).count()).toBe(0);
    expect(await panel.getByRole('button', { name: 'Download them' }).count()).toBe(0);
    await a.page.unroute('**/rest/v1/rpc/save_plan');
    // B's plan never received A's change.
    expect(await planOf(b)).toEqual(bBefore);
    // A wrong password doesn't unlock it.
    await unlock(a.page, a.account, 'not-the-password');
    await panel.getByRole('alert').waitFor();
    expect(await panel.getByRole('button', { name: /^Save them/ }).count()).toBe(0);
    await unlock(a.page, a.account);
    await panel.getByRole('button', { name: `Save them to ${a.account.email}’s account` }).click();
    await a.page.getByText(`Saved to ${a.account.email}’s account.`).waitFor();
    expect(phoneRecord(await planOf(a.account))!.actualAmountCents).toBe(15000);
    expect(await planOf(b)).toEqual(bBefore);
    // This tab stayed signed in as B throughout.
    expect((await sessionOf(a.page)).user.id).toBe(b.userId);
    await a.page.context().close();
  });

  it('after a network failure: set aside, and it can be downloaded once unlocked', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await a.page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.abort('failed'));
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    await recoveryPanel(a.page).waitFor();
    await unlock(a.page, a.account);
    const [download] = await Promise.all([a.page.waitForEvent('download'), recoveryPanel(a.page).getByRole('button', { name: 'Download them' }).click()]);
    const file = readBackup(readFileSync(await download.path(), 'utf8'));
    expect(phoneRecord(file.data)!.actualAmountCents).toBe(15000);
    // Downloading isn't saving: the panel still says so.
    expect(await recoveryPanel(a.page).innerText()).toContain('weren’t saved');
    expect(phoneRecord(await planOf(a.account))).toBeUndefined();
    await a.page.context().close();
  });

  it('a save in flight when another account signs in: it lands in its own account, and the set-aside copy recognizes it’s already saved', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await seedAccount(b, contested());
    const bBefore = await planOf(b);
    const hold = await holdNextSave(a.page);
    await payPhone(a.page);
    await hold.arrived;
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    await recoveryPanel(a.page).waitFor();
    hold.release();
    await a.saves.idle();
    expect(phoneRecord(await planOf(a.account))!.actualAmountCents).toBe(15000);
    expect(await planOf(b)).toEqual(bBefore);
    await unlock(a.page, a.account);
    await recoveryPanel(a.page).getByRole('button', { name: `Save them to ${a.account.email}’s account` }).click();
    await a.page.getByText(`These changes are already saved in ${a.account.email}’s account.`).waitFor();
    await a.page.context().close();
  });

  it('the previous account’s changes are never saved into the new account, even when a save was queued as the account changed', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    // B's plan is empty, at the revision A's next save will be based on: the case where a misdirected save would be accepted.
    const b = await newAccount();
    await seedAccount(b, emptyPlan(), 2);
    const bBefore = await planOf(b);
    expect(bBefore.revision).toBe(2);
    // A's first change is held in flight; a second one waits behind it.
    const hold = await holdNextSave(a.page);
    await payPhone(a.page);
    await hold.arrived;
    await changeRent(a.page, '1600');
    // B signs in in the other tab; then A's first save completes and the queued one would follow.
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    hold.release();
    await a.saves.idle();
    await recoveryPanel(a.page).waitFor();
    expect(await planOf(b)).toEqual(bBefore);
    // A's account has the first change (sent before the switch, with A's session); the second is set aside, not lost.
    const aPlan = await planOf(a.account);
    expect([phoneRecord(aPlan)!.actualAmountCents, rentVersions(aPlan)]).toEqual([15000, rentVersions(contested())]);
    expect(a.saves.log).toEqual([['update', 1, 200]]);
    await unlock(a.page, a.account);
    // A's plan moved on since those edits began (its first change landed), so they aren't written over it; they can be downloaded.
    await recoveryPanel(a.page).getByRole('button', { name: `Save them to ${a.account.email}’s account` }).click();
    await a.page.getByText(`${a.account.email}’s plan changed since these edits, so they weren’t saved over it. Download them to compare.`).waitFor();
    const [download] = await Promise.all([a.page.waitForEvent('download'), recoveryPanel(a.page).getByRole('button', { name: 'Download them' }).click()]);
    const kept = readBackup(readFileSync(await download.path(), 'utf8')).data;
    expect([phoneRecord(kept)!.actualAmountCents, rentVersions(kept)]).toEqual([15000, rentVersions(contested()) + 1]);
    expect(await planOf(b)).toEqual(bBefore);
    await a.page.context().close();
  });

  it('a set-aside change is refused when its account changed since, rather than written over the newer plan', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await a.page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.abort('failed'));
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    await recoveryPanel(a.page).waitFor();
    // Meanwhile A's plan changes on another device.
    const elsewhere = await planOf(a.account);
    const { error } = await asUser(a.account.session.access_token).rpc('save_plan', { p_base_revision: elsewhere.revision, p_save_id: crypto.randomUUID(), p_mode: 'update', p_plan: toRows(elsewhere) });
    expect(error).toBeNull();
    const newer = await planOf(a.account);
    await unlock(a.page, a.account);
    await recoveryPanel(a.page).getByRole('button', { name: `Save them to ${a.account.email}’s account` }).click();
    await a.page.getByText(`${a.account.email}’s plan changed since these edits, so they weren’t saved over it. Download them to compare.`).waitFor();
    expect(await planOf(a.account)).toEqual(newer);
    expect(await recoveryPanel(a.page).getByRole('button', { name: 'Download them' }).count()).toBe(1);
    await a.page.context().close();
  });

  it('the set-aside change can’t be dismissed by accident, and leaving the page warns', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await a.page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.abort('failed'));
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    const panel = recoveryPanel(a.page);
    await panel.waitFor();
    expect(await panel.getByRole('button', { name: /close/i }).count()).toBe(0);
    await panel.getByRole('button', { name: 'Discard them' }).click();
    await panel.getByRole('button', { name: 'Keep them' }).click();
    expect(await panel.innerText()).toContain('weren’t saved');
    const dialog = new Promise<Any>((resolve) => a.page.once('dialog', resolve));
    await a.page.close({ runBeforeUnload: true });
    const prompt = await dialog;
    expect(prompt.type()).toBe('beforeunload');
    await prompt.dismiss();
    // Discarding takes a second, explicit step.
    await panel.getByRole('button', { name: 'Discard them' }).click();
    await panel.getByRole('button', { name: 'Discard for good' }).click();
    await panel.waitFor({ state: 'detached' });
    expect(phoneRecord(await planOf(a.account))).toBeUndefined();
    await a.page.context().close();
  });

  it('signing out and back in after all this: each account’s confirmed plan is intact', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    await payPhone(a.page);
    await a.saves.idle();
    const b = await newAccount();
    await seedAccount(b, contested());
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    await switchTo(tab2.page, a.account);
    expect(phoneRecord(await onScreen(tab2.page))!.actualAmountCents).toBe(15000);
    expect(phoneRecord(await planOf(b))).toBeUndefined();
    await a.page.context().close();
  });
});

/** A held request in this tab: released, it goes out as it was; failed, it never reaches the server. */
async function holdNext(page: Any, pattern: string) {
  let decide!: (go: boolean) => void;
  const decision = new Promise<boolean>((r) => (decide = r));
  let held!: () => void;
  const arrived = new Promise<void>((r) => (held = r));
  await page.route(
    pattern,
    async (route: Any) => {
      held();
      if (await decision) await route.continue();
      else await route.abort('failed');
    },
    { times: 1 },
  );
  return { arrived, release: () => decide(true), fail: () => decide(false) };
}
/** Storage keys other than the browser's shared session and this app's own settings. */
const otherAuthKeys = (page: Any) =>
  page.evaluate((k: string) => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((x) => x !== k && /auth|token|supabase|sb-/i.test(x)), AUTH_KEY);

describe('two tabs: requests, recovery and pending restores', () => {
  const at = new Date(2026, 9, 16, 9, 0);

  it('a queued save that must first refresh the session, after another account signed in, is stopped before it is sent', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await seedAccount(b, emptyPlan(), 2);
    const bBefore = await planOf(b);
    const hold = await holdNextSave(a.page);
    await payPhone(a.page);
    await hold.arrived;
    await a.page.goto(`${DEV}#/settings`);
    await a.page.getByRole('radio', { name: /^Off/ }).focus();
    await a.page.keyboard.press('ArrowDown');
    // Tab A's clock passes its token's expiry, so its next request refreshes first: with the browser's (now B's) session.
    await a.page.clock.setFixedTime(new Date(Date.now() + TWO_HOURS));
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    hold.release();
    await a.saves.idle();
    await recoveryPanel(a.page).waitFor();
    // Only A's first save reached the server; nothing was sent with B's session.
    expect(a.saves.log).toEqual([['update', 1, 200]]);
    expect(await planOf(b)).toEqual(bBefore);
    // A retry trigger afterwards (the browser coming back online) sends nothing either.
    await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await a.saves.idle();
    expect(a.saves.log).toEqual([['update', 1, 200]]);
    expect(await planOf(b)).toEqual(bBefore);
    await a.page.context().close();
  });

  it('checking the password for a set-aside change leaves the browser’s session alone, keeps nothing in storage, and shows no financial details before', async () => {
    const a = await open(DEV, at);
    await seed(a.page, { ...contested(), sources: contested().sources.map((x) => (x.id === 'phone' ? { ...x, description: 'Alpha phone' } : x)) });
    const b = await newAccount();
    await a.page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.abort('failed'));
    await payPhone(a.page);
    await statusBar(a.page).waitFor();
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    const panel = recoveryPanel(a.page);
    await panel.waitFor();
    const locked = await panel.innerText();
    expect(locked).toContain(a.account.email);
    for (const detail of ['Alpha phone', 'Phone', 'Rent', 'Paycheck', '$', '150']) expect([detail, locked.includes(detail)]).toEqual([detail, false]);
    expect(await appText(a.page)).not.toContain('Alpha phone');
    const sharedBefore = await a.page.evaluate((k: string) => localStorage.getItem(k), AUTH_KEY);
    await unlock(a.page, a.account);
    await panel.getByRole('button', { name: 'Download them' }).waitFor();
    // The browser's session is still B's, unchanged, in both tabs; the check left no session anywhere in storage.
    expect(await a.page.evaluate((k: string) => localStorage.getItem(k), AUTH_KEY)).toBe(sharedBefore);
    expect((await sessionOf(a.page)).user.id).toBe(b.userId);
    expect((await sessionOf(tab2.page)).user.id).toBe(b.userId);
    expect(await otherAuthKeys(a.page)).toEqual([]);
    await tab2.page.reload();
    await loaded(tab2.page);
    expect((await sessionOf(tab2.page)).user.id).toBe(b.userId);
    // Discarded: gone from the page.
    await panel.getByRole('button', { name: 'Discard them' }).click();
    await panel.getByRole('button', { name: 'Discard for good' }).click();
    await panel.waitFor({ state: 'detached' });
    expect(await appText(a.page)).not.toContain('Alpha phone');
    await a.page.context().close();
  });

  it('the set-aside download is exactly the unsaved plan as it was on screen', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await a.page.route('**/rest/v1/rpc/save_plan', (route: Any) => route.abort('failed'));
    await payPhone(a.page);
    await changeRent(a.page, '1,650');
    await statusBar(a.page).waitFor();
    const asShown = await onScreen(a.page);
    expect([phoneRecord(asShown)!.actualAmountCents, rentAmounts(asShown)]).toEqual([15000, [150000, 165000]]);
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    await recoveryPanel(a.page).waitFor();
    await unlock(a.page, a.account);
    const [download] = await Promise.all([a.page.waitForEvent('download'), recoveryPanel(a.page).getByRole('button', { name: 'Download them' }).click()]);
    expect(plan_(readBackup(readFileSync(await download.path(), 'utf8')).data)).toEqual(plan_(asShown));
    await a.page.context().close();
  });

  it('a restore waiting for the server when another account signs in: applied for its own account, reported as possibly applied, then confirmed', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await seedAccount(b, contested());
    const bBefore = await planOf(b);
    const household = householdBackup();
    const hold = await holdNext(a.page, '**/rest/v1/rpc/save_plan');
    const dialog = await restore(a.page, household.path);
    await hold.arrived;
    expect(await dialog.getByRole('button', { name: 'Restoring…' }).isDisabled()).toBe(true);
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    const panel = recoveryPanel(a.page);
    await panel.waitFor();
    hold.release();
    await a.saves.idle();
    expect(await panel.innerText()).toContain(`A restore of a backup for ${a.account.email} was waiting for the server’s answer when another account signed in on this device. It may or may not have been applied.`);
    expect(await a.page.getByText('Backup restored.').count()).toBe(0);
    expect(a.saves.log).toEqual([['replace', 1, 200]]);
    await unlock(a.page, a.account);
    await panel.getByRole('button', { name: `Check and finish the restore in ${a.account.email}’s account` }).click();
    await a.page.getByText(`The restore was applied to ${a.account.email}’s account.`).waitFor();
    expect(plan_(await planOf(a.account))).toEqual(plan_(canonicalize(household.data)));
    expect(await planOf(b)).toEqual(bBefore);
    await a.page.context().close();
  });

  it('a restore that never reached the server when another account signed in: not applied, and finished only when the person chooses, as its own account', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const aBefore = await planOf(a.account);
    const b = await newAccount();
    const household = householdBackup();
    const hold = await holdNext(a.page, '**/rest/v1/rpc/save_plan');
    await restore(a.page, household.path);
    await hold.arrived;
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    await recoveryPanel(a.page).waitFor();
    hold.fail();
    await a.saves.idle();
    // Not sent again by itself, under any account.
    expect(a.saves.log).toEqual([['replace', 1, 'failed']]);
    expect(await planOf(a.account)).toEqual(aBefore);
    expect(phoneRecord(await planOf(b))).toBeUndefined();
    await unlock(a.page, a.account);
    await recoveryPanel(a.page).getByRole('button', { name: `Check and finish the restore in ${a.account.email}’s account` }).click();
    await a.page.getByText(`Restored in ${a.account.email}’s account.`).waitFor();
    expect(plan_(await planOf(a.account))).toEqual(plan_(canonicalize(household.data)));
    expect((await planOf(b)).sources).toEqual([]);
    await a.page.context().close();
  });

  it('starting over waiting for the server when another account signs in: applied for its own account and confirmed; another account’s plan untouched', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await newAccount();
    await seedAccount(b, contested());
    const bBefore = await planOf(b);
    const hold = await holdNext(a.page, '**/rest/v1/rpc/save_plan');
    await a.page.goto(`${DEV}#/settings`);
    await a.page.getByRole('button', { name: 'Start over' }).click();
    await a.page.getByRole('dialog', { name: 'Start over?' }).getByRole('button', { name: 'Erase and start over' }).click();
    await hold.arrived;
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    const panel = recoveryPanel(a.page);
    await panel.waitFor();
    hold.release();
    await a.saves.idle();
    expect(await panel.innerText()).toContain(`Starting over (erasing the plan) for ${a.account.email} was waiting for the server’s answer`);
    expect(await panel.getByRole('button', { name: /^Download/ }).count()).toBe(0);
    await unlock(a.page, a.account);
    await panel.getByRole('button', { name: `Check and finish starting over in ${a.account.email}’s account` }).click();
    await a.page.getByText(`${a.account.email}’s plan was erased: starting over was applied.`).waitFor();
    expect(await planOf(a.account)).toMatchObject({ onboardingComplete: false, sources: [], records: [] });
    expect(await planOf(b)).toEqual(bBefore);
    await a.page.context().close();
  });

  it('a restore the database refuses, then another account signs in: still refused when finished, and the plan is unchanged', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const aBefore = await planOf(a.account);
    const b = await newAccount();
    const bad = { ...contested(), records: [{ ...contested().records[0]!, id: 'rent@2026-10-02' }] } as AppData;
    const dialog = await restore(a.page, backupFile('refused-2.json', bad));
    await dialog.getByRole('alert').waitFor();
    const tab2 = await newTab(a.page, at);
    await switchTo(tab2.page, b);
    await recoveryPanel(a.page).waitFor();
    await unlock(a.page, a.account);
    await recoveryPanel(a.page).getByRole('button', { name: `Check and finish the restore in ${a.account.email}’s account` }).click();
    await recoveryPanel(a.page).getByRole('alert').waitFor();
    expect(await recoveryPanel(a.page).getByRole('alert').innerText()).toMatch(/^That wasn’t saved: /);
    expect(await planOf(a.account)).toEqual(aBefore);
    await a.page.context().close();
  });

  it('one account: a restore whose reply is lost after it was applied is reported as unconfirmed, never as failed; Try again confirms it, and Cancel shows what is saved', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const household = householdBackup();
    await loseNextReply(a.page);
    const dialog = await restore(a.page, household.path);
    await dialog.getByRole('alert').waitFor();
    expect(await dialog.getByRole('alert').innerText()).toBe('The restore hasn’t been confirmed. Couldn’t reach the server, so this change isn’t confirmed yet. Check your connection and try again.');
    expect(plan_(await planOf(a.account))).toEqual(plan_(canonicalize(household.data)));
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await a.page.getByText('Backup restored.').waitFor();
    expect(a.saves.ids[0]).toBe(a.saves.ids[1]);
    // And with Cancel instead: the app shows what the server holds.
    const second = await open(DEV, at);
    await seed(second.page, contested());
    await loseNextReply(second.page);
    const d2 = await restore(second.page, household.path);
    await d2.getByRole('alert').waitFor();
    await d2.getByRole('button', { name: 'Cancel' }).click();
    await loaded(second.page);
    expect(plan_(await onScreen(second.page))).toEqual(plan_(canonicalize(household.data)));
    await a.page.context().close();
    await second.page.context().close();
  });

  it('deleting when neither the reply nor the check with the auth server arrives: shown as uncertain and signed out, never as deleted or not deleted', async () => {
    const { page, account } = await open(DEV, at);
    await seed(page, contested());
    await page.route('**/rest/v1/rpc/delete_account', (route: Any) => route.abort('failed'), { times: 1 });
    await page.route('**/auth/v1/user', (route: Any) => route.abort('failed'));
    await page.goto(`${DEV}#/settings`);
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
    await dialog.getByLabel('Enter your password to confirm').fill(account.password);
    await dialog.getByRole('button', { name: 'Delete account permanently' }).click();
    await signInForm(page).waitFor();
    await page.getByText('We couldn’t confirm whether your account was deleted, so you’ve been signed out. Sign in again to check: if it was deleted, the sign-in won’t find it.').waitFor();
    expect(await appText(page)).not.toContain('Phone');
    await page.unroute('**/auth/v1/user');
    // It wasn't (the request never arrived): signing in finds the account and its plan.
    await signIn(page, account.email, account.password);
    expect(rentAmounts(await onScreen(page))).toEqual([150000]);
    await page.context().close();
  });
});

/** Signs this page's account out everywhere: its refresh tokens stop working (its access token runs until it expires). */
async function revokeAll(page: Any) {
  const { access_token } = await sessionOf(page);
  const res = await fetch(`${URL}/auth/v1/logout?scope=global`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${access_token}` } });
  expect(res.status).toBe(204);
}

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

const rentVersions = (d: AppData) => d.sources.find((s) => s.id === 'rent')!.versions.length;

async function payPhone(page: Any, dollars = '150') {
  await page.goto(`${DEV}#/home`);
  await page.getByRole('region', { name: 'Needs attention' }).locator('.entry').first().click();
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

describe('two devices signed in to one account, and saves that go wrong', () => {
  const at = new Date(2026, 9, 16, 9, 0);

  it('both on the same revision: the second save is a conflict, shown as not saved, and nothing is silently lost', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const b = await open(DEV, at, { as: a.account });
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
    const b = await open(DEV, at, { as: a.account });
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

  it('the API refuses the session’s token: the change stays on screen, marked not saved, and saves once the token is accepted', async () => {
    const a = await open(DEV, at);
    await seed(a.page, contested());
    const base = (await stored(a.page))!.revision;
    // The real API refusing a token it can't verify (a real expiry, with the app's own handling, is tested under accounts).
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
    expect(db.onboardingComplete).toBe(true);
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
