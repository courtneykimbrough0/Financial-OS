/**
 * Persistence. For the MVP the data lives on the device in localStorage behind
 * a small adapter interface, so a synced backend can replace it later without
 * touching the forecast engine or UI. Data is a single versioned JSON
 * document; `migrate` is where future schema upgrades go.
 */
import { isValidDateStr } from '../domain/dates';
import { emptyData, MAX_ACCOUNT_NAME, MAX_ACCOUNTS } from '../domain/operations';
import { ACCOUNT_TYPES, LIABILITY_TYPES, ONE_TIME_KINDS, RECURRING_KINDS, REVIEW_CADENCES, accountTypeFor, type Account, type AccountType, type AppData, type EstimateDismissal, type OccurrenceRecord, type RecurringSource, type ReviewCadence, type ReviewSettings, type TransactionKind, type Transfer } from '../domain/types';

export type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; reason: 'conflict'; message: string }
  | { ok: false; reason: 'error'; message: string };

/**
 * What a save is for. Ordinary changes are updates; restoring a backup
 * replaces the whole plan; starting over resets it. Storage that can tell
 * them apart (Supabase) checks each accordingly; device storage ignores it.
 */
export type SaveIntent = 'update' | 'replace' | 'reset';

/**
 * Where data lives. Asynchronous so a server-backed implementation (e.g.
 * Firebase) can replace the device one without changing the app.
 */
export interface StorageAdapter {
  load(): Promise<AppData>;
  /**
   * Saves `data` as revision `baseRevision + 1`, but only if the stored
   * revision is still `baseRevision`. Otherwise returns a conflict and
   * changes nothing.
   */
  save(data: AppData, baseRevision: number, intent?: SaveIntent): Promise<SaveResult>;
  /**
   * Removes all stored data for this adapter. Used only for the device's
   * sample data; account storage that can't erase this way rejects instead
   * of reporting success.
   */
  clear(): Promise<void>;
  /**
   * True when nothing is kept on the device: a change the backend hasn't
   * confirmed isn't saved anywhere. The store then shows a restore or start
   * over only once it is confirmed (see `replacePlan`).
   */
  readonly onlineFirst?: boolean;
  /** True when the data just loaded includes changes that haven't been saved yet (e.g. made offline). */
  hasUnsavedChanges?(): boolean;
  /** Changes that couldn't be combined with newer data from elsewhere, kept so the user can download them. */
  recoveredCopy?(): { data: AppData; savedAt: string } | null;
  discardRecoveredCopy?(): void;
}

export const STORAGE_KEY = 'financial-os:data';
/** Synthetic demonstration data lives under its own key and never touches real data. */
export const SAMPLE_STORAGE_KEY = 'financial-os:sample-data';

function isSource(s: unknown): s is RecurringSource {
  if (!s || typeof s !== 'object') return false;
  const v = s as RecurringSource;
  return (
    typeof v.id === 'string' &&
    (RECURRING_KINDS as readonly string[]).includes(v.kind) &&
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
    (v.sourceId === null ? (ONE_TIME_KINDS as readonly string[]).includes(v.kind) : typeof v.sourceId === 'string' && (RECURRING_KINDS as readonly string[]).includes(v.kind)) &&
    isValidDateStr(v.expectedDate) &&
    isValidDateStr(v.scheduledDate) &&
    Number.isSafeInteger(v.expectedAmountCents) &&
    Number.isSafeInteger(v.scheduledAmountCents) &&
    ['scheduled', 'completed', 'canceled'].includes(v.status)
  );
}

/** A saved review rhythm, if it is well formed; anything else is dropped rather than failing the whole load. */
function readReview(r: unknown): ReviewSettings | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const v = r as Partial<ReviewSettings>;
  if (!REVIEW_CADENCES.includes(v.cadence as ReviewCadence)) return undefined;
  const handledOn = isValidDateStr(v.handledOn) ? v.handledOn : null;
  const outcome = v.outcome === 'completed' || v.outcome === 'skipped' ? v.outcome : null;
  return { cadence: v.cadence!, handledOn, outcome: handledOn ? outcome : null };
}

/** A saved estimate dismissal, if it is well formed; anything else is dropped (the suggestion may simply return). */
function readDismissal(d: unknown): EstimateDismissal | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const v = d as Partial<EstimateDismissal>;
  const cents = (x: unknown) => Number.isSafeInteger(x) && (x as number) > 0;
  if (!cents(v.currentCents) || !cents(v.proposedCents) || !isValidDateStr(v.through)) return undefined;
  return { currentCents: v.currentCents!, proposedCents: v.proposedCents!, through: v.through };
}

/**
 * Saved accounts, keeping only well-formed ones (a known type, a name, a
 * unique id) up to the limit. Anything else is dropped rather than failing
 * the whole load; items that pointed at a dropped account become unassigned.
 */
function readAccounts(a: unknown): Account[] {
  if (!Array.isArray(a)) return [];
  const out: Account[] = [];
  const ids = new Set<string>();
  for (const x of a) {
    if (out.length >= MAX_ACCOUNTS || !x || typeof x !== 'object') continue;
    const v = x as Partial<Account>;
    if (typeof v.id !== 'string' || v.id === '' || ids.has(v.id) || !ACCOUNT_TYPES.includes(v.type as AccountType) || typeof v.name !== 'string' || v.name.trim() === '') continue;
    ids.add(v.id);
    const now = typeof v.createdAt === 'string' ? v.createdAt : new Date(0).toISOString();
    const o = v.opening;
    // A malformed opening balance is dropped: the balance becomes unknown, never wrong.
    const opening = o && typeof o === 'object' && Number.isSafeInteger(o.amountCents) && isValidDateStr(o.date) ? { opening: { amountCents: o.amountCents, date: o.date } } : {};
    out.push({ id: v.id, name: v.name.trim().slice(0, MAX_ACCOUNT_NAME), type: v.type!, ...opening, createdAt: now, updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : now });
  }
  return out;
}

/**
 * Saved transfers. Each one is whole or not kept: both accounts must exist
 * and differ, the amount be positive whole cents, the date valid and the
 * status known. A transfer is never kept with one side missing, so balances
 * always move in pairs.
 */
function readTransfers(t: unknown, accounts: Account[]): Transfer[] {
  if (!Array.isArray(t)) return [];
  const known = new Set(accounts.map((a) => a.id));
  const out: Transfer[] = [];
  const ids = new Set<string>();
  for (const x of t) {
    if (!x || typeof x !== 'object') continue;
    const v = x as Partial<Transfer>;
    const valid =
      typeof v.id === 'string' && v.id !== '' && !ids.has(v.id) &&
      typeof v.fromAccountId === 'string' && known.has(v.fromAccountId) &&
      typeof v.toAccountId === 'string' && known.has(v.toAccountId) &&
      v.fromAccountId !== v.toAccountId &&
      Number.isSafeInteger(v.amountCents) && v.amountCents! > 0 &&
      isValidDateStr(v.date) &&
      (v.status === 'expected' || v.status === 'recorded');
    if (!valid) continue;
    ids.add(v.id!);
    const now = typeof v.createdAt === 'string' ? v.createdAt : new Date(0).toISOString();
    out.push({
      id: v.id!,
      fromAccountId: v.fromAccountId!,
      toAccountId: v.toAccountId!,
      amountCents: v.amountCents!,
      date: v.date!,
      status: v.status!,
      recordedAt: v.status === 'recorded' ? (typeof v.recordedAt === 'string' ? v.recordedAt : now) : null,
      createdAt: now,
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : now,
    });
  }
  return out;
}

/** An item's account, kept only when that account exists and suits the item's kind. */
function keptAccount(accounts: Account[], kind: TransactionKind, accountId: unknown): { accountId?: string } {
  const account = typeof accountId === 'string' ? accounts.find((a) => a.id === accountId) : undefined;
  return account && account.type === accountTypeFor(kind) ? { accountId: account.id } : {};
}

/** Validates and upgrades parsed JSON. Throws if the document is unusable. */
export function migrate(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') throw new Error('Saved data is not an object.');
  const doc = raw as Omit<Partial<AppData>, 'schemaVersion'> & { schemaVersion?: number };
  if (doc.schemaVersion !== 1 && doc.schemaVersion !== 2) throw new Error(`Unsupported data version: ${String(doc.schemaVersion)}`);
  const sources = Array.isArray(doc.sources) ? doc.sources : [];
  const records = Array.isArray(doc.records) ? doc.records : [];
  if (!sources.every(isSource) || !records.every(isRecord)) throw new Error('Saved data is damaged.');
  const revision = Number.isSafeInteger(doc.revision) && doc.revision! >= 0 ? doc.revision! : 0;
  const accounts = readAccounts(doc.accounts);
  const transfers = readTransfers(doc.transfers, accounts);
  return {
    schemaVersion: 2,
    revision,
    onboardingComplete: Boolean(doc.onboardingComplete),
    ...(doc.isSample ? { isSample: true } : {}),
    sources: sources.map(({ liabilityType, mainPaycheck, estimateDismissal, accountId, ...s }) => ({
      ...s,
      kind: s.kind,
      // Keep a liability type only when it is one of the three allowed values; the edit form asks for it otherwise.
      ...(s.kind === 'liability' && liabilityType && LIABILITY_TYPES.includes(liabilityType) ? { liabilityType } : {}),
      ...(s.kind === 'income' && mainPaycheck === true ? { mainPaycheck: true } : {}),
      ...(readDismissal(estimateDismissal) ? { estimateDismissal: readDismissal(estimateDismissal) } : {}),
      ...keptAccount(accounts, s.kind, accountId),
      tags: Array.isArray(s.tags) ? s.tags : [],
      pausedRanges: s.pausedRanges ?? [],
      endDate: s.endDate ?? null,
    })),
    // Only one-time items carry their own account; recurring occurrences follow their item's.
    // A release is kept only on a one-time reserve.
    records: records.map(({ accountId, release, ...r }) => ({
      ...r,
      tags: Array.isArray(r.tags) ? r.tags : [],
      ...(r.sourceId === null ? keptAccount(accounts, r.kind, accountId) : {}),
      ...(r.sourceId === null && r.kind === 'reserve' && release === true ? { release: true as const } : {}),
    })),
    ...(readReview(doc.review) ? { review: readReview(doc.review) } : {}),
    ...(accounts.length > 0 ? { accounts } : {}),
    ...(transfers.length > 0 ? { transfers } : {}),
  };
}

const CONFLICT_MESSAGE = 'Your data was changed somewhere else, such as another window. Reload to see the latest version.';

/** Device storage (localStorage). Used for testing and before accounts exist. */
export class LocalStorageAdapter implements StorageAdapter {
  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly key = STORAGE_KEY,
  ) {}

  private read(): AppData {
    const text = this.storage.getItem(this.key);
    if (text === null) return emptyData();
    try {
      return migrate(JSON.parse(text));
    } catch (err) {
      // Keep the unreadable copy so it is never silently lost.
      this.storage.setItem(`${this.key}:unreadable:${Date.now()}`, text);
      this.storage.removeItem(this.key);
      console.error('Could not read saved data; starting fresh.', err);
      return emptyData();
    }
  }

  async load(): Promise<AppData> {
    return this.read();
  }

  async save(data: AppData, baseRevision: number): Promise<SaveResult> {
    try {
      const current = this.read();
      if (current.revision !== baseRevision) return { ok: false, reason: 'conflict', message: CONFLICT_MESSAGE };
      const revision = baseRevision + 1;
      this.storage.setItem(this.key, JSON.stringify({ ...data, schemaVersion: 2, revision }));
      return { ok: true, revision };
    } catch (err) {
      console.error(err);
      return { ok: false, reason: 'error', message: 'Your change could not be saved on this device. Check available storage and try again.' };
    }
  }

  async clear(): Promise<void> {
    this.storage.removeItem(this.key);
  }
}

/** In-memory storage for tests. `failNext` / `conflictNext` simulate problems. */
export class MemoryAdapter implements StorageAdapter {
  failNext = false;
  saves = 0;
  constructor(private data: AppData = emptyData()) {}
  async load(): Promise<AppData> {
    return structuredClone(this.data);
  }
  async save(data: AppData, baseRevision: number): Promise<SaveResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, reason: 'error', message: 'Save failed.' };
    }
    if (this.data.revision !== baseRevision) return { ok: false, reason: 'conflict', message: CONFLICT_MESSAGE };
    this.saves += 1;
    this.data = structuredClone({ ...data, revision: baseRevision + 1 });
    return { ok: true, revision: baseRevision + 1 };
  }
  async clear(): Promise<void> {
    this.data = emptyData();
  }
  /** Test helper: replace stored data as if another device had saved. */
  externalWrite(data: AppData) {
    this.data = structuredClone({ ...data, revision: this.data.revision + 1 });
  }
}
