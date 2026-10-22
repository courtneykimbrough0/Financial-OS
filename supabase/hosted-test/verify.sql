-- Financial OS: read-only checks for a hosted project after the migrations.
-- Run in the project's SQL editor; it changes nothing. Every row should read
-- 'ok'. See docs/SUPABASE-HOSTED.md.

with expected_functions(name, definer) as (
  values ('create_workspace', true), ('delete_account', true), ('load_plan', false), ('save_plan', true)
), functions as (
  select p.proname as name, p.prosecdef as definer, array_to_string(p.proconfig, ',') as config,
         has_function_privilege('anon', p.oid, 'execute') as anon_can,
         has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select name from expected_functions)
), tables(name) as (
  values ('workspaces'), ('sources'), ('schedule_versions'), ('source_pauses'), ('occurrence_records'), ('save_receipts'),
         ('work_entries'), ('clients'), ('freelance_jobs'), ('accounts'), ('transfers')
)
select 'function ' || e.name as check,
       case when f.name is null then 'MISSING'
            when f.definer <> e.definer then 'wrong security definer setting'
            when f.config <> 'search_path=""' then 'search_path not fixed'
            when f.anon_can then 'callable by signed-out users'
            when not f.signed_in_can then 'not callable by signed-in users'
            else 'ok' end as result
from expected_functions e left join functions f using (name)
union all
select 'row-level security on ' || t.name,
       case when c.relrowsecurity then 'ok' else 'OFF' end
from tables t left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace
union all
select 'no direct writes to ' || t.name,
       case when has_table_privilege('authenticated', 'public.' || t.name, 'insert')
              or has_table_privilege('authenticated', 'public.' || t.name, 'update')
              or has_table_privilege('authenticated', 'public.' || t.name, 'delete')
              or has_table_privilege('anon', 'public.' || t.name, 'insert') then 'WRITABLE' else 'ok' end
from tables t
union all
select 'save receipts hidden',
       case when has_table_privilege('authenticated', 'public.save_receipts', 'select') or has_table_privilege('anon', 'public.save_receipts', 'select') then 'READABLE' else 'ok' end
order by 1;
