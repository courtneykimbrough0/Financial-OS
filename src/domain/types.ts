import type { DateStr } from './dates';
import type { Cents } from './money';

/**
 * What a transaction is. Kinds roll up into four groups:
 *   Income
 *   Expenses: bills, subscriptions, liability payments
 *   Savings
 *   Spending
 * Every kind except income is money going out in the forecast.
 */
export type TransactionKind = 'income' | 'bill' | 'subscription' | 'liability' | 'savings' | 'spending';
export type KindGroup = 'income' | 'expenses' | 'savings' | 'spending';

/** Every liability payment is exactly one of these. */
export type LiabilityType = 'card' | 'loan' | 'lineOfCredit';
export const LIABILITY_TYPES: LiabilityType[] = ['card', 'loan', 'lineOfCredit'];
export const LIABILITY_TYPE_LABEL: Record<LiabilityType, string> = {
  card: 'Card',
  loan: 'Loan',
  lineOfCredit: 'Line of credit',
};

export const KINDS: TransactionKind[] = ['income', 'bill', 'subscription', 'liability', 'savings', 'spending'];
export const EXPENSE_KINDS: TransactionKind[] = ['bill', 'subscription', 'liability'];

export function groupOf(kind: TransactionKind): KindGroup {
  if (kind === 'income' || kind === 'savings' || kind === 'spending') return kind;
  return 'expenses';
}

/** Past-tense verb for a completed occurrence: received, paid, saved, spent. */
export function doneVerb(kind: TransactionKind): string {
  return kind === 'income' ? 'received' : kind === 'savings' ? 'saved' : kind === 'spending' ? 'spent' : 'paid';
}

/**
 * How a recurring source repeats. The first occurrence is always the schedule
 * version's `startDate` (the "next expected date" the user entered).
 *
 * - weekly / biweekly: every 7 / 14 days from the start date.
 * - monthly: the start date's day of month, every month.
 * - twiceMonthly: two explicit days of the month (e.g. the 1st and 15th).
 *   This is NOT the same as biweekly (24 vs. 26 occurrences per year).
 * - custom: every N days, weeks, or months.
 *
 * Month-based rules clamp days that do not exist in a month to that month's
 * last day (31st -> Feb 28/29, Apr 30). The clamp never "drifts": the next
 * month goes back to the intended day.
 */
export type RecurrenceRule =
  | { type: 'weekly' }
  | { type: 'biweekly' }
  | { type: 'monthly' }
  | { type: 'twiceMonthly'; days: [number, number] }
  | { type: 'custom'; interval: number; unit: 'day' | 'week' | 'month' };

/**
 * A recurring source's amount and schedule effective from `startDate` until the
 * next version's `startDate`. Editing a source's amount or schedule appends a
 * new version instead of rewriting earlier ones, so past occurrences keep the
 * expectation they had at the time.
 */
export interface ScheduleVersion {
  id: string;
  startDate: DateStr;
  amountCents: Cents;
  rule: RecurrenceRule;
}

export interface RecurringSource {
  id: string;
  kind: TransactionKind;
  description: string;
  /** Optional labels the user creates (e.g. "housing"). Never pre-filled. */
  tags: string[];
  /** Required for liability payments, absent for every other kind. */
  liabilityType?: LiabilityType;
  /** Sorted ascending by startDate; never empty. */
  versions: ScheduleVersion[];
  active: boolean;
  /** When inactive, occurrences on or after this date are not generated. */
  endDate: DateStr | null;
  /** Earlier inactive stretches: no occurrences in [from, until). */
  pausedRanges: { from: DateStr; until: DateStr }[];
  createdAt: string;
  updatedAt: string;
}

/** Stored lifecycle status. "overdue" is derived at read time, never stored. */
export type StoredStatus = 'scheduled' | 'completed' | 'canceled';
export type OccurrenceStatus = StoredStatus | 'overdue';

/**
 * A materialized occurrence. One-time transactions always have one of these.
 * Recurring occurrences are generated on the fly and only get a record once the
 * user acts on them (records an actual, reschedules, or cancels). A record
 * replaces the generated occurrence with the same id.
 *
 * `expected*` is the original prediction and is never modified after creation.
 * `scheduled*` is the latest expectation for an outstanding occurrence.
 * `actual*` is what the user reported happened.
 */
export interface OccurrenceRecord {
  id: string;
  sourceId: string | null;
  kind: TransactionKind;
  description: string;
  /** One-time items carry their own tags; recurring occurrences copy their source's. */
  tags: string[];
  expectedDate: DateStr;
  expectedAmountCents: Cents;
  scheduledDate: DateStr;
  scheduledAmountCents: Cents;
  status: StoredStatus;
  actualDate: DateStr | null;
  actualAmountCents: Cents | null;
  completedAt: string | null;
  canceledAt: string | null;
  cancelNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fully resolved occurrence, generated or materialized. */
export interface Occurrence extends OccurrenceRecord {
  /** Derived: scheduled + date passed => overdue. */
  displayStatus: OccurrenceStatus;
  /** True when no stored record exists yet (generated from a recurring source). */
  virtual: boolean;
}

export interface AppData {
  schemaVersion: 1;
  onboardingComplete: boolean;
  /** True for synthetic demonstration data, which is stored apart from real data. */
  isSample?: boolean;
  sources: RecurringSource[];
  records: OccurrenceRecord[];
}

export const KIND_LABEL: Record<TransactionKind, string> = {
  income: 'Income',
  bill: 'Bill',
  subscription: 'Subscription',
  liability: 'Liability payment',
  savings: 'Savings',
  spending: 'Spending',
};

export const GROUP_LABEL: Record<KindGroup, string> = {
  income: 'Income',
  expenses: 'Expenses',
  savings: 'Savings',
  spending: 'Spending',
};

/** Sign convention: income raises the tally; expenses and liability payments lower it. */
export function signFor(kind: TransactionKind): 1 | -1 {
  return kind === 'income' ? 1 : -1;
}

/** "Loan · " style prefix for a liability's type; empty for every other kind. */
export function liabilityPrefix(source: { kind: TransactionKind; liabilityType?: LiabilityType }): string {
  return source.kind === 'liability' && source.liabilityType ? `${LIABILITY_TYPE_LABEL[source.liabilityType]} · ` : '';
}

export function recurringOccurrenceId(sourceId: string, expectedDate: DateStr): string {
  return `${sourceId}@${expectedDate}`;
}
