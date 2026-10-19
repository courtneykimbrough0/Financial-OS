import { describe, expect, it } from 'vitest';
import * as ops from '../operations';
import { clockAt, source, unwrap, usd } from './helpers';

describe('starting over', () => {
  it('removes every item and recorded outcome, returns to setup, and keeps the revision', () => {
    let d = unwrap(ops.completeOnboarding(ops.emptyData()));
    d = source(d, '2026-10-01', 'income', 'Paycheck', 1000, '2026-10-02', { type: 'biweekly' }, 'pay');
    d = unwrap(ops.recordActual(d, 'pay@2026-10-02', { amountCents: usd(1000), date: '2026-10-02' }, clockAt('2026-10-16')));
    d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(80), date: '2026-10-20' }, clockAt('2026-10-16'), 'rep'));
    d = { ...d, revision: 9 };
    expect(unwrap(ops.startOver(d))).toEqual({ schemaVersion: 2, revision: 9, onboardingComplete: false, sources: [], records: [] });
  });
});
