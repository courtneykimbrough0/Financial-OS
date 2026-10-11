import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  dayOfWeek,
  diffDays,
  eachDay,
  endOfWeek,
  isValidDateStr,
  startOfWeek,
  todayLocal,
} from '../dates';
import { centsToInput, formatCompact, formatMoney, formatSignedMoney, parseMoney } from '../money';

describe('date-only handling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('crosses DST transitions without shifting calendar days', () => {
    // US DST starts 2026-03-08 and ends 2026-11-01.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(diffDays('2026-03-01', '2026-04-01')).toBe(31);
    expect(eachDay('2026-10-30', '2026-11-03')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(isValidDateStr('2027-02-29')).toBe(false);
    expect(isValidDateStr('2028-02-29')).toBe(true);
  });

  it('reads today from the local calendar, not UTC', () => {
    // 11:30pm local on Oct 15 must still be Oct 15 even if UTC is already Oct 16.
    const lateEvening = new Date(2026, 9, 15, 23, 30);
    expect(todayLocal(lateEvening)).toBe('2026-10-15');
    const earlyMorning = new Date(2026, 9, 16, 0, 15);
    expect(todayLocal(earlyMorning)).toBe('2026-10-16');
  });

  it('uses Sunday–Saturday weeks', () => {
    // 2026-10-11 is a Sunday.
    expect(dayOfWeek('2026-10-11')).toBe(0);
    expect(startOfWeek('2026-10-11')).toBe('2026-10-11');
    expect(endOfWeek('2026-10-11')).toBe('2026-10-17');
    expect(startOfWeek('2026-10-17')).toBe('2026-10-11');
    expect(startOfWeek('2026-10-18')).toBe('2026-10-18');
    // Weeks span month and year boundaries.
    expect(startOfWeek('2027-01-01')).toBe('2026-12-27');
  });

  it('rejects malformed dates', () => {
    expect(isValidDateStr('2026-13-01')).toBe(false);
    expect(isValidDateStr('2026-04-31')).toBe(false);
    expect(isValidDateStr('10/15/2026')).toBe(false);
    expect(isValidDateStr('')).toBe(false);
  });
});

describe('money', () => {
  it('parses user input into integer cents', () => {
    expect(parseMoney('1650')).toBe(165000);
    expect(parseMoney('$1,650.5')).toBe(165050);
    expect(parseMoney('0.07')).toBe(7);
    expect(parseMoney('.5')).toBe(50);
    expect(parseMoney('19.99')).toBe(1999);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('.')).toBeNull();
  });

  it('avoids floating-point drift', () => {
    // 0.1 + 0.2 style errors cannot happen with cents.
    const items = ['0.10', '0.20', '19.99', '0.01'].map((s) => parseMoney(s)!);
    expect(items.reduce((a, b) => a + b, 0)).toBe(2030);
    let total = 0;
    for (let i = 0; i < 1000; i++) total += parseMoney('0.10')!;
    expect(total).toBe(10000);
  });

  it('formats consistently', () => {
    expect(formatMoney(165000)).toBe('$1,650.00');
    expect(formatMoney(-23000)).toBe('−$230.00');
    expect(formatSignedMoney(500)).toBe('+$5.00');
    expect(formatSignedMoney(-500)).toBe('−$5.00');
    expect(formatSignedMoney(0)).toBe('$0.00');
    expect(centsToInput(165005)).toBe('1650.05');
    expect(formatCompact(165000)).toBe('$1.7k');
    expect(formatCompact(8500)).toBe('$85');
  });
});
