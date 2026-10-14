import { describe, expect, it } from 'vitest';
import { buildForecast, explainTimingGaps, lowestPoint, dailyTimeline, tallyOn } from '../forecast';
import { findOccurrence } from '../occurrences';
import * as ops from '../operations';
import { applyPreviewedChange, previewChange, type ChangePreview, type ProposedChange } from '../preview';
import type { AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

/*
 * Step 4: previewing one change before making it. Today is Sun 2026-10-11.
 * Paid $1,000 every 2 weeks from Thu Oct 15 (Oct 15, 29, Nov 12, 26, Dec 10, 24, Jan 7).
 * The comparison window is the 90 days from Oct 15: Oct 15 – Jan 12.
 */
const TODAY = '2026-10-11';
const clock = clockAt(TODAY);
const paid = () => source(ops.emptyData(), TODAY, 'income', 'Paycheck', 1000, '2026-10-15', { type: 'biweekly' }, 'pay');
const oneTime = (d: AppData, description: string, dollars: number, date: string) =>
  unwrap(ops.addOneTime(d, { kind: 'bill', description, amountCents: usd(dollars), date }, clock, `one-${description.toLowerCase()}`));

/** Car repair $1,300 on Oct 20 → −$300 until the Oct 29 paycheck ($700). Tuition $1,500 on Nov 30. */
function withRepair(): AppData {
  return oneTime(oneTime(paid(), 'Repair', 1300, '2026-10-20'), 'Tuition', 1500, '2026-11-30');
}

function preview(d: AppData, change: ProposedChange): ChangePreview {
  const r = previewChange(d, change, clock);
  if (!r.ok) throw new Error(r.error);
  return r.preview;
}

const gapList = (gaps: { start: string; end: string; lowestCents: number; recoversOn: string | null }[]) =>
  gaps.map((g) => [g.start, g.end, g.lowestCents / 100, g.recoversOn]);

describe('moving a payment', () => {
  it('later, past the next paycheck: the shortfall it caused is gone, and nothing new appears', () => {
    const p = preview(withRepair(), { kind: 'move', occurrenceId: 'one-repair', date: '2026-10-30' });
    expect(p.comparable).toBe(true);
    expect(p.window).toEqual({ start: '2026-10-15', end: '2027-01-12' });
    expect(gapList(p.current.gaps)).toEqual([['2026-10-20', '2026-10-28', -300, '2026-10-29']]);
    expect(p.proposed.gaps).toEqual([]);
    expect(p.target).toMatchObject({ outcome: 'eliminated', recoversOn: { current: '2026-10-29', proposed: null } });
    expect(p.target!.gap.start).toBe('2026-10-20');
    expect(p.current.lowest).toEqual({ date: '2026-10-20', tallyCents: usd(-300) });
    // Oct 15 $1,000, Oct 29 $2,000, Oct 30 $700, Nov 12 $1,700, … the lowest is now the first payday.
    expect(p.proposed.lowest).toEqual({ date: '2026-10-30', tallyCents: usd(700) });
    expect(p.lowestChangeCents).toBe(usd(1000));
    expect(p.newGaps).toEqual([]);
    expect(p.worsenedGaps).toEqual([]);
  });

  it('only partway: the same low point, but fewer days below $0, counts as reduced', () => {
    const p = preview(withRepair(), { kind: 'move', occurrenceId: 'one-repair', date: '2026-10-25' });
    expect(gapList(p.proposed.gaps)).toEqual([['2026-10-25', '2026-10-28', -300, '2026-10-29']]);
    expect(p.target!.outcome).toBe('reduced');
    expect(p.lowestChangeCents).toBe(0);
  });

  it('earlier, before a paycheck: a new shortfall appears elsewhere, shown next to the existing one', () => {
    // Tuition moves from Nov 30 to Nov 11, the day before a paycheck: $700 − $1,500 = −$800, then $200 on Nov 12.
    const p = preview(withRepair(), { kind: 'move', occurrenceId: 'one-tuition', date: '2026-11-11' });
    expect(p.target).toBeNull(); // Tuition isn't in a shortfall today.
    expect(gapList(p.newGaps)).toEqual([['2026-11-11', '2026-11-11', -800, '2026-11-12']]);
    expect(gapList(p.proposed.gaps)).toEqual([
      ['2026-10-20', '2026-10-28', -300, '2026-10-29'],
      ['2026-11-11', '2026-11-11', -800, '2026-11-12'],
    ]);
    expect(p.proposed.lowest).toEqual({ date: '2026-11-11', tallyCents: usd(-800) });
    expect(p.lowestChangeCents).toBe(usd(-500));
  });

  it('to before the next payday: flagged instead of shown as a fix, since the running total starts at payday', () => {
    const p = preview(withRepair(), { kind: 'move', occurrenceId: 'one-repair', date: '2026-10-13' });
    expect(p.comparable).toBe(false);
    expect(p.limitation).toMatch(/before the next payday \(2026-10-15\)/);
    expect(p.target).toBeNull();
    expect(p.lowestChangeCents).toBeNull();
  });
});

describe('changing an amount', () => {
  it('smaller: the shortfall is reduced but not gone', () => {
    const p = preview(withRepair(), { kind: 'amount', occurrenceId: 'one-repair', amountCents: usd(1100) });
    expect(gapList(p.proposed.gaps)).toEqual([['2026-10-20', '2026-10-28', -100, '2026-10-29']]);
    expect(p.target).toMatchObject({ outcome: 'reduced', recoversOn: { current: '2026-10-29', proposed: '2026-10-29' } });
    expect(p.lowestChangeCents).toBe(usd(200));
  });

  it('larger: later shortfalls get deeper or appear, and each is reported', () => {
    // A dentist bill of $1,000 on Nov 11 already leaves −$300 before the Nov 12 paycheck.
    const d = oneTime(withRepair(), 'Dentist', 1000, '2026-11-11');
    const p = preview(d, { kind: 'amount', occurrenceId: 'one-repair', amountCents: usd(1600) });
    expect(gapList(p.current.gaps)).toEqual([
      ['2026-10-20', '2026-10-28', -300, '2026-10-29'],
      ['2026-11-11', '2026-11-11', -300, '2026-11-12'],
    ]);
    expect(p.target!.outcome).toBe('worsened');
    expect(gapList(p.worsenedGaps)).toEqual([['2026-11-11', '2026-11-11', -600, '2026-11-12']]);
    // And tuition on Nov 30, covered today ($1,700 − $1,500 = $200), now isn't: $1,400 − $1,500 = −$100 until Dec 10.
    expect(gapList(p.newGaps)).toEqual([['2026-11-30', '2026-12-09', -100, '2026-12-10']]);
  });

  it('larger: the shortfall gets worse', () => {
    const p = preview(withRepair(), { kind: 'amount', occurrenceId: 'one-repair', amountCents: usd(1600) });
    expect(gapList(p.proposed.gaps)).toEqual([['2026-10-20', '2026-10-28', -600, '2026-10-29']]);
    expect(p.target!.outcome).toBe('worsened');
    expect(p.lowestChangeCents).toBe(usd(-300));
  });
});

describe('skipping one occurrence', () => {
  // Rent $1,200 monthly from Oct 20: −$200 until Oct 29; later months stay above $0.
  const rent = () => source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');

  it('leaves out only that one; later rent payments stay in the preview', () => {
    const p = preview(rent(), { kind: 'skip', occurrenceId: 'rent@2026-10-20' });
    expect(p.target!.outcome).toBe('eliminated');
    const at = (side: ChangePreview['current'], date: string) => side.tallies.find((t) => t.date === date)?.cents;
    // Nov 20 still has rent in both; it is $1,200 higher only because October's was left out.
    expect([at(p.current, '2026-11-20'), at(p.proposed, '2026-11-20')]).toEqual([usd(600), usd(1800)]);
    expect([at(p.current, '2026-12-20'), at(p.proposed, '2026-12-20')]).toEqual([usd(1400), usd(2600)]);
  });
});

describe('moving income', () => {
  it('a paycheck that arrives sooner shortens the shortfall and moves its recovery', () => {
    // The Oct 29 paycheck (not the next one, so the starting point stays Oct 15) moves to Oct 22.
    const d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');
    const p = preview(d, { kind: 'move', occurrenceId: 'pay@2026-10-29', date: '2026-10-22' });
    expect(p.anchorChanged).toBe(false);
    expect(gapList(p.proposed.gaps)).toEqual([['2026-10-20', '2026-10-21', -200, '2026-10-22']]);
    expect(p.target).toMatchObject({ outcome: 'reduced', recoversOn: { current: '2026-10-29', proposed: '2026-10-22' } });
    // The paycheck isn't inside the gap; it is the income that ends it, so that gap is the one compared.
    expect(p.target!.gap.start).toBe('2026-10-20');
  });

  it('a paycheck that arrives later opens a shortfall where there was none', () => {
    // Rent $1,500 on Oct 30 is covered by the Oct 29 paycheck; moved to Nov 2, Oct 30 – Nov 1 drop to −$500.
    const d = source(paid(), TODAY, 'bill', 'Rent', 1500, '2026-10-30', { type: 'monthly' }, 'rent');
    const p = preview(d, { kind: 'move', occurrenceId: 'pay@2026-10-29', date: '2026-11-02' });
    expect(p.target).toBeNull();
    expect(gapList(p.newGaps)).toEqual([['2026-10-30', '2026-11-01', -500, '2026-11-02']]);
  });

  it('moving the next payday changes the starting point, so the totals aren’t compared', () => {
    const d = source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');
    for (const change of [
      { kind: 'move', occurrenceId: 'pay@2026-10-15', date: '2026-10-16' },
      { kind: 'skip', occurrenceId: 'pay@2026-10-15' },
    ] as ProposedChange[]) {
      const p = preview(d, change);
      expect(p.anchorChanged).toBe(true);
      expect(p.comparable).toBe(false);
      expect(p.limitation).toMatch(/moves the next main payday from 2026-10-15/);
      expect([p.lowestChangeCents, p.target, p.newGaps, p.worsenedGaps]).toEqual([null, null, [], []]);
      // Each side is still described on its own terms.
      expect(p.current.forecastStart).toBe('2026-10-15');
      expect(p.proposed.forecastStart).toBe(change.kind === 'skip' ? '2026-10-29' : '2026-10-16');
    }
  });
});

describe('what a preview refuses', () => {
  it('rejects changes the ordinary operations would reject', () => {
    const d = withRepair();
    expect(previewChange(d, { kind: 'move', occurrenceId: 'one-repair', date: '2026-10-10' }, clock)).toEqual({ ok: false, error: 'Choose today or a later date.' });
    expect(previewChange(d, { kind: 'amount', occurrenceId: 'one-repair', amountCents: 0 }, clock)).toEqual({ ok: false, error: 'Amount must be greater than $0.' });
    expect(previewChange(d, { kind: 'skip', occurrenceId: 'nope' }, clock)).toEqual({ ok: false, error: 'That transaction could not be found.' });
  });

  it('can’t change a payment that is already recorded', () => {
    const d = unwrap(ops.recordActual(withRepair(), 'one-repair', { amountCents: usd(1300), date: TODAY }, clock));
    expect(previewChange(d, { kind: 'move', occurrenceId: 'one-repair', date: '2026-10-30' }, clock)).toEqual({ ok: false, error: 'Only outstanding transactions can be changed.' });
    expect(previewChange(d, { kind: 'amount', occurrenceId: 'one-repair', amountCents: usd(1) }, clock)).toEqual({ ok: false, error: 'Only outstanding transactions can be changed.' });
    expect(previewChange(d, { kind: 'skip', occurrenceId: 'one-repair' }, clock)).toEqual({ ok: false, error: 'This transaction was already recorded. Undo the recorded outcome first.' });
  });
});

describe('previews', () => {
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  it('never change the saved data, and give the same result each time', () => {
    const d = withRepair();
    const snapshot = JSON.stringify(d);
    deepFreeze(d);
    const change: ProposedChange = { kind: 'move', occurrenceId: 'one-repair', date: '2026-10-30' };
    expect(preview(d, change)).toEqual(preview(d, change));
    preview(d, { kind: 'skip', occurrenceId: 'one-tuition' });
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('with no shortfall either way, report none and the change in the lowest total', () => {
    const d = oneTime(paid(), 'Phone', 60, '2026-10-20');
    const p = preview(d, { kind: 'amount', occurrenceId: 'one-phone', amountCents: usd(80) });
    expect([p.comparable, p.current.gaps, p.proposed.gaps, p.target, p.newGaps]).toEqual([true, [], [], null, []]);
    expect([p.current.lowest, p.proposed.lowest]).toEqual([
      { date: '2026-10-20', tallyCents: usd(940) },
      { date: '2026-10-20', tallyCents: usd(920) },
    ]);
    expect(p.lowestChangeCents).toBe(usd(-20));
  });

  it('reconcile with the forecasts they come from', () => {
    const d = withRepair();
    const change: ProposedChange = { kind: 'move', occurrenceId: 'one-tuition', date: '2026-11-11' };
    const p = preview(d, change);
    const proposedData = unwrap(ops.rescheduleOccurrence(d, 'one-tuition', { date: '2026-11-11', amountCents: usd(1500) }, clock));
    for (const [side, f] of [
      [p.current, buildForecast(d, TODAY)],
      [p.proposed, buildForecast(proposedData, TODAY)],
    ] as const) {
      for (const t of side.tallies) expect(tallyOn(f, t.date)).toBe(t.cents);
      expect(side.lowest).toEqual(lowestPoint(dailyTimeline(f, p.window.start, p.window.end)));
      expect(side.gaps).toEqual(explainTimingGaps(f));
    }
  });
});

describe('applying a previewed change', () => {
  const rent = () => source(paid(), TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');

  it.each([
    { change: { kind: 'move', occurrenceId: 'rent@2026-10-20', date: '2026-10-30' }, expected: { status: 'scheduled', scheduledDate: '2026-10-30', scheduledAmountCents: usd(1200) } },
    { change: { kind: 'amount', occurrenceId: 'rent@2026-10-20', amountCents: usd(1000) }, expected: { status: 'scheduled', scheduledDate: '2026-10-20', scheduledAmountCents: usd(1000) } },
    { change: { kind: 'skip', occurrenceId: 'rent@2026-10-20' }, expected: { status: 'canceled', cancelNote: 'Skipped after a what-if preview' } },
  ] as { change: ProposedChange; expected: object }[])('$change.kind changes exactly that one occurrence, keeping its original prediction', ({ change, expected }) => {
    const before = rent();
    const after = unwrap(applyPreviewedChange(before, before, change, clock));
    expect(after.records).toHaveLength(1);
    expect(after.records[0]).toMatchObject({ id: 'rent@2026-10-20', expectedDate: '2026-10-20', expectedAmountCents: usd(1200), ...expected });
    expect(after.sources).toEqual(before.sources);
    expect(findOccurrence(after, 'rent@2026-11-20', TODAY)).toMatchObject({ virtual: true, scheduledAmountCents: usd(1200) });
    // The applied forecast is the one the preview showed.
    const p = preview(before, change);
    const applied = buildForecast(after, TODAY);
    expect(p.proposed.tallies.map((t) => tallyOn(applied, t.date))).toEqual(p.proposed.tallies.map((t) => t.cents));
  });

  it('refuses a preview made on data that has changed since', () => {
    const previewedOn = rent();
    const changed = unwrap(ops.addOneTime(previewedOn, { kind: 'bill', description: 'Vet', amountCents: usd(90), date: '2026-10-22' }, clock));
    expect(applyPreviewedChange(changed, previewedOn, { kind: 'move', occurrenceId: 'rent@2026-10-20', date: '2026-10-30' }, clock)).toEqual({
      ok: false,
      error: 'Your forecast changed after this preview. Check the updated preview before applying.',
    });
  });

  it('refuses a preview that can’t be compared, and a recorded payment', () => {
    const d = rent();
    expect(applyPreviewedChange(d, d, { kind: 'move', occurrenceId: 'pay@2026-10-15', date: '2026-10-16' }, clock)).toMatchObject({ ok: false, error: /can’t be compared/ });
    const paidRent = unwrap(ops.recordActual(d, 'rent@2026-10-20', { amountCents: usd(1200), date: TODAY }, clock));
    expect(applyPreviewedChange(paidRent, paidRent, { kind: 'amount', occurrenceId: 'rent@2026-10-20', amountCents: usd(1) }, clock)).toMatchObject({ ok: false });
  });
});
