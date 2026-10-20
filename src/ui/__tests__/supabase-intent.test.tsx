import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup } from '../../state/backup';
import { DataModeProvider } from '../../state/mode';
import { useStore } from '../../state/store';
import { CLEAR_UNSUPPORTED, SupabaseStorageAdapter } from '../../state/supabase/adapter';
import { FakeSupabase } from '../../state/supabase/__tests__/fake-supabase';
import { toRows } from '../../state/supabase/rows';
import { SaveStatusBar } from '../components/backup';
import { ToastProvider } from '../components/common';
import { Settings } from '../screens/Settings';

/*
 * Restore, start over and ordinary changes with online-first storage (the
 * Supabase adapter on a fake client): each save carries the right intent, a
 * restore or start over shows only once the database confirms it, and a
 * failed one leaves the saved plan on screen. Today is Fri 2026-10-16.
 */
const TODAY = '2026-10-16';
const clock = clockAt(TODAY);

/** A paycheck and rent: 2 items, saved at revision 5. */
function current(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, TODAY, 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
  return { ...d, revision: 5 };
}

/** Another household's backup: a salary and a one-time repair. */
function backup(): { data: AppData; text: string } {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, TODAY, 'income', 'Salary', 2400, '2026-10-30', { type: 'monthly' }, 'sal');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(300), date: '2026-11-04' }, clock, 'rep'));
  return { data: d, text: createBackup(d, new Date(2026, 9, 16, 9)).text };
}

let store: ReturnType<typeof useStore>;
function Spy() {
  store = useStore();
  return null;
}

async function mount(plan: AppData | null = current()) {
  const fake = new FakeSupabase();
  if (plan) fake.workspace = { revision: plan.revision, plan: toRows(plan) };
  let n = 0;
  const adapter = new SupabaseStorageAdapter(fake, () => `save-${++n}`);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <DataModeProvider adapter={adapter}>
      <ToastProvider>
        <Spy />
        <SaveStatusBar />
        <Settings />
      </ToastProvider>
    </DataModeProvider>,
  );
  await screen.findByRole('heading', { name: 'Settings' });
  return { fake, adapter, user };
}

const saves = (fake: FakeSupabase) => fake.calls.filter((c) => c.fn === 'save_plan').map((c) => [c.args!.p_mode, c.args!.p_base_revision, c.args!.p_save_id]);
const upload = (user: ReturnType<typeof userEvent.setup>, text: string) => user.upload(screen.getByLabelText('Backup file'), new File([text], 'backup.json', { type: 'application/json' }));
const names = (d: AppData) => d.sources.map((s) => s.description);
const restoreDialog = () => screen.getByRole('dialog', { name: 'Restore this backup?' });
const startOverDialog = () => screen.getByRole('dialog', { name: 'Start over?' });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 16, 9, 0));
  window.location.hash = '#/settings';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tweak = (id: string) => (d: AppData, c: ops.Clock) => ops.addOneTime(d, { kind: 'varied', description: 'Snack', amountCents: usd(5), date: '2026-11-09' }, c, id);

describe('ordinary changes', () => {
  it('are saved as updates, one at a time, each on the revision before', async () => {
    const { fake } = await mount();
    act(() => void store.run((d, c) => ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(80), date: '2026-11-05' }, c, 'one-a')));
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    act(() => void store.run(tweak('one-b')));
    await waitFor(() => expect(saves(fake)).toEqual([
      ['update', 5, 'save-1'],
      ['update', 6, 'save-2'],
    ]));
    expect(fake.workspace!.revision).toBe(7);
  });

  it('recording an item, and undoing it, stay updates', async () => {
    const { fake } = await mount();
    act(() => void store.run((d, c) => ops.recordActual(d, 'pay@2026-10-23', { amountCents: usd(1000), date: c.today }, c)));
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    act(() => void store.run((d, c) => ops.restoreOccurrence(d, 'pay@2026-10-23', c)));
    await waitFor(() => expect(saves(fake)).toHaveLength(2));
    await waitFor(() => expect(store.saveStatus).toBe('idle'));
    expect(saves(fake).map(([mode]) => mode)).toEqual(['update', 'update']);
    expect(fake.workspace!.plan.records).toEqual([]);
  });
});

describe('restoring a backup', () => {
  it('over a populated plan: sent as a replace, shown only once confirmed', async () => {
    const { fake, user } = await mount();
    const b = backup();
    await upload(user, b.text);
    fake.hold = true;
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Replace with backup' }));
    // Waiting for the database: the saved plan stays on screen, the dialog says it's working.
    expect(within(restoreDialog()).getByRole('button', { name: 'Restoring…' })).toBeDisabled();
    expect(within(restoreDialog()).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(names(store.data)).toEqual(['Paycheck', 'Rent']);
    expect(screen.queryByText('Backup restored.')).toBeNull();
    // Nothing else can change meanwhile.
    expect(store.run(tweak('one-c'))).toEqual({ ok: false, error: 'Wait until this finishes saving, or cancel it.' });
    fake.hold = false;
    act(() => fake.release());
    expect(await screen.findByText('Backup restored.')).toBeInTheDocument();
    expect(saves(fake)).toEqual([['replace', 5, 'save-1']]);
    expect(store.data).toEqual({ ...b.data, revision: 6 });
    expect(window.location.hash).toBe('#/home');
    // The next ordinary change is an update again.
    act(() => void store.run(tweak('one-d')));
    await waitFor(() => expect(saves(fake)).toEqual([['replace', 5, 'save-1'], ['update', 6, 'save-2']]));
  });

  it('into an empty plan (a new workspace)', async () => {
    const { fake, user } = await mount(null);
    const b = backup();
    expect(store.data.revision).toBe(0);
    await upload(user, b.text);
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Replace with backup' }));
    expect(await screen.findByText('Backup restored.')).toBeInTheDocument();
    expect(saves(fake)).toEqual([['replace', 0, 'save-1']]);
    expect(fake.workspace!.plan).toEqual(toRows(b.data));
  });

  it('Cancel sends nothing', async () => {
    const { fake, user } = await mount();
    const before = store.data;
    await upload(user, backup().text);
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saves(fake)).toEqual([]);
    expect(store.data).toBe(before);
  });

  it('a double click sends one save', async () => {
    const { fake, user } = await mount();
    await upload(user, backup().text);
    fake.hold = true;
    const button = within(restoreDialog()).getByRole('button', { name: 'Replace with backup' });
    await user.click(button);
    await user.click(button);
    fake.hold = false;
    act(() => fake.release());
    await screen.findByText('Backup restored.');
    expect(saves(fake)).toEqual([['replace', 5, 'save-1']]);
  });

  it('refused by the database: says so, keeps the saved plan, and Cancel reloads it', async () => {
    const { fake, user } = await mount();
    const before = fake.workspace!.plan;
    await upload(user, backup().text);
    fake.failNext('check-violation');
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Replace with backup' }));
    expect(await within(restoreDialog()).findByRole('alert')).toHaveTextContent(
      "Couldn't restore your backup. This change couldn't be saved because the data didn't pass a safety check. Nothing was changed.",
    );
    expect(names(store.data)).toEqual(['Paycheck', 'Rent']);
    expect(screen.queryByText('Backup restored.')).toBeNull();
    expect(fake.workspace!.plan).toEqual(before);
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fake.calls.filter((c) => c.fn === 'load_plan')).toHaveLength(2));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(names(store.data)).toEqual(['Paycheck', 'Rent']);
    expect(fake.workspace!.revision).toBe(5);
  });

  it('a lost reply: Try again sends the same replace (same id), and it applies once', async () => {
    const { fake, user } = await mount();
    const b = backup();
    await upload(user, b.text);
    fake.failNext('network-after');
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Replace with backup' }));
    expect(await within(restoreDialog()).findByRole('alert')).toHaveTextContent("Couldn't restore your backup. Couldn't reach the server");
    // It reached the database, but the screen keeps the confirmed plan until it's confirmed.
    expect(fake.workspace!.revision).toBe(6);
    expect(names(store.data)).toEqual(['Paycheck', 'Rent']);
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Backup restored.')).toBeInTheDocument();
    expect(saves(fake)).toEqual([
      ['replace', 5, 'save-1'],
      ['replace', 5, 'save-1'],
    ]);
    expect(fake.workspace!.revision).toBe(6);
    expect(store.data).toEqual({ ...b.data, revision: 6 });
  });

  it('a conflict: nothing is replaced, and the page offers Reload', async () => {
    const { fake, user } = await mount();
    fake.externalSave({ ...fake.workspace!.plan });
    await upload(user, backup().text);
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Replace with backup' }));
    const message = 'Your data was changed on another device. Reload to see the latest.';
    expect(await within(restoreDialog()).findByRole('alert')).toHaveTextContent(`Couldn't restore your backup. ${message}`);
    expect(within(restoreDialog()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(fake.workspace!.plan.sources.map((s) => s.description)).toEqual(['Paycheck', 'Rent']);
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Cancel' }));
    const bar = screen.getByRole('alert');
    expect(bar).toHaveTextContent(message);
    await user.click(within(bar).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(store.data.revision).toBe(6));
  });

  it('waits for an earlier unsaved change: refused, nothing combined', async () => {
    const { fake, user } = await mount();
    fake.failNext('network-before');
    act(() => void store.run(tweak('one-e')));
    await waitFor(() => expect(store.saveStatus).toBe('error'));
    await upload(user, backup().text);
    await user.click(within(restoreDialog()).getByRole('button', { name: 'Replace with backup' }));
    expect(await within(restoreDialog()).findByRole('alert')).toHaveTextContent(
      "Couldn't restore your backup. Saving your last change… Try this again in a moment.",
    );
    expect(saves(fake).map(([mode]) => mode)).toEqual(['update']);
  });
});

describe('starting over', () => {
  it('sent as a reset; the plan is erased on screen only once confirmed', async () => {
    const { fake, user } = await mount();
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    fake.hold = true;
    await user.click(within(startOverDialog()).getByRole('button', { name: 'Erase and start over' }));
    expect(within(startOverDialog()).getByRole('button', { name: 'Erasing…' })).toBeDisabled();
    expect(names(store.data)).toEqual(['Paycheck', 'Rent']);
    fake.hold = false;
    act(() => fake.release());
    expect(await screen.findByText("Your data was erased. Set up again whenever you're ready.")).toBeInTheDocument();
    expect(saves(fake)).toEqual([['reset', 5, 'save-1']]);
    expect(store.data).toEqual({ schemaVersion: 2, revision: 6, onboardingComplete: false, sources: [], records: [] });
    expect(fake.workspace!.plan.sources).toEqual([]);
    expect(window.location.hash).toBe('#/onboarding');
  });

  it('Cancel sends nothing', async () => {
    const { fake, user } = await mount();
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    await user.click(within(startOverDialog()).getByRole('button', { name: 'Cancel' }));
    expect(saves(fake)).toEqual([]);
    expect(names(store.data)).toEqual(['Paycheck', 'Rent']);
  });

  it('a conflict: nothing is erased', async () => {
    const { fake, user } = await mount();
    fake.externalSave(fake.workspace!.plan);
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    await user.click(within(startOverDialog()).getByRole('button', { name: 'Erase and start over' }));
    expect(await within(startOverDialog()).findByRole('alert')).toHaveTextContent("Couldn't erase your data. Your data was changed on another device");
    expect(fake.workspace!.plan.sources).toHaveLength(2);
    expect(names(store.data)).toEqual(['Paycheck', 'Rent']);
    expect(screen.queryByText(/Your data was erased/)).toBeNull();
  });

  it('no reply, then Try again: the same reset (same id), still a reset', async () => {
    const { fake, user } = await mount();
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    fake.failNext('network-before');
    await user.click(within(startOverDialog()).getByRole('button', { name: 'Erase and start over' }));
    expect(await within(startOverDialog()).findByRole('alert')).toHaveTextContent("Couldn't erase your data. Couldn't reach the server");
    expect(fake.workspace!.revision).toBe(5);
    expect(names(store.data)).toEqual(['Paycheck', 'Rent']);
    await user.click(within(startOverDialog()).getByRole('button', { name: 'Try again' }));
    await screen.findByText("Your data was erased. Set up again whenever you're ready.");
    expect(saves(fake)).toEqual([
      ['reset', 5, 'save-1'],
      ['reset', 5, 'save-1'],
    ]);
  });
});

describe('clear()', () => {
  it('is refused instead of pretending the plan was erased', async () => {
    const { fake, adapter } = await mount();
    await expect(adapter.clear()).rejects.toThrow(CLEAR_UNSUPPORTED);
    expect(fake.workspace!.plan.sources).toHaveLength(2);
  });
});
