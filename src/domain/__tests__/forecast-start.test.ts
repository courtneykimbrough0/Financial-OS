import { describe, expect, it } from 'vitest';
import { buildForecast, entriesInRange, periodKpis, tallyOn, timingGapsAhead } from '../forecast';
import * as ops from '../operations';
import { evaluateScenario } from '../scenarios';
import type { AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

/*
 * Where the running total starts: the day before the earliest income from any
 * active recurring source, whatever order the income was entered in and
 * whichever is the main paycheck (docs/PRODUCT-AUDIT.md §6).
 *
 * 2026-10-11 is a Sunday.
 *   Restaurant paycheck  $900  every 2 weeks from Tue Oct 27
 *   Weekend job          $400  every 2 weeks from Mon Oct 19
 *   Rent                 $1,000 monthly from Thu Oct 22
 */
const TODAY = '2026-10-11';
const clock = clockAt(TODAY);
const LATE = 'income-restaurant';
const EARLY = 'income-weekend';

function twoPaychecks(order: 'late-first' | 'early-first'): AppData {
  const late = (d: AppData) => source(d, TODAY, 'income', 'Restaurant paycheck', 900, '2026-10-27', { type: 'biweekly' }, LATE);
  const early = (d: AppData) => source(d, TODAY, 'income', 'Weekend job', 400, '2026-10-19', { type: 'biweekly' }, EARLY);
  const d = order === 'late-first' ? early(late(ops.emptyData())) : late(early(ops.emptyData()));
  return source(d, TODAY, 'bill', 'Rent', 1000, '2026-10-22', { type: 'monthly' }, 'bill-rent');
}

describe('the running total starts at the earliest income', () => {
  it('includes the Oct 19 income whichever paycheck was entered first, and shows the gap it leaves before Oct 27', () => {
    for (const order of ['late-first', 'early-first'] as const) {
      const f = buildForecast(twoPaychecks(order), TODAY);
      expect([order, f.anchor, f.forecastStart]).toEqual([order, '2026-10-18', '2026-10-19']);
      expect(tallyOn(f, '2026-10-18')).toBeNull();
      expect(tallyOn(f, '2026-10-19')).toBe(usd(400));
      expect(tallyOn(f, '2026-10-22')).toBe(usd(-600));
      expect(tallyOn(f, '2026-10-27')).toBe(usd(300));
      // The gap is shown, not hidden behind a later start.
      expect(timingGapsAhead(f)[0]).toEqual({ start: '2026-10-22', end: '2026-10-26', days: 5, lowestCents: usd(-600), lowestDate: '2026-10-22' });
    }
  });

  it('gives the same running totals for either entry order', () => {
    const a = buildForecast(twoPaychecks('late-first'), TODAY);
    const b = buildForecast(twoPaychecks('early-first'), TODAY);
    for (const date of ['2026-10-19', '2026-10-22', '2026-10-27', '2026-11-02', '2026-11-10', '2026-12-31']) {
      expect([date, tallyOn(a, date)]).toEqual([date, tallyOn(b, date)]);
    }
  });

  it('closely spaced paydays: the earlier one starts the running total and both count', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Thursday job', 600, '2026-10-15', { type: 'weekly' }, 'thu');
    d = source(d, TODAY, 'income', 'Wednesday job', 500, '2026-10-14', { type: 'weekly' }, 'wed');
    d = source(d, TODAY, 'income', 'Same-day bonus', 50, '2026-10-14', { type: 'monthly' }, 'bonus');
    const f = buildForecast(d, TODAY);
    expect(f.forecastStart).toBe('2026-10-14');
    expect(tallyOn(f, '2026-10-14')).toBe(usd(550));
    expect(tallyOn(f, '2026-10-15')).toBe(usd(1150));
  });

  it('different frequencies: a weekly side job before a monthly salary', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Salary', 3000, '2026-10-30', { type: 'monthly' }, 'salary');
    d = source(d, TODAY, 'income', 'Side job', 150, '2026-10-16', { type: 'weekly' }, 'side');
    d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');
    const f = buildForecast(d, TODAY);
    expect(f.forecastStart).toBe('2026-10-16');
    expect(tallyOn(f, '2026-10-20')).toBe(usd(150 - 1200));
    expect(tallyOn(f, '2026-10-30')).toBe(usd(150 * 3 - 1200 + 3000));
  });

  it('a single income source starts the running total exactly as before', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, 'phone');
    const f = buildForecast(d, TODAY);
    expect([f.anchor, f.forecastStart]).toEqual(['2026-10-14', '2026-10-15']);
    expect(tallyOn(f, '2026-10-25')).toBe(usd(1740));
  });
});

describe('payments before the first income', () => {
  it('stay in cash flow but outside the running total, and are carried in once overdue', () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-27', { type: 'biweekly' }, 'pay');
    d = source(d, TODAY, 'income', 'Weekend job', 400, '2026-10-19', { type: 'biweekly' }, 'weekend');
    d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-13', { type: 'monthly' }, 'phone');
    const f = buildForecast(d, TODAY);
    expect(f.forecastStart).toBe('2026-10-19');
    expect(entriesInRange(f, '2026-10-13', '2026-10-13').map((e) => e.occurrence.id)).toEqual(['phone@2026-10-13']);
    expect(periodKpis(f, '2026-10-01', '2026-10-31').outflowCents).toBe(usd(60));
    expect(tallyOn(f, '2026-10-19')).toBe(usd(400));

    // A week later the phone bill is overdue and unrecorded: it's carried to the start.
    const later = buildForecast(d, '2026-10-17');
    const phone = later.entries.find((e) => e.occurrence.id === 'phone@2026-10-13')!;
    expect([phone.date, phone.carriedForward]).toEqual(['2026-10-19', true]);
    expect(tallyOn(later, '2026-10-19')).toBe(usd(340));
  });
});

describe('recorded, canceled, moved and overdue income', () => {
  /** Main paycheck Oct 15; a side job whose Oct 12 payment the test changes. */
  function withSide(): AppData {
    const d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    return source(d, '2026-10-01', 'income', 'Side job', 200, '2026-10-12', { type: 'weekly' }, 'side');
  }

  it('income from another source received today starts the running total today', () => {
    const d = unwrap(ops.recordActual(withSide(), 'side@2026-10-12', { amountCents: usd(250), date: TODAY }, clock));
    const f = buildForecast(d, TODAY);
    expect(f.forecastStart).toBe(TODAY);
    expect(tallyOn(f, TODAY)).toBe(usd(250));
  });

  it("income received before today is history and doesn't start the running total", () => {
    const d = unwrap(ops.recordActual(withSide(), 'side@2026-10-12', { amountCents: usd(200), date: '2026-10-10' }, clockAt('2026-10-10')));
    const f = buildForecast(d, TODAY);
    // The next side-job payment (Oct 19) is after the paycheck, so the paycheck starts it.
    expect(f.forecastStart).toBe('2026-10-15');
    const received = f.entries.find((e) => e.occurrence.id === 'side@2026-10-12')!;
    expect([received.date, received.amountCents, received.occurrence.status]).toEqual(['2026-10-10', usd(200), 'completed']);
  });

  it('a canceled payment is ignored, and a moved one counts on its new date', () => {
    const canceled = buildForecast(unwrap(ops.cancelOccurrence(withSide(), 'side@2026-10-12', '', clock)), TODAY);
    expect(canceled.forecastStart).toBe('2026-10-15');
    const moved = buildForecast(unwrap(ops.rescheduleOccurrence(withSide(), 'side@2026-10-12', { date: '2026-10-14', amountCents: usd(200) }, clock)), TODAY);
    expect(moved.forecastStart).toBe('2026-10-14');
  });

  it("a late payment from any source hasn't arrived yet, so it still starts the running total", () => {
    // Today is Oct 13 and the side job's Oct 12 payment hasn't been recorded.
    const f = buildForecast(withSide(), '2026-10-13');
    expect(f.forecastStart).toBe('2026-10-12');
    expect(tallyOn(f, '2026-10-12')).toBe(usd(200));
  });

  it("income that is turned off, or only one-time, doesn't start the running total", () => {
    const off = buildForecast(unwrap(ops.deactivateSource(withSide(), 'side', clock)), TODAY);
    expect(off.forecastStart).toBe('2026-10-15');
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Tax refund', amountCents: usd(500), date: '2026-10-12' }, clock, 'refund'));
    const once = buildForecast(d, TODAY);
    expect(once.forecastStart).toBe('2026-10-15');
  });

  it('a later schedule change to the earlier income moves the start only when its first payment is earliest', () => {
    const d = unwrap(ops.changeSourceSchedule(withSide(), 'side', { startDate: '2026-10-19', amountCents: usd(300), rule: { type: 'weekly' } }, clock));
    const f = buildForecast(d, TODAY);
    // The Oct 12 payment keeps the old schedule; it is still the earliest.
    expect(f.forecastStart).toBe('2026-10-12');
    expect(tallyOn(f, '2026-10-19')).toBe(usd(200 + 1800 + 300));
  });
});

describe("what doesn't move the start", () => {
  it('hypothetical income in a scenario counts in the running total but never starts it', () => {
    const d = twoPaychecks('late-first');
    const r = evaluateScenario(d, [{ kind: 'hypothetical-income', description: 'Possible gig', amountCents: usd(100), schedule: { startDate: '2026-10-12', rule: { type: 'weekly' } } }], clock);
    if (!r.ok) throw new Error(r.error);
    expect(r.result.comparable).toBe(true);
    expect(r.result.period.runningTotalFrom).toBe('2026-10-19');
  });
});
