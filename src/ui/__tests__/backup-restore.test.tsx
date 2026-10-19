import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../domain/__tests__/helpers';
import { analyzeEstimate, dismissEstimate } from '../../domain/estimates';
import { buildForecast } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { createBackup, readBackup } from '../../state/backup';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { useStore } from '../../state/store';
import { ToastProvider } from '../components/common';
import { Settings } from '../screens/Settings';

/*
 * Today is Fri 2026-10-16. Current data: a paycheck, rent, and a phone bill
 * with three $65 payments and a dismissed estimate suggestion: 3 items.
 */
const TODAY = '2026-10-16';
const clock = clockAt(TODAY);

function current(): AppData {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, TODAY, 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1500, '2026-11-01', { type: 'monthly' }, 'rent');
  d = source(d, '2026-07-01', 'bill', 'Phone', 60, '2026-07-25', { type: 'monthly' }, 'phone');
  for (const date of ['2026-07-25', '2026-08-25', '2026-09-25']) d = unwrap(ops.recordActual(d, `phone@${date}`, { amountCents: usd(65), date }, clock));
  d = unwrap(dismissEstimate(d, analyzeEstimate(d, 'phone', TODAY).suggestion!, clock));
  return d;
}

/** Another household's backup: a paycheck and a one-time repair. */
function otherBackup(): string {
  let d = unwrap(ops.completeOnboarding(ops.emptyData()));
  d = source(d, TODAY, 'income', 'Salary', 2400, '2026-10-30', { type: 'monthly' }, 'sal');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(300), date: '2026-11-04' }, clock, 'rep'));
  return createBackup(d, new Date(2026, 9, 16, 9)).text;
}

let store: ReturnType<typeof useStore>;
function Spy() {
  store = useStore();
  return null;
}

const downloads: Blob[] = [];

async function mount(data: AppData = current()) {
  await new LocalStorageAdapter().save(data, 0);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <DataModeProvider>
      <ToastProvider>
        <Spy />
        <Settings />
      </ToastProvider>
    </DataModeProvider>,
  );
  await screen.findByRole('heading', { name: 'Settings' });
  await waitFor(() => expect(store.data.sources).toHaveLength(data.sources.length));
  return user;
}

const upload = (user: ReturnType<typeof userEvent.setup>, text: string) => user.upload(screen.getByLabelText('Backup file'), new File([text], 'backup.json', { type: 'application/json' }));
const saved = () => localStorage.getItem(STORAGE_KEY);

beforeEach(() => {
  localStorage.clear();
  downloads.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 16, 9, 0));
  URL.createObjectURL = vi.fn((b: Blob) => {
    downloads.push(b);
    return 'blob:backup';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  window.location.hash = '#/settings';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('restoring a backup', () => {
  it('shows what it replaces, offers a copy of the current data, and Cancel changes nothing', async () => {
    const user = await mount();
    const before = store.data;
    const stored = saved();
    await upload(user, otherBackup());
    const dialog = screen.getByRole('dialog', { name: 'Restore this backup?' });
    expect(dialog).toHaveTextContent('This backup has 2 items, saved Oct 16, 2026.Restoring replaces everything currently in the app with the backup.You have 3 items now. To keep a copy, download a backup first. You can restore it later.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Download a backup of your data' }));
    expect(within(dialog).getByRole('status')).toHaveTextContent('Backup downloaded: financial-os-backup-2026-10-16.json');
    expect(readBackup(await downloads[0]!.text()).data).toEqual(before);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.data).toBe(before);
    expect(saved()).toBe(stored);
  });

  it('replaces everything with the backup', async () => {
    const user = await mount();
    await upload(user, otherBackup());
    await user.click(screen.getByRole('button', { name: 'Replace with backup' }));
    expect(await screen.findByText('Backup restored.')).toBeInTheDocument();
    expect(store.data.sources.map((s) => s.description)).toEqual(['Salary']);
    expect(store.data.records.map((r) => [r.description, r.scheduledAmountCents])).toEqual([['Repair', 30000]]);
    await waitFor(() => expect(JSON.parse(saved()!).sources.map((s: { description: string }) => s.description)).toEqual(['Salary']));
  });

  it('a damaged or unrelated file is refused and nothing changes', async () => {
    const user = await mount();
    const before = store.data;
    const stored = saved();
    for (const [text, message] of [
      ['not json', 'This file isn’t a Financial OS backup.'],
      [JSON.stringify({ hello: 'world' }), 'This file isn’t a Financial OS backup.'],
      [JSON.stringify({ format: 'financial-os-backup', data: { schemaVersion: 2, sources: [{ id: 1 }], records: [] } }), 'This backup is damaged or from a newer version of the app, so it can’t be restored.'],
    ] as const) {
      await upload(user, text);
      const dialog = screen.getByRole('dialog', { name: 'Couldn’t restore' });
      expect(dialog).toHaveTextContent(message);
      expect(screen.queryByRole('dialog', { name: 'Restore this backup?' })).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    }
    expect(store.data).toBe(before);
    expect(saved()).toBe(stored);
  });
});

describe('starting over', () => {
  it('asks first and offers a backup; Cancel changes nothing', async () => {
    const user = await mount();
    const before = store.data;
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    const dialog = screen.getByRole('dialog', { name: 'Start over?' });
    expect(dialog).toHaveTextContent('This erases all 3 items you’ve entered, with everything recorded for them, and takes you back to setup.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.data).toBe(before);
  });

  it('erases and returns to setup, and the backup taken first brings everything back', async () => {
    const original = current();
    const user = await mount(original);
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    const dialog = screen.getByRole('dialog', { name: 'Start over?' });
    await user.click(within(dialog).getByRole('button', { name: 'Download a backup of your data' }));
    await user.click(within(dialog).getByRole('button', { name: 'Erase and start over' }));
    expect(await screen.findByText('Your data was erased. Set up again whenever you’re ready.')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/onboarding');
    expect(store.data).toMatchObject({ onboardingComplete: false, sources: [], records: [] });

    // Restore the backup downloaded just before: nothing to keep now, so no copy is offered.
    await upload(user, await downloads[0]!.text());
    const restore = screen.getByRole('dialog', { name: 'Restore this backup?' });
    expect(restore).toHaveTextContent('This backup has 3 items');
    expect(within(restore).queryByRole('button', { name: 'Download a backup of your data' })).toBeNull();
    await user.click(within(restore).getByRole('button', { name: 'Replace with backup' }));
    expect(store.data.sources).toEqual(original.sources);
    expect(store.data.records).toEqual(original.records);
    expect(store.data.sources.find((s) => s.id === 'phone')!.estimateDismissal).toEqual({ currentCents: 6000, proposedCents: 6500, through: '2026-09-25' });
    expect(buildForecast(store.data, TODAY)).toEqual(buildForecast(original, TODAY));
  });
});
