import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, Minus, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { addDays, formatMedium, formatMonthYear, formatRange, formatShort, type DateStr } from '../../domain/dates';
import { navigateToForecast } from '../router';
import { formatMoney, formatSignedMoney } from '../../domain/money';
import { homeView, type CashFlowComparison, type HomeGap, type HomeItem, type HomeOccurrence, type HomeProgress, type HomeView } from '../../domain/home';
import * as ops from '../../domain/operations';
import { useStore } from '../../state/store';
import { Field, FlowAmount, FormError, Icon, KindAvatar, Modal, SectionLabel, useToast } from '../components/common';
import { EntryButton, PeriodNav, shortDay } from '../components/entries';
import { GapsSheet } from '../components/gaps';
import { AccountLabel, TransferForm, TransferRow, useAccountsAvailable } from '../components/money-accounts';
import { OccurrenceSheet } from '../components/OccurrenceSheet';
import { ScenarioSheet } from '../components/ScenarioSheet';

/** Which sheet is open. Every one is an existing sheet; Home adds no workflow of its own. */
type Sheet = { kind: 'occurrence'; id: string } | { kind: 'transfer'; id: string } | { kind: 'gap'; start: DateStr };

const items = (n: number) => (n === 1 ? '1 item' : `${n} items`);
const monthName = (date: DateStr) => formatMonthYear(date).split(' ')[0]!;

/**
 * The opening screen: progress, what needs attention, what is coming up and
 * what happened. Everything is read from `homeView` (the one forecast); Home
 * only chooses which week to list and opens the existing sheets.
 */
export function Home() {
  const { data, today } = useStore();
  const transfersShown = useAccountsAvailable();
  const [weekOf, setWeekOf] = useState<DateStr>(today);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const view = useMemo(() => {
    const v = homeView(data, today, { weekOf });
    if (transfersShown) return v;
    const noTransfers = (list: HomeItem[]) => list.filter((i) => i.type !== 'transfer');
    return { ...v, attention: noTransfers(v.attention), comingUp: noTransfers(v.comingUp), happened: noTransfers(v.happened) };
  }, [data, today, weekOf, transfersShown]);

  const open = (item: HomeItem) =>
    setSheet(item.type === 'occurrence' ? { kind: 'occurrence', id: item.id } : item.type === 'transfer' ? { kind: 'transfer', id: item.id } : { kind: 'gap', start: item.gap.start });
  const week = view.week;

  return (
    <div className="home stack-lg">
      <header className="screen-header">
        <h1>
          <span className="sr-only">Home, </span>
          {shortDay(today)}
        </h1>
      </header>

      <Progress progress={view.progress} />
      <Attention view={view} onOpen={open} />

      <section className="stack" aria-label="This week">
        <PeriodNav
          label={formatRange(week.start, week.end)}
          prevLabel="Previous week"
          nextLabel="Next week"
          onPrev={() => setWeekOf(addDays(week.start, -7))}
          onNext={() => setWeekOf(addDays(week.start, 7))}
          onToday={week.current ? undefined : () => setWeekOf(today)}
        />
        <ComingUp view={view} onOpen={open} />
        <Happened view={view} onOpen={open} />
        {view.comingUp.length === 0 && view.happened.length === 0 && <p className="muted center">Nothing scheduled or recorded this week.</p>}
      </section>

      <p className="center">
        <button type="button" className="button link" onClick={() => navigateToForecast(week.start)}>
          Full forecast and calendar
        </button>
      </p>

      {sheet?.kind === 'occurrence' && <OccurrenceSheet occurrenceId={sheet.id} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'transfer' && <TransferSheet id={sheet.id} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'gap' && <GapFlow view={view} start={sheet.start} onClose={() => setSheet(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress

function Direction({ c }: { c: CashFlowComparison }) {
  const icon = c.direction === 'up' ? TrendingUp : c.direction === 'down' ? TrendingDown : Minus;
  return <Icon icon={icon} size={18} />;
}

const change = (c: CashFlowComparison) => (c.direction === 'unchanged' ? 'No change' : `${c.direction === 'up' ? 'Up' : 'Down'} ${formatMoney(Math.abs(c.differenceCents))}`);

/**
 * Cash flow this month against last month. The recorded comparison (same days
 * of each month) leads; the projected month is a second, labeled line. The
 * direction is the sign of the difference, with no threshold.
 */
function Progress({ progress }: { progress: HomeProgress }) {
  const { monthToDate: m, projectedVsLastMonth: p, thisMonth } = progress;
  const hasRecorded = m.current.count > 0 || m.previous.count > 0;
  const hasProjected = thisMonth.expectedCount > 0 && p.current.count > 0;
  if (!hasRecorded && !hasProjected) return null;
  const month = monthName(m.current.start);
  const last = monthName(m.previous.start);
  return (
    <section className="card progress stack-sm" aria-labelledby="progress-heading">
      {hasRecorded && (
        <>
          <p className="hero-label" id="progress-heading">
            Cash flow so far in {month} <span className="badge">Recorded</span>
          </p>
          <p className={`hero-value${m.current.netCents < 0 ? ' negative' : ''}`}>{formatSignedMoney(m.current.netCents)}</p>
          {m.previous.count > 0 ? (
            <p className={`progress-change ${m.direction}`}>
              <Direction c={m} />
              <span>
                {change(m)} from {formatRange(m.previous.start, m.previous.end)} <span className="muted">({formatSignedMoney(m.previous.netCents)} recorded)</span>
              </span>
            </p>
          ) : (
            <p className="muted">Nothing was recorded on {formatRange(m.previous.start, m.previous.end)} to compare.</p>
          )}
        </>
      )}
      {hasProjected && (
        <p className="progress-projected" id={hasRecorded ? undefined : 'progress-heading'}>
          <span className="badge">Projected</span> {month} ends at <strong>{formatSignedMoney(p.current.netCents)}</strong>
          {p.previous.count > 0 && (
            <span className="muted">
              {' '}
              · {last} recorded {formatSignedMoney(p.previous.netCents)} ({change(p).toLowerCase()})
            </span>
          )}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Needs attention

/** What a due item needs, in neutral words: expected money is "not recorded", never "late". */
function dueText(i: HomeOccurrence, today: DateStr): string {
  const o = i.entry.occurrence;
  const incoming = i.entry.signedCents > 0;
  if (o.scheduledDate === today) return incoming ? 'Expected today — not recorded' : 'Due today';
  return incoming ? `Expected ${formatShort(o.scheduledDate)} — not recorded` : `Overdue since ${formatShort(o.scheduledDate)}`;
}

function Attention({ view, onOpen }: { view: HomeView; onOpen: (i: HomeItem) => void }) {
  const { run, today } = useStore();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState<DateStr>(today);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const occurrences = view.attention.filter((i): i is HomeOccurrence => i.type === 'occurrence');
  const visible = new Set(occurrences.map((i) => i.id));
  const selected = [...picked].filter((id) => visible.has(id));
  if (view.attention.length === 0) return null;

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = occurrences.length > 0 && occurrences.every((i) => picked.has(i.id));

  const apply = (op: (d: Parameters<Parameters<typeof run>[0]>[0], clock: ops.Clock) => ops.Result, message: string) => {
    if (submitting.current) return;
    submitting.current = true;
    const result = run(op);
    submitting.current = false;
    if (!result.ok) return setError(result.error);
    setError(null);
    setPicked(new Set());
    setMoving(false);
    toast(message);
  };
  const markDone = () => apply((d, c) => ops.recordAsExpected(d, selected, c), `Recorded ${items(selected.length)} as expected.`);
  const move = (e: FormEvent) => {
    e.preventDefault();
    if (!moveDate) return setError('Choose a date.');
    apply((d, c) => ops.rescheduleSelected(d, selected, moveDate, c), `Moved ${items(selected.length)} to ${formatMedium(moveDate)}.`);
  };

  return (
    <section className="stack-sm" aria-labelledby="attention-heading">
      <SectionLabel
        id="attention-heading"
        action={
          occurrences.length > 1 ? (
            <button type="button" className="button link small" onClick={() => setPicked(all ? new Set() : new Set(occurrences.map((i) => i.id)))}>
              {all ? 'Clear' : 'Select all'}
            </button>
          ) : undefined
        }
      >
        Needs attention
      </SectionLabel>
      <ul className="entry-list card">
        {view.attention.map((i) => (
          <li key={i.id}>
            {i.type === 'occurrence' ? (
              <div className="pick-row">
                <label className="pick-check">
                  <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.entry.occurrence.description}, ${formatMoney(i.entry.amountCents)}, ${dueText(i, today).toLowerCase()}`} />
                </label>
                <button type="button" className="entry" onClick={() => onOpen(i)}>
                  <KindAvatar kind={i.entry.occurrence.kind} />
                  <span className="entry-main">
                    <span className="entry-title">{i.entry.occurrence.description}</span>
                    <span className="entry-sub">{dueText(i, today)}</span>
                    <AccountLabel accountId={i.accountId ?? undefined} />
                  </span>
                  <span className="entry-side">
                    <FlowAmount kind={i.entry.occurrence.kind} cents={i.entry.amountCents} release={i.entry.occurrence.release} />
                    <Icon icon={ChevronRight} size={18} className="chevron" />
                  </span>
                </button>
              </div>
            ) : (
              <ItemRow item={i} onOpen={onOpen} />
            )}
          </li>
        ))}
      </ul>
      {selected.length > 0 && !moving && (
        <div className="pick-actions">
          <button type="button" className="button primary" onClick={markDone}>
            Record {items(selected.length)} as expected
          </button>
          <button type="button" className="button secondary" onClick={() => setMoving(true)}>
            Move to a date
          </button>
          <p className="hint">Each is recorded at its expected amount and date. To record a different amount, open the item.</p>
        </div>
      )}
      {selected.length > 0 && moving && (
        <form className="stack pick-actions" onSubmit={move} noValidate>
          <Field label={`New expected date for ${items(selected.length)}`} hint="Amounts stay the same. Only the selected items move.">
            {(p) => <input {...p} type="date" min={today} value={moveDate} onChange={(e) => setMoveDate(e.target.value)} autoFocus />}
          </Field>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMoving(false)}>
              Back
            </button>
            <button type="submit" className="button primary">
              Move
            </button>
          </div>
        </form>
      )}
      <FormError message={error} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Coming up, happened

/** A row for any item: forecast entry, planned or recorded transfer, or timing gap. */
function ItemRow({ item, onOpen }: { item: HomeItem; onOpen: (i: HomeItem) => void }) {
  if (item.type === 'occurrence') return <EntryButton e={item.entry} onOpen={() => onOpen(item)} extra={<AccountLabel accountId={item.accountId ?? undefined} />} />;
  if (item.type === 'transfer') return <TransferRow transfer={item.transfer} onOpen={() => onOpen(item)} />;
  return <GapRow gap={item} onOpen={() => onOpen(item)} />;
}

function GapRow({ gap: { gap }, onOpen }: { gap: HomeGap; onOpen: () => void }) {
  return (
    <button type="button" className="entry gap-row" onClick={onOpen} aria-haspopup="dialog">
      <span className="avatar avatar-sm avatar-gap" aria-hidden="true">
        <Icon icon={TriangleAlert} size={14} />
      </span>
      <span className="entry-main">
        <span className="entry-title">Timing gap from {formatShort(gap.start)}</span>
        <span className="entry-sub negative-text">
          Down to {formatMoney(gap.lowestCents)} on {formatShort(gap.lowestDate)}
        </span>
      </span>
      <Icon icon={ChevronRight} size={18} className="chevron" />
    </button>
  );
}

function ComingUp({ view, onOpen }: { view: HomeView; onOpen: (i: HomeItem) => void }) {
  if (view.comingUp.length === 0) return null;
  const days: { date: DateStr; list: HomeItem[] }[] = [];
  for (const i of view.comingUp) {
    const last = days[days.length - 1];
    if (last && last.date === i.date) last.list.push(i);
    else days.push({ date: i.date, list: [i] });
  }
  return (
    <section className="stack-sm" aria-labelledby="coming-heading">
      <SectionLabel id="coming-heading" action={view.week.current ? <span className="hint">through {shortDay(view.week.comingUpThrough)}</span> : undefined}>
        Coming up
      </SectionLabel>
      {days.map((d) => (
        <div key={d.date} className="stack-sm">
          <h3 className="subhead">{shortDay(d.date)}</h3>
          <ul className="entry-list card">
            {d.list.map((i) => (
              <li key={i.id}>
                <ItemRow item={i} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Happened({ view, onOpen }: { view: HomeView; onOpen: (i: HomeItem) => void }) {
  if (view.happened.length === 0) return null;
  return (
    <section className="stack-sm" aria-labelledby="happened-heading">
      <SectionLabel id="happened-heading">Happened this week</SectionLabel>
      <ul className="entry-list card">
        {view.happened.map((i) => (
          <li key={i.id}>
            <ItemRow item={i} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sheets

function TransferSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useStore();
  const transfer = (data.transfers ?? []).find((t) => t.id === id);
  if (!transfer) return null;
  return (
    <Modal title={transfer.status === 'recorded' ? 'Transfer' : 'Planned transfer'} onClose={onClose}>
      <TransferForm transfer={transfer} onDone={onClose} />
    </Modal>
  );
}

/** The timing-gap explanation, with "See what happens if…" on its entries, as the forecast offers. */
function GapFlow({ view, start, onClose }: { view: HomeView; start: DateStr; onClose: () => void }) {
  const [whatIf, setWhatIf] = useState<string | null>(null);
  const found = [...view.attention, ...view.comingUp, ...view.laterGaps].find((i): i is HomeGap => i.type === 'gap' && i.gap.start === start);
  if (!found) return null;
  if (whatIf) return <ScenarioSheet occurrenceId={whatIf} through={found.gap.end} onClose={() => setWhatIf(null)} onApplied={onClose} />;
  return <GapsSheet gaps={[found.gap]} horizonEnd={view.horizonEnd} onClose={onClose} onWhatIf={setWhatIf} />;
}
