import { describe, expect, it } from 'vitest';
import { buildForecast, paycheckCycles, periodKpis } from '../forecast';
import * as ops from '../operations';
import { periodPlan } from '../plan';
import { buildSampleData } from '../sample';
import { accountTypeFor, KINDS, OUTFLOW_KINDS, signFor } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

const TODAY = '2026-10-11';

/*
 * Paycheck $1,800 every 2 weeks from Oct 15. Rent $1,200 on the 1st (from Nov 1),
 * phone $60 on the 25th, music $10.99 on the 20th (subscription), car loan $350
 * on the 20th (liability), a $100 strategic reserve every 2 weeks from Oct 16.
 * One-time: bonus +$500 on Oct 22, repair −$300 on Oct 27 (varied spending).
 */
function data() {
  let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
  d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, 'phone');
  d = source(d, TODAY, 'subscription', 'Music', 10.99, '2026-10-20', { type: 'monthly' }, 'music');
  d = source(d, TODAY, 'liability', 'Car loan', 350, '2026-10-20', { type: 'monthly' }, 'car');
  d = source(d, TODAY, 'reserve', 'Emergency fund', 100, '2026-10-16', { type: 'biweekly' }, 'save');
  d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Bonus', amountCents: usd(500), date: '2026-10-22' }, clockAt(TODAY), 'bonus'));
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(300), date: '2026-10-27' }, clockAt(TODAY), 'repair'));
  return d;
}

describe('cash flow for a period', () => {
  it('is income minus outflows (bills, subscriptions, liabilities, varied spending) minus net reserves, repeating and one-time', () => {
    const f = buildForecast(data(), TODAY);
    const cycle = paycheckCycles(f, 1)[0]!;
    expect([cycle.start, cycle.end]).toEqual(['2026-10-15', '2026-10-28']);
    const p = periodPlan(f, cycle.start, cycle.end);
    expect(p.incomeCents).toBe(usd(2300));
    expect(p.byKind).toEqual({ income: usd(2300), bill: usd(60), subscription: usd(10.99), liability: usd(350), reserve: usd(100), varied: usd(300) });
    // Reserves are not spending: operating cash flow leaves them out, available cash flow takes them off.
    expect(p.outflowCents).toBe(usd(720.99));
    expect(p.reservesCents).toBe(usd(100));
    expect(p.operatingCents).toBe(usd(1579.01));
    expect(p.cashFlowCents).toBe(usd(1479.01));
  });

  it('changes with the period and matches the dashboard totals for it', () => {
    const f = buildForecast(data(), TODAY);
    const periods: [string, string][] = [
      ['2026-10-01', '2026-10-31'], // month
      ['2026-10-18', '2026-10-24'], // week
      ['2026-10-29', '2026-11-11'], // second pay period
      ['2026-10-20', '2026-11-05'], // custom
    ];
    for (const [start, end] of periods) {
      const p = periodPlan(f, start, end);
      const k = periodKpis(f, start, end);
      expect([p.incomeCents, p.outflowCents, p.reservesCents, p.operatingCents, p.cashFlowCents]).toEqual([k.incomeCents, k.outflowCents, k.reservesCents, k.operatingCents, k.netCents]);
      expect(p.cashFlowCents).toBe(p.incomeCents - p.outflowCents - p.reservesCents);
    }
    expect(periodPlan(f, '2026-10-01', '2026-10-31').cashFlowCents).toBe(usd(4100 - 920.99));
    expect(periodPlan(f, '2026-10-18', '2026-10-24').cashFlowCents).toBe(usd(500 - 360.99));
  });

  it('uses actual amounts once recorded and leaves out canceled items', () => {
    let d = unwrap(ops.recordActual(data(), 'pay@2026-10-15', { amountCents: usd(1650), date: '2026-10-15' }, clockAt('2026-10-15')));
    d = unwrap(ops.cancelOccurrence(d, 'phone@2026-10-25', '', clockAt('2026-10-15')));
    const p = periodPlan(buildForecast(d, '2026-10-15'), '2026-10-01', '2026-10-31');
    expect(p.incomeCents).toBe(usd(1650 + 1800 + 500));
    expect(p.byKind.bill).toBe(0);
    expect(p.byKind.varied).toBe(usd(300));
  });

  it('goes negative when expenses exceed income in the period', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Pay', 1000, '2026-10-15', { type: 'monthly' }, 'p');
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'r');
    expect(periodPlan(buildForecast(d, TODAY), '2026-10-15', '2026-11-14').cashFlowCents).toBe(usd(-200));
  });
});

describe('classifications', () => {
  it('are the six approved ones; reserves are not an outflow', () => {
    expect(KINDS).toEqual(['income', 'bill', 'subscription', 'liability', 'reserve', 'varied']);
    expect(OUTFLOW_KINDS).toEqual(['bill', 'subscription', 'liability', 'varied']);
    expect(KINDS.map((kind) => [kind, signFor({ kind })])).toEqual([
      ['income', 1],
      ['bill', -1],
      ['subscription', -1],
      ['liability', -1],
      ['reserve', -1],
      ['varied', -1],
    ]);
    expect(signFor({ kind: 'reserve', release: true })).toBe(1);
    expect(KINDS.map(accountTypeFor)).toEqual(['income', 'payment', 'payment', 'payment', 'distribution', 'payment']);
  });

  it('keep recurring obligations recurring and varied spending one-time', () => {
    const clock = clockAt(TODAY);
    expect(ops.addSource(ops.emptyData(), { kind: 'varied' as never, description: 'X', amountCents: 100, startDate: TODAY, rule: { type: 'monthly' } }, clock)).toMatchObject({ ok: false });
    for (const kind of ['bill', 'subscription', 'liability'] as never[]) expect(ops.addOneTime(ops.emptyData(), { kind, description: 'X', amountCents: 100, date: TODAY }, clock)).toMatchObject({ ok: false });
    expect(ops.addOneTime(ops.emptyData(), { kind: 'varied', description: 'X', amountCents: 100, date: TODAY, release: true }, clock)).toEqual({ ok: false, error: 'Only a strategic reserve can be released.' });
  });
});

describe('tags', () => {
  it('are optional and start empty; nothing is built in', () => {
    const d = source(ops.emptyData(), TODAY, 'bill', 'Rent', 1200, '2026-11-01');
    expect(d.sources[0]!.tags).toEqual([]);
    expect(ops.allTags(d)).toEqual([]);
    expect(ops.allTags(buildSampleData(TODAY))).toEqual([]);
  });

  it('are cleaned: trimmed, de-duplicated ignoring case, and capped', () => {
    expect(ops.normalizeTags(['  Housing ', 'housing', '', 'Big   rent', 'x'.repeat(40)])).toEqual(['Housing', 'Big rent', 'x'.repeat(ops.MAX_TAG_LENGTH)]);
    expect(ops.normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(ops.MAX_TAGS);
  });

  it('are totaled for the period, on recurring and one-time items', () => {
    let d = ops.emptyData();
    d = unwrap(ops.addSource(d, { kind: 'income', description: 'Pay', amountCents: usd(2000), startDate: '2026-10-15', rule: { type: 'monthly' }, tags: ['Work'] }, clockAt(TODAY), 'p'));
    d = unwrap(ops.addSource(d, { kind: 'bill', description: 'Rent', amountCents: usd(1200), startDate: '2026-10-16', rule: { type: 'monthly' }, tags: ['Housing'] }, clockAt(TODAY), 'r'));
    d = unwrap(ops.addSource(d, { kind: 'bill', description: 'Power', amountCents: usd(100), startDate: '2026-10-20', rule: { type: 'monthly' }, tags: ['housing'] }, clockAt(TODAY), 'e'));
    d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Console', amountCents: usd(400), date: '2026-10-25', tags: ['Gaming', 'fun'] }, clockAt(TODAY)));
    expect(ops.allTags(d)).toEqual(['fun', 'Gaming', 'Housing', 'Work']);
    const byTag = Object.fromEntries(periodPlan(buildForecast(d, TODAY), '2026-10-15', '2026-11-14').byTag.map((t) => [t.tag, [t.inCents, t.outCents, t.count]]));
    expect(byTag).toEqual({
      Work: [usd(2000), 0, 1],
      Housing: [0, usd(1300), 2],
      Gaming: [0, usd(400), 1],
      fun: [0, usd(400), 1],
    });
  });

  it('can be changed without touching amounts or history', () => {
    let d = source(ops.emptyData(), TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'r');
    d = unwrap(ops.updateSourceDetails(d, 'r', { description: 'Rent', tags: ['Home'] }, clockAt(TODAY)));
    expect(d.sources[0]!.tags).toEqual(['Home']);
    expect(d.sources[0]!.versions[0]!.amountCents).toBe(usd(1200));
  });
});

describe('liability types', () => {
  const input = { kind: 'liability' as const, description: 'Card', amountCents: usd(75), startDate: '2026-10-20', rule: { type: 'monthly' as const } };

  it('must be card, loan, or line of credit', () => {
    const missing = ops.addSource(ops.emptyData(), input, clockAt(TODAY));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/card, a loan, or a line of credit/);
    for (const t of ['card', 'loan', 'lineOfCredit'] as const) {
      const d = unwrap(ops.addSource(ops.emptyData(), { ...input, liabilityType: t }, clockAt(TODAY), 'x'));
      expect(d.sources[0]!.liabilityType).toBe(t);
    }
    const bogus = ops.addSource(ops.emptyData(), { ...input, liabilityType: 'other' as never }, clockAt(TODAY));
    expect(bogus.ok).toBe(false);
  });

  it('is never set on other kinds', () => {
    const d = unwrap(ops.addSource(ops.emptyData(), { ...input, kind: 'bill', liabilityType: 'card' }, clockAt(TODAY), 'b'));
    expect(d.sources[0]!.liabilityType).toBeUndefined();
  });

  it('can be changed without touching the schedule', () => {
    let d = unwrap(ops.addSource(ops.emptyData(), { ...input, liabilityType: 'card' }, clockAt(TODAY), 'c'));
    d = unwrap(ops.updateSourceDetails(d, 'c', { description: 'Card', liabilityType: 'lineOfCredit' }, clockAt(TODAY)));
    expect(d.sources[0]!.liabilityType).toBe('lineOfCredit');
    expect(d.sources[0]!.versions).toHaveLength(1);
  });
});
