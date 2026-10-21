import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { source, unwrap } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

// D4: Plan and Activity on the D1 foundation and the D2/D3 patterns. Monday Oct 19, 2026.
const SETUP = '2026-09-01';
const clock = (day: string) => ({ today: day, now: `${day}T12:00:00Z` }) as ops.Clock;
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

/** Paycheck $1,800 received Oct 16; rent $1,200 paid Oct 5; phone $60 due Oct 12, paid Oct 13; $100 saved Oct 18; gym turned off. */
function month(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-10-05', { type: 'monthly' }, 'rent');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-12', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'bill', 'Water', 40, '2026-10-15', { type: 'monthly' }, 'water');
  d = source(d, SETUP, 'reserve', 'Emergency fund', 100, '2026-10-18', { type: 'monthly' }, 'fund');
  d = source(d, SETUP, 'subscription', 'Gym', 45, '2026-09-20', { type: 'monthly' }, 'gym');
  d = unwrap(ops.recordActual(d, 'pay@2026-10-16', { amountCents: 180000, date: '2026-10-16' }, clock('2026-10-16')));
  d = unwrap(ops.recordActual(d, 'rent@2026-10-05', { amountCents: 120000, date: '2026-10-05' }, clock('2026-10-05')));
  d = unwrap(ops.recordActual(d, 'phone@2026-10-12', { amountCents: 6000, date: '2026-10-13' }, clock('2026-10-13')));
  d = unwrap(ops.recordActual(d, 'fund@2026-10-18', { amountCents: 10000, date: '2026-10-18' }, clock('2026-10-18')));
  d = unwrap(ops.deactivateSource(d, 'gym', clock('2026-10-01')));
  return unwrap(ops.completeOnboarding(d));
}

async function open(hash: string, data: AppData) {
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
  vi.setSystemTime(new Date(2026, 9, 19, 9, 0));
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

const cents = (text: string) => {
  const m = /([+−]?)\$([\d,]+)\.(\d\d)/.exec(text)!;
  return (m[1] === '−' ? -1 : 1) * (Number(m[2]!.replace(/,/g, '')) * 100 + Number(m[3]));
};

describe('D4 Activity: one summary, recorded cash flow first', () => {
  it('shows the hand-computed recorded figures once, and they add up to the cash flow', async () => {
    await open('#/activity', month());
    const summary = await screen.findByRole('region', { name: 'Month summary' });
    // Received 1,800; paid 1,200 + 60; saved 100. Cash flow 1,800 − 1,260 − 100.
    expect(within(summary).getByText('+$440.00')).toHaveClass('hero-value');
    expect(within(summary).getByText('Recorded')).toHaveClass('badge');
    const row = (label: string) => within(summary).getByText(label, { selector: 'dt' }).nextElementSibling!.textContent!;
    expect(row('Received')).toBe('+$1,800.00');
    expect(row('Paid')).toBe('−$1,260.00');
    expect(row('Bills')).toBe('$1,260.00');
    expect(row('Saved in reserves')).toBe('−$100.00');
    expect(cents(row('Received')) + cents(row('Paid')) + cents(row('Saved in reserves'))).toBe(44000);
    // Nothing repeated: no three-figure strip, no second By kind card, no cash-flow total row.
    expect(summary.querySelector('.activity-kpis')).toBeNull();
    expect(screen.queryByRole('region', { name: 'By kind' })).toBeNull();
    expect(within(summary).queryByText('Cash flow', { selector: 'dt' })).toBeNull();
  });

  it('a month with nothing recorded is one plain line', async () => {
    const user = await open('#/activity', month());
    await screen.findByRole('region', { name: 'Month summary' });
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    const line = screen.getByText('Nothing recorded from Sep 1 – 30.').closest('.empty-line');
    expect(line).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Month summary' })).toBeNull();
  });

  it('recorded rows are one list group and keep their recorded badges', async () => {
    await open('#/activity', month());
    const list = await screen.findByRole('region', { name: /^Recorded/ });
    expect(list.querySelectorAll('.list-group')).toHaveLength(1);
    expect(within(list).getAllByText('Paid')).toHaveLength(2);
    expect(within(list).getByText('Received')).toBeInTheDocument();
    expect(within(list).getByText('Set aside')).toBeInTheDocument();
  });
});

describe('D4 Plan: an item list is one surface', () => {
  it('recurring items are rows in one list group, overdue still in amber', async () => {
    vi.setSystemTime(new Date(2026, 9, 21, 9, 0));
    await open('#/plan/expenses', month());
    const section = await screen.findByRole('region', { name: 'Recurring bills' });
    const groups = section.querySelectorAll('.list-group');
    expect(groups).toHaveLength(1);
    expect(section.querySelector('.card')).toBeNull();
    const rows = within(groups[0] as HTMLElement).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.entry-title')!.textContent)).toEqual(['Phone', 'Rent', 'Water']);
    expect(within(section).getByText('Overdue since Oct 15')).toHaveClass('overdue-text');
  });

  it('an item that is off stays in the list, marked Off, and still opens', async () => {
    const user = await open('#/plan/expenses', month());
    await user.click(await screen.findByRole('tab', { name: 'Subscriptions' }));
    const section = await screen.findByRole('region', { name: 'Subscriptions' });
    const gym = within(section).getByRole('button', { name: /^Gym/ });
    expect(gym.closest('li')).toHaveClass('source-card', 'inactive');
    expect(within(gym).getByText('Off')).toBeInTheDocument();
    await user.click(gym);
    expect(await screen.findByRole('dialog', { name: 'Gym' })).toBeInTheDocument();
  });
});

describe('D4 small phones', () => {
  const narrow = () => {
    const at = css.indexOf('.plan .entry > .avatar');
    return css.slice(css.lastIndexOf('@media (max-width: 374px)', at), css.indexOf('\n}\n', at));
  };

  it('Activity and Plan rows give the avatar up for the item name, as Home does', () => {
    expect(narrow()).toMatch(/\.home \.entry > \.avatar,\s*\.activity \.entry > \.avatar,\s*\.plan \.entry > \.avatar \{\s*display: none;/);
  });

  it("Plan's four section pills share the width, and Add buttons go under their heading", () => {
    expect(narrow()).toMatch(/\.plan-nav a \{[^}]*flex: 1 1 0;[^}]*min-width: 0;/);
    expect(narrow()).toMatch(/\.section-label-row \.section-actions \{[^}]*flex-basis: 100%;/);
  });
});
