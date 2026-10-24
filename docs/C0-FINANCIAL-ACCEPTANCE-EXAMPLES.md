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
- **Left to Spend:** User-facing computed remaining availability. It must declare the reference period and any starting-available-money basis. The arithmetic below demonstrates a zero-start scenario for clarity, but **does not authorize hardcoding a $0 starting balance for actual users**. If the starting availability is unknown, never imply this is their bank balance. A period net change may be displayed as such until a suitable starting basis is defined and approved.
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

**Important product decision still open:** What is the default period and starting-availability basis for **Left to Spend** on Home? Do not call +$1,100 period net change a bank balance. This fixture does not resolve the production rule.

## Scenario C0-08 — Within-period timing and shortfall

Beginning available resources are explicitly $0. On November 1, $100 of recurring expenses is due. The only projected income is $500 on November 5.

**Expected:** Total period net change through November 5 is +$400; **the person is $100 short before November 5** if no other available funds exist. A period end number alone must not hide the timing issue. If the application lacks verified starting money, show the timing projection's reference assumption instead of claiming an actual account shortage.

**Code context:** `src/domain/forecast.ts` currently anchors the running tally to the day before the next expected recurring payday, excludes one-time income from establishing that anchor, and initializes to $0 at the anchor. Therefore its existing tally is **not a universal account-balance calculation**. Any change to anchors needs a separate explicit design and regression tests, not a cosmetic rename to Left to Spend.

## Scenario C0-09 — Canceled, overdue and revised plans

A $90 subscription is projected November 10. If explicitly canceled for that occurrence, it contributes **$0** to current projected outflows and can remain visible as canceled. If it is overdue November 11 and no payment has been recorded, **it remains an unrecorded plan**, not a paid actual. If the user explicitly moves its projected date to November 15, only the revised occurrence contributes to current future totals; preserve sufficient history to identify what was originally planned where required.

**Explicit boundary:** Display handling of overdue dates may carry projected cash effects forward for useful warnings, but must not falsify the occurrence's original planned date or convert it to recorded.

## Scenario C0-10 — Onboarding and input simplicity

The guided financial entry sequence is **Income → Bills → Subscriptions → Liabilities → Strategic Reserves**, with a separate final Review action. Each section allows add another, back, continue/skip and return later. The wizard must not ask the user to estimate Left to Spend or classify one-time purchases as another onboarding section. One-time income is added within Income. A user may reach an initial forecast after entering minimal information; the wizard must not insist on full wages, tips, earnings logs, certainty labels or account routing.

**Expected in-app organization:** Recurring Expenses groups bills, subscriptions and liability payments; Liabilities keeps its own screen for balances and payoff progress, subject to confirmed existing data capabilities.

## Scenario C0-11 — Recorded versus projected presentation

For a period containing both recorded income +$1,250 and a separate future income projection +$900, the combined forecast may calculate **+$2,150** of included receipts, but must not describe **all $2,150 as received**. A clear breakdown such as “Recorded $1,250; projected $900” is an example of acceptable communication; exact layout is subject to later owner review. All recorded numbers come from records; projections do not become actual by date rollover.

## Test acceptance translation for C1–C6

1. **C1:** Fixture cases C0-01 through C0-03 and C0-11, plus persistence/RLS and historical comparison, must pass without an Expected/Possible gate.
2. **C2:** C0-10 must pass on a narrow phone viewport, keyboard navigation and live Vercel preview, retaining skip/review.
3. **C3:** C0-04 through C0-09 must be covered by one canonical engine with no double counting. Verify labels and number basis in preview.
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

**D1 — Left to Spend basis:** Determine whether it means (A) net available change within the selected period, or (B) remaining projected spending capacity as of a selected date using an explicitly known starting amount and all relevant prior events. These are not equivalent. The owner's intent is “what is left after recurring expenses and reserves,” but no automatic bank-balance claim is authorized.

**D2 — Default timeframe:** Choose the default home period and carry behavior in a separate UI acceptance review. Examples use monthly fixtures only for easy arithmetic, not as an approved monthly-only feature.

**D3 — One-time expense workflow:** The user wants one-time expense entry without a sixth onboarding section; choose the simplest placement after inspecting actual Home/Plan/Activity flows. Do not treat the underlying stored `varied` identifier as a product classification decision.

**D4 — Recorded comparison retention:** Verify which original projected amount/date versions survive schedule edits, skipped/canceled occurrences and record corrections; if necessary, a narrow history-design spec is required before code changes.

**D5 — Timeline anchoring:** The current next-recurring-payday anchor affects timing and one-time-only projections. Do not alter it without explicit product review and fixtures proving timing semantics.

**Release gate:** C0 approval means acceptance of examples and terminology, not approval to implement C1–C6 automatically. Each checkpoint needs its own reviewed Claude instructions and live owner acceptance.
