# Financial OS

A mobile-first Progressive Web App for planning cash flow. You enter the income, expenses, and liability payments you expect, and the app shows when money comes in, when it goes out, and when timing gaps are likely. When something actually happens (a late paycheck, a bigger bill), you record it. The forecast then recalculates, and the original prediction is kept for comparison.

You enter everything by hand. Data is saved to the user's Financial OS account (Firebase) when accounts are turned on, or on the device otherwise. The app has no bank connections and no budgeting; an account shows a balance only from an opening balance you enter (see Settings, Accounts).

**Architecture direction.** The current version stores data with Firebase (or on the device) and is hosted on Cloud Run, with offline changes synchronized later. Those parts are legacy: Financial OS is moving to Supabase PostgreSQL for data (and, later, authentication), Vercel for hosting, and an online-first design where the backend is the source of truth. The sections below describe how the current version works; [AGENTS.md](AGENTS.md) section C1 and the roadmap's Step 10 describe the plan. The Supabase database foundation and storage adapter are built and tested; only a development build on a local stack uses them so far: [docs/SUPABASE.md](docs/SUPABASE.md).

**Current priority.** Financial OS is in a product experience phase (correct forecasts, clear workflows, natural language, a simpler dashboard, reports, more kinds of income); infrastructure work is paused. See [PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md) and the roadmap's Phases A–F. The screens described below are the current app.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit + component tests (Vitest)
npm run typecheck
npm run build        # production build + service worker in dist/
npm run e2e          # end-to-end smoke test in Chromium (builds its own device-only copy)
npm run test:rules   # Firestore security rules, in the Firestore emulator (needs Java)
npm run test:db      # Supabase migrations and database tests, in a throwaway local PostgreSQL (needs PostgreSQL)
npm run test:supabase # Supabase integration tests through a local Supabase stack (see docs/SUPABASE.md)
npm run e2e:supabase  # the app in Chromium on a local Supabase stack, plus checks that the default build never uses it
npm run dev:supabase  # development only: the app on a local Supabase stack (supabase start), with email-and-password accounts
npm run build:hosted-test # development only: the Supabase build for an approved hosted test project (docs/SUPABASE-HOSTED.md)
npm start            # production server (server.mjs) for the built app; used on Cloud Run
```

Node 20+ is required. The e2e script uses Playwright with a pinned clock and saves screenshots to `e2e-screenshots/`, which git ignores.

### Sample data

To explore without entering anything, choose **Explore with sample data**. The button is on the onboarding welcome screen and on the Settings page. Sample data is fictional, dated relative to today, and stored under its own key (`financial-os:sample-data`). It never mixes with your real data, and a banner stays on screen the whole time. **Leave** (on the sample-data banner) discards the sample and returns you to your own data unchanged.

The sample (`src/domain/sample.ts`) covers recurring income, rent, utilities, a car-loan liability, and a one-time car repair. It also includes:
- a paycheck that came a day late and was smaller than expected ($1,650 instead of $1,800);
- an electric bill that cost more than expected ($128 instead of $90);
- an unpaid phone bill that shows as overdue;
- a stretch where the running total drops below $0 before the next payday.

It also has a subscription and a Strategic Reserve item.

## Screens

| Screen | Purpose |
| --- | --- |
| Guided setup | Seven steps, one category per step so long lists stay manageable (only income is needed for a forecast; once it's added, **Skip to review** jumps past the optional steps): welcome, income (plus one-time income and, with two or more incomes, the main paycheck), bills (plus varied spending), subscriptions, liability payments, Strategic Reserves, review. A **Cash flow** figure for the first pay period (from the first income of any kind) updates as you go. The review shows the next payday, the lowest running total, a timing-gap warning when one exists, and a breakdown of the first pay period. |
| Home | The opening screen (`#/home`): progress, Needs attention, and the week (Coming up, Happened this week), with previous and next week. See **Home** below. |
| Forecast | `#/dashboard` (the earlier dashboard; its redesign is roadmap H3). Month / Week / Paycheck / Custom views. Each view leads with **cash flow** (income − spending − money set aside in reserves) for the period, then the lowest running total, any timing gap, and the next payday. Below: a calendar, a breakdown (income, spending by classification, reserves on their own line; anything with nothing in the period is left out), totals by tag, and the period's weeks. Each week shows its running total and opens in place to show its days; a day opens a sheet with its transactions. The week view lists its days directly. Overdue items and due transfers are on Home, under Needs attention. |
| Income | Recurring income (add, edit from an effective date, turn off/on), one-time income, and the **main paycheck** choice when there are two or more incomes. |
| Expenses | Three tabs: **Bills**, **Subscriptions**, and **Varied** (one-time spending). |
| Liabilities | Recurring payments on a **card**, **loan**, or **line of credit**. Choosing one of the three is required. Each payment counts once, as money out. |
| Reserves | **Strategic Reserves**: recurring and one-time amounts set aside, and one-time uses of reserves. They lower available cash flow and are never counted as spending. |
| Settings | The gear in the top bar. Account (signed-in email, sign out, delete account), **Accounts** (where money is received, held and spent: add with a name and a type; open one to rename it, give it an optional balance, see its transfers or delete it; **Move money** records or plans a transfer between two accounts; device storage only for now), backups (download, restore), and sample data. An item's form offers an optional account that suits it once one exists, and its row shows it. |

Tap any transaction to mark it received/paid, change its date or amount, cancel it, undo, or fix a recorded actual. For a recurring item, “Change just this one” moves only that occurrence; “Change this and later ones” opens the item’s screen to change its schedule from a date on.

**Timing gaps.** When the running total drops below $0, the Forecast screen's “Timing gap ahead” line (and, within 7 days, Home's Needs attention) (and the timing-gap banner at the end of setup) opens an explanation for each gap: the running total going in, the payments and income leading to the lowest point, anything while it stays below $0, and what brings it back to $0 or more, with dates, amounts and running totals from the forecast. If it doesn't recover within the forecast, it says so. On the dashboard, each outstanding item in an explanation has **What if…**: move it, change its amount, or skip it, and see the lowest running total and the timing gaps with and without the change. Nothing is saved while exploring. **Apply change…** (only when the two forecasts can be compared) asks for confirmation, changes just that one item in the forecast, and is refused if your data changed after the preview.

**Estimate suggestions.** When a recurring bill, subscription or liability payment has enough recorded payments that clearly differ from its estimate, its card shows a short suggestion line ("Suggested estimate: $215.00 instead of $180.00 from Nov 3"). **Review** opens the suggestion: the current and suggested amounts, the change, when it would start, how it was worked out, a short explanation, anything to keep in mind (limited history, payments left out as unusual, rounding), and the payments behind it (folded away; each marked counted or why not). Seasonal suggestions say "Possible seasonal increase" and apply to one payment only. **Preview your forecast** shows each payment that would change with the running total that day, the lowest running total, and new, deeper, smaller or resolved timing gaps; nothing is saved. **Approve…** asks for confirmation and then changes the estimate from that date (or that one payment); it's refused if your data changed after the suggestion. **Dismiss** keeps the estimate and hides that suggestion until your payments change. **Not now** just closes it. Income and reserves never get suggestions.

**Explore a scenario.** A button on the Forecast screen opens a sheet for trying what-ifs together: additional income, an unexpected expense, moving or changing an expected payment (chosen from what's already in the forecast), a higher liability payment from one of its dates, reserves on a schedule (including each payday), and variable income as low, expected and high amounts. Each change can be edited or removed. The result compares the current forecast with the scenario (cash flow, lowest and ending running total, timing gaps) and puts any new or deeper shortfall first, even when the ending total improves. It lists what the scenario assumes and the dates it covers, marks added income as hypothetical and shows cash flow without it, and explains when running totals can't be compared (the next payday moves) or an item falls before the next payday. A change the scenario can't use is marked on that change. Nothing is saved: closing the sheet leaves the plan as it was, and reopening starts fresh.

**Home.** The opening screen (`#/home`, first in the navigation; the earlier dashboard is now **Forecast** until its own redesign). Top to bottom, a section appears only when it has something to show: **Progress** (recorded cash flow this month so far against the same days of last month, as a plain difference with an up, down or no-change mark and no threshold; below it, labeled **Projected**, where the month ends, against last month's recorded result), **Needs attention** (overdue and due-today items, expected income that is not yet recorded, planned transfers whose date has passed, and a timing gap that starts within 7 days; each opens the existing item, transfer or gap sheet), then a week navigator (previous, next, Today) over **Coming up** (the rest of this week and early next week, by day; any other week lists its own days) and **Happened this week** (recorded items with any difference from what was expected). Moving between weeks changes only those two sections: what is overdue, progress and needs attention always follow today's date. Home never changes data by itself.

**Recording several at once.** In Needs attention, select items due today or earlier and **Mark done** (each at its expected amount and date) or **Move to a date**, in one step. There is no batch Undo: open an item to correct it (**Mark as not paid** / **not received** returns one item to outstanding). An item not yet due, such as an early payment, is recorded from its own sheet.

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
    estimates.ts   Estimate suggestions from recorded payments; approve and dismiss
    scenarios.ts   Several hypothetical changes compared with the plan (no saving)
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
firebase.json      Rules deployment (named database), emulator settings, optional Firebase Hosting
server.mjs         Production server for Cloud Run (static files, caching, sign-in forwarding)
Dockerfile         Cloud Run image: builds the app, runs server.mjs
  ui/              React screens and components
```

Every dashboard element (calendar, KPIs, summaries, timeline, cycles) reads from the single `Forecast` object that `buildForecast` returns, so no business logic is duplicated in components.

### Data model

- **RecurringSource**: description, kind (`income`, `bill`, `subscription`, `liability` or `reserve`; varied spending is one-time only), optional tags the person creates, a liability type (card, loan, or line of credit) for liability payments, an optional main-paycheck flag on income, an active flag with an end date and earlier paused ranges, and a list of **schedule versions** (`startDate`, `amountCents`, `rule`). Editing the amount or schedule adds a version that starts on an effective date (today or later). Earlier occurrences keep the expectation they had.
- **OccurrenceRecord**: one dated transaction. One-time transactions always have a record. Recurring occurrences are generated on demand and only get stored once you act on them. Each has a stable id (`<sourceId>@<originalDate>`), so a stored record replaces exactly one generated occurrence. A record holds:
  - `expectedDate` / `expectedAmountCents`: the original prediction. This never changes after creation.
  - `scheduledDate` / `scheduledAmountCents`: the latest expectation for an outstanding item (after a reschedule).
  - `actualDate` / `actualAmountCents`: what you reported.
  - `status`: `scheduled`, `completed`, or `canceled`. **Overdue** is derived (scheduled and the date has passed) and is never stored.

- **Estimate dismissal** (`estimateDismissal`, optional, on a recurring item): the latest estimate suggestion the person dismissed (the estimate, the amount suggested, the latest payment's date), so it doesn't return right away.
- **OccurrenceRecord kinds**: a one-time record is `income`, `varied` or `reserve`; a one-time `reserve` with `release: true` takes money out of reserves.
- **Account** (`accounts`, optional): where money is received, held and spent: an id, the person's name for it, a type (`income`, `distribution` or `payment`) and an optional opening balance (`opening`: amount and date). Recurring and one-time items may carry an `accountId` whose type suits them (income → income; bills, subscriptions, liability payments and varied spending → payment; Strategic Reserves → distribution). The forecast never reads accounts.
- **Transfer** (`transfers`, optional): money moved between two different accounts of the person's: amount, date, and `expected` or `recorded`. Never income or spending; it changes balances only (`src/domain/balances.ts`). Kept on the device and in backups; left out of Firebase account saves and refused by the Supabase development build for now (see PRODUCT_EXPERIENCE.md section 11).

### Persistence

Data is one versioned JSON document per user (`schemaVersion: 2`), stored on the device in `localStorage`, or in the user's account when accounts are on (below). All storage goes through the asynchronous `StorageAdapter` interface (`src/state/storage.ts`), so the forecast engine and UI are the same either way.

- **Revisions.** Each save increments `revision`. A save is accepted only if it's based on the revision currently stored. Otherwise it is rejected as a conflict, so a stale copy (another tab, later another device) can't overwrite newer data. When that happens, the app shows "Your data was changed somewhere else" with a **Reload** button.
- **Background saving.** Changes appear on screen immediately and save in the background, one save at a time. Changes made while a save is running are folded into the next save. A failed save keeps the change on screen and shows **Try again**. The page warns before closing if a change is still unsaved. The app shows a loading state until data has loaded. Loading again (after a conflict, or when signing in or out) waits for a save that is still on its way, and a save result that arrives after a newer load is ignored, so it can't change or overwrite what was loaded.
- **Backups.** **Download backup** (on the Settings page) saves a dated JSON file with everything needed to reproduce the forecast, including dismissed suggestions. **Restore from backup** (there and on the setup welcome screen) validates the file the same way saved data is validated, says how many items it has and how many it will replace, offers a backup of the current data first, and replaces the current data only after the user confirms. A damaged file or Cancel changes nothing.
- **Start over.** In Settings, erases everything entered and returns to setup, after a confirmation that offers a backup first.
- If saved data can't be read, a copy is set aside under a separate key instead of being discarded.

### Accounts (Firebase; legacy, to be replaced by Supabase)

Accounts turn on when `firebase-applet-config.json` has a `projectId` and `apiKey`. Build with `VITE_ACCOUNTS=off` to run on device storage only (the e2e test does this). Firebase is loaded as a separate file, only in builds with accounts on.

- **Sign-in** is with Google (Firebase Auth); the first sign-in creates the account.
- **Storage.** Each user's whole forecast is one Firestore document at `financialData/{uid}`: the same JSON the app keeps on the device, plus a revision number. Saves run in a transaction that checks the revision, and `firestore.rules` independently requires every save to raise it by exactly one, so racing saves can't both succeed and a stale device can't overwrite newer data. `security_spec.md` lists the rules' guarantees.
- **Offline** (legacy; to be removed in the move to an online-first design). Every change is written to an on-device copy first and marked pending, then sent to the account. The app opens from the device copy when offline, and pending changes are sent when the connection returns or the app next opens. If newer data reached the account from elsewhere in the meantime, the newer data is loaded and this device's unsent changes are offered as a file download, so neither version is lost.
- **Refused saves.** If Firestore refuses a save (for example, rules not deployed), the app says so plainly instead of calling it a connection problem, and keeps the change on the device.
- **First sign-in.** If the account is empty and the device already has a forecast, the app offers to move it into the account.
- **Sign out** removes the account's data from the device (and warns first if changes haven't been sent yet). **Delete account** asks the person to confirm with Google first, then deletes their data and their account.
- The app also asks the browser for persistent storage, so the browser is less likely to clear the device copy when space runs low.

**Hosting.** The app runs on Cloud Run from the `Dockerfile`, served by `server.mjs` (no dependencies). The server sets caching so new versions show up, sends app pages to `index.html`, and forwards Firebase's sign-in pages (`/__/auth/*`, `/__/firebase/*`) to `https://<project>.firebaseapp.com`, so Google sign-in runs on the app's own address; Safari and installed iPhone apps block sign-in on a different one. The app asks the server for `/__/financial-os/config.json` and, when it's there, signs in through the address it was opened from. The service worker never answers `/__/` paths, so sign-in pages always reach the server. The e2e test runs against `server.mjs`.

Setup steps for the Firebase project are in [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md).

## Forecast rules

These rules live in `src/domain/forecast.ts`, and the tests in `src/domain/__tests__/forecast.test.ts` cover them. [FINANCIAL_ENGINE.md](FINANCIAL_ENGINE.md) traces the calculation step by step and maps each behavior to its tests.

**Sign convention.** Income and reserve releases add to the tally. Outflows (bills, subscriptions, liability payments, varied spending) and Strategic Reserve allocations subtract from it. All amounts are integer cents.

**Where each occurrence lands (its effective date and amount):**
- *Completed*: the actual date and actual amount. The original expected occurrence is **not** also counted.
- *Canceled*: shown on its scheduled date, struck through, and never counted.
- *Outstanding* (scheduled or overdue): the latest scheduled date and amount. An overdue item dated before the forecast start moves forward to the forecast start ("Overdue since …"), so money still owed or expected stays in the tally.

**Main paycheck.** One recurring income defines pay periods (and nothing else): the one marked as the main paycheck, or else the first active income. Other income still counts as money in; it just doesn't start a pay period. A household paid on Wednesday and Thursday gets weekly pay periods starting Wednesday, instead of a one-day period followed by a six-day one.

**Forecast anchor.** The next expected payday is the earliest occurrence of any active recurring income that is either still outstanding (including overdue, since a late paycheck hasn't arrived yet) or was received today. The order income was entered in, and which one is the main paycheck, don't matter, so income from a second job paid before the main paycheck is in the running total. One-time income and hypothetical scenario income don't start it. The anchor is the day before that payday. The tally is $0 at the end of the anchor day, and transactions count from the payday onward. If no recurring income is active, the dashboard explains what to add and shows no tally. It never picks an arbitrary date.

**Running tally.** `tally(d) = tally(d−1) + income(d) − outflows(d) − net reserves(d)` for each day after the anchor. Transfers between accounts never change it. Days on or before the anchor show "—". A week, pay period, or custom range that starts later carries the cumulative value forward from the anchor and never restarts at $0. A negative tally means scheduled outflows have run ahead of inflows since the anchor. The UI calls it the "running total" and never "balance".

**KPIs.** Projected income, external outflows, net Strategic Reserve allocations, and **cash flow** (income − outflows − net reserves) are the sums of counted entries whose effective date falls within the selected period.

**Classifications.** Income, bills, subscriptions, liabilities, Strategic Reserves and varied spending. Bills, subscriptions, liability payments and varied spending are external outflows. A Strategic Reserve allocation is money set aside, not spending: it lowers available cash flow and is shown on its own line. Operating cash flow = income − outflows; cash flow (available) = operating − net reserves.

**Liability types.** Every liability payment is exactly one of card, loan, or line of credit. No category in the app is labeled "other", "misc", or anything similarly ambiguous.

**Tags.** Tags are optional, free-text labels (e.g. "housing", "gaming") that the user adds to any item. None are built in. The only suggestions offered are tags the user has already created.

**Cash flow** (`src/domain/plan.ts`) = income − outflows − net reserves for a period. It covers repeating and one-time items on the dates they fall, uses actual amounts once recorded, and leaves out canceled items. On the dashboard it follows the selected period (month, week, pay period, or custom). During setup it covers the first pay period: the first payday through the day before the next one.

**Timing gaps at the end of setup.** The review step keeps the lowest running total in the first pay period. When the running tally drops below $0 anywhere in the next 90 days, a warning banner appears ("2 timing gaps ahead"). It opens a sheet listing every gap's dates, length, and lowest amount. The banner only shows when a gap exists, and it gives no advice.

**One-time items** (income, varied spending, reserves) occur exactly once. They count everywhere their date falls: the running tally, calendar, month, week, pay period, custom range, KPIs, cash flow, and timing gaps. A one-time income never starts a new pay period.

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
- Undoing a payment or cancellation returns the item to exactly where it was: a recurring item that was never moved follows its schedule again (so later price changes apply to it), and a moved one keeps its new date and amount.
- `variance` (`occurrences.ts`) compares a recorded outcome with its original prediction: the amount difference in cents and the number of days early or late.
- A schedule change or turning a source off replaces the occurrences from its date on. An occurrence that was rescheduled but is still outstanding stops counting once its original date is no longer in the schedule; its record is kept, and it counts again if a later schedule brings that date back. Recorded and canceled occurrences are history and stay as they are.
- Turning a source off stops future occurrences. Turning it back on starts at a new next date and leaves the turned-off stretch empty, so no backlog of overdue items appears.

## Tests

- `src/domain/__tests__/spec-scenarios.test.ts`: the specification's scenarios A–M (basic projection, timing gap, actual income and expenses that differ from expectations, late liability payment, schedule change, one-time transaction, rescheduling, cancellation, dashboard consistency, view changes, date boundaries, persistence).
- `forecast.test.ts`, `recurrence.test.ts`, `dates-money.test.ts`: engine edge cases, including time-zone independence checked across five zones.
- `engine-validation.test.ts`: hand-computed running totals in cents, spending before payday, same-day events, period and year boundaries, several paydays in one week, and the payday anchor after payments, moves and cancellations.
- `src/ui/__tests__/gaps-sheet.test.tsx`: the timing-gap explanation sheet (sections, several gaps, no recovery, keyboard).
- `src/ui/__tests__/whatif-sheet.test.tsx`: the What if… sheet (preview, confirmation, apply, stale previews, not-comparable cases).
- `preview.test.ts`: what-if previews for one occurrence (move, change amount, leave out), compared with the current forecast, without saving.
- `gap-explanations.test.ts`: what the forecast shows about each timing gap (payments and income from its start to its lowest point, and the income that ends it), checked in cents against the running totals.
- `src/ui/__tests__/home.test.tsx`: Home's four sections and their order, hidden empty sections, recorded and projected progress, neutral wording for unrecorded income, due-today and overdue items, batch recording and moving without Undo, the batch cutoff and an early payment, gaps at the 7-day boundary, previous and next week (month and year boundaries) with progress and attention unchanged, no saves from browsing, and that the projected month equals the Forecast figure.
- `src/ui/__tests__/onboarding.test.tsx`: the minimum setup to a forecast (exact cash flow, payday, lowest running total, timing gap), optional steps, Skip to review, payments before payday, corrections, the main paycheck, and keyboard use.
- `src/ui/__tests__/backup-restore.test.tsx` and `start-over.test.ts`: restore shows what it replaces and offers a copy, Cancel and damaged files change nothing, start over with confirmation, and recovery from the backup taken first.
- `src/ui/__tests__/scenario-sheet.test.tsx`: opening and closing, each kind of change, combining, editing and removing, the comparison table and shortfall message, variable-income cases, conflicting and invalid changes, anchor and before-payday limits, nothing saved, and keyboard use.
- `scenarios.test.ts`: scenarios of one-time income and expenses, extra and higher liability payments, reserves from each paycheck, moved dates and changed amounts, several changes together, low/expected/high income, confirmed vs. hypothetical income, a better ending that hides a shortfall, changed anchors, items before payday, recurring changes across month and year ends, no stored changes, exact reconciliation with `buildForecast`, and invalid input.
- `src/ui/__tests__/estimate-sheet.test.tsx`: suggestions on bills, subscriptions and liability payments (none for income, reserves or short history), the amounts, evidence, unusual payments, seasonal and limited-history wording, the forecast preview, approving with confirmation, a stale approval, dismissing, Not now, and keyboard use.
- `estimates.test.ts` and `src/state/__tests__/estimate-persistence.test.ts`: estimate suggestions from recorded payments (steady, rising, falling, variable and seasonal amounts, unusual payments, too little history, rate and schedule changes, minimum change), approving and dismissing, income left out, and keeping dismissals on the device, in backups and in account saves.
- `batch.test.ts`: recording and moving several due items, the due-today cutoff, early payments recorded singly, and correcting one item. `storage.test.ts` and `cloud.test.ts` also cover loading a saved copy that still holds a review rhythm (dropped, never written back).
- `history.test.ts` and `src/state/__tests__/history-roundtrip.test.ts`: the original prediction, the latest expectation and the actual stay distinct through paying, correcting, undoing, canceling and schedule changes, including on the device and in backups; variance values.
- `saved-changes.test.ts`: rescheduled, recorded and canceled occurrences after a later schedule change or turning an item off, paying a moved bill, the next payday after a schedule change, repeated forecasts that never change stored data, and month-end schedules.
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
