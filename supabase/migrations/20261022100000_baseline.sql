-- Financial OS: the whole database, as one baseline (roadmap Phase F, F3).
--
-- Replaces the nine development migrations (20261016000001 to
-- 20261022000005), which built the same schema step by step. No hosted
-- database ever ran them and there is no data to carry over, so a fresh
-- project applies this one file. The schema is identical to what the nine
-- produced (checked by comparing database dumps; see docs/SUPABASE.md).
-- Later changes are new migrations after this one.
--
-- Tables (see docs/SUPABASE.md):
--   workspaces          one plan per person: revision, onboarding (the review
--                       columns are retired and stay unused)
--   sources             recurring items (RecurringSource)
--   schedule_versions   their dated amounts and recurrence rules
--   source_pauses       stretches an item was turned off (pausedRanges)
--   occurrence_records  one-time items and acted-on recurring occurrences
--   work_entries        shifts and gig sessions (Phase E)
--   clients, freelance_jobs   freelance work (Phase E)
--   accounts, transfers       financial accounts and money moved between them
--   save_receipts       persistence only: makes retried saves answerable
--
-- Forecasts are never stored: the TypeScript engine derives them. Money is
-- integer cents (bigint); financial dates are `date`; audit times are
-- timestamptz. Every child row carries workspace_id and every foreign key
-- includes it, so no row can point into another workspace. Clients can only
-- read their own rows (row-level security) and write only through save_plan.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  -- One plan per person for now. Sharing later adds a membership table and
  -- changes the access policies; rows don't move.
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  schema_version smallint not null default 2 check (schema_version = 2),
  onboarding_complete boolean not null default false,
  -- Retired (review rhythm removed in H2): always null.
  review_cadence text check (review_cadence in ('off', 'weekly', 'payday', 'monthly')),
  review_handled_on date,
  review_outcome text check (review_outcome in ('completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_review_needs_cadence check (review_cadence is not null or (review_handled_on is null and review_outcome is null)),
  constraint workspaces_review_outcome_needs_date check (review_outcome is null or review_handled_on is not null)
);

-- Financial accounts: where money is received, held and spent.
create table public.accounts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  position integer not null check (position >= 0),
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  type text not null check (type in ('income', 'distribution', 'payment')),
  opening_amount_cents bigint check (abs(opening_amount_cents) <= 10000000000),
  opening_date date,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id),
  -- An opening balance is an amount on a date, or nothing.
  constraint accounts_opening_whole check ((opening_amount_cents is null) = (opening_date is null))
);

create table public.sources (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- The app's own id. Recurring occurrence ids are derived as <id>@<date>,
  -- so an id can't contain '@'.
  id text not null check (length(id) between 1 and 200 and position('@' in id) = 0),
  position integer not null check (position >= 0),
  kind text not null check (kind in ('income', 'bill', 'subscription', 'liability', 'reserve')),
  description text not null check (btrim(description) <> '' and length(description) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  liability_type text check (liability_type in ('card', 'loan', 'lineOfCredit')),
  -- Retired (main paycheck removed in R1): always false.
  main_paycheck boolean not null default false,
  active boolean not null,
  end_date date,
  -- estimateDismissal: all three fields or none.
  dismissed_current_cents bigint check (dismissed_current_cents > 0 and dismissed_current_cents <= 10000000000),
  dismissed_proposed_cents bigint check (dismissed_proposed_cents > 0 and dismissed_proposed_cents <= 10000000000),
  dismissed_through date,
  -- 'possible' on possible income; null means expected.
  certainty text,
  income_type text,
  hourly_wage_cents bigint,
  -- Checked when the transaction commits, so a save can replace accounts and the items naming them in any order.
  account_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id),
  constraint sources_account foreign key (workspace_id, account_id) references public.accounts (workspace_id, id) deferrable initially deferred,
  constraint sources_liability_type_only_on_liabilities check (liability_type is null or kind = 'liability'),
  constraint sources_main_paycheck_only_on_income check (not main_paycheck or kind = 'income'),
  constraint sources_active_has_no_end check (not (active and end_date is not null)),
  constraint sources_dismissal_complete check (
    (dismissed_current_cents is null) = (dismissed_proposed_cents is null)
    and (dismissed_current_cents is null) = (dismissed_through is null)
  ),
  constraint sources_certainty_possible_income check (certainty is null or (certainty = 'possible' and kind = 'income')),
  constraint sources_income_type_values check (income_type is null or (income_type in ('hourly', 'tipped', 'gig') and kind = 'income')),
  constraint sources_hourly_wage check (hourly_wage_cents is null or (income_type is not null and income_type in ('hourly', 'tipped') and hourly_wage_cents > 0 and hourly_wage_cents <= 10000000000))
);
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
  kind text not null,
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
  -- 'possible' on possible one-time income; null otherwise.
  certainty text,
  account_id text,
  -- A one-time Strategic Reserves record that returns money to available cash flow.
  release boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id),
  -- A source with recorded history can't be deleted (deleteSource).
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete restrict,
  constraint records_account foreign key (workspace_id, account_id) references public.accounts (workspace_id, id) deferrable initially deferred,
  constraint occurrence_records_kind_check check (kind in ('income', 'bill', 'subscription', 'liability', 'reserve', 'varied')),
  -- A recurring record is the occurrence of its source on its original date.
  constraint occurrence_records_recurring_id check (source_id is null or id = source_id || '@' || to_char(expected_date, 'YYYY-MM-DD')),
  -- One-time items are income, varied spending or reserves; varied spending is never recurring.
  constraint occurrence_records_one_time_kind check (case when source_id is null then kind in ('income', 'varied', 'reserve') else kind <> 'varied' end),
  -- An actual exists exactly when the occurrence is completed.
  constraint occurrence_records_actual_iff_completed check (
    (status = 'completed') = (actual_date is not null)
    and (status = 'completed') = (actual_amount_cents is not null)
  ),
  constraint occurrence_records_canceled_at check ((status = 'canceled') = (canceled_at is not null)),
  constraint occurrence_records_note_only_when_canceled check (cancel_note is null or status = 'canceled'),
  constraint occurrence_records_certainty_possible_one_time_income check (certainty is null or (certainty = 'possible' and kind = 'income' and source_id is null)),
  -- A recurring occurrence follows its item's account until it is recorded.
  constraint records_account_when check (account_id is null or source_id is null or status = 'completed'),
  -- Only a one-time Strategic Reserves record can be a release.
  constraint records_release_where check (not release or (source_id is null and kind = 'reserve'))
);
-- One record per occurrence of a source. Records whose original date a later
-- schedule no longer produces are kept (the engine sets them aside).
create unique index occurrence_records_one_per_occurrence on public.occurrence_records (workspace_id, source_id, expected_date) where source_id is not null;

-- Shifts (hourly and tipped income) and sessions (gig income): earnings, never money received.
create table public.work_entries (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  position integer not null check (position >= 0),
  source_id text not null,
  kind text not null,
  work_date date not null,
  minutes integer check (minutes between 1 and 1440),
  wage_cents bigint check (wage_cents > 0 and wage_cents <= 10000000000),
  cash_tips_cents bigint check (cash_tips_cents > 0 and cash_tips_cents <= 10000000000),
  card_tips_cents bigint check (card_tips_cents > 0 and card_tips_cents <= 10000000000),
  earnings_cents bigint check (earnings_cents > 0 and earnings_cents <= 10000000000),
  platform text check (btrim(platform) <> '' and length(platform) <= 40),
  -- The received one-time income record for the cash, and the recorded paycheck or payout that paid the rest.
  cash_tips_record_id text,
  paid_by_occurrence_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete restrict,
  foreign key (workspace_id, cash_tips_record_id) references public.occurrence_records (workspace_id, id) on delete restrict,
  foreign key (workspace_id, paid_by_occurrence_id) references public.occurrence_records (workspace_id, id) on delete restrict,
  constraint work_entries_kind_check check (kind in ('shift', 'session')),
  constraint work_entries_tips_record_needs_tips check (cash_tips_record_id is null or cash_tips_cents is not null),
  constraint work_entries_fields_by_kind check (
    case when kind = 'shift'
      then earnings_cents is null and platform is null and (minutes is not null or cash_tips_cents is not null or card_tips_cents is not null)
      else wage_cents is null and card_tips_cents is null and (earnings_cents is not null or cash_tips_cents is not null)
    end)
);
create unique index work_entries_one_per_tips_record on public.work_entries (workspace_id, cash_tips_record_id) where cash_tips_record_id is not null;

create table public.clients (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  position integer not null check (position >= 0),
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id)
);

create table public.freelance_jobs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  position integer not null check (position >= 0),
  client_id text,
  description text not null check (btrim(description) <> '' and length(description) <= 200),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 10000000000),
  status text not null check (status in ('planned', 'done')),
  payment_record_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete restrict,
  foreign key (workspace_id, payment_record_id) references public.occurrence_records (workspace_id, id) on delete restrict
);
-- One job per payment record, so a payment is never attached twice.
create unique index freelance_jobs_one_per_payment on public.freelance_jobs (workspace_id, payment_record_id) where payment_record_id is not null;

create table public.transfers (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  position integer not null check (position >= 0),
  from_account_id text not null,
  to_account_id text not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 10000000000),
  transfer_date date not null,
  status text not null check (status in ('expected', 'recorded')),
  recorded_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, id),
  constraint transfers_two_accounts check (from_account_id <> to_account_id),
  constraint transfers_recorded_when check ((status = 'recorded') = (recorded_at is not null)),
  foreign key (workspace_id, from_account_id) references public.accounts (workspace_id, id) deferrable initially deferred,
  foreign key (workspace_id, to_account_id) references public.accounts (workspace_id, id) deferrable initially deferred
);

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

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Clients (role `authenticated`) may only SELECT their own workspace's rows.
-- They can't write any table directly; every write goes through save_plan,
-- which checks the caller owns the workspace, checks the revision, validates
-- the plan and applies it in one transaction. `anon` (no signed-in user) gets
-- nothing. Supabase grants table and function privileges to anon and
-- authenticated by default, so they're revoked here explicitly.
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.sources enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.source_pauses enable row level security;
alter table public.occurrence_records enable row level security;
alter table public.work_entries enable row level security;
alter table public.clients enable row level security;
alter table public.freelance_jobs enable row level security;
alter table public.accounts enable row level security;
alter table public.transfers enable row level security;
alter table public.save_receipts enable row level security;
revoke all on table public.workspaces, public.sources, public.schedule_versions, public.source_pauses, public.occurrence_records, public.work_entries, public.clients, public.freelance_jobs, public.accounts, public.transfers, public.save_receipts
  from public, anon, authenticated;
grant select on table public.workspaces, public.sources, public.schedule_versions, public.source_pauses, public.occurrence_records, public.work_entries, public.clients, public.freelance_jobs, public.accounts, public.transfers
  to authenticated;
-- save_receipts: no grants and no policies, so clients can never see it.
create policy workspaces_owner_reads on public.workspaces
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy sources_owner_reads on public.sources
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy schedule_versions_owner_reads on public.schedule_versions
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy source_pauses_owner_reads on public.source_pauses
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy occurrence_records_owner_reads on public.occurrence_records
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy work_entries_owner_reads on public.work_entries
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy clients_owner_reads on public.clients
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy freelance_jobs_owner_reads on public.freelance_jobs
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy accounts_owner_reads on public.accounts
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy transfers_owner_reads on public.transfers
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- create_workspace(): the caller's workspace, created on first use. The owner
-- is always the signed-in caller; there is no way to name another.
-- ---------------------------------------------------------------------------

create function public.create_workspace() returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to save your plan.' using errcode = 'PT401';
  end if;
  insert into public.workspaces (owner_id) values (v_uid) on conflict (owner_id) do nothing;
  select w.id into v_id from public.workspaces w where w.owner_id = v_uid;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- load_plan(): the caller's whole plan as one JSON value, read in a single
-- statement (one consistent snapshot). Runs as the caller, so row-level
-- security applies. Null when the caller has no workspace yet.
-- Dates come back as YYYY-MM-DD and times as ISO-8601 UTC with milliseconds,
-- whatever the session's DateStyle or time zone.
-- ---------------------------------------------------------------------------

create function public.load_plan() returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_id', w.id,
    'revision', w.revision,
    'schema_version', w.schema_version,
    'onboarding_complete', w.onboarding_complete,
    'review_cadence', w.review_cadence,
    'review_handled_on', to_char(w.review_handled_on, 'YYYY-MM-DD'),
    'review_outcome', w.review_outcome,
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'position', s.position, 'kind', s.kind, 'description', s.description, 'tags', to_jsonb(s.tags),
        'liability_type', s.liability_type, 'main_paycheck', s.main_paycheck, 'active', s.active,
        'end_date', to_char(s.end_date, 'YYYY-MM-DD'),
        'dismissed_current_cents', s.dismissed_current_cents, 'dismissed_proposed_cents', s.dismissed_proposed_cents,
        'dismissed_through', to_char(s.dismissed_through, 'YYYY-MM-DD'), 'certainty', s.certainty,
        'income_type', s.income_type, 'hourly_wage_cents', s.hourly_wage_cents, 'account_id', s.account_id,
        'created_at', to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at', to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by s.position, s.id)
      from public.sources s where s.workspace_id = w.id), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_id', v.source_id, 'id', v.id, 'start_date', to_char(v.start_date, 'YYYY-MM-DD'), 'amount_cents', v.amount_cents,
        'rule_type', v.rule_type, 'rule_days', to_jsonb(v.rule_days), 'rule_interval', v.rule_interval, 'rule_unit', v.rule_unit
      ) order by v.source_id, v.start_date)
      from public.schedule_versions v where v.workspace_id = w.id), '[]'::jsonb),
    'pauses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_id', p.source_id, 'from_date', to_char(p.from_date, 'YYYY-MM-DD'), 'until_date', to_char(p.until_date, 'YYYY-MM-DD')
      ) order by p.source_id, p.from_date)
      from public.source_pauses p where p.workspace_id = w.id), '[]'::jsonb),
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'position', r.position, 'source_id', r.source_id, 'kind', r.kind, 'description', r.description, 'tags', to_jsonb(r.tags),
        'expected_date', to_char(r.expected_date, 'YYYY-MM-DD'), 'expected_amount_cents', r.expected_amount_cents,
        'scheduled_date', to_char(r.scheduled_date, 'YYYY-MM-DD'), 'scheduled_amount_cents', r.scheduled_amount_cents,
        'status', r.status, 'actual_date', to_char(r.actual_date, 'YYYY-MM-DD'), 'actual_amount_cents', r.actual_amount_cents,
        'completed_at', to_char(r.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'canceled_at', to_char(r.canceled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'cancel_note', r.cancel_note, 'certainty', r.certainty, 'account_id', r.account_id, 'release', r.release,
        'created_at', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at', to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by r.position, r.id)
      from public.occurrence_records r where r.workspace_id = w.id), '[]'::jsonb),
    'work_entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'position', e.position, 'source_id', e.source_id, 'kind', e.kind, 'work_date', to_char(e.work_date, 'YYYY-MM-DD'),
        'minutes', e.minutes, 'wage_cents', e.wage_cents, 'cash_tips_cents', e.cash_tips_cents, 'card_tips_cents', e.card_tips_cents,
        'earnings_cents', e.earnings_cents, 'platform', e.platform,
        'cash_tips_record_id', e.cash_tips_record_id, 'paid_by_occurrence_id', e.paid_by_occurrence_id,
        'created_at', to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at', to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by e.position, e.id)
      from public.work_entries e where e.workspace_id = w.id), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'position', c.position, 'name', c.name,
        'created_at', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by c.position, c.id)
      from public.clients c where c.workspace_id = w.id), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'position', j.position, 'client_id', j.client_id, 'description', j.description,
        'amount_cents', j.amount_cents, 'status', j.status, 'payment_record_id', j.payment_record_id,
        'created_at', to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at', to_char(j.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by j.position, j.id)
      from public.freelance_jobs j where j.workspace_id = w.id), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'position', a.position, 'name', a.name, 'type', a.type,
        'opening_amount_cents', a.opening_amount_cents, 'opening_date', to_char(a.opening_date, 'YYYY-MM-DD'),
        'created_at', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at', to_char(a.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by a.position, a.id)
      from public.accounts a where a.workspace_id = w.id), '[]'::jsonb),
    'transfers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'position', t.position, 'from_account_id', t.from_account_id, 'to_account_id', t.to_account_id,
        'amount_cents', t.amount_cents, 'transfer_date', to_char(t.transfer_date, 'YYYY-MM-DD'), 'status', t.status,
        'recorded_at', to_char(t.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'created_at', to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at', to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by t.position, t.id)
      from public.transfers t where t.workspace_id = w.id), '[]'::jsonb)
  )
  from public.workspaces w
  where w.owner_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- save_plan(base_revision, save_id, mode, plan): the whole plan, applied in
-- one transaction as revision base_revision + 1.
--
-- mode:
--   'update'  an ordinary change. Only changes the app's own operations can
--             make are accepted: at most one item or one one-time entry
--             removed per save, never an item with recorded history, never an
--             original prediction or an existing schedule version rewritten,
--             never back to setup. So an empty or truncated plan can't erase
--             a populated one by accident.
--   'replace' restore from a backup: the whole plan is replaced (destructive).
--   'reset'   start over: the plan must be empty and back in setup.
-- The database can't know the person confirmed a replace or reset; the app
-- asks for confirmation and offers a backup first. What the database
-- guarantees is that only the owner can do it, only against the revision
-- they were shown, only with a valid plan, and only when asked for by name.
--
-- Retries: the response to a save can be lost (a timeout doesn't prove
-- failure). Calling again with the same save_id and the same request returns
-- the original result ('already_saved') without applying anything twice, even
-- after later saves. The same save_id with different data is refused. Without
-- a receipt (unknown id, or older than the 30-day / 100-save retention), a
-- stale retry is a conflict and changes nothing.
--
-- Errors (SQLSTATE): PT401 not signed in, PT404 no workspace, PT409 the plan
-- changed since base_revision, PT422 the request isn't valid. Any failure
-- rolls back everything, including the receipt.
-- ---------------------------------------------------------------------------

create function public.save_plan(p_base_revision bigint, p_save_id uuid, p_mode text, p_plan jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ws public.workspaces%rowtype;
  v_fingerprint text;
  v_receipt public.save_receipts%rowtype;
  v_revision bigint;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in to save your plan.' using errcode = 'PT401';
  end if;
  if p_mode is null or p_mode not in ('update', 'replace', 'reset') then
    raise exception 'Unknown save mode.' using errcode = 'PT422';
  end if;
  if p_save_id is null or p_base_revision is null or p_base_revision < 0 then
    raise exception 'A save needs an id and the revision it is based on.' using errcode = 'PT422';
  end if;

  -- Lock this owner's workspace: concurrent saves wait here, then see the new revision.
  select * into v_ws from public.workspaces w where w.owner_id = v_uid for update;
  if not found then
    raise exception 'There is no plan to save to yet.' using errcode = 'PT404';
  end if;

  v_fingerprint := encode(sha256(convert_to(p_mode || '|' || p_base_revision::text || '|' || coalesce(p_plan::text, 'null'), 'UTF8')), 'hex');
  select * into v_receipt from public.save_receipts r where r.workspace_id = v_ws.id and r.save_id = p_save_id;
  if found then
    if v_receipt.fingerprint <> v_fingerprint then
      raise exception 'This save request was already used for a different change.' using errcode = 'PT422';
    end if;
    return jsonb_build_object('status', 'already_saved', 'revision', v_receipt.result_revision, 'current_revision', v_ws.revision);
  end if;

  if v_ws.revision <> p_base_revision then
    raise exception 'Your plan was changed somewhere else.' using errcode = 'PT409',
      detail = format('Stored revision %s, request based on %s.', v_ws.revision, p_base_revision);
  end if;

  -- Shape of the request.
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
    or jsonb_typeof(p_plan -> 'sources') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'versions') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'pauses') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'records') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'work_entries') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'clients') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'jobs') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'accounts') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'transfers') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'onboarding_complete') is distinct from 'boolean' then
    raise exception 'The plan is incomplete or malformed.' using errcode = 'PT422';
  end if;
  if jsonb_array_length(p_plan -> 'sources') > 2000 or jsonb_array_length(p_plan -> 'records') > 20000 or jsonb_array_length(p_plan -> 'work_entries') > 5000
    or jsonb_array_length(p_plan -> 'clients') > 200 or jsonb_array_length(p_plan -> 'jobs') > 5000
    or jsonb_array_length(p_plan -> 'accounts') > 50 or jsonb_array_length(p_plan -> 'transfers') > 20000 then
    raise exception 'The plan is too large.' using errcode = 'PT422';
  end if;

  drop table if exists pg_temp.fo_sources, pg_temp.fo_versions, pg_temp.fo_pauses, pg_temp.fo_records, pg_temp.fo_work_entries, pg_temp.fo_clients, pg_temp.fo_jobs, pg_temp.fo_accounts, pg_temp.fo_transfers;
  create temp table fo_sources on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'sources') as x(
      id text, position integer, kind text, description text, tags text[], liability_type text, main_paycheck boolean,
      active boolean, end_date date, dismissed_current_cents bigint, dismissed_proposed_cents bigint, dismissed_through date,
      certainty text, income_type text, hourly_wage_cents bigint, account_id text, created_at timestamptz, updated_at timestamptz);
  create temp table fo_versions on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'versions') as x(
      source_id text, id text, start_date date, amount_cents bigint, rule_type text, rule_days smallint[], rule_interval integer, rule_unit text);
  create temp table fo_pauses on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'pauses') as x(source_id text, from_date date, until_date date);
  create temp table fo_records on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'records') as x(
      id text, position integer, source_id text, kind text, description text, tags text[],
      expected_date date, expected_amount_cents bigint, scheduled_date date, scheduled_amount_cents bigint,
      status text, actual_date date, actual_amount_cents bigint, completed_at timestamptz, canceled_at timestamptz,
      cancel_note text, certainty text, account_id text, release boolean, created_at timestamptz, updated_at timestamptz);
  create temp table fo_work_entries on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'work_entries') as x(
      id text, position integer, source_id text, kind text, work_date date, minutes integer, wage_cents bigint,
      cash_tips_cents bigint, card_tips_cents bigint, earnings_cents bigint, platform text, cash_tips_record_id text, paid_by_occurrence_id text,
      created_at timestamptz, updated_at timestamptz);
  create temp table fo_clients on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'clients') as x(id text, position integer, name text, created_at timestamptz, updated_at timestamptz);
  create temp table fo_jobs on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'jobs') as x(
      id text, position integer, client_id text, description text, amount_cents bigint, status text, payment_record_id text,
      created_at timestamptz, updated_at timestamptz);
  create temp table fo_accounts on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'accounts') as x(
      id text, position integer, name text, type text, opening_amount_cents bigint, opening_date date, created_at timestamptz, updated_at timestamptz);
  create temp table fo_transfers on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'transfers') as x(
      id text, position integer, from_account_id text, to_account_id text, amount_cents bigint, transfer_date date, status text,
      recorded_at timestamptz, created_at timestamptz, updated_at timestamptz);

  -- Internal consistency, whatever the mode.
  if exists (select 1 from pg_temp.fo_sources where id is null)
    or (select count(*) from pg_temp.fo_sources) <> (select count(distinct id) from pg_temp.fo_sources)
    or exists (select 1 from pg_temp.fo_versions where id is null)
    or (select count(*) from pg_temp.fo_versions) <> (select count(distinct id) from pg_temp.fo_versions)
    or exists (select 1 from pg_temp.fo_records where id is null)
    or (select count(*) from pg_temp.fo_records) <> (select count(distinct id) from pg_temp.fo_records)
    or exists (select 1 from pg_temp.fo_work_entries where id is null)
    or (select count(*) from pg_temp.fo_work_entries) <> (select count(distinct id) from pg_temp.fo_work_entries)
    or exists (select 1 from pg_temp.fo_clients where id is null)
    or (select count(*) from pg_temp.fo_clients) <> (select count(distinct id) from pg_temp.fo_clients)
    or exists (select 1 from pg_temp.fo_jobs where id is null)
    or (select count(*) from pg_temp.fo_jobs) <> (select count(distinct id) from pg_temp.fo_jobs)
    or exists (select 1 from pg_temp.fo_accounts where id is null)
    or (select count(*) from pg_temp.fo_accounts) <> (select count(distinct id) from pg_temp.fo_accounts)
    or exists (select 1 from pg_temp.fo_transfers where id is null)
    or (select count(*) from pg_temp.fo_transfers) <> (select count(distinct id) from pg_temp.fo_transfers) then
    raise exception 'The plan has missing or repeated ids.' using errcode = 'PT422';
  end if;
  if exists (select 1 from pg_temp.fo_versions v where not exists (select 1 from pg_temp.fo_sources s where s.id = v.source_id))
    or exists (select 1 from pg_temp.fo_pauses p where not exists (select 1 from pg_temp.fo_sources s where s.id = p.source_id))
    or exists (select 1 from pg_temp.fo_records r where r.source_id is not null and not exists (select 1 from pg_temp.fo_sources s where s.id = r.source_id))
    or exists (select 1 from pg_temp.fo_work_entries e where not exists (select 1 from pg_temp.fo_sources s where s.id = e.source_id))
    or exists (select 1 from pg_temp.fo_work_entries e where e.cash_tips_record_id is not null and not exists (select 1 from pg_temp.fo_records r where r.id = e.cash_tips_record_id))
    or exists (select 1 from pg_temp.fo_work_entries e where e.paid_by_occurrence_id is not null and not exists (select 1 from pg_temp.fo_records r where r.id = e.paid_by_occurrence_id))
    or exists (select 1 from pg_temp.fo_jobs j where j.client_id is not null and not exists (select 1 from pg_temp.fo_clients c where c.id = j.client_id))
    or exists (select 1 from pg_temp.fo_jobs j where j.payment_record_id is not null
               and not exists (select 1 from pg_temp.fo_records r where r.id = j.payment_record_id and r.source_id is null and r.kind = 'income'))
    or exists (select 1 from pg_temp.fo_sources s where s.account_id is not null and not exists (select 1 from pg_temp.fo_accounts a where a.id = s.account_id))
    or exists (select 1 from pg_temp.fo_records r where r.account_id is not null and not exists (select 1 from pg_temp.fo_accounts a where a.id = r.account_id))
    or exists (select 1 from pg_temp.fo_transfers t where not exists (select 1 from pg_temp.fo_accounts a where a.id = t.from_account_id)
                                                     or not exists (select 1 from pg_temp.fo_accounts a where a.id = t.to_account_id)) then
    raise exception 'The plan refers to an item it doesn''t contain.' using errcode = 'PT422';
  end if;
  -- An item or record goes only to an account of the type that suits it: income to an income account,
  -- Strategic Reserves to a distribution account, everything else to a payment account.
  if exists (select 1 from pg_temp.fo_sources s join pg_temp.fo_accounts a on a.id = s.account_id
             where a.type <> case s.kind when 'income' then 'income' when 'reserve' then 'distribution' else 'payment' end)
    or exists (select 1 from pg_temp.fo_records r join pg_temp.fo_accounts a on a.id = r.account_id
               where a.type <> case r.kind when 'income' then 'income' when 'reserve' then 'distribution' else 'payment' end) then
    raise exception 'An item can only be assigned to an account of the type that suits it.' using errcode = 'PT422';
  end if;
  -- A record is one job's payment or one shift's cash tips, never both.
  if exists (select 1 from pg_temp.fo_jobs j join pg_temp.fo_work_entries e on e.cash_tips_record_id = j.payment_record_id) then
    raise exception 'A payment belongs to one job or shift.' using errcode = 'PT422';
  end if;
  -- A shift belongs to hourly or tipped income, a session to gig income.
  if exists (select 1 from pg_temp.fo_work_entries e join pg_temp.fo_sources s on s.id = e.source_id
             where s.income_type is null or (e.kind = 'session') <> (s.income_type = 'gig')) then
    raise exception 'Shifts belong to hourly or tipped income, and sessions to gig income.' using errcode = 'PT422';
  end if;
  if exists (select 1 from pg_temp.fo_sources s where not exists (select 1 from pg_temp.fo_versions v where v.source_id = s.id)) then
    raise exception 'Every recurring item needs at least one schedule.' using errcode = 'PT422';
  end if;

  if p_mode = 'reset' then
    if exists (select 1 from pg_temp.fo_sources) or exists (select 1 from pg_temp.fo_records) or exists (select 1 from pg_temp.fo_work_entries)
      or exists (select 1 from pg_temp.fo_clients) or exists (select 1 from pg_temp.fo_jobs)
      or exists (select 1 from pg_temp.fo_accounts) or exists (select 1 from pg_temp.fo_transfers) or (p_plan ->> 'onboarding_complete')::boolean then
      raise exception 'Starting over needs an empty plan in setup.' using errcode = 'PT422';
    end if;
  end if;

  if p_mode = 'update' then
    -- Only removals the app's own operations make (deleteSource, deleteOneTime, undo).
    select count(*) into v_count from public.sources s
      where s.workspace_id = v_ws.id and not exists (select 1 from pg_temp.fo_sources n where n.id = s.id);
    if v_count > 1 then
      raise exception 'A save can remove one item at a time. Use Restore or Start over to replace a plan.' using errcode = 'PT422';
    end if;
    if exists (select 1 from public.sources s
               where s.workspace_id = v_ws.id
                 and not exists (select 1 from pg_temp.fo_sources n where n.id = s.id)
                 and exists (select 1 from public.occurrence_records r where r.workspace_id = v_ws.id and r.source_id = s.id)) then
      raise exception 'An item with recorded history can''t be removed. Turn it off instead.' using errcode = 'PT422';
    end if;
    select count(*) into v_count from public.occurrence_records r
      where r.workspace_id = v_ws.id and r.source_id is null and not exists (select 1 from pg_temp.fo_records n where n.id = r.id);
    if v_count > 1 then
      raise exception 'A save can remove one one-time item at a time. Use Restore or Start over to replace a plan.' using errcode = 'PT422';
    end if;
    select count(*) into v_count from public.work_entries e
      where e.workspace_id = v_ws.id and not exists (select 1 from pg_temp.fo_work_entries n where n.id = e.id);
    if v_count > 1 then
      raise exception 'A save can remove one shift at a time. Use Restore or Start over to replace a plan.' using errcode = 'PT422';
    end if;
    select count(*) into v_count from public.freelance_jobs j
      where j.workspace_id = v_ws.id and not exists (select 1 from pg_temp.fo_jobs n where n.id = j.id);
    if v_count > 1 then
      raise exception 'A save can remove one job at a time. Use Restore or Start over to replace a plan.' using errcode = 'PT422';
    end if;
    select count(*) into v_count from public.clients c
      where c.workspace_id = v_ws.id and not exists (select 1 from pg_temp.fo_clients n where n.id = c.id);
    if v_count > 1 then
      raise exception 'A save can remove one client at a time. Use Restore or Start over to replace a plan.' using errcode = 'PT422';
    end if;
    select count(*) into v_count from public.accounts a
      where a.workspace_id = v_ws.id and not exists (select 1 from pg_temp.fo_accounts n where n.id = a.id);
    if v_count > 1 then
      raise exception 'A save can remove one account at a time. Use Restore or Start over to replace a plan.' using errcode = 'PT422';
    end if;
    select count(*) into v_count from public.transfers t
      where t.workspace_id = v_ws.id and not exists (select 1 from pg_temp.fo_transfers n where n.id = t.id);
    if v_count > 1 then
      raise exception 'A save can remove one transfer at a time. Use Restore or Start over to replace a plan.' using errcode = 'PT422';
    end if;
    -- The original prediction, the occurrence's identity, and existing schedule versions never change in an ordinary save.
    if exists (select 1 from public.occurrence_records r join pg_temp.fo_records n on n.id = r.id
               where r.workspace_id = v_ws.id
                 and (n.expected_date is distinct from r.expected_date
                   or n.expected_amount_cents is distinct from r.expected_amount_cents
                   or n.source_id is distinct from r.source_id
                   or n.kind is distinct from r.kind)) then
      raise exception 'A save can''t change an original prediction.' using errcode = 'PT422';
    end if;
    if exists (select 1 from public.schedule_versions v join pg_temp.fo_versions n on n.id = v.id
               where v.workspace_id = v_ws.id
                 and (n.source_id is distinct from v.source_id
                   or n.start_date is distinct from v.start_date
                   or n.amount_cents is distinct from v.amount_cents
                   or n.rule_type is distinct from v.rule_type
                   or n.rule_days is distinct from v.rule_days
                   or n.rule_interval is distinct from v.rule_interval
                   or n.rule_unit is distinct from v.rule_unit)) then
      raise exception 'A save can''t rewrite an existing schedule. Changes start a new schedule from a date.' using errcode = 'PT422';
    end if;
    if v_ws.onboarding_complete and not (p_plan ->> 'onboarding_complete')::boolean then
      raise exception 'Use Start over to go back to setup.' using errcode = 'PT422';
    end if;
  end if;

  -- Apply. Removals first, so replacements can reuse natural keys. Shifts, clients and jobs point at items
  -- and records, so they are all removed first and written back last. Accounts and transfers are replaced
  -- whole too; the account references from items and records are checked when the transaction commits.
  delete from public.transfers t where t.workspace_id = v_ws.id;
  delete from public.accounts a where a.workspace_id = v_ws.id;
  delete from public.freelance_jobs j where j.workspace_id = v_ws.id;
  delete from public.clients c where c.workspace_id = v_ws.id;
  delete from public.work_entries e where e.workspace_id = v_ws.id;
  delete from public.occurrence_records r
    where r.workspace_id = v_ws.id and not exists (select 1 from pg_temp.fo_records n where n.id = r.id);
  delete from public.source_pauses p where p.workspace_id = v_ws.id;
  delete from public.schedule_versions v
    where v.workspace_id = v_ws.id
      and not exists (select 1 from pg_temp.fo_versions n where n.id = v.id and n.source_id = v.source_id and n.start_date = v.start_date);
  delete from public.sources s
    where s.workspace_id = v_ws.id and not exists (select 1 from pg_temp.fo_sources n where n.id = s.id);
  -- Clear the main-paycheck flag first so moving it between items can't trip the one-per-plan index.
  update public.sources s set main_paycheck = false where s.workspace_id = v_ws.id and s.main_paycheck;

  insert into public.accounts (workspace_id, id, position, name, type, opening_amount_cents, opening_date, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.name, n.type, n.opening_amount_cents, n.opening_date, n.created_at, n.updated_at from pg_temp.fo_accounts n;

  insert into public.sources as t (workspace_id, id, position, kind, description, tags, liability_type, main_paycheck, active, end_date,
                                   dismissed_current_cents, dismissed_proposed_cents, dismissed_through, certainty, income_type, hourly_wage_cents, account_id, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.kind, n.description, coalesce(n.tags, '{}'), n.liability_type, coalesce(n.main_paycheck, false), n.active, n.end_date,
           n.dismissed_current_cents, n.dismissed_proposed_cents, n.dismissed_through, n.certainty, n.income_type, n.hourly_wage_cents, n.account_id, n.created_at, n.updated_at
    from pg_temp.fo_sources n
  on conflict (workspace_id, id) do update set
    position = excluded.position, kind = excluded.kind, description = excluded.description, tags = excluded.tags,
    liability_type = excluded.liability_type, main_paycheck = excluded.main_paycheck, active = excluded.active, end_date = excluded.end_date,
    dismissed_current_cents = excluded.dismissed_current_cents, dismissed_proposed_cents = excluded.dismissed_proposed_cents,
    dismissed_through = excluded.dismissed_through, certainty = excluded.certainty, income_type = excluded.income_type,
    hourly_wage_cents = excluded.hourly_wage_cents, account_id = excluded.account_id, created_at = excluded.created_at, updated_at = excluded.updated_at;

  insert into public.schedule_versions (workspace_id, source_id, id, start_date, amount_cents, rule_type, rule_days, rule_interval, rule_unit)
    select v_ws.id, n.source_id, n.id, n.start_date, n.amount_cents, n.rule_type, n.rule_days, n.rule_interval, n.rule_unit
    from pg_temp.fo_versions n
  on conflict (workspace_id, id) do update set
    amount_cents = excluded.amount_cents, rule_type = excluded.rule_type, rule_days = excluded.rule_days,
    rule_interval = excluded.rule_interval, rule_unit = excluded.rule_unit;

  insert into public.source_pauses (workspace_id, source_id, from_date, until_date)
    select v_ws.id, n.source_id, n.from_date, n.until_date from pg_temp.fo_pauses n;

  insert into public.occurrence_records as t (workspace_id, id, position, source_id, kind, description, tags,
                                              expected_date, expected_amount_cents, scheduled_date, scheduled_amount_cents,
                                              status, actual_date, actual_amount_cents, completed_at, canceled_at, cancel_note, certainty, account_id, release, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.source_id, n.kind, n.description, coalesce(n.tags, '{}'),
           n.expected_date, n.expected_amount_cents, n.scheduled_date, n.scheduled_amount_cents,
           n.status, n.actual_date, n.actual_amount_cents, n.completed_at, n.canceled_at, n.cancel_note, n.certainty, n.account_id, coalesce(n.release, false), n.created_at, n.updated_at
    from pg_temp.fo_records n
  on conflict (workspace_id, id) do update set
    position = excluded.position, source_id = excluded.source_id, kind = excluded.kind, description = excluded.description, tags = excluded.tags,
    expected_date = excluded.expected_date, expected_amount_cents = excluded.expected_amount_cents,
    scheduled_date = excluded.scheduled_date, scheduled_amount_cents = excluded.scheduled_amount_cents,
    status = excluded.status, actual_date = excluded.actual_date, actual_amount_cents = excluded.actual_amount_cents,
    completed_at = excluded.completed_at, canceled_at = excluded.canceled_at, cancel_note = excluded.cancel_note,
    certainty = excluded.certainty, account_id = excluded.account_id, release = excluded.release, created_at = excluded.created_at, updated_at = excluded.updated_at;

  insert into public.work_entries (workspace_id, id, position, source_id, kind, work_date, minutes, wage_cents, cash_tips_cents, card_tips_cents,
                                   earnings_cents, platform, cash_tips_record_id, paid_by_occurrence_id, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.source_id, n.kind, n.work_date, n.minutes, n.wage_cents, n.cash_tips_cents, n.card_tips_cents,
           n.earnings_cents, n.platform, n.cash_tips_record_id, n.paid_by_occurrence_id, n.created_at, n.updated_at
    from pg_temp.fo_work_entries n;

  insert into public.clients (workspace_id, id, position, name, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.name, n.created_at, n.updated_at from pg_temp.fo_clients n;

  insert into public.freelance_jobs (workspace_id, id, position, client_id, description, amount_cents, status, payment_record_id, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.client_id, n.description, n.amount_cents, n.status, n.payment_record_id, n.created_at, n.updated_at
    from pg_temp.fo_jobs n;

  insert into public.transfers (workspace_id, id, position, from_account_id, to_account_id, amount_cents, transfer_date, status, recorded_at, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.from_account_id, n.to_account_id, n.amount_cents, n.transfer_date, n.status, n.recorded_at, n.created_at, n.updated_at
    from pg_temp.fo_transfers n;

  v_revision := p_base_revision + 1;
  update public.workspaces w set
    revision = v_revision,
    onboarding_complete = (p_plan ->> 'onboarding_complete')::boolean,
    review_cadence = p_plan ->> 'review_cadence',
    review_handled_on = (p_plan ->> 'review_handled_on')::date,
    review_outcome = p_plan ->> 'review_outcome',
    updated_at = now()
  where w.id = v_ws.id;

  insert into public.save_receipts (workspace_id, save_id, mode, base_revision, fingerprint, result_revision)
    values (v_ws.id, p_save_id, p_mode, p_base_revision, v_fingerprint, v_revision);
  -- Keep receipts bounded: the latest 100, none older than 30 days.
  delete from public.save_receipts r
    where r.workspace_id = v_ws.id
      and (r.created_at < now() - interval '30 days'
        or r.save_id not in (select k.save_id from public.save_receipts k where k.workspace_id = v_ws.id order by k.result_revision desc limit 100));

  return jsonb_build_object('status', 'saved', 'revision', v_revision, 'current_revision', v_revision);
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_account() permanently deletes the signed-in person's account and
-- everything in it. It takes no arguments: it can only ever delete the caller.
-- Before deleting it requires:
--   1. a signed-in caller (role authenticated, a user id in the token);
--   2. a session that still exists, so a token from a session that has signed
--      out can't be used;
--   3. a password sign-in within the last 5 minutes. Supabase Auth checks the
--      password and records when in the token's `amr` claim; the app asks for
--      the password again right before calling this. A refreshed token keeps
--      the original sign-in time, so an old session can't delete.
--
-- Deleting the auth.users row removes, through foreign keys with ON DELETE
-- CASCADE: the person's identities, sessions and refresh tokens (Supabase
-- Auth's tables), and the workspace, which removes its sources, schedule
-- versions, pauses, occurrence records and save receipts.
--
-- An access token issued before the deletion still verifies until it expires
-- (Supabase Auth tokens are self-contained), but it reaches nothing: every
-- table's policy and every function look up the workspace by owner, and there
-- is none; create_workspace can't make one for a user who no longer exists.
-- ---------------------------------------------------------------------------
create function public.delete_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_session uuid;
  v_password_at bigint;
begin
  if v_user is null then
    raise exception 'Sign in to delete your account.' using errcode = 'PT401';
  end if;

  begin
    v_session := nullif(v_claims ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    v_session := null;
  end;
  if v_session is null or not exists (select 1 from auth.sessions s where s.id = v_session and s.user_id = v_user) then
    raise exception 'Your session has ended. Sign in again to delete your account.' using errcode = 'PT401';
  end if;

  select max((a ->> 'timestamp')::bigint) into v_password_at
  from jsonb_array_elements(case when jsonb_typeof(v_claims -> 'amr') = 'array' then v_claims -> 'amr' else '[]'::jsonb end) a
  where a ->> 'method' = 'password';
  if v_password_at is null or v_password_at < extract(epoch from now())::bigint - 300 then
    raise exception 'Confirm your password to delete your account.' using errcode = 'PT403';
  end if;

  delete from auth.users where id = v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: signed-in callers only.
-- ---------------------------------------------------------------------------
revoke all on function public.create_workspace() from public, anon;
revoke all on function public.load_plan() from public, anon;
revoke all on function public.save_plan(bigint, uuid, text, jsonb) from public, anon;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.create_workspace() to authenticated;
grant execute on function public.load_plan() to authenticated;
grant execute on function public.save_plan(bigint, uuid, text, jsonb) to authenticated;
grant execute on function public.delete_account() to authenticated;
