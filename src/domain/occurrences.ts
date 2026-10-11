import { addDays, minDate, type DateStr } from './dates';
import { occurrenceDates } from './recurrence';
import {
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

export function deriveStatus(record: OccurrenceRecord, today: DateStr): OccurrenceStatus {
  if (record.status === 'scheduled' && record.scheduledDate < today) return 'overdue';
  return record.status;
}

/**
 * Every occurrence relevant to [from, to]: generated recurring occurrences in
 * the window, with any stored record replacing the generated occurrence of the
 * same id, plus every stored record (one-time transactions and acted-on
 * recurring occurrences) regardless of date. Each occurrence appears once.
 */
export function resolveOccurrences(data: AppData, from: DateStr, to: DateStr, today: DateStr): Occurrence[] {
  const recordIds = new Set(data.records.map((r) => r.id));
  const out: Occurrence[] = [];
  for (const source of data.sources) {
    for (const gen of expandSource(source, from, to)) {
      if (recordIds.has(gen.id)) continue;
      out.push({ ...gen, displayStatus: deriveStatus(gen, today), virtual: true });
    }
  }
  for (const record of data.records) {
    out.push({ ...record, displayStatus: deriveStatus(record, today), virtual: false });
  }
  return out;
}

/** A single occurrence by id, generated or stored. */
export function findOccurrence(data: AppData, id: string, today: DateStr): Occurrence | null {
  const record = data.records.find((r) => r.id === id);
  if (record) return { ...record, displayStatus: deriveStatus(record, today), virtual: false };
  const at = id.lastIndexOf('@');
  if (at < 0) return null;
  const source = data.sources.find((s) => s.id === id.slice(0, at));
  const date = id.slice(at + 1);
  if (!source) return null;
  const gen = expandSource(source, date, date).find((o) => o.id === id);
  return gen ? { ...gen, displayStatus: deriveStatus(gen, today), virtual: true } : null;
}
