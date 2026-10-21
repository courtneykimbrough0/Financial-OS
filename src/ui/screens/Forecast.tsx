import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, Banknote, Check, ChevronDown, ChevronRight, ChevronUp, Info, TrendingDown } from 'lucide-react';
import {
  addDays,
  diffDays,
  addMonthsClamped,
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
  explainTimingGaps,
  GAP_LOOKAHEAD_DAYS,
  weekSummaries,
  type DayRow,
  type Forecast,
  type ForecastEntry,
  type LowPoint,
  type NegativeStretch,
  type WeekSummary,
} from '../../domain/forecast';
import { formatCompact, formatMoney, formatMoneyIn, formatMoneyOut, formatSignedMoney } from '../../domain/money';
import { periodPlan, type PeriodPlan } from '../../domain/plan';
import { useStore } from '../../state/store';
import { Icon, Modal, SectionLabel } from '../components/common';
import { EntryButton, PeriodNav, shortDay } from '../components/entries';
import { OccurrenceSheet } from '../components/OccurrenceSheet';
import { ScenarioSheet } from '../components/ScenarioSheet';
import { GapsSheet } from '../components/gaps';
import { PeriodBreakdown, TagBreakdown } from '../components/plan';
import { DayTransfers } from '../components/money-accounts';
import { consumeForecastDate, navigate, parseForecastDate } from '../router';
import { agendaItems, dayIsActive, isNegative, weekIsActive } from '../visibility';

/** Forecast views. The week has its own place on Home; here each period lists its weeks, and a week opens its days. */
type View = 'month' | 'custom';

const VIEWS: { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'custom', label: 'Custom' },
];

// ---------------------------------------------------------------------------

/**
 * Which bottom sheet is open. Details live in sheets so the forecast itself
 * stays short: tap a day to see more. An occurrence opened from a day
 * returns to it when closed.
 */
type Sheet =
  | { kind: 'day'; date: DateStr }
  | { kind: 'occurrence'; id: string; back: Sheet | null }
  | { kind: 'about-tally' }
  | { kind: 'calendar-key' }
  | { kind: 'scenario' };

export function Forecast() {
  const { data, today } = useStore();
  const [view, setView] = useState<View>('month');
  const [focus, setFocus] = useState<DateStr>(() => consumeForecastDate() ?? parseForecastDate() ?? today);
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
    if (view === 'custom') return customError ? null : [customStart, customEnd];
    return null;
  }, [view, focus, customStart, customEnd, customError]);

  const forecast = useMemo(() => buildForecast(data, today, { through: fixedRange?.[1] }), [data, today, fixedRange]);
  const range = fixedRange;

  const openOccurrence = (id: string, back: Sheet | null = null) => setSheet({ kind: 'occurrence', id, back });
  const openDay = (date: DateStr) => {
    setSelected(date);
    setSheet({ kind: 'day', date });
  };

  return (
    <div className="forecast stack-lg">
      <header className="screen-header">
        <h1>
          <span className="sr-only">Your cash flow, </span>
          {shortDay(today)}
        </h1>
      </header>

      {forecast.issue && <IssueCard forecast={forecast} />}
      {forecast.issue !== 'no-recurring-income' && (
        <>
          <button type="button" className="button small secondary scenario-entry" onClick={() => setSheet({ kind: 'scenario' })} aria-haspopup="dialog">
            See what happens if…
          </button>

          <div className="segmented" role="tablist" aria-label="Forecast view">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                id={`tab-${v.id}`}
                aria-selected={view === v.id}
                aria-controls="forecast-panel"
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

          <section id="forecast-panel" role="tabpanel" aria-labelledby={`tab-${view}`} className="stack-lg">
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
                today={today}
                selected={selected && selected >= range[0] && selected <= range[1] ? selected : null}
                onDay={openDay}
                onInfo={(kind) => setSheet({ kind })}
              />
            )}
          </section>
        </>
      )}

      {sheet?.kind === 'occurrence' && (
        <OccurrenceSheet occurrenceId={sheet.id} onClose={() => setSheet(sheet.back)} />
      )}
      {sheet?.kind === 'day' && (
        <DaySheet forecast={forecast} date={sheet.date} onClose={() => setSheet(null)} onOpen={(id) => openOccurrence(id, sheet)} />
      )}
      {sheet?.kind === 'about-tally' && forecast.anchor && forecast.forecastStart && (
        <Modal title="How cash flow and the running total work" onClose={() => setSheet(null)}>
          <div className="stack">
            <p>
              <strong>Cash flow</strong> is income minus spending and what you save in Strategic Reserves, for the period you're looking at. Reserves stay yours; they're just not available to spend.
            </p>
            <p>
              Your <strong>running total</strong> starts at $0 the day before your next paycheck, then adds what comes in and subtracts what goes out. It shows whether your income arrives in time for your payments; your bank balance can differ.
            </p>
            <p className="hint">Payments due before {formatMedium(forecast.forecastStart)} come from the money you have now.</p>
          </div>
        </Modal>
      )}
      {sheet?.kind === 'scenario' && <ScenarioSheet onClose={() => setSheet(null)} />}
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
          ? "Add your income to see what's ahead."
          : 'None of your recurring income has an upcoming payment. Check its next payment date.'}
      </p>
      <div>
        <button type="button" className="button primary" onClick={() => navigate('plan/income')}>
          Go to Income
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PeriodBody({
  forecast,
  range,
  today,
  selected,
  onDay,
  onInfo,
}: {
  forecast: Forecast;
  range: [DateStr, DateStr];
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
          <button type="button" className="button small link" onClick={() => onInfo('calendar-key')}>
            <Icon icon={Info} size={16} /> Calendar key
          </button>
        </div>
      </div>

      <PeriodBreakdown plan={plan} title="Breakdown" showRange={false} />
      <TagBreakdown plan={plan} />

      <WeekList forecast={forecast} start={start} end={end} today={today} lowDate={low?.date ?? null} onDay={onDay} />
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
  if (whatIf) return <ScenarioSheet occurrenceId={whatIf} through={end} onClose={() => setWhatIf(null)} onApplied={onClose} />;
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
          <span className="amount-in">{formatMoneyIn(plan.incomeCents)}</span> in · <span className="amount-out">{formatMoneyOut(plan.outflowCents)}</span> out
          {plan.reservesCents !== 0 && (
            <>
              {' · '}
              <span className="amount-reserve">{formatMoney(Math.abs(plan.reservesCents))}</span> {plan.reservesCents > 0 ? 'saved' : 'from reserves'}
            </>
          )}
        </p>
        {payday && (!low || low.tallyCents < 0) && (
          <div className="hero-stat">
            <span className="muted">Lowest running total</span>
            {low ? (
              <span className="negative-text">
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
              <strong>Short {formatMoney(-worst.lowestCents)}</strong> · {formatRange(worst.start, worst.end)}
              {negatives.length > 1 && ` (+${negatives.length - 1} more)`}
            </span>
            <Icon icon={ChevronRight} size={16} />
          </button>
        )}
        {showGaps && <PeriodGapsSheet forecast={forecast} range={range} onClose={() => setShowGaps(false)} />}
        {low && !worst && (
          <p className="callout callout-ok gap-line">
            <Icon icon={Check} size={16} />
            <span>You stay above $0 through {formatShort(range[1])}</span>
          </p>
        )}
      </div>
      {payday && (
        <div className="hero-footer">
          <Icon icon={Banknote} size={22} className="hero-footer-icon" />
          <span>
            {daysToPayday > 1
              ? `Next paycheck in ${daysToPayday} days`
              : daysToPayday === 1
                ? 'Next paycheck is tomorrow'
                : daysToPayday === 0
                  ? 'Next paycheck is today'
                  : `Your ${formatShort(payday)} paycheck is overdue`}
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
  if (row.reservedCents) bits.push(row.reservedCents > 0 ? `saved ${formatMoney(row.reservedCents)}` : `from reserves ${formatMoney(-row.reservedCents)}`);
  const overdue = row.entries.filter((e) => e.occurrence.displayStatus === 'overdue').length;
  if (overdue) bits.push(`${overdue} overdue`);
  const done = row.entries.filter((e) => e.occurrence.status === 'completed').length;
  if (done) bits.push(`${done} recorded`);
  if (row.tallyCents !== null) bits.push(`running total ${formatMoney(row.tallyCents)}${row.tallyCents < 0 ? ', below zero' : ''}`);
  if (isLow) bits.push('lowest point');
  return bits.join(', ');
}

/** Chip style for one direction of money on a day: filled when every item is recorded, outlined while any is expected. */
function chipState(entries: ForecastEntry[], dir: 'in' | 'out' | 'reserve'): 'done' | 'expected' {
  const isReserve = (e: ForecastEntry) => e.occurrence.kind === 'reserve';
  const items = entries.filter((e) => e.counts && (dir === 'reserve' ? isReserve(e) : !isReserve(e) && (dir === 'in' ? e.signedCents > 0 : e.signedCents < 0)));
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
      <caption className="sr-only">Calendar for {formatRange(start, end)}. Select a day to see details.</caption>
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
              if (!row || !dayIsActive(row))
                return (
                  <td key={date}>
                    <span className={`${classes} inactive`}>
                      <span className="cal-num">{parts(date).d}</span>
                      {date === lowDate && (
                        <span className="cal-flags">
                          <span className="flag-low">Low</span>
                        </span>
                      )}
                    </span>
                  </td>
                );
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
                      {row && row.reservedCents !== 0 && <span className={`chip chip-reserve chip-${chipState(row.entries, 'reserve')}`}>{row.reservedCents > 0 ? '−' : '+'}{formatCompact(Math.abs(row.reservedCents))}</span>}
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
    [<span className="chip chip-out chip-expected legend-chip">−$350</span>, 'Money out: bills, subscriptions, liabilities and spending (gray, with a −)'],
    [<span className="chip chip-reserve chip-expected legend-chip">−$100</span>, 'Saved in Strategic Reserves (teal)'],
    [<span className="chip chip-out chip-done legend-chip">−$350</span>, 'Filled: received or paid'],
    [<span className="chip chip-out chip-expected legend-chip">−$350</span>, 'Outlined chip: still expected'],
    [<Icon icon={AlertCircle} size={18} className="flag-overdue" />, "Overdue: the date passed and it hasn't been recorded"],
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
function WeekNums({ w }: { w: WeekSummary }) {
  const negative = w.endTallyCents !== null && w.endTallyCents < 0;
  const moved = w.incomeCents !== 0 || w.outflowCents !== 0 || w.reservesCents !== 0;
  return (
    <span className="week-nums">
      {w.incomeCents !== 0 && (
        <span>
          <span className="sr-only">Income </span>
          <span className="amount amount-in">{formatMoneyIn(w.incomeCents)}</span>
        </span>
      )}
      {w.outflowCents !== 0 && (
        <span>
          <span className="sr-only">Spending </span>
          <span className="amount amount-out">{formatMoneyOut(w.outflowCents)}</span>
        </span>
      )}
      {w.reservesCents !== 0 && (
        <span>
          <span className="sr-only">{w.reservesCents > 0 ? 'Saved in reserves ' : 'From reserves '}</span>
          <span className="amount amount-reserve">{formatSignedMoney(-w.reservesCents)}</span>
        </span>
      )}
      {moved && <span className={w.netCents < 0 ? 'week-net negative' : 'week-net'}>Net {formatSignedMoney(w.netCents)}</span>}
      {w.endTallyCents !== null && (
        <span className={negative ? 'week-tally negative' : 'week-tally'}>
          {negative && <Icon icon={TrendingDown} size={14} />}
          Running total {formatMoney(w.endTallyCents)}
        </span>
      )}
    </span>
  );
}

function WeekList({ forecast, start, end, today, lowDate, onDay }: { forecast: Forecast; start: DateStr; end: DateStr; today: DateStr; lowDate: DateStr | null; onDay: (d: DateStr) => void }) {
  const weeks = useMemo(() => weekSummaries(forecast, start, end), [forecast, start, end]);
  const [open, setOpen] = useState<DateStr | null>(null);
  return (
    <section aria-labelledby="weeks-heading" className="stack-sm">
      <SectionLabel id="weeks-heading">Week by week</SectionLabel>
      <div className="card list-card">
        <ul className="week-list">
          {weeks.map((w) => {
            if (!weekIsActive(w))
              return (
                <li key={w.start}>
                  <div className="week-row quiet">
                    <span className="week-label">{formatRange(w.start, w.end)}</span>
                    <span className="week-nums">
                      <span className="muted">Nothing scheduled</span>
                      {w.endTallyCents !== null && <span className="week-tally">Running total {formatMoney(w.endTallyCents)}</span>}
                    </span>
                  </div>
                </li>
              );
            const expanded = open === w.start;
            return (
              <li key={w.start} className={expanded ? 'open' : ''}>
                <button type="button" className="week-row" aria-expanded={expanded} aria-controls={`week-${w.start}`} onClick={() => setOpen(expanded ? null : w.start)}>
                  <span className="week-label">{formatRange(w.start, w.end)}</span>
                  <WeekNums w={w} />
                  <Icon icon={expanded ? ChevronUp : ChevronDown} size={18} className="chevron" />
                </button>
                {expanded && (
                  <div id={`week-${w.start}`} className="week-days">
                    <Timeline rows={w.days} today={today} lowDate={lowDate} onSelect={onDay} forecastStart={forecast.forecastStart} />
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

function Timeline({
  rows,
  today,
  lowDate,
  onSelect,
  forecastStart,
}: {
  rows: DayRow[];
  today: DateStr;
  lowDate: DateStr | null;
  onSelect: (d: DateStr) => void;
  forecastStart: DateStr | null;
}) {
  const items = agendaItems(rows, today);
  // The line goes above the first day with a running total, when earlier days in the week have none.
  const startsHere = forecastStart !== null && rows.some((r) => r.tallyCents === null) && rows.some((r) => r.date === forecastStart);
  return (
    <>
      {items.length === 0 ? (
        <p className="muted card-note">Nothing scheduled this week.</p>
      ) : (
        <ol className="timeline">
          {items.map((item) => {
            if (item.type === 'quiet')
              return (
                <li key={item.start} className="timeline-quiet muted">
                  {item.start === item.end ? shortDay(item.start) : formatRange(item.start, item.end)} · nothing scheduled
                </li>
              );
            const r = item.row;
            const negative = isNegative(r);
            const row = (
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
                    {r.reservedCents !== 0 && (
                      <span className="amount amount-reserve">
                        {formatSignedMoney(-r.reservedCents)}
                        <span className="sr-only">{r.reservedCents > 0 ? ' saved in reserves' : ' from reserves'}</span>
                      </span>
                    )}
                  </span>
                  <span className="tl-cell">
                    <span className="tl-label">Net</span>
                    <span>{formatSignedMoney(r.netCents)}</span>
                  </span>
                  {r.tallyCents !== null && (
                    <span className="tl-cell tl-tally">
                      <span className="tl-label">Running total</span>
                      <span>
                        {negative && <Icon icon={TrendingDown} size={14} />}
                        {formatMoney(r.tallyCents)}
                        {negative && <span className="sr-only"> (below zero)</span>}
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
            if (!startsHere || r.date !== forecastStart) return row;
            return (
              <Fragment key={r.date}>
                <li className="timeline-start hint">Your running total starts {formatShort(forecastStart)}, your next payday.</li>
                {row}
              </Fragment>
            );
          })}
        </ol>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sheets

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
      {row.reservedCents !== 0 && (
        <div>
          <dt>{row.reservedCents > 0 ? 'Saved in reserves' : 'From reserves'}</dt>
          <dd className="amount-reserve">{formatSignedMoney(-row.reservedCents)}</dd>
        </div>
      )}
      {row.tallyCents !== null && (
        <div>
          <dt>Running total</dt>
          <dd className={row.tallyCents < 0 ? 'negative' : ''}>
            {row.tallyCents < 0 && <Icon icon={TrendingDown} size={14} />}
            {formatMoney(row.tallyCents)}
          </dd>
        </div>
      )}
    </dl>
  );
}

function DaySheet({ forecast, date, onClose, onOpen }: { forecast: Forecast; date: DateStr; onClose: () => void; onOpen: (id: string) => void }) {
  const row = dailyTimeline(forecast, date, date)[0]!;
  return (
    <Modal title={formatLong(date)} onClose={onClose}>
      <DayTotals row={row} />
      {row.tallyCents !== null && row.tallyCents < 0 && <p className="hint">Short {formatMoney(-row.tallyCents)} at the end of this day.</p>}
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
      <DayTransfers date={date} />
    </Modal>
  );
}
