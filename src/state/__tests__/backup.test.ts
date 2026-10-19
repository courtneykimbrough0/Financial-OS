import { describe, expect, it } from 'vitest';
import { addOneTime, addSource, emptyData } from '../../domain/operations';
import { buildSampleData } from '../../domain/sample';
import { BACKUP_FORMAT, createBackup, readBackup } from '../backup';

const clock = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };

function data() {
  let r = addSource(emptyData(), { kind: 'income', description: 'Pay', amountCents: 180000, startDate: '2026-10-15', rule: { type: 'biweekly' }, tags: ['Work'] }, clock, 'pay');
  if (!r.ok) throw new Error(r.error);
  r = addOneTime({ ...r.data, onboardingComplete: true, revision: 7 }, { kind: 'varied', description: 'Repair', amountCents: 5000, date: '2026-10-20' }, clock, 'rep');
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe('backups', () => {
  it('round-trip everything the user entered', () => {
    const original = data();
    const { filename, text } = createBackup(original, new Date(2026, 9, 11, 9));
    expect(filename).toBe('financial-os-backup-2026-10-11.json');
    expect(JSON.parse(text).format).toBe(BACKUP_FORMAT);
    const restored = readBackup(text);
    expect(restored.data).toEqual(original);
    expect(restored.itemCount).toBe(2);
    expect(restored.exportedAt).toBe(new Date(2026, 9, 11, 9).toISOString());
  });

  it('never carry the sample-data flag', () => {
    const { text } = createBackup(buildSampleData('2026-10-11'));
    expect(readBackup(text).data.isSample).toBeUndefined();
  });

  it('reject files that are not backups, with a plain message', () => {
    expect(() => readBackup('not json')).toThrow('This file isn’t a Financial OS backup.');
    expect(() => readBackup(JSON.stringify({ hello: 'world' }))).toThrow('This file isn’t a Financial OS backup.');
    expect(() => readBackup(JSON.stringify({ format: BACKUP_FORMAT, data: { schemaVersion: 99 } }))).toThrow(/damaged or from a newer version/);
    expect(() => readBackup(JSON.stringify({ format: BACKUP_FORMAT, data: { schemaVersion: 2, sources: [{ id: 1 }], records: [] } }))).toThrow(/damaged/);
  });
});

describe('a backup reproduces the forecast', () => {
  it('keeps schedule changes, recorded outcomes, one-time items, the review rhythm and estimate dismissals', async () => {
    const { analyzeEstimate, dismissEstimate } = await import('../../domain/estimates');
    const { buildForecast } = await import('../../domain/forecast');
    const ops = await import('../../domain/operations');
    const c = (today: string) => ({ today, now: `${today}T12:00:00Z` });
    const u = (r: ReturnType<typeof ops.addSource>) => {
      if (!r.ok) throw new Error(r.error);
      return r.data;
    };
    let d = u(ops.addSource(emptyData(), { kind: 'income', description: 'Pay', amountCents: 100000, startDate: '2026-06-05', rule: { type: 'biweekly' } }, c('2026-06-01'), 'pay'));
    d = u(ops.addSource(d, { kind: 'bill', description: 'Phone', amountCents: 6000, startDate: '2026-07-25', rule: { type: 'monthly' } }, c('2026-07-01'), 'phone'));
    for (const date of ['2026-07-25', '2026-08-25', '2026-09-25']) d = u(ops.recordActual(d, `phone@${date}`, { amountCents: 6500, date }, c('2026-10-16')));
    d = u(dismissEstimate(d, analyzeEstimate(d, 'phone', '2026-10-16').suggestion!, c('2026-10-16')));
    d = u(ops.changeSourceSchedule(d, 'pay', { startDate: '2026-10-30', amountCents: 110000, rule: { type: 'biweekly' } }, c('2026-10-16')));
    d = u(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: 8000, date: '2026-11-03' }, c('2026-10-16'), 'rep'));
    d = { ...d, onboardingComplete: true, revision: 12 };
    const restored = readBackup(createBackup(d).text).data;
    expect(restored).toEqual(d);
    expect(restored.sources.find((s) => s.id === 'phone')!.estimateDismissal).toEqual({ currentCents: 6000, proposedCents: 6500, through: '2026-09-25' });
    expect(buildForecast(restored, '2026-10-16')).toEqual(buildForecast(d, '2026-10-16'));
  });
});
