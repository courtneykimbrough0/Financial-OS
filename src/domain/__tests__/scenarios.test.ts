import { describe, expect, it } from 'vitest';
import { dismissEstimate, analyzeEstimate } from '../estimates';
import { buildForecast, dailyTimeline, explainTimingGaps, lowestPoint, periodKpis, tallyOn } from '../forecast';
import * as ops from '../operations';
import { evaluateIncomeCases, evaluateScenario, firstShortfall, scenarioOptions, type ScenarioChange, type ScenarioResult } from '../scenarios';
import type { AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

/*
 * Today is Fri 2026-10-16. Paid $1,000 every other Friday from Oct 23 (the
 * running total starts Oct 22); rent $1,500 on the 1st from Nov 1; a car
 * loan payment of $300 on the 28th from Oct 28. The period runs to Jan 20,
 * 2027 (90 days from Oct 23). Running totals as the plan stands:
 *   Oct 23  1,000   Oct 28  700   Nov 1  −800   Nov 6  200   Nov 20  1,200
 *   Nov 28    900   Dec 1  −600   Dec 4   400   Dec 18 1,400 Dec 28  1,100
 *   Jan 1     600   Jan 15 1,600
 * Gaps: Nov 1–5 (down to −$800) and Dec 1–3 (−$600). Cash flow: 7 paychecks
 * (+$7,000), rent ×3 and the loan ×3 (−$5,400), +$1,600.
 */
const TODAY = '2026-10-16';
const clock = clockAt(TODAY);

function plan(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, TODAY, 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
  return source(d, TODAY, 'liability', 'Car loan', 300, '2026-10-28', { type: 'monthly' }, 'loan');
}

function run(changes: ScenarioChange[], d = plan(), options: { through?: string } = {}): ScenarioResult {
  const r = evaluateScenario(d, changes, clock, options);
  if (!r.ok) throw new Error(r.error);
  return r.result;
}
const gap = (g: { start: string; end: string; lowestCents: number; recoversOn: string | null }) => [g.start, g.end, g.lowestCents, g.recoversOn];

describe('the baseline', () => {
  it('matches the hand-worked plan', () => {
    const r = run([{ kind: 'one-time-expense', description: 'Nothing', amountCents: 1, date: '2027-03-01' }]);
    expect(r.period).toEqual({ start: '2026-10-16', end: '2027-01-20', runningTotalFrom: '2026-10-23' });
    expect(r.baseline).toMatchObject({
      forecastStart: '2026-10-23',
      anchor: '2026-10-22',
      cashFlow: { confirmedIncomeCents: 700000, hypotheticalIncomeCents: 0, outflowCents: 540000, netCents: 160000, netWithoutHypotheticalCents: 160000 },
      lowest: { date: '2026-11-01', tallyCents: -80000 },
      endingCents: 160000,
    });
    expect(r.baseline.gaps.map(gap)).toEqual([
      ['2026-11-01', '2026-11-05', -80000, '2026-11-06'],
      ['2026-12-01', '2026-12-03', -60000, '2026-12-04'],
    ]);
  });
});

describe('one-time changes', () => {
  it('additional income: hypothetical, counted separately, and gaps get smaller', () => {
    const r = run([{ kind: 'one-time-income', description: 'Bonus', amountCents: usd(500), date: '2026-11-01' }]);
    expect(r.assumptions).toEqual([
      { change: { kind: 'one-time-income', description: 'Bonus', amountCents: 50000, date: '2026-11-01' }, label: 'Bonus: +$500.00 once on Nov 1, 2026 (hypothetical)', direction: 'in', amountCents: 50000, recurrence: 'one-time', dates: ['2026-11-01'], income: 'hypothetical', inRunningTotal: true },
    ]);
    expect(r.scenario.cashFlow).toEqual({ confirmedIncomeCents: 700000, hypotheticalIncomeCents: 50000, outflowCents: 540000, netCents: 210000, netWithoutHypotheticalCents: 160000 });
    // Nov 1: 1,000 − 300 + 500 − 1,500 = −300; every later total is $500 higher.
    expect(r.scenario.lowest).toEqual({ date: '2026-11-01', tallyCents: -30000 });
    expect(r.differences).toEqual({ incomeCents: 50000, outflowCents: 0, netCents: 50000, lowestCents: 50000, endingCents: 50000 });
    expect(r.reducedGaps.map(gap)).toEqual([
      ['2026-11-01', '2026-11-05', -30000, '2026-11-06'],
      ['2026-12-01', '2026-12-03', -10000, '2026-12-04'],
    ]);
    expect([r.newGaps, r.worsenedGaps, r.resolvedGaps, r.shortfallDespiteGain]).toEqual([[], [], [], false]);
  });

  it('an unexpected expense: new and deeper gaps, with recovery dates', () => {
    const r = run([{ kind: 'one-time-expense', description: 'Car repair', amountCents: usd(800), date: '2026-11-10' }]);
    expect(r.assumptions[0]).toMatchObject({ label: 'Car repair: −$800.00 once on Nov 10, 2026', direction: 'out', income: null, recurrence: 'one-time' });
    // Nov 10 −600; Nov 20 400; Nov 28 100; Dec 1 −1,400; Dec 4 −400; Dec 18 600; Dec 28 300; Jan 1 −200; Jan 15 800.
    expect(r.scenario.gaps.map(gap)).toEqual([
      ['2026-11-01', '2026-11-05', -80000, '2026-11-06'],
      ['2026-11-10', '2026-11-19', -60000, '2026-11-20'],
      ['2026-12-01', '2026-12-17', -140000, '2026-12-18'],
      ['2027-01-01', '2027-01-14', -20000, '2027-01-15'],
    ]);
    expect(r.newGaps.map((g) => g.start)).toEqual(['2026-11-10', '2027-01-01']);
    expect(r.worsenedGaps.map((g) => g.start)).toEqual(['2026-12-01']);
    expect(r.differences).toEqual({ incomeCents: 0, outflowCents: 80000, netCents: -80000, lowestCents: -60000, endingCents: -80000 });
    expect(r.scenario.lowest).toEqual({ date: '2026-12-01', tallyCents: -140000 });
  });

  it('an extra liability payment counts as money out once', () => {
    const r = run([{ kind: 'extra-liability-payment', sourceId: 'loan', amountCents: usd(200), date: '2026-11-15' }]);
    expect(r.assumptions[0]).toMatchObject({ label: 'Extra payment on Car loan: −$200.00 once on Nov 15, 2026', direction: 'out', dates: ['2026-11-15'] });
    // Nov 15: 200 − 200 = 0, which isn't a gap; Dec 1 −800.
    expect(r.worsenedGaps.map(gap)).toEqual([['2026-12-01', '2026-12-03', -80000, '2026-12-04']]);
    expect(r.newGaps).toEqual([]);
    expect(r.differences.endingCents).toBe(-20000);
  });

  it('moving a date', () => {
    const r = run([{ kind: 'occurrence-date', occurrenceId: 'loan@2026-11-28', date: '2026-12-05' }]);
    expect(r.assumptions[0]).toMatchObject({ label: 'Car loan: Nov 28, 2026 → Dec 5, 2026 ($300.00)', dates: ['2026-12-05'], recurrence: 'one-time' });
    // Dec 1: 1,200 − 1,500 = −300; Dec 4 700; Dec 5 400.
    expect(r.reducedGaps.map(gap)).toEqual([['2026-12-01', '2026-12-03', -30000, '2026-12-04']]);
    expect(r.differences).toMatchObject({ lowestCents: 0, endingCents: 0, netCents: 0 });
  });

  it('a higher and a lower expected amount', () => {
    const up = run([{ kind: 'occurrence-amount', occurrenceId: 'rent@2026-12-01', amountCents: usd(1700) }]);
    expect(up.assumptions[0]!.label).toBe('Rent on Dec 1, 2026: $1,500.00 → $1,700.00');
    expect(up.worsenedGaps.map(gap)).toEqual([['2026-12-01', '2026-12-03', -80000, '2026-12-04']]);
    expect(up.differences).toEqual({ incomeCents: 0, outflowCents: 20000, netCents: -20000, lowestCents: 0, endingCents: -20000 });
    const down = run([{ kind: 'occurrence-amount', occurrenceId: 'rent@2026-12-01', amountCents: usd(1000) }]);
    expect(down.reducedGaps.map(gap)).toEqual([['2026-12-01', '2026-12-03', -10000, '2026-12-04']]);
    expect(down.differences).toEqual({ incomeCents: 0, outflowCents: -50000, netCents: 50000, lowestCents: 0, endingCents: 50000 });
  });
});

describe('several changes together', () => {
  const changes: ScenarioChange[] = [
    { kind: 'one-time-income', description: 'Bonus', amountCents: usd(500), date: '2026-11-01' },
    { kind: 'one-time-expense', description: 'Car repair', amountCents: usd(800), date: '2026-11-10' },
    { kind: 'occurrence-date', occurrenceId: 'rent@2026-12-01', date: '2026-12-04' },
  ];

  it('applies them in order and lists each assumption', () => {
    const r = run(changes);
    expect(r.assumptions.map((a) => a.label)).toEqual(['Bonus: +$500.00 once on Nov 1, 2026 (hypothetical)', 'Car repair: −$800.00 once on Nov 10, 2026', 'Rent: Dec 1, 2026 → Dec 4, 2026 ($1,500.00)']);
    // Nov 1 −300; Nov 6 700; Nov 10 −100; Nov 20 900; Nov 28 600; Dec 4 600 + 1,000 − 1,500 = 100; … Jan 15 1,300.
    expect(r.scenario.gaps.map(gap)).toEqual([
      ['2026-11-01', '2026-11-05', -30000, '2026-11-06'],
      ['2026-11-10', '2026-11-19', -10000, '2026-11-20'],
    ]);
    expect(r.newGaps.map((g) => g.start)).toEqual(['2026-11-10']);
    expect(r.reducedGaps.map((g) => g.start)).toEqual(['2026-11-01']);
    expect(r.resolvedGaps.map((g) => g.start)).toEqual(['2026-12-01']);
    expect(r.differences).toEqual({ incomeCents: 50000, outflowCents: 80000, netCents: -30000, lowestCents: 50000, endingCents: -30000 });
  });

  it('reconciles exactly with buildForecast on the same changes made by hand', () => {
    let d = plan();
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Bonus', amountCents: usd(500), date: '2026-11-01' }, clock));
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Car repair', amountCents: usd(800), date: '2026-11-10' }, clock));
    d = unwrap(ops.rescheduleOccurrence(d, 'rent@2026-12-01', { date: '2026-12-04', amountCents: usd(1500) }, clock));
    const f = buildForecast(d, TODAY);
    const r = run(changes);
    const k = periodKpis(f, TODAY, '2027-01-20');
    expect([r.scenario.cashFlow.confirmedIncomeCents + r.scenario.cashFlow.hypotheticalIncomeCents, r.scenario.cashFlow.outflowCents, r.scenario.cashFlow.netCents]).toEqual([k.incomeCents, k.outflowCents, k.netCents]);
    expect(r.scenario.lowest).toEqual(lowestPoint(dailyTimeline(f, '2026-10-23', '2027-01-20')));
    expect(r.scenario.endingCents).toBe(tallyOn(f, '2027-01-20'));
    expect(r.scenario.gaps.map(gap)).toEqual(explainTimingGaps(f).map(gap));
  });

  it('a better ending with an earlier shortfall says so', () => {
    const r = run([
      { kind: 'one-time-income', description: 'Tax refund', amountCents: usd(2000), date: '2027-01-10' },
      { kind: 'one-time-expense', description: 'Dentist', amountCents: usd(900), date: '2026-11-10' },
    ]);
    // Nov 10 −700; Nov 20 300; Nov 28 0; Dec 1 −1,500; Dec 4 −500; Dec 18 500; Dec 28 200; Jan 1 −300; Jan 10 1,700; Jan 15 2,700.
    expect(r.differences.endingCents).toBe(110000);
    expect(r.shortfallDespiteGain).toBe(true);
    expect(r.newGaps.map(gap)).toEqual([
      ['2026-11-10', '2026-11-19', -70000, '2026-11-20'],
      ['2027-01-01', '2027-01-09', -30000, '2027-01-10'],
    ]);
    expect(r.worsenedGaps.map(gap)).toEqual([['2026-12-01', '2026-12-17', -150000, '2026-12-18']]);
    expect(r.scenario.lowest).toEqual({ date: '2026-12-01', tallyCents: -150000 });
    expect(r.differences.lowestCents).toBe(-70000);
  });

  it('removing one shortfall while creating another shows both', () => {
    const r = run([
      { kind: 'occurrence-date', occurrenceId: 'rent@2026-11-01', date: '2026-11-06' },
      { kind: 'occurrence-amount', occurrenceId: 'rent@2027-01-01', amountCents: usd(2200) },
    ]);
    // Nov 6: 700 + 1,000 − 1,500 = 200; Jan 1: 1,100 + 1,000 − 2,200 = −100.
    expect(r.resolvedGaps.map((g) => g.start)).toEqual(['2026-11-01']);
    expect(r.newGaps.map(gap)).toEqual([['2027-01-01', '2027-01-14', -10000, '2027-01-15']]);
    expect(r.scenario.gaps.map((g) => g.start)).toEqual(['2026-12-01', '2027-01-01']);
    expect(r.differences).toMatchObject({ lowestCents: 20000, endingCents: -70000 });
  });
});

describe('recurring changes', () => {
  it('a higher liability payment from one of its dates', () => {
    const r = run([{ kind: 'recurring-amount', sourceId: 'loan', amountCents: usd(450), from: '2026-11-28' }]);
    expect(r.assumptions[0]).toMatchObject({ label: 'Car loan: $300.00 → $450.00 each time from Nov 28, 2026', recurrence: 'recurring', amountCents: 45000, dates: ['2026-11-28', '2026-12-28'], inRunningTotal: true });
    // Nov 28 750; Dec 1 −750.
    expect(r.worsenedGaps.map(gap)).toEqual([['2026-12-01', '2026-12-03', -75000, '2026-12-04']]);
    expect(r.differences).toEqual({ incomeCents: 0, outflowCents: 30000, netCents: -30000, lowestCents: 0, endingCents: -30000 });
  });

  it('savings from each paycheck', () => {
    const r = run([{ kind: 'recurring-savings', description: 'Emergency fund', amountCents: usd(100), schedule: 'each-paycheck' }]);
    expect(r.assumptions[0]).toMatchObject({
      label: 'Emergency fund: −$100.00 every 2 weeks from Oct 23, 2026',
      direction: 'out',
      recurrence: 'recurring',
      dates: ['2026-10-23', '2026-11-06', '2026-11-20', '2026-12-04', '2026-12-18', '2027-01-01', '2027-01-15'],
    });
    // Each payday nets $900: Nov 1 −900, Nov 6 0, Dec 1 −900, Dec 4 0, Jan 1 0, Jan 15 900.
    expect(r.scenario.gaps.map(gap)).toEqual([
      ['2026-11-01', '2026-11-05', -90000, '2026-11-06'],
      ['2026-12-01', '2026-12-03', -90000, '2026-12-04'],
    ]);
    expect(r.differences).toEqual({ incomeCents: 0, outflowCents: 70000, netCents: -70000, lowestCents: -10000, endingCents: -70000 });
  });

  it('across month ends and the year end', () => {
    const r = run(
      [
        { kind: 'recurring-savings', description: 'Car fund', amountCents: usd(50), schedule: { startDate: '2026-10-31', rule: { type: 'monthly' } } },
        { kind: 'recurring-amount', sourceId: 'loan', amountCents: usd(350), from: '2026-12-28' },
      ],
      plan(),
      { through: '2027-02-28' },
    );
    expect(r.period.end).toBe('2027-02-28');
    expect(r.assumptions.map((a) => a.dates)).toEqual([
      ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'],
      ['2026-12-28', '2027-01-28', '2027-02-28'],
    ]);
    // 5 × $50 + 3 × $50 more.
    expect(r.differences.outflowCents).toBe(40000);
  });
});

describe('variable income', () => {
  const tips = { description: 'Delivery tips', schedule: { startDate: '2026-10-24', rule: { type: 'weekly' as const } }, lowCents: 0, expectedCents: usd(60), highCents: usd(120) };

  it('three cases, all hypothetical, none added to the plan', () => {
    const d = plan();
    const before = JSON.stringify(d);
    const r = evaluateIncomeCases(d, [], tips, clock);
    if (!r.ok) throw new Error(r.error);
    expect(JSON.stringify(d)).toBe(before);
    const { low, expected, high } = r.cases;
    // 13 Saturdays from Oct 24 to Jan 16.
    expect(expected.assumptions).toEqual([
      expect.objectContaining({ label: 'Delivery tips: +$60.00 every week from Oct 24, 2026 (hypothetical)', income: 'hypothetical', incomeCase: 'expected', recurrence: 'recurring' }),
    ]);
    expect(expected.assumptions[0]!.dates).toHaveLength(13);
    expect(expected.scenario.cashFlow).toEqual({ confirmedIncomeCents: 700000, hypotheticalIncomeCents: 78000, outflowCents: 540000, netCents: 238000, netWithoutHypotheticalCents: 160000 });
    // Expected: Nov 1 −800 + 2 × 60 = −680; Dec 1 −600 + 6 × 60 = −240.
    expect(expected.scenario.gaps.map((g) => [g.start, g.lowestCents])).toEqual([
      ['2026-11-01', -68000],
      ['2026-12-01', -24000],
    ]);
    // High: Nov 1 −560; Dec 1 −600 + 720 = 120, no gap.
    expect(high.scenario.gaps.map((g) => [g.start, g.lowestCents])).toEqual([['2026-11-01', -56000]]);
    expect(high.resolvedGaps.map((g) => g.start)).toEqual(['2026-12-01']);
    expect(high.scenario.endingCents).toBe(316000);
    // Low: $0, so the plan as it is.
    expect(low.assumptions).toEqual([expect.objectContaining({ label: 'Delivery tips: $0.00 (low case, hypothetical)', amountCents: 0, income: 'hypothetical', incomeCase: 'low' })]);
    expect(low.differences).toEqual({ incomeCents: 0, outflowCents: 0, netCents: 0, lowestCents: 0, endingCents: 0 });
    expect(low.scenario).toEqual(low.baseline);
  });

  it('cases combine with other changes', () => {
    const r = evaluateIncomeCases(plan(), [{ kind: 'one-time-expense', description: 'Car repair', amountCents: usd(800), date: '2026-11-10' }], { ...tips, lowCents: usd(20) }, clock);
    if (!r.ok) throw new Error(r.error);
    expect(r.cases.low.assumptions.map((a) => a.label)).toEqual(['Car repair: −$800.00 once on Nov 10, 2026', 'Delivery tips: +$20.00 every week from Oct 24, 2026 (hypothetical)']);
    expect(r.cases.low.scenario.cashFlow.hypotheticalIncomeCents).toBe(26000);
    expect(r.cases.low.differences.netCents).toBe(-54000);
  });

  it('rejects cases out of order or below $0', () => {
    expect(evaluateIncomeCases(plan(), [], { ...tips, lowCents: usd(80) }, clock)).toEqual({ ok: false, error: 'The low case can’t be more than expected, and expected can’t be more than high.' });
    expect(evaluateIncomeCases(plan(), [], { ...tips, lowCents: -1 }, clock)).toEqual({ ok: false, error: 'Enter each income case as $0 or more.' });
    expect(evaluateIncomeCases(plan(), [], { ...tips, schedule: null }, clock)).toEqual({ ok: false, error: 'Choose the date the income might arrive.' });
  });
});

describe('confirmed and hypothetical income', () => {
  it('hypothetical recurring income never becomes the main paycheck or changes confirmed income', () => {
    const r = run([{ kind: 'hypothetical-income', description: 'Side gig', amountCents: usd(200), schedule: { startDate: '2026-10-20', rule: { type: 'weekly' } } }]);
    expect(r.comparable).toBe(true);
    expect(r.scenario.forecastStart).toBe('2026-10-23');
    expect(r.scenario.cashFlow.confirmedIncomeCents).toBe(700000);
    // Oct 20 is before payday: cash flow, not the running total.
    expect(r.assumptions[0]).toMatchObject({ income: 'hypothetical', inRunningTotal: false });
  });

  it('with no confirmed income, hypothetical income doesn’t create a running total to compare', () => {
    let d = unwrap(ops.completeOnboarding(ops.emptyData()));
    d = source(d, TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
    const r = run([{ kind: 'hypothetical-income', description: 'Side gig', amountCents: usd(400), schedule: { startDate: '2026-10-23', rule: { type: 'weekly' } } }], d);
    expect(r).toMatchObject({ comparable: false, reason: 'no-forecast', differences: { lowestCents: null, endingCents: null }, newGaps: [] });
    expect(r.limitations[0]).toBe('There’s no upcoming income to start a running total from, so only cash flow is compared.');
  });
});

describe('forecast anchor', () => {
  it('moving the next payday makes the running totals not comparable', () => {
    const r = run([{ kind: 'occurrence-date', occurrenceId: 'pay@2026-10-23', date: '2026-10-26' }]);
    expect(r).toMatchObject({ comparable: false, reason: 'anchor-changed', differences: { incomeCents: 0, outflowCents: 0, netCents: 0, lowestCents: null, endingCents: null } });
    expect(r.limitations[0]).toBe('This scenario moves your next payday from Oct 23, 2026 to Oct 26, 2026, so the running totals start on different days and can’t be compared directly.');
  });

  it('moving a payment to before the next payday isn’t shown as a fix', () => {
    const r = run([{ kind: 'occurrence-date', occurrenceId: 'loan@2026-10-28', date: '2026-10-20' }]);
    expect(r).toMatchObject({ comparable: false, reason: 'before-payday' });
    expect(r.limitations[0]).toBe('Car loan would move to before your next payday (Oct 23, 2026), where the running total starts, so it would drop out of it. The forecast can’t show whether money on hand covers it.');
  });

  it('an expense before the next payday counts in cash flow, not the running total', () => {
    const r = run([{ kind: 'one-time-expense', description: 'Groceries', amountCents: usd(50), date: '2026-10-19' }]);
    expect(r.comparable).toBe(true);
    expect(r.assumptions[0]!.inRunningTotal).toBe(false);
    expect(r.limitations).toEqual(['Groceries: −$50.00 once on Oct 19, 2026: dates before your next payday (Oct 23, 2026) count in cash flow but not in the running total, which starts that day.']);
    expect(r.differences).toEqual({ incomeCents: 0, outflowCents: 5000, netCents: -5000, lowestCents: 0, endingCents: 0 });
  });
});

describe('the plan is never changed', () => {
  it('sources, records, history, review rhythm and dismissals stay exactly as they were', () => {
    let d = plan();
    d = unwrap(ops.setReviewCadence(d, 'weekly'));
    d = source(d, '2026-06-03', 'bill', 'Phone', 60, '2026-06-25', { type: 'monthly' }, 'phone');
    for (const date of ['2026-07-25', '2026-08-25', '2026-09-25']) d = unwrap(ops.recordActual(d, `phone@${date}`, { amountCents: usd(65), date }, clock));
    d = unwrap(ops.recordActual(d, 'phone@2026-06-25', { amountCents: usd(60), date: '2026-06-25' }, clock));
    d = unwrap(dismissEstimate(d, analyzeEstimate(d, 'phone', TODAY).suggestion!, clock));
    d = unwrap(ops.changeSourceSchedule(d, 'phone', { startDate: '2026-10-25', amountCents: usd(62), rule: { type: 'monthly' } }, clock));
    const before = JSON.stringify(d);
    const forecast = buildForecast(d, TODAY);
    run(
      [
        { kind: 'one-time-income', description: 'Bonus', amountCents: usd(500), date: '2026-11-01' },
        { kind: 'occurrence-amount', occurrenceId: 'rent@2026-12-01', amountCents: usd(1700) },
        { kind: 'occurrence-date', occurrenceId: 'loan@2026-11-28', date: '2026-12-02' },
        { kind: 'recurring-amount', sourceId: 'loan', amountCents: usd(400), from: '2026-12-28' },
        { kind: 'recurring-savings', description: 'Savings', amountCents: usd(100), schedule: 'each-paycheck' },
        { kind: 'extra-liability-payment', sourceId: 'loan', amountCents: usd(100), date: '2026-11-15' },
      ],
      d,
    );
    expect(JSON.stringify(d)).toBe(before);
    expect(buildForecast(d, TODAY)).toEqual(forecast);
  });

  it('gives identical results every time', () => {
    const changes: ScenarioChange[] = [
      { kind: 'one-time-expense', description: 'Car repair', amountCents: usd(800), date: '2026-11-10' },
      { kind: 'recurring-savings', description: 'Savings', amountCents: usd(100), schedule: 'each-paycheck' },
    ];
    expect(run(changes)).toEqual(run(changes));
  });
});

describe('invalid assumptions', () => {
  const err = (changes: ScenarioChange[], d = plan()) => {
    const r = evaluateScenario(d, changes, clock);
    return r.ok ? null : r.error;
  };

  it('are refused with a reason, naming the change when there are several', () => {
    expect(err([])).toBe('Add at least one change.');
    expect(err([{ kind: 'one-time-expense', description: 'Repair', amountCents: 0, date: '2026-11-10' }])).toBe('Amount must be greater than $0.');
    expect(err([{ kind: 'one-time-income', description: 'Bonus', amountCents: 100, date: '2026-10-01' }])).toBe('Hypothetical changes need today or a later date.');
    expect(err([{ kind: 'one-time-income', description: ' ', amountCents: 100, date: '2026-11-01' }])).toMatch(/description|name/i);
    expect(err([{ kind: 'occurrence-amount', occurrenceId: 'rent@2026-11-02', amountCents: 100 }])).toBe('That transaction could not be found.');
    expect(err([{ kind: 'extra-liability-payment', sourceId: 'rent', amountCents: 100, date: '2026-11-10' }])).toBe('Choose one of your liability payments.');
    expect(err([{ kind: 'recurring-amount', sourceId: 'loan', amountCents: 100, from: '2026-11-15' }])).toBe('Choose one of Car loan’s upcoming payment dates to start from.');
    expect(
      err([
        { kind: 'one-time-income', description: 'Bonus', amountCents: 100, date: '2026-11-01' },
        { kind: 'occurrence-date', occurrenceId: 'rent@2026-11-01', date: '2026-10-01' },
      ]),
    ).toBe('Change 2: Hypothetical changes need today or a later date.');
    expect(
      err([
        { kind: 'occurrence-amount', occurrenceId: 'rent@2026-11-01', amountCents: 100 },
        { kind: 'occurrence-date', occurrenceId: 'rent@2026-11-01', date: '2026-11-03' },
      ]),
    ).toBe('Change each transaction only once in a scenario.');
  });

  it('refuses a recorded occurrence, a pending schedule change, and paycheck savings with no paycheck', () => {
    const paid = unwrap(ops.recordActual(plan(), 'loan@2026-10-28', { amountCents: usd(300), date: TODAY }, clock));
    expect(err([{ kind: 'occurrence-amount', occurrenceId: 'loan@2026-10-28', amountCents: 100 }], paid)).toBe('Car loan on Oct 28, 2026 has already been recorded or canceled.');
    const pending = unwrap(ops.changeSourceSchedule(plan(), 'loan', { startDate: '2026-12-28', amountCents: usd(350), rule: { type: 'monthly' } }, clock));
    expect(err([{ kind: 'recurring-amount', sourceId: 'loan', amountCents: 100, from: '2026-11-28' }], pending)).toBe('Car loan already has a change set for Dec 28, 2026, so a scenario can’t change its amount yet.');
    const noPay = source(unwrap(ops.completeOnboarding(ops.emptyData())), TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
    expect(err([{ kind: 'recurring-savings', description: 'Savings', amountCents: 100, schedule: 'each-paycheck' }], noPay)).toBe('There’s no main paycheck to follow. Choose dates instead.');
  });
});

describe('choosing and summarizing', () => {
  it('lists upcoming payments and liability dates to choose from', () => {
    const o = scenarioOptions(plan(), TODAY);
    // Through Jan 14, 2027 (90 days from today), in forecast order.
    expect(o.occurrences.map((x) => [x.id, x.date, x.amountCents])).toEqual([
      ['pay@2026-10-23', '2026-10-23', 100000],
      ['loan@2026-10-28', '2026-10-28', 30000],
      ['rent@2026-11-01', '2026-11-01', 150000],
      ['pay@2026-11-06', '2026-11-06', 100000],
      ['pay@2026-11-20', '2026-11-20', 100000],
      ['loan@2026-11-28', '2026-11-28', 30000],
      ['rent@2026-12-01', '2026-12-01', 150000],
      ['pay@2026-12-04', '2026-12-04', 100000],
      ['pay@2026-12-18', '2026-12-18', 100000],
      ['loan@2026-12-28', '2026-12-28', 30000],
      ['pay@2027-01-01', '2027-01-01', 100000],
      ['rent@2027-01-01', '2027-01-01', 150000],
    ]);
    expect(o.liabilities).toEqual([{ sourceId: 'loan', description: 'Car loan', amountCents: 30000, dates: ['2026-10-28', '2026-11-28', '2026-12-28', '2027-01-28', '2027-02-28', '2027-03-28'] }]);
    // A liability with a change already set can't be changed in a scenario, so it isn't offered.
    const pending = unwrap(ops.changeSourceSchedule(plan(), 'loan', { startDate: '2026-12-28', amountCents: usd(350), rule: { type: 'monthly' } }, clock));
    expect(scenarioOptions(pending, TODAY).liabilities).toEqual([]);
  });

  it('points to the earliest new or deeper shortfall, and whether the ending still looks better', () => {
    const better = run([
      { kind: 'one-time-income', description: 'Tax refund', amountCents: usd(2000), date: '2027-01-10' },
      { kind: 'one-time-expense', description: 'Dentist', amountCents: usd(900), date: '2026-11-10' },
    ]);
    expect(firstShortfall(better)).toMatchObject({ gap: { start: '2026-11-10', lowestDate: '2026-11-10', lowestCents: -70000 }, created: true, despiteGain: true });
    const repair = run([{ kind: 'one-time-expense', description: 'Car repair', amountCents: usd(800), date: '2026-11-10' }]);
    expect(firstShortfall(repair)).toMatchObject({ gap: { start: '2026-11-10', lowestCents: -60000 }, created: true, despiteGain: false });
    const deeper = run([{ kind: 'occurrence-amount', occurrenceId: 'rent@2026-12-01', amountCents: usd(1700) }]);
    expect(firstShortfall(deeper)).toMatchObject({ gap: { start: '2026-12-01', lowestCents: -80000 }, created: false, despiteGain: false });
    expect(firstShortfall(run([{ kind: 'one-time-income', description: 'Bonus', amountCents: usd(500), date: '2026-11-01' }]))).toBeNull();
  });
});
