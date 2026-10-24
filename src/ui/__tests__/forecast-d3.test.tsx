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

// D3: Forecast on the D1 foundation and the D2 patterns. Tuesday Oct 13, 2026; the month view shows October.
const SETUP = '2026-09-01';
const TODAY = '2026-10-13';
const clock = (day: string) => ({ today: day, now: `${day}T12:00:00Z` }) as ops.Clock;
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

/** Stays above $0: paycheck $1,800 Oct 16 and 30, $100 to reserves Oct 18, music $11 and car loan $350 Oct 20, a $250 repair Oct 24. */
function steady(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'subscription', 'Music', 11, '2026-10-20', { type: 'monthly' }, 'music');
  d = source(d, SETUP, 'liability', 'Car loan', 350, '2026-10-20', { type: 'monthly' }, 'car');
  d = source(d, SETUP, 'reserve', 'Emergency fund', 100, '2026-10-18', { type: 'monthly' }, 'fund');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Car repair', amountCents: 25000, date: '2026-10-24' }, clock(TODAY), 'repair'));
  return unwrap(ops.completeOnboarding(d));
}

/** Below $0 from Oct 20 for the rest of the month: $100 monthly income against $1,200 rent. */
function short(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 100, '2026-10-16', { type: 'monthly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');
  return unwrap(ops.completeOnboarding(d));
}

async function openForecast(data: AppData) {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = '#/forecast';
  render(
    <DataModeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>,
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
  return user;
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

const hero = () => screen.getByText('Cash flow', { selector: '.hero-label' }).closest('section')!;
const row = (label: string) => within(hero()).getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!.textContent;
const cents = (text: string) => {
  const m = /([+−]?)\$([\d,]+)\.(\d\d)/.exec(text)!;
  return (m[1] === '−' ? -1 : 1) * (Number(m[2]!.replace(/,/g, '')) * 100 + Number(m[3]));
};

describe('D3 summary: one card, cash flow first, its breakdown beneath', () => {
  it('shows the hand-computed figures once, and they add up to the cash flow', async () => {
    await openForecast(steady());
    // October: income 1,800 × 2; spending 11 + 350 + 250; reserves 100. Cash flow 3,600 − 611 − 100.
    expect(within(hero()).getByText('+$2,889.00', { selector: '.hero-value' })).toBeInTheDocument();
    expect(row('Income')).toBe('+$3,600.00');
    expect(row('Spending')).toBe('−$611.00');
    expect(row('Subscriptions')).toBe('$11.00');
    expect(row('Liability payments')).toBe('$350.00');
    expect(row('Varied spending')).toBe('$250.00');
    expect(row('Set aside in reserves')).toBe('−$100.00');
    expect(cents(row('Income')!) + cents(row('Spending')!) + cents(row('Set aside in reserves')!)).toBe(288900);
    // Nothing repeated: no second breakdown card, no cash-flow total row, no "in · out" line.
    expect(screen.queryByRole('region', { name: 'Breakdown' })).toBeNull();
    expect(within(hero()).queryByText('Cash flow', { selector: 'dt' })).toBeNull();
    expect(hero()).not.toHaveTextContent(/ in · /);
    expect(hero()).toHaveTextContent('You stay above $0 through Oct 31');
  });

  it('leaves out a row with nothing in it', async () => {
    const d = unwrap(ops.completeOnboarding(source(ops.emptyData(), SETUP, 'income', 'Paycheck', 900, '2026-10-16', { type: 'monthly' }, 'pay')));
    await openForecast(d);
    expect(row('Income')).toBe('+$900.00');
    expect(within(hero()).queryByText('Spending')).toBeNull();
  });

  it('the closing line says where the running total starts, the period’s first day, and never names a payday', async () => {
    const d = unwrap(ops.completeOnboarding(source(ops.emptyData(), SETUP, 'income', 'Paycheck', 900, '2026-11-02', { type: 'monthly' }, 'pay')));
    await openForecast(d);
    expect(hero()).not.toHaveTextContent('Lowest running total');
    expect(hero().querySelector('.hero-footer')).toHaveTextContent('Running total from Oct 1Starts at $0, not your bank balance.');
    expect(hero()).not.toHaveTextContent(/paycheck|payday/i);
  });
});

describe('D3 timing gaps and running totals below $0 stay prominent', () => {
  it('names the lowest point and the timing gap in red, and the gap opens its explanation', async () => {
    const user = await openForecast(short());
    expect(within(hero()).getByText('−$1,100.00', { selector: '.hero-value' })).toHaveClass('hero-value');
    const low = within(hero()).getByText('Lowest running total', { selector: 'dt' }).nextElementSibling!;
    expect(low).toHaveClass('negative-text');
    expect(low).toHaveTextContent('−$1,100.00 · Oct 20');
    const gap = within(hero()).getByRole('button', { name: /Short \$1,100\.00/ });
    expect(gap).toHaveClass('callout-danger');
    expect(gap).toHaveTextContent(/Short \$1,100\.00Timing gap · Oct 20 – (Oct )?31/);
    await user.click(gap);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a week below $0 keeps its red running total with an arrow, and its days stay red', async () => {
    const user = await openForecast(short());
    const week = screen.getByRole('button', { name: /^Oct 18 – 24/ });
    const tally = week.querySelector('.week-tally')!;
    expect(tally).toHaveClass('negative');
    expect(tally.querySelector('svg')).not.toBeNull();
    await user.click(week);
    const days = document.querySelector('.week-days .timeline')!;
    expect(days.querySelectorAll('li.negative').length).toBeGreaterThan(0);
  });
});

describe('D3 week by week: one list group, no repeated amounts', () => {
  it('is one list group; Net shows only when more than one kind of money moved', async () => {
    await openForecast(steady());
    const section = screen.getByRole('region', { name: 'Week by week' });
    expect(section.querySelectorAll('.list-group')).toHaveLength(1);
    expect(section.querySelector('.card')).toBeNull();
    // Oct 11 – 17: only the paycheck. Oct 18 – 24: spending and reserves.
    expect(screen.getByRole('button', { name: /^Oct 11 – 17/ })).not.toHaveTextContent('Net');
    expect(screen.getByRole('button', { name: /^Oct 18 – 24/ })).toHaveTextContent('Oct 18 – 24Spending −$611.00Saved in reserves −$100.00Net −$711.00Running total $1,089.00');
  });

  it('an open week lists only the amounts each day has, with no dashes', async () => {
    const user = await openForecast(steady());
    await user.click(screen.getByRole('button', { name: /^Oct 18 – 24/ }));
    const days = document.querySelector('.week-days .timeline') as HTMLElement;
    expect(days).not.toHaveTextContent('—');
    const sunday = within(days).getByRole('button', { name: /Sunday, October 18/ });
    expect(sunday).toHaveTextContent('Sun, Oct 18Saved−$100.00Running total$1,700.00');
    const tuesday = within(days).getByRole('button', { name: /Tuesday, October 20/ });
    expect(tuesday).toHaveTextContent('Tue, Oct 20Out−$361.00Running total$1,339.00');
  });
});

describe('D3 calendar chips fit a 320px phone', () => {
  it('keeps the full amount for screen readers and in the markup, and only small phones drop the "$"', async () => {
    await openForecast(steady());
    const day = screen.getByRole('button', { name: /^Friday, October 16, 2026, money in \$1,800\.00/ });
    const chip = day.querySelector('.chip-in')!;
    expect(chip).toHaveTextContent('+$1.8k');
    expect(chip.querySelector('.chip-cur')).toHaveTextContent('$');
    const narrow = /@media \(max-width: 374px\) \{([\s\S]*?)\n\}/.exec(css.slice(css.indexOf('.cal-chips .chip-cur') - 400))![1]!;
    expect(narrow).toMatch(/\.cal-chips \.chip-cur \{\s*display: none;/);
    expect(narrow).toMatch(/\.cal-chips \.chip \{[^}]*font-size: 0\.625rem;/);
  });

  it('keeps recorded (filled) and expected (outlined) chips apart', async () => {
    let d = steady();
    d = unwrap(ops.recordActual(d, 'pay@2026-10-16', { amountCents: 180000, date: TODAY }, clock(TODAY)));
    await openForecast(d);
    const recorded = screen.getByRole('button', { name: /^Tuesday, October 13, 2026, money in \$1,800\.00/ });
    expect(recorded.querySelector('.chip-in')).toHaveClass('chip-done');
    const expected = screen.getByRole('button', { name: /^Friday, October 30, 2026, money in \$1,800\.00/ });
    expect(expected.querySelector('.chip-in')).toHaveClass('chip-expected');
  });

  it('custom range date fields shrink with the page and stack on small phones', () => {
    expect(css).toMatch(/\.custom-range \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width: 374px\) \{\s*\.custom-range \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
});
