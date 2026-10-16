import type { DateStr } from './dates';
import type { Cents } from './money';

/**
 * What a transaction is. Two groups:
 *   Income
 *   Expenses: bills, subscriptions, liability payments, savings
 * Every kind except income is an expense (money going out in the forecast).
 * Income minus expenses for a period is its "cash flow".
 */
export type TransactionKind = 'income' | 'bill' | 'subscription' | 'liability' | 'savings';
export type KindGroup = 'income' | 'expenses';

/** Every liability payment is exactly one of these. */
export type LiabilityType = 'card' | 'loan' | 'lineOfCredit';
export const LIABILITY_TYPES: LiabilityType[] = ['card', 'loan', 'lineOfCredit'];
export const LIABILITY_TYPE_LABEL: Record<LiabilityType, string> = {
  card: 'Card',
  loan: 'Loan',
  lineOfCredit: 'Line of credit',
};

export const KINDS: TransactionKind[] = ['income', 'bill', 'subscription', 'liability', 'savings'];
export const EXPENSE_KINDS: TransactionKind[] = ['bill', 'subscription', 'liability', 'savings'];

export function groupOf(kind: TransactionKind): KindGroup {
  return kind === 'income' ? 'income' : 'expenses';
}

/** Past-tense verb for a completed occurrence: received, paid, saved. */
export function doneVerb(kind: TransactionKind): string {
  return kind === 'income' ? 'received' : kind === 'savings' ? 'saved' : 'paid';
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
  /**
   * Income only: pay periods run from one payday of this source to the next.
   * At most one source has it; see `mainPaycheckId` for the fallback.
   */
  mainPaycheck?: boolean;
  /** Sorted ascending by startDate; never empty. */
  versions: ScheduleVersion[];
  active: boolean;
  /** When inactive, occurrences on or after this date are not generated. */
  endDate: DateStr | null;
  /** Earlier inactive stretches: no occurrences in [from, until). */
  pausedRanges: { from: DateStr; until: DateStr }[];
  /** The latest estimate suggestion the person dismissed (see `estimates.ts`). Absent otherwise. */
  estimateDismissal?: EstimateDismissal;
  createdAt: string;
  updatedAt: string;
}

/**
 * A dismissed estimate suggestion: the estimate it was compared with, the
 * amount suggested, and the original date of the latest payment it used.
 */
export interface EstimateDismissal {
  currentCents: Cents;
  proposedCents: Cents;
  through: DateStr;
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

/** How often the person wants to review their outlook. "off" (the default) means never prompted. */
export type ReviewCadence = 'off' | 'weekly' | 'payday' | 'monthly';
export const REVIEW_CADENCES: ReviewCadence[] = ['off', 'weekly', 'payday', 'monthly'];

/**
 * Review rhythm. Only the latest handling is kept: a review period counts as
 * done once `handledOn` is on or after its start, so missed periods never
 * pile up.
 */
export interface ReviewSettings {
  cadence: ReviewCadence;
  /** The day the latest review was completed or skipped, or null. */
  handledOn: DateStr | null;
  outcome: 'completed' | 'skipped' | null;
}

export interface AppData {
  schemaVersion: 2;
  /**
   * Increases by one with every successful save. A save is accepted only when
   * it is based on the revision currently stored, so an out-of-date copy
   * (another tab, another device) can never overwrite newer data.
   */
  revision: number;
  onboardingComplete: boolean;
  /** True for synthetic demonstration data, which is stored apart from real data. */
  isSample?: boolean;
  sources: RecurringSource[];
  records: OccurrenceRecord[];
  /** Absent until the person chooses a review rhythm (then saved with the rest). */
  review?: ReviewSettings;
}

export const KIND_LABEL: Record<TransactionKind, string> = {
  income: 'Income',
  bill: 'Bill',
  subscription: 'Subscription',
  liability: 'Liability payment',
  savings: 'Savings',
};

export const GROUP_LABEL: Record<KindGroup, string> = {
  income: 'Income',
  expenses: 'Expenses',
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

/**
 * The income that defines pay periods: the active income marked as the main
 * paycheck, or else the first active recurring income. Null without income.
 */
export function mainPaycheckId(data: AppData): string | null {
  const incomes = data.sources.filter((s) => s.kind === 'income' && s.active);
  return (incomes.find((s) => s.mainPaycheck) ?? incomes[0])?.id ?? null;
}
