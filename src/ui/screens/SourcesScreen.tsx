import { ChevronRight, CircleOff, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, formatMedium, formatShort, type DateStr } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import { deriveStatus, resolveOccurrences } from '../../domain/occurrences';
import * as ops from '../../domain/operations';
import { describeRule } from '../../domain/recurrence';
import { incomeTypePrefix, isUncountedPossible, liabilityPrefix, ONE_TIME_KINDS, RECURRING_KINDS, type AppData, type OneTimeKind, type Occurrence, type RecurringKind, type RecurringSource, type TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { EmptyLine, FlowAmount, ListGroup, Icon, KindAvatar, Modal, SectionLabel, StatusBadge, TagList, useToast } from '../components/common';
import { KIND_COPY, nextScheduledDate, OneTimeForm, ReactivateForm, SourceForm, useIncomeDetailAvailable } from '../components/forms';
import { ShiftSheet, ShiftsSection } from '../components/shifts';
import { EstimateCallout, EstimateSheet, useEstimateSuggestion } from '../components/EstimateSheet';
import { OccurrenceSheet } from '../components/OccurrenceSheet';
import { AccountLabel } from '../components/money-accounts';

const isRecurringKind = (k: TransactionKind): k is RecurringKind => (RECURRING_KINDS as readonly string[]).includes(k);
const isOneTimeKind = (k: TransactionKind): k is OneTimeKind => (ONE_TIME_KINDS as readonly string[]).includes(k);

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
    oneTime: null,
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
  reserve: {
    title: 'Strategic Reserves',
    intro: "Money you save on purpose and keep. It lowers what's available to spend, and it stays yours.",
    recurringHeading: 'Recurring reserves',
    addRecurring: 'Add reserve',
    empty: 'Add amounts you save regularly, like an emergency fund.',
    oneTime: { heading: 'One-time reserves', empty: 'Save a single amount, or use some of your reserves. It counts once.' },
  },
  varied: {
    title: 'Varied spending',
    intro: 'Spending that happens once, like a car repair or a gift.',
    recurringHeading: '',
    addRecurring: '',
    empty: '',
    oneTime: { heading: 'Varied spending', empty: 'Add spending that happens once, like a car repair. It counts once.' },
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
        {o.sourceId === null && <AccountLabel accountId={o.accountId} />}
        {o.status === 'completed' && (o.actualAmountCents !== o.expectedAmountCents || o.actualDate !== o.expectedDate) && (
          <span className="entry-sub">
            Expected {formatMoney(o.expectedAmountCents)} on {formatMedium(o.expectedDate)}
          </span>
        )}
      </span>
      <span className="entry-side">
        <FlowAmount kind={o.kind} cents={amount} strike={o.status === 'canceled'} release={o.release} possible={isUncountedPossible(o)} />
        <StatusBadge status={o.displayStatus} kind={o.kind} release={o.release} possible={isUncountedPossible(o)} />
      </span>
      <Icon icon={ChevronRight} size={18} className="chevron" />
    </button>
  );
}

/** Where an item stands: overdue first, then its next date, or when it was turned off. */
function itemStatus(data: AppData, source: RecurringSource, today: DateStr): { text: string; overdue: boolean } {
  const overdue = sourceHistory(data, source, today, today)
    .filter((o) => o.displayStatus === 'overdue')
    .map((o) => o.scheduledDate)
    .sort()[0];
  if (overdue) return { text: `Overdue since ${formatShort(overdue)}`, overdue: true };
  if (!source.active) return { text: source.endDate ? `Off since ${formatShort(source.endDate)}` : 'Off', overdue: false };
  const next = nextScheduledDate(source, today);
  return { text: next ? `Next ${formatShort(next)}` : 'No upcoming dates', overdue: false };
}

/** One recurring item: a single row that opens its sheet. Only "Off" is marked; active is the normal state. */
function SourceRow({ source, onOpen }: { source: RecurringSource; onOpen: () => void }) {
  const { data, today } = useStore();
  const [reviewingEstimate, setReviewingEstimate] = useState(false);
  const suggestion = useEstimateSuggestion(source);
  const current = source.versions[source.versions.length - 1]!;
  const status = itemStatus(data, source, today);
  return (
    <li className={`source-card${source.active ? '' : ' inactive'}`}>
      <button type="button" className="entry source-row" onClick={onOpen} aria-haspopup="dialog">
        <KindAvatar kind={source.kind} />
        <span className="entry-main">
          <span className="entry-title">{source.description}</span>
          <span className="entry-sub">
            {liabilityPrefix(source)}
            {incomeTypePrefix(source)}
            {describeRule(current.rule, current.startDate)} · <span className={status.overdue ? 'overdue-text' : undefined}>{status.text}</span>
          </span>
          <TagList tags={source.tags} />
          <AccountLabel accountId={source.accountId} />
        </span>
        <span className="entry-side">
          <FlowAmount kind={source.kind} cents={current.amountCents} possible={source.certainty === 'possible'} />
          {source.certainty === 'possible' && <StatusBadge status="scheduled" possible />}
          {!source.active && (
            <span className="badge badge-canceled">
              <Icon icon={CircleOff} size={13} /> Off
            </span>
          )}
        </span>
        <Icon icon={ChevronRight} size={18} className="chevron" />
      </button>
      {suggestion && <EstimateCallout suggestion={suggestion} onOpen={() => setReviewingEstimate(true)} />}
      {reviewingEstimate && <EstimateSheet sourceId={source.id} onClose={() => setReviewingEstimate(false)} />}
    </li>
  );
}

/**
 * An item's sheet: its schedule, recent and upcoming dates, and what can be
 * done with it. One dialog at a time: confirmations replace the sheet and
 * return to it.
 */
function ItemSheet({ source, onClose, onOpenDate, onEdit }: { source: RecurringSource; onClose: () => void; onOpenDate: (id: string) => void; onEdit: () => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'turn-off' | 'turn-on' | 'delete'>('view');
  // A shift sheet replaces this one and returns to it: 'new' to log one, or a shift's id.
  const [shiftSheet, setShiftSheet] = useState<string | null>(null);
  const shiftsShown = useIncomeDetailAvailable() && source.kind === 'income' && !!source.incomeType;
  const current = source.versions[source.versions.length - 1]!;
  const occurrences = useMemo(() => sourceOccurrences(data, source, today), [data, source, today]);
  const pending = source.versions.filter((v) => v.startDate > today);
  const upcomingChange = pending.length > 0 && source.versions.length > 1 ? pending[0] : null;
  const deletable = !data.records.some((r) => r.sourceId === source.id) && !(data.workEntries ?? []).some((e) => e.sourceId === source.id);
  const status = itemStatus(data, source, today);
  const name = source.description;

  if (shiftSheet !== null) return <ShiftSheet source={source} shiftId={shiftSheet === 'new' ? null : shiftSheet} onDone={() => setShiftSheet(null)} />;
  if (mode === 'turn-off')
    return (
      <Modal title={`Turn off ${name}?`} onClose={() => setMode('view')}>
        <div className="stack">
          <p>It leaves your forecast from today. Payments you've recorded stay.</p>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMode('view')} data-autofocus>
              Keep it on
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => {
                const r = run((d, c) => ops.deactivateSource(d, source.id, c));
                setMode('view');
                if (r.ok) toast(`${name} turned off.`);
                else toast(r.error, 'error');
              }}
            >
              Turn off
            </button>
          </div>
        </div>
      </Modal>
    );
  if (mode === 'turn-on')
    return (
      <Modal title={`Turn on ${name}`} onClose={() => setMode('view')}>
        <ReactivateForm source={source} onDone={() => setMode('view')} />
      </Modal>
    );
  if (mode === 'delete')
    return (
      <Modal title={`Delete ${name}?`} onClose={() => setMode('view')}>
        <div className="stack">
          <p>It leaves your plan and your forecast.</p>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMode('view')} data-autofocus>
              Keep it
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => {
                const r = run((d) => ops.deleteSource(d, source.id));
                if (r.ok) {
                  toast(`Deleted ${name}.`);
                  onClose();
                } else {
                  toast(r.error, 'error');
                  setMode('view');
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    );

  return (
    <Modal title={name} onClose={onClose}>
      <div className="stack">
        <p>
          <FlowAmount kind={source.kind} cents={current.amountCents} /> · {liabilityPrefix(source)}
          {incomeTypePrefix(source)}
          {describeRule(current.rule, current.startDate)}
        </p>
        <p className={status.overdue ? 'overdue-text' : 'muted'}>{status.text}</p>
        {upcomingChange && (
          <p className="hint">
            Scheduled change: {formatMoney(upcomingChange.amountCents)}, {describeRule(upcomingChange.rule, upcomingChange.startDate).toLowerCase()}, starting {formatMedium(upcomingChange.startDate)}.
          </p>
        )}
        {shiftsShown && <ShiftsSection source={source} onLog={() => setShiftSheet('new')} onOpen={setShiftSheet} />}
        {occurrences.length > 0 && (
          <section className="stack-sm" aria-labelledby="item-dates">
            <SectionLabel id="item-dates">Recent and upcoming dates</SectionLabel>
            <ul className="entry-list">
              {occurrences.map((o) => (
                <li key={o.id}>
                  <OccurrenceRow o={o} onOpen={onOpenDate} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="card-actions">
          <button type="button" className="button small primary" onClick={onEdit}>
            Edit
          </button>
          {source.active ? (
            <button type="button" className="button small secondary" onClick={() => setMode('turn-off')}>
              Turn off
            </button>
          ) : (
            <button type="button" className="button small secondary" onClick={() => setMode('turn-on')}>
              Turn on
            </button>
          )}
          {deletable && (
            <button type="button" className="button small danger-link" onClick={() => setMode('delete')}>
              Delete
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** One kind's list. `embedded` drops the screen header when shown inside another screen's tabs. */
export function SourcesScreen({ kind, embedded = false }: { kind: TransactionKind; embedded?: boolean }) {
  const { data, today } = useStore();
  const copy = SCREEN_COPY[kind];
  const recurring = isRecurringKind(kind);
  const [adding, setAdding] = useState<'recurring' | 'one-time' | null>(null);
  const [editing, setEditing] = useState<RecurringSource | null>(null);
  // A date opened from an item's sheet returns to that sheet when closed.
  const [sheet, setSheet] = useState<{ kind: 'item'; id: string } | { kind: 'occurrence'; id: string; back: string | null } | null>(null);
  const openOccurrence = (id: string) => setSheet({ kind: 'occurrence', id, back: null });
  const itemSource = sheet?.kind === 'item' ? data.sources.find((s) => s.id === sheet.id) : undefined;

  const sources = data.sources.filter((s) => s.kind === kind).sort((a, b) => Number(b.active) - Number(a.active) || a.description.localeCompare(b.description));
  // Cash tips logged with a shift are listed with the shift, not here (they still count wherever money received is shown).
  const shiftTips = new Set((data.workEntries ?? []).map((e) => e.cashTipsRecordId));
  const oneTimes = data.records
    .filter((r) => r.sourceId === null && r.kind === kind && !shiftTips.has(r.id))
    .map((r) => ({ ...r, displayStatus: deriveStatus(r, today), virtual: false }))
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1));
  const upcomingOneTimes = oneTimes.filter((o) => o.status === 'scheduled').reverse();
  const pastOneTimes = oneTimes.filter((o) => o.status !== 'scheduled');
  const showIntro = embedded && sources.length === 0 && oneTimes.length === 0;
  // A recurring kind's one-time list appears once it has items; until then its Add sits beside the recurring one.
  const showOneTimeList = copy.oneTime !== null && (!recurring || oneTimes.length > 0);
  const addOneTime = (
    <button type="button" className="button secondary small" onClick={() => setAdding('one-time')}>
      <Icon icon={Plus} size={16} /> {recurring ? 'Add one-time' : 'Add spending'}
    </button>
  );

  return (
    <div className="stack-lg">
      {showIntro ? (
        <p className="muted center">{copy.intro}</p>
      ) : embedded ? null : (
        <header className="screen-header">
          <h1>{copy.title}</h1>
          <p className="muted">{copy.intro}</p>
        </header>
      )}

      {recurring && (
        <section className="stack" aria-labelledby="recurring-heading">
          <SectionLabel
            id="recurring-heading"
            action={
              <span className="section-actions">
                <button type="button" className="button primary small" onClick={() => setAdding('recurring')}>
                  <Icon icon={Plus} size={16} /> {copy.addRecurring}
                </button>
                {copy.oneTime && !showOneTimeList && addOneTime}
              </span>
            }
          >
            {copy.recurringHeading}
          </SectionLabel>
          {sources.length === 0 ? (
            showIntro ? null : <EmptyLine>{copy.empty}</EmptyLine>
          ) : (
            <ListGroup className="source-list">
              {sources.map((s) => (
                <SourceRow key={s.id} source={s} onOpen={() => setSheet({ kind: 'item', id: s.id })} />
              ))}
            </ListGroup>
          )}
        </section>
      )}

      {copy.oneTime && showOneTimeList && (
        <section className="stack" aria-labelledby="onetime-heading">
          <SectionLabel id="onetime-heading" action={addOneTime}>
            {copy.oneTime.heading}
          </SectionLabel>
          {oneTimes.length === 0 ? (
            showIntro ? null : <EmptyLine>{copy.oneTime.empty}</EmptyLine>
          ) : (
            <>
              {upcomingOneTimes.length > 0 && (
                <>
                  <h3 className="subhead">{upcomingOneTimes.some(isUncountedPossible) ? 'Expected and possible' : 'Expected'}</h3>
                  <ListGroup>
                    {upcomingOneTimes.map((o) => (
                      <li key={o.id}>
                        <OccurrenceRow o={o} onOpen={openOccurrence} />
                      </li>
                    ))}
                  </ListGroup>
                </>
              )}
              {pastOneTimes.length > 0 && (
                <>
                  <h3 className="subhead">Recorded or canceled</h3>
                  <ListGroup>
                    {pastOneTimes.map((o) => (
                      <li key={o.id}>
                        <OccurrenceRow o={o} onOpen={openOccurrence} />
                      </li>
                    ))}
                  </ListGroup>
                </>
              )}
            </>
          )}
        </section>
      )}

      {adding === 'recurring' && isRecurringKind(kind) && (
        <Modal title={copy.addRecurring} onClose={() => setAdding(null)}>
          <SourceForm kind={kind} onDone={() => setAdding(null)} />
        </Modal>
      )}
      {adding === 'one-time' && isOneTimeKind(kind) && (
        <Modal title={recurring ? `Add one-time ${KIND_COPY[kind].noun}` : 'Add varied spending'} onClose={() => setAdding(null)}>
          <OneTimeForm kind={kind} onDone={() => setAdding(null)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.description}`} onClose={() => setEditing(null)}>
          <SourceForm kind={editing.kind} source={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {itemSource && (
        <ItemSheet
          source={itemSource}
          onClose={() => setSheet(null)}
          onOpenDate={(id) => setSheet({ kind: 'occurrence', id, back: itemSource.id })}
          onEdit={() => {
            setSheet(null);
            setEditing(itemSource);
          }}
        />
      )}
      {sheet?.kind === 'occurrence' && (
        <OccurrenceSheet occurrenceId={sheet.id} onClose={() => setSheet(sheet.back ? { kind: 'item', id: sheet.back } : null)} />
      )}
    </div>
  );
}

const EXPENSE_TABS: { kind: TransactionKind; label: string }[] = [
  { kind: 'bill', label: 'Bills' },
  { kind: 'subscription', label: 'Subscriptions' },
  { kind: 'varied', label: 'Varied' },
];

/** Expenses screen: bills, subscriptions and varied spending, one pill tab each. Liabilities and reserves have their own screens. */
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
