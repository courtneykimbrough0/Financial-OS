/**
 * Earnings from logged shifts (E2): what was earned, kept apart from money
 * received. Pure functions over `WorkEntry`; nothing here is read by the
 * forecast, so nothing here can change cash flow or the running total.
 *
 * - Wages for a shift: hours × hourly wage, in whole cents (rounded to the
 *   nearest cent once per shift).
 * - A shift's earnings: wages + cash tips + card tips.
 * - Earned, not paid yet: the wages and card tips of shifts no recorded
 *   paycheck has covered. Cash tips are never in it: they were money in on the
 *   shift's date, as their own received income record.
 * - Effective hourly: earnings ÷ hours, over shifts that have hours.
 */
import type { DateStr } from './dates';
import type { Cents } from './money';
import type { AppData, WorkEntry } from './types';

export interface ShiftEarnings {
  wagesCents: Cents;
  cashTipsCents: Cents;
  cardTipsCents: Cents;
  /** Wages + cash tips + card tips. */
  totalCents: Cents;
  /** Wages + card tips: what the paycheck pays. */
  payrollCents: Cents;
}

/** Hours × wage for one shift, to the nearest cent; $0 without both. */
export function shiftWagesCents(e: Pick<WorkEntry, 'minutes' | 'wageCents'>): Cents {
  return e.minutes && e.wageCents ? Math.round((e.minutes * e.wageCents) / 60) : 0;
}

export function shiftEarnings(e: WorkEntry): ShiftEarnings {
  const wagesCents = shiftWagesCents(e);
  const cashTipsCents = e.cashTipsCents ?? 0;
  const cardTipsCents = e.cardTipsCents ?? 0;
  return { wagesCents, cashTipsCents, cardTipsCents, totalCents: wagesCents + cashTipsCents + cardTipsCents, payrollCents: wagesCents + cardTipsCents };
}

export interface EarningsSummary {
  shifts: number;
  minutes: number;
  wagesCents: Cents;
  cashTipsCents: Cents;
  cardTipsCents: Cents;
  totalCents: Cents;
  /** Earnings per hour over the shifts that have hours; null when none do. */
  effectiveHourlyCents: Cents | null;
}

/** Totals for a set of shifts. Each shift is counted once. */
export function summarize(entries: WorkEntry[]): EarningsSummary {
  let minutes = 0;
  let withHoursCents = 0;
  const sum = { wagesCents: 0, cashTipsCents: 0, cardTipsCents: 0, totalCents: 0 };
  for (const e of entries) {
    const s = shiftEarnings(e);
    sum.wagesCents += s.wagesCents;
    sum.cashTipsCents += s.cashTipsCents;
    sum.cardTipsCents += s.cardTipsCents;
    sum.totalCents += s.totalCents;
    if (e.minutes) {
      minutes += e.minutes;
      withHoursCents += s.totalCents;
    }
  }
  return { shifts: entries.length, minutes, ...sum, effectiveHourlyCents: minutes > 0 ? Math.round((withHoursCents * 60) / minutes) : null };
}

/** An income item's shifts, newest first (then by id, so the order never depends on storage). */
export function shiftsFor(data: AppData, sourceId: string): WorkEntry[] {
  return (data.workEntries ?? [])
    .filter((e) => e.sourceId === sourceId)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Shifts in [start, end], every item or one. */
export function shiftsInRange(data: AppData, start: DateStr, end: DateStr, sourceId?: string): WorkEntry[] {
  return (data.workEntries ?? []).filter((e) => e.date >= start && e.date <= end && (sourceId === undefined || e.sourceId === sourceId));
}

/** Wages and card tips no recorded paycheck has covered yet, for one item. Outside cash flow until that paycheck is recorded. */
export function earnedNotPaid(data: AppData, sourceId: string): { cents: Cents; shifts: WorkEntry[] } {
  const shifts = shiftsFor(data, sourceId).filter((e) => e.paidByOccurrenceId === undefined);
  return { cents: shifts.reduce((n, e) => n + shiftEarnings(e).payrollCents, 0), shifts };
}

/** "6.5 h", "45 min". */
export function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours} h`;
}
