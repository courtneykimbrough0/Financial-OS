/**
 * Earnings from logged shifts (E2): what was earned, kept apart from money
 * received. Pure functions over `WorkEntry`; nothing here is read by the
 * forecast, so nothing here can change cash flow or the running total.
 *
 * - Wages for a shift: hours × hourly wage, in whole cents (rounded to the
 *   nearest cent once per shift).
 * - A shift's earnings: wages + cash tips + card tips.
 * - Earned, not paid yet: the wages and card tips of shifts no recorded
 *   paycheck has covered. Cash tips are never in it: they were money in on the
 *   shift's date, as their own received income record.
 * - Effective hourly: earnings ÷ hours, over shifts that have hours.
 * - Gig sessions (E4) the same way: cash received immediately is its own
 *   received record; platform earnings wait for the payout that covers them.
 *
 * Freelance jobs (E3) are read the same way: done but unpaid work is earned,
 * not received; only a job's payment record is ever counted.
 */
import type { DateStr } from './dates';
import type { Cents } from './money';
import { deriveStatus } from './occurrences';
import { type AppData, type FreelanceJob, type JobStatus, type OccurrenceRecord, type WorkEntry } from './types';

export interface ShiftEarnings {
  wagesCents: Cents;
  /** Shifts: cash tips. Sessions: cash received immediately. */
  cashTipsCents: Cents;
  cardTipsCents: Cents;
  /** Sessions: platform earnings. */
  earningsCents: Cents;
  /** Everything earned: wages + cash + card tips + platform earnings. */
  totalCents: Cents;
  /** What a later paycheck or payout pays: wages + card tips + platform earnings (never the cash, already received). */
  payrollCents: Cents;
}

/** Hours × wage for one shift, to the nearest cent; $0 without both. */
export function shiftWagesCents(e: Pick<WorkEntry, 'minutes' | 'wageCents'>): Cents {
  return e.minutes && e.wageCents ? Math.round((e.minutes * e.wageCents) / 60) : 0;
}

export function shiftEarnings(e: WorkEntry): ShiftEarnings {
  const wagesCents = shiftWagesCents(e);
  const cashTipsCents = e.cashTipsCents ?? 0;
  const cardTipsCents = e.cardTipsCents ?? 0;
  const earningsCents = e.earningsCents ?? 0;
  return { wagesCents, cashTipsCents, cardTipsCents, earningsCents, totalCents: wagesCents + cashTipsCents + cardTipsCents + earningsCents, payrollCents: wagesCents + cardTipsCents + earningsCents };
}

export interface EarningsSummary {
  shifts: number;
  minutes: number;
  wagesCents: Cents;
  cashTipsCents: Cents;
  cardTipsCents: Cents;
  earningsCents: Cents;
  totalCents: Cents;
  /** Earnings per hour over the shifts that have hours; null when none do. */
  effectiveHourlyCents: Cents | null;
}

/** Totals for a set of shifts. Each shift is counted once. */
export function summarize(entries: WorkEntry[]): EarningsSummary {
  let minutes = 0;
  let withHoursCents = 0;
  const sum = { wagesCents: 0, cashTipsCents: 0, cardTipsCents: 0, earningsCents: 0, totalCents: 0 };
  for (const e of entries) {
    const s = shiftEarnings(e);
    sum.wagesCents += s.wagesCents;
    sum.cashTipsCents += s.cashTipsCents;
    sum.cardTipsCents += s.cardTipsCents;
    sum.earningsCents += s.earningsCents;
    sum.totalCents += s.totalCents;
    if (e.minutes) {
      minutes += e.minutes;
      withHoursCents += s.totalCents;
    }
  }
  return { shifts: entries.length, minutes, ...sum, effectiveHourlyCents: minutes > 0 ? Math.round((withHoursCents * 60) / minutes) : null };
}

/** An income item's shifts, newest first (then by id, so the order never depends on storage). */
export function shiftsFor(data: AppData, sourceId: string): WorkEntry[] {
  return (data.workEntries ?? [])
    .filter((e) => e.sourceId === sourceId)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Shifts in [start, end], every item or one. */
export function shiftsInRange(data: AppData, start: DateStr, end: DateStr, sourceId?: string): WorkEntry[] {
  return (data.workEntries ?? []).filter((e) => e.date >= start && e.date <= end && (sourceId === undefined || e.sourceId === sourceId));
}

/**
 * What no recorded paycheck or payout has covered yet, for one item: wages and
 * card tips of shifts, or platform earnings of sessions ("waiting for
 * payout"). Outside cash flow until that paycheck or payout is recorded.
 */
export function earnedNotPaid(data: AppData, sourceId: string): { cents: Cents; shifts: WorkEntry[] } {
  const shifts = shiftsFor(data, sourceId).filter((e) => e.paidByOccurrenceId === undefined);
  return { cents: shifts.reduce((n, e) => n + shiftEarnings(e).payrollCents, 0), shifts };
}

/** Platform earnings waiting for a payout, by platform (unnamed last), for one gig income. */
export function waitingByPlatform(data: AppData, sourceId: string): { platform: string | null; cents: Cents }[] {
  const totals = new Map<string | null, Cents>();
  for (const e of earnedNotPaid(data, sourceId).shifts) if (e.earningsCents) totals.set(e.platform ?? null, (totals.get(e.platform ?? null) ?? 0) + e.earningsCents);
  return [...totals].map(([platform, cents]) => ({ platform, cents })).sort((a, b) => (a.platform === null ? 1 : b.platform === null ? -1 : a.platform.localeCompare(b.platform)));
}

/** "6.5 h", "45 min". */
export function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours} h`;
}

/** Where a freelance job's payment stands. */
export type JobPaymentState = 'pending' | 'expected' | 'overdue' | 'received' | 'skipped';

export interface JobView {
  job: FreelanceJob;
  /** Planned or done work, or paid once its payment is received. */
  status: JobStatus | 'paid';
  payment: JobPaymentState;
  /** Received: the actual amount; with a payment record: its current expectation; otherwise the agreed amount. */
  amountCents: Cents;
  /** Received: the actual date; with a payment record: its current expected date; otherwise none. */
  date: DateStr | null;
  record?: OccurrenceRecord;
}

/**
 * A job as it stands today: its work and its payment. "pending" is a job
 * without an expected payment date, which doesn't count; "expected" and
 * "overdue" are projected payments, which do. Only "received" is money in.
 */
export function jobView(data: AppData, job: FreelanceJob, today: DateStr): JobView {
  const record = job.paymentRecordId ? data.records.find((r) => r.id === job.paymentRecordId) : undefined;
  if (!record) return { job, status: job.status, payment: 'pending', amountCents: job.amountCents, date: null };
  if (record.status === 'completed') return { job, status: 'paid', payment: 'received', amountCents: record.actualAmountCents!, date: record.actualDate, record };
  const base = { job, status: job.status, amountCents: record.scheduledAmountCents, date: record.scheduledDate, record };
  if (record.status === 'canceled') return { ...base, payment: 'skipped' };
  return { ...base, payment: deriveStatus(record, today) === 'overdue' ? 'overdue' : 'expected' };
}

/**
 * Done work not paid yet: earned, outside cash flow. A job whose payment was
 * skipped isn't in it. Each job once, at its current amount.
 */
export function doneNotPaid(data: AppData, today: DateStr): { cents: Cents; jobs: JobView[] } {
  const jobs = (data.jobs ?? []).map((j) => jobView(data, j, today)).filter((v) => v.status === 'done' && v.payment !== 'skipped');
  return { cents: jobs.reduce((n, v) => n + v.amountCents, 0), jobs };
}
