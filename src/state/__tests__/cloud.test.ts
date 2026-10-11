import { beforeEach, describe, expect, it } from 'vitest';
import { addOneTime, emptyData } from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { CloudAdapter, cloudCacheKey, hasPendingDeviceChanges, OFFLINE_MESSAGE } from '../cloud';
import { FakeServer } from './fake-server';

const USER = 'user-1';
const clock = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };

function withBill(data: AppData, name: string): AppData {
  const r = addOneTime(data, { kind: 'bill', description: name, amountCents: 1000, date: '2026-10-20' }, clock, name);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const names = (d: AppData) => d.records.map((r) => r.description);

describe('CloudAdapter', () => {
  let server: FakeServer;
  let adapter: CloudAdapter;
  beforeEach(() => {
    localStorage.clear();
    server = new FakeServer();
    adapter = new CloudAdapter(server, USER, localStorage);
  });

  it('starts empty, saves with revisions, and rejects stale saves', async () => {
    const start = await adapter.load();
    expect(start.revision).toBe(0);
    expect(await adapter.save(withBill(start, 'A'), 0)).toEqual({ ok: true, revision: 1 });
    expect(await adapter.save(withBill(start, 'B'), 1)).toEqual({ ok: true, revision: 2 });
    expect(await adapter.save(withBill(start, 'C'), 1)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(server.row?.revision).toBe(2);
    expect(names(server.row!.data)).toEqual(['B']);
  });

  it('keeps a device copy and opens from it offline', async () => {
    await adapter.load();
    await adapter.save(withBill(emptyData(), 'Rent'), 0);
    expect(hasPendingDeviceChanges(USER, localStorage)).toBe(false);
    server.offline = true;
    const fresh = new CloudAdapter(server, USER, localStorage);
    const loaded = await fresh.load();
    expect(names(loaded)).toEqual(['Rent']);
    expect(loaded.revision).toBe(1);
    expect(fresh.hasUnsavedChanges()).toBe(false);
  });

  it('fails to load offline only when there is no device copy', async () => {
    server.offline = true;
    await expect(adapter.load()).rejects.toThrow();
  });

  it('keeps an offline change on the device and sends it once back online', async () => {
    await adapter.load();
    server.offline = true;
    const result = await adapter.save(withBill(emptyData(), 'Offline bill'), 0);
    expect(result).toEqual({ ok: false, reason: 'error', message: OFFLINE_MESSAGE });
    expect(hasPendingDeviceChanges(USER, localStorage)).toBe(true);

    // The app is closed and reopened, still offline: the change is there and still pending.
    const reopened = new CloudAdapter(server, USER, localStorage);
    expect(names(await reopened.load())).toEqual(['Offline bill']);
    expect(reopened.hasUnsavedChanges()).toBe(true);

    // Back online: the store retries from the same base.
    server.offline = false;
    expect(await reopened.save(withBill(emptyData(), 'Offline bill'), 0)).toEqual({ ok: true, revision: 1 });
    expect(names(server.row!.data)).toEqual(['Offline bill']);
    expect(hasPendingDeviceChanges(USER, localStorage)).toBe(false);
  });

  it('on load, sends a pending change when nothing changed elsewhere', async () => {
    await adapter.load();
    server.offline = true;
    await adapter.save(withBill(emptyData(), 'Pending'), 0);
    server.offline = false;
    const reopened = new CloudAdapter(server, USER, localStorage);
    expect(names(await reopened.load())).toEqual(['Pending']);
    expect(reopened.hasUnsavedChanges()).toBe(true);
    expect(reopened.recoveredCopy()).toBeNull();
  });

  it('loads newer data from elsewhere and sets the unsent change aside', async () => {
    await adapter.load();
    server.offline = true;
    await adapter.save(withBill(emptyData(), 'From this phone'), 0);
    server.offline = false;
    server.saveElsewhere(withBill(emptyData(), 'From the laptop'));

    const reopened = new CloudAdapter(server, USER, localStorage);
    const loaded = await reopened.load();
    expect(names(loaded)).toEqual(['From the laptop']);
    expect(reopened.hasUnsavedChanges()).toBe(false);
    expect(names(reopened.recoveredCopy()!.data)).toEqual(['From this phone']);
    reopened.discardRecoveredCopy();
    expect(reopened.recoveredCopy()).toBeNull();
  });

  it('a conflicting save stays on the device until the reload sets it aside', async () => {
    await adapter.load();
    server.saveElsewhere(withBill(emptyData(), 'Elsewhere'));
    expect(await adapter.save(withBill(emptyData(), 'Mine'), 0)).toMatchObject({ reason: 'conflict' });
    const loaded = await adapter.load();
    expect(names(loaded)).toEqual(['Elsewhere']);
    expect(names(adapter.recoveredCopy()!.data)).toEqual(['Mine']);
  });

  it('never sends the sample flag, and sign-out removes the device copy', async () => {
    await adapter.load();
    await adapter.save({ ...withBill(emptyData(), 'X'), isSample: true }, 0);
    expect(server.row!.data.isSample).toBeUndefined();
    expect(localStorage.getItem(cloudCacheKey(USER))).not.toBeNull();
    adapter.forgetDevice();
    expect(localStorage.getItem(cloudCacheKey(USER))).toBeNull();
  });

  it('keeps each account’s device copy separate', async () => {
    await adapter.save(withBill(emptyData(), 'Mine'), 0);
    const other = new CloudAdapter(new FakeServer(), 'user-2', localStorage);
    expect((await other.load()).records).toHaveLength(0);
  });
});
