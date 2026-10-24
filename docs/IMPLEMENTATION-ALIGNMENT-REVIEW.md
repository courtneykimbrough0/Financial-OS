# Financial OS — independent implementation alignment review

Status: **Documentation-only source review, October 23–24, 2026.** Prepared against the current GitHub default branch and the owner-approved [PRODUCT_CONTRACT.md](../PRODUCT_CONTRACT.md). No code, database, build, or Vercel changes. This is not a claim that every interactive flow was manually exercised. File/line references are evidence from inspected source, not a complete line-by-line audit of all repository files.

## Executive conclusion

**Confirmed product drift exists in both the user interface and the financial engine.** The app's existing “Expected vs Possible” income toggle does not merely rename projections: it excludes Possible income from forecast totals. Onboarding uses **three steps** (Income, Payments, Review), and payments combine Bills, Subscriptions and Liabilities into one entry step, rather than the five separate owner-required onboarding sections. Varied Spending is a dedicated entered one-time expense classification, not the calculated Left to Spend outcome. The existing UI also displays owner-prohibited terminology. These are implementation facts supported below.

The engineering strengths should be preserved. The central forecast pipeline distinguishes completed records from uncompleted occurrences, already has a single forecast engine, records one-time activity and recurring income, has reserve/transfer handling, and the live Vercel preview has saved data through refresh and sign-out/sign-in according to the owner. Corrective work should simplify product behavior **without casually deleting these protections**.

## Authority and review method

The governing rules are in `PRODUCT_CONTRACT.md`; historical implementation claims in `AGENTS.md`, `PRODUCT_EXPERIENCE.md`, `FINANCIAL_ENGINE.md`, and the roadmap cannot override it. This review directly read the following implementation files: `src/ui/screens/Onboarding.tsx`, `src/ui/screens/Plan.tsx`, `src/ui/screens/SourcesScreen.tsx`, `src/ui/screens/Forecast.tsx`, `src/ui/screens/Home.tsx`, `src/ui/screens/Activity.tsx`, `src/ui/components/forms.tsx`, `src/domain/types.ts`, `src/domain/forecast.ts`, `src/domain/occurrences.ts`, `src/domain/activity.ts` and `src/state/supabase/rows.ts`. Some were inspected via targeted sections. Additional code-path and browser confirmation is needed before implementation. Historical audits and product docs were also compared.

## Confirmed contradictions — priority ordered

### P0. Income certainty alters future cash-flow forecasting

**Evidence:** `src/domain/types.ts` gives recurring income a `certainty?: 'possible'` field (around line 180). `src/ui/components/forms.tsx` (around lines 66–85, 354–357, 465, 494–546) implements an Expected/Possible picker for recurring and one-time income, with copy that Possible is “shown, but not counted in cash flow or the running total.” `src/domain/forecast.ts` (around lines 132 and 151–158) excludes Possible sources from the forecast anchor and assigns signed value **zero** to unrecorded Possible occurrences. `src/domain/occurrences.ts` (around lines 59–73) exempts Possible income from ordinary overdue display. `src/state/supabase/rows.ts` stores and restores certainty (around lines 32–33, 75–76, 189–224 and 305–335).

**Contract conflict:** A person entering a date and an amount is making a projection. The software must not automatically exclude it from projected cash flow because of subjective reliability. A schedule is not a guarantee, and nothing becomes actual until recorded.

**Correction boundary:** Trace all read/write paths, schema constraints, database functions, forecast anchors, scenario tests, UI wording, and fixtures for certainty before designing its removal. Removing a picker while leaving zero-valued Possible income in stored data would produce invisible financial errors. Do not remove legitimate amount/date estimation inputs, shifts, tips, gig sessions or freelance-job tracking merely because those currently coexist with certainty labels.

### P0. Wrong onboarding information architecture

**Evidence:** `src/ui/screens/Onboarding.tsx` (around lines 22–59) declares **three** `STEPS`: Income, Payments, Review; `STEP_OF` maps bill, subscription, liability and reserve to the same Payments step. `PaymentsStep` (around lines 216–256) combines Bills, Subscriptions and Liabilities in one payment list, offers an Add payment chooser, includes a one-time expense section, and embeds Strategic Reserves inside that step. The render logic (around lines 469–590) only renders a dedicated Income step, Payments step, and Review. The owner specifically wants separate Income, Bills, Subscriptions, Liabilities, Strategic Reserves guided sections. Review may be a completion stage, but **does not substitute for a category**.

**Why important:** The owner wants a category-by-category memory aid without forcing users to recall all ongoing obligations simultaneously. Today's combined Payment stage defeats that goal even though it retains distinct data kinds underneath.

**Correction boundary:** Keep the useful existing Back/Continue, sample-data, optional skipping, editing, accessibility focus, and early-first-forecast mechanics. Do not add an unrelated sixth onboarding category. Decide how to present final Review without claiming there are only five screens total. Obtain live owner acceptance on the sequence before closing the checkpoint.

### P0. Varied Spending is treated as input instead of calculated Left to Spend

**Evidence:** `src/domain/types.ts` (around lines 8–32) declares `varied` a one-time spending kind and includes it among external outflows. `src/ui/components/forms.tsx` (around lines 481 and 555) has Varied spending entry copy. `src/ui/screens/Onboarding.tsx` (around lines 71, 142, 286–295, 348–349) offers “Add varied spending,” places it on the Bills/Payments step, and includes these entries in review. `src/ui/screens/SourcesScreen.tsx` (around lines 65–71, 420–473) provides an entire Varied tab inside Expenses and a modal to Add varied spending. `src/domain/forecast.ts` uses its existing outflow semantics.

**Contract conflict:** Left to Spend is a calculated outcome for a defined period, not another amount the user estimates as a category during onboarding. **One-time expenses must still be recordable** and count once, not disappear with the Varied Spending UI.

**Correction boundary:** Preserve the underlying external-outflow semantics of genuine one-time purchases. Define Left to Spend precisely against available cash flow, period boundaries, projected/recorded inclusion, and opening balance assumptions. Assess whether the existing available-cash-flow/running-total already supplies the necessary financial quantity; do not create a second inconsistent formula. Make one-time expense entry legible, distinct from Left to Spend, and accessible outside the five onboarding sections. Audit `varied` database/persistence identifiers before any rename or migration.

### P1. App navigation and grouping do not match the intended experience

**Evidence:** `src/ui/screens/Plan.tsx` (lines 4–29) has four sections: Income, Expenses, Liabilities and Reserves. `src/ui/screens/SourcesScreen.tsx` (around lines 446–473) makes Expenses three tabs: Bills, Subscriptions and Varied. Liabilities is already a separate Plan section and not included in that Expense view.

**Contract implications:** In-app Recurring Expenses should aggregate Bills, Subscriptions **and liability payments**. Separately, Liabilities needs an experience focused on balances and payoff progress, not only a recurring payment list. Existing separate navigation is a useful starting point, not evidence a payoff plan already exists.

**Correction boundary:** Do not reflexively add more top-level tabs. Specify the minimum Recurring Expenses view and the separate liability progress experience, and get owner approval on the screen structure.

### P1. Prohibited and misleading user-facing copy persists

**Evidence:** `src/ui/screens/SourcesScreen.tsx` around lines 58–62 contains an example using the prohibited reserve wording. `src/ui/screens/SourcesScreen.tsx` around lines 385–401 uses “Expected and possible” / “Expected” headings. `src/ui/components/forms.tsx` around lines 66–85 describes possible income as not counted. `src/ui/screens/Forecast.tsx` around lines 189–198 describes the running total starting at $0; this is not a bank balance and should be clear.

**Correction boundary:** Audit displayed strings throughout the app, copy inventory, tests and error messages. Prohibit “debt” and “emergency fund” in user-facing copy. Historical inventory entries and source quotations may remain quoted as records, not approved current language. Avoid global replacements that alter domain fields or test fixtures unintentionally.

## Already aligned or valuable foundations

- **Projection versus recorded mechanism:** `src/domain/forecast.ts` (around lines 139–167) uses actual amount/date for completed occurrences and scheduled amount/date for uncompleted ones. This is a valuable starting mechanism, **not proof** the full historical projection comparison preserves every previous planned version.
- **Single calculation path:** Home, Activity and Forecast import the domain forecast pipeline; avoid replacing it with screen-specific calculations.
- **One-time and recurring distinctions exist:** `src/domain/types.ts` declares recurring and one-time kinds. `SourcesScreen.tsx` already supports one-time Income and one-time external expenses. The UI may be complicated, but these primitives should stay.
- **Reserves and transfers:** The documented engine already separates external outflows from reserve allocations and internal account transfers. Preserve the financial invariant and audit edge cases before UI changes.
- **Early useful setup:** The existing onboarding permits continuing without income, has Review and sample-data entry. Reuse rather than rebuild needlessly.
- **Hosted data persistence:** The owner reports data remained after refreshing and signing out/in at the Vercel preview. This is a live observation, not a full pass of all hosted failure conditions.

## Open questions and unverified items — do not guess

1. **Left to Spend formula details:** What period is default? Is it remaining projected available cash during the *selected* period, versus actual remaining bank funds? How do recorded events in the same period replace planned amounts rather than count twice? The contract sets the principle, but a precise calculation and presentation spec requires a code walkthrough and acceptance examples.
2. **Liabilities payoff data:** The source inspection confirms a separate Liabilities section and `liabilityType` metadata, but **does not establish** that principal balance, rate, amortization or payoff progress are modeled today. Do not promise a functioning payoff plan until verified.
3. **Historical plan snapshots:** The forecast branches on recorded versus unrecorded amounts, but test whether original projection snapshots persist after schedule edits and late recordings.
4. **Full source-copy coverage:** A sampled source review located contradictions but cannot guarantee every string, unused component and older route has been inventoried.
5. **Live five-section experience:** No revised onboarding UI has been built. Owner must review a functioning preview before declaring alignment.
6. **Broader income complexity:** Hourly/tipped/gig/freelance helpers exist; confirm which user-facing inputs are necessary to establish amount/date versus optional deep earning logs.
7. **Opening-balance semantics:** A “Left to Spend” figure must not imply an actual account balance where starting cash is unknown.

## Recommended correction sequence (proposal, not authorized implementation)

**R0 — Product acceptance examples (docs only):** Write hand-computable examples for expected/actual income, one-time outflows, reserve allocations, transfers, and Left to Spend in a specified period. Identify explicit proposed UI wording. Product owner approves these before calculations or navigation are modified.

**R1 — Income projection semantics:** Remove subjective certainty gating from the engine and inputs with schema/persistence review and regression tests. Preserve variable-income computation and recorded actuals. Validate projected-versus-recorded presentation in the live app.

**R2 — Guided onboarding:** Replace the combined Payments step with five focused financial sections and a final review. Keep optional/skip behavior and a quick first forecast. Make ordinary entry simple, and leave advanced paths opt-in. Product owner reviews on phone.

**R3 — Left to Spend and one-time expense:** Implement the approved residual presentation by reusing one canonical calculation; decouple actual one-time expense entry from an entered Varied Spending “budget.” Preserve stored events and no double counting. Product owner verifies hand-calculated cases in preview.

**R4 — Recurring Expenses and Liabilities:** Make the combined recurring-expense presentation understandable; preserve separate Liabilities progress space, implementing only approved capabilities after verifying which payoff data already exists.

**R5 — Simplify supporting flows and copy:** Audit Home, Forecast, Activity, Plan, Settings, entry forms, empty states and reporting for duplicated numbers, unwanted terms and unnecessary decisions. Only remove work after explaining what functionality would be lost.

**R6 — Live acceptance and release gate:** Each correction receives automated relevant regression checks **and** owner review of the actual deployed Vercel preview; no unrelated feature expansion or F5 launch before product alignment approval.

## Process safeguards

Each corrective task must identify source evidence, a narrow scope, exact financial invariants, failure-oriented tests, visible acceptance criteria, and explicit non-goals. Label confirmed behavior versus inference. Provide the owner a complete Claude execution prompt only **after** the owner approves the proposed correction roadmap. Do not make the full roadmap a single autonomous task.
