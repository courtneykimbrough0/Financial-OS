import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Equal,
  HandCoins,
  Receipt,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import {
  addDays,
  diffDays,
  addMonthsClamped,
  dayOfWeek,
  eachDay,
  endOfMonth,
  endOfWeek,
  formatLong,
  formatMedium,
  formatMonthYear,
  formatRange,
  formatShort,
  isValidDateStr,
  parts,
  startOfMonth,
  startOfWeek,
  WEEKDAYS_SHORT,
  type DateStr,
} from '../../domain/dates';
import {
  buildForecast,
  dailyTimeline,
  lowestPoint,
  monthWeekSummaries,
  negativeStretches,
  overdueEntries,
  paycheckCycles,
  periodKpis,
  type DayRow,
  type Forecast,
  type ForecastEntry,
  type LowPoint,
  type NegativeStretch,
} from '../../domain/forecast';
import { formatCompact, formatMoney, formatSignedMoney } from '../../domain/money';
import type { TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { EmptyState, FlowAmount, Icon, KindAvatar, KindTag, SectionLabel, StatusBadge } from '../components/common';
import { OccurrenceSheet } from '../components/OccurrenceSheet';
import { navigate } from '../router';

type View = 'month' | 'week' | 'cycle' | 'custom';

const VIEWS: { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'cycle', label: 'Paycheck' },
  { id: 'custom', label: 'Custom' },
];

function shortDay(date: DateStr): string {
  return `${WEEKDAYS_SHORT[dayOfWeek(date)]}, ${formatShort(date)}`;
}

function tallyText(cents: number | null): string {
  return cents === null ? '—' : formatMoney(cents);
}

// ---------------------------------------------------------------------------

export function Dashboard() {
  const { data, today } = useStore();
  const [view, setView] = useState<View>('month');
  const [focus, setFocus] = useState<DateStr>(today);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [customStart, setCustomStart] = useState<DateStr>(today);
  const [customEnd, setCustomEnd] = useState<DateStr>(addDays(today, 30));
  const [selected, setSelected] = useState<DateStr | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);

  const customError =
    !isValidDateStr(customStart) || !isValidDateStr(customEnd)
      ? 'Choose a start and end date.'
      : customEnd < customStart
        ? 'The end date must be on or after the start date.'
        : null;

  const fixedRange = useMemo((): [DateStr, DateStr] | null => {
    if (view === 'month') return [startOfMonth(focus), endOfMonth(focus)];
    if (view === 'week') return [startOfWeek(focus), endOfWeek(focus)];
    if (view === 'custom') return customError ? null : [customStart, customEnd];
    return null;
  }, [view, focus, customStart, customEnd, customError]);

  const forecast = useMemo(() => buildForecast(data, today, { through: fixedRange?.[1] }), [data, today, fixedRange]);
  const cycles = useMemo(() => paycheckCycles(forecast), [forecast]);
  const cycle = cycles[Math.min(cycleIndex, Math.max(cycles.length - 1, 0))];
  const range: [DateStr, DateStr] | null = view === 'cycle' ? (cycle ? [cycle.start, cycle.end] : null) : fixedRange;

  const overdue = overdueEntries(forecast);

  return (
    <div className="dashboard stack-lg">
      <header className="screen-header">
        <h1>Your cash flow</h1>
        <p className="muted">Today is {formatLong(today)}</p>
      </header>

      {forecast.issue && <IssueCard forecast={forecast} />}
      {overdue.length > 0 && <OverduePanel entries={overdue} onOpen={setSheetId} />}

      <div className="segmented" role="tablist" aria-label="Dashboard view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            id={`tab-${v.id}`}
            aria-selected={view === v.id}
            aria-controls="dashboard-panel"
            className={view === v.id ? 'active' : ''}
            onClick={() => {
              setView(v.id);
              setSelected(null);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <section id="dashboard-panel" role="tabpanel" aria-labelledby={`tab-${view}`} className="stack-lg">
        {view === 'month' && (
          <PeriodNav
            label={formatMonthYear(focus)}
            prevLabel="Previous month"
            nextLabel="Next month"
            onPrev={() => setFocus(addMonthsClamped(startOfMonth(focus), -1))}
            onNext={() => setFocus(addMonthsClamped(startOfMonth(focus), 1))}
            onToday={focus.slice(0, 7) !== today.slice(0, 7) ? () => setFocus(today) : undefined}
          />
        )}
        {view === 'week' && (
          <PeriodNav
            label={formatRange(startOfWeek(focus), endOfWeek(focus))}
            prevLabel="Previous week"
            nextLabel="Next week"
            onPrev={() => setFocus(addDays(startOfWeek(focus), -7))}
            onNext={() => setFocus(addDays(startOfWeek(focus), 7))}
            onToday={startOfWeek(focus) !== startOfWeek(today) ? () => setFocus(today) : undefined}
          />
        )}
        {view === 'cycle' &&
          (cycle ? (
            <div className="stack">
              <PeriodNav
                label={formatRange(cycle.start, cycle.end)}
                prevLabel="Previous pay period"
                nextLabel="Next pay period"
                onPrev={cycleIndex > 0 ? () => setCycleIndex(cycleIndex - 1) : undefined}
                onNext={cycleIndex < cycles.length - 1 ? () => setCycleIndex(cycleIndex + 1) : undefined}
              />
              <p className="muted center">
                Pay period {cycleIndex + 1} of {cycles.length}: starts with {cycle.paydayEntries.map((e) => e.occurrence.description).join(' and ')} on {formatMedium(cycle.start)} and runs until
                the next income on {formatMedium(addDays(cycle.end, 1))}.
              </p>
            </div>
          ) : (
            <EmptyState title="Pay periods aren’t available yet">
              <p>
                {forecast.issue
                  ? 'Add a recurring income with its next payment date. Pay periods run from one expected payday to the next.'
                  : 'We need at least two upcoming paydays to show a pay period. Check that your recurring income is turned on.'}
              </p>
            </EmptyState>
          ))}
        {view === 'custom' && (
          <div className="custom-range">
            <div className="field">
              <label htmlFor="custom-start">Start date</label>
              <input id="custom-start" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} aria-invalid={customError ? true : undefined} />
            </div>
            <div className="field">
              <label htmlFor="custom-end">End date</label>
              <input id="custom-end" type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} aria-invalid={customError ? true : undefined} aria-describedby="custom-error" />
            </div>
            {customError && (
              <p className="field-error" id="custom-error" role="alert">
                {customError}
              </p>
            )}
          </div>
        )}

        {range && (
          <PeriodBody
            forecast={forecast}
            range={range}
            view={view}
            today={today}
            selected={selected && selected >= range[0] && selected <= range[1] ? selected : null}
            onSelect={setSelected}
            onOpen={setSheetId}
          />
        )}
      </section>

      {sheetId && <OccurrenceSheet occurrenceId={sheetId} onClose={() => setSheetId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function IssueCard({ forecast }: { forecast: Forecast }) {
  return (
    <div className="card stack">
      <p>
        <strong>Add a recurring income to start your forecast.</strong>
      </p>
      <p>
        {forecast.issue === 'no-recurring-income'
          ? 'Your running cash flow starts the day before your next expected payday, so we need at least one recurring income (like a paycheck or benefits) with its next payment date.'
          : 'None of your recurring income has an upcoming payment. Check its next payment date.'}{' '}
        Totals for each period are still shown below.
      </p>
      <div>
        <button type="button" className="button primary" onClick={() => navigate('income')}>
          Go to Income
        </button>
      </div>
    </div>
  );
}

function OverduePanel({ entries, onOpen }: { entries: ForecastEntry[]; onOpen: (id: string) => void }) {
  const shown = entries.slice(0, 5);
  return (
    <section className="panel panel-warn" aria-labelledby="overdue-heading">
      <h2 id="overdue-heading">
        <Icon icon={AlertCircle} size={20} />
        {entries.length === 1 ? '1 transaction needs an update' : `${entries.length} transactions need an update`}
      </h2>
      <p className="muted">These dates have passed. Record what happened, or change the expected date. They stay in your forecast until you do.</p>
      <ul className="entry-list">
        {shown.map((e) => (
          <li key={e.occurrence.id}>
            <button type="button" className="entry" onClick={() => onOpen(e.occurrence.id)}>
              <KindAvatar kind={e.occurrence.kind} />
              <span className="entry-main">
                <span className="entry-title">{e.occurrence.description}</span>
                <span className="entry-sub">Expected {formatMedium(e.occurrence.scheduledDate)}</span>
              </span>
              <span className="entry-side">
                <FlowAmount kind={e.occurrence.kind} cents={e.amountCents} />
                <span className="entry-action">
                  {e.occurrence.kind === 'income' ? 'Mark received' : 'Mark paid'}
                  <Icon icon={ChevronRight} size={14} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {entries.length > shown.length && <p className="muted">And {entries.length - shown.length} more, marked “Overdue” on the calendar.</p>}
    </section>
  );
}

function PeriodNav({
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev?: () => void;
  onNext?: () => void;
  onToday?: () => void;
}) {
  return (
    <div className="period-nav">
      <button type="button" className="icon-button" onClick={onPrev} disabled={!onPrev} aria-label={prevLabel}>
        <Icon icon={ChevronLeft} size={22} />
      </button>
      <h2 aria-live="polite">{label}</h2>
      <button type="button" className="icon-button" onClick={onNext} disabled={!onNext} aria-label={nextLabel}>
        <Icon icon={ChevronRight} size={22} />
      </button>
      {onToday && (
        <button type="button" className="button small secondary" onClick={onToday}>
          Today
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PeriodBody({
  forecast,
  range,
  view,
  today,
  selected,
  onSelect,
  onOpen,
}: {
  forecast: Forecast;
  range: [DateStr, DateStr];
  view: View;
  today: DateStr;
  selected: DateStr | null;
  onSelect: (d: DateStr) => void;
  onOpen: (id: string) => void;
}) {
  const [start, end] = range;
  const rows = useMemo(() => dailyTimeline(forecast, start, end), [forecast, start, end]);
  const kpis = periodKpis(forecast, start, end);
  const low = lowestPoint(rows);
  const negatives = negativeStretches(rows);
  const activeDay = selected ?? (today >= start && today <= end ? today : start);
  const activeRow = rows.find((r) => r.date === activeDay);

  return (
    <>
      <TallyHero forecast={forecast} low={low} negatives={negatives} today={today} />

      <ul className="card list-card kpis" aria-label={`Totals for ${formatRange(start, end)}`}>
        <KpiRow icon={HandCoins} label="Projected income" value={formatMoney(kpis.incomeCents)} />
        <KpiRow icon={Receipt} label="Projected expenses" sub="Includes liability payments" value={formatMoney(kpis.outflowCents)} />
        <KpiRow icon={Equal} label="Projected cash flow" sub="Income minus expenses" value={formatSignedMoney(kpis.netCents)} negative={kpis.netCents < 0} />
      </ul>

      <Calendar rows={rows} start={start} end={end} today={today} selected={activeDay} lowDate={low?.date ?? null} onSelect={onSelect} />

      {activeRow && <DayDetails row={activeRow} onOpen={onOpen} isLow={low?.date === activeRow.date} />}

      {view === 'month' && <WeekSummaries forecast={forecast} monthDate={start} onOpen={onOpen} />}

      <Timeline rows={rows} lowDate={low?.date ?? null} onSelect={onSelect} anchor={forecast.anchor} />
    </>
  );
}

function KpiRow({ icon, label, sub, value, negative }: { icon: LucideIcon; label: string; sub?: string; value: string; negative?: boolean }) {
  return (
    <li className="list-row">
      <Icon icon={icon} size={22} className="list-row-icon" />
      <span className="list-row-main">
        <span className="list-row-label">{label}</span>
        {sub && <span className="list-row-sub">{sub}</span>}
      </span>
      <span className={`list-row-value${negative ? ' negative' : ''}`}>
        {negative && <Icon icon={TrendingDown} size={16} />}
        {value}
      </span>
    </li>
  );
}

/** The headline card: the lowest projected cash flow in view, any timing gaps, and the next expected payday. */
function TallyHero({ forecast, low, negatives, today }: { forecast: Forecast; low: LowPoint | null; negatives: NegativeStretch[]; today: DateStr }) {
  if (!forecast.anchor || !forecast.forecastStart) return null;
  const payday = forecast.forecastStart;
  const daysToPayday = diffDays(today, payday);
  return (
    <section className="card hero" aria-labelledby="hero-label">
      <div className="hero-body">
        <p className="hero-label" id="hero-label">
          Lowest projected cash flow
        </p>
        {low ? (
          <>
            <p className={`hero-value${low.tallyCents < 0 ? ' negative' : ''}`}>
              {low.tallyCents < 0 && <Icon icon={TrendingDown} size={28} />}
              {formatMoney(low.tallyCents)}
            </p>
            <p className="hero-sub">on {formatMedium(low.date)}</p>
          </>
        ) : (
          <p className="hero-sub">This period ends before your projected cash flow begins on {formatMedium(payday)}.</p>
        )}
        {negatives.length > 0 && (
          <div className="callout callout-danger" role="note">
            <p>
              <strong>
                <Icon icon={TrendingDown} size={16} /> Timing gap ahead
              </strong>
            </p>
            <ul className="plain-list">
              {negatives.map((n) => (
                <li key={n.start}>
                  Money out runs ahead of money in from <strong>{formatRange(n.start, n.end)}</strong>, by up to <strong>{formatMoney(-n.lowestCents)}</strong>.
                </li>
              ))}
            </ul>
          </div>
        )}
        {low && negatives.length === 0 && (
          <p className="callout callout-ok">
            <Icon icon={Check} size={16} /> Projected cash flow stays at or above $0 in this period.
          </p>
        )}
      </div>
      <div className="hero-footer">
        <Icon icon={Banknote} size={22} className="hero-footer-icon" />
        <span>
          {daysToPayday > 1
            ? `Next expected payday in ${daysToPayday} days`
            : daysToPayday === 1
              ? 'Next expected payday is tomorrow'
              : daysToPayday === 0
                ? 'Next expected payday is today'
                : `Next expected payday was ${formatShort(payday)}`}
          <span className="muted"> · {formatShort(payday)}</span>
        </span>
      </div>
      <p className="hint hero-hint">
        Projected cash flow starts at $0 on {formatMedium(forecast.anchor)}, the day before your next expected payday ({formatMedium(payday)}), and adds money in and subtracts money out day by day. It shows
        timing, separate from your bank balance.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function dayAriaLabel(row: DayRow | undefined, date: DateStr, isLow: boolean): string {
  const bits = [formatLong(date)];
  if (!row) return bits.join('. ');
  if (row.inCents) bits.push(`money in ${formatMoney(row.inCents)}`);
  if (row.outCents) bits.push(`money out ${formatMoney(row.outCents)}`);
  const overdue = row.entries.filter((e) => e.occurrence.displayStatus === 'overdue').length;
  if (overdue) bits.push(`${overdue} overdue`);
  const done = row.entries.filter((e) => e.occurrence.status === 'completed').length;
  if (done) bits.push(`${done} done`);
  if (row.tallyCents !== null) bits.push(`projected cash flow ${formatMoney(row.tallyCents)}${row.tallyCents < 0 ? ', below zero' : ''}`);
  if (isLow) bits.push('lowest point');
  return bits.join(', ');
}

/** Chip style for one direction of money on a day: filled when every item is done, outlined while any is expected. */
function chipState(entries: ForecastEntry[], dir: 'in' | 'out'): 'done' | 'expected' {
  const items = entries.filter((e) => e.counts && (dir === 'in' ? e.signedCents > 0 : e.signedCents < 0));
  return items.length > 0 && items.every((e) => e.occurrence.status === 'completed') ? 'done' : 'expected';
}

function Calendar({
  rows,
  start,
  end,
  today,
  selected,
  lowDate,
  onSelect,
}: {
  rows: DayRow[];
  start: DateStr;
  end: DateStr;
  today: DateStr;
  selected: DateStr;
  lowDate: DateStr | null;
  onSelect: (d: DateStr) => void;
}) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const days = eachDay(startOfWeek(start), endOfWeek(end));
  const weeks: DateStr[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Footer breakdown by kind, counting each counted occurrence once.
  const counted = rows.flatMap((r) => r.entries.filter((e) => e.counts));
  const byKind = (['income', 'expense', 'liability'] as const).map((kind) => {
    const items = counted.filter((e) => e.occurrence.kind === kind);
    return { kind, count: items.length, cents: items.reduce((s, e) => s + e.amountCents, 0) };
  });
  const KIND_FOOT: Record<TransactionKind, [string, string]> = {
    income: ['Income', 'Income'],
    expense: ['Expense', 'Expenses'],
    liability: ['Liability payment', 'Liability payments'],
  };

  return (
    <div className="calendar-card">
      <table className="calendar">
        <caption className="sr-only">Calendar for {formatRange(start, end)}. Select a day to see its transactions.</caption>
        <thead>
          <tr>
            {WEEKDAYS_SHORT.map((d) => (
              <th key={d} scope="col" abbr={d}>
                {d.slice(0, 1)}
                <span className="wide-only">{d.slice(1)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => {
                const inRange = date >= start && date <= end;
                if (!inRange)
                  return (
                    <td key={date} className="cal-out" aria-hidden="true">
                      <span className="cal-num">{parts(date).d}</span>
                    </td>
                  );
                const row = byDate.get(date);
                const overdue = row?.entries.some((e) => e.occurrence.displayStatus === 'overdue');
                const negative = row?.tallyCents !== null && row?.tallyCents !== undefined && row.tallyCents < 0;
                const classes = ['cal-day', date === selected && 'selected', date === today && 'today', negative && 'negative', date === lowDate && 'low'].filter(Boolean).join(' ');
                return (
                  <td key={date}>
                    <button type="button" className={classes} aria-pressed={date === selected} aria-label={dayAriaLabel(row, date, date === lowDate)} onClick={() => onSelect(date)}>
                      <span className="cal-num">{parts(date).d}</span>
                      <span className="cal-flags" aria-hidden="true">
                        {overdue && <Icon icon={AlertCircle} size={14} className="flag-overdue" />}
                        {negative && <Icon icon={TrendingDown} size={14} className="flag-neg" />}
                        {date === lowDate && <span className="flag-low">Low</span>}
                      </span>
                      <span className="cal-chips" aria-hidden="true">
                        {row && row.outCents > 0 && <span className={`chip chip-out chip-${chipState(row.entries, 'out')}`}>−{formatCompact(row.outCents)}</span>}
                        {row && row.inCents > 0 && <span className={`chip chip-in chip-${chipState(row.entries, 'in')}`}>+{formatCompact(row.inCents)}</span>}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="legend" aria-label="Calendar key">
        <li>
          <span className="chip chip-in chip-expected legend-chip">+</span> Money in
        </li>
        <li>
          <span className="chip chip-out chip-expected legend-chip">−</span> Money out
        </li>
        <li>
          <span className="chip chip-out chip-done legend-chip">
            <Icon icon={Check} size={11} />
          </span>
          Filled: done
        </li>
        <li>
          <span className="chip chip-out chip-expected legend-chip">
            <Icon icon={CircleDashed} size={11} />
          </span>
          Outlined: expected
        </li>
        <li>
          <Icon icon={AlertCircle} size={14} className="flag-overdue" /> Overdue
        </li>
        <li>
          <Icon icon={TrendingDown} size={14} className="flag-neg" /> Below $0
        </li>
      </ul>
      <dl className="calendar-foot">
        {byKind.map((k) => (
          <div key={k.kind}>
            <dt>
              {k.count} {KIND_FOOT[k.kind][k.count === 1 ? 0 : 1]}
            </dt>
            <dd>{formatMoney(k.cents)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EntryButton({ e, onOpen }: { e: ForecastEntry; onOpen: (id: string) => void }) {
  const o = e.occurrence;
  let sub: string | null = null;
  if (e.carriedForward) sub = `Overdue since ${formatMedium(o.scheduledDate)}`;
  else if (o.status === 'completed' && (o.actualDate !== o.expectedDate || o.actualAmountCents !== o.expectedAmountCents)) {
    sub = `Expected ${formatMoney(o.expectedAmountCents)} on ${formatShort(o.expectedDate)}`;
  } else if (o.status === 'scheduled' && (o.scheduledDate !== o.expectedDate || o.scheduledAmountCents !== o.expectedAmountCents)) {
    sub = `Changed from ${formatMoney(o.expectedAmountCents)} on ${formatShort(o.expectedDate)}`;
  }
  return (
    <button type="button" className="entry" onClick={() => onOpen(o.id)}>
      <KindAvatar kind={o.kind} />
      <span className="entry-main">
        <span className="entry-title">{o.description}</span>
        <span className="entry-tags">
          <KindTag kind={o.kind} />
          <StatusBadge status={o.displayStatus} kind={o.kind} />
        </span>
        {sub && <span className="entry-sub">{sub}</span>}
      </span>
      <span className="entry-side">
        <FlowAmount kind={o.kind} cents={e.amountCents} strike={!e.counts} />
        <Icon icon={ChevronRight} size={18} className="chevron" />
      </span>
    </button>
  );
}

function DayDetails({ row, onOpen, isLow }: { row: DayRow; onOpen: (id: string) => void; isLow: boolean }) {
  return (
    <section className="card" aria-labelledby="day-heading" aria-live="polite">
      <div className="panel-head">
        <h2 id="day-heading">{formatLong(row.date)}</h2>
        {row.tallyCents !== null && (
          <p className={row.tallyCents < 0 ? 'tally negative' : 'tally'}>
            Projected cash flow: <strong>{formatMoney(row.tallyCents)}</strong>
            {row.tallyCents < 0 && <span> (below $0)</span>}
            {isLow && <span className="badge badge-low">Lowest point</span>}
          </p>
        )}
      </div>
      {row.entries.length === 0 ? (
        <p className="muted">Nothing scheduled this day.</p>
      ) : (
        <ul className="entry-list">
          {row.entries.map((e) => (
            <li key={e.occurrence.id}>
              <EntryButton e={e} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WeekSummaries({ forecast, monthDate, onOpen }: { forecast: Forecast; monthDate: DateStr; onOpen: (id: string) => void }) {
  const weeks = useMemo(() => monthWeekSummaries(forecast, monthDate), [forecast, monthDate]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby="weeks-heading" className="stack-sm">
      <SectionLabel id="weeks-heading">Week by week</SectionLabel>
      <div className="card list-card">
        <p className="hint card-note">Weeks run Sunday to Saturday.</p>
        <ul className="week-list">
          {weeks.map((w) => {
            const isOpen = open === w.start;
            const active = w.days.filter((d) => d.entries.length > 0);
            return (
              <li key={w.start}>
                <button type="button" className="week-row" aria-expanded={isOpen} aria-controls={`week-${w.start}`} onClick={() => setOpen(isOpen ? null : w.start)}>
                  <span className="week-label">
                    <Icon icon={isOpen ? ChevronDown : ChevronRight} size={18} />
                    {formatRange(w.start, w.end)}
                  </span>
                  <span className="week-nums">
                    <span>
                      <span className="sr-only">Income </span>
                      <span className="amount amount-in">+{formatMoney(w.incomeCents)}</span>
                    </span>
                    <span>
                      <span className="sr-only">Expenses </span>
                      <span className="amount amount-out">−{formatMoney(w.outflowCents)}</span>
                    </span>
                    <span className={w.netCents < 0 ? 'week-net negative' : 'week-net'}>
                      <span className="sr-only">Net </span>
                      Net {formatSignedMoney(w.netCents)}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div id={`week-${w.start}`} className="week-detail">
                    {active.length === 0 ? (
                      <p className="muted">Nothing scheduled this week.</p>
                    ) : (
                      active.map((d) => (
                        <div key={d.date} className="week-day">
                          <p className="week-day-head">
                            <strong>{shortDay(d.date)}</strong>
                            <span>
                              Net {formatSignedMoney(d.netCents)} · Cash flow {tallyText(d.tallyCents)}
                            </span>
                          </p>
                          <ul className="entry-list">
                            {d.entries.map((e) => (
                              <li key={e.occurrence.id}>
                                <EntryButton e={e} onOpen={onOpen} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Timeline({ rows, lowDate, onSelect, anchor }: { rows: DayRow[]; lowDate: DateStr | null; onSelect: (d: DateStr) => void; anchor: DateStr | null }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.filter((r) => r.entries.length > 0 || r.date === lowDate);
  return (
    <section aria-labelledby="timeline-heading" className="stack-sm">
      <SectionLabel
        id="timeline-heading"
        action={
          <label className="toggle">
            <input type="checkbox" role="switch" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            <span className="toggle-track" aria-hidden="true" />
            Show every day
          </label>
        }
      >
        Day by day
      </SectionLabel>
      <div className="card list-card">
        {shown.length === 0 ? (
          <p className="muted card-note">Nothing scheduled in this period.</p>
        ) : (
          <ol className="timeline">
            {shown.map((r) => {
              const negative = r.tallyCents !== null && r.tallyCents < 0;
              return (
                <li key={r.date} className={`${negative ? 'negative' : ''}${r.date === lowDate ? ' low' : ''}`}>
                  <button type="button" className="timeline-row" onClick={() => onSelect(r.date)} aria-label={`Show ${formatLong(r.date)} on the calendar`}>
                    <span className="tl-date">{shortDay(r.date)}</span>
                    <span className="tl-cell">
                      <span className="tl-label">In</span>
                      <span className="amount amount-in">{r.inCents ? `+${formatMoney(r.inCents)}` : '—'}</span>
                    </span>
                    <span className="tl-cell">
                      <span className="tl-label">Out</span>
                      <span className="amount amount-out">{r.outCents ? `−${formatMoney(r.outCents)}` : '—'}</span>
                    </span>
                    <span className="tl-cell">
                      <span className="tl-label">Net</span>
                      <span>{formatSignedMoney(r.netCents)}</span>
                    </span>
                    <span className="tl-cell tl-tally">
                      <span className="tl-label">Cash flow</span>
                      <span>
                        {negative && <Icon icon={TrendingDown} size={14} />}
                        {tallyText(r.tallyCents)}
                        {negative && <span className="sr-only"> (below zero)</span>}
                      </span>
                    </span>
                    {r.date === lowDate && <span className="badge badge-low tl-badge">Lowest point</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {anchor && rows.some((r) => r.tallyCents === null) && (
          <p className="hint card-note">“—” means the day is on or before {formatMedium(anchor)}, when the projected cash flow begins.</p>
        )}
      </div>
    </section>
  );
}
