# Financial OS — build and test roadmap

A dependency-ordered sequence of work and test gates for one evolving application. It is **not** a list of features allowed in particular release phases: alpha, beta, and release are testing phases with growing groups of people (Step 11), and evidence from them can add, simplify, change, or remove anything below.

Rules for using this roadmap are in [AGENTS.md](AGENTS.md). In short: read AGENTS.md first, work on one authorized task at a time, add tests with every change, report real results, and wait for the product owner before moving on.

Each step lists:
- **Inspect** — what to read and check first.
- **Build or correct** — what to add or fix, if the inspection shows it's needed.
- **Tests** — what must be covered.
- **Exit criteria** — what must be true before dependent steps start.

"Today" notes describe the code as of commit `957cdc2` (October 2026). Verify them; they will drift.

## Development order (October 2026)

The product owner's architecture decisions are in [AGENTS.md](AGENTS.md) section C1: Supabase (PostgreSQL, and later authentication) for data, Vercel for hosting, an online-first PWA with no offline synchronization, and authentication deferred. Firebase/Firestore, Cloud Run hosting and offline synchronization are legacy, kept running until the migration removes them. Work in this order:

1. Finish the core financial features: Steps 6–9 (Step 8 is manual-first; imports are deferred).
2. Finalize and verify the data architecture: Step 10a.
3. Move persistence to Supabase: Step 10b.
4. Remove offline synchronization: Step 10c.
5. Complete authentication and per-user data isolation: Step 10d.
6. Deploy and test the finished application on Vercel: Step 10e.

Then validate with real users (Step 11) and keep release readiness (Step 12).

---

## Step 0: Establish a trustworthy baseline

**Inspect**
- Git state: current branch (`ccr-12ec4965-6tzwgr`), uncommitted work, and whether work done elsewhere (AI Studio) has been pushed.
- `package.json` scripts, `package-lock.json` integrity fields, existing tests (`src/**/__tests__/`, `scripts/__tests__/`, `scripts/e2e-smoke.mjs`) and what they cover, test configuration (`vite.config.ts`, `vitest.rules.config.ts`, `src/test-setup.ts`), and CI (none exists today).
- Architecture against [AGENTS.md](AGENTS.md) section C and [README.md](README.md); storage (`src/state/`), security (`firestore.rules`, `security_spec.md`), hosting (`server.mjs`, `Dockerfile`), and documentation.

**Build or correct**
- Nothing in application code. Record findings only.
- Record known gaps as open items (see "Open items at the time of writing" below).

**Tests**
- Run every command in AGENTS.md section H and record exact results, including failures and commands that couldn't run.

**Exit criteria**
- A written baseline: commit hash, each command's result, existing failures, and open items, agreed with the product owner.
- Work done outside GitHub has been pushed or explicitly set aside, so later steps build on one known version.

## Step 1: Validate the financial core

**Inspect**
- `dates.ts`, `money.ts`, `recurrence.ts`, `occurrences.ts`, `forecast.ts`, `operations.ts`, `plan.ts`, and their tests in `src/domain/__tests__/`.

**Build or correct**
- A written **financial test matrix** (rows: behaviors below; columns: test file and test name). Fill gaps with tests; fix any defect found, each with a regression test.

**Tests**
- Integer-cent arithmetic and parsing; no floating-point drift across long horizons.
- Deterministic results for fixed inputs; identical results across host time zones.
- Recurrence: weekly, every 2 weeks, twice monthly, monthly (month-end clamping, leap years), custom intervals, year boundaries.
- Same-day events (ordering and totals), running totals through zero and below zero.
- Main-paycheck anchor and pay periods (including back-to-back paydays and five paydays in one week).
- Timing gaps (start, end, length, lowest amount) and the 90-day lookahead.
- Duplicate prevention between generated occurrences and stored records; adjacent date windows never duplicate or skip.

**Exit criteria**
- Every matrix row has at least one passing test with exact expected values in cents.
- No known defect in the core is open.

## Step 2: Protect prediction and actual history

**Inspect**
- `OccurrenceRecord` (`expected*`, `scheduled*`, `actual*`, `status`), schedule versions, and the operations that change them.

**Build or correct**
- A shared **variance** calculation in the domain layer (actual vs. expected, date and amount), if the UI needs one. Today the UI shows "Expected $X on <date>" but no domain function computes variance.
- Fixes for any path that rewrites history.

**Tests**
- Original expected date and amount never change after creation, through reschedule, correction, cancel, restore, and forecast rebuilds.
- Rescheduling counts the item on the new date only; recording an actual counts it on the actual date only.
- Recurring schedule edits apply from their effective date; earlier occurrences keep their expectations.
- Undo restores exactly the prior state of that one record.
- Variance values for early, late, larger, and smaller actuals.
- If any persisted type changes: migration tests for old documents, backups, on-device copies, and Firestore rules (AGENTS.md section C).

**Exit criteria**
- History preservation is covered end to end, from domain to storage to backup round trip.

## Step 3: Simplify everyday review

**Inspect**
- `OccurrenceSheet.tsx`, the overdue banner and list on the Dashboard, `SourcesScreen.tsx`, and save-status handling in `store.tsx`. Today, records are confirmed one at a time; undo exists per record ("Undo: not paid yet", "Restore"); there's no batch confirmation.

**Build or correct**
- Batch confirmation and batch editing of selected items, exception-focused review (what's overdue or changed first), clear recurring-edit scope ("just this one" vs. "this and later"), and batch undo.

**Tests**
- Only the selected items change; unselected items, including ones on the same day, are untouched.
- A batch can be undone as a unit, restoring every affected record exactly.
- Nothing is marked actual just because it was expected.
- A failed save during a batch keeps every change on screen and retries them together.
- Component tests for the review flow; an end-to-end test confirming several items and undoing them.

**Exit criteria**
- A person can clear a week of expected items in a few taps, and reverse it safely.

## Step 4: Make forecasting proactive and explainable

**Inspect**
- `timingGapsAhead`, `negativeStretches`, `lowestPoint`, the timing-gap banner (`gaps.tsx`), and the dashboard hero.

**Build or correct**
- For each future shortfall, including ones several weeks out: the events that cause it, their amounts and dates, and possible actions (move a date, change an amount, skip one occurrence).
- Previewing an action recalculates the outlook through the shared engine.

**Tests**
- Shortfalls detected 1, 4, and 8+ weeks ahead, with the correct contributing events.
- A proposed change that fixes one shortfall but creates an earlier or later one is shown as such.
- Explanations use the same numbers as the forecast (no separate math in components).

**Exit criteria**
- Every warning can be traced to its causes, and every suggested action's effect is visible before it's applied.

## Step 5: Establish a configurable review cadence

**Inspect**
- Existing settings (Settings screen), stored preferences (none today), and how "today" is determined (`useToday` in `store.tsx`).

**Build or correct**
- A review cadence the person chooses: weekly, on payday, and a monthly look ahead, with a short summary of what needs attention. No reminders by default beyond what they choose.

**Tests**
- Settings persist and migrate safely.
- Review due dates across week, month, and year boundaries, and around time-zone and daylight-saving changes.
- Completing a review clears it until the next one; skipping doesn't pile up repeats.
- Never claim a notification was delivered unless delivery exists and was verified (the app has no push notifications today).

**Exit criteria**
- Review timing is correct and quiet by default.

## Step 6: Improve estimates and recurring insights

**Inspect**
- Recorded actuals per recurring source (`resolveOccurrences`, `sourceOccurrences` on the Income and Expenses screens).

**Build or correct**
- Suggestions from history, for example comparing an upcoming electricity estimate with the last eight months of actual bills. Show the historical average and, separately, any buffered planning estimate, with the rule behind it.
- Suggestions apply only when the person approves them.

**Tests**
- Too little history: no suggestion, or a clearly marked low-confidence one.
- Outliers, seasonal patterns, and a known rate change.
- Rejecting a suggestion keeps the person's value and doesn't re-suggest it immediately.
- Approving a suggestion creates a schedule change from an effective date and keeps past expectations.

**Exit criteria**
- Suggestions are explainable, optional, and never change values on their own.

## Step 7: Build scenario modeling

**Inspect**
- `buildForecast` inputs and whether scenarios can be represented as data changes applied to a copy.

**Build or correct**
- Scenarios computed by applying changes to a copy of the data and running the same `buildForecast`: extra liability payments, savings goals, one-time expenses, moved payment dates, and variable income.
- A comparison view: baseline vs. scenario across the whole timeline, with the assumptions listed.

**Tests**
- A scenario never alters the baseline or stored data.
- Scenario totals equal the baseline engine's results for the same inputs.
- Intermediate timing gaps are detected even when the ending result improves.
- Variable-income ranges (low, expected, high).

**Exit criteria**
- Scenarios use one engine, leave the baseline untouched, and surface every shortfall along the way.

## Step 8: Manual-first onboarding and recovery

Revised (October 2026): the priority is a fast first forecast and safe recovery, not imports.

**Inspect**
- Guided setup (`Onboarding.tsx`), the item forms (`forms.tsx`), backup and restore (`backup.ts`, `components/backup.tsx`), and sample data (`mode.tsx`).

**Build or correct**
- The shortest path to a useful forecast: the main income is enough; bills and debt payments next; subscriptions, savings and other details can wait. No exhaustive profile, history, balances or categories are required, and nothing missing is invented.
- Say clearly that payments before the next payday aren't in the running total.
- Restore shows what will be replaced and offers a backup of the current data first; a refused or canceled restore changes nothing.
- A safe start-over: explicit confirmation, a backup offered first.

**Deferred** (not planned until the product owner asks): spreadsheet import, statement or PDF parsing, automatic categorization, recurring-rule discovery from imported history, and import batches. No bank connections or Plaid, ever (AGENTS.md section E).

**Tests**
- Minimum setup to a forecast with exact running totals; skipped optional steps; corrections; main paycheck choice; timing gaps.
- Backup round trips that reproduce the forecast, including review rhythm and estimate dismissals; damaged files; cancel; replacement with a copy offered; start over and recovery.

**Exit criteria**
- A person can reach a useful forecast with only their income (and ideally main bills), add the rest later, and recover from any replacement or reset with a backup.

## Step 9: Evaluate optional allocations and purpose-based accounts

Only if the product owner authorizes implementation.

**Inspect**
- How savings and transfers are modeled. Today, savings deposits count as expenses in cash flow (a product-owner decision recorded in README and AGENTS.md section D), and transfers between a person's own accounts aren't modeled.

**Build or correct**
- A separation between external cash flow and internal allocations (money set aside for a purpose), without requiring a real account per category and without fixed percentages.
- Decide with the product owner whether savings moves from "expense" to "allocation", and migrate existing data if so.

**Tests**
- Reserved funds, money available to spend, obligations due before the next paycheck, insufficient income, user overrides.
- Transfers between a person's own accounts never count as new income or spending in consolidated totals.
- Existing data keeps the same cash-flow results unless the person opts into the new model.

**Exit criteria**
- Allocations are optional, explainable, and never double counted.

## Step 10: Data architecture, Supabase, and deployment

Replaces the earlier plan to validate Firebase persistence and offline behavior. Each stage is its own authorized task, in order.

### 10a. Finalize and verify the data architecture

**Inspect**
- `types.ts`, `storage.ts` (`StorageAdapter`, `migrate`), `store.tsx`, `backup.ts`, and every persisted field, including ones added by Steps 6–9.

**Build or correct**
- A relational schema for sources, schedule versions, occurrence records and settings, with ownership on every row, and a mapping from today's JSON document. No code moves yet.

**Exit criteria**
- The product owner approves the schema, the migration path for existing data, and how a refused or failed save is reported.

### 10b. Move persistence to Supabase

**Build or correct**
- A Supabase `StorageAdapter`. The forecast engine and screens stay unchanged. Existing data (device copies, backups and Firestore documents) moves over safely.

**Tests**
- Saves, failed saves, refused saves and conflicts (another device or tab). The app never reports a save the backend didn't accept.
- Data migration from each current source, with nothing lost or doubled.

### 10c. Remove offline synchronization

**Build or correct**
- Remove the on-device copy, pending changes and set-aside recovery (`cloud.ts`), keeping in-memory editing, immediate forecasts, retry of a failed save, and clear unsaved-change messages.
- Keep PWA installation and caching of the app's own files.

**Tests**
- Unsaved and failed-save states are always visible; the service worker never reloads mid-entry.

### 10d. Authentication and data isolation

**Build or correct**
- Supabase sign-in, and row-level security so each person reaches only their own records. Remove Firebase sign-in, `firebase.ts`, `firestore.rules` and the Firestore tests once nothing depends on them.

**Tests**
- Access controls against a real Supabase instance (local or test project), including denied access to other people's data and signed-out access.
- Sign-in, sign-out, and account deletion.

### 10e. Deploy on Vercel

**Build or correct**
- Vercel hosting, replacing Cloud Run (`server.mjs`, `Dockerfile`) once nothing depends on them.

**Tests**
- Installability; on a real iPhone, installed from Safari: sign in, reopen, make a change, and see it saved.

**Exit criteria (Step 10)**
- No known data-loss path; access controls are tested against Supabase; the installed app works on iPhone and Android.

## Step 11: Validate with real users

**Inspect**
- What the app can measure without collecting financial details, and the privacy policy.

**Build or correct**
- Lightweight, privacy-respecting feedback: onboarding completion, time to first useful forecast, warnings understood, review effort, correction and undo success, feature use, points of confusion, trust, and willingness to keep using it.
- Grow testing groups in stages; adjust the roadmap based on what people actually do.

**Tests**
- Any measurement never records amounts, descriptions, or personal identifiers.

**Exit criteria**
- Findings are written down and turned into roadmap changes the product owner approves.

## Step 12: Maintain release readiness and regression coverage

**Inspect**
- Test coverage against Steps 1–10, open defects, and documented limitations.

**Build or correct**
- Regression tests for every bug found.
- Keep measuring the experience (Step 11) and remove steps people don't need.

**Tests**
- The full suite in AGENTS.md section H on every change.

**Exit criteria** (for each wider release)
- Core financial tests, end-to-end tests, safe recovery, and verified persistence all pass.
- Limitations are documented.
- No open high-severity data-loss, double-counting, privacy, or security defect.

---

## Status

- **Step 0: complete with follow-ups** (October 2026). Baseline: commit `5fc80fb`, all six checks in AGENTS.md section H passing. The GitHub branch is the working baseline; AI Studio changes that never reached GitHub are set aside, to be handled only if a concrete defect points to them. A defect found during the baseline (unpaid moved occurrences still counted after a schedule change or turning an item off, which could also set the wrong payday) is fixed, with tests in `saved-changes.test.ts`.
- **Step 1: complete with follow-ups.** Calculation path and test matrix: [FINANCIAL_ENGINE.md](FINANCIAL_ENGINE.md). Validation tests: `engine-validation.test.ts`. No further engine defects found.
- **Step 2: complete.** The prediction, latest expectation and actual were already kept apart. Fixed: undoing a payment or cancellation left a stored copy that kept the old amount, so a later price change didn't apply to that occurrence. Added `variance` (`occurrences.ts`). Tests: `history.test.ts`, `state/__tests__/history-roundtrip.test.ts`.
- **Step 3: complete.** A review list (overdue and due today first, then the rest of the week) with selection, **Mark done** as expected and **Move to a date** for several items at once, and **Undo** that reverses the whole batch exactly (`recordAsExpected`, `rescheduleSelected`, `undoBatch`, `reviewEntries`). The item sheet names the scope: “Change just this one” or “Change this and later ones”. Tests: `review.test.ts`, `ui/__tests__/review-sheet.test.tsx`, and a review step in the end-to-end test.
- **Step 4: complete with follow-ups.** Dashboard warning → explanation of each timing gap (`explainTimingGaps`, `gaps.tsx`) → What if… for one outstanding item: move, change amount, or skip (`previewChange`, `WhatIfSheet.tsx`) → confirmation → the change applied to that one occurrence (`applyPreviewedChange`). Previews never save; Apply needs confirmation, is refused for stale previews and for previews that can't be compared (the next payday moves, or a payment moves to before it), and states it changes only the forecast. Skipping a liability payment says the debt and what is owed don't change. Previews cover the period being viewed, never less than 90 days. Tests: `gap-explanations`, `preview`, `gaps-sheet`, `whatif-sheet`, and an end-to-end step.
  - Follow-ups: one change at a time (no combined scenarios); the app doesn't suggest which change to try; the setup review's gap banner explains gaps but has no What if…; shortfalls before the next payday stay outside the running total (cash on hand is unknown).
- **Step 5: complete for device storage.** Signed-in (Firebase) accounts keep it off; see below. Review rhythm in Settings (off, weekly, on payday, monthly look-ahead), a quiet dashboard entry when a review is due, and a review sheet from `reviewSummary` with Mark review done and Skip (neither records payments; closing leaves it due; a different rhythm starts fresh). Nothing is sent outside the app. Tests: `cadence`, `review-persistence`, `period-review`, rules tests, and an end-to-end step.
  - Accounts: the updated `firestore.rules` (optional `review` field) aren't confirmed deployed, so `REVIEW_RHYTHM_IN_ACCOUNTS` (`src/state/features.ts`) keeps the rhythm hidden when signed in and out of account saves, so no save is refused. With Firebase now legacy, the rules won't be deployed and the flag stays false; signed-in review rhythms arrive with the Supabase migration (Step 10b).
- **Step 6: complete with follow-ups.** Interface: a suggestion line on the item's card (bills, subscriptions, liability payments) opens a sheet with the amounts, start date, method, explanation, limitations, the payments behind it, a forecast preview (`previewEstimate`), and Approve (with confirmation) / Dismiss / Not now. Tests: `ui/estimate-sheet`, an end-to-end step. Foundation: `estimates.ts` compares each recurring bill, subscription and liability payment's recorded payments with its estimate (steady, rising, falling, variable and seasonal rules, unusual payments left out, at least 3 payments, at least $5 and 5% difference) and returns explained suggestions with their payments, confidence and limitations. `approveEstimate` applies one through the schedule operations from the first payment that keeps the schedule's dates; `dismissEstimate` keeps the estimate and holds the suggestion back (`estimateDismissal` on the item). Income and savings aren't estimated; what income history could support is recorded in FINANCIAL_ENGINE.md. Tests: `estimates`, `state/estimate-persistence`.
  - Follow-ups: suggestions appear only on the item's card (no list across items, by design); the separate buffered planning estimate this step describes isn't built (suggestions only round up to a dollar); variable income.
- **Step 7: complete with follow-ups.** Interface: **Explore a scenario** on the dashboard opens a sheet to add, edit and remove several changes (from existing payments where possible), compare the scenario with the forecast, see the first new or deeper shortfall even when the ending improves, and compare low, expected and high income. Nothing is saved; there's no way to apply a scenario. Tests: `ui/scenario-sheet`, an end-to-end step. Foundation: `evaluateScenario` applies several changes (one-time income and expenses, extra and higher liability payments, savings, moved dates, changed amounts, hypothetical recurring income) to a copy with the ordinary operations and compares it with the plan through `buildForecast`: assumptions, cash flow with hypothetical income separate, lowest and ending running totals, gaps with recovery dates, differences, and new or deeper shortfalls even when the ending improves. Changed paydays and moves before payday aren't compared. `evaluateIncomeCases` gives low, expected and high cases from amounts the person supplies. Tests: `scenarios`.
  - Follow-ups: applying a scenario to the plan; saving scenarios; scenarios can't change an item's schedule (only its amount from a date), turn an item off, or change a recurring item that already has a later change set; one-time liability items exist only inside scenarios.
- **Step 8: complete (revised to manual-first).** Setup now says which steps are optional, offers **Skip to review** once there's income, and the review says when payments fall before the running total starts. Restore shows how many items will be replaced and offers a backup of the current data first. **Start over** (Settings) erases everything after confirmation, keeps the review rhythm, and offers a backup first (`startOver`). Fixed: the review's section labels used ids with spaces, so "Liability payments" had no accessible name. Imports are deferred. Tests: `onboarding`, `backup-restore`, `start-over`, `state/backup`, an end-to-end step.
  - Follow-ups: a one-time item still has to be removed and added again to change it during setup; setup has no undo for a removed item.
- **Step 10a: design approved.** Five financial tables with workspace ownership, the app's own ids, whole-plan saves through one function, row-level security.
- **Step 10b-1: database foundation complete; not connected.** `supabase/migrations` (tables, checks, row-level security, `create_workspace`, `load_plan`, `save_plan` with update / replace / reset modes, revision checks and save receipts for retries), `src/state/supabase/rows.ts` (mapping and pre-migration check). Tests: `rows`, and `npm run test:db` against a local PostgreSQL (equivalence, persistence, integrity, security). See docs/SUPABASE.md.
  - Since run against a local Supabase stack too (Postgres 17.11): the database tests pass on its PostgreSQL without the shim.
- **Step 10b-2: storage adapter built; not connected.** `src/state/supabase/adapter.ts` implements `StorageAdapter` online-first (nothing on the device, no queue), with a save id per logical save, safe retries after a lost reply, and a check whether an earlier unconfirmed save went through before reporting a conflict. `StorageAdapter.save` takes an optional intent (`update`, `replace`, `reset`); the existing adapters ignore it. Tests: `adapter` (fake client, with the store), and `npm run test:supabase` through a local stack's Auth and API. See docs/SUPABASE.md.
  - Follow-ups before switching: the store passes `replace` for a restore and `reset` for start over; a signed-in supabase-js client (public key only) and a development-only way to choose this adapter; migration of existing data; then Steps 10c and 10d.

## Open items

- **Cash before payday is unknown.** The running total starts at $0 the day before the next payday, so a shortfall caused by spending before that payday can't be shown. A product decision (for example, an optional "cash available now" amount); see FINANCIAL_ENGINE.md.
- **For the UI review** (calculations are consistent; how they are presented needs a look):
  - An early payment followed by a schedule change: both the payment and the new schedule's first payment count.
  - A schedule change whose start date falls after the next payment keeps that payment under the old schedule.
  - A canceled occurrence stays canceled while the new schedule's payment counts.
  - Deleting an item whose only saved change has been set aside is refused with a message about history that isn't visible.
- **Rare:** "twice a month" on two days that both fall on Feb 28 or 29 gives one February payment (deliberate, tested).
- **No CI.** Checks run only when an agent runs them.
- **Console setup** in [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md) is partly done. It covers legacy Firebase and Cloud Run infrastructure and is no longer a development priority; only steps needed to keep the current version running apply.

---

## Roadmap governance

- Agents never execute the whole roadmap in one run. Each step is split into manageable tasks; each task is implemented, verified, and reported on its own.
- The product owner authorizes the next task after reviewing the previous task's results.
- A step's exit criteria must be met before dependent steps start, unless the product owner explicitly decides otherwise and the decision is written down here.
- When evidence changes priorities, update this file in the same change that acts on it.

### Task template

Every task request (and every agent's restatement of it before starting) specifies:

1. **Authorized roadmap step:** e.g. "Step 3 — batch confirmation of overdue items."
2. **Intended behavior:** what a person will be able to do, and what must stay the same.
3. **Relevant files to inspect:** starting points in the code and docs.
4. **Tests and exit criteria:** which tests to add or update, and what must pass.
5. **Explicit non-goals:** what this task must not change.

The agent ends with the completion report in [AGENTS.md](AGENTS.md) section I.
