# AGENTS.md — shared instructions for every coding agent

This is the canonical source of project rules for Financial OS. Every agent (Claude Code, Gemini / AI Studio, Codex, or any other) reads this file in full before doing any work. `CLAUDE.md`, `GEMINI.md` and `CODEX.md` only point here; when they and this file differ, this file wins.

Read next: [BUILD_AND_TEST_ROADMAP.md](BUILD_AND_TEST_ROADMAP.md) (the order of work and its test gates), [README.md](README.md) (architecture, forecast rules, data model), [DESIGN.md](DESIGN.md) (visual system), [security_spec.md](security_spec.md) (Firestore guarantees) and [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md) (Firebase and Cloud Run setup for the current, legacy infrastructure).

---

## A. Product philosophy

Financial OS is **one evolving application**. Alpha, beta, and general release are testing and learning phases with progressively larger groups of people. They are not separate feature sets, and a phase is never a reason on its own to leave something out of the product vision. Build and validate incrementally; let evidence from real users justify adding, simplifying, changing, or removing features.

The central purpose is **cash-flow control first, and cash-flow creation next**.

The application should:

- Help people understand their future income, expenses, liability payments, available cash, and potential timing gaps.
- Identify potential problems early enough for people to act on them.
- Help people compare financial decisions and understand their consequences.
- Model real life: changing dates, variable amounts, unexpected events, and imperfect plans.
- Do the complicated calculation and coordination behind the scenes.
- Keep the experience simple: review, confirm, correct a date or amount, undo a mistake, or choose an action.
- Stay free of rigid budget philosophies, unnecessary categories, excessive notifications, and unnecessary account setup.
- Explain important recommendations briefly, with more detail available on request.
- Preserve history, so people can see what was expected, what changed, and what actually happened.

It is a projection tool for the big picture. It does not track every penny, and it does not show a bank balance.

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
- **Firebase/Firestore, Cloud Run hosting and offline synchronization are legacy.** They keep the current version running and will be removed during the Supabase migration, not before. Until then: don't deploy Firestore rules, request Firebase credentials, turn on `REVIEW_RHYTHM_IN_ACCOUNTS`, add Firebase storage features or change Firebase sign-in. Keep the current app working, and keep the documentation needed to run it.

**Development order:**

1. Finish the core financial features (roadmap Steps 6–9).
2. Finalize and verify the data architecture.
3. Move persistence to Supabase.
4. Remove offline synchronization.
5. Complete authentication and per-user data isolation.
6. Deploy and test the finished application on Vercel.

The roadmap's Step 10 holds stages 2–6.

### C2. Current implementation

Preserve the existing architecture; don't rebuild it without a reason the product owner has agreed to. As of this writing (verify before relying on it):

| Area | Where | Notes |
| --- | --- | --- |
| Stack | TypeScript (strict), React 19, Vite, vite-plugin-pwa | npm only; `package-lock.json` is committed |
| Domain logic | `src/domain/` | Pure TypeScript, no React. `dates.ts`, `money.ts`, `types.ts`, `recurrence.ts`, `occurrences.ts`, `forecast.ts` (`buildForecast` and everything derived from it), `operations.ts` (every state change), `plan.ts` (cash flow per period), `sample.ts` |
| State and persistence | `src/state/` | `storage.ts` (`StorageAdapter`, validation, `migrate`), `store.tsx` (applies operations, background saving, conflicts), `cloud.ts` (account storage with an on-device copy; legacy), `firebase.ts` (Google sign-in and Firestore, loaded on demand; legacy), `account.tsx`, `backup.ts`, `mode.tsx` (sample vs real data) |
| UI | `src/ui/` | `screens/`, `components/`, a hash router (`router.ts`) |
| Hosting (legacy) | `server.mjs`, `Dockerfile` | Cloud Run serves the built app and forwards Firebase sign-in pages through its own address. To be replaced by Vercel |
| Data and sign-in (legacy) | Firebase | Google sign-in; Firestore document `financialData/{uid}` in the named database; rules in `firestore.rules`. To be replaced by Supabase |
| Tests | Vitest + Testing Library (jsdom); Firestore emulator; Playwright | See section H |

Rules:

- **One forecast engine.** Financial calculations live in the shared domain layer. Dashboards, calendars, reports, alerts, and scenarios read from `buildForecast` (and helpers in `forecast.ts` / `plan.ts`); they never re-implement the math.
- **Integer cents** for all money arithmetic. Parse and format only through `money.ts`.
- **Date-only values** (`YYYY-MM-DD` strings) with the conventions in `dates.ts`: UTC-midnight arithmetic, Sunday-start weeks, month-end clamping. Results must not depend on the host time zone.
- **Deterministic and testable.** Domain calculations take "today" (and a clock, for operations) as inputs and never read the system clock themselves. The only clock reads in `src/domain/` are the `todayLocal()` helper the UI calls and ID generation.
- **State changes go through `operations.ts`** as pure functions that return new data or a validation error.
- **Before changing a persisted type or schema**, inspect and update together (the Firebase items stay on this list while the current version runs on Firebase; keeping them correct isn't new Firebase work): validation and `migrate` in `storage.ts`, backups (`backup.ts`), the on-device copy (`cloud.ts`), Firestore writes (`firebase.ts`), `firestore.rules`, `security_spec.md`, `firebase-blueprint.json`, and the rules tests. Existing data must keep loading; add migration tests.
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
  - **Current product decision:** scheduled **savings** deposits count as expenses in cash flow (README: "savings is treated as an expense" — the product owner's call). Changing that to an internal allocation is a decision for the product owner in roadmap Step 9. Don't change it silently.
- A low or negative **running total** is a forecast condition to explain (a timing gap), not a data error.
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
- clear undo and recovery;
- short contextual explanations, with optional deeper detail;
- sensible defaults;
- a configurable review cadence instead of repeated nagging;
- clear distinctions between confirmed information, estimates, and suggestions.

Don't assume every subscription is unnecessary, every recurring expense is discretionary, or that everyone should follow the same financial strategy. Help people see what they can do **now** about a future problem.

Product terms are fixed; use them consistently in UI, docs, and tests:

- **Cash flow** — income minus expenses (including savings) for a period.
- **Running total** — the day-by-day cumulative total from the forecast anchor. Never call it a "balance".
- **Main paycheck** — the income whose paydays start pay periods.
- **Expected / Overdue / Done**, **Money in / Money out**, **Lowest running total**, **Timing gap**.

Categories are income, bills, subscriptions, liability payments (card, loan, or line of credit), and savings. No category is labeled "other", "misc", or anything similarly vague. Tags are optional and created only by the person; none are built in.

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
- Timing gaps between paydays; main-paycheck pay periods.
- Recurring schedule changes and effective dates.
- Cancellation, rescheduling, actuals, stored overrides, and duplicate prevention.
- Original-prediction preservation and variance.
- Undo and batch-operation correctness.
- Scenario consistency and internal-transfer handling (once those exist).

**Component and integration tests** (`src/ui/__tests__/`, `src/state/__tests__/`)
- A person can inspect a warning, understand its cause, edit an amount or date, confirm events, undo, and see the forecast update.
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
| `npm run test:rules` | Runs `firestore.rules` in the Firestore emulator | Needs Java; the emulator is downloaded on first run. Kept while the current version uses Firebase; passing it doesn't authorize Firebase work |

For any coherent code change, run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` at minimum. Also run `npm run e2e` for user-facing flows, state changes, navigation, or persistence, and `npm run test:rules` for storage or security changes when the emulator can run. If a command can't be run, say so and why; never report it as passing.

**Repository practice**
- Use npm. Only change `package-lock.json` by running `npm install`; keep every entry's `resolved` and `integrity` fields. Never add `bun.lock` or another lockfile.
- The working branch is `ccr-12ec4965-6tzwgr` (GitHub's default branch, which AI Studio syncs with). Pull before starting and before pushing; never force-push or rewrite shared history.
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
