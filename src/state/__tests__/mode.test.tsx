import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { addSource, emptyData } from '../../domain/operations';
import { DataModeProvider, useDataMode } from '../mode';
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
