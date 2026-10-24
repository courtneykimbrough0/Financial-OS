# Financial OS — authoritative product contract

Status: **Product-owner decisions confirmed October 23, 2026. Documentation-only correction.** No application behavior is claimed to have changed. This contract governs future implementation and takes precedence over conflicting historical descriptions in other repository documents. Any change to this contract requires explicit product-owner authorization, not agent inference.

## Purpose

Financial OS is a **projection-first financial planning application with recorded actuals**. Its job is to show where money may be headed, make it easy to record what actually happened, and help people improve their future plans by comparing projections with outcomes.

The user provides assumptions; the application computes their consequences. The application does **not** claim future money movements are guaranteed, determine whether a person or employer will pay, rank the trustworthiness of income, or automatically pronounce future events certain. Whether an income source is employment, government benefits, freelance, tipped, gig, long-standing client work, or a one-time receipt does not change this rule.

Product shorthand: **Plan → Record → Learn**. Financial calculation complexity is handled internally; the default interface must remain simple.

## Binding financial semantics

1. **Every unrecorded financial occurrence is a projection**, even if recurring, overdue, routine, or highly anticipated. Do not convert projected amounts into actuals because a date passes, because a schedule repeats, or because an outside event suggests payment.
2. **Only an explicitly recorded occurrence is an actual.** Recording requires an intentional user action or a separately authorized verified recording mechanism; none is assumed here. The recorded amount and date may differ from the projection.
3. **Preserve projection versus outcome.** A recorded occurrence must retain enough original projected timing/amount history for the app to explain the comparison. Later changes to a recurring schedule must not retroactively rewrite recorded outcomes or silently falsify the earlier plan.
4. **Schedule is not certainty.** One-time, recurring, hourly, tipped, freelance and gig models are ways to calculate projected amount/dates. They are not reliability scores. Do not require certainty, confidence, likelihood, guaranteed/expected reliability buckets, or client solvency judgments as inputs to include income in the forecast.
5. **Projection can change when the user changes assumptions.** Past projected versions and recorded outcomes are distinct from the current projection. The presentation may distinguish projected, recorded, canceled, deferred, or revised schedule actions without introducing an income-certainty classification.
6. **No invented actuals.** Projected schedules, imported assumptions and calculated balances must not be described as money already received or spent.
7. **Historical comparisons inform, not dictate.** Show what was planned, what was recorded, and the difference in amount/date. Future projections remain user-controlled.

## Financial classifications and the five onboarding sections

The **five guided onboarding sections**, in this order, are **Income, Bills, Subscriptions, Liabilities, Strategic Reserves**. They are distinct steps in setup, regardless of how the application aggregates money in a report. Each section helps a person recall relevant commitments without asking them to produce a complete inventory at once. A person may skip incomplete sections, return, and reach a useful forecast early. Do not require extensive optional income detail before delivering value.

- **Income:** projected incoming money; recurring or one-time. Simple default entry: source, amount, date or schedule. Optional advanced calculation paths for hourly, tipped, freelance or gig income must produce projected amounts and dates without certainty grading.
- **Bills:** essential ongoing recurring obligations without a defined payoff.
- **Subscriptions:** nonessential recurring services and memberships, without a defined payoff.
- **Liabilities:** obligations with balances/payoff progress and recurring payments. The dedicated Liabilities experience must be able to display balances and progress and can later support an explicitly approved payoff-plan feature. That screen is distinct from aggregated expense views.
- **Strategic Reserves:** money intentionally set aside. Allocations lower **available** cash flow, but are not external expenses. A release adds back to available funds without becoming income. User-entered plans and recorded allocations must remain distinct.

**Bills, subscriptions and liability payments combine under “Recurring Expenses” in appropriate in-app summaries**, while remaining distinct in the five-step onboarding wizard. A combined view must not erase the dedicated Liabilities screen or its progress information.

**One-time expenses are supported** through a simple transaction/event entry outside the five guided onboarding sections. **One-time income is supported within Income.** There is no extra onboarding section for one-time activity. Avoid adding a top-level financial classification merely to handle a recurrence type.

**Left to Spend replaces the user-facing concept of “Varied Spending.”** Left to Spend is an **automatically calculated result**, not a planned expense category, user-entered estimate, or sixth onboarding step. For a clearly defined forecast period, it is the projected resources remaining after applicable recurring obligations, planned one-time external expenses, and net Strategic Reserve allocations, with recorded activity handled consistently. It is **not automatically a bank balance or money already received**. The engine must make the calculation's time period and available starting-balance assumptions clear and prevent double-counting actual purchases, recorded obligations, transfers and reserve movements.

Actual everyday purchases can be recorded as one-time expenses; they then affect the applicable available amount. **Do not conflate the entry of a one-time expense with entering “Left to Spend.”** Existing storage or historical identifiers named `varied` are implementation details to audit for migration/compatibility impact, not permission to continue presenting Varied Spending as an expense users must budget during onboarding. Do not change the calculation formula or persistence representation until the owner reviews an explicit implementation design backed by tests.

## Financial accounts and transfers

Financial account types describe where money is received, held, moved or paid; **they are not additional financial classifications or onboarding categories**. Distribution accounts and internal transfers cannot be counted as income or expenses merely because money moves between a person's accounts. Optional account assignment should not block the minimum viable forecast. Retain existing account integrity and ownership controls.

## Interface and language

- Make the default action simple: enter projected income or an obligation, record a receipt/payment, and see the resulting forecast.
- The five onboarding sections must be visible as a guided sequence with progress and simple review/return controls, not merged into one undifferentiated expense-memory task.
- Progressive disclosure: ordinary forms request only what is essential; **Advanced** reveals additional details or a multi-step entry flow only when needed.
- Show an ordinary-language projection and actual comparison; do not build a risk assessment into income forms.
- Prefer **home**, **Recurring Expenses**, **Liabilities**, **Strategic Reserves**, **Left to Spend**, **projected**, **recorded**, **received**, and **paid** as context demands.
- **Prohibited user-facing terminology:** “debt” and “emergency fund”, including onboarding text, interface labels and marketing. Use “Liabilities” and “Strategic Reserves” where appropriate. Do not rewrite third-party/legal quoted source materials; instead prevent these terms from becoming app copy.
- Do not give the user a false statement of certainty or represent projection as verified available cash.
- Keep essential financial correctness and security information; avoid duplicating every total across Home, Forecast, Activity and Plan.

## Application organization versus onboarding

Onboarding is five focused entry sections. The application's later information architecture is **not required to mirror those five steps**. Appropriate in-app groupings include Recurring Expenses (Bills + Subscriptions + liability payments), one-time activity, Income, Strategic Reserves and a separate Liabilities screen for balance/payoff progress. Existing routes and user experience are subject to live review; this section is a product requirement, not approval to add screens without design review.

## Engineering invariants that must survive simplification

- Financial calculations derive from a single consistent projection engine, not duplicate screen formulas.
- Explicit recorded history remains intact when schedules or assumptions change.
- One-time and recurring flows both work; forecast periods and dates are respected.
- Net reserve allocation affects available cash flow, not external expense totals.
- Internal transfers do not create income/expense.
- Supabase ownership isolation, RLS, account deletion, save integrity, conflict checks, retry idempotency and secure session handling remain mandatory.
- An easier screen cannot silently discard stored information.
- Actual app behavior must be tested through a live preview, alongside automated financial and security regression tests.

## Process contract: stop translation drift

1. **Documentation first.** Read this contract and the related current product specifications before planning changes. Inventory each contradictory interface, domain function, test, and older doc. Do not treat a historical “complete” implementation entry as a current product decision.
2. **Separate fact from proposal.** State current behavior, confirmed owner decision, and suggested implementation distinctly. Do not invent design requirements or add classifications.
3. **Owner reviews the experience.** For major workflow changes, supply a concise design or screen-by-screen behavior spec, then obtain authorization before implementation. The owner reviews the live preview before a major product-experience checkpoint closes.
4. **Small implementation batches.** Fix one cohesive workflow at a time, preserving existing calculations/security and adding focused regression tests. No sprawling implementation based solely on an agent's interpretation.
5. **Document acceptance.** Every task cites the exact rule in this contract, records evidence, actual live behavior and remaining limitations. If a feature does not help project, record or learn, it needs explicit justification.
6. **Documentation update is not code approval.** This change records the decisions and contradictions only. A Claude implementation brief and revised phased roadmap follow separately after documentation review.

## Known conflicts to resolve during the forthcoming implementation review

- AGENTS.md and PRODUCT_EXPERIENCE.md historically say “Varied Spending” is a one-time classification, whereas the owner has now defined **Left to Spend** as a calculated result. One-time expense entry must be preserved without treating Left to Spend as an expense.
- PRODUCT_EXPERIENCE.md describes both six Plan sections and a combined onboarding list of three recurring kinds; the owner requires **five separate onboarding steps** while keeping recurring-expense aggregation in the main app.
- Income-variation and certainty work may require projected-income status/reliability inputs; all unrecorded money is now a projection. Review stored data, interface, labels, tests and calculations **before** removing any implementation.
- Liabilities need their own in-app balance/progress experience despite appearing in Recurring Expenses totals.
- Historical roadmap “complete” markers document what was built, not necessarily what is now approved.

## Acceptance tests for future work (requirements, not claims of implementation)

- An ordinary recurring paycheck and a freelance receipt both show as projected until explicitly recorded, without a certainty decision.
- A projected $1,500 Friday receipt recorded as $1,250 Monday retains both dates/amounts for comparison.
- Bills, Subscriptions and Liabilities each appear as their own onboarding step; their payments aggregate into Recurring Expenses in an appropriate report.
- A one-time expense can be entered without adding an onboarding category; one-time income can be entered from Income.
- A reserve allocation lowers available cash flow without inflating expense totals; transfers do not inflate income or spending.
- Left to Spend is calculated for a stated period; nothing asks the user to enter a planned “Varied Spending” amount to finish setup.
- Record, reload and sign back in preserve information; distinct user data stays isolated.
- A test of updated onboarding is performed in the actual hosted phone preview and approved by the product owner before that milestone is marked complete.
