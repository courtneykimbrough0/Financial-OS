/**
 * Earnings history (E5): what was earned in a period, set beside what was
 * received, from data E2–E4 already keep. Read-only aggregation; nothing here
 * is stored, and nothing here is read by the forecast.
 *
 * Three kinds of money, never added together:
 * - Earned: work done in the period (shifts and sessions by their date),
 *   from `summarize`. Earned is never money in.
 * - Not received yet: what no recorded paycheck, payout or job payment covers
 *   today (`earnedNotPaid`, `waitingByPlatform`, `doneNotPaid`).
 * - Received: recorded income in the period that pays for work (paychecks and
 *   payouts of tracked income, cash tips and session cash, job payments). These
 *   are the same recorded entries Activity counts, so they are counted once, in
 *   cash flow, and only listed here.
 */
import type { DateStr } from './dates';
import { doneNotPaid, earnedNotPaid, jobView, shiftsInRange, summarize, waitingByPlatform, type EarningsSummary, type JobView } from './earnings';
import type { ForecastEntry } from './forecast';
import type { Cents } from './money';
import { workKindFor, type AppData, type RecurringSource, type WorkEntry } from './types';

export interface SourceEarnings {
  source: RecurringSource;
  kind: WorkEntry['kind'];
  summary: EarningsSummary;
}

export interface SourceNotReceived {
  source: RecurringSource;
  kind: WorkEntry['kind'];
  cents: Cents;
  /** Gig income with more than one platform waiting: the split. */
  platforms: { platform: string | null; cents: Cents }[];
}

/** Why a recorded income is listed with earnings. */
export type ReceivedFor = 'paycheck' | 'payout' | 'cash-tips' | 'session-cash' | 'job-payment';

export interface ReceivedItem {
  entry: ForecastEntry;
  for: ReceivedFor;
}

export interface EarningsHistory {
  start: DateStr;
  end: DateStr;
  /** Shifts and sessions dated in the period, all together. */
  work: EarningsSummary;
  /** The same, per income item, in the order of the plan. Items with no work in the period are left out. */
  bySource: SourceEarnings[];
  /** Today: wages and card tips not paid, and platform earnings waiting for payout, per item (non-zero only). */
  notReceived: SourceNotReceived[];
  jobs: {
    /** Today: planned work, not yet done or paid (a skipped payment is left out). */
    planned: JobView[];
    plannedCents: Cents;
    /** Today: done work not paid. */
    doneNotPaid: JobView[];
    doneNotPaidCents: Cents;
    /** Jobs whose payment was recorded in the period. */
    paid: JobView[];
    paidCents: Cents;
  };
  /** Recorded income in the period that pays for work, newest first. Already in cash flow. */
  received: ReceivedItem[];
  receivedCents: Cents;
}

/** True when there is anything to show: at least one logged shift or session, or one job. */
export function hasEarningsData(data: AppData): boolean {
  return (data.workEntries?.length ?? 0) > 0 || (data.jobs?.length ?? 0) > 0;
}

/**
 * Earnings for [start, end]. `recorded` is the period's recorded entries
 * (`recordedEntries`), so "received" is exactly what Activity counts.
 * `today` decides what is not received yet and whether a payment is overdue.
 */
export function earningsHistory(data: AppData, recorded: ForecastEntry[], start: DateStr, end: DateStr, today: DateStr): EarningsHistory {
  const entries = data.workEntries ?? [];
  const tracked = data.sources.filter((s) => s.kind === 'income' && (s.incomeType !== undefined || entries.some((e) => e.sourceId === s.id)));

  const bySource: SourceEarnings[] = [];
  const notReceived: SourceNotReceived[] = [];
  for (const source of tracked) {
    const kind = workKindFor(source.incomeType) ?? entries.find((e) => e.sourceId === source.id)?.kind ?? 'shift';
    const inRange = shiftsInRange(data, start, end, source.id);
    if (inRange.length > 0) bySource.push({ source, kind, summary: summarize(inRange) });
    const owed = earnedNotPaid(data, source.id).cents;
    if (owed > 0) {
      const platforms = kind === 'session' ? waitingByPlatform(data, source.id) : [];
      notReceived.push({ source, kind, cents: owed, platforms: platforms.length > 1 ? platforms : [] });
    }
  }

  // What each recorded income pays for, from the links E2–E4 keep.
  const paycheckOf = new Map(tracked.map((s) => [s.id, workKindFor(s.incomeType) === 'session' ? 'payout' : 'paycheck'] as const));
  const linked = new Map<string, ReceivedFor>();
  for (const e of entries) {
    if (e.cashTipsRecordId) linked.set(e.cashTipsRecordId, e.kind === 'session' ? 'session-cash' : 'cash-tips');
    if (e.paidByOccurrenceId && !linked.has(e.paidByOccurrenceId)) linked.set(e.paidByOccurrenceId, e.kind === 'session' ? 'payout' : 'paycheck');
  }
  for (const j of data.jobs ?? []) if (j.paymentRecordId) linked.set(j.paymentRecordId, 'job-payment');

  const received: ReceivedItem[] = [];
  for (const entry of recorded) {
    const o = entry.occurrence;
    if (o.kind !== 'income') continue;
    const reason = linked.get(o.id) ?? (o.sourceId ? paycheckOf.get(o.sourceId) : undefined);
    if (reason) received.push({ entry, for: reason });
  }
  received.sort((a, b) => (a.entry.date !== b.entry.date ? (a.entry.date > b.entry.date ? -1 : 1) : a.entry.occurrence.id < b.entry.occurrence.id ? -1 : 1));

  const views = (data.jobs ?? []).map((j) => jobView(data, j, today));
  const paidIds = new Set(received.filter((r) => r.for === 'job-payment').map((r) => r.entry.occurrence.id));
  const planned = views.filter((v) => v.status === 'planned' && v.payment !== 'skipped');
  const done = doneNotPaid(data, today);
  const paid = views.filter((v) => v.payment === 'received' && v.record && paidIds.has(v.record.id));
  const sum = (vs: JobView[]) => vs.reduce((n, v) => n + v.amountCents, 0);

  return {
    start,
    end,
    work: summarize(shiftsInRange(data, start, end)),
    bySource,
    notReceived,
    jobs: { planned, plannedCents: sum(planned), doneNotPaid: done.jobs, doneNotPaidCents: done.cents, paid, paidCents: sum(paid) },
    received,
    receivedCents: received.reduce((n, r) => n + r.entry.amountCents, 0),
  };
}
