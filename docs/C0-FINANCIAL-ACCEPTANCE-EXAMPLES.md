# C0 — Financial behavior acceptance examples

**Status:** Product-alignment examples for owner review, October 23, 2026. Documentation only; examples describe **required future behavior** unless expressly marked as confirmed current behavior. They are not evidence that the current application passes. Governed by [PRODUCT_CONTRACT.md](../PRODUCT_CONTRACT.md) and the [implementation alignment review](IMPLEMENTATION-ALIGNMENT-REVIEW.md). The staged correction sequence is proposed in [PR #37](https://github.com/courtneykimbrough0/Financial-OS/pull/37) and must not be treated as merged until it is.

## Ground rules and precise terms

- **Projection:** An occurrence on a future or unrecorded date, using a user-supplied projected amount and date. Recurring is scheduling, not confidence. Every included projected income counts in projected totals regardless of type or subjective certainty.
- **Recorded actual:** A deliberately recorded receipt, payment, reserve movement or transfer. Its actual amount/date replace that occurrence's planned amount/date in the **current financial timeline**. Do not add both. Preserve the previous plan separately for comparison.
- **Recorded does not mean irrevocable:** A user can correct an erroneous record through an explicit audited action; never silently convert a projection to an actual.
- **Canceled occurrence:** Does not count in the current projected totals but may remain visible in history. A genuinely rescheduled occurrence counts on its current planned date; preserve its old plan for comparison.
- **External outflows:** Bills + subscriptions + liability payments + one-time expenses. Internal transfers are not external outflows.
- **Strategic Reserves:** Allocations subtract from *available* cash, not from external-expense totals. Releases increase available cash and do not become income.
- **Period net available change:** Projected and recorded included income within a stated date range, less external outflows and net reserve allocations **in that range**. This is an amount changed during the period, **not automatically a balance the user can spend**.
- **Left to Spend — confirmed owner formula:** For the selected forecast period, **Income − (Expenses + Strategic Reserves allocations net of releases)**. Income and expenses include **both recurring and one-time occurrences** within that period. Recorded occurrences substitute their actual dates and amounts; unrecorded occurrences remain projections. Internal account transfers are not income or external expenses. Left to Spend is a projected period result, not an actual bank balance or a separately entered spending estimate. No additional formula choice is pending.
- **Actual versus future together:** When a displayed range includes past recorded and future projected occurrences, totals must not silently label the whole result actual. Separate or clearly identify portions.
- **Dates:** ISO 8601 local calendar dates, no fictional status advancement. These examples are deterministic fixture scenarios; date choices are not assertions about today's real bank activity.
- **Money:** USD, exact cents, no rounding assumptions needed. Use the same canonical forecast calculation in all screens.
- **No user-facing prohibited terminology:** do not introduce the two forbidden finance labels described in PRODUCT_CONTRACT.md.

## Scenario C0-01 — Ordinary recurring pay

A user enters a recurring $1,500 income every other Friday, with an occurrence on 2026-11-06. It is unrecorded on 2026-11-05.

**Expected:** November 6 carries **projected +$1,500**. No certainty question is needed. If the same source repeats November 20, that second +$1,500 is also a projection. Neither is recorded simply because it appears in the schedule. The recurrence controls occurrence dates, not likelihood. The two occurrences must not merge.

**Current divergence:** `src/ui/components/forms.tsx` includes an Expected/Possible selection; `src/domain/forecast.ts` excludes the Possible selection from the tally. That exclusion violates this example.

## Scenario C0-02 — A different amount arrives on a different day

Initial projection: income +$1,500 on Friday, 2026-11-06. The user explicitly records **+$1,250 actually received on Monday, 2026-11-09**.

**Expected current timeline:** exactly one +$1,250 income movement on November 9. The original +$1,500 is **not** also counted on November 6. The difference is **$250 less**, **3 calendar days later**. The comparison view preserves and displays the November 6 / $1,500 plan alongside the November 9 / $1,250 recorded outcome. A change to next month's recurrence must not rewrite this comparison.

**Current foundation:** `src/domain/forecast.ts` uses `actualDate ?? scheduledDate` and `actualAmountCents ?? scheduledAmountCents` for completed occurrences. **Unverified:** whether the full original snapshot is retained after all edit sequences, and where the comparison is presented.

## Scenario C0-03 — Freelance, irregular and one-time projected income

A freelancer enters +$800 planned for November 12 as a one-time receipt and +$500 planned for November 27 from a different job; a weekly tipped worker enters a user-calculated +$650 for November 13.

**Expected:** +$800, +$500 and +$650 appear on those dates as **three projected receipts**, total **+$1,950** across November 12–27 until any are recorded or explicitly changed. Do **not** ask the freelancer to certify the client will pay, or exclude the receipt based on work type. Optional hours, shifts, tips or job details may help calculate a projection but may not change its projection status.

**Caution:** A work log of unpaid earnings by itself is not an actual cash receipt; if its amount is already included in a projected payout, it must not also enter the forecast separately. Recording actual cash tips can create a receipt exactly once.

## Scenario C0-04 — Recurring obligations and one-time expense

Within November 1–30 a user plans Bills $1,200, Subscriptions $60 and Liability payments $240, all on separate due dates; additionally, a one-time car repair of $175 is planned for November 18.

**Expected:** **Recurring Expenses = $1,500** ($1,200 + $60 + $240), shown as a grouped summary while all three entry kinds retain their identity and Liabilities remains separately viewable. **External outflows in the period = $1,675** including the one-time repair. One-time expense must be entered once in a simple workflow **outside the five onboarding sections**. It must **not** be entered by supplying a “Left to Spend” amount.

**Recording variant:** When the $175 repair is actually recorded as $210 on November 19, current outflow totals use **$210 once** for that occurrence, not $175 + $210. Preserve the planned $175/Nov 18 versus actual $210/Nov 19 for comparison (actual is $35 more and one day later).

## Scenario C0-05 — Strategic Reserve allocations and release

In November the user projects an allocation of **$300** to Strategic Reserves on Nov 7 and release of **$80** on Nov 21.

**Expected:** Net reserve allocation = **$220**. Available cash decreases by $220 for the period; **external spending does not increase**, income does not increase from the release. If the allocation is actually $260, with other projections unchanged, net reserve allocation becomes **$180** and the original $300 estimate remains accessible for comparison. None of these movements should be labeled as a purchase.

## Scenario C0-06 — Transfer between own accounts

The user plans a $400 transfer from an Income account to a Payment account on November 8, and records it on November 9.

**Expected:** Both account ledgers reflect the movement on the appropriate planned/recorded dates, subject to existing account integrity rules. **Aggregate income, external outflows and total available resources across owned accounts change by $0.** The recorded transfer replaces the planned movement; no duplicate. If the user has allocated Strategic Reserves, ensure the same movement is not mistakenly represented as a transfer **and** a separate allocation unless they are explicitly distinct actions.

**Current foundation:** Transfer data has a separate `TransferStatus` in `src/domain/types.ts`; `src/domain/forecast.ts` says transfers are not forecast entries. Exact account-ledger integration remains a separate verification item.

## Scenario C0-07 — The computed remainder (zero-start isolated example)

**Fixture only:** Begin November 1 with **$0 known available**. For the period November 1–30, include projected income **$4,500**, recurring expenses **$2,600**, one-time external expense **$200**, planned reserve allocations **$600**, no releases, no transfers affecting aggregate totals.

**Expected period available change:** $4,500 − $2,600 − $200 − $600 = **+$1,100**. Under the fixture's **explicit zero-start assumption**, the calculated remaining availability at November 30 is **$1,100**. The user enters income, recurring obligations, one-time expenses and reserve plans—never a $1,100 “Varied Spending” line item.

**Recorded substitution:** If one projected $200 one-time expense is recorded at $250 and all other inputs remain as projected, current remaining projection changes to **$1,050**. Do not subtract $200 and $250.

**Confirmed:** The **$1,100** result is Left to Spend for the example's selected November 1–30 forecast period, using income minus all expenses and planned net reserve allocations. The user controls the forecast start date; no next-payday anchor may override that choice. Do not call this result an actual bank balance.

## Scenario C0-08 — Within-period timing and shortfall

The user chooses **November 1** as the forecast starting date. For illustration, beginning available resources are explicitly $0. On November 1, $100 of recurring expenses is due. The only projected income is $500 on November 5.

**Expected:** Total period net change through November 5 is +$400; **the person is $100 short before November 5** if no other available funds exist. A period end number alone must not hide the timing issue. If the application lacks verified starting money, show the timing projection's reference assumption instead of claiming an actual account shortage.

**Owner decision:** The forecast starts on **the user's chosen starting date**, not automatically on their next recurring payday or first-entered income. The current payday-based anchor in `src/domain/forecast.ts` contradicts this requirement. Timing calculations must respect the selected start and include eligible one-time and recurring occurrences. A running total with no known opening balance remains a projection from its stated basis, never a verified bank balance.

## Scenario C0-09 — Canceled, overdue and revised plans

A $90 subscription is projected November 10. If explicitly canceled for that occurrence, it contributes **$0** to current projected outflows and can remain visible as canceled. If it is overdue November 11 and no payment has been recorded, **it remains an unrecorded plan**, not a paid actual. If the user explicitly moves its projected date to November 15, only the revised occurrence contributes to current future totals; preserve sufficient history to identify what was originally planned where required.

**Explicit boundary:** Display handling of overdue dates may carry projected cash effects forward for useful warnings, but must not falsify the occurrence's original planned date or convert it to recorded.

## Scenario C0-10 — Onboarding and input simplicity

The guided financial entry sequence is **Income → Bills → Subscriptions → Liabilities → Strategic Reserves**, with a separate final Review action. Each section allows add another, back, continue/skip and return later. The wizard must not ask the user to estimate Left to Spend or classify one-time purchases as another onboarding section. One-time income is added within Income. A user may reach an initial forecast after entering minimal information; the wizard must not insist on full wages, tips, earnings logs, certainty labels or account routing.

**Expected in-app organization:** Recurring Expenses groups bills, subscriptions and liability payments; Liabilities keeps its own screen for balances and payoff progress, subject to confirmed existing data capabilities.

## Scenario C0-11 — Recorded versus projected presentation

For a period containing both recorded income +$1,250 and a separate future income projection +$900, the combined forecast may calculate **+$2,150** of included receipts, but must not describe **all $2,150 as received**. A clear breakdown such as “Recorded $1,250; projected $900” is an example of acceptable communication; exact layout is subject to later owner review. All recorded numbers come from records; projections do not become actual by date rollover.


## C0-12 — User-chosen forecast start is authoritative

A user selects **2026-11-01** as the forecast start, enters a one-time receipt of **$900 on November 4**, and a recurring paycheck of **$1,500 on November 20**. There is a $120 bill on November 2.

**Expected:** The forecast starts November 1, shows the November 2 projected bill before either projected receipt, includes the November 4 one-time income and November 20 recurring income, and never moves the chosen starting date to November 20. For November 1–30 and zero reserve allocations, **Left to Spend = $900 + $1,500 − $120 = $2,280**. This is a period projection, **not** proof the user had enough in an account to pay $120 on November 2. If the user changes the start to November 5 while keeping November 30 as end, the November 2 bill and November 4 receipt are outside this period; **period Left to Spend = $1,500**, with opening resources not inferred from earlier events. The app may show earlier events in a separate history view, but must not silently extend the chosen period.

**Current divergence:** `src/domain/forecast.ts` derives `forecastStart` from `nextExpectedPayday`, filters starts to eligible recurring income, and excludes one-time income as an anchor. Correct the behavior only in the later authorized implementation phase, with timing and historical regression tests.

## C0-13 — Catching up on an overdue obligation

A user owes **$300** in missed payments on a recurring bill. Their normal upcoming bill is **$150 on November 15**, and they plan a separate **$100 catch-up payment on November 8**.

**Expected:** The user can enter the additional $100 as a **one-time expense**, while the normal recurring $150 schedule stays intact. Within November 1–30, the forecast includes **$250** in planned outflows for these two distinct payments. The remaining $200 behind is informational unless the user schedules it as another payment or already has individual overdue projected occurrences included. Nothing is marked paid until actually recorded.

**Contextual explanation:** On Bills, Subscriptions or Liabilities entry/edit flows, offer an unobtrusive optional tooltip or information popup, for example: **“Behind on a payment? Add what you plan to catch up on as a one-time expense. Your regular payments stay on schedule.”** Provide a direct one-time-entry action where practicable. Do not interrupt everyone with a mandatory popup, require a new onboarding step, or use punitive language.

**No-double-count rule:** If Financial OS already includes an overdue $100 recurring occurrence in the forecast, adding a second $100 one-time payment for that **same** obligation cannot silently create $200 in planned outflows. The UI should enable the user to reschedule or record the existing occurrence, or explicitly distinguish a new additional catch-up amount from that occurrence. **Do not automatically reclassify an existing recurring installment as a new expense.** Liability principal or payoff progress must not increase or decrease twice from the same payment.

**Recorded variant:** If the one-time catch-up is paid as **$95 on November 9**, replace its projected $100 November 8 occurrence with a single recorded $95 November 9 expense and retain the original plan for comparison. The recurring $150 November 15 payment remains a separate projection.

**Design boundary:** This is an optional contextual aid to an existing one-time-expense capability—not a new financial classification, certainty status, or full arrears-management subsystem. C2/C3 should evaluate the simplest placement; C4 must verify liability payment accounting and payoff progress.

## C0-14 — Split an overdue balance across multiple payment dates

A user is **$600 behind** on a bill and plans to catch up in three separate payments: **$200 on November 6, $150 on November 20, and $250 on December 4**. Their ordinary recurring payment of **$125 on November 15 and December 15** continues unchanged.

**Expected:** The three catch-up installments are distinct projected one-time expense occurrences, each on its chosen date, associated with the same obligation for explanation and review. November 1–30 shows **$350** of catch-up payments plus the **$125** November regular payment, for **$475** projected external outflows. December 1–31 shows **$250** catch-up plus the **$125** December recurring payment, for **$375** projected outflows. The complete three-payment catch-up plan totals **$600**; do not subtract the entire $600 in November or duplicate it as a separate $600 expense.

**Flexible scheduling:** Users can choose any number of catch-up installments, different dates and different amounts; installments need not be equal or occur on the recurring bill's normal date. The entry experience can offer **“Split into payments”** as an optional detail alongside a simple single-payment entry, rather than requiring a new category or mandatory multi-step wizard. Show the total scheduled and any remainder not yet assigned a date. Do not invent payment dates or automatically impose a repayment schedule.

**Actuals and revisions:** If the November 6 projected $200 installment is recorded as **$180 paid November 8**, use **$180 once on November 8** in the current timeline; preserve its original $200 November 6 plan. The remaining **$20** is not automatically a new expense, nor automatically added to another installment. The user can explicitly reschedule that shortfall or revise future installments. Other installments remain projections until recorded.

**No double counting:** If an original overdue recurring occurrence already appears in the forecast, adding catch-up installments for the same amount cannot create duplicate projected external outflows. The experience must offer clear association to existing overdue occurrences or an explicit additional-payment path, depending on what is actually being paid. Recording an installment must not also mark a different obligation payment recorded without an explicit linked action. Transfers and Strategic Reserves retain their separate accounting semantics.

**Scope boundary:** C0 specifies the expected behavior, not a fully designed arrears or financing product. Implementing an automated multi-installment plan, linking installments to existing occurrences, or tracking an unpaid balance requires explicit design and regression tests in the relevant later checkpoint. The core need is to let a user accurately place the individual projected payments where they expect them to occur, while keeping normal schedules intact.

## C0-15 — Split a recurring monthly obligation into weekly planned payments

A user has a **$400 monthly bill** due November 30. Instead of making one $400 payment, they choose to pay **$100 on November 6, 13, 20 and 27**. The underlying obligation is still **$400 for November**; its payment plan is four linked weekly installments, not four extra expenses on top of a separate $400 monthly occurrence.

**Expected forecast:** Within November 1–30, projected expense total is **$400, not $800**. For November 1–7 the view shows a **$100 planned installment**, and for the full month it shows the **$400 obligation with its four payment dates**. A future month may have a different number of weekly dates; never blindly assume four weeks per month or silently inflate the amount. The user controls the payment schedule and can review the allocated total against the obligation's amount and due date.

**Dynamic remaining amount:** At initial setup, **$400 remains to be recorded** against the November obligation. After the user explicitly records the November 6 installment at **$100**, the remaining **unrecorded obligation is $300**; three $100 planned installments remain projected. If the November 13 installment is actually recorded at **$80**, the remaining unrecorded obligation becomes **$220**. The app shows the actual amount received by the payee versus what was planned, without automatically declaring the remaining $20 paid. The user can explicitly redistribute that $20, add another installment, or leave it outstanding. The app must show any difference between planned remaining installments and the obligation's remaining amount.

**Corresponding views:** In a weekly forecast, each installment affects that week's projected cash flow on its planned date. In a monthly Recurring Expenses summary, the user sees the single $400 November bill, how much was **recorded as paid**, how much remains, and its installment schedule. The source bill or liability detail links the same obligation and payments. Switching views must **not** create duplicate ledger events, retroactively modify actuals, or turn a monthly obligation into a weekly obligation merely because its payment cadence is weekly.

**Liability variant:** A liability with an amount due for the month may use the same installment schedule. The monthly scheduled amount, installment payments and month-to-date remaining amount update from a single relationship. The liability's **actual outstanding principal/payoff balance** must only change from appropriate recorded principal payments and applicable liability rules, not from projecting an installment or merely moving its date. Do not imply the app knows an interest allocation, minimum-payment rule or lender posting policy unless explicitly modeled and approved.

**Arbitrary splits and timing:** Four $100 installments are only one example. The user may select weekly, biweekly or custom split dates/amounts, including a month with five payment dates. Show allocations accurately for the obligation's relevant cycle, handle boundary dates, and flag when installments are short of or greater than the amount owed. No forced monthly-to-weekly conversion, no invented dates, and no automatic actuals. If a payment is made ahead of its due date, it affects cash flow on its real recorded date, while the obligation view still associates it with the correct month's obligation.

**Necessary implementation distinction:** An obligation's recurring **amount/cycle** and its chosen **payment cadence** are separate concepts. Multiple installments represent allocations toward **one** obligation occurrence. Existing recurring occurrences must be split/replaced or linked in a way that ensures **exactly one** total expense and no simultaneous unsplit duplicate. Do not implement this by simply creating unrelated weekly one-time expenses while keeping the complete monthly amount in forecast totals.

**UX requirement:** Offer **“Split payments”** as an optional control on ordinary Bills, Subscriptions and Liabilities payment setup/detail, with a simple default of one payment. Keep the five-section onboarding intact and defer detailed installment controls to Advanced/optional entry. Updates to split plans require clear handling of the selected occurrence versus future occurrences; recorded past installments are never silently rewritten.

**Acceptance checks:** (1) a $400 monthly obligation split into four $100 weekly payments contributes $400 in November and correct amounts per week; (2) recording $100 then $80 yields $180 recorded and $220 remaining, with the unresolved $20 difference visible; (3) month with five weekly dates and cross-month installment dates preserves correct obligation attribution and date-scoped cash flow; (4) changing future split cadence does not mutate recorded installments; (5) projected payments are not actuals; (6) liability balances and month-to-date progress are not falsely reduced by unrecorded installments.

## Test acceptance translation for C1–C6

1. **C1:** Fixture cases C0-01 through C0-03, C0-11 and C0-12, plus persistence/RLS and historical comparison, must pass without an Expected/Possible gate or forced payday-based forecast start.
2. **C2:** C0-10 must pass on a narrow phone viewport, keyboard navigation and live Vercel preview, retaining skip/review.
3. **C3:** C0-04 through C0-09 and C0-12 through C0-15 must be covered by one canonical engine using **Income − (Expenses + net Strategic Reserves)**, counting both recurring and one-time transactions within the user-selected period, with no double counting. Verify labels and numbers in preview.
4. **C4:** C0-04 recurring aggregation plus actual liability progress backed by verified data; no invented payoff mathematics.
5. **C5:** Copy and default-form review across Home, Plan, Forecast, Activity, Settings and setup.
6. **C6:** Run integrated hosted flows (save, reload, sign out/in, cross-user isolation, recordings, reserves, transfers, changing recurrence) and obtain owner acceptance.

## Confirmed present implementation and gaps

- `src/domain/plan.ts` `periodPlan` computes income minus external outflows minus net reserves, using `entriesInRange`. This is a **period net change** and provides a likely canonical base for the remainder, but it is **not inherently a remaining account balance**.
- `src/domain/forecast.ts` `totals` and `dailyTimeline` implement a running tally anchored to next recurring payday, initialized at $0. It may not include earlier events or one-time-income-only scenarios in the way a user expects of Left to Spend. **Do not assume an unexplained $0 starting balance is a user's real available money**.
- `src/domain/forecast.ts` maps completed occurrences onto their actual date/amount and excludes scheduled duplicate amounts from current totals. Retention of original plan after every edit path still needs test verification.
- `src/domain/types.ts` contains optional account opening balances and transfer statuses; these do not by themselves establish a universal available opening cash quantity.
- `src/ui/screens/Onboarding.tsx` currently has three steps, not five guided category steps, and includes one-time Varied Spending within Payments.
- `src/ui/components/forms.tsx`, `src/domain/types.ts`, `src/domain/forecast.ts`, and `src/state/supabase/rows.ts` currently support Possible income that is excluded from projected totals. C1 must handle full persistence/read path.
- Some labels and forecasts rely on old income-based anchoring; this is a separate correctness concern when trying to present a user-facing remainder.

## Decisions held for explicit review (do not silently invent answers)

**D1 — RESOLVED by owner:** Left to Spend = **Income − (Expenses + net Strategic Reserves)** for the selected forecast period. Both Income and Expenses include recurring and one-time transactions. No category entry for Left to Spend. This projected result is not an actual bank balance.

**D2 — Display period:** The user controls forecast start. A reasonable initial end-date horizon, default Home interval and navigation are still interface decisions; the example's monthly span is for arithmetic only. No default may override the user's chosen start.

**D3 — One-time expense workflow:** The user wants one-time expense entry without a sixth onboarding section. Add a small optional tooltip/popup explaining that catch-up payments can be entered as one-time expenses, including optional split installments across user-chosen dates, with an easy entry path. Verify existing overdue scheduled occurrences do not get counted twice. Choose exact placement after inspecting Home/Plan/Activity. Do not treat the underlying stored `varied` identifier as a product classification decision.

**D4 — Recorded comparison retention:** Verify which original projected amount/date versions survive schedule edits, skipped/canceled occurrences and record corrections; if necessary, a narrow history-design spec is required before code changes.

**D5 — RESOLVED by owner:** The **user selects the forecast starting date**; the app does not force a next-payday or first-income anchor. C1/C3 must test arbitrary user-selected starts, including dates before any income, with irregular and one-time income. The selected period's end/display range and the optional opening balance basis remain implementation details to specify without overturning this rule.

**Release gate:** C0 approval means acceptance of examples and terminology, not approval to implement C1–C6 automatically. Each checkpoint needs its own reviewed Claude instructions and live owner acceptance.
