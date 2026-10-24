# Financial engine: calculation path and test matrix

> **CURRENT PRODUCT SEMANTICS — October 23, 2026:** Read [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md). All future/unrecorded occurrences remain projections; only user-recorded events are actuals. Source or cadence does not confer certainty. Preserve original projections versus recorded amount/date, and distinguish Left to Spend (calculated residual for a stated period) from one-time external expenses. Reserve allocations are not external spending, and transfers are not income. The formula/data-model implications must be audited and tested before code changes; historical descriptions below are not authorization to preserve contradictory UI semantics.

How stored data becomes the forecast, and which tests prove each behavior. Written for roadmap Step 1; verify against the code before relying on it. All functions are pure and live in `src/domain/`.

## Calculation path

1. **Stored inputs** (`types.ts`, `AppData`). Recurring sources (each with schedule versions, an active flag, end date and paused ranges) and stored records (one-time items, plus recurring occurrences a person has acted on). Each record keeps three things apart: the original prediction (`expected*`, set once when the record is created), the latest expectation (`scheduled*`, changed by moving it) and what happened (`actual*`, set by recording or correcting a payment). Undoing a payment or cancellation of an occurrence that was never moved removes its record, so it follows the schedule again. Amounts are integer cents; dates are `YYYY-MM-DD`.
2. **Schedule dates** (`recurrence.ts`, `occurrenceDates`). Each version's rule produces dates from its start date. Every date is computed from the start, never chained, so date windows never duplicate or skip. Month days that don't exist clamp to the month's last day.
3. **Generated occurrences** (`occurrences.ts`, `expandSource`). Each version covers its start date up to the next version's start. Dates on or after an inactive source's end date, or inside a paused range, are left out. Each occurrence's id is `<sourceId>@<originalDate>`.
4. **Merging stored records** (`occurrences.ts`, `resolveOccurrences`). A stored record replaces the generated occurrence with the same id. One-time records are always included. A stored change to an unpaid recurring occurrence whose original date the schedule no longer produces is set aside (`isSuperseded`); recorded and canceled occurrences are always kept. `findOccurrence` follows the same rules for a single id.
5. **Placing entries** (`forecast.ts`, `buildForecast`).
   - Recorded: on the actual date, at the actual amount.
   - Canceled: shown on its scheduled date, never counted.
   - Outstanding (not recorded): a projection, on its scheduled date at its scheduled amount, whatever the income type or how often it repeats. Overdue once its date passes, it stays an unrecorded projection on that date; it is never moved, and never recorded by the date passing. (C1, October 2026: the Expected/Possible income certainty and its exclusion from totals were removed; a stored `certainty` from before is dropped on load, so that income counts.)
   - The horizon is 400 days from today, extended to the end of any requested period (`through`).
6. **Forecast start and anchor** (`ForecastOptions.start`). The person chooses where the forecast starts: each view passes the first day of the period it shows (Forecast › Month: the 1st of the month in view; Forecast › Custom: the start date entered), and views that look ahead from now (Home, setup's first look, What if…, estimate previews) start today, the default. The start never depends on income: not the next payday, the first income entered, or any income at all (C1, PRODUCT_CONTRACT.md; C0-12). The anchor is the day before; the running total is $0 at its end, a stated reference point, not a bank balance. It isn't stored: it follows the period in view, so it is the same on every device.
   - History: Phase A1 started the running total the day before the earliest upcoming recurring income; C1 replaced that with the chosen start. `forecast.issue` is now only `nothing-planned` (no active item and no one-time item).
7. **Ordering** (`compareEntries`). Date, then entries that raise the running total (income, reserve releases) before those that lower it, then larger amounts first, then description, then id. The order never depends on how data is stored.
8. **Running total** (`dailyTimeline`, `tallyOn`). From the forecast start, each day adds its counted income and reserve releases and subtracts its counted outflows and reserve allocations (`signFor`). Days before the forecast start have no running total, and nothing dated before it is carried into it. The running total is available cash from a $0 starting point, never an account balance.
9. **Derived views.**
   - `totals`, `periodKpis`, `weekSummaries`: income, external outflows and net reserves for any date range (every counted entry in the range, whatever the forecast start), with operating and available cash flow (see **Cash-flow definitions**).
   - `periodPlan` (`plan.ts`): the same, by kind and tag.
   - `explainTimingGaps`: each timing gap with the running total going in, the money out and in from its first day to its lowest day, what happens after the lowest day while it is still below $0, and every entry on the day it is back to $0 or more (or no recovery within the forecast). It reports what the forecast shows rather than naming one cause, and always satisfies before + in − out = lowest, and lowest + after-lowest + recovery day = the running total on recovery.
   - `previewChange` (`preview.ts`): a what-if for one outstanding occurrence (move it, change its amount, or leave it out), applied to a copy with the ordinary operations and forecast with the same engine; nothing is saved. Compares the current and proposed forecasts over the current 90-day warning window (or longer, through a period being viewed): lowest running total, the gap the occurrence is in (or, for income, the gap it ends) and whether it is eliminated, reduced, unchanged or worsened, new gaps, and deeper gaps elsewhere. Both forecasts start on the same day (today), so they are always compared; a payment moved to before the start would drop out of the running total and isn't shown as a fix (`before-payday`, which needs a date before today and so can't arise from an allowed change).
     `applyPreviewedChange` makes a previewed change real after the person confirms it: refused if the data changed since the preview or the preview wasn't comparable; otherwise only that occurrence changes (a skip is recorded as a cancellation).
     One change moves money in one direction: moving a payment later only raises the running total between the two dates, so it can't create a shortfall; moving a payment earlier, moving income later, or a larger amount can, and the preview reports it.
   - `homeView` (`home.ts`): what Home shows (section Home below).
   - `variance` (`occurrences.ts`): a recorded outcome against its original prediction, in cents and days.
   - `weekSummaries`, `monthWeekSummaries`, `lowestPoint`, `negativeStretches`, `timingGapsAhead` (90 days from the forecast start), `overdueEntries`.
   - Screens read only these; none computes money itself.

## Cash-flow definitions

Every counted entry lands in exactly one part, by kind (`totals`):

| Part | Kinds | Effect on the running total |
| --- | --- | --- |
| External income (`inCents`, `incomeCents`) | income | raises it |
| External outflows (`outCents`, `outflowCents`) | bill, subscription, liability, varied | lowers it |
| Net reserves (`reservedCents`, `reservesCents`) | reserve: allocations count positive, releases (`release: true`, one-time only) negative | an allocation lowers it, a release raises it |

- **Operating cash flow** (`operatingCents`) = income − outflows.
- **Available cash flow** (`netCents`, `cashFlowCents`; "Cash flow" in the interface) = operating − net reserves = the change in the running total over the period.
- Worked example (`reserves-transfers` test): income $4,000, outflows $2,800, reserves $500 → operating $1,200, available $700.
- A reserve allocation is money set aside, not spending: it never appears in outflows, and recording it counts it once, at its actual amount. Releasing reserves is never income.

**Accounts and transfers aren't forecast inputs.** Items may carry an `accountId` (PRODUCT_EXPERIENCE.md section 11) and the plan may hold transfers, but nothing above reads either: creating, assigning or deleting accounts and adding, recording or deleting transfers changes no entry, running total or cash-flow figure (`accounts`, `reserves-transfers` tests).

## Earnings from shifts (`earnings.ts`, E2)

Shifts are earnings, never money received, and the forecast never reads them, an income's type or its wage.
- Cash tips enter cash flow once, as their own received one-time income record on the shift's date.
- Wages and card tips enter cash flow once, as the recorded paycheck that pays them (its actual amount); until then they are "earned, not paid yet", outside every total.
- A recorded paycheck pays only work done on or before the day it arrived (`canHavePaid`): correcting it to an earlier date, or moving a shift past it, unpays that work. Links never change an amount (E6).
- Wages for a shift: minutes × wage ÷ 60, rounded to the nearest cent once per shift. Earnings: wages + cash tips + card tips. Effective hourly: earnings ÷ hours over shifts with hours.

## Gig sessions and payouts (`earnings.ts`, `operations.ts`, E4)

Sessions are shift-like work entries (`kind: 'session'`) on gig income. They are earnings, never money received; the forecast never reads them.
- Cash received immediately enters cash flow once, as its own received one-time income record on the session date.
- Platform earnings are "waiting for payout" (`earnedNotPaid`, by platform with `waitingByPlatform`), outside every total.
- A payout is the gig income's ordinary occurrence: projected on its schedule, and counted once when recorded, at its actual date and amount. Recording it links the unpaid sessions dated before it; undoing it unlinks them. Linking changes no figure.
- With no sessions at all, the expected payout alone is the baseline.

## Earnings history (`earnings-history.ts`, E5)

Read-only, from data E2–E4 keep; nothing is stored and the forecast doesn't read it.
- Earned in a month: shifts and sessions dated in it (`summarize`). Never money in.
- Not received yet, as of today: `earnedNotPaid` per income (by platform for gig) and `doneNotPaid`; planned jobs are shown apart and aren't earned.
- Received for work: the month's recorded entries (`recordedEntries`, the same ones Activity's summary counts) that are paychecks or payouts of tracked income, cash tips or session cash, or job payments. Listed, never added again; fixed income is never earnings.

## Freelance jobs (`earnings.ts`, `operations.ts`, E3)

A job is work; its money is one one-time income record, the only part the forecast reads.
- With an expected payment date the record is projected income on that date, counted like any other (overdue if it passes, still a projection on its date).
- Without a date there is no record: the job is pending and counted nowhere.
- Recording the payment records that record: counted once, at the actual date and amount; the original expectation is kept.
- Done but unpaid work (`doneNotPaid`) is never money received.

## Home (`home.ts`, roadmap H1 and H2)

`homeView(data, today, { weekOf })` organizes what the Home screen shows, from the same forecast. `today` decides what is overdue, what needs attention and what progress compares; `weekOf` (any date in a week, default `today`) only chooses the week listed under Coming up and Happened, so browsing weeks never changes a figure. It adds no money math: every figure comes from `buildForecast` and `totals` (through `kpisOfEntries`), `transfersInRange` / `transferShortfall`, `explainTimingGaps` and `variance`. Weeks run Sunday to Saturday.

- **Progress.** This month and last month, each as `recorded` (completed entries only) and `projected` (recorded plus still expected), and two comparisons that state their basis:
  - `monthToDate`: recorded cash flow from the 1st through today against the same days of last month (the 31st compares with the last day of a shorter month). Like for like.
  - `projectedVsLastMonth`: this month as projected against last month as recorded. Different bases, labeled as such.
  - The direction is the sign of the difference (`up`, `down`, `unchanged`); there is no threshold.
- **Attention.** Outstanding items dated today or earlier (overdue first, oldest first, then today's), planned transfers dated today or earlier (never treated as recorded), and timing gaps that start within 7 days (today included) and haven't ended.
- **Coming up.** Outstanding items after today in the viewed week, planned transfers there, and timing gaps starting after the attention window within it. For the current week the window also takes early next week (through the Tuesday after); another week lists only its own days. A past week has nothing coming up. Chronological.
- **Happened.** Entries recorded in the viewed week (on their actual dates, with `variance` against the original expectation) and transfers recorded then. Chronological.
- **Later gaps.** Timing gaps not in Needs attention or the viewed window (within the 90-day look-ahead), so the forecast can still show them. `horizonEnd` is the forecast's reach, for explaining a gap that doesn't end before it.
- Each comparison side carries `count` (the entries behind the figure); a side with `count` 0 has nothing to compare, and Home then shows only the trustworthy figure.
- **Batches.** `recordAsExpected` and `rescheduleSelected` take only items dated today or earlier; a later one is refused with nothing changed. An early payment is recorded one item at a time (`recordActual`). There is no batch undo.
- Each item appears in one section only and carries its stable id (an occurrence id, transfer id, or `gap@<start>`) for the existing sheets; occurrences carry their account (`accountOf`). Empty sections are empty arrays.

## Account balances (`balances.ts`)

A balance is where money is at a point in time, not cash flow over a period. It is known only from an account's optional **opening balance** (what it held at the end of a day the person names); without one, `accountBalance` returns null and the interface states nothing.

- **Recorded balance** at the end of a date = opening + recorded income assigned to the account − recorded payments assigned to it (bills, subscriptions, liabilities, varied spending) + recorded transfers in − recorded transfers out, counting activity after the opening day.
- **Projected balance** adds everything still expected through the date: outstanding assigned items and expected transfers, whatever their date (one due before the opening day and still unrecorded is still owed; `unrecordedPastCount` counts those dated before today). It is an estimate and is never shown as confirmed.
- A one-time item has its own account. A recurring occurrence keeps the account its item had when it was recorded (`recordActual` stores it on the record), so moving an item to another account never moves recorded money; outstanding occurrences follow the item's current account (`accountOf`).
- **Strategic Reserve items never change a balance**: an allocation says money is set aside, and only a transfer moves it. Counting both would count it twice.
- Every transfer changes two balances by the same amount, so the total across accounts is unchanged by it. Balances may go negative; recorded history is kept as it is.
- **Shortfalls** (`transferShortfall`): for an expected transfer, how far its source is projected to fall below $0 on its date (or today, once passed), counting the transfer; null when the source has no opening balance. Nothing moves money to cover it.
- A passed date never records a transfer: Home lists an expected transfer dated today or earlier under Needs attention until it is recorded.

**What the inputs can't express.** No amount of cash on hand is stored, so the running total measures change from the chosen start's $0. Payments due before the first income therefore show as a timing gap from that $0 (C0-08): the person may have money on hand to cover them, which the app doesn't know. An overdue unrecorded item dated before the start isn't in that running total; Home lists it under Needs attention until it is recorded, moved or skipped.

## Adaptive estimates (`estimates.ts`)

Compares a recurring bill, subscription or liability payment's recorded payments with its current estimate, and suggests a new estimate only when they clearly differ. It reads only; nothing changes until the person approves.

- **Payments used.** Recorded payments of the item, by their original date (an early, late or moved payment counts once, for its own occurrence), since its amount last changed (a schedule change that keeps the amount keeps earlier payments), at most the latest 12. Fewer than 3: no suggestion.
- **Rules, in order.**
  1. *Seasonal* (monthly items with 12 payments): at least 3 of the last 12 are more than 25% from their median. The next payment is suggested at the same month's amount in the last two years (averaged, rounded up to a dollar), for that payment only.
  2. *Steady:* the latest 3 or more payments were exactly equal. Suggests that amount.
  3. *Rising or falling:* each of the latest 4 was higher (or lower) than the one before, by at most 25%. Suggests the latest amount (rounded up to a dollar), never an extrapolation.
  4. *Variable:* the latest 6, leaving out any more than 25% from their median, averaged and rounded up to a dollar. Suggested only when the current estimate is outside the range of the payments counted. Fewer than 3 left: no suggestion ("inconsistent").
- **Worth suggesting.** At least $5 and 5% from the current estimate.
- **Confidence.** "Limited" with fewer than 6 counted payments (or one earlier year for a seasonal month), and the limitations are listed: few payments, payments left out as unusual, rounding, payments before the latest amount change, "this payment only".
- **When it starts.** The first outstanding payment from today whose date a new schedule version keeps exactly (so a month-end schedule never drifts). No suggestion while a change the person already set is still to come.
- **Approve** (`approveEstimate`): a schedule version from that date at the new amount (`changeSourceSchedule`), or, for a seasonal one, that one payment's expected amount (`rescheduleOccurrence`). Earlier occurrences, recorded payments and original predictions are untouched. Refused if the data changed since the suggestion.
- **Dismiss** (`dismissEstimate`): the estimate and forecast stay exactly as they are; the item keeps `estimateDismissal` (the estimate, the amount suggested, the latest payment's date). The same suggestion is held back until the estimate changes, the suggested amount moves by at least the minimum change, or 3 newer payments are recorded.
- **Review later** is doing neither: nothing changes and the suggestion stays available.
- **Payments marked.** Each payment considered says whether it counted, and if not, why: unusual (more than 25% from the median), earlier (older than the payments the rule used), or another month (seasonal).
- **Preview** (`previewEstimate`): runs `approveEstimate` on a copy and compares the two forecasts with the same window as What if… (`compareForecasts` in `preview.ts`: 90 days from the forecast start, today, or longer). So a change from a date on covers every later payment in the window, and a seasonal one only its payment. It lists each changed payment with the running total that day, the change in the lowest running total, and new, deeper, smaller and resolved timing gaps. Nothing is saved; refused if the suggestion is out of date.

**Income is not estimated.** Recorded income could show, per income item, the typical amount received, its range and lowest amount, and how early or late it tends to arrive (`variance`), and for tips, commissions or gig work, how much arrives over a period. None of that is used yet. The forecast counts the income the person has entered (as a projection until recorded) and what they recorded; history never adds income to the running total. A later variable-income task could show history-based income as a separate, unconfirmed range outside the running total, or offer a cautious estimate (for example the lowest recent amount) for the person to approve. Strategic Reserve allocations aren't estimated either; their amount is the person's choice.

## Scenarios (`scenarios.ts`)

One or more hypothetical changes evaluated together; the interface's single "See what happens if…" (C6). `evaluateScenario(data, changes, clock, { through })` applies the changes in order to a copy with the ordinary operations, forecasts the copy with `buildForecast`, and compares it with the plan over the same window as every preview (`compareForecasts`: 90 days from the forecast start, today, or longer). Nothing is saved. A scenario of exactly one change to an expected payment can be made real: `applicableChange` maps it to a `ProposedChange`, and `applyPreviewedChange` (preview.ts) applies it after the person confirms, refusing a stale or uncomparable preview. Any other scenario is informational.

- **Changes.** One-time income (always hypothetical) and one-time expenses (varied spending, `addOneTime`); an extra payment on a liability (a one-time money-out item; the app has no one-time liability items, so only the copy's record takes the liability kind); a different amount or date for one outstanding occurrence (`rescheduleOccurrence`); one outstanding occurrence left out (`cancelOccurrence` with the what-if note, on the copy only); a recurring item's amount from one of its payment dates on (`changeSourceSchedule`, refused when the date isn't one of its payments, would drift a month-end schedule, or a change is already set for later); recurring Strategic Reserve allocations and hypothetical recurring income (`addSource`), on an explicit schedule. Hypothetical changes need today or later; each occurrence and each recurring amount is changed at most once per scenario; an invalid change is refused with its number.
- **Assumptions.** Each change is listed with a plain label, money in or out, its amount, one-time or recurring, the dates it lands on in the period, whether its income is hypothetical (added by the scenario) or confirmed (entered by the person), and whether all its dates are in the running total.
- **Comparison.** For the plan and the scenario: cash flow from today to the end of the period, with confirmed and hypothetical income separate (and cash flow without the hypothetical income), the lowest running total and its date, the running total at the end, and every timing gap with its recovery date. Differences, and new, deeper, smaller and resolved gaps (`gapChanges`, shared with estimate previews). `shortfallDespiteGain` is set when the scenario ends higher or has more cash flow yet creates or deepens a gap, so the ending number never hides a shortfall.
- **Not compared** (cash flow only, with the reason): the running totals start on different days (`anchor-changed`), or a transaction moves from inside the running total to before its start (`before-payday`). Both forecasts start today and changes need today or later, so neither arises from an allowed change; the checks stay as guards.
- **Variable income** (`evaluateIncomeCases`): the same scenario with low, expected and high amounts the person supplies (low may be $0, which adds nothing; low ≤ expected ≤ high), once or on a schedule. The income is hypothetical in every case and never added to the plan; nothing is inferred from history.
- Without any income, the running total still compares from today (bills alone, below $0).
- **For the interface.** `scenarioOptions` lists what can be changed without re-entering it: outstanding occurrences for the next 90 days, and liability payments (with no later change set) with their next six payment dates that keep the schedule. `firstShortfall` picks the shortfall to point out first: the earliest new or deeper gap by the day it reaches its lowest, and whether the scenario also ends higher or has more cash flow.

## Test matrix

Files are in `src/domain/__tests__/`. "EV" is `engine-validation.test.ts`; "SC" is `saved-changes.test.ts`; "spec" is `spec-scenarios.test.ts`.

| Behavior | Tests |
| --- | --- |
| Integer cents, parsing, no float drift | `dates-money` › money (all); EV › keeps exact cents over a long horizon |
| Date-only values, time zones | `dates-money` › date-only handling; `forecast` › time zone independence |
| Weekly / every 2 weeks | `recurrence` › weekly and every-two-weeks; EV › schedules across year ends |
| Twice monthly | `recurrence` › twice monthly is distinct…, clamps to month end, does not duplicate…; SC › month-end schedules |
| Monthly, month-end, leap years | `recurrence` › monthly on the 31st…; spec › L month-end and leap-year dates; SC › month-end schedules; EV › leap year case |
| Custom intervals | `recurrence` › custom intervals; EV › every 3 months from Nov 30 |
| Year boundaries | EV › schedules across year ends, crosses a year end… |
| Adjacent windows never duplicate or skip | `recurrence` › adjacent windows…; spec › L split date ranges… |
| Running total arithmetic | EV › applies every income and expense…, period cash flow equals the change…; spec › A, J |
| Same-day events (order and totals) | `forecast` › nets several transactions on the same day…; spec › L several income schedules…; EV › events on the same day |
| Totals through zero and below | `forecast` › finds the lowest point and negative stretches; spec › B; `one-time-and-gaps` › treats exactly $0 as not a gap |
| Period boundaries and horizon | EV › includes events on the first and last day…, extends the forecast…; `forecast` › custom ranges carry the tally… |
| Forecast start chosen by the person (C1: never a payday or first income; before every income; one-time-only and irregular income; expenses only; several schedules) | `projection-first` › C0-12, C0-08, forecasts that no longer depend on income; `forecast` › starts at $0 on the chosen day…; EV › the start stays where chosen…; `ui/projection-first-c1` |
| Several paydays in a week | EV › several paydays in one week |
| Spending before payday (in the running total from the chosen start; a timing gap from $0) | `forecast` › upcoming items before the next payday…, overdue items dated before the forecast start…; EV › spending before the next payday; spec › A |
| Projection first (C1: every unrecorded income counts; recorded replaces its projection once; original kept for comparison; recorded and projected told apart; legacy `possible` data counts) | `projection-first` (all); `state/legacy-certainty`; `integrity.db` › retired income certainty |
| Timing gaps and 90-day lookahead | `one-time-and-gaps` › timing gaps ahead |
| Timing-gap explanations (1, 4, 8+ weeks; timing vs. spending; consistency) | `gap-explanations` (all) |
| What-if previews (move, amount, skip; new and deeper gaps; anchor changes; no saving) | `preview` (all) |
| Actuals (late, early, different amount) | `forecast` › expected vs actual outcomes; spec › C, D, E |
| Paying a bill: once only, correction, undo | `forecast` › rejects duplicate completion…, corrects a recorded actual…, undoing a recorded outcome…; SC › marking a bill paid; `history` › paying a bill, correcting a payment, undoing a payment or cancellation |
| Variance (actual vs. original prediction) | `history` › paying a bill |
| Batches: only selected due items change, later items refused | `batch` (all); `ui/home` |
| Home: sections, week navigation (month and year), progress bases, attention rules | `home`; `ui/home` |
| Adaptive estimates (steady, rising, falling, variable, seasonal; unusual payments; too little history; rate and schedule changes; approve, dismiss, repeat; income not estimated; exact cents) | `estimates` (all); `state/estimate-persistence` |
| Scenarios (one-time, several together, recurring, variable income, anchors, before payday, no stored changes, reconciliation, invalid input) | `scenarios` (all) |
| Freelance jobs: planned, done, paid, overdue and pending payments; only dated payments count, as projections; recorded once at the actual date and amount with the original kept; corrections move the record; clients relabel; delete and skip rules; forecast reads only payment records | `freelance` (all); `state/freelance-persistence`; `integrity.db` › freelance income; `ui/freelance-e3` |
| Income integration (E6): every kind of income at once, each dollar counted once, identical figures through device storage, backups, Supabase rows, PostgreSQL ordinary saves and the local stack; Firebase refusals; damaged records | `state/income-integration`; `integrity.db` › every kind of income through ordinary saves; `equivalence.db`; `adapter.supabase` (CI) |
| Earnings history: earned versus received, effective hourly, tips, jobs and payment states, waiting for payout, corrected and undone payments, several incomes, empty and partial history, no double counting, projected job payments in Activity | `earnings-history` (all); `ui/earnings-e5` |
| Gig sessions: cash counted once on the session date, earnings waiting for payout and never counted, payouts counted once as recorded (expected vs actual date and amount), linking, correcting and undoing payouts, several platforms and incomes, validation | `gig` (all); `state/gig-persistence`; `integrity.db` › gig work and payouts; `ui/gig-e4` |
| Shifts: wages and tips calculations, cash tips counted once on the shift date, wages and card tips never counted until the paycheck (counted once, as recorded), corrections replace the tips record, paycheck links and undo, validation, forecast never reads shifts | `shifts` (all); `state/shift-persistence`; `integrity.db` › hourly and tipped income; `ui/shifts-e2` |
| Rescheduling and canceling | `forecast` › overdue, rescheduled, and canceled occurrences; spec › H, I; SC › a moved occurrence |
| Schedule changes and effective dates | `forecast` › recurring schedule changes; spec › F; SC › D1 |
| Turning items off and on | `forecast` › deactivating stops future occurrences…; SC › D2, items that are turned off |
| Stored records never double count | SC › D1, D2, never list the same occurrence twice; `forecast` › KPIs use actual outcomes… |
| History preserved | SC › recorded history after later changes; spec › F; `history` › schedule changes and history, the original prediction never changes; `state/history-roundtrip` (device storage and backups) |
| Repeatable, order-independent, no mutation | SC › repeated forecasts, building a forecast; EV › gives the same order and totals however the data is stored |
| One-time items | `one-time-and-gaps` › one-time income and expenses…; spec › G |
| Cash flow by kind and tag | `plan` (all) |
| Home sections (progress bases and direction, attention, 7-day gap boundary, coming up, happened, transfers, reserves, accounts, no duplicates, empty, determinism) | `home` (all) |
| Classifications; reserves not counted as outflows; releases; operating vs available cash flow | `plan` › classifications, cash flow for a period; `reserves-transfers` › Strategic Reserves in cash flow; EV › events on the same day |
| Transfers (routes, validation, expected vs recorded, correction, never income or spending) | `reserves-transfers` › transfers between accounts |
| Balances (opening, recorded, projected, conservation, reserves move no balance, shortfalls) | `reserves-transfers` › account balances |
| Accounts (types, assignment, deletion keeps items, transfers block deletion) | `accounts`; `reserves-transfers` › deleting an account |
| Persistence of kinds, releases, balances, transfers | `state/storage`, `state/accounts-persistence`; DB › the six classifications |
