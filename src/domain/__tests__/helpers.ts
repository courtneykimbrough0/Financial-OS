import { expect } from 'vitest';
import type { DateStr } from '../dates';
import * as ops from '../operations';
import type { AppData, RecurrenceRule, TransactionKind } from '../types';

export const clockAt = (today: DateStr): ops.Clock => ({ today, now: `${today}T12:00:00.000Z` });

export function unwrap(result: ops.Result): AppData {
  if (!result.ok) throw new Error(`Expected success, got: ${result.error}`);
  return result.data;
}

export function expectError(result: ops.Result, match?: RegExp): string {
  expect(result.ok).toBe(false);
  if (result.ok) return '';
  if (match) expect(result.error).toMatch(match);
  return result.error;
}

let seq = 0;
export function source(
  data: AppData,
  today: DateStr,
  kind: TransactionKind,
  description: string,
  dollars: number,
  startDate: DateStr,
  rule: RecurrenceRule = { type: 'monthly' },
  id = `${kind}-${++seq}`,
): AppData {
  return unwrap(ops.addSource(data, { kind, description, amountCents: Math.round(dollars * 100), startDate, rule, ...(kind === 'liability' ? { liabilityType: 'loan' as const } : {}) }, clockAt(today), id));
}

export const usd = (dollars: number) => Math.round(dollars * 100);
