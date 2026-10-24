import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { buildForecast, dailyTimeline, negativeStretches, overdueEntries, tallyOn } from '../forecast';
import { findOccurrence } from '../occurrences';
import { buildSampleData, SAMPLE_IDS } from '../sample';
import { usd } from './helpers';

// Run the checks on several "today" values, including month ends and a leap day.
const TODAYS = ['2026-10-11', '2026-01-31', '2028-02-29', '2026-12-31'];

describe.each(TODAYS)('sample data built on %s', (today) => {
  const T = (n: number) => addDays(today, n);
  const data = buildSampleData(today);
  const f = buildForecast(data, today);

  it('is flagged as sample data and skips onboarding', () => {
    expect(data.isSample).toBe(true);
    expect(data.onboardingComplete).toBe(true);
  });

  it('has a late, smaller paycheck with the original prediction kept', () => {
    expect(findOccurrence(data, `${SAMPLE_IDS.paycheck}@${T(-3)}`, today)).toMatchObject({
      status: 'completed',
      expectedAmountCents: usd(1800),
      expectedDate: T(-3),
      actualAmountCents: usd(1650),
      actualDate: T(-2),
    });
    // The next paycheck is still scheduled on its normal rhythm; the forecast starts today, not at it.
    expect(f.forecastStart).toBe(today);
    expect(findOccurrence(data, `${SAMPLE_IDS.paycheck}@${T(11)}`, today)).toMatchObject({ status: 'scheduled', scheduledAmountCents: usd(1800) });
  });

  it('has an expense that cost more than expected', () => {
    expect(findOccurrence(data, `${SAMPLE_IDS.electric}@${T(-12)}`, today)).toMatchObject({ expectedAmountCents: usd(90), actualAmountCents: usd(128), actualDate: T(-10) });
  });

  it('has an unpaid bill that stays visible as overdue and stays in the forecast', () => {
    const overdue = overdueEntries(f);
    expect(overdue.map((e) => e.occurrence.id)).toEqual([`${SAMPLE_IDS.phone}@${T(-6)}`]);
    expect([overdue[0]!.date, overdue[0]!.counts]).toEqual([T(-6), true]);
  });

  it('dips below $0 before a later payday, then recovers', () => {
    const rows = dailyTimeline(f, T(0), T(40));
    const stretches = negativeStretches(rows);
    expect(stretches).toHaveLength(1);
    expect(stretches[0]!.start).toBe(T(20));
    expect(stretches[0]!.end).toBe(T(24));
    expect(tallyOn(f, T(25))!).toBeGreaterThan(0);
  });
});
