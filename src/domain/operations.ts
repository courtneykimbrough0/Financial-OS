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
import { findOccurrence } from './occurrences';
import { validateRule } from './recurrence';
import { LIABILITY_TYPES, type AppData, type LiabilityType, type OccurrenceRecord, type RecurrenceRule, type RecurringSource, type TransactionKind } from './types';

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
  kind: TransactionKind;
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
 * expectations they were generated with. Occurrences the user already acted on
 * (completed, rescheduled, canceled) are stored records and are unaffected.
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

/** Stops forecasting from today. Past occurrences and recorded outcomes remain. */
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
  kind: Exclude<TransactionKind, 'subscription' | 'liability'>;
  tags?: string[];
  description: string;
  amountCents: Cents;
  date: DateStr;
}

export function addOneTime(data: AppData, input: OneTimeInput, clock: Clock, id = newId('one')): Result {
  const err =
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
    return { ...r, status: 'completed', actualAmountCents: actual.amountCents, actualDate: actual.date, completedAt: clock.now };
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

/** Undoes a completion or cancellation, returning the occurrence to outstanding. */
export function restoreOccurrence(data: AppData, id: string, clock: Clock): Result {
  return withOccurrence(data, id, clock, (r) => {
    if (r.status === 'scheduled') return 'This transaction is already outstanding.';
    return { ...r, status: 'scheduled', actualAmountCents: null, actualDate: null, completedAt: null, canceledAt: null, cancelNote: null };
  });
}

export function completeOnboarding(data: AppData): Result {
  return ok({ ...data, onboardingComplete: true });
}

/** Default date for "record actual": the expected date, unless that is in the future. */
export function defaultActualDate(scheduledDate: DateStr, today: DateStr): DateStr {
  return scheduledDate > today ? today : scheduledDate;
}

