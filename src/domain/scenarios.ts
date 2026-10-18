/**
 * Scenarios: several hypothetical changes applied together to a copy of the
 * data, forecast with the same `buildForecast`, and compared with the plan as
 * it is. Every change goes through the ordinary operations (so their
 * validation applies) and the copy is discarded; nothing is saved. A scenario
 * is informational: there is no way to apply one to the plan yet.
 *
 * Hypothetical income is kept apart from confirmed income: it is listed as
 * hypothetical in the assumptions and reported separately in cash flow. Only
 * income the person has entered or recorded is confirmed.
 */
import { addDays, formatMedium, type DateStr } from './dates';
import { buildForecast, periodKpis, tallyOn, type Forecast, type ForecastEntry, type GapExplanation, type LowPoint } from './forecast';
import { formatMoney, type Cents } from './money';
import { expandSource, findOccurrence } from './occurrences';
import * as ops from './operations';
import { compareForecasts, gapChanges } from './preview';
import { describeRule, startKeepsDates } from './recurrence';
import { mainPaycheckId, type AppData, type RecurrenceRule, type TransactionKind } from './types';

/** A recurring schedule for a hypothetical item, or "on each main payday from the next one". */
export type ScenarioSchedule = { startDate: DateStr; rule: RecurrenceRule } | 'each-paycheck';

export type ScenarioChange =
  /** Income that might arrive once. Always hypothetical. */
  | { kind: 'one-time-income'; description: string; amountCents: Cents; date: DateStr }
  /** An unexpected expense, once. */
  | { kind: 'one-time-expense'; description: string; amountCents: Cents; date: DateStr }
  /** An extra payment toward an existing liability, once. */
  | { kind: 'extra-liability-payment'; sourceId: string; amountCents: Cents; date: DateStr }
  /** A different expected amount for one outstanding occurrence. */
  | { kind: 'occurrence-amount'; occurrenceId: string; amountCents: Cents }
  /** A different expected date for one outstanding occurrence. */
  | { kind: 'occurrence-date'; occurrenceId: string; date: DateStr }
  /** A recurring item's amount from one of its payment dates on (for example a higher liability payment). */
  | { kind: 'recurring-amount'; sourceId: string; amountCents: Cents; from: DateStr }
  /** A hypothetical recurring savings contribution. */
  | { kind: 'recurring-savings'; description: string; amountCents: Cents; schedule: ScenarioSchedule }
  /** Hypothetical recurring income (for income that might arrive once, use `one-time-income`). Never confirmed. */
  | { kind: 'hypothetical-income'; description: string; amountCents: Cents; schedule: ScenarioSchedule };

export interface ScenarioAssumption {
  change: ScenarioChange;
  /** Plain description, e.g. "Car repair: −$800.00 once on Nov 5, 2026". */
  label: string;
  direction: 'in' | 'out';
  /** The amount each time it happens (for a moved occurrence, its amount). */
  amountCents: Cents;
  recurrence: 'one-time' | 'recurring';
  /** The dates it lands on within the period. */
  dates: DateStr[];
  /** For income: `hypothetical` when the scenario adds it, `confirmed` when the person entered it. Null for money out. */
  income: 'hypothetical' | 'confirmed' | null;
  /** False when any of its dates are before the next payday, where the running total doesn't reach. */
  inRunningTotal: boolean;
  /** For variable-income cases: which case this is. */
  incomeCase?: IncomeCaseName;
}

export interface ScenarioCashFlow {
  /** Income the person entered or recorded. */
  confirmedIncomeCents: Cents;
  /** Income only this scenario adds. */
  hypotheticalIncomeCents: Cents;
  outflowCents: Cents;
  /** All income minus money out. */
  netCents: Cents;
  /** Confirmed income minus money out: the cash flow if the hypothetical income doesn't arrive. */
  netWithoutHypotheticalCents: Cents;
}

/** One side of the comparison. */
export interface ScenarioOutlook {
  forecastStart: DateStr | null;
  anchor: DateStr | null;
  /** Cash flow for the whole period, from today. */
  cashFlow: ScenarioCashFlow;
  /** Lowest running total in the period, and its date. */
  lowest: LowPoint | null;
  /** Running total on the period's last day. */
  endingCents: Cents | null;
  /** Timing gaps in the period, with recovery dates. */
  gaps: GapExplanation[];
}

export interface ScenarioResult {
  assumptions: ScenarioAssumption[];
  /** Cash flow covers `start` (today) to `end`; the running total runs from `runningTotalFrom` (the next payday) to `end`. */
  period: { start: DateStr; end: DateStr; runningTotalFrom: DateStr | null };
  baseline: ScenarioOutlook;
  scenario: ScenarioOutlook;
  /** False when the two running totals don't start from the same payday, or there is none; the running-total comparisons are then null or empty. */
  comparable: boolean;
  reason: 'no-forecast' | 'anchor-changed' | 'before-payday' | null;
  limitations: string[];
  /** Scenario minus baseline. */
  differences: { incomeCents: Cents; outflowCents: Cents; netCents: Cents; lowestCents: Cents | null; endingCents: Cents | null };
  newGaps: GapExplanation[];
  worsenedGaps: GapExplanation[];
  reducedGaps: GapExplanation[];
  resolvedGaps: GapExplanation[];
  /** True when the scenario ends higher (or has more cash flow) yet creates or deepens a timing gap on the way. */
  shortfallDespiteGain: boolean;
}

export type ScenarioOutcome = { ok: true; result: ScenarioResult } | { ok: false; error: string };

/** Ids of items a scenario adds start with this, so they can be told apart from the person's own. */
export const SCENARIO_ID_PREFIX = 'scenario-';
const isHypothetical = (e: ForecastEntry) => e.occurrence.id.startsWith(SCENARIO_ID_PREFIX) || (e.occurrence.sourceId?.startsWith(SCENARIO_ID_PREFIX) ?? false);

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Applying changes to a copy
// ---------------------------------------------------------------------------

interface Applied {
  data: AppData;
  assumption: Omit<ScenarioAssumption, 'dates' | 'inRunningTotal'> & { dates: (end: DateStr) => DateStr[] };
}

/** The main paycheck's schedule from its next payday that keeps its dates. */
function paycheckSchedule(data: AppData, today: DateStr): { startDate: DateStr; rule: RecurrenceRule } | string {
  const id = mainPaycheckId(data);
  const main = data.sources.find((s) => s.id === id);
  if (!main) return 'There’s no main paycheck to follow. Choose dates instead.';
  const version = [...main.versions].filter((v) => v.startDate <= today).pop() ?? main.versions[0]!;
  for (const gen of expandSource(main, today, addDays(today, 400))) {
    if (startKeepsDates(version.rule, version.startDate, gen.expectedDate)) return { startDate: gen.expectedDate, rule: version.rule };
  }
  return 'The main paycheck has no upcoming payday to follow.';
}

function resolveSchedule(data: AppData, schedule: ScenarioSchedule, today: DateStr) {
  return schedule === 'each-paycheck' ? paycheckSchedule(data, today) : schedule;
}

const sourceDates = (data: AppData, sourceId: string, from: DateStr) => (end: DateStr) => {
  const s = data.sources.find((x) => x.id === sourceId);
  return s ? expandSource(s, from, end).filter((g) => data.records.find((r) => r.id === g.id)?.status !== 'completed').map((g) => g.expectedDate) : [];
};

function applyChange(data: AppData, change: ScenarioChange, index: number, clock: ops.Clock): Applied | string {
  const id = `${SCENARIO_ID_PREFIX}${index + 1}`;
  const unwrap = (r: ops.Result) => (r.ok ? r.data : r.error);
  const notPast = (date: DateStr) => (date < clock.today ? 'Hypothetical changes need today or a later date.' : null);

  switch (change.kind) {
    case 'one-time-income':
    case 'one-time-expense': {
      const err = notPast(change.date);
      if (err) return err;
      const income = change.kind === 'one-time-income';
      const next = unwrap(ops.addOneTime(data, { kind: income ? 'income' : 'bill', description: change.description, amountCents: change.amountCents, date: change.date }, clock, id));
      if (typeof next === 'string') return next;
      return {
        data: next,
        assumption: { change, label: `${change.description.trim()}: ${income ? '+' : '−'}${formatMoney(change.amountCents)} once on ${formatMedium(change.date)}${income ? ' (hypothetical)' : ''}`, direction: income ? 'in' : 'out', amountCents: change.amountCents, recurrence: 'one-time', income: income ? 'hypothetical' : null, dates: () => [change.date] },
      };
    }
    case 'extra-liability-payment': {
      const source = data.sources.find((s) => s.id === change.sourceId);
      if (!source || source.kind !== 'liability') return 'Choose one of your liability payments.';
      const err = notPast(change.date);
      if (err) return err;
      const next = unwrap(ops.addOneTime(data, { kind: 'bill', description: `Extra payment: ${source.description}`, amountCents: change.amountCents, date: change.date }, clock, id));
      if (typeof next === 'string') return next;
      // The app has no one-time liability items yet; on this copy only, the validated record takes the liability kind.
      const withKind = { ...next, records: next.records.map((r) => (r.id === id ? { ...r, kind: 'liability' as TransactionKind } : r)) };
      return {
        data: withKind,
        assumption: { change, label: `Extra payment on ${source.description}: −${formatMoney(change.amountCents)} once on ${formatMedium(change.date)}`, direction: 'out', amountCents: change.amountCents, recurrence: 'one-time', income: null, dates: () => [change.date] },
      };
    }
    case 'occurrence-amount':
    case 'occurrence-date': {
      const o = findOccurrence(data, change.occurrenceId, clock.today);
      if (!o) return 'That transaction could not be found.';
      if (o.status !== 'scheduled') return `${o.description} on ${formatMedium(o.scheduledDate)} has already been recorded or canceled.`;
      if (change.kind === 'occurrence-date') {
        const err = notPast(change.date);
        if (err) return err;
      }
      const amount = change.kind === 'occurrence-amount' ? change.amountCents : o.scheduledAmountCents;
      const date = change.kind === 'occurrence-date' ? change.date : o.scheduledDate;
      const next = unwrap(ops.rescheduleOccurrence(data, o.id, { date, amountCents: amount }, clock));
      if (typeof next === 'string') return next;
      const income = o.kind === 'income';
      const label =
        change.kind === 'occurrence-amount'
          ? `${o.description} on ${formatMedium(o.scheduledDate)}: ${formatMoney(o.scheduledAmountCents)} → ${formatMoney(amount)}`
          : `${o.description}: ${formatMedium(o.scheduledDate)} → ${formatMedium(date)} (${formatMoney(amount)})`;
      return { data: next, assumption: { change, label, direction: income ? 'in' : 'out', amountCents: amount, recurrence: 'one-time', income: income ? 'confirmed' : null, dates: () => [date] } };
    }
    case 'recurring-amount': {
      const source = data.sources.find((s) => s.id === change.sourceId);
      if (!source || !source.active) return 'Choose a recurring item that’s turned on.';
      const versions = [...source.versions].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
      const pending = versions.slice(1).find((v) => v.startDate > clock.today);
      if (pending) return `${source.description} already has a change set for ${formatMedium(pending.startDate)}, so a scenario can’t change its amount yet.`;
      const version = versions[versions.length - 1]!;
      const dates = expandSource(source, clock.today, addDays(clock.today, 400)).map((g) => g.expectedDate);
      if (!dates.includes(change.from) || !startKeepsDates(version.rule, version.startDate, change.from)) {
        return `Choose one of ${source.description}’s upcoming payment dates to start from.`;
      }
      const next = unwrap(ops.changeSourceSchedule(data, source.id, { startDate: change.from, amountCents: change.amountCents, rule: version.rule }, clock));
      if (typeof next === 'string') return next;
      const income = source.kind === 'income';
      return {
        data: next,
        assumption: { change, label: `${source.description}: ${formatMoney(version.amountCents)} → ${formatMoney(change.amountCents)} each time from ${formatMedium(change.from)}`, direction: income ? 'in' : 'out', amountCents: change.amountCents, recurrence: 'recurring', income: income ? 'confirmed' : null, dates: sourceDates(next, source.id, change.from) },
      };
    }
    case 'recurring-savings':
    case 'hypothetical-income': {
      const income = change.kind === 'hypothetical-income';
      const schedule = resolveSchedule(data, change.schedule, clock.today);
      if (typeof schedule === 'string') return schedule;
      const next = unwrap(ops.addSource(data, { kind: income ? 'income' : 'savings', description: change.description, amountCents: change.amountCents, startDate: schedule.startDate, rule: schedule.rule }, clock, id));
      if (typeof next === 'string') return next;
      return {
        data: next,
        assumption: {
          change,
          label: `${change.description.trim()}: ${income ? '+' : '−'}${formatMoney(change.amountCents)} ${describeRule(schedule.rule, schedule.startDate).toLowerCase()} from ${formatMedium(schedule.startDate)}${income ? ' (hypothetical)' : ''}`,
          direction: income ? 'in' : 'out',
          amountCents: change.amountCents,
          recurrence: 'recurring',
          income: income ? 'hypothetical' : null,
          dates: sourceDates(next, id, schedule.startDate),
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluating
// ---------------------------------------------------------------------------

function cashFlow(f: Forecast, start: DateStr, end: DateStr): ScenarioCashFlow {
  const k = periodKpis(f, start, end);
  const hypothetical = f.entries.filter((e) => e.counts && e.signedCents > 0 && e.date >= start && e.date <= end && isHypothetical(e)).reduce((n, e) => n + e.amountCents, 0);
  return {
    confirmedIncomeCents: k.incomeCents - hypothetical,
    hypotheticalIncomeCents: hypothetical,
    outflowCents: k.outflowCents,
    netCents: k.netCents,
    netWithoutHypotheticalCents: k.netCents - hypothetical,
  };
}

function outlook(f: Forecast, side: { lowest: LowPoint | null; gaps: GapExplanation[] }, start: DateStr, end: DateStr): ScenarioOutlook {
  return { forecastStart: f.forecastStart, anchor: f.anchor, cashFlow: cashFlow(f, start, end), lowest: side.lowest, endingCents: f.forecastStart ? tallyOn(f, end) : null, gaps: side.gaps };
}

/**
 * Applies `changes` in order to a copy of `data` and compares the forecast
 * with the current one over the 90-day warning window (or through
 * `options.through`, if later). Refused, with the change's number, if any
 * change isn't allowed. `incomeCase` labels a variable-income case.
 */
export function evaluateScenario(data: AppData, changes: ScenarioChange[], clock: ops.Clock, options: { through?: DateStr; incomeCase?: IncomeCaseName } = {}): ScenarioOutcome {
  if (changes.length === 0) return fail('Add at least one change.');
  const touched = changes.flatMap((c) => (c.kind === 'occurrence-amount' || c.kind === 'occurrence-date' ? [c.occurrenceId] : []));
  if (new Set(touched).size !== touched.length) return fail('Change each transaction only once in a scenario.');
  const recurring = changes.flatMap((c) => (c.kind === 'recurring-amount' ? [c.sourceId] : []));
  if (new Set(recurring).size !== recurring.length) return fail('Change each recurring item’s amount once per scenario.');

  let copy = data;
  const pending: Applied['assumption'][] = [];
  for (const [i, raw] of changes.entries()) {
    const applied = applyChange(copy, raw, i, clock);
    if (typeof applied === 'string') return fail(changes.length > 1 ? `Change ${i + 1}: ${applied}` : applied);
    copy = applied.data;
    pending.push({ ...applied.assumption, change: raw, ...(options.incomeCase && applied.assumption.income === 'hypothetical' ? { incomeCase: options.incomeCase } : {}) });
  }

  const before = buildForecast(data, clock.today, { through: options.through });
  // Hypothetical income counts inside the running total but never moves its start earlier.
  const after = buildForecast(copy, clock.today, { through: options.through, excludeFromStart: (id) => id.startsWith(SCENARIO_ID_PREFIX) });
  const { window, current, proposed, anchorChanged } = compareForecasts(before, after, clock.today, options.through);
  const end = window.end;
  const start = before.forecastStart;
  const assumptions: ScenarioAssumption[] = pending.map((a) => {
    const dates = a.dates(end).filter((d) => d >= clock.today && d <= end);
    return { ...a, dates, inRunningTotal: start !== null && dates.every((d) => d >= start) };
  });

  const baseline = outlook(before, current, clock.today, end);
  const scenario = outlook(after, proposed, clock.today, end);
  const limitations: string[] = [];
  for (const a of assumptions) {
    if (a.dates.length === 0) limitations.push(`${a.label}: no dates fall within ${formatMedium(clock.today)} to ${formatMedium(end)}.`);
    else if (!a.inRunningTotal && start) limitations.push(`${a.label}: dates before your next payday (${formatMedium(start)}) count in cash flow but not in the running total, which starts that day.`);
  }
  const money = {
    incomeCents: scenario.cashFlow.confirmedIncomeCents + scenario.cashFlow.hypotheticalIncomeCents - (baseline.cashFlow.confirmedIncomeCents + baseline.cashFlow.hypotheticalIncomeCents),
    outflowCents: scenario.cashFlow.outflowCents - baseline.cashFlow.outflowCents,
    netCents: scenario.cashFlow.netCents - baseline.cashFlow.netCents,
  };
  const base = { assumptions, period: { start: clock.today, end, runningTotalFrom: start }, baseline, scenario };
  const notCompared = (reason: ScenarioResult['reason'], text: string): ScenarioOutcome => ({
    ok: true,
    result: { ...base, comparable: false, reason, limitations: [text, ...limitations], differences: { ...money, lowestCents: null, endingCents: null }, newGaps: [], worsenedGaps: [], reducedGaps: [], resolvedGaps: [], shortfallDespiteGain: false },
  });

  if (!before.forecastStart || !after.forecastStart) return notCompared('no-forecast', 'There’s no upcoming income to start a running total from, so only cash flow is compared.');
  if (anchorChanged) return notCompared('anchor-changed', `This scenario moves your next payday from ${formatMedium(before.forecastStart)} to ${formatMedium(after.forecastStart)}, so the running totals start on different days and can’t be compared directly.`);
  // A transaction moved from inside the running total to before it would just drop out of it.
  const was = new Map(before.entries.map((e) => [e.occurrence.id, e.date]));
  const dropped = after.entries.find((e) => {
    const d = was.get(e.occurrence.id);
    return d !== undefined && d >= before.forecastStart! && e.date < after.forecastStart!;
  });
  if (dropped) return notCompared('before-payday', `${dropped.occurrence.description} would move to before your next payday (${formatMedium(after.forecastStart)}), where the running total starts, so it would drop out of it. The forecast can’t show whether money on hand covers it.`);

  const gaps = gapChanges(current.gaps, proposed.gaps);
  const differences = {
    ...money,
    lowestCents: current.lowest && proposed.lowest ? proposed.lowest.tallyCents - current.lowest.tallyCents : null,
    endingCents: baseline.endingCents !== null && scenario.endingCents !== null ? scenario.endingCents - baseline.endingCents : null,
  };
  const gain = (differences.endingCents ?? 0) > 0 || money.netCents > 0;
  return { ok: true, result: { ...base, comparable: true, reason: null, limitations, differences, ...gaps, shortfallDespiteGain: gain && gaps.newGaps.length + gaps.worsenedGaps.length > 0 } };
}

// ---------------------------------------------------------------------------
// Variable income
// ---------------------------------------------------------------------------

export type IncomeCaseName = 'low' | 'expected' | 'high';

/** Hypothetical variable income in three cases the person supplies. Never added to the plan. */
export interface IncomeRange {
  description: string;
  /** Once (null) or on a schedule; `date` is used when once. */
  schedule: ScenarioSchedule | null;
  date?: DateStr;
  lowCents: Cents;
  expectedCents: Cents;
  highCents: Cents;
}

/**
 * Evaluates the same scenario three times, with the low, expected and high
 * amounts of hypothetical income. A $0 low case adds no income and is still
 * listed. The income is hypothetical in every case.
 */
export function evaluateIncomeCases(data: AppData, changes: ScenarioChange[], range: IncomeRange, clock: ops.Clock, options: { through?: DateStr } = {}): { ok: true; cases: Record<IncomeCaseName, ScenarioResult> } | { ok: false; error: string } {
  const amounts = [range.lowCents, range.expectedCents, range.highCents];
  if (!amounts.every((a) => Number.isSafeInteger(a) && a >= 0)) return fail('Enter each income case as $0 or more.');
  if (!(range.lowCents <= range.expectedCents && range.expectedCents <= range.highCents)) return fail('The low case can’t be more than expected, and expected can’t be more than high.');
  if (range.expectedCents === 0 || range.highCents === 0) return fail('Enter an expected and high amount above $0.');
  if (range.schedule === null && !range.date) return fail('Choose the date the income might arrive.');
  const cases = {} as Record<IncomeCaseName, ScenarioResult>;
  for (const [name, cents] of [['low', range.lowCents], ['expected', range.expectedCents], ['high', range.highCents]] as const) {
    const income: ScenarioChange[] =
      cents === 0
        ? []
        : range.schedule === null
          ? [{ kind: 'one-time-income', description: range.description, amountCents: cents, date: range.date! }]
          : [{ kind: 'hypothetical-income', description: range.description, amountCents: cents, schedule: range.schedule }];
    const all = [...changes, ...income];
    // A $0 case with no other changes is the plan as it is, evaluated against itself.
    const r = all.length ? evaluateScenario(data, all, clock, { ...options, incomeCase: name }) : baselineOnly(data, clock, options);
    if (!r.ok) return r;
    if (cents === 0) {
      const change: ScenarioChange = range.schedule === null ? { kind: 'one-time-income', description: range.description, amountCents: 0, date: range.date! } : { kind: 'hypothetical-income', description: range.description, amountCents: 0, schedule: range.schedule };
      r.result.assumptions.push({ change, label: `${range.description.trim()}: $0.00 (low case, hypothetical)`, direction: 'in', amountCents: 0, recurrence: range.schedule === null ? 'one-time' : 'recurring', dates: [], income: 'hypothetical', inRunningTotal: true, incomeCase: 'low' });
    }
    cases[name] = r.result;
  }
  return { ok: true, cases };
}

/** The plan compared with itself: no differences. Used for a $0 income case with nothing else changed. */
function baselineOnly(data: AppData, clock: ops.Clock, options: { through?: DateStr }): ScenarioOutcome {
  const f = buildForecast(data, clock.today, { through: options.through });
  const { window, current } = compareForecasts(f, f, clock.today, options.through);
  const side = outlook(f, current, clock.today, window.end);
  const comparable = f.forecastStart !== null;
  return {
    ok: true,
    result: {
      assumptions: [],
      period: { start: clock.today, end: window.end, runningTotalFrom: f.forecastStart },
      baseline: side,
      scenario: side,
      comparable,
      reason: comparable ? null : 'no-forecast',
      limitations: comparable ? [] : ['There’s no upcoming income to start a running total from, so only cash flow is compared.'],
      differences: { incomeCents: 0, outflowCents: 0, netCents: 0, lowestCents: comparable ? 0 : null, endingCents: comparable ? 0 : null },
      newGaps: [],
      worsenedGaps: [],
      reducedGaps: [],
      resolvedGaps: [],
      shortfallDespiteGain: false,
    },
  };
}


// ---------------------------------------------------------------------------
// For choosing and summarizing
// ---------------------------------------------------------------------------

/** What a scenario can change without the person re-entering it: upcoming payments, and liability payments with their next dates. */
export interface ScenarioOptions {
  /** Outstanding occurrences from today through `end`, in forecast order. */
  occurrences: { id: string; description: string; kind: TransactionKind; date: DateStr; amountCents: Cents }[];
  /** Active liability payments with no later change set, and the dates a new amount could start from. */
  liabilities: { sourceId: string; description: string; amountCents: Cents; dates: DateStr[] }[];
}

export function scenarioOptions(data: AppData, today: DateStr, end: DateStr = addDays(today, 90)): ScenarioOptions {
  const f = buildForecast(data, today);
  const occurrences = f.entries
    .filter((e) => e.occurrence.status === 'scheduled' && e.occurrence.scheduledDate >= today && e.date <= end)
    .map((e) => ({ id: e.occurrence.id, description: e.occurrence.description, kind: e.occurrence.kind, date: e.occurrence.scheduledDate, amountCents: e.amountCents }));
  const liabilities = data.sources
    .filter((s) => s.kind === 'liability' && s.active && !s.versions.slice(1).some((v) => v.startDate > today))
    .flatMap((s) => {
      const version = [...s.versions].sort((a, b) => (a.startDate < b.startDate ? -1 : 1)).at(-1)!;
      const dates = expandSource(s, today, addDays(today, 400))
        .filter((g) => data.records.find((r) => r.id === g.id)?.status !== 'completed' && startKeepsDates(version.rule, version.startDate, g.expectedDate))
        .slice(0, 6)
        .map((g) => g.expectedDate);
      return dates.length ? [{ sourceId: s.id, description: s.description, amountCents: version.amountCents, dates }] : [];
    });
  return { occurrences, liabilities };
}

/**
 * The shortfall to point out first: the earliest new or deeper timing gap,
 * by the day it reaches its lowest point. `despiteGain` when the scenario
 * also ends higher or has more cash flow, so the better number isn't read
 * as safe. Null when the scenario creates or deepens no gap.
 */
export function firstShortfall(r: ScenarioResult): { gap: GapExplanation; created: boolean; despiteGain: boolean } | null {
  const candidates = [...r.newGaps.map((gap) => ({ gap, created: true })), ...r.worsenedGaps.map((gap) => ({ gap, created: false }))];
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.gap.lowestDate < b.gap.lowestDate ? -1 : a.gap.lowestDate > b.gap.lowestDate ? 1 : 0));
  return { ...candidates[0]!, despiteGain: r.shortfallDespiteGain };
}
