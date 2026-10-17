# Testing against a hosted Supabase project

How to run Financial OS's Supabase tests, and the Supabase build of the app, against an **isolated hosted test project**. The hosted project is disposable test infrastructure: test accounts only, no real financial data, no production credentials, no Firebase migration. The default app is unaffected; it never includes any Supabase code (see [SUPABASE.md](SUPABASE.md)).

Nothing here has been run against a hosted project yet. The steps below are for the product owner. Claude Code doesn't create projects, apply migrations to them, or handle their keys.

## How a hosted project is selected

A hosted project is never used by default and never reached by accident:

| Guard | Where | What it requires |
| --- | --- | --- |
| Allowlist | `supabase/hosted-test/projects.json` (committed, starts empty) | The project's 20-letter ref, added in a reviewed commit |
| Exact address | Browser build and test runners | `https://<ref>.supabase.co` exactly: no other host, scheme, port or path, and no default or fallback |
| Explicit build mode | `npm run build:hosted-test` (`--mode supabase-hosted-test`) | `VITE_SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; any other build leaves Supabase out |
| Explicit test target | `SUPABASE_TEST_TARGET=hosted` | `SUPABASE_TEST_PROJECT_REF`; the local stack stays the default |
| Destructive-test confirmation | Test runners | `SUPABASE_TEST_ALLOW_DESTRUCTIVE=<the same ref>`. The tests create and delete accounts |
| In-database marker | `supabase/hosted-test/marker.sql`, run only in the test project | The runners call `financial_os_test_environment()` and stop unless it answers `financial-os-hosted-test:<ref>`. A project without it (production), or marked with another ref, is never touched |
| Public key only | Browser build and test runners | The anon or publishable key; a service-role or secret key is refused, as is a legacy key whose `ref` names another project |

The checks are in `src/state/supabase/target.ts` (browser) and `scripts/supabase-target.mjs` (test runners), and tested in `src/state/supabase/__tests__/target.test.tsx`. The local stack keeps its own checks unchanged: this machine only.

## Setting up the test project (product owner)

1. **Create a new, separate Supabase project** for testing only. Don't reuse a project that holds, or will hold, real data. Note its project ref (Project Settings → General) and its public API key (Project Settings → API: the publishable key, or the legacy `anon` key).
2. **Apply the migrations, in file-name order** (and nothing from `supabase/hosted-test/`):
   1. `supabase/migrations/20261016000001_financial_schema.sql`
   2. `supabase/migrations/20261016000002_access_and_persistence.sql`
   3. `supabase/migrations/20261018000001_account_deletion.sql`

   Either `supabase link --project-ref <ref>` then `supabase db push`, or paste each file into the SQL editor in that order.
3. **Check them:** run `supabase/hosted-test/verify.sql` in the SQL editor. It is read-only, and every row should read `ok`:
   - four functions, with fixed search paths and the right security setting;
   - not callable signed out, callable signed in;
   - row-level security on all six tables;
   - no direct writes;
   - save receipts hidden.
4. **Mark it as the test project:** open `supabase/hosted-test/marker.sql`, replace `YOUR_PROJECT_REF` with the ref, and run it in the SQL editor. Never in production.
5. **Authentication** (Authentication → Providers / Settings):
   - Email provider on, with email and password sign-in. No other providers.
   - **Confirm email: on.** For the automated tests, the project's emails must reach an inbox the tests can read: a test SMTP provider with a Mailpit-compatible API, given as `SUPABASE_TEST_MAIL_URL`. Without one, turn Confirm email off for automated runs: the tests that need an email (sign-up confirmation, password recovery) then skip themselves and say so. Check those flows by hand with a real inbox, then turn it back on.
   - Minimum password length 8 (as the app asks).
   - **Anonymous sign-ins: off.** A hosted test checks this.
   - Site URL and redirect URLs: the addresses the app is served from. For the browser tests, `http://localhost:4183/**`; for a hosted preview, its own address. Email links only return to listed addresses.
6. **Email delivery:** set a custom SMTP provider (Authentication → Emails → SMTP). Supabase's built-in sender is limited to a few emails an hour, which isn't enough for the tests.
7. **Rate limits** (Authentication → Rate Limits): a full test run signs up and signs in roughly 150 accounts. Raise sign-ups/sign-ins and token verifications enough for that on the test project only, and keep production at its defaults.
8. **Approve the project:** add its ref to `supabase/hosted-test/projects.json` (`"projects": [{ "ref": "<ref>", "purpose": "Financial OS hosted tests" }]`) in a reviewed commit.

Account deletion needs nothing more: `delete_account()` (migration 3) runs in the database and requires a password sign-in within the last 5 minutes. No service-role key is used anywhere.

## Keys and settings

Keep the project's values out of the repository and out of logs:

- **For the browser build:** `.env.supabase-hosted-test.local` (git ignores `.env.*.local`) with `VITE_SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public key only). Vite reads it for that mode.
- **For the test runners:** environment variables in the shell or CI secret store, never committed:
  - `SUPABASE_TEST_TARGET=hosted`
  - `SUPABASE_TEST_PROJECT_REF`
  - `SUPABASE_TEST_ANON_KEY` (public)
  - `SUPABASE_TEST_ALLOW_DESTRUCTIVE`
  - optionally `SUPABASE_TEST_MAIL_URL`
- **Never:** the service-role or secret key, the database password, or any production value. The runners print the project ref, and never a key.

## Running the tests against it

```
SUPABASE_TEST_TARGET=hosted SUPABASE_TEST_PROJECT_REF=<ref> SUPABASE_TEST_ANON_KEY=<public key> \
SUPABASE_TEST_ALLOW_DESTRUCTIVE=<ref> [SUPABASE_TEST_MAIL_URL=<mail API>] npm run test:supabase

# the same variables, then
npm run e2e:supabase
```

Before anything runs, each runner checks the allowlist, the address, the key, the destructive-test confirmation, that the project answers, and the marker. It stops with a plain message and status 2 if any check fails.

**What runs (real auth, real API), the same suites as locally:**
- accounts and sessions;
- ownership isolation, including with the app's request guard bypassed;
- ordinary saves, revisions and conflicts, lost replies and retries;
- restore, Start over and backup migration;
- forecast equivalence;
- cross-tab account switching, owner-bound requests, session refresh;
- pending restores and resets;
- password-protected recovery;
- account deletion with the recent-password check, previously issued tokens, and cleanup.

**What is skipped on a hosted project:**
- without a mail API: sign-up confirmation, recovery, and the unknown-email check;
- always: the two anonymous-identity tests, since anonymous sign-ins are off. A hosted-only test checks they are refused instead.

**Not run on the hosted project:** `npm run test:db` stays on its throwaway local PostgreSQL. It needs direct database access, which the hosted tests don't use.

**Cleanup:** at the end of each suite, the accounts the tests made are deleted through `delete_account()`, the same path a person takes. The few made through the app's own sign-up screen, or whose password a test changed, remain: purge the test project's users from time to time (Authentication → Users), or recreate the project.

## Not done here

- No hosted project has been created, migrated or tested.
- No deployment.
- No Firebase migration and no real financial data.
- Production authentication settings are not changed.
