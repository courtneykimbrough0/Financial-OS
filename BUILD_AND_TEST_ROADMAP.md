# Financial OS — build and test roadmap

A dependency-ordered sequence of work and test gates for one evolving application. It is **not** a list of features allowed in particular release phases: alpha, beta, and release are testing phases with growing groups of people (Step 11), and evidence from them can add, simplify, change, or remove anything below.

Rules for using this roadmap are in [AGENTS.md](AGENTS.md). In short: read AGENTS.md first, work on one authorized task at a time, add tests with every change, report real results, and wait for the product owner before moving on.

Each step lists:
- **Inspect** — what to read and check first.
- **Build or correct** — what to add or fix, if the inspection shows it's needed.
- **Tests** — what must be covered.
- **Exit criteria** — what must be true before dependent steps start.

"Today" notes describe the code as of commit `957cdc2` (October 2026). Verify them; they will drift.

## Current priority: product experience (October 2026)

**Product-owner decision.** Financial OS is in a product experience phase. Priorities, in order:

1. Financial correctness.
2. Clear and intuitive workflows.
3. Human, natural interface language.
4. A clean, useful dashboard.
5. Dedicated reports.
6. Better support for several kinds of income.
7. Mobile-first usability.

The specification is [PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md); the evidence is [docs/PRODUCT-AUDIT.md](docs/PRODUCT-AUDIT.md).

**Paused, as a sequencing decision, not abandonment:**
- hosted Supabase setup and testing;
- Firebase retirement;
- removal of offline synchronization (Step 10c);
- Vercel deployment (Step 10e);
- further infrastructure;
- Step 9 (allocations and transfers).

The completed Supabase, account and security work (Steps 10a–10d in development, and the hosted-test preparation) stays as it is, and resumes in Phase F. Nothing in it is undone or rebuilt.

**Two boundaries for every phase below:**
- **A visual or language change never changes a calculation.** Every screen reads the one forecast engine. A financial fix ships alone, with before-and-after tests.
- **Onboarding stays short.** Paycheck, main bills, forecast. Detailed income tracking is optional and arrives gradually.

### What the roadmap now distinguishes

| | Where it's recorded |
| --- | --- |
| Confirmed product requirements | PRODUCT_EXPERIENCE.md, items marked **Confirmed** |
| Existing implemented behavior | Steps 0–10 below and their Status entries; README; FINANCIAL_ENGINE.md |
| Known defects | docs/PRODUCT-AUDIT.md §2 (H1 is a financial defect); "Open items" below |
| Missing functionality | PRODUCT_EXPERIENCE.md, items marked **Missing**; docs/PRODUCT-AUDIT.md §7 |
| Proposed design changes | PRODUCT_EXPERIENCE.md, items marked **Proposed**, pending review |
| Deferred features | PRODUCT_EXPERIENCE.md §10; Step 8's deferred imports; Step 9 |

### Phases

Workstreams A–F, in the recommended order of work:

A1 → B1 → C1 → D1 → C2 → C3 → D2 → D3 → B2 → (decision D8) → E1 → E2 → E3 → E4 → E5 → E6 → F

Each phase is its own authorized task, small enough to verify on its own. A–C must not change any calculation except A1's. No phase mixes a visual redesign with new forecasting calculations.

#### A. Financial correctness

**A1. Forecast start follows the earliest eligible income.** Complexity: **medium**.
- **Scope.**
  - The running total starts the day before the earliest eligible upcoming income: the algorithm in docs/PRODUCT-AUDIT.md §6.3, with defaults D1 and D2.
  - Add `nextMainPayday` to `Forecast`.
  - Screens that say "next payday" use it. Screens that explain where the running total starts use `anchor` / `forecastStart`.
  - Preview and scenario "can't compare" wording updated to match.
- **Dependencies:** none. This is the first phase.
- **Likely files:**
  - `src/domain/forecast.ts`, `src/domain/types.ts` (comments only for `mainPaycheckId`);
  - `src/domain/preview.ts`, `src/domain/scenarios.ts` (messages);
  - `src/ui/screens/Dashboard.tsx`, `src/ui/screens/Onboarding.tsx`, `src/ui/components/WhatIfSheet.tsx`, `src/ui/components/EstimateSheet.tsx`, `src/ui/components/ScenarioSheet.tsx`;
  - `FINANCIAL_ENGINE.md`, `README.md`.
- **Acceptance:**
  - In the audit's reproduction (Oct 27 paycheck entered first, Oct 19 weekend job, Oct 22 rent), the running total starts Oct 19, Rent shows a $600 timing gap, and pay periods still start Oct 27.
  - Entry order never changes the start.
  - Single-income plans give identical results.
- **Tests:**
  - every regression test in docs/PRODUCT-AUDIT.md §6.6, written failing first against the current code;
  - existing tests that encoded the old start (`forecast.test.ts › anchors on the main paycheck…`) updated deliberately, each change explained in the commit;
  - an end-to-end step for the reproduction.
- **Excluded:**
  - any layout or visual change;
  - wording beyond what the new start makes wrong;
  - changing how the main paycheck is chosen (D3);
  - "cash available now" (D11).

**A2. Correctness follow-ups from the audit, if confirmed.** Complexity: **low**.
- **Scope:** fix only what a failing test shows to be wrong. Today, no other calculation defect is confirmed. H5 (one bill on three dates) is presentation and belongs to C1.
- **Dependencies:** A1.
- **Tests:** regression tests for anything found.
- **Excluded:** anything without a failing test.

#### B. Product language

**B1. Voice guide adopted, and the most-seen wording corrected.** Complexity: **low–medium**.
- **Scope:**
  - Adopt the voice and tone rules (PRODUCT_EXPERIENCE.md §2) in AGENTS.md section F.
  - Apply the term decisions and rows 1–35 of the wording table (docs/PRODUCT-AUDIT.md §4): Home, setup, the item sheet, the review list, Plan screens and forms.
  - No layout change.
  - Remove the one "debt" string and the "debt" fallback.
  - Fix the silent sample-data failure.
- **Dependencies:** A1, so wording about the running total's start is written once, against the new rule.
- **Likely files:**
  - `src/ui/screens/*.tsx`;
  - `src/ui/components/{OccurrenceSheet,ReviewSheet,PeriodReviewSheet,forms,common,plan,rhythm,WhatIfSheet}.tsx`;
  - `src/domain/operations.ts` (error messages);
  - `src/state/mode.tsx` callers;
  - `scripts/e2e-smoke.mjs` and the component tests that assert text.
- **Acceptance:**
  - Every changed string matches the voice guide.
  - No "debt", "transaction", "occurrence", "prediction" or "outstanding" remains in the default build's interface.
  - The same state uses the same word everywhere.
- **Tests:**
  - updated text assertions;
  - a test that scans rendered screens for the banned terms;
  - a test that sample-data failure shows a message.
- **Excluded:**
  - layout;
  - new features;
  - calculation changes;
  - the Supabase development screens (checked at the account cutover).

**B2. Remaining wording.** Complexity: **low**.
- **Scope:** rows 36–63 of the wording table: the gap, What if…, scenario and estimate sheets, save and conflict messages, operation errors, backups and Settings.
- **Dependencies:** C2, so text isn't rewritten for screens that move.
- **Tests:** as in B1.
- **Excluded:** as in B1.

#### C. Information architecture

**C1. Conditional visibility on today's screens.** Complexity: **low–medium**.
- **Scope:**
  - The rules in PRODUCT_EXPERIENCE.md §5, applied to the current dashboard, calendar, week list, day list, day sheet, setup review and Plan lists:
    - empty days aren't buttons;
    - empty runs fold;
    - empty weeks have no expand control;
    - zero columns are hidden;
    - the no-income dashboard becomes a single setup card;
    - negative running totals always stay visible.
  - H5: the overdue date on item cards.
- **Dependencies:** B1.
- **Likely files:**
  - new `src/ui/visibility.ts` (pure flags from `DayRow` / `WeekSummary`);
  - `Dashboard.tsx`, `Onboarding.tsx`, `SourcesScreen.tsx`;
  - `styles.css`.
- **Acceptance:** each row of the §5 table holds. An empty week with a negative running total stays visible and is announced.
- **Tests:**
  - unit tests for `visibility.ts`, including "negative but empty";
  - component tests for each component in the table;
  - accessibility checks (no `aria-expanded` or `aria-haspopup` on inert rows);
  - e2e: the empty dashboard.
- **Excluded:** moving content between screens; visual redesign; any change to engine output.

**C2. Navigation and Home.** Complexity: **high** (split into C2a shell and tabs, C2b Home, C2c Calendar tab, C2d Plan).
- **Scope:**
  - The Home / Calendar / Reports / Plan tabs.
  - Quick add.
  - Home per PRODUCT_EXPERIENCE.md §3.2: summary, attention line, Coming up with one-tap recording, period chip.
  - The Calendar tab, with grid and agenda.
  - Plan with item rows and detail sheets.
  - Settings reorder.
  - Every existing capability stays reachable.
- **Dependencies:** C1, D1.
- **Likely files:**
  - `src/ui/App.tsx`, `src/ui/router.ts` (new routes, with redirects from old hashes);
  - `src/ui/screens/*`;
  - new `Home.tsx`, `Calendar.tsx`, `Plan.tsx`;
  - `components/common.tsx`.
- **Acceptance:**
  - At 390 × 844, Home's summary and the first three Coming up items are above the fold.
  - Recording a due payment takes one tap from Home, with undo.
  - Every action available today is still available. Each one is checked off in the task report.
- **Tests:**
  - component tests per screen;
  - routing and redirect tests;
  - the e2e smoke test rewritten to the new navigation, covering every current flow;
  - keyboard and screen-reader paths.
- **Excluded:** new calculations; Reports (C3); new income data.

**C3. Reports, first release.** Complexity: **medium**.
- **Scope:**
  - Cash flow, Income and Payments reports (PRODUCT_EXPERIENCE.md §4.2).
  - Period filter, drill-down and empty states.
  - Pure aggregation in `src/domain/reports.ts`.
  - The history variant for past pay periods.
- **Dependencies:** C2.
- **Likely files:** new `src/domain/reports.ts`, `src/ui/screens/Reports.tsx`; `plan.tsx` (moved breakdowns).
- **Acceptance:**
  - Every figure equals the forecast's own totals for the same range.
  - Actuals, expected and overdue are always labeled apart.
  - Empty categories are hidden.
- **Tests:**
  - exact-cents domain tests that reconcile with `periodKpis` / `periodPlan` / `variance`;
  - component tests;
  - an e2e step.
- **Excluded:** the Earnings report (E5); charts beyond the two allowed in §7.2.

#### D. Visual redesign

**D1. Tokens and core components.** Complexity: **medium**.
- **Scope:**
  - Color roles: money out neutral, indigo as the accent only (D6).
  - Type scale, fewer card wrappers, section labels in sentence case.
  - New components: ListGroup, EntryRow (with ✓), AttentionLine, PeriodChip, SummaryCard, OverflowMenu, EmptyLine, Toast with Undo, and one toast at a time.
  - Applied to existing screens without moving content.
- **Dependencies:** C1.
- **Likely files:** `src/styles.css`, `src/ui/components/common.tsx`, `DESIGN.md`.
- **Acceptance:**
  - Contrast stays at WCAG AA.
  - Status still pairs color with an icon or word.
  - Targets are 44 px or larger.
  - The screenshot set is retaken.
- **Tests:**
  - component tests for new components;
  - existing tests pass unchanged except class-name assertions;
  - e2e screenshots compared by the product owner.
- **Excluded:** navigation changes; calculation changes; light theme (D7).

**D2. Screen-by-screen redesign.** Complexity: **high** (one screen per task).
- **Scope:** Home, Calendar, Plan, Reports, Settings, then onboarding in four steps (PRODUCT_EXPERIENCE.md §7.9), each to the wireframe specifications.
- **Dependencies:** C2, C3, D1.
- **Acceptance:** the wireframe's hierarchy holds at 390 px; the product owner approves screenshots for each screen.
- **Tests:**
  - component and e2e tests per screen;
  - for onboarding, the minimum path (one paycheck) still reaches a forecast in the fewest steps.
- **Excluded:** new data or calculations.

**D3. Desktop layouts.** Complexity: **medium**.
- **Scope:** the navigation rail, two-column Home and Reports, side panels instead of centered dialogs (PRODUCT_EXPERIENCE.md §7.6).
- **Dependencies:** D2.
- **Tests:** e2e at 1280 × 900 and 768 × 1024; focus management in side panels.
- **Excluded:** phone layout changes.

#### E. Income expansion

Starts only after decision D8 (how new fields are stored while Firebase is legacy). Each step adds persisted data, so each one updates validation, `migrate`, backups, the Supabase mapping and schema, and the database tests, with migration tests (AGENTS.md section C).

**E1. Income certainty and income types.** Complexity: **medium**.
- **Scope:**
  - `certainty` (expected / possible) and `incomeType` labels.
  - Possible income is displayed, never counted, and never starts the running total.
  - Setup offers "Other kinds of income (tips, freelance, gig)…" using the same baseline form.
- **Dependencies:** A1, C2, D8.
- **Tests:**
  - domain: possible income is never in totals or the running total, and one tap converts it to expected or received;
  - migration: existing income reads as expected;
  - setup still works with one paycheck.
- **Excluded:** shifts, jobs, sessions.

**E2. Tipped and hourly shifts.** Complexity: **high**.
- **Scope:**
  - Optional per-source tracking: shifts with hours, wage, cash tips and card tips.
  - Cash tips become one received income entry.
  - Card tips and wages count as earned and are linked to the paycheck that pays them.
  - Optional paycheck estimate as a suggestion (D9).
- **Dependencies:** E1.
- **Tests:**
  - no double counting: cash tips counted once on the shift date; card tips never counted apart from the paycheck; a paycheck that already includes the tips is never increased;
  - effective hourly earnings in exact cents;
  - undo.
- **Excluded:** reminders; freelance; gig.

**E3. Freelance jobs.** Complexity: **medium**.
- **Scope:**
  - Clients and jobs: Planned / Done / Paid.
  - An expected payment date makes a job an expected income event; without one it is possible (D10).
  - Earned-not-paid is shown outside cash flow.
- **Dependencies:** E1.
- **Tests:** counting rules; recording a payment keeps the original expectation.
- **Excluded:** partial payments; invoices.

**E4. Gig sessions and payouts.** Complexity: **medium**.
- **Scope:**
  - Sessions, cash received immediately, and earnings waiting for payout.
  - A payout is the only event that counts, linked to its sessions.
- **Dependencies:** E1.
- **Tests:** no double counting between sessions and payouts; cash received counts once.
- **Excluded:** platform integrations.

**E5. Earnings report.** Complexity: **medium**.
- **Scope:** PRODUCT_EXPERIENCE.md §4.3.
- **Dependencies:** C3 and E2–E4 (each part appears when its data exists).
- **Tests:**
  - exact-cents aggregation;
  - earned never added to cash flow;
  - the tab is hidden without data.

**E6. In-app reminders.** Complexity: **low–medium**.
- **Scope:** optional Home attention items: log last night's shift, weekly entry, confirm a freelance payment, confirm a payout. Off by default; skipping never piles up.
- **Dependencies:** E2–E4, C2.
- **Tests:** timing across days and weeks; quiet by default.
- **Excluded:** push notifications (Deferred).

#### F. Infrastructure resumption

Resumes after the product owner judges the product work ready. The order is unchanged from the October 2026 development order below:

1. hosted Supabase test project and runs ([docs/SUPABASE-HOSTED.md](docs/SUPABASE-HOSTED.md));
2. moving real data and cutting over from Firebase (10b/10d);
3. removing offline synchronization (10c);
4. Vercel deployment and real-device testing (10e).

Complexity: **high**, split as in Step 10. Persisted fields added in Phase E are included in the cutover's migration and tests.

---

## Development order (October 2026; resumes as Phase F)

The product owner's architecture decisions are in [AGENTS.md](AGENTS.md) section C1: Supabase (PostgreSQL, and later authentication) for data, Vercel for hosting, an online-first PWA with no offline synchronization, and authentication deferred. Firebase/Firestore, Cloud Run hosting and offline synchronization are legacy, kept running until the migration removes them. Work in this order:

1. Finish the core financial features: Steps 6–9 (Step 8 is manual-first; imports are deferred).
2. Finalize and verify the data architecture: Step 10a.
3. Move persistence to Supabase: Step 10b.
4. Remove offline synchronization: Step 10c.
5. Complete authentication and per-user data isolation: Step 10d.
6. Deploy and test the finished application on Vercel: Step 10e.

Then validate with real users (Step 11) and keep release readiness (Step 12).

Since the product experience decision above, this order is paused after the hosted-test preparation and resumes as Phase F. Steps 6–8 are complete; Step 9 is paused.

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

Paused (October 2026) by the product experience decision. Only if the product owner authorizes implementation.

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
- **Step 10b-3: development integration verified; production unchanged.** Restore and start over are sent as `replace` and `reset` through `replacePlan`; with online-first storage they show only once confirmed, and Try again resends the same save. Ordinary changes stay `update`. The Supabase adapter's `clear()` rejects. `npm run dev:supabase` runs the app on a local stack as a temporary anonymous identity; other builds leave Supabase out. Tests: `supabase-intent`, `dev`, and `npm run e2e:supabase` (workflows with reloads, conflicts and retries, isolation, migration and rollback through backups, the default build). See docs/SUPABASE.md.
  - Follow-ups before replacing Firebase:
    - Supabase sign-in, sign-out and account deletion (10d): built in development, see below;
    - a hosted test project and its configuration (10e);
    - moving real Firestore data (backups only so far);
    - removing offline sync (10c);
    - a conflicted change can be downloaded but not merged.
- **Step 10d (development): recoverable accounts on the local stack; production unchanged.** Email-and-password accounts (Supabase Auth) in the supabase-dev build: sign-up with email confirmation, sign-in, password recovery, persistent and refreshed sessions, sign-out, and account deletion through `delete_account()` after a fresh password check. A session that ends with unsaved changes asks to sign in again. Earlier anonymous identities convert to accounts with the same identity. `supabase/config.toml` runs the local stack from the repository. Tests: `account.db`, `auth.supabase`, `session`, and the account tests in `npm run e2e:supabase`. See docs/SUPABASE.md.
  - Follow-ups:
    - a hosted test project: SMTP, redirect URLs, rate limits, anonymous sign-ins off (prepared: docs/SUPABASE-HOSTED.md);
    - changing the email or password while signed in;
    - set-aside changes from a tab whose account was switched live only in that page (see docs/SUPABASE.md);
    - signing out other devices;
    - the production sign-in cutover from Firebase;
    - removing offline sync (10c).
- **Step 10d (development), account safety:** requests are bound to their account, so another tab switching accounts can't send one account's changes under another's session (reproduced, then fixed). Unconfirmed changes are set aside for their own account, unlocked with its password, and saved only on top of the revision they came from, or downloaded. A deletion whose reply was lost is checked with the auth server before it is reported. Deletion authorization was audited against the real stack with no weakness found. Tests: `owner-guard`, the audit tests in `auth.supabase`, and the two-tab and deletion tests in `npm run e2e:supabase`.
- **Hosted test preparation: ready, not run.** An approved hosted test project can be selected deliberately, through an allowlist (empty until approved), an exact address, the `supabase-hosted-test` build mode, `SUPABASE_TEST_TARGET=hosted`, a destructive-test confirmation and an in-database marker. The suites run against it unchanged; email- and anonymous-dependent tests skip when the target can't support them, and test accounts are cleaned up. Setup steps, migrations and verification SQL: docs/SUPABASE-HOSTED.md. Tests: `target`.
- **Product experience audit: complete (documentation only, October 2026).** [PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md) (decisions and specifications), [docs/PRODUCT-AUDIT.md](docs/PRODUCT-AUDIT.md) (findings ranked by severity, the forecast-start analysis, the wording table) and [docs/COPY-INVENTORY.md](docs/COPY-INVENTORY.md) (every interface string). No application code changed. Next: Phase A1, once authorized.

## Open items

- **Defect (financial correctness): the running total can start too late.** It starts at the next payday of the main paycheck (the marked one, or the first income entered), so income from another source before that day is left out and a real timing gap can stay hidden. Decided fix and tests: docs/PRODUCT-AUDIT.md §6; Phase A1.
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
