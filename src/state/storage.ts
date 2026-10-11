/**
 * Persistence. For the MVP the data lives on the device in localStorage behind
 * a small adapter interface, so a synced backend can replace it later without
 * touching the forecast engine or UI. Data is a single versioned JSON
 * document; `migrate` is where future schema upgrades go.
 */
import { isValidDateStr } from '../domain/dates';
import { emptyData } from '../domain/operations';
import type { AppData, OccurrenceRecord, RecurringSource } from '../domain/types';

export interface StorageAdapter {
  load(): AppData;
  save(data: AppData): void;
}

export const STORAGE_KEY = 'cashflow-forecast:data';

function isSource(s: unknown): s is RecurringSource {
  if (!s || typeof s !== 'object') return false;
  const v = s as RecurringSource;
  return (
    typeof v.id === 'string' &&
    ['income', 'expense', 'liability'].includes(v.kind) &&
    typeof v.description === 'string' &&
    Array.isArray(v.versions) &&
    v.versions.length > 0 &&
    v.versions.every((x) => isValidDateStr(x.startDate) && Number.isSafeInteger(x.amountCents) && x.rule && typeof x.rule.type === 'string')
  );
}

function isRecord(r: unknown): r is OccurrenceRecord {
  if (!r || typeof r !== 'object') return false;
  const v = r as OccurrenceRecord;
  return (
    typeof v.id === 'string' &&
    ['income', 'expense', 'liability'].includes(v.kind) &&
    isValidDateStr(v.expectedDate) &&
    isValidDateStr(v.scheduledDate) &&
    Number.isSafeInteger(v.expectedAmountCents) &&
    Number.isSafeInteger(v.scheduledAmountCents) &&
    ['scheduled', 'completed', 'canceled'].includes(v.status)
  );
}

/** Validates and upgrades parsed JSON. Throws if the document is unusable. */
export function migrate(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') throw new Error('Saved data is not an object.');
  const doc = raw as Partial<AppData>;
  if (doc.schemaVersion !== 1) throw new Error(`Unsupported data version: ${String(doc.schemaVersion)}`);
  const sources = Array.isArray(doc.sources) ? doc.sources : [];
  const records = Array.isArray(doc.records) ? doc.records : [];
  if (!sources.every(isSource) || !records.every(isRecord)) throw new Error('Saved data is damaged.');
  return {
    schemaVersion: 1,
    onboardingComplete: Boolean(doc.onboardingComplete),
    sources: sources.map((s) => ({ ...s, category: s.category ?? '', pausedRanges: s.pausedRanges ?? [], endDate: s.endDate ?? null })),
    records,
  };
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly key = STORAGE_KEY,
  ) {}

  load(): AppData {
    const text = this.storage.getItem(this.key);
    if (text === null) return emptyData();
    try {
      return migrate(JSON.parse(text));
    } catch (err) {
      // Keep the unreadable copy so it is never silently lost.
      this.storage.setItem(`${this.key}:unreadable:${Date.now()}`, text);
      console.error('Could not read saved data; starting fresh.', err);
      return emptyData();
    }
  }

  save(data: AppData): void {
    this.storage.setItem(this.key, JSON.stringify(data));
  }
}

export class MemoryAdapter implements StorageAdapter {
  constructor(private data: AppData = emptyData()) {}
  load(): AppData {
    return structuredClone(this.data);
  }
  save(data: AppData): void {
    this.data = structuredClone(data);
  }
}
