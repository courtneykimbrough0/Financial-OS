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
 * a liability with a type and a custom
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
  d = source(d, '2026-05-20', 'bill', 'Rent', 1500, '2026-06-01', { type: 'monthly' }, 'rent');
  d = source(d, '2026-03-20', 'bill', 'Electricity', 180, '2026-04-03', { type: 'monthly' }, 'elec');
  d = source(d, '2026-06-20', 'bill', 'Phone', 60, '2026-07-25', { type: 'monthly' }, 'phone');
  d = unwrap(ops.addSource(d, { kind: 'liability', liabilityType: 'loan', description: 'Car loan', amountCents: usd(410), startDate: '2026-06-15', rule: { type: 'custom', interval: 2, unit: 'month' }, tags: ['Car'] }, clockAt('2026-06-01'), 'loan'));
  d = source(d, '2026-05-01', 'subscription', 'Streaming', 15.99, '2026-05-01', { type: 'twiceMonthly', days: [1, 15] }, 'stream');
  d = source(d, '2026-06-01', 'reserve', 'Emergency fund', 50, '2026-06-06', { type: 'weekly' }, 'save');

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
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Car repair', amountCents: usd(800), date: '2026-11-10' }, clock, 'one-repair'));
  d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Holiday fund', amountCents: usd(100), date: '2026-12-01' }, clock, 'one-holiday'));
  d = unwrap(ops.cancelOccurrence(d, 'one-holiday', '', clock));
  return { ...d, revision: 37 };
}

/** A plan with income and one bill, nothing recorded. */
export function smallPlan(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, TODAY, 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  return source(d, TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
}

/** A document an early version saved: old kind names, missing optional fields, timestamps without milliseconds. */
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
        kind: 'bill',
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
        kind: 'bill',
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
    ["sample data (as if it were the person's own)", sampleAsOwn],
    ['every kind of income (E1–E5)', incomePlan()],
    ['everything: income, accounts, transfers and Strategic Reserves (F1)', withAccounts(incomePlan())],
  ];
}

/**
 * `plan` with shift tracking (E2): the side job is tipped at $16/h, with a
 * shift that had cash and card tips and one with hours only.
 */
export function withShifts(plan: AppData): AppData {
  let d = unwrap(ops.setIncomeDetails(plan, 'side', { incomeType: 'tipped', hourlyWageCents: 1600 }, clock));
  d = unwrap(ops.logShift(d, { sourceId: 'side', date: '2026-10-14', minutes: 330, wageCents: 1600, cashTipsCents: usd(42.5), cardTipsCents: usd(31) }, clock, 'shift-1'));
  return unwrap(ops.logShift(d, { sourceId: 'side', date: '2026-10-15', minutes: 240, wageCents: 1600 }, clock, 'shift-2'));
}

/**
 * `plan` with freelance work (E3): a client, a done job paid on Oct 15, a
 * planned job with a projected payment, and a done job with no payment date.
 */
export function withJobs(plan: AppData): AppData {
  let d = unwrap(ops.addClient(plan, 'Acme', clock, 'client-acme'));
  d = unwrap(ops.addJob(d, { description: 'Logo design', clientId: 'client-acme', amountCents: usd(800), status: 'done', expectedDate: '2026-10-20' }, clock, 'job-logo'));
  d = unwrap(ops.recordJobPayment(d, 'job-logo', { amountCents: usd(780), date: '2026-10-15' }, clock));
  d = unwrap(ops.addJob(d, { description: 'Website copy', clientId: 'client-acme', amountCents: usd(1200), status: 'planned', expectedDate: '2026-11-15' }, clock, 'job-copy'));
  return unwrap(ops.addJob(d, { description: 'Brochure', amountCents: usd(300), status: 'done' }, clock, 'job-brochure'));
}

/**
 * `plan` with gig work (E4): gig payouts every Monday from Oct 5, a session
 * paid by the Oct 12 payout, and one waiting for payout with cash received.
 */
export function withSessions(plan: AppData): AppData {
  let d = unwrap(ops.addSource(plan, { kind: 'income', description: 'Delivery payouts', amountCents: usd(300), startDate: '2026-10-05', rule: { type: 'weekly' }, incomeType: 'gig' }, clockAt('2026-10-01'), 'gig'));
  d = unwrap(ops.logSession(d, { sourceId: 'gig', date: '2026-10-08', minutes: 180, earningsCents: usd(95), platform: 'DoorDash' }, clock, 'session-1'));
  d = unwrap(ops.recordActual(d, 'gig@2026-10-12', { amountCents: usd(290), date: '2026-10-12' }, clock));
  return unwrap(ops.logSession(d, { sourceId: 'gig', date: '2026-10-14', earningsCents: usd(70), cashTipsCents: usd(12), platform: 'Uber' }, clock, 'session-2'));
}

/**
 * Every kind of income at once (E6), on the rich plan: irregular projected
 * income (a recurring item and a one-time), tipped shifts paid by a recorded
 * paycheck, freelance jobs (paid, planned with a projected payment, pending)
 * and gig sessions (one paid by a recorded payout, one waiting, with cash
 * received).
 */
export function incomePlan(): AppData {
  let d = withSessions(withJobs(withShifts(richPlan())));
  d = unwrap(ops.addSource(d, { kind: 'income', description: 'Tutoring', amountCents: usd(120), startDate: '2026-10-20', rule: { type: 'biweekly' } }, clock, 'tutor'));
  d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Maybe a bonus', amountCents: usd(250), date: '2026-10-30' }, clock, 'bonus'));
  // The side job's Oct 17 paycheck arrives a day early and pays both shifts; its amount differs from the expected $150.
  return unwrap(ops.recordActual(d, 'side@2026-10-17', { amountCents: usd(212.4), date: '2026-10-16' }, clock));
}

/**
 * `plan` with accounts (F1): one of each type and a second payment account,
 * opening balances (one negative), the paycheck, rent and reserves assigned,
 * a recorded paycheck that keeps its account, a one-time release from
 * Strategic Reserves, and transfers both recorded and expected.
 */
export function withAccounts(plan: AppData): AppData {
  let d = unwrap(ops.addAccount(plan, { name: 'Paycheck account', type: 'income' }, clock, 'acct-income'));
  d = unwrap(ops.addAccount(d, { name: 'Reserves', type: 'distribution' }, clock, 'acct-reserves'));
  d = unwrap(ops.addAccount(d, { name: 'Bills', type: 'payment' }, clock, 'acct-bills'));
  d = unwrap(ops.addAccount(d, { name: 'Everyday', type: 'payment' }, clock, 'acct-everyday'));
  d = unwrap(ops.assignAccount(d, 'pay', 'acct-income', clock));
  d = unwrap(ops.assignAccount(d, 'rent', 'acct-bills', clock));
  d = unwrap(ops.assignAccount(d, 'save', 'acct-reserves', clock));
  d = unwrap(ops.setOpeningBalance(d, 'acct-income', { amountCents: usd(420), date: '2026-10-01' }, clock));
  d = unwrap(ops.setOpeningBalance(d, 'acct-bills', { amountCents: usd(-35.5), date: '2026-10-01' }, clock));
  d = unwrap(ops.recordActual(d, 'pay@2026-10-23', { amountCents: usd(1000), date: TODAY }, clock));
  d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Use reserves for the car', amountCents: usd(200), date: '2026-10-28', release: true }, clock, 'release-car'));
  d = unwrap(ops.addTransfer(d, { fromAccountId: 'acct-income', toAccountId: 'acct-bills', amountCents: usd(1500), date: TODAY }, 'recorded', clock, 'xfer-rent'));
  return unwrap(ops.addTransfer(d, { fromAccountId: 'acct-income', toAccountId: 'acct-reserves', amountCents: usd(50), date: '2026-10-23' }, 'expected', clock, 'xfer-save'));
}
