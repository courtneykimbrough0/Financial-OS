import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';
import { consumeForecastDate, navigateToForecast, parse, parseForecastDate } from '../router';

const SETUP = '2026-09-01';

function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
  d = source(d, SETUP, 'subscription', 'Music', 11, '2026-10-20', { type: 'monthly' }, 'music');
  d = source(d, SETUP, 'reserve', 'Emergency fund', 100, '2026-10-18', { type: 'monthly' }, 'fund');
  return unwrap(ops.completeOnboarding(d));
}

async function open(hash: string, data: AppData = plan()) {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = hash;
  render(
    <DataModeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>,
  );
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 9, 0));
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

describe('router: contextual forecast navigation', () => {
  it('parse recognises #/forecast/YYYY-MM-DD as the forecast route', () => {
    expect(parse('#/forecast/2026-11-15')).toBe('forecast');
    expect(parse('#/forecast/2026-10-01')).toBe('forecast');
    expect(parse('#/forecast/bad')).toBeNull();
    expect(parse('#/forecast/')).toBeNull();
  });

  it('navigateToForecast sets a date consumed once by consumeForecastDate', () => {
    navigateToForecast('2026-11-01');
    expect(consumeForecastDate()).toBe('2026-11-01');
    expect(consumeForecastDate()).toBeNull();
  });

  it('parseForecastDate extracts a date from #/forecast/YYYY-MM-DD', () => {
    window.location.hash = '#/forecast/2026-12-25';
    expect(parseForecastDate()).toBe('2026-12-25');
    window.location.hash = '#/forecast';
    expect(parseForecastDate()).toBeNull();
  });

  it('direct #/forecast still works without a date', async () => {
    await open('#/forecast');
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    expect(window.location.hash).toBe('#/forecast');
  });

  it('redirects still work: #/dashboard opens Forecast', async () => {
    await open('#/dashboard');
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    expect(window.location.hash).toBe('#/forecast');
  });
});

describe('Home to Forecast context', () => {
  it('"Full forecast and calendar" is a button, not a link', async () => {
    await open('#/home');
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    const btn = screen.getByRole('button', { name: 'Full forecast and calendar' });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('clicking the button navigates to Forecast', async () => {
    const user = await open('#/home');
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    await user.click(screen.getByRole('button', { name: 'Full forecast and calendar' }));
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    expect(window.location.hash).toBe('#/forecast');
  });
});

describe('conditional visibility', () => {
  it('embedded intro is hidden when items exist on an expense tab', async () => {
    await open('#/plan/expenses');
    await screen.findByText('Rent');
    expect(screen.queryByText('Regular bills like rent, utilities, phone, and insurance.')).not.toBeInTheDocument();
  });

  it('embedded intro is shown when the tab has no items', async () => {
    const user = await open('#/plan/expenses');
    await screen.findByText('Rent');
    const tabs = screen.getByRole('tablist', { name: 'Expense type' });
    await user.click(within(tabs).getByRole('tab', { name: 'Varied' }));
    await waitFor(() => expect(screen.getByText(/Spending that happens once/)).toBeInTheDocument());
  });
});

describe('simplified language', () => {
  it('week-list hint is concise', async () => {
    await open('#/forecast');
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    expect(screen.queryByText(/Tap a week to see its days/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Weeks run Sunday to Saturday/)).not.toBeInTheDocument();
  });

  it('running-total OK message uses "above" not "at or above"', async () => {
    await open('#/forecast');
    const ok = await screen.findAllByText(/You stay above \$0/);
    expect(ok.length).toBeGreaterThanOrEqual(1);
  });
});

describe('financial integrity', () => {
  it('navigation between screens does not alter stored data', async () => {
    const user = await open('#/home');
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    const before = localStorage.getItem(STORAGE_KEY);
    await user.click(screen.getByRole('button', { name: 'Full forecast and calendar' }));
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});
