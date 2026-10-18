/**
 * "What if" previews: the forecast with one outstanding occurrence moved,
 * resized, or left out, next to the forecast as it is. The change is applied
 * to a copy of the data with the ordinary operations (so their validation
 * applies), forecast with the same engine, and then discarded. Nothing is
 * saved; making a change real is a separate, explicit action.
 */
import { addDays, diffDays, maxDate, type DateStr } from './dates';
import { buildForecast, dailyTimeline, explainTimingGaps, GAP_LOOKAHEAD_DAYS, lowestPoint, type Forecast, type GapExplanation, type LowPoint } from './forecast';
import type { Cents } from './money';
import { findOccurrence } from './occurrences';
import * as ops from './operations';
import type { AppData } from './types';

/** A hypothetical change to one outstanding occurrence. Later occurrences of a recurring item are never affected. */
export type ProposedChange =
  | { kind: 'move'; occurrenceId: string; date: DateStr }
  | { kind: 'amount'; occurrenceId: string; amountCents: Cents }
  /** Leave this one occurrence out of the forecast. A what-if only: it doesn't mean the payment is canceled, waived or paid. */
  | { kind: 'skip'; occurrenceId: string };

/** One side of the comparison, over the shared window. */
export interface ForecastSnapshot {
  forecastStart: DateStr | null;
  anchor: DateStr | null;
  /** Running total at the end of each day in the window with counted activity. */
  tallies: { date: DateStr; cents: Cents }[];
  /** Lowest running total in the window. */
  lowest: LowPoint | null;
  /** Timing gaps in the window, explained. */
  gaps: GapExplanation[];
}

export type GapOutcome = 'eliminated' | 'reduced' | 'unchanged' | 'worsened';

export interface ChangePreview {
  change: ProposedChange;
  /** Both forecasts are measured over these dates: the current forecast's 90-day warning window, or through `options.through` if later. */
  window: { start: DateStr; end: DateStr };
  current: ForecastSnapshot;
  proposed: ForecastSnapshot;
  /**
   * False when the two running totals don't share a starting point (the
   * change moves or removes the next main payday), when a payment would move
   * to before the next payday (where the running total doesn't reach), or
   * when there is no forecast to compare. The comparisons below are then null or empty, and
   * `limitation` says why.
   */
  comparable: boolean;
  limitation: string | null;
  /** Why the forecasts aren't compared, for wording in the interface; null when they are. */
  reason: 'no-forecast' | 'anchor-changed' | 'before-payday' | null;
  /** True when the next main payday, and so the running total's starting point, differs. */
  anchorChanged: boolean;
  /** Proposed lowest running total minus the current one. */
  lowestChangeCents: Cents | null;
  /** The current gap the occurrence falls in (for income, otherwise the gap it ends), and what becomes of it; null when there is none. */
  target: {
    gap: GapExplanation;
    outcome: GapOutcome;
    /** Proposed gaps overlapping the target gap's dates. */
    proposedGaps: GapExplanation[];
    /** When the running total is back to $0 or more; `proposed` is null when the gap is eliminated or doesn't recover. */
    recoversOn: { current: DateStr | null; proposed: DateStr | null };
  } | null;
  /** Proposed gaps on dates where there is no gap today. */
  newGaps: GapExplanation[];
  /** Proposed gaps that overlap another current gap (not the target) and go lower than it. */
  worsenedGaps: GapExplanation[];
}

export type PreviewResult = { ok: true; preview: ChangePreview } | { ok: false; error: string };

/** The change applied with the ordinary operations: to that one occurrence only. */
export function applyProposedChange(data: AppData, change: ProposedChange, clock: ops.Clock, note = ''): ops.Result {
  if (change.kind === 'skip') return ops.cancelOccurrence(data, change.occurrenceId, note, clock);
  const o = findOccurrence(data, change.occurrenceId, clock.today);
  if (!o) return { ok: false, error: 'That transaction could not be found.' };
  return change.kind === 'move'
    ? ops.rescheduleOccurrence(data, change.occurrenceId, { date: change.date, amountCents: o.scheduledAmountCents }, clock)
    : ops.rescheduleOccurrence(data, change.occurrenceId, { date: o.scheduledDate, amountCents: change.amountCents }, clock);
}

function snapshot(f: Forecast, window: { start: DateStr; end: DateStr }): ForecastSnapshot {
  if (!f.forecastStart) return { forecastStart: null, anchor: null, tallies: [], lowest: null, gaps: [] };
  const rows = dailyTimeline(f, window.start, window.end).filter((r) => r.tallyCents !== null);
  return {
    forecastStart: f.forecastStart,
    anchor: f.anchor,
    tallies: rows.filter((r) => r.entries.some((e) => e.counts)).map((r) => ({ date: r.date, cents: r.tallyCents! })),
    lowest: lowestPoint(rows),
    gaps: explainTimingGaps(f, diffDays(f.forecastStart, window.end) + 1).filter((g) => g.end >= window.start),
  };
}

export const overlaps = (a: { start: DateStr; end: DateStr }, b: { start: DateStr; end: DateStr }) => a.start <= b.end && b.start <= a.end;

/**
 * The current and proposed forecasts measured over the same dates: the
 * current forecast's 90-day warning window from its start, or longer to
 * cover `through`. Shared by every preview so they compare alike.
 */
export function compareForecasts(before: Forecast, after: Forecast, today: DateStr, through?: DateStr) {
  const start = before.forecastStart ?? today;
  const window = { start, end: maxDate(addDays(start, GAP_LOOKAHEAD_DAYS - 1), through ?? start) };
  return { window, current: snapshot(before, window), proposed: snapshot(after, window), anchorChanged: before.forecastStart !== after.forecastStart };
}

/** How the proposed timing gaps differ from the current ones, by overlapping dates. */
export function gapChanges(currentGaps: GapExplanation[], proposedGaps: GapExplanation[]) {
  const overlapping = (g: GapExplanation, list: GapExplanation[]) => list.filter((c) => overlaps(c, g));
  return {
    /** Proposed gaps on dates with no gap now. */
    newGaps: proposedGaps.filter((g) => overlapping(g, currentGaps).length === 0),
    /** Proposed gaps that go lower than a current gap they overlap. */
    worsenedGaps: proposedGaps.filter((g) => overlapping(g, currentGaps).some((c) => g.lowestCents < c.lowestCents)),
    /** Proposed gaps that stay above every current gap they overlap. */
    reducedGaps: proposedGaps.filter((g) => {
      const c = overlapping(g, currentGaps);
      return c.length > 0 && c.every((x) => g.lowestCents > x.lowestCents);
    }),
    /** Current gaps with no proposed gap on those dates. */
    resolvedGaps: currentGaps.filter((c) => overlapping(c, proposedGaps).length === 0),
  };
}

/** Previews `change` without saving it. Rejected with the operation's own message when the change isn't allowed. */
export function previewChange(data: AppData, change: ProposedChange, clock: ops.Clock, options: { through?: DateStr } = {}): PreviewResult {
  const applied = applyProposedChange(data, change, clock);
  if (!applied.ok) return applied;
  const before = buildForecast(data, clock.today, { through: options.through });
  const after = buildForecast(applied.data, clock.today, { through: options.through });

  // The 90-day warning window, or longer to cover a period being viewed further out.
  const { window, current, proposed, anchorChanged } = compareForecasts(before, after, clock.today, options.through);
  const base = { change, window, current, proposed, anchorChanged };

  if (!before.forecastStart || !after.forecastStart) {
    return { ok: true, preview: { ...base, comparable: false, reason: 'no-forecast', limitation: 'There is no upcoming income to start a running total from, so the two forecasts can’t be compared.', lowestChangeCents: null, target: null, newGaps: [], worsenedGaps: [] } };
  }
  if (anchorChanged) {
    return {
      ok: true,
      preview: {
        ...base,
        comparable: false,
        reason: 'anchor-changed',
        limitation: `This change moves the next payday from ${before.forecastStart} to ${after.forecastStart}, so the running totals start from different days and can’t be compared directly.`,
        lowestChangeCents: null,
        target: null,
        newGaps: [],
        worsenedGaps: [],
      },
    };
  }

  const entry = before.entries.find((e) => e.occurrence.id === change.occurrenceId);
  const entryDate = entry?.date;
  const movedDate = after.entries.find((e) => e.occurrence.id === change.occurrenceId)?.date;
  if (change.kind === 'move' && entryDate && movedDate && entryDate >= before.forecastStart && movedDate < after.forecastStart) {
    // The running total starts the day before the next payday, so anything earlier isn't in it. Showing that as a fix would mislead.
    return {
      ok: true,
      preview: {
        ...base,
        comparable: false,
        reason: 'before-payday',
        limitation: `The new date is before the next payday (${after.forecastStart}), when the running total starts, so the payment would simply drop out of it. The forecast can’t show whether money on hand covers it.`,
        lowestChangeCents: null,
        target: null,
        newGaps: [],
        worsenedGaps: [],
      },
    };
  }
  // The gap the occurrence falls in; for income, otherwise the gap it ends.
  const targetGap = entryDate
    ? (current.gaps.find((g) => entryDate >= g.start && entryDate <= g.end) ??
      (entry!.signedCents > 0 ? current.gaps.find((g) => g.recoversOn === entryDate) : undefined) ??
      null)
    : null;
  let target: ChangePreview['target'] = null;
  if (targetGap) {
    const proposedGaps = proposed.gaps.filter((g) => overlaps(g, targetGap));
    const low = proposedGaps.length ? Math.min(...proposedGaps.map((g) => g.lowestCents)) : null;
    const days = proposedGaps.reduce((n, g) => n + g.days, 0);
    // Lower is worse; at the same low point, fewer days below $0 is better.
    const outcome: GapOutcome =
      low === null ? 'eliminated'
      : low !== targetGap.lowestCents ? (low > targetGap.lowestCents ? 'reduced' : 'worsened')
      : days === targetGap.days ? 'unchanged'
      : days < targetGap.days ? 'reduced' : 'worsened';
    target = { gap: targetGap, outcome, proposedGaps, recoversOn: { current: targetGap.recoversOn, proposed: proposedGaps.at(-1)?.recoversOn ?? null } };
  }
  const others = current.gaps.filter((g) => g !== targetGap);
  const newGaps = proposed.gaps.filter((g) => !current.gaps.some((c) => overlaps(c, g)));
  const worsenedGaps = proposed.gaps.filter((g) => others.some((c) => overlaps(c, g) && g.lowestCents < c.lowestCents) && !(targetGap && overlaps(g, targetGap)));

  return {
    ok: true,
    preview: {
      ...base,
      comparable: true,
      limitation: null,
      reason: null,
      lowestChangeCents: current.lowest && proposed.lowest ? proposed.lowest.tallyCents - current.lowest.tallyCents : null,
      target,
      newGaps,
      worsenedGaps,
    },
  };
}

/** Kept on a skipped occurrence, so its record says what the cancellation was. */
export const SKIP_NOTE = 'Left out of the forecast in a what-if preview. Nothing changed outside Financial OS.';

/** Same sources and records, regardless of when or where they were saved. */
function sameFinancialData(a: AppData, b: AppData): boolean {
  return a === b || JSON.stringify([a.sources, a.records]) === JSON.stringify([b.sources, b.records]);
}

/**
 * Makes a previewed change real, after the person confirms it. Refused when
 * the data has changed since the preview was made (`previewedOn`), so a stale
 * preview is never applied, or when the preview couldn't be compared.
 * Changes only that one occurrence; a skip is recorded as a cancellation.
 */
export function applyPreviewedChange(data: AppData, previewedOn: AppData, change: ProposedChange, clock: ops.Clock): ops.Result {
  if (!sameFinancialData(data, previewedOn)) return { ok: false, error: 'Your forecast changed after this preview. Check the updated preview before applying.' };
  const preview = previewChange(data, change, clock);
  if (!preview.ok) return preview;
  if (!preview.preview.comparable) return { ok: false, error: 'This preview can’t be compared with your forecast, so it can’t be applied from here.' };
  return applyProposedChange(data, change, clock, change.kind === 'skip' ? SKIP_NOTE : '');
}
