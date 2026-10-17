# Supabase storage (Steps 10b-1 to 10b-3)

The PostgreSQL storage for Financial OS, the storage adapter that uses it, and a development-only way to run the app on it. **The app itself still saves on the device or to Firebase.** Only a build in the `supabase-dev` mode uses Supabase, and only a local stack (see Development). Nothing here has been applied to a hosted Supabase project; the tests run against a throwaway local PostgreSQL and a local Supabase stack.

- Migrations: `supabase/migrations/` (apply in file-name order).
- Mapping between the app and the tables: `src/state/supabase/rows.ts`.
- Storage adapter: `src/state/supabase/adapter.ts` (see Adapter).
- Tests: `src/state/supabase/__tests__/` (`rows.test.ts` and `adapter.test.ts` run in `npm test`; `*.db.test.ts` in `npm run test:db`; `*.supabase.test.ts` in `npm run test:supabase`).

## Tables

| Table | Holds | Key |
| --- | --- | --- |
| `workspaces` | One plan: owner, revision, onboarding, review rhythm | `id`; `owner_id` unique |
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
  - one-time items are income, bills or savings;
  - at most one main paycheck;
  - a liability type only on liability payments;
  - estimate dismissals are complete or absent;
  - an item that's on has no end date.
- **Kept, not checked:** records whose original date a later schedule no longer produces. The engine sets them aside and they count again if a schedule brings the date back. The database can't run the schedule, so it doesn't judge them.
- **Not stored:** forecasts, timing gaps, suggestions, scenarios, sample data.

## Functions

All three run with `search_path = ''`, name every object by schema, and can be called only by signed-in users (role `authenticated`).

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

### Save modes

| Mode | Used for | Accepted |
| --- | --- | --- |
| `update` | Every ordinary change | Only removals the app's own operations make: at most one item (never one with recorded history) and one one-time entry per save; recurring records only by undo. An existing record's original prediction (`expected_*`), source and kind can't change, existing schedule versions can't be rewritten, and setup can't be reopened. An empty or truncated plan therefore can't erase a populated one. |
| `replace` | Restore from a backup | The whole plan is replaced, history included. |
| `reset` | Start over | Only an empty plan back in setup (the review rhythm may stay). |

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
- **Anonymous Supabase sign-in** may be used for isolated development only. It isn't recoverable and isn't for real users (see Step 10d).

## Mapping (`src/state/supabase/rows.ts`)

- **`toRows(appData)`** builds the request body for `save_plan`; **`fromRows(loaded)`** turns `load_plan`'s result back into AppData. Both are pure.
- **Everything financial round-trips exactly.** That includes absent optional fields: no review rhythm stays absent and differs from "off"; no liability type stays absent.
- **Three things come back in canonical form (`canonicalize`):** times as ISO-8601 UTC with milliseconds (what the app writes anyway), schedule versions in start order, and pauses in date order. The forecast doesn't change.
- **The source order is stored (`position`)**, because with no main paycheck marked, the first active income starts pay periods.
- **`checkForMigration(appData)`** lists everything the database would refuse: orphaned records, ids that don't match their source and date, repeated ids, completed records without actuals, invalid times, and so on. It also lists what will be stored in canonical form. Today's `migrate` is more lenient than the database, so run this before migrating.

## Adapter (`src/state/supabase/adapter.ts`)

`SupabaseStorageAdapter` implements the app's `StorageAdapter` with a supabase-js client (only `client.rpc` is used). It is given an already signed-in client; signing in is Step 10d.

- **Load:** `load_plan`. With no workspace yet, `create_workspace` once, then `load_plan` again (an empty plan in setup, revision 0). `fromRows` turns the result into AppData.
- **Save:** `save(data, baseRevision, intent)` sends `toRows(data)` to `save_plan` with the intent as the mode: `update` (the default), `replace` for a restore, `reset` for start over. A save counts as done only when `save_plan` confirms it; the store keeps the change in memory until then.
- **Online-first:** nothing is kept on the device: no local copy, no queue of pending changes, no recovered copy. `clear()` does nothing (erasing the plan is a `reset` save). The store already shows that a change isn't saved, offers Try again, and warns before the page closes.

### Results and messages

| What happened | Result | Message |
| --- | --- | --- |
| Confirmed (`saved`, or `already_saved` with nothing newer) | `ok`, the new revision | |
| No reply, a network failure, a gateway or server error (5xx), a timeout | error | Couldn’t reach the server, so this change isn’t saved yet. Check your connection and try again. |
| Signed out or session expired (PT401, 401, 42501, PGRST301/302) | error | You’ve been signed out, so this change isn’t saved. Sign in again, then try again. |
| The database refused the request (PT422) | error | This change couldn’t be saved: *the database's reason* |
| A check or key refused the plan (SQLSTATE 22xxx, 23xxx) | error | …didn’t pass a safety check. Nothing was changed. |
| No workspace (PT404) | error | There’s no plan to save to. Reload and try again. |
| Changed elsewhere first (PT409) | conflict | Your data was changed somewhere else, such as another device. Reload to see the latest version. |
| This change was saved, but newer saves followed | conflict | Your change was saved, but your data has changed somewhere else since. Reload to see the latest version. |

Loading throws an Error with the same messages; the store shows its load-failure screen.

### Save intent in the app (`src/state/store.tsx`)

- **Ordinary changes** (`run`), including undo and batches, are always saved as `update`.
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
| Sign out | Firebase: forget the device copy (`forgetDevice`) | Nothing on the device but the session; sign-out arrives with Step 10d |
| Delete the account and its data | Firebase `deleteAccount` | Not built. Deleting the `auth.users` row cascades to the workspace and every row; it needs a server-side function or the Auth admin API (never a key in the browser) and re-authentication first. Step 10d |

### Retries in the adapter

- **One save id per logical save:** the same intent, base revision and plan. Try again after an unknown outcome reuses the id, so the database applies it at most once; any other save gets a new id.
- **Unknown outcome** (no reply, 5xx, timeout): the adapter remembers that save (id, base, intent, plan) in memory and reports it as not saved.
- **Try again, same save:** `already_saved` with nothing newer is success at that revision; with newer saves since, it's a conflict saying the change was saved and asking for a reload. The revision never goes backwards and the newer data isn't overwritten.
- **A different save after an unknown one** (the person kept editing): if it meets a conflict, the adapter re-sends the remembered save (same id) to ask whether it went through. If it did and nothing else followed, it saves the new edit on top of that revision; if newer saves followed, a "saved, but changed since" conflict; if it never arrived, a plain conflict. If that question gets no reply either, the save stays unknown and is reported as not saved.
- **A refused save** (PT422, a check) is definite: nothing was applied, and the next save gets a new id.

## Development (`src/state/supabase/dev.tsx`)

A build in the `supabase-dev` mode runs the app on a **local** Supabase stack:

```
VITE_SUPABASE_ANON_KEY=<anon or publishable key from supabase status> npm run dev:supabase
```

- `VITE_SUPABASE_URL` defaults to `http://127.0.0.1:54321`. Anything other than this machine is refused, and so is any key but the public anon or publishable key.
- **Identity:** a temporary anonymous Supabase identity (`signInAnonymously`; anonymous sign-ins must be on in the local stack's `supabase/config.toml`). The page says so: "Development storage: local Supabase, temporary anonymous identity. Not a real account; it can’t be recovered." Row-level security still limits the plan to that identity, and signed-out callers reach nothing.
- **On the device:** only the Supabase session (`financial-os:supabase-dev-auth`). The plan is never stored there.
- **Every other build is unchanged:** `import.meta.env.MODE` is fixed at build time, so the Supabase code is left out of the default build entirely. `npm run e2e:supabase` checks the built files contain no Supabase code and that the page never contacts it.

## Migration and rollback

- **Migration path (development data):** download a backup from the current app, then restore it into the Supabase-backed app (a `replace` save into the new, empty workspace). Run `checkForMigration` first.
- **Verified by the equivalence tests:** the stored plan equals the canonical original, and `buildForecast`, timing gaps, pay periods, the lowest running total, estimate suggestions, the review status and summary, and variances are identical today and 30, 90, 180 and 365 days ahead.
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
2. In a scratch folder, run `supabase init`, copy `supabase/migrations` into it, and run `supabase start` (only the database, auth, API gateway and PostgREST are needed: `-x studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta`).
3. Run `SUPABASE_TEST_ANON_KEY=<anon or publishable key from supabase status> npm run test:supabase`. `SUPABASE_TEST_URL` defaults to `http://127.0.0.1:54321`.

The script refuses any address other than this machine, and refuses a service-role or secret key: the tests use only what a browser has. Each test signs up its own throwaway users. To run the database tests against the same stack's PostgreSQL: `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres npx vitest run --config vitest.db.config.ts`.

Last run (October 2026): Supabase CLI 2.121.0, Supabase Postgres 17.11.0.004, GoTrue 2.197.0, PostgREST 16.4; both migrations applied unchanged by `supabase start`.

## Browser tests (`npm run e2e:supabase`)

`e2e/supabase.e2e.test.ts` drives built copies of the app in Chromium against a local stack (same requirements as `test:supabase`; `scripts/local-supabase.mjs` applies the same checks):

- **Setup and everyday use:** an empty workspace, setup (income, a bill, a one-time expense, a liability payment), a recorded payment, undo, a raise from a date, a moved occurrence, a review rhythm and a completed review, a restore, a dismissed estimate suggestion, and start over. After each one, Supabase holds exactly what's on screen, and a reload brings back the same plan, the same dashboard and identical forecasts. Every save is confirmed; all are `update` except one `replace` and one `reset`.
- **Conflicts and retries:**
  - two sessions of one identity: the second save gets a conflict and isn't shown as saved, the first is kept, the unsaved change can still be downloaded, and Reload shows the latest;
  - a reply lost after commit: shown as not saved, warns before leaving, Try again reuses the save id and applies once;
  - a lost save, then more edits: saved on top;
  - a lost save retried after a newer save: recognized, no regression, asks for a reload;
  - an expired session: shown as signed out, saved after signing in again;
  - a restore the database refuses: the saved plan stays;
  - a double-clicked restore: one save.
- **Isolation:** two anonymous identities can't reach each other's plans.
- **Migration:** a plan from the device-storage app, downloaded with its backup button, restored into an empty Supabase workspace. `checkForMigration` passes first, and everything arrives exactly: ids, original predictions, current expectations, actuals, schedule versions, pauses, estimate dismissals, review settings, onboarding, forecasts and timing gaps. The Supabase copy's backup then restores into device storage again (rollback).
- **The default build:** no Supabase code, no requests to it.

## Performance

Measured once, as a guide only (local PostgreSQL 16): a plan with 40 items and 1,440 recorded payments loads in about 57 ms and saves in about 200 ms, in one call each (a request of about 740 KB). No extra indexes or caching until real use shows a need. If plans grow large, saves can later send only what changed, through the same function.

## Not built (extension points)

| Feature | How it would be added |
| --- | --- |
| Virtual paycheck allocations and reserves | New tables keyed by `workspace_id`; recommendations with proposed / approved / dismissed status |
| Optional cash-on-hand snapshot | A dated snapshot table; with none, the forecast keeps its $0 start the day before payday |
| Real accounts | An `accounts` table and a nullable `account_id` on sources and records (null = today's single pool) |
| Transfers | A link table pairing a money-out record with a money-in record; savings stays money out unless the product owner decides otherwise |
| Shared households | A membership table; the read policies and the owner check in the functions change, rows don't |
| Partial payments | Several actuals per occurrence (a child table of `occurrence_records`) with completion rules in the engine; today an occurrence has one recorded outcome |

Savings stays money out, and the zero-start anchor is unchanged.
