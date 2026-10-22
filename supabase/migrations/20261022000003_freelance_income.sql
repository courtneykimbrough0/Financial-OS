-- Financial OS: freelance income (roadmap Phase E, checkpoint E3).
--
-- Optional clients (names that group jobs) and freelance jobs: a description,
-- an agreed amount, planned or done work, and the job's payment. The money is
-- never stored here: a job's payment is one ordinary one-time income record
-- (`payment_record_id`) on its expected payment date, expected or possible
-- (20261022000001), and recording it is the payment. A job without a date has
-- no record and counts nowhere. Done but unpaid work is never money received.
--
-- Nothing existing changes. load_plan and save_plan are redefined only to
-- carry the two new tables, to require `clients` and `jobs` in a save (so a
-- client that doesn't know them can't erase them), to check that a job's
-- payment is a one-time income record no shift uses, and to let an ordinary
-- save remove at most one job and one client, as for items and shifts. Every
-- other check and rule is unchanged (compare with
-- 20261022000002_hourly_and_tipped_income.sql).

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

alter table public.clients enable row level security;
alter table public.freelance_jobs enable row level security;
revoke all on table public.clients, public.freelance_jobs from public, anon, authenticated;
grant select on table public.clients, public.freelance_jobs to authenticated;
create policy clients_owner_reads on public.clients
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));
create policy freelance_jobs_owner_reads on public.freelance_jobs
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

create or replace function public.load_plan() returns jsonb
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
        'income_type', s.income_type, 'hourly_wage_cents', s.hourly_wage_cents,
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
        'cancel_note', r.cancel_note, 'certainty', r.certainty,
        'created_at', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updated_at', to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by r.position, r.id)
      from public.occurrence_records r where r.workspace_id = w.id), '[]'::jsonb),
    'work_entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'position', e.position, 'source_id', e.source_id, 'kind', e.kind, 'work_date', to_char(e.work_date, 'YYYY-MM-DD'),
        'minutes', e.minutes, 'wage_cents', e.wage_cents, 'cash_tips_cents', e.cash_tips_cents, 'card_tips_cents', e.card_tips_cents,
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
      from public.freelance_jobs j where j.workspace_id = w.id), '[]'::jsonb)
  )
  from public.workspaces w
  where w.owner_id = (select auth.uid());
$$;

create or replace function public.save_plan(p_base_revision bigint, p_save_id uuid, p_mode text, p_plan jsonb) returns jsonb
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
    or jsonb_typeof(p_plan -> 'onboarding_complete') is distinct from 'boolean' then
    raise exception 'The plan is incomplete or malformed.' using errcode = 'PT422';
  end if;
  if jsonb_array_length(p_plan -> 'sources') > 2000 or jsonb_array_length(p_plan -> 'records') > 20000 or jsonb_array_length(p_plan -> 'work_entries') > 5000
    or jsonb_array_length(p_plan -> 'clients') > 200 or jsonb_array_length(p_plan -> 'jobs') > 5000 then
    raise exception 'The plan is too large.' using errcode = 'PT422';
  end if;

  drop table if exists pg_temp.fo_sources, pg_temp.fo_versions, pg_temp.fo_pauses, pg_temp.fo_records, pg_temp.fo_work_entries, pg_temp.fo_clients, pg_temp.fo_jobs;
  create temp table fo_sources on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'sources') as x(
      id text, position integer, kind text, description text, tags text[], liability_type text, main_paycheck boolean,
      active boolean, end_date date, dismissed_current_cents bigint, dismissed_proposed_cents bigint, dismissed_through date,
      certainty text, income_type text, hourly_wage_cents bigint, created_at timestamptz, updated_at timestamptz);
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
      cancel_note text, certainty text, created_at timestamptz, updated_at timestamptz);
  create temp table fo_work_entries on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'work_entries') as x(
      id text, position integer, source_id text, kind text, work_date date, minutes integer, wage_cents bigint,
      cash_tips_cents bigint, card_tips_cents bigint, cash_tips_record_id text, paid_by_occurrence_id text,
      created_at timestamptz, updated_at timestamptz);
  create temp table fo_clients on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'clients') as x(id text, position integer, name text, created_at timestamptz, updated_at timestamptz);
  create temp table fo_jobs on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'jobs') as x(
      id text, position integer, client_id text, description text, amount_cents bigint, status text, payment_record_id text,
      created_at timestamptz, updated_at timestamptz);

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
    or (select count(*) from pg_temp.fo_jobs) <> (select count(distinct id) from pg_temp.fo_jobs) then
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
               and not exists (select 1 from pg_temp.fo_records r where r.id = j.payment_record_id and r.source_id is null and r.kind = 'income')) then
    raise exception 'The plan refers to an item it doesn''t contain.' using errcode = 'PT422';
  end if;
  -- A record is one job's payment or one shift's cash tips, never both.
  if exists (select 1 from pg_temp.fo_jobs j join pg_temp.fo_work_entries e on e.cash_tips_record_id = j.payment_record_id) then
    raise exception 'A payment belongs to one job or shift.' using errcode = 'PT422';
  end if;
  if exists (select 1 from pg_temp.fo_sources s where not exists (select 1 from pg_temp.fo_versions v where v.source_id = s.id)) then
    raise exception 'Every recurring item needs at least one schedule.' using errcode = 'PT422';
  end if;

  if p_mode = 'reset' then
    if exists (select 1 from pg_temp.fo_sources) or exists (select 1 from pg_temp.fo_records) or exists (select 1 from pg_temp.fo_work_entries)
      or exists (select 1 from pg_temp.fo_clients) or exists (select 1 from pg_temp.fo_jobs) or (p_plan ->> 'onboarding_complete')::boolean then
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
  -- and records, so they are all removed first and written back last.
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

  insert into public.sources as t (workspace_id, id, position, kind, description, tags, liability_type, main_paycheck, active, end_date,
                                   dismissed_current_cents, dismissed_proposed_cents, dismissed_through, certainty, income_type, hourly_wage_cents, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.kind, n.description, coalesce(n.tags, '{}'), n.liability_type, coalesce(n.main_paycheck, false), n.active, n.end_date,
           n.dismissed_current_cents, n.dismissed_proposed_cents, n.dismissed_through, n.certainty, n.income_type, n.hourly_wage_cents, n.created_at, n.updated_at
    from pg_temp.fo_sources n
  on conflict (workspace_id, id) do update set
    position = excluded.position, kind = excluded.kind, description = excluded.description, tags = excluded.tags,
    liability_type = excluded.liability_type, main_paycheck = excluded.main_paycheck, active = excluded.active, end_date = excluded.end_date,
    dismissed_current_cents = excluded.dismissed_current_cents, dismissed_proposed_cents = excluded.dismissed_proposed_cents,
    dismissed_through = excluded.dismissed_through, certainty = excluded.certainty, income_type = excluded.income_type,
    hourly_wage_cents = excluded.hourly_wage_cents, created_at = excluded.created_at, updated_at = excluded.updated_at;

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
                                              status, actual_date, actual_amount_cents, completed_at, canceled_at, cancel_note, certainty, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.source_id, n.kind, n.description, coalesce(n.tags, '{}'),
           n.expected_date, n.expected_amount_cents, n.scheduled_date, n.scheduled_amount_cents,
           n.status, n.actual_date, n.actual_amount_cents, n.completed_at, n.canceled_at, n.cancel_note, n.certainty, n.created_at, n.updated_at
    from pg_temp.fo_records n
  on conflict (workspace_id, id) do update set
    position = excluded.position, source_id = excluded.source_id, kind = excluded.kind, description = excluded.description, tags = excluded.tags,
    expected_date = excluded.expected_date, expected_amount_cents = excluded.expected_amount_cents,
    scheduled_date = excluded.scheduled_date, scheduled_amount_cents = excluded.scheduled_amount_cents,
    status = excluded.status, actual_date = excluded.actual_date, actual_amount_cents = excluded.actual_amount_cents,
    completed_at = excluded.completed_at, canceled_at = excluded.canceled_at, cancel_note = excluded.cancel_note,
    certainty = excluded.certainty, created_at = excluded.created_at, updated_at = excluded.updated_at;

  insert into public.work_entries (workspace_id, id, position, source_id, kind, work_date, minutes, wage_cents, cash_tips_cents, card_tips_cents,
                                   cash_tips_record_id, paid_by_occurrence_id, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.source_id, n.kind, n.work_date, n.minutes, n.wage_cents, n.cash_tips_cents, n.card_tips_cents,
           n.cash_tips_record_id, n.paid_by_occurrence_id, n.created_at, n.updated_at
    from pg_temp.fo_work_entries n;

  insert into public.clients (workspace_id, id, position, name, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.name, n.created_at, n.updated_at from pg_temp.fo_clients n;

  insert into public.freelance_jobs (workspace_id, id, position, client_id, description, amount_cents, status, payment_record_id, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.client_id, n.description, n.amount_cents, n.status, n.payment_record_id, n.created_at, n.updated_at
    from pg_temp.fo_jobs n;

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
