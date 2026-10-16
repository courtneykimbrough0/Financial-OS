import { addDays, dayInMonthOffset, diffDays, parts, ordinal, type DateStr } from './dates';
import type { RecurrenceRule } from './types';

function stepDays(rule: RecurrenceRule): number | null {
  switch (rule.type) {
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
    case 'custom':
      if (rule.unit === 'day') return rule.interval;
      if (rule.unit === 'week') return rule.interval * 7;
      return null;
    default:
      return null;
  }
}

/**
 * All occurrence dates of `rule`, anchored at `start`, that fall within the
 * inclusive window [from, to]. Results are sorted and unique. Because each
 * date is computed from the anchor (not by chaining from the previous window),
 * adjacent windows never duplicate or skip an occurrence at their boundary.
 */
export function occurrenceDates(rule: RecurrenceRule, start: DateStr, from: DateStr, to: DateStr): DateStr[] {
  const lo = from > start ? from : start;
  if (lo > to) return [];
  const out: DateStr[] = [];

  const step = stepDays(rule);
  if (step !== null) {
    if (step < 1) return [];
    const k0 = Math.max(0, Math.ceil(diffDays(start, lo) / step));
    for (let k = k0; ; k++) {
      const d = addDays(start, k * step);
      if (d > to) break;
      out.push(d);
    }
    return out;
  }

  if (rule.type === 'monthly' || (rule.type === 'custom' && rule.unit === 'month')) {
    const interval = rule.type === 'monthly' ? 1 : rule.interval;
    if (interval < 1) return [];
    const day = parts(start).d;
    const sp = parts(start);
    const lp = parts(lo);
    const monthsBetween = (lp.y - sp.y) * 12 + (lp.m - sp.m);
    let k = Math.max(0, Math.floor(monthsBetween / interval) - 1);
    for (; ; k++) {
      const d = dayInMonthOffset(start, k * interval, day);
      if (d > to) break;
      if (d >= lo) out.push(d);
    }
    return out;
  }

  if (rule.type === 'twiceMonthly') {
    const [a, b] = [...rule.days].sort((x, y) => x - y) as [number, number];
    const sp = parts(start);
    const lp = parts(lo);
    let k = Math.max(0, (lp.y - sp.y) * 12 + (lp.m - sp.m) - 1);
    for (; ; k++) {
      const first = dayInMonthOffset(start, k, a);
      if (first > to) break;
      const second = dayInMonthOffset(start, k, b);
      for (const d of first === second ? [first] : [first, second]) {
        if (d >= lo && d <= to) out.push(d);
      }
    }
    return out;
  }

  return out;
}

/** The first occurrence on or after `date`, searching up to ~2 years ahead. */
export function nextOccurrenceOnOrAfter(rule: RecurrenceRule, start: DateStr, date: DateStr): DateStr | null {
  return occurrenceDates(rule, start, date, addDays(date < start ? start : date, 800))[0] ?? null;
}

/** Returns an error message when `start` is not a valid first occurrence for `rule`. */
export function validateRule(rule: RecurrenceRule, start: DateStr): string | null {
  if (rule.type === 'custom') {
    if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365) {
      return 'Enter how often it repeats as a whole number between 1 and 365.';
    }
  }
  if (rule.type === 'twiceMonthly') {
    const [a, b] = rule.days;
    if (![a, b].every((d) => Number.isInteger(d) && d >= 1 && d <= 31)) {
      return 'Choose two days of the month between 1 and 31.';
    }
    if (a === b) return 'Choose two different days of the month.';
    if (occurrenceDates(rule, start, start, start).length === 0) {
      return `The next expected date must fall on the ${ordinal(Math.min(a, b))} or ${ordinal(Math.max(a, b))} (or the last day of a short month).`;
    }
  }
  return null;
}

export function describeRule(rule: RecurrenceRule, start: DateStr): string {
  switch (rule.type) {
    case 'weekly':
      return 'Every week';
    case 'biweekly':
      return 'Every 2 weeks';
    case 'monthly':
      return `Monthly on the ${ordinal(parts(start).d)}`;
    case 'twiceMonthly': {
      const [a, b] = [...rule.days].sort((x, y) => x - y);
      return `Twice a month on the ${ordinal(a!)} and ${ordinal(b!)}`;
    }
    case 'custom': {
      const unit = rule.interval === 1 ? rule.unit : `${rule.unit}s`;
      return rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}`;
    }
  }
}

/**
 * True when the same rule started on `start` gives exactly the dates it gives
 * from `anchor`, from `start` on (checked a little over a year ahead). A
 * month-end date that was clamped (the 31st falling on Nov 30) fails, since
 * a schedule started there would drift to the 30th.
 */
export function startKeepsDates(rule: RecurrenceRule, anchor: DateStr, start: DateStr): boolean {
  const end = addDays(start, 400);
  const a = occurrenceDates(rule, start, start, end);
  const b = occurrenceDates(rule, anchor, start, end);
  return a.length === b.length && a.every((d, i) => d === b[i]);
}
