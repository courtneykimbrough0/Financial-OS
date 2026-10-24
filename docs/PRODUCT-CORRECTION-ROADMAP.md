# Financial OS — approved product correction roadmap

Status: **Sequence approved by product owner October 23, 2026.** Based on [PRODUCT_CONTRACT.md](../PRODUCT_CONTRACT.md) and [IMPLEMENTATION-ALIGNMENT-REVIEW.md](IMPLEMENTATION-ALIGNMENT-REVIEW.md). This document approves **order and scope**, not blanket permission to implement all phases. Every implementation phase receives its own prompt, PR, tests, and owner review of the live Vercel preview. The existing financial/security CI remains in place. No F5 launch during correction.

## Governing goal

Financial OS forecasts future money movements, records actual outcomes only when explicitly recorded, and shows the differences to help refine user-directed projections. Default interaction must be simpler than the calculation engine. Exactly five guided onboarding financial sections: Income, Bills, Subscriptions, Liabilities, Strategic Reserves. In-app Recurring Expenses can aggregate Bills, Subscriptions and liability payments, while Liabilities retains a separate experience. Left to Spend is a calculated remaining amount, never an input category. One-time income and expenses remain supported. Never place “debt” or “emergency fund” in user-facing copy.

## C0 — Calculation and experience acceptance examples (first; documentation only)

- Inspect current domain forecast/recorded/reserves/transfers, projection start, income forms and persistence.
- Write executable-style, hand-computable acceptance examples covering: recurring income, one-time income, freelance/irregular income, projected $1,500 Friday vs recorded $1,250 Monday, recurring payments, one-time expense, Strategic Reserve allocation/release, inter-account transfer, and a stated forecast period for Left to Spend.
- Explain how a recorded amount replaces rather than adds to the projected occurrence; compare recorded date and amount to prior plan. Explain when opening balances are unknown rather than suggesting a bank balance.
- Identify the exact existing engine functions and any cases not yet supported. Propose default UX labels and period choice without turning examples into a second formula.
- **Exit:** product-owner signoff on expected figures and terminology; no engine/UI changes.
- **Do not:** invent certainty grades, estimate bank balances, or change project hosting.

## C1 — Remove income certainty gating; preserve projections and history

- Inspect and correct certainty picker, domain kind/occurrence state, forecast anchor and totals, persistence mappings, DB validation and fixtures. All included projected income counts in projections irrespective of perceived reliability; recorded data alone becomes actual.
- Preserve one-time/recurring scheduling; hourly, tipped, gig and freelance amount/date modeling; historical record/schedule comparison.
- Ensure migrations are appropriately scoped to current zero-user environment; don't leave existing `possible` data in a state silently excluded from the forecast.
- **Tests:** recurring/one-time projected income, late and different actual receipt, no certainty-based zeroing, anchors, previous regression/security suites.
- **Exit:** relevant CI and manual live preview pass; product-owner approves income form and forecast.
- **Do not:** remove useful optional work/earnings detail merely because it is adjacent to certainty UI.

## C2 — Five-section guided onboarding

- Separate Income, Bills, Subscriptions, Liabilities and Strategic Reserves into **five entry sections** plus a clearly distinguished final Review, with Back/Continue/Skip and return.
- Support quick first forecast as soon as useful input exists. Don't make comprehensive onboarding compulsory. Keep one-time income inside Income; allow one-time expenses elsewhere, **not** as a sixth onboarding category.
- Default forms ask only for minimum projected amounts/dates/schedules; complex income detail goes behind Advanced options.
- **Tests:** five sections and navigation, optional skipping, saved entries and revisit, Review correctness, narrow/mobile browser accessibility.
- **Exit:** owner uses revised wizard on actual Vercel preview and approves behavior.
- **Do not:** turn the onboarding into five mandatory long questionnaires or modify financial calculations solely for layout.

## C3 — Calculated Left to Spend and one-time expenses

- First compare current available cash flow, running total, record replacements, reserve allocations and transfers to approved C0 examples. Reuse the canonical engine. Define displayed period and projection qualifier.
- Replace **user-facing Varied Spending as planned category** with automatically calculated Left to Spend. Retain simple one-time expense entry and accurate recorded purchases. Assess internal `varied` storage compatibility separately; no blind global renames.
- **Tests:** projected/actual replacement, one-time entries counted once, reserve allocations not counted as spending, transfers not treated as income/outflow, date boundaries and absent opening cash.
- **Exit:** owner verifies exact example amounts and labels in live app.
- **Do not:** imply actual account balance or add a separate guessed budget.

## C4 — Recurring Expenses and Liabilities

- Design minimal Recurring Expenses aggregation of Bills, Subscriptions and liability payments. Preserve detailed items and onboarding separation.
- Audit existing liability balance, payment, progress and payoff data. Add a clear Liabilities experience only for owner-approved capabilities, separating known current features from aspirational payoff planning.
- **Tests:** aggregated totals equal constituent payments once, independent liability details, historical payments, mobile navigation and accessibility.
- **Exit:** owner approves the in-app grouping and liability progress in preview.
- **Do not:** add amortization/payoff optimization without separate explicit scope.

## C5 — Simplify supporting screens and wording

- Audit Home, Forecast, Activity, Plan, Settings, forms and reports for unnecessary information, duplicate totals, misleading certainty/actual language and prohibited terminology.
- Simplify only when it does not hide required financial context, history or record/undo/error handling. Keep Advanced for optional complexity.
- **Tests:** regression, accessibility, key workflows, narrow-phone screenshots/browser; owner signs off screen by screen.
- **Exit:** app reflects governing contract with no unresolved high-severity user-facing contradictions.
- **Do not:** rebuild the UI wholesale or add unrelated features.

## C6 — Integrated live verification and release decision

- Validate real sign-in, setup, planned activity, one-time items, recordings, reserved amounts, transfers, forecasts, Left to Spend, sign-out/reload persistence and mobile PWA/offline warnings in the existing test environment.
- Keep automated finance, RLS, persistence, security, concurrent save and regression checks. Log real defects with reproductions and tests.
- **Exit:** explicit product-owner acceptance of experience; separate authorization before F5/production launch.
- **Do not:** infer acceptance from green CI alone.

## Workflow and governance

Each checkpoint: (1) short source-grounded scope and UI behavior proposal, (2) owner authorization, (3) focused implementation, (4) CI and browser testing, (5) actual live preview review by owner, (6) merge authorization. Document confirmed behavior vs interpretation vs recommendation. No agent should autonomously execute C0–C6 in one request.

**Next authorized task: C0 documentation-only acceptance examples.** Implementation C1–C6 is not authorized by sequence approval alone.
