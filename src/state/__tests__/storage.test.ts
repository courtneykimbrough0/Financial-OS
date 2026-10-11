import { beforeEach, describe, expect, it } from 'vitest';
import { addSource, emptyData, recordActual } from '../../domain/operations';
import { LocalStorageAdapter, STORAGE_KEY } from '../storage';

const clock = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };

describe('LocalStorageAdapter', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and round-trips data, including recorded outcomes', () => {
    const adapter = new LocalStorageAdapter();
    expect(adapter.load()).toEqual(emptyData());
    let r = addSource(emptyData(), { kind: 'income', description: 'Pay', amountCents: 180000, startDate: '2026-10-11', rule: { type: 'biweekly' } }, clock, 'pay');
    if (!r.ok) throw new Error(r.error);
    r = recordActual(r.data, 'pay@2026-10-11', { amountCents: 165000, date: '2026-10-11' }, clock);
    if (!r.ok) throw new Error(r.error);
    adapter.save(r.data);
    expect(new LocalStorageAdapter().load()).toEqual(r.data);
  });

  it('keeps an unreadable copy instead of silently discarding damaged data', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const data = new LocalStorageAdapter().load();
    expect(data).toEqual(emptyData());
    const backups = Object.keys(localStorage).filter((k) => k.startsWith(`${STORAGE_KEY}:unreadable:`));
    expect(backups).toHaveLength(1);
    expect(localStorage.getItem(backups[0]!)).toBe('{not json');
  });
});
