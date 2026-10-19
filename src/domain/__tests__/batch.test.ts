import { describe, expect, it } from 'vitest';
import { buildForecast } from '../forecast';
import { homeView } from '../home';
import { findOccurrence } from '../occurrences';
import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

/*
 * Recording or moving several due items at once. Set up on Sun 2026-10-11 and
 * used on Wed 2026-10-21, a week whose Saturday is Oct 24. A batch takes only
 * items due today or earlier; an early payment is recorded on its own.
 *   Paycheck   $1,800 every 2 weeks from Thu Oct 15
 *   Car loan   $350   monthly from Oct 20
 *   Gym        $40    monthly from Oct 20 (same day as the car loan)
 *   Water      $30    monthly from Oct 21 (due today)
 *   Phone      $60    monthly from Oct 23 (later this week)
 *   Rent       $1,200 monthly from Nov 1 (next week and beyond)
 */
const SETUP = '2026-10-11';
const TODAY = '2026-10-21';
const clock = clockAt(TODAY);
const id = (sourceId: string, date: string) => `${sourceId}@${date}`;
const PAY = id('pay', '2026-10-15');
const CAR = id('car', '2026-10-20');
const GYM = id('gym', '2026-10-20');
const WATER = id('water', '2026-10-21');
const PHONE = id('phone', '2026-10-23');

function data(): AppData {
  let d = ops.emptyData();
  d = source(d, SETUP, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'liability', 'Car loan', 350, '2026-10-20', { type: 'monthly' }, 'car');
  d = source(d, SETUP, 'subscription', 'Gym', 40, '2026-10-20', { type: 'monthly' }, 'gym');
  d = source(d, SETUP, 'bill', 'Water', 30, '2026-10-21', { type: 'monthly' }, 'water');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-23', { type: 'monthly' }, 'phone');
  return source(d, SETUP, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
}

describe('marking several done as expected', () => {
  it('records only the selected items, each at its expected amount and date', () => {
    const before = data();
    const d = unwrap(ops.recordAsExpected(before, [PAY, CAR, WATER], clock));
    expect(d.records.map((r) => [r.id, r.status, r.actualDate, r.actualAmountCents! / 100])).toEqual([
      [PAY, 'completed', '2026-10-15', 1800],
      [CAR, 'completed', '2026-10-20', 350],
      [WATER, 'completed', TODAY, 30],
    ]);
    // Gym is due the same day as the car loan but wasn't selected.
    expect(findOccurrence(d, GYM, TODAY)).toMatchObject({ status: 'scheduled', virtual: true });
    expect(findOccurrence(d, PHONE, TODAY)).toMatchObject({ status: 'scheduled', virtual: true });
    expect(d.sources).toEqual(before.sources);
  });

  it('refuses an item that is not due yet, and nothing changes', () => {
    expectError(ops.recordAsExpected(data(), [CAR, PHONE], clock), /^Phone: This isn’t due yet\. Open it to record it early\./);
    expect(ops.recordAsExpected(data(), [PHONE], clock).ok).toBe(false);
  });

  it('accepts an item due today, the last day a batch takes', () => {
    const d = unwrap(ops.recordAsExpected(data(), [WATER], clock));
    expect(findOccurrence(d, WATER, TODAY)).toMatchObject({ status: 'completed', actualDate: TODAY });
  });

  it('an early payment is still recorded one at a time, on the day it happened', () => {
    const d = unwrap(ops.recordActual(data(), PHONE, { amountCents: usd(60), date: TODAY }, clock));
    expect(findOccurrence(d, PHONE, TODAY)).toMatchObject({ status: 'completed', expectedDate: '2026-10-23', actualDate: TODAY, actualAmountCents: usd(60) });
  });

  it('a recorded item is corrected on its own: undone and recorded again', () => {
    let d = unwrap(ops.recordAsExpected(data(), [CAR], clock));
    d = unwrap(ops.restoreOccurrence(d, CAR, clock));
    expect(findOccurrence(d, CAR, TODAY)).toMatchObject({ status: 'scheduled', virtual: true });
  });

  it('keeps each original prediction and uses a moved date and amount', () => {
    let d = unwrap(ops.rescheduleOccurrence(data(), CAR, { date: TODAY, amountCents: usd(375) }, clock));
    d = unwrap(ops.recordAsExpected(d, [CAR], clock));
    expect(findOccurrence(d, CAR, TODAY)).toMatchObject({
      expectedDate: '2026-10-20', expectedAmountCents: usd(350), actualDate: TODAY, actualAmountCents: usd(375), status: 'completed',
    });
  });

  it('changes nothing if any selected item can’t be recorded', () => {
    const d = unwrap(ops.cancelOccurrence(data(), GYM, '', clock));
    expectError(ops.recordAsExpected(d, [CAR, GYM], clock), /^Gym: .*canceled/);
    expect(d.records.map((r) => r.id)).toEqual([GYM]);
  });

  it('ignores a repeated selection and rejects an empty one', () => {
    const d = unwrap(ops.recordAsExpected(data(), [CAR, CAR], clock));
    expect(d.records).toHaveLength(1);
    expectError(ops.recordAsExpected(data(), [], clock), /Select at least one/);
  });

  it('counts each recorded item once in the forecast', () => {
    const d = unwrap(ops.recordAsExpected(data(), [PAY, CAR, GYM, WATER], clock));
    const f = buildForecast(d, TODAY);
    for (const occ of [PAY, CAR, GYM, WATER]) expect(f.entries.filter((e) => e.occurrence.id === occ)).toHaveLength(1);
    expect(homeView(d, TODAY).attention).toEqual([]);
  });
});

describe('moving several to a new date', () => {
  it('moves only the selected items, each keeping its amount and original prediction', () => {
    const d = unwrap(ops.rescheduleSelected(data(), [CAR, GYM], '2026-10-29', clock));
    expect([CAR, GYM].map((x) => findOccurrence(d, x, TODAY)).map((o) => [o!.expectedDate, o!.scheduledDate, o!.scheduledAmountCents / 100])).toEqual([
      ['2026-10-20', '2026-10-29', 350],
      ['2026-10-20', '2026-10-29', 40],
    ]);
    expect(findOccurrence(d, WATER, TODAY)).toMatchObject({ virtual: true });
    expectError(ops.rescheduleSelected(data(), [CAR], '2026-10-19', clock), /today or a later date/);
    expectError(ops.rescheduleSelected(data(), [CAR, PHONE], '2026-10-29', clock), /^Phone: This isn’t due yet/);
  });
});
