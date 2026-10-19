import { describe, expect, it } from 'vitest';
import { buildForecast, type Forecast } from '../forecast';
import { findOccurrence, variance } from '../occurrences';
import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

/*
 * Step 2: the original prediction (expected*), the latest expectation
 * (scheduled*) and what happened (actual*) stay distinct through every action.
 * 2026-10-11 is a Sunday.
 *   Paycheck   $1,800 every 2 weeks from Thu Oct 15
 *   Phone      $60    monthly from Oct 25
 *   Rent       $1,000 monthly from Nov 1
 */
const TODAY = '2026-10-11';
const PAY = 'pay';
const PHONE = 'phone';
const RENT = 'rent';
const id = (sourceId: string, date: string) => `${sourceId}@${date}`;

function baseline(): AppData {
  let d = ops.emptyData();
  d = source(d, TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, PAY);
  d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-25', { type: 'monthly' }, PHONE);
  return source(d, TODAY, 'bill', 'Rent', 1000, '2026-11-01', { type: 'monthly' }, RENT);
}

/** Counted entries of one source through `end`, as [date, dollars, status]. */
function counted(f: Forecast, sourceId: string, end: string) {
  return f.entries.filter((e) => e.occurrence.sourceId === sourceId && e.counts && e.date <= end).map((e) => [e.date, e.amountCents / 100, e.occurrence.status]);
}

/** [expected, scheduled, actual] as [date, dollars] pairs (actual null until recorded). */
function history(d: AppData, occurrenceId: string, today: string) {
  const o = findOccurrence(d, occurrenceId, today)!;
  return {
    expected: [o.expectedDate, o.expectedAmountCents / 100],
    scheduled: [o.scheduledDate, o.scheduledAmountCents / 100],
    actual: o.actualDate === null ? null : [o.actualDate, o.actualAmountCents! / 100],
  };
}

const pay = (d: AppData, occurrenceId: string, dollars: number, date: string) =>
  unwrap(ops.recordActual(d, occurrenceId, { amountCents: usd(dollars), date }, clockAt(date)));

describe('paying a bill', () => {
  it('on the expected date for the expected amount: no variance, counted once, later bills unchanged', () => {
    const d = pay(baseline(), id(PHONE, '2026-10-25'), 60, '2026-10-25');
    expect(history(d, id(PHONE, '2026-10-25'), '2026-10-25')).toEqual({ expected: ['2026-10-25', 60], scheduled: ['2026-10-25', 60], actual: ['2026-10-25', 60] });
    expect(variance(d.records[0]!)).toEqual({ amountCents: 0, days: 0 });
    expect(counted(buildForecast(d, '2026-10-25'), PHONE, '2026-12-31')).toEqual([
      ['2026-10-25', 60, 'completed'],
      ['2026-11-25', 60, 'scheduled'],
      ['2026-12-25', 60, 'scheduled'],
    ]);
  });

  it.each([
    { name: 'late', date: '2026-10-27', dollars: 60, expected: { amountCents: 0, days: 2 } },
    { name: 'early', date: '2026-10-22', dollars: 60, expected: { amountCents: 0, days: -3 } },
    { name: 'for more', date: '2026-10-25', dollars: 100, expected: { amountCents: usd(40), days: 0 } },
    { name: 'for less, early', date: '2026-10-24', dollars: 45, expected: { amountCents: usd(-15), days: -1 } },
  ])('$name: the actual is kept beside the unchanged prediction, and only the actual counts', ({ date, dollars, expected }) => {
    const d = pay(baseline(), id(PHONE, '2026-10-25'), dollars, date);
    expect(history(d, id(PHONE, '2026-10-25'), date)).toEqual({ expected: ['2026-10-25', 60], scheduled: ['2026-10-25', 60], actual: [date, dollars] });
    expect(variance(d.records[0]!)).toEqual(expected);
    expect(counted(buildForecast(d, '2026-10-27'), PHONE, '2026-11-30')).toEqual([
      [date, dollars, 'completed'],
      ['2026-11-25', 60, 'scheduled'],
    ]);
  });

  it('after moving it: keeps the original prediction, the move, and the payment', () => {
    let d = unwrap(ops.rescheduleOccurrence(baseline(), id(RENT, '2026-11-01'), { date: '2026-11-04', amountCents: usd(1050) }, clockAt(TODAY)));
    d = pay(d, id(RENT, '2026-11-01'), 1050, '2026-11-05');
    expect(history(d, id(RENT, '2026-11-01'), '2026-11-05')).toEqual({
      expected: ['2026-11-01', 1000],
      scheduled: ['2026-11-04', 1050],
      actual: ['2026-11-05', 1050],
    });
    expect(variance(d.records[0]!)).toEqual({ amountCents: usd(50), days: 4 });
  });

  it('has no variance until it is recorded, and none when canceled', () => {
    const moved = unwrap(ops.rescheduleOccurrence(baseline(), id(RENT, '2026-11-01'), { date: '2026-11-04', amountCents: usd(1050) }, clockAt(TODAY)));
    expect(variance(moved.records[0]!)).toBeNull();
    const canceled = unwrap(ops.cancelOccurrence(baseline(), id(RENT, '2026-11-01'), '', clockAt(TODAY)));
    expect(variance(canceled.records[0]!)).toBeNull();
  });
});

describe('correcting a payment', () => {
  it('changes only the actual; the prediction stays and there is still one record', () => {
    let d = pay(baseline(), id(PHONE, '2026-10-25'), 65, '2026-10-26');
    d = unwrap(ops.correctActual(d, id(PHONE, '2026-10-25'), { amountCents: usd(62), date: '2026-10-25' }, clockAt('2026-10-27')));
    expect(d.records).toHaveLength(1);
    expect(history(d, id(PHONE, '2026-10-25'), '2026-10-27')).toEqual({ expected: ['2026-10-25', 60], scheduled: ['2026-10-25', 60], actual: ['2026-10-25', 62] });
    expect(variance(d.records[0]!)).toEqual({ amountCents: usd(2), days: 0 });
    expect(counted(buildForecast(d, '2026-10-27'), PHONE, '2026-10-31')).toEqual([['2026-10-25', 62, 'completed']]);
  });
});

describe('undoing a payment or cancellation', () => {
  const raise = (d: AppData) => unwrap(ops.changeSourceSchedule(d, RENT, { startDate: '2026-11-01', amountCents: usd(1100), rule: { type: 'monthly' } }, clockAt(TODAY)));

  it.each([
    { name: 'payment', act: (d: AppData) => pay(d, id(RENT, '2026-11-01'), 1000, TODAY) },
    { name: 'cancellation', act: (d: AppData) => unwrap(ops.cancelOccurrence(d, id(RENT, '2026-11-01'), 'Paid by roommate', clockAt(TODAY))) },
  ])('undoing a $name restores exactly the state before it', ({ act }) => {
    const before = baseline();
    const undone = unwrap(ops.restoreOccurrence(act(before), id(RENT, '2026-11-01'), clockAt(TODAY)));
    expect(undone).toEqual(before);
    expect(findOccurrence(undone, id(RENT, '2026-11-01'), TODAY)).toMatchObject({ virtual: true, status: 'scheduled' });
  });

  it('a later price change applies to an occurrence whose payment was undone', () => {
    // Before the fix, the undone record kept the old $1,000 and overrode the new schedule.
    const undone = unwrap(ops.restoreOccurrence(pay(baseline(), id(RENT, '2026-11-01'), 1000, TODAY), id(RENT, '2026-11-01'), clockAt(TODAY)));
    expect(counted(buildForecast(raise(undone), TODAY), RENT, '2026-12-31')).toEqual([
      ['2026-11-01', 1100, 'scheduled'],
      ['2026-12-01', 1100, 'scheduled'],
    ]);
    expect(buildForecast(raise(undone), TODAY)).toEqual(buildForecast(raise(baseline()), TODAY));
  });

  it('undoing a payment on a moved occurrence returns it to its moved date and amount', () => {
    const moved = unwrap(ops.rescheduleOccurrence(baseline(), id(RENT, '2026-11-01'), { date: '2026-11-04', amountCents: usd(1050) }, clockAt(TODAY)));
    const paid = pay(moved, id(RENT, '2026-11-01'), 1050, '2026-11-04');
    const undone = unwrap(ops.restoreOccurrence(paid, id(RENT, '2026-11-01'), clockAt('2026-11-04')));
    expect(undone.records).toEqual([{ ...moved.records[0]!, updatedAt: '2026-11-04T12:00:00.000Z' }]);
    expect(counted(buildForecast(undone, '2026-11-04'), RENT, '2026-11-30')).toEqual([['2026-11-04', 1050, 'scheduled']]);
  });

  it('undoing a one-time payment keeps the one-time item', () => {
    let d = unwrap(ops.addOneTime(baseline(), { kind: 'varied', description: 'Vet', amountCents: usd(240), date: '2026-10-20' }, clockAt(TODAY), 'vet'));
    d = pay(d, 'vet', 250, '2026-10-20');
    d = unwrap(ops.restoreOccurrence(d, 'vet', clockAt('2026-10-20')));
    expect(history(d, 'vet', '2026-10-20')).toEqual({ expected: ['2026-10-20', 240], scheduled: ['2026-10-20', 240], actual: null });
  });

  it('cannot undo twice', () => {
    const undone = unwrap(ops.restoreOccurrence(pay(baseline(), id(RENT, '2026-11-01'), 1000, TODAY), id(RENT, '2026-11-01'), clockAt(TODAY)));
    expectError(ops.restoreOccurrence(undone, id(RENT, '2026-11-01'), clockAt(TODAY)), /already outstanding/);
  });
});

describe('schedule changes and history', () => {
  it('a future amount change leaves recorded and earlier predictions as they were', () => {
    let d = pay(baseline(), id(PHONE, '2026-10-25'), 62, '2026-10-25');
    d = unwrap(ops.changeSourceSchedule(d, PHONE, { startDate: '2026-12-25', amountCents: usd(75), rule: { type: 'monthly' } }, clockAt('2026-10-26')));
    const today = '2026-10-26';
    expect(history(d, id(PHONE, '2026-10-25'), today)).toEqual({ expected: ['2026-10-25', 60], scheduled: ['2026-10-25', 60], actual: ['2026-10-25', 62] });
    expect(history(d, id(PHONE, '2026-11-25'), today).expected).toEqual(['2026-11-25', 60]);
    expect(history(d, id(PHONE, '2026-12-25'), today).expected).toEqual(['2026-12-25', 75]);
  });

  it('an unpaid overdue occurrence keeps the prediction it had when it came due', () => {
    // Phone's Oct 25 bill is still unpaid on Oct 28 when the price changes from Nov 25.
    const today = '2026-10-28';
    const d = unwrap(ops.changeSourceSchedule(baseline(), PHONE, { startDate: '2026-11-25', amountCents: usd(80), rule: { type: 'monthly' } }, clockAt(today)));
    expect(history(d, id(PHONE, '2026-10-25'), today)).toEqual({ expected: ['2026-10-25', 60], scheduled: ['2026-10-25', 60], actual: null });
    expect(counted(buildForecast(d, today), PHONE, '2026-11-30').map((r) => r[1])).toEqual([60, 80]);
  });
});

describe('the original prediction never changes', () => {
  it('through moving, paying, correcting, undoing, canceling, restoring, schedule changes, and forecasts', () => {
    const occ = id(RENT, '2026-12-01');
    let d = baseline();
    const steps: ((x: AppData) => AppData)[] = [
      (x) => unwrap(ops.rescheduleOccurrence(x, occ, { date: '2026-12-03', amountCents: usd(1020) }, clockAt(TODAY))),
      (x) => pay(x, occ, 1020, '2026-12-03'),
      (x) => unwrap(ops.correctActual(x, occ, { amountCents: usd(1025), date: '2026-12-02' }, clockAt('2026-12-04'))),
      (x) => unwrap(ops.restoreOccurrence(x, occ, clockAt('2026-12-04'))),
      (x) => unwrap(ops.cancelOccurrence(x, occ, '', clockAt('2026-12-04'))),
      (x) => unwrap(ops.restoreOccurrence(x, occ, clockAt('2026-12-04'))),
      (x) => unwrap(ops.changeSourceSchedule(x, RENT, { startDate: '2027-01-01', amountCents: usd(1200), rule: { type: 'monthly' } }, clockAt('2026-12-04'))),
    ];
    for (const step of steps) {
      d = step(d);
      buildForecast(d, '2026-12-04');
      expect(history(d, occ, '2026-12-04').expected).toEqual(['2026-12-01', 1000]);
    }
    // Back to the moved state, after everything.
    expect(history(d, occ, '2026-12-04')).toEqual({ expected: ['2026-12-01', 1000], scheduled: ['2026-12-03', 1020], actual: null });
  });
});
