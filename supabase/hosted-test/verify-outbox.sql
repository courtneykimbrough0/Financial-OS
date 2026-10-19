-- Financial OS: read-only checks of the test outbox's privileges, after
-- test-outbox.sql. Run in the test project's SQL editor; it changes nothing.
-- Every row should read 'ok'.

select item, result from (
  select 'captured emails: row-level security' as item,
         case when relrowsecurity then 'ok' else 'OFF' end as result
  from pg_class where oid = 'public.financial_os_test_outbox'::regclass
  union all
  select 'captured emails: no policies', case when count(*) = 0 then 'ok' else 'HAS POLICIES' end
  from pg_policy where polrelid = 'public.financial_os_test_outbox'::regclass
  union all
  select 'captured emails: not readable by ' || r, case when has_table_privilege(r, 'public.financial_os_test_outbox', 'select') then 'READABLE' else 'ok' end
  from unnest(array['anon', 'authenticated']) r
  union all
  select 'secret: not readable by ' || r, case when has_table_privilege(r, 'public.financial_os_test_outbox_secret', 'select') then 'READABLE' else 'ok' end
  from unnest(array['anon', 'authenticated']) r
  union all
  select 'secret: changed and long enough',
         case when exists (select 1 from public.financial_os_test_outbox_secret where length(secret) >= 32 and secret <> 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET') then 'ok' else 'NOT SET' end
  union all
  select 'capture hook: callable by ' || r || ' only if Supabase Auth',
         case when has_function_privilege(r, 'public.financial_os_test_send_email(jsonb)', 'execute') = (r = 'supabase_auth_admin') then 'ok' else 'WRONG' end
  from unnest(array['anon', 'authenticated', 'supabase_auth_admin']) r
  union all
  select 'reader: callable by ' || r || ' only if anon',
         case when has_function_privilege(r, 'public.financial_os_test_read_outbox(text, text)', 'execute') = (r = 'anon') then 'ok' else 'WRONG' end
  from unnest(array['anon', 'authenticated']) r
  union all
  select 'both functions: fixed search path, security definer',
         case when count(*) = 2 then 'ok' else 'WRONG' end
  from pg_proc where proname in ('financial_os_test_send_email', 'financial_os_test_read_outbox')
    and prosecdef and array_to_string(proconfig, ',') = 'search_path=""'
) checks
order by 1;
