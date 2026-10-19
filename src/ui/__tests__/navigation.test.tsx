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
import { parse } from '../router';

const SETUP = '2026-09-01';

/** One item of each recurring classification, plus varied spending and a one-time reserve. */
function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
  d = source(d, SETUP, 'subscription', 'Music', 11, '2026-10-20', { type: 'monthly' }, 'music');
  d = source(d, SETUP, 'liability', 'Car loan', 350, '2026-10-20', { type: 'monthly' }, 'car');
  d = source(d, SETUP, 'reserve', 'Emergency fund', 100, '2026-10-18', { type: 'monthly' }, 'fund');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Car repair', amountCents: 25000, date: '2026-10-24' }, { today: '2026-10-13', now: '2026-10-13T12:00:00Z' }, 'repair'));
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

const mainNav = () => within(screen.getAllByRole('navigation', { name: 'Main' })[0]!);
const planNav = () => within(screen.getByRole('navigation', { name: 'Plan' }));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 9, 0));
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

describe('routes', () => {
  it('knows the canonical routes and sends earlier addresses to their new places', () => {
    expect(['#/home', '#/forecast', '#/plan/income', '#/plan/expenses', '#/plan/liabilities', '#/plan/reserves', '#/settings', '#/onboarding'].map(parse)).toEqual([
      'home', 'forecast', 'plan/income', 'plan/expenses', 'plan/liabilities', 'plan/reserves', 'settings', 'onboarding',
    ]);
    expect(['#/dashboard', '#/plan', '#/income', '#/expenses', '#/liabilities', '#/reserves'].map(parse)).toEqual([
      'forecast', 'plan/income', 'plan/income', 'plan/expenses', 'plan/liabilities', 'plan/reserves',
    ]);
    expect(['', '#/', '#/nowhere', '#/plan/other'].map(parse)).toEqual([null, null, null, null]);
  });

  it('opens on Home after setup', async () => {
    await open('');
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
  });

  it('an old #/dashboard link opens Forecast and the address becomes #/forecast, without an extra history entry', async () => {
    await open('#/dashboard');
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    expect(window.location.hash).toBe('#/forecast');
    expect(mainNav().getByRole('link', { name: 'Forecast' })).toHaveAttribute('aria-current', 'page');
    const before = window.history.length;
    window.location.hash = '#/dashboard';
    await waitFor(() => expect(window.location.hash).toBe('#/forecast'));
    expect(window.history.length).toBe(before + 1);
  });

  it.each([
    ['#/income', '#/plan/income', 'Income'],
    ['#/expenses', '#/plan/expenses', 'Expenses'],
    ['#/liabilities', '#/plan/liabilities', 'Liabilities'],
    ['#/reserves', '#/plan/reserves', 'Strategic Reserves'],
    ['#/plan', '#/plan/income', 'Income'],
  ])('an old %s link opens %s', async (old, canonical, heading) => {
    await open(old);
    await screen.findByRole('heading', { level: 1, name: heading });
    expect(window.location.hash).toBe(canonical);
  });

  it.each([
    ['#/forecast', /Your cash flow/],
    ['#/plan/reserves', 'Strategic Reserves'],
    ['#/settings', 'Settings'],
  ])('opening %s directly (or refreshing it) shows that screen', async (hash, heading) => {
    await open(hash);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(window.location.hash).toBe(hash);
  });
});

describe('main navigation', () => {
  it('is Home, Forecast and Plan, with Settings behind the gear', async () => {
    await open('#/home');
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    for (const nav of screen.getAllByRole('navigation', { name: 'Main' })) {
      expect(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
        ['Home', '#/home'],
        ['Forecast', '#/forecast'],
        ['Plan', '#/plan/income'],
      ]);
    }
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
  });

  it('Plan stays the current tab in every Plan section', async () => {
    const user = await open('#/plan/income');
    await screen.findByRole('heading', { level: 1, name: 'Income' });
    for (const [label, heading] of [['Expenses', 'Expenses'], ['Liabilities', 'Liabilities'], ['Reserves', 'Strategic Reserves'], ['Income', 'Income']]) {
      await user.click(planNav().getByRole('link', { name: label! }));
      await screen.findByRole('heading', { level: 1, name: heading });
      expect(planNav().getByRole('link', { name: label! })).toHaveAttribute('aria-current', 'page');
      expect(mainNav().getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
    }
  });
});

describe('Plan', () => {
  it('reaches all six classifications, each with its own items', async () => {
    const user = await open('#/plan/income');
    expect(await screen.findByText('Paycheck')).toBeInTheDocument();
    await user.click(planNav().getByRole('link', { name: 'Expenses' }));
    const types = await screen.findByRole('tablist', { name: 'Expense type' });
    expect(within(types).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Bills', 'Subscriptions', 'Varied']);
    expect(screen.getByText('Rent')).toBeInTheDocument();
    await user.click(within(types).getByRole('tab', { name: 'Subscriptions' }));
    expect(await screen.findByText('Music')).toBeInTheDocument();
    await user.click(within(types).getByRole('tab', { name: 'Varied' }));
    expect(await screen.findByText('Car repair')).toBeInTheDocument();
    await user.click(planNav().getByRole('link', { name: 'Liabilities' }));
    expect(await screen.findByText('Car loan')).toBeInTheDocument();
    await user.click(planNav().getByRole('link', { name: 'Reserves' }));
    expect(await screen.findByText('Emergency fund')).toBeInTheDocument();
  });

  it('keeps the existing item actions: add, edit and record, from the same screens', async () => {
    const user = await open('#/plan/expenses');
    await screen.findByText('Rent');
    expect(screen.getByRole('button', { name: /Add (a )?bill/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
    await user.click(planNav().getByRole('link', { name: 'Reserves' }));
    await screen.findByText('Emergency fund');
    expect(screen.getByRole('button', { name: 'Add one-time' })).toBeInTheDocument();
  });

  it('an item’s “Change this and later ones” opens its own Plan section', async () => {
    const user = await open('#/home');
    const coming = await screen.findByRole('region', { name: 'Coming up' });
    await user.click(within(coming).getByRole('button', { name: /Car loan/ }));
    await user.click(await screen.findByRole('button', { name: 'Change this and later ones' }));
    await screen.findByRole('heading', { level: 1, name: 'Liabilities' });
    expect(window.location.hash).toBe('#/plan/liabilities');
  });
});

describe('Forecast', () => {
  it('has Month and Custom views and no separate Week tab; a period still opens its weeks and days', async () => {
    const user = await open('#/forecast');
    const views = await screen.findByRole('tablist', { name: 'Forecast view' });
    expect(within(views).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Month', 'Custom']);
    const week = screen.getByRole('button', { name: /^Oct 11 – 17/ });
    await user.click(week);
    await user.click(screen.getByRole('button', { name: 'Show details for Friday, October 16, 2026' }));
    expect(await screen.findByRole('dialog', { name: 'Friday, October 16, 2026' })).toHaveTextContent('Paycheck');
  });

  it('a custom range can still show a single week', async () => {
    const user = await open('#/forecast');
    const views = await screen.findByRole('tablist', { name: 'Forecast view' });
    await user.click(within(views).getByRole('tab', { name: 'Custom' }));
    const start = screen.getByLabelText('Start date');
    const end = screen.getByLabelText('End date');
    await user.clear(start);
    await user.type(start, '2026-10-18');
    await user.clear(end);
    await user.type(end, '2026-10-24');
    expect(await screen.findByRole('button', { name: /^Oct 18 – 24/ })).toBeInTheDocument();
  });
});

describe('navigation never changes money', () => {
  it('moving between Home, Forecast, Plan and Settings saves nothing', async () => {
    const user = await open('#/home');
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    const before = localStorage.getItem(STORAGE_KEY);
    await user.click(mainNav().getByRole('link', { name: 'Forecast' }));
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    await user.click(mainNav().getByRole('link', { name: 'Plan' }));
    await screen.findByRole('heading', { level: 1, name: 'Income' });
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await user.click(mainNav().getByRole('link', { name: 'Home' }));
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});
