import { describe, expect, it } from 'vitest';
import { addOneTime, addSource, emptyData } from '../../domain/operations';
import { buildSampleData } from '../../domain/sample';
import { BACKUP_FORMAT, createBackup, readBackup } from '../backup';

const clock = { today: '2026-10-11', now: '2026-10-11T12:00:00Z' };

function data() {
  let r = addSource(emptyData(), { kind: 'income', description: 'Pay', amountCents: 180000, startDate: '2026-10-15', rule: { type: 'biweekly' }, tags: ['Work'] }, clock, 'pay');
  if (!r.ok) throw new Error(r.error);
  r = addOneTime({ ...r.data, onboardingComplete: true, revision: 7 }, { kind: 'bill', description: 'Repair', amountCents: 5000, date: '2026-10-20' }, clock, 'rep');
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
