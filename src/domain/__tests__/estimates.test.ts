import { describe, expect, it } from 'vitest';
import { analyzeEstimate, approveEstimate, dismissEstimate, estimateSuggestions, minimumChange, previewEstimate, type EstimateSuggestion } from '../estimates';
import { buildForecast, periodKpis } from '../forecast';
import { findOccurrence, variance } from '../occurrences';
import * as ops from '../operations';
import type { AppData, RecurrenceRule, TransactionKind } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

/*
 * Today is Fri 2026-10-16. Most items are monthly bills; the October
 * occurrence is left unpaid (overdue), so the next outstanding payment, and
 * the earliest a new estimate can start, is in November.
 */
const TODAY = '2026-10-16';
const clock = clockAt(TODAY);

function item(dollars: number, start: string, opts: { id?: string; name?: string; kind?: TransactionKind; rule?: RecurrenceRule } = {}, d: AppData = ops.emptyData()): AppData {
  return source(d, start, opts.kind ?? 'bill', opts.name ?? 'Electricity', dollars, start, opts.rule ?? { type: 'monthly' }, opts.id ?? 'elec');
}

/** Records payments: [original date, dollars, actual date (defaults to the original date)]. */
function pay(d: AppData, id: string, payments: [string, number, string?][], today = TODAY): AppData {
  for (const [date, dollars, actual] of payments) {
    d = unwrap(ops.recordActual(d, `${id}@${date}`, { amountCents: usd(dollars), date: actual ?? date }, clockAt(today)));
  }
  return d;
}

const suggestion = (d: AppData, id = 'elec', today = TODAY) => analyzeEstimate(d, id, today).suggestion!;

/** Electricity estimated at $180, paid Apr–Sep: 210, 215, 220, 205, 225, 210. */
function electricity(estimate = 180, start = '2026-01-03'): AppData {
  return pay(item(estimate, start), 'elec', [
    ['2026-04-03', 210],
    ['2026-05-03', 215],
    ['2026-06-03', 220],
    ['2026-07-03', 205],
    ['2026-08-03', 225],
    ['2026-09-03', 210],
  ]);
}

describe('consistent and varying amounts', () => {
  it('a bill paid at the same new amount each time: suggests that exact amount', () => {
    const d = pay(item(60, '2026-01-25', { id: 'phone', name: 'Phone' }), 'phone', [
      ['2026-06-25', 65],
      ['2026-07-25', 65],
      ['2026-08-25', 65],
      ['2026-09-25', 65],
    ]);
    const s = suggestion(d, 'phone');
    expect(s).toMatchObject({
      pattern: 'steady',
      scope: 'from-date',
      occurrenceId: 'phone@2026-10-25',
      effectiveDate: '2026-10-25',
      currentCents: 6000,
      proposedCents: 6500,
      differenceCents: 500,
      lowCents: 6500,
      highCents: 6500,
      averageCents: 6500,
      confidence: 'limited',
      through: '2026-09-25',
      explanation: 'Your last 4 Phone payments were each $65.00. Your current estimate is $60.00. Consider $65.00 from Oct 25, 2026.',
      limitations: ['Based on only 4 payments.'],
    });
    expect(s.observations.map((o) => [o.originalDate, o.actualAmountCents, o.counted])).toEqual([
      ['2026-06-25', 6500, true],
      ['2026-07-25', 6500, true],
      ['2026-08-25', 6500, true],
      ['2026-09-25', 6500, true],
    ]);
  });

  it('payments that match the estimate: nothing to suggest', () => {
    const d = pay(item(60, '2026-01-25', { id: 'phone', name: 'Phone' }), 'phone', [
      ['2026-07-25', 60],
      ['2026-08-25', 60],
      ['2026-09-25', 60],
    ]);
    expect(analyzeEstimate(d, 'phone', TODAY)).toMatchObject({ suggestion: null, reason: 'close-enough' });
  });

  it('a varying bill above its estimate: the average of recent payments, rounded up to a dollar', () => {
    // 210 + 215 + 220 + 205 + 225 + 210 = $1,285; / 6 = $214.1666…
    const s = suggestion(electricity());
    expect(s).toMatchObject({
      pattern: 'variable',
      occurrenceId: 'elec@2026-11-03',
      effectiveDate: '2026-11-03',
      currentCents: 18000,
      proposedCents: 21500,
      differenceCents: 3500,
      lowCents: 20500,
      highCents: 22500,
      averageCents: 21417,
      confidence: 'established',
      through: '2026-09-03',
      explanation: 'Your last 6 Electricity payments averaged $214.17 and ranged from $205.00 to $225.00. Your current estimate is $180.00. Consider $215.00 from Nov 3, 2026.',
      limitations: ['Rounded up to the next whole dollar.'],
    });
    expect(s.observations.every((o) => o.counted)).toBe(true);
  });

  it('water that regularly runs $70 to $85 against a $60 estimate', () => {
    const d = pay(item(60, '2026-01-10', { id: 'water', name: 'Water' }), 'water', [
      ['2026-04-10', 70],
      ['2026-05-10', 85],
      ['2026-06-10', 78],
      ['2026-07-10', 72],
      ['2026-08-10', 80],
      ['2026-09-10', 75],
    ]);
    // $460 / 6 = $76.666…
    expect(suggestion(d, 'water')).toMatchObject({
      pattern: 'variable',
      currentCents: 6000,
      proposedCents: 7700,
      differenceCents: 1700,
      averageCents: 7667,
      effectiveDate: '2026-11-10',
      explanation: 'Your last 6 Water payments averaged $76.67 and ranged from $70.00 to $85.00. Your current estimate is $60.00. Consider $77.00 from Nov 10, 2026.',
    });
  });

  it('a gradually rising bill: the latest amount, not the older average', () => {
    const d = pay(item(60, '2026-01-10', { id: 'water', name: 'Water' }), 'water', [
      ['2026-01-10', 60],
      ['2026-02-10', 60],
      ['2026-03-10', 60],
      ['2026-04-10', 60],
      ['2026-05-10', 60],
      ['2026-06-10', 62],
      ['2026-07-10', 66],
      ['2026-08-10', 70],
      ['2026-09-10', 75],
    ]);
    const s = suggestion(d, 'water');
    // The last six average $65.50, which would already be out of date.
    expect(s).toMatchObject({
      pattern: 'rising',
      currentCents: 6000,
      proposedCents: 7500,
      differenceCents: 1500,
      lowCents: 6200,
      highCents: 7500,
      averageCents: 6825,
      confidence: 'limited',
      explanation: 'Your last 4 Water payments went up each time, from $62.00 to $75.00. Your current estimate is $60.00. Consider $75.00 from Nov 10, 2026.',
      limitations: ['Based on only 4 payments.', "Uses the latest amount; it doesn't assume the rise continues."],
    });
    expect(s.observations.filter((o) => o.counted).map((o) => o.originalDate)).toEqual(['2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10']);
  });

  it('a gradually falling payment: the latest amount, rounded up to a dollar', () => {
    const d = pay(item(90, '2026-01-12', { id: 'net', name: 'Internet', kind: 'subscription' }), 'net', [
      ['2026-06-12', 90],
      ['2026-07-12', 84],
      ['2026-08-12', 79],
      ['2026-09-12', 75.5],
    ]);
    expect(suggestion(d, 'net')).toMatchObject({
      pattern: 'falling',
      currentCents: 9000,
      proposedCents: 7600,
      differenceCents: -1400,
      effectiveDate: '2026-11-12',
      explanation: 'Your last 4 Internet payments went down each time, from $90.00 to $75.50. Your current estimate is $90.00. Consider $76.00 from Nov 12, 2026.',
      limitations: ['Based on only 4 payments.', "Uses the latest amount; it doesn't assume the drop continues.", 'Rounded up to the next whole dollar.'],
    });
  });
});

describe('unusual payments', () => {
  const sevenThenHigh: [string, number][] = [
    ['2026-03-03', 148],
    ['2026-04-03', 152],
    ['2026-05-03', 150],
    ['2026-06-03', 149],
    ['2026-07-03', 151],
    ['2026-08-03', 150],
    ['2026-09-03', 400],
  ];

  it('seven bills near $150 and then $400: the $400 is left out and $150 still fits', () => {
    const a = analyzeEstimate(pay(item(150, '2026-01-03'), 'elec', sevenThenHigh), 'elec', TODAY);
    expect(a.reason).toBe('close-enough');
    expect(a.observations.map((o) => [o.originalDate, o.counted])).toEqual([
      ['2026-03-03', false], // older than the latest six
      ['2026-04-03', true],
      ['2026-05-03', true],
      ['2026-06-03', true],
      ['2026-07-03', true],
      ['2026-08-03', true],
      ['2026-09-03', false], // unusual
    ]);
  });

  it('the same bills against a $120 estimate: suggests from the typical payments and names the one left out', () => {
    // 152 + 150 + 149 + 151 + 150 = $752; / 5 = $150.40.
    expect(suggestion(pay(item(120, '2026-01-03'), 'elec', sevenThenHigh))).toMatchObject({
      pattern: 'variable',
      currentCents: 12000,
      proposedCents: 15100,
      averageCents: 15040,
      lowCents: 14900,
      highCents: 15200,
      confidence: 'limited',
      explanation: '5 of your last 6 Electricity payments averaged $150.40 and ranged from $149.00 to $152.00. Your current estimate is $120.00. Consider $151.00 from Nov 3, 2026.',
      limitations: ['Based on only 5 payments.', 'Left out as unusual: $400.00 (Sep 3, 2026).', 'Rounded up to the next whole dollar.'],
    });
  });

  it('a jump at the end of small increases is not a rising trend', () => {
    const d = pay(item(150, '2026-01-03'), 'elec', [
      ['2026-04-03', 148],
      ['2026-05-03', 149],
      ['2026-06-03', 150],
      ['2026-07-03', 151],
      ['2026-08-03', 152],
      ['2026-09-03', 400],
    ]);
    expect(analyzeEstimate(d, 'elec', TODAY)).toMatchObject({ suggestion: null, reason: 'close-enough' });
  });

  it('one unusually low payment is left out', () => {
    const d = pay(item(100, '2026-01-03', { name: 'Gas' }), 'elec', [
      ['2026-04-03', 130],
      ['2026-05-03', 128],
      ['2026-06-03', 132],
      ['2026-07-03', 131],
      ['2026-08-03', 40],
      ['2026-09-03', 129],
    ]);
    expect(suggestion(d)).toMatchObject({
      pattern: 'variable',
      currentCents: 10000,
      proposedCents: 13000,
      averageCents: 13000,
      explanation: '5 of your last 6 Gas payments averaged $130.00 and ranged from $128.00 to $132.00. Your current estimate is $100.00. Consider $130.00 from Nov 3, 2026.',
      limitations: ['Based on only 5 payments.', 'Left out as unusual: $40.00 (Aug 3, 2026).'],
    });
  });

  it('payments too scattered to estimate from: no suggestion', () => {
    const d = pay(item(120, '2026-01-03'), 'elec', [
      ['2026-04-03', 100],
      ['2026-05-03', 200],
      ['2026-06-03', 100],
      ['2026-07-03', 200],
      ['2026-08-03', 100],
      ['2026-09-03', 200],
    ]);
    expect(analyzeEstimate(d, 'elec', TODAY)).toMatchObject({ suggestion: null, reason: 'inconsistent' });
  });
});

describe('seasonal amounts', () => {
  /** A year of electricity, Oct 2025–Sep 2026, high in winter and summer, plus Sep 2025. */
  function seasonal(): AppData {
    return pay(item(180, '2025-09-03'), 'elec', [
      ['2025-09-03', 190],
      ['2025-10-03', 160],
      ['2025-11-03', 240],
      ['2025-12-03', 270],
      ['2026-01-03', 280],
      ['2026-02-03', 250],
      ['2026-03-03', 190],
      ['2026-04-03', 150],
      ['2026-05-03', 140],
      ['2026-06-03', 170],
      ['2026-07-03', 230],
      ['2026-08-03', 240],
      ['2026-09-03', 180],
    ]);
  }

  it('with a year of history, the next payment is suggested from the same month last year, for that payment only', () => {
    // Last 12 sorted: 140 150 160 170 180 190 230 240 240 250 270 280; median $210.
    // More than 25% away (below $157.50 or above $262.50): 140, 150, 270, 280.
    const s = suggestion(seasonal());
    expect(s).toMatchObject({
      pattern: 'seasonal',
      scope: 'one-payment',
      occurrenceId: 'elec@2026-11-03',
      effectiveDate: '2026-11-03',
      currentCents: 18000,
      proposedCents: 24000,
      differenceCents: 6000,
      confidence: 'limited',
      through: '2026-09-03',
      explanation: 'Electricity may change with the season. Your November 2025 payment was $240.00. Your Nov 3, 2026 payment is expected at $180.00. Consider $240.00 for that payment.',
      limitations: ["Based on one earlier November; one year doesn't show a reliable yearly pattern.", 'For this one payment only; later payments keep $180.00.'],
    });
    expect(s.observations.filter((o) => o.counted).map((o) => o.originalDate)).toEqual(['2025-11-03']);
  });

  it('approving it changes only that payment', () => {
    const d = seasonal();
    const next = unwrap(approveEstimate(d, suggestion(d), clock));
    expect(next.sources).toBe(d.sources);
    expect(findOccurrence(next, 'elec@2026-11-03', TODAY)).toMatchObject({ expectedAmountCents: 18000, scheduledAmountCents: 24000, scheduledDate: '2026-11-03', status: 'scheduled' });
    expect(findOccurrence(next, 'elec@2026-12-03', TODAY)).toMatchObject({ scheduledAmountCents: 18000, virtual: true });
    expect(analyzeEstimate(next, 'elec', TODAY).reason).toBe('close-enough');
  });

  it('a payment already moved to another date keeps that date', () => {
    let d = seasonal();
    d = unwrap(ops.rescheduleOccurrence(d, 'elec@2026-11-03', { date: '2026-11-06', amountCents: usd(180) }, clock));
    const s = suggestion(d);
    expect(s).toMatchObject({ occurrenceId: 'elec@2026-11-03', effectiveDate: '2026-11-06', currentCents: 18000, proposedCents: 24000 });
    expect(s.explanation).toBe('Electricity may change with the season. Your November 2025 payment was $240.00. Your Nov 6, 2026 payment is expected at $180.00. Consider $240.00 for that payment.');
    const next = unwrap(approveEstimate(d, s, clock));
    expect(findOccurrence(next, 'elec@2026-11-03', TODAY)).toMatchObject({ expectedDate: '2026-11-03', scheduledDate: '2026-11-06', expectedAmountCents: 18000, scheduledAmountCents: 24000 });
  });

  it('less than a year of the same swings: no seasonal suggestion', () => {
    const d = pay(item(180, '2026-01-03'), 'elec', [
      ['2026-04-03', 150],
      ['2026-05-03', 140],
      ['2026-06-03', 170],
      ['2026-07-03', 230],
      ['2026-08-03', 240],
      ['2026-09-03', 180],
    ]);
    // Median $175; 230 and 240 are unusual; 150 140 170 180 average $160 and range $140–$180, which includes $180.
    expect(analyzeEstimate(d, 'elec', TODAY)).toMatchObject({ suggestion: null, reason: 'close-enough' });
  });
});

describe('too little history', () => {
  it('no payments recorded: keeps the estimate, suggests nothing', () => {
    expect(analyzeEstimate(item(180, '2026-01-03'), 'elec', TODAY)).toEqual({ sourceId: 'elec', suggestion: null, reason: 'insufficient-history', observations: [] });
  });

  it('two payments, however different, are not enough', () => {
    const d = pay(item(180, '2026-01-03'), 'elec', [
      ['2026-08-03', 260],
      ['2026-09-03', 270],
    ]);
    const a = analyzeEstimate(d, 'elec', TODAY);
    expect(a.reason).toBe('insufficient-history');
    expect(a.observations.map((o) => o.actualAmountCents)).toEqual([26000, 27000]);
  });

  it('a new person with only their estimates gets a forecast and no suggestions', () => {
    let d = item(1800, '2026-10-22', { id: 'pay', name: 'Paycheck', kind: 'income', rule: { type: 'biweekly' } });
    d = item(1200, '2026-11-01', { id: 'rent', name: 'Rent' }, d);
    d = item(180, '2026-11-03', {}, d);
    expect(estimateSuggestions(d, TODAY)).toEqual([]);
    const f = buildForecast(d, TODAY);
    expect(f.issue).toBeNull();
    expect(periodKpis(f, '2026-11-01', '2026-11-30')).toEqual({ incomeCents: usd(3600), outflowCents: usd(1380), netCents: usd(2220) });
  });
});

describe('schedule and rate changes', () => {
  it('payments from before the estimate last changed are not counted', () => {
    let d = pay(item(300, '2026-01-01', { id: 'loan', name: 'Car loan', kind: 'liability' }), 'loan', [
      ['2026-04-01', 300],
      ['2026-05-01', 300],
      ['2026-06-01', 300],
    ]);
    d = unwrap(ops.changeSourceSchedule(d, 'loan', { startDate: '2026-07-01', amountCents: usd(250), rule: { type: 'monthly' } }, clockAt('2026-06-20')));
    d = pay(d, 'loan', [
      ['2026-07-01', 270],
      ['2026-08-01', 270],
      ['2026-09-01', 270],
    ]);
    const s = suggestion(d, 'loan');
    expect(s).toMatchObject({
      pattern: 'steady',
      currentCents: 25000,
      proposedCents: 27000,
      effectiveDate: '2026-11-01',
      limitations: ['Based on only 3 payments.', 'Counts only payments since your estimate became $250.00 on Jul 1, 2026.'],
    });
    expect(s.observations.map((o) => o.originalDate)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('after a known rate increase, older payments at the old rate don’t suggest going back', () => {
    let d = pay(item(140, '2026-01-01', { id: 'ins', name: 'Insurance' }), 'ins', [
      ['2026-03-01', 140],
      ['2026-04-01', 140],
      ['2026-05-01', 140],
      ['2026-06-01', 140],
    ]);
    d = unwrap(ops.changeSourceSchedule(d, 'ins', { startDate: '2026-08-01', amountCents: usd(155), rule: { type: 'monthly' } }, clockAt('2026-07-20')));
    d = pay(d, 'ins', [
      ['2026-08-01', 155],
      ['2026-09-01', 155],
    ]);
    expect(analyzeEstimate(d, 'ins', TODAY)).toMatchObject({ suggestion: null, reason: 'insufficient-history' });
  });

  it('a rate rise the person hasn’t entered yet: suggested once three payments show it', () => {
    const d = pay(item(140, '2026-01-01', { id: 'ins', name: 'Insurance' }), 'ins', [
      ['2026-04-01', 140],
      ['2026-05-01', 140],
      ['2026-06-01', 140],
      ['2026-07-01', 155],
      ['2026-08-01', 155],
      ['2026-09-01', 155],
    ]);
    expect(suggestion(d, 'ins')).toMatchObject({
      pattern: 'steady',
      proposedCents: 15500,
      explanation: 'Your last 3 Insurance payments were each $155.00. Your current estimate is $140.00. Consider $155.00 from Nov 1, 2026.',
    });
  });

  it('a change the person has already set for later: no suggestion until it starts', () => {
    let d = electricity();
    d = unwrap(ops.changeSourceSchedule(d, 'elec', { startDate: '2027-01-03', amountCents: usd(200), rule: { type: 'monthly' } }, clock));
    expect(analyzeEstimate(d, 'elec', TODAY)).toMatchObject({ suggestion: null, reason: 'upcoming-change' });
  });

  it('moving the date without changing the amount keeps earlier payments', () => {
    let d = pay(item(180, '2026-01-03'), 'elec', [
      ['2026-04-03', 215],
      ['2026-05-03', 215],
      ['2026-06-03', 215],
    ]);
    d = unwrap(ops.changeSourceSchedule(d, 'elec', { startDate: '2026-07-05', amountCents: usd(180), rule: { type: 'monthly' } }, clockAt('2026-06-20')));
    d = pay(d, 'elec', [
      ['2026-07-05', 215],
      ['2026-08-05', 215],
      ['2026-09-05', 215],
    ]);
    expect(suggestion(d)).toMatchObject({ pattern: 'steady', effectiveDate: '2026-11-05', confidence: 'established', explanation: 'Your last 6 Electricity payments were each $215.00. Your current estimate is $180.00. Consider $215.00 from Nov 5, 2026.', limitations: [] });
  });

  it('a month-end schedule starts the new estimate on a date that keeps every later date', () => {
    const d = pay(item(180, '2026-01-31', { id: 'card', name: 'Card', kind: 'liability' }), 'card', [
      ['2026-08-31', 200],
      ['2026-09-30', 200],
      ['2026-10-31', 200],
    ], '2026-11-01');
    // Nov 30 is the 31st clamped; a schedule started on Nov 30 would fall on Dec 30.
    const s = suggestion(d, 'card', '2026-11-01');
    expect(s).toMatchObject({ occurrenceId: 'card@2026-12-31', effectiveDate: '2026-12-31', proposedCents: 20000 });
    const next = unwrap(approveEstimate(d, s, clockAt('2026-11-01')));
    const f = buildForecast(next, '2026-11-01');
    const dates = f.entries.filter((e) => e.occurrence.sourceId === 'card' && e.date >= '2026-11-01' && e.date <= '2027-03-31').map((e) => [e.date, e.amountCents]);
    expect(dates).toEqual([
      ['2026-11-30', 18000],
      ['2026-12-31', 20000],
      ['2027-01-31', 20000],
      ['2027-02-28', 20000],
      ['2027-03-31', 20000],
    ]);
  });
});

describe('payments on different dates', () => {
  it('early, late and same-month payments each count once, for their own occurrence', () => {
    const d = pay(item(180, '2026-01-03'), 'elec', [
      ['2026-04-03', 210, '2026-04-09'],
      ['2026-05-03', 215, '2026-04-30'],
      ['2026-06-03', 220],
      ['2026-07-03', 205, '2026-08-01'],
      ['2026-08-03', 225, '2026-08-02'],
      ['2026-09-03', 210, '2026-09-01'],
    ]);
    const s = suggestion(d);
    expect(s.observations.map((o) => [o.originalDate, o.actualDate])).toEqual([
      ['2026-04-03', '2026-04-09'],
      ['2026-05-03', '2026-04-30'],
      ['2026-06-03', '2026-06-03'],
      ['2026-07-03', '2026-08-01'],
      ['2026-08-03', '2026-08-02'],
      ['2026-09-03', '2026-09-01'],
    ]);
    const same = suggestion(electricity());
    expect({ ...s, observations: [] }).toEqual({ ...same, observations: [] });
  });

  it('a payment moved to another date, then paid, counts once', () => {
    let d = item(180, '2026-01-03');
    d = pay(d, 'elec', [
      ['2026-06-03', 215],
      ['2026-07-03', 215],
    ]);
    d = unwrap(ops.rescheduleOccurrence(d, 'elec@2026-08-03', { date: '2026-08-20', amountCents: usd(180) }, clockAt('2026-08-01')));
    d = pay(d, 'elec', [['2026-08-03', 215, '2026-08-20']]);
    const s = suggestion(d);
    expect(s.observations.map((o) => o.occurrenceId)).toEqual(['elec@2026-06-03', 'elec@2026-07-03', 'elec@2026-08-03']);
    expect(s.proposedCents).toBe(21500);
  });
});

describe('minimum change', () => {
  it('is $5 or 5% of the current estimate, whichever is more, in whole cents', () => {
    expect(minimumChange(6000)).toBe(500);
    expect(minimumChange(18000)).toBe(900);
    expect(minimumChange(15500)).toBe(775);
    expect(minimumChange(15501)).toBe(776);
  });

  it('an estimate inside the range of recent payments: no suggestion', () => {
    expect(analyzeEstimate(electricity(212), 'elec', TODAY)).toMatchObject({ suggestion: null, reason: 'close-enough' });
  });

  it('a steady difference smaller than the minimum: no suggestion', () => {
    const d = pay(item(155, '2026-01-01', { id: 'ins', name: 'Insurance' }), 'ins', [
      ['2026-07-01', 162.74],
      ['2026-08-01', 162.74],
      ['2026-09-01', 162.74],
    ]);
    // $7.74 < $7.75
    expect(analyzeEstimate(d, 'ins', TODAY).reason).toBe('close-enough');
    const e = pay(item(155, '2026-01-01', { id: 'ins', name: 'Insurance' }), 'ins', [
      ['2026-07-01', 162.75],
      ['2026-08-01', 162.75],
      ['2026-09-01', 162.75],
    ]);
    expect(suggestion(e, 'ins')).toMatchObject({ proposedCents: 16275, differenceCents: 775 });
  });
});

describe('approving', () => {
  it('changes the estimate from the effective date only, through a schedule change', () => {
    const d = electricity();
    const next = unwrap(approveEstimate(d, suggestion(d), clock));
    const src = next.sources.find((s) => s.id === 'elec')!;
    expect(src.versions.map((v) => [v.startDate, v.amountCents])).toEqual([
      ['2026-01-03', 18000],
      ['2026-11-03', 21500],
    ]);
    expect(src.versions[1]!.rule).toEqual({ type: 'monthly' });
    expect(next.records).toBe(d.records);
    expect(findOccurrence(next, 'elec@2026-10-03', TODAY)).toMatchObject({ displayStatus: 'overdue', scheduledAmountCents: 18000 });
    expect(findOccurrence(next, 'elec@2026-11-03', TODAY)?.scheduledAmountCents).toBe(21500);
    expect(findOccurrence(next, 'elec@2026-12-03', TODAY)?.scheduledAmountCents).toBe(21500);
    // November's money out rises by exactly the difference.
    const nov = (x: AppData) => periodKpis(buildForecast(x, TODAY), '2026-11-01', '2026-11-30').outflowCents;
    expect(nov(next) - nov(d)).toBe(3500);
    // The approved change is now the estimate; nothing more to suggest until it starts.
    expect(analyzeEstimate(next, 'elec', TODAY).reason).toBe('upcoming-change');
  });

  it('keeps every original prediction and recorded payment', () => {
    const d = electricity();
    const next = unwrap(approveEstimate(d, suggestion(d), clock));
    expect(next.records).toEqual(d.records);
    const sep = next.records.find((r) => r.id === 'elec@2026-09-03')!;
    expect([sep.expectedAmountCents, sep.actualAmountCents]).toEqual([18000, 21000]);
    expect(variance(sep)).toEqual({ amountCents: 3000, days: 0 });
  });

  it('is refused once the data has changed since the suggestion', () => {
    const d = electricity();
    const s = suggestion(d);
    const later = pay(d, 'elec', [['2026-10-03', 230]]);
    expectError(approveEstimate(later, s, clock), /out of date/);
    expectError(dismissEstimate(later, s, clock), /out of date/);
  });

  it('is refused for a suggestion that was never made', () => {
    const d = electricity();
    const forged: EstimateSuggestion = { ...suggestion(d), proposedCents: 99900 };
    expectError(approveEstimate(d, forged, clock), /out of date/);
  });
});

describe('dismissing', () => {
  it('leaves the estimate and the forecast exactly as they were', () => {
    const d = electricity();
    const next = unwrap(dismissEstimate(d, suggestion(d), clock));
    expect(next.records).toBe(d.records);
    const { estimateDismissal, ...rest } = next.sources.find((s) => s.id === 'elec')!;
    expect(rest).toEqual(d.sources.find((s) => s.id === 'elec'));
    expect(estimateDismissal).toEqual({ currentCents: 18000, proposedCents: 21500, through: '2026-09-03' });
    expect(buildForecast(next, TODAY)).toEqual(buildForecast(d, TODAY));
  });

  it('doesn’t come back with the next payment unless the suggestion changes', () => {
    let d = electricity();
    d = unwrap(dismissEstimate(d, suggestion(d), clock));
    expect(analyzeEstimate(d, 'elec', TODAY).reason).toBe('dismissed');
    expect(estimateSuggestions(d, TODAY)).toEqual([]);
    // One more payment: the last six (215 220 205 225 210 212) still suggest $215.
    d = pay(d, 'elec', [['2026-10-03', 212]]);
    expect(analyzeEstimate(d, 'elec', TODAY).reason).toBe('dismissed');
  });

  it('can come back after three newer payments', () => {
    const today = '2027-01-16';
    let d = electricity();
    d = unwrap(dismissEstimate(d, suggestion(d), clock));
    d = pay(d, 'elec', [
      ['2026-10-03', 214],
      ['2026-11-03', 216],
      ['2026-12-03', 212],
    ], today);
    // Last six: 205 225 210 214 216 212 = $1,282; / 6 = $213.666…
    expect(suggestion(d, 'elec', today)).toMatchObject({ proposedCents: 21400, averageCents: 21367, through: '2026-12-03', effectiveDate: '2027-02-03' });
  });

  it('comes back when the suggested amount moves by at least the minimum change', () => {
    let d = pay(item(60, '2026-01-25', { id: 'phone', name: 'Phone' }), 'phone', [
      ['2026-07-25', 65],
      ['2026-08-25', 65],
      ['2026-09-25', 65],
    ]);
    d = unwrap(dismissEstimate(d, suggestion(d, 'phone'), clock));
    d = pay(d, 'phone', [['2026-10-25', 80]], '2026-10-26');
    // 65, 65, 65, 80: average $68.75, rounded up to $69; $4 from the dismissed $65.
    expect(analyzeEstimate(d, 'phone', '2026-10-26').reason).toBe('dismissed');
    d = pay(d, 'phone', [['2026-11-25', 80]], '2026-11-26');
    // 65, 65, 65, 80, 80: average $71; $6 from $65, with only two newer payments.
    expect(suggestion(d, 'phone', '2026-11-26')).toMatchObject({ pattern: 'variable', proposedCents: 7100, effectiveDate: '2026-12-25' });
  });
});

describe('income and savings', () => {
  function withIncome(): AppData {
    let d = item(1800, '2026-01-09', { id: 'pay', name: 'Paycheck', kind: 'income', rule: { type: 'biweekly' } });
    // Every other Friday from Jan 9: Aug 7, Aug 21, Sep 4, Sep 18, Oct 2, and today, Oct 16.
    d = pay(d, 'pay', [
      ['2026-08-07', 2100],
      ['2026-08-21', 2300],
      ['2026-09-04', 2050],
      ['2026-09-18', 2200],
      ['2026-10-02', 2150],
    ]);
    return item(100, '2026-01-20', { id: 'save', name: 'Savings', kind: 'savings' }, d);
  }

  it('recorded income never produces a suggestion or more expected income', () => {
    const d = pay(withIncome(), 'save', [
      ['2026-07-20', 150],
      ['2026-08-20', 150],
      ['2026-09-20', 150],
    ]);
    expect(analyzeEstimate(d, 'pay', TODAY)).toEqual({ sourceId: 'pay', suggestion: null, reason: 'not-estimated', observations: [] });
    expect(analyzeEstimate(d, 'save', TODAY).reason).toBe('not-estimated');
    expect(estimateSuggestions(d, TODAY)).toEqual([]);
    const upcoming = buildForecast(d, TODAY).entries.filter((e) => e.occurrence.kind === 'income' && e.date >= TODAY && e.date <= '2026-12-31');
    expect(upcoming.map((e) => [e.date, e.amountCents, e.occurrence.status])).toEqual([
      ['2026-10-16', 180000, 'scheduled'],
      ['2026-10-30', 180000, 'scheduled'],
      ['2026-11-13', 180000, 'scheduled'],
      ['2026-11-27', 180000, 'scheduled'],
      ['2026-12-11', 180000, 'scheduled'],
      ['2026-12-25', 180000, 'scheduled'],
    ]);
  });
});

describe('repeatable and exact', () => {
  function several(): AppData {
    let d = electricity();
    d = pay(item(60, '2026-01-10', { id: 'water', name: 'Water' }, d), 'water', [
      ['2026-07-10', 70],
      ['2026-08-10', 85],
      ['2026-09-10', 78],
    ]);
    return pay(item(60, '2026-01-25', { id: 'phone', name: 'Phone' }, d), 'phone', [
      ['2026-07-25', 65],
      ['2026-08-25', 65],
      ['2026-09-25', 65],
    ]);
  }

  it('lists every suggestion by the date it would start, the same every time, however records are stored', () => {
    const d = several();
    const list = estimateSuggestions(d, TODAY);
    expect(list.map((s) => [s.sourceId, s.effectiveDate, s.proposedCents])).toEqual([
      ['phone', '2026-10-25', 6500],
      ['elec', '2026-11-03', 21500],
      // 70 + 85 + 78 = $233; / 3 = $77.666…
      ['water', '2026-11-10', 7800],
    ]);
    expect(estimateSuggestions(d, TODAY)).toEqual(list);
    const shuffled: AppData = { ...d, records: [...d.records].reverse(), sources: [...d.sources].reverse() };
    expect(estimateSuggestions(shuffled, TODAY)).toEqual(list);
  });

  it('never changes the data or the forecast it reads', () => {
    const d = several();
    const before = JSON.stringify(d);
    const forecast = buildForecast(d, TODAY);
    estimateSuggestions(d, TODAY);
    for (const s of d.sources) analyzeEstimate(d, s.id, TODAY);
    expect(JSON.stringify(d)).toBe(before);
    expect(buildForecast(d, TODAY)).toEqual(forecast);
  });

  it('works in whole cents, rounding the suggestion up to a dollar', () => {
    const d = pay(item(90, '2026-01-03'), 'elec', [
      ['2026-07-03', 100.01],
      ['2026-08-03', 100.02],
      ['2026-09-03', 100.04],
    ]);
    // 10001 + 10002 + 10004 = 30007 cents; / 3 = 10002.33…
    const s = suggestion(d);
    expect(s).toMatchObject({ proposedCents: 10100, averageCents: 10002, lowCents: 10001, highCents: 10004, differenceCents: 1100 });
    expect(s.explanation).toBe('Your last 3 Electricity payments averaged $100.02 and ranged from $100.01 to $100.04. Your current estimate is $90.00. Consider $101.00 from Nov 3, 2026.');
  });
});

describe('why payments weren’t counted', () => {
  it('marks unusual and older payments', () => {
    const d = pay(item(120, '2026-01-03'), 'elec', [
      ['2026-03-03', 148],
      ['2026-04-03', 152],
      ['2026-05-03', 150],
      ['2026-06-03', 149],
      ['2026-07-03', 151],
      ['2026-08-03', 150],
      ['2026-09-03', 400],
    ]);
    expect(suggestion(d).observations.map((o) => [o.originalDate, o.counted, o.excluded])).toEqual([
      ['2026-03-03', false, 'earlier'],
      ['2026-04-03', true, null],
      ['2026-05-03', true, null],
      ['2026-06-03', true, null],
      ['2026-07-03', true, null],
      ['2026-08-03', true, null],
      ['2026-09-03', false, 'unusual'],
    ]);
  });
});

describe('previewing a suggestion', () => {
  /*
   * Paid $1,000 every other Friday from Oct 23 (the running total starts Oct
   * 22); rent $1,500 on the 1st from Nov 1; a one-time $940 insurance bill on
   * Jan 2; electricity as in `electricity()` but starting in April, so
   * nothing is overdue, October paid $210. The suggestion is $215 from
   * Nov 3. Running totals (now → with $215):
   *   Nov 1 −500; Nov 3 −680 → −715; Nov 6 320 → 285
   *   Dec 1 −180 → −215; Dec 3 −360 → −430; Dec 4 640 → 570
   *   Jan 1 1,140 → 1,070; Jan 2 200 → 130; Jan 3 20 → −85; Jan 15 1,020 → 915
   */
  function outlook(): AppData {
    let d = pay(electricity(180, '2026-04-03'), 'elec', [['2026-10-03', 210]]);
    d = item(1000, '2026-10-23', { id: 'pay', name: 'Paycheck', kind: 'income', rule: { type: 'biweekly' } }, d);
    d = item(1500, '2026-11-01', { id: 'rent', name: 'Rent' }, d);
    return unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Car insurance', amountCents: usd(940), date: '2027-01-02' }, clock, 'ins'));
  }

  it('covers every later payment of a change from a date on, over the 90-day window, without saving', () => {
    const d = outlook();
    const before = JSON.stringify(d);
    const s = suggestion(d);
    expect([s.proposedCents, s.effectiveDate]).toEqual([21500, '2026-11-03']);
    const r = previewEstimate(d, s, clock);
    if (!r.ok) throw new Error(r.error);
    const p = r.preview;
    expect(JSON.stringify(d)).toBe(before);
    expect(p).toMatchObject({ window: { start: '2026-10-23', end: '2027-01-20' }, comparable: true, reason: null, lowestChangeCents: -3500, continuesAfter: '2027-01-20' });
    expect(p.payments).toEqual([
      { occurrenceId: 'elec@2026-11-03', date: '2026-11-03', currentCents: 18000, proposedCents: 21500, inRunningTotal: true, currentTallyCents: -68000, proposedTallyCents: -71500 },
      { occurrenceId: 'elec@2026-12-03', date: '2026-12-03', currentCents: 18000, proposedCents: 21500, inRunningTotal: true, currentTallyCents: -36000, proposedTallyCents: -43000 },
      { occurrenceId: 'elec@2027-01-03', date: '2027-01-03', currentCents: 18000, proposedCents: 21500, inRunningTotal: true, currentTallyCents: 2000, proposedTallyCents: -8500 },
    ]);
    expect([p.current.lowest, p.proposed.lowest]).toEqual([
      { date: '2026-11-03', tallyCents: -68000 },
      { date: '2026-11-03', tallyCents: -71500 },
    ]);
    const gap = (g: { start: string; end: string; lowestCents: number }) => [g.start, g.end, g.lowestCents];
    expect(p.newGaps.map(gap)).toEqual([['2027-01-03', '2027-01-14', -8500]]);
    expect(p.worsenedGaps.map(gap)).toEqual([
      ['2026-11-01', '2026-11-05', -71500],
      ['2026-12-01', '2026-12-03', -43000],
    ]);
    expect([p.reducedGaps, p.resolvedGaps]).toEqual([[], []]);
  });

  it('a lower estimate shows gaps getting smaller or going away', () => {
    // Electricity estimated at $250; the same payments suggest $215.
    let d = pay(electricity(250, '2026-04-03'), 'elec', [['2026-10-03', 210]]);
    d = item(1000, '2026-10-23', { id: 'pay', name: 'Paycheck', kind: 'income', rule: { type: 'biweekly' } }, d);
    d = item(1500, '2026-11-01', { id: 'rent', name: 'Rent' }, d);
    d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Car insurance', amountCents: usd(940), date: '2027-01-02' }, clock, 'ins'));
    const r = previewEstimate(d, suggestion(d), clock);
    if (!r.ok) throw new Error(r.error);
    // Running totals now → with $215: Nov 3 −750 → −715; Dec 3 −500 → −430; Jan 2 60 → 130; Jan 3 −190 → −85.
    expect(r.preview.lowestChangeCents).toBe(3500);
    expect(r.preview.reducedGaps.map((g) => [g.start, g.lowestCents])).toEqual([
      ['2026-11-01', -71500],
      ['2026-12-01', -43000],
      ['2027-01-03', -8500],
    ]);
    expect(r.preview.newGaps).toEqual([]);
    expect(r.preview.worsenedGaps).toEqual([]);
  });

  it('a payment before the next payday changes cash flow, not the running total', () => {
    let d = pay(item(60, '2026-07-25', { id: 'phone', name: 'Phone' }), 'phone', [
      ['2026-07-25', 65],
      ['2026-08-25', 65],
      ['2026-09-25', 65],
    ]);
    d = item(1000, '2026-10-30', { id: 'pay', name: 'Paycheck', kind: 'income', rule: { type: 'biweekly' } }, d);
    const r = previewEstimate(d, suggestion(d, 'phone'), clock);
    if (!r.ok) throw new Error(r.error);
    // Running total from Oct 30: +1,000; Nov 13 +1,000 = 2,000; Nov 25 −65 instead of −60.
    expect(r.preview.payments.slice(0, 2)).toEqual([
      { occurrenceId: 'phone@2026-10-25', date: '2026-10-25', currentCents: 6000, proposedCents: 6500, inRunningTotal: false, currentTallyCents: null, proposedTallyCents: null },
      { occurrenceId: 'phone@2026-11-25', date: '2026-11-25', currentCents: 6000, proposedCents: 6500, inRunningTotal: true, currentTallyCents: 194000, proposedTallyCents: 193500 },
    ]);
  });

  it('a seasonal suggestion changes only its one payment', () => {
    const d = pay(item(180, '2025-09-03'), 'elec', [
      ['2025-09-03', 190],
      ['2025-10-03', 160],
      ['2025-11-03', 240],
      ['2025-12-03', 270],
      ['2026-01-03', 280],
      ['2026-02-03', 250],
      ['2026-03-03', 190],
      ['2026-04-03', 150],
      ['2026-05-03', 140],
      ['2026-06-03', 170],
      ['2026-07-03', 230],
      ['2026-08-03', 240],
      ['2026-09-03', 180],
    ]);
    const s = suggestion(d);
    expect(s.observations.filter((o) => o.excluded === 'other-month').length).toBe(11);
    const r = previewEstimate(d, s, clock);
    if (!r.ok) throw new Error(r.error);
    // No income, so no running total to compare.
    expect(r.preview).toMatchObject({ comparable: false, reason: 'no-forecast', continuesAfter: null });
    expect(r.preview.payments.map((p) => [p.date, p.currentCents, p.proposedCents, p.inRunningTotal])).toEqual([['2026-11-03', 18000, 24000, false]]);
  });

  it('is refused for an out-of-date suggestion', () => {
    const d = electricity();
    const s = suggestion(d);
    const r = previewEstimate(pay(d, 'elec', [['2026-10-03', 230]]), s, clock);
    expect(r).toEqual({ ok: false, error: 'This suggestion is out of date. Look at the latest one before choosing.' });
  });
});
