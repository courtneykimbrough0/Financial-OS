/**
 * Recorded activity for a date range: pure aggregation over completed
 * forecast entries, with the same by-kind and by-tag breakdown that
 * `periodPlan` computes for projected entries.
 *
 * Labels in this view:
 *   Received  (income that arrived)
 *   Paid      (external outflows: bills, subscriptions, liabilities, varied)
 *   Saved     (net allocations to Strategic Reserves)
 *   Cash flow (received − paid − saved)
 *
 * The summary is a `PeriodPlan` so `PeriodBreakdown` and `TagBreakdown`
 * render it without changes.
 */
import type { DateStr } from './dates';
import { entriesInRange, type Forecast, type ForecastEntry } from './forecast';
import type { Cents } from './money';
import type { PeriodPlan, TagTotal } from './plan';
import { variance, type Variance } from './occurrences';
import { KINDS, OUTFLOW_KINDS, type TransactionKind } from './types';

export interface ActivityItem {
  entry: ForecastEntry;
  variance: Variance | null;
}

export interface ActivityView {
  start: DateStr;
  end: DateStr;
  /** Recorded items in the range, newest first. Filtered by kind when one is chosen. */
  items: ActivityItem[];
  /** Summary of ALL recorded items in the range (unfiltered). */
  summary: PeriodPlan;
  /** Total recorded items before any kind filter. */
  totalCount: number;
}

export function activityView(forecast: Forecast, start: DateStr, end: DateStr, kindFilter?: TransactionKind): ActivityView {
  const recorded = entriesInRange(forecast, start, end).filter((e) => e.counts && e.occurrence.status === 'completed');

  const filtered = kindFilter ? recorded.filter((e) => e.occurrence.kind === kindFilter) : recorded;

  const items: ActivityItem[] = filtered
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? -1 : 1;
      return a.occurrence.id < b.occurrence.id ? -1 : a.occurrence.id > b.occurrence.id ? 1 : 0;
    })
    .map((entry) => ({ entry, variance: variance(entry.occurrence) }));

  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<TransactionKind, Cents>;
  const tags = new Map<string, TagTotal>();
  for (const e of recorded) {
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
  const incomeCents = byKind.income;
  const reservesCents = byKind.reserve;
  const operatingCents = incomeCents - outflowCents;
  const cashFlowCents = operatingCents - reservesCents;

  return {
    start,
    end,
    items,
    totalCount: recorded.length,
    summary: {
      start,
      end,
      byKind,
      incomeCents,
      outflowCents,
      reservesCents,
      operatingCents,
      cashFlowCents,
      byTag: [...tags.values()].sort((a, b) => b.outCents + b.inCents - (a.outCents + a.inCents) || a.tag.localeCompare(b.tag)),
    },
  };
}
