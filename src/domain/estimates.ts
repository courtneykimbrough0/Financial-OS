/**
 * Adaptive estimates: compares a recurring expense's recorded payments with
 * its current estimate and, when the payments clearly differ, suggests a new
 * estimate the person can approve or dismiss. Nothing here changes data on
 * its own: `analyzeEstimate` and `estimateSuggestions` only read, and
 * `approveEstimate` / `dismissEstimate` run only when the person chooses.
 * "Review later" is doing neither; the suggestion stays available.
 *
 * The method is a fixed set of rules, applied in this order to the payments
 * recorded since the estimate last changed (at most the latest 12):
 *
 *  1. Seasonal (monthly items with a year of payments): when at least three
 *     of the last 12 were more than 25% from the typical (median) amount,
 *     the next payment is suggested at the same month's amount in earlier
 *     years, for that payment only.
 *  2. Steady: the latest three or more payments were exactly the same.
 *  3. Rising or falling: each of the latest four payments was higher (or
 *     lower) than the one before, by no more than 25% at a time. Suggests
 *     the latest amount; it never assumes the change continues.
 *  4. Variable: the average of the latest six, leaving out any payment more
 *     than 25% from their median, rounded up to the next whole dollar.
 *     Suggested only when the current estimate is outside the range of the
 *     payments counted.
 *
 * At least three payments are needed. A suggestion must differ from the
 * current estimate by at least $5 and 5%. Income and reserves are not
 * estimated: future income counts only when the person enters it, and a
 * reserve allocation is the person's choice.
 */
import { addDays, formatMedium, parts, type DateStr } from './dates';
import { formatMoney, type Cents } from './money';
import { buildForecast, tallyOn, type GapExplanation } from './forecast';
import { expandSource, findOccurrence } from './occurrences';
import { changeSourceSchedule, rescheduleOccurrence, type Clock, type Result } from './operations';
import { compareForecasts, gapChanges, type ForecastSnapshot } from './preview';
import { startKeepsDates } from './recurrence';
import type { AppData, EstimateDismissal, OccurrenceRecord, RecurringSource, ScheduleVersion, TransactionKind } from './types';

export type { EstimateDismissal } from './types';

/** Kinds whose estimates are compared with recorded payments. */
export const ESTIMATE_KINDS: TransactionKind[] = ['bill', 'subscription', 'liability'];
/** Fewer recorded payments than this: no suggestion. */
export const MIN_OBSERVATIONS = 3;
/** The latest payments considered at all. */
export const HISTORY_WINDOW = 12;
/** The latest payments averaged for a variable amount. */
export const RECENT_OBSERVATIONS = 6;
/** A payment this far (percent) from the median is unusual. */
export const UNUSUAL_PERCENT = 25;
/** A suggestion must differ from the current estimate by at least this much… */
export const MIN_CHANGE_CENTS = 500;
/** …and by at least this percentage of it. */
export const MIN_CHANGE_PERCENT = 5;
/** Payments in a row, each higher (or lower) than the last, for a rising (falling) amount. */
export const TREND_LENGTH = 4;
/** Months of the last 12 far from the median that make an amount seasonal. */
export const SEASONAL_MONTHS = 3;
/** A dismissed suggestion can return once this many newer payments are recorded. */
export const REPEAT_AFTER_OBSERVATIONS = 3;
/** Below this many counted payments, a suggestion is marked limited. */
export const ESTABLISHED_OBSERVATIONS = 6;

/** One recorded payment of a recurring item. */
export interface EstimateObservation {
  occurrenceId: string;
  /** The occurrence's original date (its place in the schedule). */
  originalDate: DateStr;
  actualDate: DateStr;
  /** The original prediction for this occurrence. */
  expectedAmountCents: Cents;
  actualAmountCents: Cents;
  /** Whether this payment counted toward the suggested amount. */
  counted: boolean;
  /**
   * Why a considered payment wasn't counted: more than 25% from the median
   * (`unusual`), older than the payments the rule uses (`earlier`), or another
   * month than the one a seasonal suggestion is for (`other-month`). Null when
   * counted, or when no rule was applied (too little history).
   */
  excluded: 'unusual' | 'earlier' | 'other-month' | null;
}

export type EstimatePattern = 'steady' | 'rising' | 'falling' | 'variable' | 'seasonal';

export interface EstimateSuggestion {
  sourceId: string;
  description: string;
  kind: TransactionKind;
  /** `from-date`: the item's estimate from `effectiveDate` on. `one-payment`: only the payment `occurrenceId`. */
  scope: 'from-date' | 'one-payment';
  /** The payment the suggestion starts with (and, for `one-payment`, the only one it changes). */
  occurrenceId: string;
  /** `from-date`: that payment's original date, where the new estimate starts. `one-payment`: the date it's expected on. */
  effectiveDate: DateStr;
  currentCents: Cents;
  proposedCents: Cents;
  /** Proposed minus current: positive means a higher estimate. */
  differenceCents: Cents;
  pattern: EstimatePattern;
  /** Payments considered, oldest first, each marked counted or not. */
  observations: EstimateObservation[];
  /** Lowest and highest counted payments. */
  lowCents: Cents;
  highCents: Cents;
  /** Average of the counted payments, to the nearest cent. */
  averageCents: Cents;
  explanation: string;
  /** `limited` when fewer than ESTABLISHED_OBSERVATIONS payments were counted. */
  confidence: 'limited' | 'established';
  limitations: string[];
  /** Original date of the latest payment considered. */
  through: DateStr;
}

export type NoSuggestionReason =
  | 'not-estimated' // income, reserves, or an item that's turned off
  | 'upcoming-change' // the person has already set a change that starts later
  | 'no-upcoming' // nothing outstanding to apply it to
  | 'insufficient-history'
  | 'inconsistent' // payments too scattered to estimate from
  | 'close-enough' // the current estimate already fits the payments
  | 'dismissed';

export interface EstimateAnalysis {
  sourceId: string;
  suggestion: EstimateSuggestion | null;
  reason: NoSuggestionReason | null;
  /** Recorded payments considered (empty when the item isn't estimated). */
  observations: EstimateObservation[];
}

// ---------------------------------------------------------------------------
// Integer helpers (all amounts are positive integer cents)
// ---------------------------------------------------------------------------

const divFloor = (a: number, b: number) => (a - (a % b)) / b;
/** sum / count rounded up to a whole dollar, in cents. */
const ceilDollarAverage = (sum: Cents, count: number) => {
  const d = 100 * count;
  return (divFloor(sum, d) + (sum % d === 0 ? 0 : 1)) * 100;
};
/** sum / count to the nearest cent, halves up. */
const roundAverage = (sum: Cents, count: number) => divFloor(2 * sum + count, 2 * count);
const sumOf = (xs: Cents[]) => xs.reduce((a, b) => a + b, 0);
/** Twice the median, so it stays an integer. */
const doubleMedian = (xs: Cents[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? 2 * s[mid]! : s[mid - 1]! + s[mid]!;
};
/** More than UNUSUAL_PERCENT away from the median (given as twice the median). */
const isUnusual = (x: Cents, median2: number) => Math.abs(2 * x - median2) * 100 > UNUSUAL_PERCENT * median2;

/** The smallest change worth suggesting from `current`. */
export function minimumChange(currentCents: Cents): Cents {
  return Math.max(MIN_CHANGE_CENTS, divFloor(currentCents * MIN_CHANGE_PERCENT + 99, 100));
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const byStart = (a: ScheduleVersion, b: ScheduleVersion) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0);

function isMonthly(v: ScheduleVersion): boolean {
  return v.rule.type === 'monthly' || (v.rule.type === 'custom' && v.rule.unit === 'month' && v.rule.interval === 1);
}

const keepsDates = (version: ScheduleVersion, start: DateStr) => startKeepsDates(version.rule, version.startDate, start);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Raw {
  suggestion: EstimateSuggestion | null;
  reason: NoSuggestionReason | null;
  observations: EstimateObservation[];
  /** Every recorded payment since the estimate last changed, oldest first. */
  all: EstimateObservation[];
}

function mark(considered: EstimateObservation[], counted: Set<string>, unusual: EstimateObservation[], pattern: EstimatePattern): EstimateObservation[] {
  const odd = new Set(unusual.map((o) => o.occurrenceId));
  return considered.map((o) => {
    const c = counted.has(o.occurrenceId);
    return { ...o, counted: c, excluded: c ? null : odd.has(o.occurrenceId) ? 'unusual' : pattern === 'seasonal' ? 'other-month' : 'earlier' };
  });
}

const none = (reason: NoSuggestionReason, observations: EstimateObservation[] = [], all = observations): Raw => ({ suggestion: null, reason, observations, all });

function observe(r: OccurrenceRecord): EstimateObservation {
  return { occurrenceId: r.id, originalDate: r.expectedDate, actualDate: r.actualDate!, expectedAmountCents: r.expectedAmountCents, actualAmountCents: r.actualAmountCents!, counted: false, excluded: null };
}

function evaluate(data: AppData, source: RecurringSource, today: DateStr): Raw {
  if (!ESTIMATE_KINDS.includes(source.kind) || !source.active) return none('not-estimated');
  const versions = [...source.versions].sort(byStart);
  if (versions.slice(1).some((v) => v.startDate > today)) return none('upcoming-change');
  // The version in force, and the start of its amount (earlier versions with the same amount count too).
  let i = versions.length - 1;
  while (i > 0 && versions[i]!.startDate > today) i--;
  const version = versions[i]!;
  while (i > 0 && versions[i - 1]!.amountCents === version.amountCents) i--;
  const rateStart = i === 0 ? null : versions[i]!.startDate;

  const paid = data.records
    .filter((r) => r.sourceId === source.id && r.status === 'completed' && r.actualAmountCents !== null && r.actualDate !== null)
    .sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : a.expectedDate > b.expectedDate ? 1 : a.id < b.id ? -1 : 1));
  const all = paid.filter((r) => rateStart === null || r.expectedDate >= rateStart).map(observe);
  const earlier = paid.length - all.length;
  const window = all.slice(-HISTORY_WINDOW);
  if (window.length < MIN_OBSERVATIONS) return none('insufficient-history', window, all);

  // The first outstanding payment from today on whose start keeps the schedule's dates.
  let target: OccurrenceRecord | null = null;
  let rateTarget: OccurrenceRecord | null = null;
  for (const gen of expandSource(source, today, addDays(today, 400))) {
    const rec = data.records.find((r) => r.id === gen.id);
    if (rec && rec.status !== 'scheduled') continue;
    target ??= rec ?? gen;
    if (keepsDates(version, gen.expectedDate)) {
      rateTarget = rec ?? gen;
      break;
    }
  }
  if (!target) return none('no-upcoming', window, all);

  const amounts = window.map((o) => o.actualAmountCents);
  const name = source.description;
  const limitations: string[] = [];
  if (earlier > 0 && rateStart) limitations.push(`Counts only payments since your estimate became ${formatMoney(version.amountCents)} on ${formatMedium(rateStart)}.`);

  const build = (
    pattern: EstimatePattern,
    counted: EstimateObservation[],
    considered: EstimateObservation[],
    proposedCents: Cents,
    scope: EstimateSuggestion['scope'],
    at: OccurrenceRecord,
    currentCents: Cents,
    explain: (current: string, proposed: string, when: string) => string,
    extra: string[] = [],
    basis?: { confidence: EstimateSuggestion['confidence']; note: string | null },
    unusual: EstimateObservation[] = [],
  ): Raw => {
    const ids = new Set(counted.map((o) => o.occurrenceId));
    // A schedule version starts on an original date; a single payment keeps the date it's expected on now.
    const effectiveDate = scope === 'one-payment' ? at.scheduledDate : at.expectedDate;
    const observations = mark(considered, ids, unusual, pattern);
    const differenceCents = proposedCents - currentCents;
    if (Math.abs(differenceCents) < minimumChange(currentCents)) return none('close-enough', observations, all);
    const values = counted.map((o) => o.actualAmountCents);
    const confidence = basis?.confidence ?? (counted.length < ESTABLISHED_OBSERVATIONS ? 'limited' : 'established');
    const note = basis ? basis.note : confidence === 'limited' ? `Based on only ${counted.length} payments.` : null;
    const notes = [...(note ? [note] : []), ...limitations, ...extra];
    return {
      reason: null,
      observations,
      all,
      suggestion: {
        sourceId: source.id,
        description: name,
        kind: source.kind,
        scope,
        occurrenceId: at.id,
        effectiveDate,
        currentCents,
        proposedCents,
        differenceCents,
        pattern,
        observations,
        lowCents: Math.min(...values),
        highCents: Math.max(...values),
        averageCents: roundAverage(sumOf(values), values.length),
        explanation: explain(formatMoney(currentCents), formatMoney(proposedCents), formatMedium(effectiveDate)),
        confidence,
        limitations: notes,
        through: window[window.length - 1]!.originalDate,
      },
    };
  };

  // 1. Seasonal.
  if (isMonthly(version) && window.length >= HISTORY_WINDOW) {
    const m2 = doubleMedian(amounts);
    if (amounts.filter((x) => isUnusual(x, m2)).length >= SEASONAL_MONTHS) {
      const t = parts(target.expectedDate);
      const sameMonth = all.filter((o) => {
        const p = parts(o.originalDate);
        return p.m === t.m && p.y < t.y && p.y >= t.y - 2;
      });
      if (sameMonth.length > 0) {
        const considered = [...new Map([...sameMonth, ...window].map((o) => [o.occurrenceId, o])).values()].sort((a, b) => (a.originalDate < b.originalDate ? -1 : 1));
        const sum = sumOf(sameMonth.map((o) => o.actualAmountCents));
        const proposed = ceilDollarAverage(sum, sameMonth.length);
        const month = MONTHS[t.m - 1]!;
        const history =
          sameMonth.length === 1
            ? `Your ${month} ${parts(sameMonth[0]!.originalDate).y} payment was ${formatMoney(sameMonth[0]!.actualAmountCents)}.`
            : `Your ${month} payments averaged ${formatMoney(roundAverage(sum, sameMonth.length))} over the last ${sameMonth.length} years.`;
        const extra = [`For this one payment only; later payments keep ${formatMoney(version.amountCents)}.`];
        if (proposed * sameMonth.length !== sum) extra.push('Rounded up to the next whole dollar.');
        const basis =
          sameMonth.length < 2
            ? { confidence: 'limited' as const, note: `Based on one earlier ${month}; one year doesn't show a reliable yearly pattern.` }
            : { confidence: 'established' as const, note: null };
        return build('seasonal', sameMonth, considered, proposed, 'one-payment', target, target.scheduledAmountCents, (cur, prop, when) => `${name} may change with the season. ${history} Your ${when} payment is expected at ${cur}. Consider ${prop} for that payment.`, extra, basis);
      }
    }
  }

  if (!rateTarget) return none('no-upcoming', window, all);
  const current = version.amountCents;

  // 2. Steady.
  let run = 1;
  while (run < amounts.length && amounts[amounts.length - 1 - run] === amounts[amounts.length - 1]) run++;
  if (run >= MIN_OBSERVATIONS) {
    const counted = window.slice(-run);
    const amount = amounts[amounts.length - 1]!;
    return build('steady', counted, window, amount, 'from-date', rateTarget, current, (cur, prop, when) => `Your last ${run} ${name} payments were each ${formatMoney(amount)}. Your current estimate is ${cur}. Consider ${prop} from ${when}.`);
  }

  // 3. Rising or falling.
  const last = amounts.slice(-TREND_LENGTH);
  const steps = last.slice(1).map((x, k) => x - last[k]!);
  const gentle = steps.every((d, k) => Math.abs(d) * 100 <= UNUSUAL_PERCENT * last[k]!);
  if (last.length === TREND_LENGTH && gentle && (steps.every((d) => d > 0) || steps.every((d) => d < 0))) {
    const rising = steps[0]! > 0;
    const latest = last[last.length - 1]!;
    const proposed = ceilDollarAverage(latest, 1);
    const extra = [`Uses the latest amount; it doesn't assume the ${rising ? 'rise' : 'drop'} continues.`];
    if (proposed !== latest) extra.push('Rounded up to the next whole dollar.');
    return build(rising ? 'rising' : 'falling', window.slice(-TREND_LENGTH), window, proposed, 'from-date', rateTarget, current, (cur, prop, when) => `Your last ${TREND_LENGTH} ${name} payments went ${rising ? 'up' : 'down'} each time, from ${formatMoney(last[0]!)} to ${formatMoney(latest)}. Your current estimate is ${cur}. Consider ${prop} from ${when}.`, extra);
  }

  // 4. Variable.
  const recent = window.slice(-RECENT_OBSERVATIONS);
  const m2 = doubleMedian(recent.map((o) => o.actualAmountCents));
  const kept = recent.filter((o) => !isUnusual(o.actualAmountCents, m2));
  const unusual = recent.filter((o) => isUnusual(o.actualAmountCents, m2));
  if (kept.length < MIN_OBSERVATIONS) return none('inconsistent', window, all);
  const values = kept.map((o) => o.actualAmountCents);
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (current >= low && current <= high) return none('close-enough', mark(window, new Set(kept.map((o) => o.occurrenceId)), unusual, 'variable'), all);
  const sum = sumOf(values);
  const proposed = ceilDollarAverage(sum, kept.length);
  const extra: string[] = [];
  if (unusual.length > 0) extra.push(`Left out as unusual: ${unusual.map((o) => `${formatMoney(o.actualAmountCents)} (${formatMedium(o.originalDate)})`).join(', ')}.`);
  if (proposed * kept.length !== sum) extra.push('Rounded up to the next whole dollar.');
  const which = unusual.length > 0 ? `${kept.length} of your last ${recent.length} ${name} payments` : `Your last ${kept.length} ${name} payments`;
  return build('variable', kept, window, proposed, 'from-date', rateTarget, current, (cur, prop, when) => `${which} averaged ${formatMoney(roundAverage(sum, kept.length))} and ranged from ${formatMoney(low)} to ${formatMoney(high)}. Your current estimate is ${cur}. Consider ${prop} from ${when}.`, extra, undefined, unusual);
}

function isDismissed(source: RecurringSource, raw: Raw): boolean {
  const d = source.estimateDismissal;
  const s = raw.suggestion;
  if (!d || !s) return false;
  const newer = raw.all.filter((o) => o.originalDate > d.through).length;
  return d.currentCents === s.currentCents && Math.abs(d.proposedCents - s.proposedCents) < minimumChange(s.currentCents) && newer < REPEAT_AFTER_OBSERVATIONS;
}

/**
 * Compares one recurring item's recorded payments with its current estimate.
 * Returns a suggestion, or the reason there isn't one. Reads only.
 */
export function analyzeEstimate(data: AppData, sourceId: string, today: DateStr): EstimateAnalysis {
  const source = data.sources.find((s) => s.id === sourceId);
  if (!source) return { sourceId, suggestion: null, reason: 'not-estimated', observations: [] };
  const raw = evaluate(data, source, today);
  if (isDismissed(source, raw)) return { sourceId, suggestion: null, reason: 'dismissed', observations: raw.observations };
  return { sourceId, suggestion: raw.suggestion, reason: raw.reason, observations: raw.observations };
}

/** Every current suggestion, ordered by the date it would take effect, then name. Reads only. */
export function estimateSuggestions(data: AppData, today: DateStr): EstimateSuggestion[] {
  return data.sources
    .map((s) => analyzeEstimate(data, s.id, today).suggestion)
    .filter((s): s is EstimateSuggestion => s !== null)
    .sort((a, b) => (a.effectiveDate !== b.effectiveDate ? (a.effectiveDate < b.effectiveDate ? -1 : 1) : a.description !== b.description ? (a.description < b.description ? -1 : 1) : a.sourceId < b.sourceId ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Approve and dismiss
// ---------------------------------------------------------------------------

const STALE = 'This suggestion is out of date. Look at the latest one before choosing.';

function sameSuggestion(a: EstimateSuggestion, b: EstimateSuggestion): boolean {
  return (
    a.sourceId === b.sourceId &&
    a.scope === b.scope &&
    a.occurrenceId === b.occurrenceId &&
    a.effectiveDate === b.effectiveDate &&
    a.currentCents === b.currentCents &&
    a.proposedCents === b.proposedCents &&
    a.through === b.through
  );
}

function check(data: AppData, suggestion: EstimateSuggestion, today: DateStr): { source: RecurringSource } | string {
  const source = data.sources.find((s) => s.id === suggestion.sourceId);
  if (!source) return 'That item could not be found.';
  const fresh = evaluate(data, source, today).suggestion;
  return fresh && sameSuggestion(fresh, suggestion) ? { source } : STALE;
}

const withoutDismissal = (data: AppData, sourceId: string): AppData => ({
  ...data,
  sources: data.sources.map((s) => {
    if (s.id !== sourceId || !s.estimateDismissal) return s;
    const { estimateDismissal: _d, ...rest } = s;
    void _d;
    return rest;
  }),
});

/**
 * Applies a suggestion the person approved, through the ordinary schedule
 * operations: `from-date` adds a schedule version from the effective date
 * (earlier occurrences, recorded payments and their original predictions
 * stay as they are); `one-payment` changes only that payment's expected
 * amount. Refused if the suggestion no longer matches the data.
 */
export function approveEstimate(data: AppData, suggestion: EstimateSuggestion, clock: Clock): Result {
  const found = check(data, suggestion, clock.today);
  if (typeof found === 'string') return { ok: false, error: found };
  if (suggestion.scope === 'one-payment') {
    const o = findOccurrence(data, suggestion.occurrenceId, clock.today);
    if (!o) return { ok: false, error: STALE };
    return rescheduleOccurrence(data, o.id, { date: o.scheduledDate, amountCents: suggestion.proposedCents }, clock);
  }
  const version = [...found.source.versions].sort(byStart).filter((v) => v.startDate <= suggestion.effectiveDate).pop()!;
  const r = changeSourceSchedule(data, found.source.id, { startDate: suggestion.effectiveDate, amountCents: suggestion.proposedCents, rule: version.rule }, clock);
  return r.ok ? { ok: true, data: withoutDismissal(r.data, found.source.id) } : r;
}

/**
 * Dismisses a suggestion: the estimate stays as it is, and the same
 * suggestion doesn't return until the current estimate changes, the
 * suggested amount moves by at least the minimum change, or
 * REPEAT_AFTER_OBSERVATIONS newer payments are recorded. Only the item's
 * dismissal note changes; the forecast is unchanged.
 */
export function dismissEstimate(data: AppData, suggestion: EstimateSuggestion, clock: Clock): Result {
  const found = check(data, suggestion, clock.today);
  if (typeof found === 'string') return { ok: false, error: found };
  const dismissal: EstimateDismissal = { currentCents: suggestion.currentCents, proposedCents: suggestion.proposedCents, through: suggestion.through };
  return { ok: true, data: { ...data, sources: data.sources.map((s) => (s.id === found.source.id ? { ...s, estimateDismissal: dismissal } : s)) } };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** One payment the suggestion would change, within the comparison. */
export interface EstimatePreviewPayment {
  occurrenceId: string;
  /** The date it counts on in the forecast. */
  date: DateStr;
  currentCents: Cents;
  proposedCents: Cents;
  /** False before the next payday, where the running total doesn't reach. */
  inRunningTotal: boolean;
  /** Running total at the end of that day, now and with the suggestion; null outside the running total. */
  currentTallyCents: Cents | null;
  proposedTallyCents: Cents | null;
}

export interface EstimatePreview {
  /** Both forecasts are measured over these dates (see `compareForecasts`). */
  window: { start: DateStr; end: DateStr };
  current: ForecastSnapshot;
  proposed: ForecastSnapshot;
  /** False when there's no running total to compare, or its starting payday would change. */
  comparable: boolean;
  reason: 'no-forecast' | 'anchor-changed' | null;
  /** Proposed lowest running total minus the current one. */
  lowestChangeCents: Cents | null;
  /** Every payment of the item the suggestion changes, from today through the end of the comparison. */
  payments: EstimatePreviewPayment[];
  /** Proposed gaps on dates with no gap today. */
  newGaps: GapExplanation[];
  /** Proposed gaps that go lower than a current gap they overlap. */
  worsenedGaps: GapExplanation[];
  /** Proposed gaps that stay above a current gap they overlap. */
  reducedGaps: GapExplanation[];
  /** Current gaps with no gap on those dates under the suggestion. */
  resolvedGaps: GapExplanation[];
  /** For a change from a date on: the comparison ends here, and the new estimate keeps applying after it. */
  continuesAfter: DateStr | null;
}

export type EstimatePreviewResult = { ok: true; preview: EstimatePreview } | { ok: false; error: string };

/**
 * The forecast with a suggestion approved, next to the forecast as it is.
 * The approval runs on a copy with `approveEstimate` itself, so the preview
 * covers exactly what approving would change: every later payment for a
 * change from a date on, or the one payment for a seasonal suggestion.
 * Nothing is saved. Refused, like approval, if the suggestion is out of date.
 */
export function previewEstimate(data: AppData, suggestion: EstimateSuggestion, clock: Clock, options: { through?: DateStr } = {}): EstimatePreviewResult {
  const applied = approveEstimate(data, suggestion, clock);
  if (!applied.ok) return applied;
  const before = buildForecast(data, clock.today, { through: options.through });
  const after = buildForecast(applied.data, clock.today, { through: options.through });
  const { window, current, proposed, anchorChanged } = compareForecasts(before, after, clock.today, options.through);

  const was = new Map(before.entries.map((e) => [e.occurrence.id, e]));
  const payments: EstimatePreviewPayment[] = after.entries
    .filter((e) => e.occurrence.sourceId === suggestion.sourceId && e.counts && e.date >= clock.today && e.date <= window.end)
    .flatMap((e) => {
      const b = was.get(e.occurrence.id);
      if (!b || b.amountCents === e.amountCents) return [];
      const inRunningTotal = after.forecastStart !== null && e.date >= after.forecastStart;
      return [{ occurrenceId: e.occurrence.id, date: e.date, currentCents: b.amountCents, proposedCents: e.amountCents, inRunningTotal, currentTallyCents: inRunningTotal ? tallyOn(before, e.date) : null, proposedTallyCents: inRunningTotal ? tallyOn(after, e.date) : null }];
    });

  const base = { window, current, proposed, payments, continuesAfter: suggestion.scope === 'from-date' ? window.end : null };
  const empty = { lowestChangeCents: null, newGaps: [], worsenedGaps: [], reducedGaps: [], resolvedGaps: [] };
  if (!before.forecastStart || !after.forecastStart) return { ok: true, preview: { ...base, ...empty, comparable: false, reason: 'no-forecast' } };
  if (anchorChanged) return { ok: true, preview: { ...base, ...empty, comparable: false, reason: 'anchor-changed' } };

  return {
    ok: true,
    preview: {
      ...base,
      comparable: true,
      reason: null,
      lowestChangeCents: current.lowest && proposed.lowest ? proposed.lowest.tallyCents - current.lowest.tallyCents : null,
      ...gapChanges(current.gaps, proposed.gaps),
    },
  };
}
