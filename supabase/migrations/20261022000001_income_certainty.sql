-- Financial OS: income certainty (roadmap Phase E, checkpoint E1).
--
-- Income is expected (it counts on its date) unless marked possible: income
-- that may come but isn't dependable. Possible income is listed but never
-- counted in cash flow or the running total until it is marked expected or
-- recorded as received; a recorded actual always counts. The app works this
-- out (src/domain/forecast.ts); the database only stores the mark.
--
-- Stored as `certainty = 'possible'` on income items and on one-time income.
-- Null means expected, so every existing row keeps its meaning and nothing is
-- rewritten. A recurring occurrence follows its item, so its record never
-- carries the mark.
--
-- load_plan and save_plan are redefined only to carry the new column; every
-- check and every rule of save_plan is unchanged (compare with
-- 20261016000002_access_and_persistence.sql). Grants are kept by
-- `create or replace`.

alter table public.sources
  add column certainty text,
  add constraint sources_certainty_possible_income check (certainty is null or (certainty = 'possible' and kind = 'income'));

alter table public.occurrence_records
  add column certainty text,
  add constraint occurrence_records_certainty_possible_one_time_income check (certainty is null or (certainty = 'possible' and kind = 'income' and source_id is null));

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
      from public.occurrence_records r where r.workspace_id = w.id), '[]'::jsonb)
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
    or jsonb_typeof(p_plan -> 'onboarding_complete') is distinct from 'boolean' then
    raise exception 'The plan is incomplete or malformed.' using errcode = 'PT422';
  end if;
  if jsonb_array_length(p_plan -> 'sources') > 2000 or jsonb_array_length(p_plan -> 'records') > 20000 then
    raise exception 'The plan is too large.' using errcode = 'PT422';
  end if;

  drop table if exists pg_temp.fo_sources, pg_temp.fo_versions, pg_temp.fo_pauses, pg_temp.fo_records;
  create temp table fo_sources on commit drop as
    select * from jsonb_to_recordset(p_plan -> 'sources') as x(
      id text, position integer, kind text, description text, tags text[], liability_type text, main_paycheck boolean,
      active boolean, end_date date, dismissed_current_cents bigint, dismissed_proposed_cents bigint, dismissed_through date,
      certainty text, created_at timestamptz, updated_at timestamptz);
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

  -- Internal consistency, whatever the mode.
  if exists (select 1 from pg_temp.fo_sources where id is null)
    or (select count(*) from pg_temp.fo_sources) <> (select count(distinct id) from pg_temp.fo_sources)
    or exists (select 1 from pg_temp.fo_versions where id is null)
    or (select count(*) from pg_temp.fo_versions) <> (select count(distinct id) from pg_temp.fo_versions)
    or exists (select 1 from pg_temp.fo_records where id is null)
    or (select count(*) from pg_temp.fo_records) <> (select count(distinct id) from pg_temp.fo_records) then
    raise exception 'The plan has missing or repeated ids.' using errcode = 'PT422';
  end if;
  if exists (select 1 from pg_temp.fo_versions v where not exists (select 1 from pg_temp.fo_sources s where s.id = v.source_id))
    or exists (select 1 from pg_temp.fo_pauses p where not exists (select 1 from pg_temp.fo_sources s where s.id = p.source_id))
    or exists (select 1 from pg_temp.fo_records r where r.source_id is not null and not exists (select 1 from pg_temp.fo_sources s where s.id = r.source_id)) then
    raise exception 'The plan refers to an item it doesn''t contain.' using errcode = 'PT422';
  end if;
  if exists (select 1 from pg_temp.fo_sources s where not exists (select 1 from pg_temp.fo_versions v where v.source_id = s.id)) then
    raise exception 'Every recurring item needs at least one schedule.' using errcode = 'PT422';
  end if;

  if p_mode = 'reset' then
    if exists (select 1 from pg_temp.fo_sources) or exists (select 1 from pg_temp.fo_records) or (p_plan ->> 'onboarding_complete')::boolean then
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

  -- Apply. Removals first, so replacements can reuse natural keys.
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
                                   dismissed_current_cents, dismissed_proposed_cents, dismissed_through, certainty, created_at, updated_at)
    select v_ws.id, n.id, n.position, n.kind, n.description, coalesce(n.tags, '{}'), n.liability_type, coalesce(n.main_paycheck, false), n.active, n.end_date,
           n.dismissed_current_cents, n.dismissed_proposed_cents, n.dismissed_through, n.certainty, n.created_at, n.updated_at
    from pg_temp.fo_sources n
  on conflict (workspace_id, id) do update set
    position = excluded.position, kind = excluded.kind, description = excluded.description, tags = excluded.tags,
    liability_type = excluded.liability_type, main_paycheck = excluded.main_paycheck, active = excluded.active, end_date = excluded.end_date,
    dismissed_current_cents = excluded.dismissed_current_cents, dismissed_proposed_cents = excluded.dismissed_proposed_cents,
    dismissed_through = excluded.dismissed_through, certainty = excluded.certainty, created_at = excluded.created_at, updated_at = excluded.updated_at;

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
