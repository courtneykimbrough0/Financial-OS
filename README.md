# Financial OS

A mobile-first Progressive Web App for planning cash flow. You enter the income, expenses, and liability payments you expect, and the app shows when money comes in, when it goes out, and when timing gaps are likely. When something actually happens (a late paycheck, a bigger bill), you record it. The forecast then recalculates, and the original prediction is kept for comparison.

You enter everything by hand. Data is saved to the user's Financial OS account (Firebase) when accounts are turned on, or on the device otherwise. The app has no bank connections, no account balances, and no budgeting.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit + component tests (Vitest)
npm run typecheck
npm run build        # production build + service worker in dist/
npm run e2e          # end-to-end smoke test in Chromium (builds its own device-only copy)
npm run test:rules   # Firestore security rules, in the Firestore emulator (needs Java)
```

Node 20+ is required. The e2e script uses Playwright with a pinned clock and saves screenshots to `e2e-screenshots/`, which git ignores.

### Sample data

To explore without entering anything, choose **Explore with sample data**. The button is on the onboarding welcome screen and on the Settings page. Sample data is fictional, dated relative to today, and stored under its own key (`financial-os:sample-data`). It never mixes with your real data, and a banner stays on screen the whole time. **Leave** (on the sample-data banner) discards the sample and returns you to your own data unchanged.

The sample (`src/domain/sample.ts`) covers recurring income, rent, utilities, a car-loan liability, and a one-time car repair. It also includes:
- a paycheck that came a day late and was smaller than expected ($1,650 instead of $1,800);
- an electric bill that cost more than expected ($128 instead of $90);
- an unpaid phone bill that shows as overdue;
- a stretch where the running total drops below $0 before the next payday.

It also has a subscription and a savings item.

## Screens

| Screen | Purpose |
| --- | --- |
| Guided setup | Seven steps, one category per step so long lists stay manageable: welcome, income (plus one-time income and, with two or more incomes, the main paycheck), bills (plus one-time expenses), subscriptions, liability payments, savings, review. A **Cash flow** figure for the first pay period updates as you go. The review shows the next payday, the lowest running total, a timing-gap warning when one exists, and a breakdown of the first pay period. |
| Dashboard | Month / Week / Paycheck / Custom views. Each view leads with **cash flow** (income − expenses) for the period, then the lowest running total, any timing gap, and the next payday. Below: a calendar, a breakdown by category (categories with nothing in the period are left out), totals by tag, and the period's weeks. Each week shows its running total and opens in place to show its days; a day opens a sheet with its transactions. The week view lists its days directly. Overdue items sit behind a banner at the top. |
| Income | Recurring income (add, edit from an effective date, turn off/on), one-time income, and the **main paycheck** choice when there are two or more incomes. |
| Expenses | Three tabs: **Bills** (with one-time expenses), **Subscriptions**, and **Savings** (with one-time deposits). |
| Liabilities | Recurring payments on a **card**, **loan**, or **line of credit**. Choosing one of the three is required. Each payment counts once, as money out. |
| Settings | The gear in the top bar. Account (signed-in email, sign out, delete account), backups (download, restore), and sample data. |

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
    sample.ts      Synthetic demonstration data
  state/
    storage.ts     StorageAdapter interface; localStorage implementation with validation
    cloud.ts       Account storage with an on-device copy for offline use
    account.tsx    Account gate; sign out; delete account (no Firebase code, so it stays out of device-only builds)
    firebase.ts    Google sign-in and Firestore storage
    backup.ts      Backup files: create and validate
    store.tsx      React context; applies operations and saves
    mode.tsx       Switches between real data and sample data (separate storage keys)
firestore.rules    Firestore security rules (see security_spec.md)
firebase.json      Rules deployment and emulator settings
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

Data is one versioned JSON document per user (`schemaVersion: 2`), stored on the device in `localStorage`, or in the user's account when accounts are on (below). All storage goes through the asynchronous `StorageAdapter` interface (`src/state/storage.ts`), so the forecast engine and UI are the same either way.

- **Revisions.** Each save increments `revision`. A save is accepted only if it's based on the revision currently stored. Otherwise it is rejected as a conflict, so a stale copy (another tab, later another device) can't overwrite newer data. When that happens, the app shows "Your data was changed somewhere else" with a **Reload** button.
- **Background saving.** Changes appear on screen immediately and save in the background, one save at a time. Changes made while a save is running are folded into the next save. A failed save keeps the change on screen and shows **Try again**. The page warns before closing if a change is still unsaved. The app shows a loading state until data has loaded.
- **Backups.** **Download backup** (on the Settings page) saves a dated JSON file. **Restore from backup** (there and on the setup welcome screen) validates the file the same way saved data is validated, then replaces the current data after the user confirms.
- If saved data can't be read, a copy is set aside under a separate key instead of being discarded.

### Accounts (Firebase)

Accounts turn on when `firebase-applet-config.json` has a `projectId` and `apiKey`. Build with `VITE_ACCOUNTS=off` to run on device storage only (the e2e test does this). Firebase is loaded as a separate file, only in builds with accounts on.

- **Sign-in** is with Google (Firebase Auth); the first sign-in creates the account.
- **Storage.** Each user's whole forecast is one Firestore document at `financialData/{uid}`: the same JSON the app keeps on the device, plus a revision number. Saves run in a transaction that checks the revision, and `firestore.rules` independently requires every save to raise it by exactly one, so racing saves can't both succeed and a stale device can't overwrite newer data. `security_spec.md` lists the rules' guarantees.
- **Offline.** Every change is written to an on-device copy first and marked pending, then sent to the account. The app opens from the device copy when offline, and pending changes are sent when the connection returns or the app next opens. If newer data reached the account from elsewhere in the meantime, the newer data is loaded and this device's unsent changes are offered as a file download, so neither version is lost.
- **Refused saves.** If Firestore refuses a save (for example, rules not deployed), the app says so plainly instead of calling it a connection problem, and keeps the change on the device.
- **First sign-in.** If the account is empty and the device already has a forecast, the app offers to move it into the account.
- **Sign out** removes the account's data from the device (and warns first if changes haven't been sent yet). **Delete account** asks the person to confirm with Google first, then deletes their data and their account.
- The app also asks the browser for persistent storage, so the browser is less likely to clear the device copy when space runs low.

Setup steps for the Firebase project are in [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md).

## Forecast rules

These rules live in `src/domain/forecast.ts`, and the tests in `src/domain/__tests__/forecast.test.ts` cover them.

**Sign convention.** Income adds to the tally. Expenses and liability payments subtract from it. All amounts are integer cents.

**Where each occurrence lands (its effective date and amount):**
- *Completed*: the actual date and actual amount. The original expected occurrence is **not** also counted.
- *Canceled*: shown on its scheduled date, struck through, and never counted.
- *Outstanding* (scheduled or overdue): the latest scheduled date and amount. An overdue item dated before the forecast start moves forward to the forecast start ("Overdue since …"), so money still owed or expected stays in the tally.

**Main paycheck.** One recurring income defines pay periods: the one marked as the main paycheck, or else the first active income. Other income still counts as money in; it just doesn't start a pay period. A household paid on Wednesday and Thursday gets weekly pay periods starting Wednesday, instead of a one-day period followed by a six-day one.

**Forecast anchor.** The next expected payday is the earliest main-paycheck occurrence that is either still outstanding (including overdue, since a late paycheck hasn't arrived yet) or was received today. The anchor is the day before that payday. The tally is $0 at the end of the anchor day, and transactions count from the payday onward. If no recurring income is active, the dashboard explains what to add and shows no tally. It never picks an arbitrary date.

**Running tally.** `tally(d) = tally(d−1) + income(d) − outflows(d)` for each day after the anchor. Days on or before the anchor show "—". A week, pay period, or custom range that starts later carries the cumulative value forward from the anchor and never restarts at $0. A negative tally means scheduled outflows have run ahead of inflows since the anchor. The UI calls it the "running total" and never "balance".

**KPIs.** Projected income, projected expenses (savings included), and **cash flow** (income − expenses) are the sums of counted entries whose effective date falls within the selected period.

**Categories.** Every item is either **income** or an **expense**. Expenses are bills, subscriptions, liability payments, and savings (savings is treated as an expense). Spending is not tracked: income minus expenses is the period's cash flow.

**Liability types.** Every liability payment is exactly one of card, loan, or line of credit. No category in the app is labeled "other", "misc", or anything similarly ambiguous.

**Tags.** Tags are optional, free-text labels (e.g. "housing", "gaming") that the user adds to any item. None are built in. The only suggestions offered are tags the user has already created.

**Cash flow** (`src/domain/plan.ts`) = income − expenses for a period. It covers repeating and one-time items on the dates they fall, uses actual amounts once recorded, and leaves out canceled items. On the dashboard it follows the selected period (month, week, pay period, or custom). During setup it covers the first pay period: the first payday through the day before the next one.

**Timing gaps at the end of setup.** The review step keeps the lowest running total in the first pay period. When the running tally drops below $0 anywhere in the next 90 days, a warning banner appears ("2 timing gaps ahead"). It opens a sheet listing every gap's dates, length, and lowest amount. The banner only shows when a gap exists, and it gives no advice.

**One-time items** (income, bills, savings) occur exactly once. They count everywhere their date falls: the running tally, calendar, month, week, pay period, custom range, KPIs, cash flow, and timing gaps. A one-time income never starts a new pay period.

**Weeks.** Weeks run Sunday through Saturday. Month summaries split weeks at the month's edges, so the weekly totals add up exactly to the month.

**Paycheck cycles.** Cycle boundaries are the dates of counted main-paycheck entries from the forecast start onward. A cycle runs from one main payday to the day before the next; other income lands inside the cycle. A late paycheck's boundary uses its actual date. If there aren't two upcoming main paydays, the view explains why instead of inventing dates.

**Recurrence.**
- *Every 2 weeks* is every 14 days. *Twice a month* uses two explicit days of the month (e.g. the 1st and 15th). That gives 24 payments a year, compared with 26 for every 2 weeks.
- Monthly days that don't exist in a month fall on that month's last day (the 31st becomes Feb 28/29, Apr 30). The next month returns to the 31st.
- Every date is computed from the schedule's start date, so adjacent date windows never duplicate or skip an occurrence.

**Safeguards.**
- Recording an actual for an item that is already completed is rejected, which covers double taps and retried saves. To change a recorded actual, use "Fix what was paid".
- Actual dates can't be in the future.
- Rescheduling replaces the scheduled date, so the item is never counted on both dates.
- Turning a source off stops future occurrences. Turning it back on starts at a new next date and leaves the turned-off stretch empty, so no backlog of overdue items appears.

## Tests

- `src/domain/__tests__/spec-scenarios.test.ts`: the specification's scenarios A–M (basic projection, timing gap, actual income and expenses that differ from expectations, late liability payment, schedule change, one-time transaction, rescheduling, cancellation, dashboard consistency, view changes, date boundaries, persistence).
- `forecast.test.ts`, `recurrence.test.ts`, `dates-money.test.ts`: engine edge cases, including time-zone independence checked across five zones.
- `sample.test.ts`: checks that the sample data shows each behavior it is meant to demonstrate, with the sample built on several different "today" dates.
- `src/state/__tests__`: storage round-trips, damaged data handling, the separation between sample and real data, background saving, backups, and account storage (offline changes, sending them later, conflicts that set changes aside, refused saves).
- `src/state/__tests__/firestore.rules.test.ts` (`npm run test:rules`): every guarantee in `security_spec.md`, checked against the real rules in the Firestore emulator, plus the app's Firestore storage code.
- `src/ui/__tests__/accounts.test.tsx`: Google sign-in, moving device data into a new account, offline saving, recovered changes, and account deletion.
- `src/ui/__tests__`: recording an actual, the double-tap guard, future-date validation, and cancellation, all through the real UI.
- `scripts/e2e-smoke.mjs`: drives a device-only production build in Chromium with a pinned clock (onboarding step by step → all four views → weeks opening into days → late paycheck → settings → backup and restore → sample data).

## Design system

The visual language (color, type, spacing, and components) is documented in [DESIGN.md](DESIGN.md). Its tokens live at the top of `src/styles.css`.

## Accessibility

- Every status pairs color with an icon or word: a check for Done, an alert for Overdue, a downward trend for Below $0, and +/− signs on amounts. Calendar chips are also filled when done and outlined while expected.
- Calendar days are buttons with full spoken summaries.
- Dialogs trap focus, close on Escape, return focus when closed, and make the page behind them inert.
- Form fields have labels and error descriptions. Toasts and the selected day are announced through live regions.
- Focus rings are visible, a skip link is provided, and tap targets are at least 44px.

## Known limitations

- Without accounts turned on, data lives in this browser on one device and isn't synced; clearing site data erases it. Users can download a backup and restore it on any device. The Settings page says so.
- With accounts, two devices editing at the same time don't merge changes: the first save wins and the other device's changes are offered as a download.
- USD only.
- Recurring sources can be turned off but not deleted once they have recorded history. This is intentional, so the history is preserved.
- Because the anchor moves to the next payday once a paycheck is in the past, items between today and the next payday appear on the calendar and in the KPIs but are outside the running tally until they become overdue.
