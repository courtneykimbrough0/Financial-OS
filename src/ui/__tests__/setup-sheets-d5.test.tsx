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
import { Onboarding } from '../screens/Onboarding';

// D5: setup and sheets on the D1 foundation and the D2–D4 patterns. Tuesday Oct 13, 2026.
const SETUP = '2026-09-01';
const clock = (day: string) => ({ today: day, now: `${day}T12:00:00Z` }) as ops.Clock;
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

function renderWith(ui: React.ReactNode) {
  render(
    <DataModeProvider>
      <ToastProvider>{ui}</ToastProvider>
    </DataModeProvider>,
  );
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

async function openApp(hash: string, data: AppData) {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = hash;
  return renderWith(<App />);
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

describe('D5 setup', () => {
  it('an empty step is one line with its primary Add, and the tap hint waits until there is something to tap', async () => {
    await new LocalStorageAdapter().save(ops.emptyData(), 0);
    const user = renderWith(<Onboarding />);
    await screen.findByRole('heading', { name: 'When do you get paid?' });
    const line = screen.getByText('No income added yet').closest('.empty-line')!;
    expect(within(line as HTMLElement).getByRole('button', { name: 'Add income' })).toHaveClass('button', 'primary');
    expect(document.querySelector('.empty-state')).toBeNull();
    expect(screen.getByText('Like a tax refund or a bonus. Optional.').closest('.empty-line')).not.toBeNull();
    expect(screen.queryByText('Tap an item to change or remove it.')).toBeNull();
    // Sample data and restore stay on the first step.
    expect(screen.getByRole('button', { name: 'Explore with sample data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore a backup' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add income' }));
    const sheet = screen.getByRole('dialog', { name: 'Add income' });
    await user.type(within(sheet).getByLabelText('What is this income?'), 'Paycheck');
    await user.type(within(sheet).getByLabelText('Amount you expect to receive'), '1800');
    await user.type(within(sheet).getByLabelText('Next payment date'), '2026-10-15');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Tap an item to change or remove it.')).toBeInTheDocument();
  });

  it('the review lists what makes up the four weeks once (the banner gives the range and cash flow), with the primary action first', async () => {
    let d = source(ops.emptyData(), '2026-10-11', 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
    d = source(d, '2026-10-11', 'bill', 'Rent', 1200, '2026-11-01', { type: 'monthly' }, 'rent');
    await new LocalStorageAdapter().save(d, 0);
    const user = renderWith(<Onboarding />);
    await screen.findByRole('heading', { name: 'When do you get paid?' });
    for (let i = 0; i < 2; i++) await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Check everything over' });
    // Oct 13 – Nov 9: paychecks Oct 15 and 29, rent Nov 1. $1,800 × 2 − $1,200.
    expect(document.querySelector('.left-to-spend')).toHaveTextContent('Cash flowNext 4 weeks · Oct 13 – Nov 9+$2,400.00');
    const breakdown = screen.getByRole('region', { name: 'Next 4 weeks' });
    expect(breakdown).toHaveTextContent(/^Next 4 weeksIncome\+\$3,600\.00Spending−\$1,200\.00Bills\$1,200\.00$/);
    const actions = document.querySelector('.review-actions')!;
    const buttons = within(actions as HTMLElement).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Looks right', 'Change something']);
    expect(buttons[0]).toHaveClass('primary');
    await user.click(buttons[1]!);
    expect(await screen.findByRole('heading', { name: 'What do you pay regularly?' })).toBeInTheDocument();
  });

  it('setup rows give the decorative avatar up on small phones, as the other screens do', () => {
    const at = css.indexOf('.onboarding .entry > .avatar');
    expect(at).toBeGreaterThan(-1);
    expect(css.lastIndexOf('@media (max-width: 374px)', at)).toBeGreaterThan(-1);
  });
});

/** Phone $60 due Oct 12 (overdue); paycheck $1,800 every 2 weeks from Oct 12, that one received Oct 13 at $1,650; rent $3,600 on the 28th, after the Oct 26 paycheck (a timing gap). */
function sheets(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1800, '2026-10-12', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-12', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'bill', 'Rent', 3600, '2026-10-28', { type: 'monthly' }, 'rent');
  d = unwrap(ops.recordActual(d, 'pay@2026-10-12', { amountCents: 165000, date: '2026-10-13' }, clock('2026-10-13')));
  return unwrap(ops.completeOnboarding(d));
}

describe('D5 payment and item sheets', () => {
  it('an overdue payment says what to do without repeating its date, and its status sits with its kind', async () => {
    const user = await openApp('#/home', sheets());
    await user.click(await screen.findByRole('button', { name: /^Phone/ }));
    const sheet = screen.getByRole('dialog', { name: 'Phone' });
    expect(within(sheet).getByText(/Its date has passed\. Record it, or move it to a new date\./)).toBeInTheDocument();
    expect(sheet.querySelector('.callout-warn')).not.toHaveTextContent(/Oct 12/);
    expect(sheet.querySelector('.occ-meta')).toHaveTextContent('Bill · Recurring Overdue');
    // Every action is still there; recording is the primary one.
    expect(within(sheet).getByRole('button', { name: 'Record paid' })).toHaveClass('primary');
    for (const name of ['Change date or amount', 'Skip this payment', 'Edit Phone']) expect(within(sheet).getByRole('button', { name })).toBeInTheDocument();
  });

  it('a recorded payment keeps its expected-vs-actual rows, which wrap on a narrow sheet instead of overflowing', async () => {
    const user = await openApp('#/home', sheets());
    await user.click(await screen.findByRole('button', { name: /^Paycheck.*1,650/ }));
    const sheet = screen.getByRole('dialog', { name: 'Paycheck' });
    expect(sheet.querySelector('.details')).toHaveTextContent('Expected$1,800.00 on Oct 12, 2026Actually received$1,650.00 on Oct 13, 2026Difference−$150.00 vs. expected, 1 day late');
    expect(rule('.details > div')).toContain('flex-wrap: wrap');
    expect(rule('.occ-meta')).toContain('flex-wrap: wrap');
  });

  it("an item's sheet makes Edit its primary action and keeps Turn off and Delete", async () => {
    const user = await openApp('#/plan/expenses', sheets());
    await user.click(await screen.findByRole('button', { name: /^Rent/ }));
    const sheet = screen.getByRole('dialog', { name: 'Rent' });
    expect(within(sheet).getByRole('button', { name: 'Edit' })).toHaveClass('primary');
    expect(within(sheet).getByRole('button', { name: 'Turn off' })).toHaveClass('secondary');
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});

describe('D5 timing gaps and "See what happens if…"', () => {
  it('each expected payment in a gap is one row that opens "See what happens if…", with one hint instead of a link per line', async () => {
    const user = await openApp('#/forecast', sheets());
    await user.click(await screen.findByRole('button', { name: /Short \$/ }));
    const sheet = screen.getByRole('dialog', { name: /timing gap/ });
    expect(within(sheet).getByText('Tap an expected payment to see what happens if it changes.')).toBeInTheDocument();
    const rows = within(sheet).getAllByRole('button', { name: /^See what happens if/ });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).toHaveClass('gap-entry');
      expect(r).not.toHaveTextContent('See what happens if');
      expect(r.querySelector('.chevron')).not.toBeNull();
    }
    expect(rule('.gap-step')).not.toContain('uppercase');
    await user.click(within(sheet).getByRole('button', { name: 'See what happens if Rent on Oct 28 changes' }));
    expect(await screen.findByRole('dialog', { name: 'See what happens if…' })).toHaveTextContent('Rent · Oct 28, 2026 · $3,600.00');
  });

  it('with no changes yet, adding one is the primary action and Done is a quiet close', async () => {
    const user = await openApp('#/forecast', sheets());
    await user.click(await screen.findByRole('button', { name: 'See what happens if…' }));
    const sheet = screen.getByRole('dialog', { name: 'See what happens if…' });
    expect(within(sheet).getByRole('button', { name: 'Add a change' })).toHaveClass('primary');
    expect(within(sheet).getByRole('button', { name: 'Done' })).toHaveClass('link');
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
