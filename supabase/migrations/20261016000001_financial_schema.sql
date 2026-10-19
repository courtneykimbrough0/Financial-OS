-- Financial OS: relational storage for the existing financial model.
--
-- Five financial tables mirror AppData exactly (see docs/SUPABASE.md):
--   workspaces          one plan: revision, onboarding, review rhythm
--   sources             recurring items (RecurringSource)
--   schedule_versions   their dated amounts and recurrence rules
--   source_pauses       stretches an item was turned off (pausedRanges)
--   occurrence_records  one-time items and acted-on recurring occurrences
-- plus one persistence-only table, save_receipts, that makes retried saves
-- answerable (see save_plan).
--
-- Forecasts are never stored: the TypeScript engine derives them. Money is
-- integer cents (bigint); financial dates are `date`; audit times are
-- timestamptz. Every child row carries workspace_id and every foreign key
-- includes it, so no row can point into another workspace.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  -- One plan per person for now. Sharing later adds a membership table and
  -- changes the access policies; rows don't move.
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  schema_version smallint not null default 2 check (schema_version = 2),
  onboarding_complete boolean not null default false,
  -- AppData.review: null cadence means no rhythm chosen (review absent),
  -- which differs from a chosen 'off'.
  review_cadence text check (review_cadence in ('off', 'weekly', 'payday', 'monthly')),
  review_handled_on date,
  review_outcome text check (review_outcome in ('completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_review_needs_cadence check (review_cadence is not null or (review_handled_on is null and review_outcome is null)),
  constraint workspaces_review_outcome_needs_date check (review_outcome is null or review_handled_on is not null)
);

create table public.sources (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- The app's own id. Recurring occurrence ids are derived as <id>@<date>,
  -- so an id can't contain '@'.
  id text not null check (length(id) between 1 and 200 and position('@' in id) = 0),
  -- Order matters: with no main paycheck marked, the first active income
  -- starts pay periods (mainPaycheckId).
  position integer not null check (position >= 0),
  kind text not null check (kind in ('income', 'bill', 'subscription', 'liability', 'savings')),
  description text not null check (btrim(description) <> '' and length(description) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  liability_type text check (liability_type in ('card', 'loan', 'lineOfCredit')),
  main_paycheck boolean not null default false,
  active boolean not null,
  end_date date,
  -- estimateDismissal: all three fields or none.
  dismissed_current_cents bigint check (dismissed_current_cents > 0 and dismissed_current_cents <= 10000000000),
  dismissed_proposed_cents bigint check (dismissed_proposed_cents > 0 and dismissed_proposed_cents <= 10000000000),
  dismissed_through date,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id),
  constraint sources_liability_type_only_on_liabilities check (liability_type is null or kind = 'liability'),
  constraint sources_main_paycheck_only_on_income check (not main_paycheck or kind = 'income'),
  constraint sources_active_has_no_end check (not (active and end_date is not null)),
  constraint sources_dismissal_complete check (
    (dismissed_current_cents is null) = (dismissed_proposed_cents is null)
    and (dismissed_current_cents is null) = (dismissed_through is null)
  )
);
-- At most one main paycheck per plan (setMainPaycheck clears the others).
create unique index sources_one_main_paycheck on public.sources (workspace_id) where main_paycheck;

create table public.schedule_versions (
  workspace_id uuid not null,
  source_id text not null,
  id text not null check (length(id) between 1 and 200),
  start_date date not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 10000000000),
  rule_type text not null check (rule_type in ('weekly', 'biweekly', 'monthly', 'twiceMonthly', 'custom')),
  rule_days smallint[],
  rule_interval integer,
  rule_unit text check (rule_unit in ('day', 'week', 'month')),
  primary key (workspace_id, id),
  -- The engine treats each version as covering its start date up to the next.
  unique (workspace_id, source_id, start_date),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete cascade,
  -- The same rules as validateRule.
  constraint schedule_versions_rule_shape check (
    case rule_type
      when 'twiceMonthly' then rule_days is not null and cardinality(rule_days) = 2
        and rule_days[1] between 1 and 31 and rule_days[2] between 1 and 31 and rule_days[1] <> rule_days[2]
        and rule_interval is null and rule_unit is null
      when 'custom' then rule_days is null and rule_interval between 1 and 365 and rule_unit is not null
      else rule_days is null and rule_interval is null and rule_unit is null
    end
  )
);

create table public.source_pauses (
  workspace_id uuid not null,
  source_id text not null,
  from_date date not null,
  until_date date not null,
  primary key (workspace_id, source_id, from_date),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete cascade,
  constraint source_pauses_ordered check (until_date > from_date)
);

create table public.occurrence_records (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (length(id) between 1 and 300),
  position integer not null check (position >= 0),
  -- Null for a one-time item.
  source_id text,
  -- Copies taken when the record was created; a later rename of the source
  -- doesn't change them.
  kind text not null check (kind in ('income', 'bill', 'subscription', 'liability', 'savings')),
  description text not null check (btrim(description) <> '' and length(description) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  -- The original prediction (never changed by ordinary saves; see save_plan),
  expected_date date not null,
  expected_amount_cents bigint not null check (expected_amount_cents > 0 and expected_amount_cents <= 10000000000),
  -- the current expectation,
  scheduled_date date not null,
  scheduled_amount_cents bigint not null check (scheduled_amount_cents > 0 and scheduled_amount_cents <= 10000000000),
  status text not null check (status in ('scheduled', 'completed', 'canceled')),
  -- and what actually happened.
  actual_date date,
  actual_amount_cents bigint check (actual_amount_cents > 0 and actual_amount_cents <= 10000000000),
  completed_at timestamptz,
  canceled_at timestamptz,
  cancel_note text check (length(cancel_note) <= 500),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id),
  -- A source with recorded history can't be deleted (deleteSource).
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete restrict,
  -- A recurring record is the occurrence of its source on its original date.
  constraint occurrence_records_recurring_id check (source_id is null or id = source_id || '@' || to_char(expected_date, 'YYYY-MM-DD')),
  -- One-time items are income, bills or savings (addOneTime).
  constraint occurrence_records_one_time_kind check (source_id is not null or kind in ('income', 'bill', 'savings')),
  -- An actual exists exactly when the occurrence is completed.
  constraint occurrence_records_actual_iff_completed check (
    (status = 'completed') = (actual_date is not null)
    and (status = 'completed') = (actual_amount_cents is not null)
  ),
  constraint occurrence_records_canceled_at check ((status = 'canceled') = (canceled_at is not null)),
  constraint occurrence_records_note_only_when_canceled check (cancel_note is null or status = 'canceled')
);
-- One record per occurrence of a source. Records whose original date a later
-- schedule no longer produces are kept (the engine sets them aside).
create unique index occurrence_records_one_per_occurrence on public.occurrence_records (workspace_id, source_id, expected_date) where source_id is not null;

-- Persistence only: one row per accepted save, so a retried request (after a
-- timeout, say) can be told definitively whether it was applied. Not
-- financial data; never readable by clients.
create table public.save_receipts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  save_id uuid not null,
  mode text not null check (mode in ('update', 'replace', 'reset')),
  base_revision bigint not null,
  fingerprint text not null,
  result_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, save_id)
);
