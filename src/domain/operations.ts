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
 *  - Only income can be possible, and certainty changes no amount, date or
 *    recorded outcome (see `IncomeCertainty`).
 *  - A freelance job's money is one one-time income record; finishing the work
 *    never counts as money received (see `FreelanceJob`).
 *  - A shift never changes cash flow by itself: its cash tips are one received
 *    income record, and its wages and card tips are paid by a recorded
 *    paycheck, counted once as that paycheck (see `WorkEntry`).
 */
import { addDays, formatShort, isValidDateStr, type DateStr } from './dates';
import type { Cents } from './money';
import { findOccurrence, resolveOccurrences } from './occurrences';
import { validateRule } from './recurrence';
import { ACCOUNT_TYPES, INCOME_TYPES, LIABILITY_TYPES, ONE_TIME_KINDS, RECURRING_KINDS, accountTypeFor, type Account, type AccountType, type AppData, type IncomeCertainty, type IncomeType, type LiabilityType, type OccurrenceRecord, type OneTimeKind, type RecurrenceRule, type RecurringKind, type RecurringSource, type Transfer, type TransactionKind, type WorkEntry, workKindFor, canHavePaid, type Client, type FreelanceJob, type JobStatus, certaintyOf } from './types';

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
  /** Income only; see `IncomeCertainty`. Omitted keeps what the item has (expected for a new one). */
  certainty?: IncomeCertainty;
  /** Income only; see `IncomeType`. Omitted keeps what the item has; null makes it a fixed income. */
  incomeType?: IncomeType | null;
  /** Hourly and tipped income only. Omitted keeps what the item has; null clears it. */
  hourlyWageCents?: Cents | null;
}

type IncomeDetails = Pick<SourceInput, 'incomeType' | 'hourlyWageCents'>;

function validateIncomeDetails(kind: TransactionKind, details: IncomeDetails): string | null {
  if (details.incomeType === undefined && details.hourlyWageCents === undefined) return null;
  if (kind !== 'income' && (details.incomeType || details.hourlyWageCents)) return 'Only income can be hourly, tipped or gig.';
  if (details.incomeType && !INCOME_TYPES.includes(details.incomeType)) return 'Choose fixed, hourly, tipped or gig.';
  if (details.hourlyWageCents !== undefined && details.hourlyWageCents !== null) return validateAmount(details.hourlyWageCents, 'Hourly wage');
  return null;
}

/** `item` with income details applied; omitted ones are kept. Only hourly and tipped income keep a wage. */
function applyIncomeDetails(item: RecurringSource, details: IncomeDetails): RecurringSource {
  if (details.incomeType === undefined && details.hourlyWageCents === undefined) return item;
  const { incomeType: oldType, hourlyWageCents: oldWage, ...rest } = item;
  const type = details.incomeType === undefined ? oldType : (details.incomeType ?? undefined);
  const wage = details.hourlyWageCents === undefined ? oldWage : (details.hourlyWageCents ?? undefined);
  if (item.kind !== 'income' || !type) return rest;
  return { ...rest, incomeType: type, ...(wage && type !== 'gig' ? { hourlyWageCents: wage } : {}) };
}

/** The stored form of a certainty choice: only possible income carries the field. */
function certaintyField(kind: TransactionKind, certainty: IncomeCertainty | undefined): { certainty?: 'possible' } {
  return kind === 'income' && certainty === 'possible' ? { certainty: 'possible' } : {};
}

/** `item` with `certainty` applied, or unchanged when it is omitted. */
function applyCertainty<T extends { kind: TransactionKind; certainty?: 'possible' }>(item: T, certainty: IncomeCertainty | undefined): T {
  if (certainty === undefined) return item;
  const { certainty: _old, ...rest } = item;
  void _old;
  return { ...(rest as T), ...certaintyField(item.kind, certainty) };
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
    validateIncomeDetails(input.kind, input) ??
    validateAmount(input.amountCents) ??
    (!isValidDateStr(input.startDate) ? 'Enter a valid date.' : null) ??
    (input.startDate < clock.today ? 'The next expected date must be today or later.' : null) ??
    validateRule(input.rule, input.startDate);
  if (err) return fail(err);
  const created: RecurringSource = {
    id,
    kind: input.kind,
    description: input.description.trim(),
    tags: normalizeTags(input.tags),
    ...(input.kind === 'liability' ? { liabilityType: input.liabilityType } : {}),
    ...certaintyField(input.kind, input.certainty),
    versions: [{ id: newId('ver'), startDate: input.startDate, amountCents: input.amountCents, rule: input.rule }],
    active: true,
    endDate: null,
    pausedRanges: [],
    createdAt: clock.now,
    updatedAt: clock.now,
  };
  const source = applyIncomeDetails(created, input);
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
    (change.startDate < clock.today ? 'Choose today or a later date.' : null) ??
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
    validateIncomeDetails(kind, input) ??
    loggedWorkKeepsType(data, id, input.incomeType) ??
    validateAmount(input.amountCents) ??
    (!isValidDateStr(input.startDate) ? 'Enter a valid date.' : null) ??
    (input.startDate < clock.today ? 'The next expected date must be today or later.' : null) ??
    validateRule(input.rule, input.startDate);
  if (err) return fail(err);
  return withSource(data, id, (s) => ({
    ...applyIncomeDetails(applyCertainty(s, input.certainty), input),
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
  if ((data.workEntries ?? []).some((e) => e.sourceId === id)) return fail('This item has logged shifts. Turn it off instead so they are kept.');
  return ok({ ...data, sources: data.sources.filter((s) => s.id !== id) });
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
  /** Income only; see `IncomeCertainty`. Expected when omitted. */
  certainty?: IncomeCertainty;
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
    ...certaintyField(input.kind, input.certainty),
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

/** The note on a possible payment whose date passed unrecorded, skipped when its item became expected. */
export const POSSIBLE_NOT_RECEIVED_NOTE = 'Possible income, not received';

/**
 * Marks income expected or possible: a recurring income item (every
 * occurrence not yet received follows it) or a one-time income not yet
 * received. Amounts, dates and recorded outcomes don't change, and recorded
 * income keeps counting whatever its item's certainty.
 *
 * A possible recurring item marked expected counts from today. Its earlier
 * dates that were never recorded were never dependable, so they are skipped
 * (with `POSSIBLE_NOT_RECEIVED_NOTE`) instead of becoming overdue income that
 * the running total would wait for. Each can be restored and recorded if that
 * money did arrive.
 */
export function setIncomeCertainty(data: AppData, id: string, certainty: IncomeCertainty, clock: Clock): Result {
  if (certainty !== 'expected' && certainty !== 'possible') return fail('Choose expected or possible.');
  const source = data.sources.find((s) => s.id === id);
  if (source) {
    if (source.kind !== 'income') return fail('Only income can be possible.');
    const marked = withSource(data, id, (s) => ({ ...applyCertainty(s, certainty), updatedAt: clock.now }));
    if (!marked.ok || certainty !== 'expected' || source.certainty !== 'possible') return marked;
    const first = source.versions.reduce((d, v) => (v.startDate < d ? v.startDate : d), clock.today);
    const unrecorded = resolveOccurrences(data, first, addDays(clock.today, -1), clock.today).filter((o) => o.sourceId === id && o.status === 'scheduled' && o.scheduledDate < clock.today);
    let next = marked.data;
    for (const o of unrecorded) {
      const step = cancelOccurrence(next, o.id, POSSIBLE_NOT_RECEIVED_NOTE, clock);
      if (!step.ok) return step;
      next = step.data;
    }
    return ok(next);
  }
  const record = data.records.find((r) => r.id === id && r.sourceId === null);
  if (!record) return fail('That item no longer exists.');
  if (record.kind !== 'income') return fail('Only income can be possible.');
  if (record.status !== 'scheduled') return fail('This income is already recorded.');
  return ok({ ...data, records: data.records.map((r) => (r.id === id ? { ...applyCertainty(r, certainty), updatedAt: clock.now } : r)) });
}

export function deleteOneTime(data: AppData, id: string): Result {
  const record = data.records.find((r) => r.id === id);
  if (!record || record.sourceId !== null) return fail('Only one-time items can be deleted.');
  const shift = shiftWithTips(data, id);
  if (shift) return fail(shiftOwnsTips(shift));
  const job = (data.jobs ?? []).find((j) => j.paymentRecordId === id);
  if (job) return fail(`This is the payment for ${job.description}. Change or delete the job instead.`);
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
  if (!occ) return fail('That item could not be found.');
  const shift = shiftWithTips(data, id);
  if (shift) return fail(shiftOwnsTips(shift));
  const { displayStatus: _ds, virtual, certainty: _c, ...rest } = occ;
  void _ds;
  void _c;
  // A recurring occurrence's certainty is its item's, never stored on the record.
  const record: OccurrenceRecord = occ.sourceId === null ? { ...rest, ...certaintyField(occ.kind, occ.certainty) } : rest;
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
  const result = withOccurrence(data, id, clock, (r) => {
    if (r.status === 'completed') return 'This item has already been recorded.';
    if (r.status === 'canceled') return 'This was skipped. Undo the skip first.';
    // A recurring occurrence keeps the account its item has now, so moving the item later never moves recorded money.
    const account = r.sourceId === null ? undefined : data.sources.find((s) => s.id === r.sourceId)?.accountId;
    return { ...r, status: 'completed', actualAmountCents: actual.amountCents, actualDate: actual.date, completedAt: clock.now, ...(account ? { accountId: account } : {}) };
  });
  return result.ok ? ok(linkShiftsToPaycheck(result.data, id, clock)) : result;
}

/** Fixes the recorded actual amount/date of a completed occurrence. */
export function correctActual(data: AppData, id: string, actual: ActualInput, clock: Clock): Result {
  const err = validateActual(actual, clock);
  if (err) return fail(err);
  const result = withOccurrence(data, id, clock, (r) =>
    r.status !== 'completed' ? 'Only recorded items can be corrected.' : { ...r, actualAmountCents: actual.amountCents, actualDate: actual.date },
  );
  // Moved earlier, a paycheck or payout no longer pays work done after it arrived.
  return result.ok ? ok(unlinkShifts(result.data, id, clock, (e, paycheck) => !canHavePaid(paycheck, e))) : result;
}

/** Updates the latest expectation of an outstanding occurrence. The original prediction is kept. */
export function rescheduleOccurrence(data: AppData, id: string, change: { date: DateStr; amountCents: Cents }, clock: Clock): Result {
  const err = validateAmount(change.amountCents) ?? (!isValidDateStr(change.date) ? 'Enter a valid date.' : null);
  if (err) return fail(err);
  return withOccurrence(data, id, clock, (r) => {
    if (r.status !== 'scheduled') return 'Only expected items can be changed.';
    if (change.date !== r.scheduledDate && change.date < clock.today) return 'Choose today or a later date.';
    return { ...r, scheduledDate: change.date, scheduledAmountCents: change.amountCents };
  });
}

/** Cancels an outstanding occurrence: it stays on record but is never counted. */
export function cancelOccurrence(data: AppData, id: string, note: string, clock: Clock): Result {
  return withOccurrence(data, id, clock, (r) => {
    if (r.status === 'canceled') return 'This is already skipped.';
    if (r.status === 'completed') return 'This item was already recorded. Undo the recorded outcome first.';
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
    if (r.status === 'scheduled') return 'This item is already expected.';
    // Outstanding again, a recurring occurrence follows its item's account.
    const { accountId: _recorded, ...rest } = r;
    const base = r.sourceId === null ? r : rest;
    return { ...base, status: 'scheduled', actualAmountCents: null, actualDate: null, completedAt: null, canceledAt: null, cancelNote: null };
  });
  if (!result.ok) return result;
  // A paycheck no longer recorded has paid no shift.
  const restored = unlinkShifts(result.data, id, clock);
  const r = restored.records.find((x) => x.id === id)!;
  const unchanged = r.sourceId !== null && r.scheduledDate === r.expectedDate && r.scheduledAmountCents === r.expectedAmountCents;
  return ok(unchanged ? { ...restored, records: restored.records.filter((x) => x.id !== id) } : restored);
}

// ---------------------------------------------------------------------------
// Batches: several selected occurrences that are due, changed as one step
// ---------------------------------------------------------------------------

/** Applies `fn` to each selected occurrence in turn; all succeed or nothing changes. */
function forEachSelected(data: AppData, ids: string[], today: DateStr, fn: (d: AppData, id: string) => Result): Result {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return fail('Select at least one item.');
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

/** Batches take only items that are due: dated today or earlier. An early payment is recorded one at a time. */
const NOT_DUE = "This isn't due yet. Open it to record it early.";

/**
 * Marks each selected outstanding occurrence done exactly as expected: its
 * scheduled amount, on its scheduled date. Only items due today or earlier
 * are accepted; one dated later is refused and nothing changes (record an
 * early payment with `recordActual`). Only the selected occurrences change.
 * To record a different amount or date, use `recordActual` on that one.
 */
export function recordAsExpected(data: AppData, ids: string[], clock: Clock): Result {
  return forEachSelected(data, ids, clock.today, (d, id) => {
    const o = findOccurrence(d, id, clock.today);
    if (!o) return fail('That item could not be found.');
    if (o.status === 'scheduled' && o.scheduledDate > clock.today) return fail(NOT_DUE);
    return recordActual(d, id, { amountCents: o.scheduledAmountCents, date: defaultActualDate(o.scheduledDate, clock.today) }, clock);
  });
}

/** Moves each selected outstanding occurrence that is due (today or earlier) to `date`, keeping its amount. */
export function rescheduleSelected(data: AppData, ids: string[], date: DateStr, clock: Clock): Result {
  return forEachSelected(data, ids, clock.today, (d, id) => {
    const o = findOccurrence(d, id, clock.today);
    if (!o) return fail('That item could not be found.');
    if (o.status === 'scheduled' && o.scheduledDate > clock.today) return fail(NOT_DUE);
    return rescheduleOccurrence(d, id, { date, amountCents: o.scheduledAmountCents }, clock);
  });
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

/**
 * Starting over: every recurring item, one-time item and recorded outcome is
 * removed and setup starts again. The revision (so the save is accepted) is
 * kept. The
 * interface offers a backup first; this never runs without the person's
 * explicit confirmation.
 */
export function startOver(data: AppData): Result {
  return ok({ ...emptyData(), revision: data.revision });
}

export function completeOnboarding(data: AppData): Result {
  return ok({ ...data, onboardingComplete: true });
}

/** Default date for "record actual": the expected date, unless that is in the future. */
export function defaultActualDate(scheduledDate: DateStr, today: DateStr): DateStr {
  return scheduledDate > today ? today : scheduledDate;
}


// ---------------------------------------------------------------------------
// Hourly and tipped income: shifts (E2; see `WorkEntry`)
// ---------------------------------------------------------------------------

export const MAX_SHIFTS = 5000;
const MAX_SHIFT_MINUTES = 24 * 60;

/**
 * Makes an income fixed, hourly, tipped or gig, with its usual hourly wage
 * (hourly and tipped only). Changes nothing financial. An income with logged
 * work keeps a type that logs the same kind (shifts or sessions), so its work
 * is never orphaned.
 */
export function setIncomeDetails(data: AppData, id: string, details: { incomeType: IncomeType | null; hourlyWageCents: Cents | null }, clock: Clock): Result {
  return withSource(data, id, (s) => {
    const err = validateIncomeDetails(s.kind, details) ?? loggedWorkKeepsType(data, id, details.incomeType);
    if (err) return err;
    return { ...applyIncomeDetails(s, details), updatedAt: clock.now };
  });
}

/** An income with logged shifts stays hourly or tipped, and one with sessions stays gig: other types would orphan them. */
function loggedWorkKeepsType(data: AppData, id: string, incomeType: IncomeType | null | undefined): string | null {
  if (incomeType === undefined) return null;
  const logged = (data.workEntries ?? []).find((e) => e.sourceId === id);
  if (!logged || workKindFor(incomeType ?? undefined) === logged.kind) return null;
  return logged.kind === 'session' ? 'This income has logged sessions, so it stays gig income.' : 'This income has logged shifts, so it stays hourly or tipped.';
}

export interface ShiftInput {
  /** The hourly or tipped income item (a shift), or a gig income item (a session). */
  sourceId: string;
  date: DateStr;
  /** Each optional: null or 0 means none. */
  minutes?: number | null;
  /** Shifts only. */
  wageCents?: Cents | null;
  /** Shifts: cash tips. Sessions: cash received immediately. */
  cashTipsCents?: Cents | null;
  /** Shifts only. */
  cardTipsCents?: Cents | null;
  /** Sessions only: earnings on the platform, waiting for a payout. */
  earningsCents?: Cents | null;
  /** Sessions only: the platform's name. */
  platform?: string | null;
}

/** A gig session: the same as a shift's input, with platform earnings instead of wages and card tips. */
export type SessionInput = Omit<ShiftInput, 'wageCents' | 'cardTipsCents'>;

export const MAX_PLATFORM_NAME = 40;

/** The shift whose cash tips are this record, if any. */
function shiftWithTips(data: AppData, recordId: string): WorkEntry | undefined {
  return (data.workEntries ?? []).find((e) => e.cashTipsRecordId === recordId);
}

const shiftOwnsTips = (shift: WorkEntry) =>
  shift.kind === 'session'
    ? `This is the cash from your ${formatShort(shift.date)} session. Change or delete the session instead.`
    : `These are the cash tips from your ${formatShort(shift.date)} shift. Change or delete the shift instead.`;

const present = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? undefined : n);

function validateShift(data: AppData, input: ShiftInput, clock: Clock): string | null {
  const source = data.sources.find((s) => s.id === input.sourceId);
  if (!source) return 'That income no longer exists.';
  const kind = source.kind === 'income' ? workKindFor(source.incomeType) : null;
  if (!kind) return 'Shifts can be logged for hourly or tipped income, and sessions for gig income.';
  const session = kind === 'session';
  if (session && (present(input.wageCents) !== undefined || present(input.cardTipsCents) !== undefined)) return 'A gig session has earnings and cash, not a wage or card tips.';
  if (!session && (present(input.earningsCents) !== undefined || (input.platform ?? '').trim() !== '')) return 'A shift has a wage and tips, not platform earnings.';
  if (!isValidDateStr(input.date)) return 'Enter a valid date.';
  if (input.date > clock.today) return session ? 'Log a session once it has been worked.' : 'Log a shift once it has been worked.';
  if ((input.platform ?? '').trim().length > MAX_PLATFORM_NAME) return `Keep the platform under ${MAX_PLATFORM_NAME} characters.`;
  const minutes = present(input.minutes);
  if (minutes !== undefined && (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > MAX_SHIFT_MINUTES)) return 'Hours must be between 0 and 24.';
  for (const [value, label] of [
    [input.wageCents, 'Hourly wage'],
    [input.cashTipsCents, 'Cash tips'],
    [input.cardTipsCents, 'Card tips'],
    [input.earningsCents, 'Earnings'],
  ] as const) {
    const v = present(value);
    if (v !== undefined) {
      const amountErr = validateAmount(v, label);
      if (amountErr) return amountErr;
    }
  }
  if (session) {
    if (present(input.earningsCents) === undefined && present(input.cashTipsCents) === undefined) return 'Enter the earnings or the cash received.';
  } else if (minutes === undefined && present(input.cashTipsCents) === undefined && present(input.cardTipsCents) === undefined) return 'Enter the hours worked or the tips.';
  return null;
}

/** The received income record for a shift's cash tips: money in on the shift's date, counted once. */
function addCashTips(data: AppData, shiftSourceId: string, cents: Cents, date: DateStr, clock: Clock, platform?: string): { data: AppData; recordId: string } | string {
  const source = data.sources.find((s) => s.id === shiftSourceId)!;
  const recordId = newId('tips');
  const description = (source.incomeType === 'gig' ? `Cash · ${platform ?? source.description}` : `Cash tips · ${source.description}`).slice(0, 80);
  let step = addOneTime(data, { kind: 'income', description, amountCents: cents, date }, clock, recordId);
  if (step.ok) step = recordActual(step.data, recordId, { amountCents: cents, date }, clock);
  if (step.ok && source.accountId) step = assignAccount(step.data, recordId, source.accountId, clock);
  return step.ok ? { data: step.data, recordId } : step.error;
}

const withoutRecord = (data: AppData, id: string | undefined): AppData => (id ? { ...data, records: data.records.filter((r) => r.id !== id) } : data);

type WorkFields = Pick<WorkEntry, 'minutes' | 'wageCents' | 'cashTipsCents' | 'cardTipsCents' | 'earningsCents' | 'platform'>;

function shiftFields(input: ShiftInput): WorkFields {
  const out: WorkFields = {};
  const minutes = present(input.minutes);
  const wage = present(input.wageCents);
  const cash = present(input.cashTipsCents);
  const card = present(input.cardTipsCents);
  const earnings = present(input.earningsCents);
  const platform = (input.platform ?? '').trim();
  if (minutes !== undefined) out.minutes = minutes;
  if (wage !== undefined) out.wageCents = wage;
  if (cash !== undefined) out.cashTipsCents = cash;
  if (card !== undefined) out.cardTipsCents = card;
  if (earnings !== undefined) out.earningsCents = earnings;
  if (platform) out.platform = platform;
  return out;
}

const kindOf = (data: AppData, sourceId: string): WorkEntry['kind'] => workKindFor(data.sources.find((s) => s.id === sourceId)?.incomeType) ?? 'shift';

/**
 * Logs a shift for an hourly or tipped income, worked today or earlier. Its
 * cash tips become one received income record on the shift's date; its wages
 * and card tips are earned, not paid yet, until a paycheck covers them. The
 * income's expected paychecks don't change.
 */
export function logShift(data: AppData, input: ShiftInput, clock: Clock, id = newId('shift')): Result {
  const err = validateShift(data, input, clock);
  if (err) return fail(err);
  if ((data.workEntries ?? []).length >= MAX_SHIFTS) return fail(`You can log up to ${MAX_SHIFTS} shifts.`);
  const fields = shiftFields(input);
  let next = data;
  let cashTipsRecordId: string | undefined;
  if (fields.cashTipsCents) {
    const tips = addCashTips(next, input.sourceId, fields.cashTipsCents, input.date, clock, fields.platform);
    if (typeof tips === 'string') return fail(tips);
    next = tips.data;
    cashTipsRecordId = tips.recordId;
  }
  const shift: WorkEntry = { id, sourceId: input.sourceId, kind: kindOf(data, input.sourceId), date: input.date, ...fields, ...(cashTipsRecordId ? { cashTipsRecordId } : {}), createdAt: clock.now, updatedAt: clock.now };
  return ok({ ...next, workEntries: [...(next.workEntries ?? []), shift] });
}

/**
 * Corrects a shift. When its cash tips or date change, their income record is
 * replaced (a record's original amount and date never change), so the cash
 * flow follows the correction and still counts the tips once. Whether it was
 * paid is kept.
 */
export function editShift(data: AppData, id: string, input: Omit<ShiftInput, 'sourceId'>, clock: Clock): Result {
  const shift = (data.workEntries ?? []).find((e) => e.id === id);
  if (!shift) return fail('That shift no longer exists.');
  const full: ShiftInput = { ...input, sourceId: shift.sourceId };
  const err = validateShift(data, full, clock);
  if (err) return fail(err);
  const fields = shiftFields(full);
  let next = data;
  let cashTipsRecordId = shift.cashTipsRecordId;
  if (fields.cashTipsCents !== shift.cashTipsCents || input.date !== shift.date || fields.platform !== shift.platform) {
    next = withoutRecord(next, shift.cashTipsRecordId);
    cashTipsRecordId = undefined;
    if (fields.cashTipsCents) {
      const tips = addCashTips(next, shift.sourceId, fields.cashTipsCents, input.date, clock, fields.platform);
      if (typeof tips === 'string') return fail(tips);
      next = tips.data;
      cashTipsRecordId = tips.recordId;
    }
  }
  const updated: WorkEntry = {
    id,
    sourceId: shift.sourceId,
    kind: shift.kind,
    date: input.date,
    ...fields,
    ...(cashTipsRecordId ? { cashTipsRecordId } : {}),
    ...(stillPaid(next, shift, input.date) ? { paidByOccurrenceId: shift.paidByOccurrenceId } : {}),
    createdAt: shift.createdAt,
    updatedAt: clock.now,
  };
  return ok({ ...next, workEntries: (next.workEntries ?? []).map((e) => (e.id === id ? updated : e)) });
}

/**
 * Logs a gig session for a gig income, worked today or earlier. Its cash
 * received immediately becomes one received income record on that date; its
 * platform earnings wait for the payout that covers them (recording an
 * occurrence of the gig income, as for a paycheck). Expected payouts don't
 * change.
 */
export function logSession(data: AppData, input: SessionInput, clock: Clock, id = newId('session')): Result {
  return logShift(data, input, clock, id);
}

/** Corrects a session (see `editShift`): the cash record follows a changed amount, date or platform. */
export function editSession(data: AppData, id: string, input: Omit<SessionInput, 'sourceId'>, clock: Clock): Result {
  return editShift(data, id, input, clock);
}

/** Removes a shift or session and its cash record. A paycheck or payout that paid it is unchanged. */
export function deleteShift(data: AppData, id: string): Result {
  const shift = (data.workEntries ?? []).find((e) => e.id === id);
  if (!shift) return fail('That shift no longer exists.');
  const next = withoutRecord(data, shift.cashTipsRecordId);
  const workEntries = (next.workEntries ?? []).filter((e) => e.id !== id);
  const { workEntries: _w, ...rest } = next;
  void _w;
  return ok(workEntries.length ? { ...rest, workEntries } : rest);
}

/**
 * Says which recorded paycheck paid a shift's wages and card tips (`null`:
 * not paid yet). Only a recorded paycheck of the shift's own income can, so
 * nothing is ever counted twice: the paycheck's recorded amount is the money.
 */
export function setShiftPaid(data: AppData, id: string, occurrenceId: string | null, clock: Clock): Result {
  const shift = (data.workEntries ?? []).find((e) => e.id === id);
  if (!shift) return fail('That shift no longer exists.');
  if (occurrenceId !== null) {
    const paycheck = data.records.find((r) => r.id === occurrenceId);
    if (!paycheck || paycheck.sourceId !== shift.sourceId || paycheck.status !== 'completed') return fail('Choose a paycheck from this income that has been recorded.');
    if (!canHavePaid(paycheck, shift)) return fail('That paycheck arrived before this work was done, so it could not have paid it.');
  }
  const { paidByOccurrenceId: _p, ...rest } = shift;
  void _p;
  const updated: WorkEntry = { ...rest, ...(occurrenceId ? { paidByOccurrenceId: occurrenceId } : {}), updatedAt: clock.now };
  return ok({ ...data, workEntries: (data.workEntries ?? []).map((e) => (e.id === id ? updated : e)) });
}

/**
 * When a paycheck or payout is recorded, the shifts or sessions of its income
 * worked before the day it arrived and not yet paid are paid by it. Each can
 * be corrected with `setShiftPaid`.
 */
function linkShiftsToPaycheck(data: AppData, occurrenceId: string, clock: Clock): AppData {
  const paycheck = data.records.find((r) => r.id === occurrenceId);
  if (!paycheck || paycheck.sourceId === null || paycheck.kind !== 'income' || paycheck.actualDate === null || !data.workEntries?.length) return data;
  const paidOn = paycheck.actualDate;
  return {
    ...data,
    workEntries: data.workEntries.map((e) =>
      e.sourceId === paycheck.sourceId && e.paidByOccurrenceId === undefined && e.date < paidOn ? { ...e, paidByOccurrenceId: occurrenceId, updatedAt: clock.now } : e,
    ),
  };
}

/** Whether `shift`, moved to `date`, is still paid by the paycheck that paid it. */
function stillPaid(data: AppData, shift: WorkEntry, date: DateStr): boolean {
  const paycheck = shift.paidByOccurrenceId ? data.records.find((r) => r.id === shift.paidByOccurrenceId) : undefined;
  return paycheck !== undefined && canHavePaid(paycheck, { sourceId: shift.sourceId, date });
}

/** Unpays the shifts or sessions `occurrenceId` paid: all of them, or only those `when` picks. */
function unlinkShifts(data: AppData, occurrenceId: string, clock: Clock, when: (e: WorkEntry, paycheck: OccurrenceRecord) => boolean = () => true): AppData {
  const paycheck = data.records.find((r) => r.id === occurrenceId);
  const unpay = (e: WorkEntry) => e.paidByOccurrenceId === occurrenceId && (paycheck === undefined || when(e, paycheck));
  if (!data.workEntries?.some(unpay)) return data;
  return {
    ...data,
    workEntries: data.workEntries.map((e) => {
      if (!unpay(e)) return e;
      const { paidByOccurrenceId: _p, ...rest } = e;
      void _p;
      return { ...rest, updatedAt: clock.now };
    }),
  };
}

// ---------------------------------------------------------------------------
// Freelance clients and jobs (E3; see `FreelanceJob`)
// ---------------------------------------------------------------------------

export const MAX_CLIENTS = 200;
export const MAX_CLIENT_NAME = 60;
export const MAX_JOBS = 5000;
const JOB_STATUSES: JobStatus[] = ['planned', 'done'];

function validateClientName(data: AppData, name: string, exceptId?: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name.';
  if (trimmed.length > MAX_CLIENT_NAME) return `Keep the name under ${MAX_CLIENT_NAME} characters.`;
  if ((data.clients ?? []).some((c) => c.id !== exceptId && c.name.toLowerCase() === trimmed.toLowerCase())) return 'You already have a client with that name.';
  return null;
}

/** How a job's payment is labeled wherever money is shown: "Logo design · Acme". */
function jobLabel(data: AppData, description: string, clientId: string | undefined): string {
  const client = clientId ? (data.clients ?? []).find((c) => c.id === clientId) : undefined;
  return (client ? `${description.trim()} · ${client.name}` : description.trim()).slice(0, 80);
}

/** Keeps each job's payment label in step with its description and client (a label, never an amount or date). */
function relabelPayments(data: AppData, jobIds: Set<string>): AppData {
  const labels = new Map<string, string>();
  for (const j of data.jobs ?? []) if (jobIds.has(j.id) && j.paymentRecordId) labels.set(j.paymentRecordId, jobLabel(data, j.description, j.clientId));
  if (labels.size === 0) return data;
  return { ...data, records: data.records.map((r) => (labels.has(r.id) && r.description !== labels.get(r.id) ? { ...r, description: labels.get(r.id)! } : r)) };
}

export function addClient(data: AppData, name: string, clock: Clock, id = newId('client')): Result {
  const err = validateClientName(data, name);
  if (err) return fail(err);
  if ((data.clients ?? []).length >= MAX_CLIENTS) return fail(`You can have up to ${MAX_CLIENTS} clients.`);
  const client: Client = { id, name: name.trim(), createdAt: clock.now, updatedAt: clock.now };
  return ok({ ...data, clients: [...(data.clients ?? []), client] });
}

export function renameClient(data: AppData, id: string, name: string, clock: Clock): Result {
  if (!(data.clients ?? []).some((c) => c.id === id)) return fail('That client no longer exists.');
  const err = validateClientName(data, name, id);
  if (err) return fail(err);
  const next = { ...data, clients: data.clients!.map((c) => (c.id === id ? { ...c, name: name.trim(), updatedAt: clock.now } : c)) };
  return ok(relabelPayments(next, new Set((next.jobs ?? []).filter((j) => j.clientId === id).map((j) => j.id))));
}

/** Removes a client. Its jobs stay, without a client; nothing financial changes. */
export function deleteClient(data: AppData, id: string, clock: Clock): Result {
  if (!(data.clients ?? []).some((c) => c.id === id)) return fail('That client no longer exists.');
  const affected = new Set((data.jobs ?? []).filter((j) => j.clientId === id).map((j) => j.id));
  const clients = data.clients!.filter((c) => c.id !== id);
  const jobs = (data.jobs ?? []).map((j) => {
    if (j.clientId !== id) return j;
    const { clientId: _c, ...rest } = j;
    void _c;
    return { ...rest, updatedAt: clock.now };
  });
  const { clients: _old, ...rest } = data;
  void _old;
  const next: AppData = { ...rest, ...(clients.length ? { clients } : {}), ...(data.jobs ? { jobs } : {}) };
  return ok(relabelPayments(next, affected));
}

export interface JobInput {
  description: string;
  clientId?: string | null;
  amountCents: Cents;
  status: JobStatus;
  /** When payment is expected. Null: none (the job is pending and not counted). Omitted when editing: unchanged. */
  expectedDate?: DateStr | null;
  /** The payment's certainty while it has a date. Omitted: expected for a new job, unchanged when editing. */
  certainty?: IncomeCertainty;
}

function validateJob(data: AppData, input: JobInput): string | null {
  return (
    validateDescription(input.description) ??
    validateAmount(input.amountCents) ??
    (!JOB_STATUSES.includes(input.status) ? 'Choose planned or done.' : null) ??
    (input.clientId && !(data.clients ?? []).some((c) => c.id === input.clientId) ? 'That client no longer exists.' : null) ??
    (input.expectedDate && !isValidDateStr(input.expectedDate) ? 'Enter a valid date.' : null) ??
    (input.certainty !== undefined && input.certainty !== 'expected' && input.certainty !== 'possible' ? 'Choose expected or possible.' : null)
  );
}

/** A job's payment record, if it has one. */
export function jobPayment(data: AppData, job: FreelanceJob): OccurrenceRecord | undefined {
  return job.paymentRecordId ? data.records.find((r) => r.id === job.paymentRecordId) : undefined;
}

const withoutPayment = (data: AppData, id: string): AppData => ({ ...data, records: data.records.filter((r) => r.id !== id) });

/**
 * Adds a freelance job. With an expected payment date its payment is one
 * one-time income record on that date, expected or possible; without one the
 * job is pending and not counted.
 */
export function addJob(data: AppData, input: JobInput, clock: Clock, id = newId('job')): Result {
  const err = validateJob(data, input);
  if (err) return fail(err);
  if ((data.jobs ?? []).length >= MAX_JOBS) return fail(`You can have up to ${MAX_JOBS} jobs.`);
  const clientId = input.clientId ?? undefined;
  let next = data;
  let paymentRecordId: string | undefined;
  if (input.expectedDate) {
    paymentRecordId = newId('pay');
    const step = addOneTime(next, { kind: 'income', description: jobLabel(data, input.description, clientId), amountCents: input.amountCents, date: input.expectedDate, certainty: input.certainty }, clock, paymentRecordId);
    if (!step.ok) return step;
    next = step.data;
  }
  const job: FreelanceJob = {
    id,
    ...(clientId ? { clientId } : {}),
    description: input.description.trim(),
    amountCents: input.amountCents,
    status: input.status,
    ...(paymentRecordId ? { paymentRecordId } : {}),
    createdAt: clock.now,
    updatedAt: clock.now,
  };
  return ok({ ...next, jobs: [...(next.jobs ?? []), job] });
}

/**
 * Changes a job. While it isn't paid, its amount and expected payment date
 * move its payment record (whose original expectation is kept), a new date
 * gives it one, and removing the date makes it pending again. A paid job's
 * amount and date are its recorded payment's; correct that instead.
 */
export function editJob(data: AppData, id: string, input: JobInput, clock: Clock): Result {
  const job = (data.jobs ?? []).find((j) => j.id === id);
  if (!job) return fail('That job no longer exists.');
  const err = validateJob(data, input);
  if (err) return fail(err);
  const record = jobPayment(data, job);
  const clientId = input.clientId === undefined ? job.clientId : (input.clientId ?? undefined);
  let next = data;
  let paymentRecordId = record?.id;
  const changesMoney = input.amountCents !== job.amountCents || (input.expectedDate !== undefined && input.expectedDate !== (record?.scheduledDate ?? null));
  if (record && record.status === 'completed') {
    if (changesMoney) return fail('This job is paid. Correct its recorded payment instead.');
    if (input.status !== 'done') return fail('A paid job is done.');
  } else if (record && record.status === 'canceled') {
    if (changesMoney) return fail("This job's payment was skipped. Undo the skip first.");
  } else {
    const date = input.expectedDate === undefined ? (record?.scheduledDate ?? null) : input.expectedDate;
    if (record && date === null) {
      next = withoutPayment(next, record.id);
      paymentRecordId = undefined;
    } else if (!record && date) {
      paymentRecordId = newId('pay');
      const step = addOneTime(next, { kind: 'income', description: jobLabel(next, input.description, clientId), amountCents: input.amountCents, date, certainty: input.certainty }, clock, paymentRecordId);
      if (!step.ok) return step;
      next = step.data;
    } else if (record && date) {
      if (record.scheduledDate !== date || record.scheduledAmountCents !== input.amountCents) {
        const step = rescheduleOccurrence(next, record.id, { date, amountCents: input.amountCents }, clock);
        if (!step.ok) return step;
        next = step.data;
      }
      if (input.certainty !== undefined && certaintyOf(record) !== input.certainty) {
        const step = setIncomeCertainty(next, record.id, input.certainty, clock);
        if (!step.ok) return step;
        next = step.data;
      }
    }
  }
  const { clientId: _c, paymentRecordId: _p, ...rest } = job;
  void _c;
  void _p;
  const updated: FreelanceJob = {
    ...rest,
    ...(clientId ? { clientId } : {}),
    description: input.description.trim(),
    amountCents: input.amountCents,
    status: input.status,
    ...(paymentRecordId ? { paymentRecordId } : {}),
    updatedAt: clock.now,
  };
  return ok(relabelPayments({ ...next, jobs: (next.jobs ?? []).map((j) => (j.id === id ? updated : j)) }, new Set([id])));
}

/**
 * Records a job's payment: its payment record is recorded at the actual date
 * and amount (one is made, expected at the job's amount on that date, when the
 * job had no date). The job is then paid, and its work done.
 */
export function recordJobPayment(data: AppData, id: string, actual: ActualInput, clock: Clock): Result {
  const job = (data.jobs ?? []).find((j) => j.id === id);
  if (!job) return fail('That job no longer exists.');
  const record = jobPayment(data, job);
  if (record?.status === 'completed') return fail('This job is already paid.');
  if (record?.status === 'canceled') return fail("This job's payment was skipped. Undo the skip first.");
  let next = data;
  const recordId = record?.id ?? newId('pay');
  if (!record) {
    const added = addOneTime(next, { kind: 'income', description: jobLabel(data, job.description, job.clientId), amountCents: job.amountCents, date: actual.date }, clock, recordId);
    if (!added.ok) return added;
    next = added.data;
  }
  const recorded = recordActual(next, recordId, actual, clock);
  if (!recorded.ok) return recorded;
  next = recorded.data;
  return ok({ ...next, jobs: (next.jobs ?? []).map((j) => (j.id === id ? { ...j, status: 'done' as const, paymentRecordId: recordId, updatedAt: clock.now } : j)) });
}

/** Removes a job and its payment record. A paid job is kept: its payment is history. */
export function deleteJob(data: AppData, id: string): Result {
  const job = (data.jobs ?? []).find((j) => j.id === id);
  if (!job) return fail('That job no longer exists.');
  const record = jobPayment(data, job);
  if (record?.status === 'completed') return fail('This job has a recorded payment. Undo the payment first, then delete the job.');
  const next = record ? withoutPayment(data, record.id) : data;
  const jobs = (next.jobs ?? []).filter((j) => j.id !== id);
  const { jobs: _j, ...rest } = next;
  void _j;
  return ok(jobs.length ? { ...rest, jobs } : rest);
}
