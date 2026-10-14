# Financial engine: calculation path and test matrix

How stored data becomes the forecast, and which tests prove each behavior. Written for roadmap Step 1; verify against the code before relying on it. All functions are pure and live in `src/domain/`.

## Calculation path

1. **Stored inputs** (`types.ts`, `AppData`). Recurring sources (each with schedule versions, an active flag, end date and paused ranges) and stored records (one-time items, plus recurring occurrences a person has acted on). Each record keeps three things apart: the original prediction (`expected*`, set once when the record is created), the latest expectation (`scheduled*`, changed by moving it) and what happened (`actual*`, set by recording or correcting a payment). Undoing a payment or cancellation of an occurrence that was never moved removes its record, so it follows the schedule again. Amounts are integer cents; dates are `YYYY-MM-DD`.
2. **Schedule dates** (`recurrence.ts`, `occurrenceDates`). Each version's rule produces dates from its start date. Every date is computed from the start, never chained, so date windows never duplicate or skip. Month days that don't exist clamp to the month's last day.
3. **Generated occurrences** (`occurrences.ts`, `expandSource`). Each version covers its start date up to the next version's start. Dates on or after an inactive source's end date, or inside a paused range, are left out. Each occurrence's id is `<sourceId>@<originalDate>`.
4. **Merging stored records** (`occurrences.ts`, `resolveOccurrences`). A stored record replaces the generated occurrence with the same id. One-time records are always included. A stored change to an unpaid recurring occurrence whose original date the schedule no longer produces is set aside (`isSuperseded`); recorded and canceled occurrences are always kept. `findOccurrence` follows the same rules for a single id.
5. **Placing entries** (`forecast.ts`, `buildForecast`).
   - Recorded: on the actual date, at the actual amount.
   - Canceled: shown on its scheduled date, never counted.
   - Outstanding: on its scheduled date at its scheduled amount; if overdue and dated before the forecast start, carried forward to the forecast start.
   - The horizon is 400 days from today, extended to the end of any requested period (`through`).
6. **Next payday and anchor** (`nextExpectedPayday`, `mainPaycheckId`). The main paycheck is the marked income, else the first active income. Next payday: its earliest outstanding occurrence (overdue included), or one received today. Canceled occurrences and ones received before today don't count. The anchor is the day before; the running total is $0 at its end.
7. **Ordering** (`compareEntries`). Date, then income before expenses, then larger amounts first, then description, then id. The order never depends on how data is stored.
8. **Running total** (`dailyTimeline`, `tallyOn`). From the forecast start, each day adds its counted income and subtracts its counted expenses. Days before the forecast start have no running total.
9. **Derived views.**
   - `periodKpis` and `totals`: cash flow for any date range (every counted entry in the range, before payday included).
   - `periodPlan` (`plan.ts`): cash flow by kind and tag.
   - `explainTimingGaps`: each timing gap with the running total going in, the money out and in from its first day to its lowest day, what happens after the lowest day while it is still below $0, and every entry on the day it is back to $0 or more (or no recovery within the forecast). It reports what the forecast shows rather than naming one cause, and always satisfies before + in − out = lowest, and lowest + after-lowest + recovery day = the running total on recovery.
   - `previewChange` (`preview.ts`): a what-if for one outstanding occurrence (move it, change its amount, or leave it out), applied to a copy with the ordinary operations and forecast with the same engine; nothing is saved. Compares the current and proposed forecasts over the current 90-day warning window: lowest running total, the gap the occurrence is in (or, for income, the gap it ends) and whether it is eliminated, reduced, unchanged or worsened, new gaps, and deeper gaps elsewhere. Not compared when the next main payday moves (the running totals would start on different days) or when a payment would move to before the next payday (where the running total doesn't reach).
     `applyPreviewedChange` makes a previewed change real after the person confirms it: refused if the data changed since the preview or the preview wasn't comparable; otherwise only that occurrence changes (a skip is recorded as a cancellation).
     One change moves money in one direction: moving a payment later only raises the running total between the two dates, so it can't create a shortfall; moving a payment earlier, moving income later, or a larger amount can, and the preview reports it.
   - `reviewEntries`: outstanding items due today or earlier, then the rest of the week.
   - `variance` (`occurrences.ts`): a recorded outcome against its original prediction, in cents and days.
   - `weekSummaries`, `monthWeekSummaries`, `paycheckCycles`, `lowestPoint`, `negativeStretches`, `timingGapsAhead` (90 days from the forecast start), `overdueEntries`.
   - Screens read only these; none computes money itself.

**What the inputs can't express.** No amount of cash on hand is stored, so the running total measures change from the payday anchor. Upcoming items before the next payday count in cash flow for their period but not in the running total, so a shortfall before payday can't be shown. Once such an item is overdue and still unrecorded, it's carried to payday.

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
| Main paycheck anchor | `forecast` › anchors at $0…, anchors on the main paycheck…; EV › anchor cases; SC › a moved paycheck the schedule has replaced… |
| Pay periods (back-to-back, several paydays in a week) | `forecast` › paycheck-to-paycheck cycles; EV › several paydays in one week |
| Spending before payday | `forecast` › upcoming items before the next payday…, overdue items dated before the forecast start…; EV › spending before the next payday |
| Timing gaps and 90-day lookahead | `one-time-and-gaps` › timing gaps ahead |
| Timing-gap explanations (1, 4, 8+ weeks; timing vs. spending; consistency) | `gap-explanations` (all) |
| What-if previews (move, amount, skip; new and deeper gaps; anchor changes; no saving) | `preview` (all) |
| Actuals (late, early, different amount) | `forecast` › expected vs actual outcomes; spec › C, D, E |
| Paying a bill: once only, correction, undo | `forecast` › rejects duplicate completion…, corrects a recorded actual…, undoing a recorded outcome…; SC › marking a bill paid; `history` › paying a bill, correcting a payment, undoing a payment or cancellation |
| Variance (actual vs. original prediction) | `history` › paying a bill |
| Batch review: only selected items change, batch undo is exact | `review` (all); `ui/review-sheet` |
| Rescheduling and canceling | `forecast` › overdue, rescheduled, and canceled occurrences; spec › H, I; SC › a moved occurrence |
| Schedule changes and effective dates | `forecast` › recurring schedule changes; spec › F; SC › D1 |
| Turning items off and on | `forecast` › deactivating stops future occurrences…; SC › D2, items that are turned off |
| Stored records never double count | SC › D1, D2, never list the same occurrence twice; `forecast` › KPIs use actual outcomes… |
| History preserved | SC › recorded history after later changes; spec › F; `history` › schedule changes and history, the original prediction never changes; `state/history-roundtrip` (device storage and backups) |
| Repeatable, order-independent, no mutation | SC › repeated forecasts, building a forecast; EV › gives the same order and totals however the data is stored |
| One-time items | `one-time-and-gaps` › one-time income and expenses…; spec › G |
| Cash flow by kind and tag | `plan` (all) |
