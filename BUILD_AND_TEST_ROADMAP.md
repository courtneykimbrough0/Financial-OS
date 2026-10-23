# Financial OS — build and test roadmap

A dependency-ordered sequence of work and test gates for one evolving application. It is **not** a list of features allowed in particular release phases: alpha, beta, and release are testing phases with growing groups of people (Step 11), and evidence from them can add, simplify, change, or remove anything below.

Rules for using this roadmap are in [AGENTS.md](AGENTS.md). In short: read AGENTS.md first, work on one authorized task at a time, add tests with every change, report real results, and wait for the product owner before moving on.

Each step lists:
- **Inspect** — what to read and check first.
- **Build or correct** — what to add or fix, if the inspection shows it's needed.
- **Tests** — what must be covered.
- **Exit criteria** — what must be true before dependent steps start.

"Today" notes inside the steps describe the code as of commit `957cdc2` (October 2026) and are kept as written; they drift. **Current state** below and the Status section are the up-to-date record.

## Current priority: product experience (October 2026)

**Product-owner decision.** Financial OS is in a product experience phase. Priorities, in order:

1. Financial correctness.
2. Clear and intuitive workflows.
3. Human, natural interface language.
4. A clean, useful dashboard.
5. Dedicated reports.
6. Better support for several kinds of income.
7. Mobile-first usability.

The mission and philosophy are in [AGENTS.md](AGENTS.md) section A; the specification is [PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md); the evidence is [docs/PRODUCT-AUDIT.md](docs/PRODUCT-AUDIT.md) and [docs/REDUCTION-AUDIT.md](docs/REDUCTION-AUDIT.md).

**Paused, as a sequencing decision, not abandonment:**
- hosted Supabase setup and testing;
- Firebase retirement;
- removal of offline synchronization (Step 10c);
- Vercel deployment (Step 10e);
- further infrastructure;
- Step 9 (virtual allocations; reserves and transfers are built, accounts phases AC3–AC5).

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
| Audit recommendations (not yet approved) | docs/REDUCTION-AUDIT.md §3 and decisions §7 |
| Deferred features | PRODUCT_EXPERIENCE.md §10; Step 8's deferred imports; Step 9 |

### Current state (verified October 22, 2026; `main` at `3de2938`)

`main` is the default and integration branch (AGENTS.md section H). CI (`.github/workflows/ci.yml`, five jobs) passed on all merge commits below.

| Work | Status | Where |
| --- | --- | --- |
| PR #4, account distribution and cash-flow architecture | **Complete**, merged as `3fac4ac` | AC1–AC4, AC5 in part, CI, seven integration fixes |
| PR #5, Home (H1 selector, H2 opening screen) | **Complete**, merged as `fe8b13d` | H1, H2; R2 and C1 done through them |
| PR #11, C3 Activity view and navigation (H3, H4, A2, R1, C3) | **Complete**, merged as `abc57d6` | H3, H4, A1, A2, R1, C2, C3 |
| H4, interface simplification | **Complete** | Conditional visibility, language, contextual nav, density |
| A1, where the running total starts | **Complete** | Status |
| A2, defects D3 and D5 | **Complete** (with H3's pull request; D4 no longer applies) | Phase A2 |
| R1, remove the primary-paycheck concept and Paycheck view | **Complete** | Phase R1 |
| R2, remove review states, rhythm and batch Undo | **Complete** (in H2) | Phase R2 |
| C1, the week view | **Complete** (as Home, H2) | Phase C1 |
| C2, navigation | **Complete** (Home, Forecast, Activity, Plan) | Phases C2, H3, C3 |
| C3, Activity view | **Complete** | Phase C3 |
| B1, wording | **Complete** | Phase B1 |
| C4, conditional visibility | **Complete**, merged as `ae331a1` | Phase C4 |
| C5, Plan screens and setup | **Complete**, merged as `957d79a` | Phase C5 |
| C6, one "See what happens if…" | **Complete**, merged as `0f4d33f` | Phase C6 |
| D1, shared visual foundation | **Complete**, merged as `27cda0b` | Phase D |
| D2, Home | **Complete**, merged as `89f25be` | Phase D |
| D3, Forecast | **Complete**, merged as `81bdf00` | Phase D |
| D4, Plan and Activity | **Complete**, merged as `e911b18` | Phase D |
| D5, setup and sheets | **Complete**, merged as `ab843ce` | Phase D |
| D6, desktop | **Complete**, merged as `d5e8b61`; Phase D is complete | Phase D |
| E1, income foundation (income certainty) | **Complete**, merged as `b747c96` | Phase E |
| E2, hourly and tipped income | **Complete**, merged as `e2fbfc1` | Phase E |
| E3, freelance income | **Complete**, merged as `6d88365` | Phase E |
| E4, gig work and payouts | **Complete**, merged as `d8910c6` | Phase E |
| E5, earnings history and views | **Complete**, merged as `a50ac4d` | Phase E |
| E6, income integration and verification | **Complete**, merged as `70f4248`; **Phase E is complete** | Phase E |
| F0, production readiness and infrastructure plan | **Complete** (documentation; revised for no users), merged as `3de2938` | Phase F |
| F1, AC-S: accounts, transfers and Strategic Reserves in Supabase | **Complete**, merged as `3de2938` (with F0) | Phase F |
| F2, production Supabase build | **Complete** (in review) | Phase F |
| AC5, account balances | **In part**: opening, recorded and projected balances done; availability, balance alerts, "cash available now" not built | Phase AC |
| AC-S, accounts, transfers and releases in Supabase | **Complete** as F1, merged as `3de2938` | Phases AC, F |
| AC6 payoff support, recurring planned transfers | **Deferred** (need specifications or decisions) | Phase AC, conflicts |
| Step 9 virtual allocations; Phase F (hosted Supabase, Firebase cutover, offline-sync removal, Vercel) | **Deferred** (paused by the product experience decision) | Phase F, Step 10 |
| Steps 3 and 5 (review list, review rhythm) | **Superseded** by Home (H2) | Status |

### Home (progress, actions, what's coming) — H1 and H2 merged to `main`; H3 complete in review (October 2026)

Goal: within about 30 seconds of opening the app, a person can tell (1) whether their cash flow is improving, declining or steady, (2) what needs attention now, and (3) what's coming. It carries out phases R2, C1, C2 and C4 below in a tighter order, and adds no financial data, inputs or engine.

*Historical: the assessment and plan from here through "Dependencies" were written before H1 and are kept as the record of the decision; they name code (`reviewEntries`, `transfersDue`, the review sheets) that H2 later removed. The H1 and H2 entries under "Sequence" describe what was built.*

**Assessment of the dashboard before Home (`Dashboard.tsx`, October 2026).** One screen stacks: the date; an overdue banner *or* a "Review this week" button; the review-rhythm entry; the transfers entry; "Explore a scenario"; a Month / Week / Paycheck / Custom switch; the cash-flow hero (cash flow, in / out / set aside, lowest running total, timing gap, next payday); a calendar with a key; the breakdown; tag totals; and the period's weeks or days. Problems:
- **Progress isn't shown.** Cash flow is for the selected period only, with nothing to compare it with, so "improving or declining" can't be read.
- **Actions are scattered** across up to four separate entry points (overdue banner, review button, rhythm entry, transfers entry), each opening its own sheet. A shortfall a planned transfer would cause shows only after opening the transfers list.
- **Week information is duplicated**: the Week tab, the week list under every period, the "Review this week" sheet and the period review all list the same items.
- **Supporting detail sits on the opening screen** (breakdown, tag totals, calendar key, Paycheck and Custom views) and pushes actions below the fold on a phone.

**Opening screen ("This week"; Q1).** Top to bottom; a section appears only when it has content (phase C4):
1. **Progress line.** Available cash flow this month (recorded plus still expected) with an arrow against last month's recorded cash flow (improving, steady or declining), and the lowest running total ahead if it goes below $0, linked to its explanation. No other metric.
2. **Needs attention.** One list: overdue items from any date, items due today, planned transfers due and not recorded (with the shortfall when the source balance is known), and a timing gap that starts within 7 days. Each item has Record and Move; batch recording only for items due today or earlier (Q4).
3. **Coming up.** The rest of this week and early next week by day: expected income, obligations, reserve allocations and planned transfers, kept visually distinct from recorded items.
4. **Happened this week.** Recorded items with any difference from what was expected ("$128, expected $90").

Previous and next week stay one tap away. The month calendar, breakdown, tag totals, custom range and scenarios move to a **Forecast** tab (C2); nothing is removed from the app.

**Remove (each needs its decision):** review completion states, the payday rhythm and batch Undo (Q3, Q4; phase R2); the separate overdue banner, "Review this week" button, rhythm entry and transfers entry (folded into Needs attention); the dashboard's Week tab and per-period week list (replaced by the opening screen); the calendar key's explanatory list (a tooltip instead). The Paycheck view and primary-paycheck concept were removed in R1.

**Consolidate:** the four action entry points into Needs attention; "Review this week" and the period review into the opening screen; What if… and scenarios into one "See what happens if…" (Q5; phase C6, later).

**Reuse (no new money math):** `periodKpis` and `periodPlan` (progress, month cash flow), `overdueEntries` and `reviewEntries` (attention, coming up), `explainTimingGaps` and `timingGapsAhead` (gaps), `variance` (happened vs expected), `transfersDue` and `transferShortfall` (transfers), `recordAsExpected` / `rescheduleSelected` (batch actions), and the existing `OccurrenceSheet`, `GapsSheet`, `TransferForm`, `EntryButton`, `FlowAmount` and `StatusBadge`. One new pure helper groups a week's entries and transfers into the four sections, with tests.

**Dependencies:** R2 before H2 (it removes the review states the opening screen would otherwise duplicate). Decisions Q1, Q3, Q4 and the progress comparison (below) before H2. Nothing depends on Supabase, Firebase or new storage.

**Sequence (each its own authorized task, with tests):**
- **H1. Home selector (complete, October 2026).** `homeView` in `src/domain/home.ts` (FINANCIAL_ENGINE.md, Home): progress (this month and last month, recorded and projected, a like-for-like month-to-date comparison and a labeled projected-versus-recorded one), attention, coming up, happened and later gaps, including transfers, reserves and accounts. Domain tests only (`home`, 22). No interface change.
- **H2. Opening screen (complete and merged, October 2026; PR #4 `3fac4ac`, PR #5 `fe8b13d`).** `Home` (`src/ui/screens/Home.tsx`, route `#/home`, first in the navigation and the screen after setup, restore and sample data): progress, Needs attention, a week navigator over Coming up and Happened, built from `homeView(data, today, { weekOf })`. `weekOf` is separate from `today`, so moving weeks never changes overdue items, progress or Needs attention. Removed: review completion and skip, the review rhythm (all options, its Settings control and `REVIEW_RHYTHM_IN_ACCOUNTS`), the weekly and period review sheets, the overdue banner, the review entry, the transfers entry, batch Undo (`undoBatch`) and `transfersDue`. Batch recording and moving take only items due today or earlier. The old dashboard keeps its place as **Forecast** (route `#/dashboard`) with its Month, Week, Paycheck and Custom views, calendar, breakdown, scenarios and the rest, untouched until H3. The stored `review` field is dropped on load and never written; the Supabase `review_*` columns stay, unused, and the Firestore rules still accept the optional field. Tests: 32 domain (`home`), 7 `batch`, 25 component (`ui/home`), browser smoke steps.
- **H3. Forecast and Plan navigation (complete, October 2026; in review).** Navigation is Home, Forecast and Plan, with Settings behind the gear. `#/forecast` is canonical (`Forecast.tsx`, formerly `Dashboard.tsx`); `#/dashboard` redirects, replacing the address without a history entry. Plan (`Plan.tsx`, `#/plan/income`, `expenses`, `liabilities`, `reserves`) hosts the existing item screens unchanged; the old kind routes redirect. Forecast's Week tab is removed; Month, Paycheck and Custom each list their weeks and days, and a custom range can cover a single week. Accounts and transfers stay in Settings, item sheets and Home. No calculation changed. Decisions 1–3 below were approved as recommended. Not done from the plan: step 5's deep links from Home into a particular Forecast month or gap (Home's "Full forecast and calendar" opens the current month). Tests: `navigation` (19), updated `home`, `money-accounts` and `scenario-sheet`, the browser smoke test (redirects, Plan sections, phone-width fit) and the Supabase browser suite's navigation helper.
- **H4. Interface simplification (complete, October 2026).** Conditional visibility: embedded section intros hidden when items exist; overdue callout shortened. Language: concise week-list hint, tighter running-total OK callout, shorter source-occurrence hint. Contextual navigation: Home's "Full forecast and calendar" carries the viewed week's start date into Forecast via `navigateToForecast`/`consumeForecastDate`; `#/forecast/YYYY-MM-DD` deep links parse to the forecast route; direct `#/forecast` and all redirects still work. Density: Home and Forecast stack spacing tightened via CSS overrides. No domain or calculation changes. Tests: `h4-simplification` (12), updated `home` (25), `occurrence-sheet` (8), `navigation` (19), browser smoke (all steps pass).
- C3 (Activity view) is complete; see below. Later, separately: C5 (Plan and setup), C6 (one "See what happens if…"), D (visual redesign). R1 (primary-paycheck removal) is complete.

**Decisions (product owner, October 2026):** the week view opens the app (Q1); progress is month over month, shown as the factual difference with no threshold; review completion states, the payday rhythm and batch Undo are removed (Q3, Q4), keeping ordinary corrections and legitimate early payments; a timing gap needs attention when it starts within 7 days, and later gaps stay visible in the forecast; the primary-paycheck concept is removed (Q2, done in R1).

**Decided for H2 (as built):** progress leads with recorded month to date against the same days of last month, with the projected month as a second, labeled line (Projected against last month's recorded result); expected income that is not recorded appears in Needs attention as "Expected — not recorded", never as late; "coming up" is the viewed week, and for the current week it runs through Tuesday of next week.

**H3 plan (Forecast and navigation; approved and built, see the H3 entry above).** Goal: Home answers "what matters now"; Forecast holds the detail behind it; neither asks for more work. No new calculation, screen logic or metric.

*What exists to reuse.* The Forecast screen is today's dashboard (`Dashboard.tsx`, route `#/dashboard`): Month / Week / Paycheck / Custom views, the cash-flow hero with its timing-gap line, the calendar and key, breakdown, tag totals, the week list or day timeline, the day sheet, the gap and What if… sheets, and "Explore a scenario". Plan screens are `SourcesScreen.tsx` (Income, Liabilities, Reserves) and `ExpensesScreen`; accounts and transfers live in Settings and in item sheets. Shared parts already exist: `PeriodNav`, `EntryButton` (`components/entries.tsx`), `GapsSheet`, `OccurrenceSheet`.

*Sequence (each step shippable, with tests):*
1. **Routes first.** Add `forecast` (and `plan`) routes; `#/dashboard` and the four kind routes (`income`, `expenses`, `liabilities`, `reserves`) redirect so saved links and tests keep working. No visible change yet.
2. **Navigation.** Bottom bar and top nav become Home, Forecast, Plan, with Settings as the gear. This removes today's six-item bar (Liabilities and Reserves are tight at 390px). Needs the Plan screen from step 3, so ship 2 and 3 together.
3. **Plan screen.** One screen with a segmented control (Income, Expenses, Liabilities, Reserves) that hosts the existing `SourcesScreen` / `ExpensesScreen` unchanged. Accounts stay in Settings until C5.
4. **Forecast trimming (only what Home now covers).** Drop the Week tab (Home's week navigator and the Month view's week list cover it). Keep Month, Paycheck (until R1 removes it) and Custom, the calendar, breakdown, tags, scenarios and What if…. Hide the breakdown and tag sections when empty (C4).
5. **Home to Forecast links.** "Full forecast and calendar" opens Forecast on the month of the week being viewed; a timing gap row can open Forecast's gap sheet. `laterGaps` from `homeView` is not shown on Home by design; Forecast's hero and gap sheet are where later gaps appear, so step 4 must keep that line.
6. **Regression tests.** Route redirects, nav, Plan segments, each removed or moved control reachable from its new place, the browser smoke test and the Supabase browser suite updated for the new routes, and a check that no financial figure changes (Forecast month total still equals Home's projected month).

*Mobile.* Three nav items fit comfortably; the segmented control scrolls horizontally on narrow screens rather than wrapping. Forecast keeps its single column.

*Conditional visibility.* Sections with nothing to show are hidden (breakdown, tag totals, gap line, empty week list); no zero-value placeholders.

*Decisions for the product owner (all three approved as recommended, October 2026).*
1. Drop the Forecast Week tab? (Recommended: yes, Home and the week list cover it.)
2. A Plan tab grouping Income / Expenses / Liabilities / Reserves, or keep them as separate top-level items? (Recommended: Plan, to keep the bar to three.)
3. Rename the route `dashboard` to `forecast` with a redirect, or keep both names? (Recommended: rename with a redirect.)

**Also open, outside H3:** whether to drop the unused Supabase `review_*` columns in a later migration (after every client is past H2); and a retirement date for `overdueEntries` if nothing else uses it. The primary-paycheck removal (R1) is complete.

### Phases

Revised for the product philosophy (AGENTS.md section A) and the reduction audit ([docs/REDUCTION-AUDIT.md](docs/REDUCTION-AUDIT.md)). Removals come before redesign, so nothing is redesigned and then removed.

**Order:**

A1 → A2 → R1 → R2 → C1 → C2 → C3 → B1 → C4 → C5 → C6 → D → (decision D8) → E → F

**Rules for every phase:**
- Each phase is its own authorized task, small enough to verify on its own, with tests in the same change.
- Only A1 changes a calculation.
- R1 and R2 had to wait for decisions Q2–Q4. The product owner approved them (October 2026): R2 is complete (in H2) and R1 is complete.

#### A. Financial correctness

**A1. The running total starts at the earliest eligible upcoming income** (defects D1 and D2). **Complete (October 2026).** Complexity: **medium**.
- **Scope:**
  - The algorithm in docs/PRODUCT-AUDIT.md §6.3, with defaults D1 and D2 (PRODUCT_EXPERIENCE.md §9).
  - `Forecast` gained `nextMainPayday` (later removed in R1).
  - Wording that says "next payday" where it means the running total's start is corrected.
- **Dependencies:** none.
- **Files:**
  - `src/domain/forecast.ts`, `preview.ts`, `scenarios.ts` (messages);
  - `src/ui/screens/Dashboard.tsx`, `Onboarding.tsx`, `src/ui/components/WhatIfSheet.tsx`, `EstimateSheet.tsx`, `ScenarioSheet.tsx`;
  - `FINANCIAL_ENGINE.md`, `README.md`.
- **Acceptance:**
  - In the audit's reproduction, the running total starts Oct 19 and shows the $600 gap.
  - Entry order never changes the start.
  - Single-income plans are unchanged.
- **Tests:**
  - docs/PRODUCT-AUDIT.md §6.6, written failing first;
  - `forecast.test.ts › anchors at $0…` updated deliberately;
  - an e2e step for the reproduction.
- **Excluded:** layout; "cash available now". The primary-paycheck concept was removed in R1.

**A2. Small verified defects** (D3, D5). **Complete (October 2026).** D3: a one-time item's delete label names it in words ("varied spending", "one-time income", "Strategic Reserve amount", "use of reserves"), never the kind id. D5: when the device won't store sample data, `enterSample` returns a result instead of throwing, leaves nothing half set up, and Settings and the welcome screen say what went wrong. Tests: `occurrence-sheet` (D3), `mode` and `sample-data` (D5), each failing against the old code. D4 no longer applies (the rhythm entry was removed in H2). Complexity: **low**.
- **Scope:**
  - the one-time item's delete label uses its own words;
  - a failed switch to sample data shows a message.
- **Tests:** a component test for each.
- **Excluded:** other wording (B1).

#### R. Removals (each needs its decision approved)

**R1. Remove the primary-paycheck concept and the Paycheck view** (Q2). **Complete (October 2026).** Complexity: **medium**.
- **Scope:** every use replaced per REDUCTION-AUDIT §5.4:
  - the setup cash-flow bar shows the first period (earliest income to the second upcoming income date);
  - scenario reserves use an explicit schedule;
  - the picker, badge, `MainPaycheckPicker`, `setMainPaycheck`, `paycheckCycles` and the Paycheck view tab are removed;
  - `mainPaycheckId()` replaced by `hasActiveIncome()`;
  - `firstPeriod()` rewritten to scan forecast entries for the earliest income source's first two dates;
  - `'each-paycheck'` schedule type removed from scenarios.
- **Data:** stored `mainPaycheck` / `main_paycheck` stay readable and are ignored. No schema change until the Supabase cutover. `main_paycheck` column always written as `false`.
- **Dependencies:** A1.
- **Files changed:**
  - `types.ts`, `forecast.ts`, `scenarios.ts`, `operations.ts`;
  - `forms.tsx`, `SourcesScreen.tsx`, `Forecast.tsx`, `Onboarding.tsx`, `ScenarioSheet.tsx`;
  - `storage.ts`, `rows.ts`.
- **Acceptance:** no screen mentions a primary paycheck; forecasts are identical to A1's.
- **Tests:**
  - old data with `mainPaycheck` loads (silently stripped);
  - backups round-trip;
  - scenario reserves on an explicit schedule;
  - updated component, domain and e2e tests.
- **Excluded:** dropping the column; any calculation change.

**R2. Remove review completion states, the payday rhythm and batch Undo; limit batch recording to due items** (Q3, Q4). **Complete in H2 (October 2026).** Complexity: **low**.
- **Scope:**
  - Remove `completeReview` / `skipReview` and their UI, the payday option, and the `REVIEW_RHYTHM_IN_ACCOUNTS` branching.
  - Keep the monthly look-ahead only if Q3a says so.
  - Remove the batch Undo callout and `undoBatch`.
  - `recordAsExpected` accepts only items due today or earlier.
- **Data:** the stored `review` field stays readable and is ignored.
- **Dependencies:** none (can run before or after A1).
- **Acceptance:** per-item corrections still work (Mark as not paid, Edit payment, Add back).
- **Tests:**
  - migration of data with `review`;
  - batch recording refuses not-yet-due items with a clear message;
  - the e2e review steps updated.
- **Excluded:** the week view (C1).

#### C. Structure (simplify, consolidate, relocate)

**C1. The week view** (REDUCTION-AUDIT §5.2, PRODUCT_EXPERIENCE.md §3.2). **Complete as Home (H2, October 2026).** Complexity: **medium–high**.
- **Scope:**
  - The week view replaces the dashboard's Week tab, the "Review this week" sheet and the overdue banner.
  - Its sections: forecast line, Needs attention (overdue from any date, plus today), Coming up, Happened (with expected-vs-actual), Early next week.
  - Batch record and move are kept, for due items.
- **Dependencies:** R2 (and Q1 for whether it opens the app).
- **Files:**
  - a new week screen and a grouping helper (pure, tested);
  - `Dashboard.tsx`, `ReviewSheet.tsx`.
- **Acceptance:**
  - In the sample data, this week shows the overdue phone bill and the Oct 22 paycheck.
  - Empty sections are absent.
  - Every figure comes from the forecast.
- **Tests:**
  - the grouping helper (overdue from earlier weeks, week boundaries, early next week);
  - component tests per section;
  - e2e: record and move from the week view.
- **Excluded:** visual redesign; new data.

**C2. Navigation and the remaining dashboard** (Q1; PRODUCT_EXPERIENCE.md §3.1, §3.3). **Complete** (H2, H3 and C3): Home, Forecast, Activity and Plan, with redirects from old addresses. Complexity: **medium**.
- **Scope:**
  - The tabs This week, Forecast, Activity and Plan; Plan for now is today's Income / Expenses / Liabilities screens behind one tab.
  - Forecast holds the month calendar, gaps, "See what happens if…" and the range chip.
  - The Breakdown, tag totals and custom range leave the main screen.
- **Dependencies:** C1.
- **Acceptance:** every current capability stays reachable, each one checked off in the task report.
- **Tests:** routing with redirects from old hashes; the e2e smoke test updated.
- **Excluded:** the Activity view (C3); visual redesign.

**C3. The Activity view** (PRODUCT_EXPERIENCE.md §4). **Complete (October 2026).** Complexity: **medium**.
- **Scope:** recorded history with expected-vs-actual, and a month summary by kind and by tag.
- **Dependencies:** C2.
- **Tests:** exact-cents aggregation reconciled with recorded entries and `variance` (12 domain tests); component tests for rendering, kind filter, empty states and variance (8); updated navigation tests (20) and home nav assertion (1).
- **Excluded:** forecast figures; the Earnings section (E).
- **What was built:** `activityView` in `src/domain/activity.ts` (pure function producing a `PeriodPlan`-compatible summary from completed forecast entries), `Activity` screen in `src/ui/screens/Activity.tsx` (month navigation, summary KPIs, `PeriodBreakdown` with recorded labels, `TagBreakdown`, kind filter chips, item list with variance sub-line, occurrence sheet on tap), route `#/activity` in the nav between Forecast and Plan. No domain or calculation changes to existing code; `PeriodBreakdown` gained a `recorded` prop to swap labels.

**C4. Conditional visibility** (PRODUCT_EXPERIENCE.md §5) on the screens that remain. **Complete (October 2026; PR #14, merged as `ae331a1`).** Complexity: **low–medium**.
- **Dependencies:** C2.
- **What was built:** `src/ui/visibility.ts` (pure rules over fields the engine already computed: active day, active week, folding quiet days, empty plan, classifications with activity). Forecast: a day with nothing scheduled and a running total at or above $0 is a plain calendar cell; a week with no active day shows "Nothing scheduled" with no expand control; week rows show only non-zero amounts; an open week folds runs of quiet days into one text line ("Oct 18 – 19 · nothing scheduled"), keeping today and every day below $0; no "—" running totals (the running total is left out before it starts, with "Your running total starts Oct 16, your next payday." above the first day that has one, completing PRODUCT-AUDIT §4 item 9); the lowest running total shows only when it goes below $0, otherwise "You stay above $0 through …"; with no recurring income, only the setup card. The breakdown is one line when nothing moved. Activity: "By kind" shows when two or more classifications have activity (decision S1). Plan: an empty section is one line beside its Add button; a recurring kind's one-time list appears once it has items, with "Add one-time" beside the recurring Add until then; "See dates" only when an item has dates. Setup review: kinds with nothing added collapse into "Not added: subscriptions, Strategic Reserves." with a link to add each. No calculation changed.
- **Tests:** `visibility` (21: the pure rules including "negative but empty", calendar cells, week rows, folding, the running total's start line, the summary line, the empty breakdown, the no-income card, S1 and S2, Plan sections, "See dates", and nothing saved); updated `onboarding` (review) and the browser smoke test (summary line and folded days).
- **Not changed:** Home (its sections were already conditional in H2 and H4); S2 (Paid $0.00 stays in the Activity summary) and S7 (all four Plan tabs stay).

**C5. Plan screens and setup** (rows plus a detail sheet, one-time items inside each kind; setup in three steps). **Complete (October 2026; PR #15, merged as `957d79a`).** Complexity: **medium**.
- **Dependencies:** R1, C2.
- **What was built:**
  - **Plan** (PRODUCT_EXPERIENCE.md §3.4): each recurring item is one tappable row (name, schedule, status, amount). Only "Off" is marked. The status shows where the item really stands: "Overdue since Oct 5" before "Next Nov 1" (audit finding H5), then "No upcoming dates" or "Off since …". The row opens the item's sheet with its recent and upcoming dates (formerly "See dates"), any scheduled change, Edit, Turn off or Turn on, and Delete only when nothing has been recorded (`deleteSource` already refuses otherwise). A date opened from the sheet returns to it. The estimate suggestion stays on the row. One-time items stay inside their kind (C4). The four Plan tabs stay (decision S7).
  - **Setup** (§7.9): three steps instead of seven. (1) "When do you get paid?": income, with sample data, restore and the signed-in line on the same screen. (2) "What do you pay regularly?": one list for bills, subscriptions and liability payments, added through one "Add a payment" sheet with a kind picker; varied spending and optional Strategic Reserves ("Set money aside on a schedule (optional).") on the same step. (3) The review, ending in "Looks right" or "Change something". The first look (the cash-flow banner on each step, the review's lowest running total and its breakdown) covers a rolling next four weeks from today, read from the one forecast (product-owner decision, C5 review); recorded payments in the window count at what actually happened. It appears once there is income. `firstPeriod`, the setup-only pay-period helper, is removed, so nothing in setup depends on a pay period. No calculation or stored data changed.
- **Tests:** `onboarding` (the three steps, the first screen's links and the income prompt, the kind picker, "Change something"), `setup-timing-gaps` (the four-week first look with one income, several incomes, a payment already recorded, and no income), `plan-rows` (7: status text, Off only, the sheet's dates and actions, Delete only without history, return from a date, turning off), updated `accounts`, `update-banner`, `estimate-sheet`, `money-accounts`, `navigation` and `visibility`; the browser smoke test and the Supabase browser suite walk the new setup and reach items through their sheets.
- **Not changed from today:** the review's per-kind sections and "Not added" line (C4) stay. "+ Add" in the top bar (§3.1) is not part of C5.

**C6. One "See what happens if…"** (merge What if… and scenarios; Q5). **Complete (October 2026; PR #16, merged as `0f4d33f`).** Complexity: **medium–high**.
- **Dependencies:** C2.
- **What was built:** one sheet, "See what happens if…" (`ScenarioSheet.tsx`), opened from Forecast and from each outstanding item in a timing-gap explanation (Forecast and Home), where it opens on that payment. `WhatIfSheet.tsx` is removed. Its three actions on one payment (move it, change its amount, leave it out) are one change type, "Change an expected payment", next to the scenario types (additional income, unexpected expense, a higher liability payment, reserves, variable income). Every comparison comes from `evaluateScenario` / `evaluateIncomeCases` over the existing forecast engine, through the period being viewed when opened from a gap. Domain additions only: an `occurrence-skip` scenario change (the same `cancelOccurrence` on a copy that What if… used, so the plan is untouched) and `applicableChange`, which names the one case that can be applied: exactly one change to an expected payment. Apply… appears only for that case when the comparison is valid, asks for confirmation, and goes through the existing `applyPreviewedChange`, which refuses a stale or uncomparable preview and changes that one occurrence. Closing changes nothing. No new engine, classification or saved scenarios.
- **Tests:** `see-what-happens` (17, 15 ported from the What if… sheet: opening on a payment, comparisons, Keep exploring, apply a move, apply "leave it out", stale preview refused, not comparable, invalid date, several or hypothetical changes never applied, a recorded payment refused, closing, plain words for leaving out income, a liability or a bill, a gap beyond 90 days; plus an overdue payment opened from a gap, and a confirmation that resets when the change is edited); `scenarios` (7 new: leaving out a payment, agreement with `previewChange` for move, amount and leave-out, the plan unchanged, one change per item, recorded payments refused, `applicableChange`, applying through `applyPreviewedChange`); updated `scenario-sheet` and `gaps-sheet`; the browser smoke test's timing-gap step.
- **Excluded:** saving scenarios; applying several changes at once.

#### B. Product language

**B1. Wording** (PRODUCT_EXPERIENCE.md §2; docs/PRODUCT-AUDIT.md §4, minus rows made moot by R1–R2). Complexity: **low–medium**. **Complete (October 2026).**
- Applied the 14 voice/tone rules from §2.2 across all screens and domain messages.
- Replaced "transaction" with "item", "canceled" with "skipped", "outstanding" with "expected", "Cancel" with "Skip", "prediction" with "original estimate".
- Replaced curly (Unicode) quotes with straight quotes project-wide.
- Rewrote onboarding steps, ScenarioSheet prompts, OccurrenceSheet actions, and error messages in everyday language.
- Updated all test assertions to match changed text; 718 tests passing.
- Product-owner decisions S1, S2, S7 recorded (§9).

#### D. Visual redesign

PRODUCT_EXPERIENCE.md §7: tokens and components first, then screen by screen, then desktop. Complexity: **high**, split per screen.
- **Dependencies:** C1–C6 (all complete).
- **Excluded:** calculation changes; the light theme.
- **D1. Shared visual foundation (complete, October 2026; merged as `27cda0b`).** Tokens: the §7.1 type scale (display 36/700, section 15/600, `--text-section`), a 18px card radius, and §7.2 color roles: money out is neutral text with its "−" (`--color-out` = primary text), its chips and the bill avatar a neutral slate (`--color-out-line`, `--color-out-fill`), so indigo is the interactive accent and focus only. Section labels and subheads are sentence case. `StatusBadge` marks done money in (Received) green and other done states (Paid, Set aside) neutral. New shared components `ListGroup` (one surface, hairline dividers) and `EmptyLine` (one line, at most one action) replace the unused `EmptyState`; adopted in Plan's one-time lists and empty lines and in Activity's recorded list. The calendar key says money out is gray with a "−". Every new color pair checked against WCAG AA (text 4.5:1, outlines and icons 3:1). No screen restructured, no navigation or calculation change.
- **D2. Home (complete, October 2026; merged as `89f25be`).** Home only, on the D1 foundation; no domain, classification or stored-data change.
  - **Progress:** one leading figure: recorded cash flow so far this month, or, with nothing recorded, the projected month labeled Projected. The comparison with the same days of last month stays one line under it. The projected month, last month's recorded total and their difference follow as short label-and-amount rows (they were one wrapping sentence). Below-$0 figures are red; up and down are said in words with an arrow, no longer red or green (§7.2: red means below $0).
  - **Needs attention:** one `ListGroup`; a payment past its date says "Overdue since …" in amber; money not yet in stays neutral ("Expected … — not recorded"). With items selected, the primary action takes its own full-width line above "Move to a date".
  - **Coming up:** one `ListGroup` for the week, each day a small label inside it (was one card per day). **Happened this week:** one `ListGroup`. An empty week is an `EmptyLine`.
  - **Small phones (≤ 374 px):** the decorative kind avatar gives way to the item name, and the checkbox column sits in the group's padding; at 320 px names no longer break mid-word and badges no longer overlap amounts.
  - Tests: `home-d2` (8): hand-computed progress figures below $0 and their difference, projected-only lead equal to the Forecast month, list-group structure, amber only for overdue payments, empty line, 44px checkbox targets, the small-phone rule. The smoke test finds the progress card by its region name.
- **D3. Forecast (complete, October 2026; merged as `81bdf00`).** Forecast only, on the D1 foundation and D2 patterns; no domain, classification or stored-data change. Activity's and setup's breakdowns are unchanged (they share the new `BreakdownRows`).
  - **One summary:** the breakdown (income, spending with a row per classification, reserves) moved into the cash-flow card under the figure, replacing the "in · out" line and the separate Breakdown card that repeated income, spending and cash flow. Rows with nothing in them are left out; a period with nothing in it says so in one line.
  - **Below $0:** the lowest running total is a labeled row in red; the gap callout reads "Short $X" over "Timing gap · dates" and still opens the explanation. When the running total starts after the period, the payday line says "Your running total starts then." instead of an empty lowest-total row.
  - **Week by week** is one `ListGroup`. A week's Net shows only when more than one kind of money moved (it repeated the single amount). An open week lists only the amounts each day has (no "—" placeholders); reserves get their own labeled cell.
  - **Small phones (≤ 374 px):** calendar chips drop the "$" and tighten so amounts fit their day (each day's label still reads the full amount); the custom range's date fields stack instead of overflowing the page (a pre-existing defect).
  - Tests: `forecast-d3` (10): hand-computed summary figures that add up to the cash flow, no repeated breakdown, zero rows hidden, the running-total-starts line, red lowest point and gap that opens its explanation, red weeks and days below $0, one list group with Net only when it adds something, no dashes in open weeks, chip markup and narrow rule, recorded vs expected chips, custom range layout. Updated: two `visibility` tests and the smoke test read the breakdown from the summary card.
- **D4. Plan and Activity (complete, October 2026; merged as `e911b18`).** On the D1 foundation and the D2/D3 patterns; no domain, classification or stored-data change. Setup, sheets and desktop are unchanged.
  - **Activity summary:** one card leads with recorded cash flow ("Recorded" badge), then its breakdown (Received, Paid, a row per classification, reserves) from the shared `BreakdownRows`. It replaces the three-figure strip and the separate By kind card, which repeated the same three figures; the strip also overflowed a 320 px screen. Decision S1 holds inside the card: per-classification rows show only when more than one classification has activity. Decision S2 holds: Received and Paid show even at $0.00.
  - **Activity empty states** (a month with nothing recorded, a filter with no items) are `EmptyLine`s.
  - **Plan:** each section's recurring items are rows in one `ListGroup` (was one card per item). Rows keep their schedule, next date or "Overdue since" in amber, tags, account and estimate suggestion; an item that is off stays in the list with its "Off" badge and a secondary-color name.
  - **Small phones (≤ 374 px):** Activity and Plan rows hide the decorative avatar as Home's do, so names no longer break mid-word; Plan's four section pills share the width so all four fit without scrolling (DESIGN.md's rule, which failed at 320 px); a section's Add buttons go under its heading instead of stacking at the right.
  - Tests: `plan-activity-d4` (7): hand-computed recorded figures that add up to the cash flow, no repeated summary, empty month line, recorded badges in one list group, Plan rows in one list group with overdue in amber, an Off item still listed and opening, the small-phone rules. Updated: the Activity by-kind test and the S1/S2 tests read the one summary; the D2 small-phone CSS test allows the shared selector; the smoke test finds Plan rows by `.source-list`.
- **D5. Setup and sheets (complete, October 2026; merged as `ab843ce`).** On the D1 foundation and the D2–D4 patterns; no domain, classification, stored-data, account or navigation change. The rolling four-week first look, sample data, restore, every financial action, confirmations and scenario comparison are unchanged.
  - **Setup:** an empty step is one `EmptyLine` with its primary Add (was an empty card with an icon and a heading); the one-time lists' empty notes are `EmptyLine`s; "Tap an item to change or remove it." shows only once there is something to tap. The review's breakdown no longer repeats the range and cash flow the four-week banner above it already shows. Its actions are stacked with the primary first ("Looks right", then "Change something"), so neither label wraps. Setup rows hide the decorative avatar below 375 px, as the other screens do.
  - **Payment sheet:** an overdue payment says "Its date has passed. Record it, or move it to a new date." (the date was shown three times). The status badge sits with the kind ("Bill · Recurring", "Overdue") under the amount, and the expected/actual rows wrap on a narrow sheet; at 320 px the recorded-payment sheet was 13 px wider than the screen.
  - **Item sheet:** Edit is the primary action; Turn off/on and Delete stay.
  - **Timing gaps:** each expected payment is one tappable row (date, name, amount, chevron) that opens "See what happens if…", with one hint above the gaps instead of a link under every line; the group labels are sentence case.
  - **"See what happens if…":** with no changes yet, Add a change is the primary action; Done is a quiet close (the sheet's X does the same). Apply change and its confirmation are unchanged.
  - Tests: `setup-sheets-d5` (8): empty step line and primary Add, the tap hint after the first item, sample and restore present, review breakdown once with the primary action first and "Change something" going back, setup small-phone rule, overdue wording and status placement with every action present, recorded rows wrapping, item sheet actions, gap rows opening the scenario with one hint, scenario empty-state actions. Updated: a setup test reads the breakdown without the range, the D4 small-phone test allows setup rows, the smoke test reads the range and cash flow from the banner.
- **D6. Desktop (complete, October 2026; merged as `d5e8b61`).** From 1024 px; no domain, classification, stored-data, account or route change, and no second navigation or sheet component.
  - **Navigation:** the existing tab bar (the same `NAV` list and links as the phone bottom bar) becomes a fixed left rail under the top bar, with icon and label rows and the current route highlighted; the top pills hide. Settings stays behind the gear in the top bar. The tab bar now comes before the content in the page, so keyboard focus reaches the rail before the screen (skip link, Settings, the four routes, then content). Tablets (760–1023 px) keep the top pills; phones keep the bottom bar, pixel for pixel (all 101 phone screenshots from D2–D5 at 320 and 390 px compared identical).
  - **Sheets:** the same `Modal` opens as a full-height panel from the right (480 px wide) instead of a centered dialog, sliding in only when reduced motion isn't requested. Focus trap, Escape, focus return, page scroll lock and scrolling inside a long panel were checked in the browser at 1024 and 1280 px; tablets keep the centered dialog.
  - **Layout:** content stays the one 760 px reading column, centered in the space beside the rail. **Product-owner decision (October 22, 2026):** the 760 px single-column desktop layout is retained. A two-column layout is built only when a usability need is demonstrated (PRODUCT_EXPERIENCE.md §7.6).
  - Tests: `desktop-d6` (6): one tab bar with the same routes, before the content; rail navigation marks the current route; the rail, hidden pills and centered column rules; no rail in setup; the panel rules with reduced motion; dialog semantics, focus and Escape. Browser checks in the D6 screenshot script (rail geometry, panel geometry, focus trap, scroll lock, panel scrolling, no horizontal overflow at 900, 1024, 1280 and 1440 px).
- **Phase D is complete** (D1–D6, merged as `27cda0b`, `89f25be`, `81bdf00`, `e911b18`, `ab843ce` and `d5e8b61`; CI passed on each merge commit). D6's merge commit first failed one job before any test ran (the runner's port 54324 was already in use when the local Supabase stack started); the one re-run passed all five jobs. Decision D8 is settled as a feature flag (Phase E below).

#### E. Income expansion (complete, October 2026; each checkpoint was separately authorized)

PRODUCT_EXPERIENCE.md §6. Planned October 22, 2026. The financial rules every checkpoint keeps:
1. Income counts in cash flow when it's received, or when its receipt is expected on a date; never because it was earned.
2. Possible income, without a dependable date, is shown where it helps but never in cash-flow totals or the running total.
3. Each dollar is counted once.
4. Several income sources need no primary one.
5. Recorded amounts and dates are authoritative.
6. Existing income records keep their meaning.
7. A storage that can't keep something new refuses the save; it never silently loses it.

**Decision D8, as built:** a feature flag per storage. Device storage, backups and Supabase keep the new income data; signed in with Firebase (legacy), it is off (`INCOME_CERTAINTY_IN_SIGNED_IN_SAVES`, `src/state/features.ts`): the choice is hidden and a plan with possible income is refused, never saved without it. Full availability comes with the Supabase cutover (Phase F). New work data (shifts, jobs, sessions) follows the same pattern.

| Checkpoint | Scope | Depends on |
| --- | --- | --- |
| **E1. Income foundation** | Income certainty (expected or possible) and its financial treatment; persistence in every storage; the minimal interface to mark, see and resolve possible income | — |
| E2. Hourly and tipped income | Optional `incomeType`; shifts (hours, wage, cash tips, card tips) as work entries; cash tips as one received income record each; wages and card tips "earned, not paid yet" until the paycheck is recorded (decision D9: the baseline paycheck stays as entered) | E1; introduces the work-entry collection, its `migrate`, backup, Supabase table and Firebase refusal |
| E3. Freelance jobs and payments | Jobs (planned → done → paid); a job with a date and expected certainty is expected income; without a date it is possible (decision D10); recording the payment marks it paid | E1 (certainty), E2 (work entries) |
| E4. Gig work and payouts | Sessions with earnings and cash received; platform earnings waiting for payout; a payout is the one income event, linked to the sessions it covers | E2 (work entries); E1 for possible payouts |
| E5. Earnings history and supporting views (optional) | `earnings.ts` (hours, tips, effective hourly, earned versus paid); possible income in Activity's income list; Earnings reports | E2–E4 |
| E6. Integration and testing across storage providers | Every income type through device storage, backups, Supabase (local stack and browser tests) and the Firebase refusal; migration checks; regression of every total | E1–E5 |

Reminders (§6.7) stay deferred. Each checkpoint stops for review before the next.

- **E1. Income foundation (complete, October 2026; merged as `b747c96`).**
  - **Domain:** an optional `certainty: 'possible'` on income items and one-time income (absent means expected, so every existing record keeps its meaning). A recurring occurrence follows its item; its record never carries the mark. `buildForecast` gives possible income not yet received `counts: false`, `signedCents: 0` and `possible: true`; it is never carried forward, never overdue and never starts the running total, and with only possible income there is no running total. Received possible income is an ordinary recorded entry, counted once at its recorded date and amount. `setIncomeCertainty` marks an item or a one-time income expected or possible without changing any amount, date or recorded outcome. A possible recurring item marked expected counts from today: its earlier dates that were never recorded are skipped (noted "Possible income, not received", each restorable) instead of becoming overdue income carried into the running total. Scenarios offer only counted items and refuse a change to possible income.
  - **Persistence:** `migrate` keeps the mark only on income items and one-time income (device storage and backups). Supabase: migration `20261022000001_income_certainty.sql` adds a `certainty` column to `sources` and `occurrence_records`, with checks (only `'possible'`, only income, never on a recurring occurrence), and redefines `load_plan` and `save_plan` only to carry it; `rows.ts` maps it and `checkForMigration` names a mark the database would refuse. Firebase: the flag above; `CloudAdapter.save` refuses before writing anything. The rules would accept the field (items aren't checked field by field), but an older copy of the app would count possible income, which is why it stays off.
  - **Interface:** an Expected / Possible choice on the income and one-time income forms where the storage keeps it; a dashed "Possible" badge and a muted amount (not struck through) on rows; a "Possible" list on Home for the viewed week, apart from Coming up; on its sheet, an explanation, Record received, and Mark as expected (for a recurring item, the whole item); Mark as possible on an expected one-time income.
  - Tests: `income-certainty` (16, domain), `certainty-persistence` (9: device, backup, Firebase refusal and flag, Supabase mapping and migration checks), `income-certainty-e1` (5, interface), and three PostgreSQL tests in `integrity.db.test.ts` (round trip and an ordinary update, existing rows unmarked, the constraints).

- **E2. Hourly and tipped income (complete, October 2026; merged as `e2fbfc1`).**
  - **Domain:** an income can be hourly or tipped (`incomeType`), with a usual hourly wage (`hourlyWageCents`); neither is read by the forecast. Shifts are a new collection, `workEntries` (`WorkEntry`: date, optional minutes, wage, cash tips and card tips; amounts are absent, never $0). `logShift`, `editShift`, `deleteShift`, `setShiftPaid` and `setIncomeDetails` in `operations.ts`; earnings calculations in `earnings.ts` (wages to the nearest cent per shift, totals, effective hourly over shifts with hours, earned not paid).
  - **Money received, counted once:** a shift's cash tips are one received one-time income record on the shift's date (`cashTipsRecordId`); correcting them replaces that record (a record's original amount never changes), and the record changes only through its shift. Wages and card tips are "earned, not paid yet" and never enter cash flow; recording a paycheck of that income pays the unpaid shifts worked before the day it arrived (`paidByOccurrenceId`), and undoing it unpays them. The paycheck's recorded amount is the money, so nothing is added again. Expected paychecks stay as entered: no suggestion changes them (Option B, D9, deferred).
  - **Persistence:** `migrate` keeps shifts only for an hourly or tipped income that exists, with well-formed amounts, and keeps a link only when it still points at its tips record or a recorded paycheck of the same income (device storage and backups). Supabase: migration `20261022000002_hourly_and_tipped_income.sql` adds `income_type` and `hourly_wage_cents` to `sources` and a `work_entries` table (row-level security, foreign keys to the item, the tips record and the paycheck, checks mirroring the app); `load_plan` and `save_plan` carry them, a save must include `work_entries` (so a client that doesn't know shifts can't erase them), and an ordinary save removes at most one shift. Firebase: `INCOME_DETAIL_IN_SIGNED_IN_SAVES = false`; the choices are hidden and a plan with any of it is refused before anything is written (the rules would refuse `workEntries`, and leaving it out would lose it).
  - **Interface:** "How is it paid?" (Fixed amount, Hourly, Tipped) and a usual hourly wage on the income form; "Tipped · " on its row; on its sheet, a Shifts section first: earned, not paid yet, the latest eight shifts (hours, cash and card tips, earned, paid or not), and Log a shift. The shift sheet: date (today or earlier), hours ("6.5" or "6:30"), wage (from the item), cash tips, card tips; Save, Delete, Mark not paid yet, or Paid in a recorded paycheck. Shift cash tips appear wherever money received is shown, but not in Plan's one-time income list; their sheet points to the shift.
  - Not built (E5 or later): a quick add from Home, the weekly entry sheet, per-week totals on screen, and the Earnings views.
  - Tests: `shifts` (15, domain), `shift-persistence` (8: device, backup, migrate validation, Firebase refusal and flag, Supabase mapping and migration checks), `shifts-e2` (5, interface), three PostgreSQL tests in `integrity.db.test.ts`; the row-level-security, account-deletion and Supabase browser tests now include `work_entries`.

- **E3. Freelance income (complete, October 2026; merged as `6d88365`).** Decision (October 22, 2026): jobs and shifts keep separate storage; they are different financial activities.
  - **Domain:** optional `clients` (names that group jobs) and `jobs` (`FreelanceJob`: description, agreed amount, planned or done work). A job's money is one ordinary one-time income record (`paymentRecordId`), so the existing forecast, E1 certainty and recording count it, and nothing else does: with an expected payment date the record is expected (counts on that date, overdue if it passes unpaid) or possible (doesn't count); without a date there is no record and the job is pending (D10). Recording the payment (`recordJobPayment`, or the record's own sheet or a batch) is the payment: the job is paid at the actual date and amount, the original expectation kept; undoing it unpays the job. Done but unpaid work is "done, not paid yet" (`doneNotPaid`) and never money received. `addJob`, `editJob` (moves the record with `rescheduleOccurrence`, keeps the original; removing the date removes it; a paid job's amount and date are its recorded payment's), `deleteJob` (an unpaid job's record goes with it; a paid job is kept), `addClient`, `renameClient`, `deleteClient` (jobs stay, without a client); payment labels follow the description and client ("Logo design · Acme"). A job's record can't be deleted on its own.
  - **Not built:** partial payments (deferred, as specified), invoices, chasing, and Earnings views.
  - **Deviation from §6.8:** jobs are their own collection and table, not `workEntries` rows: a job belongs to no income item and has its own fields and checks. The roadmap's E2 → E3 dependency was the work-entry pattern (migrate, Supabase table, Firebase refusal), which E3 reuses.
  - **Persistence:** `migrate` keeps clients and jobs only when well formed, and a job's links only when they still point at a client and at a one-time income record no other job or shift uses (device storage and backups). Supabase: migration `20261022000003_freelance_income.sql` adds `clients` and `freelance_jobs` (row-level security, foreign keys, one job per payment record); a save must include both, a job's payment must be a one-time income record no shift uses, and an ordinary save removes at most one job and one client. Firebase: the E2 flag (`INCOME_DETAIL_IN_SIGNED_IN_SAVES`) now covers clients and jobs; such a plan is refused before anything is written.
  - **Interface:** Plan › Income: "Add job" beside the recurring Add until there are jobs, then a Freelance jobs section: a client filter when there are two or more, "Done, not paid yet", Not paid yet (overdue first, then by date, then pending) and Paid (latest ten), each row with client, work, payment state and amount (muted when not counted). The job sheet: description, client (or a new one), amount, Planned/Done, expected payment date, Expected/Possible; Record payment, Undo payment or skip, Delete. A Clients sheet to add, rename and remove. Job payments appear wherever money is shown, not in the one-time list; their sheet points to the job.
  - Tests: `freelance` (13, domain), `freelance-persistence` (5: device, backup, migrate validation, Firebase refusal, Supabase mapping and migration checks), `freelance-e3` (4, interface), three PostgreSQL tests in `integrity.db.test.ts`; the row-level-security, account-deletion and Supabase browser tests include `clients` and `freelance_jobs`.

- **E4. Gig work and payouts (complete, October 2026; merged as `d8910c6`).**
  - **Domain:** a new income type, `gig`: expected platform payouts on a schedule, an ordinary recurring income (expected or possible, E1), so the baseline needs no sessions at all. Sessions reuse E2's work entries (`kind: 'session'`): a date, optional hours and platform, platform earnings (`earningsCents`, waiting for payout) and cash received immediately (one received one-time income record on the session date, "Cash · DoorDash", changed only through the session). Recording a payout (an occurrence of the gig income) pays its unpaid sessions worked before the day it arrived, exactly as a paycheck pays shifts; undoing it unpays them; a session can be marked paid by another recorded payout or not paid. The payout's recorded amount is the money, so platform earnings are never counted again. `logSession` and `editSession` (the shift pipeline, checked by the income's type: no wage or card tips on a session, no platform earnings on a shift); `earnings.ts` adds platform earnings to a session's earnings and to what a later payout pays, and `waitingByPlatform`. An income with sessions stays gig income; one with shifts never becomes gig. Freelance jobs are untouched (separate storage, as decided).
  - **Not built:** platform integrations, automated payout reconciliation, instant cash-outs as one-time payouts (record the next expected payout early instead), reminders and Earnings reports.
  - **Persistence:** `migrate` keeps a session only on gig income, with session fields (and a shift only with shift fields), and drops a wage from gig income (device storage and backups). Supabase: migration `20261022000004_gig_income.sql` allows `income_type = 'gig'` (a wage only for hourly or tipped), adds `earnings_cents` and `platform` to `work_entries`, a `kind` of `'session'`, a check on each kind's fields, and a `save_plan` check that shifts belong to hourly or tipped income and sessions to gig income. Firebase: covered by `INCOME_DETAIL_IN_SIGNED_IN_SAVES`; such a plan is refused before anything is written.
  - **Interface:** "Gig payouts" under "How is it paid?" (no wage asked); "Gig · " on its row; on its sheet a Sessions section first: "Waiting for payout" (split by platform when there are two or more), the latest sessions (hours, platform, earnings, cash, paid or waiting) and Log a session. The session sheet: date, hours, platform (with earlier platforms suggested), earnings on the platform, cash received; Save, Delete, Mark not paid yet, or Paid in a recorded payout.
  - **Found while checking `main`:** CI on E3's merge (`6d88365`) failed one unit test, `h4-simplification › redirects still work: #/dashboard opens Forecast` (expected the address `#/forecast`, got `#/dashboard`), while the same tree passed on its pull request and locally (15 of 15 runs of that file). The test read the address the moment the Forecast heading appeared; the router rewrites it in an effect and again on `hashchange`, which jsdom delivers as a later task. The test now waits for the address to settle; no product code changed. This matches the intermittent unit failure seen once in D5.
  - Tests: `gig` (11, domain), `gig-persistence` (5: device, backup, migrate validation, Firebase refusal, Supabase mapping and migration checks), `gig-e4` (2, interface), three PostgreSQL tests in `integrity.db.test.ts`; E2's earnings tests now include `earningsCents: 0`.

- **E5. Earnings history and views (complete, October 2026; merged as `a50ac4d`).**
  - **Domain:** `earnings-history.ts`, read-only aggregation over data E2–E4 already keep; nothing new is stored and the forecast is unchanged. For a month: work dated in it (shifts and sessions together and per income item: hours, wages, cash tips or cash received, card tips, platform earnings, earned, effective hourly, all from `summarize`); as of today, what is not received yet (`earnedNotPaid` with `waitingByPlatform`, `doneNotPaid`) and planned jobs; jobs paid in the month; and the month's recorded income that pays for work (paychecks and payouts of tracked income, cash tips and session cash, job payments), taken from the same recorded entries as Activity's summary (`recordedEntries`), so it is listed, never added again. Fixed income is never listed as earnings. `hasEarningsData` is true with any shift, session or job. `possibleEntries` lists possible income in a range, never counted.
  - **Interface (Activity, no new tab):** after the month summary, an Earnings card appears only with earnings data: earned from work, hours, effective hourly, jobs paid, not received yet and received for work, with a line that earnings count only when received. Details opens a read-only sheet: work per income item, not received yet (by platform; done and planned jobs) and the month's received list. A Possible list (E1 income not received this month, opening its sheet to resolve it) appears when there is some. Without earnings data or possible income, Activity is unchanged.
  - **Not built:** reconciliation of earned versus paid per paycheck, per-week totals, reports beyond Activity, platform integrations, partial payments, reminders.
  - Tests: `earnings-history` (11, domain: earned versus received, effective hourly, tips, jobs and payment states, waiting for payout, corrected and undone payments, several incomes, empty and partial history, no double counting, possible income), `earnings-e5` (4, interface: hidden without data, figures, read-only details and month browsing with nothing saved, possible income).

- **E6. Income integration and verification (complete, October 2026; merged as `70f4248`). Phase E is complete.** Verification of E1–E5 together, with corrections only for confirmed defects; no new income features.
  - **Fixture:** `incomePlan()` (`src/state/supabase/__tests__/fixtures.ts`): the rich plan with possible income (a recurring item and a one-time), tipped shifts paid by an early, different-amount paycheck, freelance jobs (paid, planned and possible, pending) and gig sessions (paid and waiting, with cash). It joins `allPlans()`, so every storage test that runs over the shared plans now runs it too.
  - **Integration matrix** (✓ verified by an automated test; "CI" runs only in CI, which has the Supabase CLI):

    | Behavior | Device and backup | Supabase rows / fake API | PostgreSQL (constraints, RLS, ordinary saves) | Supabase local stack (API) | Firebase (legacy) |
    | --- | --- | --- | --- | --- | --- |
    | Expected and possible income | ✓ `certainty-persistence`, `income-integration` | ✓ `rows`, `income-integration` | ✓ `integrity` E1, `equivalence` | ✓ CI `adapter.supabase` | refused ✓ |
    | Hourly and tipped income, shifts, cash and card tips | ✓ `shift-persistence`, `income-integration` | ✓ | ✓ `integrity` E2, `equivalence` | ✓ CI | refused ✓ |
    | Freelance clients, jobs and payments | ✓ `freelance-persistence`, `income-integration` | ✓ | ✓ `integrity` E3, `equivalence` | ✓ CI | refused ✓ |
    | Gig sessions, platform earnings and payouts | ✓ `gig-persistence`, `income-integration` | ✓ | ✓ `integrity` E4, `equivalence` | ✓ CI | refused ✓ (message now names gig) |
    | Earnings history and recorded Activity | ✓ `income-integration` (identical after every storage) | ✓ | ✓ `equivalence` (five days), `integrity` E6 | ✓ CI | — |
    | Corrections, undo, recorded vs expected date and amount | ✓ domain tests per checkpoint | — | ✓ `integrity` E6: seventeen ordinary saves (correct a paycheck, including to an earlier date, undo and re-record it; edit and delete shifts; unpay, re-link, edit and unpay sessions; undo and re-record a job payment; date a pending job; delete a job and a client; mark possible income expected), each read back exactly with identical figures and every link intact | ✓ CI (undo a payout in an ordinary save) | — |
    | Several incomes together; totals, timing gaps, cash flow | ✓ `income-integration` (each dollar once; removing all work changes no counted figure) | ✓ | ✓ `equivalence` | ✓ CI | — |
    | Damaged or unsupported records on restore or load | ✓ `income-integration` (broken links and impossible work dropped, every money record kept, figures unchanged) and per-checkpoint `migrate` tests | ✓ `checkForMigration` | ✓ constraint tests per checkpoint | — | — |
    | Row-level security and account deletion | — | — | ✓ `security`, `account` include `work_entries`, `clients`, `freelance_jobs` | ✓ CI browser test (another account reads nothing) | — |

  - **Defects found and corrected:**
    1. `redefineSource` (editing an item that hasn't started and has nothing recorded) skipped the rule that logged work keeps its income's type. A tipped job with a shift logged before its first paycheck could be changed to Fixed or Gig: the save succeeded, the next device load silently dropped the shift, and Supabase refused every later save. It now refuses with the same message as `setIncomeDetails` (one shared check, `loggedWorkKeepsType`).
    2. The legacy Firebase refusal (`INCOME_DETAIL_NOT_STORED`) predated E4 and didn't mention gig income or sessions; it now does. Behavior was already correct.
    3. (From review.) A paycheck or payout corrected to an earlier date stayed linked to shifts or sessions worked after that date, so they showed "Paid in…" and were left out of "not received yet". One rule now decides whether a recorded paycheck can have paid work (`canHavePaid`: the same income, received on or after the day the work was done) and is applied wherever a link can go stale: `correctActual` unpays work after the new date; `editShift` unpays a shift moved past its paycheck; `setShiftPaid` refuses a paycheck that came first (the shift sheet already offered only later ones); and `migrate` drops such a link from stored data on load. The payment's record, date and amount and every cash-flow figure are unchanged; a correction to a later date links nothing new (recording does that, and a shift can be marked paid by hand).
  - **Not changed (limitations):** a Supabase workspace saved before fix 3 keeps a stale link until that shift or paycheck is changed (the database has no rule for it; device storage repairs on load). The Supabase browser test covers income through the API and the cross-account check, not by driving the income screens (the screens are storage-independent and covered on device storage). Hosted Supabase was not tested.
  - Tests: `income-integration` (18, five for fix 3: earlier and later corrections, undo, shift moves and manual links, repair on load, earnings history), `earnings-e5` (one more: the corrected paycheck in Earnings and on the income's shifts), one PostgreSQL lifecycle test in `integrity.db.test.ts` (seventeen ordinary saves, including a correction to an earlier date, with no stale link after any step), the income plan in `rows` and `equivalence` (which now also compares Activity, earnings and income-table row counts), and one local-stack case in `adapter.supabase.test.ts` (CI).

#### AC. Accounts (where money is received, held and spent)

Specification: PRODUCT_EXPERIENCE.md section 11. Each phase is separately authorized. None adds bank connections, real transfers or automation.

- **AC1. Foundation (complete, October 2026).**
  - Three account types.
  - The `Account` entity, with create, rename and view in Settings.
  - Optional assignment of recurring items (form) and one-time items (domain) to an account whose type suits them.
  - Validation on load, device storage and backups.
  - Firebase and Supabase guarded (below).
  - No forecast change.
- **AC2. Assignment where people already work (complete, October 2026).**
  - An item's account shown on its row; an account choice on one-time items.
  - Deleting an account: one confirmation when unused; when items are assigned, the confirmation names the count and the items stay, unassigned. Refused while a transfer references the account.
  - Not built: changing an account's type. Every account keeps the one type it was created with (Account Distribution & Cash-Flow Architecture, Phase 2); a different type is a new account.
- **AC3. Transfers (expected and recorded) (complete, October 2026).**
  - `Transfer` (id, source, destination, amount, date, `expected` or `recorded`, audit times) with `addTransfer`, `recordTransfer`, `updateTransfer` and `deleteTransfer`; one atomic entry per transfer, so no one-sided record exists.
  - Any direction between two different accounts (corrections and rebalancing included). Never income or spending; the forecast never reads transfers.
  - A planned transfer stays planned until recorded; Home lists those due (Needs attention) and this week's (Coming up). Recording takes the amount and date it actually had.
  - Not built: recurring or rule-based transfers ("each payday, move $X"). Entering them with minimal effort is still an open product decision (below).
- **AC4. Strategic Reserves as an internal allocation (complete, October 2026).**
  - Decided by the Development-State Directive: reserve allocations lower available cash flow and the running total, and are never external outflows. Releases ("Use reserves") return money to available cash flow.
  - Six classifications: `reserve` replaces `savings`; `varied` (Varied Spending, one-time only) replaces one-time bills. No migration of sample data; a document with retired kinds isn't loaded (its copy is kept).
  - Totals split into income, outflows and net reserves (operating and available cash flow; FINANCIAL_ENGINE.md).
- **AC5. Account balances (partly complete, October 2026).**
  - Done: optional opening balances, recorded and projected balances per account (`balances.ts`), and the shortfall a planned transfer would cause in its source account. Reserve items move no balance.
  - Not built: account-level availability ("enough in Bills for rent"), balance-based forecasts or alerts, and the "cash available now" starting amount for the running total (decision Q6).
- **AC-S. Accounts in Supabase (complete as F1, October 2026; merged as `3de2938`).** Complexity: **medium**.
  - `accounts` and `transfers` tables with workspace ownership and row-level security; nullable `account_id` on sources and one-time records; a `release` flag on one-time records; opening balances.
  - `load_plan` / `save_plan` carrying them; remove the adapter's refusal.
  - Tests: `test:db`, `test:supabase`, `e2e:supabase`.
  - Belongs with Phase F unless authorized earlier. The kind constraints already match the six classifications (migration `20261018000002`).
- **AC6. Payoff support.** Using existing liability information and the cash-flow index to help decide when to deploy reserves. Needs liability payoff amounts, which aren't stored today, and its own specification.

**Conflicts and open decisions:**
1. ~~Six classifications vs five kinds~~ and 2. ~~Savings as money out vs the transfer rule~~: resolved by AC4.
3. ~~"Account" means two things in the interface~~: resolved (product-owner decision, F2): the sign-in card is "Sign-in & Security"; "Accounts" means financial accounts.
4. **Liabilities are defined with a payoff amount and date, but liability items store only payments.** Needed before AC6.
5. **Storage.** Accounts, transfers and reserve releases work with device storage and in backups. Firebase (legacy, rules can't change) leaves accounts and transfers out and keeps releases; Supabase stores all three since F1, and its build offers accounts and "Use reserves". Signed-in Firebase users don't see accounts.
6. **Planned transfers with minimal effort.** Each planned transfer is entered once today. A repeating plan ("each payday, move $X to Reserves") needs rules for how it's generated, edited and recorded; not built until those are decided.
7. **Opening balance on the same day.** An opening balance is the balance at the end of its day, so a transfer recorded on that same day is treated as already included. Clear in the form's wording; revisit if it confuses people.

#### F. Infrastructure resumption (planned in F0, revised October 22, 2026)

Phase F carries out Step 10 (10b–10e) on the architecture decided in AGENTS.md section C1: Supabase for data and sign-in, Vercel for hosting, online-first, Firebase and Cloud Run retired. Each checkpoint is separately authorized. No hosted deployment and no spending happen until separately authorized.

**Product-owner clarification (October 22, 2026): Financial OS has no real users and no production financial data.** Every existing record, in Firebase, Supabase or on a device, is development or sample data. So, for the rest of the roadmap:
- No historical data migrations, data-preservation layers or backward-compatibility mechanisms for development records. Existing Firebase and Supabase test data may be discarded or reset.
- The simplest correct production-ready schema and architecture come first. Schema migrations stay, for reproducible deployment.
- One production stack: no parallel Firebase and Supabase period for a user transition that doesn't exist.
- Security, row-level security, ownership checks, financial correctness and automated tests are kept in full.

**F0. Production readiness and infrastructure plan (complete, October 2026; documentation only).**

*Verified current architecture (repository, `main` at `70f4248`):*
- **Hosting today:** a static Vite PWA served on Cloud Run by `server.mjs` (`Dockerfile`; deployed by hand or by AI Studio, region us-east5; no deployment in CI). The server adds caching rules, two security headers (`nosniff`, `strict-origin-when-cross-origin`; no content security policy) and forwards Firebase's sign-in pages (`/__/auth/*`) through the app's own address. Data: device storage, or with accounts on, Google sign-in (Firebase Auth) and one Firestore document per person, with an offline device copy (`cloud.ts`).
- **Firebase accounts can't hold** possible income, income detail or accounts and transfers (three flags in `src/state/features.ts`). Everything built in Phase E and AC1–AC5 works only with device storage today.
- **Supabase:** eight migrations, nine tables with row-level security and no direct writes, four functions with fixed search paths; an online-first adapter; email-and-password accounts (confirmation, recovery, sessions, sign-out, account deletion). Tested on PostgreSQL 16 (`test:db`) and in CI on a local stack (`test:supabase`, `e2e:supabase`). Compiled only into the `supabase-dev` and `supabase-hosted-test` builds: **no production build uses it yet**.
- **Gaps:** accounts, transfers, opening balances and reserve releases aren't stored in Supabase (AC-S, refused by the adapter); the hosted-test guide lists three of the eight migrations and `verify.sql` skips the three income tables; production sign-in is Google, the Supabase build email and password.

*Checkpoints (in order; each its own pull request and authorization):*

| Checkpoint | Scope | Depends on | Needs the product owner |
| --- | --- | --- | --- |
| **F1. AC-S: accounts, transfers and Strategic Reserves in Supabase** | `accounts` and `transfers` tables (ownership, row-level security), `account_id` on items and records, opening balances, the `release` flag; `load_plan` / `save_plan`; the adapter's refusal removed; accounts and "Use reserves" offered in the Supabase build; `verify.sql` and the hosted-test guide brought up to every migration and table | — (repository only) | Authorization only |
| **F2. Production Supabase build** | A production build that uses Supabase, configured by environment (URL and publishable key, never a service key), with Firebase left out; anonymous identities off; the "Account" wording settled; `vercel.json` (app routes to `index.html`, today's caching and security headers, plus a content security policy). Optional, since no hosted database exists yet: consolidate the migrations into one baseline | F1 | Sign-in methods (decision 4), wording (decision 5) |
| **F3. Hosted test project** | A Free Supabase project created by the product owner; the baseline migration applied; the focused hosted verification passes: database checks (schema and functions against the baseline, `verify.sql`, the security advisor, row-level security and ownership) and `npm run test:hosted` through the project's real Auth and API with two disposable identities (Auth settings, signed-out denial, persistence with identical forecasts, revision conflicts and retries, cross-account isolation, sessions, account deletion); disposable accounts and data removed. The local and CI suites stay unchanged and are not re-run against the hosted project | F1 | Creates the project; Auth settings; network access for the session; no payment |
| **F4. Vercel preview** | The F2 build on Vercel against the test project; installability; real iPhone and Android: sign up, confirm, reopen, change, see it saved; offline shows unsaved | F2, F3 | Creates the Vercel project |
| **F5. Production launch** | A production Supabase project (migrations verified; confirmation on, anonymous off, redirect URLs, rate limits, SMTP) and the production Vercel deployment; launched empty | F4 | Plans and spending (decisions 1–2), domain (3), region (6), launch date |
| **F6. Retire legacy** | Directly after F5 is verified, with no parallel period: remove `cloud.ts` (offline sync, 10c), `firebase.ts`, Firestore rules, emulator tests and CI job, `server.mjs`, `Dockerfile`, the three Firebase flags and Firebase-only docs and wording; the product owner deletes the Firebase project and Cloud Run services | F5 | Deleting the Firebase project and Cloud Run services; CI goes from five checks to four |

AC5 (remaining) and AC6 stay outside Phase F.

*Security and data-integrity risks to manage:*
- Row-level security or grants missing on a new table (F1 updates `verify.sql`; hosted runs execute it).
- A privileged key in a build: only the publishable key is ever used; the code refuses a secret or service-role key, and none is needed (account deletion runs in the database).
- Auth settings differing between local and hosted (confirmation, anonymous sign-ins off, redirect allowlist, rate limits, SMTP): checked in F3 and again in F5.
- No content security policy today (added in F2).
- Backups: the Free plan has no usable backups; production uses Pro daily backups once real data exists.
- Data integrity is tested in depth (revision checks, save receipts, removal limits, equivalence, ordinary-save lifecycles).

*Operating costs (USD per month; verify on the providers' pricing pages before deciding):*

| Stage | Supabase | Vercel | Email (SMTP) | Total |
| --- | --- | --- | --- | --- |
| F3–F4 testing | Free: $0 (500 MB database, 50,000 monthly active users; pauses when idle; no usable backups) | Hobby: $0 (non-commercial use) | Provider free tier: $0 (assumption) | **$0** |
| Production, small | Pro: $25, including $10 of compute (one Micro instance); daily backups kept 7 days | Pro: $20 per deploying seat for commercial use; Hobby $0 if non-commercial | $0–$20 (assumption) | **about $45–$65** (or $25–$45 on Vercel Hobby) |
| Optional | Point-in-time recovery: from $100 (not needed at launch) | — | — | — |

Supabase's built-in email sender delivers only to the organization's team addresses, a few messages an hour: F3 sends no email, and a custom SMTP provider is needed by F5 (production) at the latest. Cloud Run and Firestore cost stops at F6.

*Launch and rollback:*
- Production launches empty; no data moves from Firebase, Supabase test projects or devices. Testers start fresh (a backup file still restores if someone wants one, through the existing Restore; nothing is built for it).
- Rollback before real data exists: redeploy the previous Vercel build; if the schema is wrong, reset the production project and apply the corrected migrations.
- Once real people use it: forward-only migrations, Vercel's previous deployments, and Pro daily backups.

*Decisions for the product owner (everything else is an engineering choice made within the checkpoint):*
1. Supabase plan for production and when spending starts (Free pauses and has no backups; Pro $25).
2. Vercel plan (Hobby only if non-commercial; Pro $20 per seat otherwise).
3. Domain: the Vercel default address or a custom domain (recommended before inviting testers, so the app's address never changes).
4. Sign-in methods at launch: email and password (built and tested), or Google sign-in as well (new work).
5. "Account" wording: sign-in account versus money accounts (AC conflict 3).
6. Supabase region (fixed for the life of a project).
7. SMTP provider and sending address.
8. When to delete the Firebase project and Cloud Run services (recommended: as part of F6, right after F5 is verified).

*Engineering choices (no separate authorization):* build-mode and environment names, `vercel.json` and headers, consolidating migrations before the first hosted project, applying migrations by CLI or SQL editor, test order, and how Firebase code is removed.

**Recommended next checkpoint after F0: F1 (AC-S).**

**F1. AC-S: accounts, transfers and Strategic Reserves in Supabase (complete, October 2026; merged as `3de2938`).**
- **Schema** (migration `20261022000005_accounts_and_transfers.sql`): `accounts` (name, type, optional opening balance as amount and date together) and `transfers` (two different accounts, amount, date, expected or recorded, a recorded time exactly when recorded), both owned by a workspace with row-level security, read-only grants and no direct writes; `account_id` on items and records and `release` on records, with checks: an assignment suits the item's kind, a recurring occurrence carries an account only once recorded, a release only on a one-time Strategic Reserves record. Account references are checked at commit, so a save replaces accounts and the items naming them in any order.
- **Functions:** `load_plan` and `save_plan` carry the new tables and columns; a save must include `accounts` and `transfers`; references must point into the plan and assignments must suit their kind; an ordinary save removes at most one account and one transfer, as for every other collection. Nothing else changed.
- **App:** `rows.ts` maps them both ways and `checkForMigration` names what the database would refuse; the adapter's refusal (`hasAccountData`) is gone; the Supabase build offers the Accounts section and "Use reserves". No compatibility code: nothing existed to preserve.
- **Hosted tooling:** `verify.sql` covers all eleven tables (27 checks); the hosted-test guide applies every migration in order.
- **Not changed:** device storage, backups and Firebase (which still leaves accounts out). The "Account" wording conflict (sign-in versus money accounts, now both in the Supabase build's Settings) is decision 5, for F2.
- Tests: `accounts-persistence` (Supabase round trip with balances and timeline; what the database would refuse), `integrity.db` (round trip, thirteen ordinary saves of every account and transfer operation with identical balances and figures, removal limits, constraints, another person can't read them), `security.db` and `account.db` (row-level security and account deletion cover both tables), `rows` and `equivalence.db` (an "everything" plan with every kind of income, accounts and transfers), `money-accounts` (the Supabase build offers accounts and "Use reserves"); `adapter.supabase` and the cross-account browser check run in CI.

**F2. Production Supabase build (complete, October 2026; in review).**
- **Build:** a `supabase-production` mode (`npm run build:supabase`, output `dist-supabase/`). Supabase storage and the existing email-and-password accounts, configured only by `VITE_SUPABASE_URL` (https, never this machine) and `VITE_SUPABASE_ANON_KEY` (publishable or anon; a secret or service-role key stops the app before anything renders). Firebase code, settings and project id are compiled out, as are the development banner and hosted-test allowlist; the session has its own storage key. The default (Firebase, Cloud Run) and development builds are unchanged.
- **Wording (product-owner decision):** the sign-in card is "Sign-in & Security"; "Accounts" means only financial accounts. Google sign-in stays a separate decision.
- **Vercel (prepared, not deployed):** `vercel.json` builds `build:supabase`, routes app paths to `index.html` but never a missing asset, keeps the Cloud Run server's caching (app shell re-checked, hashed assets a year) and its security headers, and adds a content security policy (own scripts and styles only, `https://*.supabase.co` for data, `data:` images, no framing, no plugins), `X-Frame-Options`, HSTS and a permissions policy.
- **Verified without any account:** `npm run e2e:production` serves the production build with `vercel.json`'s rules and checks in Chromium the sign-in screen, the service worker and manifest, routing, caching and headers, that nothing leaves the app before sign-in, and that every screen (the device build, same components, with sample data) renders with no resource blocked by the policy; it runs in CI's browser job, so CI keeps five checks. A deliberately broken policy fails it.
- **Not done (later checkpoints):** a hosted project (F3), a Vercel project and deployment (F4), production auth settings and launch (F5), removing Firebase and Cloud Run (F6). Migrations consolidated in F3.
- Tests: `production` (configuration checks, the build at runtime, `vercel.json` rules), `target` and `dev` (unchanged checks under the renamed entry point), `e2e:production`.

**F3. Hosted test project (in progress, October 2026).**
- **Migrations consolidated:** one baseline, `20261022100000_baseline.sql`, replaces the nine development migrations. No hosted database ever ran them and there is no data to carry over, so a new project applies one file. A database built from it is identical to one built from the nine (`pg_dump` of tables, constraints, indexes, policies and function bodies, plus every table and function grant, compared). Financial rules and functions are unchanged; `load_plan`, `save_plan`, `create_workspace` and `delete_account` are copied verbatim. The test of the retired savings-to-reserve data conversion is removed with the migration it tested.
- **Verified locally:** `test:db` on a fresh database from the baseline; `verify.sql` on a fresh database, all 27 rows `ok`. CI runs the local-stack suites from it. These are not hosted results.
- **Hosted test project:** Financial OS 2 (`aymombliohuwbokpncdn`, us-west-2, Free plan), chosen by the product owner and approved in `supabase/hosted-test/projects.json`. Restored from paused; it held no tables, users or migrations. Applied through the Supabase connector: the baseline's tables, row-level security, policies, `create_workspace` and `load_plan` with their grants, and the test marker. The connector stalls on statements that contain deletes (it waits for a confirmation), so `save_plan`, `delete_account` and their grants go in through the SQL editor (product owner).
- **Acceptance simplified (product-owner decision):** a focused hosted verification replaces running every local suite unchanged against the hosted project. No test outbox, email hook, custom email provider or raised rate limits. `npm run test:hosted` (`verification.hosted.test.ts`, `scripts/test-hosted.mjs`, `vitest.hosted.config.ts`) signs in as two disposable `@example.test` accounts created confirmed through Supabase's supported user management (dashboard Add user with Auto Confirm User, equivalent to the Auth Admin API's `email_confirm: true`; never rows written into the managed Auth tables, never a personal account) and deletes them at the end; the runner keeps every hosted guard (allowlist, exact address, marker, public key only) and reads no email. The local and CI suites are unchanged.
- **Hosted database verification (passed, 23 October 2026):** the product owner installed `save_plan`, `delete_account` and their grants (through another Supabase connection). Then, through the connector: a catalog fingerprint of every table, column, default, constraint, index, policy, table grant, function definition (body, security, search path) and function grant matches a fresh database built from the baseline exactly (290 items, same hash); nothing else in `public` but the test marker and Supabase's own `rls_auto_enable`; `verify.sql` 27/27 `ok`; the security advisor shows only the expected findings (`save_receipts` has no policy by design; signed-in users may call the definer functions, each of which acts only on the caller); the performance advisor notes seven composite foreign keys without a covering index (informational; schema unchanged in F3). Ownership probes as the real roles, leaving nothing behind: signed out, every table and function refused (42501); signed in without a user id, every write function refused (PT401); signed in as an unknown user, every table reads empty, `load_plan` is null, `save_receipts` refused, direct inserts and updates refused (42501), `create_workspace` refused for a user that doesn't exist (23503), `save_plan` without a workspace refused (PT404), `delete_account` without a live session refused (PT401). The install recorded two entries in Supabase's migration history (`f3_save_plan_function`, `f3_delete_account_and_function_grants`) that don't match the repository's one baseline; harmless for this test project, which isn't managed with `supabase db push`; production (F5) applies the baseline as a single migration.
- **Running it from GitHub Actions (product-owner decision):** the session's environment settings can't be changed from the phone app, so the hosted verification runs from a manual workflow (`hosted-verification.yml`, `workflow_dispatch` only, separate from the five CI checks) with the fixed accounts and one repository secret, `SUPABASE_HOSTED_TEST_PASSWORD`, mapped to both password variables; the dispatcher types the project ref as the destructive-test confirmation.
- **Waiting on the product owner:** the Auth settings (confirmation on, minimum password length 8, anonymous and other providers off); the two disposable accounts, created in the dashboard, with their addresses and passwords in the session environment's settings (no available tool can create Auth users without the secret key, which is never used); and network access from the Claude Code environment to `*.supabase.co` (currently refused). The hosted Auth and API checks (`npm run test:hosted`) have not run yet.

Fields ignored by R1–R2 can be dropped from the schema at the cutover.

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
- Git state: current branch (at the time of Step 0, `ccr-12ec4965-6tzwgr`; now `main`), uncommitted work, and whether work done elsewhere (AI Studio) has been pushed.
- `package.json` scripts, `package-lock.json` integrity fields, existing tests (`src/**/__tests__/`, `scripts/__tests__/`, `scripts/e2e-smoke.mjs`) and what they cover, test configuration (`vite.config.ts`, `vitest.rules.config.ts`, `src/test-setup.ts`), and CI (none existed at Step 0; it now runs, AGENTS.md section H).
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
- Forecast start anchor from earliest income (including back-to-back paydays and several paydays in one week).
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

**Superseded (October 2026).** The review rhythm built here was removed in H2 (decision Q3); Home replaces it. Kept as the record of the step.

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
- Scenarios computed by applying changes to a copy of the data and running the same `buildForecast`: extra liability payments, reserve allocations, one-time expenses, moved payment dates, and variable income.
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
- The shortest path to a useful forecast: the main income is enough; bills and debt payments next; subscriptions, reserves and other details can wait. No exhaustive profile, history, balances or categories are required, and nothing missing is invented.
- Say clearly that payments before the next payday aren't in the running total.
- Restore shows what will be replaced and offers a backup of the current data first; a refused or canceled restore changes nothing.
- A safe start-over: explicit confirmation, a backup offered first.

**Deferred** (not planned until the product owner asks): spreadsheet import, statement or PDF parsing, automatic categorization, recurring-rule discovery from imported history, and import batches. No bank connections or Plaid, ever (AGENTS.md section E).

**Tests**
- Minimum setup to a forecast with exact running totals; skipped optional steps; corrections; timing gaps.
- Backup round trips that reproduce the forecast, including review rhythm and estimate dismissals; damaged files; cancel; replacement with a copy offered; start over and recovery.

**Exit criteria**
- A person can reach a useful forecast with only their income (and ideally main bills), add the rest later, and recover from any replacement or reset with a backup.

## Step 9: Evaluate optional allocations and purpose-based accounts

Paused (October 2026) by the product experience decision. Only if the product owner authorizes implementation.

**Update (October 2026):** the separation between external cash flow and internal allocations is built (Strategic Reserves, transfers and balances; accounts phases AC3–AC5). What remains here is virtual paycheck allocations (money set aside for a purpose without a real account), without fixed percentages.

**Inspect**
- How reserves, transfers and balances are modeled (FINANCIAL_ENGINE.md).

**Build or correct**
- Virtual allocations, without requiring a real account per category and without fixed percentages.

**Tests**
- Reserved funds, money available to spend, obligations due before the next paycheck, insufficient income, user overrides.
- Transfers between a person's own accounts never count as new income or spending in consolidated totals.

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
  - Superseded in part (H2, October 2026): batch Undo, `undoBatch`, `reviewEntries` and the review sheet were removed; batches take only items due today or earlier, from Home's Needs attention (tests now in `batch` and `ui/home`).
- **Step 4: complete with follow-ups.** Dashboard warning → explanation of each timing gap (`explainTimingGaps`, `gaps.tsx`) → What if… for one outstanding item: move, change amount, or skip (`previewChange`, `WhatIfSheet.tsx`) → confirmation → the change applied to that one occurrence (`applyPreviewedChange`). Previews never save; Apply needs confirmation, is refused for stale previews and for previews that can't be compared (the next payday moves, or a payment moves to before it), and states it changes only the forecast. Skipping a liability payment says the debt and what is owed don't change. Previews cover the period being viewed, never less than 90 days. Tests: `gap-explanations`, `preview`, `gaps-sheet`, `whatif-sheet`, and an end-to-end step.
  - Follow-ups: one change at a time (no combined scenarios); the app doesn't suggest which change to try; the setup review's gap banner explains gaps but has no What if…; shortfalls before the next payday stay outside the running total (cash on hand is unknown).
- **Step 5: complete for device storage.** Signed-in (Firebase) accounts keep it off; see below. Review rhythm in Settings (off, weekly, on payday, monthly look-ahead), a quiet dashboard entry when a review is due, and a review sheet from `reviewSummary` with Mark review done and Skip (neither records payments; closing leaves it due; a different rhythm starts fresh). Nothing is sent outside the app. Tests: `cadence`, `review-persistence`, `period-review`, rules tests, and an end-to-end step.
  - **Superseded (H2, October 2026):** the rhythm, its Settings control, the review sheets and `REVIEW_RHYTHM_IN_ACCOUNTS` were removed with their tests; a saved `review` field is dropped on load.
  - Accounts: the updated `firestore.rules` (optional `review` field) aren't confirmed deployed, so `REVIEW_RHYTHM_IN_ACCOUNTS` (`src/state/features.ts`) keeps the rhythm hidden when signed in and out of account saves, so no save is refused. With Firebase now legacy, the rules won't be deployed and the flag stays false; signed-in review rhythms arrive with the Supabase migration (Step 10b).
- **Step 6: complete with follow-ups.** Interface: a suggestion line on the item's card (bills, subscriptions, liability payments) opens a sheet with the amounts, start date, method, explanation, limitations, the payments behind it, a forecast preview (`previewEstimate`), and Approve (with confirmation) / Dismiss / Not now. Tests: `ui/estimate-sheet`, an end-to-end step. Foundation: `estimates.ts` compares each recurring bill, subscription and liability payment's recorded payments with its estimate (steady, rising, falling, variable and seasonal rules, unusual payments left out, at least 3 payments, at least $5 and 5% difference) and returns explained suggestions with their payments, confidence and limitations. `approveEstimate` applies one through the schedule operations from the first payment that keeps the schedule's dates; `dismissEstimate` keeps the estimate and holds the suggestion back (`estimateDismissal` on the item). Income and savings aren't estimated; what income history could support is recorded in FINANCIAL_ENGINE.md. Tests: `estimates`, `state/estimate-persistence`.
  - Follow-ups: suggestions appear only on the item's card (no list across items, by design); the separate buffered planning estimate this step describes isn't built (suggestions only round up to a dollar); variable income.
- **Step 7: complete with follow-ups.** Interface: **Explore a scenario** on the dashboard opens a sheet to add, edit and remove several changes (from existing payments where possible), compare the scenario with the forecast, see the first new or deeper shortfall even when the ending improves, and compare low, expected and high income. Nothing is saved; there's no way to apply a scenario. Tests: `ui/scenario-sheet`, an end-to-end step. Foundation: `evaluateScenario` applies several changes (one-time income and expenses, extra and higher liability payments, savings, moved dates, changed amounts, hypothetical recurring income) to a copy with the ordinary operations and compares it with the plan through `buildForecast`: assumptions, cash flow with hypothetical income separate, lowest and ending running totals, gaps with recovery dates, differences, and new or deeper shortfalls even when the ending improves. Changed paydays and moves before payday aren't compared. `evaluateIncomeCases` gives low, expected and high cases from amounts the person supplies. Tests: `scenarios`.
  - Follow-ups: applying a scenario to the plan; saving scenarios; scenarios can't change an item's schedule (only its amount from a date), turn an item off, or change a recurring item that already has a later change set; one-time liability items exist only inside scenarios.
- **Step 8: complete (revised to manual-first).** Setup now says which steps are optional, offers **Skip to review** once there's income, and the review says when payments fall before the running total starts. Restore shows how many items will be replaced and offers a backup of the current data first. **Start over** (Settings) erases everything after confirmation, keeps the review rhythm (since removed, H2), and offers a backup first (`startOver`). Fixed: the review's section labels used ids with spaces, so "Liability payments" had no accessible name. Imports are deferred. Tests: `onboarding`, `backup-restore`, `start-over`, `state/backup`, an end-to-end step.
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
- **Product reduction audit: complete (documentation only, October 2026).** The philosophy and information model are in AGENTS.md section A. [docs/REDUCTION-AUDIT.md](docs/REDUCTION-AUDIT.md) has the feature inventory and classifications, ranked recommendations, verified defects D1–D5, the proposed structure (This week, Forecast, Activity, Plan) and decisions Q1–Q7. The phases above were revised to match.
- **Phase A1: complete (October 2026).** The running total starts the day before the earliest outstanding or received-today income from any active recurring source, so entry order and the main paycheck no longer decide it (defect D1). Overdue income counts the same for every source; one-time income, inactive sources and hypothetical scenario income don't start it. Setup's first-period cash flow, lowest running total and before-payday note start from the same point (defect D2, `firstPeriod`). Pay periods still follow the main paycheck. Tests: `forecast-start` (15), the updated `forecast` anchor test, a setup test in `setup-timing-gaps`, and a browser step in the e2e smoke test.
- **Accounts AC1: complete (October 2026).** Income, Distribution and Payment accounts (`types.ts`, `addAccount` / `renameAccount` / `assignAccount`), an Accounts section in Settings, an optional account on recurring item forms, validation on load, device storage and backups. Firebase saves leave accounts out (`ACCOUNTS_IN_SIGNED_IN_SAVES`) and the Supabase adapter refuses them, so nothing is silently dropped. The forecast never reads accounts. Tests: `accounts` (domain), `accounts-persistence`, `money-accounts` (UI), and an e2e step.
- **Account distribution and cash-flow architecture: AC2, AC3, AC4 complete; AC5 partly (October 2026).** Six classifications (Strategic Reserves and Varied Spending); reserves lower available cash flow without counting as spending; operating and available cash flow; transfers (expected and recorded); optional opening balances with recorded and projected balances; account deletion; the account on item rows; transfers on the dashboard. Supabase kind constraints updated (migration `20261018000002`); Supabase still refuses accounts, transfers and releases (AC-S). Tests: `reserves-transfers` (25), updated `plan`, `accounts-persistence`, `storage`, `money-accounts` (AC2, balances, transfers, dashboard), a DB classification test, and an e2e transfer step. Next: AC-S with Phase F, or the planned-transfer decision (conflict 6).
- **A2 and H3: complete (October 2026), in one pull request against `main`.** D3 and D5 fixed with failing-first regression tests; Home, Forecast and Plan navigation with redirects from earlier addresses; Forecast's Week tab removed. No calculation changed. Details in Phase A2 and the H3 entry.
- **Home H1 and H2: complete, merged (October 2026).** PR #5, merge commit `fe8b13d`, on top of PR #4 (`3fac4ac`). Details in the H1 and H2 entries above. CI passed on both merge commits, and on integrated `main` the unit and component tests (665), browser smoke test, PostgreSQL (58) and Firestore rules (14) suites also passed locally.
- **Repository governance (October 2026).** `main` is the default and integration branch; work arrives through pull requests (AGENTS.md section H). The earlier working branch `ccr-12ec4965-6tzwgr` is merged and retired.
- **PR #4 integration verification (October 2026).** GitHub Actions CI added (`.github/workflows/ci.yml`): typecheck, lint, unit tests, build, browser smoke test, database tests, Firestore rules, and the Supabase integration and browser suites on a local stack, all green. An integration review found and fixed: the classifications migration failing on existing savings rows; recorded payments moving when an item changed accounts; projected balances leaving out items due before the opening day; "Use reserves" offered in the Supabase build, which refuses it; release amounts shown with the wrong sign on several sheets; an empty default destination in the transfer form; unbounded opening balances in storage. Each has a regression test.

## Open items

- **Cash before payday is unknown.** The running total starts at $0 the day before the next payday, so a shortfall caused by spending before that payday can't be shown. A product decision (for example, an optional "cash available now" amount); see FINANCIAL_ENGINE.md.
- **For the UI review** (calculations are consistent; how they are presented needs a look):
  - An early payment followed by a schedule change: both the payment and the new schedule's first payment count.
  - A schedule change whose start date falls after the next payment keeps that payment under the old schedule.
  - A canceled occurrence stays canceled while the new schedule's payment counts.
  - Deleting an item whose only saved change has been set aside is refused with a message about history that isn't visible.
- **Rare:** "twice a month" on two days that both fall on Feb 28 or 29 gives one February payment (deliberate, tested).
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
