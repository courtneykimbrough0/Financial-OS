import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  TrendingDown,
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
import { doneVerb } from '../../domain/types';
import { useStore } from '../../state/store';
import { EmptyState, FlowAmount, Icon, KindAvatar, KindTag, Modal, SectionLabel, StatusBadge } from '../components/common';
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

/**
 * Which bottom sheet is open. Details live in sheets so the dashboard itself
 * stays short: tap a day, a week, or the overdue banner to see more. An
 * occurrence opened from another sheet returns to it when closed.
 */
type Sheet =
  | { kind: 'day'; date: DateStr }
  | { kind: 'week'; start: DateStr; end: DateStr }
  | { kind: 'overdue' }
  | { kind: 'occurrence'; id: string; back: Sheet | null }
  | { kind: 'about-tally' }
  | { kind: 'calendar-key' };

export function Dashboard() {
  const { data, today } = useStore();
  const [view, setView] = useState<View>('month');
  const [focus, setFocus] = useState<DateStr>(today);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [customStart, setCustomStart] = useState<DateStr>(today);
  const [customEnd, setCustomEnd] = useState<DateStr>(addDays(today, 30));
  const [selected, setSelected] = useState<DateStr | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

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
  const openOccurrence = (id: string, back: Sheet | null = null) => setSheet({ kind: 'occurrence', id, back });
  const openDay = (date: DateStr) => {
    setSelected(date);
    setSheet({ kind: 'day', date });
  };

  return (
    <div className="dashboard stack-lg">
      <header className="screen-header">
        <h1>
          <span className="sr-only">Your cash flow, </span>
          {shortDay(today)}
        </h1>
      </header>

      {forecast.issue && <IssueCard forecast={forecast} />}
      {overdue.length > 0 && (
        <button type="button" className="overdue-banner" onClick={() => setSheet({ kind: 'overdue' })}>
          <Icon icon={AlertCircle} size={20} />
          <span>{overdue.length === 1 ? '1 transaction needs an update' : `${overdue.length} transactions need an update`}</span>
          <Icon icon={ChevronRight} size={18} />
        </button>
      )}

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
            <div className="stack-sm">
              <PeriodNav
                label={formatRange(cycle.start, cycle.end)}
                prevLabel="Previous pay period"
                nextLabel="Next pay period"
                onPrev={cycleIndex > 0 ? () => setCycleIndex(cycleIndex - 1) : undefined}
                onNext={cycleIndex < cycles.length - 1 ? () => setCycleIndex(cycleIndex + 1) : undefined}
              />
              <p className="hint center">
                Pay period {cycleIndex + 1} of {cycles.length} · starts with {cycle.paydayEntries.map((e) => e.occurrence.description).join(' and ')} · next income {formatShort(addDays(cycle.end, 1))}
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
            key={view}
            forecast={forecast}
            range={range}
            view={view}
            today={today}
            selected={selected && selected >= range[0] && selected <= range[1] ? selected : null}
            onDay={openDay}
            onWeek={(start, end) => setSheet({ kind: 'week', start, end })}
            onInfo={(kind) => setSheet({ kind })}
          />
        )}
      </section>

      {sheet?.kind === 'occurrence' && <OccurrenceSheet occurrenceId={sheet.id} onClose={() => setSheet(sheet.back)} />}
      {sheet?.kind === 'day' && (
        <DaySheet forecast={forecast} date={sheet.date} onClose={() => setSheet(null)} onOpen={(id) => openOccurrence(id, sheet)} />
      )}
      {sheet?.kind === 'week' && (
        <WeekSheet forecast={forecast} start={sheet.start} end={sheet.end} onClose={() => setSheet(null)} onOpen={(id) => openOccurrence(id, sheet)} />
      )}
      {sheet?.kind === 'overdue' && (
        <Modal title={overdue.length === 1 ? '1 transaction needs an update' : `${overdue.length} transactions need an update`} onClose={() => setSheet(null)}>
          <OverdueList entries={overdue} onOpen={(id) => openOccurrence(id, overdue.length > 1 ? sheet : null)} />
        </Modal>
      )}
      {sheet?.kind === 'about-tally' && forecast.anchor && forecast.forecastStart && (
        <Modal title="How projected cash flow works" onClose={() => setSheet(null)}>
          <div className="stack">
            <p>
              Projected cash flow starts at $0 on {formatMedium(forecast.anchor)}, the day before your next expected payday ({formatMedium(forecast.forecastStart)}), and adds money in and subtracts money out
              day by day.
            </p>
            <p>It shows timing, separate from your bank balance. A number below $0 means scheduled money out runs ahead of money in by that amount.</p>
            <p className="hint">Days on or before {formatMedium(forecast.anchor)} show “—” in place of a projected cash flow.</p>
          </div>
        </Modal>
      )}
      {sheet?.kind === 'calendar-key' && (
        <Modal title="Calendar key" onClose={() => setSheet(null)}>
          <CalendarKey />
        </Modal>
      )}
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

function OverdueList({ entries, onOpen }: { entries: ForecastEntry[]; onOpen: (id: string) => void }) {
  return (
    <div className="stack">
      <p className="muted">These dates have passed. Record what happened, or change the expected date. They stay in your forecast until you do.</p>
      <ul className="entry-list overdue-list">
        {entries.map((e) => (
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
                  Mark {doneVerb(e.occurrence.kind)}
                  <Icon icon={ChevronRight} size={14} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
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
      {onToday && (
        <button type="button" className="button small secondary" onClick={onToday}>
          Today
        </button>
      )}
      <button type="button" className="icon-button" onClick={onNext} disabled={!onNext} aria-label={nextLabel}>
        <Icon icon={ChevronRight} size={22} />
      </button>
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
  onDay,
  onWeek,
  onInfo,
}: {
  forecast: Forecast;
  range: [DateStr, DateStr];
  view: View;
  today: DateStr;
  selected: DateStr | null;
  onDay: (d: DateStr) => void;
  onWeek: (start: DateStr, end: DateStr) => void;
  onInfo: (kind: 'about-tally' | 'calendar-key') => void;
}) {
  const [start, end] = range;
  const rows = useMemo(() => dailyTimeline(forecast, start, end), [forecast, start, end]);
  const kpis = periodKpis(forecast, start, end);
  const low = lowestPoint(rows);
  const negatives = negativeStretches(rows);

  return (
    <>
      <TallyHero forecast={forecast} low={low} negatives={negatives} today={today} onInfo={() => onInfo('about-tally')} />

      <div className="calendar-card">
        <Calendar rows={rows} start={start} end={end} today={today} selected={selected} lowDate={low?.date ?? null} onSelect={onDay} />
        <dl className="kpis totals-strip" aria-label={`Totals for ${formatRange(start, end)}`}>
          <div>
            <dt>Projected income</dt>
            <dd className="amount-in">{formatMoney(kpis.incomeCents)}</dd>
          </div>
          <div>
            <dt>Projected expenses</dt>
            <dd className="amount-out">{formatMoney(kpis.outflowCents)}</dd>
          </div>
          <div>
            <dt>Left to spend</dt>
            <dd className={kpis.netCents < 0 ? 'negative' : ''}>{formatSignedMoney(kpis.netCents)}</dd>
          </div>
        </dl>
        <div className="calendar-actions">
          <p className="hint">Expenses include savings. Left to spend is income minus expenses for this period. Tap a day for details.</p>
          <button type="button" className="button small link" onClick={() => onInfo('calendar-key')}>
            <Icon icon={Info} size={16} /> Calendar key
          </button>
        </div>
      </div>

      <Breakdown forecast={forecast} rows={rows} view={view} start={start} lowDate={low?.date ?? null} onDay={onDay} onWeek={onWeek} />
    </>
  );
}

/** The headline card: the lowest projected cash flow in view, any timing gap, and the next expected payday. */
function TallyHero({ forecast, low, negatives, today, onInfo }: { forecast: Forecast; low: LowPoint | null; negatives: NegativeStretch[]; today: DateStr; onInfo: () => void }) {
  if (!forecast.anchor || !forecast.forecastStart) return null;
  const payday = forecast.forecastStart;
  const daysToPayday = diffDays(today, payday);
  const worst = negatives.reduce<NegativeStretch | null>((w, n) => (w === null || n.lowestCents < w.lowestCents ? n : w), null);
  return (
    <section className="card hero" aria-labelledby="hero-label">
      <div className="hero-body">
        <div className="hero-top">
          <p className="hero-label" id="hero-label">
            Lowest projected cash flow
          </p>
          <button type="button" className="icon-button small-icon" onClick={onInfo} aria-label="How projected cash flow works">
            <Icon icon={Info} size={20} />
          </button>
        </div>
        {low ? (
          <p className={`hero-value${low.tallyCents < 0 ? ' negative' : ''}`}>
            {low.tallyCents < 0 && <Icon icon={TrendingDown} size={28} />}
            {formatMoney(low.tallyCents)}
            <span className="hero-when">on {formatShort(low.date)}</span>
          </p>
        ) : (
          <p className="hero-sub">This period ends before your projected cash flow begins on {formatMedium(payday)}.</p>
        )}
        {worst && (
          <p className="callout callout-danger gap-line" role="note">
            <Icon icon={TrendingDown} size={16} />
            <span>
              <strong>Timing gap ahead</strong> · {formatRange(worst.start, worst.end)}, by up to {formatMoney(-worst.lowestCents)}
              {negatives.length > 1 && ` (+${negatives.length - 1} more)`}
            </span>
          </p>
        )}
        {low && !worst && (
          <p className="callout callout-ok gap-line">
            <Icon icon={Check} size={16} />
            <span>Stays at or above $0 this period</span>
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
  selected: DateStr | null;
  lowDate: DateStr | null;
  onSelect: (d: DateStr) => void;
}) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const days = eachDay(startOfWeek(start), endOfWeek(end));
  const weeks: DateStr[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
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
                  <button type="button" className={classes} aria-haspopup="dialog" aria-label={dayAriaLabel(row, date, date === lowDate)} onClick={() => onSelect(date)}>
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
  );
}

function CalendarKey() {
  const items: [ReactNode, string][] = [
    [<span className="chip chip-in chip-expected legend-chip">+$1.8k</span>, 'Money in (green)'],
    [<span className="chip chip-out chip-expected legend-chip">−$350</span>, 'Money out: expenses, including savings (indigo)'],
    [<span className="chip chip-out chip-done legend-chip">−$350</span>, 'Filled chip: everything that day is done (received or paid)'],
    [<span className="chip chip-out chip-expected legend-chip">−$350</span>, 'Outlined chip: still expected'],
    [<Icon icon={AlertCircle} size={18} className="flag-overdue" />, 'Overdue: the date passed and it hasn’t been recorded'],
    [<Icon icon={TrendingDown} size={18} className="flag-neg" />, 'Projected cash flow is below $0 that day'],
    [<span className="flag-low">Low</span>, 'Lowest projected cash flow in this period'],
    [<span className="today-dot">11</span>, 'Today'],
  ];
  return (
    <ul className="key-list">
      {items.map(([mark, text]) => (
        <li key={text}>
          <span className="key-mark" aria-hidden="true">
            {mark}
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

/** Weeks | Days pill switch: one compact list at a time. Rows open sheets with the details. */
function Breakdown({
  forecast,
  rows,
  view,
  start,
  lowDate,
  onDay,
  onWeek,
}: {
  forecast: Forecast;
  rows: DayRow[];
  view: View;
  start: DateStr;
  lowDate: DateStr | null;
  onDay: (d: DateStr) => void;
  onWeek: (start: DateStr, end: DateStr) => void;
}) {
  const showWeeks = view === 'month';
  const [tab, setTab] = useState<'weeks' | 'days'>(showWeeks ? 'weeks' : 'days');
  const [showAll, setShowAll] = useState(false);
  const active = showWeeks ? tab : 'days';
  return (
    <section aria-labelledby="breakdown-heading" className="stack-sm">
      <SectionLabel
        id="breakdown-heading"
        action={
          active === 'days' ? (
            <label className="toggle">
              <input type="checkbox" role="switch" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              <span className="toggle-track" aria-hidden="true" />
              Show every day
            </label>
          ) : undefined
        }
      >
        {showWeeks ? 'Breakdown' : 'Day by day'}
      </SectionLabel>
      <div className="card list-card">
        {showWeeks && (
          <div className="pill-tabs" role="tablist" aria-label="Breakdown">
            <button type="button" role="tab" aria-selected={tab === 'weeks'} className={tab === 'weeks' ? 'active' : ''} onClick={() => setTab('weeks')}>
              Week by week
            </button>
            <button type="button" role="tab" aria-selected={tab === 'days'} className={tab === 'days' ? 'active' : ''} onClick={() => setTab('days')}>
              Day by day
            </button>
          </div>
        )}
        {active === 'weeks' ? (
          <WeekList forecast={forecast} monthDate={start} onWeek={onWeek} />
        ) : (
          <Timeline rows={showAll ? rows : rows.filter((r) => r.entries.length > 0 || r.date === lowDate)} lowDate={lowDate} onSelect={onDay} anchor={forecast.anchor} anyBeforeAnchor={rows.some((r) => r.tallyCents === null)} />
        )}
      </div>
    </section>
  );
}

function WeekList({ forecast, monthDate, onWeek }: { forecast: Forecast; monthDate: DateStr; onWeek: (start: DateStr, end: DateStr) => void }) {
  const weeks = useMemo(() => monthWeekSummaries(forecast, monthDate), [forecast, monthDate]);
  return (
    <>
      <ul className="week-list">
        {weeks.map((w) => (
          <li key={w.start}>
            <button type="button" className="week-row" aria-haspopup="dialog" onClick={() => onWeek(w.start, w.end)}>
              <span className="week-label">{formatRange(w.start, w.end)}</span>
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
              <Icon icon={ChevronRight} size={18} className="chevron" />
            </button>
          </li>
        ))}
      </ul>
      <p className="hint card-note">Weeks run Sunday to Saturday. Tap a week for its days.</p>
    </>
  );
}

function Timeline({
  rows,
  lowDate,
  onSelect,
  anchor,
  anyBeforeAnchor,
}: {
  rows: DayRow[];
  lowDate: DateStr | null;
  onSelect: (d: DateStr) => void;
  anchor: DateStr | null;
  anyBeforeAnchor: boolean;
}) {
  return (
    <>
      {rows.length === 0 ? (
        <p className="muted card-note">Nothing scheduled in this period.</p>
      ) : (
        <ol className="timeline">
          {rows.map((r) => {
            const negative = r.tallyCents !== null && r.tallyCents < 0;
            return (
              <li key={r.date} className={`${negative ? 'negative' : ''}${r.date === lowDate ? ' low' : ''}`}>
                <button type="button" className="timeline-row" aria-haspopup="dialog" onClick={() => onSelect(r.date)} aria-label={`Show details for ${formatLong(r.date)}`}>
                  <span className="tl-date">
                    {shortDay(r.date)}
                    {r.date === lowDate && <span className="badge badge-low">Lowest point</span>}
                  </span>
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
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {anchor && anyBeforeAnchor && <p className="hint card-note">“—” means the day is on or before {formatMedium(anchor)}, when the projected cash flow begins.</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sheets

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

function DayTotals({ row }: { row: DayRow }) {
  return (
    <dl className="sheet-stats">
      <div>
        <dt>Money in</dt>
        <dd className="amount-in">{row.inCents ? `+${formatMoney(row.inCents)}` : '—'}</dd>
      </div>
      <div>
        <dt>Money out</dt>
        <dd className="amount-out">{row.outCents ? `−${formatMoney(row.outCents)}` : '—'}</dd>
      </div>
      <div>
        <dt>Projected cash flow</dt>
        <dd className={row.tallyCents !== null && row.tallyCents < 0 ? 'negative' : ''}>
          {row.tallyCents !== null && row.tallyCents < 0 && <Icon icon={TrendingDown} size={14} />}
          {tallyText(row.tallyCents)}
        </dd>
      </div>
    </dl>
  );
}

function DaySheet({ forecast, date, onClose, onOpen }: { forecast: Forecast; date: DateStr; onClose: () => void; onOpen: (id: string) => void }) {
  const row = dailyTimeline(forecast, date, date)[0]!;
  return (
    <Modal title={formatLong(date)} onClose={onClose}>
      <DayTotals row={row} />
      {row.tallyCents !== null && row.tallyCents < 0 && <p className="hint">Below $0: scheduled money out is ahead of money in by {formatMoney(-row.tallyCents)} at the end of this day.</p>}
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
    </Modal>
  );
}

function WeekSheet({ forecast, start, end, onClose, onOpen }: { forecast: Forecast; start: DateStr; end: DateStr; onClose: () => void; onOpen: (id: string) => void }) {
  const days = dailyTimeline(forecast, start, end);
  const k = periodKpis(forecast, start, end);
  const active = days.filter((d) => d.entries.length > 0);
  return (
    <Modal title={`Week of ${formatRange(start, end)}`} onClose={onClose}>
      <dl className="sheet-stats">
        <div>
          <dt>Projected income</dt>
          <dd className="amount-in">+{formatMoney(k.incomeCents)}</dd>
        </div>
        <div>
          <dt>Projected expenses</dt>
          <dd className="amount-out">−{formatMoney(k.outflowCents)}</dd>
        </div>
        <div>
          <dt>Left to spend</dt>
          <dd className={k.netCents < 0 ? 'negative' : ''}>{formatSignedMoney(k.netCents)}</dd>
        </div>
      </dl>
      {active.length === 0 ? (
        <p className="muted">Nothing scheduled this week.</p>
      ) : (
        active.map((d) => (
          <section key={d.date} className="week-day" aria-label={formatLong(d.date)}>
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
          </section>
        ))
      )}
    </Modal>
  );
}
