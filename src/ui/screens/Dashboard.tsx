import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Banknote,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
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
  negativeStretches,
  overdueEntries,
  reviewEntries,
  explainTimingGaps,
  GAP_LOOKAHEAD_DAYS,
  paycheckCycles,
  weekSummaries,
  type DayRow,
  type Forecast,
  type ForecastEntry,
  type LowPoint,
  type NegativeStretch,
} from '../../domain/forecast';
import { formatCompact, formatMoney, formatSignedMoney } from '../../domain/money';
import { periodPlan, type PeriodPlan } from '../../domain/plan';
import { useStore } from '../../state/store';
import { EmptyState, FlowAmount, Icon, KindAvatar, KindTag, Modal, SectionLabel, StatusBadge } from '../components/common';
import { OccurrenceSheet } from '../components/OccurrenceSheet';
import { ReviewSheet } from '../components/ReviewSheet';
import { GapsSheet } from '../components/gaps';
import { WhatIfSheet } from '../components/WhatIfSheet';
import { PeriodBreakdown, TagBreakdown } from '../components/plan';
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
 * stays short: tap a day or the overdue banner to see more. An
 * occurrence opened from another sheet returns to it when closed.
 */
type Sheet =
  | { kind: 'day'; date: DateStr }
  | { kind: 'review'; title: string; closeIfEmpty?: boolean }
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
  const overdueTitle = overdue.length === 1 ? '1 transaction needs an update' : `${overdue.length} transactions need an update`;
  const review = reviewEntries(forecast);
  const toReview = review.attention.length + review.upcoming.length;
  useEffect(() => {
    if (sheet?.kind === 'review' && sheet.closeIfEmpty && toReview === 0) setSheet(null);
  }, [sheet, toReview]);
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
      {overdue.length > 0 ? (
        <button type="button" className="overdue-banner" onClick={() => setSheet({ kind: 'review', title: overdueTitle })}>
          <Icon icon={AlertCircle} size={20} />
          <span>{overdueTitle}</span>
          <Icon icon={ChevronRight} size={18} />
        </button>
      ) : (
        toReview > 0 && (
          <button type="button" className="button small secondary review-start" onClick={() => setSheet({ kind: 'review', title: 'Review this week' })}>
            Review this week · {toReview}
          </button>
        )
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
                Pay period {cycleIndex + 1} of {cycles.length} · starts with {cycle.paydayEntries.map((e) => e.occurrence.description).join(' and ')} · next main payday {formatShort(addDays(cycle.end, 1))}
              </p>
            </div>
          ) : (
            <EmptyState title="Pay periods aren’t available yet">
              <p>
                {forecast.issue
                  ? 'Add a recurring income with its next payment date. Pay periods run from one main payday to the next.'
                  : 'We need at least two upcoming main paydays to show a pay period. Check that your main paycheck is turned on.'}
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
            onInfo={(kind) => setSheet({ kind })}
          />
        )}
      </section>

      {sheet?.kind === 'occurrence' && (
        // Back to the review list after handling an item, unless that left nothing to review.
        <OccurrenceSheet occurrenceId={sheet.id} onClose={() => setSheet(sheet.back?.kind === 'review' ? { ...sheet.back, closeIfEmpty: true } : sheet.back)} />
      )}
      {sheet?.kind === 'day' && (
        <DaySheet forecast={forecast} date={sheet.date} onClose={() => setSheet(null)} onOpen={(id) => openOccurrence(id, sheet)} />
      )}
      {sheet?.kind === 'review' && !(sheet.closeIfEmpty && toReview === 0) && (
        <ReviewSheet
          forecast={forecast}
          title={sheet.title}
          onOpen={(id) => openOccurrence(id, sheet)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'about-tally' && forecast.anchor && forecast.forecastStart && (
        <Modal title="How cash flow and the running total work" onClose={() => setSheet(null)}>
          <div className="stack">
            <p>
              <strong>Cash flow</strong> is income minus expenses (including savings) for the period you’re looking at.
            </p>
            <p>
              The <strong>running total</strong> starts at $0 on {formatMedium(forecast.anchor)}, the day before your next expected payday ({formatMedium(forecast.forecastStart)}), and adds money in and subtracts money out
              day by day. It shows timing, separate from your bank balance. Below $0 means scheduled money out runs ahead of money in by that amount.
            </p>
            <p className="hint">Days on or before {formatMedium(forecast.anchor)} show “—” in place of a running total.</p>
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
          ? 'Your running total starts the day before your next expected payday, so we need at least one recurring income (like a paycheck or benefits) with its next payment date.'
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
  onInfo,
}: {
  forecast: Forecast;
  range: [DateStr, DateStr];
  view: View;
  today: DateStr;
  selected: DateStr | null;
  onDay: (d: DateStr) => void;
  onInfo: (kind: 'about-tally' | 'calendar-key') => void;
}) {
  const [start, end] = range;
  const rows = useMemo(() => dailyTimeline(forecast, start, end), [forecast, start, end]);
  const plan = useMemo(() => periodPlan(forecast, start, end), [forecast, start, end]);
  const low = lowestPoint(rows);
  const negatives = negativeStretches(rows);

  return (
    <>
      <CashFlowHero forecast={forecast} plan={plan} low={low} negatives={negatives} range={range} today={today} onInfo={() => onInfo('about-tally')} />

      <div className="calendar-card">
        <Calendar rows={rows} start={start} end={end} today={today} selected={selected} lowDate={low?.date ?? null} onSelect={onDay} />
        <div className="calendar-actions">
          <p className="hint">Tap a day for details.</p>
          <button type="button" className="button small link" onClick={() => onInfo('calendar-key')}>
            <Icon icon={Info} size={16} /> Calendar key
          </button>
        </div>
      </div>

      <PeriodBreakdown plan={plan} title="Breakdown" showRange={false} />
      <TagBreakdown plan={plan} />

      {view === 'week' ? (
        <section aria-labelledby="days-heading" className="stack-sm">
          <SectionLabel id="days-heading">Day by day</SectionLabel>
          <div className="card list-card">
            <Timeline rows={rows} lowDate={low?.date ?? null} onSelect={onDay} anchor={forecast.anchor} anyBeforeAnchor={rows.some((r) => r.tallyCents === null)} />
          </div>
        </section>
      ) : (
        <WeekList forecast={forecast} start={start} end={end} lowDate={low?.date ?? null} onDay={onDay} />
      )}
    </>
  );
}

/** Explains every timing gap that overlaps the period in view. */
function PeriodGapsSheet({ forecast, range, onClose }: { forecast: Forecast; range: [DateStr, DateStr]; onClose: () => void }) {
  const [start, end] = range;
  const gaps = useMemo(() => {
    if (!forecast.forecastStart) return [];
    const days = Math.max(GAP_LOOKAHEAD_DAYS, diffDays(forecast.forecastStart, end) + 1);
    return explainTimingGaps(forecast, days).filter((g) => g.end >= start && g.start <= end);
  }, [forecast, start, end]);
  const [whatIf, setWhatIf] = useState<string | null>(null);
  if (whatIf) return <WhatIfSheet occurrenceId={whatIf} onBack={() => setWhatIf(null)} onDone={onClose} />;
  if (gaps.length === 0) return null;
  return <GapsSheet gaps={gaps} horizonEnd={forecast.horizonEnd} onClose={onClose} onWhatIf={setWhatIf} />;
}

/**
 * The headline card: cash flow (income minus expenses) for the period in view,
 * then the lowest running total, any timing gap, and the next expected payday.
 */
function CashFlowHero({
  forecast,
  plan,
  low,
  negatives,
  range,
  today,
  onInfo,
}: {
  forecast: Forecast;
  plan: PeriodPlan;
  low: LowPoint | null;
  negatives: NegativeStretch[];
  range: [DateStr, DateStr];
  today: DateStr;
  onInfo: () => void;
}) {
  const [showGaps, setShowGaps] = useState(false);
  const payday = forecast.forecastStart;
  const daysToPayday = payday ? diffDays(today, payday) : 0;
  const worst = negatives.reduce<NegativeStretch | null>((w, n) => (w === null || n.lowestCents < w.lowestCents ? n : w), null);
  const negative = plan.cashFlowCents < 0;
  return (
    <section className="card hero" aria-labelledby="hero-label">
      <div className="hero-body">
        <div className="hero-top">
          <p className="hero-label" id="hero-label">
            Cash flow
          </p>
          <button type="button" className="icon-button small-icon" onClick={onInfo} aria-label="How cash flow and the running total work">
            <Icon icon={Info} size={20} />
          </button>
        </div>
        <p className={`hero-value${negative ? ' negative' : ''}`}>
          {negative && <Icon icon={TrendingDown} size={28} />}
          {formatSignedMoney(plan.cashFlowCents)}
        </p>
        <p className="hero-sub">
          <span className="amount-in">+{formatMoney(plan.incomeCents)}</span> in · <span className="amount-out">−{formatMoney(plan.expensesCents)}</span> out
        </p>
        {payday && (
          <div className="hero-stat">
            <span className="muted">Lowest running total</span>
            {low ? (
              <span className={low.tallyCents < 0 ? 'negative-text' : ''}>
                <strong>{formatMoney(low.tallyCents)}</strong>
                <span className="muted"> · {formatShort(low.date)}</span>
              </span>
            ) : (
              <span className="muted">Starts {formatShort(payday)}</span>
            )}
          </div>
        )}
        {worst && (
          <button type="button" className="callout callout-danger gap-line" onClick={() => setShowGaps(true)} aria-haspopup="dialog">
            <Icon icon={TrendingDown} size={16} />
            <span>
              <strong>Timing gap ahead</strong> · {formatRange(worst.start, worst.end)}, by up to {formatMoney(-worst.lowestCents)}
              {negatives.length > 1 && ` (+${negatives.length - 1} more)`}
            </span>
            <Icon icon={ChevronRight} size={16} />
          </button>
        )}
        {showGaps && <PeriodGapsSheet forecast={forecast} range={range} onClose={() => setShowGaps(false)} />}
        {low && !worst && (
          <p className="callout callout-ok gap-line">
            <Icon icon={Check} size={16} />
            <span>Running total stays at or above $0 this period</span>
          </p>
        )}
      </div>
      {payday && (
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
      )}
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
  if (row.tallyCents !== null) bits.push(`running total ${formatMoney(row.tallyCents)}${row.tallyCents < 0 ? ', below zero' : ''}`);
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
    [<Icon icon={TrendingDown} size={18} className="flag-neg" />, 'Running total is below $0 that day'],
    [<span className="flag-low">Low</span>, 'Lowest running total in this period'],
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

/** Week by week. Each week opens in place to show its days, with the running total at the end of each day. */
function WeekList({ forecast, start, end, lowDate, onDay }: { forecast: Forecast; start: DateStr; end: DateStr; lowDate: DateStr | null; onDay: (d: DateStr) => void }) {
  const weeks = useMemo(() => weekSummaries(forecast, start, end), [forecast, start, end]);
  const [open, setOpen] = useState<DateStr | null>(null);
  return (
    <section aria-labelledby="weeks-heading" className="stack-sm">
      <SectionLabel id="weeks-heading">Week by week</SectionLabel>
      <div className="card list-card">
        <ul className="week-list">
          {weeks.map((w) => {
            const expanded = open === w.start;
            const negative = w.endTallyCents !== null && w.endTallyCents < 0;
            return (
              <li key={w.start} className={expanded ? 'open' : ''}>
                <button type="button" className="week-row" aria-expanded={expanded} aria-controls={`week-${w.start}`} onClick={() => setOpen(expanded ? null : w.start)}>
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
                    <span className={w.netCents < 0 ? 'week-net negative' : 'week-net'}>Net {formatSignedMoney(w.netCents)}</span>
                    <span className={negative ? 'week-tally negative' : 'week-tally'}>
                      {negative && <Icon icon={TrendingDown} size={14} />}
                      Running total {tallyText(w.endTallyCents)}
                    </span>
                  </span>
                  <Icon icon={expanded ? ChevronUp : ChevronDown} size={18} className="chevron" />
                </button>
                {expanded && (
                  <div id={`week-${w.start}`} className="week-days">
                    <Timeline rows={w.days} lowDate={lowDate} onSelect={onDay} anchor={forecast.anchor} anyBeforeAnchor={w.days.some((r) => r.tallyCents === null)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="hint card-note">Weeks run Sunday to Saturday. Tap a week to see its days, and a day for its transactions.</p>
      </div>
    </section>
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
                    {r.date === lowDate && <span className="badge badge-low">Lowest</span>}
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
                    <span className="tl-label">Running total</span>
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
      {anchor && anyBeforeAnchor && <p className="hint card-note">“—” means the day is on or before {formatMedium(anchor)}, when the running total begins.</p>}
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
        <dt>Running total</dt>
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
