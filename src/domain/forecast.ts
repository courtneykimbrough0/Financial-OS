/**
 * The forecast engine. Pure functions only: every dashboard view (calendar,
 * KPIs, weekly summaries, daily timeline, paycheck cycles) derives from the
 * single `Forecast` produced by `buildForecast`.
 *
 * Definitions
 * -----------
 * Effective date/amount of an occurrence (where it lands in the timeline):
 *   - completed: actual date and actual amount (the original expected
 *     occurrence is NOT also counted);
 *   - canceled: shown on its scheduled date for reference, never counted;
 *   - outstanding (scheduled or overdue): latest scheduled date and amount.
 *     An overdue item dated before the forecast start is carried forward to
 *     the forecast start so the money that is still owed/expected stays in
 *     the tally.
 *
 * Main paycheck:
 *   One recurring income defines pay periods (`mainPaycheckId`): the one the
 *   user marked, or else the first active income. Other income still counts
 *   as money in; it just doesn't start a pay period. This keeps households
 *   paid on nearby days (say Wednesday and Thursday) from getting one-day pay
 *   periods. The main paycheck plays no part in where the running total
 *   starts.
 *
 * Forecast anchor:
 *   The "next expected payday" is the earliest occurrence of any active
 *   recurring income that is still outstanding (including overdue: a late
 *   paycheck has not arrived yet) or that was received today. Which income
 *   was entered first, or marked as the main paycheck, doesn't matter, so
 *   earlier income from another source is never left out of the running
 *   total. One-time income doesn't start the running total (it still counts
 *   once inside it). The anchor is the day before the payday.
 *   The running tally is $0 at the end of the anchor day and transactions are
 *   processed from the next day (the payday itself) onward.
 *
 * Running tally (available cash):
 *   tally(d) = tally(d - 1) + income(d) − outflows(d) − net reserves(d)
 *   for every day d after the anchor, where outflows are bills, subscriptions,
 *   liability payments and varied spending, and net reserves are allocations
 *   to Strategic Reserves minus releases from them. Internal transfers between
 *   accounts are not entries at all, so they never change it. Days on or before the anchor have no
 *   tally. Views never reset it: a week, cycle, or custom range starting later
 *   shows the cumulative value carried from the anchor.
 */
import { addDays, eachDay, endOfMonth, endOfWeek, maxDate, minDate, startOfMonth, type DateStr } from './dates';
import type { Cents } from './money';
import { resolveOccurrences } from './occurrences';
import { mainPaycheckId, signFor, type AppData, type Occurrence } from './types';

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
  /** True when an overdue item was moved from its scheduled date to the forecast start. */
  carriedForward: boolean;
}

export type ForecastIssue = 'no-recurring-income' | 'no-upcoming-income';

export interface Forecast {
  today: DateStr;
  anchor: DateStr | null;
  forecastStart: DateStr | null;
  horizonEnd: DateStr;
  /** The income source that defines pay periods. */
  mainSourceId: string | null;
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

function isOutstanding(o: Occurrence): boolean {
  return o.status === 'scheduled';
}

/** Earliest relevant date in the data, so overdue history is generated too. */
function dataStart(data: AppData, today: DateStr): DateStr {
  let start = today;
  for (const s of data.sources) for (const v of s.versions) start = minDate(start, v.startDate);
  for (const r of data.records) start = minDate(start, minDate(r.scheduledDate, r.expectedDate));
  return start;
}

/**
 * The next expected payday per the anchor rule above, or null: the earliest
 * outstanding or received-today occurrence of any of `incomeSourceIds`.
 */
export function nextExpectedPayday(occurrences: Occurrence[], today: DateStr, incomeSourceIds: ReadonlySet<string>): DateStr | null {
  let best: DateStr | null = null;
  for (const o of occurrences) {
    if (o.kind !== 'income' || o.sourceId === null || !incomeSourceIds.has(o.sourceId) || o.status === 'canceled') continue;
    let candidate: DateStr | null = null;
    if (isOutstanding(o)) candidate = o.scheduledDate;
    else if (o.status === 'completed' && o.actualDate !== null && o.actualDate >= today) candidate = o.actualDate;
    if (candidate !== null && (best === null || candidate < best)) best = candidate;
  }
  return best;
}

export interface ForecastOptions {
  /** Build the forecast through at least this date. */
  through?: DateStr;
  /**
   * Income sources that may not start the running total, though they still
   * count inside it. Scenarios use this for hypothetical income, so income
   * that may never arrive never moves the start earlier.
   */
  excludeFromStart?: (sourceId: string) => boolean;
}

export function buildForecast(data: AppData, today: DateStr, options: ForecastOptions = {}): Forecast {
  const horizonEnd = maxDate(options.through ?? today, addDays(today, DEFAULT_HORIZON_DAYS));
  const occurrences = resolveOccurrences(data, dataStart(data, today), horizonEnd, today);

  const mainSourceId = mainPaycheckId(data);
  const hasActiveIncome = mainSourceId !== null;
  const startSources = new Set(data.sources.filter((s) => s.kind === 'income' && s.active && !options.excludeFromStart?.(s.id)).map((s) => s.id));
  const payday = hasActiveIncome ? nextExpectedPayday(occurrences, today, startSources) : null;
  const forecastStart = payday;
  const anchor = payday ? addDays(payday, -1) : null;
  const issue: ForecastIssue | null = !hasActiveIncome ? 'no-recurring-income' : payday ? null : 'no-upcoming-income';

  const entries: ForecastEntry[] = occurrences.map((o) => {
    if (o.status === 'completed') {
      const amount = o.actualAmountCents ?? o.scheduledAmountCents;
      return {
        occurrence: o,
        date: o.actualDate ?? o.scheduledDate,
        amountCents: amount,
        signedCents: signFor(o) * amount,
        counts: true,
        carriedForward: false,
      };
    }
    if (o.status === 'canceled') {
      return { occurrence: o, date: o.scheduledDate, amountCents: o.scheduledAmountCents, signedCents: 0, counts: false, carriedForward: false };
    }
    const carry = forecastStart !== null && o.displayStatus === 'overdue' && o.scheduledDate < forecastStart;
    return {
      occurrence: o,
      date: carry ? forecastStart! : o.scheduledDate,
      amountCents: o.scheduledAmountCents,
      signedCents: signFor(o) * o.scheduledAmountCents,
      counts: true,
      carriedForward: carry,
    };
  });
  entries.sort(compareEntries);

  return { today, anchor, forecastStart, horizonEnd, mainSourceId, entries, issue };
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

/** See `MoneyTotals`. Canceled entries are excluded. */
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
 * cumulatively from the forecast anchor (never restarted at `start`).
 */
export function dailyTimeline(forecast: Forecast, start: DateStr, end: DateStr): DayRow[] {
  if (end < start) return [];
  const byDate = new Map<DateStr, ForecastEntry[]>();
  const firstDay = forecast.forecastStart ? minDate(forecast.forecastStart, start) : start;
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
    if (forecast.forecastStart && date >= forecast.forecastStart) {
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
 * running tally is below $0. Empty when the forecast cannot start or the tally
 * never goes negative.
 */
export function timingGapsAhead(forecast: Forecast, days = GAP_LOOKAHEAD_DAYS): TimingGap[] {
  if (!forecast.forecastStart) return [];
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

export interface PaycheckCycle {
  start: DateStr;
  end: DateStr;
  /** The main-paycheck entries that open the cycle. */
  paydayEntries: ForecastEntry[];
}

/**
 * Pay periods from the next expected payday onward. Boundaries are the dates
 * of counted main-paycheck entries only; other income lands inside a period
 * as money in. A period runs from one main payday to the day before the next.
 * The last main payday in the horizon has no known end and therefore does not
 * start a period.
 */
export function paycheckCycles(forecast: Forecast, maxCycles = 12): PaycheckCycle[] {
  if (!forecast.forecastStart) return [];
  const byDate = new Map<DateStr, ForecastEntry[]>();
  for (const e of forecast.entries) {
    if (!e.counts || e.occurrence.kind !== 'income' || e.occurrence.sourceId !== forecast.mainSourceId) continue;
    if (e.date < forecast.forecastStart) continue;
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  const dates = [...byDate.keys()].sort();
  const cycles: PaycheckCycle[] = [];
  for (let i = 0; i + 1 < dates.length && cycles.length < maxCycles; i++) {
    cycles.push({ start: dates[i]!, end: addDays(dates[i + 1]!, -1), paydayEntries: byDate.get(dates[i]!)! });
  }
  return cycles;
}

/**
 * The first stretch of the forecast that setup describes: from the start of
 * the running total (the earliest income) to the end of the first pay period,
 * the day before the main paycheck's second upcoming payday. It begins with
 * the first income of any kind, so income and payments before the main
 * payday are never left out. Null until there is a first pay period.
 */
export function firstPeriod(forecast: Forecast): [DateStr, DateStr] | null {
  const cycle = paycheckCycles(forecast, 1)[0];
  if (!forecast.forecastStart || !cycle) return null;
  return [minDate(forecast.forecastStart, cycle.start), cycle.end];
}

/** Outstanding occurrences whose date has passed, oldest first. */
export function overdueEntries(forecast: Forecast): ForecastEntry[] {
  return forecast.entries
    .filter((e) => e.occurrence.displayStatus === 'overdue')
    .sort((a, b) => (a.occurrence.scheduledDate < b.occurrence.scheduledDate ? -1 : a.occurrence.scheduledDate > b.occurrence.scheduledDate ? 1 : compareEntries(a, b)));
}

export interface ReviewGroups {
  /** Outstanding items whose date has passed or is today: these need an update. */
  attention: ForecastEntry[];
  /** Outstanding items due after today through the end of this week (Saturday). */
  upcoming: ForecastEntry[];
}

/** Outstanding items to review, oldest first: what needs attention, then the rest of this week. */
export function reviewEntries(forecast: Forecast): ReviewGroups {
  const { today } = forecast;
  const weekEnd = endOfWeek(today);
  const outstanding = forecast.entries
    .filter((e) => e.occurrence.status === 'scheduled' && e.occurrence.scheduledDate <= weekEnd)
    .sort((a, b) => (a.occurrence.scheduledDate < b.occurrence.scheduledDate ? -1 : a.occurrence.scheduledDate > b.occurrence.scheduledDate ? 1 : compareEntries(a, b)));
  return {
    attention: outstanding.filter((e) => e.occurrence.scheduledDate <= today),
    upcoming: outstanding.filter((e) => e.occurrence.scheduledDate > today),
  };
}
