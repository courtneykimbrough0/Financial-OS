import { AlertCircle, ChevronRight, CircleCheck, CircleOff, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, formatMedium, type DateStr } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import { resolveOccurrences } from '../../domain/occurrences';
import * as ops from '../../domain/operations';
import { describeRule } from '../../domain/recurrence';
import { liabilityPrefix, mainPaycheckId, type AppData, type Occurrence, type RecurringSource, type TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { EmptyState, FlowAmount, Icon, KindAvatar, Modal, SectionLabel, StatusBadge, TagList, useToast } from '../components/common';
import { KIND_COPY, MainPaycheckPicker, nextScheduledDate, OneTimeForm, ReactivateForm, SourceForm } from '../components/forms';
import { OccurrenceSheet } from '../components/OccurrenceSheet';

const SCREEN_COPY: Record<
  TransactionKind,
  { title: string; intro: string; recurringHeading: string; addRecurring: string; empty: string; oneTime: { heading: string; empty: string } | null }
> = {
  income: {
    title: 'Income',
    intro: 'Money you expect to receive, like wages or benefits.',
    recurringHeading: 'Recurring income',
    addRecurring: 'Add recurring income',
    empty: 'Add a paycheck or other regular income to start your forecast.',
    oneTime: { heading: 'One-time income', empty: 'Add things like a tax refund or a gift. They count once.' },
  },
  bill: {
    title: 'Bills',
    intro: 'Regular bills like rent, utilities, phone, and insurance.',
    recurringHeading: 'Recurring bills',
    addRecurring: 'Add bill',
    empty: 'Add regular bills like rent, utilities, phone, or insurance.',
    oneTime: { heading: 'One-time expenses', empty: 'Add a bill that happens once, like a medical bill. It counts once.' },
  },
  subscription: {
    title: 'Subscriptions',
    intro: 'Services that charge you on a schedule.',
    recurringHeading: 'Subscriptions',
    addRecurring: 'Add subscription',
    empty: 'Add streaming services, apps, and memberships that renew on a schedule.',
    oneTime: null,
  },
  liability: {
    title: 'Liabilities',
    intro: 'Regular payments on things you owe, like a car loan, student loan, or credit card. Each payment counts once as money going out.',
    recurringHeading: 'Liability payments',
    addRecurring: 'Add liability payment',
    empty: 'Add payments like a car loan, student loan, or credit card payment.',
    oneTime: null,
  },
  savings: {
    title: 'Savings',
    intro: 'Money you plan to set aside on a schedule. It counts as an expense.',
    recurringHeading: 'Recurring savings',
    addRecurring: 'Add savings',
    empty: 'Add regular amounts you set aside, like an emergency fund.',
    oneTime: { heading: 'One-time savings', empty: 'Add a single deposit you plan to make. It counts once.' },
  },
};

/**
 * Occurrences of one source from the last 60 days through the next 90 days,
 * plus any older ones that are still overdue.
 */
function sourceOccurrences(data: AppData, source: RecurringSource, today: DateStr): Occurrence[] {
  const from = addDays(today, -60);
  const to = addDays(today, 90);
  const inWindow = (d: DateStr | null) => d !== null && d >= from && d <= to;
  return sourceHistory(data, source, today, to)
    .filter((o) => inWindow(o.scheduledDate) || inWindow(o.actualDate) || o.displayStatus === 'overdue')
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : a.scheduledDate > b.scheduledDate ? 1 : 0));
}

function sourceHistory(data: AppData, source: RecurringSource, today: DateStr, to: DateStr): Occurrence[] {
  const first = source.versions[0]!.startDate;
  return resolveOccurrences({ ...data, sources: [source] }, first < today ? first : today, to, today).filter((o) => o.sourceId === source.id);
}

function OccurrenceRow({ o, onOpen }: { o: Occurrence; onOpen: (id: string) => void }) {
  const amount = o.status === 'completed' ? o.actualAmountCents! : o.scheduledAmountCents;
  const date = o.status === 'completed' ? o.actualDate! : o.scheduledDate;
  return (
    <button type="button" className="entry" onClick={() => onOpen(o.id)}>
      <KindAvatar kind={o.kind} size="sm" />
      <span className="entry-main">
        <span className="entry-title">{formatMedium(date)}</span>
        {o.sourceId === null && <span className="entry-sub">{o.description}</span>}
        {o.status === 'completed' && (o.actualAmountCents !== o.expectedAmountCents || o.actualDate !== o.expectedDate) && (
          <span className="entry-sub">
            Expected {formatMoney(o.expectedAmountCents)} on {formatMedium(o.expectedDate)}
          </span>
        )}
      </span>
      <span className="entry-side">
        <FlowAmount kind={o.kind} cents={amount} strike={o.status === 'canceled'} />
        <StatusBadge status={o.displayStatus} kind={o.kind} />
      </span>
      <Icon icon={ChevronRight} size={18} className="chevron" />
    </button>
  );
}

function SourceCard({ source, onEdit, onOpen }: { source: RecurringSource; onEdit: () => void; onOpen: (id: string) => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const current = source.versions[source.versions.length - 1]!;
  const occurrences = useMemo(() => (expanded ? sourceOccurrences(data, source, today) : []), [expanded, data, source, today]);
  const overdueCount = useMemo(
    () => sourceHistory(data, source, today, today).filter((o) => o.displayStatus === 'overdue').length,
    [data, source, today],
  );
  const next = source.active ? nextScheduledDate(source, today) : null;
  const pending = source.versions.filter((v) => v.startDate > today);
  const upcomingChange = pending.length > 0 && source.versions.length > 1 ? pending[0] : null;

  return (
    <li className={`card source-card${source.active ? '' : ' inactive'}`}>
      <div className="source-top">
        <KindAvatar kind={source.kind} />
        <div className="source-name">
          <h3>{source.description}</h3>
          <p className="muted">
            {liabilityPrefix(source)}
            {describeRule(current.rule, current.startDate)}
          </p>
          {source.id === mainPaycheckId(data) && <span className="badge badge-main">Main paycheck</span>}
          <TagList tags={source.tags} />
        </div>
        <div className="source-amount">
          <FlowAmount kind={source.kind} cents={current.amountCents} />
          {source.active ? (
            <span className="badge badge-active">
              <Icon icon={CircleCheck} size={13} /> On
            </span>
          ) : (
            <span className="badge badge-canceled">
              <Icon icon={CircleOff} size={13} /> Off
            </span>
          )}
        </div>
      </div>
      <p>
        {source.active ? (
          next ? (
            <>
              Next: <strong>{formatMedium(next)}</strong>
            </>
          ) : (
            'No upcoming dates'
          )
        ) : (
          `Turned off ${source.endDate ? `on ${formatMedium(source.endDate)}` : ''}. Not included in future forecasts.`
        )}
      </p>
      {upcomingChange && (
        <p className="hint">
          Scheduled change: {formatMoney(upcomingChange.amountCents)}, {describeRule(upcomingChange.rule, upcomingChange.startDate).toLowerCase()}, starting {formatMedium(upcomingChange.startDate)}.
        </p>
      )}
      {overdueCount > 0 && (
        <p className="callout callout-warn small">
          <Icon icon={AlertCircle} size={16} /> 
          {overdueCount} overdue {overdueCount === 1 ? 'payment needs' : 'payments need'} an update.
        </p>
      )}
      <div className="card-actions">
        <button type="button" className="button small secondary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide dates' : 'See dates'}
        </button>
        <button type="button" className="button small secondary" onClick={onEdit}>
          Edit
        </button>
        {source.active ? (
          <button type="button" className="button small secondary" onClick={() => setConfirmOff(true)}>
            Turn off
          </button>
        ) : (
          <button type="button" className="button small secondary" onClick={() => setReactivating(true)}>
            Turn on
          </button>
        )}
      </div>
      {expanded && (
        <div className="source-occurrences">
          <p className="hint">Last 60 days and next 90 days. Select one to record what happened or change just that date.</p>
          {occurrences.length === 0 ? (
            <p className="muted">No dates in this window.</p>
          ) : (
            <ul className="entry-list">
              {occurrences.map((o) => (
                <li key={o.id}>
                  <OccurrenceRow o={o} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {confirmOff && (
        <Modal title={`Turn off ${source.description}?`} onClose={() => setConfirmOff(false)}>
          <div className="stack">
            <p>It will stop appearing in your forecast from today. Everything you’ve already recorded stays, and any overdue payments stay visible until you update them.</p>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setConfirmOff(false)} data-autofocus>
                Keep it on
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  const r = run((d, c) => ops.deactivateSource(d, source.id, c));
                  setConfirmOff(false);
                  if (r.ok) toast(`${source.description} turned off.`);
                  else toast(r.error, 'error');
                }}
              >
                Turn off
              </button>
            </div>
          </div>
        </Modal>
      )}
      {reactivating && (
        <Modal title={`Turn on ${source.description}`} onClose={() => setReactivating(false)}>
          <ReactivateForm source={source} onDone={() => setReactivating(false)} />
        </Modal>
      )}
    </li>
  );
}

/** One kind's list. `embedded` drops the screen header when shown inside another screen's tabs. */
export function SourcesScreen({ kind, embedded = false }: { kind: TransactionKind; embedded?: boolean }) {
  const { data, today } = useStore();
  const copy = SCREEN_COPY[kind];
  const [adding, setAdding] = useState<'recurring' | 'one-time' | null>(null);
  const [editing, setEditing] = useState<RecurringSource | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);

  const sources = data.sources.filter((s) => s.kind === kind).sort((a, b) => Number(b.active) - Number(a.active) || a.description.localeCompare(b.description));
  const oneTimes = data.records
    .filter((r) => r.sourceId === null && r.kind === kind)
    .map((r) => ({ ...r, displayStatus: r.status === 'scheduled' && r.scheduledDate < today ? ('overdue' as const) : r.status, virtual: false }))
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1));
  const upcomingOneTimes = oneTimes.filter((o) => o.status === 'scheduled').reverse();
  const pastOneTimes = oneTimes.filter((o) => o.status !== 'scheduled');

  return (
    <div className="stack-lg">
      {embedded ? (
        <p className="muted center">{copy.intro}</p>
      ) : (
        <header className="screen-header">
          <h1>{copy.title}</h1>
          <p className="muted">{copy.intro}</p>
        </header>
      )}

      <section className="stack" aria-labelledby="recurring-heading">
        <SectionLabel
          id="recurring-heading"
          action={
            <button type="button" className="button primary small" onClick={() => setAdding('recurring')}>
              <Icon icon={Plus} size={16} /> {copy.addRecurring}
            </button>
          }
        >
          {copy.recurringHeading}
        </SectionLabel>
        {kind === 'income' && <MainPaycheckPicker />}
        {sources.length === 0 ? (
          <EmptyState title={`No ${copy.recurringHeading.toLowerCase()} yet`}>
            <p>{copy.empty}</p>
          </EmptyState>
        ) : (
          <ul className="card-list">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} onEdit={() => setEditing(s)} onOpen={setSheetId} />
            ))}
          </ul>
        )}
      </section>

      {copy.oneTime && (
        <section className="stack" aria-labelledby="onetime-heading">
          <SectionLabel
            id="onetime-heading"
            action={
              <button type="button" className="button secondary small" onClick={() => setAdding('one-time')}>
                <Icon icon={Plus} size={16} /> Add one-time
              </button>
            }
          >
            {copy.oneTime.heading}
          </SectionLabel>
          {oneTimes.length === 0 ? (
            <EmptyState title="Nothing one-time yet">
              <p>{copy.oneTime.empty}</p>
            </EmptyState>
          ) : (
            <>
              {upcomingOneTimes.length > 0 && (
                <>
                  <h3 className="subhead">Expected</h3>
                  <ul className="entry-list card">
                    {upcomingOneTimes.map((o) => (
                      <li key={o.id}>
                        <OccurrenceRow o={o} onOpen={setSheetId} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {pastOneTimes.length > 0 && (
                <>
                  <h3 className="subhead">Recorded or canceled</h3>
                  <ul className="entry-list card">
                    {pastOneTimes.map((o) => (
                      <li key={o.id}>
                        <OccurrenceRow o={o} onOpen={setSheetId} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}

      {adding === 'recurring' && (
        <Modal title={copy.addRecurring} onClose={() => setAdding(null)}>
          <SourceForm kind={kind} onDone={() => setAdding(null)} />
        </Modal>
      )}
      {adding === 'one-time' && kind !== 'subscription' && kind !== 'liability' && (
        <Modal title={`Add one-time ${KIND_COPY[kind].noun}`} onClose={() => setAdding(null)}>
          <OneTimeForm kind={kind} onDone={() => setAdding(null)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.description}`} onClose={() => setEditing(null)}>
          <SourceForm kind={kind} source={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {sheetId && <OccurrenceSheet occurrenceId={sheetId} onClose={() => setSheetId(null)} />}
    </div>
  );
}

const EXPENSE_TABS: { kind: TransactionKind; label: string }[] = [
  { kind: 'bill', label: 'Bills' },
  { kind: 'subscription', label: 'Subscriptions' },
  { kind: 'savings', label: 'Savings' },
];

/** Expenses screen: bills, subscriptions, and savings, one pill tab each. Liabilities have their own screen. */
export function ExpensesScreen({ initial = 'bill' }: { initial?: TransactionKind }) {
  const [tab, setTab] = useState<TransactionKind>(initial);
  return (
    <div className="stack-lg">
      <header className="screen-header">
        <h1>Expenses</h1>
      </header>
      <div className="pill-tabs pill-tabs-3" role="tablist" aria-label="Expense type">
        {EXPENSE_TABS.map((t) => (
          <button key={t.kind} type="button" role="tab" id={`expense-tab-${t.kind}`} aria-selected={tab === t.kind} aria-controls="expense-panel" className={tab === t.kind ? 'active' : ''} onClick={() => setTab(t.kind)}>
            {t.label}
          </button>
        ))}
      </div>
      <div id="expense-panel" role="tabpanel" aria-labelledby={`expense-tab-${tab}`}>
        <SourcesScreen key={tab} kind={tab} embedded />
      </div>
    </div>
  );
}
