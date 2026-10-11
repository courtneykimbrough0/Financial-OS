# Cash Flow Forecast

A mobile-first Progressive Web App for planning cash flow. You enter the income, expenses, and liability payments you expect, and the app shows when money comes in, when it goes out, and when timing gaps are likely. When something actually happens (a late paycheck, a bigger bill), you record it. The forecast then recalculates, and the original prediction is kept for comparison.

You enter everything by hand, and the data stays on your device. The app has no bank connections, no account balances, and no budgeting.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit + component tests (Vitest)
npm run typecheck
npm run build        # production build + service worker in dist/
npm run e2e          # end-to-end smoke test in Chromium (run after build)
```

Node 20+ is required. The e2e script uses Playwright with a pinned clock. It saves screenshots to `e2e-screenshots/`, which git ignores.

## Screens

| Screen | Purpose |
| --- | --- |
| Onboarding | Five short steps: welcome, recurring income, expenses, liabilities, review. Shows the next payday and forecast start before you reach the dashboard. |
| Dashboard | Month / Week / Paycheck / Custom views. Each view has KPI cards, a calendar, details for the selected day, a day-by-day timeline with the running tally, the lowest point, and below-zero stretches. The month view also has expandable week summaries. Overdue items are listed at the top. |
| Income | Recurring income (add, edit from an effective date, turn off/on) and one-time income. |
| Expenses | Recurring expenses and one-time expenses. |
| Liabilities | Recurring liability payments. These count once, as money out. |

Tap any transaction to mark it received/paid, change its date or amount, cancel it, undo, or fix a recorded actual.

## Architecture

```
src/
  domain/          Pure TypeScript, no React. Everything is unit tested.
    dates.ts       Date-only (YYYY-MM-DD) arithmetic on UTC midnights; Sunday-start weeks
    money.ts       Integer cents; parsing and formatting
    types.ts       Data model
    recurrence.ts  Occurrence generation for weekly / biweekly / twice-monthly / monthly / custom rules
    occurrences.ts Merges generated occurrences with stored records
    forecast.ts    Anchor, running tally, daily rows, KPIs, week summaries, paycheck cycles
    operations.ts  Every state change (pure functions returning a new state or an error)
  state/
    storage.ts     StorageAdapter interface; localStorage implementation with validation
    store.tsx      React context; applies operations and saves
  ui/              React screens and components
```

Every dashboard element (calendar, KPIs, summaries, timeline, cycles) reads from the single `Forecast` object that `buildForecast` returns, so no business logic is duplicated in components.

### Data model

- **RecurringSource**: description, kind (`income` / `expense` / `liability`), category, active flag, and a list of **schedule versions** (`startDate`, `amountCents`, `rule`). Editing the amount or schedule adds a version that starts on an effective date (today or later). Earlier occurrences keep the expectation they had.
- **OccurrenceRecord**: one dated transaction. One-time transactions always have a record. Recurring occurrences are generated on demand and only get stored once you act on them. Each has a stable id (`<sourceId>@<originalDate>`), so a stored record replaces exactly one generated occurrence. A record holds:
  - `expectedDate` / `expectedAmountCents`: the original prediction. This never changes after creation.
  - `scheduledDate` / `scheduledAmountCents`: the latest expectation for an outstanding item (after a reschedule).
  - `actualDate` / `actualAmountCents`: what you reported.
  - `status`: `scheduled`, `completed`, or `canceled`. **Overdue** is derived (scheduled and the date has passed) and is never stored.

### Persistence

Data is stored on the device as one versioned JSON document in `localStorage`, behind the `StorageAdapter` interface. That interface keeps the forecast engine and UI independent of storage, so a synced backend can replace localStorage later without changing either. If saved data can't be read, a copy is set aside under a separate key instead of being discarded.

## Forecast rules

These rules live in `src/domain/forecast.ts`, and the tests in `src/domain/__tests__/forecast.test.ts` cover them.

**Sign convention.** Income adds to the tally. Expenses and liability payments subtract from it. All amounts are integer cents.

**Where each occurrence lands (its effective date and amount):**
- *Completed*: the actual date and actual amount. The original expected occurrence is **not** also counted.
- *Canceled*: shown on its scheduled date, struck through, and never counted.
- *Outstanding* (scheduled or overdue): the latest scheduled date and amount. An overdue item dated before the forecast start moves forward to the forecast start ("Overdue since …"), so money still owed or expected stays in the tally.

**Forecast anchor.** The next expected payday is the earliest recurring-income occurrence that is either still outstanding (including overdue, since a late paycheck hasn't arrived yet) or was received today. The anchor is the day before that payday. The tally is $0 at the end of the anchor day, and transactions count from the payday onward. If no recurring income is active, the dashboard explains what to add and shows no tally. It never picks an arbitrary date.

**Running tally.** `tally(d) = tally(d−1) + income(d) − outflows(d)` for each day after the anchor. Days on or before the anchor show "—". A week, pay period, or custom range that starts later carries the cumulative value forward from the anchor and never restarts at $0. A negative tally means scheduled outflows have run ahead of inflows since the anchor. The UI calls it "projected cash flow" and never "balance".

**KPIs.** Projected income, projected expenses (liability payments included), and projected cash flow (income − expenses) are the sums of counted entries whose effective date falls within the selected period.

**Weeks.** Weeks run Sunday through Saturday. Month summaries split weeks at the month's edges, so the weekly totals add up exactly to the month.

**Paycheck cycles.** Cycle boundaries are the dates of counted recurring-income entries from the forecast start onward, merged across all income sources. A cycle runs from one income date to the day before the next. A late paycheck's boundary uses its actual date. If there aren't two upcoming income dates, the view explains why instead of inventing dates.

**Recurrence.**
- *Every 2 weeks* is every 14 days. *Twice a month* uses two explicit days of the month (e.g. the 1st and 15th). That gives 24 payments a year, compared with 26 for every 2 weeks.
- Monthly days that don't exist in a month fall on that month's last day (the 31st becomes Feb 28/29, Apr 30). The next month returns to the 31st.
- Every date is computed from the schedule's start date, so adjacent date windows never duplicate or skip an occurrence.

**Safeguards.**
- Recording an actual for an item that is already completed is rejected, which covers double taps and retried saves. To change a recorded actual, use "Fix what was paid".
- Actual dates can't be in the future.
- Rescheduling replaces the scheduled date, so the item is never counted on both dates.
- Turning a source off stops future occurrences. Turning it back on starts at a new next date and leaves the turned-off stretch empty, so no backlog of overdue items appears.

## Accessibility

- Every status pairs color with a symbol or word: ✓ Done, ! Overdue, ▼ Below $0, +/− signs on amounts.
- Calendar days are buttons with full spoken summaries.
- Dialogs trap focus, close on Escape, return focus when closed, and make the page behind them inert.
- Form fields have labels and error descriptions. Toasts and the selected day are announced through live regions.
- Focus rings are visible, a skip link is provided, and tap targets are at least 44px.
- Dark mode follows the system setting.

## Known limitations

- Data lives on one device with no sync or export yet. Clearing site data erases it.
- USD only.
- Recurring sources can be turned off but not deleted once they have recorded history. This is intentional, so the history is preserved.
- Because the anchor moves to the next payday once a paycheck is in the past, items between today and the next payday appear on the calendar and in the KPIs but are outside the running tally until they become overdue.
