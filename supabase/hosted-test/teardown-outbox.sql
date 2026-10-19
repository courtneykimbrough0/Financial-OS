-- Financial OS: removes the test outbox (test-outbox.sql) from the test
-- project. Turn off the Send Email hook first (Authentication -> Hooks), or
-- Supabase Auth will fail to send emails.
drop function if exists public.financial_os_test_read_outbox(text, text);
drop function if exists public.financial_os_test_send_email(jsonb);
drop table if exists public.financial_os_test_outbox;
drop table if exists public.financial_os_test_outbox_secret;
