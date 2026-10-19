# Supabase storage and accounts (Steps 10b-1 to 10b-3, 10d in development)

The PostgreSQL storage for Financial OS, the storage adapter that uses it, and a development-only way to run the app on it. **The app itself still saves on the device or to Firebase.** Only a build in the `supabase-dev` mode uses Supabase, and only a local stack (see Development). Nothing here has been applied to a hosted Supabase project; the tests run against a throwaway local PostgreSQL and a local Supabase stack.

- Migrations: `supabase/migrations/` (apply in file-name order).
- Mapping between the app and the tables: `src/state/supabase/rows.ts`.
- Storage adapter: `src/state/supabase/adapter.ts` (see Adapter).
- Tests: `src/state/supabase/__tests__/` (`rows.test.ts` and `adapter.test.ts` run in `npm test`; `*.db.test.ts` in `npm run test:db`; `*.supabase.test.ts` in `npm run test:supabase`).

## Tables

| Table | Holds | Key |
| --- | --- | --- |
| `workspaces` | One plan: owner, revision, onboarding (the retired review columns stay, unused) | `id`; `owner_id` unique |
| `sources` | Recurring items, in the app's order (`position`), with any estimate dismissal | (`workspace_id`, `id`) |
| `schedule_versions` | Each item's dated amounts and recurrence rules | (`workspace_id`, `id`); unique (`workspace_id`, `source_id`, `start_date`) |
| `source_pauses` | Stretches an item was turned off | (`workspace_id`, `source_id`, `from_date`) |
| `occurrence_records` | One-time items, and recurring occurrences someone acted on | (`workspace_id`, `id`); unique (`workspace_id`, `source_id`, `expected_date`) for recurring ones |
| `save_receipts` | Persistence only: one row per accepted save (see Retries) | (`workspace_id`, `save_id`) |

```
auth.users 1─1 workspaces 1─* sources 1─* schedule_versions
                    │             └──1─* source_pauses
                    └──1─* occurrence_records *─0..1 sources   (null = one-time)
                    └──1─* save_receipts
```

- **Money** is `bigint` cents, above $0 and at most $100,000,000, as in the app. **Financial dates** are `date`; audit times are `timestamptz`.
- **Ids are the app's own**, unique within a workspace. A recurring record's id must equal `<source_id>@<original date>`, which is how the engine finds it; moving an occurrence changes `scheduled_date`, never its id. Source ids can't contain `@`.
- **Every child row carries `workspace_id`, and every foreign key includes it**, so a row can never point into another workspace.
- **Checks mirror the app's rules:**
  - recurrence-rule shapes (`validateRule`);
  - an actual exists exactly when an occurrence is completed;
  - a cancel time exists exactly when it's canceled;
  - recurring items are income, bills, subscriptions, liabilities or reserves; one-time items are income, varied spending or reserves (migration `20261018000002`);
  - `main_paycheck` is always `false` (column retained for schema compatibility; the concept was removed in Phase R1);
  - a liability type only on liability payments;
  - estimate dismissals are complete or absent;
  - an item that's on has no end date.
- **Kept, not checked:** records whose original date a later schedule no longer produces. The engine sets them aside and they count again if a schedule brings the date back. The database can't run the schedule, so it doesn't judge them.
- **Not stored:** forecasts, timing gaps, suggestions, scenarios, sample data.

## Functions

All four run with `search_path = ''`, name every object by schema, and can be called only by signed-in users (role `authenticated`).

- **`create_workspace()`** returns the caller's workspace, creating it on first use. There is no way to name another owner.
- **`load_plan()`** returns the caller's whole plan as one JSON value, read in a single statement (one consistent snapshot). It runs as the caller, so row-level security applies; it returns null without a workspace. Dates come back as `YYYY-MM-DD`; times as ISO-8601 UTC with milliseconds.
- **`save_plan(base_revision, save_id, mode, plan)`** saves the whole plan as revision `base_revision + 1`, in one transaction:
  1. checks the caller is signed in (PT401) and has a workspace (PT404), and locks it;
  2. answers a retried request from its receipt;
  3. checks the revision (PT409);
  4. validates the request (PT422) and the rules of its mode;
  5. applies the plan;
  6. advances the revision once and records a receipt.

  Any error rolls everything back. Codes `PTxxx` become HTTP status `xxx` through Supabase's API.
- **`delete_account()`** permanently deletes the caller's own account (migration `20261018000001_account_deletion.sql`). It takes no arguments, so it can't name another account. It requires:
  - a signed-in caller (PT401);
  - a session that still exists in Supabase Auth (PT401), so a token from a session that signed out can't use it;
  - a password sign-in within the last 5 minutes (PT403). Supabase Auth checks the password and records the time in the token's `amr` claim, and refreshing a token keeps the original time.

  Checked against the real auth server: a token refresh keeps the original sign-in time (only `iat` changes), so it never counts as a new password check. A token with edited claims is rejected by the API (PGRST301) before the function runs, so nothing the browser changes can satisfy the check. An anonymous identity's sign-in method is `anonymous` and is refused.

  Deleting the `auth.users` row removes, through foreign keys with ON DELETE CASCADE, the person's identities, sessions and refresh tokens, and their workspace with its sources, schedule versions, pauses, occurrence records and save receipts. An access token issued earlier still verifies until it expires (Supabase Auth tokens are self-contained), but it reaches nothing: no workspace, no rows, and `create_workspace` fails because the user no longer exists. It runs as the migration owner (`security definer`), so no privileged key is ever in the app. The alternative is an Edge Function calling the Auth admin API with the service-role key on the server; both keep the privilege server-side.

### Save modes

| Mode | Used for | Accepted |
| --- | --- | --- |
| `update` | Every ordinary change | Only removals the app's own operations make: at most one item (never one with recorded history) and one one-time entry per save; recurring records only by undo. An existing record's original prediction (`expected_*`), source and kind can't change, existing schedule versions can't be rewritten, and setup can't be reopened. An empty or truncated plan therefore can't erase a populated one. |
| `replace` | Restore from a backup | The whole plan is replaced, history included. |
| `reset` | Start over | Only an empty plan back in setup . |

The database can't know that someone confirmed a restore or a start over: the app asks for confirmation and offers a backup first. What the database does guarantee is that only the owner can do it, only against the revision they were shown, only with a valid plan, and only when the mode is named.

### Retries

A timeout doesn't prove a save failed.
- **Same request again:** calling `save_plan` again with the same `save_id` and the same request returns the original result (`already_saved`, with the current revision) and applies nothing, even after later saves.
- **Reused id, different data:** refused (PT422). The receipt's fingerprint is a SHA-256 of the mode, the base revision and the plan.
- **Retention:** receipts are kept for 30 days and at most 100 per workspace.
- **Without a receipt,** a stale retry is a conflict. The revision check alone already prevents a change being applied twice. The receipts add a definite answer to "was my change saved?", which the revision can't give after other saves.

### Concurrency

`save_plan` locks the workspace row. Two sessions saving from the same revision run one after the other; the second sees the new revision and gets a conflict.

## Access rules

- **Row-level security is on for all six tables.** Signed-in users may `select` only rows of the workspace they own.
- **No direct writes:** `insert`, `update` and `delete` are revoked from everyone (Supabase grants them by default), so all writes go through `save_plan`.
- **Hidden tables:** `save_receipts` has no grants or policies.
- **Signed-out callers** (`anon`) can't read tables or call the functions.
- **Ownership** comes from `auth.uid()`; requests carry no owner or workspace id, and any sent are ignored.
- **Service-role keys never go in the browser.**
- **Accounts are email and password** (Supabase Auth), with email confirmation. The app never creates anonymous identities; one left by an earlier development build can be converted (see Development).

## Mapping (`src/state/supabase/rows.ts`)

- **`toRows(appData)`** builds the request body for `save_plan`; **`fromRows(loaded)`** turns `load_plan`'s result back into AppData. Both are pure.
- **Everything financial round-trips exactly.** That includes absent optional fields: no liability type stays absent.
- **Three things come back in canonical form (`canonicalize`):** times as ISO-8601 UTC with milliseconds (what the app writes anyway), schedule versions in start order, and pauses in date order. The forecast doesn't change.
- **The source order is stored (`position`)**; the earliest active income's first upcoming date anchors the forecast start.
- **`checkForMigration(appData)`** lists everything the database would refuse: orphaned records, ids that don't match their source and date, repeated ids, completed records without actuals, invalid times, and so on. It also lists what will be stored in canonical form. Today's `migrate` is more lenient than the database, so run this before migrating.

## Adapter (`src/state/supabase/adapter.ts`)

`SupabaseStorageAdapter` implements the app's `StorageAdapter` with a supabase-js client (only `client.rpc` is used). It is given a signed-in client (see Development); each signed-in person gets their own adapter.

- **Load:** `load_plan`. With no workspace yet, `create_workspace` once, then `load_plan` again (an empty plan in setup, revision 0). `fromRows` turns the result into AppData.
- **Save:** `save(data, baseRevision, intent)` sends `toRows(data)` to `save_plan` with the intent as the mode: `update` (the default), `replace` for a restore, `reset` for start over. A save counts as done only when `save_plan` confirms it; the store keeps the change in memory until then.
- **Online-first:** nothing is kept on the device: no local copy, no queue of pending changes, no recovered copy. `clear()` does nothing (erasing the plan is a `reset` save). The store already shows that a change isn't saved, offers Try again, and warns before the page closes.

### Results and messages

| What happened | Result | Message |
| --- | --- | --- |
| Confirmed (`saved`, or `already_saved` with nothing newer) | `ok`, the new revision | |
| No reply, a network failure, a gateway or server error (5xx), a timeout | error | Couldn’t reach the server, so this change isn’t confirmed yet. Check your connection and try again. |
| Signed out or session expired (PT401, 401, 42501, PGRST301/302) | error | You’ve been signed out, so this change isn’t saved. Sign in again, then try again. |
| The database refused the request (PT422) | error | This change couldn’t be saved: *the database's reason* |
| A check or key refused the plan (SQLSTATE 22xxx, 23xxx) | error | …didn’t pass a safety check. Nothing was changed. |
| No workspace (PT404) | error | There’s no plan to save to. Reload and try again. |
| Changed elsewhere first (PT409) | conflict | Your data was changed somewhere else, such as another device. Reload to see the latest version. |
| This change was saved, but newer saves followed | conflict | Your change was saved, but your data has changed somewhere else since. Reload to see the latest version. |

Loading throws an Error with the same messages; the store shows its load-failure screen.

### Save intent in the app (`src/state/store.tsx`)

- **Ordinary changes** (`run`), including undoing one item and batches of due items, are always saved as `update`.
- **Restore a backup** and **Start over** use `replacePlan(op, 'replace' | 'reset')`. The adapter says it is online-first (`onlineFirst`), so the store:
  1. runs it only when every earlier change is saved (otherwise: "Your latest change hasn’t been saved yet…"), and combines nothing into it;
  2. keeps the saved plan on screen and other changes waiting until `save_plan` confirms it; the dialog shows Restoring… / Erasing… and its buttons are disabled, so a second click sends nothing;
  3. on confirmation shows the new plan, closes the dialog and reports success;
  4. otherwise keeps the dialog open with the reason ("The restore hasn’t been confirmed. …" / "Erasing hasn’t been confirmed. …"). **Try again** sends the same save (same intent, base revision and plan, so the same save id). **Cancel** drops it and reloads what is actually saved, because an unconfirmed save may have gone through. A conflict offers Reload.
- With device or Firebase storage, `replacePlan` applies like `run`, as before.

### `clear()`

`StorageAdapter.clear()` has one caller: entering sample data clears the device's sample copy (a `LocalStorageAdapter` under its own key). It is never called on account or Supabase storage. The Supabase adapter's `clear()` **rejects** ("Supabase storage doesn’t erase a plan this way…") instead of reporting success, because nothing is kept on the device and erasing the plan is an explicit `reset` save. These are different actions:

| Action | Today | With Supabase |
| --- | --- | --- |
| Clear the plan / start setup again | Start over (`reset` save) | Same |
| Sign out | Firebase: forget the device copy (`forgetDevice`) | Ends this device's session (`signOut({ scope: 'local' })`); the account and plan stay on the server |
| Delete the account and its data | Firebase `deleteAccount` | `delete_account()` after a fresh password check (see Functions) |

### Retries in the adapter

- **One save id per logical save:** the same intent, base revision and plan. Try again after an unknown outcome reuses the id, so the database applies it at most once; any other save gets a new id.
- **Unknown outcome** (no reply, 5xx, timeout): the adapter remembers that save (id, base, intent, plan) in memory and reports it as not saved.
- **Try again, same save:** `already_saved` with nothing newer is success at that revision; with newer saves since, it's a conflict saying the change was saved and asking for a reload. The revision never goes backwards and the newer data isn't overwritten.
- **A different save after an unknown one** (the person kept editing): if it meets a conflict, the adapter re-sends the remembered save (same id) to ask whether it went through. If it did and nothing else followed, it saves the new edit on top of that revision; if newer saves followed, a "saved, but changed since" conflict; if it never arrived, a plain conflict. If that question gets no reply either, the save stays unknown and is reported as not saved.
- **A refused save** (PT422, a check) is definite: nothing was applied, and the next save gets a new id.

## Development (`src/state/supabase/dev.tsx`, `session.tsx`, `src/ui/supabase/`)

A build in the `supabase-dev` mode runs the app on a **local** Supabase stack, with email-and-password accounts:

```
supabase start                     # from the repository (supabase/config.toml)
VITE_SUPABASE_ANON_KEY=<anon or publishable key from supabase status> npm run dev:supabase
```

- `VITE_SUPABASE_URL` defaults to `http://127.0.0.1:54321`. Anything other than this machine is refused, and so is any key but the public anon or publishable key.
- **Every other build is unchanged:** `import.meta.env.MODE` is fixed at build time, so the Supabase code is left out of the default build entirely. Settings and setup get the account controls through an account slot (`src/state/slots.tsx`) that only this build fills. `npm run e2e:supabase` checks the built files contain no Supabase code and that the page never contacts it.

### Accounts

- **Create an account:** an email and a password (at least 8 characters), nothing else. Supabase Auth emails a confirmation link; opening it in the same browser signs in, and setup starts on an empty plan. Signing in before confirming says so and offers to resend the link.
- **Sign in:** a wrong password and an unknown email get the same message. "Already registered" on sign-up gets the same answer as a new sign-up, so the screens never say which emails have accounts.
- **Recover a password:** "Forgot your password?" emails a link. It opens "Choose a new password", then the app.
- **Links in emails** use PKCE: they return with a one-time code for the browser that asked, never with tokens in the address. Opened in another browser, the email is still confirmed, but the person then signs in there.
- **Sessions** are supabase-js's: kept in this browser's storage (`financial-os:supabase-dev-auth`, tokens only), so reloading or reopening the app stays signed in. They're refreshed automatically, and the API checks them on every request. Nothing financial is stored on the device.
- **Each person gets their own app** (keyed by user id) and their own adapter, so nothing in memory carries over to whoever signs in next on the device.
- **Requests are bound to their account.** The browser has one Supabase session shared by all its tabs, so another tab signing in as someone else changes the token every tab's requests carry. Each adapter therefore marks its requests with its owner (`ownerBound`). The client's fetch (`ownerGuardFetch`) stops a marked request whose token belongs to another account before it is sent (code FO401: "Another account signed in on this device, so this change wasn’t sent…"). Without this, a save still queued in one tab went out under the other account's session; in a reproduction, one account's plan landed in another's empty workspace.
- **Another account signing in elsewhere sets changes aside.** When another tab signs in as someone else, this tab follows the browser's session to the new account. First, whatever the previous account hadn't confirmed is captured (`unsavedChanges()` in the store) and set aside in memory for that account. Nothing is merged, and nothing is ever shown as the new account's plan.
  - The recovery panel ("Unsaved changes from another account") shows only that something was set aside and for which email, until that account's password is entered. A separate, in-memory session checks it, without touching the browser's session.
  - Unlocked, the changes can be saved into that account, but only on top of exactly the revision they were based on. If the account's plan is already the same, it says so. If the plan has moved on since, they aren't written over it ("…changed since these edits, so they weren’t saved over it. Download them to compare."), and they can be downloaded as a backup instead.
  - Discarding takes a second, explicit step, and leaving the page warns while anything is set aside.
  - A restore or start over that was waiting for the server's answer is set aside too, with its intent. The panel says it "may or may not have been applied". Unlocked, it checks the account: applied (says so), still at the revision it started from (the person can finish it, as that account), or changed since (left alone). It is never sent again by itself.
  - Limits: set-aside changes live only in that page, so closing it (after the warning) loses them. Ordinary changes that were in flight as the account changed are sent with the right session and land in their own account. But the set-aside copy can't then tell that save apart from a newer one made elsewhere: if the copy differs from the saved plan, it is refused and offered as a download.
- **What the server enforces without the app's guard:** a token reaches only its own account's workspace. Requests sent with plain HTTP and no guard, using A's token while claiming B and carrying B's ids, can't read, write or link into B's workspace; a save lands in A's own (tested). What the server can't know is which account a plan was *meant* for: a request sent with B's valid token is B's request. Keeping one account's plan from being sent under another's session is therefore the client's job (`ownerGuardFetch`), and every plan request and the deletion request are bound.
- **Sign out** (Settings, or the setup welcome screen) ends this device's session; the account and plan stay. With an unsaved change it warns first and offers Try saving again and a backup.
- **A session that ends while the app is open** (expired and couldn't be refreshed, or signed out everywhere): with nothing unsaved, back to sign-in. With unsaved changes, they stay on screen, and "Sign in again to save" asks for the same account's password and then saves. It also offers a backup, or leaving without saving.
- **Offline:** the session is kept, and a change is shown as not saved until the connection returns and it's saved.
- **Delete account** (Settings):
  - explains that it's permanent and that Start over only clears the plan;
  - offers a backup;
  - is refused while a change is unsaved;
  - requires the password. A wrong one deletes nothing; the right one signs in afresh, then calls `delete_account()`;
  - is bound to its account like every plan request, so a session switched by another tab can't redirect it;
  - is shown as done only when the server confirms it. If the reply is lost (or the server fails), the app asks the auth server whether the account still exists. If it's gone, the app shows it as deleted and signs out; if it's still there, it says it wasn't deleted. If neither can be told, it signs out and says so. It never retries a deletion by itself.

### Temporary identities from earlier development builds

The previous development build signed in with anonymous identities. Supabase supports converting one into a permanent account while keeping its id: `updateUser({ email })`, confirmed by a link, then `updateUser({ password })`. An anonymous session left in the browser opens its plan with "Keep this plan" in Settings: add an email, open the link, choose a password. The identity, and so the workspace and plan, stay the same, and the email and password then work on any device. Nothing is merged and no second workspace is made. A temporary identity that is signed out can't be reached again, so signing out of one warns and offers a backup; restoring that backup into an account is the fallback. This is a development path only, not an account-merging feature.

### Hosted test projects

An approved, isolated hosted test project can be used deliberately: through an allowlist, an exact address, its own build mode (`npm run build:hosted-test`), an explicit test target, a destructive-test confirmation and an in-database marker. See [SUPABASE-HOSTED.md](SUPABASE-HOSTED.md) for the guards and the setup steps.

## Migration and rollback

- **Migration path (development data):** download a backup from the current app, then restore it into the Supabase-backed app (a `replace` save into the new, empty workspace). Run `checkForMigration` first.
- **Verified by the equivalence tests:** the stored plan equals the canonical original, and `buildForecast`, timing gaps, the lowest running total, estimate suggestions, the Home view, and variances are identical today and 30, 90, 180 and 365 days ahead.
- **Rollback:** the device copy and Firestore documents aren't touched. A backup downloaded from the Supabase-backed app (the same format, round-trip tested) restores into the current app.
  - If both copies changed after migrating, neither overwrites the other automatically. The person picks which backup to restore, and can keep the other as a file.

## Tests (`npm run test:db`)

The script creates a temporary PostgreSQL cluster (Unix socket only) and then:
1. applies `supabase/tests/local-supabase-shim.sql`, which stands in for the parts of Supabase the migrations use: the `anon`, `authenticated` and `service_role` roles, `auth.users`, `auth.uid()` from the JWT claims, and Supabase's default grants;
2. applies the migrations unchanged;
3. runs `src/**/*.db.test.ts`;
4. deletes the cluster.

It needs the PostgreSQL server binaries and `psql`. These tests run against plain PostgreSQL with the shim. The same files also pass against the database of a local Supabase stack (see below), without the shim.

| File | Covers |
| --- | --- |
| `equivalence.db.test.ts` | Round trips and identical forecasts for every fixture plan; backup export |
| `persistence.db.test.ts` | Normal save, immediate, delayed and late retries, reused ids, concurrent sessions, stale revisions, rollback partway, lost replies, repeated restore, receipt retention |
| `integrity.db.test.ts` | Each event counts once (actual, early, late, moved, canceled, undo, schedule changes), removal rules, empty plans, replace, reset, history and corrections |
| `security.db.test.ts` | Users A and B and a signed-out caller: reads, saves, direct writes, cross-workspace links, ownership, function privileges, row-level security |
| `adapter.test.ts` (in `npm test`) | The adapter against a fake client (`fake-supabase.ts`): every kind of save, lost replies and retries, conflicts, refused saves, signed-out sessions, and the store's saving / not-saved / Try again states |

## Tests against a local Supabase stack (`npm run test:supabase`)

`*.supabase.test.ts` run the adapter and the functions through a real Supabase stack: its auth server (real email sign-ups and sessions), API gateway and PostgREST. They cover signed-out and invalid-token callers, a new user's first load, exact round trips and identical forecasts, two people who can't reach each other's plans or write rows directly, a session that ends, two devices saving at once, replies lost after the database committed, an old save retried after newer ones, reused save ids, stale revisions, and the update, replace and reset modes.

1. Install the Supabase CLI (not a project dependency) and Docker.
2. From the repository, run `supabase start`. It uses `supabase/config.toml` and applies `supabase/migrations`. Only the database, auth, API gateway, PostgREST and the email-testing server are needed: `-x studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta`.
3. Run `SUPABASE_TEST_ANON_KEY=<anon or publishable key from supabase status> npm run test:supabase`. `SUPABASE_TEST_URL` defaults to `http://127.0.0.1:54321`, and `SUPABASE_TEST_MAIL_URL` (the email-testing server) to `http://127.0.0.1:54324`.

The script refuses any address other than this machine, and refuses a service-role or secret key: the tests use only what a browser has. Each test signs up its own throwaway accounts and confirms them through their real emails.

`auth.supabase.test.ts` covers accounts through the real auth server:
- sign-up with email confirmation;
- wrong credentials;
- a returning account on another device;
- password recovery by email (and an unknown email getting the same answer);
- refresh, and sign-out revoking the refresh token;
- deletion: cleanup, stale tokens, refusals, and only the caller deleted;
- converting an anonymous identity, which keeps its id and plan. To run the database tests against the same stack's PostgreSQL: `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres npx vitest run --config vitest.db.config.ts`.

Last run by hand (October 2026): Supabase CLI 2.121.0, Supabase Postgres 17.11.0.004, GoTrue 2.197.0, PostgREST 16.4, Mailpit 1.31.3; the migrations applied unchanged by `supabase start`. CI (`.github/workflows/ci.yml`, job "Supabase integration and browser tests") now runs `test:supabase` and `e2e:supabase` against a fresh local stack (Supabase CLI 2.121.0) on every pull request, with all four migrations.

## Browser tests (`npm run e2e:supabase`)

`e2e/supabase.e2e.test.ts` drives built copies of the app in Chromium against a local stack. It has the same requirements as `test:supabase`, and `scripts/local-supabase.mjs` applies the same checks. Every test signs in through the app's sign-in screen.

- **Setup and everyday use:** an empty workspace, setup (income, a bill, varied spending, a liability payment), a recorded payment, undo, a raise from a date, a moved occurrence, a restore, a dismissed estimate suggestion, and start over. After each one, Supabase holds exactly what's on screen, and a reload brings back the same plan, the same dashboard and identical forecasts. Every save is confirmed; all are `update` except one `replace` and one `reset`.
- **Conflicts and retries:**
  - two devices signed in to one account: the second save gets a conflict and isn't shown as saved, the first is kept, the unsaved change can still be downloaded, and Reload shows the latest;
  - a reply lost after commit: shown as not saved, warns before leaving, Try again reuses the save id and applies once;
  - a lost save, then more edits: saved on top;
  - a lost save retried after a newer save: recognized, no regression, asks for a reload;
  - a token the API refuses: shown as signed out, saved once accepted;
  - a restore the database refuses: the saved plan stays;
  - a double-clicked restore: one save.
- **Accounts**, through the app's own screens:
  - creating an account and confirming its email (and signing in before confirming);
  - wrong credentials;
  - reload, closing and reopening, and another device;
  - password recovery;
  - token refresh, and an expired session both on reopening and while open (sign in again to save);
  - going offline;
  - sign-out, with and without unsaved changes;
  - switching accounts on one device, never showing the previous plan;
  - start over keeping the account;
  - account deletion (explained, password required, a wrong password, cleanup, a stale token, another account untouched), and deletion refused while unsaved;
  - converting an earlier temporary identity;
  - a deletion whose reply is lost after it happened, and one that never reached the server.
- **Two tabs on one device**, with real shared sessions:
  - the same account in both;
  - another account signing in with nothing unsaved;
  - with an unsaved change after a server failure, and after a network failure;
  - with a save in flight;
  - with a save queued behind it (the case that used to land in the other account);
  - a set-aside change that went stale;
  - discarding and leaving the page;
  - each account's confirmed plan intact afterwards.
- **Isolation:** two accounts can't reach each other's plans, and signed-out callers reach nothing.
- **Migration:** a plan from the device-storage app, downloaded with its backup button, restored into an empty Supabase workspace. `checkForMigration` passes first, and everything arrives exactly: ids, original predictions, current expectations, actuals, schedule versions, pauses, estimate dismissals, onboarding, forecasts and timing gaps. The Supabase copy's backup then restores into device storage again (rollback).
- **The default build:** no Supabase code, no requests to it.

## Performance

Measured once, as a guide only (local PostgreSQL 16): a plan with 40 items and 1,440 recorded payments loads in about 57 ms and saves in about 200 ms, in one call each (a request of about 740 KB). No extra indexes or caching until real use shows a need. If plans grow large, saves can later send only what changed, through the same function.

## Not built (extension points)

| Feature | How it would be added |
| --- | --- |
| Virtual paycheck allocations | New tables keyed by `workspace_id`; recommendations with proposed / approved / dismissed status |
| Optional cash-on-hand snapshot | A dated snapshot table; with none, the forecast keeps its $0 start the day before payday |
| Accounts, transfers and reserve releases (in the app; not in the schema) | An `accounts` table (id, name, type `income` / `distribution` / `payment`, optional opening balance and date, timestamps) keyed by `workspace_id`, a nullable `account_id` on sources and on one-time records (null = unassigned) referencing it, a `transfers` table (source and a different destination account in the same workspace, positive amount, date, `expected` / `recorded`), a `release` flag on one-time reserve records, and `load_plan` / `save_plan` carrying them (roadmap AC-S). Until then the adapter refuses a plan with any of them (`hasAccountData`) instead of saving it without them, and `checkForMigration` reports it |
| Shared households | A membership table; the read policies and the owner check in the functions change, rows don't |
| Partial payments | Several actuals per occurrence (a child table of `occurrence_records`) with completion rules in the engine; today an occurrence has one recorded outcome |

The zero-start anchor is unchanged.
