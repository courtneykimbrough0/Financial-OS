import { describe, expect, it } from 'vitest';
import { buildForecast, tallyOn } from '../forecast';
import * as ops from '../operations';
import { monthlyFactor, monthlyPlan } from '../plan';
import { buildSampleData } from '../sample';
import { groupOf } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

const TODAY = '2026-10-11';

describe('monthly equivalents', () => {
  it('converts each schedule to an average month', () => {
    expect(monthlyFactor({ type: 'weekly' })).toBeCloseTo(52 / 12);
    expect(monthlyFactor({ type: 'biweekly' })).toBeCloseTo(26 / 12);
    expect(monthlyFactor({ type: 'twiceMonthly', days: [1, 15] })).toBe(2);
    expect(monthlyFactor({ type: 'monthly' })).toBe(1);
    expect(monthlyFactor({ type: 'custom', interval: 3, unit: 'month' })).toBeCloseTo(1 / 3);
    expect(monthlyFactor({ type: 'custom', interval: 2, unit: 'week' })).toBeCloseTo(26 / 12);
    expect(monthlyFactor({ type: 'custom', interval: 10, unit: 'day' })).toBeCloseTo(365 / 120);
  });
});

describe('left to spend', () => {
  function data() {
    let d = ops.emptyData();
    d = source(d, TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay'); // 3,900.00 / mo
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent'); // 1,200.00
    d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, 'phone'); // 60.00
    d = source(d, TODAY, 'subscription', 'Music', 10.99, '2026-10-20', { type: 'monthly' }, 'music'); // 10.99
    d = source(d, TODAY, 'liability', 'Car loan', 350, '2026-10-20', { type: 'monthly' }, 'car'); // 350.00
    d = source(d, TODAY, 'savings', 'Emergency fund', 50, '2026-10-16', { type: 'weekly' }, 'save'); // 216.67
    d = source(d, TODAY, 'spending', 'Groceries', 120, '2026-10-12', { type: 'weekly' }, 'food'); // 520.00
    return d;
  }

  it('is income minus expenses, with savings and spending reported separately', () => {
    const plan = monthlyPlan(data(), TODAY);
    expect(plan.incomeCents).toBe(usd(3900));
    expect(plan.byKind.bill).toBe(usd(1260));
    expect(plan.byKind.subscription).toBe(usd(10.99));
    expect(plan.byKind.liability).toBe(usd(350));
    expect(plan.expensesCents).toBe(usd(1620.99));
    expect(plan.leftToSpendCents).toBe(usd(3900 - 1620.99));
    expect(plan.savingsCents).toBe(usd(216.67));
    expect(plan.spendingCents).toBe(usd(520));
  });

  it('every total is the exact sum of the items under it', () => {
    const plan = monthlyPlan(data(), TODAY);
    for (const [kind, items] of Object.entries(plan.items)) {
      expect(items.reduce((s, i) => s + i.monthlyCents, 0)).toBe(plan.byKind[kind as keyof typeof plan.byKind]);
    }
    expect(plan.incomeCents - plan.expensesCents).toBe(plan.leftToSpendCents);
  });

  it('updates as items are added, and goes negative when expenses exceed income', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Pay', 1000, '2026-10-15', { type: 'monthly' }, 'p');
    expect(monthlyPlan(d, TODAY).leftToSpendCents).toBe(usd(1000));
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'r');
    expect(monthlyPlan(d, TODAY).leftToSpendCents).toBe(usd(-200));
  });

  it('leaves out turned-off items and one-time transactions', () => {
    let d = unwrap(ops.deactivateSource(data(), 'phone', clockAt(TODAY)));
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Repair', amountCents: usd(500), date: '2026-10-30' }, clockAt(TODAY)));
    const plan = monthlyPlan(d, TODAY);
    expect(plan.byKind.bill).toBe(usd(1200));
  });

  it('uses the schedule in effect today, not a future change', () => {
    let d = data();
    d = unwrap(ops.changeSourceSchedule(d, 'rent', { startDate: '2027-01-01', amountCents: usd(1300), rule: { type: 'monthly' } }, clockAt(TODAY)));
    expect(monthlyPlan(d, TODAY).byKind.bill).toBe(usd(1260));
    expect(monthlyPlan(d, '2027-01-02').byKind.bill).toBe(usd(1360));
  });
});

describe('categories', () => {
  it('group into Income, Expenses (bills, subscriptions, liabilities), Savings, Spending', () => {
    expect(groupOf('income')).toBe('income');
    expect(groupOf('bill')).toBe('expenses');
    expect(groupOf('subscription')).toBe('expenses');
    expect(groupOf('liability')).toBe('expenses');
    expect(groupOf('savings')).toBe('savings');
    expect(groupOf('spending')).toBe('spending');
  });

  it('savings and spending are money out in the forecast', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Pay', 1000, '2026-10-15', { type: 'monthly' }, 'p');
    d = source(d, TODAY, 'savings', 'Save', 100, '2026-10-16', { type: 'monthly' }, 's');
    d = source(d, TODAY, 'spending', 'Food', 50, '2026-10-17', { type: 'monthly' }, 'f');
    expect(tallyOn(buildForecast(d, TODAY), '2026-10-17')).toBe(usd(850));
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

  it('are saved on recurring and one-time items and totaled per month', () => {
    let d = ops.emptyData();
    d = unwrap(ops.addSource(d, { kind: 'income', description: 'Pay', amountCents: usd(2000), startDate: '2026-10-15', rule: { type: 'monthly' }, tags: ['Work'] }, clockAt(TODAY), 'p'));
    d = unwrap(ops.addSource(d, { kind: 'bill', description: 'Rent', amountCents: usd(1200), startDate: '2026-11-01', rule: { type: 'monthly' }, tags: ['Housing'] }, clockAt(TODAY), 'r'));
    d = unwrap(ops.addSource(d, { kind: 'spending', description: 'Games', amountCents: usd(15), startDate: '2026-10-20', rule: { type: 'weekly' }, tags: ['Gaming', 'fun'] }, clockAt(TODAY), 'g'));
    d = unwrap(ops.addSource(d, { kind: 'bill', description: 'Power', amountCents: usd(100), startDate: '2026-10-20', rule: { type: 'monthly' }, tags: ['housing'] }, clockAt(TODAY), 'e'));
    d = unwrap(ops.addOneTime(d, { kind: 'spending', description: 'Console', amountCents: usd(400), date: '2026-10-25', tags: ['Gaming'] }, clockAt(TODAY)));
    expect(ops.allTags(d)).toEqual(['fun', 'Gaming', 'Housing', 'Work']);
    const byTag = Object.fromEntries(monthlyPlan(d, TODAY).byTag.map((t) => [t.tag, [t.inCents, t.outCents, t.count]]));
    expect(byTag).toEqual({
      Work: [usd(2000), 0, 1],
      Housing: [0, usd(1300), 2],
      Gaming: [0, usd(65), 1],
      fun: [0, usd(65), 1],
    });
    // Occurrences carry their tags for display.
    const f = buildForecast(d, TODAY);
    expect(f.entries.find((e) => e.occurrence.sourceId === 'g')!.occurrence.tags).toEqual(['Gaming', 'fun']);
  });

  it('can be changed without touching amounts or history', () => {
    let d = source(ops.emptyData(), TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'r');
    d = unwrap(ops.updateSourceDetails(d, 'r', { description: 'Rent', tags: ['Home'] }, clockAt(TODAY)));
    expect(d.sources[0]!.tags).toEqual(['Home']);
    expect(d.sources[0]!.versions[0]!.amountCents).toBe(usd(1200));
  });
});
