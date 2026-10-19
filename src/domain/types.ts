import type { DateStr } from './dates';
import type { Cents } from './money';

/**
 * The six financial classifications. They describe activity, never accounts.
 *
 *   income        money coming in from outside
 *   bill          an essential recurring obligation with no payoff
 *   subscription  a nonessential recurring obligation with no payoff
 *   liability     a payment toward an obligation with a payoff amount and date
 *   reserve       Strategic Reserves: money set aside on purpose, to keep
 *   varied        Varied Spending: one-time spending
 *
 * Bills, subscriptions, liabilities and varied spending are external outflows:
 * money that leaves the person's accounts. A reserve allocation is not: the
 * money stays theirs, set aside, so it is never spending. It still reduces the
 * cash available for ordinary spending, and a release (a one-time reserve
 * marked `release`) returns money to it.
 *
 *   Operating cash flow = income − external outflows
 *   Available cash flow = operating cash flow − net reserve allocations
 *
 * The running total and "cash flow" everywhere in the app are available cash
 * flow. See FINANCIAL_ENGINE.md.
 */
export type TransactionKind = 'income' | 'bill' | 'subscription' | 'liability' | 'reserve' | 'varied';

/** Kinds a recurring item can have. Varied spending is one-time by definition. */
export const RECURRING_KINDS = ['income', 'bill', 'subscription', 'liability', 'reserve'] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];
/** Kinds a one-time item can have: recurring obligations are recurring by definition. */
export const ONE_TIME_KINDS = ['income', 'varied', 'reserve'] as const;
export type OneTimeKind = (typeof ONE_TIME_KINDS)[number];

/** Every liability payment is exactly one of these. */
export type LiabilityType = 'card' | 'loan' | 'lineOfCredit';
export const LIABILITY_TYPES: LiabilityType[] = ['card', 'loan', 'lineOfCredit'];
export const LIABILITY_TYPE_LABEL: Record<LiabilityType, string> = {
  card: 'Card',
  loan: 'Loan',
  lineOfCredit: 'Line of credit',
};

/**
 * Where money is received, held and spent. Every account has exactly one type;
 * its name (the person's own) says what it's for. A type never describes a
 * financial classification: "Strategic Reserves" is a classification, held in
 * a distribution account; "Subscriptions" is a classification, paid from a
 * payment account. No bank connection: these are the person's own labels.
 *
 * - income: receives external income and moves it to other accounts. In a
 *   simple setup it also does the routing. Never pays bills or spending.
 * - distribution: receives internal transfers, may accumulate money (routing,
 *   strategic reserves), and moves it on. Never receives external income or
 *   pays outside parties.
 * - payment: holds money for payments and spending, and pays outside parties.
 *   Obligations and everyday spending are both payment accounts; the purpose
 *   is in the name.
 */
export type AccountType = 'income' | 'distribution' | 'payment';
export const ACCOUNT_TYPES: AccountType[] = ['income', 'distribution', 'payment'];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  income: 'Income',
  distribution: 'Distribution',
  payment: 'Payment',
};

export interface Account {
  id: string;
  /** The person's own name for it, e.g. "Paycheck account", "Bills", "Reserves". */
  name: string;
  type: AccountType;
  /**
   * Optional: what the account held at the end of `opening.date`, as the
   * person reported it. Balances are known only from here on (see
   * `balances.ts`); without it the app never states a balance. May be negative.
   */
  opening?: { amountCents: Cents; date: DateStr };
  createdAt: string;
  updatedAt: string;
}

/**
 * Money moved from one of the person's accounts to another. An internal
 * transfer is never income or spending, and never changes the total held
 * across their accounts: the source goes down and the destination up by the
 * same amount. "expected" is a plan; only "recorded" says the money moved,
 * and an expected transfer stays expected until the person records it,
 * whatever its date. No bank is involved.
 */
export type TransferStatus = 'expected' | 'recorded';
export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: Cents;
  /** The planned date while expected; the date it happened once recorded. */
  date: DateStr;
  status: TransferStatus;
  /** When it was recorded (audit), or null while expected. */
  recordedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The account type an item of this kind can be assigned to: income arrives in
 * an income account; Strategic Reserves are held in a distribution account;
 * bills, subscriptions, liabilities and varied spending are paid from a
 * payment account.
 */
export function accountTypeFor(kind: TransactionKind): AccountType {
  return kind === 'income' ? 'income' : kind === 'reserve' ? 'distribution' : 'payment';
}

export const KINDS: TransactionKind[] = ['income', 'bill', 'subscription', 'liability', 'reserve', 'varied'];
/** External outflows: money that leaves the person's accounts. */
export const OUTFLOW_KINDS: TransactionKind[] = ['bill', 'subscription', 'liability', 'varied'];

/** Past-tense verb for a completed occurrence: received, paid, set aside, released. */
export function doneVerb(o: { kind: TransactionKind; release?: true }): string {
  if (o.kind === 'income') return 'received';
  if (o.kind === 'reserve') return o.release ? 'released' : 'set aside';
  return 'paid';
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
  kind: RecurringKind;
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
  /** The latest estimate suggestion the person dismissed (see `estimates.ts`). Absent otherwise. */
  estimateDismissal?: EstimateDismissal;
  /** Optional: the account this item is received in, paid from or held in (see `accountTypeFor`). Never read by the forecast. */
  accountId?: string;
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
  /**
   * Optional, never read by the forecast. A one-time item's account; for a
   * recurring occurrence, the account its item had when it was recorded
   * (outstanding ones follow their item's current account).
   */
  accountId?: string;
  /** One-time reserves only: money taken back out of reserves, which returns it to available cash flow. */
  release?: true;
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
  /** The person's accounts. Absent until the first one is added; items work without any. */
  accounts?: Account[];
  /** Money moved between the person's own accounts. Absent until the first one. */
  transfers?: Transfer[];
}

export const KIND_LABEL: Record<TransactionKind, string> = {
  income: 'Income',
  bill: 'Bill',
  subscription: 'Subscription',
  liability: 'Liability payment',
  reserve: 'Strategic reserve',
  varied: 'Varied spending',
};

/**
 * Sign in available cash flow and the running total: income and reserve
 * releases raise it; outflows and reserve allocations lower it.
 */
export function signFor(o: { kind: TransactionKind; release?: true }): 1 | -1 {
  return o.kind === 'income' || (o.kind === 'reserve' && o.release) ? 1 : -1;
}

/** "Loan · " style prefix for a liability's type; empty for every other kind. */
export function liabilityPrefix(source: { kind: TransactionKind; liabilityType?: LiabilityType }): string {
  return source.kind === 'liability' && source.liabilityType ? `${LIABILITY_TYPE_LABEL[source.liabilityType]} · ` : '';
}

export function recurringOccurrenceId(sourceId: string, expectedDate: DateStr): string {
  return `${sourceId}@${expectedDate}`;
}

/** True when at least one active recurring income exists. */
export function hasActiveIncome(data: AppData): boolean {
  return data.sources.some((s) => s.kind === 'income' && s.active);
}
