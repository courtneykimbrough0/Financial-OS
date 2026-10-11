/**
 * Date-only helpers.
 *
 * Every scheduled event is a calendar date, stored as an ISO string `YYYY-MM-DD`
 * (type `DateStr`). Arithmetic is done on UTC midnights internally so that the
 * host time zone and daylight-saving transitions can never shift an event onto
 * a different calendar day. Only `todayLocal()` reads the host clock, and it
 * converts using the *local* calendar date.
 */

export type DateStr = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isValidDateStr(value: unknown): value is DateStr {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parts(date: DateStr): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid date string: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function fromParts(y: number, m: number, d: number): DateStr {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toUtcMs(date: DateStr): number {
  const { y, m, d } = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): DateStr {
  const dt = new Date(ms);
  return fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** The user's current local calendar date. */
export function todayLocal(now: Date = new Date()): DateStr {
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: DateStr, n: number): DateStr {
  return fromUtcMs(toUtcMs(date) + n * MS_PER_DAY);
}

/** Days from `a` to `b` (positive when b is later). */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY);
}

/**
 * The given day-of-month in the month `monthOffset` months after `date`'s month.
 * Days that do not exist in the target month are clamped to its last day
 * (e.g. the 31st becomes Feb 28/29, Apr 30, ...).
 */
export function dayInMonthOffset(date: DateStr, monthOffset: number, day: number): DateStr {
  const { y, m } = parts(date);
  const index = y * 12 + (m - 1) + monthOffset;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  return fromParts(ty, tm, Math.min(day, daysInMonth(ty, tm)));
}

export function compareDates(a: DateStr, b: DateStr): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: DateStr, b: DateStr): DateStr {
  return a > b ? a : b;
}

export function minDate(a: DateStr, b: DateStr): DateStr {
  return a < b ? a : b;
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(date: DateStr): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

/**
 * Week convention used everywhere in the app: weeks run Sunday through Saturday.
 */
export const WEEK_STARTS_ON = 0;

export function startOfWeek(date: DateStr): DateStr {
  return addDays(date, -((dayOfWeek(date) - WEEK_STARTS_ON + 7) % 7));
}

export function endOfWeek(date: DateStr): DateStr {
  return addDays(startOfWeek(date), 6);
}

export function startOfMonth(date: DateStr): DateStr {
  const { y, m } = parts(date);
  return fromParts(y, m, 1);
}

export function endOfMonth(date: DateStr): DateStr {
  const { y, m } = parts(date);
  return fromParts(y, m, daysInMonth(y, m));
}

export function addMonthsClamped(date: DateStr, n: number): DateStr {
  return dayInMonthOffset(date, n, parts(date).d);
}

/** Inclusive list of dates from `start` to `end`. */
export function eachDay(start: DateStr, end: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Oct 15" */
export function formatShort(date: DateStr): string {
  const { m, d } = parts(date);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Oct 15, 2026" */
export function formatMedium(date: DateStr): string {
  const { y, m, d } = parts(date);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Thursday, October 15, 2026" */
export function formatLong(date: DateStr): string {
  const { y, m, d } = parts(date);
  return `${WEEKDAYS_LONG[dayOfWeek(date)]}, ${MONTHS_LONG[m - 1]} ${d}, ${y}`;
}

/** "October 2026" */
export function formatMonthYear(date: DateStr): string {
  const { y, m } = parts(date);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "Oct 11 – Oct 17" or "Oct 11 – 17" */
export function formatRange(start: DateStr, end: DateStr): string {
  if (start === end) return formatShort(start);
  const a = parts(start);
  const b = parts(end);
  if (a.y !== b.y) return `${formatMedium(start)} – ${formatMedium(end)}`;
  if (a.m === b.m) return `${formatShort(start)} – ${b.d}`;
  return `${formatShort(start)} – ${formatShort(end)}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
