import { beforeEach, describe, expect, it } from 'vitest';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
import { earnedNotPaid } from '../../domain/earnings';
import { buildForecast } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { cloudCacheKey, CloudAdapter, INCOME_DETAIL_NOT_STORED } from '../cloud';
import { INCOME_DETAIL_IN_SIGNED_IN_SAVES } from '../features';
import { LocalStorageAdapter, migrate } from '../storage';
import { SupabaseStorageAdapter } from '../supabase/adapter';
import { checkForMigration, toRows } from '../supabase/rows';
import { FakeSupabase } from '../supabase/__tests__/fake-supabase';
import { FakeServer } from './fake-server';

// E2: income type, wage and shifts in every storage. Kept where the storage can keep them; refused, never dropped, where it can't.
const TODAY = '2026-10-19';
const clock = { today: TODAY, now: '2026-10-19T12:00:00.000Z' };

/** A tipped job with two shifts (one with cash tips) and a recorded paycheck that paid the first. */
function plan(): AppData {
  let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Server', amountCents: usd(600), startDate: '2026-10-16', rule: { type: 'biweekly' }, incomeType: 'tipped', hourlyWageCents: 1525 }, { today: '2026-10-01', now: '2026-10-01T12:00:00.000Z' }, 'job'));
  d = source(d, '2026-10-01', 'bill', 'Rent', 900, '2026-10-25', { type: 'monthly' }, 'rent');
  d = unwrap(ops.logShift(d, { sourceId: 'job', date: '2026-10-13', minutes: 390, wageCents: 1525, cashTipsCents: usd(40), cardTipsCents: usd(55) }, clock, 's1'));
  d = unwrap(ops.recordActual(d, 'job@2026-10-16', { amountCents: usd(640), date: '2026-10-16' }, clock));
  d = unwrap(ops.logShift(d, { sourceId: 'job', date: '2026-10-17', minutes: 300, wageCents: 1525, cardTipsCents: usd(30) }, clock, 's2'));
  return unwrap(ops.completeOnboarding(d));
}

const detail = (d: AppData) => ({
  job: d.sources.find((s) => s.id === 'job')!,
  shifts: d.workEntries,
  notPaid: earnedNotPaid(d, 'job').cents,
});
const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);

beforeEach(() => localStorage.clear());

describe('device storage and backups keep shift tracking', () => {
  it('through a save and reload', async () => {
    const p = plan();
    expect(await new LocalStorageAdapter().save(p, 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new LocalStorageAdapter().load();
    expect(detail(loaded)).toEqual(detail(p));
    expect(loaded.workEntries![0]).toMatchObject({ id: 's1', paidByOccurrenceId: 'job@2026-10-16', cashTipsRecordId: expect.any(String) });
    expect(counted(loaded)).toEqual(counted(p));
  });

  it('through a backup and restore', () => {
    const p = plan();
    const restored = readBackup(createBackup(p).text).data;
    expect(detail(restored)).toEqual(detail(p));
    expect(counted(restored)).toEqual(counted(p));
  });

  it('reading stored data keeps shifts and details only where they mean something, and drops a link rather than move money', () => {
    const raw = JSON.parse(JSON.stringify(plan()));
    raw.sources.find((s: { id: string }) => s.id === 'rent').incomeType = 'hourly';
    raw.workEntries.push({ id: 'bad-source', sourceId: 'rent', kind: 'shift', date: '2026-10-18', minutes: 60 });
    raw.workEntries.push({ id: 'bad-amount', sourceId: 'job', kind: 'shift', date: '2026-10-18', minutes: 60, cashTipsCents: 0 });
    raw.workEntries.push({ id: 'empty', sourceId: 'job', kind: 'shift', date: '2026-10-18' });
    raw.workEntries.push({ ...raw.workEntries[0], id: 's1' });
    raw.workEntries[1].paidByOccurrenceId = 'rent@2026-10-25';
    const read = migrate(raw);
    expect(read.sources.find((s) => s.id === 'rent')).not.toHaveProperty('incomeType');
    expect(read.workEntries!.map((e) => e.id)).toEqual(['s1', 's2']);
    expect(read.workEntries![1]).not.toHaveProperty('paidByOccurrenceId');
    // A tips link to a missing record is dropped; the shift keeps its amounts.
    const lost = JSON.parse(JSON.stringify(plan()));
    lost.records = lost.records.filter((r: { id: string }) => r.id !== lost.workEntries[0].cashTipsRecordId);
    expect(migrate(lost).workEntries![0]).toMatchObject({ id: 's1', cashTipsCents: usd(40) });
    expect(migrate(lost).workEntries![0]).not.toHaveProperty('cashTipsRecordId');
    // A plan from before E2 reads back exactly as it was.
    const old = source(ops.emptyData(), '2026-10-01', 'income', 'Pay', 500, '2026-10-30');
    expect(migrate(JSON.parse(JSON.stringify(old)))).toEqual(old);
  });
});

describe('signed in with Firebase (legacy): shift tracking is refused, never dropped', () => {
  it('is off by default (decision D8)', () => {
    expect(INCOME_DETAIL_IN_SIGNED_IN_SAVES).toBe(false);
  });

  it('a plan with shifts, an income type or a wage is refused before anything is written', async () => {
    const onlyType = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Server', amountCents: usd(600), startDate: TODAY, rule: { type: 'biweekly' }, incomeType: 'hourly' }, clock, 'job'));
    for (const d of [plan(), onlyType]) {
      localStorage.clear();
      const server = new FakeServer();
      const adapter = new CloudAdapter(server, 'user-1', localStorage);
      await adapter.load();
      expect(await adapter.save(d, 0)).toEqual({ ok: false, reason: 'error', message: INCOME_DETAIL_NOT_STORED });
      expect(server.row).toBeNull();
      expect(localStorage.getItem(cloudCacheKey('user-1'))).toBeNull();
    }
  });

  it('with the flag on, everything is saved and read back', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage, false, false, true);
    await adapter.load();
    const p = plan();
    expect(await adapter.save(p, 0)).toEqual({ ok: true, revision: 1 });
    localStorage.clear();
    expect(detail(await new CloudAdapter(server, 'user-1', localStorage, false, false, true).load())).toEqual(detail(p));
  });
});

describe('Supabase keeps shift tracking', () => {
  it('as columns and work_entries rows, read back exactly', async () => {
    const rows = toRows(plan());
    expect(rows.sources.find((s) => s.id === 'job')).toMatchObject({ income_type: 'tipped', hourly_wage_cents: 1525 });
    expect(rows.sources.find((s) => s.id === 'rent')).toMatchObject({ income_type: null, hourly_wage_cents: null });
    expect(rows.work_entries.map((e) => [e.id, e.work_date, e.minutes, e.cash_tips_cents, e.card_tips_cents, e.paid_by_occurrence_id])).toEqual([
      ['s1', '2026-10-13', 390, usd(40), usd(55), 'job@2026-10-16'],
      ['s2', '2026-10-17', 300, null, usd(30), null],
    ]);
    const fake = new FakeSupabase();
    const adapter = new SupabaseStorageAdapter(fake, () => 'save-1');
    await adapter.load();
    const p = plan();
    expect(await adapter.save(p, 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new SupabaseStorageAdapter(fake, () => 'save-2').load();
    expect(detail(loaded)).toEqual(detail(p));
    expect(counted(loaded)).toEqual(counted(p));
  });

  it('checkForMigration accepts shift tracking and names what the database would refuse', () => {
    expect(checkForMigration(plan()).filter((i) => i.level === 'error')).toEqual([]);
    const bad = plan();
    const broken: AppData = {
      ...bad,
      sources: bad.sources.map((s) => (s.id === 'rent' ? { ...s, incomeType: 'hourly' as const } : s)),
      workEntries: [{ ...bad.workEntries![1]!, minutes: 2000, sourceId: 'nope' }],
    };
    expect(checkForMigration(broken).filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'Item 2 (rent): only income can be hourly, tipped or gig, and a wage needs hourly or tipped and an amount above $0.',
      "Shift 1 (s2): its income no longer exists or isn't hourly, tipped or gig.",
      'Shift 1 (s2): hours must be between 0 and 24.',
    ]);
  });
});
