/**
 * What the Home screen shows, read from the one forecast (roadmap phase H1).
 * A pure, deterministic selector: no new money math, no inputs, no state.
 * Every figure comes from `buildForecast`, `totals`, the transfer helpers in
 * `balances.ts` and `explainTimingGaps`.
 *
 * Four sections:
 *   progress   this month's cash flow and last month's, on stated bases
 *   attention  what needs a decision now: overdue items, items due today,
 *              planned transfers due and not recorded, and a timing gap that
 *              starts within the next `attentionDays` days
 *   comingUp   expected items, planned transfers and timing gaps after today
 *              in the viewed week (the current week also takes early next week)
 *   happened   what was recorded in the viewed week
 *
 * Two dates, kept apart: `today` decides what is overdue and what needs
 * attention, and what progress compares; `options.weekOf` only chooses which
 * week "coming up" and "happened" list. Moving the viewed week never changes
 * a figure, an overdue flag or the attention list.
 *
 * An item appears in one section only. A timing gap that starts after both
 * windows is in `laterGaps`, so the forecast can still show it.
 */
import { accountOf, transferShortfall, transfersInRange } from './balances';
import { addDays, addMonthsClamped, daysInMonth, diffDays, endOfMonth, endOfWeek, parts, startOfMonth, startOfWeek, type DateStr } from './dates';
import { buildForecast, entriesInRange, explainTimingGaps, GAP_LOOKAHEAD_DAYS, kpisOfEntries, type ForecastEntry, type GapExplanation, type PeriodKpis } from './forecast';
import type { Cents } from './money';
import { variance, type Variance } from './occurrences';
import type { AppData, Transfer } from './types';

export interface HomeOptions {
  /** A timing gap starting within this many days (today included) needs attention. Default 7. */
  attentionDays?: number;
  /** Days of next week included in "coming up" (from Sunday). Default 3 (Sunday to Tuesday). */
  earlyNextWeekDays?: number;
  /**
   * Any date in the week to list under "coming up" and "happened". Default
   * `today`. It never changes what is overdue, what needs attention or the
   * progress figures, which always read `today`.
   */
  weekOf?: DateStr;
}

/** An item from the forecast (recurring or one-time), with its stable id for the existing occurrence sheet. */
export interface HomeOccurrence {
  type: 'occurrence';
  /** The occurrence id (`ops.recordActual`, `OccurrenceSheet`). */
  id: string;
  /** Where it lands: the actual date once recorded, otherwise its latest expected date. */
  date: DateStr;
  entry: ForecastEntry;
  /** The account it belongs to (`accountOf`), or null. */
  accountId: string | null;
  /** Expected and its date has passed. */
  overdue: boolean;
  /** Recorded only: the difference from what was originally expected. */
  variance: Variance | null;
}

/** A transfer between the person's accounts, with its stable id for the existing transfer form. */
export interface HomeTransfer {
  type: 'transfer';
  id: string;
  date: DateStr;
  transfer: Transfer;
  /** Expected only: how far its source would fall below $0 (0 when covered), or null when its balance isn't known. */
  shortfallCents: Cents | null;
}

/** A timing gap: the running total below $0, explained from the same forecast. */
export interface HomeGap {
  type: 'gap';
  /** `gap@<start>`, stable while the gap starts on the same day. */
  id: string;
  date: DateStr;
  gap: GapExplanation;
}

export type HomeItem = HomeOccurrence | HomeTransfer | HomeGap;

/**
 * One month's cash flow. `recorded` counts only what has been recorded;
 * `projected` adds what is still expected in the month (`PeriodKpis`).
 */
export interface MonthCashFlow {
  start: DateStr;
  end: DateStr;
  recorded: PeriodKpis;
  projected: PeriodKpis;
  /** Expected items in the month not yet recorded (overdue ones still dated in it, upcoming ones after today). */
  expectedCount: number;
  /** Recorded entries, and all counted entries (recorded and expected), in the month. */
  recordedCount: number;
  projectedCount: number;
}

export interface ComparedPeriod {
  start: DateStr;
  end: DateStr;
  netCents: Cents;
  /** Entries behind the figure; 0 means there is nothing to compare on this side. */
  count: number;
}

/** A difference between two available-cash-flow figures, and its basis. No threshold: the sign is the sign. */
export interface CashFlowComparison {
  basis: 'month-to-date-recorded' | 'projected-vs-recorded';
  /** The two periods compared, in the order current, previous. */
  current: ComparedPeriod;
  previous: ComparedPeriod;
  differenceCents: Cents;
  direction: 'up' | 'down' | 'unchanged';
}

export interface HomeProgress {
  thisMonth: MonthCashFlow;
  lastMonth: MonthCashFlow;
  /**
   * Like for like: recorded cash flow from the 1st through today in this
   * month, against the same days of last month (clamped to its length).
   */
  monthToDate: CashFlowComparison;
  /**
   * This month as projected (recorded plus still expected) against last
   * month as recorded. The two bases differ, and the basis says so; which
   * comparison Home leads with is a product decision (roadmap H2).
   */
  projectedVsLastMonth: CashFlowComparison;
}

export interface HomeView {
  today: DateStr;
  /**
   * The viewed week (Sunday to Saturday), whether it is the current one, and
   * the end of the "coming up" window: early next week for the current week,
   * the week's own end otherwise.
   */
  week: { start: DateStr; end: DateStr; current: boolean; comingUpThrough: DateStr };
  progress: HomeProgress;
  /** Oldest first: overdue items, then today's, then due transfers, then an imminent timing gap. */
  attention: HomeItem[];
  /** Chronological, after today and within the viewed week through `week.comingUpThrough`. */
  comingUp: HomeItem[];
  /** Recorded in the viewed week, chronological. */
  happened: HomeItem[];
  /** Timing gaps starting after both windows, within the forecast's 90-day look-ahead. */
  laterGaps: HomeGap[];
  /** How far this forecast reaches (for explaining a gap that doesn't end before it). */
  horizonEnd: DateStr;
}

const direction = (d: Cents): CashFlowComparison['direction'] => (d > 0 ? 'up' : d < 0 ? 'down' : 'unchanged');

function compare(basis: CashFlowComparison['basis'], current: CashFlowComparison['current'], previous: CashFlowComparison['previous']): CashFlowComparison {
  const differenceCents = current.netCents - previous.netCents;
  return { basis, current, previous, differenceCents, direction: direction(differenceCents) };
}

const recordedIn = (entries: ForecastEntry[]) => entries.filter((e) => e.counts && e.occurrence.status === 'completed');

function month(entries: ForecastEntry[], start: DateStr, end: DateStr): MonthCashFlow {
  const inMonth = entries.filter((e) => e.date >= start && e.date <= end);
  return {
    start,
    end,
    recorded: kpisOfEntries(recordedIn(inMonth)),
    projected: kpisOfEntries(inMonth),
    expectedCount: inMonth.filter((e) => e.counts && e.occurrence.status === 'scheduled').length,
    recordedCount: recordedIn(inMonth).length,
    projectedCount: inMonth.filter((e) => e.counts).length,
  };
}

/** Chronological order for mixed items; on the same day, items before transfers before gaps, then id. */
function byDate(a: HomeItem, b: HomeItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const rank = { occurrence: 0, transfer: 1, gap: 2 } as const;
  if (rank[a.type] !== rank[b.type]) return rank[a.type] - rank[b.type];
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function homeView(data: AppData, today: DateStr, options: HomeOptions = {}): HomeView {
  const attentionDays = options.attentionDays ?? 7;
  const weekBase = options.weekOf ?? today;
  const weekStart = startOfWeek(weekBase);
  const weekEnd = endOfWeek(weekBase);
  const current = weekStart === startOfWeek(today);
  const comingUpThrough = current ? addDays(weekEnd, options.earlyNextWeekDays ?? 3) : weekEnd;
  const attentionThrough = addDays(today, attentionDays - 1);
  const horizon = comingUpThrough > today ? comingUpThrough : today;

  const forecast = buildForecast(data, today, { through: endOfMonth(horizon) });

  const occurrence = (e: ForecastEntry): HomeOccurrence => ({
    type: 'occurrence',
    id: e.occurrence.id,
    date: e.date,
    entry: e,
    accountId: accountOf(data, e.occurrence),
    overdue: e.occurrence.displayStatus === 'overdue',
    variance: variance(e.occurrence),
  });
  const transfer = (t: Transfer): HomeTransfer => ({ type: 'transfer', id: t.id, date: t.date, transfer: t, shortfallCents: t.status === 'expected' ? transferShortfall(data, t.id, today) : null });
  const gapItem = (g: GapExplanation): HomeGap => ({ type: 'gap', id: `gap@${g.start}`, date: g.start, gap: g });
  /** In the viewed week's "coming up" window, and after today. */
  const upcomingDate = (d: DateStr) => d > today && d >= weekStart && d <= comingUpThrough;

  // Progress: this month and last month, from the same entries. Always read `today`.
  const thisStart = startOfMonth(today);
  const lastStart = addMonthsClamped(thisStart, -1);
  const lastEnd = addDays(thisStart, -1);
  const thisMonth = month(forecast.entries, thisStart, endOfMonth(today));
  const lastMonth = month(forecast.entries, lastStart, lastEnd);
  const { y, m } = parts(lastStart);
  const lastSameDay = addDays(lastStart, Math.min(parts(today).d, daysInMonth(y, m)) - 1);
  const recordedSoFar = recordedIn(entriesInRange(forecast, thisStart, today));
  const recordedLastSame = recordedIn(entriesInRange(forecast, lastStart, lastSameDay));
  const monthToDate = compare(
    'month-to-date-recorded',
    { start: thisStart, end: today, netCents: kpisOfEntries(recordedSoFar).netCents, count: recordedSoFar.length },
    { start: lastStart, end: lastSameDay, netCents: kpisOfEntries(recordedLastSame).netCents, count: recordedLastSame.length },
  );
  const projectedVsLastMonth = compare(
    'projected-vs-recorded',
    { start: thisMonth.start, end: thisMonth.end, netCents: thisMonth.projected.netCents, count: thisMonth.projectedCount },
    { start: lastMonth.start, end: lastMonth.end, netCents: lastMonth.recorded.netCents, count: lastMonth.recordedCount },
  );

  // Outstanding items: overdue or due today need attention (whatever week is viewed); later ones are coming up. Each occurrence once.
  const outstanding = forecast.entries.filter((e) => e.counts && e.occurrence.status === 'scheduled');
  const due = outstanding
    .filter((e) => e.occurrence.scheduledDate <= today)
    .sort((a, b) => (a.occurrence.scheduledDate !== b.occurrence.scheduledDate ? (a.occurrence.scheduledDate < b.occurrence.scheduledDate ? -1 : 1) : a.occurrence.id < b.occurrence.id ? -1 : 1))
    .map(occurrence);
  const upcoming = outstanding.filter((e) => e.occurrence.scheduledDate > today && upcomingDate(e.date)).map(occurrence);

  // Transfers: planned and due (a passed date never records one), planned in the window, recorded in the viewed week.
  const allTransfers = transfersInRange(data, '0000-01-01', horizon);
  const dueTransfers = allTransfers.filter((t) => t.status === 'expected' && t.date <= today).map(transfer);
  const plannedTransfers = allTransfers.filter((t) => t.status === 'expected' && upcomingDate(t.date)).map(transfer);
  const recordedTransfers = allTransfers.filter((t) => t.status === 'recorded' && t.date >= weekStart && t.date <= weekEnd).map(transfer);

  // Timing gaps that haven't ended: imminent ones need attention, the rest are coming up or later.
  const gapDays = forecast.forecastStart ? Math.max(GAP_LOOKAHEAD_DAYS, diffDays(forecast.forecastStart, horizon) + 1) : GAP_LOOKAHEAD_DAYS;
  const gaps = explainTimingGaps(forecast, gapDays).filter((g) => g.end >= today).map(gapItem);
  const imminent = gaps.filter((g) => g.date <= attentionThrough);
  const soon = gaps.filter((g) => g.date > attentionThrough && upcomingDate(g.date));
  const later = gaps.filter((g) => g.date > attentionThrough && !upcomingDate(g.date));

  const happened = forecast.entries
    .filter((e) => e.counts && e.occurrence.status === 'completed' && e.date >= weekStart && e.date <= weekEnd)
    .map(occurrence);

  return {
    today,
    week: { start: weekStart, end: weekEnd, current, comingUpThrough },
    progress: { thisMonth, lastMonth, monthToDate, projectedVsLastMonth },
    attention: [...due, ...dueTransfers, ...imminent],
    comingUp: [...upcoming, ...plannedTransfers, ...soon].sort(byDate),
    happened: [...happened, ...recordedTransfers].sort(byDate),
    laterGaps: later,
    horizonEnd: forecast.horizonEnd,
  };
}
