import { Tag, TrendingDown } from 'lucide-react';
import { formatRange } from '../../domain/dates';
import { formatMoney, formatSignedMoney } from '../../domain/money';
import type { PeriodPlan } from '../../domain/plan';
import { Icon, SectionLabel } from './common';

/** The single headline number for a period: income minus expenses. */
export function LeftToSpend({ plan }: { plan: PeriodPlan | null }) {
  const negative = plan !== null && plan.leftToSpendCents < 0;
  return (
    <div className={`left-to-spend${negative ? ' negative' : ''}`} role="status" aria-live="polite">
      <span className="lts-label">
        Left to spend
        <span className="lts-sub">{plan ? `First pay period · ${formatRange(plan.start, plan.end)}` : 'Add income to see this'}</span>
      </span>
      <span className="lts-value">
        {negative && <Icon icon={TrendingDown} size={20} />}
        {plan ? formatMoney(plan.leftToSpendCents) : '—'}
      </span>
    </div>
  );
}

function Row({ label, value, tone, level = 0, strong = false }: { label: string; value: string; tone?: 'in' | 'out' | 'neg'; level?: 0 | 1; strong?: boolean }) {
  return (
    <div className={`breakdown-row${level ? ' sub' : ''}${strong ? ' strong' : ''}`}>
      <dt>{label}</dt>
      <dd className={tone === 'in' ? 'amount-in' : tone === 'out' ? 'amount-out' : tone === 'neg' ? 'negative-text' : ''}>{value}</dd>
    </div>
  );
}

/** Income, Expenses (bills, subscriptions, liability payments, savings), and Left to spend for a period. */
export function PeriodBreakdown({ plan, title }: { plan: PeriodPlan; title: string }) {
  return (
    <section className="stack-sm" aria-labelledby="breakdown-period">
      <SectionLabel id="breakdown-period">{title}</SectionLabel>
      <div className="card">
        <p className="hint">{formatRange(plan.start, plan.end)}</p>
        <dl className="breakdown">
          <Row label="Income" value={formatSignedMoney(plan.incomeCents)} tone="in" />
          <Row label="Expenses" value={plan.expensesCents ? `−${formatMoney(plan.expensesCents)}` : formatMoney(0)} tone="out" />
          <Row label="Bills" value={formatMoney(plan.byKind.bill)} level={1} />
          <Row label="Subscriptions" value={formatMoney(plan.byKind.subscription)} level={1} />
          <Row label="Liability payments" value={formatMoney(plan.byKind.liability)} level={1} />
          <Row label="Savings" value={formatMoney(plan.byKind.savings)} level={1} />
          <Row label="Left to spend" value={formatMoney(plan.leftToSpendCents)} tone={plan.leftToSpendCents < 0 ? 'neg' : undefined} strong />
        </dl>
        <p className="hint">Left to spend is income minus expenses. Includes repeating and one-time items dated in this period.</p>
      </div>
    </section>
  );
}

/** Totals per tag the user created, for the same period. Hidden when no tagged items fall in it. */
export function TagBreakdown({ plan }: { plan: PeriodPlan }) {
  if (plan.byTag.length === 0) return null;
  return (
    <section className="stack-sm" aria-labelledby="breakdown-tags">
      <SectionLabel id="breakdown-tags">By tag</SectionLabel>
      <div className="card">
        <dl className="breakdown">
          {plan.byTag.map((t) => (
            <div key={t.tag} className="breakdown-row">
              <dt>
                <span className="tag">
                  <Icon icon={Tag} size={11} />
                  {t.tag}
                </span>
                <span className="hint"> · {t.count === 1 ? '1 item' : `${t.count} items`}</span>
              </dt>
              <dd>
                {t.inCents > 0 && <span className="amount-in">+{formatMoney(t.inCents)}</span>}
                {t.inCents > 0 && t.outCents > 0 && ' '}
                {t.outCents > 0 && <span className="amount-out">−{formatMoney(t.outCents)}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="hint">An item with more than one tag counts toward each of its tags.</p>
      </div>
    </section>
  );
}
