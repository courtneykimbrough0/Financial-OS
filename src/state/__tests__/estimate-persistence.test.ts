import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeEstimate, dismissEstimate } from '../../domain/estimates';
import { addSource, emptyData, recordActual } from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { CloudAdapter } from '../cloud';
import { LocalStorageAdapter, migrate } from '../storage';
import { FakeServer } from './fake-server';

const TODAY = '2026-10-16';
const clock = { today: TODAY, now: `${TODAY}T12:00:00Z` };
const unwrap = (r: { ok: true; data: AppData } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

/** Phone estimated at $60, paid $65 three times, and the $65 suggestion dismissed. */
function dismissed(): AppData {
  let d = unwrap(addSource(emptyData(), { kind: 'bill', description: 'Phone', amountCents: 6000, startDate: '2026-01-25', rule: { type: 'monthly' } }, { today: '2026-01-25', now: '2026-01-25T12:00:00Z' }, 'phone'));
  for (const date of ['2026-07-25', '2026-08-25', '2026-09-25']) d = unwrap(recordActual(d, `phone@${date}`, { amountCents: 6500, date }, clock));
  return unwrap(dismissEstimate(d, analyzeEstimate(d, 'phone', TODAY).suggestion!, clock));
}
const DISMISSAL = { currentCents: 6000, proposedCents: 6500, through: '2026-09-25' };
const phone = (d: AppData) => d.sources.find((s) => s.id === 'phone')!;

describe('a dismissed suggestion stays dismissed', () => {
  beforeEach(() => localStorage.clear());

  it('on the device, across a reload', async () => {
    await new LocalStorageAdapter().save(dismissed(), 0);
    const loaded = await new LocalStorageAdapter().load();
    expect(phone(loaded).estimateDismissal).toEqual(DISMISSAL);
    expect(analyzeEstimate(loaded, 'phone', TODAY).reason).toBe('dismissed');
  });

  it('in a backup file', () => {
    const restored = readBackup(createBackup(dismissed()).text).data;
    expect(phone(restored).estimateDismissal).toEqual(DISMISSAL);
  });

  it('in account saves, as part of the item, with no new document field', async () => {
    const server = new FakeServer();
    const adapter = new CloudAdapter(server, 'user-1', localStorage);
    await adapter.load();
    expect(await adapter.save(dismissed(), 0)).toEqual({ ok: true, revision: 1 });
    const doc = server.row!.data as AppData;
    expect(Object.keys(doc).sort()).toEqual(['onboardingComplete', 'records', 'revision', 'schemaVersion', 'sources']);
    expect(phone(doc).estimateDismissal).toEqual(DISMISSAL);
  });
});

describe('existing saved data', () => {
  const src = {
    id: 'phone',
    kind: 'bill',
    description: 'Phone',
    tags: [],
    versions: [{ id: 'v1', startDate: '2026-01-25', amountCents: 6000, rule: { type: 'monthly' } }],
    active: true,
    endDate: null,
    pausedRanges: [],
    createdAt: '2026-01-25T12:00:00Z',
    updatedAt: '2026-01-25T12:00:00Z',
  };
  const old = { schemaVersion: 2, revision: 3, onboardingComplete: true, sources: [src], records: [] };

  it('without dismissals loads unchanged', () => {
    expect(migrate(old)).toEqual(old);
  });

  it('drops a damaged dismissal instead of refusing the document', () => {
    for (const bad of ['yes', { currentCents: 6000, proposedCents: 6500 }, { currentCents: -1, proposedCents: 6500, through: '2026-09-25' }, { currentCents: 6000, proposedCents: 65.5, through: '2026-09-25' }, { currentCents: 6000, proposedCents: 6500, through: 'Sep 25' }]) {
      expect(migrate({ ...old, sources: [{ ...src, estimateDismissal: bad }] })).toEqual(old);
    }
  });

  it('keeps only the three dismissal fields', () => {
    const d = migrate({ ...old, sources: [{ ...src, estimateDismissal: { ...DISMISSAL, note: 'x' } }] });
    expect(phone(d).estimateDismissal).toEqual(DISMISSAL);
  });
});
