-- Financial OS: marks a hosted Supabase project as disposable TEST infrastructure.
--
-- Run this ONLY in the isolated hosted test project, in its SQL editor, after
-- replacing YOUR_PROJECT_REF with that project's 20-letter ref. Never run it in
-- production, and never add it to supabase/migrations (so `supabase db push`
-- never carries it anywhere).
--
-- The test runners (npm run test:supabase / e2e:supabase with
-- SUPABASE_TEST_TARGET=hosted) call this before anything that creates or
-- deletes accounts, and refuse to run unless it answers with exactly
-- 'financial-os-hosted-test:<the project ref they were given>'. A project
-- without it (production) or with another project's ref is never touched.

create or replace function public.financial_os_test_environment() returns text
language sql
stable
set search_path = ''
as $$
  select 'financial-os-hosted-test:YOUR_PROJECT_REF'::text
$$;

revoke all on function public.financial_os_test_environment() from public;
grant execute on function public.financial_os_test_environment() to anon, authenticated;
