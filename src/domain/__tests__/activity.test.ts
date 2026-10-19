import { describe, expect, it } from 'vitest';
import { activityView } from '../activity';
import { buildForecast } from '../forecast';
import * as ops from '../operations';
import { clockAt, source, unwrap, usd } from './helpers';

const SETUP = '2026-09-25';
const TODAY = '2026-10-19';

function data() {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-01', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-10-01', { type: 'monthly' }, 'rent');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-15', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'subscription', 'Music', 10.99, '2026-10-10', { type: 'monthly' }, 'music');
  d = source(d, SETUP, 'reserve', 'Savings', 100, '2026-10-05', { type: 'monthly' }, 'save');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Groceries', amountCents: usd(85.50), date: '2026-10-12', tags: ['Food'] }, clockAt(SETUP), 'groc'));

  d = unwrap(ops.recordActual(d, 'pay@2026-10-01', { amountCents: usd(1800), date: '2026-10-01' }, clockAt('2026-10-01')));
  d = unwrap(ops.recordActual(d, 'rent@2026-10-01', { amountCents: usd(1200), date: '2026-10-01' }, clockAt('2026-10-01')));
  d = unwrap(ops.recordActual(d, 'phone@2026-10-15', { amountCents: usd(55), date: '2026-10-16' }, clockAt('2026-10-16')));
  d = unwrap(ops.recordActual(d, 'music@2026-10-10', { amountCents: usd(10.99), date: '2026-10-10' }, clockAt('2026-10-10')));
  d = unwrap(ops.recordActual(d, 'save@2026-10-05', { amountCents: usd(100), date: '2026-10-05' }, clockAt('2026-10-05')));
  d = unwrap(ops.recordActual(d, 'groc', { amountCents: usd(90), date: '2026-10-12' }, clockAt('2026-10-12')));
  return d;
}

describe('activityView', () => {
  it('includes only recorded (completed) entries', () => {
    const d = data();
    const f = buildForecast(d, TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    expect(view.items.length).toBe(6);
    for (const item of view.items) {
      expect(item.entry.occurrence.status).toBe('completed');
    }
  });

  it('sorts items newest first', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    const dates = view.items.map((i) => i.entry.date);
    for (let j = 1; j < dates.length; j++) {
      expect(dates[j]! <= dates[j - 1]!).toBe(true);
    }
  });

  it('computes exact-cents summary: received, paid, cash flow', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    expect(view.summary.incomeCents).toBe(usd(1800));
    expect(view.summary.outflowCents).toBe(usd(1200 + 55 + 10.99 + 90));
    expect(view.summary.reservesCents).toBe(usd(100));
    expect(view.summary.operatingCents).toBe(usd(1800 - 1355.99));
    expect(view.summary.cashFlowCents).toBe(usd(1800 - 1355.99 - 100));
  });

  it('reconciles summary with individual entry amounts', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    let totalIn = 0;
    let totalOut = 0;
    for (const item of view.items) {
      if (item.entry.signedCents > 0) totalIn += item.entry.amountCents;
      else totalOut += item.entry.amountCents;
    }
    expect(totalIn).toBe(view.summary.incomeCents);
    expect(totalOut).toBe(view.summary.outflowCents + view.summary.reservesCents);
  });

  it('provides by-kind breakdown with exact cents', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    expect(view.summary.byKind).toEqual({
      income: usd(1800),
      bill: usd(1255),
      subscription: usd(10.99),
      liability: 0,
      reserve: usd(100),
      varied: usd(90),
    });
  });

  it('provides by-tag breakdown for tagged items', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    expect(view.summary.byTag).toHaveLength(1);
    expect(view.summary.byTag[0]).toEqual({ tag: 'Food', inCents: 0, outCents: usd(90), count: 1 });
  });

  it('includes variance for each recorded item', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    const phone = view.items.find((i) => i.entry.occurrence.description === 'Phone')!;
    expect(phone.variance).toEqual({ amountCents: usd(-5), days: 1 });
    const groceries = view.items.find((i) => i.entry.occurrence.description === 'Groceries')!;
    expect(groceries.variance).toEqual({ amountCents: usd(4.50), days: 0 });
    const paycheck = view.items.find((i) => i.entry.occurrence.description === 'Paycheck')!;
    expect(paycheck.variance).toEqual({ amountCents: 0, days: 0 });
  });

  it('filters items by kind but keeps summary from all recorded entries', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31', 'bill');
    expect(view.items.length).toBe(2);
    expect(view.items.every((i) => i.entry.occurrence.kind === 'bill')).toBe(true);
    expect(view.summary.incomeCents).toBe(usd(1800));
    expect(view.totalCount).toBe(6);
  });

  it('returns empty for a range with no recorded entries', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-12-31' });
    const view = activityView(f, '2026-12-01', '2026-12-31');
    expect(view.items).toEqual([]);
    expect(view.totalCount).toBe(0);
    expect(view.summary.incomeCents).toBe(0);
    expect(view.summary.outflowCents).toBe(0);
    expect(view.summary.cashFlowCents).toBe(0);
    expect(view.summary.byTag).toEqual([]);
  });

  it('excludes canceled entries', () => {
    let d = data();
    d = unwrap(ops.cancelOccurrence(d, 'pay@2026-10-15', 'late', clockAt('2026-10-18')));
    const f = buildForecast(d, TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    expect(view.items.every((i) => i.entry.occurrence.status === 'completed')).toBe(true);
    expect(view.totalCount).toBe(6);
  });

  it('uses actual date and actual amount for recorded entries', () => {
    const f = buildForecast(data(), TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    const phone = view.items.find((i) => i.entry.occurrence.description === 'Phone')!;
    expect(phone.entry.date).toBe('2026-10-16');
    expect(phone.entry.amountCents).toBe(usd(55));
  });

  it('handles reserve releases correctly in by-kind', () => {
    let d = source(ops.emptyData(), SETUP, 'income', 'Pay', 2000, '2026-10-01', { type: 'monthly' }, 'inc');
    d = source(d, SETUP, 'reserve', 'Savings', 200, '2026-10-05', { type: 'monthly' }, 'sav');
    d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Emergency withdrawal', amountCents: usd(50), date: '2026-10-10', release: true }, clockAt(SETUP), 'rel'));
    d = unwrap(ops.recordActual(d, 'inc@2026-10-01', { amountCents: usd(2000), date: '2026-10-01' }, clockAt('2026-10-01')));
    d = unwrap(ops.recordActual(d, 'sav@2026-10-05', { amountCents: usd(200), date: '2026-10-05' }, clockAt('2026-10-05')));
    d = unwrap(ops.recordActual(d, 'rel', { amountCents: usd(50), date: '2026-10-10' }, clockAt('2026-10-10')));
    const f = buildForecast(d, TODAY, { through: '2026-10-31' });
    const view = activityView(f, '2026-10-01', '2026-10-31');
    expect(view.summary.byKind.reserve).toBe(usd(150));
    expect(view.summary.cashFlowCents).toBe(usd(2000 - 150));
  });
});
