import { beforeEach, describe, expect, it } from 'vitest';
import { addSource, emptyData, recordActual } from '../../domain/operations';
import { LocalStorageAdapter, migrate, STORAGE_KEY } from '../storage';

const clock = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };

describe('LocalStorageAdapter', () => {
  beforeEach(() => localStorage.clear());

  function sampleData() {
    let r = addSource(emptyData(), { kind: 'income', description: 'Pay', amountCents: 180000, startDate: '2026-10-11', rule: { type: 'biweekly' } }, clock, 'pay');
    if (!r.ok) throw new Error(r.error);
    r = recordActual(r.data, 'pay@2026-10-11', { amountCents: 165000, date: '2026-10-11' }, clock);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }

  it('starts empty and round-trips data, including recorded outcomes', async () => {
    const adapter = new LocalStorageAdapter();
    expect(await adapter.load()).toEqual(emptyData());
    const data = sampleData();
    expect(await adapter.save(data, 0)).toEqual({ ok: true, revision: 1 });
    expect(await new LocalStorageAdapter().load()).toEqual({ ...data, revision: 1 });
  });

  it('increments the revision on each save and rejects saves based on an old revision', async () => {
    const a = new LocalStorageAdapter();
    const b = new LocalStorageAdapter(); // e.g. a second tab
    const data = sampleData();
    expect(await a.save(data, 0)).toEqual({ ok: true, revision: 1 });
    expect(await a.save(data, 1)).toEqual({ ok: true, revision: 2 });
    // The second tab still thinks revision 1 is current.
    const stale = await b.save({ ...data, onboardingComplete: true }, 1);
    expect(stale).toMatchObject({ ok: false, reason: 'conflict' });
    expect((await a.load()).onboardingComplete).toBe(false);
    expect((await a.load()).revision).toBe(2);
  });

  it('reports a failed write instead of throwing', async () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} } as unknown as Storage;
    expect(await new LocalStorageAdapter(broken).save(emptyData(), 0)).toMatchObject({ ok: false, reason: 'error' });
  });

  it('keeps an unreadable copy instead of silently discarding damaged data', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const data = await new LocalStorageAdapter().load();
    expect(data).toEqual(emptyData());
    const backups = Object.keys(localStorage).filter((k) => k.startsWith(`${STORAGE_KEY}:unreadable:`));
    expect(backups).toHaveLength(1);
    expect(localStorage.getItem(backups[0]!)).toBe('{not json');
  });

  it('upgrades version 1 data to version 2 at revision 0', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, onboardingComplete: true, sources: [], records: [] }));
    expect(await new LocalStorageAdapter().load()).toEqual({ ...emptyData(), onboardingComplete: true });
  });
});

describe('reading saved data', () => {
  beforeEach(() => localStorage.clear());

  it('does not load a document with retired kinds, and keeps the unreadable copy', async () => {
    // "savings", "expense" and "spending" were development-stage kinds; there is no upgrade path for sample data.
    const v = [{ id: 'v', startDate: '2026-11-01', amountCents: 5000, rule: { type: 'monthly' } }];
    for (const kind of ['savings', 'expense', 'spending']) {
      localStorage.clear();
      const text = JSON.stringify({ schemaVersion: 2, revision: 3, onboardingComplete: true, sources: [{ id: 's', kind, description: 'Old', tags: [], versions: v, active: true, endDate: null, pausedRanges: [], createdAt: 'x', updatedAt: 'x' }], records: [] });
      localStorage.setItem(STORAGE_KEY, text);
      expect(await new LocalStorageAdapter().load()).toEqual(emptyData());
      const kept = Object.keys(localStorage).filter((k) => k.startsWith(`${STORAGE_KEY}:unreadable:`));
      expect(kept.map((k) => localStorage.getItem(k))).toEqual([text]);
    }
  });

  it('refuses a one-time bill or a recurring varied spending: recurring obligations recur, varied spending happens once', () => {
    const one = { id: 'one', sourceId: null, kind: 'bill', description: 'Repair', tags: [], expectedDate: '2026-10-20', expectedAmountCents: 5000, scheduledDate: '2026-10-20', scheduledAmountCents: 5000, status: 'scheduled', actualDate: null, actualAmountCents: null, completedAt: null, canceledAt: null, cancelNote: null, createdAt: 'x', updatedAt: 'x' };
    expect(() => migrate({ schemaVersion: 2, sources: [], records: [one] })).toThrow('Saved data is damaged.');
    expect(migrate({ schemaVersion: 2, sources: [], records: [{ ...one, kind: 'varied' }] }).records[0]!.kind).toBe('varied');
    const src = { id: 's', kind: 'varied', description: 'X', tags: [], versions: [{ id: 'v', startDate: '2026-11-01', amountCents: 5000, rule: { type: 'monthly' } }], active: true, endDate: null, pausedRanges: [], createdAt: 'x', updatedAt: 'x' };
    expect(() => migrate({ schemaVersion: 2, sources: [src], records: [] })).toThrow('Saved data is damaged.');
  });

  it('keeps a release only on a one-time reserve', () => {
    const one = { id: 'one', sourceId: null, kind: 'reserve', release: true, description: 'Use', tags: [], expectedDate: '2026-10-20', expectedAmountCents: 5000, scheduledDate: '2026-10-20', scheduledAmountCents: 5000, status: 'scheduled', actualDate: null, actualAmountCents: null, completedAt: null, canceledAt: null, cancelNote: null, createdAt: 'x', updatedAt: 'x' };
    const loaded = migrate({ schemaVersion: 2, sources: [], records: [one, { ...one, id: 'two', kind: 'varied' }, { ...one, id: 'three', release: 'yes' }] });
    expect(loaded.records.map((r) => [r.id, r.release ?? null])).toEqual([
      ['one', true],
      ['two', null],
      ['three', null],
    ]);
  });

  it('keeps valid liability types and drops anything else so the user is asked again', async () => {
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
    const [a, b, c] = (await new LocalStorageAdapter().load()).sources;
    expect(a!.liabilityType).toBe('card');
    expect(b!.liabilityType).toBeUndefined();
    expect(c!.liabilityType).toBeUndefined();
  });
});
