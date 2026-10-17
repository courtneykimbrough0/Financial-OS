-- Financial OS: deleting an account (Step 10d).
--
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

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
