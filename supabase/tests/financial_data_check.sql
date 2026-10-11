-- Run after applying the migration (Supabase SQL editor). Everything happens
-- inside a transaction that is rolled back, so it leaves nothing behind.
-- It raises an exception on the first rule that doesn't hold; otherwise the
-- final line reads "All checks passed".
begin;

insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-00000000000a', 'check-a@example.invalid', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000000b', 'check-b@example.invalid', 'authenticated', 'authenticated');

do $$
declare r bigint; n int;
begin
  -- Act as user A.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

  r := public.save_financial_data('{"schemaVersion":2}', 0);
  if r is distinct from 1 then raise exception 'First save should be revision 1, got %', r; end if;
  r := public.save_financial_data('{"schemaVersion":2}', 0);
  if r is not null then raise exception 'Second first-save should conflict'; end if;
  r := public.save_financial_data('{"schemaVersion":2,"n":2}', 1);
  if r is distinct from 2 then raise exception 'Save from revision 1 should give 2, got %', r; end if;
  r := public.save_financial_data('{"schemaVersion":2,"n":3}', 1);
  if r is not null then raise exception 'Stale save should conflict'; end if;

  -- Act as user B: sees nothing of A's.
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
  select count(*) into n from public.financial_data;
  if n <> 0 then raise exception 'User B can see % rows', n; end if;
  update public.financial_data set revision = 99;
  delete from public.financial_data;
  r := public.save_financial_data('{"schemaVersion":2}', 2);
  if r is not null then raise exception 'User B saved over user A'; end if;

  -- Signed out: no access.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into n from public.financial_data;
    raise exception 'Signed-out read was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_financial_data('{}', 0);
    raise exception 'Signed-out save was allowed';
  exception when insufficient_privilege then null;
  end;

  -- Back as A: data intact, then delete the account.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  select revision into r from public.financial_data;
  if r is distinct from 2 then raise exception 'User A data changed: revision %', r; end if;
  perform public.delete_my_account();
  perform set_config('role', 'postgres', true);
  select count(*) into n from auth.users where id = '00000000-0000-0000-0000-00000000000a';
  if n <> 0 then raise exception 'Account was not deleted'; end if;
  select count(*) into n from public.financial_data;
  if n <> 0 then raise exception 'Data was not deleted with the account'; end if;
  select count(*) into n from auth.users where id = '00000000-0000-0000-0000-00000000000b';
  if n <> 1 then raise exception 'Another account was deleted'; end if;
end $$;

select 'All checks passed' as result;
rollback;
