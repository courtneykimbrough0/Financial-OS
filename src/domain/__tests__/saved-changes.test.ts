import { describe, expect, it } from 'vitest';
import { isValidDateStr } from '../dates';
import { buildForecast, type Forecast } from '../forecast';
import { expandSource, findOccurrence, resolveOccurrences } from '../occurrences';
import * as ops from '../operations';
import type { AppData, RecurrenceRule } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

/*
 * Saved changes (stored records) against later schedule changes and turning
 * an item off. 2026-10-11 is a Sunday.
 *   Paycheck   $1,800 every 2 weeks from Thu Oct 15
 *   Phone      $60    monthly from Oct 25
 *   Rent       $1,000 monthly from Nov 1
 */
const TODAY = '2026-10-11';
const PAY = 'income-pay';
const PHONE = 'bill-phone';
const RENT = 'bill-rent';
const clock = clockAt(TODAY);
const id = (sourceId: string, date: string) => `${sourceId}@${date}`;

function baseline(): AppData {
  let d = ops.emptyData();
  d = source(d, TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, PAY);
  d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, PHONE);
  d = source(d, TODAY, 'bill', 'Rent', 1000, '2026-11-01', { type: 'monthly' }, RENT);
  return d;
}

/** Counted entries of one source through `end`, as [date, dollars, status]. */
function counted(f: Forecast, sourceId: string, end: string) {
  return f.entries
    .filter((e) => e.occurrence.sourceId === sourceId && e.counts && e.date <= end)
    .map((e) => [e.date, e.amountCents / 100, e.occurrence.status]);
}

/** Every entry of one source, counted or not, as [id, date, status]. */
function listed(f: Forecast, sourceId: string, end: string) {
  return f.entries.filter((e) => e.occurrence.sourceId === sourceId && e.date <= end).map((e) => [e.occurrence.id, e.date, e.occurrence.status]);
}

const moveRent = (d: AppData) => unwrap(ops.rescheduleOccurrence(d, id(RENT, '2026-11-01'), { date: '2026-11-03', amountCents: usd(1000) }, clock));

describe('a moved occurrence', () => {
  it('counts once, on its new date only', () => {
    const f = buildForecast(moveRent(baseline()), TODAY);
    expect(counted(f, RENT, '2026-12-31')).toEqual([
      ['2026-11-03', 1000, 'scheduled'],
      ['2026-12-01', 1000, 'scheduled'],
    ]);
  });

  it('changes only that occurrence', () => {
    const before = baseline();
    const after = moveRent(before);
    expect(after.records.map((r) => r.id)).toEqual([id(RENT, '2026-11-01')]);
    const others = (d: AppData) => buildForecast(d, TODAY).entries.filter((e) => e.occurrence.id !== id(RENT, '2026-11-01'));
    expect(others(after)).toEqual(others(before));
  });

  it('stays separate from the next occurrence when moved onto its date', () => {
    const d = unwrap(ops.rescheduleOccurrence(baseline(), id(RENT, '2026-11-01'), { date: '2026-12-01', amountCents: usd(1000) }, clock));
    // November's rent paid late, on the same day as December's: two payments.
    expect(listed(buildForecast(d, TODAY), RENT, '2026-12-31')).toEqual([
      [id(RENT, '2026-11-01'), '2026-12-01', 'scheduled'],
      [id(RENT, '2026-12-01'), '2026-12-01', 'scheduled'],
    ]);
  });

  it('keeps the moved date and amount when only later amounts change', () => {
    // Same day of the month, new amount from Nov 1: Nov 1 still exists, so the saved change still applies to it.
    let d = moveRent(baseline());
    d = unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-11-01', amountCents: usd(1100), rule: { type: 'monthly' } }, clock));
    expect(counted(buildForecast(d, TODAY), RENT, '2026-12-31')).toEqual([
      ['2026-11-03', 1000, 'scheduled'],
      ['2026-12-01', 1100, 'scheduled'],
    ]);
  });
});

describe('D1: moving an occurrence, then changing the schedule', () => {
  // From Oct 30 rent is due on the 30th: the Nov 1 occurrence that was moved to Nov 3 no longer exists.
  const toThe30th = (d: AppData) =>
    unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-10-30', amountCents: usd(1100), rule: { type: 'monthly' } }, clock));

  it('counts the new schedule only, not the moved occurrence it replaced', () => {
    const f = buildForecast(toThe30th(moveRent(baseline())), TODAY);
    expect(listed(f, RENT, '2026-12-31')).toEqual([
      [id(RENT, '2026-10-30'), '2026-10-30', 'scheduled'],
      [id(RENT, '2026-11-30'), '2026-11-30', 'scheduled'],
      [id(RENT, '2026-12-30'), '2026-12-30', 'scheduled'],
    ]);
    // Same result as changing the schedule without moving anything first.
    expect(f.entries).toEqual(buildForecast(toThe30th(baseline()), TODAY).entries);
  });

  it('keeps the saved change on record, unchanged', () => {
    const moved = moveRent(baseline());
    const d = toThe30th(moved);
    expect(d.records).toEqual(moved.records);
    expect(d.records[0]).toMatchObject({ expectedDate: '2026-11-01', expectedAmountCents: usd(1000), scheduledDate: '2026-11-03', status: 'scheduled' });
  });

  it('applies the saved change again if a later schedule brings back its original date', () => {
    let d = toThe30th(moveRent(baseline()));
    d = unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-11-01', amountCents: usd(1000), rule: { type: 'monthly' } }, clock));
    expect(counted(buildForecast(d, TODAY), RENT, '2026-12-31')).toEqual([
      ['2026-10-30', 1100, 'scheduled'],
      ['2026-11-03', 1000, 'scheduled'],
      ['2026-12-01', 1000, 'scheduled'],
    ]);
  });

  it('a replaced occurrence can no longer be opened or changed', () => {
    const d = toThe30th(moveRent(baseline()));
    expect(findOccurrence(d, id(RENT, '2026-11-01'), TODAY)).toBeNull();
    expectError(ops.recordActual(d, id(RENT, '2026-11-01'), { amountCents: usd(1000), date: TODAY }, clock), /could not be found/);
    expect(findOccurrence(d, id(RENT, '2026-11-30'), TODAY)).toMatchObject({ scheduledAmountCents: usd(1100), virtual: true });
  });

  it('a change that starts after the moved occurrence leaves it in place', () => {
    // Existing rule: occurrences before a change's start date keep the old schedule, moved or not.
    let d = moveRent(baseline());
    d = unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-11-05', amountCents: usd(1100), rule: { type: 'monthly' } }, clock));
    expect(counted(buildForecast(d, TODAY), RENT, '2026-12-31')).toEqual([
      ['2026-11-03', 1000, 'scheduled'],
      ['2026-11-05', 1100, 'scheduled'],
      ['2026-12-05', 1100, 'scheduled'],
    ]);
  });
});

describe('D2: moving an occurrence, then turning the item off', () => {
  it('counts nothing from the turned-off item', () => {
    let d = moveRent(baseline());
    d = unwrap(ops.deactivateSource(d, RENT, clock));
    const f = buildForecast(d, TODAY);
    expect(listed(f, RENT, '2027-12-31')).toEqual([]);
    expect(d.records).toEqual(moveRent(baseline()).records);
  });

  it('stays out after turning the item back on later', () => {
    let d = moveRent(baseline());
    d = unwrap(ops.deactivateSource(d, RENT, clock));
    d = unwrap(ops.reactivateSource(d, RENT, '2026-12-01', clockAt('2026-11-20')));
    expect(counted(buildForecast(d, '2026-11-20'), RENT, '2027-01-31')).toEqual([
      ['2026-12-01', 1000, 'scheduled'],
      ['2027-01-01', 1000, 'scheduled'],
    ]);
  });

  it('keeps an outstanding occurrence that was due before the item was turned off', () => {
    // Phone's Oct 25 bill was moved to Oct 28 and is still unpaid on Nov 2, when the phone is turned off.
    let d = unwrap(ops.rescheduleOccurrence(baseline(), id(PHONE, '2026-10-25'), { date: '2026-10-28', amountCents: usd(60) }, clock));
    d = unwrap(ops.deactivateSource(d, PHONE, clockAt('2026-11-02')));
    const f = buildForecast(d, '2026-11-02');
    expect(listed(f, PHONE, '2027-12-31')).toEqual([[id(PHONE, '2026-10-25'), '2026-10-28', 'scheduled']]);
    expect(f.entries.find((e) => e.occurrence.sourceId === PHONE)!.occurrence.displayStatus).toBe('overdue');
  });
});

describe('recorded history after later changes', () => {
  it('D3: a payment made early stays on record and counts on its actual date', () => {
    // Which later payment (if any) an early payment covers after a schedule change is an open product decision;
    // see "a stored outcome survives a later schedule change" in forecast.test.ts for today's behavior.
    let d = unwrap(ops.recordActual(baseline(), id(RENT, '2026-12-01'), { amountCents: usd(1000), date: TODAY }, clock));
    const paid = d.records[0]!;
    d = unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-11-05', amountCents: usd(1100), rule: { type: 'monthly' } }, clock));
    expect(d.records).toEqual([paid]);
    expect(paid).toMatchObject({ expectedDate: '2026-12-01', expectedAmountCents: usd(1000), actualDate: TODAY, actualAmountCents: usd(1000), status: 'completed' });
    const f = buildForecast(d, TODAY);
    expect(f.entries.filter((e) => e.occurrence.id === paid.id).map((e) => [e.date, e.amountCents / 100, e.counts])).toEqual([[TODAY, 1000, true]]);
    expect(findOccurrence(d, paid.id, TODAY)).toMatchObject({ status: 'completed', virtual: false });
  });

  it('a payment made early still counts after the item is turned off', () => {
    let d = unwrap(ops.recordActual(baseline(), id(RENT, '2026-11-01'), { amountCents: usd(1000), date: TODAY }, clock));
    d = unwrap(ops.deactivateSource(d, RENT, clock));
    expect(counted(buildForecast(d, TODAY), RENT, '2027-12-31')).toEqual([[TODAY, 1000, 'completed']]);
  });

  it('past payments keep their expectation after a schedule change', () => {
    let d = unwrap(ops.recordActual(baseline(), id(PHONE, '2026-10-25'), { amountCents: usd(65), date: '2026-10-25' }, clockAt('2026-10-25')));
    d = unwrap(ops.changeSourceSchedule(d, PHONE, { startDate: '2026-11-10', amountCents: usd(70), rule: { type: 'monthly' } }, clockAt('2026-10-26')));
    const f = buildForecast(d, '2026-10-26');
    expect(counted(f, PHONE, '2026-12-31')).toEqual([
      ['2026-10-25', 65, 'completed'],
      ['2026-11-10', 70, 'scheduled'],
      ['2026-12-10', 70, 'scheduled'],
    ]);
    expect(findOccurrence(d, id(PHONE, '2026-10-25'), '2026-10-26')).toMatchObject({ expectedAmountCents: usd(60), actualAmountCents: usd(65) });
  });

  it('a canceled occurrence stays on record and never counts', () => {
    let d = unwrap(ops.cancelOccurrence(baseline(), id(RENT, '2026-12-01'), 'Paid by roommate', clock));
    d = unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-11-05', amountCents: usd(1100), rule: { type: 'monthly' } }, clock));
    const f = buildForecast(d, TODAY);
    const canceled = f.entries.filter((e) => e.occurrence.id === id(RENT, '2026-12-01'));
    expect(canceled.map((e) => [e.counts, e.occurrence.cancelNote])).toEqual([[false, 'Paid by roommate']]);
  });
});

describe('repeated forecasts', () => {
  function busy(): AppData {
    let d = moveRent(baseline());
    d = unwrap(ops.recordActual(d, id(PAY, '2026-10-15'), { amountCents: usd(1750), date: TODAY }, clock));
    d = unwrap(ops.cancelOccurrence(d, id(PHONE, '2026-11-25'), '', clock));
    d = unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-10-30', amountCents: usd(1100), rule: { type: 'monthly' } }, clock));
    return unwrap(ops.deactivateSource(d, PHONE, clock));
  }

  it('give the same result for the same data', () => {
    const d = busy();
    expect(buildForecast(d, TODAY)).toEqual(buildForecast(d, TODAY));
    expect(resolveOccurrences(d, TODAY, '2027-06-30', TODAY)).toEqual(resolveOccurrences(d, TODAY, '2027-06-30', TODAY));
  });

  it('do not depend on the order saved changes are stored in', () => {
    const d = busy();
    const reversed = { ...d, records: [...d.records].reverse(), sources: [...d.sources].reverse() };
    expect(buildForecast(reversed, TODAY).entries).toEqual(buildForecast(d, TODAY).entries);
  });

  it('never list the same occurrence twice', () => {
    const ids = buildForecast(busy(), TODAY).entries.map((e) => e.occurrence.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('month-end schedules', () => {
  const cases: { name: string; start: string; rule: RecurrenceRule; perYear: number }[] = [
    { name: 'monthly on the 31st', start: '2027-01-31', rule: { type: 'monthly' }, perYear: 12 },
    { name: 'monthly on the 30th', start: '2027-01-30', rule: { type: 'monthly' }, perYear: 12 },
    { name: 'monthly on the 29th in a leap year', start: '2028-01-29', rule: { type: 'monthly' }, perYear: 12 },
    { name: 'every 3 months on the 31st', start: '2027-01-31', rule: { type: 'custom', interval: 3, unit: 'month' }, perYear: 4 },
    { name: 'twice monthly on the 15th and 31st', start: '2027-01-15', rule: { type: 'twiceMonthly', days: [15, 31] }, perYear: 24 },
    { name: 'twice monthly on the 1st and 30th', start: '2027-01-01', rule: { type: 'twiceMonthly', days: [1, 30] }, perYear: 24 },
    { name: 'twice monthly on the 14th and 29th in a leap year', start: '2028-01-14', rule: { type: 'twiceMonthly', days: [14, 29] }, perYear: 24 },
  ];

  it.each(cases)('$name: valid, distinct dates with one occurrence per id', ({ start, rule, perYear }) => {
    let d = ops.emptyData();
    d = source(d, start, 'bill', 'Month end', 100, start, rule, 'bill-me');
    const year = start.slice(0, 4);
    const gen = expandSource(d.sources[0]!, `${year}-01-01`, `${year}-12-31`);
    const dates = gen.map((o) => o.scheduledDate);
    expect(dates.every(isValidDateStr)).toBe(true);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
    expect(new Set(gen.map((o) => o.id)).size).toBe(gen.length);
    expect(gen).toHaveLength(perYear);
    // Every day of a month that has fewer days falls on that month's last day.
    expect(dates.filter((x) => x.slice(5, 7) === '02')).toHaveLength(rule.type === 'twiceMonthly' ? 2 : rule.type === 'monthly' ? 1 : 0);
  });

  it('a month-end occurrence can be moved without affecting the next month', () => {
    let d = ops.emptyData();
    d = source(d, '2027-01-01', 'bill', 'Month end', 100, '2027-01-31', { type: 'monthly' }, 'bill-me');
    d = unwrap(ops.rescheduleOccurrence(d, 'bill-me@2027-02-28', { date: '2027-03-01', amountCents: usd(100) }, clockAt('2027-01-01')));
    const f = buildForecast(d, '2027-01-01');
    expect(listed(f, 'bill-me', '2027-04-30')).toEqual([
      ['bill-me@2027-01-31', '2027-01-31', 'scheduled'],
      ['bill-me@2027-02-28', '2027-03-01', 'scheduled'],
      ['bill-me@2027-03-31', '2027-03-31', 'scheduled'],
      ['bill-me@2027-04-30', '2027-04-30', 'scheduled'],
    ]);
  });
});

describe('marking a bill paid', () => {
  it('a moved bill, once paid, counts once on the payment date and later bills stay scheduled', () => {
    const today = '2026-11-03';
    const before = moveRent(baseline());
    const d = unwrap(ops.recordActual(before, id(RENT, '2026-11-01'), { amountCents: usd(1010), date: today }, clockAt(today)));
    expect(counted(buildForecast(d, today), RENT, '2027-01-31')).toEqual([
      [today, 1010, 'completed'],
      ['2026-12-01', 1000, 'scheduled'],
      ['2027-01-01', 1000, 'scheduled'],
    ]);
    expect(d.records).toHaveLength(1);
    expect(d.records[0]).toMatchObject({ expectedDate: '2026-11-01', expectedAmountCents: usd(1000), scheduledDate: '2026-11-03' });
    expect(d.sources).toEqual(before.sources);
  });

  it('undoing a payment the schedule has since replaced leaves only the new schedule', () => {
    let d = unwrap(ops.recordActual(baseline(), id(RENT, '2026-11-01'), { amountCents: usd(1000), date: TODAY }, clock));
    d = unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-10-30', amountCents: usd(1100), rule: { type: 'monthly' } }, clock));
    d = unwrap(ops.restoreOccurrence(d, id(RENT, '2026-11-01'), clock));
    expect(counted(buildForecast(d, TODAY), RENT, '2026-11-30')).toEqual([
      ['2026-10-30', 1100, 'scheduled'],
      ['2026-11-30', 1100, 'scheduled'],
    ]);
  });
});

describe('the forecast starting point', () => {
  it('a moved paycheck the schedule has replaced no longer sets the next payday', () => {
    // The Oct 15 paycheck was moved to Oct 12; then pay changed to every 2 weeks from Tue Oct 13.
    let d = unwrap(ops.rescheduleOccurrence(baseline(), id(PAY, '2026-10-15'), { date: '2026-10-12', amountCents: usd(1800) }, clock));
    d = unwrap(ops.changeSourceSchedule(d, PAY, { startDate: '2026-10-13', amountCents: usd(1800), rule: { type: 'biweekly' } }, clock));
    const f = buildForecast(d, TODAY);
    expect(f.forecastStart).toBe('2026-10-13');
    expect(counted(f, PAY, '2026-10-31')).toEqual([
      ['2026-10-13', 1800, 'scheduled'],
      ['2026-10-27', 1800, 'scheduled'],
    ]);
  });
});

describe('items that are turned off', () => {
  it('a schedule change cannot turn an item back on', () => {
    const d = unwrap(ops.deactivateSource(moveRent(baseline()), RENT, clock));
    expectError(ops.changeSourceSchedule(d, RENT, { startDate: '2026-11-01', amountCents: usd(1000), rule: { type: 'monthly' } }, clock), /Turn this item back on/);
    expect(listed(buildForecast(d, TODAY), RENT, '2027-12-31')).toEqual([]);
  });
});

describe('building a forecast', () => {
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  it('never changes the stored data', () => {
    let d = moveRent(baseline());
    d = unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-10-30', amountCents: usd(1100), rule: { type: 'monthly' } }, clock));
    d = unwrap(ops.recordActual(d, id(PHONE, '2026-10-25'), { amountCents: usd(60), date: TODAY }, clock));
    const snapshot = JSON.stringify(d);
    deepFreeze(d);
    buildForecast(d, TODAY);
    findOccurrence(d, id(RENT, '2026-11-01'), TODAY);
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});
