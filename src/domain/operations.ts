/**
 * Pure state transitions. Each returns a new AppData or an error message and
 * never mutates its input. These are the only way the UI changes data, so the
 * invariants below hold everywhere:
 *
 *  - An occurrence's original prediction (expectedDate / expectedAmountCents)
 *    is never modified after the occurrence exists.
 *  - Recording an actual outcome touches only that occurrence; the recurring
 *    source and its other occurrences are unchanged.
 *  - An occurrence can be completed once. A second completion attempt (double
 *    tap, retried save) is rejected; corrections use `correctActual`.
 *  - Schedule changes apply from an effective date (today or later) by adding
 *    a schedule version; earlier occurrences keep their expectation.
 */
import { isValidDateStr, type DateStr } from './dates';
import type { Cents } from './money';
import { DEFAULT_REVIEW, reviewStatus } from './cadence';
import { findOccurrence } from './occurrences';
import { validateRule } from './recurrence';
import { ACCOUNT_TYPES, LIABILITY_TYPES, ONE_TIME_KINDS, RECURRING_KINDS, REVIEW_CADENCES, accountTypeFor, type Account, type AccountType, type AppData, type ReviewCadence, type LiabilityType, type OccurrenceRecord, type OneTimeKind, type RecurrenceRule, type RecurringKind, type RecurringSource, type Transfer, type TransactionKind } from './types';

export type Result = { ok: true; data: AppData } | { ok: false; error: string };

const ok = (data: AppData): Result => ({ ok: true, data });
const fail = (error: string): Result => ({ ok: false, error });

export function newId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

export function emptyData(): AppData {
  return { schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] };
}

export interface Clock {
  today: DateStr;
  /** ISO timestamp for audit fields. */
  now: string;
}

function validateAmount(amountCents: Cents, label = 'Amount'): string | null {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return `${label} must be greater than $0.`;
  if (amountCents > 100_000_000_00) return `${label} is too large.`;
  return null;
}

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 24;

/**
 * Cleans user-entered tags: trims, collapses spaces, drops empties, removes
 * case-insensitive duplicates (keeping the first spelling), and caps length
 * and count. Tags are always the user's own words; none are built in.
 */
export function normalizeTags(tags: string[] | undefined, limit = MAX_TAGS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const tag = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === limit) break;
  }
  return out;
}

/** Every tag the user has created, for suggestions. Sorted, case-insensitively unique (no cap on count). */
export function allTags(data: AppData): string[] {
  // De-duplicate in the order tags were created (keeping the user's first spelling), then sort.
  const tags = [...data.sources.flatMap((s) => s.tags), ...data.records.flatMap((r) => r.tags)];
  return normalizeTags(tags, Infinity).sort((a, b) => a.localeCompare(b));
}

function validateDescription(description: string): string | null {
  if (description.trim() === '') return 'Enter a description.';
  if (description.trim().length > 80) return 'Keep the description under 80 characters.';
  return null;
}

// ---------------------------------------------------------------------------
// Recurring sources
// ---------------------------------------------------------------------------

export interface SourceInput {
  kind: RecurringKind;
  description: string;
  tags?: string[];
  /** Required when kind is 'liability'. */
  liabilityType?: LiabilityType;
  amountCents: Cents;
  startDate: DateStr;
  rule: RecurrenceRule;
}

function validateLiabilityType(kind: TransactionKind, type: LiabilityType | undefined): string | null {
  if (kind !== 'liability') return null;
  return type && LIABILITY_TYPES.includes(type) ? null : 'Choose whether this is a card, a loan, or a line of credit.';
}

export function addSource(data: AppData, input: SourceInput, clock: Clock, id = newId('src')): Result {
  const err =
    (!RECURRING_KINDS.includes(input.kind) ? 'Choose income, a bill, a subscription, a liability or a strategic reserve.' : null) ??
    validateDescription(input.description) ??
    validateLiabilityType(input.kind, input.liabilityType) ??
    validateAmount(input.amountCents) ??
    (!isValidDateStr(input.startDate) ? 'Enter a valid date.' : null) ??
    (input.startDate < clock.today ? 'The next expected date must be today or later.' : null) ??
    validateRule(input.rule, input.startDate);
  if (err) return fail(err);
  const source: RecurringSource = {
    id,
    kind: input.kind,
    description: input.description.trim(),
    tags: normalizeTags(input.tags),
    ...(input.kind === 'liability' ? { liabilityType: input.liabilityType } : {}),
    versions: [{ id: newId('ver'), startDate: input.startDate, amountCents: input.amountCents, rule: input.rule }],
    active: true,
    endDate: null,
    pausedRanges: [],
    createdAt: clock.now,
    updatedAt: clock.now,
  };
  return ok({ ...data, sources: [...data.sources, source] });
}

function withSource(data: AppData, id: string, fn: (s: RecurringSource) => RecurringSource | string): Result {
  const source = data.sources.find((s) => s.id === id);
  if (!source) return fail('That item no longer exists.');
  const next = fn(source);
  if (typeof next === 'string') return fail(next);
  return ok({ ...data, sources: data.sources.map((s) => (s.id === id ? next : s)) });
}

/** Rename / recategorize. Does not touch amounts, dates, or recorded outcomes. */
export function updateSourceDetails(data: AppData, id: string, details: { description: string; tags?: string[]; liabilityType?: LiabilityType }, clock: Clock): Result {
  const err = validateDescription(details.description);
  if (err) return fail(err);
  return withSource(data, id, (s) => {
    const typeErr = validateLiabilityType(s.kind, details.liabilityType ?? s.liabilityType);
    if (typeErr) return typeErr;
    return {
      ...s,
      ...(s.kind === 'liability' ? { liabilityType: details.liabilityType ?? s.liabilityType } : {}),
      description: details.description.trim(),
      tags: details.tags ? normalizeTags(details.tags) : s.tags,
      updatedAt: clock.now,
    };
  });
}

export interface ScheduleChange {
  /** First occurrence under the new schedule; also the effective date. */
  startDate: DateStr;
  amountCents: Cents;
  rule: RecurrenceRule;
}

/**
 * Changes the amount and/or schedule from `change.startDate` onward. Versions
 * starting on or after that date are replaced; occurrences before it keep the
 * expectations they were generated with. Recorded and canceled occurrences are
 * kept as they are. A rescheduled occurrence that is still outstanding stops
 * applying if the new schedule no longer has its original date (see
 * `resolveOccurrences`); its record is kept.
 */
export function changeSourceSchedule(data: AppData, id: string, change: ScheduleChange, clock: Clock): Result {
  const err =
    validateAmount(change.amountCents) ??
    (!isValidDateStr(change.startDate) ? 'Enter a valid date.' : null) ??
    (change.startDate < clock.today ? 'Changes can only take effect today or later, so past occurrences keep their original expectations.' : null) ??
    validateRule(change.rule, change.startDate);
  if (err) return fail(err);
  return withSource(data, id, (s) => {
    if (!s.active) return 'Turn this item back on before changing its schedule.';
    const kept = s.versions.filter((v) => v.startDate < change.startDate);
    return {
      ...s,
      versions: [...kept, { id: newId('ver'), startDate: change.startDate, amountCents: change.amountCents, rule: change.rule }],
      updatedAt: clock.now,
    };
  });
}

/**
 * True when a source has no recorded outcomes and no occurrences before today,
 * so nothing about it has happened yet (e.g. it was just added during setup).
 */
export function sourceHasNoHistory(data: AppData, id: string, today: DateStr): boolean {
  const source = data.sources.find((s) => s.id === id);
  if (!source) return false;
  return source.versions[0]!.startDate >= today && !data.records.some((r) => r.sourceId === id);
}

/**
 * Replaces the whole definition of a source that has no history yet. Unlike
 * `changeSourceSchedule`, nothing from the old schedule is kept, because no
 * occurrence of it has happened or been recorded.
 */
export function redefineSource(data: AppData, id: string, input: Omit<SourceInput, 'kind'>, clock: Clock): Result {
  if (!sourceHasNoHistory(data, id, clock.today)) return fail('This item already has history. Change its schedule from a future date instead.');
  const kind = data.sources.find((x) => x.id === id)!.kind;
  const err =
    validateDescription(input.description) ??
    validateLiabilityType(kind, input.liabilityType) ??
    validateAmount(input.amountCents) ??
    (!isValidDateStr(input.startDate) ? 'Enter a valid date.' : null) ??
    (input.startDate < clock.today ? 'The next expected date must be today or later.' : null) ??
    validateRule(input.rule, input.startDate);
  if (err) return fail(err);
  return withSource(data, id, (s) => ({
    ...s,
    description: input.description.trim(),
    tags: normalizeTags(input.tags),
    ...(kind === 'liability' ? { liabilityType: input.liabilityType } : {}),
    versions: [{ id: newId('ver'), startDate: input.startDate, amountCents: input.amountCents, rule: input.rule }],
    updatedAt: clock.now,
  }));
}

/**
 * Permanently removes a recurring source that has no recorded outcomes (e.g.
 * one added by mistake during setup). Sources with history must be turned off
 * instead so that history is preserved.
 */
export function deleteSource(data: AppData, id: string): Result {
  if (!data.sources.some((s) => s.id === id)) return fail('That item no longer exists.');
  if (data.records.some((r) => r.sourceId === id)) return fail('This item has recorded history. Turn it off instead so the history is kept.');
  return ok({ ...data, sources: data.sources.filter((s) => s.id !== id) });
}

/** Makes this income the main paycheck: pay periods run from one of its paydays to the next. */
export function setMainPaycheck(data: AppData, id: string, clock: Clock): Result {
  const source = data.sources.find((s) => s.id === id);
  if (!source) return fail('This item no longer exists.');
  if (source.kind !== 'income') return fail('Only income can be the main paycheck.');
  if (!source.active) return fail('Turn this income back on before making it the main paycheck.');
  return ok({
    ...data,
    sources: data.sources.map((s) => {
      if (s.id === id) return { ...s, mainPaycheck: true, updatedAt: clock.now };
      if (!s.mainPaycheck) return s;
      const { mainPaycheck: _was, ...rest } = s;
      return { ...rest, updatedAt: clock.now };
    }),
  });
}

/**
 * Stops forecasting from today. Past occurrences and recorded outcomes remain;
 * outstanding occurrences originally due today or later, including rescheduled
 * ones, are no longer counted.
 */
export function deactivateSource(data: AppData, id: string, clock: Clock): Result {
  return withSource(data, id, (s) => (s.active ? { ...s, active: false, endDate: clock.today, updatedAt: clock.now } : 'This item is already turned off.'));
}

/**
 * Resumes forecasting with the next occurrence on `nextDate`. The inactive
 * stretch stays empty, so turning an item back on never creates a backlog of
 * overdue occurrences.
 */
export function reactivateSource(data: AppData, id: string, nextDate: DateStr, clock: Clock): Result {
  if (!isValidDateStr(nextDate)) return fail('Enter a valid date.');
  if (nextDate < clock.today) return fail('The next expected date must be today or later.');
  return withSource(data, id, (s) => {
    if (s.active) return 'This item is already on.';
    const last = s.versions[s.versions.length - 1]!;
    const ruleErr = validateRule(last.rule, nextDate);
    if (ruleErr) return ruleErr;
    const pauseFrom = s.endDate ?? clock.today;
    const kept = s.versions.filter((v) => v.startDate < nextDate);
    return {
      ...s,
      active: true,
      endDate: null,
      pausedRanges: nextDate > pauseFrom ? [...s.pausedRanges, { from: pauseFrom, until: nextDate }] : s.pausedRanges,
      versions: [...kept, { id: newId('ver'), startDate: nextDate, amountCents: last.amountCents, rule: last.rule }],
      updatedAt: clock.now,
    };
  });
}

// ---------------------------------------------------------------------------
// One-time transactions
// ---------------------------------------------------------------------------

export interface OneTimeInput {
  kind: OneTimeKind;
  tags?: string[];
  description: string;
  amountCents: Cents;
  date: DateStr;
  /** Reserves only: money taken out of reserves rather than set aside. */
  release?: boolean;
}

export function addOneTime(data: AppData, input: OneTimeInput, clock: Clock, id = newId('one')): Result {
  const err =
    (!ONE_TIME_KINDS.includes(input.kind) ? 'Choose income, varied spending or a strategic reserve.' : null) ??
    (input.release && input.kind !== 'reserve' ? 'Only a strategic reserve can be released.' : null) ??
    validateDescription(input.description) ??
    validateAmount(input.amountCents) ??
    (!isValidDateStr(input.date) ? 'Enter a valid date.' : null);
  if (err) return fail(err);
  const record: OccurrenceRecord = {
    id,
    sourceId: null,
    kind: input.kind,
    description: input.description.trim(),
    tags: normalizeTags(input.tags),
    ...(input.release ? { release: true as const } : {}),
    expectedDate: input.date,
    expectedAmountCents: input.amountCents,
    scheduledDate: input.date,
    scheduledAmountCents: input.amountCents,
    status: 'scheduled',
    actualDate: null,
    actualAmountCents: null,
    completedAt: null,
    canceledAt: null,
    cancelNote: null,
    createdAt: clock.now,
    updatedAt: clock.now,
  };
  return ok({ ...data, records: [...data.records, record] });
}

export function deleteOneTime(data: AppData, id: string): Result {
  const record = data.records.find((r) => r.id === id);
  if (!record || record.sourceId !== null) return fail('Only one-time transactions can be deleted.');
  return ok({ ...data, records: data.records.filter((r) => r.id !== id) });
}

// ---------------------------------------------------------------------------
// Occurrence outcomes
// ---------------------------------------------------------------------------

/** Applies `fn` to the occurrence's record, materializing generated occurrences first. */
function withOccurrence(
  data: AppData,
  id: string,
  clock: Clock,
  fn: (r: OccurrenceRecord) => OccurrenceRecord | string,
): Result {
  const occ = findOccurrence(data, id, clock.today);
  if (!occ) return fail('That transaction could not be found.');
  const { displayStatus: _ds, virtual, ...record } = occ;
  void _ds;
  const next = fn(record);
  if (typeof next === 'string') return fail(next);
  const updated = { ...next, updatedAt: clock.now };
  return ok({
    ...data,
    records: virtual ? [...data.records, { ...updated, createdAt: clock.now }] : data.records.map((r) => (r.id === id ? updated : r)),
  });
}

export interface ActualInput {
  amountCents: Cents;
  date: DateStr;
}

function validateActual(actual: ActualInput, clock: Clock): string | null {
  return (
    validateAmount(actual.amountCents, 'Actual amount') ??
    (!isValidDateStr(actual.date) ? 'Enter a valid date.' : null) ??
    (actual.date > clock.today ? 'The actual date cannot be in the future. Record it once it has happened.' : null)
  );
}

/** Marks an outstanding occurrence received/paid. Rejects repeat completions. */
export function recordActual(data: AppData, id: string, actual: ActualInput, clock: Clock): Result {
  const err = validateActual(actual, clock);
  if (err) return fail(err);
  return withOccurrence(data, id, clock, (r) => {
    if (r.status === 'completed') return 'This transaction has already been recorded.';
    if (r.status === 'canceled') return 'This transaction was canceled. Restore it before recording what happened.';
    // A recurring occurrence keeps the account its item has now, so moving the item later never moves recorded money.
    const account = r.sourceId === null ? undefined : data.sources.find((s) => s.id === r.sourceId)?.accountId;
    return { ...r, status: 'completed', actualAmountCents: actual.amountCents, actualDate: actual.date, completedAt: clock.now, ...(account ? { accountId: account } : {}) };
  });
}

/** Fixes the recorded actual amount/date of a completed occurrence. */
export function correctActual(data: AppData, id: string, actual: ActualInput, clock: Clock): Result {
  const err = validateActual(actual, clock);
  if (err) return fail(err);
  return withOccurrence(data, id, clock, (r) =>
    r.status !== 'completed' ? 'Only recorded transactions can be corrected.' : { ...r, actualAmountCents: actual.amountCents, actualDate: actual.date },
  );
}

/** Updates the latest expectation of an outstanding occurrence. The original prediction is kept. */
export function rescheduleOccurrence(data: AppData, id: string, change: { date: DateStr; amountCents: Cents }, clock: Clock): Result {
  const err = validateAmount(change.amountCents) ?? (!isValidDateStr(change.date) ? 'Enter a valid date.' : null);
  if (err) return fail(err);
  return withOccurrence(data, id, clock, (r) => {
    if (r.status !== 'scheduled') return 'Only outstanding transactions can be changed.';
    if (change.date !== r.scheduledDate && change.date < clock.today) return 'Choose today or a later date.';
    return { ...r, scheduledDate: change.date, scheduledAmountCents: change.amountCents };
  });
}

/** Cancels an outstanding occurrence: it stays on record but is never counted. */
export function cancelOccurrence(data: AppData, id: string, note: string, clock: Clock): Result {
  return withOccurrence(data, id, clock, (r) => {
    if (r.status === 'canceled') return 'This transaction is already canceled.';
    if (r.status === 'completed') return 'This transaction was already recorded. Undo the recorded outcome first.';
    return { ...r, status: 'canceled', canceledAt: clock.now, cancelNote: note.trim() || null };
  });
}

/**
 * Undoes a completion or cancellation, returning the occurrence to outstanding.
 * A recurring occurrence that was never rescheduled goes back to following its
 * schedule, exactly as before it was recorded or canceled: its record is
 * removed, so later amount or schedule changes apply to it again. A
 * rescheduled one keeps its new date and amount.
 */
export function restoreOccurrence(data: AppData, id: string, clock: Clock): Result {
  const result = withOccurrence(data, id, clock, (r) => {
    if (r.status === 'scheduled') return 'This transaction is already outstanding.';
    // Outstanding again, a recurring occurrence follows its item's account.
    const { accountId: _recorded, ...rest } = r;
    const base = r.sourceId === null ? r : rest;
    return { ...base, status: 'scheduled', actualAmountCents: null, actualDate: null, completedAt: null, canceledAt: null, cancelNote: null };
  });
  if (!result.ok) return result;
  const r = result.data.records.find((x) => x.id === id)!;
  const unchanged = r.sourceId !== null && r.scheduledDate === r.expectedDate && r.scheduledAmountCents === r.expectedAmountCents;
  return unchanged ? ok({ ...result.data, records: result.data.records.filter((x) => x.id !== id) }) : result;
}

// ---------------------------------------------------------------------------
// Batches: several selected occurrences changed, and undone, as one step
// ---------------------------------------------------------------------------

/** Applies `fn` to each selected occurrence in turn; all succeed or nothing changes. */
function forEachSelected(data: AppData, ids: string[], today: DateStr, fn: (d: AppData, id: string) => Result): Result {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return fail('Select at least one transaction.');
  let next = data;
  for (const id of unique) {
    const r = fn(next, id);
    if (!r.ok) {
      const name = findOccurrence(next, id, today)?.description;
      return fail(name ? `${name}: ${r.error}` : r.error);
    }
    next = r.data;
  }
  return ok(next);
}

/**
 * Marks each selected outstanding occurrence done exactly as expected: its
 * scheduled amount, on its scheduled date (or today, if that is still ahead).
 * Only the selected occurrences change. To record a different amount or date,
 * use `recordActual` on that one.
 */
export function recordAsExpected(data: AppData, ids: string[], clock: Clock): Result {
  return forEachSelected(data, ids, clock.today, (d, id) => {
    const o = findOccurrence(d, id, clock.today);
    if (!o) return fail('That transaction could not be found.');
    return recordActual(d, id, { amountCents: o.scheduledAmountCents, date: defaultActualDate(o.scheduledDate, clock.today) }, clock);
  });
}

/** Moves each selected outstanding occurrence to `date`, keeping its amount. */
export function rescheduleSelected(data: AppData, ids: string[], date: DateStr, clock: Clock): Result {
  return forEachSelected(data, ids, clock.today, (d, id) => {
    const o = findOccurrence(d, id, clock.today);
    if (!o) return fail('That transaction could not be found.');
    return rescheduleOccurrence(d, id, { date, amountCents: o.scheduledAmountCents }, clock);
  });
}

/** Compares two records field by field, regardless of key order. */
function sameRecord(a: OccurrenceRecord | undefined, b: OccurrenceRecord | undefined): boolean {
  if (!a || !b) return a === b;
  const keys = Object.keys(a).sort();
  return JSON.stringify(a, keys) === JSON.stringify(b, Object.keys(b).sort());
}

/**
 * Undoes a batch: puts the records of the given occurrences back exactly as
 * they were in `before` (removing any that didn't exist then). Every other
 * record and every source stays as it is now. Refused, with nothing changed,
 * if any of those records differs from how the batch left it (`after`), so a
 * later correction is never silently overwritten.
 */
export function undoBatch(data: AppData, before: AppData, after: AppData, ids: string[]): Result {
  const selected = new Set(ids);
  const find = (d: AppData, id: string) => d.records.find((r) => r.id === id);
  if ([...selected].some((id) => !sameRecord(find(data, id), find(after, id)))) {
    return fail('Some of these items have changed since, so they can’t be undone together. Open each one to change it.');
  }
  const previous = before.records.filter((r) => selected.has(r.id));
  const kept = data.records.filter((r) => !selected.has(r.id));
  return ok({ ...data, records: [...kept, ...previous] });
}

// ---------------------------------------------------------------------------
// Accounts: where money is received, held and spent (see `AccountType`).
// Optional everywhere: items work without one, and the forecast never reads
// them. Creating, renaming, assigning or deleting an account changes no
// amount or date.
// ---------------------------------------------------------------------------

/**
 * Bounds on what one stored plan holds, not on how the person organizes
 * money: they keep the saved document (and a Firestore document's 1 MB limit)
 * and the account list on a phone screen in reasonable size.
 */
export const MAX_ACCOUNTS = 50;
export const MAX_ACCOUNT_NAME = 60;
/** Largest opening balance, either way: the same bound as any amount. */
export const MAX_BALANCE_CENTS = 100_000_000_00;

export interface AccountInput {
  name: string;
  type: AccountType;
}

function validateAccountName(data: AppData, name: string, exceptId?: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name for the account.';
  if (trimmed.length > MAX_ACCOUNT_NAME) return `Keep the name under ${MAX_ACCOUNT_NAME} characters.`;
  const lower = trimmed.toLowerCase();
  if ((data.accounts ?? []).some((a) => a.id !== exceptId && a.name.toLowerCase() === lower)) return 'You already have an account with that name.';
  return null;
}

export function addAccount(data: AppData, input: AccountInput, clock: Clock, id = newId('acct')): Result {
  if (!ACCOUNT_TYPES.includes(input.type)) return fail('Choose income, distribution or payment.');
  const err = validateAccountName(data, input.name);
  if (err) return fail(err);
  const accounts = data.accounts ?? [];
  if (accounts.length >= MAX_ACCOUNTS) return fail(`You can have up to ${MAX_ACCOUNTS} accounts.`);
  if (accounts.some((a) => a.id === id)) return fail('That account already exists.');
  const account: Account = { id, name: input.name.trim(), type: input.type, createdAt: clock.now, updatedAt: clock.now };
  return ok({ ...data, accounts: [...accounts, account] });
}

/** A new name; the id, type and every assignment stay as they are. */
export function renameAccount(data: AppData, id: string, name: string, clock: Clock): Result {
  const accounts = data.accounts ?? [];
  if (!accounts.some((a) => a.id === id)) return fail('That account no longer exists.');
  const err = validateAccountName(data, name, id);
  if (err) return fail(err);
  return ok({ ...data, accounts: accounts.map((a) => (a.id === id ? { ...a, name: name.trim(), updatedAt: clock.now } : a)) });
}

const WRONG_ACCOUNT_TYPE: Record<AccountType, string> = {
  income: 'Income goes to an income account.',
  distribution: 'Strategic reserves are held in a distribution account.',
  payment: 'Payments come from a payment account.',
};

/**
 * Assigns a recurring item, or a one-time item, to an account, or clears it
 * (`accountId` null). The account's type must suit the item's kind
 * (`accountTypeFor`). Only that item changes; amounts, dates, history and the
 * forecast don't.
 */
export function assignAccount(data: AppData, itemId: string, accountId: string | null, clock: Clock): Result {
  const source = data.sources.find((s) => s.id === itemId);
  const record = source ? undefined : data.records.find((r) => r.id === itemId && r.sourceId === null);
  const item = source ?? record;
  if (!item) return fail('That item no longer exists.');
  if (accountId !== null) {
    const account = (data.accounts ?? []).find((a) => a.id === accountId);
    if (!account) return fail('That account no longer exists.');
    if (account.type !== accountTypeFor(item.kind)) return fail(WRONG_ACCOUNT_TYPE[accountTypeFor(item.kind)]);
  }
  if ((item.accountId ?? null) === accountId) return ok(data);
  const assign = <T extends { accountId?: string; updatedAt: string }>(x: T): T => {
    const { accountId: _old, ...rest } = x;
    return { ...(rest as T), ...(accountId !== null ? { accountId } : {}), updatedAt: clock.now };
  };
  return source
    ? ok({ ...data, sources: data.sources.map((s) => (s.id === itemId ? assign(s) : s)) })
    : ok({ ...data, records: data.records.map((r) => (r.id === itemId ? assign(r) : r)) });
}

/** How many items (recurring and one-time) are assigned to the account. */
export function assignedCount(data: AppData, accountId: string): number {
  return data.sources.filter((s) => s.accountId === accountId).length + data.records.filter((r) => r.accountId === accountId).length;
}

/**
 * Deletes an account. Items assigned to it are kept and become unassigned
 * (the interface asks first). An account that any transfer moves money to or
 * from is kept, so recorded history never loses one side: delete or change
 * those transfers first.
 */
export function deleteAccount(data: AppData, id: string, clock: Clock): Result {
  const accounts = data.accounts ?? [];
  if (!accounts.some((a) => a.id === id)) return fail('That account no longer exists.');
  const used = (data.transfers ?? []).filter((t) => t.fromAccountId === id || t.toAccountId === id).length;
  if (used > 0) return fail(`This account has ${used === 1 ? 'a transfer' : `${used} transfers`}. Delete or change ${used === 1 ? 'it' : 'them'} first.`);
  const unassign = <T extends { accountId?: string; updatedAt: string }>(x: T): T => {
    if (x.accountId !== id) return x;
    const { accountId: _old, ...rest } = x;
    return { ...(rest as T), updatedAt: clock.now };
  };
  const rest = accounts.filter((a) => a.id !== id);
  const { accounts: _a, ...withoutList } = data;
  return ok({ ...(rest.length ? { ...withoutList, accounts: rest } : withoutList), sources: data.sources.map(unassign), records: data.records.map(unassign) });
}

/**
 * Sets what the account held at the end of `date` (today or earlier), or
 * clears it (null). Balances are then known from that day on.
 */
export function setOpeningBalance(data: AppData, id: string, opening: { amountCents: Cents; date: DateStr } | null, clock: Clock): Result {
  const accounts = data.accounts ?? [];
  if (!accounts.some((a) => a.id === id)) return fail('That account no longer exists.');
  if (opening) {
    if (!Number.isSafeInteger(opening.amountCents) || Math.abs(opening.amountCents) > MAX_BALANCE_CENTS) return fail('Enter a balance.');
    if (!isValidDateStr(opening.date)) return fail('Enter a valid date.');
    if (opening.date > clock.today) return fail('Enter a balance for today or an earlier day.');
  }
  return ok({
    ...data,
    accounts: accounts.map((a) => {
      if (a.id !== id) return a;
      const { opening: _old, ...rest } = a;
      return { ...rest, ...(opening ? { opening: { amountCents: opening.amountCents, date: opening.date } } : {}), updatedAt: clock.now };
    }),
  });
}

// ---------------------------------------------------------------------------
// Transfers: money moved between the person's own accounts (see `Transfer`).
// Never income or spending; each one changes exactly two balances by the same
// amount, in one step. Any direction between two different accounts is
// allowed, so corrections and rebalancing need no special case.
// ---------------------------------------------------------------------------

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountCents: Cents;
  date: DateStr;
}

function validateTransfer(data: AppData, input: TransferInput, status: Transfer['status'], clock: Clock): string | null {
  const accounts = data.accounts ?? [];
  if (!accounts.some((a) => a.id === input.fromAccountId)) return 'Choose the account the money comes from.';
  if (!accounts.some((a) => a.id === input.toAccountId)) return 'Choose the account the money goes to.';
  if (input.fromAccountId === input.toAccountId) return 'Choose two different accounts.';
  return (
    validateAmount(input.amountCents) ??
    (!isValidDateStr(input.date) ? 'Enter a valid date.' : null) ??
    (status === 'recorded' && input.date > clock.today ? 'A transfer can be recorded once it has happened. Plan it as expected instead.' : null)
  );
}

/** Adds a transfer: `expected` (a plan) or `recorded` (it happened, today or earlier). */
export function addTransfer(data: AppData, input: TransferInput, status: Transfer['status'], clock: Clock, id = newId('xfer')): Result {
  const err = validateTransfer(data, input, status, clock);
  if (err) return fail(err);
  const transfers = data.transfers ?? [];
  if (transfers.some((t) => t.id === id)) return fail('That transfer already exists.');
  const transfer: Transfer = {
    id,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amountCents: input.amountCents,
    date: input.date,
    status,
    recordedAt: status === 'recorded' ? clock.now : null,
    createdAt: clock.now,
    updatedAt: clock.now,
  };
  return ok({ ...data, transfers: [...transfers, transfer] });
}

/** Records that an expected transfer happened, with the amount and date it actually had. */
export function recordTransfer(data: AppData, id: string, actual: { amountCents: Cents; date: DateStr }, clock: Clock): Result {
  const t = (data.transfers ?? []).find((x) => x.id === id);
  if (!t) return fail('That transfer no longer exists.');
  if (t.status === 'recorded') return fail('This transfer has already been recorded.');
  return updateTransfer(data, id, { ...t, ...actual }, clock, 'recorded');
}

/**
 * Changes a transfer's accounts, amount or date: a change of plan for an
 * expected one, or a correction for a recorded one (which stays recorded).
 */
export function updateTransfer(data: AppData, id: string, input: TransferInput, clock: Clock, status?: Transfer['status']): Result {
  const transfers = data.transfers ?? [];
  const t = transfers.find((x) => x.id === id);
  if (!t) return fail('That transfer no longer exists.');
  const next = status ?? t.status;
  const err = validateTransfer(data, input, next, clock);
  if (err) return fail(err);
  const updated: Transfer = {
    ...t,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amountCents: input.amountCents,
    date: input.date,
    status: next,
    recordedAt: next === 'recorded' ? (t.recordedAt ?? clock.now) : null,
    updatedAt: clock.now,
  };
  return ok({ ...data, transfers: transfers.map((x) => (x.id === id ? updated : x)) });
}

/** Removes a transfer entered by mistake, expected or recorded. Both balances lose it together. */
export function deleteTransfer(data: AppData, id: string): Result {
  const transfers = data.transfers ?? [];
  if (!transfers.some((t) => t.id === id)) return fail('That transfer no longer exists.');
  const rest = transfers.filter((t) => t.id !== id);
  const { transfers: _t, ...withoutList } = data;
  return ok(rest.length ? { ...withoutList, transfers: rest } : withoutList);
}

// ---------------------------------------------------------------------------
// Review rhythm
// ---------------------------------------------------------------------------

/**
 * Chooses how often to review. A different rhythm (or turning reviews off)
 * starts fresh: its own current period is due right away. Choosing the
 * rhythm already in use changes nothing.
 */
export function setReviewCadence(data: AppData, cadence: ReviewCadence): Result {
  if (!REVIEW_CADENCES.includes(cadence)) return fail('Choose how often to review.');
  const current = data.review ?? DEFAULT_REVIEW;
  if (current.cadence === cadence) return ok(data);
  return ok({ ...data, review: { cadence, handledOn: null, outcome: null } });
}

function handleReview(data: AppData, outcome: 'completed' | 'skipped', clock: Clock): Result {
  if (!reviewStatus(data, clock.today).due) return fail('There’s no review due right now.');
  return ok({ ...data, review: { ...(data.review ?? DEFAULT_REVIEW), handledOn: clock.today, outcome } });
}

/** Marks the current review done until the next period. Changes nothing else. */
export function completeReview(data: AppData, clock: Clock): Result {
  return handleReview(data, 'completed', clock);
}

/** Skips the current review; the next period's review is due as usual. Changes nothing else. */
export function skipReview(data: AppData, clock: Clock): Result {
  return handleReview(data, 'skipped', clock);
}

/**
 * Starting over: every recurring item, one-time item and recorded outcome is
 * removed and setup starts again. The review rhythm (a preference, not
 * financial data) and the revision (so the save is accepted) are kept. The
 * interface offers a backup first; this never runs without the person's
 * explicit confirmation.
 */
export function startOver(data: AppData): Result {
  return ok({ ...emptyData(), revision: data.revision, ...(data.review ? { review: data.review } : {}) });
}

export function completeOnboarding(data: AppData): Result {
  return ok({ ...data, onboardingComplete: true });
}

/** Default date for "record actual": the expected date, unless that is in the future. */
export function defaultActualDate(scheduledDate: DateStr, today: DateStr): DateStr {
  return scheduledDate > today ? today : scheduledDate;
}

