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

describe('migrating data saved by earlier builds', () => {
  beforeEach(() => localStorage.clear());

  it('turns the old "expense" kind into bills, drops the old fixed categories, and adds empty tags', () => {
    const old = {
      schemaVersion: 1,
      onboardingComplete: true,
      sources: [
        { id: 'r', kind: 'expense', description: 'Rent', category: 'Housing', versions: [{ id: 'v', startDate: '2026-11-01', amountCents: 120000, rule: { type: 'monthly' } }], active: true, endDate: null, createdAt: 'x', updatedAt: 'x' },
      ],
      records: [
        { id: 'one', sourceId: null, kind: 'expense', description: 'Repair', expectedDate: '2026-10-20', expectedAmountCents: 5000, scheduledDate: '2026-10-20', scheduledAmountCents: 5000, status: 'scheduled', actualDate: null, actualAmountCents: null, completedAt: null, canceledAt: null, cancelNote: null, createdAt: 'x', updatedAt: 'x' },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(old));
    const data = new LocalStorageAdapter().load();
    expect(data.sources[0]).toMatchObject({ kind: 'bill', tags: [], pausedRanges: [] });
    expect(data.records[0]).toMatchObject({ kind: 'bill', tags: [] });
  });

  it('keeps valid liability types and drops anything else so the user is asked again', () => {
    const v = [{ id: 'v', startDate: '2026-11-01', amountCents: 5000, rule: { type: 'monthly' } }];
    const base = { active: true, endDate: null, createdAt: 'x', updatedAt: 'x', versions: v, tags: [] };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        onboardingComplete: true,
        sources: [
          { ...base, id: 'a', kind: 'liability', description: 'Card', liabilityType: 'card' },
          { ...base, id: 'b', kind: 'liability', description: 'Mystery', liabilityType: 'misc' },
          { ...base, id: 'c', kind: 'bill', description: 'Rent', liabilityType: 'loan' },
        ],
        records: [],
      }),
    );
    const [a, b, c] = new LocalStorageAdapter().load().sources;
    expect(a!.liabilityType).toBe('card');
    expect(b!.liabilityType).toBeUndefined();
    expect(c!.liabilityType).toBeUndefined();
  });
});
