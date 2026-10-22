import { describe, expect, it } from 'vitest';
import { migrate } from '../../state/storage';
import { activityView } from '../activity';
import { buildForecast, dailyTimeline, overdueEntries, periodKpis, totals, type Forecast } from '../forecast';
import { homeView } from '../home';
import { findOccurrence } from '../occurrences';
import * as ops from '../operations';
import { periodPlan } from '../plan';
import { evaluateScenario, scenarioOptions } from '../scenarios';
import { hasPossibleIncome, isUncountedPossible, type AppData } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

// E1: income certainty. Tuesday Oct 13, 2026; the week is Sun Oct 11 – Sat Oct 17.
const TODAY = '2026-10-13';
const SETUP = '2026-10-01';
const clock = clockAt(TODAY);

/** Paycheck $1,000 every 2 weeks from Oct 16; rent $800 on the 25th. Only expected items. */
function baseline(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1000, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 800, '2026-10-25', { type: 'monthly' }, 'rent');
  return d;
}

/** The baseline plus possible income: tips of $200 every week from Oct 14, and a $500 invoice on Oct 20. */
function withPossible(): AppData {
  let d = unwrap(ops.addSource(baseline(), { kind: 'income', description: 'Tips', amountCents: usd(200), startDate: '2026-10-14', rule: { type: 'weekly' }, certainty: 'possible' }, clockAt(SETUP), 'tips'));
  d = unwrap(ops.addOneTime(d, { kind: 'income', description: 'Invoice', amountCents: usd(500), date: '2026-10-20', certainty: 'possible' }, clockAt(SETUP), 'invoice'));
  return d;
}

const tallies = (f: Forecast, start: string, end: string) => dailyTimeline(f, start, end).map((r) => [r.date, r.tallyCents]);
const entry = (f: Forecast, id: string) => f.entries.filter((e) => e.occurrence.id === id);

describe('possible income is listed, never counted', () => {
  it('it is in the forecast, marked possible, with no effect on any total or the running total', () => {
    const f = buildForecast(withPossible(), TODAY);
    const tip = entry(f, 'tips@2026-10-14')[0]!;
    expect(tip).toMatchObject({ date: '2026-10-14', amountCents: usd(200), signedCents: 0, counts: false, possible: true, carriedForward: false });
    expect(entry(f, 'invoice')[0]).toMatchObject({ date: '2026-10-20', amountCents: usd(500), signedCents: 0, counts: false, possible: true });

    // Every total and every day's running total is exactly the baseline's.
    const without = buildForecast(baseline(), TODAY);
    for (const [start, end] of [['2026-10-01', '2026-10-31'], ['2026-10-11', '2026-10-17'], ['2026-10-13', '2026-12-31']] as const) {
      expect(periodKpis(f, start, end)).toEqual(periodKpis(without, start, end));
      expect(totals(f.entries.filter((e) => e.date >= start && e.date <= end))).toEqual(totals(without.entries.filter((e) => e.date >= start && e.date <= end)));
      expect(periodPlan(f, start, end)).toEqual(periodPlan(without, start, end));
    }
    expect(tallies(f, '2026-10-13', '2026-12-31')).toEqual(tallies(without, '2026-10-13', '2026-12-31'));
    // By hand: Oct 16 +1,000; Oct 25 −800; Oct 30 +1,000.
    expect(f.entries.filter((e) => e.counts && e.date <= '2026-10-31').reduce((n, e) => n + e.signedCents, 0)).toBe(usd(1200));
  });

  it('it never starts the running total, even when it comes first', () => {
    const f = buildForecast(withPossible(), TODAY);
    // Tips on Oct 14 come before the paycheck on Oct 16; the running total still starts with the paycheck.
    expect(f.forecastStart).toBe('2026-10-16');
    expect(f.anchor).toBe('2026-10-15');
  });

  it('with only possible income there is no dependable income to start the running total', () => {
    const d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Tips', amountCents: usd(200), startDate: '2026-10-14', rule: { type: 'weekly' }, certainty: 'possible' }, clock, 'tips'));
    const f = buildForecast(d, TODAY);
    expect(f.issue).toBe('no-recurring-income');
    expect(f.forecastStart).toBeNull();
    expect(f.entries.every((e) => !e.counts)).toBe(true);
  });

  it('a date that has passed makes it neither overdue nor carried forward, and it never needs attention', () => {
    const d = unwrap(ops.addOneTime(baseline(), { kind: 'income', description: 'Invoice', amountCents: usd(500), date: '2026-10-09', certainty: 'possible' }, clockAt('2026-10-05'), 'invoice'));
    const f = buildForecast(d, TODAY);
    const invoice = entry(f, 'invoice')[0]!;
    expect(invoice.occurrence.displayStatus).toBe('scheduled');
    expect(invoice).toMatchObject({ date: '2026-10-09', counts: false, carriedForward: false, possible: true });
    expect(overdueEntries(f)).toHaveLength(0);
    const home = homeView(d, TODAY);
    expect(home.attention.map((i) => i.id)).not.toContain('invoice');
  });

  it("Home lists this week's possible income on its own, outside coming up and progress", () => {
    const home = homeView(withPossible(), TODAY);
    // Coming up runs through early next week (Tue Oct 20), so the invoice is in it too.
    expect(home.possible.map((i) => i.id)).toEqual(['tips@2026-10-14', 'invoice']);
    expect(home.comingUp.map((i) => i.id)).toEqual(['pay@2026-10-16']);
    expect(home.progress).toEqual(homeView(baseline(), TODAY).progress);
  });

  it('scenarios offer only counted items, and a change to possible income is refused rather than shown as having no effect', () => {
    const options = scenarioOptions(withPossible(), TODAY);
    expect(options.occurrences.map((o) => o.id)).not.toContain('invoice');
    expect(options.occurrences.map((o) => o.id)).not.toContain('tips@2026-10-14');
    const outcome = evaluateScenario(withPossible(), [{ kind: 'occurrence-skip', occurrenceId: 'invoice' }], clock);
    expect(outcome).toEqual({ ok: false, error: "Invoice is possible income, which isn't counted, so changing it here changes nothing. Mark it expected first." });
  });
});

describe('received possible income counts once, as recorded', () => {
  it('a recorded tip counts at its recorded date and amount, once, and the rest of the item stays possible', () => {
    const at = clockAt('2026-10-15');
    const d = unwrap(ops.recordActual(withPossible(), 'tips@2026-10-14', { amountCents: usd(180), date: '2026-10-15' }, at));
    const f = buildForecast(d, '2026-10-15');
    const tip = entry(f, 'tips@2026-10-14');
    expect(tip).toHaveLength(1);
    expect(tip[0]).toMatchObject({ date: '2026-10-15', amountCents: usd(180), signedCents: usd(180), counts: true });
    expect(tip[0]!.possible).toBeUndefined();
    // The expected $200 isn't also counted, and next week's tip is still possible.
    expect(f.entries.filter((e) => e.occurrence.sourceId === 'tips' && e.counts)).toHaveLength(1);
    expect(entry(f, 'tips@2026-10-21')[0]).toMatchObject({ counts: false, possible: true });
    // Activity's received total is exactly the recorded amount.
    const activity = activityView(f, '2026-10-01', '2026-10-31');
    expect(activity.items.map((i) => [i.entry.occurrence.id, i.entry.amountCents])).toEqual([['tips@2026-10-14', usd(180)]]);
    // The recorded tip is history: the stored record has no certainty of its own.
    expect(d.records.find((r) => r.id === 'tips@2026-10-14')!.certainty).toBeUndefined();
  });

  it('recorded possible one-time income counts once; undoing the record makes it possible again', () => {
    const at = clockAt('2026-10-21');
    const d = unwrap(ops.recordActual(withPossible(), 'invoice', { amountCents: usd(450), date: '2026-10-21' }, at));
    const f = buildForecast(d, '2026-10-21');
    expect(entry(f, 'invoice')).toEqual([expect.objectContaining({ date: '2026-10-21', amountCents: usd(450), signedCents: usd(450), counts: true })]);
    expect(ops.setIncomeCertainty(d, 'invoice', 'expected', at)).toEqual({ ok: false, error: 'This income is already recorded.' });
    const undone = unwrap(ops.restoreOccurrence(d, 'invoice', at));
    expect(entry(buildForecast(undone, '2026-10-21'), 'invoice')[0]).toMatchObject({ counts: false, possible: true, amountCents: usd(500) });
  });
});

describe('marking income expected or possible', () => {
  it('marking an invoice expected counts it on its date, once; marking it possible again restores every total', () => {
    const marked = unwrap(ops.setIncomeCertainty(withPossible(), 'invoice', 'expected', clock));
    const f = buildForecast(marked, TODAY);
    expect(entry(f, 'invoice')).toEqual([expect.objectContaining({ date: '2026-10-20', signedCents: usd(500), counts: true })]);
    expect(entry(f, 'invoice')[0]!.possible).toBeUndefined();
    const before = buildForecast(withPossible(), TODAY);
    // The running total rises by exactly $500 from Oct 20 on, and not before.
    const b = dailyTimeline(before, '2026-10-16', '2026-11-30');
    const a = dailyTimeline(f, '2026-10-16', '2026-11-30');
    a.forEach((row, i) => expect(row.tallyCents! - b[i]!.tallyCents!).toBe(row.date >= '2026-10-20' ? usd(500) : 0));
    // Nothing else about it changed.
    const was = withPossible().records.find((r) => r.id === 'invoice')!;
    const now = marked.records.find((r) => r.id === 'invoice')!;
    expect({ ...now, updatedAt: was.updatedAt }).toEqual((({ certainty: _c, ...rest }) => rest)(was));

    const back = unwrap(ops.setIncomeCertainty(marked, 'invoice', 'possible', clock));
    expect(tallies(buildForecast(back, TODAY), '2026-10-13', '2026-12-31')).toEqual(tallies(before, '2026-10-13', '2026-12-31'));
  });

  it('marking a recurring item expected counts each payment not yet received, and the item can start the running total', () => {
    const plan = withPossible();
    const marked = unwrap(ops.setIncomeCertainty(plan, 'tips', 'expected', clock));
    const f = buildForecast(marked, TODAY);
    expect(f.forecastStart).toBe('2026-10-14');
    expect(entry(f, 'tips@2026-10-14')[0]).toMatchObject({ counts: true, signedCents: usd(200) });
    expect(marked.sources.find((s) => s.id === 'tips')!.versions).toEqual(plan.sources.find((s) => s.id === 'tips')!.versions);
  });

  it('marking a recurring item expected counts from today: earlier unrecorded dates are skipped, never carried into the running total', () => {
    // Tips every week from Sep 15 (possible); Sep 22 was received. Today is Oct 13.
    let d = unwrap(ops.addSource(baseline(), { kind: 'income', description: 'Tips', amountCents: usd(200), startDate: '2026-09-15', rule: { type: 'weekly' }, certainty: 'possible' }, clockAt('2026-09-10'), 'tips'));
    d = unwrap(ops.recordActual(d, 'tips@2026-09-22', { amountCents: usd(150), date: '2026-09-22' }, clockAt('2026-09-22')));
    const marked = unwrap(ops.setIncomeCertainty(d, 'tips', 'expected', clock));
    const f = buildForecast(marked, TODAY);
    // Sep 15, Sep 29 and Oct 6 never arrived: skipped with a note, not overdue.
    expect(marked.records.filter((r) => r.sourceId === 'tips').map((r) => [r.id, r.status, r.cancelNote])).toEqual([
      ['tips@2026-09-22', 'completed', null],
      ['tips@2026-09-15', 'canceled', ops.POSSIBLE_NOT_RECEIVED_NOTE],
      ['tips@2026-09-29', 'canceled', ops.POSSIBLE_NOT_RECEIVED_NOTE],
      ['tips@2026-10-06', 'canceled', ops.POSSIBLE_NOT_RECEIVED_NOTE],
    ]);
    expect(overdueEntries(f)).toHaveLength(0);
    expect(f.entries.some((e) => e.carriedForward)).toBe(false);
    // Today's tip and later ones count, and today's starts the running total.
    expect(f.forecastStart).toBe(TODAY);
    expect(entry(f, 'tips@2026-10-13')[0]).toMatchObject({ counts: true, signedCents: usd(200) });
    // The received tip still counts once, as recorded.
    expect(f.entries.filter((e) => e.occurrence.id === 'tips@2026-09-22' && e.counts).map((e) => e.signedCents)).toEqual([usd(150)]);
    // A skipped date can be restored and recorded if it did arrive.
    const restored = unwrap(ops.restoreOccurrence(marked, 'tips@2026-10-06', clock));
    expect(unwrap(ops.recordActual(restored, 'tips@2026-10-06', { amountCents: usd(90), date: '2026-10-07' }, clock)).records.find((r) => r.id === 'tips@2026-10-06')!.status).toBe('completed');
    // Marking an item that is already expected touches no occurrence.
    expect(unwrap(ops.setIncomeCertainty(baseline(), 'pay', 'expected', clock)).records).toEqual([]);
  });

  it('a rescheduled payment follows its item: it is stored without a certainty and counts once the item is expected', () => {
    let d = unwrap(ops.rescheduleOccurrence(withPossible(), 'tips@2026-10-14', { date: '2026-10-15', amountCents: usd(250) }, clock));
    expect(d.records.find((r) => r.id === 'tips@2026-10-14')!.certainty).toBeUndefined();
    expect(isUncountedPossible(findOccurrence(d, 'tips@2026-10-14', TODAY)!)).toBe(true);
    d = unwrap(ops.setIncomeCertainty(d, 'tips', 'expected', clock));
    expect(entry(buildForecast(d, TODAY), 'tips@2026-10-14')[0]).toMatchObject({ date: '2026-10-15', signedCents: usd(250), counts: true });
  });

  it('only income can be possible', () => {
    expectError(ops.setIncomeCertainty(withPossible(), 'rent', 'possible', clock), /Only income can be possible/);
    const spend = unwrap(ops.addOneTime(baseline(), { kind: 'varied', description: 'Repair', amountCents: usd(90), date: '2026-10-20', certainty: 'possible' }, clock, 'repair'));
    expect(spend.records.find((r) => r.id === 'repair')!.certainty).toBeUndefined();
    const bill = unwrap(ops.addSource(baseline(), { kind: 'bill', description: 'Gym', amountCents: usd(30), startDate: '2026-10-20', rule: { type: 'monthly' }, certainty: 'possible' }, clock, 'gym'));
    expect(bill.sources.find((s) => s.id === 'gym')!.certainty).toBeUndefined();
    expectError(ops.setIncomeCertainty(withPossible(), 'nothing', 'possible', clock), /no longer exists/);
  });
});

describe('several income sources need no primary one', () => {
  it('the earliest expected income starts the running total, whatever the order the items were added in', () => {
    const d = source(withPossible(), SETUP, 'income', 'Side job', 300, '2026-10-15', { type: 'monthly' }, 'side');
    const reversed: AppData = { ...d, sources: [...d.sources].reverse() };
    const f = buildForecast(d, TODAY);
    expect(f.forecastStart).toBe('2026-10-15');
    expect(buildForecast(reversed, TODAY).entries).toEqual(f.entries);
    expect(tallies(buildForecast(reversed, TODAY), '2026-10-13', '2026-11-30')).toEqual(tallies(f, '2026-10-13', '2026-11-30'));
  });
});

describe('existing data keeps its meaning', () => {
  it('income without a certainty is expected; stored data reads back unchanged and forecasts identically', () => {
    const plan = baseline();
    const read = migrate(JSON.parse(JSON.stringify(plan)));
    expect(read).toEqual(plan);
    expect(read.sources.every((s) => !('certainty' in s))).toBe(true);
    expect(hasPossibleIncome(read)).toBe(false);
    expect(buildForecast(read, TODAY)).toEqual(buildForecast(plan, TODAY));
  });

  it('reading stored data keeps possible only where it means something', () => {
    const raw = JSON.parse(JSON.stringify(withPossible()));
    raw.sources.find((s: { id: string }) => s.id === 'rent').certainty = 'possible';
    raw.sources.find((s: { id: string }) => s.id === 'pay').certainty = 'expected';
    raw.records.push({ ...raw.records[0], id: 'pay@2026-10-16', sourceId: 'pay', certainty: 'possible' });
    raw.records[0].certainty = 'maybe';
    const read = migrate({ ...raw, records: raw.records.slice(1) });
    expect(read.sources.map((s) => [s.id, s.certainty])).toEqual([['pay', undefined], ['rent', undefined], ['tips', 'possible']]);
    // A recurring occurrence's record never carries one: it follows its item.
    expect(read.records.find((r) => r.id === 'pay@2026-10-16')!.certainty).toBeUndefined();
    expect(migrate(raw).records.find((r) => r.id === 'invoice')!.certainty).toBeUndefined();
    expect(migrate(withPossible()).records.find((r) => r.id === 'invoice')!.certainty).toBe('possible');
  });
});
