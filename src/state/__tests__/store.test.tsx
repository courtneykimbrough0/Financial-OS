import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addOneTime, emptyData } from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { MemoryAdapter, type SaveResult, type StorageAdapter } from '../storage';
import { StoreProvider, useStore } from '../store';

const TODAY = '2026-10-11';
let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <p>items:{store.data.records.length}</p>;
}

async function mount(adapter: StorageAdapter) {
  render(
    <StoreProvider adapter={adapter} today={TODAY}>
      <Probe />
    </StoreProvider>,
  );
  await screen.findByText(/^items:/);
}

const addItem = (n: number) =>
  act(() => {
    store.run((d, c) => addOneTime(d, { kind: 'bill', description: `Bill ${n}`, amountCents: 1000, date: '2026-10-20' }, c, `one-${n}`));
  });

/** Adapter whose saves wait until the test releases them, to observe in-flight behavior. */
class SlowAdapter extends MemoryAdapter {
  pending: (() => void)[] = [];
  override async save(data: AppData, base: number): Promise<SaveResult> {
    await new Promise<void>((resolve) => this.pending.push(resolve));
    return super.save(data, base);
  }
  release() {
    const next = this.pending.shift();
    next?.();
  }
}

describe('StoreProvider saving', () => {
  it('shows a loading state, then the loaded data', async () => {
    render(
      <StoreProvider adapter={new MemoryAdapter()} today={TODAY}>
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText('Loading your forecast…')).toBeInTheDocument();
    expect(await screen.findByText('items:0')).toBeInTheDocument();
  });

  it('applies changes immediately and saves them in the background', async () => {
    const adapter = new MemoryAdapter();
    await mount(adapter);
    await addItem(1);
    expect(screen.getByText('items:1')).toBeInTheDocument();
    await waitFor(async () => expect((await adapter.load()).records).toHaveLength(1));
    expect((await adapter.load()).revision).toBe(1);
    expect(store.saveStatus).toBe('idle');
  });

  it('saves one at a time and folds changes made during a save into the next one', async () => {
    const adapter = new SlowAdapter();
    await mount(adapter);
    await addItem(1);
    await waitFor(() => expect(store.saveStatus).toBe('saving'));
    await addItem(2);
    await addItem(3);
    expect(adapter.pending).toHaveLength(1);
    await act(async () => adapter.release());
    await waitFor(() => expect(adapter.pending).toHaveLength(1));
    await act(async () => adapter.release());
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    const saved = await adapter.load();
    expect(saved.records).toHaveLength(3);
    expect(saved.revision).toBe(2);
    expect(adapter.saves).toBe(2);
  });

  it('reports a failed save, keeps the change on screen, and saves it on retry', async () => {
    const adapter = new MemoryAdapter();
    await mount(adapter);
    adapter.failNext = true;
    await addItem(1);
    await waitFor(() => expect(store.saveStatus).toBe('error'));
    expect(screen.getByText('items:1')).toBeInTheDocument();
    expect((await adapter.load()).records).toHaveLength(0);
    await act(async () => store.retrySave());
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect((await adapter.load()).records).toHaveLength(1);
  });

  it('stops on a conflict, blocks further changes, and reloads the newer data', async () => {
    const adapter = new MemoryAdapter();
    await mount(adapter);
    // Another device saves first.
    const r = addOneTime(emptyData(), { kind: 'income', description: 'From elsewhere', amountCents: 5000, date: '2026-10-20' }, { today: TODAY, now: 'x' }, 'other');
    if (!r.ok) throw new Error(r.error);
    adapter.externalWrite(r.data);
    await addItem(1);
    await waitFor(() => expect(store.saveStatus).toBe('conflict'));
    let blocked: ReturnType<typeof store.run> | null = null;
    act(() => {
      blocked = store.run((d, c) => addOneTime(d, { kind: 'bill', description: 'x', amountCents: 100, date: '2026-10-21' }, c));
    });
    expect(blocked).toMatchObject({ ok: false });
    await act(async () => store.reload());
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect(store.data.records.map((x) => x.description)).toEqual(['From elsewhere']);
  });
});
