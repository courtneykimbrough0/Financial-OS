import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { addSource, emptyData } from '../../domain/operations';
import { DataModeProvider, SAMPLE_UNAVAILABLE, useDataMode } from '../mode';
import { LocalStorageAdapter, SAMPLE_STORAGE_KEY, STORAGE_KEY } from '../storage';
import { useStore } from '../store';

let api: ReturnType<typeof useDataMode>;
function Probe() {
  api = useDataMode();
  const { data } = useStore();
  return (
    <p>
      {api.mode}:{data.sources.map((s) => s.description).join(',')}
    </p>
  );
}

describe('DataModeProvider', () => {
  beforeEach(() => localStorage.clear());

  it('keeps sample data separate from real data', async () => {
    const r = addSource(emptyData(), { kind: 'income', description: 'My job', amountCents: 100000, startDate: '2099-01-01', rule: { type: 'monthly' } }, { today: '2026-10-11', now: 'x' });
    if (!r.ok) throw new Error(r.error);
    await new LocalStorageAdapter().save(r.data, 0);
    const realBefore = localStorage.getItem(STORAGE_KEY);

    render(
      <DataModeProvider>
        <Probe />
      </DataModeProvider>,
    );
    expect(await screen.findByText('real:My job')).toBeInTheDocument();

    await act(() => api.enterSample());
    expect(await screen.findByText(/^sample:.*Paycheck/)).toBeInTheDocument();
    expect(screen.queryByText(/My job/)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(realBefore);
    expect(localStorage.getItem(SAMPLE_STORAGE_KEY)).not.toBeNull();

    act(() => api.exitSample());
    expect(await screen.findByText('real:My job')).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(realBefore);
    expect(localStorage.getItem(SAMPLE_STORAGE_KEY)).toBeNull();
  });
});

/** Browser storage that refuses writes to one key, as a full or blocked store does. */
function refusing(key: string): Storage {
  const base = window.localStorage;
  return {
    get length() {
      return base.length;
    },
    key: (i: number) => base.key(i),
    getItem: (k: string) => base.getItem(k),
    removeItem: (k: string) => base.removeItem(k),
    clear: () => base.clear(),
    setItem: (k: string, v: string) => {
      if (k === key) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      base.setItem(k, v);
    },
  };
}

describe("when the device won't store the sample data (defect D5)", () => {
  beforeEach(() => localStorage.clear());

  it("says so, stays on the person's own data, and leaves it untouched", async () => {
    const r = addSource(emptyData(), { kind: 'income', description: 'My job', amountCents: 100000, startDate: '2099-01-01', rule: { type: 'monthly' } }, { today: '2026-10-11', now: 'x' });
    if (!r.ok) throw new Error(r.error);
    await new LocalStorageAdapter().save(r.data, 0);
    const realBefore = localStorage.getItem(STORAGE_KEY);
    render(
      <DataModeProvider storage={refusing(SAMPLE_STORAGE_KEY)}>
        <Probe />
      </DataModeProvider>,
    );
    expect(await screen.findByText('real:My job')).toBeInTheDocument();
    let result: Awaited<ReturnType<typeof api.enterSample>> | undefined;
    await act(async () => {
      result = await api.enterSample();
    });
    expect(result).toEqual({ ok: false, message: SAMPLE_UNAVAILABLE });
    expect(screen.getByText('real:My job')).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(realBefore);
    expect(localStorage.getItem(SAMPLE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('financial-os:mode')).toBeNull();
  });

  it('a failure after the sample is saved leaves nothing half set up', async () => {
    render(
      <DataModeProvider storage={refusing('financial-os:mode')}>
        <Probe />
      </DataModeProvider>,
    );
    await screen.findByText(/^real:/);
    let result: Awaited<ReturnType<typeof api.enterSample>> | undefined;
    await act(async () => {
      result = await api.enterSample();
    });
    expect(result).toEqual({ ok: false, message: SAMPLE_UNAVAILABLE });
    expect(screen.getByText(/^real:/)).toBeInTheDocument();
    expect(localStorage.getItem(SAMPLE_STORAGE_KEY)).toBeNull();
  });
});
