# Financial OS — build and test roadmap

A dependency-ordered sequence of work and test gates for one evolving application. It is **not** a list of features allowed in particular release phases: alpha, beta, and release are testing phases with growing groups of people (Step 11), and evidence from them can add, simplify, change, or remove anything below.

Rules for using this roadmap are in [AGENTS.md](AGENTS.md). In short: read AGENTS.md first, work on one authorized task at a time, add tests with every change, report real results, and wait for the product owner before moving on.

Each step lists:
- **Inspect** — what to read and check first.
- **Build or correct** — what to add or fix, if the inspection shows it's needed.
- **Tests** — what must be covered.
- **Exit criteria** — what must be true before dependent steps start.

"Today" notes describe the code as of commit `957cdc2` (October 2026). Verify them; they will drift.

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

## Step 8: Improve onboarding, imports, and recovery

**Inspect**
- Guided setup (`Onboarding.tsx`), backup and restore (`backup.ts`), moving device data into an account (`DeviceDataOffer`), and sample data (`mode.tsx`).

**Build or correct**
- Safe manual entry first. Optionally, spreadsheet import and user-initiated statement parsing with a preview step: validation, duplicate detection, recurring suggestions, transfers, refunds, card payments, and ambiguous items flagged for review.
- Import batches can be cancelled before applying and undone after.
- A safe reset and rebuild, with a backup offered first.

**Tests**
- Invalid files are rejected with plain messages; nothing is applied without confirmation.
- Uncertain items are never created as confirmed records; missing dates are never invented.
- Duplicates within a file and against existing data are detected.
- Undoing an import removes exactly that batch.
- Backup, restore, reset, and rebuild round trips.

**Exit criteria**
- A person can get to a useful forecast quickly, and any import or reset can be reversed.

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

## Step 10: Validate persistence, offline behavior, security, and the PWA

**Inspect**
- `storage.ts`, `store.tsx`, `cloud.ts`, `firebase.ts`, `firestore.rules`, `server.mjs`, `vite.config.ts` (service worker), and [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md).

**Build or correct**
- Fix any gap found. Complete the console tasks in AI_STUDIO_TASKS.md (API-key restrictions, App Check, backups).

**Tests**
- Local and cloud saves, failed saves, conflicts (another device or tab), refused saves, and offline changes sent later.
- Backup and restore validation; sample-data isolation; schema migrations.
- Sign-in, sign-out with unsent changes, account deletion (confirm with Google first).
- Firestore rules against the emulator (`npm run test:rules`).
- Installability; the service worker never reloads mid-entry and never answers sign-in pages; offline start.
- On a real iPhone, installed from Safari: sign in, reopen, offline change, reconnect.

**Exit criteria**
- No known data-loss path; rules and security guarantees are tested; the installed app works on iPhone and Android.

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

## Open items

- **Cash before payday is unknown.** The running total starts at $0 the day before the next payday, so a shortfall caused by spending before that payday can't be shown. A product decision (for example, an optional "cash available now" amount); see FINANCIAL_ENGINE.md.
- **For the UI review** (calculations are consistent; how they are presented needs a look):
  - An early payment followed by a schedule change: both the payment and the new schedule's first payment count.
  - A schedule change whose start date falls after the next payment keeps that payment under the old schedule.
  - A canceled occurrence stays canceled while the new schedule's payment counts.
  - Deleting an item whose only saved change has been set aside is refused with a message about history that isn't visible.
- **Rare:** "twice a month" on two days that both fall on Feb 28 or 29 gives one February payment (deliberate, tested).
- **No CI.** Checks run only when an agent runs them.
- **Console setup** in [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md) is partly done: Cloud Run deploy with `server.mjs`, OAuth redirect URIs, API-key restrictions, App Check, and backups remain.

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
