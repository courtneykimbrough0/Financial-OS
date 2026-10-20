import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { source, unwrap, usd, clockAt } from '../../domain/__tests__/helpers';
import { buildForecast, explainTimingGaps } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { GapsSheet } from '../components/gaps';

/*
 * The timing-gap explanation sheet. It only lays out what explainTimingGaps
 * returns, so every figure comes from the forecast. Today is Sun 2026-10-11;
 * paid $1,000 every 2 weeks from Thu Oct 15.
 */
const TODAY = '2026-10-11';
const clock = clockAt(TODAY);
const paid = () => source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'biweekly' }, 'pay');
const oneTime = (d: AppData, description: string, dollars: number, date: string, kind: 'varied' | 'income' = 'varied') =>
  unwrap(ops.addOneTime(d, { kind, description, amountCents: usd(dollars), date }, clock, `one-${description.toLowerCase().replace(/ /g, '-')}`));

function show(d: AppData, onWhatIf?: (id: string) => void) {
  const f = buildForecast(d, TODAY);
  const gaps = explainTimingGaps(f);
  let closed = false;
  render(<GapsSheet gaps={gaps} horizonEnd={f.horizonEnd} onClose={() => (closed = true)} onWhatIf={onWhatIf} />);
  return { gaps, closed: () => closed };
}

/** Text of a section's lines, one string per line. */
const lines = (el: HTMLElement) => Array.from(el.querySelectorAll('li')).map((li) => li.textContent);
const section = (group: HTMLElement, heading: string) => within(group).getByRole('heading', { name: heading }).nextElementSibling as HTMLElement;

describe('GapsSheet', () => {
  it('one gap: what leads to the low point, and the paycheck that brings it back', () => {
    // Rent $1,200 Oct 19 (−$200); side job +$150 Oct 21 (−$50); phone $60 Oct 24 (−$110); paycheck Oct 29 (+$890).
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = oneTime(d, 'Side job', 150, '2026-10-21', 'income');
    d = oneTime(d, 'Phone', 60, '2026-10-24');
    show(d);
    const dialog = screen.getByRole('dialog', { name: '1 timing gap ahead' });
    const [gap] = within(dialog).getAllByRole('group');
    expect(gap).toHaveAttribute('open');
    expect(within(gap!).getByText(/Oct 19 – 28/)).toBeInTheDocument();
    expect(gap).toHaveTextContent('Down to −$200.00 on Oct 19');
    expect(gap).toHaveTextContent('Running total before, Oct 18$1,000.00');
    expect(lines(section(gap!, 'Leading to the lowest point'))).toEqual(['Oct 19Rent−$1,200.00']);
    expect(gap).toHaveTextContent('Running total, Oct 19−$200.00');
    expect(lines(section(gap!, 'While still below $0'))).toEqual(['Oct 21Side job+$150.00', 'Oct 24Phone−$60.00']);
    expect(lines(section(gap!, 'Back to $0 or more'))).toEqual(['Oct 29Paycheck+$1,000.00']);
    expect(gap).toHaveTextContent('Running total, Oct 29$890.00');
  });

  it('several payments and income before the low point, in date order; no "still below" section when there is nothing after it', () => {
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = source(d, TODAY, 'bill', 'Phone', 60, '2026-10-20', { type: 'monthly' }, 'phone');
    d = source(d, TODAY, 'income', 'Side job', 100, '2026-10-21', { type: 'monthly' }, 'side');
    d = source(d, TODAY, 'liability', 'Car loan', 350, '2026-10-22', { type: 'monthly' }, 'car');
    show(d);
    const [first, second] = screen.getAllByRole('group');
    expect(lines(section(first!, 'Leading to the lowest point'))).toEqual([
      'Oct 19Rent−$1,200.00',
      'Oct 20Phone−$60.00',
      'Oct 21Side job+$100.00',
      'Oct 22Car loan−$350.00',
    ]);
    expect(first).toHaveTextContent('Running total, Oct 22−$510.00');
    expect(within(first!).queryByRole('heading', { name: 'While still below $0' })).toBeNull();
    // A second, separate gap in November is listed too, collapsed until opened.
    expect(second).toHaveTextContent('Nov 22 – 25');
    expect(second).toHaveTextContent('Down to −$20.00 on Nov 22');
    expect(second).not.toHaveAttribute('open');
  });

  it('a paycheck that moved later shows as the income that ends the gap', () => {
    let d = source(paid(), TODAY, 'bill', 'Rent', 1500, '2026-10-30', { type: 'monthly' }, 'rent');
    d = unwrap(ops.rescheduleOccurrence(d, 'pay@2026-10-29', { date: '2026-11-02', amountCents: usd(1000) }, clock));
    show(d);
    const [gap] = screen.getAllByRole('group');
    expect(lines(section(gap!, 'Leading to the lowest point'))).toEqual(['Oct 30Rent−$1,500.00']);
    expect(lines(section(gap!, 'Back to $0 or more'))).toEqual(['Nov 2Paycheck+$1,000.00']);
    expect(gap).toHaveTextContent('Running total, Nov 2$500.00');
  });

  it('shows everything on the recovery day, not only the income', () => {
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = oneTime(d, 'Phone', 60, '2026-10-29');
    show(d);
    const [gap] = screen.getAllByRole('group');
    expect(lines(section(gap!, 'Back to $0 or more'))).toEqual(['Oct 29Paycheck+$1,000.00', 'Oct 29Phone−$60.00']);
    expect(gap).toHaveTextContent('Running total, Oct 29$740.00');
  });

  it("says so when the running total doesn't recover within the forecast", () => {
    let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'monthly' }, 'pay');
    d = source(d, TODAY, 'bill', 'Rent', 2100, '2026-10-20', { type: 'monthly' }, 'rent');
    show(d);
    const [gap] = screen.getAllByRole('group');
    expect(gap).toHaveTextContent("It stays below $0 through Nov 15, 2027.");
    expect(within(gap!).queryByText(/Running total, (Jan|Feb)/)).toBeNull();
  });

  it('opens a collapsed gap and closes with Escape (Enter on a gap is checked in the browser test)', async () => {
    const user = userEvent.setup();
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = source(d, TODAY, 'liability', 'Car loan', 950, '2026-11-22', { type: 'monthly' }, 'car');
    const { closed } = show(d);
    const groups = screen.getAllByRole('group');
    expect(groups.length).toBeGreaterThan(1);
    const summary = groups[1]!.querySelector('summary')!;
    await user.click(summary);
    expect(groups[1]).toHaveAttribute('open');
    await user.keyboard('{Escape}');
    expect(closed()).toBe(true);
  });

  it('offers "See what happens if…" on each outstanding entry, when asked to', async () => {
    const user = userEvent.setup();
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = oneTime(d, 'Phone', 60, '2026-10-24');
    // A recorded payment (dated today or earlier) never sits in a future gap; the sheet refuses those itself.
    const asked: string[] = [];
    show(d, (id) => asked.push(id));
    const [gap] = screen.getAllByRole('group');
    expect(within(gap!).getAllByRole('button', { name: /^See what happens if/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'See what happens if Rent on Oct 19 changes',
      'See what happens if Phone on Oct 24 changes',
      'See what happens if Paycheck on Oct 29 changes',
    ]);
    await user.click(within(gap!).getByRole('button', { name: 'See what happens if Phone on Oct 24 changes' }));
    expect(asked).toEqual(['one-phone']);
  });

  it('has no "What if…" without a handler (as at the end of setup)', () => {
    show(source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent'));
    expect(screen.queryByRole('button', { name: /^What if/ })).toBeNull();
  });

  it('matches the forecast for every figure shown', () => {
    let d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-19', { type: 'monthly' }, 'rent');
    d = oneTime(d, 'Phone', 60, '2026-10-24');
    const { gaps } = show(d);
    const g = gaps[0]!;
    const [gap] = screen.getAllByRole('group');
    expect(gap).toHaveTextContent(`Running total before, Oct 18$${(g.beforeCents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`);
    expect(g.beforeCents + g.inflowCents - g.outflowCents).toBe(g.lowestCents);
  });
});
