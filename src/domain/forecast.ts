/**
 * The forecast engine. Pure functions only: every dashboard view (calendar,
 * KPIs, weekly summaries, daily timeline) derives from the single `Forecast`
 * produced by `buildForecast`.
 *
 * Projection first: every occurrence that hasn't been recorded is a
 * projection and counts on its date at its latest projected amount, whatever
 * the kind of income or how often it repeats. Recurring describes how often
 * something happens, never how likely it is. Only an occurrence the person
 * records is an actual, and a date passing never records anything.
 *
 * Definitions
 * -----------
 * Effective date/amount of an occurrence (where it lands in the timeline):
 *   - completed (recorded): actual date and actual amount. The original
 *     projection is NOT also counted; it stays on the record
 *     (`expectedDate`, `expectedAmountCents`) for comparison;
 *   - canceled: shown on its scheduled date for reference, never counted;
 *   - outstanding (scheduled, or overdue once its date has passed): its
 *     latest scheduled date and amount. It is never moved to another date.
 *
 * Forecast start:
 *   The person chooses it: it is the first day of the period they look at
 *   (`options.start`; today when a view doesn't choose one). It never depends
 *   on income: not the next payday, not the first income entered, not any
 *   income at all, so expenses before the first income and plans with only
 *   one-time or irregular income all forecast. The anchor is the day before
 *   the start.
 *
 * Running total:
 *   tally(d) = tally(d - 1) + income(d) − outflows(d) − net reserves(d)
 *   for every day d from the start, beginning at $0 at the end of the anchor
 *   day, where outflows are bills, subscriptions, liability payments and
 *   varied spending, and net reserves are allocations to Strategic Reserves
 *   minus releases from them. Internal transfers between accounts are not
 *   entries at all, so they never change it. The $0 is a stated reference
 *   point, not a bank balance: the running total shows timing (whether money
 *   in arrives before money out) within the chosen period. Days before the
 *   start have no tally, and nothing before the start is carried into it.
 */
import { addDays, eachDay, endOfMonth, endOfWeek, maxDate, minDate, startOfMonth, type DateStr } from './dates';
import type { Cents } from './money';
import { resolveOccurrences } from './occurrences';
import { signFor, type AppData, type Occurrence } from './types';

export interface ForecastEntry {
  occurrence: Occurrence;
  /** Date the entry lands on in the timeline. */
  date: DateStr;
  /** Unsigned amount the entry contributes. */
  amountCents: Cents;
  /** Signed contribution to available cash: positive for income and reserve releases, negative for outflows and reserve allocations, 0 when not counted. */
  signedCents: Cents;
  /** False for canceled occurrences (displayed but excluded from all totals). */
  counts: boolean;
}

/** `nothing-planned`: no active item and no one-time item, so there is nothing to forecast yet. */
export type ForecastIssue = 'nothing-planned';

export interface Forecast {
  today: DateStr;
  /** The day before `forecastStart`; the running total is $0 at its end. */
  anchor: DateStr;
  /** The first day of the running total, as chosen (see the file comment). */
  forecastStart: DateStr;
  horizonEnd: DateStr;
  /** Sorted deterministically: date, income before outflows, larger amounts first, description, id. */
  entries: ForecastEntry[];
  issue: ForecastIssue | null;
}

const DEFAULT_HORIZON_DAYS = 400;

export function compareEntries(a: ForecastEntry, b: ForecastEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ai = signFor(a.occurrence) === 1 ? 0 : 1;
  const bi = signFor(b.occurrence) === 1 ? 0 : 1;
  if (ai !== bi) return ai - bi;
  if (a.amountCents !== b.amountCents) return b.amountCents - a.amountCents;
  const ad = a.occurrence.description.localeCompare(b.occurrence.description);
  if (ad !== 0) return ad;
  return a.occurrence.id < b.occurrence.id ? -1 : a.occurrence.id > b.occurrence.id ? 1 : 0;
}

/** Earliest relevant date in the data, so overdue history is generated too. */
function dataStart(data: AppData, today: DateStr): DateStr {
  let start = today;
  for (const s of data.sources) for (const v of s.versions) start = minDate(start, v.startDate);
  for (const r of data.records) start = minDate(start, minDate(r.scheduledDate, r.expectedDate));
  return start;
}

export interface ForecastOptions {
  /** Build the forecast through at least this date. */
  through?: DateStr;
  /** The first day of the running total, chosen by the person (the period they look at). Default `today`. */
  start?: DateStr;
}

export function buildForecast(data: AppData, today: DateStr, options: ForecastOptions = {}): Forecast {
  const forecastStart = options.start ?? today;
  const horizonEnd = maxDate(maxDate(options.through ?? today, forecastStart), addDays(today, DEFAULT_HORIZON_DAYS));
  const occurrences = resolveOccurrences(data, dataStart(data, minDate(today, forecastStart)), horizonEnd, today);
  const anchor = addDays(forecastStart, -1);
  const planned = data.sources.some((s) => s.active) || data.records.length > 0;
  const issue: ForecastIssue | null = planned ? null : 'nothing-planned';

  const entries: ForecastEntry[] = occurrences.map((o) => {
    if (o.status === 'completed') {
      const amount = o.actualAmountCents ?? o.scheduledAmountCents;
      return { occurrence: o, date: o.actualDate ?? o.scheduledDate, amountCents: amount, signedCents: signFor(o) * amount, counts: true };
    }
    if (o.status === 'canceled') {
      return { occurrence: o, date: o.scheduledDate, amountCents: o.scheduledAmountCents, signedCents: 0, counts: false };
    }
    return { occurrence: o, date: o.scheduledDate, amountCents: o.scheduledAmountCents, signedCents: signFor(o) * o.scheduledAmountCents, counts: true };
  });
  entries.sort(compareEntries);

  return { today, anchor, forecastStart, horizonEnd, entries, issue };
}

/** Entries (counted and not) whose timeline date falls in [start, end]. */
export function entriesInRange(forecast: Forecast, start: DateStr, end: DateStr): ForecastEntry[] {
  return forecast.entries.filter((e) => e.date >= start && e.date <= end);
}

/**
 * Money for a set of entries, in the app's three parts: external income,
 * external outflows, and net allocations to Strategic Reserves (allocations
 * minus releases; negative when more is released than set aside). Every
 * entry lands in exactly one part, so nothing is counted twice:
 * netCents = inCents − outCents − reservedCents (available cash flow).
 */
export interface MoneyTotals {
  inCents: Cents;
  outCents: Cents;
  reservedCents: Cents;
  netCents: Cents;
}

export interface DayRow extends MoneyTotals {
  date: DateStr;
  /** Running tally after this day's transactions; null on or before the anchor. */
  tallyCents: Cents | null;
  entries: ForecastEntry[];
}

/** See `MoneyTotals`. Entries that don't count (canceled) are excluded. */
export function totals(entries: ForecastEntry[]): MoneyTotals {
  let inCents = 0;
  let outCents = 0;
  let reservedCents = 0;
  for (const e of entries) {
    if (!e.counts) continue;
    if (e.occurrence.kind === 'reserve') reservedCents -= e.signedCents;
    else if (e.signedCents > 0) inCents += e.signedCents;
    else outCents -= e.signedCents;
  }
  return { inCents, outCents, reservedCents, netCents: inCents - outCents - reservedCents };
}

/**
 * One row per day in [start, end], with the running tally computed
 * cumulatively from the forecast start (never restarted at `start`).
 */
export function dailyTimeline(forecast: Forecast, start: DateStr, end: DateStr): DayRow[] {
  if (end < start) return [];
  const byDate = new Map<DateStr, ForecastEntry[]>();
  const firstDay = minDate(forecast.forecastStart, start);
  for (const e of forecast.entries) {
    if (e.date < firstDay || e.date > end) continue;
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }

  const rows: DayRow[] = [];
  let tally: Cents = 0;
  for (const date of eachDay(firstDay, end)) {
    const dayEntries = byDate.get(date) ?? [];
    const t = totals(dayEntries);
    let tallyCents: Cents | null = null;
    if (date >= forecast.forecastStart) {
      tally += t.netCents;
      tallyCents = tally;
    }
    if (date >= start) rows.push({ date, ...t, tallyCents, entries: dayEntries });
  }
  return rows;
}

/** Tally at the end of `date` (cumulative from the anchor), or null on/before the anchor. */
export function tallyOn(forecast: Forecast, date: DateStr): Cents | null {
  return dailyTimeline(forecast, date, date)[0]?.tallyCents ?? null;
}

export interface PeriodKpis {
  incomeCents: Cents;
  /** External outflows: bills, subscriptions, liability payments, varied spending. */
  outflowCents: Cents;
  /** Net allocations to Strategic Reserves. */
  reservesCents: Cents;
  /** Operating cash flow: income − outflows. */
  operatingCents: Cents;
  /** Available cash flow: operating − net reserves. */
  netCents: Cents;
}

function kpisOf(t: MoneyTotals): PeriodKpis {
  return { incomeCents: t.inCents, outflowCents: t.outCents, reservesCents: t.reservedCents, operatingCents: t.inCents - t.outCents, netCents: t.netCents };
}

/** `PeriodKpis` for any set of entries (for example only the recorded ones in a range). Entries that don't count are excluded. */
export function kpisOfEntries(entries: ForecastEntry[]): PeriodKpis {
  return kpisOf(totals(entries));
}

/** Income, outflows, net reserves, operating and available cash flow for [start, end]. */
export function periodKpis(forecast: Forecast, start: DateStr, end: DateStr): PeriodKpis {
  return kpisOf(totals(entriesInRange(forecast, start, end)));
}

export interface LowPoint {
  date: DateStr;
  tallyCents: Cents;
}

/** Lowest tally among the rows (earliest date wins ties), or null if none have a tally. */
export function lowestPoint(rows: DayRow[]): LowPoint | null {
  let low: LowPoint | null = null;
  for (const r of rows) {
    if (r.tallyCents === null) continue;
    if (low === null || r.tallyCents < low.tallyCents) low = { date: r.date, tallyCents: r.tallyCents };
  }
  return low;
}

export interface NegativeStretch {
  start: DateStr;
  end: DateStr;
  lowestCents: Cents;
}

/** Consecutive runs of days whose tally is below zero. */
export function negativeStretches(rows: DayRow[]): NegativeStretch[] {
  const out: NegativeStretch[] = [];
  let current: NegativeStretch | null = null;
  for (const r of rows) {
    if (r.tallyCents !== null && r.tallyCents < 0) {
      if (current) {
        current.end = r.date;
        current.lowestCents = Math.min(current.lowestCents, r.tallyCents);
      } else {
        current = { start: r.date, end: r.date, lowestCents: r.tallyCents };
      }
    } else if (current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out;
}

export interface TimingGap {
  start: DateStr;
  end: DateStr;
  days: number;
  /** Most negative tally in the gap, and the first day it is reached. */
  lowestCents: Cents;
  lowestDate: DateStr;
}

export const GAP_LOOKAHEAD_DAYS = 90;

/**
 * Every stretch in the next `days` days (from the forecast start) where the
 * running tally is below $0. Empty when the tally never goes negative.
 */
export function timingGapsAhead(forecast: Forecast, days = GAP_LOOKAHEAD_DAYS): TimingGap[] {
  const rows = dailyTimeline(forecast, forecast.forecastStart, addDays(forecast.forecastStart, days - 1));
  return negativeStretches(rows).map((n) => {
    const inGap = rows.filter((r) => r.date >= n.start && r.date <= n.end);
    const lowest = inGap.find((r) => r.tallyCents === n.lowestCents)!;
    return { start: n.start, end: n.end, days: inGap.length, lowestCents: n.lowestCents, lowestDate: lowest.date };
  });
}

/**
 * What the forecast shows about a timing gap, using its own numbers. It lists
 * what happens, not why: the money in and out from the first day of the gap
 * through its lowest day, and the income that brings the running total back.
 * A gap is often a matter of timing (a bill due before the next paycheck)
 * rather than of spending, so no single entry is singled out as its cause.
 *
 * Always: beforeCents + inflowCents − outflowCents = lowestCents. Here
 * "out" means anything that lowers the running total, reserve allocations
 * included, and "in" anything that raises it, reserve releases included.
 */
export interface GapExplanation extends TimingGap {
  /** Running total at the end of the day before the gap ($0 when the gap starts on the first forecast day). */
  beforeCents: Cents;
  /** Counted money out from `start` through `lowestDate`, in forecast order. */
  outflows: ForecastEntry[];
  outflowCents: Cents;
  /** Counted money in over the same days. */
  inflows: ForecastEntry[];
  inflowCents: Cents;
  /**
   * Counted money in and out after the lowest day while the running total is
   * still below $0: through the day before `recoversOn`, or through `end`
   * when there is no recovery within the forecast.
   */
  afterLowest: ForecastEntry[];
  /** First day after the gap with a running total of $0 or more, or null if none within the forecast. */
  recoversOn: DateStr | null;
  /** Counted income on `recoversOn`. */
  recoveryIncome: ForecastEntry[];
  /** Every counted entry on `recoversOn` (income and money out), so the day's lines add up to `recoveryCents`. */
  recoveryEntries: ForecastEntry[];
  /** Running total at the end of `recoversOn`, or null without a recovery. */
  recoveryCents: Cents | null;
}

/** `timingGapsAhead`, with each gap explained from the same forecast. */
export function explainTimingGaps(forecast: Forecast, days = GAP_LOOKAHEAD_DAYS): GapExplanation[] {
  return timingGapsAhead(forecast, days).map((gap) => {
    const during = entriesInRange(forecast, gap.start, gap.lowestDate).filter((e) => e.counts);
    const outflows = during.filter((e) => e.signedCents < 0);
    const inflows = during.filter((e) => e.signedCents > 0);
    const after = dailyTimeline(forecast, addDays(gap.end, 1), forecast.horizonEnd).find((r) => r.tallyCents !== null && r.tallyCents >= 0) ?? null;
    const stillBelow = after ? addDays(after.date, -1) : gap.end;
    return {
      ...gap,
      beforeCents: tallyOn(forecast, addDays(gap.start, -1)) ?? 0,
      outflows,
      outflowCents: outflows.reduce((sum, e) => sum - e.signedCents, 0),
      inflows,
      inflowCents: inflows.reduce((sum, e) => sum + e.signedCents, 0),
      afterLowest: stillBelow > gap.lowestDate ? entriesInRange(forecast, addDays(gap.lowestDate, 1), stillBelow).filter((e) => e.counts) : [],
      recoversOn: after?.date ?? null,
      recoveryIncome: after ? after.entries.filter((e) => e.counts && e.signedCents > 0) : [],
      recoveryEntries: after ? after.entries.filter((e) => e.counts) : [],
      recoveryCents: after?.tallyCents ?? null,
    };
  });
}

export interface WeekSummary extends PeriodKpis {
  start: DateStr;
  end: DateStr;
  days: DayRow[];
  /** Running total at the end of the week's last day; null on or before the anchor. */
  endTallyCents: Cents | null;
}

/**
 * Sunday–Saturday weeks covering [start, end], clipped to the range so the
 * weekly totals add up exactly to the range's totals.
 */
export function weekSummaries(forecast: Forecast, start: DateStr, end: DateStr): WeekSummary[] {
  const rows = dailyTimeline(forecast, start, end);
  const out: WeekSummary[] = [];
  for (let ws = start; ws <= end; ws = addDays(endOfWeek(ws), 1)) {
    const we = minDate(endOfWeek(ws), end);
    const days = rows.filter((r) => r.date >= ws && r.date <= we);
    const t = totals(days.flatMap((d) => d.entries));
    out.push({ start: ws, end: we, days, ...kpisOf(t), endTallyCents: days[days.length - 1]?.tallyCents ?? null });
  }
  return out;
}

/** The weeks of the month containing `monthDate` (see `weekSummaries`). */
export function monthWeekSummaries(forecast: Forecast, monthDate: DateStr): WeekSummary[] {
  return weekSummaries(forecast, startOfMonth(monthDate), endOfMonth(monthDate));
}

/** Outstanding (unrecorded) occurrences whose date has passed, oldest first: still projections, never recorded by the date passing. */
export function overdueEntries(forecast: Forecast): ForecastEntry[] {
  return forecast.entries
    .filter((e) => e.occurrence.displayStatus === 'overdue')
    .sort((a, b) => (a.occurrence.scheduledDate < b.occurrence.scheduledDate ? -1 : a.occurrence.scheduledDate > b.occurrence.scheduledDate ? 1 : compareEntries(a, b)));
}
