import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { addMonthsClamped, endOfMonth, formatMonthYear, formatRange, formatShort, startOfMonth, type DateStr } from '../../domain/dates';
import { buildForecast, type ForecastEntry } from '../../domain/forecast';
import { formatMoney, formatSignedMoney } from '../../domain/money';
import type { PeriodPlan } from '../../domain/plan';
import { activityView, possibleEntries, recordedEntries, type ActivityItem } from '../../domain/activity';
import { earningsHistory, hasEarningsData } from '../../domain/earnings-history';
import { KINDS, KIND_LABEL, type TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { EmptyLine, FlowAmount, Icon, KindAvatar, KindTag, ListGroup, SectionLabel, StatusBadge } from '../components/common';
import { PeriodNav } from '../components/entries';
import { OccurrenceSheet } from '../components/OccurrenceSheet';
import { BreakdownRows, TagBreakdown } from '../components/plan';
import { EarningsSection } from '../components/earnings';
import { kindsWithActivity } from '../visibility';

type Sheet = { kind: 'occurrence'; id: string };

const KIND_FILTERS: TransactionKind[] = KINDS;

export function Activity() {
  const { data, today } = useStore();
  const [monthOf, setMonthOf] = useState<DateStr>(today);
  const [kindFilter, setKindFilter] = useState<TransactionKind | undefined>(undefined);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const start = startOfMonth(monthOf);
  const end = endOfMonth(monthOf);

  const forecast = useMemo(() => buildForecast(data, today, { through: end }), [data, today, end]);
  const view = useMemo(() => activityView(forecast, start, end, kindFilter), [forecast, start, end, kindFilter]);
  const possible = useMemo(() => possibleEntries(forecast, start, end), [forecast, start, end]);
  // Earnings appear only when shifts, sessions or jobs exist; "received" is the same recorded entries as the summary.
  const earnings = useMemo(
    () => (hasEarningsData(data) ? earningsHistory(data, recordedEntries(forecast, start, end), start, end, today) : null),
    [data, forecast, start, end, today],
  );

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
        <RecordedSummary summary={view.summary} />
      )}

      {earnings && <EarningsSection history={earnings} month={formatMonthYear(start)} />}

      {possible.length > 0 && <PossibleList entries={possible} onOpen={(id) => setSheet({ kind: 'occurrence', id })} />}

      {view.totalCount > 0 && (
        <>
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
              <EmptyLine>No {KIND_LABEL[kindFilter].toLowerCase()} items recorded this month.</EmptyLine>
            ) : (
              <ListGroup>
                {view.items.map((item) => (
                  <li key={item.entry.occurrence.id}>
                    <ActivityRow item={item} onOpen={(id) => setSheet({ kind: 'occurrence', id })} />
                  </li>
                ))}
              </ListGroup>
            )}
          </section>
        </>
      )}

      {sheet?.kind === 'occurrence' && <OccurrenceSheet occurrenceId={sheet.id} onClose={() => setSheet(null)} />}
    </div>
  );
}

/**
 * The month's one summary: recorded cash flow, then what was received, paid
 * and moved to or from reserves. Received and Paid show even at $0.00
 * (decision S2). The per-classification rows show only when
 * more than one classification has activity (decision S1), since otherwise
 * they repeat the total above them.
 */
function RecordedSummary({ summary }: { summary: PeriodPlan }) {
  return (
    <section className="card activity-summary" aria-label="Month summary">
      <p className="hero-label">
        Cash flow <span className="badge">Recorded</span>
      </p>
      <p className={`hero-value${summary.cashFlowCents < 0 ? ' negative' : ''}`}>{formatSignedMoney(summary.cashFlowCents)}</p>
      <BreakdownRows plan={summary} recorded total={false} byKind={kindsWithActivity(summary) > 1} />
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

/** Possible income in the month, not received: listed apart, never in a total (E1). */
function PossibleList({ entries, onOpen }: { entries: ForecastEntry[]; onOpen: (id: string) => void }) {
  return (
    <section className="stack-sm" aria-labelledby="activity-possible">
      <SectionLabel id="activity-possible">Possible</SectionLabel>
      <p className="hint">Income that may come. Not counted until you mark it expected or record it.</p>
      <ListGroup>
        {entries.map((e) => (
          <li key={e.occurrence.id}>
            <button type="button" className="entry" onClick={() => onOpen(e.occurrence.id)}>
              <KindAvatar kind="income" />
              <span className="entry-main">
                <span className="entry-title">{e.occurrence.description}</span>
                <span className="entry-tags">
                  <StatusBadge status={e.occurrence.displayStatus} kind="income" possible />
                </span>
                <span className="entry-sub">{formatShort(e.date)}</span>
              </span>
              <span className="entry-side">
                <FlowAmount kind="income" cents={e.amountCents} possible />
                <Icon icon={ChevronRight} size={18} className="chevron" />
              </span>
            </button>
          </li>
        ))}
      </ListGroup>
    </section>
  );
}

function EmptyMonth({ start, end, hasAnyRecords }: { start: DateStr; end: DateStr; hasAnyRecords: boolean }) {
  return <EmptyLine>{hasAnyRecords ? `Nothing recorded from ${formatRange(start, end)}.` : 'Payments you record show up here.'}</EmptyLine>;
}
