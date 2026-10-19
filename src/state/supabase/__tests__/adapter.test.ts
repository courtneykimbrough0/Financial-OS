import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usd, unwrap } from '../../../domain/__tests__/helpers';
import { addDays } from '../../../domain/dates';
import { analyzeEstimate, dismissEstimate } from '../../../domain/estimates';
import { buildForecast, explainTimingGaps } from '../../../domain/forecast';
import * as ops from '../../../domain/operations';
import type { AppData } from '../../../domain/types';
import type { StorageAdapter } from '../../storage';
import { StoreProvider, useStore } from '../../store';
import { SupabaseStorageAdapter } from '../adapter';
import { toRows } from '../rows';
import { FakeSupabase } from './fake-supabase';
import { clock, richPlan, smallPlan, TODAY } from './fixtures';

const OFFLINE = 'Couldn’t reach the server, so this change isn’t confirmed yet. Check your connection and try again.';
const SIGNED_OUT = 'You’ve been signed out, so this change isn’t saved. Sign in again, then try again.';
const CONFLICT = 'Your data was changed somewhere else, such as another device. Reload to see the latest version.';
const SAVED_BUT_NEWER = 'Your change was saved, but your data has changed somewhere else since. Reload to see the latest version.';

/** An adapter on a fake holding `plan` (or no workspace yet). */
function setup(plan?: AppData) {
  const fake = new FakeSupabase();
  if (plan) fake.workspace = { revision: plan.revision, plan: toRows(plan) };
  let n = 0;
  const adapter = new SupabaseStorageAdapter(fake, () => `save-${++n}`);
  return { fake, adapter };
}
const saveCalls = (fake: FakeSupabase) => fake.calls.filter((c) => c.fn === 'save_plan');
const repair = (d: AppData, dollars: number) => unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(dollars), date: '2026-11-05' }, clock, 'one-repair'));

beforeEach(() => localStorage.clear());

describe('loading', () => {
  it('1–2. with no workspace yet: creates one, once, and loads an empty plan', async () => {
    const { fake, adapter } = setup();
    expect(await adapter.load()).toEqual({ schemaVersion: 2, revision: 0, onboardingComplete: false, sources: [], records: [] });
    expect(fake.calls.map((c) => c.fn)).toEqual(['load_plan', 'create_workspace', 'load_plan']);
    await adapter.load();
    expect(fake.calls.map((c) => c.fn)).toEqual(['load_plan', 'create_workspace', 'load_plan', 'load_plan']);
  });

  it('3. loads a populated plan exactly', async () => {
    const plan = richPlan();
    const { adapter } = setup(plan);
    expect(await adapter.load()).toEqual(plan);
  });

  it('23. a session that has ended fails the load with a plain message', async () => {
    const { fake, adapter } = setup(smallPlan());
    fake.failNext('signed-out');
    await expect(adapter.load()).rejects.toThrow(SIGNED_OUT);
  });
});

describe('saving', () => {
  async function roundTrip(plan: AppData, change: (d: AppData) => AppData) {
    const { fake, adapter } = setup(plan);
    const loaded = await adapter.load();
    const changed = change(loaded);
    const r = await adapter.save(changed, loaded.revision);
    expect(r).toEqual({ ok: true, revision: loaded.revision + 1 });
    const back = await adapter.load();
    expect(back).toEqual({ ...changed, revision: loaded.revision + 1 });
    return { fake, back };
  }

  it('4. an ordinary change is one save_plan call, mode update, and reloads the same', async () => {
    const { fake, back } = await roundTrip(smallPlan(), (d) => repair(d, 80));
    expect(saveCalls(fake).map((c) => [c.args!.p_base_revision, c.args!.p_mode, c.args!.p_save_id])).toEqual([[0, 'update', 'save-1']]);
    expect(back.records.map((r) => [r.id, r.scheduledAmountCents])).toEqual([['one-repair', 8000]]);
  });

  it('5. a recurring schedule change', async () => {
    const { back } = await roundTrip(smallPlan(), (d) => unwrap(ops.changeSourceSchedule(d, 'rent', { startDate: '2026-12-01', amountCents: usd(1550), rule: { type: 'monthly' } }, clock)));
    expect(back.sources.find((s) => s.id === 'rent')!.versions.map((v) => [v.startDate, v.amountCents])).toEqual([
      ['2026-11-01', 150000],
      ['2026-12-01', 155000],
    ]);
  });

  it('6–7. recording an actual payment, then undoing it', async () => {
    const plan = richPlan();
    const { back } = await roundTrip(plan, (d) => unwrap(ops.recordActual(d, 'elec@2026-08-03', { amountCents: usd(212.5), date: '2026-08-05' }, clock)));
    expect(back.records.find((r) => r.id === 'elec@2026-08-03')).toMatchObject({ expectedAmountCents: 18000, actualAmountCents: 21250, actualDate: '2026-08-05', status: 'completed' });
    const { back: undone } = await roundTrip(back, (d) => unwrap(ops.restoreOccurrence(d, 'elec@2026-08-03', clock)));
    expect(undone.records.some((r) => r.id === 'elec@2026-08-03')).toBe(false);
  });

  it('8. a batch marked done, then one item undone', async () => {
    const plan = smallPlan();
    const ids = ['pay@2026-10-23', 'rent@2026-11-01', 'pay@2026-11-06'];
    const { back } = await roundTrip(plan, (d) => unwrap(ops.recordAsExpected(d, ids, { today: '2026-11-06', now: '2026-11-06T12:00:00.000Z' })));
    expect(back.records.map((r) => [r.id, r.actualAmountCents])).toEqual([
      ['pay@2026-10-23', 100000],
      ['rent@2026-11-01', 150000],
      ['pay@2026-11-06', 100000],
    ]);
    const { back: undone } = await roundTrip(back, (d) => unwrap(ops.restoreOccurrence(d, ids[2]!, { today: '2026-11-06', now: '2026-11-06T12:00:00.000Z' })));
    expect(undone.records.map((r) => r.id)).toEqual([ids[0], ids[1]]);
  });

  it('9. an estimate dismissal is kept', async () => {
    const plan = richPlan();
    const { back } = await roundTrip({ ...plan, sources: plan.sources.map((s) => (s.id === 'phone' ? { ...s, estimateDismissal: undefined } : s)).map(stripUndefined) }, (d) => {
      return unwrap(dismissEstimate(d, analyzeEstimate(d, 'phone', TODAY).suggestion!, clock));
    });
    expect(back.sources.find((s) => s.id === 'phone')!.estimateDismissal).toEqual({ currentCents: 6000, proposedCents: 6500, through: '2026-09-25' });
  });

  it('11. a restore is sent as a replace and replaces the plan', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    const backup = richPlan();
    expect(await adapter.save({ ...backup, revision: loaded.revision }, loaded.revision, 'replace')).toEqual({ ok: true, revision: 1 });
    expect(saveCalls(fake)[0]!.args!.p_mode).toBe('replace');
    expect(await adapter.load()).toEqual({ ...backup, revision: 1 });
  });

  it('12. start over is sent as a reset', async () => {
    const { fake, adapter } = setup(richPlan());
    const loaded = await adapter.load();
    expect(await adapter.save(unwrap(ops.startOver(loaded)), loaded.revision, 'reset')).toEqual({ ok: true, revision: 38 });
    expect(saveCalls(fake)[0]!.args!.p_mode).toBe('reset');
    expect(await adapter.load()).toEqual({ schemaVersion: 2, revision: 38, onboardingComplete: false, sources: [], records: [] });
    // A reset that isn't empty is refused, and says why.
    const r = await adapter.save({ ...loaded, revision: 38 }, 38, 'reset');
    expect(r).toEqual({ ok: false, reason: 'error', message: 'This change couldn’t be saved: Starting over needs an empty plan in setup.' });
  });

  it('20. the forecast after saving and reloading is the same, on every day checked', async () => {
    const plan = richPlan();
    const { adapter } = setup({ ...plan, revision: 0, sources: [], records: [] });
    await adapter.load();
    await adapter.save({ ...plan, revision: 0 }, 0, 'replace');
    const back = await adapter.load();
    for (const day of [0, 30, 90, 180, 365].map((n) => addDays(TODAY, n))) {
      const f = (d: AppData) => {
        const fc = buildForecast(d, day);
        return [fc, explainTimingGaps(fc)];
      };
      expect(f(back)).toEqual(f({ ...plan, revision: 1 }));
    }
  });
});

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

describe('failures and conflicts', () => {
  it('13. no connection: reported as not saved, nothing applied, and Try again saves it once', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    const changed = repair(loaded, 80);
    fake.failNext('network-before');
    expect(await adapter.save(changed, 0)).toEqual({ ok: false, reason: 'error', message: OFFLINE });
    expect(fake.workspace!.revision).toBe(0);
    expect(await adapter.save(changed, 0)).toEqual({ ok: true, revision: 1 });
    expect(saveCalls(fake).map((c) => c.args!.p_save_id)).toEqual(['save-1', 'save-1']);
  });

  it('14. a signed-out save is refused and says so; nothing applied', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    fake.failNext('signed-out');
    expect(await adapter.save(repair(loaded, 80), 0)).toEqual({ ok: false, reason: 'error', message: SIGNED_OUT });
    expect(fake.workspace!.revision).toBe(0);
  });

  it('15. a change saved elsewhere first is a conflict', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    fake.externalSave(toRows(repair(loaded, 99)));
    expect(await adapter.save(repair(loaded, 80), 0)).toEqual({ ok: false, reason: 'conflict', message: CONFLICT });
    expect(fake.workspace!.plan.records[0]!.scheduled_amount_cents).toBe(9900);
  });

  it('16. the reply to a save is lost: Try again reuses the save id and is told it was saved, applying nothing twice', async () => {
    const { fake, adapter } = setup(smallPlan());
    const changed = repair(await adapter.load(), 80);
    fake.failNext('network-after');
    expect(await adapter.save(changed, 0)).toEqual({ ok: false, reason: 'error', message: OFFLINE });
    expect(fake.workspace!.revision).toBe(1);
    expect(await adapter.save(changed, 0)).toEqual({ ok: true, revision: 1 });
    expect(saveCalls(fake).map((c) => c.args!.p_save_id)).toEqual(['save-1', 'save-1']);
    expect(fake.workspace!.revision).toBe(1);
  });

  it('a server error before the database ran it is retried under the same id', async () => {
    const { fake, adapter } = setup(smallPlan());
    const changed = repair(await adapter.load(), 80);
    fake.failNext('server-error');
    expect((await adapter.save(changed, 0)).ok).toBe(false);
    expect(await adapter.save(changed, 0)).toEqual({ ok: true, revision: 1 });
    expect(saveCalls(fake).map((c) => c.args!.p_save_id)).toEqual(['save-1', 'save-1']);
  });

  it('17a. a lost save retried after newer saves elsewhere: recognized as saved, not reapplied, and asks for a reload', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    const mine = repair(loaded, 80);
    fake.failNext('network-after');
    await adapter.save(mine, 0);
    const other = toRows({ ...mine, records: [...mine.records, { ...mine.records[0]!, id: 'one-other', description: 'Other' }] });
    fake.externalSave(other);
    expect(await adapter.save(mine, 0)).toEqual({ ok: false, reason: 'conflict', message: SAVED_BUT_NEWER });
    // Nothing reapplied, nothing overwritten, and the revision never went backwards.
    expect(fake.workspace!.revision).toBe(2);
    expect(fake.workspace!.plan).toEqual(other);
  });

  it('17b. a lost save followed by more edits: the adapter checks the lost save went through, then saves the edits on top', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    const first = repair(loaded, 80);
    fake.failNext('network-after');
    await adapter.save(first, 0);
    // Meanwhile the person changed something else; the store sends the whole plan, still based on revision 0.
    const both = unwrap(ops.addOneTime(first, { kind: 'varied', description: 'Dentist', amountCents: usd(120), date: '2026-11-12' }, clock, 'one-dentist'));
    expect(await adapter.save(both, 0)).toEqual({ ok: true, revision: 2 });
    expect(saveCalls(fake).map((c) => [c.args!.p_save_id, c.args!.p_base_revision])).toEqual([
      ['save-1', 0],
      ['save-2', 0],
      ['save-1', 0],
      ['save-3', 1],
    ]);
    expect(fake.workspace!.plan).toEqual(toRows(both));
  });

  it('17c. a lost save, then a save elsewhere, then more edits: a conflict naming that the first change was saved', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    const first = repair(loaded, 80);
    fake.failNext('network-after');
    await adapter.save(first, 0);
    fake.externalSave(toRows(first));
    const both = unwrap(ops.addOneTime(first, { kind: 'varied', description: 'Dentist', amountCents: usd(120), date: '2026-11-12' }, clock, 'one-dentist'));
    expect(await adapter.save(both, 0)).toEqual({ ok: false, reason: 'conflict', message: SAVED_BUT_NEWER });
    expect(fake.workspace!.revision).toBe(2);
  });

  it('17d. a save that never arrived, then a save elsewhere: a plain conflict, nothing applied', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    const first = repair(loaded, 80);
    fake.failNext('network-before');
    await adapter.save(first, 0);
    fake.externalSave(toRows(repair(loaded, 99)));
    expect(await adapter.save(first, 0)).toEqual({ ok: false, reason: 'conflict', message: CONFLICT });
    expect(fake.workspace!.plan.records[0]!.scheduled_amount_cents).toBe(9900);
  });

  it('18. a save id reused for different data is refused, and nothing changes', async () => {
    const fake = new FakeSupabase();
    fake.workspace = { revision: 0, plan: toRows(smallPlan()) };
    const adapter = new SupabaseStorageAdapter(fake, () => 'same-id');
    const loaded = await adapter.load();
    expect(await adapter.save(repair(loaded, 80), 0)).toEqual({ ok: true, revision: 1 });
    const r = await adapter.save(repair({ ...loaded, revision: 1 }, 95), 1);
    expect(r).toEqual({ ok: false, reason: 'error', message: 'This change couldn’t be saved: This save request was already used for a different change.' });
    expect(fake.workspace.plan.records[0]!.scheduled_amount_cents).toBe(8000);
  });

  it('19. a save the database refuses partway is reported, nothing applied, and the next save gets a new id', async () => {
    const { fake, adapter } = setup(smallPlan());
    const changed = repair(await adapter.load(), 80);
    fake.failNext('check-violation');
    expect(await adapter.save(changed, 0)).toEqual({ ok: false, reason: 'error', message: 'This change couldn’t be saved because the data didn’t pass a safety check. Nothing was changed.' });
    expect(fake.workspace!.revision).toBe(0);
    expect(await adapter.save(changed, 0)).toEqual({ ok: true, revision: 1 });
    expect(saveCalls(fake).map((c) => c.args!.p_save_id)).toEqual(['save-1', 'save-2']);
  });

  it('21. keeps nothing on the device and has no offline queue', async () => {
    const { fake, adapter } = setup(smallPlan());
    const loaded = await adapter.load();
    fake.failNext('network-before', 'network-after');
    await adapter.save(repair(loaded, 80), 0);
    await adapter.save(repair(loaded, 80), 0);
    await adapter.save(repair(loaded, 80), 0);
    expect(localStorage.length).toBe(0);
    // None of the offline adapter's pending-change or recovery hooks.
    const asStorage: StorageAdapter = adapter;
    expect([asStorage.hasUnsavedChanges, asStorage.recoveredCopy]).toEqual([undefined, undefined]);
  });
});

describe('with the app’s store', () => {
  let store: ReturnType<typeof useStore>;
  function Spy() {
    store = useStore();
    return null;
  }

  it('22. a change shows as saving, never as saved, until the database confirms; a failure keeps it on screen for Try again', async () => {
    const { fake, adapter } = setup(smallPlan());
    render(createElement(StoreProvider, { adapter, today: TODAY, children: createElement(Spy) }));
    await waitFor(() => expect(store.data.sources).toHaveLength(2));
    fake.hold = true;
    fake.failNext('network-before');
    act(() => {
      store.run((d) => ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(80), date: '2026-11-05' }, clock, 'one-repair'));
    });
    expect(store.saveStatus).toBe('saving');
    await act(async () => fake.release());
    await waitFor(() => expect(store.saveStatus).toBe('error'));
    expect(store.saveMessage).toBe(OFFLINE);
    expect(store.data.records.map((r) => r.description)).toEqual(['Repair']);
    expect(fake.workspace!.revision).toBe(0);
    fake.hold = false;
    act(() => store.retrySave());
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect(fake.workspace!.revision).toBe(1);
    expect(fake.workspace!.plan.records.map((r) => r.description)).toEqual(['Repair']);
    expect(localStorage.length).toBe(0);
  });

  it('23. when the session ends mid-use, the change stays on screen and the message says to sign in again', async () => {
    const { fake, adapter } = setup(smallPlan());
    render(createElement(StoreProvider, { adapter, today: TODAY, children: createElement(Spy) }));
    await waitFor(() => expect(store.data.sources).toHaveLength(2));
    fake.failNext('signed-out');
    act(() => {
      store.run((d) => ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(80), date: '2026-11-05' }, clock, 'one-repair'));
    });
    await waitFor(() => expect(store.saveStatus).toBe('error'));
    expect(store.saveMessage).toBe(SIGNED_OUT);
    expect(store.data.records).toHaveLength(1);
  });
});
