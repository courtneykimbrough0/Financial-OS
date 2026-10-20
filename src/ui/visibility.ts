// What a screen shows, from what the forecast already computed. No money math:
// every rule reads fields the engine produced. A running total below $0 is
// never hidden, even on a day with nothing scheduled.
import type { DateStr } from '../domain/dates';
import type { DayRow, WeekSummary } from '../domain/forecast';
import type { PeriodPlan } from '../domain/plan';
import { KINDS } from '../domain/types';

export const isNegative = (row: DayRow): boolean => row.tallyCents !== null && row.tallyCents < 0;

/** A day worth opening: something is scheduled, or its running total is below $0. */
export const dayIsActive = (row: DayRow): boolean => row.entries.length > 0 || isNegative(row);

/** A week that can open: at least one of its days is active. */
export const weekIsActive = (week: WeekSummary): boolean => week.days.some(dayIsActive);

export type AgendaItem = { type: 'day'; row: DayRow } | { type: 'quiet'; start: DateStr; end: DateStr };

/** A week's days with each run of quiet days (not active, not today) folded into one item. */
export function agendaItems(rows: DayRow[], today: DateStr): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const row of rows) {
    if (dayIsActive(row) || row.date === today) {
      out.push({ type: 'day', row });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.type === 'quiet') last.end = row.date;
    else out.push({ type: 'quiet', start: row.date, end: row.date });
  }
  return out;
}

/** Nothing came in, went out or moved to or from reserves in the period. */
export const planIsEmpty = (plan: PeriodPlan): boolean => plan.incomeCents === 0 && plan.outflowCents === 0 && plan.reservesCents === 0;

/** A breakdown by classification says more than the totals only when two or more classifications have activity. */
export const kindsWithActivity = (plan: PeriodPlan): number => KINDS.filter((k) => plan.byKind[k] !== 0).length;
