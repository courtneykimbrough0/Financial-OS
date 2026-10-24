import { beforeEach, describe, expect, it } from 'vitest';
import { source, unwrap, usd } from '../../domain/__tests__/helpers';
import { buildForecast } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { CloudAdapter } from '../cloud';
import { LocalStorageAdapter, STORAGE_KEY } from '../storage';
import { checkForMigration, fromRows, toRows } from '../supabase/rows';
import { FakeServer } from './fake-server';

/*
 * C1 retired income certainty: every unrecorded income is a projection and
 * counts. A plan saved before C1 may still carry `certainty: 'possible'` on an
 * income item or a one-time income. Every storage reads it as ordinary
 * projected income (counted, never silently excluded) and never writes the
 * mark again.
 */
const TODAY = '2026-10-13';
const clock = { today: TODAY, now: '2026-10-13T12:00:00.000Z' };

/** A paycheck, rent, weekly tips (one already received) and an invoice. */
function plan(): AppData {
  let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 800, '2026-10-25', { type: 'monthly' }, 'rent');
  d = source(d, TODAY, 'income', 'Tips', 200, TODAY, { type: 'weekly' }, 'tips');
  d = unwrap(ops.recordActual(d, `tips@${TODAY}`, { amountCents: usd(180), date: TODAY }, clock));
  d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Invoice', amountCents: usd(500), date: '2026-10-20' }, clock, 'invoice'));
  return unwrap(ops.completeOnboarding(d));
}

/** `plan()` as a pre-C1 app stored it: the tips and the invoice marked possible. */
function legacy(d: AppData = plan()): AppData {
  return {
    ...d,
    sources: d.sources.map((s) => (s.id === 'tips' ? { ...s, certainty: 'possible' } : s)),
    records: d.records.map((r) => (r.id === 'invoice' ? { ...r, certainty: 'possible' } : r)),
  } as AppData;
}

const counted = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.counts).map((e) => [e.occurrence.id, e.date, e.signedCents]);
/** Projected (unrecorded) tips and the invoice in October: what a pre-C1 forecast left out. */
const formerlyExcluded = (d: AppData) =>
  buildForecast(d, TODAY).entries.filter((e) => e.counts && e.occurrence.status === 'scheduled' && e.date <= '2026-10-31' && (e.occurrence.sourceId === 'tips' || e.occurrence.id === 'invoice')).map((e) => [e.occurrence.id, e.signedCents]);

beforeEach(() => localStorage.clear());

describe('device storage', () => {
  it('a saved plan with possible income loads without the mark, and that income counts', async () => {
    const base = plan();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy(base)));
    const loaded = await new LocalStorageAdapter().load();
    expect(JSON.stringify(loaded)).not.toContain('certainty');
    expect(loaded).toEqual(base);
    expect(counted(loaded)).toEqual(counted(plan()));
    expect(formerlyExcluded(loaded)).toEqual([
      ['invoice', usd(500)],
      [`tips@2026-10-20`, usd(200)],
      [`tips@2026-10-27`, usd(200)],
    ]);
  });

  it('the next save writes no mark', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy()));
    const adapter = new LocalStorageAdapter();
    const loaded = await adapter.load();
    expect(await adapter.save(loaded, loaded.revision)).toEqual({ ok: true, revision: loaded.revision + 1 });
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('certainty');
  });

  it('a backup made before C1 restores without the mark', () => {
    const restored = readBackup(createBackup(legacy()).text).data;
    expect(JSON.stringify(restored)).not.toContain('certainty');
    expect(counted(restored)).toEqual(counted(plan()));
  });
});

describe('signed in with Firebase (legacy)', () => {
  it('a stored plan with the mark loads as counted income, and a plan with irregular income now saves', async () => {
    const server = new FakeServer();
    server.row = { data: legacy(), revision: 1 };
    const adapter = new CloudAdapter(server, 'user-1', localStorage);
    const loaded = await adapter.load();
    expect(JSON.stringify(loaded)).not.toContain('certainty');
    expect(counted(loaded)).toEqual(counted(plan()));
    expect(await adapter.save(loaded, 1)).toEqual({ ok: true, revision: 2 });
    expect(JSON.stringify(server.row.data)).not.toContain('certainty');
  });
});

describe('Supabase', () => {
  it('the retired column is always written null', () => {
    const rows = toRows(legacy());
    expect(rows.sources.map((s) => s.certainty)).toEqual([null, null, null]);
    expect(rows.records.map((r) => r.certainty)).toEqual([null, null]);
  });

  it("a stored 'possible' is ignored on load, so that income counts", () => {
    const rows = toRows(plan());
    const stored = {
      ...rows,
      sources: rows.sources.map((s) => (s.id === 'tips' ? { ...s, certainty: 'possible' as const } : s)),
      records: rows.records.map((r) => (r.id === 'invoice' ? { ...r, certainty: 'possible' as const } : r)),
      workspace_id: 'ws',
      revision: 1,
      schema_version: 2 as const,
    };
    const loaded = fromRows(stored);
    expect(JSON.stringify(loaded)).not.toContain('certainty');
    expect(counted(loaded)).toEqual(counted(plan()));
  });

  it('checkForMigration finds nothing to refuse in a plan that had the mark', () => {
    expect(checkForMigration(legacy()).filter((i) => i.level === 'error')).toEqual([]);
  });
});
