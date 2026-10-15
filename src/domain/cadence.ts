/**
 * Review rhythm: when a review is due, which dates it covers, and a short
 * summary of what needs attention, all from the forecast. Quiet by default:
 * nothing is ever due until the person picks a rhythm, and only the current
 * period can be due (missed ones don't pile up).
 */
import { addDays, diffDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek, type DateStr } from './dates';
import {
  buildForecast,
  entriesInRange,
  explainTimingGaps,
  GAP_LOOKAHEAD_DAYS,
  overdueEntries,
  periodKpis,
  type Forecast,
  type ForecastEntry,
  type GapExplanation,
  type PeriodKpis,
} from './forecast';
import type { AppData, ReviewCadence, ReviewSettings } from './types';

export const DEFAULT_REVIEW: ReviewSettings = { cadence: 'off', handledOn: null, outcome: null };

export interface ReviewPeriod {
  start: DateStr;
  end: DateStr;
}

export interface ReviewStatus {
  cadence: ReviewCadence;
  /** The period the current review covers, or null (rhythm off, or no main paycheck dates for a payday rhythm). */
  period: ReviewPeriod | null;
  /** True when the current period hasn't been completed or skipped yet. */
  due: boolean;
  /** When the next review after the current one becomes due, or null if unknown. */
  nextDue: DateStr | null;
  /** The latest handling, if any. */
  handledOn: DateStr | null;
  outcome: ReviewSettings['outcome'];
}

/** Main-paycheck dates in the forecast (counted entries, sorted, unique), from the existing payday logic. */
function paydays(forecast: Forecast): DateStr[] {
  const main = forecast.mainSourceId;
  if (!main) return [];
  return [...new Set(forecast.entries.filter((e) => e.counts && e.occurrence.sourceId === main).map((e) => e.date))].sort();
}

/** The period containing `today` for a rhythm, and when the next one starts. */
export function reviewPeriod(cadence: ReviewCadence, today: DateStr, forecast: Forecast): { period: ReviewPeriod | null; nextStart: DateStr | null } {
  switch (cadence) {
    case 'off':
      return { period: null, nextStart: null };
    case 'weekly':
      return { period: { start: startOfWeek(today), end: endOfWeek(today) }, nextStart: addDays(endOfWeek(today), 1) };
    case 'monthly':
      return { period: { start: startOfMonth(today), end: endOfMonth(today) }, nextStart: addDays(endOfMonth(today), 1) };
    case 'payday': {
      // From the latest main payday on or before today to the day before the next one.
      const dates = paydays(forecast);
      const past = dates.filter((d) => d <= today);
      const next = dates.find((d) => d > today) ?? null;
      if (past.length === 0) return { period: null, nextStart: next };
      const start = past[past.length - 1]!;
      return { period: { start, end: next ? addDays(next, -1) : start }, nextStart: next };
    }
  }
}

/** The review status for `today`. `data.review` absent means the rhythm is off. */
export function reviewStatus(data: AppData, today: DateStr, forecast: Forecast = buildForecast(data, today)): ReviewStatus {
  const settings = data.review ?? DEFAULT_REVIEW;
  const { period, nextStart } = reviewPeriod(settings.cadence, today, forecast);
  const handled = period !== null && settings.handledOn !== null && settings.handledOn >= period.start;
  return {
    cadence: settings.cadence,
    period,
    due: period !== null && !handled,
    nextDue: settings.cadence === 'off' ? null : period && !handled ? period.start : nextStart,
    handledOn: settings.handledOn,
    outcome: settings.outcome,
  };
}

export interface ReviewSummary {
  period: ReviewPeriod;
  /** Expected (not yet recorded) money in and out dated in the period, in forecast order. */
  expectedIncome: ForecastEntry[];
  expectedOutflows: ForecastEntry[];
  /** Recorded in the period (received or paid), kept apart from what is only expected. */
  recorded: ForecastEntry[];
  /** Every overdue item, whatever its date: due and not yet recorded. */
  overdue: ForecastEntry[];
  /** Cash flow for the period: counted income and expenses, recorded or expected. */
  cashFlow: PeriodKpis;
  /** Timing gaps that overlap the period. */
  gaps: GapExplanation[];
}

/** What needs attention for a review period, read from the forecast (build it `through: period.end`). */
export function reviewSummary(forecast: Forecast, period: ReviewPeriod): ReviewSummary {
  const inPeriod = entriesInRange(forecast, period.start, period.end).filter((e) => e.counts);
  const outstanding = inPeriod.filter((e) => e.occurrence.status === 'scheduled');
  const days = forecast.forecastStart ? Math.max(GAP_LOOKAHEAD_DAYS, diffDays(forecast.forecastStart, period.end) + 1) : GAP_LOOKAHEAD_DAYS;
  return {
    period,
    expectedIncome: outstanding.filter((e) => e.signedCents > 0),
    expectedOutflows: outstanding.filter((e) => e.signedCents < 0),
    recorded: inPeriod.filter((e) => e.occurrence.status === 'completed'),
    overdue: overdueEntries(forecast),
    cashFlow: periodKpis(forecast, period.start, period.end),
    gaps: explainTimingGaps(forecast, days).filter((g) => g.end >= period.start && g.start <= period.end),
  };
}
