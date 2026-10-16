-- TEST ONLY. Never apply to a Supabase project, which already has all of this.
--
-- A plain PostgreSQL cluster lacks what Supabase provides, so the database
-- tests recreate the parts the migrations rely on, the way Supabase defines
-- them: the anon / authenticated / service_role roles, auth.users, and
-- auth.uid() reading the signed-in user from the request's JWT claims. It also
-- reproduces Supabase's default grants on the public schema (everything to
-- anon and authenticated), so the tests prove the migrations revoke them.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (id uuid primary key);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  ), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
