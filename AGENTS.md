# AGENTS.md — shared instructions for every coding agent

This is the canonical source of project rules for Financial OS. Every agent (Claude Code, Gemini / AI Studio, Codex, or any other) reads this file in full before doing any work. `CLAUDE.md`, `GEMINI.md` and `CODEX.md` only point here; when they and this file differ, this file wins.

Read next: [BUILD_AND_TEST_ROADMAP.md](BUILD_AND_TEST_ROADMAP.md) (the order of work and its test gates), [PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md) (how the product should look, read and behave; the current priority), [README.md](README.md) (architecture, forecast rules, data model), [DESIGN.md](DESIGN.md) (visual system), [security_spec.md](security_spec.md) (Firestore guarantees) and [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md) (Firebase and Cloud Run setup for the current, legacy infrastructure).

---

## A. Product philosophy

Product-owner decision, October 2026. This section is the authoritative statement of the mission and philosophy; other documents point here.

**Mission.** Financial OS is a cash-flow operating system. It helps people establish practical, sustainable financial habits and strengthen their financial resilience, with greater financial independence as the long-term direction. People shouldn't need to become accountants, understand complicated financial concepts, or treat everyday money decisions like a second job. The software handles the complexity wherever practical.

**Core philosophy.** Financial resilience is built through repeated, sustainable financial habits. Good habits, kept up over a long enough time, produce results that reinforce further progress. Financial OS makes those habits easier to establish, repeat and maintain: it helps people understand their circumstances, anticipate changes, make informed decisions and learn from what actually happened, without constant attention, unnecessary data entry or elaborate routines.

**Three objectives.** Every feature serves at least one:
1. **Establish** a reliable financial system that accounts for income, obligations, available money and changing circumstances.
2. **Simplify** keeping that system up: automation, clear information, sensible defaults, straightforward actions.
3. **Strengthen** the habits and decisions that improve financial resilience over time.

Financial independence is the long-term direction; financial resilience is the practical capability people build along the way.

**Governing standard.** *Financial OS should make managing money easier than not using Financial OS.* Judge this by real workflows, not by feature counts or visual minimalism.

**Operating philosophy.** Deliver about 80% of the practical benefit for about 20% of the effort, for the person using it and in how features are built. It's a way of choosing what to build and how much to ask of people, not a numerical scoring system for features.

### A1. Information model

Three complementary perspectives, each with its own job. They complement one another and don't duplicate information.

| Perspective | Question | What it is |
| --- | --- | --- |
| **Projections** | What's possible? | The consequences of expected income, expenses, obligations and planned decisions: running totals, timing gaps, scenarios. Projections are never confirmed transactions, and people are never asked to confirm future amounts or dates that can't reasonably be known before they happen. |
| **Recorded activity** | What happened? | The factual history of financial events, kept distinguishable from projections. It preserves financial accuracy (original expectation, latest expectation, actual; section D) without imposing administrative work, and lets people see outcomes, patterns and the consequences of earlier decisions. |
| **Home and the week view** | What do I do now? | Connects recorded activity with upcoming projections for the current week: what has happened, what's expected next, what needs attention, what may need a decision. Home is the opening screen and carries the week view (implemented in roadmap H2). It's an intentional part of the product, never removed just because a continuous forecast exists, and never an extra budgeting system, administrative checklist or redundant dashboard. |

*Projections show what's possible. Recorded activity shows what happened. Home and the week view help people see what to do now.*

**Home priorities, in order:** (1) progress (how cash flow is changing), (2) actions that need attention, (3) relevant upcoming activity. Recorded activity from the week gives context below them.

### A2. Design principles

- **Decisions over data.** Prominent information helps people understand their circumstances or make a meaningful decision; supporting analysis lives in secondary views.
- **Actions over management.** Minimize repetitive input, configuration, confirmations and administrative work.
- **Clarity over completeness.** Show what's relevant; keep detail reachable.
- **Reality over artificial structure.** Support several income sources, overlapping or closely spaced deposits, irregular schedules, variable earnings and changing obligations. Don't force people into arbitrary income hierarchies or periods.
- **Honest forecasting.** Keep expected and recorded activity distinct. Future income amounts and dates can stay uncertain until the money arrives; never build workflows that demand impossible certainty.
- **Human language.** Plain, natural wording about practical consequences, not internal mechanics; no robotic encouragement, generic AI phrasing, needless reassurance or jargon ([PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md) section 2).
- **Simplicity through subtraction.** A feature must justify the complexity it adds. Remove, simplify or consolidate what doesn't; never remove essential functionality just to have fewer screens.
- **Complexity belongs in the software.** Internal sophistication is welcome when it improves reliability or saves effort; implementation details never become user-facing concepts.
- **Habits over administrative rituals.** Make useful, repeatable behaviors easier. Extra confirmations, checklists or review requirements are not habit formation.
- **Use what the system already knows; ask only for what's genuinely needed; show only what helps.** Don't repeat in text what the screen already shows, and don't add artificial engagement (streaks, mandatory check-ins, acknowledgements just to clear an item).
- **No unnecessary undo complexity.** Don't build visible undo histories, complex recovery workflows or extra interface states without demonstrated need. Keep the safeguards that prevent data loss or wrong financial records. A genuine financial correction (this wasn't actually paid; the amount was different) is an ordinary edit, distinct from undoing an interface action.

### A3. What this means in practice

- Model real life: changing dates, variable amounts, unexpected events and imperfect plans; do the calculation and coordination behind the scenes.
- Identify problems early enough to act on, and help people compare decisions and their consequences.
- Explain important recommendations briefly, with more detail on request.
- Preserve history: what was expected, what changed, what actually happened.
- Stay free of rigid budget philosophies, unnecessary categories, excessive notifications and unnecessary account setup.
- Keep the long-term direction (more resilience, more independence) behind the scenes: no mandatory stages, levels or milestones, and no financial scores or unrelated metrics. Cash flow is the primary measure.
- It's a projection tool for the big picture. It doesn't track every penny, and it doesn't show a bank balance.

Alpha, beta and general release are testing phases with growing groups of people, not separate feature sets. Let evidence from real users justify adding, simplifying, changing or removing features.

## B. Mandatory working procedure

Every agent, on every task:

1. Reads `AGENTS.md` (this file) before doing any work.
2. Reads the relevant project documentation and inspects the current implementation. Earlier descriptions of the code, including in this file, can be out of date; verify before relying on them.
3. Identifies the smallest coherent task that advances the roadmap, within what the product owner has authorized.
4. States the intended behavior, affected files, risks, and proposed tests **before** editing.
5. Establishes a test baseline for the affected area before changing anything (run the relevant tests and note the results, including existing failures).
6. Implements in small, reviewable increments.
7. Adds or updates tests alongside the implementation, in the same change.
8. Runs targeted tests during development.
9. Runs the required verification checks (section H) before declaring a code change complete.
10. Reviews the complete diff for regressions, duplicated logic, data loss, security concerns, and accidental scope expansion.
11. Reports exactly what changed, which commands were run, their actual results, what was not tested, and known limitations (section I).
12. Updates documentation (README, DESIGN, security_spec, this file, the roadmap) when the change alters documented behavior.

**Reasoning discipline** (for audits, recommendations and reviews):
1. No invented assumptions: evaluate actual requirements and implemented behavior, never claims attributed to the product owner that they didn't make.
2. Challenge with evidence: code, tests, documented requirements, observed behavior or sound reasoning.
3. Separate facts from interpretations: label findings **Verified**, **Inferred** or **Unresolved**.
4. No manufactured objections or speculative edge cases to appear critical, and no automatic agreement either: raise substantive objections when the evidence warrants them.
5. Stay within scope.

Challenge the reasoning, not a distorted version of the argument.

Never claim a test passed if it wasn't run. Never hide failing tests, skip or disable tests, or weaken assertions to get a passing result.

**Do not execute the whole roadmap in one session.** Work only on the specifically authorized task, finish its verification, report, and wait for the next instruction.

## C. Architecture rules

### C1. Architecture direction (product-owner decision, October 2026)

These decisions replace earlier infrastructure plans. Don't reopen them in a task; raise new evidence with the product owner instead.

- **Supabase is the future backend.** Supabase PostgreSQL will hold the authoritative financial data, and Supabase will provide authentication and data-access controls once authentication is built. The reason is the app's relational data, maintainability and long-term architecture, not only hosting cost.
- **Vercel will host the application.**
- **Online-first.** Financial OS will be an online-first PWA. The backend is the source of truth for saved data. There is no parallel offline database, no later synchronization, and no permanent device-copy conflict reconciliation. Temporary in-memory state is fine for editing, showing an immediate forecast and retrying a failed save. People are always told when a change hasn't been saved, and the app never reports a save the backend refused or failed. Installing the PWA and caching the app's own files stay.
- **Authentication is deferred** until the core financial features are finished. Deferring the sign-in screens never allows public access to financial records: once Supabase holds data, every record is limited to its owner.
- **The forecast engine stays independent of storage.** `src/domain/` never imports a storage provider; persistence stays behind `StorageAdapter`.
- **Firebase/Firestore, Cloud Run hosting and offline synchronization are legacy.** They keep the current version running and will be removed during the Supabase migration, not before. Until then: don't deploy Firestore rules, request Firebase credentials, add Firebase storage features or change Firebase sign-in. Keep the current app working, and keep the documentation needed to run it.

**Development order:**

1. Finish the core financial features (roadmap Steps 6–9).
2. Finalize and verify the data architecture.
3. Move persistence to Supabase.
4. Remove offline synchronization.
5. Complete authentication and per-user data isolation.
6. Deploy and test the finished application on Vercel.

The roadmap's Step 10 holds stages 2–6.

**Current priority (product-owner decision, October 2026).** The product experience comes first: financial correctness, clear workflows, natural language, a clean dashboard, reports, more kinds of income, mobile-first usability ([PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md), roadmap Phases A–F). Hosted Supabase testing, Firebase retirement, removing offline sync, Vercel deployment, further infrastructure and Step 9 are paused as a sequencing decision; the completed Supabase and security work is kept as the foundation and resumes as Phase F. A visual or wording change never changes a calculation, and a financial fix ships on its own with before-and-after tests.

### C2. Current implementation

Preserve the existing architecture; don't rebuild it without a reason the product owner has agreed to. As of this writing (verify before relying on it):

| Area | Where | Notes |
| --- | --- | --- |
| Stack | TypeScript (strict), React 19, Vite, vite-plugin-pwa | npm only; `package-lock.json` is committed |
| Domain logic | `src/domain/` | Pure TypeScript, no React. `dates.ts`, `money.ts`, `types.ts`, `recurrence.ts`, `occurrences.ts`, `forecast.ts` (`buildForecast` and everything derived from it), `operations.ts` (every state change), `plan.ts` (cash flow per period), `home.ts` (what Home shows, `homeView`), `balances.ts` (account balances and transfers), `preview.ts` (what-if previews), `estimates.ts` (estimate suggestions), `scenarios.ts` (several hypothetical changes), `sample.ts` |
| State and persistence | `src/state/` | `storage.ts` (`StorageAdapter`, validation, `migrate`), `store.tsx` (applies operations, background saving, conflicts), `cloud.ts` (account storage with an on-device copy; legacy), `firebase.ts` (Google sign-in and Firestore, loaded on demand; legacy), `account.tsx`, `backup.ts`, `mode.tsx` (sample vs real data) |
| UI | `src/ui/` | `screens/`, `components/`, a hash router (`router.ts`). Navigation (roadmap H3): Home (`#/home`, the opening screen), Forecast (`#/forecast`) and Plan (`#/plan/income`, `expenses`, `liabilities`, `reserves`), with Settings behind the gear. Earlier addresses (`#/dashboard`, `#/income` and the other kinds) redirect in `router.ts` |
| Hosting (legacy) | `server.mjs`, `Dockerfile` | Cloud Run serves the built app and forwards Firebase sign-in pages through its own address. To be replaced by Vercel |
| Data and sign-in (legacy) | Firebase | Google sign-in; Firestore document `financialData/{uid}` in the named database; rules in `firestore.rules`. To be replaced by Supabase |
| Future storage (not connected) | `supabase/`, `src/state/supabase/` | PostgreSQL schema, access rules and `load_plan` / `save_plan`, with the app-to-rows mapping. See docs/SUPABASE.md |
| Tests | Vitest + Testing Library (jsdom); Firestore emulator; Playwright | See section H |

Rules:

- **One forecast engine.** Financial calculations live in the shared domain layer. Dashboards, calendars, reports, alerts, and scenarios read from `buildForecast` (and helpers in `forecast.ts` / `plan.ts`); they never re-implement the math.
- **Integer cents** for all money arithmetic. Parse and format only through `money.ts`.
- **Date-only values** (`YYYY-MM-DD` strings) with the conventions in `dates.ts`: UTC-midnight arithmetic, Sunday-start weeks, month-end clamping. Results must not depend on the host time zone.
- **Deterministic and testable.** Domain calculations take "today" (and a clock, for operations) as inputs and never read the system clock themselves. The only clock reads in `src/domain/` are the `todayLocal()` helper the UI calls and ID generation.
- **State changes go through `operations.ts`** as pure functions that return new data or a validation error.
- **Before changing a persisted type or schema**, inspect and update together (the Firebase items stay on this list while the current version runs on Firebase; keeping them correct isn't new Firebase work): validation and `migrate` in `storage.ts`, backups (`backup.ts`), the on-device copy (`cloud.ts`), Firestore writes (`firebase.ts`), `firestore.rules`, `security_spec.md`, `firebase-blueprint.json`, and the rules tests. Existing data must keep loading; add migration tests.
- **Accounts in storage:** device storage and backups keep `accounts` and `accountId`. Firebase account saves leave them out while `ACCOUNTS_IN_SIGNED_IN_SAVES` is false (the live rules accept a fixed set of fields), and Supabase stores them (migration `20261022000005`, roadmap F1). Never drop them silently.
- **Firebase imports only in `src/state/firebase.ts`**, so device-only builds never download Firebase.
- **Keep the revision check** in both `firebaseBackend.save` (a transaction) and the rules (exactly +1). It stops a stale device from overwriting newer data.
- **No personal data in errors or logs** (email, uid, provider details, financial values).

## D. Financial correctness rules

The application must keep these distinct (the data model already does for occurrences; preserve it):

- the **original predicted** date and amount (`expectedDate`, `expectedAmountCents` — never modified after creation);
- the **current scheduled** date and amount (`scheduledDate`, `scheduledAmountCents`);
- the **actual** date and amount (`actualDate`, `actualAmountCents`);
- the **variance** between prediction and actual;
- **internal allocation or reservation** of funds;
- genuine **external** cash inflows and outflows.

Rules:

- Rescheduling or correcting an event never silently erases the original prediction.
- Recurring schedule changes have an explicit scope and effective date. Past occurrences keep the expectations that applied to them (today: schedule versions with a start date).
- No double counting between generated recurring occurrences and stored overrides. A stored record replaces exactly one generated occurrence (stable id `<sourceId>@<originalDate>`); a completed item counts on its actual date only; a rescheduled item counts on its new date only; a canceled item never counts.
- Transfers between a person's own accounts are not new income or spending in a consolidated view, and internal allocation of money is not, in itself, an external expense.
- **Strategic Reserves** (decided and implemented October 2026, Development-State Directive): a reserve allocation is money set aside, not spending. It lowers **available cash flow** and the running total, and is never counted in external outflows; a release (a one-time reserve marked `release`) returns money to available cash flow. Operating cash flow = income − external outflows; available cash flow = operating − net reserve allocations. Every forecast entry lands in exactly one of income, outflows or reserves (`totals`), so nothing is counted twice. FINANCIAL_ENGINE.md has the definitions.
- A low or negative **running total** is a forecast condition to explain (a timing gap), not a data error.
- **Accounts** (where money is received, held and spent; PRODUCT_EXPERIENCE.md section 11): exactly three types, Income, Distribution and Payment; names are the person's own; assignments are optional and must suit the item (`accountTypeFor`). Accounts never change a cash-flow figure.
- **Transfers** move money between two different accounts of the person's (`addTransfer`, `balances.ts`). They are never income or spending, the forecast never reads them, and each one changes two balances by the same amount. Expected and recorded transfers stay distinct: a passed date never records one, and nothing moves money automatically to cover a shortfall. Reserve allocations change no balance (only a transfer moves the money), so a reserve and its transfer are never counted twice. Balances exist only from an opening balance the person gave; without one the app never states a balance, and a projected balance is always labeled an estimate. Scheduled or rule-based transfers, routing and bank automation aren't built.
- **Where the running total starts** (decided and implemented October 2026, Phase A1): the day before the earliest eligible upcoming income, whichever source it comes from. Entry order never decides it. Uncertain or speculative income never sets the start.
- Batch confirmation applies only to the selected records. An event is never marked actual merely because it was expected.
- Undo, corrections, batch operations, imports, and resets never silently alter unrelated records.
- **Uncertain future income is never counted as confirmed cash flow** just because past income suggests it may arrive. Income counts in the forecast only when the person has entered it as expected (a recurring or one-time item) or recorded it.
- A calculated suggestion never replaces an approved forecast rule on its own. The person's current expectation stays in force until they approve a change.
- Historical averages are estimates, not facts. Consider how much history exists, outliers, seasonality, known changes, and user-adjustable buffers.
- Conservative forecasting (cautious income, buffered expenses) must follow an explainable rule the person can see and adjust. Never silently modify user-entered values or apply arbitrary percentages.
- Scenarios use the same forecast engine as the baseline, never alter the baseline, and state their assumptions and limitations.

## E. Product integration constraints

- **No Plaid or other direct bank-aggregation integration** is planned. Don't add one to the roadmap or the architecture.
- A **Sequence Financial Router** integration may be investigated only if paying customers show meaningful demand **and** the product owner explicitly authorizes the investigation. Don't add speculative integration hooks in the meantime.
- **Spreadsheet import and statement parsing** may be considered as user-initiated setup and maintenance tools. Imported data is previewed, validated, and reviewed before it's applied. Never invent missing dates or treat uncertain classifications as confirmed.
- The app doesn't need every transaction. The goal is a useful forecast with minimal maintenance.
- **Purpose-based allocations** may be useful, but never require a separate real bank account per subscription or category. Logical allocations can be enough. Recommendations are optional and sensitive to individual circumstances.
- **Scenarios evaluate the full timeline**, not just the ending number. A plan that improves the end result but creates a shortfall before then must reveal that shortfall.
- **Reset, import removal, and recovery** workflows are safe, understandable, and tested.

## F. User experience rules

Simple and mobile-first. Prefer:

- batch confirmation and editing;
- exception-focused review (show what needs attention, not everything);
- safe corrections through ordinary editing, and recovery from data loss (backups, restore), without elaborate undo (section A2);
- short contextual explanations, with optional deeper detail;
- sensible defaults;
- one opening screen that shows progress, what needs attention and what is coming, instead of repeated nagging or review rituals;
- clear distinctions between confirmed information, estimates, and suggestions.

Don't assume every subscription is unnecessary, every recurring expense is discretionary, or that everyone should follow the same financial strategy. Help people see what they can do **now** about a future problem.

Product terms are fixed; use them consistently in UI, docs, and tests:

- **Cash flow** — available cash flow for a period: income minus external outflows minus net Strategic Reserve allocations.
- **Running total** — the day-by-day cumulative total from the forecast anchor. Never call it a "balance".
- ~~Main paycheck~~ — removed (Phase R1, October 2026). All income sources are treated equally; entry order never decides where the running total starts.
- **Expected / Overdue / Done**, **Money in / Money out**, **Lowest running total**, **Timing gap**.

The six financial classifications are Income, Bills, Subscriptions, Liabilities (liability payments: card, loan, or line of credit), Strategic Reserves and Varied Spending. Bills, subscriptions and liabilities are recurring; varied spending is one-time. Use "Strategic Reserves", never "savings", and "liability", never the alternative term. No classification is labeled "other", "misc", or anything similarly vague. Tags are optional and created only by the person; none are built in.

Interface wording follows the voice and tone rules in [PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md) section 2: short, specific, about the person's money rather than the app's mechanics. Never use "debt" in the interface (say liability, loan, card, line of credit or payment), and add no budgeting terminology or budgeting features. Show information when the data makes it relevant (PRODUCT_EXPERIENCE.md section 5), and never hide a running total below $0.

Follow [DESIGN.md](DESIGN.md) for visuals and its accessibility rules (status never shown by color alone, 44px tap targets, focus management in sheets). In onboarding and marketing copy, say what something is rather than what it isn't.

## G. Testing standards

Use deterministic test data and fixed dates (pass "today" explicitly; pin the browser clock in end-to-end tests). Add a regression test for every bug found. A passing suite is not proof of correctness if important scenarios are missing.

**Domain tests** (`src/domain/__tests__/`)
- Known inputs with exact expected outputs in cents.
- Weekly, every-2-weeks, twice-monthly, monthly, and custom recurrence.
- Month ends, leap years, year boundaries; date-only behavior across time zones.
- Several events on the same day.
- Zero and negative running totals.
- Income arriving early, late, or in a different amount.
- Timing gaps between paydays.
- Recurring schedule changes and effective dates.
- Cancellation, rescheduling, actuals, stored overrides, and duplicate prevention.
- Original-prediction preservation and variance.
- Batch-operation correctness (due items only) and per-item corrections.
- Scenario consistency and internal-transfer handling (once those exist).

**Component and integration tests** (`src/ui/__tests__/`, `src/state/__tests__/`)
- A person can inspect a warning, understand its cause, edit an amount or date, confirm events, correct a recorded event, and see the forecast update.
- Loading, empty, error, offline, pending-save, conflict, and recovery states.
- UI shows shared domain output instead of duplicating financial logic.
- Mobile and accessibility behavior for important flows, where the setup allows.

**End-to-end tests** (`scripts/e2e-smoke.mjs`)
- Setup through forecast display; editing and confirming expected events; updated projections and warnings.
- Persistence, backup, restore, and recovery.
- Isolation from real financial data and production services (the e2e build runs with `VITE_ACCOUNTS=off`).

**Data and security tests**
- Local and cloud persistence, conflicts, refused saves.
- Backup and restore validation; sample-data isolation.
- Account lifecycle and deletion.
- Firestore rules against the emulator (`npm run test:rules`) — never a JavaScript copy of the rules.
- Migration safety for existing records.

## H. Verification commands

Check `package.json` before running anything; scripts can change. Currently:

| Command | What it does | Notes |
| --- | --- | --- |
| `npm test` | Vitest unit, component, and server tests | |
| `npm run typecheck` | `tsc -b` | |
| `npm run lint` | `tsc -b` plus a syntax check of `firestore.rules` | |
| `npm run build` | Type-check and production build | |
| `npm run e2e` | Builds a device-only copy and drives it in Chromium through `server.mjs` | Needs Playwright with Chromium |
| `npm run test:db` | Applies `supabase/migrations` to a throwaway local PostgreSQL and runs the database tests (`*.db.test.ts`) | Needs the PostgreSQL server binaries and `psql`. Plain PostgreSQL with a stand-in for Supabase's auth schema; see docs/SUPABASE.md |
| `npm run test:supabase` | Runs the Supabase integration tests (`*.supabase.test.ts`) through Supabase's real Auth and API, accounts included | The local stack by default (`supabase start` from the repository, with its email-testing server) and `SUPABASE_TEST_ANON_KEY`. An approved hosted test project only with `SUPABASE_TEST_TARGET=hosted` and the guards in docs/SUPABASE-HOSTED.md. Refuses service-role keys |
| `npm run e2e:supabase` | Builds the Supabase, default and device-storage copies and drives them in Chromium against Supabase (the local stack by default), accounts included | Same needs as `test:supabase`, plus Playwright with Chromium. See docs/SUPABASE.md |
| `npm run test:rules` | Runs `firestore.rules` in the Firestore emulator | Needs Java; the emulator is downloaded on first run. Kept while the current version uses Firebase; passing it doesn't authorize Firebase work |

For any coherent code change, run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` at minimum. Also run `npm run e2e` for user-facing flows, state changes, navigation, or persistence, and `npm run test:rules` for storage or security changes when the emulator can run. If a command can't be run, say so and why; never report it as passing.

**CI** (`.github/workflows/ci.yml`) runs on every pull request and on every push to `main`, in five jobs:
1. typecheck, lint, unit tests and build (`npm run typecheck`, `lint`, `test`, `build`);
2. the browser smoke test (`npm run e2e`);
3. the database tests on the runner's PostgreSQL (`npm run test:db`);
4. the Firestore rules on the emulator (`npm run test:rules`);
5. the Supabase integration and browser suites (`npm run test:supabase`, `e2e:supabase`) against a local stack started with the Supabase CLI (its public key only; never a hosted project).

When a command can't run in your environment, its CI job is the evidence; report which, and never report a check that didn't run.

**Repository practice**
- Use npm. Only change `package-lock.json` by running `npm install`; keep every entry's `resolved` and `integrity` fields. Never add `bun.lock` or another lockfile.
- **`main` is the permanent default and integration branch.** Start each feature or fix on its own branch from the current `main` (a stacked branch only when the product owner authorizes it), and open its pull request against `main`.
- Work reaches `main` only through a reviewed pull request, merged once CI passes on the final state being merged (re-check after a base change or retarget). Don't push directly to `main`.
- Pull before starting and before pushing. Never force-push or rewrite shared history; resolve routine conflicts with a merge.
- A finished branch is merged or closed; it's never documented as the place to work. (Before October 2026 the working branch was `ccr-12ec4965-6tzwgr`; it is merged and retired.)
- Commit messages describe the change and why. Keep each commit to one coherent change.
- Don't run the Vite dev server in production; Cloud Run runs `server.mjs` (`npm start`).

## I. Required completion report

Every implementation task ends with:

1. **Changed files and behavior.**
2. **Exact tests and commands run.**
3. **Actual pass/fail results** (counts where available).
4. **Tests or scenarios not run, and why.**
5. **Known risks and limitations.**
6. **One logical next step**, based on the roadmap's dependencies.
