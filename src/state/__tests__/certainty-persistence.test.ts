import { beforeEach, describe, expect, it } from 'vitest';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
import { buildForecast } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { cloudCacheKey, CloudAdapter, POSSIBLE_INCOME_NOT_STORED } from '../cloud';
import { INCOME_CERTAINTY_IN_SIGNED_IN_SAVES } from '../features';
import { LocalStorageAdapter } from '../storage';
import { SupabaseStorageAdapter } from '../supabase/adapter';
import { checkForMigration, fromRows, toRows } from '../supabase/rows';
import { FakeSupabase } from '../supabase/__tests__/fake-supabase';
import { FakeServer } from './fake-server';

// E1: possible income in every storage. It is kept where the storage can keep it, and refused (never dropped) where it can't.
const TODAY = '2026-10-13';
const clock = { today: TODAY, now: '2026-10-13T12:00:00.000Z' };

/** A paycheck, possible tips (one already received) and a possible invoice. */
function plan(): AppData {
  let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 800, '2026-10-25', { type: 'monthly' }, 'rent');
  d = unwrap(ops.addSource(d, { kind: 'income', description: 'Tips', amountCents: usd(200), startDate: TODAY, rule: { type: 'weekly' }, certainty: 'possible' }, clock, 'tips'));
  d = unwrap(ops.recordActual(d, `tips@${TODAY}`, { amountCents: usd(180), date: TODAY }, clock));
  d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Invoice', amountCents: usd(500), date: '2026-10-20', certainty: 'possible' }, clock, 'invoice'));
  return unwrap(ops.completeOnboarding(d));
}

const certainties = (d: AppData) => ({
  sources: d.sources.map((s) => [s.id, s.certainty ?? 'expected']),
  records: d.records.map((r) => [r.id, r.certainty ?? 'expected']),
});
const EXPECTED_MARKS = {
  sources: [['pay', 'expected'], ['rent', 'expected'], ['tips', 'possible']],
  records: [[`tips@${TODAY}`, 'expected'], ['invoice', 'possible']],
};
const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);

beforeEach(() => localStorage.clear());

describe('device storage keeps possible income', () => {
  it('through a save and reload, with the same forecast', async () => {
    const adapter = new LocalStorageAdapter();
    expect(await adapter.save(plan(), 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new LocalStorageAdapter().load();
    expect(certainties(loaded)).toEqual(EXPECTED_MARKS);
    expect(counted(loaded)).toEqual(counted(plan()));
  });

  it('through a backup and restore', () => {
    const { text } = createBackup(plan());
    const restored = readBackup(text).data;
    expect(certainties(restored)).toEqual(EXPECTED_MARKS);
    expect(counted(restored)).toEqual(counted(plan()));
  });
});

describe('signed in with Firebase (legacy): possible income is refused, never dropped', () => {
  it('is off by default (decision D8)', () => {
    expect(INCOME_CERTAINTY_IN_SIGNED_IN_SAVES).toBe(false);
  });

  it('a plan with possible income is refused before anything is written, so it can never be saved as counted income', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage);
    await adapter.load();
    expect(await adapter.save(plan(), 0)).toEqual({ ok: false, reason: 'error', message: POSSIBLE_INCOME_NOT_STORED });
    expect(server.row).toBeNull();
    expect(localStorage.getItem(cloudCacheKey('user-1'))).toBeNull();
    expect(adapter.hasUnsavedChanges()).toBe(false);
  });

  it('received possible income still carries its mark, so it is refused too (nothing is lost)', async () => {
    const onlyReceived = unwrap(ops.setIncomeCertainty(unwrap(ops.deleteOneTime(plan(), 'invoice')), 'tips', 'expected', clock));
    const withMarkedRecord = unwrap(ops.addOneTime(onlyReceived, { kind: 'income', description: 'Refund', amountCents: usd(40), date: TODAY, certainty: 'possible' }, clock, 'refund'));
    const received = unwrap(ops.recordActual(withMarkedRecord, 'refund', { amountCents: usd(40), date: TODAY }, clock));
    const adapter = new CloudAdapter(new FakeServer(), 'user-1', localStorage);
    await adapter.load();
    expect(await adapter.save(received, 0)).toEqual({ ok: false, reason: 'error', message: POSSIBLE_INCOME_NOT_STORED });
  });

  it('a plan with only expected income saves as before, with no certainty field anywhere', async () => {
    const expected = unwrap(ops.setIncomeCertainty(unwrap(ops.setIncomeCertainty(plan(), 'tips', 'expected', clock)), 'invoice', 'expected', clock));
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage);
    await adapter.load();
    expect(await adapter.save(expected, 0)).toEqual({ ok: true, revision: 1 });
    expect(JSON.stringify(server.row!.data)).not.toContain('certainty');
  });

  it('with the flag on, the mark is saved and read back', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage, false, true);
    await adapter.load();
    expect(await adapter.save(plan(), 0)).toEqual({ ok: true, revision: 1 });
    localStorage.clear();
    const reread = await new CloudAdapter(server, 'user-1', localStorage, false, true).load();
    expect(certainties(reread)).toEqual(EXPECTED_MARKS);
  });
});

describe('Supabase keeps possible income', () => {
  it('as a certainty column, read back exactly, with the same forecast', async () => {
    const rows = toRows(plan());
    expect(rows.sources.map((s) => [s.id, s.certainty])).toEqual([['pay', null], ['rent', null], ['tips', 'possible']]);
    expect(rows.records.map((r) => [r.id, r.certainty])).toEqual([[`tips@${TODAY}`, null], ['invoice', 'possible']]);

    const fake = new FakeSupabase();
    const adapter = new SupabaseStorageAdapter(fake, () => 'save-1');
    await adapter.load();
    expect(await adapter.save(plan(), 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new SupabaseStorageAdapter(fake, () => 'save-2').load();
    expect(certainties(loaded)).toEqual(EXPECTED_MARKS);
    expect(counted(loaded)).toEqual(counted(plan()));
    expect(fromRows({ ...rows, workspace_id: 'ws', revision: 1, schema_version: 2 }).sources.find((s) => s.id === 'pay')).not.toHaveProperty('certainty');
  });

  it('checkForMigration accepts possible income and names a mark the database would refuse', () => {
    expect(checkForMigration(plan()).filter((i) => i.level === 'error')).toEqual([]);
    const bad = plan();
    const marked: AppData = {
      ...bad,
      sources: bad.sources.map((s) => (s.id === 'rent' ? { ...s, certainty: 'possible' as const } : s)),
      records: bad.records.map((r) => (r.id === `tips@${TODAY}` ? { ...r, certainty: 'possible' as const } : r)),
    };
    expect(checkForMigration(marked).filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'Item 2 (rent): only income can be possible.',
      `Record 1 (tips@${TODAY}): only one-time income can be marked possible; a recurring occurrence follows its item.`,
    ]);
  });
});
