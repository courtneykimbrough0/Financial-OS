import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addOneTime, emptyData } from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { MemoryAdapter, type SaveResult, type StorageAdapter } from '../storage';
import { StoreProvider, useStore } from '../store';

/*
 * Loads and saves that finish in an unexpected order: a reload or a switch of
 * storage (signing in or out) while a save is still on its way, and a load
 * that finishes late. None of these may lose or overwrite a change, or report
 * a save that didn't happen.
 */
const TODAY = '2026-10-11';
let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <p>items:{store.data.records.map((r) => r.description).join(',')}</p>;
}

function mount(adapter: StorageAdapter) {
  const view = render(
    <StoreProvider adapter={adapter} today={TODAY}>
      <Probe />
    </StoreProvider>,
  );
  return {
    switchTo: (next: StorageAdapter) =>
      view.rerender(
        <StoreProvider adapter={next} today={TODAY}>
          <Probe />
        </StoreProvider>,
      ),
  };
}

const addItem = (n: number) =>
  act(() => {
    store.run((d, c) => addOneTime(d, { kind: 'bill', description: `Bill ${n}`, amountCents: 1000, date: '2026-10-20' }, c, `one-${n}`));
  });

const stored = async (adapter: StorageAdapter) => (await adapter.load()).records.map((r) => r.description);

/** Saves (and optionally loads) wait until the test releases them. */
class SlowAdapter extends MemoryAdapter {
  pendingSaves: (() => void)[] = [];
  pendingLoads: (() => void)[] = [];
  slowLoads = false;
  failSaves = false;
  override async load(): Promise<AppData> {
    if (this.slowLoads) await new Promise<void>((resolve) => this.pendingLoads.push(resolve));
    return super.load();
  }
  override async save(data: AppData, base: number): Promise<SaveResult> {
    await new Promise<void>((resolve) => this.pendingSaves.push(resolve));
    if (this.failSaves) return { ok: false, reason: 'error', message: 'Offline.' };
    return super.save(data, base);
  }
  releaseSave = () => act(async () => this.pendingSaves.shift()?.());
  releaseLoad = () => act(async () => this.pendingLoads.shift()?.());
}

function withItems(...names: string[]): AppData {
  let d = emptyData();
  for (const [i, name] of names.entries()) {
    const r = addOneTime(d, { kind: 'bill', description: name, amountCents: 500, date: '2026-10-20' }, { today: TODAY, now: `${TODAY}T12:00:00Z` }, `seed-${i}`);
    if (!r.ok) throw new Error(r.error);
    d = r.data;
  }
  return { ...d, revision: 3 };
}

describe('StoreProvider load and save ordering', () => {
  it('loads normally, and a reload with nothing pending shows the saved data', async () => {
    const adapter = new MemoryAdapter(withItems('Rent'));
    mount(adapter);
    await screen.findByText('items:Rent');
    await addItem(1);
    await waitFor(async () => expect(await stored(adapter)).toEqual(['Rent', 'Bill 1']));
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    act(() => store.reload());
    await screen.findByText('items:Rent,Bill 1');
    expect(store.saveStatus).toBe('idle');
  });

  it('a reload during a save waits for it, so the change is neither lost nor overwritten later', async () => {
    const adapter = new SlowAdapter();
    mount(adapter);
    await screen.findByText('items:');
    await addItem(1);
    act(() => store.reload());
    await adapter.releaseSave();
    await screen.findByText('items:Bill 1');
    await addItem(2);
    await adapter.releaseSave();
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect(await stored(adapter)).toEqual(['Bill 1', 'Bill 2']);
  });

  it('switching storage during a save: the late result doesn’t touch the new storage', async () => {
    const device = new SlowAdapter();
    const account = new MemoryAdapter(withItems('Rent'));
    const { switchTo } = mount(device);
    await screen.findByText('items:');
    await addItem(1);
    switchTo(account);
    await device.releaseSave();
    await screen.findByText('items:Rent');
    // Before the fix, the late save's revision replaced the account's, so this save was refused as a conflict.
    await addItem(2);
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect(await stored(account)).toEqual(['Rent', 'Bill 2']);
    expect(await stored(device)).toEqual(['Bill 1']);
  });

  it('switching storage during a save that then fails doesn’t report the new storage as unsaved', async () => {
    const device = new SlowAdapter();
    device.failSaves = true;
    const account = new MemoryAdapter(withItems('Rent'));
    const { switchTo } = mount(device);
    await screen.findByText('items:');
    await addItem(1);
    switchTo(account);
    await device.releaseSave();
    await screen.findByText('items:Rent');
    expect(store.saveStatus).toBe('idle');
    expect(account.saves).toBe(0);
  });

  it('a load that finishes after a newer one is ignored', async () => {
    const first = new SlowAdapter(withItems('Old'));
    first.slowLoads = true;
    const second = new MemoryAdapter(withItems('New'));
    const { switchTo } = mount(first);
    switchTo(second);
    await screen.findByText('items:New');
    await first.releaseLoad();
    expect(screen.getByText('items:New')).toBeInTheDocument();
    await addItem(1);
    await waitFor(async () => expect(await stored(second)).toEqual(['New', 'Bill 1']));
  });

  it('a failed save keeps the change for retry; a reload after a conflict shows the newer data', async () => {
    const adapter = new MemoryAdapter(withItems('Rent'));
    mount(adapter);
    await screen.findByText('items:Rent');
    adapter.failNext = true;
    await addItem(1);
    await waitFor(() => expect(store.saveStatus).toBe('error'));
    expect(screen.getByText('items:Rent,Bill 1')).toBeInTheDocument();
    await act(async () => store.retrySave());
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect(await stored(adapter)).toEqual(['Rent', 'Bill 1']);

    adapter.externalWrite(withItems('Rent', 'Phone'));
    await addItem(2);
    await waitFor(() => expect(store.saveStatus).toBe('conflict'));
    act(() => store.reload());
    await screen.findByText('items:Rent,Phone');
    expect(store.saveStatus).toBe('idle');
  });

  it('sends changes that were kept on the device (not yet in the account) as soon as it loads', async () => {
    class PendingAdapter extends MemoryAdapter {
      pending = true;
      hasUnsavedChanges = () => this.pending;
      override async save(data: AppData, base: number) {
        const r = await super.save(data, base);
        if (r.ok) this.pending = false;
        return r;
      }
    }
    const adapter = new PendingAdapter(withItems('Offline change'));
    mount(adapter);
    await screen.findByText('items:Offline change');
    await waitFor(() => expect(adapter.saves).toBe(1));
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect(adapter.pending).toBe(false);
  });
});
