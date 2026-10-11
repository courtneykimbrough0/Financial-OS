-- Financial OS: accounts and saved data.
--
-- One row per user holds their whole forecast document (the same JSON the app
-- keeps on the device and writes to backup files) plus a revision number that
-- goes up by one on every save. A save names the revision it was based on and
-- is rejected if the stored revision has moved on, so a stale device or tab
-- can never overwrite newer data.

create table public.financial_data (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 2000000),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now()
);

comment on table public.financial_data is 'Financial OS: one forecast document per user.';

-- Row level security: each signed-in user can reach only their own row.
alter table public.financial_data enable row level security;

create policy "Users can read their own data" on public.financial_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own data" on public.financial_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own data" on public.financial_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own data" on public.financial_data
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Signed-out visitors get no access at all.
revoke all on public.financial_data from anon;

-- Saves the document as revision base + 1, only if the stored revision is
-- still `p_base_revision` (0 means nothing is stored yet). Returns the new
-- revision, or null when newer data was saved elsewhere. Runs with the
-- caller's permissions, so the row level security policies above apply.
create function public.save_financial_data(p_data jsonb, p_base_revision bigint)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_revision bigint;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_base_revision = 0 then
    insert into public.financial_data (user_id, data, revision)
    values (uid, p_data, 1)
    on conflict (user_id) do nothing
    returning revision into new_revision;
  else
    -- Two saves racing from the same base: Postgres re-checks the revision
    -- after taking the row lock, so only the first one matches.
    update public.financial_data
    set data = p_data, revision = revision + 1, updated_at = now()
    where user_id = uid and revision = p_base_revision
    returning revision into new_revision;
  end if;
  return new_revision;
end;
$$;

revoke execute on function public.save_financial_data(jsonb, bigint) from public, anon;
grant execute on function public.save_financial_data(jsonb, bigint) to authenticated;

-- Lets a signed-in user permanently delete their own account. It runs with
-- elevated permissions because the client can't remove sign-in records, and it
-- removes only the caller's own: `auth.uid()` comes from their verified
-- session. Their financial_data row goes with it (on delete cascade).
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
