/**
 * Plans for the storage tests, built with the app's own operations so they
 * hold exactly what the app writes. Today is Fri 2026-10-16.
 */
import { clockAt, source, unwrap, usd } from '../../../domain/__tests__/helpers';
import { analyzeEstimate, dismissEstimate } from '../../../domain/estimates';
import * as ops from '../../../domain/operations';
import { buildSampleData } from '../../../domain/sample';
import type { AppData } from '../../../domain/types';
import { migrate } from '../../storage';

export const TODAY = '2026-10-16';
export const clock = clockAt(TODAY);

/**
 * Every kind of item and every persisted field: a schedule change, a main
 * paycheck that isn't the first income, a liability with a type and a custom
 * rule, twice-monthly and weekly rules, an item turned off and on again
 * (a pause), recorded payments (early, late, different amount), a moved and a
 * canceled occurrence, a moved occurrence the schedule no longer produces
 * (kept but set aside), one-time items in every state, an estimate dismissal,
 * and a completed payday review.
 */
export function richPlan(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, '2026-06-01', 'income', 'Paycheck', 1000, '2026-06-05', { type: 'biweekly' }, 'pay');
  d = source(d, '2026-09-01', 'income', 'Side job', 150, '2026-09-05', { type: 'weekly' }, 'side');
  d = unwrap(ops.setMainPaycheck(d, 'side', clockAt('2026-09-01')));
  d = source(d, '2026-05-20', 'bill', 'Rent', 1500, '2026-06-01', { type: 'monthly' }, 'rent');
  d = source(d, '2026-03-20', 'bill', 'Electricity', 180, '2026-04-03', { type: 'monthly' }, 'elec');
  d = source(d, '2026-06-20', 'bill', 'Phone', 60, '2026-07-25', { type: 'monthly' }, 'phone');
  d = unwrap(ops.addSource(d, { kind: 'liability', liabilityType: 'loan', description: 'Car loan', amountCents: usd(410), startDate: '2026-06-15', rule: { type: 'custom', interval: 2, unit: 'month' }, tags: ['Car'] }, clockAt('2026-06-01'), 'loan'));
  d = source(d, '2026-05-01', 'subscription', 'Streaming', 15.99, '2026-05-01', { type: 'twiceMonthly', days: [1, 15] }, 'stream');
  d = source(d, '2026-06-01', 'savings', 'Emergency fund', 50, '2026-06-06', { type: 'weekly' }, 'save');

  // Recorded payments on electricity: early, on time, late and different amounts.
  for (const [date, dollars, actual] of [
    ['2026-04-03', 175, '2026-04-01'],
    ['2026-05-03', 190, '2026-05-03'],
    ['2026-06-03', 205, '2026-06-09'],
    ['2026-07-03', 220.55, '2026-07-03'],
  ] as const) {
    d = unwrap(ops.recordActual(d, `elec@${date}`, { amountCents: usd(dollars), date: actual }, clock));
  }
  // Phone: three $65 payments and a dismissed $65 suggestion.
  for (const date of ['2026-07-25', '2026-08-25', '2026-09-25']) d = unwrap(ops.recordActual(d, `phone@${date}`, { amountCents: usd(65), date }, clock));
  d = unwrap(dismissEstimate(d, analyzeEstimate(d, 'phone', TODAY).suggestion!, clock));
  // A late paycheck, smaller than expected.
  d = unwrap(ops.recordActual(d, 'pay@2026-10-09', { amountCents: usd(950), date: '2026-10-12' }, clock));
  // Moved and canceled occurrences.
  d = unwrap(ops.rescheduleOccurrence(d, 'elec@2026-11-03', { date: '2026-11-06', amountCents: usd(200) }, clock));
  d = unwrap(ops.cancelOccurrence(d, 'stream@2026-11-01', 'Paused for a month', clock));
  // Rent moved, then the schedule changed so Dec 1 is no longer produced: kept, set aside.
  d = unwrap(ops.rescheduleOccurrence(d, 'rent@2026-12-01', { date: '2026-12-03', amountCents: usd(1500) }, clock));
  d = unwrap(ops.changeSourceSchedule(d, 'rent', { startDate: '2026-11-28', amountCents: usd(1550), rule: { type: 'monthly' } }, clock));
  // A raise from Oct 30.
  d = unwrap(ops.changeSourceSchedule(d, 'pay', { startDate: '2026-10-30', amountCents: usd(1080), rule: { type: 'biweekly' } }, clock));
  // Savings turned off in August and back on in September: a pause.
  d = unwrap(ops.deactivateSource(d, 'save', clockAt('2026-08-01')));
  d = unwrap(ops.reactivateSource(d, 'save', '2026-09-05', clockAt('2026-09-01')));
  // One-time items: received, expected, and canceled.
  d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Tax refund', amountCents: usd(640), date: '2026-09-15', tags: ['Taxes'] }, clockAt('2026-09-01'), 'one-refund'));
  d = unwrap(ops.recordActual(d, 'one-refund', { amountCents: usd(612.4), date: '2026-09-18' }, clock));
  d = unwrap(ops.addOneTime(d, { kind: 'bill', description: 'Car repair', amountCents: usd(800), date: '2026-11-10' }, clock, 'one-repair'));
  d = unwrap(ops.addOneTime(d, { kind: 'savings', description: 'Holiday fund', amountCents: usd(100), date: '2026-12-01' }, clock, 'one-holiday'));
  d = unwrap(ops.cancelOccurrence(d, 'one-holiday', '', clock));
  // Review rhythm: on payday, the current one done.
  d = unwrap(ops.setReviewCadence(d, 'payday'));
  d = unwrap(ops.completeReview(d, clock));
  return { ...d, revision: 37 };
}

/** A plan with income and one bill, nothing recorded, no review rhythm. */
export function smallPlan(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, TODAY, 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  return source(d, TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
}

/** A document an early version saved: old kind names, missing optional fields, timestamps without milliseconds, a review set to off. */
export function legacyPlan(): AppData {
  return migrate({
    schemaVersion: 1,
    revision: 4,
    onboardingComplete: true,
    sources: [
      {
        id: 'src-old-pay',
        kind: 'income',
        description: 'Wages',
        versions: [{ id: 'ver-old-1', startDate: '2026-09-04', amountCents: 120000, rule: { type: 'biweekly' } }],
        active: true,
        createdAt: '2026-09-01T08:00:00Z',
        updatedAt: '2026-09-01T08:00:00Z',
      },
      {
        id: 'src-old-gym',
        kind: 'expense',
        category: 'health',
        description: 'Gym',
        versions: [{ id: 'ver-old-2', startDate: '2026-09-10', amountCents: 4000, rule: { type: 'monthly' } }],
        active: false,
        endDate: '2026-10-01',
        createdAt: '2026-09-01T08:00:00Z',
        updatedAt: '2026-10-01T08:00:00Z',
      },
    ],
    records: [
      {
        id: 'src-old-gym@2026-09-10',
        sourceId: 'src-old-gym',
        kind: 'spending',
        description: 'Gym',
        expectedDate: '2026-09-10',
        expectedAmountCents: 4000,
        scheduledDate: '2026-09-10',
        scheduledAmountCents: 4000,
        status: 'completed',
        actualDate: '2026-09-11',
        actualAmountCents: 4500,
        completedAt: '2026-09-11T19:30:00Z',
        canceledAt: null,
        cancelNote: null,
        createdAt: '2026-09-11T19:30:00Z',
        updatedAt: '2026-09-11T19:30:00Z',
      },
    ],
    review: { cadence: 'off', handledOn: null, outcome: null },
  });
}

/** Plans every storage test runs through. */
export function allPlans(): [string, AppData][] {
  const sample = buildSampleData(TODAY);
  const { isSample: _s, ...sampleAsOwn } = sample;
  void _s;
  return [
    ['rich plan', richPlan()],
    ['small plan', smallPlan()],
    ['empty plan in setup', ops.emptyData()],
    ['legacy document', legacyPlan()],
    ['sample data (as if it were the person’s own)', sampleAsOwn],
  ];
}
