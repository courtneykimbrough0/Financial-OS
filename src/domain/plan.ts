/**
 * Cash flow for a period:
 *
 *   Cash flow = income − expenses
 *
 * where expenses are bills, subscriptions, liability payments, and savings.
 * It is computed from the same forecast entries as every other view, so
 * recurring and one-time items both count on the dates they fall, completed
 * items count at their actual amount and date, and canceled items do not count.
 */
import type { DateStr } from './dates';
import { entriesInRange, type Forecast } from './forecast';
import type { Cents } from './money';
import { EXPENSE_KINDS, KINDS, type TransactionKind } from './types';

export interface TagTotal {
  tag: string;
  inCents: Cents;
  outCents: Cents;
  count: number;
}

export interface PeriodPlan {
  start: DateStr;
  end: DateStr;
  byKind: Record<TransactionKind, Cents>;
  incomeCents: Cents;
  /** Bills + subscriptions + liability payments + savings. */
  expensesCents: Cents;
  /** Cash flow: income − expenses. */
  cashFlowCents: Cents;
  /** Totals per user-created tag in the period. An item with several tags counts toward each. */
  byTag: TagTotal[];
}

export function periodPlan(forecast: Forecast, start: DateStr, end: DateStr): PeriodPlan {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<TransactionKind, Cents>;
  const tags = new Map<string, TagTotal>();
  for (const e of entriesInRange(forecast, start, end)) {
    if (!e.counts) continue;
    const kind = e.occurrence.kind;
    byKind[kind] += e.amountCents;
    for (const tag of e.occurrence.tags) {
      const key = tag.toLowerCase();
      const t = tags.get(key) ?? { tag, inCents: 0, outCents: 0, count: 0 };
      if (kind === 'income') t.inCents += e.amountCents;
      else t.outCents += e.amountCents;
      t.count += 1;
      tags.set(key, t);
    }
  }
  const expensesCents = EXPENSE_KINDS.reduce((s, k) => s + byKind[k], 0);
  return {
    start,
    end,
    byKind,
    incomeCents: byKind.income,
    expensesCents,
    cashFlowCents: byKind.income - expensesCents,
    byTag: [...tags.values()].sort((a, b) => b.outCents + b.inCents - (a.outCents + a.inCents) || a.tag.localeCompare(b.tag)),
  };
}
