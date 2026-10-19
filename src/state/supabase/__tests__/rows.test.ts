import { describe, expect, it } from 'vitest';
import { buildForecast } from '../../../domain/forecast';
import * as ops from '../../../domain/operations';
import type { AppData } from '../../../domain/types';
import { canonicalize, checkForMigration, fromRows, toRows, type LoadedPlan } from '../rows';
import { allPlans, legacyPlan, richPlan, TODAY } from './fixtures';

const loaded = (d: AppData): LoadedPlan => ({ ...toRows(d), workspace_id: 'ws', revision: d.revision, schema_version: 2 });

describe('mapping a plan to rows and back', () => {
  it.each(allPlans())('%s comes back exactly', (_name, plan) => {
    expect(fromRows(loaded(plan))).toEqual(plan);
  });

  it('keeps every field of the rich plan in the right columns', () => {
    const rows = toRows(richPlan());
    expect(rows.sources.map((s) => [s.id, s.position, s.kind, s.main_paycheck, s.liability_type])).toEqual([
      ['pay', 0, 'income', false, null],
      ['side', 1, 'income', true, null],
      ['rent', 2, 'bill', false, null],
      ['elec', 3, 'bill', false, null],
      ['phone', 4, 'bill', false, null],
      ['loan', 5, 'liability', false, 'loan'],
      ['stream', 6, 'subscription', false, null],
      ['save', 7, 'reserve', false, null],
    ]);
    expect(rows.sources.find((s) => s.id === 'phone')).toMatchObject({ dismissed_current_cents: 6000, dismissed_proposed_cents: 6500, dismissed_through: '2026-09-25' });
    expect(rows.versions.filter((v) => v.source_id === 'pay').map((v) => [v.start_date, v.amount_cents, v.rule_type])).toEqual([
      ['2026-06-05', 100000, 'biweekly'],
      ['2026-10-30', 108000, 'biweekly'],
    ]);
    expect(rows.versions.find((v) => v.source_id === 'loan')).toMatchObject({ rule_type: 'custom', rule_interval: 2, rule_unit: 'month', rule_days: null });
    expect(rows.versions.find((v) => v.source_id === 'stream')).toMatchObject({ rule_type: 'twiceMonthly', rule_days: [1, 15], rule_interval: null, rule_unit: null });
    expect(rows.pauses).toEqual([{ source_id: 'save', from_date: '2026-08-01', until_date: '2026-09-05' }]);
    expect(rows.records.find((r) => r.id === 'elec@2026-06-03')).toMatchObject({ expected_date: '2026-06-03', expected_amount_cents: 18000, actual_date: '2026-06-09', actual_amount_cents: 20500, status: 'completed' });
    expect(rows.records.find((r) => r.id === 'elec@2026-11-03')).toMatchObject({ expected_date: '2026-11-03', scheduled_date: '2026-11-06', scheduled_amount_cents: 20000, status: 'scheduled' });
    expect(rows.records.find((r) => r.id === 'one-refund')).toMatchObject({ source_id: null, kind: 'income', tags: ['Taxes'], actual_amount_cents: 61240 });
    expect([rows.review_cadence, rows.review_handled_on, rows.review_outcome, rows.onboarding_complete]).toEqual(['payday', TODAY, 'completed', true]);
  });

  it('keeps "no review rhythm chosen" apart from a rhythm set to off', () => {
    const none = smallNoReview();
    expect('review' in fromRows(loaded(none))).toBe(false);
    expect(toRows(none)).toMatchObject({ review_cadence: null, review_handled_on: null, review_outcome: null });
    const off = legacyPlan();
    expect(fromRows(loaded(off)).review).toEqual({ cadence: 'off', handledOn: null, outcome: null });
  });

  it('doesn’t add optional fields that were absent', () => {
    const back = fromRows(loaded(richPlan()));
    const rent = back.sources.find((s) => s.id === 'rent')!;
    expect(Object.keys(rent).sort()).toEqual(['active', 'createdAt', 'description', 'endDate', 'id', 'kind', 'pausedRanges', 'tags', 'updatedAt', 'versions']);
  });

  it('never stores the sample flag', () => {
    const r = toRows({ ...richPlan(), isSample: true });
    expect('isSample' in r).toBe(false);
    expect('isSample' in fromRows({ ...r, workspace_id: 'ws', revision: 0, schema_version: 2 })).toBe(false);
  });
});

function smallNoReview(): AppData {
  return unwrapOk(ops.completeOnboarding(ops.emptyData()));
}
function unwrapOk(r: ops.Result) {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe('canonical form', () => {
  it('changes only timestamp formatting and ordering, never the forecast', () => {
    const plan = legacyPlan();
    const c = canonicalize(plan);
    expect(c.sources[0]!.createdAt).toBe('2026-09-01T08:00:00.000Z');
    expect(canonicalize(c)).toEqual(c);
    const money = (d: AppData) => buildForecast(d, TODAY).entries.map((e) => [e.occurrence.id, e.date, e.amountCents, e.signedCents, e.counts]);
    expect(money(c)).toEqual(money(plan));
  });

  it('is a no-op for what the app writes itself', () => {
    const plan = richPlan();
    expect(canonicalize(plan)).toEqual(plan);
  });
});

describe('checking a plan before migrating', () => {
  it.each(allPlans())('%s has nothing the database would refuse', (_name, plan) => {
    expect(checkForMigration(plan).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('reports what would be stored in canonical form', () => {
    expect(checkForMigration(legacyPlan())).toEqual([{ level: 'normalized', message: 'Some times will be stored as ISO-8601 UTC with milliseconds.' }]);
  });

  it('names each problem the database would refuse', () => {
    const d = richPlan();
    const broken: AppData = {
      ...d,
      sources: [
        { ...d.sources[0]!, versions: [] },
        { ...d.sources[1]!, mainPaycheck: true },
        { ...d.sources[2]!, mainPaycheck: true, kind: 'income', id: 'rent@x' },
        { ...d.sources[3]!, versions: [{ ...d.sources[3]!.versions[0]!, id: '' }, { ...d.sources[3]!.versions[0]!, id: 'v2', amountCents: 0 }] },
        ...d.sources.slice(4),
      ],
      records: [
        { ...d.records[0]!, id: 'elec@2026-01-01' },
        { ...d.records[1]!, status: 'completed', actualDate: null },
        { ...d.records[2]!, sourceId: 'gone', id: 'gone@2026-06-03' },
        { ...d.records.find((r) => r.id === 'one-repair')!, kind: 'liability' },
        { ...d.records[3]!, createdAt: 'yesterday' },
        d.records[3]!,
      ],
    };
    expect(checkForMigration(broken).filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'Item 1 (pay): it has no schedule.',
      "Item 3 (rent@x): the id can't be used (empty, too long, or contains @).",
      'Item 4 (elec), schedule 1: it has no id.',
      'Item 4 (elec): two schedules start on 2026-04-03.',
      'Item 4 (elec), schedule 2: the amount must be above $0 and at most $100,000,000.',
      'More than one item is marked as the main paycheck.',
      "Record 1 (elec@2026-01-01): the id doesn't match its item and original date.",
      "Record 2 (elec@2026-05-03): an actual must be recorded exactly when it's done.",
      'Record 3 (gone@2026-06-03): its item no longer exists.',
      "Record 4 (one-repair): a one-time item can't be a liability.",
      "Record 5 (elec@2026-07-03): a time isn't a valid time.",
      'Record 6 (elec@2026-07-03): the id is used twice.',
    ]);
  });
});
