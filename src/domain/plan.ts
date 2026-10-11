/**
 * The monthly plan: what each recurring item adds up to in an average month,
 * grouped by Income, Expenses (bills, subscriptions, liability payments),
 * Savings, and Spending, plus one headline number:
 *
 *   Left to spend = monthly income − monthly expenses
 *
 * Savings and Spending are reported separately and are not subtracted; they
 * are planned uses of what is left to spend.
 *
 * Monthly equivalents use average-month factors so items on different
 * schedules can be added together:
 *   weekly ×52/12, every 2 weeks ×26/12, twice a month ×2, monthly ×1,
 *   every N days ×(365/12)/N, every N weeks ×(52/12)/N, every N months ×1/N.
 * Each item is rounded to whole cents once, so every total shown is an exact
 * sum of the items under it. Only active recurring items count; one-time
 * items do not repeat and are left out.
 */
import type { DateStr } from './dates';
import type { Cents } from './money';
import { EXPENSE_KINDS, type AppData, type RecurrenceRule, type RecurringSource, type TransactionKind } from './types';

export function monthlyFactor(rule: RecurrenceRule): number {
  switch (rule.type) {
    case 'weekly':
      return 52 / 12;
    case 'biweekly':
      return 26 / 12;
    case 'twiceMonthly':
      return 2;
    case 'monthly':
      return 1;
    case 'custom':
      if (rule.unit === 'day') return 365 / 12 / rule.interval;
      if (rule.unit === 'week') return 52 / 12 / rule.interval;
      return 1 / rule.interval;
  }
}

/** The schedule version that applies from today on: the latest one starting on or before today, else the first upcoming one. */
function currentVersion(source: RecurringSource, today: DateStr) {
  const started = source.versions.filter((v) => v.startDate <= today);
  return started[started.length - 1] ?? source.versions[0]!;
}

export function monthlyCents(source: RecurringSource, today: DateStr): Cents {
  const v = currentVersion(source, today);
  return Math.round(v.amountCents * monthlyFactor(v.rule));
}

export interface PlanItem {
  source: RecurringSource;
  monthlyCents: Cents;
}

export interface TagTotal {
  tag: string;
  inCents: Cents;
  outCents: Cents;
  count: number;
}

export interface MonthlyPlan {
  byKind: Record<TransactionKind, Cents>;
  items: Record<TransactionKind, PlanItem[]>;
  incomeCents: Cents;
  /** Bills + subscriptions + liability payments. */
  expensesCents: Cents;
  savingsCents: Cents;
  spendingCents: Cents;
  /** Income − expenses. */
  leftToSpendCents: Cents;
  /** Monthly totals per user-created tag. An item with several tags counts toward each. */
  byTag: TagTotal[];
}

export function monthlyPlan(data: AppData, today: DateStr): MonthlyPlan {
  const kinds: TransactionKind[] = ['income', 'bill', 'subscription', 'liability', 'savings', 'spending'];
  const items = Object.fromEntries(kinds.map((k) => [k, [] as PlanItem[]])) as Record<TransactionKind, PlanItem[]>;
  const tags = new Map<string, TagTotal>();

  for (const source of data.sources) {
    if (!source.active) continue;
    const cents = monthlyCents(source, today);
    items[source.kind].push({ source, monthlyCents: cents });
    for (const tag of source.tags) {
      const key = tag.toLowerCase();
      const t = tags.get(key) ?? { tag, inCents: 0, outCents: 0, count: 0 };
      if (source.kind === 'income') t.inCents += cents;
      else t.outCents += cents;
      t.count += 1;
      tags.set(key, t);
    }
  }

  const byKind = Object.fromEntries(kinds.map((k) => [k, items[k].reduce((s, i) => s + i.monthlyCents, 0)])) as Record<TransactionKind, Cents>;
  const expensesCents = EXPENSE_KINDS.reduce((s, k) => s + byKind[k], 0);
  return {
    byKind,
    items,
    incomeCents: byKind.income,
    expensesCents,
    savingsCents: byKind.savings,
    spendingCents: byKind.spending,
    leftToSpendCents: byKind.income - expensesCents,
    byTag: [...tags.values()].sort((a, b) => b.outCents + b.inCents - (a.outCents + a.inCents) || a.tag.localeCompare(b.tag)),
  };
}
