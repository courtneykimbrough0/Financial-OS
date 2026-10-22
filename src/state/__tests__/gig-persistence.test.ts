import { beforeEach, describe, expect, it } from 'vitest';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
import { earnedNotPaid } from '../../domain/earnings';
import { buildForecast } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { cloudCacheKey, CloudAdapter, INCOME_DETAIL_NOT_STORED } from '../cloud';
import { LocalStorageAdapter, migrate } from '../storage';
import { SupabaseStorageAdapter } from '../supabase/adapter';
import { checkForMigration, toRows } from '../supabase/rows';
import { FakeSupabase } from '../supabase/__tests__/fake-supabase';
import { FakeServer } from './fake-server';

// E4: gig income and sessions in every storage. Kept where the storage can keep them; refused, never dropped, where it can't.
const TODAY = '2026-10-19';
const clock = { today: TODAY, now: '2026-10-19T12:00:00.000Z' };

/** Gig payouts every Monday from Oct 12, a session paid by that payout and one waiting with cash received. */
function plan(): AppData {
  let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Delivery payouts', amountCents: usd(300), startDate: '2026-10-12', rule: { type: 'weekly' }, incomeType: 'gig' }, { today: '2026-10-05', now: '2026-10-05T12:00:00.000Z' }, 'gig'));
  d = source(d, '2026-10-05', 'bill', 'Rent', 900, '2026-10-25', { type: 'monthly' }, 'rent');
  d = unwrap(ops.logSession(d, { sourceId: 'gig', date: '2026-10-10', minutes: 180, earningsCents: usd(95), platform: 'DoorDash' }, clock, 's1'));
  d = unwrap(ops.recordActual(d, 'gig@2026-10-12', { amountCents: usd(290), date: '2026-10-12' }, clock));
  d = unwrap(ops.logSession(d, { sourceId: 'gig', date: '2026-10-16', earningsCents: usd(70), cashTipsCents: usd(12), platform: 'Uber' }, clock, 's2'));
  return unwrap(ops.completeOnboarding(d));
}

const detail = (d: AppData) => ({ gig: d.sources.find((s) => s.id === 'gig'), sessions: d.workEntries, waiting: earnedNotPaid(d, 'gig').cents });
const counted = (d: AppData) => buildForecast(d, TODAY).entries.map((e) => [e.occurrence.id, e.date, e.signedCents, e.counts]);

beforeEach(() => localStorage.clear());

describe('device storage and backups keep gig income and sessions', () => {
  it('through a save and reload, and a backup and restore', async () => {
    const p = plan();
    expect(await new LocalStorageAdapter().save(p, 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new LocalStorageAdapter().load();
    expect(detail(loaded)).toEqual(detail(p));
    expect(counted(loaded)).toEqual(counted(p));
    const restored = readBackup(createBackup(p).text).data;
    expect(detail(restored)).toEqual(detail(p));
    expect(counted(restored)).toEqual(counted(p));
  });

  it('reading stored data keeps sessions only on gig income and only with session fields', () => {
    const p = plan();
    const raw = JSON.parse(JSON.stringify(p));
    raw.sources.find((s: { id: string }) => s.id === 'gig').hourlyWageCents = 1500;
    raw.workEntries.push({ id: 'wage', sourceId: 'gig', kind: 'session', date: '2026-10-17', earningsCents: 100, wageCents: 1500 });
    raw.workEntries.push({ id: 'nothing', sourceId: 'gig', kind: 'session', date: '2026-10-17', minutes: 60 });
    raw.workEntries.push({ id: 'as-shift', sourceId: 'gig', kind: 'shift', date: '2026-10-17', minutes: 60 });
    raw.workEntries.push({ id: 'wrong-income', sourceId: 'rent', kind: 'session', date: '2026-10-17', earningsCents: 100 });
    raw.workEntries.push({ id: 'blank-platform', sourceId: 'gig', kind: 'session', date: '2026-10-17', earningsCents: 100, platform: ' ' });
    const read = migrate(raw);
    expect(read.sources.find((s) => s.id === 'gig')).not.toHaveProperty('hourlyWageCents');
    expect(read.workEntries!.map((e) => e.id)).toEqual(['s1', 's2']);
    expect(counted(read)).toEqual(counted(p));
  });
});

describe('signed in with Firebase (legacy): gig detail is refused, never dropped', () => {
  it('a plan with gig income or sessions is refused before anything is written', async () => {
    const onlyType = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Payouts', amountCents: usd(300), startDate: TODAY, rule: { type: 'weekly' }, incomeType: 'gig' }, clock, 'gig'));
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
});

describe('Supabase keeps gig income and sessions', () => {
  it('as columns on sources and work entries, read back exactly', async () => {
    const p = plan();
    const rows = toRows(p);
    expect(rows.sources.find((s) => s.id === 'gig')).toMatchObject({ income_type: 'gig', hourly_wage_cents: null });
    expect(rows.work_entries.map((e) => [e.id, e.kind, e.earnings_cents, e.cash_tips_cents, e.platform, e.paid_by_occurrence_id])).toEqual([
      ['s1', 'session', usd(95), null, 'DoorDash', 'gig@2026-10-12'],
      ['s2', 'session', usd(70), usd(12), 'Uber', null],
    ]);
    const fake = new FakeSupabase();
    const adapter = new SupabaseStorageAdapter(fake, () => 'save-1');
    await adapter.load();
    expect(await adapter.save(p, 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new SupabaseStorageAdapter(fake, () => 'save-2').load();
    expect(detail(loaded)).toEqual(detail(p));
    expect(counted(loaded)).toEqual(counted(p));
  });

  it('checkForMigration accepts gig work and names what the database would refuse', () => {
    const p = plan();
    expect(checkForMigration(p).filter((i) => i.level === 'error')).toEqual([]);
    const broken: AppData = { ...p, workEntries: [{ ...p.workEntries![0]!, wageCents: 1500 }, { ...p.workEntries![1]!, kind: 'shift' }] };
    expect(checkForMigration(broken).filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'Shift 1 (s1): it has fields of the other kind of work.',
      "Shift 2 (s2): a shift doesn't belong to gig income.",
      'Shift 2 (s2): it has fields of the other kind of work.',
    ]);
  });
});
