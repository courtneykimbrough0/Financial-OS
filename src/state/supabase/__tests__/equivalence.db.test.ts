import { describe, expect, it } from 'vitest';
import { addDays } from '../../../domain/dates';
import { estimateSuggestions } from '../../../domain/estimates';
import { buildForecast, dailyTimeline, explainTimingGaps, lowestPoint, paycheckCycles } from '../../../domain/forecast';
import { variance } from '../../../domain/occurrences';
import type { AppData } from '../../../domain/types';
import { createBackup, readBackup } from '../../backup';
import { canonicalize, checkForMigration, toRows } from '../rows';
import { homeView } from '../../../domain/home';
import { allPlans, TODAY } from './fixtures';
import { count, load, loadRows, newUser, save, workspaceOf } from './pg';

/** Everything the app derives from a plan on one day. */
function outcomes(d: AppData, today: string) {
  const f = buildForecast(d, today);
  const start = f.forecastStart;
  return {
    forecast: f,
    gaps: explainTimingGaps(f),
    cycles: paycheckCycles(f),
    lowest: start ? lowestPoint(dailyTimeline(f, start, addDays(start, 89))) : null,
    suggestions: estimateSuggestions(d, today),
    home: homeView(d, today),
    variances: d.records.map((r) => [r.id, variance(r)]),
  };
}

const DAYS = [0, 30, 90, 180, 365].map((n) => addDays(TODAY, n));

describe('a plan stored in PostgreSQL comes back the same', () => {
  it.each(allPlans())('%s: identical plan, identical forecasts on every day checked', (_name, plan) => {
    expect(checkForMigration(plan).filter((i) => i.level === 'error')).toEqual([]);
    const user = newUser();
    // Migration: the backup's plan replaces the new, empty workspace.
    const r = save(user, { ...plan, revision: 0 }, { mode: 'replace' });
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ status: 'saved', revision: 1 });
    const stored = load(user);
    const expected = { ...canonicalize(plan), revision: 1 };
    expect(stored).toEqual(expected);
    for (const day of DAYS) expect(outcomes(stored, day)).toEqual(outcomes(expected, day));
    // Row counts match what went in.
    const ws = workspaceOf(user);
    const rows = toRows(plan);
    expect([
      count(`select count(*) from public.sources where workspace_id = '${ws}'`),
      count(`select count(*) from public.schedule_versions where workspace_id = '${ws}'`),
      count(`select count(*) from public.source_pauses where workspace_id = '${ws}'`),
      count(`select count(*) from public.occurrence_records where workspace_id = '${ws}'`),
    ]).toEqual([rows.sources.length, rows.versions.length, rows.pauses.length, rows.records.length]);
  });

  it('a backup made from the stored plan restores the same plan (export for rollback)', () => {
    const [, plan] = allPlans()[0]!;
    const user = newUser();
    save(user, { ...plan, revision: 0 }, { mode: 'replace' });
    const stored = load(user);
    const backup = readBackup(createBackup(stored).text).data;
    expect(backup).toEqual(stored);
    // And that backup, restored into another workspace, gives the same plan again.
    const other = newUser();
    expect(save(other, { ...backup, revision: 0 }, { mode: 'replace' }).ok).toBe(true);
    expect({ ...load(other), revision: 0 }).toEqual({ ...stored, revision: 0 });
  });

  it('the rich plan keeps its moved, canceled, set-aside and recorded occurrences', () => {
    const [, plan] = allPlans()[0]!;
    const user = newUser();
    save(user, { ...plan, revision: 0 }, { mode: 'replace' });
    const rows = loadRows(user)!;
    const rec = (id: string) => rows.records.find((r) => r.id === id);
    expect(rec('elec@2026-06-03')).toMatchObject({ expected_amount_cents: 18000, actual_date: '2026-06-09', actual_amount_cents: 20500, status: 'completed' });
    expect(rec('elec@2026-11-03')).toMatchObject({ expected_date: '2026-11-03', scheduled_date: '2026-11-06', scheduled_amount_cents: 20000, status: 'scheduled' });
    expect(rec('stream@2026-11-01')).toMatchObject({ status: 'canceled', cancel_note: 'Paused for a month' });
    // Moved, then no longer produced by the new rent schedule: kept, and still not counted.
    expect(rec('rent@2026-12-01')).toMatchObject({ scheduled_date: '2026-12-03', status: 'scheduled' });
    expect(buildForecast(load(user), TODAY).entries.some((e) => e.occurrence.id === 'rent@2026-12-01')).toBe(false);
  });
});
