import { beforeEach, describe, expect, it } from 'vitest';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
import { accountBalance } from '../../domain/balances';
import { buildForecast, dailyTimeline } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { CloudAdapter } from '../cloud';
import { LocalStorageAdapter, migrate, STORAGE_KEY } from '../storage';
import { checkForMigration, hasAccountData, toRows } from '../supabase/rows';
import { SupabaseStorageAdapter } from '../supabase/adapter';
import { FakeSupabase } from '../supabase/__tests__/fake-supabase';
import { FakeServer } from './fake-server';

const TODAY = '2026-10-11';
const clock = { today: TODAY, now: '2026-10-11T12:00:00.000Z' };

/** A plan with one account of each type, a payment account for spending, items assigned to them, balances and transfers. */
function plan(): AppData {
  let d = ops.emptyData();
  d = source(d, TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');
  d = source(d, TODAY, 'reserve', 'Reserves', 100, '2026-10-16', { type: 'biweekly' }, 'save');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Car repair', amountCents: usd(700), date: '2026-10-31' }, clock, 'repair'));
  d = unwrap(ops.addAccount(d, { name: 'Paycheck account', type: 'income' }, clock, 'acct-income'));
  d = unwrap(ops.addAccount(d, { name: 'Reserves account', type: 'distribution' }, clock, 'acct-reserves'));
  d = unwrap(ops.addAccount(d, { name: 'Bills', type: 'payment' }, clock, 'acct-bills'));
  d = unwrap(ops.addAccount(d, { name: 'Everyday', type: 'payment' }, clock, 'acct-everyday'));
  d = unwrap(ops.assignAccount(d, 'pay', 'acct-income', clock));
  d = unwrap(ops.assignAccount(d, 'rent', 'acct-bills', clock));
  d = unwrap(ops.assignAccount(d, 'save', 'acct-reserves', clock));
  d = unwrap(ops.assignAccount(d, 'repair', 'acct-everyday', clock));
  d = unwrap(ops.setOpeningBalance(d, 'acct-income', { amountCents: usd(250), date: '2026-10-10' }, clock));
  d = unwrap(ops.setOpeningBalance(d, 'acct-bills', { amountCents: usd(-40), date: '2026-10-10' }, clock));
  d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Toward the repair', amountCents: usd(300), date: '2026-10-31', release: true }, clock, 'use'));
  d = unwrap(ops.addTransfer(d, { fromAccountId: 'acct-income', toAccountId: 'acct-bills', amountCents: usd(1200), date: TODAY }, 'recorded', clock, 'xfer-rent'));
  d = unwrap(ops.addTransfer(d, { fromAccountId: 'acct-income', toAccountId: 'acct-reserves', amountCents: usd(100), date: '2026-10-16' }, 'expected', clock, 'xfer-save'));
  return d;
}

beforeEach(() => localStorage.clear());

describe('device storage and backups', () => {
  it('saves and restores accounts, their types, balances, transfers and every assignment exactly', async () => {
    const d = plan();
    const adapter = new LocalStorageAdapter();
    expect(await adapter.save(d, 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await adapter.load();
    expect(loaded).toEqual({ ...d, revision: 1 });
    expect(loaded.accounts!.map((a) => [a.id, a.type])).toEqual([
      ['acct-income', 'income'],
      ['acct-reserves', 'distribution'],
      ['acct-bills', 'payment'],
      ['acct-everyday', 'payment'],
    ]);
  });

  it('a backup round trip keeps accounts and assignments, and the forecast is the same', () => {
    const d = plan();
    const parsed = readBackup(createBackup(d, new Date('2026-10-11T12:00:00Z')).text);
    expect(parsed.data.accounts).toEqual(d.accounts);
    expect(parsed.data.sources).toEqual(d.sources);
    expect(parsed.data.records).toEqual(d.records);
    expect(parsed.data.transfers).toEqual(d.transfers);
    expect(accountBalance(parsed.data, 'acct-income', TODAY, TODAY)).toEqual(accountBalance(d, 'acct-income', TODAY, TODAY));
    const days = (x: AppData) => dailyTimeline(buildForecast(x, TODAY), '2026-10-01', '2026-11-30').map((r) => [r.date, r.netCents, r.tallyCents]);
    expect(days(parsed.data)).toEqual(days(d));
  });

  it('data saved before accounts existed loads unchanged, with no accounts', () => {
    let old = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    old = unwrap(ops.addOneTime(old, { kind: 'varied', description: 'Car repair', amountCents: usd(700), date: '2026-10-31' }, clock, 'repair'));
    const loaded = migrate(JSON.parse(JSON.stringify(old)));
    expect(loaded).toEqual(old);
    expect('accounts' in loaded).toBe(false);
  });

  it('drops malformed accounts and any assignment that points at a missing or unsuitable account, keeping every item', () => {
    const raw = JSON.parse(JSON.stringify(plan()));
    raw.accounts.push({ id: 'acct-bad-type', name: 'Odd', type: 'reserve' }, { id: 'acct-income', name: 'Duplicate id', type: 'payment' }, { id: 'acct-no-name', name: '  ', type: 'payment' }, 'not an account');
    raw.sources.find((s: { id: string }) => s.id === 'rent').accountId = 'acct-missing';
    raw.sources.find((s: { id: string }) => s.id === 'pay').accountId = 'acct-bills'; // income in a payment account
    raw.records.find((r: { id: string }) => r.id === 'repair').accountId = 42;
    // A recurring occurrence's record never carries an account of its own.
    raw.records.push({ ...raw.records[0], id: 'rent@2026-10-20', sourceId: 'rent', kind: 'bill', description: 'Rent', expectedDate: '2026-10-20', scheduledDate: '2026-10-20', accountId: 'acct-bills' });
    const loaded = migrate(raw);
    expect(loaded.accounts!.map((a) => a.id)).toEqual(['acct-income', 'acct-reserves', 'acct-bills', 'acct-everyday']);
    expect(Object.fromEntries(loaded.sources.map((s) => [s.id, s.accountId ?? null]))).toEqual({ pay: null, rent: null, save: 'acct-reserves' });
    expect(loaded.records.map((r) => [r.id, r.accountId ?? null])).toEqual([
      ['repair', null],
      ['use', null],
      ['rent@2026-10-20', null],
    ]);
    expect(loaded.sources.map((s) => s.id)).toEqual(['pay', 'rent', 'save']);
  });

  it('keeps a transfer whole or not at all: both accounts must exist and differ, with a positive amount and a known status', () => {
    const raw = JSON.parse(JSON.stringify(plan()));
    const ok = raw.transfers[0];
    raw.transfers.push(
      { ...ok, id: 'to-missing', toAccountId: 'acct-gone' },
      { ...ok, id: 'same', toAccountId: ok.fromAccountId },
      { ...ok, id: 'zero', amountCents: 0 },
      { ...ok, id: 'half-cent', amountCents: 10.5 },
      { ...ok, id: 'bad-date', date: '2026-13-01' },
      { ...ok, id: 'done', status: 'completed' },
      { ...ok }, // a repeated id
      null,
    );
    raw.accounts[0].opening = { amountCents: 'lots', date: '2026-10-10' };
    raw.accounts[1].opening = { amountCents: Number.MAX_SAFE_INTEGER, date: '2026-10-10' }; // beyond what the app allows
    const loaded = migrate(raw);
    expect(loaded.transfers!.map((t) => t.id)).toEqual(['xfer-rent', 'xfer-save']);
    // A malformed opening balance makes the balance unknown, never wrong.
    expect('opening' in loaded.accounts![0]!).toBe(false);
    expect('opening' in loaded.accounts![1]!).toBe(false);
    expect(loaded.accounts!.find((a) => a.id === 'acct-bills')!.opening).toEqual({ amountCents: usd(-40), date: '2026-10-10' });
  });

  it('keeps the account a recorded occurrence was paid from, and drops one on an outstanding occurrence', () => {
    let d = plan();
    d = unwrap(ops.recordActual(d, 'rent@2026-10-20', { amountCents: usd(1200), date: TODAY }, clock));
    const loaded = migrate(JSON.parse(JSON.stringify(d)));
    expect(loaded.records.find((r) => r.id === 'rent@2026-10-20')).toMatchObject({ status: 'completed', accountId: 'acct-bills' });
  });

  it('drops transfers whose account was dropped, never keeping one side', () => {
    const raw = JSON.parse(JSON.stringify(plan()));
    raw.accounts = raw.accounts.filter((a: { id: string }) => a.id !== 'acct-reserves');
    expect(migrate(raw).transfers!.map((t) => t.id)).toEqual(['xfer-rent']);
  });

  it('a stored document with accounts survives a reload through localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...plan(), revision: 3 }));
    const loaded = await new LocalStorageAdapter().load();
    expect(loaded.accounts).toHaveLength(4);
    expect(loaded.sources.find((s) => s.id === 'rent')!.accountId).toBe('acct-bills');
  });
});

describe("storage that can't keep accounts yet", () => {
  it('signed in with Firebase: saves leave accounts, assignments and transfers out, so the rules never refuse them', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage);
    await adapter.load();
    expect(await adapter.save(plan(), 0)).toEqual({ ok: true, revision: 1 });
    const stored = server.row!.data;
    expect('accounts' in stored).toBe(false);
    expect(stored.sources.every((s) => !('accountId' in s))).toBe(true);
    expect(stored.records.every((r) => !('accountId' in r))).toBe(true);
    // Everything financial is saved.
    expect(stored.sources.map((s) => s.id)).toEqual(['pay', 'rent', 'save']);
    expect(stored.records.map((r) => r.id)).toEqual(['repair', 'use']);
    expect('transfers' in stored).toBe(false);
    // A release is an ordinary record field, so it is kept: dropping it would turn money taken out of reserves into money set aside.
    expect(stored.records.find((r) => r.id === 'use')!.release).toBe(true);
  });

  it('Supabase: a plan with accounts, transfers or releases is refused, never saved without them', async () => {
    const fake = new FakeSupabase();
    const adapter = new SupabaseStorageAdapter(fake, () => 'save-1');
    await adapter.load();
    expect(await adapter.save(plan(), 0)).toEqual({ ok: false, reason: 'error', message: "This plan has accounts, transfers or reserve releases, which can't be saved to this storage yet. Nothing was saved." });
    expect(fake.calls.filter((c) => c.fn === 'save_plan')).toHaveLength(0);
    expect(hasAccountData(plan())).toBe(true);
    expect(checkForMigration(plan()).filter((i) => i.level === 'error').map((i) => i.message)).toEqual(["Accounts, account assignments, transfers and reserve releases can't be stored in Supabase yet."]);
    // A plan without accounts saves as before.
    const { accounts: _a, transfers: _t, ...withoutList } = plan();
    const plain: AppData = { ...withoutList, sources: withoutList.sources.map(({ accountId: _x, ...s }) => s), records: withoutList.records.filter((r) => !r.release).map(({ accountId: _x, ...r }) => r) };
    expect(hasAccountData(plain)).toBe(false);
    expect(toRows(plain).sources).toHaveLength(3);
    // Each one alone is refused.
    expect(hasAccountData({ ...plain, transfers: plan().transfers })).toBe(true);
    expect(hasAccountData({ ...plain, records: plan().records.filter((r) => r.release).map(({ accountId: _x, ...r }) => r) })).toBe(true);
  });
});
