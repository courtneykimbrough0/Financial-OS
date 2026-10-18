/**
 * Cash flow for a period:
 *
 *   Operating cash flow = income − outflows
 *   Cash flow (available) = operating cash flow − net reserves
 *
 * where outflows are bills, subscriptions, liability payments and varied
 * spending, and net reserves are allocations to Strategic Reserves minus
 * releases. Reserves are never counted as outflows.
 * It is computed from the same forecast entries as every other view, so
 * recurring and one-time items both count on the dates they fall, completed
 * items count at their actual amount and date, and canceled items do not count.
 */
import type { DateStr } from './dates';
import { entriesInRange, type Forecast } from './forecast';
import type { Cents } from './money';
import { KINDS, OUTFLOW_KINDS, type TransactionKind } from './types';

export interface TagTotal {
  tag: string;
  inCents: Cents;
  outCents: Cents;
  count: number;
}

export interface PeriodPlan {
  start: DateStr;
  end: DateStr;
  /** Per kind; for reserves, allocations minus releases. */
  byKind: Record<TransactionKind, Cents>;
  incomeCents: Cents;
  /** External outflows: bills + subscriptions + liability payments + varied spending. */
  outflowCents: Cents;
  /** Net allocations to Strategic Reserves. */
  reservesCents: Cents;
  /** Operating cash flow: income − outflows. */
  operatingCents: Cents;
  /** Available cash flow: operating − net reserves. */
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
    const released = kind === 'reserve' && e.occurrence.release;
    byKind[kind] += released ? -e.amountCents : e.amountCents;
    for (const tag of e.occurrence.tags) {
      const key = tag.toLowerCase();
      const t = tags.get(key) ?? { tag, inCents: 0, outCents: 0, count: 0 };
      if (e.signedCents > 0) t.inCents += e.amountCents;
      else t.outCents += e.amountCents;
      t.count += 1;
      tags.set(key, t);
    }
  }
  const outflowCents = OUTFLOW_KINDS.reduce((s, k) => s + byKind[k], 0);
  const operatingCents = byKind.income - outflowCents;
  return {
    start,
    end,
    byKind,
    incomeCents: byKind.income,
    outflowCents,
    reservesCents: byKind.reserve,
    operatingCents,
    cashFlowCents: operatingCents - byKind.reserve,
    byTag: [...tags.values()].sort((a, b) => b.outCents + b.inCents - (a.outCents + a.inCents) || a.tag.localeCompare(b.tag)),
  };
}
