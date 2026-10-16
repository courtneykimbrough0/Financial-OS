/**
 * Mapping between the app's plan (AppData) and the Supabase tables, with no
 * network involved. `toRows` builds the request body for `save_plan`;
 * `fromRows` turns what `load_plan` returns back into AppData. Field names
 * follow the SQL columns (supabase/migrations).
 *
 * Every financially meaningful field round-trips exactly: identities,
 * original predictions, current expectations, actuals, schedules, pauses,
 * estimate dismissals, the review rhythm (including "none chosen") and
 * onboarding. Three things come back in canonical form (see `canonicalize`):
 * timestamps as ISO-8601 UTC with milliseconds, schedule versions in start
 * order, and pauses in date order. Sample data is never stored.
 */
import { isValidDateStr, type DateStr } from '../../domain/dates';
import { validateRule } from '../../domain/recurrence';
import { type AppData, type OccurrenceRecord, type RecurrenceRule, type RecurringSource, type ReviewCadence, type ScheduleVersion, type StoredStatus, type TransactionKind } from '../../domain/types';

export interface SourceRow {
  id: string;
  position: number;
  kind: TransactionKind;
  description: string;
  tags: string[];
  liability_type: RecurringSource['liabilityType'] | null;
  main_paycheck: boolean;
  active: boolean;
  end_date: DateStr | null;
  dismissed_current_cents: number | null;
  dismissed_proposed_cents: number | null;
  dismissed_through: DateStr | null;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  source_id: string;
  id: string;
  start_date: DateStr;
  amount_cents: number;
  rule_type: RecurrenceRule['type'];
  rule_days: number[] | null;
  rule_interval: number | null;
  rule_unit: 'day' | 'week' | 'month' | null;
}

export interface PauseRow {
  source_id: string;
  from_date: DateStr;
  until_date: DateStr;
}

export interface RecordRow {
  id: string;
  position: number;
  source_id: string | null;
  kind: TransactionKind;
  description: string;
  tags: string[];
  expected_date: DateStr;
  expected_amount_cents: number;
  scheduled_date: DateStr;
  scheduled_amount_cents: number;
  status: StoredStatus;
  actual_date: DateStr | null;
  actual_amount_cents: number | null;
  completed_at: string | null;
  canceled_at: string | null;
  cancel_note: string | null;
  created_at: string;
  updated_at: string;
}

/** The body of a save_plan request. */
export interface PlanRows {
  onboarding_complete: boolean;
  review_cadence: ReviewCadence | null;
  review_handled_on: DateStr | null;
  review_outcome: 'completed' | 'skipped' | null;
  sources: SourceRow[];
  versions: VersionRow[];
  pauses: PauseRow[];
  records: RecordRow[];
}

/** What load_plan returns. */
export interface LoadedPlan extends PlanRows {
  workspace_id: string;
  revision: number;
  schema_version: number;
}

const byStart = (a: ScheduleVersion, b: ScheduleVersion) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0);

function ruleColumns(rule: RecurrenceRule): Pick<VersionRow, 'rule_type' | 'rule_days' | 'rule_interval' | 'rule_unit'> {
  if (rule.type === 'twiceMonthly') return { rule_type: rule.type, rule_days: [rule.days[0], rule.days[1]], rule_interval: null, rule_unit: null };
  if (rule.type === 'custom') return { rule_type: rule.type, rule_days: null, rule_interval: rule.interval, rule_unit: rule.unit };
  return { rule_type: rule.type, rule_days: null, rule_interval: null, rule_unit: null };
}

function ruleFrom(v: VersionRow): RecurrenceRule {
  if (v.rule_type === 'twiceMonthly') return { type: 'twiceMonthly', days: [v.rule_days![0]!, v.rule_days![1]!] };
  if (v.rule_type === 'custom') return { type: 'custom', interval: v.rule_interval!, unit: v.rule_unit! };
  return { type: v.rule_type };
}

/** The plan as the rows save_plan expects. Doesn't validate; see `checkForMigration`. */
export function toRows(data: AppData): PlanRows {
  const sources: SourceRow[] = data.sources.map((s, i) => ({
    id: s.id,
    position: i,
    kind: s.kind,
    description: s.description,
    tags: s.tags,
    liability_type: s.liabilityType ?? null,
    main_paycheck: s.mainPaycheck === true,
    active: s.active,
    end_date: s.endDate,
    dismissed_current_cents: s.estimateDismissal?.currentCents ?? null,
    dismissed_proposed_cents: s.estimateDismissal?.proposedCents ?? null,
    dismissed_through: s.estimateDismissal?.through ?? null,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  }));
  const versions: VersionRow[] = data.sources.flatMap((s) =>
    s.versions.map((v) => ({ source_id: s.id, id: v.id, start_date: v.startDate, amount_cents: v.amountCents, ...ruleColumns(v.rule) })),
  );
  const pauses: PauseRow[] = data.sources.flatMap((s) => s.pausedRanges.map((p) => ({ source_id: s.id, from_date: p.from, until_date: p.until })));
  const records: RecordRow[] = data.records.map((r, i) => ({
    id: r.id,
    position: i,
    source_id: r.sourceId,
    kind: r.kind,
    description: r.description,
    tags: r.tags,
    expected_date: r.expectedDate,
    expected_amount_cents: r.expectedAmountCents,
    scheduled_date: r.scheduledDate,
    scheduled_amount_cents: r.scheduledAmountCents,
    status: r.status,
    actual_date: r.actualDate,
    actual_amount_cents: r.actualAmountCents,
    completed_at: r.completedAt,
    canceled_at: r.canceledAt,
    cancel_note: r.cancelNote,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
  return {
    onboarding_complete: data.onboardingComplete,
    review_cadence: data.review?.cadence ?? null,
    review_handled_on: data.review?.handledOn ?? null,
    review_outcome: data.review?.outcome ?? null,
    sources,
    versions,
    pauses,
    records,
  };
}

/** The plan load_plan returned, as AppData. */
export function fromRows(plan: LoadedPlan): AppData {
  const versionsOf = new Map<string, ScheduleVersion[]>();
  for (const v of plan.versions) {
    const list = versionsOf.get(v.source_id) ?? [];
    list.push({ id: v.id, startDate: v.start_date, amountCents: Number(v.amount_cents), rule: ruleFrom(v) });
    versionsOf.set(v.source_id, list);
  }
  const pausesOf = new Map<string, { from: DateStr; until: DateStr }[]>();
  for (const p of plan.pauses) {
    const list = pausesOf.get(p.source_id) ?? [];
    list.push({ from: p.from_date, until: p.until_date });
    pausesOf.set(p.source_id, list);
  }
  const sources: RecurringSource[] = [...plan.sources]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      description: s.description,
      tags: s.tags ?? [],
      ...(s.liability_type ? { liabilityType: s.liability_type } : {}),
      ...(s.main_paycheck ? { mainPaycheck: true } : {}),
      versions: (versionsOf.get(s.id) ?? []).sort(byStart),
      active: s.active,
      endDate: s.end_date,
      pausedRanges: (pausesOf.get(s.id) ?? []).sort((a, b) => (a.from < b.from ? -1 : 1)),
      ...(s.dismissed_current_cents !== null
        ? { estimateDismissal: { currentCents: Number(s.dismissed_current_cents), proposedCents: Number(s.dismissed_proposed_cents), through: s.dismissed_through! } }
        : {}),
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  const records: OccurrenceRecord[] = [...plan.records]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      kind: r.kind,
      description: r.description,
      tags: r.tags ?? [],
      expectedDate: r.expected_date,
      expectedAmountCents: Number(r.expected_amount_cents),
      scheduledDate: r.scheduled_date,
      scheduledAmountCents: Number(r.scheduled_amount_cents),
      status: r.status,
      actualDate: r.actual_date,
      actualAmountCents: r.actual_amount_cents === null ? null : Number(r.actual_amount_cents),
      completedAt: r.completed_at,
      canceledAt: r.canceled_at,
      cancelNote: r.cancel_note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  return {
    schemaVersion: 2,
    revision: Number(plan.revision),
    onboardingComplete: plan.onboarding_complete,
    sources,
    records,
    ...(plan.review_cadence ? { review: { cadence: plan.review_cadence, handledOn: plan.review_handled_on, outcome: plan.review_outcome } } : {}),
  };
}

/** An ISO timestamp as the database returns it: UTC, milliseconds, `Z`. */
export function canonicalTimestamp(value: string): string {
  return new Date(value).toISOString();
}

/**
 * The plan as it comes back from the database: timestamps in canonical form,
 * versions in start order, pauses in date order, sample flag dropped. Nothing
 * financial changes.
 */
export function canonicalize(data: AppData): AppData {
  const { isSample: _sample, ...rest } = data;
  void _sample;
  const ts = (s: string | null) => (s === null ? null : canonicalTimestamp(s));
  return {
    ...rest,
    sources: data.sources.map((s) => ({
      ...s,
      versions: [...s.versions].sort(byStart),
      pausedRanges: [...s.pausedRanges].sort((a, b) => (a.from < b.from ? -1 : 1)),
      createdAt: canonicalTimestamp(s.createdAt),
      updatedAt: canonicalTimestamp(s.updatedAt),
    })),
    records: data.records.map((r) => ({ ...r, completedAt: ts(r.completedAt), canceledAt: ts(r.canceledAt), createdAt: canonicalTimestamp(r.createdAt), updatedAt: canonicalTimestamp(r.updatedAt) })),
  };
}

export interface MigrationIssue {
  /** `error`: the database would refuse it; fix before migrating. `normalized`: stored in canonical form, nothing financial changes. */
  level: 'error' | 'normalized';
  message: string;
}

const MAX_CENTS = 100_000_000_00;
const isCents = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= MAX_CENTS;
const isTimestamp = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const KINDS: TransactionKind[] = ['income', 'bill', 'subscription', 'liability', 'savings'];

/**
 * Everything in a plan (already through `migrate`) that the database would
 * refuse, or that will be stored in canonical form. Run before migrating; an
 * empty list of errors means the plan will save unchanged.
 */
export function checkForMigration(data: AppData): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  const error = (message: string) => issues.push({ level: 'error', message });
  const normalized = (message: string) => issues.push({ level: 'normalized', message });
  const text = (s: string) => s.trim() !== '' && s.length <= 200;

  const sourceIds = new Set<string>();
  const versionIds = new Set<string>();
  let mains = 0;
  data.sources.forEach((s, i) => {
    const where = `Item ${i + 1} (${s.id})`;
    if (sourceIds.has(s.id)) error(`${where}: the id is used twice.`);
    sourceIds.add(s.id);
    if (s.id.includes('@') || s.id.length === 0 || s.id.length > 200) error(`${where}: the id can't be used (empty, too long, or contains @).`);
    if (!KINDS.includes(s.kind)) error(`${where}: unknown kind.`);
    if (!text(s.description)) error(`${where}: the description is empty or longer than 200 characters.`);
    if (s.tags.length > 10) error(`${where}: more than 10 tags.`);
    if (s.mainPaycheck) mains += 1;
    if (s.active && s.endDate !== null) error(`${where}: it's on but has an end date.`);
    if (!isTimestamp(s.createdAt) || !isTimestamp(s.updatedAt)) error(`${where}: a created or updated time isn't a valid time.`);
    if (s.versions.length === 0) error(`${where}: it has no schedule.`);
    const starts = new Set<string>();
    s.versions.forEach((v, j) => {
      if (!v.id) error(`${where}, schedule ${j + 1}: it has no id.`);
      else if (versionIds.has(v.id)) error(`${where}, schedule ${j + 1}: the id is used twice.`);
      versionIds.add(v.id);
      if (!isValidDateStr(v.startDate)) error(`${where}, schedule ${j + 1}: the start date isn't valid.`);
      if (starts.has(v.startDate)) error(`${where}: two schedules start on ${v.startDate}.`);
      starts.add(v.startDate);
      if (!isCents(v.amountCents)) error(`${where}, schedule ${j + 1}: the amount must be above $0 and at most $100,000,000.`);
      const ruleError = validateRule(v.rule, v.startDate);
      if (ruleError) error(`${where}, schedule ${j + 1}: ${ruleError}`);
    });
    if (s.versions.some((v, j) => j > 0 && v.startDate < s.versions[j - 1]!.startDate)) normalized(`${where}: schedules will be stored in start-date order.`);
    if (s.pausedRanges.some((p) => !(isValidDateStr(p.from) && isValidDateStr(p.until) && p.until > p.from))) error(`${where}: a turned-off stretch has invalid dates.`);
    if (s.pausedRanges.some((p, j) => j > 0 && p.from < s.pausedRanges[j - 1]!.from)) normalized(`${where}: turned-off stretches will be stored in date order.`);
  });
  if (mains > 1) error('More than one item is marked as the main paycheck.');

  const recordIds = new Set<string>();
  data.records.forEach((r, i) => {
    const where = `Record ${i + 1} (${r.id})`;
    if (recordIds.has(r.id)) error(`${where}: the id is used twice.`);
    recordIds.add(r.id);
    if (r.sourceId !== null) {
      if (!sourceIds.has(r.sourceId)) error(`${where}: its item no longer exists.`);
      if (r.id !== `${r.sourceId}@${r.expectedDate}`) error(`${where}: the id doesn't match its item and original date.`);
    } else if (!['income', 'bill', 'savings'].includes(r.kind)) {
      error(`${where}: a one-time item can't be a ${r.kind}.`);
    }
    if (!text(r.description)) error(`${where}: the description is empty or longer than 200 characters.`);
    if (r.tags.length > 10) error(`${where}: more than 10 tags.`);
    for (const [label, d] of [['original', r.expectedDate], ['scheduled', r.scheduledDate]] as const) if (!isValidDateStr(d)) error(`${where}: the ${label} date isn't valid.`);
    if (!isCents(r.expectedAmountCents) || !isCents(r.scheduledAmountCents)) error(`${where}: an amount must be above $0 and at most $100,000,000.`);
    const completed = r.status === 'completed';
    if (completed !== (r.actualDate !== null) || completed !== (r.actualAmountCents !== null)) error(`${where}: an actual must be recorded exactly when it's done.`);
    else if (completed && (!isValidDateStr(r.actualDate) || !isCents(r.actualAmountCents))) error(`${where}: the actual date or amount isn't valid.`);
    if ((r.status === 'canceled') !== (r.canceledAt !== null)) error(`${where}: the cancel time doesn't match its status.`);
    if (r.cancelNote !== null && (r.status !== 'canceled' || r.cancelNote.length > 500)) error(`${where}: a cancel note on something not canceled, or longer than 500 characters.`);
    if (![r.createdAt, r.updatedAt].every(isTimestamp) || ![r.completedAt, r.canceledAt].every((t) => t === null || isTimestamp(t))) error(`${where}: a time isn't a valid time.`);
  });

  const all = [...data.sources.flatMap((s) => [s.createdAt, s.updatedAt]), ...data.records.flatMap((r) => [r.createdAt, r.updatedAt, r.completedAt, r.canceledAt])];
  if (all.some((t) => t !== null && isTimestamp(t) && canonicalTimestamp(t) !== t)) normalized('Some times will be stored as ISO-8601 UTC with milliseconds.');
  if (data.isSample) error('Sample data is never stored in an account.');
  return issues;
}
