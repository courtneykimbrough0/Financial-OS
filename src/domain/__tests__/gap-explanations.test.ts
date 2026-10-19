import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { buildForecast, explainTimingGaps, tallyOn, timingGapsAhead, type ForecastEntry, type GapExplanation } from '../forecast';
import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

/*
 * Step 4: explaining timing gaps from the forecast's own numbers.
 * Today is Sun 2026-10-11. Every scenario is paid $1,000 every 2 weeks from
 * Thu Oct 15 (Oct 15, Oct 29, Nov 12, Nov 26, Dec 10, Dec 24, Jan 7).
 */
const TODAY = '2026-10-11';
const clock = clockAt(TODAY);

function paid(): AppData {
  return source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'biweekly' }, 'pay');
}
const oneTime = (d: AppData, description: string, dollars: number, date: string, kind: 'varied' | 'income' = 'varied') =>
  unwrap(ops.addOneTime(d, { kind, description, amountCents: usd(dollars), date }, clock, `one-${description.toLowerCase()}`));

/** [description, date, dollars] for a list of entries. */
const rows = (entries: ForecastEntry[]) => entries.map((e) => [e.occurrence.description, e.date, e.amountCents / 100]);

/** The explanation without its entry lists, in dollars, for compact comparison. */
function summary(x: GapExplanation) {
  return {
    start: x.start,
    end: x.end,
    days: x.days,
    lowest: [x.lowestDate, x.lowestCents / 100],
    before: x.beforeCents / 100,
    out: x.outflowCents / 100,
    in: x.inflowCents / 100,
    recoversOn: x.recoversOn,
    recovery: x.recoveryCents === null ? null : x.recoveryCents / 100,
    afterLowest: rows(x.afterLowest),
    outflows: rows(x.outflows),
    inflows: rows(x.inflows),
    recoveryIncome: rows(x.recoveryIncome),
  };
}

describe('explaining a timing gap', () => {
  it('about a week ahead: rent due before the next paycheck', () => {
    // Rent $1,200 on Mon Oct 19; the paycheck before it brought $1,000 and the next arrives Oct 29.
    const d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    const [first] = explainTimingGaps(buildForecast(d, TODAY));
    expect(summary(first!)).toEqual({
      start: '2026-10-19',
      end: '2026-10-28',
      days: 10,
      lowest: ['2026-10-19', -200],
      before: 1000,
      out: 1200,
      in: 0,
      recoversOn: '2026-10-29',
      recovery: 800,
      afterLowest: [],
      outflows: [['Rent', '2026-10-19', 1200]],
      inflows: [],
      recoveryIncome: [['Paycheck', '2026-10-29', 1000]],
    });
  });

  it('about four weeks ahead', () => {
    const d = oneTime(paid(), 'Insurance', 2600, '2026-11-09');
    expect(explainTimingGaps(buildForecast(d, TODAY)).map(summary)).toEqual([
      {
        start: '2026-11-09',
        end: '2026-11-11',
        days: 3,
        lowest: ['2026-11-09', -600],
        before: 2000,
        out: 2600,
        in: 0,
        recoversOn: '2026-11-12',
        recovery: 400,
        afterLowest: [],
        outflows: [['Insurance', '2026-11-09', 2600]],
        inflows: [],
        recoveryIncome: [['Paycheck', '2026-11-12', 1000]],
      },
    ]);
  });

  it('eight or more weeks ahead', () => {
    const d = oneTime(paid(), 'Tuition', 4500, '2026-12-09');
    const [gap] = explainTimingGaps(buildForecast(d, TODAY));
    expect(summary(gap!)).toEqual({
      start: '2026-12-09',
      end: '2026-12-09',
      days: 1,
      lowest: ['2026-12-09', -500],
      before: 4000,
      out: 4500,
      in: 0,
      recoversOn: '2026-12-10',
      recovery: 500,
      afterLowest: [],
      outflows: [['Tuition', '2026-12-09', 4500]],
      inflows: [],
      recoveryIncome: [['Paycheck', '2026-12-10', 1000]],
    });
  });

  it('a paycheck that moved later: the timing, not the spending, opens the gap', () => {
    // Rent of $1,500 on Oct 30 is normally covered by the Oct 29 paycheck, which is now expected Nov 2.
    let d = source(paid(), TODAY, 'bill', 'Rent', 1500, '2026-10-30', { type: 'monthly' }, 'rent');
    expect(explainTimingGaps(buildForecast(d, TODAY))).toEqual([]);
    d = unwrap(ops.rescheduleOccurrence(d, 'pay@2026-10-29', { date: '2026-11-02', amountCents: usd(1000) }, clock));
    const [gap] = explainTimingGaps(buildForecast(d, TODAY));
    expect(summary(gap!)).toMatchObject({
      start: '2026-10-30',
      end: '2026-11-01',
      days: 3,
      lowest: ['2026-10-30', -500],
      before: 1000,
      outflows: [['Rent', '2026-10-30', 1500]],
      recoversOn: '2026-11-02',
      recoveryIncome: [['Paycheck', '2026-11-02', 1000]],
    });
    // The paycheck that ends the gap shows it was first expected Oct 29.
    expect(gap!.recoveryIncome[0]!.occurrence.expectedDate).toBe('2026-10-29');
  });
});

describe('several payments and several gaps', () => {
  // Monthly: rent $1,200 on the 19th, phone $60 on the 20th, side job +$100 on the 21st, car loan $350 on the 22nd.
  function household(): AppData {
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-20', { type: 'monthly' }, 'phone');
    d = source(d, TODAY, 'income', 'Side job', 100, '2026-10-21', { type: 'monthly' }, 'side');
    return source(d, TODAY, 'liability', 'Car loan', 350, '2026-10-22', { type: 'monthly' }, 'car');
  }

  it('lists every payment between the start of a gap and its lowest point, and income received meanwhile', () => {
    const [first] = explainTimingGaps(buildForecast(household(), TODAY));
    expect(summary(first!)).toEqual({
      start: '2026-10-19',
      end: '2026-10-28',
      days: 10,
      lowest: ['2026-10-22', -510],
      before: 1000,
      out: 1610,
      in: 100,
      recoversOn: '2026-10-29',
      recovery: 490,
      afterLowest: [],
      outflows: [
        ['Rent', '2026-10-19', 1200],
        ['Phone', '2026-10-20', 60],
        ['Car loan', '2026-10-22', 350],
      ],
      inflows: [['Side job', '2026-10-21', 100]],
      recoveryIncome: [['Paycheck', '2026-10-29', 1000]],
    });
  });

  it('explains each separate gap on its own', () => {
    // Nov: $490 after Oct 29, +$1,000 Nov 12 → $1,490; rent → $290; phone → $230; side job → $330; car loan → −$20.
    // Dec: the Nov 26 paycheck leaves enough, so December has no gap.
    const gaps = explainTimingGaps(buildForecast(household(), TODAY));
    expect(gaps.map((g) => [g.start, g.end, g.lowestDate, g.lowestCents / 100])).toEqual([
      ['2026-10-19', '2026-10-28', '2026-10-22', -510],
      ['2026-11-22', '2026-11-25', '2026-11-22', -20],
    ]);
    expect(summary(gaps[1]!)).toMatchObject({
      before: 330,
      outflows: [['Car loan', '2026-11-22', 350]],
      inflows: [],
      recoversOn: '2026-11-26',
    });
  });

  it('uses exactly the forecast’s running totals', () => {
    const f = buildForecast(household(), TODAY);
    const gaps = explainTimingGaps(f);
    expect(gaps.map(({ start, end, days, lowestCents, lowestDate }) => ({ start, end, days, lowestCents, lowestDate }))).toEqual(timingGapsAhead(f));
    for (const g of gaps) {
      expect(g.beforeCents).toBe(tallyOn(f, addDays(g.start, -1)));
      expect(g.lowestCents).toBe(tallyOn(f, g.lowestDate));
      expect(g.beforeCents + g.inflowCents - g.outflowCents).toBe(g.lowestCents);
      expect(tallyOn(f, g.recoversOn!)).toBe(g.recoveryCents);
      expect(g.recoveryCents!).toBeGreaterThanOrEqual(0);
      for (const e of g.afterLowest) expect(tallyOn(f, e.date)!).toBeLessThan(0);
      const net = (entries: ForecastEntry[]) => entries.reduce((sum, e) => sum + e.signedCents, 0);
      expect(g.lowestCents + net(g.afterLowest) + net(g.recoveryEntries)).toBe(g.recoveryCents);
      for (const e of [...g.outflows, ...g.inflows]) {
        expect(f.entries).toContain(e);
        expect(e.counts).toBe(true);
        expect(e.date >= g.start && e.date <= g.lowestDate).toBe(true);
      }
    }
  });
});

describe('after the lowest point', () => {
  it('lists what happens while the total is still below $0, separately from what led to the low', () => {
    // Rent $1,200 Oct 19 (low −$200), side job +$150 Oct 21 (−$50), phone $60 Oct 24 (−$110), paycheck Oct 29 (+$890).
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = oneTime(d, 'Side job', 150, '2026-10-21', 'income');
    d = oneTime(d, 'Phone', 60, '2026-10-24');
    const [gap] = explainTimingGaps(buildForecast(d, TODAY));
    expect(summary(gap!)).toMatchObject({
      start: '2026-10-19',
      end: '2026-10-28',
      lowest: ['2026-10-19', -200],
      outflows: [['Rent', '2026-10-19', 1200]],
      inflows: [],
      afterLowest: [
        ['Side job', '2026-10-21', 150],
        ['Phone', '2026-10-24', 60],
      ],
      recoversOn: '2026-10-29',
      recovery: 890,
    });
  });

  it('lists every entry on the recovery day, so the lines add up to the running total shown', () => {
    // Rent $1,200 Oct 19 (−$200); on Oct 29 the paycheck (+$1,000) and a $60 phone bill: −$200 + $1,000 − $60 = $740.
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = oneTime(d, 'Phone', 60, '2026-10-29');
    const [gap] = explainTimingGaps(buildForecast(d, TODAY));
    expect(rows(gap!.recoveryIncome)).toEqual([['Paycheck', '2026-10-29', 1000]]);
    expect(rows(gap!.recoveryEntries)).toEqual([
      ['Paycheck', '2026-10-29', 1000],
      ['Phone', '2026-10-29', 60],
    ]);
    expect(gap!.recoveryCents).toBe(usd(740));
  });

  it('says there is no recovery when the total stays below $0 through the forecast', () => {
    // Paid $1,000 on the 15th; rent of $2,100 on the 20th: each month ends $1,100 lower.
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'monthly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 2100, '2026-10-20', { type: 'monthly' }, 'rent');
    const gaps = explainTimingGaps(buildForecast(d, TODAY));
    expect(gaps).toHaveLength(1);
    expect(summary(gaps[0]!)).toEqual({
      start: '2026-10-20',
      end: '2027-01-12', // the last day of the 90-day lookahead
      days: 85,
      lowest: ['2026-12-20', -3300],
      before: 1000,
      out: 6300,
      in: 2000,
      recoversOn: null,
      recovery: null,
      afterLowest: [],
      outflows: [
        ['Rent', '2026-10-20', 2100],
        ['Rent', '2026-11-20', 2100],
        ['Rent', '2026-12-20', 2100],
      ],
      inflows: [
        ['Paycheck', '2026-11-15', 1000],
        ['Paycheck', '2026-12-15', 1000],
      ],
      recoveryIncome: [],
    });
  });
});

describe('when there is nothing to explain', () => {
  it('is empty without a gap, and without a forecast', () => {
    const d = source(paid(), TODAY, 'bill', 'Rent', 900, '2026-10-19', { type: 'monthly' }, 'rent');
    expect(explainTimingGaps(buildForecast(d, TODAY))).toEqual([]);
    const noIncome = source(ops.emptyData(), TODAY, 'bill', 'Rent', 900, '2026-10-19');
    expect(explainTimingGaps(buildForecast(noIncome, TODAY))).toEqual([]);
  });

  it('leaves out canceled payments, which never count', () => {
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = unwrap(ops.cancelOccurrence(d, 'rent@2026-10-19', '', clock));
    expect(explainTimingGaps(buildForecast(d, TODAY)).map((g) => g.start)).not.toContain('2026-10-19');
  });
});

describe('explaining gaps', () => {
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  it('never changes the stored data, and gives the same result each time', () => {
    const d = oneTime(paid(), 'Insurance', 2600, '2026-11-09');
    const snapshot = JSON.stringify(d);
    deepFreeze(d);
    const f = buildForecast(d, TODAY);
    expect(explainTimingGaps(f)).toEqual(explainTimingGaps(buildForecast(d, TODAY)));
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});
