/**
 * Synthetic demonstration data, built relative to "today" so it always shows
 * the same story. Everything here is fictional and flagged `isSample`.
 *
 * Timeline (T = today):
 *   T−17  Paycheck $1,800 expected — received on time.
 *   T−12  Electric $90 expected — paid $128 on T−10 (larger and later).
 *   T−6   Phone $60 expected — not recorded, so it shows as overdue.
 *   T−3   Paycheck $1,800 expected — $1,650 arrived on T−2 (late and smaller).
 *   T+11  Next paycheck $1,800 (the running total starts today, at $0).
 *   T+12  Rent $1,200.
 *   T+15  Car loan $350 (liability).
 *   T+20  One-time car repair $700 (varied spending) — pushes the running total below $0.
 *   T+25  Paycheck $1,800 — the running total recovers.
 *   T+26  Emergency fund $100 every 2 weeks (strategic reserve).
 *   T+27  Streaming service $15 monthly (subscription).
 */
import { addDays, type DateStr } from './dates';
import * as ops from './operations';
import type { AppData } from './types';

function must(result: ops.Result): AppData {
  if (!result.ok) throw new Error(`Sample data could not be built: ${result.error}`);
  return result.data;
}

export const SAMPLE_IDS = {
  paycheck: 'sample-paycheck',
  rent: 'sample-rent',
  electric: 'sample-electric',
  phone: 'sample-phone',
  carLoan: 'sample-car-loan',
  carRepair: 'sample-car-repair',
  streaming: 'sample-streaming',
  reserve: 'sample-reserve',
};

export function buildSampleData(today: DateStr): AppData {
  const T = (n: number) => addDays(today, n);
  const setup: ops.Clock = { today: T(-20), now: `${T(-20)}T12:00:00.000Z` };
  const now: ops.Clock = { today, now: `${today}T12:00:00.000Z` };

  let d = ops.emptyData();
  d = must(ops.addSource(d, { kind: 'income', description: 'Paycheck', amountCents: 180000, startDate: T(-17), rule: { type: 'biweekly' } }, setup, SAMPLE_IDS.paycheck));
  d = must(ops.addSource(d, { kind: 'bill', description: 'Rent', amountCents: 120000, startDate: T(12), rule: { type: 'monthly' } }, setup, SAMPLE_IDS.rent));
  d = must(ops.addSource(d, { kind: 'bill', description: 'Electric bill', amountCents: 9000, startDate: T(-12), rule: { type: 'monthly' } }, setup, SAMPLE_IDS.electric));
  d = must(ops.addSource(d, { kind: 'bill', description: 'Phone', amountCents: 6000, startDate: T(-6), rule: { type: 'monthly' } }, setup, SAMPLE_IDS.phone));
  d = must(ops.addSource(d, { kind: 'liability', liabilityType: 'loan', description: 'Car loan', amountCents: 35000, startDate: T(15), rule: { type: 'monthly' } }, setup, SAMPLE_IDS.carLoan));
  // Added after the T+25 payday so they show the categories without changing the timing gap.
  d = must(ops.addSource(d, { kind: 'subscription', description: 'Streaming service', amountCents: 1500, startDate: T(27), rule: { type: 'monthly' } }, setup, SAMPLE_IDS.streaming));
  d = must(ops.addSource(d, { kind: 'reserve', description: 'Emergency fund', amountCents: 10000, startDate: T(26), rule: { type: 'biweekly' } }, setup, SAMPLE_IDS.reserve));
  d = must(ops.addOneTime(d, { kind: 'varied', description: 'Car repair', amountCents: 70000, date: T(20) }, now, SAMPLE_IDS.carRepair));

  d = must(ops.recordActual(d, `${SAMPLE_IDS.paycheck}@${T(-17)}`, { amountCents: 180000, date: T(-17) }, now));
  d = must(ops.recordActual(d, `${SAMPLE_IDS.paycheck}@${T(-3)}`, { amountCents: 165000, date: T(-2) }, now));
  d = must(ops.recordActual(d, `${SAMPLE_IDS.electric}@${T(-12)}`, { amountCents: 12800, date: T(-10) }, now));

  return { ...d, onboardingComplete: true, isSample: true };
}
