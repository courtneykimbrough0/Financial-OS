import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

// D2: Home on the D1 foundation. Tuesday Oct 13; the week is Sun Oct 11 – Sat Oct 17.
const TODAY = '2026-10-13';
const SETUP = '2026-09-01';
const at = (date: string) => clockAt(date);
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

async function renderHome(data: AppData) {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = '#/home';
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <DataModeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: /^Home/ });
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

const region = (name: string | RegExp) => screen.getByRole('region', { name });
const fact = (progress: HTMLElement, label: RegExp) => {
  const row = within(progress).getByText(label, { selector: 'dt' }).parentElement!;
  return row.querySelector('dd')!;
};
const cents = (text: string) => {
  const m = /([+−]?)\$([\d,]+)\.(\d\d)/.exec(text)!;
  return (m[1] === '−' ? -1 : 1) * (Number(m[2]!.replace(/,/g, '')) * 100 + Number(m[3]));
};

/** Pay $1,200 on Sep 2 and $1,000 on Oct 2 (recorded); rent $1,500 on the 5th (recorded both months); a $100 card payment due Oct 20. */
function belowZero(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1000, '2026-09-02', { type: 'monthly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 1500, '2026-09-05', { type: 'monthly' }, 'rent');
  d = source(d, SETUP, 'liability', 'Card', 100, '2026-10-20', { type: 'monthly' }, 'card');
  d = unwrap(ops.recordActual(d, 'pay@2026-09-02', { amountCents: usd(1200), date: '2026-09-02' }, at('2026-09-02')));
  d = unwrap(ops.recordActual(d, 'rent@2026-09-05', { amountCents: usd(1500), date: '2026-09-05' }, at('2026-09-05')));
  d = unwrap(ops.recordActual(d, 'pay@2026-10-02', { amountCents: usd(1000), date: '2026-10-02' }, at('2026-10-02')));
  d = unwrap(ops.recordActual(d, 'rent@2026-10-05', { amountCents: usd(1500), date: '2026-10-05' }, at('2026-10-05')));
  return unwrap(ops.completeOnboarding(d));
}

describe('D2 progress: one leading figure, then labeled rows', () => {
  it('below $0: every figure is the hand-computed one, red only where it is below $0', async () => {
    await renderHome(belowZero());
    const progress = region(/Cash flow so far in October/);
    // October 1–13 recorded: +1,000 − 1,500. September 1–13 recorded: +1,200 − 1,500.
    const lead = within(progress).getByText('−$500.00');
    expect(lead).toHaveClass('hero-value', 'negative');
    expect(progress).toHaveTextContent('Down $200.00 from Sep 1 – 13 (−$300.00 recorded)');
    // Projected October: −500 recorded, −100 still expected. All of September: +1,200 − 1,500.
    const projected = fact(progress, /October ends at/);
    const september = fact(progress, /September recorded/);
    expect(projected).toHaveTextContent('−$600.00');
    expect(projected).toHaveClass('negative-text');
    expect(within(projected.parentElement!).getByText('Projected')).toHaveClass('badge');
    expect(september).toHaveTextContent('−$300.00');
    expect(september).toHaveClass('negative-text');
    // The difference row is the two figures above it, subtracted.
    const difference = fact(progress, /^Difference$/);
    expect(difference).toHaveTextContent('Down $300.00');
    expect(cents(projected.textContent!) - cents(september.textContent!)).toBe(-cents(difference.textContent!));
  });

  it('up and down are said in words with an arrow, not in red or green', async () => {
    await renderHome(belowZero());
    for (const el of region(/Cash flow so far/).querySelectorAll('.progress-change')) {
      expect(el).not.toHaveClass('up');
      expect(el).not.toHaveClass('down');
      expect(el.querySelector('svg')).not.toBeNull();
    }
    expect(rule('.progress-change')).not.toContain('color');
  });

  it('with nothing recorded yet, the projected month leads and is labeled projected', async () => {
    let d = source(ops.emptyData(), '2026-10-01', 'income', 'Paycheck', 900, '2026-10-20', { type: 'monthly' }, 'pay');
    d = unwrap(ops.completeOnboarding(d));
    const user = await renderHome(d);
    const progress = region('Cash flow for October Projected');
    expect(within(progress).getByText('+$900.00')).toHaveClass('hero-value');
    expect(within(progress).queryByText('Recorded')).toBeNull();
    expect(progress.querySelector('dl')).toBeNull();
    // The forecast's own month total.
    await user.click(screen.getByRole('button', { name: 'Full forecast and calendar' }));
    const hero = await screen.findByRole('region', { name: 'Cash flow' });
    expect(within(hero).getByText('+$900.00', { selector: '.hero-value' })).toBeInTheDocument();
  });
});

/** Phone overdue since Oct 12, a refund expected Oct 9 and not recorded, a trip due today, pay and internet on Oct 16, music on Oct 19, side job recorded today. */
function week(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 900, '2026-10-16', { type: 'weekly' }, 'pay');
  d = source(d, SETUP, 'income', 'Side job', 150, '2026-10-12', { type: 'monthly' }, 'side');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-12', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'bill', 'Internet', 70, '2026-10-16', { type: 'monthly' }, 'net');
  d = source(d, SETUP, 'subscription', 'Music', 11, '2026-10-19', { type: 'monthly' }, 'music');
  d = unwrap(ops.recordActual(d, 'side@2026-10-12', { amountCents: usd(150), date: TODAY }, at(TODAY)));
  d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Refund', amountCents: usd(75), date: '2026-10-09' }, at('2026-10-08'), 'refund'));
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'School trip', amountCents: usd(40), date: TODAY }, at(SETUP), 'trip'));
  return unwrap(ops.completeOnboarding(d));
}

describe('D2 lists: related rows on one surface', () => {
  it('Coming up is one list group, with each day as a small label inside it', async () => {
    await renderHome(week());
    const coming = region('Coming up');
    const groups = coming.querySelectorAll('.list-group');
    expect(groups).toHaveLength(1);
    expect(coming.querySelector('.card')).toBeNull();
    const days = within(groups[0] as HTMLElement).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(days).toEqual(['Fri, Oct 16', 'Mon, Oct 19']);
    // Fri has two items, both still expected.
    const friday = within(groups[0] as HTMLElement).getByRole('heading', { name: 'Fri, Oct 16' }).nextElementSibling as HTMLElement;
    expect(within(friday).getAllByRole('button').map((b) => b.querySelector('.entry-title')!.textContent)).toEqual(['Internet', 'Paycheck']);
    expect(within(friday).getAllByText('Expected')).toHaveLength(2);
  });

  it('Happened this week keeps the recorded distinction, in one list group', async () => {
    await renderHome(week());
    const happened = region('Happened this week');
    expect(happened.querySelectorAll('.list-group')).toHaveLength(1);
    expect(within(happened).getByText('Side job')).toBeInTheDocument();
    expect(within(happened).getByText('Received')).toBeInTheDocument();
  });

  it('Needs attention is one list group; only a payment past its date is amber, and money not yet in stays neutral', async () => {
    await renderHome(week());
    const attention = region('Needs attention');
    expect(attention.querySelectorAll('.list-group')).toHaveLength(1);
    expect(within(attention).getByText('Overdue since Oct 12')).toHaveClass('entry-sub', 'overdue-text');
    expect(within(attention).getByText('Expected Oct 9 — not recorded')).not.toHaveClass('overdue-text');
    expect(within(attention).getByText('Due today')).not.toHaveClass('overdue-text');
    // Every row still has its checkbox, a 44px target.
    expect(within(attention).getAllByRole('checkbox')).toHaveLength(3);
    expect(rule('.pick-check')).toContain('width: var(--tap)');
    expect(rule('.pick-check')).toContain('height: var(--tap)');
  });

  it('an empty week is one plain line, with no card', async () => {
    const d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 900, '2026-10-30', { type: 'monthly' }, 'pay');
    await renderHome(unwrap(ops.completeOnboarding(d)));
    const line = screen.getByText('Nothing scheduled or recorded this week.').closest('.empty-line');
    expect(line).not.toBeNull();
    expect(line).not.toHaveClass('card');
  });

  it('on small phones the decorative avatar gives way to the item name', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 374px)'));
    expect(narrow.slice(0, narrow.indexOf('}\n}'))).toContain('.home .entry > .avatar');
  });
});
