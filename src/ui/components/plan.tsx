import { Tag, TrendingDown } from 'lucide-react';
import { formatMoney, formatSignedMoney } from '../../domain/money';
import type { MonthlyPlan } from '../../domain/plan';
import { Icon, SectionLabel } from './common';

/** The single headline number: monthly income minus monthly expenses. */
export function LeftToSpend({ plan }: { plan: MonthlyPlan }) {
  const negative = plan.leftToSpendCents < 0;
  return (
    <div className={`left-to-spend${negative ? ' negative' : ''}`} role="status" aria-live="polite">
      <span className="lts-label">
        Left to spend
        <span className="lts-sub">each month</span>
      </span>
      <span className="lts-value">
        {negative && <Icon icon={TrendingDown} size={20} />}
        {formatMoney(plan.leftToSpendCents)}
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

/** Income, Expenses (bills, subscriptions, liabilities), Left to spend, Savings, Spending, per month. */
export function MonthlyBreakdown({ plan }: { plan: MonthlyPlan }) {
  const out = (c: number) => (c === 0 ? formatMoney(0) : `−${formatMoney(c)}`);
  return (
    <section className="stack-sm" aria-labelledby="breakdown-month">
      <SectionLabel id="breakdown-month">Monthly breakdown</SectionLabel>
      <div className="card">
        <dl className="breakdown">
          <Row label="Income" value={formatSignedMoney(plan.incomeCents)} tone="in" />
          <Row label="Expenses" value={out(plan.expensesCents)} tone="out" />
          <Row label="Bills" value={formatMoney(plan.byKind.bill)} level={1} />
          <Row label="Subscriptions" value={formatMoney(plan.byKind.subscription)} level={1} />
          <Row label="Liability payments" value={formatMoney(plan.byKind.liability)} level={1} />
          <Row label="Left to spend" value={formatMoney(plan.leftToSpendCents)} tone={plan.leftToSpendCents < 0 ? 'neg' : undefined} strong />
          <Row label="Savings" value={formatMoney(plan.savingsCents)} />
          <Row label="Spending" value={formatMoney(plan.spendingCents)} />
        </dl>
        <p className="hint">Left to spend is income minus expenses. Savings and spending come out of what’s left to spend.</p>
        <p className="hint">
          Amounts are monthly averages, so items on different schedules add up. For example, a paycheck every 2 weeks counts as 26 paychecks over 12 months.
        </p>
      </div>
    </section>
  );
}

/** Monthly totals per tag the user created. Hidden when there are no tags. */
export function TagBreakdown({ plan }: { plan: MonthlyPlan }) {
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
        <p className="hint">Per month. An item with more than one tag counts toward each of its tags.</p>
      </div>
    </section>
  );
}
