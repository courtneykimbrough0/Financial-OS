import { addDays, diffDays, minDate, type DateStr } from './dates';
import type { Cents } from './money';
import { occurrenceDates } from './recurrence';
import {
  isUncountedPossible,
  recurringOccurrenceId,
  type AppData,
  type Occurrence,
  type OccurrenceRecord,
  type OccurrenceStatus,
  type RecurringSource,
} from './types';

/** Last date (inclusive) a source can generate occurrences, or null if open-ended. */
export function sourceLastDate(source: RecurringSource): DateStr | null {
  if (source.active || !source.endDate) return null;
  return addDays(source.endDate, -1);
}

/**
 * Generated (not yet stored) occurrences of a recurring source within [from, to].
 * Each schedule version covers [version.startDate, nextVersion.startDate).
 */
export function expandSource(source: RecurringSource, from: DateStr, to: DateStr): OccurrenceRecord[] {
  const out: OccurrenceRecord[] = [];
  const last = sourceLastDate(source);
  const versions = [...source.versions].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  versions.forEach((version, i) => {
    const next = versions[i + 1];
    let windowEnd = to;
    if (next) windowEnd = minDate(windowEnd, addDays(next.startDate, -1));
    if (last) windowEnd = minDate(windowEnd, last);
    for (const date of occurrenceDates(version.rule, version.startDate, from, windowEnd)) {
      if (source.pausedRanges.some((p) => date >= p.from && date < p.until)) continue;
      out.push({
        id: recurringOccurrenceId(source.id, date),
        sourceId: source.id,
        kind: source.kind,
        description: source.description,
        tags: source.tags,
        expectedDate: date,
        expectedAmountCents: version.amountCents,
        scheduledDate: date,
        scheduledAmountCents: version.amountCents,
        status: 'scheduled',
        actualDate: null,
        actualAmountCents: null,
        completedAt: null,
        canceledAt: null,
        cancelNote: null,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      });
    }
  });
  return out;
}

/** Possible income is never overdue: it was never dependable, so nothing is owed. */
export function deriveStatus(record: OccurrenceRecord, today: DateStr): OccurrenceStatus {
  if (record.status === 'scheduled' && record.scheduledDate < today && !isUncountedPossible(record)) return 'overdue';
  return record.status;
}

/**
 * The record with its certainty as it applies now: a recurring occurrence
 * follows its item (stored or not), a one-time record keeps its own.
 */
function withCertainty(record: OccurrenceRecord, sources: Map<string, RecurringSource>): OccurrenceRecord {
  if (record.sourceId === null) return record;
  const { certainty: _stored, ...rest } = record;
  void _stored;
  return sources.get(record.sourceId)?.certainty === 'possible' && record.kind === 'income' ? { ...rest, certainty: 'possible' } : rest;
}

const resolved = (record: OccurrenceRecord, sources: Map<string, RecurringSource>, today: DateStr, virtual: boolean): Occurrence => {
  const r = withCertainty(record, sources);
  return { ...r, displayStatus: deriveStatus(r, today), virtual };
};

/**
 * True for a stored change to an outstanding recurring occurrence that its
 * source no longer generates, because the schedule changed or the item was
 * turned off from a date on or before the occurrence's original date. The new
 * schedule replaces that occurrence, so the change no longer applies: it is
 * kept on record but neither listed nor counted. It applies again if a later
 * schedule generates the original date again. Recorded (completed) and
 * canceled occurrences are history and are never superseded.
 */
function isSuperseded(record: OccurrenceRecord, sources: Map<string, RecurringSource>): boolean {
  if (record.sourceId === null || record.status !== 'scheduled') return false;
  const source = sources.get(record.sourceId);
  if (!source) return false;
  return !expandSource(source, record.expectedDate, record.expectedDate).some((gen) => gen.id === record.id);
}

/**
 * Every occurrence relevant to [from, to]: generated recurring occurrences in
 * the window, with any stored record replacing the generated occurrence of the
 * same id, plus every stored record (one-time transactions and acted-on
 * recurring occurrences) regardless of date, except superseded ones (see
 * `isSuperseded`). Each occurrence appears once.
 */
export function resolveOccurrences(data: AppData, from: DateStr, to: DateStr, today: DateStr): Occurrence[] {
  const recordIds = new Set(data.records.map((r) => r.id));
  const sources = new Map(data.sources.map((s) => [s.id, s]));
  const out: Occurrence[] = [];
  for (const source of data.sources) {
    for (const gen of expandSource(source, from, to)) {
      if (recordIds.has(gen.id)) continue;
      out.push(resolved(gen, sources, today, true));
    }
  }
  for (const record of data.records) {
    if (isSuperseded(record, sources)) continue;
    out.push(resolved(record, sources, today, false));
  }
  return out;
}

/** A single occurrence by id, generated or stored. Null for a superseded record. */
export function findOccurrence(data: AppData, id: string, today: DateStr): Occurrence | null {
  const sources = new Map(data.sources.map((s) => [s.id, s]));
  const record = data.records.find((r) => r.id === id);
  if (record) {
    if (isSuperseded(record, sources)) return null;
    return resolved(record, sources, today, false);
  }
  const at = id.lastIndexOf('@');
  if (at < 0) return null;
  const source = data.sources.find((s) => s.id === id.slice(0, at));
  const date = id.slice(at + 1);
  if (!source) return null;
  const gen = expandSource(source, date, date).find((o) => o.id === id);
  return gen ? resolved(gen, sources, today, true) : null;
}

/** How a recorded outcome differed from the original prediction. */
export interface Variance {
  /** Actual minus expected amount: positive when more than expected. */
  amountCents: Cents;
  /** Days from the expected date to the actual date: positive when later. */
  days: number;
}

/** Variance of a recorded occurrence against its original prediction; null until it is recorded. */
export function variance(record: OccurrenceRecord): Variance | null {
  if (record.status !== 'completed' || record.actualDate === null || record.actualAmountCents === null) return null;
  return { amountCents: record.actualAmountCents - record.expectedAmountCents, days: diffDays(record.expectedDate, record.actualDate) };
}
