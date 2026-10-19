import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockAt, source, unwrap, usd } from '../../domain/__tests__/helpers';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { DataModeProvider } from '../../state/mode';
import { LocalStorageAdapter, STORAGE_KEY } from '../../state/storage';
import { App } from '../App';
import { ToastProvider } from '../components/common';

// Tuesday. The week is Sun Oct 11 – Sat Oct 17; "coming up" runs through Tue Oct 20.
const TODAY = '2026-10-13';
const SETUP = '2026-09-01';
const at = (date: string) => clockAt(date);

/** Pay $900 every 2 weeks from Fri Oct 16; side job $150 weekly from Sep 7 (this week's came a day late, $20 short); phone $60 due Oct 12 (overdue); a $40 trip due today; $100 to reserves on the 18th. */
function plan(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 900, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'income', 'Side job', 150, '2026-09-07', { type: 'weekly' }, 'side');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-12', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'reserve', 'Emergency fund', 100, '2026-10-18', { type: 'monthly' }, 'fund');
  for (const date of ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']) d = unwrap(ops.recordActual(d, `side@${date}`, { amountCents: usd(150), date }, at(date)));
  d = unwrap(ops.recordActual(d, 'side@2026-10-12', { amountCents: usd(130), date: TODAY }, at(TODAY)));
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'School trip', amountCents: usd(40), date: TODAY }, at(SETUP), 'trip'));
  return unwrap(ops.completeOnboarding(d));
}

const stored = (): AppData => JSON.parse(localStorage.getItem(STORAGE_KEY)!);

async function renderHome(data: AppData, route = 'home') {
  await new LocalStorageAdapter().save(data, 0);
  window.location.hash = `#/${route}`;
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <DataModeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DataModeProvider>,
  );
  return user;
}

function setToday(y: number, m: number, d: number) {
  vi.setSystemTime(new Date(y, m - 1, d, 9, 0));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  setToday(2026, 10, 13);
});
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

const region = (name: string) => screen.getByRole('region', { name });
const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('Home layout', () => {
  it('opens on Home with progress, needs attention, this week, coming up and what happened, in that order', async () => {
    await renderHome(plan(), 'home');
    expect(await screen.findByRole('heading', { level: 1, name: /^Home/ })).toHaveTextContent('Tue, Oct 13');
    expect(headings()).toEqual(['Needs attention', 'Oct 11 – 17', 'Coming up', 'Happened this week']);
    const order = ['progress-heading', 'attention-heading', 'coming-heading', 'happened-heading'].map((id) => document.getElementById(id)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is the first screen after setup, with Home first in the navigation and the forecast one tap away', async () => {
    window.location.hash = '';
    await new LocalStorageAdapter().save(plan(), 0);
    render(
      <DataModeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DataModeProvider>,
    );
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(within(screen.getAllByRole('navigation', { name: 'Main' })[0]!).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Forecast', 'Plan']);
    expect(screen.getByRole('button', { name: 'Full forecast and calendar' })).toBeInTheDocument();
  });

  it('shows no review, rhythm, undo or overdue-banner controls anywhere', async () => {
    const user = await renderHome(plan(), 'home');
    await screen.findByRole('region', { name: 'Needs attention' });
    await user.click(screen.getAllByRole('checkbox')[0]!);
    for (const text of [/Undo/, /Review this week/, /review is ready/i, /need an update/, /Mark review/, /Skip review/]) expect(screen.queryByText(text)).toBeNull();
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
    window.location.hash = '#/forecast';
    await screen.findByRole('heading', { level: 1, name: /Your cash flow/ });
    expect(screen.queryByText(/need an update/)).toBeNull();
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull();
    window.location.hash = '#/settings';
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(screen.queryByRole('heading', { name: 'Review rhythm' })).toBeNull();
  });

  it('hides sections that have nothing in them, and says so plainly when the week is empty', async () => {
    let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 900, '2026-10-30', { type: 'monthly' }, 'pay');
    d = unwrap(ops.completeOnboarding(d));
    await renderHome(d);
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(headings()).toEqual(['Oct 11 – 17']);
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Coming up' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Happened this week' })).toBeNull();
    expect(screen.getByText('Nothing scheduled or recorded this week.')).toBeInTheDocument();
  });
});

describe('Progress', () => {
  it('leads with recorded cash flow this month against the same days of last month, and labels the projected month apart', async () => {
    let d = plan();
    d = source(d, SETUP, 'bill', 'Rent', 600, '2026-09-10', { type: 'monthly' }, 'rent');
    d = unwrap(ops.recordActual(d, 'rent@2026-09-10', { amountCents: usd(600), date: '2026-09-10' }, at('2026-09-10')));
    d = unwrap(ops.recordActual(d, 'rent@2026-10-10', { amountCents: usd(600), date: '2026-10-10' }, at('2026-10-10')));
    await renderHome(d);
    const progress = await screen.findByRole('region', { name: /Cash flow so far in October/ });
    // October 1–13 recorded: side job 150×1 (Oct 5) + 130 − rent 600; September 1–13: 150×1 (Sep 7) + ... − rent 600.
    expect(within(progress).getByText('Recorded')).toBeInTheDocument();
    expect(within(progress).getByText('Projected')).toBeInTheDocument();
    expect(progress).toHaveTextContent('Cash flow so far in October Recorded');
    expect(progress).toHaveTextContent(/(Up|Down) \$[\d,.]+ from Sep 1 – 13|No change from Sep 1 – 13/);
    expect(progress).toHaveTextContent(/Projected October ends at/);
    expect(progress).toHaveTextContent(/September recorded/);
  });

  it('shows only what is trustworthy: nothing recorded last month means no comparison, not a made-up one', async () => {
    let d = source(ops.emptyData(), '2026-10-01', 'income', 'Paycheck', 900, '2026-10-05', { type: 'monthly' }, 'pay');
    d = unwrap(ops.recordActual(d, 'pay@2026-10-05', { amountCents: usd(900), date: '2026-10-05' }, at('2026-10-05')));
    await renderHome(unwrap(ops.completeOnboarding(d)));
    const progress = await screen.findByRole('region', { name: /Cash flow so far in October/ });
    expect(progress).toHaveTextContent('+$900.00');
    expect(progress).toHaveTextContent('Nothing was recorded on Sep 1 – 13 to compare.');
    expect(within(progress).queryByText('Projected')).toBeNull();
  });

  it('is hidden when there is nothing recorded or expected to report', async () => {
    await renderHome(unwrap(ops.completeOnboarding(ops.emptyData())));
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(screen.queryByRole('region', { name: /Cash flow so far/ })).toBeNull();
  });

  it('early in the month the comparison covers only the days so far', async () => {
    setToday(2026, 10, 2);
    let d = source(ops.emptyData(), '2026-09-01', 'income', 'Paycheck', 900, '2026-09-01', { type: 'monthly' }, 'pay');
    d = unwrap(ops.recordActual(d, 'pay@2026-09-01', { amountCents: usd(900), date: '2026-09-01' }, at('2026-09-01')));
    await renderHome(unwrap(ops.completeOnboarding(d)));
    const progress = await screen.findByRole('region', { name: /Cash flow so far in October/ });
    expect(progress).toHaveTextContent('from Sep 1 – 2');
    expect(progress).toHaveTextContent(/Down \$900\.00 from Sep 1 – 2/);
  });

  it('the projected month is the forecast’s own figure: it equals the Forecast month total', async () => {
    const user = await renderHome(plan());
    const progress = await screen.findByRole('region', { name: /Cash flow so far in October/ });
    const projected = /October ends at\s*([+−]?\$[\d,]+\.\d\d)/.exec(progress.textContent ?? '')![1]!;
    await user.click(screen.getByRole('button', { name: 'Full forecast and calendar' }));
    const hero = await screen.findByRole('region', { name: 'Cash flow' });
    expect(within(hero).getByText(projected, { selector: '.hero-value' })).toBeInTheDocument();
  });
});

describe('Needs attention', () => {
  it('lists an overdue bill and an item due today, with neutral wording for expected money that is not recorded', async () => {
    let d = plan();
    d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Refund', amountCents: usd(75), date: '2026-10-09' }, at('2026-10-08'), 'refund'));
    await renderHome(d);
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    const rows = within(attention).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Refund'),
      expect.stringContaining('Phone'),
      expect.stringContaining('School trip'),
    ]);
    expect(rows[0]).toHaveTextContent('Expected Oct 9 — not recorded');
    expect(rows[0]).not.toHaveTextContent(/late|didn.t arrive|missed/i);
    expect(rows[1]).toHaveTextContent('Overdue since Oct 12');
    expect(rows[2]).toHaveTextContent('Due today');
  });

  it('opens the existing item sheet for an item', async () => {
    const user = await renderHome(plan());
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    await user.click(within(attention).getByRole('button', { name: /Phone/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Phone' });
    expect(within(sheet).getByRole('button', { name: /^Mark paid$/ })).toBeInTheDocument();
  });

  it('records a payment from the sheet and the item leaves the list, with the record kept', async () => {
    const user = await renderHome(plan());
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    await user.click(within(attention).getByRole('button', { name: /Phone/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Phone' });
    await user.click(within(sheet).getByRole('button', { name: /^Mark paid$/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Save as paid' }));
    await waitFor(() => expect(stored().records.find((r) => r.id === 'phone@2026-10-12')).toMatchObject({ status: 'completed', actualAmountCents: usd(60) }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Needs attention' })).queryByText('Phone')).toBeNull());
    expect(within(region('Happened this week')).getByText('Phone')).toBeInTheDocument();
  });

  it('marks several due items done in one step with no Undo, using each item’s expected amount and date', async () => {
    const user = await renderHome(plan());
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    await user.click(within(attention).getByRole('button', { name: 'Select all' }));
    await user.click(within(attention).getByRole('button', { name: 'Mark 2 items done' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull());
    const done = stored().records.filter((r) => ['phone@2026-10-12', 'trip'].includes(r.id)).map((r) => [r.id, r.status, r.actualAmountCents, r.actualDate]);
    expect(done.sort()).toEqual([
      ['phone@2026-10-12', 'completed', usd(60), '2026-10-12'],
      ['trip', 'completed', usd(40), TODAY],
    ]);
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it('moves selected due items to a later date', async () => {
    const user = await renderHome(plan());
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    await user.click(within(attention).getByRole('checkbox', { name: /Select Phone/ }));
    await user.click(within(attention).getByRole('button', { name: 'Move to a date' }));
    const date = within(attention).getByLabelText('New expected date for 1 item');
    await user.clear(date);
    await user.type(date, '2026-10-16');
    await user.click(within(attention).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(stored().records.find((r) => r.id === 'phone@2026-10-12')).toMatchObject({ status: 'scheduled', scheduledDate: '2026-10-16', expectedDate: '2026-10-12' }));
  });

  it('batch selection is offered only for items due today or earlier; an early payment is recorded one at a time', async () => {
    const user = await renderHome(plan());
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(within(attention).getAllByRole('checkbox')).toHaveLength(2);
    // Nothing coming up can be selected.
    expect(within(region('Coming up')).queryAllByRole('checkbox')).toHaveLength(0);
    // The Friday paycheck is not due, but can be recorded early on its own.
    await user.click(within(region('Coming up')).getByRole('button', { name: /Paycheck/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Paycheck' });
    await user.click(within(sheet).getByRole('button', { name: /^Mark received$/ }));
    await user.clear(within(sheet).getByLabelText('Date received'));
    await user.type(within(sheet).getByLabelText('Date received'), TODAY);
    await user.click(within(sheet).getByRole('button', { name: 'Save as received' }));
    await waitFor(() => expect(stored().records.find((r) => r.id === 'pay@2026-10-16')).toMatchObject({ status: 'completed', actualDate: TODAY, expectedDate: '2026-10-16' }));
  });

  it('shows a timing gap that starts within seven days, and opens its explanation', async () => {
    let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 100, '2026-10-14', { type: 'monthly' }, 'pay');
    d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(500), date: '2026-10-19' }, at(TODAY), 'repair'));
    const user = await renderHome(unwrap(ops.completeOnboarding(d)));
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(attention).toHaveTextContent('Timing gap from Oct 19');
    await user.click(within(attention).getByRole('button', { name: /Timing gap from Oct 19/ }));
    expect(await screen.findByRole('dialog', { name: '1 timing gap ahead' })).toBeInTheDocument();
  });

  it('puts a gap that starts after seven days under Coming up instead', async () => {
    let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 100, '2026-10-14', { type: 'monthly' }, 'pay');
    d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(500), date: '2026-10-20' }, at(TODAY), 'repair'));
    await renderHome(unwrap(ops.completeOnboarding(d)));
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    expect(region('Coming up')).toHaveTextContent('Timing gap from Oct 20');
  });
});

describe('Coming up and Happened', () => {
  it('lists the rest of the week and early next week by day, with reserves kept distinct from spending', async () => {
    await renderHome(plan());
    const coming = await screen.findByRole('region', { name: 'Coming up' });
    expect(within(coming).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Fri, Oct 16', 'Sun, Oct 18', 'Mon, Oct 19']);
    expect(coming).toHaveTextContent('through Tue, Oct 20');
    const reserve = within(coming).getByText('Emergency fund').closest('li')!;
    expect(reserve.querySelector('.amount-reserve')).not.toBeNull();
    expect(reserve.querySelector('.amount-out')).toBeNull();
  });

  it('shows what was recorded this week with the difference from what was expected', async () => {
    await renderHome(plan());
    const happened = await screen.findByRole('region', { name: 'Happened this week' });
    const row = within(happened).getByText('Side job').closest('li')!;
    expect(row).toHaveTextContent('Expected $150.00 on Oct 12');
    expect(row).toHaveTextContent('+$130.00');
  });

  it('does not repeat an item that already appears under Needs attention', async () => {
    await renderHome(plan());
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(within(region('Coming up')).queryByText('Phone')).toBeNull();
    expect(within(region('Coming up')).queryByText('School trip')).toBeNull();
  });
});

describe('Week navigation', () => {
  it('moves a week at a time without changing progress or what needs attention', async () => {
    const user = await renderHome(plan());
    await screen.findByRole('region', { name: 'Needs attention' });
    const progressBefore = region('Cash flow so far in October Recorded').textContent;
    const attentionBefore = region('Needs attention').textContent;

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Oct 18 – 24' })).toBeInTheDocument();
    const coming = region('Coming up');
    expect(within(coming).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Sun, Oct 18', 'Mon, Oct 19']);
    expect(screen.queryByRole('region', { name: 'Happened this week' })).toBeNull();
    // Today is still Oct 13: the overdue phone bill is still overdue, and progress is unchanged.
    expect(region('Needs attention').textContent).toBe(attentionBefore);
    expect(region('Cash flow so far in October Recorded').textContent).toBe(progressBefore);
    expect(within(region('Needs attention')).getByText('Overdue since Oct 12')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Oct 4 – 10' })).toBeInTheDocument();
    expect(within(region('Happened this week')).getByText('Side job')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Coming up' })).toBeNull();
    expect(region('Needs attention').textContent).toBe(attentionBefore);

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Oct 11 – 17' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('crosses a month boundary', async () => {
    setToday(2026, 10, 29);
    const user = await renderHome(plan());
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(screen.getByRole('heading', { level: 2, name: 'Oct 25 – 31' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Nov 1 – 7' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Oct 25 – 31' })).toBeInTheDocument();
  });

  it('crosses a year boundary', async () => {
    setToday(2026, 12, 30);
    let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1000, '2026-12-05', { type: 'monthly' }, 'pay');
    d = source(d, SETUP, 'bill', 'Rent', 700, '2026-12-30', { type: 'monthly' }, 'rent');
    const user = await renderHome(unwrap(ops.completeOnboarding(d)));
    await screen.findByRole('heading', { level: 1, name: /^Home/ });
    expect(screen.getByRole('heading', { level: 2, name: 'Dec 27, 2026 – Jan 2, 2027' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Jan 3 – 9' })).toBeInTheDocument();
    expect(within(region('Coming up')).getByText('Paycheck')).toBeInTheDocument();
    // Rent is due today, whichever week is on screen.
    expect(within(region('Needs attention')).getByText('Rent')).toBeInTheDocument();
  });
});

describe('Home never changes money by itself', () => {
  it('opening Home and moving between weeks saves nothing', async () => {
    const data = plan();
    const user = await renderHome(data);
    await screen.findByRole('region', { name: 'Needs attention' });
    const before = localStorage.getItem(STORAGE_KEY);
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('hides transfers when accounts are not available, and shows them where they are', async () => {
    let d = plan();
    d = unwrap(ops.addAccount(d, { name: 'Pay', type: 'income' }, at(SETUP), 'a1'));
    d = unwrap(ops.addAccount(d, { name: 'Bills', type: 'payment' }, at(SETUP), 'a2'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'a1', toAccountId: 'a2', amountCents: usd(300), date: '2026-10-14' }, 'expected', at(SETUP), 'move'));
    await renderHome(d);
    expect(await screen.findByText('Pay → Bills')).toBeInTheDocument();
    expect(region('Coming up')).toHaveTextContent('Oct 14, 2026 · Planned');
  });
});
