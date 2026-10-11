/**
 * Account storage: the user's data saved to their Financial OS account
 * (Supabase), with a copy kept on the device so the app opens and keeps
 * working without a connection.
 *
 * Every change is written to the device copy first and marked pending, then
 * sent to the account. A pending change is sent again the next time the app
 * loads or the connection returns. If newer data reached the account from
 * somewhere else in the meantime, the newer data is loaded and this device's
 * unsent changes are set aside as a recovered copy the user can download, so
 * neither version is silently lost.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyData } from '../domain/operations';
import type { AppData } from '../domain/types';
import { migrate, type SaveResult, type StorageAdapter } from './storage';

/** What the adapter needs from the server. Thrown errors mean it couldn't be reached. */
export interface CloudBackend {
  /** The stored document and its revision, or null when nothing is stored yet. */
  fetch(): Promise<{ data: unknown; revision: number } | null>;
  /** Stores `data` as revision base + 1 if the stored revision is `baseRevision`. Returns the new revision, or null on conflict. */
  save(data: AppData, baseRevision: number): Promise<number | null>;
  remove(): Promise<void>;
}

const TABLE = 'financial_data';

export function supabaseBackend(client: SupabaseClient, userId: string): CloudBackend {
  return {
    async fetch() {
      const { data, error } = await client.from(TABLE).select('data, revision').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { data: data.data as unknown, revision: Number(data.revision) } : null;
    },
    async save(data, baseRevision) {
      const { data: revision, error } = await client.rpc('save_financial_data', { p_data: data, p_base_revision: baseRevision });
      if (error) throw new Error(error.message);
      return revision === null ? null : Number(revision);
    },
    async remove() {
      const { error } = await client.from(TABLE).delete().eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
  };
}

/** The device copy: the latest data, the account revision it is based on, and whether it has unsent changes. */
interface DeviceCopy {
  data: AppData;
  pending: boolean;
}

export const cloudCacheKey = (userId: string) => `financial-os:account:${userId}`;
const recoveredKey = (userId: string) => `${cloudCacheKey(userId)}:recovered`;

export const OFFLINE_MESSAGE = 'Financial OS can’t reach your account right now. Your change is kept on this device and will be saved when you’re back online.';
const CONFLICT_MESSAGE = 'Your data was changed on another device or window. Reload to see the latest version.';

export class CloudAdapter implements StorageAdapter {
  private pendingAfterLoad = false;

  constructor(
    private readonly backend: CloudBackend,
    private readonly userId: string,
    private readonly storage: Storage = window.localStorage,
  ) {}

  private readCopy(): DeviceCopy | null {
    try {
      const text = this.storage.getItem(cloudCacheKey(this.userId));
      if (!text) return null;
      const parsed = JSON.parse(text) as { data: unknown; pending?: unknown };
      return { data: migrate(parsed.data), pending: parsed.pending === true };
    } catch {
      return null;
    }
  }

  private writeCopy(copy: DeviceCopy) {
    try {
      this.storage.setItem(cloudCacheKey(this.userId), JSON.stringify(copy));
    } catch (err) {
      // The account copy is what matters; a full device only costs offline access.
      console.error('Could not update the device copy.', err);
    }
  }

  private setAside(data: AppData) {
    try {
      this.storage.setItem(recoveredKey(this.userId), JSON.stringify({ savedAt: new Date().toISOString(), data }));
    } catch (err) {
      console.error('Could not keep the unsent changes.', err);
    }
  }

  async load(): Promise<AppData> {
    const copy = this.readCopy();
    let remote: { data: unknown; revision: number } | null;
    try {
      remote = await this.backend.fetch();
    } catch (err) {
      // Offline: open with the device copy. Its pending change is sent once the connection returns.
      if (copy) {
        this.pendingAfterLoad = copy.pending;
        return copy.data;
      }
      throw err;
    }

    const remoteRevision = remote?.revision ?? 0;
    if (copy?.pending) {
      if (copy.data.revision === remoteRevision) {
        // Nothing changed elsewhere since this device's change: send it now.
        this.pendingAfterLoad = true;
        return copy.data;
      }
      this.setAside(copy.data);
    }

    const data: AppData = remote ? { ...migrate(remote.data), revision: remoteRevision } : emptyData();
    this.pendingAfterLoad = false;
    if (remote) this.writeCopy({ data, pending: false });
    else this.storage.removeItem(cloudCacheKey(this.userId));
    return data;
  }

  hasUnsavedChanges(): boolean {
    return this.pendingAfterLoad;
  }

  async save(data: AppData, baseRevision: number): Promise<SaveResult> {
    const { isSample: _sample, ...doc } = data;
    this.writeCopy({ data: { ...doc, revision: baseRevision }, pending: true });
    let revision: number | null;
    try {
      revision = await this.backend.save({ ...doc, schemaVersion: 2, revision: baseRevision + 1 }, baseRevision);
    } catch (err) {
      console.error(err);
      return { ok: false, reason: 'error', message: OFFLINE_MESSAGE };
    }
    // On a conflict the change stays pending on the device; the reload sets it aside.
    if (revision === null) return { ok: false, reason: 'conflict', message: CONFLICT_MESSAGE };
    this.pendingAfterLoad = false;
    this.writeCopy({ data: { ...doc, revision }, pending: false });
    return { ok: true, revision };
  }

  async clear(): Promise<void> {
    await this.backend.remove();
    this.forgetDevice();
  }

  /** Removes everything this account keeps on the device (used on sign-out). */
  forgetDevice() {
    this.storage.removeItem(cloudCacheKey(this.userId));
    this.storage.removeItem(recoveredKey(this.userId));
  }

  recoveredCopy(): { data: AppData; savedAt: string } | null {
    try {
      const text = this.storage.getItem(recoveredKey(this.userId));
      if (!text) return null;
      const parsed = JSON.parse(text) as { data: unknown; savedAt: string };
      return { data: migrate(parsed.data), savedAt: parsed.savedAt };
    } catch {
      return null;
    }
  }

  discardRecoveredCopy() {
    this.storage.removeItem(recoveredKey(this.userId));
  }
}

/** Whether there is anything on the device copy that hasn't reached the account yet. */
export function hasPendingDeviceChanges(userId: string, storage: Storage = window.localStorage): boolean {
  try {
    const text = storage.getItem(cloudCacheKey(userId));
    return text ? (JSON.parse(text) as { pending?: unknown }).pending === true : false;
  } catch {
    return false;
  }
}
