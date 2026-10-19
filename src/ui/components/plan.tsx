import { Tag, TrendingDown } from 'lucide-react';
import { formatRange } from '../../domain/dates';
import { formatMoney, formatSignedMoney } from '../../domain/money';
import type { PeriodPlan } from '../../domain/plan';
import type { TransactionKind } from '../../domain/types';
import { Icon, SectionLabel } from './common';

/** The single headline number for a period: available cash flow (income minus spending and money set aside). */
export function CashFlowBanner({ plan }: { plan: PeriodPlan | null }) {
  const negative = plan !== null && plan.cashFlowCents < 0;
  return (
    <div className={`left-to-spend${negative ? ' negative' : ''}`} role="status" aria-live="polite">
      <span className="lts-label">
        Cash flow
        <span className="lts-sub">{plan ? `First pay period · ${formatRange(plan.start, plan.end)}` : 'Add income to see this'}</span>
      </span>
      <span className="lts-value">
        {negative && <Icon icon={TrendingDown} size={20} />}
        {plan ? formatSignedMoney(plan.cashFlowCents) : '—'}
      </span>
    </div>
  );
}

function Row({ label, value, tone, level = 0, strong = false }: { label: string; value: string; tone?: 'in' | 'out' | 'reserve' | 'neg'; level?: 0 | 1; strong?: boolean }) {
  return (
    <div className={`breakdown-row${level ? ' sub' : ''}${strong ? ' strong' : ''}`}>
      <dt>{label}</dt>
      <dd className={tone === 'in' ? 'amount-in' : tone === 'out' ? 'amount-out' : tone === 'reserve' ? 'amount-reserve' : tone === 'neg' ? 'negative-text' : ''}>{value}</dd>
    </div>
  );
}

const OUTFLOW_ROWS: [Exclude<TransactionKind, 'income' | 'reserve'>, string][] = [
  ['bill', 'Bills'],
  ['subscription', 'Subscriptions'],
  ['liability', 'Liability payments'],
  ['varied', 'Varied spending'],
];

/**
 * Income, spending by classification, Strategic Reserves, and cash flow for a
 * period. Reserves are their own line: money set aside, never spending.
 * Classifications with nothing in the period are left out.
 */
export function PeriodBreakdown({ plan, title, showRange = true }: { plan: PeriodPlan; title: string; showRange?: boolean }) {
  const rows = OUTFLOW_ROWS.filter(([kind]) => plan.byKind[kind] > 0);
  return (
    <section className="stack-sm" aria-labelledby="breakdown-period">
      <SectionLabel id="breakdown-period">{title}</SectionLabel>
      <div className="card">
        {showRange && <p className="hint">{formatRange(plan.start, plan.end)}</p>}
        <dl className="breakdown">
          <Row label="Income" value={formatSignedMoney(plan.incomeCents)} tone="in" />
          <Row label="Spending" value={plan.outflowCents ? `−${formatMoney(plan.outflowCents)}` : formatMoney(0)} tone="out" />
          {rows.map(([kind, label]) => (
            <Row key={kind} label={label} value={formatMoney(plan.byKind[kind])} level={1} />
          ))}
          {plan.reservesCents !== 0 && <Row label={plan.reservesCents > 0 ? 'Set aside in reserves' : 'Used from reserves'} value={formatSignedMoney(-plan.reservesCents)} tone="reserve" />}
          <Row label="Cash flow" value={formatSignedMoney(plan.cashFlowCents)} tone={plan.cashFlowCents < 0 ? 'neg' : undefined} strong />
        </dl>
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
