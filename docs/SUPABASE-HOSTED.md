# Testing against a hosted Supabase project

How to run Financial OS's Supabase tests, and the Supabase build of the app, against an **isolated hosted test project**. The hosted project is disposable test infrastructure:
- test accounts only;
- no real financial data;
- no production credentials;
- no Firebase migration.

The default app is unaffected; it never includes any Supabase code (see [SUPABASE.md](SUPABASE.md)).

The hosted test project is Financial OS 2 (`aymombliohuwbokpncdn`), approved in `supabase/hosted-test/projects.json`. Its setup is in progress (roadmap F3); no hosted test has passed yet. Claude Code handles no keys and never needs the database password or a service-role key; it works in a hosted project only through the Supabase connector, for a project you name (step 3).

F3 verifies the hosted project with a **focused hosted verification** (below): database checks through the connector, and `npm run test:hosted` through the project's real Auth and API with two disposable identities. The local and CI suites stay as they are. Running the full suites against a hosted project is optional and not part of F3 (last sections).

## How a hosted project is selected

A hosted project is never used by default and never reached by accident:

| Guard | Where | What it requires |
| --- | --- | --- |
| Allowlist | `supabase/hosted-test/projects.json` (committed, starts empty) | The project's 20-letter ref, added in a reviewed commit |
| Exact address | Browser build and test runners | `https://<ref>.supabase.co` exactly: no other host, scheme, port or path, and no default or fallback |
| Explicit build mode | `npm run build:hosted-test` (`--mode supabase-hosted-test`) | `VITE_SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; any other build leaves Supabase out |
| Explicit test target | `SUPABASE_TEST_TARGET=hosted` | `SUPABASE_TEST_PROJECT_REF`; the local stack stays the default, and the runners never switch on their own |
| Destructive-test confirmation | Test runners | `SUPABASE_TEST_ALLOW_DESTRUCTIVE=<the same ref>`. The tests create and delete accounts |
| In-database marker | `supabase/hosted-test/marker.sql`, run only in the test project | The runners call `financial_os_test_environment()` and stop unless it answers `financial-os-hosted-test:<ref>`. A project without it (production), or marked with another ref, is never touched |
| A way to read confirmation emails | Full-suite runners only | `SUPABASE_TEST_OUTBOX_SECRET` (the optional test outbox) or `SUPABASE_TEST_MAIL_URL`. Email confirmation stays on, so a full-suite hosted run without either is refused. The focused verification reads no email |
| Disposable identities | `npm run test:hosted` | `SUPABASE_TEST_IDENTITY_A` and `_B`: two different `@example.test` addresses (never a real person's), with their passwords |
| Public key only | Browser build and test runners | The anon or publishable key; a service-role or secret key is refused, as is a legacy key whose `ref` names another project |

The checks are in `src/state/supabase/target.ts` (browser) and `scripts/supabase-target.mjs` (test runners) and `scripts/test-hosted.mjs` (the focused verification), and tested in `src/state/supabase/__tests__/target.test.tsx`.

## Setting up the test project (product owner)

Do these in order; each step says where in the Supabase dashboard (supabase.com/dashboard).

1. **Create the project.** New project, in an organization you control.
   - Name it so it can't be mistaken: for example `financial-os-hosted-test`.
   - The Free plan is enough for testing (a Free project pauses after a period without use; restore it from the dashboard).
   - Set a database password, keep it in your password manager, and never share it, including in chat. Nothing here needs it.
   - Pick a region near you.

   Don't use any project that holds, or will hold, real data.
2. **Note the project ref and public key.**
   - Project Settings → General: the **Reference ID**, 20 lowercase letters.
   - Project Settings → API Keys: the **publishable** key (`sb_publishable_…`), or the legacy `anon` key.

   Never copy the `service_role` or secret key anywhere.
3. **Apply the migrations in `supabase/migrations`, in file-name order.** Today that is one file, `20261022100000_baseline.sql` (SQL Editor → New query → paste the whole file → Run). It needs an empty `public` schema.

   If you use the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`. Before anything else, make sure the dashboard shows the right project name. If any file fails, stop: don't run the next one.

   With your authorization for a named project, Claude Code can apply the migrations, run `verify.sql` and read the security advisors through the Supabase connector instead. The connector never shows the database password or a secret key. It stalls on statements that contain deletes (even inside a function body), so those parts go in through the SQL Editor.
4. **Check them.** Run `supabase/hosted-test/verify.sql` in the SQL Editor. It is read-only. All 27 rows must read `ok`; if any doesn't, stop. The checks cover:
   - the four functions: fixed search paths, the right security setting, not callable signed out;
   - row-level security on all eleven tables;
   - no direct writes;
   - save receipts hidden.
5. **Mark it as the test project.** Open `supabase/hosted-test/marker.sql`, replace `YOUR_PROJECT_REF` with the ref from step 2, and run it. Only in this project.
6. **Authentication → Sign In / Providers:**
   - Email provider on; allow new users to sign up.
   - **Confirm email: on.**
   - Minimum password length 8 (Supabase's default is 6; the app and the local stack require 8).
   - **Anonymous sign-ins: off.**
   - Leave every other provider off, Google included.
7. **Authentication → URL Configuration** (recommended; needed for the browser build, not for the focused verification):
   - Site URL: `http://localhost:4183`.
   - Redirect URLs: add `http://localhost:4183/**`. Email links only return to listed addresses.
8. **Approve the project in the repository:** add the ref to `supabase/hosted-test/projects.json` as `"projects": [{ "ref": "<ref>", "purpose": "Financial OS hosted tests" }]`, in a commit you review.

No test outbox, email hook, custom email provider or raised rate limits are needed for F3. Account deletion needs nothing more: `delete_account()` runs in the database and requires a password sign-in within the last 5 minutes. No service-role key is used anywhere.

## The focused hosted verification (F3)

What a hosted project adds over the local stack is its configuration: the schema and grants as deployed, its own Auth settings, and its real tokens. The persistence and security rules themselves are the same SQL that `test:db` (PostgreSQL) and the local-stack suites in CI already cover, so F3 checks the deployed project rather than re-running every suite against it.

**1. Database checks** (Claude Code, through the Supabase connector, or you in the SQL Editor):
- every table, constraint, index, policy and grant, and the four function definitions, compared with the baseline;
- `verify.sql`: all 27 rows `ok`;
- the security advisor: no finding beyond the expected ones (`save_receipts` has no policy by design; signed-in users may call `create_workspace`);
- row-level security and ownership as the `authenticated` and `anon` roles, with two temporary users that are removed afterwards.

**2. `npm run test:hosted`** (`src/state/supabase/__tests__/verification.hosted.test.ts`), through the project's real Auth and API:
- Auth settings as the project reports them: email only, confirmation required, sign-ups open, anonymous and every other provider off; an anonymous sign-in and a 7-character password refused; a new sign-up gets no session until confirmed;
- signed out: every function and table refused; a wrong password and an unknown email answered the same;
- persistence: a plan with every kind of income, accounts, transfers and Strategic Reserves comes back exactly, with identical forecasts, Activity and earnings; an ordinary save keeps everything;
- revision conflicts (two devices), retried saves answered once, a reused save id refused, a stale revision refused, an ordinary save can't erase the plan;
- sessions: refresh, and sign-out ending the session;
- cross-account isolation with raw requests (reads, direct writes, a save carrying the other workspace's ids);
- account deletion: no way to name another account, a signed-out session refused, a fresh password sign-in deletes the account and its whole plan, an earlier token reaches nothing, the other plan untouched; finally both identities are deleted.

**Disposable identities.** With confirmation on and no test outbox, the two identities are created already confirmed: two `@example.test` addresses (a reserved domain no person can own), each with a long random password generated for the run and kept only in the runner's environment. Claude Code creates them through the connector, sending only a bcrypt hash of each password, as a confirmed email-and-password user (an `auth.users` row and its `email` identity), the same thing Authentication → Users → Add user → Create new user with "Auto Confirm User" makes. Never use a personal account.

**Running it:**

```
SUPABASE_TEST_TARGET=hosted SUPABASE_TEST_PROJECT_REF=<ref> \
SUPABASE_TEST_ANON_KEY=<publishable key> SUPABASE_TEST_ALLOW_DESTRUCTIVE=<ref> \
SUPABASE_TEST_IDENTITY_A=<a@example.test> SUPABASE_TEST_IDENTITY_A_PASSWORD=<…> \
SUPABASE_TEST_IDENTITY_B=<b@example.test> SUPABASE_TEST_IDENTITY_B_PASSWORD=<…> \
npm run test:hosted
```

The runner refuses anything but the approved, marked test project and two disposable identities. It needs network access to `https://<ref>.supabase.co`. The suite uses a handful of sign-ins and two sign-up attempts, well within Supabase's default rate limits.

**Cleanup.** The suite deletes both identities through `delete_account()`. Its sign-up attempt with a fresh `@example.test` address may leave one unconfirmed user; remove it in Authentication → Users (or through the connector). Record the date, the project ref, the commit tested and the passed count. Note "hosted" and not local.

**Stop at once, and don't retry, if:**
- a runner refuses: wrong ref, not allowlisted, no marker, a non-public key, or an identity that isn't `@example.test`;
- `verify.sql` shows anything but `ok`;
- the dashboard's project name isn't the test project;
- a test reports another account's data, or a cross-account write.

## Keys and settings

Keep the project's values out of the repository and out of logs:

- **For the browser build:** a file `.env.supabase-hosted-test.local` in the repository folder. Git ignores `.env.*.local`; never commit it. It holds:

  ```
  VITE_SUPABASE_PROJECT_REF=<ref>
  VITE_SUPABASE_URL=https://<ref>.supabase.co
  VITE_SUPABASE_ANON_KEY=<publishable or anon key>
  ```

- **For the test runners:** environment variables in your shell (or a CI secret store), never committed:
  - `SUPABASE_TEST_TARGET=hosted`
  - `SUPABASE_TEST_PROJECT_REF=<ref>`
  - `SUPABASE_TEST_ANON_KEY=<publishable or anon key>`
  - `SUPABASE_TEST_ALLOW_DESTRUCTIVE=<ref>`
  - for `npm run test:hosted`: `SUPABASE_TEST_IDENTITY_A`, `SUPABASE_TEST_IDENTITY_A_PASSWORD`, `SUPABASE_TEST_IDENTITY_B`, `SUPABASE_TEST_IDENTITY_B_PASSWORD`;
  - for the optional full suites: `SUPABASE_TEST_OUTBOX_SECRET=<the outbox secret>`.
- **Never:** the service-role or secret key, the database password, or any production value. The runners print the project ref, and never a key or secret.

## Optional: the full suites against a hosted project (not part of F3)

The local-stack suites (`test:supabase`, `e2e:supabase`) can also run against a hosted test project. They create roughly 90 to 160 confirmed accounts, so they need a way to read confirmation emails and, from one machine, raised rate limits on sign-ins and verifications. F3 doesn't use any of this. Set it up only if you decide to run them:

- install the test outbox (`supabase/hosted-test/test-outbox.sql`, with your own secret of at least 32 characters; `verify-outbox.sql` must show all 13 rows `ok`);
- Authentication → Hooks → Send Email hook: type Postgres, schema `public`, function `financial_os_test_send_email` (on for automated runs, off for a real-delivery check);
- Authentication → Rate Limits: raise sign-ups, sign-ins and token verifications enough for the run, on this project only;
- remove it all afterwards with `teardown-outbox.sql`.

### The test outbox

Every test account needs its confirmation email, and the password-recovery tests need theirs. Two parts:

1. **Automated runs read emails from a test outbox** (`supabase/hosted-test/test-outbox.sql`, test project only). Supabase's **Send Email** auth hook hands each email to a database function instead of sending it, and the function stores that email's token. The test runner reads the tokens back through a function that answers only with its secret, `SUPABASE_TEST_OUTBOX_SECRET`.
   - Confirmation is still required and still checked by Supabase Auth; only the delivery changes.
   - Who can do what:
     - the captured emails and the secret: no direct access for signed-out or signed-in users (row-level security, no policies, no table privileges);
     - the capture hook: only Supabase Auth's role can run it;
     - the reader: only signed-out callers holding the secret (32+ characters, changed from the placeholder). Anything else gets the same refusal, with no contents.
   - Captured tokens are kept one hour; the links expire by then. `teardown-outbox.sql` removes it all.
   - The file refuses to install unless `marker.sql` has marked the project as the test project, so it can't be added to production by mistake. It is never a migration.
   - Verified against the real local auth server:
     - with the hook on, every sign-up, resend, recovery and email change went through the outbox, both full suites passed, and no email was sent;
     - every access rule above was probed through the API;
     - `verify-outbox.sql` flagged deliberately broken privileges;
     - the outbox secret appeared in no build or log, and no link or token appeared in any log.
   - If your plan doesn't offer auth hooks, use a test SMTP inbox with a Mailpit-compatible API (`SUPABASE_TEST_MAIL_URL`) instead. Otherwise the email-dependent part stays manual and *not yet verified*.
2. **Real delivery is checked by hand**, with the hook turned off and your SMTP provider on (procedure below). Automated runs through the outbox are not evidence that real emails arrive: until the manual check is done, report email delivery as *not yet verified*.

Never install the outbox, or turn on this hook, in a production project.

### Running the full suites, in order

1. **Confirm the project:** its dashboard name and ref, and that `https://<ref>.supabase.co` is its API URL.
2. **Confirm it's allowlisted:** `supabase/hosted-test/projects.json` lists that ref, from a reviewed commit.
3. **Migrations:** applied in order (step 3 above).
4. **Permissions and ownership:** `verify.sql` all `ok` (step 4).
5. **Marker:** installed (step 5). The runners check it themselves.
6. **Authentication and email:** settings from steps 6 and 7, the outbox and Send Email hook on, and raised rate limits.
7. **Integration suite:** with the variables above set,

   ```
   npm run test:supabase
   ```

8. **Browser suite:** with the same variables,

   ```
   npm run e2e:supabase
   ```

9. **Forecasts and backup round trips:** covered by both suites. Results come from the run's output.
10. **Account isolation and deletion:** covered by both suites, including with the app's request guard bypassed, previously issued tokens, and cleanup.
11. **Cleanup:** each suite deletes the accounts it made, through `delete_account()`. Accounts made through the app's own sign-up screen, or whose password a test changed, remain. Afterwards, Authentication → Users in this project lists them; delete them there, or leave them, since the project is disposable. Never delete anything in any other project.
12. **Record the results:** the date, the project ref, the commit tested, and the passed and skipped counts of each suite. Note "hosted" and not local.

**Expected results:**
- `test:supabase`: 30 passed, 2 skipped.
- `e2e:supabase`: 44 passed, 1 skipped.

The skips are the two anonymous-identity conversion tests, which a hosted project can't run because anonymous sign-ins are off. The integration suite's other skipped test locally becomes the hosted-only check that anonymous sign-ins are refused, which must pass. Any other skip or failure is a result to investigate, not a pass.

**Stop at once, and don't retry, if:**
- a runner refuses: wrong ref, not allowlisted, no marker, a non-public key, or no way to read emails;
- `verify.sql` shows anything but `ok`;
- the dashboard's project name isn't the test project;
- a test reports another account's data, or a cross-account write.

## Manual email check (real delivery; with F4)

Real email delivery is checked by a person, with the F4 preview or the hosted-test build. Supabase's built-in sender only delivers to your organization's team addresses, a few an hour; a custom SMTP provider lifts that. If the optional Send Email hook is installed, turn it **off** first. Use inboxes you control. Serve the hosted-test build at `http://localhost:4183`:

```
npm run build:hosted-test
PORT=4183 DIST_DIR=dist-hosted-test npm start
```

Record each step as passed or failed:

1. **Create an account** with inbox 1. The screen says to check your email, and a confirmation email arrives.
2. **Sign in before confirming.** You're told to confirm first. Choose "Send the confirmation link again", and a second email arrives.
3. **Open the newest link** in the same browser. It returns to `localhost:4183` and opens setup, signed in, on an empty plan.
4. **Sign out, then sign in** with the right password: it works. With a wrong password: "That email and password don’t match an account." With an unknown email: the same message.
5. **Forgot your password?** with inbox 1. The email arrives, and its link opens "Choose a new password". Set one, sign out, and check that the new password works and the old one doesn't.
6. **Recovery for inbox 2 without an account:** the screen answers the same way, and no email arrives.
7. **A link in another browser:** the email is confirmed, but that browser shows sign-in. This is expected, because links work in the browser that asked.

Until this check is done and recorded, real email delivery is *not yet verified*.

When testing is finished, if the optional outbox was installed, turn the hook off and run `supabase/hosted-test/teardown-outbox.sql`.

## Not done here

- Hosted setup of Financial OS 2 is in progress; no hosted test has passed yet.
- No deployment.
- No Firebase migration and no real financial data.
- Production authentication settings are not changed.
