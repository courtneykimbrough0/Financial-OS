import { beforeEach, describe, expect, it } from 'vitest';
import { reviewStatus } from '../../domain/cadence';
import { addOneTime, completeReview, emptyData, setReviewCadence } from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { CloudAdapter } from '../cloud';
import { LocalStorageAdapter, migrate } from '../storage';
import { FakeServer } from './fake-server';

/** A separate device's storage. */
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const clock = { today: '2026-10-14', now: '2026-10-14T12:00:00Z' };
const unwrap = (r: { ok: true; data: AppData } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

/** A forecast with a bill, weekly reviews, and this week's review completed. */
function reviewed(): AppData {
  let d = unwrap(addOneTime(emptyData(), { kind: 'bill', description: 'Rent', amountCents: 120000, date: '2026-11-01' }, clock, 'rent'));
  d = unwrap(setReviewCadence(d, 'weekly'));
  return unwrap(completeReview(d, clock));
}

describe('the review rhythm is kept', () => {
  beforeEach(() => localStorage.clear());

  it('on the device, across a reload', async () => {
    const d = reviewed();
    await new LocalStorageAdapter().save(d, 0);
    const loaded = await new LocalStorageAdapter().load();
    expect(loaded.review).toEqual({ cadence: 'weekly', handledOn: '2026-10-14', outcome: 'completed' });
    expect(reviewStatus(loaded, '2026-10-17').due).toBe(false);
  });

  it('in the account and its copy on the device, including when reopened offline, once accounts accept it', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage, true);
    await adapter.load();
    await adapter.save(reviewed(), 0);
    expect((server.row!.data as AppData).review).toEqual(reviewed().review);
    server.offline = true;
    const reopened = await new CloudAdapter(server, 'user-1', localStorage, true).load();
    expect(reopened.review).toEqual(reviewed().review);
  });

  it('left out of account saves until the live rules accept it, so nothing else stops saving', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage);
    await adapter.load();
    // For example, device data with a rhythm moved into an account, or a backup restored while signed in.
    expect(await adapter.save(reviewed(), 0)).toEqual({ ok: true, revision: 1 });
    expect(server.row!.data).not.toHaveProperty('review');
    expect((server.row!.data as AppData).records.map((r) => r.description)).toEqual(['Rent']);
  });

  it('in a backup file', () => {
    expect(readBackup(createBackup(reviewed()).text).data.review).toEqual(reviewed().review);
  });
});

describe('accounts while the rhythm is left out of account saves', () => {
  beforeEach(() => localStorage.clear());

  it('a rhythm already in the account (saved by a newer version) survives saves from a device that leaves it out', async () => {
    const server = new FakeServer();
    const newer = new CloudAdapter(server, 'user-1', localStorage, true);
    await newer.load();
    await newer.save(reviewed(), 0);
    expect((server.row!.data as AppData).review).toEqual(reviewed().review);

    // An older version on another device (field left out) loads and changes something unrelated.
    const otherStorage = new MemoryStorage();
    const older = new CloudAdapter(server, 'user-1', otherStorage);
    const loaded = await older.load();
    const changed = unwrap(addOneTime(loaded, { kind: 'bill', description: 'Phone', amountCents: 6000, date: '2026-10-25' }, clock, 'phone'));
    expect(await older.save(changed, loaded.revision)).toEqual({ ok: true, revision: 2 });
    expect((server.row!.data as AppData).review).toEqual(reviewed().review);
    expect((server.row!.data as AppData).records.map((r) => r.description)).toEqual(['Rent', 'Phone']);
  });

  it('a rhythm that only exists on this device (moved in, or from a restored backup) stays out of the account', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage);
    await adapter.load();
    expect(await adapter.save(reviewed(), 0)).toEqual({ ok: true, revision: 1 });
    expect(server.row!.data).not.toHaveProperty('review');
    // Reopening shows the account as saved: financial data intact, no rhythm.
    const reopened = await new CloudAdapter(server, 'user-1', localStorage).load();
    expect(reopened.records.map((r) => r.description)).toEqual(['Rent']);
    expect(reopened.review).toBeUndefined();
    expect(reopened.revision).toBe(1);
  });
});

describe('existing saved data', () => {
  const old = { schemaVersion: 2, revision: 4, onboardingComplete: true, sources: [], records: [] };

  it('without a review rhythm loads unchanged, with nothing due', () => {
    const d = migrate(old);
    expect(d).toEqual(old);
    expect('review' in d).toBe(false);
    expect(reviewStatus(d, '2026-10-14')).toMatchObject({ cadence: 'off', due: false });
  });

  it('keeps a valid rhythm and its latest review', () => {
    const review = { cadence: 'payday', handledOn: '2026-10-15', outcome: 'skipped' };
    expect(migrate({ ...old, review }).review).toEqual(review);
  });

  it('drops a damaged rhythm instead of refusing the whole document', () => {
    expect(migrate({ ...old, review: { cadence: 'daily', handledOn: null, outcome: null } })).toEqual(old);
    expect(migrate({ ...old, review: 'weekly' })).toEqual(old);
    // A bad date can't mark anything reviewed.
    expect(migrate({ ...old, review: { cadence: 'weekly', handledOn: 'yesterday', outcome: 'completed' } }).review).toEqual({ cadence: 'weekly', handledOn: null, outcome: null });
  });
});
