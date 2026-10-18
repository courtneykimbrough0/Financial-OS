import { describe, expect, it } from 'vitest';
import { buildForecast, dailyTimeline, paycheckCycles, periodKpis, tallyOn, timingGapsAhead, type Forecast } from '../forecast';
import { expandSource } from '../occurrences';
import * as ops from '../operations';
import type { AppData, RecurrenceRule } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

/*
 * Step 1 validation of the forecast engine: the path from stored sources and
 * records to the running total, checked against hand-computed values in cents.
 * 2026-10-11 is a Sunday.
 */
const TODAY = '2026-10-11';
const clock = clockAt(TODAY);
const id = (sourceId: string, date: string) => `${sourceId}@${date}`;

/** Days with counted activity as [date, net dollars, running total dollars | null]. */
function ledger(f: Forecast, start: string, end: string) {
  return dailyTimeline(f, start, end)
    .filter((r) => r.entries.some((e) => e.counts))
    .map((r) => [r.date, r.netCents / 100, r.tallyCents === null ? null : r.tallyCents / 100]);
}

/*
 * Household: paid $2,000.10 every 2 weeks from Thu Oct 15; rent $1,450 on the 1st;
 * car loan $310.55 on the 20th; streaming $15.99 on the 18th; a $100 reserve twice a
 * month (1st and 15th, from Nov 1); one-time vet bill $240 on Nov 3.
 */
function household(): AppData {
  let d = ops.emptyData();
  d = source(d, TODAY, 'income', 'Paycheck', 2000.1, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1450, '2026-11-01', { type: 'monthly' }, 'rent');
  d = source(d, TODAY, 'liability', 'Car loan', 310.55, '2026-10-20', { type: 'monthly' }, 'car');
  d = source(d, TODAY, 'subscription', 'Streaming', 15.99, '2026-10-18', { type: 'monthly' }, 'stream');
  d = source(d, TODAY, 'reserve', 'Savings', 100, '2026-11-01', { type: 'twiceMonthly', days: [1, 15] }, 'save');
  return unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Vet', amountCents: usd(240), date: '2026-11-03' }, clock, 'one-vet'));
}

describe('running total arithmetic', () => {
  it('applies every income and expense on its date, in cents, from the payday anchor', () => {
    const f = buildForecast(household(), TODAY);
    expect(f.anchor).toBe('2026-10-14');
    expect(ledger(f, '2026-10-15', '2026-11-30')).toEqual([
      ['2026-10-15', 2000.1, 2000.1],
      ['2026-10-18', -15.99, 1984.11],
      ['2026-10-20', -310.55, 1673.56],
      ['2026-10-29', 2000.1, 3673.66],
      ['2026-11-01', -1550, 2123.66], // rent 1,450 + reserve 100
      ['2026-11-03', -240, 1883.66],
      ['2026-11-12', 2000.1, 3883.76],
      ['2026-11-15', -100, 3783.76],
      ['2026-11-18', -15.99, 3767.77],
      ['2026-11-20', -310.55, 3457.22],
      ['2026-11-26', 2000.1, 5457.32],
    ]);
  });

  it('period cash flow equals the change in running total over the period', () => {
    const f = buildForecast(household(), TODAY);
    const nov = periodKpis(f, '2026-11-01', '2026-11-30');
    // Paydays Nov 12 and 26; rent, vet, streaming, car loan out; reserve x2 set aside.
    expect(nov).toEqual({ incomeCents: usd(4000.2), outflowCents: usd(2016.54), reservesCents: usd(200), operatingCents: usd(1983.66), netCents: usd(1783.66) });
    expect(tallyOn(f, '2026-11-30')! - tallyOn(f, '2026-10-31')!).toBe(nov.netCents);
  });

  it('keeps exact cents over a long horizon', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'weekly' }, 'pay');
    d = source(d, TODAY, 'subscription', 'Coffee', 0.1, '2026-10-15', { type: 'custom', interval: 1, unit: 'day' }, 'coffee');
    const end = '2027-10-13'; // Oct 15 through Oct 13 a year later: 52 paychecks, 364 coffees
    const f = buildForecast(d, TODAY, { through: end });
    expect(tallyOn(f, end)).toBe(52 * 100_000 - 364 * 10);
  });
});

describe('spending before the next payday', () => {
  // Payday is Thu Oct 15; the electric bill and a side payment land before it.
  function early(): AppData {
    let d = household();
    d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Electric', amountCents: usd(90), date: '2026-10-13' }, clock, 'one-electric'));
    return unwrap(ops.addOneTime(d, { kind: 'income', description: 'Side job', amountCents: usd(50), date: '2026-10-12' }, clock, 'one-side'));
  }

  it('counts in cash flow for its period but not in the running total, which starts at payday', () => {
    const f = buildForecast(early(), TODAY);
    expect(ledger(f, '2026-10-11', '2026-10-15')).toEqual([
      ['2026-10-12', 50, null],
      ['2026-10-13', -90, null],
      ['2026-10-15', 2000.1, 2000.1],
    ]);
    expect(periodKpis(f, '2026-10-01', '2026-10-31')).toMatchObject({ incomeCents: usd(4050.2), outflowCents: usd(416.54) });
    expect(timingGapsAhead(f)).toEqual([]);
  });

  it('once overdue and still unpaid, is carried to payday so the money still owed stays in the total', () => {
    const today = '2026-10-14';
    const f = buildForecast(early(), today);
    // Both are past due and not yet recorded, so both move to payday.
    const carried = f.entries.filter((e) => e.carriedForward).map((e) => [e.occurrence.id, e.date]);
    expect(carried).toEqual([['one-side', '2026-10-15'], ['one-electric', '2026-10-15']]);
    expect(tallyOn(f, '2026-10-15')).toBe(usd(2000.1 + 50 - 90));
  });

  it('once paid before payday, stays out of the running total', () => {
    const d = unwrap(ops.recordActual(early(), 'one-electric', { amountCents: usd(92), date: '2026-10-13' }, clockAt('2026-10-13')));
    const f = buildForecast(d, '2026-10-14');
    // The side payment is still unrecorded, so it alone is carried to payday.
    expect(tallyOn(f, '2026-10-15')).toBe(usd(2000.1 + 50));
    expect(periodKpis(f, '2026-10-13', '2026-10-13').outflowCents).toBe(usd(92));
  });
});

describe('events on the same day', () => {
  function sameDay(): AppData {
    let d = ops.emptyData();
    d = source(d, TODAY, 'income', 'Paycheck', 1500, '2026-11-01', { type: 'monthly' }, 'pay');
    d = source(d, TODAY, 'income', 'Side job', 200, '2026-11-01', { type: 'monthly' }, 'side');
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
    d = source(d, TODAY, 'bill', 'Water', 40, '2026-11-01', { type: 'monthly' }, 'water');
    d = source(d, TODAY, 'reserve', 'Savings', 40, '2026-11-01', { type: 'monthly' }, 'save');
    // Two separate $40 items on the same day stay two items.
    return unwrap(ops.rescheduleOccurrence(d, id('water', '2026-12-01'), { date: '2026-12-02', amountCents: usd(45) }, clock));
  }

  it('includes each event once and nets them into one daily change', () => {
    const f = buildForecast(sameDay(), TODAY);
    const row = dailyTimeline(f, '2026-11-01', '2026-11-01')[0]!;
    expect(row.entries.map((e) => e.occurrence.id)).toEqual([
      id('pay', '2026-11-01'), id('side', '2026-11-01'), id('rent', '2026-11-01'), id('save', '2026-11-01'), id('water', '2026-11-01'),
    ]);
    // The reserve is set aside, not spent: its own part of the day, and still off the running total.
    expect([row.inCents, row.outCents, row.reservedCents, row.netCents, row.tallyCents]).toEqual([usd(1700), usd(1240), usd(40), usd(420), usd(420)]);
  });

  it('gives the same order and totals however the data is stored', () => {
    const d = sameDay();
    const shuffled = { ...d, sources: [d.sources[3]!, d.sources[0]!, d.sources[4]!, d.sources[2]!, d.sources[1]!], records: [...d.records].reverse() };
    expect(buildForecast(shuffled, TODAY)).toEqual(buildForecast(d, TODAY));
  });
});

describe('period boundaries', () => {
  it('includes events on the first and last day and nothing outside', () => {
    const f = buildForecast(household(), TODAY);
    // Oct 20 car loan and Oct 29 paycheck sit on the edges.
    expect(periodKpis(f, '2026-10-20', '2026-10-29')).toEqual({ incomeCents: usd(2000.1), outflowCents: usd(310.55), reservesCents: 0, operatingCents: usd(1689.55), netCents: usd(1689.55) });
    expect(periodKpis(f, '2026-10-21', '2026-10-28')).toEqual({ incomeCents: 0, outflowCents: 0, reservesCents: 0, operatingCents: 0, netCents: 0 });
  });

  it('crosses a year end without losing or repeating an occurrence', () => {
    const f = buildForecast(household(), TODAY);
    const dec = periodKpis(f, '2026-12-01', '2026-12-31');
    const jan = periodKpis(f, '2027-01-01', '2027-01-31');
    const both = periodKpis(f, '2026-12-01', '2027-01-31');
    expect(dec.netCents + jan.netCents).toBe(both.netCents);
    expect(f.entries.filter((e) => e.occurrence.sourceId === 'pay' && e.date >= '2026-12-01' && e.date <= '2027-01-31').map((e) => e.date)).toEqual([
      '2026-12-10', '2026-12-24', '2027-01-07', '2027-01-21',
    ]);
  });

  it('extends the forecast to cover a requested period beyond the default horizon', () => {
    const f = buildForecast(household(), TODAY, { through: '2028-06-30' });
    const june = periodKpis(f, '2028-06-01', '2028-06-30');
    expect([june.outflowCents, june.reservesCents]).toEqual([usd(1450 + 310.55 + 15.99), usd(200)]);
  });
});

describe('schedules across year ends', () => {
  const cases: { name: string; start: string; rule: RecurrenceRule; through: string; expected: string[] }[] = [
    { name: 'weekly', start: '2026-12-24', rule: { type: 'weekly' }, through: '2027-01-07', expected: ['2026-12-24', '2026-12-31', '2027-01-07'] },
    { name: 'every 2 weeks', start: '2026-12-18', rule: { type: 'biweekly' }, through: '2027-01-14', expected: ['2026-12-18', '2027-01-01'] },
    { name: 'monthly on the 31st', start: '2026-12-31', rule: { type: 'monthly' }, through: '2027-02-27', expected: ['2026-12-31', '2027-01-31'] },
    { name: 'twice a month on the 15th and 31st', start: '2026-12-15', rule: { type: 'twiceMonthly', days: [15, 31] }, through: '2027-01-30', expected: ['2026-12-15', '2026-12-31', '2027-01-15'] },
    { name: 'leap year, monthly on the 29th', start: '2027-12-29', rule: { type: 'monthly' }, through: '2028-02-29', expected: ['2027-12-29', '2028-01-29', '2028-02-29'] },
  ];
  it.each(cases)('$name', ({ start, rule, through, expected }) => {
    const d = source(ops.emptyData(), TODAY, 'bill', 'Bill', 10, start, rule, 'b');
    expect(expandSource(d.sources[0]!, '2026-12-01', through).map((o) => o.scheduledDate)).toEqual(expected);
  });

  it('every 3 months from Nov 30 lands on Feb 28, May 30, and Aug 30', () => {
    const d = source(ops.emptyData(), TODAY, 'bill', 'Bill', 10, '2026-11-30', { type: 'custom', interval: 3, unit: 'month' }, 'b');
    expect(expandSource(d.sources[0]!, '2026-11-01', '2027-08-31').map((o) => o.scheduledDate)).toEqual(['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30']);
  });
});

describe('pay periods and the next payday', () => {
  it('several paydays in one week: only the main paycheck starts a pay period, and each counts once', () => {
    let d = ops.emptyData();
    d = source(d, TODAY, 'income', 'Main job', 1000, '2026-10-12', { type: 'biweekly' }, 'main');
    for (const [i, day] of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].entries()) {
      d = source(d, TODAY, 'income', `Gig ${i + 1}`, 100, day, { type: 'biweekly' }, `gig${i}`);
    }
    const f = buildForecast(d, TODAY);
    expect(paycheckCycles(f).slice(0, 2).map((c) => [c.start, c.end])).toEqual([
      ['2026-10-12', '2026-10-25'],
      ['2026-10-26', '2026-11-08'],
    ]);
    expect(ledger(f, '2026-10-12', '2026-10-18').map((r) => r[2])).toEqual([1000, 1100, 1200, 1300, 1400]);
  });

  const anchorCases: { name: string; change: (d: AppData) => AppData; today: string; payday: string }[] = [
    { name: 'next paycheck ahead', change: (d) => d, today: TODAY, payday: '2026-10-15' },
    {
      name: 'paycheck moved later',
      change: (d) => unwrap(ops.rescheduleOccurrence(d, id('pay', '2026-10-15'), { date: '2026-10-16', amountCents: usd(2000.1) }, clock)),
      today: TODAY,
      payday: '2026-10-16',
    },
    {
      name: 'paycheck canceled: the following one',
      change: (d) => unwrap(ops.cancelOccurrence(d, id('pay', '2026-10-15'), '', clock)),
      today: TODAY,
      payday: '2026-10-29',
    },
    {
      name: 'paycheck received today',
      change: (d) => unwrap(ops.recordActual(d, id('pay', '2026-10-15'), { amountCents: usd(2000.1), date: '2026-10-15' }, clockAt('2026-10-15'))),
      today: '2026-10-15',
      payday: '2026-10-15',
    },
    {
      name: 'paycheck received early, before today: the following one',
      change: (d) => unwrap(ops.recordActual(d, id('pay', '2026-10-15'), { amountCents: usd(2000.1), date: '2026-10-11' }, clock)),
      today: '2026-10-12',
      payday: '2026-10-29',
    },
    { name: 'paycheck late and not yet received', change: (d) => d, today: '2026-10-17', payday: '2026-10-15' },
    {
      name: 'raise from a later payday',
      change: (d) => unwrap(ops.changeSourceSchedule(d, 'pay', { startDate: '2026-10-29', amountCents: usd(2100), rule: { type: 'biweekly' } }, clock)),
      today: TODAY,
      payday: '2026-10-15',
    },
  ];

  it.each(anchorCases)('anchor: $name', ({ change, today, payday }) => {
    const f = buildForecast(change(household()), today);
    expect(f.forecastStart).toBe(payday);
    // The running total starts at the payday's own amount (plus anything else that day).
    const first = dailyTimeline(f, payday, payday)[0]!;
    expect(first.tallyCents).toBe(first.netCents);
  });
});
