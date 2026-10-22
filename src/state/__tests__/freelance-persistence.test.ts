import { beforeEach, describe, expect, it } from 'vitest';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
import { doneNotPaid } from '../../domain/earnings';
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

// E3: clients and jobs in every storage. Kept where the storage can keep them; refused, never dropped, where it can't.
const TODAY = '2026-10-19';
const clock = { today: TODAY, now: '2026-10-19T12:00:00.000Z' };

/** A client; a paid job, one with a possible payment, and a pending one. */
function plan(): AppData {
  let d = source(ops.emptyData(), '2026-10-05', 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  d = unwrap(ops.addClient(d, 'Acme', clock, 'acme'));
  d = unwrap(ops.addJob(d, { description: 'Logo design', clientId: 'acme', amountCents: usd(800), status: 'done', expectedDate: '2026-10-28' }, clock, 'logo'));
  d = unwrap(ops.recordJobPayment(d, 'logo', { amountCents: usd(780), date: '2026-10-18' }, clock));
  d = unwrap(ops.addJob(d, { description: 'Website copy', clientId: 'acme', amountCents: usd(1200), status: 'planned', expectedDate: '2026-11-15', certainty: 'possible' }, clock, 'copy'));
  d = unwrap(ops.addJob(d, { description: 'Brochure', amountCents: usd(300), status: 'done' }, clock, 'brochure'));
  return unwrap(ops.completeOnboarding(d));
}

const detail = (d: AppData) => ({ clients: d.clients, jobs: d.jobs, notPaid: doneNotPaid(d, TODAY).cents });
const counted = (d: AppData) => buildForecast(d, TODAY).entries.map((e) => [e.occurrence.id, e.date, e.signedCents, e.counts]);

beforeEach(() => localStorage.clear());

describe('device storage and backups keep clients and jobs', () => {
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

  it('reading stored data keeps jobs and links only where they mean something; a dropped link never moves money', () => {
    const p = plan();
    const raw = JSON.parse(JSON.stringify(p));
    raw.jobs.push({ id: 'bad-amount', description: 'X', amountCents: 0, status: 'done' });
    raw.jobs.push({ id: 'bad-status', description: 'X', amountCents: 100, status: 'paid' });
    raw.jobs.push({ id: 'shared', description: 'Dup', amountCents: 100, status: 'done', paymentRecordId: raw.jobs[0].paymentRecordId });
    raw.jobs.push({ id: 'recurring', description: 'Rec', amountCents: 100, status: 'done', paymentRecordId: 'pay@2026-10-23', clientId: 'gone' });
    raw.clients.push({ id: 'acme', name: 'Again' }, { id: 'blank', name: ' ' });
    const read = migrate(raw);
    expect(read.clients!.map((c) => c.id)).toEqual(['acme']);
    expect(read.jobs!.map((j) => j.id)).toEqual(['logo', 'copy', 'brochure', 'shared', 'recurring']);
    expect(read.jobs!.find((j) => j.id === 'shared')).not.toHaveProperty('paymentRecordId');
    expect(read.jobs!.find((j) => j.id === 'recurring')).not.toHaveProperty('paymentRecordId');
    expect(read.jobs!.find((j) => j.id === 'recurring')).not.toHaveProperty('clientId');
    // The records themselves are untouched, so the forecast is unchanged.
    expect(counted(read)).toEqual(counted(p));
    // A plan from before E3 reads back exactly as it was.
    const old = source(ops.emptyData(), '2026-10-01', 'income', 'Pay', 500, '2026-10-30');
    expect(migrate(JSON.parse(JSON.stringify(old)))).toEqual(old);
  });
});

describe('signed in with Firebase (legacy): clients and jobs are refused, never dropped', () => {
  it('a plan with a job or only a client is refused before anything is written', async () => {
    const onlyClient = unwrap(ops.addClient(ops.emptyData(), 'Acme', clock, 'acme'));
    // (A plan with possible income is refused for that first, by E1.)
    const p = plan();
    const expectedOnly = unwrap(ops.setIncomeCertainty(p, p.jobs![1]!.paymentRecordId!, 'expected', clock));
    for (const d of [expectedOnly, onlyClient]) {
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

describe('Supabase keeps clients and jobs', () => {
  it('as clients and freelance_jobs rows, read back exactly', async () => {
    const p = plan();
    const rows = toRows(p);
    expect(rows.clients).toEqual([{ id: 'acme', position: 0, name: 'Acme', created_at: clock.now, updated_at: clock.now }]);
    expect(rows.jobs.map((j) => [j.id, j.client_id, j.amount_cents, j.status, j.payment_record_id !== null])).toEqual([
      ['logo', 'acme', usd(800), 'done', true],
      ['copy', 'acme', usd(1200), 'planned', true],
      ['brochure', null, usd(300), 'done', false],
    ]);
    const fake = new FakeSupabase();
    const adapter = new SupabaseStorageAdapter(fake, () => 'save-1');
    await adapter.load();
    expect(await adapter.save(p, 0)).toEqual({ ok: true, revision: 1 });
    const loaded = await new SupabaseStorageAdapter(fake, () => 'save-2').load();
    expect(detail(loaded)).toEqual(detail(p));
    expect(counted(loaded)).toEqual(counted(p));
  });

  it('checkForMigration accepts freelance work and names what the database would refuse', () => {
    const p = plan();
    expect(checkForMigration(p).filter((i) => i.level === 'error')).toEqual([]);
    const broken: AppData = { ...p, jobs: [...p.jobs!, { ...p.jobs![0]!, id: 'dup', clientId: 'gone' }, { ...p.jobs![2]!, id: 'rec', paymentRecordId: 'pay@2026-10-23' }] };
    expect(checkForMigration(broken).filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'Job 4 (dup): its client no longer exists.',
      'Job 4 (dup): its payment belongs to another job or shift.',
      "Job 5 (rec): its payment isn't a one-time income record.",
    ]);
  });
});
