import { beforeEach, describe, expect, it } from 'vitest';
import { buildForecast } from '../../domain/forecast';
import { variance } from '../../domain/occurrences';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../backup';
import { LocalStorageAdapter } from '../storage';

const clock = (today: string) => ({ today, now: `${today}T12:00:00.000Z` });

function unwrap(r: ops.Result): AppData {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** Prediction, latest expectation and actual all differ, plus a cancellation and a paused stretch. */
function withHistory(): AppData {
  let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Pay', amountCents: 180000, startDate: '2026-10-15', rule: { type: 'biweekly' } }, clock('2026-10-11'), 'pay'));
  d = unwrap(ops.addSource(d, { kind: 'bill', description: 'Rent', amountCents: 100000, startDate: '2026-11-01', rule: { type: 'monthly' } }, clock('2026-10-11'), 'rent'));
  d = unwrap(ops.addSource(d, { kind: 'bill', description: 'Gym', amountCents: 4000, startDate: '2026-10-20', rule: { type: 'monthly' } }, clock('2026-10-11'), 'gym'));
  d = unwrap(ops.rescheduleOccurrence(d, 'rent@2026-11-01', { date: '2026-11-04', amountCents: 105000 }, clock('2026-10-11')));
  d = unwrap(ops.recordActual(d, 'rent@2026-11-01', { amountCents: 106000, date: '2026-11-05' }, clock('2026-11-05')));
  d = unwrap(ops.cancelOccurrence(d, 'gym@2026-11-20', 'Away', clock('2026-11-05')));
  d = unwrap(ops.deactivateSource(d, 'gym', clock('2026-11-05')));
  d = unwrap(ops.reactivateSource(d, 'gym', '2027-01-20', clock('2026-11-06')));
  return unwrap(ops.changeSourceSchedule(d, 'rent', { startDate: '2027-01-01', amountCents: 110000, rule: { type: 'monthly' } }, clock('2026-11-06')));
}

describe('history survives storage and backups', () => {
  beforeEach(() => localStorage.clear());

  it('on the device: every prediction, change and actual comes back unchanged', async () => {
    const d = withHistory();
    await new LocalStorageAdapter().save(d, 0);
    const loaded = await new LocalStorageAdapter().load();
    expect(loaded).toEqual({ ...d, revision: 1 });
    expect(buildForecast(loaded, '2026-11-06')).toEqual(buildForecast(d, '2026-11-06'));
  });

  it('in a backup file', () => {
    const d = withHistory();
    const restored = readBackup(createBackup(d).text).data;
    expect(restored).toEqual(d);
    const rent = restored.records.find((r) => r.id === 'rent@2026-11-01')!;
    expect([rent.expectedDate, rent.expectedAmountCents, rent.scheduledDate, rent.scheduledAmountCents, rent.actualDate, rent.actualAmountCents]).toEqual([
      '2026-11-01', 100000, '2026-11-04', 105000, '2026-11-05', 106000,
    ]);
    expect(variance(rent)).toEqual({ amountCents: 6000, days: 4 });
    expect(buildForecast(restored, '2026-11-06')).toEqual(buildForecast(d, '2026-11-06'));
  });
});
