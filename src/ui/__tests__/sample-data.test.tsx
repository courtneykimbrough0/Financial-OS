import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider, SAMPLE_UNAVAILABLE } from '../../state/mode';
import { LocalStorageAdapter, SAMPLE_STORAGE_KEY, STORAGE_KEY } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

/** Browser storage that refuses the sample data, as a full or blocked store does. */
function refusingSample(): Storage {
  const base = window.localStorage;
  return {
    get length() {
      return base.length;
    },
    key: (i: number) => base.key(i),
    getItem: (k: string) => base.getItem(k),
    removeItem: (k: string) => base.removeItem(k),
    clear: () => base.clear(),
    setItem: (k: string, v: string) => {
      if (k === SAMPLE_STORAGE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      base.setItem(k, v);
    },
  };
}

async function renderAt(route: string, data: AppData) {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = route ? `#/${route}` : '';
  render(
    <DataModeProvider storage={refusingSample()}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  window.location.hash = '';
});

describe("sample data that can't be stored (defect D5)", () => {
  it("from Settings: the sheet says why, nothing switches, and the person's data is untouched", async () => {
    const mine = unwrap(ops.completeOnboarding(source(ops.emptyData(), '2026-10-01', 'income', 'My job', 900, '2099-01-01')));
    const user = await renderAt('settings', mine);
    await user.click(await screen.findByRole('button', { name: 'Explore with sample data' }));
    const sheet = screen.getByRole('dialog', { name: 'Explore with sample data?' });
    const before = localStorage.getItem(STORAGE_KEY);
    await user.click(within(sheet).getByRole('button', { name: 'Show sample data' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(SAMPLE_UNAVAILABLE);
    expect(window.location.hash).toBe('#/settings');
    expect(screen.queryByText("You're exploring sample data.")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('from the welcome screen: the message appears under the button, and setup stays open', async () => {
    const user = await renderAt('', ops.emptyData());
    await user.click(await screen.findByRole('button', { name: 'Explore with sample data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(SAMPLE_UNAVAILABLE);
    expect(screen.getByRole('button', { name: 'Explore with sample data' })).toBeInTheDocument();
    expect(screen.queryByText("You're exploring sample data.")).toBeNull();
  });
});
