import { describe, expect, it } from 'vitest';
import { migrate } from '../../state/storage';
import { recordedEntries } from '../activity';
import { buildForecast, dailyTimeline, entriesInRange, overdueEntries, periodKpis, tallyOn, timingGapsAhead, weekSummaries, type Forecast } from '../forecast';
import { homeView } from '../home';
import { findOccurrence, variance } from '../occurrences';
import * as ops from '../operations';
import { periodPlan } from '../plan';
import type { AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

/*
 * C1: projection first (PRODUCT_CONTRACT.md, docs/C0-FINANCIAL-ACCEPTANCE-EXAMPLES.md).
 * Every unrecorded occurrence is a projection and counts; only an explicit
 * record is an actual; the person chooses where the forecast starts.
 *
 * 2026-11-01 is a Sunday; 2026-11-06 is a Friday.
 */
const NOV1 = '2026-11-01';
const clock = clockAt(NOV1);
const entry = (f: Forecast, id: string) => f.entries.filter((e) => e.occurrence.id === id);
const leftToSpend = (f: Forecast, start: string, end: string) => periodPlan(f, start, end).cashFlowCents;

describe('C0-01: ordinary recurring pay is projected, with no certainty question', () => {
  const pay = () => source(ops.emptyData(), NOV1, 'income', 'Paycheck', 1500, '2026-11-06', { type: 'biweekly' }, 'pay');

  it('counts +$1,500 on Nov 6 and again on Nov 20, as two separate projections', () => {
    const f = buildForecast(pay(), '2026-11-05');
    const nov = entriesInRange(f, NOV1, '2026-11-30');
    expect(nov.map((e) => [e.date, e.signedCents, e.counts, e.occurrence.status])).toEqual([
      ['2026-11-06', usd(1500), true, 'scheduled'],
      ['2026-11-20', usd(1500), true, 'scheduled'],
    ]);
    expect(periodKpis(f, NOV1, '2026-11-30').incomeCents).toBe(usd(3000));
  });

  it('stays a projection when its date passes: overdue, never recorded by the date', () => {
    const f = buildForecast(pay(), '2026-11-10');
    const [nov6] = entry(f, 'pay@2026-11-06');
    expect([nov6!.occurrence.status, nov6!.occurrence.displayStatus, nov6!.counts, nov6!.date]).toEqual(['scheduled', 'overdue', true, '2026-11-06']);
    expect(recordedEntries(f, NOV1, '2026-11-30')).toEqual([]);
    expect(overdueEntries(f).map((e) => e.occurrence.id)).toEqual(['pay@2026-11-06']);
  });
});

describe('C0-02: a different amount on a different day replaces the projection once', () => {
  const recorded = () => {
    const d = source(ops.emptyData(), NOV1, 'income', 'Paycheck', 1500, '2026-11-06', { type: 'biweekly' }, 'pay');
    return unwrap(ops.recordActual(d, 'pay@2026-11-06', { amountCents: usd(1250), date: '2026-11-09' }, clockAt('2026-11-09')));
  };

  it('counts exactly one +$1,250 on Nov 9 and nothing on Nov 6', () => {
    const f = buildForecast(recorded(), '2026-11-09');
    expect(entriesInRange(f, '2026-11-06', '2026-11-06')).toEqual([]);
    expect(entry(f, 'pay@2026-11-06').map((e) => [e.date, e.signedCents, e.counts])).toEqual([['2026-11-09', usd(1250), true]]);
    expect(periodKpis(f, NOV1, '2026-11-30').incomeCents).toBe(usd(1250 + 1500));
  });

  it('keeps the original $1,500 on Nov 6 for comparison: $250 less, 3 days later', () => {
    const o = findOccurrence(recorded(), 'pay@2026-11-06', '2026-11-09')!;
    expect([o.expectedDate, o.expectedAmountCents, o.actualDate, o.actualAmountCents]).toEqual(['2026-11-06', usd(1500), '2026-11-09', usd(1250)]);
    expect(variance(o)).toEqual({ amountCents: usd(-250), days: 3 });
  });

  it('a later schedule change, a correction or an undo never rewrites the original plan', () => {
    const changed = unwrap(ops.changeSourceSchedule(recorded(), 'pay', { startDate: '2026-12-04', amountCents: usd(1600), rule: { type: 'biweekly' } }, clockAt('2026-11-10')));
    const after = findOccurrence(changed, 'pay@2026-11-06', '2026-11-10')!;
    expect([after.expectedDate, after.expectedAmountCents, after.actualAmountCents]).toEqual(['2026-11-06', usd(1500), usd(1250)]);

    const corrected = unwrap(ops.correctActual(changed, 'pay@2026-11-06', { amountCents: usd(1200), date: '2026-11-10' }, clockAt('2026-11-10')));
    expect(variance(findOccurrence(corrected, 'pay@2026-11-06', '2026-11-10')!)).toEqual({ amountCents: usd(-300), days: 4 });

    const undone = unwrap(ops.restoreOccurrence(corrected, 'pay@2026-11-06', clockAt('2026-11-10')));
    const back = buildForecast(undone, '2026-11-10');
    expect(entry(back, 'pay@2026-11-06').map((e) => [e.date, e.signedCents, e.occurrence.status])).toEqual([['2026-11-06', usd(1500), 'scheduled']]);
  });
});

describe('C0-03: freelance, irregular and one-time income are projections like any other', () => {
  function plan(): AppData {
    let d = unwrap(ops.addOneTime(ops.emptyData(), { kind: 'income', description: 'Logo project', amountCents: usd(800), date: '2026-11-12' }, clock, 'logo'));
    d = unwrap(ops.addJob(d, { description: 'Brochure', amountCents: usd(500), status: 'planned', expectedDate: '2026-11-27' }, clock, 'brochure'));
    d = unwrap(ops.addSource(d, { kind: 'income', description: 'Tips', amountCents: usd(650), startDate: '2026-11-13', rule: { type: 'weekly' }, incomeType: 'tipped' }, clock, 'tips'));
    return d;
  }

  it('counts +$800, +$650 and +$500 on their dates, +$1,950 together, and every later tips date too', () => {
    const d = plan();
    const f = buildForecast(d, NOV1);
    const received = entriesInRange(f, '2026-11-12', '2026-11-27').filter((e) => e.signedCents > 0);
    // Weekly tips: Nov 13, 20 and 27 are all projections too.
    expect(received.map((e) => [e.date, e.signedCents])).toEqual([
      ['2026-11-12', usd(800)],
      ['2026-11-13', usd(650)],
      ['2026-11-20', usd(650)],
      ['2026-11-27', usd(650)],
      ['2026-11-27', usd(500)],
    ]);
    expect(received.every((e) => e.counts && e.occurrence.status === 'scheduled')).toBe(true);
    // The example's three receipts: the one-time $800, the first $650 of tips, and the job's $500.
    const three = [entry(f, 'logo')[0]!, entry(f, 'tips@2026-11-13')[0]!, entry(f, d.jobs![0]!.paymentRecordId!)[0]!];
    expect(three.reduce((n, e) => n + e.signedCents, 0)).toBe(usd(1950));
  });

  it('logging a shift never adds income by itself; its paychecks are still the projection', () => {
    const before = buildForecast(plan(), '2026-11-14');
    const d = unwrap(ops.logShift(plan(), { sourceId: 'tips', date: '2026-11-13', minutes: 360, cardTipsCents: usd(90) }, clockAt('2026-11-14')));
    const after = buildForecast(d, '2026-11-14');
    expect(periodKpis(after, NOV1, '2026-11-30')).toEqual(periodKpis(before, NOV1, '2026-11-30'));
  });
});

describe('C0-11: recorded and projected in one period are told apart', () => {
  it('+$2,150 of receipts, of which only the $1,250 recorded is received', () => {
    let d = unwrap(ops.addOneTime(ops.emptyData(), { kind: 'income', description: 'Invoice A', amountCents: usd(1500), date: '2026-11-06' }, clock, 'a'));
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Invoice B', amountCents: usd(900), date: '2026-11-25' }, clock, 'b'));
    d = unwrap(ops.recordActual(d, 'a', { amountCents: usd(1250), date: '2026-11-09' }, clockAt('2026-11-10')));
    const f = buildForecast(d, '2026-11-10');
    expect(periodKpis(f, NOV1, '2026-11-30').incomeCents).toBe(usd(2150));
    expect(recordedEntries(f, NOV1, '2026-11-30').reduce((n, e) => n + e.signedCents, 0)).toBe(usd(1250));
    expect(entry(f, 'b')[0]!.occurrence.status).toBe('scheduled');
  });
});

describe('C0-12: the chosen forecast start is authoritative', () => {
  function plan(): AppData {
    let d = unwrap(ops.addOneTime(ops.emptyData(), { kind: 'income', description: 'Refund', amountCents: usd(900), date: '2026-11-04' }, clock, 'refund'));
    d = source(d, NOV1, 'income', 'Paycheck', 1500, '2026-11-20', { type: 'monthly' }, 'pay');
    return source(d, NOV1, 'bill', 'Water', 120, '2026-11-02', { type: 'monthly' }, 'water');
  }

  it('starting Nov 1: the Nov 2 bill comes first, both receipts count, Left to Spend is $2,280', () => {
    const f = buildForecast(plan(), NOV1, { start: NOV1, through: '2026-11-30' });
    expect([f.forecastStart, f.anchor]).toEqual([NOV1, '2026-10-31']);
    expect(tallyOn(f, '2026-10-31')).toBeNull();
    expect(dailyTimeline(f, NOV1, '2026-11-30').filter((r) => r.entries.length > 0).map((r) => [r.date, r.tallyCents])).toEqual([
      ['2026-11-02', usd(-120)],
      ['2026-11-04', usd(780)],
      ['2026-11-20', usd(2280)],
    ]);
    expect(leftToSpend(f, NOV1, '2026-11-30')).toBe(usd(2280));
  });

  it('starting Nov 5: the Nov 2 bill and Nov 4 receipt are outside the period; Left to Spend is $1,500', () => {
    const f = buildForecast(plan(), NOV1, { start: '2026-11-05', through: '2026-11-30' });
    expect(f.forecastStart).toBe('2026-11-05');
    expect(leftToSpend(f, '2026-11-05', '2026-11-30')).toBe(usd(1500));
    expect(tallyOn(f, '2026-11-04')).toBeNull();
    expect(tallyOn(f, '2026-11-05')).toBe(0);
    expect(tallyOn(f, '2026-11-20')).toBe(usd(1500));
  });

  it('never moves the start to a payday, the first income entered or the first recurring income', () => {
    for (const start of [NOV1, '2026-11-03', '2026-11-05', '2026-11-21']) {
      expect(buildForecast(plan(), NOV1, { start }).forecastStart).toBe(start);
    }
    // Without a choice, the forecast starts today, whatever the income dates.
    expect(buildForecast(plan(), NOV1).forecastStart).toBe(NOV1);
  });
});

describe('C0-08: expenses before income stay visible as a timing shortfall', () => {
  it('$100 due Nov 1 and $500 coming Nov 5: $100 short from Nov 1 to Nov 4, +$400 by Nov 5', () => {
    let d = source(ops.emptyData(), NOV1, 'bill', 'Phone', 100, NOV1, { type: 'monthly' }, 'phone');
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Payment', amountCents: usd(500), date: '2026-11-05' }, clock, 'payment'));
    const f = buildForecast(d, NOV1, { start: NOV1 });
    expect(tallyOn(f, NOV1)).toBe(usd(-100));
    expect(tallyOn(f, '2026-11-05')).toBe(usd(400));
    expect(timingGapsAhead(f, 30)).toEqual([{ start: NOV1, end: '2026-11-04', days: 4, lowestCents: usd(-100), lowestDate: NOV1 }]);
    expect(periodKpis(f, NOV1, '2026-11-05').netCents).toBe(usd(400));
  });
});

describe('forecasts that no longer depend on income', () => {
  it('a plan with only expenses forecasts, below $0', () => {
    const d = source(ops.emptyData(), NOV1, 'bill', 'Rent', 1000, '2026-11-03', { type: 'monthly' }, 'rent');
    const f = buildForecast(d, NOV1);
    expect([f.issue, f.forecastStart]).toEqual([null, NOV1]);
    expect(tallyOn(f, '2026-11-03')).toBe(usd(-1000));
  });

  it('a plan with only one-time income forecasts', () => {
    const d = unwrap(ops.addOneTime(ops.emptyData(), { kind: 'income', description: 'Gift', amountCents: usd(300), date: '2026-11-15' }, clock, 'gift'));
    const f = buildForecast(d, NOV1);
    expect([f.issue, f.forecastStart, tallyOn(f, '2026-11-15')]).toEqual([null, NOV1, usd(300)]);
  });

  it('a start before every income carries the running total to the first income', () => {
    let d = source(ops.emptyData(), NOV1, 'income', 'Contract', 2000, '2026-12-15', { type: 'monthly' }, 'contract');
    d = source(d, NOV1, 'bill', 'Insurance', 150, '2026-11-10', { type: 'monthly' }, 'insurance');
    const f = buildForecast(d, NOV1, { start: NOV1, through: '2026-12-31' });
    expect(tallyOn(f, '2026-11-10')).toBe(usd(-150));
    expect(tallyOn(f, '2026-12-14')).toBe(usd(-300));
    expect(tallyOn(f, '2026-12-15')).toBe(usd(1700));
  });

  it('several incomes on different schedules all count from the chosen start', () => {
    let d = source(ops.emptyData(), NOV1, 'income', 'Salary', 3000, '2026-11-30', { type: 'monthly' }, 'salary');
    d = source(d, NOV1, 'income', 'Side job', 150, '2026-11-06', { type: 'weekly' }, 'side');
    d = source(d, NOV1, 'income', 'Benefit', 400, '2026-11-03', { type: 'twiceMonthly', days: [3, 18] }, 'benefit');
    const f = buildForecast(d, NOV1, { start: NOV1, through: '2026-11-30' });
    // Side job Nov 6, 13, 20, 27; benefit Nov 3 and 18; salary Nov 30.
    expect(tallyOn(f, '2026-11-30')).toBe(usd(150 * 4 + 400 * 2 + 3000));
  });

  it('nothing planned at all is the only case without a forecast to show', () => {
    expect(buildForecast(ops.emptyData(), NOV1).issue).toBe('nothing-planned');
  });
});

describe('periods with recorded and projected activity', () => {
  /** Paycheck $1,000 every 2 weeks from Oct 2; rent $800 on Oct 5; today is Oct 20. */
  function october(): AppData {
    let d = source(ops.emptyData(), '2026-09-30', 'income', 'Paycheck', 1000, '2026-10-02', { type: 'biweekly' }, 'pay');
    d = source(d, '2026-09-30', 'bill', 'Rent', 800, '2026-10-05', { type: 'monthly' }, 'rent');
    d = unwrap(ops.recordActual(d, 'pay@2026-10-02', { amountCents: usd(980), date: '2026-10-02' }, clockAt('2026-10-02')));
    return d;
  }

  it('a past start uses recorded actuals and leaves unrecorded past items as projections on their own dates', () => {
    const f = buildForecast(october(), '2026-10-20', { start: '2026-10-01', through: '2026-10-31' });
    expect(tallyOn(f, '2026-10-02')).toBe(usd(980));
    const [rent] = entry(f, 'rent@2026-10-05');
    expect([rent!.date, rent!.occurrence.displayStatus, rent!.counts]).toEqual(['2026-10-05', 'overdue', true]);
    expect(tallyOn(f, '2026-10-05')).toBe(usd(180));
    // Oct 16 and Oct 30 paychecks are unrecorded projections.
    expect(tallyOn(f, '2026-10-31')).toBe(usd(180 + 1000 + 1000));
    expect(leftToSpend(f, '2026-10-01', '2026-10-31')).toBe(usd(980 + 1000 + 1000 - 800));
  });

  it('nothing dated before the chosen start is carried into its running total', () => {
    const f = buildForecast(october(), '2026-10-20', { start: '2026-10-20', through: '2026-10-31' });
    expect(entry(f, 'rent@2026-10-05')[0]!.date).toBe('2026-10-05');
    expect(tallyOn(f, '2026-10-20')).toBe(0);
    expect(tallyOn(f, '2026-10-30')).toBe(usd(1000));
  });

  it('weekly, monthly and custom views read the same transactions', () => {
    const month = buildForecast(october(), '2026-10-20', { start: '2026-10-01', through: '2026-10-31' });
    const weeks = weekSummaries(month, '2026-10-01', '2026-10-31');
    expect(weeks.reduce((n, w) => n + w.netCents, 0)).toBe(leftToSpend(month, '2026-10-01', '2026-10-31'));
    // A custom period's totals don't depend on where its running total starts.
    const custom = buildForecast(october(), '2026-10-20', { start: '2026-10-10', through: '2026-10-31' });
    expect(periodPlan(custom, '2026-10-10', '2026-10-31')).toEqual(periodPlan(month, '2026-10-10', '2026-10-31'));
    expect(weeks.at(-1)!.endTallyCents).toBe(tallyOn(month, '2026-10-31'));
  });

  it('a canceled occurrence counts nowhere and a moved one counts on its new date', () => {
    let d = unwrap(ops.cancelOccurrence(october(), 'pay@2026-10-16', '', clockAt('2026-10-15')));
    d = unwrap(ops.rescheduleOccurrence(d, 'pay@2026-10-30', { date: '2026-11-02', amountCents: usd(1000) }, clockAt('2026-10-15')));
    const f = buildForecast(d, '2026-10-20', { start: '2026-10-01', through: '2026-11-30' });
    expect(periodKpis(f, '2026-10-01', '2026-10-31').incomeCents).toBe(usd(980));
    expect(entry(f, 'pay@2026-10-30').map((e) => e.date)).toEqual(['2026-11-02']);
  });
});

describe('income marked possible before C1', () => {
  /** A device copy saved before C1, with a possible recurring income and a possible one-time income. */
  const legacy = () =>
    migrate({
      schemaVersion: 2,
      revision: 3,
      onboardingComplete: true,
      sources: [
        { ...unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Tips', amountCents: usd(200), startDate: '2026-11-04', rule: { type: 'weekly' } }, clock, 'tips')).sources[0]!, certainty: 'possible' },
      ],
      records: [{ ...unwrap(ops.addOneTime(ops.emptyData(), { kind: 'income', description: 'Invoice', amountCents: usd(500), date: '2026-11-10' }, clock, 'invoice')).records[0]!, certainty: 'possible' }],
    });

  it('loads as ordinary projected income: counted, never silently excluded', () => {
    const d = legacy();
    expect(JSON.stringify(d)).not.toContain('certainty');
    const f = buildForecast(d, NOV1, { through: '2026-11-30' });
    // Tips Nov 4, 11, 18, 25 and the invoice.
    expect(periodKpis(f, NOV1, '2026-11-30').incomeCents).toBe(usd(200 * 4 + 500));
    expect(f.entries.filter((e) => e.date <= '2026-11-30').every((e) => e.counts)).toBe(true);
  });

  it('becomes overdue like any income once its date passes unrecorded, and Home lists it', () => {
    const view = homeView(legacy(), '2026-11-11');
    expect(view.attention.map((i) => i.id)).toEqual(['tips@2026-11-04', 'invoice', 'tips@2026-11-11']);
  });
});
