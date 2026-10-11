import { describe, expect, it } from 'vitest';
import type { RecurrenceRule } from '../types';
import { describeRule, nextOccurrenceOnOrAfter, occurrenceDates, validateRule } from '../recurrence';

describe('recurrence generation', () => {
  it('weekly and every-two-weeks', () => {
    expect(occurrenceDates({ type: 'weekly' }, '2026-10-02', '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30',
    ]);
    expect(occurrenceDates({ type: 'biweekly' }, '2026-10-02', '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13', '2026-11-27',
    ]);
  });

  it('never generates occurrences before the start date', () => {
    expect(occurrenceDates({ type: 'weekly' }, '2026-10-15', '2026-10-01', '2026-10-20')).toEqual(['2026-10-15']);
    expect(occurrenceDates({ type: 'monthly' }, '2026-10-15', '2026-01-01', '2026-11-30')).toEqual(['2026-10-15', '2026-11-15']);
  });

  it('twice monthly is distinct from every two weeks', () => {
    const twice = occurrenceDates({ type: 'twiceMonthly', days: [1, 15] }, '2026-01-01', '2026-01-01', '2026-12-31');
    const biweekly = occurrenceDates({ type: 'biweekly' }, '2026-01-01', '2026-01-01', '2026-12-31');
    expect(twice).toHaveLength(24);
    expect(biweekly).toHaveLength(27); // 2026 has 27 Thursdays in this biweekly series
    expect(twice.slice(0, 4)).toEqual(['2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15']);
    expect(biweekly.slice(0, 4)).toEqual(['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12']);
  });

  it('twice monthly on the 15th and 31st clamps to month end', () => {
    expect(occurrenceDates({ type: 'twiceMonthly', days: [15, 31] }, '2026-01-15', '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-15', '2026-01-31', '2026-02-15', '2026-02-28', '2026-03-15', '2026-03-31', '2026-04-15', '2026-04-30',
    ]);
  });

  it('twice monthly does not duplicate when both days clamp to the same date', () => {
    expect(occurrenceDates({ type: 'twiceMonthly', days: [30, 31] }, '2027-01-30', '2027-02-01', '2027-02-28')).toEqual(['2027-02-28']);
  });

  it('monthly on the 31st clamps to the last day without drifting', () => {
    expect(occurrenceDates({ type: 'monthly' }, '2026-01-31', '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
    ]);
    // Leap year
    expect(occurrenceDates({ type: 'monthly' }, '2028-01-30', '2028-02-01', '2028-03-31')).toEqual(['2028-02-29', '2028-03-30']);
  });

  it('custom intervals in days, weeks, and months', () => {
    expect(occurrenceDates({ type: 'custom', interval: 10, unit: 'day' }, '2026-10-01', '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-01', '2026-10-11', '2026-10-21', '2026-10-31',
    ]);
    expect(occurrenceDates({ type: 'custom', interval: 4, unit: 'week' }, '2026-10-01', '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-01', '2026-10-29', '2026-11-26', '2026-12-24',
    ]);
    expect(occurrenceDates({ type: 'custom', interval: 3, unit: 'month' }, '2026-11-30', '2026-11-01', '2027-08-31')).toEqual([
      '2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30',
    ]);
  });

  it('adjacent windows neither duplicate nor skip boundary occurrences', () => {
    const rules: RecurrenceRule[] = [
      { type: 'weekly' },
      { type: 'biweekly' },
      { type: 'monthly' },
      { type: 'twiceMonthly', days: [1, 15] },
      { type: 'custom', interval: 2, unit: 'month' },
    ];
    for (const rule of rules) {
      const whole = occurrenceDates(rule, '2026-01-01', '2026-01-01', '2026-12-31');
      // Split exactly on occurrence dates and between them.
      for (const split of ['2026-01-15', '2026-03-01', '2026-06-30', '2026-07-01']) {
        const before = occurrenceDates(rule, '2026-01-01', '2026-01-01', split);
        const after = occurrenceDates(rule, '2026-01-01', nextDay(split), '2026-12-31');
        expect([...before, ...after]).toEqual(whole);
      }
    }
  });

  it('finds the next occurrence on or after a date', () => {
    expect(nextOccurrenceOnOrAfter({ type: 'biweekly' }, '2026-10-02', '2026-10-17')).toBe('2026-10-30');
    expect(nextOccurrenceOnOrAfter({ type: 'biweekly' }, '2026-10-02', '2026-10-16')).toBe('2026-10-16');
  });

  it('validates rules', () => {
    expect(validateRule({ type: 'twiceMonthly', days: [1, 15] }, '2026-10-15')).toBeNull();
    expect(validateRule({ type: 'twiceMonthly', days: [1, 15] }, '2026-10-10')).toMatch(/1st or 15th/);
    expect(validateRule({ type: 'twiceMonthly', days: [15, 15] }, '2026-10-15')).toMatch(/different/);
    expect(validateRule({ type: 'twiceMonthly', days: [15, 31] }, '2026-02-28')).toBeNull();
    expect(validateRule({ type: 'custom', interval: 0, unit: 'day' }, '2026-10-15')).toMatch(/whole number/);
  });

  it('describes rules in plain language', () => {
    expect(describeRule({ type: 'monthly' }, '2026-10-01')).toBe('Monthly on the 1st');
    expect(describeRule({ type: 'twiceMonthly', days: [15, 1] }, '2026-10-01')).toBe('Twice a month on the 1st and 15th');
    expect(describeRule({ type: 'custom', interval: 3, unit: 'week' }, '2026-10-01')).toBe('Every 3 weeks');
  });
});

function nextDay(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
