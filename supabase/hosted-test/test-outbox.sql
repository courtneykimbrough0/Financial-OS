-- Financial OS: a test outbox for the hosted TEST project's automated tests.
--
-- Run ONLY in the isolated hosted test project (SQL editor), never in
-- production, and never add it to supabase/migrations.
--
-- Why: email confirmation stays ON in the test project, so every test account
-- needs its confirmation email. With Supabase's "Send Email" auth hook pointed
-- at financial_os_test_send_email (Authentication -> Hooks), Supabase Auth
-- hands each email to this function instead of sending it: the confirmation
-- or recovery token is stored here, and the test runner reads it back through
-- financial_os_test_read_outbox, which answers only with the runner's secret.
-- Confirmation is still required and still checked by Supabase Auth; only the
-- delivery changes. Real delivery (SMTP, a real inbox, the link's redirect) is
-- checked by hand with the hook turned off (docs/SUPABASE-HOSTED.md).
--
-- Before running: run marker.sql first (this file refuses to install without
-- it), and replace CHANGE_ME_TO_A_LONG_RANDOM_SECRET in the insert line below
-- with a long random value (at least 32 characters, for example from a
-- password manager's generator). Keep it only in your local environment as
-- SUPABASE_TEST_OUTBOX_SECRET. It is not a Supabase key and grants nothing
-- beyond reading this test outbox.
--
-- Who can do what (check with verify-outbox.sql):
--   - the captured emails: nobody directly (row-level security with no
--     policies, and no table privileges for anon or signed-in users);
--   - financial_os_test_send_email: Supabase Auth's role only;
--   - financial_os_test_read_outbox: signed-out (anon) callers only, and it
--     answers only with the secret. A wrong, missing, short or unchanged
--     secret gets an error and nothing else.
-- Captured tokens are kept one hour (Supabase's email links expire by then).
-- To remove it all: teardown-outbox.sql.

-- Only in the project marked as the Financial OS test project (marker.sql).
do $$
declare
  v_marker text;
begin
  if to_regprocedure('public.financial_os_test_environment()') is not null then
    execute 'select public.financial_os_test_environment()' into v_marker;
  end if;
  if v_marker is null or v_marker not like 'financial-os-hosted-test:%' or v_marker like '%YOUR_PROJECT_REF' then
    raise exception 'This project is not marked as the Financial OS test project. Run marker.sql (with this project''s ref) first; never install the test outbox anywhere else.';
  end if;
end;
$$;

create table if not exists public.financial_os_test_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text not null,
  action text not null,
  token_hash text not null,
  redirect_to text not null default ''
);
create table if not exists public.financial_os_test_outbox_secret (secret text not null);

alter table public.financial_os_test_outbox enable row level security;
alter table public.financial_os_test_outbox_secret enable row level security;
revoke all on table public.financial_os_test_outbox, public.financial_os_test_outbox_secret from public, anon, authenticated;

delete from public.financial_os_test_outbox_secret;
insert into public.financial_os_test_outbox_secret (secret) values ('CHANGE_ME_TO_A_LONG_RANDOM_SECRET');

-- Called by Supabase Auth (as supabase_auth_admin) for every email it would send.
create or replace function public.financial_os_test_send_email(event jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb := event -> 'email_data';
  v_email text := nullif(event -> 'user' ->> 'email', '');
  v_new_email text := nullif(event -> 'user' ->> 'new_email', '');
  v_new_hash text := nullif(v_data ->> 'token_hash_new', '');
begin
  -- The email to the current address (or, with none yet, to the new one).
  insert into public.financial_os_test_outbox (email, action, token_hash, redirect_to)
  values (coalesce(v_email, v_new_email), v_data ->> 'email_action_type', v_data ->> 'token_hash', coalesce(v_data ->> 'redirect_to', ''));
  -- A change between two addresses also sends the new address its own token.
  if v_new_hash is not null and v_new_email is not null then
    insert into public.financial_os_test_outbox (email, action, token_hash, redirect_to)
    values (v_new_email, v_data ->> 'email_action_type', v_new_hash, coalesce(v_data ->> 'redirect_to', ''));
  end if;
  -- Keep only the last hour: the links expire by then.
  delete from public.financial_os_test_outbox where created_at < now() - interval '1 hour';
  return '{}'::jsonb;
end;
$$;

-- Read by the test runner with the public key and the outbox secret.
create or replace function public.financial_os_test_read_outbox(p_secret text, p_email text)
returns table (id bigint, created_at timestamptz, action text, token_hash text, redirect_to text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or not exists (
    select 1 from public.financial_os_test_outbox_secret s
    where s.secret = p_secret and length(s.secret) >= 32 and s.secret <> 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET'
  ) then
    raise exception 'Not allowed.' using errcode = 'PT403';
  end if;
  return query
    select o.id, o.created_at, o.action, o.token_hash, o.redirect_to
    from public.financial_os_test_outbox o
    where lower(o.email) = lower(p_email)
    order by o.id desc
    limit 10;
end;
$$;

revoke all on function public.financial_os_test_send_email(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.financial_os_test_send_email(jsonb) to supabase_auth_admin;
grant insert, delete, select on table public.financial_os_test_outbox to supabase_auth_admin;
-- The runner reads with the public key alone, as a signed-out caller; signed-in users have no use for it.
revoke all on function public.financial_os_test_read_outbox(text, text) from public, anon, authenticated;
grant execute on function public.financial_os_test_read_outbox(text, text) to anon;
