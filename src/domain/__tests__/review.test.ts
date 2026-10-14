import { describe, expect, it } from 'vitest';
import { buildForecast, reviewEntries } from '../forecast';
import { findOccurrence } from '../occurrences';
import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

/*
 * Step 3: reviewing several items at once. Set up on Sun 2026-10-11 and
 * reviewed on Wed 2026-10-21, a week whose Saturday is Oct 24.
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

const ids = (entries: { occurrence: { id: string } }[]) => entries.map((e) => e.occurrence.id);

describe('what to review', () => {
  it('lists overdue and due-today items first, then the rest of this week, oldest first', () => {
    const groups = reviewEntries(buildForecast(data(), TODAY));
    expect(ids(groups.attention)).toEqual([PAY, CAR, GYM, WATER]);
    expect(ids(groups.upcoming)).toEqual([PHONE]);
  });

  it('leaves out items already done, moved past this week, or canceled', () => {
    let d = unwrap(ops.recordActual(data(), PAY, { amountCents: usd(1800), date: '2026-10-15' }, clock));
    d = unwrap(ops.rescheduleOccurrence(d, CAR, { date: '2026-10-28', amountCents: usd(350) }, clock));
    d = unwrap(ops.cancelOccurrence(d, GYM, '', clock));
    expect(ids(reviewEntries(buildForecast(d, TODAY)).attention)).toEqual([WATER]);
  });

  it('is empty once everything through this week is done, or when there is nothing', () => {
    const d = unwrap(ops.recordAsExpected(data(), [PAY, CAR, GYM, WATER, PHONE], clock));
    expect(reviewEntries(buildForecast(d, TODAY))).toEqual({ attention: [], upcoming: [] });
    expect(reviewEntries(buildForecast(ops.emptyData(), TODAY))).toEqual({ attention: [], upcoming: [] });
  });
});

describe('marking several done as expected', () => {
  it('records only the selected items, each at its expected amount and date', () => {
    const before = data();
    const d = unwrap(ops.recordAsExpected(before, [PAY, CAR, PHONE], clock));
    expect(d.records.map((r) => [r.id, r.status, r.actualDate, r.actualAmountCents! / 100])).toEqual([
      [PAY, 'completed', '2026-10-15', 1800],
      [CAR, 'completed', '2026-10-20', 350],
      // Phone isn't due until Friday, so it is recorded as done today.
      [PHONE, 'completed', TODAY, 60],
    ]);
    // Gym is due the same day as the car loan but wasn't selected.
    expect(findOccurrence(d, GYM, TODAY)).toMatchObject({ status: 'scheduled', virtual: true });
    expect(findOccurrence(d, WATER, TODAY)).toMatchObject({ status: 'scheduled', virtual: true });
    expect(d.sources).toEqual(before.sources);
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
    expect(reviewEntries(f).attention).toEqual([]);
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
  });
});

describe('undoing a batch', () => {
  it.each([
    { name: 'done as expected', act: (d: AppData, sel: string[]) => unwrap(ops.recordAsExpected(d, sel, clock)) },
    { name: 'a move', act: (d: AppData, sel: string[]) => unwrap(ops.rescheduleSelected(d, sel, '2026-10-29', clock)) },
  ])('undoing $name restores every affected record exactly, in one step', ({ act }) => {
    // One of the selected items was already moved before the batch.
    const before = unwrap(ops.rescheduleOccurrence(data(), WATER, { date: '2026-10-22', amountCents: usd(32) }, clock));
    const selected = [PAY, CAR, WATER];
    const after = act(before, selected);
    const undone = unwrap(ops.undoBatch(after, before, selected));
    expect(undone).toEqual(before);
    expect(buildForecast(undone, TODAY)).toEqual(buildForecast(before, TODAY));
  });

  it('leaves changes to other items made after the batch alone', () => {
    const before = data();
    let d = unwrap(ops.recordAsExpected(before, [PAY, CAR], clock));
    d = unwrap(ops.recordActual(d, GYM, { amountCents: usd(40), date: TODAY }, clock));
    d = unwrap(ops.undoBatch(d, before, [PAY, CAR]));
    expect(d.records.map((r) => [r.id, r.status])).toEqual([[GYM, 'completed']]);
  });
});
