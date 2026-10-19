import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { addMonthsClamped, endOfMonth, formatMonthYear, formatRange, formatShort, startOfMonth, type DateStr } from '../../domain/dates';
import { buildForecast } from '../../domain/forecast';
import { formatMoney, formatSignedMoney } from '../../domain/money';
import { activityView, type ActivityItem } from '../../domain/activity';
import { KINDS, KIND_LABEL, type TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { FlowAmount, Icon, KindAvatar, KindTag, SectionLabel, StatusBadge } from '../components/common';
import { PeriodNav } from '../components/entries';
import { OccurrenceSheet } from '../components/OccurrenceSheet';
import { PeriodBreakdown, TagBreakdown } from '../components/plan';

type Sheet = { kind: 'occurrence'; id: string };

const KIND_FILTERS: TransactionKind[] = KINDS;

export function Activity() {
  const { data, today } = useStore();
  const [monthOf, setMonthOf] = useState<DateStr>(today);
  const [kindFilter, setKindFilter] = useState<TransactionKind | undefined>(undefined);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const start = startOfMonth(monthOf);
  const end = endOfMonth(monthOf);

  const view = useMemo(() => {
    const forecast = buildForecast(data, today, { through: end });
    return activityView(forecast, start, end, kindFilter);
  }, [data, today, start, end, kindFilter]);

  const prev = () => setMonthOf(addMonthsClamped(monthOf, -1));
  const next = () => setMonthOf(addMonthsClamped(monthOf, 1));
  const isCurrent = startOfMonth(today) === start;

  return (
    <div className="activity stack-lg">
      <header className="screen-header">
        <h1>Activity</h1>
      </header>

      <PeriodNav
        label={formatMonthYear(start)}
        prevLabel="Previous month"
        nextLabel="Next month"
        onPrev={prev}
        onNext={isCurrent ? undefined : next}
        onToday={isCurrent ? undefined : () => setMonthOf(today)}
      />

      {view.totalCount === 0 ? (
        <EmptyMonth start={start} end={end} hasAnyRecords={data.records.some((r) => r.status === 'completed')} />
      ) : (
        <>
          <RecordedSummary receivedCents={view.summary.incomeCents} paidCents={view.summary.outflowCents} cashFlowCents={view.summary.cashFlowCents} />
          <PeriodBreakdown plan={view.summary} title="By kind" showRange={false} recorded />
          <TagBreakdown plan={view.summary} />

          <section className="stack-sm" aria-labelledby="activity-list-heading">
            <SectionLabel
              id="activity-list-heading"
              action={
                <KindFilterChips
                  active={kindFilter}
                  onChange={(k) => setKindFilter(k === kindFilter ? undefined : k)}
                  byKind={view.summary.byKind}
                />
              }
            >
              Recorded
            </SectionLabel>
            {view.items.length === 0 && kindFilter ? (
              <p className="muted center">No {KIND_LABEL[kindFilter].toLowerCase()} items recorded this month.</p>
            ) : (
              <ul className="entry-list card">
                {view.items.map((item) => (
                  <li key={item.entry.occurrence.id}>
                    <ActivityRow item={item} onOpen={(id) => setSheet({ kind: 'occurrence', id })} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {sheet?.kind === 'occurrence' && <OccurrenceSheet occurrenceId={sheet.id} onClose={() => setSheet(null)} />}
    </div>
  );
}

function RecordedSummary({ receivedCents, paidCents, cashFlowCents }: { receivedCents: number; paidCents: number; cashFlowCents: number }) {
  return (
    <section className="card activity-summary" aria-label="Month summary">
      <dl className="activity-kpis">
        <div className="activity-kpi">
          <dt>Received</dt>
          <dd className="amount-in">{formatSignedMoney(receivedCents)}</dd>
        </div>
        <div className="activity-kpi">
          <dt>Paid</dt>
          <dd className="amount-out">{paidCents ? `−${formatMoney(paidCents)}` : formatMoney(0)}</dd>
        </div>
        <div className="activity-kpi">
          <dt>Cash flow</dt>
          <dd className={cashFlowCents < 0 ? 'negative-text' : ''}>{formatSignedMoney(cashFlowCents)}</dd>
        </div>
      </dl>
    </section>
  );
}

function KindFilterChips({
  active,
  onChange,
  byKind,
}: {
  active: TransactionKind | undefined;
  onChange: (kind: TransactionKind) => void;
  byKind: Record<TransactionKind, number>;
}) {
  const visible = KIND_FILTERS.filter((k) => byKind[k] > 0 || (k === 'income' && byKind.income > 0));
  if (visible.length <= 1) return null;
  return (
    <div className="kind-chips" role="group" aria-label="Filter by kind">
      {visible.map((k) => (
        <button key={k} type="button" className={`chip${active === k ? ' active' : ''}`} onClick={() => onChange(k)} aria-pressed={active === k}>
          {KIND_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (id: string) => void }) {
  const e = item.entry;
  const o = e.occurrence;
  const v = item.variance;
  let sub: string | null = null;
  if (v && (v.amountCents !== 0 || v.days !== 0)) {
    sub = `Expected ${formatMoney(o.expectedAmountCents)} on ${formatShort(o.expectedDate)}`;
  }
  return (
    <button type="button" className="entry" onClick={() => onOpen(o.id)}>
      <KindAvatar kind={o.kind} />
      <span className="entry-main">
        <span className="entry-title">{o.description}</span>
        <span className="entry-tags">
          <KindTag kind={o.kind} />
          <StatusBadge status={o.displayStatus} kind={o.kind} release={o.release} />
        </span>
        {sub && <span className="entry-sub">{sub}</span>}
      </span>
      <span className="entry-side">
        <FlowAmount kind={o.kind} cents={e.amountCents} release={o.release} />
        <Icon icon={ChevronRight} size={18} className="chevron" />
      </span>
    </button>
  );
}

function EmptyMonth({ start, end, hasAnyRecords }: { start: DateStr; end: DateStr; hasAnyRecords: boolean }) {
  return <p className="muted center">{hasAnyRecords ? `Nothing recorded from ${formatRange(start, end)}.` : 'Payments you record show up here.'}</p>;
}
