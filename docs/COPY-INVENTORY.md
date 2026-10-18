# Interface wording inventory (October 2026)

Every user-facing string in the default build at commit `d00a919`, for the product experience audit ([PRODUCT-AUDIT.md](PRODUCT-AUDIT.md) §4, the voice guide in [PRODUCT_EXPERIENCE.md](../PRODUCT_EXPERIENCE.md) §2). Read-only: no string was changed. Line numbers are from that commit and will drift; search for the text.

- Template literals are shown with `${...}` placeholders and JSX expressions as `{...}`; strings composed from several pieces are listed once with the composed shape.
- Categories: Page heading · Description/hint · Button label · Navigation · Tooltip/aria-label · Empty state · Warning · Error · Success/toast · Setup instruction · Financial explanation.
- The ID column (e.g. A1, D12) cross-references strings between Section 1 and Section 2.
- Section 2's flags were produced against the audit criteria and are candidates, not decisions; [PRODUCT-AUDIT.md](PRODUCT-AUDIT.md) §4 holds the reviewed replacements. One flag group is noted rather than adopted: "set aside" for **savings** (2.3) is ordinary English and stays; the term to avoid on screen is "set aside" in its recovery sense ("changes set aside"), which appears only in the development build.

---

# Section 1 — Inventory

## src/ui/App.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| A1 | 17, 37 | Dashboard | Navigation / Page heading (document title) |
| A2 | 18, 38 | Income | Navigation / Page heading (document title) |
| A3 | 19, 39 | Expenses | Navigation / Page heading (document title) |
| A4 | 20, 40 | Liabilities | Navigation / Page heading (document title) |
| A5 | 41 | Savings | Page heading (document title) |
| A6 | 42 | Settings | Page heading (document title) |
| A7 | 43 | Get started | Page heading (document title) |
| A8 | 46 | `${titles[route]} · Financial OS` | Page heading (browser tab title) |
| A9 | 54 | Skip to content | Navigation (skip link) |
| A10 | 59 | Financial OS | Page heading (brand) |
| A11 | 62, 92 | Main (aria-label of nav) | Tooltip/aria-label |
| A12 | 71 | Settings (aria-label of gear link) | Tooltip/aria-label |
| A13 | 110 | **You’re exploring sample data.** Your own data stays unchanged. | Warning (banner) |
| A14 | 120–121 | Leave + sr-only " sample data" → "Leave sample data" | Button label |
| A15 | 135 | **A new version of Financial OS is ready.** Update when you’re done entering things. | Description/hint (banner) |
| A16 | 138 | Update | Button label |

## src/ui/router.ts

No user-facing strings. Route ids (`dashboard`, `income`, `expenses`, `liabilities`, `savings`, `settings`, `onboarding`) appear only in the URL hash (`#/${route}`, line 12).

## src/ui/update.ts

No user-facing strings.

## src/ui/screens/Dashboard.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| D1 | 70 | Month | Navigation (view tab) |
| D2 | 71 | Week | Navigation (view tab) |
| D3 | 72 | Paycheck | Navigation (view tab) |
| D4 | 73 | Custom | Navigation (view tab) |
| D5 | 77 | `${weekday}, ${formatShort(date)}` (e.g. "Sun, Oct 18") | Page heading (date format) |
| D6 | 81 | — (null running total) | Financial explanation (placeholder value) |
| D7 | 112 | Choose a start and end date. | Error (field) |
| D8 | 114 | The end date must be on or after the start date. | Error (field) |
| D9 | 130 | 1 transaction needs an update / `${overdue.length} transactions need an update` | Warning (overdue banner + sheet title) |
| D10 | 149–150 | sr-only "Your cash flow, " + `{shortDay(today)}` | Page heading (h1) |
| D11 | 164–165 | Review this week (sheet title) / `Review this week · {toReview}` | Button label |
| D12 | 172 | `Your {cadence label lowercased} review is ready` (e.g. "Your weekly review is ready") | Button label / Success-style prompt |
| D13 | 178 | Explore a scenario | Button label |
| D14 | 181 | Dashboard view (aria-label of tablist) | Tooltip/aria-label |
| D15 | 205 / 206 | Previous month / Next month | Tooltip/aria-label |
| D16 | 215 / 216 | Previous week / Next week | Tooltip/aria-label |
| D17 | 227 / 228 | Previous pay period / Next pay period | Tooltip/aria-label |
| D18 | 233 | `Pay period {n} of {count} · starts with {names joined ' and '} · next main payday {date}` | Description/hint |
| D19 | 237 | Pay periods aren’t available yet | Empty state (title) |
| D20 | 240 | Add a recurring income with its next payment date. Pay periods run from one main payday to the next. | Empty state / Setup instruction |
| D21 | 241 | We need at least two upcoming main paydays to show a pay period. Check that your main paycheck is turned on. | Empty state / Setup instruction |
| D22 | 248 | Start date | Description/hint (field label) |
| D23 | 252 | End date | Description/hint (field label) |
| D24 | 294, 476 | How cash flow and the running total work | Page heading (modal title) / Tooltip/aria-label (info button) |
| D25 | 297 | **Cash flow** is income minus expenses (including savings) for the period you’re looking at. | Financial explanation |
| D26 | 300–301 | The **running total** starts at $0 on {anchor date}, the day before your next expected payday ({forecastStart date}), and adds money in and subtracts money out day by day. It shows timing, separate from your bank balance. Below $0 means scheduled money out runs ahead of money in by that amount. | Financial explanation |
| D27 | 303 | Days on or before {anchor date} show “—” in place of a running total. Payments due before your next payday count in that period’s cash flow but aren’t in the running total, because the app doesn’t know how much money you have now. | Financial explanation |
| D28 | 309 | Calendar key | Page heading (modal title) |
| D29 | 323 | **Add a recurring income to start your forecast.** | Setup instruction (card heading) |
| D30 | 327 | Your running total starts the day before your next expected payday, so we need at least one recurring income (like a paycheck or benefits) with its next payment date. | Setup instruction / Financial explanation |
| D31 | 328 | None of your recurring income has an upcoming payment. Check its next payment date. | Warning / Setup instruction |
| D32 | 329 | Totals for each period are still shown below. | Description/hint |
| D33 | 333 | Go to Income | Button label |
| D34 | 363 | Today | Button label |
| D35 | 405 | Tap a day for details. | Description/hint |
| D36 | 407 | Calendar key | Button label |
| D37 | 412 | Breakdown (title passed to PeriodBreakdown) | Page heading (section) |
| D38 | 417 | Day by day | Page heading (section) |
| D39 | 474 | Cash flow | Page heading (hero label) |
| D40 | 485 | `{+$x} in · {−$y} out` | Financial explanation (hero sub-line) |
| D41 | 489 | Lowest running total | Financial explanation (stat label) |
| D42 | 493 | ` · {date}` after the lowest amount | Financial explanation |
| D43 | 496 | `Starts {date}` | Financial explanation |
| D44 | 504–505 | **Timing gap ahead** · `{range}, by up to {amount}` + ` (+${n} more)` | Warning (callout button) |
| D45 | 514 | Running total stays at or above $0 this period | Success/toast (callout ok) |
| D46 | 523 | `Next expected payday in ${daysToPayday} days` | Financial explanation |
| D47 | 525 | Next expected payday is tomorrow | Financial explanation |
| D48 | 527 | Next expected payday is today | Financial explanation |
| D49 | 528 | `Next expected payday was ${formatShort(payday)}` | Warning |
| D50 | 529 | ` · {date}` | Financial explanation |
| D51 | 540–550 | Day aria-label: `{long date}, money in {amt}, money out {amt}, {n} overdue, {n} done, running total {amt}[, below zero], lowest point` | Tooltip/aria-label |
| D52 | 583 | `Calendar for {range}. Select a day to see its transactions.` (sr-only caption) | Tooltip/aria-label |
| D53 | 616 | Low (calendar flag) | Financial explanation (marker) |
| D54 | 619 / 620 | `−{compact}` / `+{compact}` chips | Financial explanation (marker) |
| D55 | 635 | Money in (green) | Description/hint (key) |
| D56 | 636 | Money out: expenses, including savings (indigo) | Description/hint (key) |
| D57 | 637 | Filled chip: everything that day is done (received or paid) | Description/hint (key) |
| D58 | 638 | Outlined chip: still expected | Description/hint (key) |
| D59 | 639 | Overdue: the date passed and it hasn’t been recorded | Description/hint (key) |
| D60 | 640 | Running total is below $0 that day | Description/hint (key) |
| D61 | 641 | Lowest running total in this period | Description/hint (key) |
| D62 | 642 | Today | Description/hint (key) |
| D63 | 666 | Week by week | Page heading (section) |
| D64 | 678 / 682 | sr-only "Income " / "Expenses " | Tooltip/aria-label |
| D65 | 685 | `Net {signed amount}` | Financial explanation |
| D66 | 688 | `Running total {amount or —}` | Financial explanation |
| D67 | 702 | Weeks run Sunday to Saturday. Tap a week to see its days, and a day for its transactions. | Description/hint |
| D68 | 724 | Nothing scheduled in this period. | Empty state |
| D69 | 731 | `Show details for ${formatLong(r.date)}` | Tooltip/aria-label |
| D70 | 734 | Lowest | Financial explanation (badge) |
| D71 | 737 / 741 / 745 / 749 | In / Out / Net / Running total (timeline column labels) | Financial explanation |
| D72 | 753 | sr-only " (below zero)" | Tooltip/aria-label |
| D73 | 762 | “—” means the day is on or before {anchor date}, when the running total begins. | Financial explanation |
| D74 | 773 | `Overdue since ${formatMedium(o.scheduledDate)}` | Warning |
| D75 | 775 | `Expected ${amount} on ${date}` | Financial explanation |
| D76 | 777 | `Changed from ${amount} on ${date}` | Financial explanation |
| D77 | 802 / 806 / 810 | Money in / Money out / Running total (day sheet stats) | Financial explanation |
| D78 | 825 | `Below $0: scheduled money out is ahead of money in by {amount} at the end of this day.` | Financial explanation / Warning |
| D79 | 827 | Nothing scheduled this day. | Empty state |
| D80 | 823 | `{formatLong(date)}` (day sheet title) | Page heading (modal title) |

## src/ui/screens/Onboarding.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| O1 | 30 | Welcome (step name) | Navigation (step) |
| O2 | 30 | See your cash flow ahead of time | Page heading |
| O3 | 30 | Find out whether your income will cover your bills, and spot tight days before they happen. | Description/hint |
| O4 | 32 | Income (step name) | Navigation (step) |
| O5 | 34 | When does money come in? | Page heading |
| O6 | 35 | Add your regular income, like a paycheck or benefits. Your forecast is built around your next expected payday. | Setup instruction |
| O7 | 38 | Bills (step name) | Navigation (step) |
| O8 | 40 | What bills do you pay? | Page heading |
| O9 | 41 | Rent, utilities, phone, insurance, and other regular bills. Add one-time expenses here too, like a car repair. | Setup instruction |
| O10 | 44 | Subscriptions (step name) | Navigation (step) |
| O11 | 46 | What subscriptions renew? | Page heading |
| O12 | 47 | Streaming services, apps, and memberships that charge you on a schedule. Optional: you can add them later. | Setup instruction |
| O13 | 50 | Liabilities (step name) | Navigation (step) |
| O14 | 52 | What do you pay toward debts? | Page heading |
| O15 | 53 | Regular payments on a card, loan, or line of credit. Skip this if you have none. | Setup instruction |
| O16 | 56 | Savings (step name) | Navigation (step) |
| O17 | 58 | What do you set aside? | Page heading |
| O18 | 59 | Money you move into savings on a schedule. It counts as an expense, so cash flow shows what’s left after it. Optional: you can add it later. | Setup instruction / Financial explanation |
| O19 | 61 | Review (step name) | Navigation (step) |
| O20 | 61 | Check everything over | Page heading |
| O21 | 61 | Tap anything to change it before you start. | Description/hint |
| O22 | 67 | Income / Add income / Add another income / No income added yet | Page heading / Button label / Button label / Empty state |
| O23 | 68 | Bills / Add a bill / Add another bill / No bills added yet | Page heading / Button label / Button label / Empty state |
| O24 | 69 | Subscriptions / Add a subscription / Add another subscription / No subscriptions added yet | Page heading / Button label / Button label / Empty state |
| O25 | 70 | Liability payments / Add a payment / Add another payment / No liability payments added yet | Page heading / Button label / Button label / Empty state |
| O26 | 71 | Savings / Add savings / Add more savings / No savings added yet | Page heading / Button label / Button label / Empty state |
| O27 | 93 | `One time · {date}` | Description/hint (row sub-line) |
| O28 | 116 | `{liabilityPrefix}{rule description} · next {date}` | Description/hint (row sub-line) |
| O29 | 134 | Modal title = add label (O22–O26 "Add …") | Page heading (modal) |
| O30 | 135, 174 | Save (submitLabel) | Button label |
| O31 | 141 | Add one-time income / Add one-time expense | Page heading (modal) |
| O32 | 152 | `One-time {income|expense} of {amount} on {date}. It counts once, in the period it falls in.` | Financial explanation |
| O33 | 154 | To change it, remove it and add it again. | Description/hint |
| O34 | 160, 180 | `Removed ${description}.` | Success/toast |
| O35 | 161, 181 | `{res.error}` (operation error, see operations.ts) | Error (toast) |
| O36 | 165, 185 | `Remove {description}` | Button label |
| O37 | 173 | `Edit ${s.description}` | Page heading (modal) |
| O38 | 226 / 237 | One-time income / One-time expenses | Page heading (section) |
| O39 | 233 | Add one-time income / Add one-time expense | Button label |
| O40 | 240 | Like a tax refund or a bonus. Optional. | Empty state |
| O41 | 240 | Like a car repair or a medical bill. Optional. | Empty state |
| O42 | 258 | Tap an item to change or remove it. | Description/hint |
| O43 | 276–280 | Income / Bills / Subscriptions / Liability payments / Savings (review group headings) | Page heading (section) |
| O44 | 289 | **Add recurring income to start your forecast.** | Warning |
| O45 | 291 | Your forecast starts the day before your next expected payday. You can add it now or later on the Income screen. | Setup instruction |
| O46 | 293 | Add income | Button label |
| O47 | 301 | Next expected payday | Financial explanation (hero label) |
| O48 | 303 | How the running total works | Tooltip/aria-label |
| O49 | 309 | `in ${days} days` / tomorrow / today | Financial explanation |
| O50 | 316 | `Lowest running total before {date}: {amount} · {date}` | Financial explanation |
| O51 | 328 | `{1 payment | n payments} ({total}) {is|are} due before your next payday. The running total starts at $0 on {anchor}, so it doesn’t include {it|them}. Make sure the money you have now covers {it|them}.` | Warning / Financial explanation |
| O52 | 335 | First pay period (breakdown title) | Page heading (section) |
| O53 | 348–349 | Add + sr-only ` {noun}` (e.g. "Add income", "Add bill") | Button label |
| O54 | 356 | None added. | Empty state |
| O55 | 372 | You can change any of these later. | Description/hint |
| O56 | 376 | How the running total works | Page heading (modal) |
| O57 | 379 | The running total starts at $0 on {anchor}, the day before your next expected payday ({payday}), and adds money in and subtracts money out day by day. | Financial explanation |
| O58 | 381 | Anything due before then isn’t in the running total, because the app doesn’t know how much money you have now. | Financial explanation |
| O59 | 382 | It shows timing, separate from your bank balance. | Financial explanation |
| O60 | 431 | `Step ${n} of ${total}: ${name}` | Tooltip/aria-label |
| O61 | 437 | sr-only `{name} (done)` | Tooltip/aria-label |
| O62 | 443 | `Step {n} of {total} · {name}` | Navigation (progress) |
| O63 | 459 | Add when you expect to get paid | Description/hint (checklist) |
| O64 | 460 | Add your main bills and loan payments. Subscriptions and savings can wait | Description/hint (checklist) |
| O65 | 461 | See your cash flow for each pay period and your running total day by day | Description/hint (checklist) |
| O66 | 462 | Record what actually happens, and the forecast updates | Description/hint (checklist) |
| O67 | 465 | `Your income is all you need to see a forecast. You enter everything yourself, and it’s saved {to your account | only on this device}.` | Description/hint |
| O68 | 474 | Explore with sample data | Button label |
| O69 | 477 | Have a backup? Restore it | Button label |
| O70 | 487 | Add at least one recurring income so we can start your forecast from your next payday. You can also continue and add it later. | Warning |
| O71 | 494 | Back | Button label |
| O72 | 499 | Skip to review | Button label |
| O73 | 504 | Get started / Continue without income / Continue | Button label |
| O74 | 508 | See my forecast | Button label |

## src/ui/screens/Settings.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| S1 | 24 | Settings | Page heading |
| S2 | 32 | Your data | Page heading (section) |
| S3 | 36 | Your data is saved to your Financial OS account, with a copy on this device so it opens offline. Changes made offline are saved to your account when you reconnect. | Description/hint |
| S4 | 38 | Your data is saved in this browser on this device. Clearing your browser’s site data removes it, so download a backup to keep a copy or to move it to another device. | Description/hint / Warning |
| S5 | 41 | Backups are available for your own data. Leave the sample data to download or restore one. | Description/hint |
| S6 | 48 | Entered something wrong from the start? Start over to erase everything and set up again. You can download a backup first. | Description/hint |
| S7 | 58 | Sample data | Page heading (section) |
| S8 | 59 | Explore a made-up example to see how the forecast works. It’s kept separate from your own data. | Description/hint |
| S9 | 62 | Explore with sample data | Button label |
| S10 | 69 | Explore with sample data? | Page heading (modal) |
| S11 | 71 | You’ll see a made-up example with a late paycheck, a bill that cost more than expected, an overdue bill, and a stretch where the running total dips below $0. | Description/hint |
| S12 | 72 | Sample data is kept separate from yours. Your own entries stay exactly as they are, and you can return to them anytime with “Leave” on the sample-data banner. | Description/hint |
| S13 | 75 | Not now | Button label |
| S14 | 84 | Show sample data | Button label |

## src/ui/screens/SignIn.tsx (Firebase account build path)

| ID | Line | Text | Category |
|---|---|---|---|
| SI1 | 23 | Sign in · Financial OS | Page heading (browser tab title) |
| SI2 | 33 | Sign-in couldn’t be completed. Try again. | Error |
| SI3 | 43 | Financial OS | Page heading (brand) |
| SI4 | 48 | Sign in to Financial OS | Page heading |
| SI5 | 49 | Your forecast is saved to your account and ready on any device where you sign in. First time here? Signing in creates your account. | Description/hint |
| SI6 | 53 | Signing in… / Continue with Google | Button label |

## src/ui/screens/SourcesScreen.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| SS1 | 20 | Income | Page heading |
| SS2 | 21 | Money you expect to receive, like wages or benefits. | Description/hint |
| SS3 | 22 | Recurring income | Page heading (section) |
| SS4 | 23 | Add recurring income | Button label / modal title |
| SS5 | 24 | Add a paycheck or other regular income to start your forecast. | Empty state / Setup instruction |
| SS6 | 25 | One-time income | Page heading (section) |
| SS7 | 25 | Add things like a tax refund or a gift. They count once. | Empty state |
| SS8 | 28 | Bills | Page heading / tab |
| SS9 | 29 | Regular bills like rent, utilities, phone, and insurance. | Description/hint |
| SS10 | 30 | Recurring bills | Page heading (section) |
| SS11 | 31 | Add bill | Button label / modal title |
| SS12 | 32 | Add regular bills like rent, utilities, phone, or insurance. | Empty state |
| SS13 | 33 | One-time expenses | Page heading (section) |
| SS14 | 33 | Add a bill that happens once, like a medical bill. It counts once. | Empty state |
| SS15 | 36 | Subscriptions | Page heading |
| SS16 | 37 | Services that charge you on a schedule. | Description/hint |
| SS17 | 38 | Subscriptions | Page heading (section) |
| SS18 | 39 | Add subscription | Button label / modal title |
| SS19 | 40 | Add streaming services, apps, and memberships that renew on a schedule. | Empty state |
| SS20 | 44 | Liabilities | Page heading |
| SS21 | 45 | Regular payments on things you owe, like a car loan, student loan, or credit card. Each payment counts once as money going out. | Description/hint / Financial explanation |
| SS22 | 46 | Liability payments | Page heading (section) |
| SS23 | 47 | Add liability payment | Button label / modal title |
| SS24 | 48 | Add payments like a car loan, student loan, or credit card payment. | Empty state |
| SS25 | 52 | Savings | Page heading |
| SS26 | 53 | Money you plan to set aside on a schedule. It counts as an expense. | Description/hint / Financial explanation |
| SS27 | 54 | Recurring savings | Page heading (section) |
| SS28 | 55 | Add savings | Button label / modal title |
| SS29 | 56 | Add regular amounts you set aside, like an emergency fund. | Empty state |
| SS30 | 57 | One-time savings | Page heading (section) |
| SS31 | 57 | Add a single deposit you plan to make. It counts once. | Empty state |
| SS32 | 90 | `Expected {amount} on {date}` | Financial explanation |
| SS33 | 131 | Main paycheck | Description/hint (badge) |
| SS34 | 138 / 142 | On / Off | Description/hint (status badge) |
| SS35 | 151 | `Next: {date}` | Financial explanation |
| SS36 | 154 | No upcoming dates | Empty state |
| SS37 | 157 | `Turned off ${on {date}}. Not included in future forecasts.` | Description/hint |
| SS38 | 162 | `Scheduled change: {amount}, {rule lowercased}, starting {date}.` | Financial explanation |
| SS39 | 169 | `{n} overdue {payment needs | payments need} an update.` | Warning |
| SS40 | 174 | Hide dates / See dates | Button label |
| SS41 | 177 | Edit | Button label |
| SS42 | 181, 223 | Turn off | Button label |
| SS43 | 185 | Turn on | Button label |
| SS44 | 191 | Last 60 days and next 90 days. Select one to record what happened or change just that date. | Description/hint |
| SS45 | 193 | No dates in this window. | Empty state |
| SS46 | 206 | `Turn off ${source.description}?` | Page heading (modal) |
| SS47 | 208 | It will stop appearing in your forecast from today. Everything you’ve already recorded stays, and any overdue payments stay visible until you update them. | Description/hint / Warning |
| SS48 | 211 | Keep it on | Button label |
| SS49 | 219 | `${source.description} turned off.` | Success/toast |
| SS50 | 220 | `{r.error}` | Error (toast) |
| SS51 | 231 | `Turn on ${source.description}` | Page heading (modal) |
| SS52 | 279 | `No ${recurringHeading lowercased} yet` (e.g. "No recurring income yet", "No liability payments yet") | Empty state (title) |
| SS53 | 297 | Add one-time | Button label |
| SS54 | 304 | Nothing one-time yet | Empty state (title) |
| SS55 | 311 | Expected | Page heading (subhead) |
| SS56 | 323 | Recorded or canceled | Page heading (subhead) |
| SS57 | 344 | `Add one-time ${noun}` (e.g. "Add one-time income", "Add one-time bill", "Add one-time savings") | Page heading (modal) |
| SS58 | 349 | `Edit ${editing.description}` | Page heading (modal) |
| SS59 | 359–361 | Bills / Subscriptions / Savings | Navigation (pill tabs) |
| SS60 | 370 | Expenses | Page heading |
| SS61 | 372 | Expense type (aria-label) | Tooltip/aria-label |

## src/ui/components/common.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| C1 | 72 | `{toast message}` with check or alert icon (tone success/error) | Success/toast / Error (container) |
| C2 | 143 | Close (modal close button aria-label) | Tooltip/aria-label |
| C3 | 159 | Expected (status badge) | Description/hint (status) |
| C4 | 160 | Overdue (status badge) | Warning (status) |
| C5 | 161 | Done (status badge, fallback when no kind) | Description/hint (status) |
| C6 | 162 | Canceled (status badge) | Description/hint (status) |
| C7 | 173 | Received / Paid / Saved (completed badge via doneVerb, capitalized) | Description/hint (status) |
| C8 | 182 | Money in (kind tag for income) / Liability (kind tag for liability) / Bill / Subscription / Savings | Description/hint (kind tag) |
| C9 | 191 | sr-only "Tags: " | Tooltip/aria-label |
| C10 | 205 | `+{amount}` / `−{amount}` | Financial explanation (amount) |
| C11 | 264 | $ (money input prefix) | Description/hint |
| C12 | 270 | 0.00 (money input placeholder) | Description/hint |

## src/domain/types.ts (labels)

| ID | Line | Text | Category |
|---|---|---|---|
| T1 | 18–20 | Card / Loan / Line of credit (LIABILITY_TYPE_LABEL) | Description/hint (label) |
| T2 | 32 | received / saved / paid (doneVerb) | Description/hint (status verb) |
| T3 | 182–186 | Income / Bill / Subscription / Liability payment / Savings (KIND_LABEL) | Description/hint (label) |
| T4 | 190–191 | Income / Expenses (GROUP_LABEL) | Page heading (group label) |
| T5 | 201 | `${LIABILITY_TYPE_LABEL} · ` (e.g. "Loan · ") | Description/hint (prefix) |

## src/ui/components/forms.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| F1 | 13–17 | income: noun "income"; "What is this income?"; placeholder "e.g. Paycheck from work"; "Amount you expect to receive"; "Next payment date" | Description/hint (field labels) |
| F2 | 20–24 | bill: noun "bill"; "What is this bill?"; "e.g. Rent"; "Amount you expect to pay"; "Next due date" | Description/hint (field labels) |
| F3 | 27–31 | subscription: noun "subscription"; "What is this subscription?"; "e.g. Streaming service"; "Amount you expect to pay"; "Next charge date" | Description/hint (field labels) |
| F4 | 34–38 | liability: noun "liability payment"; "What is this payment for?"; "e.g. Car loan"; "Payment amount"; "Next payment due date" | Description/hint (field labels) |
| F5 | 41–45 | savings: noun "savings"; "What are you saving for?"; "e.g. Emergency fund"; "Amount you plan to set aside"; "Next date you’ll set it aside" | Description/hint (field labels) |
| F6 | 66 | Tags (optional) | Description/hint (field label) |
| F7 | 68 | Your own labels for grouping, like a place or a hobby. Press Enter or Add after each one. | Description/hint |
| F8 | 71 | Tags on this item (aria-label) | Tooltip/aria-label |
| F9 | 75 | `Remove tag ${t}` (aria-label) | Tooltip/aria-label |
| F10 | 99–100 | Add + sr-only " tag" → "Add tag" | Button label |
| F11 | 105 | Your tags: | Description/hint |
| F12 | 123 | What kind of liability is it? | Description/hint (legend) |
| F13 | 165 | Enter how often it repeats as a whole number (1 or more). | Error |
| F14 | 178 | How often? | Description/hint (field label) |
| F15 | 181–185 | Every week / Every 2 weeks / Twice a month (two set days) / Once a month / Custom | Description/hint (options) |
| F16 | 191 | Which two days of the month? | Description/hint (legend) |
| F17 | 192 / 203 | First day / Second day | Description/hint (field label) |
| F18 | 197 / 208 | 31 (or last day) / `${d} (or last day)` | Description/hint (options) |
| F19 | 218 | Repeats every | Description/hint (legend) |
| F20 | 219 / 222 | Number / Unit | Description/hint (field label) |
| F21 | 225–227 | Days / Weeks / Months | Description/hint (options) |
| F22 | 233 | Repeats on the same day each month. If a month is shorter, it falls on that month’s last day. | Description/hint |
| F23 | 276, 376 | Enter a description. | Error (field) |
| F24 | 277 | Choose card, loan, or line of credit. | Error (field) |
| F25 | 279 | Enter an amount greater than $0, like 1250 or 1250.50. | Error (field) |
| F26 | 280, 379 | Choose a date. | Error (field) |
| F27 | 289 | `Added ${description}.` | Success/toast |
| F28 | 296, 309 | `Saved ${description}.` | Success/toast |
| F29 | 309 | `Updated ${description} starting ${date}.` | Success/toast |
| F30 | 288, 295, 308, 383, 425 | `{result.error}` (operation errors; see operations.ts) | Error (form) |
| F31 | 328 | This item is turned off. Turn it back on to change its amount or schedule. | Description/hint (callout) |
| F32 | 331 | Changes to the amount or schedule apply starting on the date below. Earlier transactions and anything you have already recorded keep their original values. | Description/hint (callout) |
| F33 | 340 | Changes start with the payment on | Description/hint (field label) |
| F34 | 342 | `Currently: ${rule}, ${amount}.` | Description/hint (field hint) |
| F35 | 353, 406, 437 | Cancel | Button label |
| F36 | 356 | Save changes / `Add ${noun}` (e.g. "Add liability payment") | Button label |
| F37 | 378 | Enter an amount greater than $0. | Error (field) |
| F38 | 384 | `Added ${description} on ${date}.` | Success/toast |
| F39 | 390 | This happens once and will not repeat. | Description/hint |
| F40 | 391 | Description | Description/hint (field label) |
| F41 | 393 | e.g. Tax refund / e.g. Extra deposit / e.g. Car repair | Description/hint (placeholder) |
| F42 | 396 / 399 | Expected amount / Expected date | Description/hint (field label) |
| F43 | 409 | `Add one-time {noun}` | Button label |
| F44 | 426 | `${description} is back on, starting ${date}.` | Success/toast |
| F45 | 431 | Next expected date | Description/hint (field label) |
| F46 | 431 | Nothing is added for the time it was turned off. | Description/hint |
| F47 | 440 | Turn back on | Button label |
| F48 | 460 | Main paycheck | Description/hint (legend) |
| F49 | 462 | Pay periods run from one main payday to the next. Other income still counts as money coming in during the pay period. | Financial explanation |
| F50 | 474 | `Pay periods now follow ${description}.` | Success/toast |
| F51 | 475 | `{r.error}` | Error (toast) |

## src/ui/components/OccurrenceSheet.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| OS1 | 22 | on the expected date | Financial explanation |
| OS2 | 24 | `${n} day${s} ${late|early}` | Financial explanation |
| OS3 | 28 | Originally expected → `${amount} on ${date}` | Financial explanation |
| OS4 | 30 | Updated expectation → `${amount} on ${date}` | Financial explanation |
| OS5 | 34 | `Actually ${received|paid|saved}` → `${amount} on ${date}` | Financial explanation |
| OS6 | 35 | Difference → `Same amount` or `${signed diff} vs. expected`, `${timing}` | Financial explanation |
| OS7 | 37 | Canceled → `Note: ${note}` / Not expected to happen | Financial explanation |
| OS8 | 63 | Transaction (modal title, missing item) | Page heading (modal) |
| OS9 | 64 | This transaction no longer exists. | Empty state / Error |
| OS10 | 101 | Enter an amount greater than $0. | Error |
| OS11 | 102 | Choose a date. | Error |
| OS12 | 104 | `Recorded ${description}: ${amount} ${received|paid|saved} on ${date}.` | Success/toast |
| OS13 | 106 | `Updated what was ${verb} for ${description}.` | Success/toast |
| OS14 | 108 | `${description} now expected ${amount} on ${date}.` | Success/toast |
| OS15 | 116 | `{description}` (modal title) | Page heading (modal) |
| OS16 | 122 | `{KIND_LABEL} · Recurring` / `{KIND_LABEL} · One-time` | Description/hint |
| OS17 | 127 | `{formatLong(date)}` | Financial explanation |
| OS18 | 131 | `This was expected on {date} and hasn’t been marked {verb}. It stays in your forecast until you record what happened, change its date, or cancel it.` | Warning |
| OS19 | 141 | `Mark {received|paid|saved}` | Button label |
| OS20 | 144 | Change just this one / Change date or amount | Button label |
| OS21 | 147 | Cancel this one | Button label |
| OS22 | 154 | `Fix what was {verb}` | Button label |
| OS23 | 156 | `Marked ${description} as not ${verb} yet.` | Success/toast |
| OS24 | 157 | `Undo: not {verb} yet` | Button label |
| OS25 | 162 | `Restored ${description}.` | Success/toast |
| OS26 | 163 | Restore to expected | Button label |
| OS27 | 168 | `Delete this one-time {o.kind}` (raw kind id: income / bill / savings) | Button label |
| OS28 | 181 | Change this and later ones | Button label |
| OS29 | 184 | `“Just this one” changes only the {date} occurrence. To change the amount or schedule from a date on, edit {description} on its screen.` | Description/hint |
| OS30 | 193 | `What was ${verb}?` / `Fix what was ${verb}` / New expected date or amount | Page heading (form) |
| OS31 | 194 | Expected amount / `Amount ${verb}` | Description/hint (field label) |
| OS32 | 195 | Expected date / `Date ${verb}` | Description/hint (field label) |
| OS33 | 195 | The original prediction is kept for comparison. | Description/hint |
| OS34 | 207 | Back | Button label |
| OS35 | 210 | `Save as ${verb}` / Save | Button label |
| OS36 | 221 | `Canceled ${description} on ${date}.` | Success/toast |
| OS37 | 224 | Cancel this occurrence? | Page heading (form) |
| OS38 | 225 | It will be removed from your forecast but kept on record as canceled. / Future occurrences are not affected. | Description/hint |
| OS39 | 226 | Note (optional) | Description/hint (field label) |
| OS40 | 230, 246 | Keep it | Button label |
| OS41 | 233 | Cancel occurrence | Button label |
| OS42 | 241 | `Delete this one-time {o.kind}?` | Page heading (form) |
| OS43 | 242 | Use this if it was added by mistake. To keep a record that it didn’t happen, cancel it instead. | Description/hint |
| OS44 | 248 | `Deleted ${description}.` | Success/toast |
| OS45 | 249 | Delete | Button label |
| OS46 | 92, 204, 227, 243, 254 | `{result.error}` (operation errors) | Error |

## src/ui/components/EstimateSheet.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| E1 | 21 | Same amount each time | Financial explanation (method) |
| E2 | 23 | Payments going up | Financial explanation (method) |
| E3 | 25 | Payments going down | Financial explanation (method) |
| E4 | 27 | Average of recent payments | Financial explanation (method) |
| E5 | 29 | Possible seasonal increase / Possible seasonal decrease | Financial explanation (method) |
| E6 | 33 | `${amount} more` / `${amount} less` | Financial explanation |
| E7 | 34 | `For the ${date} payment only` / `From ${date} on` | Financial explanation |
| E8 | 43–45 | `{Suggested estimate: | <method>: }{proposed} instead of {current}{ for {date} | from {date}}.` | Description/hint (callout on item card) |
| E9 | 47 | `Review the suggestion for ${description}` (aria-label) | Tooltip/aria-label |
| E10 | 48 | Review | Button label |
| E11 | 55 | Left out: more than 25% from your typical payment | Financial explanation |
| E12 | 56 | Not counted: older than the payments used | Financial explanation |
| E13 | 57 | Not counted: a different month | Financial explanation |
| E14 | 84 | This item (fallback name) | Description/hint |
| E15 | 88, 115 | `Suggestion for ${name}` | Page heading (modal) |
| E16 | 90 | There’s no suggestion for this item right now. Its estimate stays as it is. | Empty state |
| E17 | 104 | `${description} on ${date} is now expected at ${amount}.` / `${description} is now expected at ${amount} from ${date}.` | Success/toast |
| E18 | 110 | `Suggestion dismissed. ${description} stays at ${amount}.` | Success/toast |
| E19 | 123 | Limited history | Warning (badge) |
| E20 | 130 / 134 / 138 | Current estimate / Suggested / Change | Financial explanation (stat labels) |
| E21 | 146 | Approve this change? | Page heading (confirm) |
| E22 | 149 | `Expect ${proposed} for the ${date} ${description} payment instead of ${current}. Later payments stay at their current estimate.` | Financial explanation |
| E23 | 150 | `Change the ${description} estimate from ${current} to ${proposed}, starting with the ${date} payment.` | Financial explanation |
| E24 | 152 | Earlier payments, what you’ve recorded, and what was originally expected stay as they are. This changes your Financial OS forecast only. | Description/hint (reassurance) |
| E25 | 163 | Go back | Button label |
| E26 | 166 | Approve change | Button label |
| E27 | 172 | `{s.explanation}` (see estimates.ts) | Financial explanation |
| E28 | 174–175 | Keep in mind (aria-label + section label) | Page heading (section) |
| E29 | 178 | `{limitation}` (see estimates.ts) | Warning |
| E30 | 186 | Payments behind this suggestion | Page heading (disclosure) |
| E31 | 188 | `{n} counted of {total}` | Description/hint |
| E32 | 191 | Payments (aria-label) | Tooltip/aria-label |
| E33 | 197 | ` · paid {date}` · Counted / {EXCLUDED reason} | Financial explanation |
| E34 | 208 | Hide forecast preview / Preview your forecast | Button label |
| E35 | 211 | Forecast preview (aria-label) | Tooltip/aria-label |
| E36 | 220 | Not now | Button label |
| E37 | 223 | Dismiss | Button label |
| E38 | 235 | Approve… | Button label |
| E39 | 239 | `Dismiss keeps {current} and doesn’t suggest this again until your payments change. Not now closes this; the suggestion stays here for later.` | Description/hint |
| E40 | 250 | `{result.error}` (preview error, see estimates.ts) | Error |
| E41 | 259 | Your lowest running total would improve from {a} to {b}. | Financial explanation |
| E42 | 261 | Your lowest running total would drop from {a} to {b}. | Financial explanation |
| E43 | 262 | Your lowest running total would stay at {a}. | Financial explanation |
| E44 | 265 | Payments that change (aria-label) | Tooltip/aria-label |
| E45 | 272 | ` · running total {a} → {b}` | Financial explanation |
| E46 | 273 | ` · before your next payday, outside the running total` | Financial explanation |
| E47 | 277 | `{current} → {proposed}` | Financial explanation |
| E48 | 285 | This would change your next payday, when the running total starts, so the two running totals can’t be compared directly. | Financial explanation / Warning |
| E49 | 286 | There’s no upcoming payday to start a running total from, so only the payment amounts are shown. | Financial explanation / Warning |
| E50 | 291 | `Compared through ${date}; the new estimate also applies to later payments. ` | Financial explanation |
| E51 | 292 | Nothing is saved until you approve. | Description/hint (reassurance) |
| E52 | 102, 109 | `{r.error}` (approve/dismiss errors, see estimates.ts) | Error |

## src/ui/components/PeriodReviewSheet.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| PR1 | 30 | Review (modal title, nothing due) | Page heading (modal) |
| PR2 | 31 | There’s no review right now. | Empty state |
| PR3 | 45 | `${CADENCE_LABEL} review` → "Weekly review" / "On payday review" / "Monthly look-ahead review" | Page heading (modal) |
| PR4 | 47 | `{date range}` | Description/hint |
| PR5 | 50 / 54 / 58 | Money in / Money out / Cash flow | Financial explanation (stat labels) |
| PR6 | 62 | Expected and recorded items for these dates. | Description/hint |
| PR7 | 65 | Needs an update | Page heading (group) |
| PR8 | 65 | The date passed and nothing was recorded. They stay expected until you record them. | Description/hint |
| PR9 | 68–69 | Timing gaps (aria-label + section label) | Page heading (section) |
| PR10 | 73–74 | `{range}: down to {amount}` + `, back to $0 or more on ${date}` | Financial explanation / Warning |
| PR11 | 80 | Expected income | Page heading (group) |
| PR12 | 81 | Expected payments | Page heading (group) |
| PR13 | 82 | Recorded | Page heading (group) |
| PR14 | 86 | Review skipped. | Success/toast |
| PR15 | 87 | Skip this one | Button label |
| PR16 | 89 | Review done. | Success/toast |
| PR17 | 90 | Mark review done | Button label |
| PR18 | 93 | Marking the review done doesn’t record any payments or income. | Description/hint (reassurance) |
| PR19 | 105 | None. | Empty state |
| PR20 | 112 | `{Received|Paid|Saved} {date}` | Description/hint |
| PR21 | 114 | `Expected {date} · not recorded` | Warning |
| PR22 | 116 | Expected today | Description/hint |
| PR23 | 117 | `Expected {date}` | Description/hint |
| PR24 | 38 | `{r.error}` | Error |

## src/ui/components/ReviewSheet.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| R1 | 19 | `1 item` / `${n} items` | Description/hint |
| R2 | 75 | `Marked ${n items} done as expected.` | Success/toast |
| R3 | 78 | Choose a date. | Error |
| R4 | 79 | `Moved ${n items} to ${date}.` | Success/toast |
| R5 | 90 | `Undone: ${n items} back to how they were.` | Success/toast |
| R6 | 96 | `{title}` (from Dashboard: "Review this week" or "N transactions need an update") | Page heading (modal) |
| R7 | 100 | `{batch.message}` (R2/R4 repeated in undo callout) | Success/toast |
| R8 | 102 | Undo | Button label |
| R9 | 107 | Nothing to review through Saturday. Everything due so far has been recorded. | Empty state / Success |
| R10 | 109 | Select what went as expected and mark it done in one step, or tap an item to record a different amount or date. | Description/hint |
| R11 | 111 | Needs an update | Page heading (group) |
| R12 | 111 | Due today or earlier. These stay in your forecast until you record them. | Description/hint |
| R13 | 112 | Later this week | Page heading (group) |
| R14 | 117 | `Mark {n items} done` | Button label |
| R15 | 120 | Move to a date | Button label |
| R16 | 122 | Done uses each item’s expected amount and date (today, for items not yet due). Each original prediction is kept. | Description/hint |
| R17 | 127 | `New expected date for ${n items}` | Description/hint (field label) |
| R18 | 127 | Amounts stay the same. Only the selected items move. | Description/hint |
| R19 | 132 | Back | Button label |
| R20 | 135 | Move | Button label |
| R21 | 172 | Clear / Select all | Button label |
| R22 | 182 | `Overdue since ${date}` / Due today / `Due ${date}` | Warning / Description/hint |
| R23 | 190 | `Select ${description}, ${amount}, ${when lowercased}` (checkbox aria-label) | Tooltip/aria-label |
| R24 | 67, 86 | `{result.error}` | Error |

## src/ui/components/rhythm.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| RH1 | 8 | Off | Description/hint (option) |
| RH2 | 9 | Weekly | Description/hint (option) |
| RH3 | 10 | On payday | Description/hint (option) |
| RH4 | 11 | Monthly look-ahead | Description/hint (option) |
| RH5 | 15 | No reviews. You can still look at your forecast anytime. | Description/hint |
| RH6 | 16 | A short look at the week, each Sunday through Saturday. | Description/hint |
| RH7 | 17 | A look at each pay period, starting on your main payday. | Description/hint |
| RH8 | 18 | A look at the month ahead, from the 1st. | Description/hint |
| RH9 | 29 | Reviews turned off. | Success/toast |
| RH10 | 29 | `Reviews: ${label lowercased}.` → "Reviews: weekly." / "Reviews: on payday." / "Reviews: monthly look-ahead." | Success/toast |
| RH11 | 33 | Review rhythm | Page heading (section) |
| RH12 | 34 | A quick look at what’s coming up, when it suits you. It shows on your dashboard when it’s due; there are no notifications or emails. | Description/hint |
| RH13 | 36 | How often to review (sr-only legend) | Tooltip/aria-label |

## src/domain/cadence.ts

No user-facing strings (period logic only; labels live in rhythm.tsx).

## src/ui/components/ScenarioSheet.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| SC1 | 25 | Additional income — Money that might come in once | Button label + Description/hint |
| SC2 | 26 | Unexpected expense — A cost that might come up once | Button label + Description/hint |
| SC3 | 27 | Move an expected payment — One upcoming payment on another date | Button label + Description/hint |
| SC4 | 28 | Change an expected amount — One upcoming payment at another amount | Button label + Description/hint |
| SC5 | 29 | Increase a liability payment — A higher payment from a date on | Button label + Description/hint |
| SC6 | 30 | Set aside savings — An amount on a schedule | Button label + Description/hint |
| SC7 | 31 | Explore variable income — Low, expected and high amounts | Button label + Description/hint |
| SC8 | 35 | Once / Each payday / Every week / Every 2 weeks / Every month | Description/hint (options) |
| SC9 | 70 | `${description}: +${amount} on ${date}` | Description/hint (change row) |
| SC10 | 72 | `${description}: −${amount} on ${date}` | Description/hint (change row) |
| SC11 | 75 | `${description ?? 'Payment'} on ${date}: move to ${date}` | Description/hint (change row) |
| SC12 | 79 | `${description ?? 'Payment'} on ${date}: ${amount}` | Description/hint (change row) |
| SC13 | 82 | `${description ?? 'Payment'}: ${amount} from ${date}` | Description/hint (change row) |
| SC14 | 84 | `${description}: ${amount} {each payday | <frequency> from <date>}` | Description/hint (change row) |
| SC15 | 86 | `${description}: +${amount}` | Description/hint (change row) |
| SC16 | 88 | `Extra payment: −${amount} on ${date}` | Description/hint (change row) |
| SC17 | 93 | `${description}: ${low} / ${expected} / ${high} (low / expected / high), {once on <date> | each payday | <frequency> from <date>}` | Description/hint (change row) |
| SC18 | 163 | Explore a scenario | Page heading (modal) |
| SC19 | 165 | Try a few what-ifs together and compare them with your forecast. Nothing here changes your plan or is saved. | Description/hint (reassurance) |
| SC20 | 177 | Choose a change (aria-label) | Tooltip/aria-label |
| SC21 | 178 | What might happen? | Page heading (section) |
| SC22 | 193 | No liability payments to change | Empty state (disabled option hint) |
| SC23 | 193 | No upcoming payments | Empty state (disabled option hint) |
| SC24 | 201, 679 | Cancel | Button label |
| SC25 | 207–208 | Your changes | Page heading (section) |
| SC26 | 210 | No changes yet. Add one to see how it would affect your forecast. | Empty state |
| SC27 | 239 | Add a change | Button label |
| SC28 | 245 | `{problem.message}` (engine error, see scenarios.ts) | Error |
| SC29 | 250 | One change needs attention before the scenario can be compared. | Error |
| SC30 | 260 | Done | Button label |
| SC31 | 274 / 277 | `Edit ${label}` / `Remove ${label}` | Tooltip/aria-label |
| SC32 | 283 | `Needs attention: ${error}` | Error |
| SC33 | 298 | creates a {amount} shortfall on {date} / deepens a shortfall to {amount} on {date} | Warning |
| SC34 | 299 | `, back to $0 or more on ${date}` / `, and it doesn’t recover within this period` | Warning |
| SC35 | 305–306 | Your projected ending total improves by {amount}, but this scenario {what}{recovery}. | Warning |
| SC36 | 310–311 | Your projected cash flow improves by {amount}, but this scenario {what}{recovery}. | Warning |
| SC37 | 315–316 | This scenario {what}{recovery}. | Warning |
| SC38 | 323 | `{amount} on {date}` / — | Financial explanation |
| SC39 | 324 | None / 1 / n (gap count) | Financial explanation |
| SC40 | 329 | Scenario comparison (aria-label) | Tooltip/aria-label |
| SC41 | 330 | Compared with your forecast | Page heading (section) |
| SC42 | 334 | `{limitation}` (see scenarios.ts) | Warning / Financial explanation |
| SC43 | 341, 432 | Measure (sr-only column header) | Tooltip/aria-label |
| SC44 | 343 / 344 | Current forecast / With this scenario | Page heading (table columns) |
| SC45 | 349, 451 | Cash flow (row) | Financial explanation |
| SC46 | 356, 459 | Lowest running total (row) | Financial explanation |
| SC47 | 361 | Ending running total (row) | Financial explanation |
| SC48 | 366, 465 | Timing gaps (row) | Financial explanation |
| SC49 | 376 | `Includes {amount} of hypothetical income. Without it, cash flow would be {signed amount}.` | Financial explanation |
| SC50 | 387–388 | What this assumes (aria-label + label) | Page heading (section) |
| SC51 | 392 | `{assumption label}` (see scenarios.ts) | Financial explanation |
| SC52 | 395 | One-time / Recurring | Financial explanation |
| SC53 | 396 | Hypothetical income, not in your forecast / Income you entered | Financial explanation |
| SC54 | 397 | `Dates in this period: ${dates}` | Financial explanation |
| SC55 | 398 | Before your next payday: cash flow only | Financial explanation |
| SC56 | 407–408 | `Cash flow from {start} through {end}{; running total from {date}, the day of your next payday. | .} The running total shows timing, separate from your bank balance.` | Financial explanation |
| SC57 | 415–417 | Low / Expected / High | Page heading (table columns / pills) |
| SC58 | 425 | Income cases (aria-label) | Tooltip/aria-label |
| SC59 | 426 | Three income cases | Page heading (section) |
| SC60 | 427 | All three are hypothetical. None is added to your forecast. | Description/hint (reassurance) |
| SC61 | 443 | Hypothetical income (row) | Financial explanation |
| SC62 | 475 | Details for (legend) | Description/hint |
| SC63 | 521 | Extra income / Unexpected expense / Savings / Variable income (default names) | Description/hint (prefill) |
| SC64 | 541 | Enter $0 or more. / Enter an amount above $0. | Error (field) |
| SC65 | 545 | Choose a date. | Error (field) |
| SC66 | 546 | Enter a short name. | Error (field) |
| SC67 | 562 | `${description} · ${date} · ${amount}` (option) | Description/hint |
| SC68 | 568, 575 | `{title}` (change type label, form heading) | Page heading (form) |
| SC69 | 577 | Name | Description/hint (field label) |
| SC70 | 582 | Payment | Description/hint (field label) |
| SC71 | 605 | Liability payment | Description/hint (field label) |
| SC72 | 621 | `{description} · {amount} now` | Description/hint (option) |
| SC73 | 627 | Starting with | Description/hint (field label) |
| SC74 | 641 | New amount / Amount each time / Amount | Description/hint (field label) |
| SC75 | 647 / 650 / 653 | Low / Expected / High | Description/hint (field label) |
| SC76 | 659 | How often | Description/hint (field label) |
| SC77 | 672 | New date / First date / Date | Description/hint (field label) |
| SC78 | 676 | Enter amounts you think are possible. They stay hypothetical and aren’t added to your forecast. | Description/hint (reassurance) |
| SC79 | 682 | Save change / Add to scenario | Button label |

## src/ui/components/WhatIfSheet.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| W1 | 13 | Move date | Button label (choice pill) |
| W2 | 14 | Change amount | Button label (choice pill) |
| W3 | 15 | Skip this one | Button label (choice pill) |
| W4 | 45, 63 | What if… | Page heading (modal) |
| W5 | 46 | This transaction has already been recorded or changed, so it can’t be previewed here. | Error / Empty state |
| W6 | 70–71 | `Expected {+|−}{amount} on {date}` | Financial explanation |
| W7 | 78 | Apply this change? | Page heading (confirm) |
| W8 | 82 | `Only this one on ${date} changes; later ones keep their schedule. ` | Description/hint |
| W9 | 83 | This updates your Financial OS forecast. It doesn’t change any payment arrangement outside the app. | Description/hint (reassurance) |
| W10 | 87 | Keep exploring | Button label |
| W11 | 90 | Apply change | Button label |
| W12 | 97 | What to change (sr-only legend) | Tooltip/aria-label |
| W13 | 108 | New date | Description/hint (field label) |
| W14 | 110 | New amount | Description/hint (field label) |
| W15 | 113 | Preview (aria-label) | Tooltip/aria-label |
| W16 | 114 | `{result.error}` (see preview.ts) | Error |
| W17 | 126 | Back | Button label |
| W18 | 137 | Apply change… | Button label |
| W19 | 150 | Shows your forecast without this income. It doesn’t change what you’re owed. | Financial explanation (reassurance) |
| W20 | 153–154 | `Shows your forecast without this payment. Your ${card|loan|line of credit|debt} and the payment you owe don’t change; Financial OS just leaves this one out.` (fallback word is **"debt"**) | Financial explanation (reassurance) |
| W21 | 156 | Shows your forecast without this payment. It doesn’t cancel, waive, or pay it. | Financial explanation (reassurance) |
| W22 | 160 | `Moved ${name} to ${date}.` / `Move ${name} from ${date} to ${date}.` | Success/toast / Description/hint |
| W23 | 161 | `${name} now expected ${amount}.` / `Expect ${amount} for ${name} on ${date}.` | Success/toast / Description/hint |
| W24 | 162 | `Left ${name} on ${date} out of your forecast.` / `Leave ${name} on ${date} out of your forecast.` | Success/toast / Description/hint |
| W25 | 165 | `${range}, down to ${amount}` | Financial explanation |
| W26 | 171 | `This changes your next payday from ${date} to ${date}. The running total starts the day before payday, so the two forecasts would start on different days and can’t be compared directly.` | Financial explanation / Warning |
| W27 | 173 | `The new date is before your next payday (${date}), when the running total starts, so the payment would just drop out of it. The forecast can’t show whether money on hand covers it.` | Financial explanation / Warning |
| W28 | 174 | There’s no upcoming payday to start a running total from, so this can’t be compared. | Financial explanation / Warning |
| W29 | 186 / 188 / 189 | `Your lowest running total would improve from ${a} to ${b}.` / `…would drop from ${a} to ${b}.` / `…would stay at ${a}.` | Financial explanation |
| W30 | 194 / 198 | Now / With this change | Financial explanation (stat labels) |
| W31 | 195, 199 | `${amount} on ${date}` / — | Financial explanation |
| W32 | 205 | `The timing gap ${range} would be gone.` | Success/toast-style callout |
| W33 | 207 | `The timing gap ${range} would be smaller: ${gap lines}.` | Financial explanation |
| W34 | 209 | `The timing gap ${range} would be worse: ${gap lines}.` | Warning |
| W35 | 210 | `The timing gap ${range} would stay the same.` | Financial explanation |
| W36 | 212 | ` Back to $0 or more on ${date} instead of ${date}.` | Financial explanation |
| W37 | 218–219 | `New timing gap: {range}, down to {amount}{, back to $0 or more on {date}}.` | Warning |
| W38 | 224 | `Deeper timing gap: {range}, down to {amount} (now {amount}).` | Warning |
| W39 | 228 | No timing gaps either way. / Your timing gaps stay as they are. | Financial explanation |
| W40 | 56 | `{r.error}` (apply error, see preview.ts) | Error |

## src/ui/components/comparison.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| CM1 | 10 | `{range}, down to {amount}` | Financial explanation |
| CM2 | 36–37 | `New timing gap: {range}, down to {amount}{, back to $0 or more on {date}}.` | Warning |
| CM3 | 42 | `Deeper timing gap: {range}, down to {amount}.` | Warning |
| CM4 | 47 | `Smaller timing gap: {range}, down to {amount}.` | Success-style callout |
| CM5 | 52 | `The timing gap {range} would be gone.` | Success-style callout |
| CM6 | 56 | No timing gaps either way. / Your timing gaps stay as they are. | Financial explanation |

## src/ui/components/gaps.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| G1 | 8 | `1 timing gap ahead` / `${n} timing gaps ahead` | Warning (banner + modal title) |
| G2 | 23 | `Next {90} days` | Description/hint |
| G3 | 32 | `Covers ${date} through ${date}.` | Description/hint |
| G4 | 59 | On these dates, scheduled money out runs ahead of money in, so the running total drops below $0. Each one shows what leads to its lowest point and what brings it back. | Financial explanation |
| G5 | 68 | ` · 1 day` / ` · ${n} days` | Financial explanation |
| G6 | 71 | `Down to {amount} on {date}` | Financial explanation |
| G7 | 80 | `{note }The running total shows timing, separate from your bank balance.` | Financial explanation (repeated disclaimer) |
| G8 | 92 | `Running total before, {date}` | Financial explanation |
| G9 | 96 | Leading to the lowest point | Page heading (step) |
| G10 | 99 | `Running total, {date}` | Financial explanation |
| G11 | 105 | While still below $0 | Page heading (step) |
| G12 | 110 | Back to $0 or more | Page heading (step) |
| G13 | 115 | `Running total, {date}` | Financial explanation |
| G14 | 120 | `The running total doesn’t return to $0 or more in the forecast, which runs through {date}.` | Warning |
| G15 | 127 | Nothing scheduled. | Empty state |
| G16 | 140 | `What if: ${description}, ${date}` (aria-label) | Tooltip/aria-label |
| G17 | 142 | What if… | Button label |

## src/ui/components/plan.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| P1 | 14 | Cash flow (banner label) | Financial explanation |
| P2 | 15 | `First pay period · ${range}` / Add income to see this | Description/hint / Setup instruction |
| P3 | 19 | `{signed amount}` / — | Financial explanation |
| P4 | 35–38 | Bills / Subscriptions / Liability payments / Savings (breakdown rows) | Financial explanation |
| P5 | 53 | Income (row) | Financial explanation |
| P6 | 54 | Expenses (row) | Financial explanation |
| P7 | 58 | Cash flow (row) | Financial explanation |
| P8 | 60 | Cash flow is income minus expenses, including savings. It counts repeating and one-time items dated in this period. | Financial explanation |
| P9 | 71 | By tag | Page heading (section) |
| P10 | 81 | ` · 1 item` / ` · ${n} items` | Description/hint |
| P11 | 91 | An item with more than one tag counts toward each of its tags. | Financial explanation |

## src/ui/components/account.tsx (Firebase account build only; renders nothing in the local-only default)

| ID | Line | Text | Category |
|---|---|---|---|
| AC1 | 43 | Your account couldn’t be deleted. Try again. | Error |
| AC2 | 51 | Account | Page heading (section) |
| AC3 | 53 | `Signed in as {email}` | Description/hint |
| AC4 | 57, 75, 137 | Sign out | Button label |
| AC5 | 60, 109 | Delete account / Deleting… | Button label |
| AC6 | 66 | Sign out now? | Page heading (modal) |
| AC7 | 68 | Some of your changes haven’t reached your account yet. Signing out removes them from this device. | Warning |
| AC8 | 69 | Stay signed in until you’re back online and they’ll be saved, or download a backup to keep a copy. | Description/hint |
| AC9 | 72 | Stay signed in | Button label |
| AC10 | 83 | Delete your account? | Page heading (modal) |
| AC11 | 86 | This permanently deletes your account and everything saved in it from Financial OS. It can’t be undone. | Warning |
| AC12 | 88 | Download a backup first if you want to keep a copy. You’ll be asked to confirm with Google before anything is deleted. | Description/hint |
| AC13 | 97 | Download backup | Button label |
| AC14 | 101 | `{error}` | Error |
| AC15 | 106 | Keep my account | Button label |
| AC16 | 125, 128 | `Signed in as {email}.` | Description/hint |
| AC17 | 150 | Changes from this device | Page heading (modal) |
| AC18 | 153 | `Changes made on this device on {date} reached your account after newer changes from another device or window, so your forecast now shows the newer version.` | Warning (conflict) |
| AC19 | 155 | Download this device’s changes as a backup file to keep them. You can open the file anytime to compare, or restore it to use that version instead. | Description/hint |
| AC20 | 158 | Discard removes this device’s changes for good. | Warning |
| AC21 | 163 | Discard for good / Discard | Button label |
| AC22 | 175 | Download them | Button label |
| AC23 | 171 | `…changes-from-this-device…json` (download filename) | Description/hint (file name) |
| AC24 | 230 | Your forecast is now saved to your account. | Success/toast |
| AC25 | 235 | Move this device’s forecast to your account? | Page heading (modal) |
| AC26 | 238 | `This device has a forecast from before you signed in, with {1 item | n items}. Move it into your account to keep using it here and on your other devices.` | Description/hint |
| AC27 | 242 | Start fresh | Button label |
| AC28 | 245 | Move to my account | Button label |

## src/ui/components/backup.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| B1 | 22 | `1 item` / `${n} items` | Description/hint |
| B2 | 36 | `You have {n items} now. To keep a copy, download a backup first. You can restore it later.` | Warning / Description/hint |
| B3 | 39 | `Backup downloaded: {filename}` | Success/toast (inline status) |
| B4 | 50 | Download a backup of your data | Button label |
| B5 | 67 | `Backup downloaded: ${filename}` | Success/toast |
| B6 | 70 | Download backup | Button label |
| B7 | 115 | Restore from backup (default label) | Button label |
| B8 | 123 | Backup restored. | Success/toast |
| B9 | 132 | This file couldn’t be read. | Error |
| B10 | 149 | Backup file (aria-label of hidden input) | Tooltip/aria-label |
| B11 | 151 | Restore this backup? | Page heading (modal) |
| B12 | 154–155 | `This backup has {n items}{, saved {date}}.` | Description/hint |
| B13 | 157 | Restoring replaces everything currently in the app with the backup. | Warning |
| B14 | 161 | `The restore hasn’t been confirmed. {error}` | Error |
| B15 | 166, 230 | Cancel | Button label |
| B16 | 170 | Restoring… / Try again / Replace with backup | Button label |
| B17 | 178 | Couldn’t restore | Page heading (modal, error) |
| B18 | 181 | `{error}` (from state/backup.ts) | Error |
| B19 | 185 | OK | Button label |
| B20 | 206 | Your data was erased. Set up again whenever you’re ready. | Success/toast |
| B21 | 214 | Start over | Button label |
| B22 | 217 | Start over? | Page heading (modal) |
| B23 | 220 | `This erases {your setup | all {n items} you’ve entered, with everything recorded for them,} and takes you back to setup. Your review rhythm stays.` | Warning |
| B24 | 225 | `Erasing hasn’t been confirmed. {error}` | Error |
| B25 | 234 | Erasing… / Try again / Erase and start over | Button label |
| B26 | 252 | `Your latest change hasn’t been saved. {saveMessage}` | Error (save status bar) |
| B27 | 252 | `{saveMessage}` (conflict message, from store.tsx) | Warning (save status bar) |
| B28 | 256 | Try again | Button label |
| B29 | 260 | Reload | Button label |

## src/state/store.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| ST1 | 61 | Your latest change hasn’t been saved yet. Wait for it to save, or use Try again, then do this again. | Error (restore/start over blocked) |
| ST2 | 62 | Reload to see the latest version before making changes. | Error (conflict; returned from every `run`) |
| ST3 | 63 | Wait until this finishes saving, or cancel it. | Error |
| ST4 | 124 | Your data could not be loaded. | Error (load screen) |
| ST5 | 188, 249 | Still loading. Try again in a moment. | Error |
| ST6 | 205 | There’s nothing to save. | Error |
| ST7 | 219 | Your data was reloaded first. Check it, then try again. | Error |
| ST8 | 318 | Try again | Button label (load screen) |
| ST9 | 327 | Loading your forecast… | Description/hint (loading) |
| ST10 | 301 | (browser-native "Leave site? Changes you made may not be saved." via beforeunload; text not controlled) | Warning |

## src/state/mode.tsx

No user-facing strings. `enterSample` rethrows the storage `message` (S-storage errors) but the callers (`Onboarding.tsx:471`, `Settings.tsx:81`) do not catch or display it, so a failure is silent.

## src/state/account.tsx

| ID | Line | Text | Category |
|---|---|---|---|
| AS1 | 104 | Opening Financial OS… | Description/hint (loading) |

## src/state/backup.ts

| ID | Line | Text | Category |
|---|---|---|---|
| BK1 | 36 | `financial-os-backup-${date}.json` (download filename, shown in toast B5) | Description/hint (file name) |
| BK2 | 56, 60 | This file isn’t a Financial OS backup. | Error |
| BK3 | 66 | This backup is damaged or from a newer version of the app, so it can’t be restored. | Error |

## src/state/storage.ts

| ID | Line | Text | Category |
|---|---|---|---|
| SG1 | 113 | Saved data is not an object. | Error (internal; caught and replaced before display) |
| SG2 | 115 | `Unsupported data version: ${version}` | Error (internal; caught and replaced before display) |
| SG3 | 118 | Saved data is damaged. | Error (internal; caught and replaced before display) |
| SG4 | 141 | Your data was changed somewhere else, such as another window. Reload to see the latest version. | Warning (conflict, shown in save status bar) |
| SG5 | 177 | Your change could not be saved on this device. Check available storage and try again. | Error (shown after B26 prefix) |
| SG6 | 197 | Save failed. | Error (test adapter only) |

## src/domain/operations.ts (error messages returned to the UI)

| ID | Line | Text | Category |
|---|---|---|---|
| OP1 | 46 | `${label} must be greater than $0.` (label "Amount" or "Actual amount") | Error |
| OP2 | 47 | `${label} is too large.` | Error |
| OP3 | 81 | Enter a description. | Error |
| OP4 | 82 | Keep the description under 80 characters. | Error |
| OP5 | 103 | Choose whether this is a card, a loan, or a line of credit. | Error |
| OP6 | 111, 174, 211, 268, 304, 366, 393 | Enter a valid date. | Error |
| OP7 | 112, 212, 269 | The next expected date must be today or later. | Error |
| OP8 | 133, 231 | That item no longer exists. | Error |
| OP9 | 175 | Changes can only take effect today or later, so past occurrences keep their original expectations. | Error |
| OP10 | 179 | Turn this item back on before changing its schedule. | Error |
| OP11 | 205 | This item already has history. Change its schedule from a future date instead. | Error |
| OP12 | 232 | This item has recorded history. Turn it off instead so the history is kept. | Error |
| OP13 | 239 | This item no longer exists. | Error |
| OP14 | 240 | Only income can be the main paycheck. | Error |
| OP15 | 241 | Turn this income back on before making it the main paycheck. | Error |
| OP16 | 259 | This item is already turned off. | Error |
| OP17 | 271 | This item is already on. | Error |
| OP18 | 330 | Only one-time transactions can be deleted. | Error |
| OP19 | 346, 458, 467 | That transaction could not be found. | Error |
| OP20 | 367 | The actual date cannot be in the future. Record it once it has happened. | Error |
| OP21 | 376 | This transaction has already been recorded. | Error |
| OP22 | 377 | This transaction was canceled. Restore it before recording what happened. | Error |
| OP23 | 387 | Only recorded transactions can be corrected. | Error |
| OP24 | 396 | Only outstanding transactions can be changed. | Error |
| OP25 | 397 | Choose today or a later date. | Error |
| OP26 | 405 | This transaction is already canceled. | Error |
| OP27 | 406 | This transaction was already recorded. Undo the recorded outcome first. | Error |
| OP28 | 420 | This transaction is already outstanding. | Error |
| OP29 | 436 | Select at least one transaction. | Error |
| OP30 | 442 | `${name}: ${error}` (batch error prefix) | Error |
| OP31 | 490 | Some of these items have changed since, so they can’t be undone together. Open each one to change it. | Error |
| OP32 | 507 | Choose how often to review. | Error |
| OP33 | 514 | There’s no review due right now. | Error |

### Supplementary: src/domain/recurrence.ts (shown via operations errors and on every item row)

| ID | Line | Text | Category |
|---|---|---|---|
| RC1 | 86 | Enter how often it repeats as a whole number between 1 and 365. | Error |
| RC2 | 92 | Choose two days of the month between 1 and 31. | Error |
| RC3 | 94 | Choose two different days of the month. | Error |
| RC4 | 96 | `The next expected date must fall on the ${1st} or ${15th} (or the last day of a short month).` | Error |
| RC5 | 105 / 107 | Every week / Every 2 weeks | Description/hint (rule label) |
| RC6 | 109 | `Monthly on the ${ordinal}` | Description/hint (rule label) |
| RC7 | 112 | `Twice a month on the ${a} and ${b}` | Description/hint (rule label) |
| RC8 | 116 | `Every ${unit}` / `Every ${n} ${unit}s` (e.g. "Every 3 weeks", raw "day/week/month") | Description/hint (rule label) |

### Supplementary: src/domain/dates.ts and money.ts formats

Month abbreviations (Jan…Dec), full months, weekday names (Sun…Sat; Sunday…), date formats "Oct 18", "Oct 18, 2026", "Sunday, October 18, 2026", "October 2026", ranges "Oct 1 – 31" / "Oct 28 – Nov 3"; money "$1,234.56", compact "$1.8k". (Not voice-relevant; listed for completeness.)

## src/domain/preview.ts

| ID | Line | Text | Category |
|---|---|---|---|
| PV1 | 78 | That transaction could not be found. | Error |
| PV2 | 139 | There is no upcoming main payday to start a running total from, so the two forecasts can’t be compared. | Financial explanation (`limitation`; not currently rendered — UI uses its own copy W28) |
| PV3 | 148 | `This change moves the next main payday from ${YYYY-MM-DD} to ${YYYY-MM-DD}, so the running totals start from different days and can’t be compared directly.` (raw ISO dates) | Financial explanation (`limitation`; not currently rendered) |
| PV4 | 168 | `The new date is before the next payday (${YYYY-MM-DD}), when the running total starts, so the payment would simply drop out of it. The forecast can’t show whether money on hand covers it.` | Financial explanation (`limitation`; not currently rendered) |
| PV5 | 215 | Left out of the forecast in a what-if preview. Nothing changed outside Financial OS. (SKIP_NOTE, stored as the cancel note and shown as "Note: …" in OccurrenceSheet OS7) | Financial explanation |
| PV6 | 229 | Your forecast changed after this preview. Check the updated preview before applying. | Error |
| PV7 | 232 | This preview can’t be compared with your forecast, so it can’t be applied from here. | Error |

## src/domain/scenarios.ts

| ID | Line | Text | Category |
|---|---|---|---|
| SN1 | 127 | There’s no main paycheck to follow. Choose dates instead. | Error |
| SN2 | 132 | The main paycheck has no upcoming payday to follow. | Error |
| SN3 | 147 | Hypothetical changes need today or a later date. | Error |
| SN4 | 159 | `${description}: {+|−}${amount} once on ${date}{ (hypothetical)}` | Financial explanation (assumption label) |
| SN5 | 164 | Choose one of your liability payments. | Error |
| SN6 | 167 | `Extra payment: ${source}` (description on copy) | Description/hint |
| SN7 | 173 | `Extra payment on ${source}: −${amount} once on ${date}` | Financial explanation (assumption label) |
| SN8 | 179 | That transaction could not be found. | Error |
| SN9 | 180 | `${description} on ${date} has already been recorded or canceled.` | Error |
| SN10 | 192 | `${description} on ${date}: ${old} → ${new}` | Financial explanation (assumption label) |
| SN11 | 193 | `${description}: ${old date} → ${new date} (${amount})` | Financial explanation (assumption label) |
| SN12 | 198 | Choose a recurring item that’s turned on. | Error |
| SN13 | 201 | `${source} already has a change set for ${date}, so a scenario can’t change its amount yet.` | Error |
| SN14 | 205 | `Choose one of ${source}’s upcoming payment dates to start from.` | Error |
| SN15 | 212 | `${source}: ${old} → ${new} each time from ${date}` | Financial explanation (assumption label) |
| SN16 | 226 | `${description}: {+|−}${amount} ${rule lowercased} from ${date}{ (hypothetical)}` | Financial explanation (assumption label) |
| SN17 | 265 | Add at least one change. | Error |
| SN18 | 267 | Change each transaction only once in a scenario. | Error |
| SN19 | 269 | Change each recurring item’s amount once per scenario. | Error |
| SN20 | 275 | `Change ${n}: ${error}` (prefix; stripped by UI attribute()) | Error |
| SN21 | 294 | `${label}: no dates fall within ${date} to ${date}.` | Warning (limitation) |
| SN22 | 295 | `${label}: dates before your next payday (${date}) count in cash flow but not in the running total, which starts that day.` | Warning / Financial explanation (limitation) |
| SN23 | 308, 392 | There’s no upcoming main payday to start a running total from, so only cash flow is compared. | Warning (limitation) |
| SN24 | 309 | `This scenario moves your next payday from ${date} to ${date}, so the running totals start on different days and can’t be compared directly.` | Warning (limitation) |
| SN25 | 316 | `${description} would move to before your next payday (${date}), where the running total starts, so it would drop out of it. The forecast can’t show whether money on hand covers it.` | Warning (limitation) |
| SN26 | 352 | Enter each income case as $0 or more. | Error |
| SN27 | 353 | The low case can’t be more than expected, and expected can’t be more than high. | Error |
| SN28 | 354 | Enter an expected and high amount above $0. | Error |
| SN29 | 355 | Choose the date the income might arrive. | Error |
| SN30 | 370 | `${description}: $0.00 (low case, hypothetical)` | Financial explanation (assumption label) |

## src/domain/estimates.ts

| ID | Line | Text | Category |
|---|---|---|---|
| ES1 | 232 | `Counts only payments since your estimate became ${amount} on ${date}.` | Warning (limitation) |
| ES2 | 255 | `Based on only ${n} payments.` | Warning (limitation) |
| ES3 | 300 | `Your ${Month} ${year} payment was ${amount}.` | Financial explanation |
| ES4 | 301 | `Your ${Month} payments averaged ${amount} over the last ${n} years.` | Financial explanation |
| ES5 | 302 | `For this one payment only; later payments keep ${amount}.` | Warning (limitation) |
| ES6 | 303, 334, 352 | Rounded up to the next whole dollar. | Warning (limitation) |
| ES7 | 306 | `Based on one earlier ${Month}; one year doesn't show a reliable yearly pattern.` | Warning (limitation) |
| ES8 | 308 | `${name} may change with the season. ${history} Your ${date} payment is expected at ${current}. Consider ${proposed} for that payment.` | Financial explanation (explanation) |
| ES9 | 322 | `Your last ${n} ${name} payments were each ${amount}. Your current estimate is ${current}. Consider ${proposed} from ${date}.` | Financial explanation (explanation) |
| ES10 | 333 | `Uses the latest amount; it doesn't assume the ${rise|drop} continues.` | Warning (limitation) |
| ES11 | 335 | `Your last 4 ${name} payments went ${up|down} each time, from ${first} to ${latest}. Your current estimate is ${current}. Consider ${proposed} from ${date}.` | Financial explanation (explanation) |
| ES12 | 351 | `Left out as unusual: ${amount} (${date}), …` | Warning (limitation) |
| ES13 | 353–354 | `{${k} of your last ${n} ${name} payments | Your last ${k} ${name} payments} averaged ${avg} and ranged from ${low} to ${high}. Your current estimate is ${current}. Consider ${proposed} from ${date}.` | Financial explanation (explanation) |
| ES14 | 389 | This suggestion is out of date. Look at the latest one before choosing. | Error |
| ES15 | 405 | That item could not be found. | Error |

## src/domain/forecast.ts, plan.ts, occurrences.ts, money.ts

No user-facing sentences (numbers, dates and statuses only). `sample.ts` supplies the sample-data item names (content, not interface copy; not audited).

---

## Dev-only Supabase build (headings only, not audited)

- src/ui/supabase/AuthScreens.tsx — "Sign in to Financial OS" (l.123), "Create your account" (l.124), "Reset your password" (l.125), "Check your email" (l.107), "Choose a new password" / "Choose a password" (l.189).
- src/ui/supabase/AccountControls.tsx — "Account" (l.186), "Sign out?" (l.65), "Delete your account?" (l.115), "Sign in again to save" (l.266).
- src/ui/supabase/RecoveryPanel.tsx — recovery panel for changes that could not be saved (no separate h1/h2).
- src/state/supabase/ (adapter.ts, rows.ts, session.tsx, target.ts, dev.tsx) — storage and auth error messages for the Supabase backend.

---

# Section 2 — Flagged strings

One row per flagged inventory entry (IDs refer to Section 1). "Reason" is a one-phrase verdict against the audit criteria. Where one problem spans several entries, the related IDs are listed in the same row and counted once per ID in the totals.

## 2.1 The word "debt" (must become liability / loan / card / payment)

| ID | File:line | Text | Reason |
|---|---|---|---|
| O14 | Onboarding.tsx:52 | What do you pay toward debts? | "debt" in a step heading |
| W20 | WhatIfSheet.tsx:153–154 | `…Your ${…|debt} and the payment you owe don’t change; Financial OS just leaves this one out.` | "debt" fallback word (shown when a liability has no type); also "just" |

## 2.2 Mechanical / system-explaining phrasing, implementation terms, jargon

| ID | File:line | Text | Reason |
|---|---|---|---|
| D9 | Dashboard.tsx:130 | 1 transaction needs an update / N transactions need an update | robotic status line; "transaction" where the rest of the app says payment/item |
| D18 | Dashboard.tsx:233 | Pay period 1 of 6 · starts with … · next main payday … | system readout; "main payday" jargon |
| D21 | Dashboard.tsx:241 | We need at least two upcoming main paydays to show a pay period… | explains the system's needs instead of the person's next step |
| D26 | Dashboard.tsx:300–301 | The running total starts at $0 on {date}, the day before your next expected payday ({date}), and adds money in and subtracts money out day by day… | anchor mechanics; 38-word sentence |
| D27 | Dashboard.tsx:303 | Days on or before {date} show “—” … because the app doesn’t know how much money you have now. | anchor mechanics; refers to "the app"; negative |
| D30 | Dashboard.tsx:327 | Your running total starts the day before your next expected payday, so we need at least one recurring income… | system-explaining; 33 words on the first screen |
| D45 | Dashboard.tsx:514 | Running total stays at or above $0 this period | robotic "at or above $0" status |
| D51 | Dashboard.tsx:540–550 | …, {n} overdue, {n} done, running total …, lowest point | "done" vs received/paid; machine-assembled label |
| D73 | Dashboard.tsx:762 | “—” means the day is on or before {date}, when the running total begins. | anchor mechanics shown under every timeline |
| D78 | Dashboard.tsx:825 | Below $0: scheduled money out is ahead of money in by {amount} at the end of this day. | mechanical restatement of the number |
| O51 | Onboarding.tsx:328 | {n} payments ({total}) are due before your next payday. The running total starts at $0 on {date}, so it doesn’t include them… | anchor mechanics; ~40 words |
| O57 | Onboarding.tsx:379 | The running total starts at $0 on {date}, the day before your next expected payday… | anchor mechanics; duplicate of D26 |
| O58 | Onboarding.tsx:381 | Anything due before then isn’t in the running total, because the app doesn’t know how much money you have now. | anchor mechanics; duplicate of D27; negative |
| O70 | Onboarding.tsx:487 | Add at least one recurring income so we can start your forecast from your next payday… | system-explaining ("so we can") |
| SS44 | SourcesScreen.tsx:191 | Last 60 days and next 90 days. Select one to record what happened or change just that date. | exposes the query window; mechanical |
| SS21 | SourcesScreen.tsx:45 | …Each payment counts once as money going out. | explains the engine, not the person's money |
| F32 | forms.tsx:331 | Changes to the amount or schedule apply starting on the date below. Earlier transactions and anything you have already recorded keep their original values. | schedule-versioning mechanics; 26 words on every edit |
| F33 | forms.tsx:340 | Changes start with the payment on | awkward, incomplete field label |
| F46 | forms.tsx:431 | Nothing is added for the time it was turned off. | engine behavior; negative |
| OS3 / OS4 | OccurrenceSheet.tsx:28, 30 | Originally expected / Updated expectation | "expectation" is implementation vocabulary |
| OS26 | OccurrenceSheet.tsx:163 | Restore to expected | jargon; "restore" also means backup restore |
| OS29 | OccurrenceSheet.tsx:184 | “Just this one” changes only the {date} occurrence. To change the amount or schedule from a date on, edit … on its screen. | "occurrence"; "from a date on"; long |
| OS33 | OccurrenceSheet.tsx:195 | The original prediction is kept for comparison. | "prediction" jargon; reassurance |
| OS37 | OccurrenceSheet.tsx:224 | Cancel this occurrence? | "occurrence" |
| OS38 | OccurrenceSheet.tsx:225 | It will be removed from your forecast but kept on record as canceled. Future occurrences are not affected. | "occurrences"; "kept on record" |
| OS41 | OccurrenceSheet.tsx:233 | Cancel occurrence | "occurrence" in a button |
| R16 | ReviewSheet.tsx:122 | Done uses each item’s expected amount and date (today, for items not yet due). Each original prediction is kept. | mechanical; "prediction" |
| PR8 | PeriodReviewSheet.tsx:65 | The date passed and nothing was recorded. They stay expected until you record them. | system state explanation; negative |
| R12 | ReviewSheet.tsx:111 | Due today or earlier. These stay in your forecast until you record them. | system state explanation (third copy, with OS18/PR8) |
| E12 | EstimateSheet.tsx:56 | Not counted: older than the payments used | describes the algorithm's window |
| E39 | EstimateSheet.tsx:239 | Dismiss keeps {amount} and doesn’t suggest this again until your payments change. Not now closes this; the suggestion stays here for later. | explains button mechanics; 27 words |
| E46 | EstimateSheet.tsx:273 | · before your next payday, outside the running total | anchor mechanics |
| E48 | EstimateSheet.tsx:285 | This would change your next payday, when the running total starts, so the two running totals can’t be compared directly. | anchor mechanics; negative |
| E49 | EstimateSheet.tsx:286 | There’s no upcoming payday to start a running total from, so only the payment amounts are shown. | anchor mechanics; negative |
| E50 | EstimateSheet.tsx:291 | Compared through {date}; the new estimate also applies to later payments. | comparison-window mechanics |
| W5 | WhatIfSheet.tsx:46 | This transaction has already been recorded or changed, so it can’t be previewed here. | system-state; negative |
| W26 | WhatIfSheet.tsx:171 | This changes your next payday from … The running total starts the day before payday, so the two forecasts would start on different days and can’t be compared directly. | anchor mechanics; 40 words |
| W27 | WhatIfSheet.tsx:173 | The new date is before your next payday (…), when the running total starts, so the payment would just drop out of it… | anchor mechanics; "just" |
| W28 | WhatIfSheet.tsx:174 | There’s no upcoming payday to start a running total from, so this can’t be compared. | anchor mechanics; negative |
| G4 | gaps.tsx:59 | On these dates, scheduled money out runs ahead of money in, so the running total drops below $0. Each one shows what leads to its lowest point and what brings it back. | over-explained intro (32 words) |
| G14 | gaps.tsx:120 | The running total doesn’t return to $0 or more in the forecast, which runs through {date}. | horizon mechanics; negative |
| SC29 | ScenarioSheet.tsx:250 | One change needs attention before the scenario can be compared. | robotic validation status |
| SC32 | ScenarioSheet.tsx:283 | Needs attention: {error} | robotic prefix |
| SC55 | ScenarioSheet.tsx:398 | Before your next payday: cash flow only | anchor mechanics |
| SC56 | ScenarioSheet.tsx:407–408 | Cash flow from … through …; running total from …, the day of your next payday. The running total shows timing, separate from your bank balance. | window mechanics plus repeated disclaimer |
| PV5 | preview.ts:215 | Left out of the forecast in a what-if preview. Nothing changed outside Financial OS. | system note stored on the item; reassurance |
| PV3 / PV4 | preview.ts:148, 168 | …moves the next main payday from 2026-10-23 to … | raw ISO dates and anchor mechanics (dormant: not rendered today) |
| PV6 | preview.ts:229 | Your forecast changed after this preview. Check the updated preview before applying. | "data changed since the preview" phrasing |
| PV7 | preview.ts:232 | This preview can’t be compared with your forecast, so it can’t be applied from here. | system-explaining; negative |
| SN21 | scenarios.ts:294 | `${label}: no dates fall within ${date} to ${date}.` | robotic, label-prefixed |
| SN22 | scenarios.ts:295 | `${label}: dates before your next payday (…) count in cash flow but not in the running total, which starts that day.` | anchor mechanics; label-prefixed |
| SN23 | scenarios.ts:308, 392 | There’s no upcoming main payday to start a running total from, so only cash flow is compared. | anchor mechanics |
| SN24 | scenarios.ts:309 | This scenario moves your next payday from … so the running totals start on different days and can’t be compared directly. | anchor mechanics; long |
| SN25 | scenarios.ts:316 | … would move to before your next payday …, where the running total starts, so it would drop out of it… | anchor mechanics; ~40 words |
| SN13 | scenarios.ts:201 | … already has a change set for {date}, so a scenario can’t change its amount yet. | "change set" schedule-version jargon |
| ES1 | estimates.ts:232 | Counts only payments since your estimate became {amount} on {date}. | algorithm detail |
| ES14 | estimates.ts:389 | This suggestion is out of date. Look at the latest one before choosing. | stale-state system message |
| OP9 | operations.ts:175 | Changes can only take effect today or later, so past occurrences keep their original expectations. | "occurrences", "expectations" |
| OP11 | operations.ts:205 | This item already has history. Change its schedule from a future date instead. | "has history" jargon |
| OP12 | operations.ts:232 | This item has recorded history. Turn it off instead so the history is kept. | "recorded history" jargon |
| OP20 | operations.ts:367 | The actual date cannot be in the future. Record it once it has happened. | "actual date" jargon; negative |
| OP23 | operations.ts:387 | Only recorded transactions can be corrected. | rule-statement; negative |
| OP24 | operations.ts:396 | Only outstanding transactions can be changed. | "outstanding" jargon |
| OP27 | operations.ts:406 | This transaction was already recorded. Undo the recorded outcome first. | "recorded outcome" jargon |
| OP28 | operations.ts:420 | This transaction is already outstanding. | "outstanding" jargon |
| OP30 | operations.ts:442 | `${name}: ${error}` | machine-concatenated message |
| OP31 | operations.ts:490 | Some of these items have changed since, so they can’t be undone together. Open each one to change it. | system-state; negative |
| ST1 | store.tsx:61 | Your latest change hasn’t been saved yet. Wait for it to save, or use Try again, then do this again. | robotic save status; refers to a button by name |
| ST2 | store.tsx:62 | Reload to see the latest version before making changes. | robotic; "version" |
| ST3 | store.tsx:63 | Wait until this finishes saving, or cancel it. | robotic save status |
| ST6 | store.tsx:205 | There’s nothing to save. | robotic save status |
| ST7 | store.tsx:219 | Your data was reloaded first. Check it, then try again. | robotic; unclear "first" |
| B14 | backup.tsx:161 | The restore hasn’t been confirmed. {error} | robotic "hasn’t been confirmed" |
| B24 | backup.tsx:225 | Erasing hasn’t been confirmed. {error} | robotic "hasn’t been confirmed" |
| B26 | backup.tsx:252 + storage.ts:177 | Your latest change hasn’t been saved. Your change could not be saved on this device. Check available storage and try again. | duplicated statement when composed; robotic |
| SG4 | storage.ts:141 | Your data was changed somewhere else, such as another window. Reload to see the latest version. | conflict jargon ("version") |
| AC18 | account.tsx:153 | Changes made on this device on {date} reached your account after newer changes from another device or window, so your forecast now shows the newer version. | sync mechanics; 28 words |

## 2.3 Budgeting terminology / budgeting-flavored terms

| ID | File:line | Text | Reason |
|---|---|---|---|
| O17 | Onboarding.tsx:58 | What do you set aside? | "set aside" (envelope-budget flavor; flagged term) |
| SS26 | SourcesScreen.tsx:53 | Money you plan to set aside on a schedule. It counts as an expense. | "set aside"; engine explanation |
| SS29 | SourcesScreen.tsx:56 | Add regular amounts you set aside, like an emergency fund. | "set aside" |
| F5 | forms.tsx:44–45 | Amount you plan to set aside / Next date you’ll set it aside | "set aside" in field labels |
| SC6 | ScenarioSheet.tsx:30 | Set aside savings | "set aside" in a choice label |
| O18 | Onboarding.tsx:59 | …It counts as an expense, so cash flow shows what’s left after it… | "what’s left" reads as left-to-spend budgeting |

(No "budget", "envelope", "left to spend" or "spending" appears in rendered text; `left-to-spend` / `lts-*` survive only as CSS class names in plan.tsx.)

## 2.4 Repetitive reassurance

| ID | File:line | Text | Reason |
|---|---|---|---|
| A13 | App.tsx:110 | Your own data stays unchanged. | reassurance on every sample-mode screen |
| S8 / S12 | Settings.tsx:59, 72 | It’s kept separate from your own data. / Sample data is kept separate from yours. Your own entries stay exactly as they are… | same reassurance twice in one flow (and A13) |
| D26 / O59 / G7 / SC56 | Dashboard.tsx:301; Onboarding.tsx:382; gaps.tsx:80; ScenarioSheet.tsx:408 | It shows timing, separate from your bank balance. | same disclaimer in four places |
| SC19 | ScenarioSheet.tsx:165 | Nothing here changes your plan or is saved. | "Nothing is saved" reassurance; negative |
| SC60 | ScenarioSheet.tsx:427 | All three are hypothetical. None is added to your forecast. | repeated "not added" reassurance |
| SC78 | ScenarioSheet.tsx:676 | …They stay hypothetical and aren’t added to your forecast. | repeated "not added" reassurance |
| E24 | EstimateSheet.tsx:152 | Earlier payments, what you’ve recorded, and what was originally expected stay as they are. This changes your Financial OS forecast only. | "changes only the forecast" reassurance |
| E51 | EstimateSheet.tsx:292 | Nothing is saved until you approve. | "Nothing is saved" reassurance |
| W9 | WhatIfSheet.tsx:83 | This updates your Financial OS forecast. It doesn’t change any payment arrangement outside the app. | "changes only the forecast" reassurance |
| W19 | WhatIfSheet.tsx:150 | Shows your forecast without this income. It doesn’t change what you’re owed. | reassurance; negative |
| W21 | WhatIfSheet.tsx:156 | Shows your forecast without this payment. It doesn’t cancel, waive, or pay it. | reassurance; negative |
| PR18 | PeriodReviewSheet.tsx:93 | Marking the review done doesn’t record any payments or income. | reassurance; negative |
| RH12 | rhythm.tsx:34 | …It shows on your dashboard when it’s due; there are no notifications or emails. | reassurance; negative |
| F39 | forms.tsx:390 | This happens once and will not repeat. | redundant; negative |
| SS7 / SS14 / SS31 / O32 | SourcesScreen.tsx:25, 33, 57; Onboarding.tsx:152 | They count once. / It counts once. / It counts once, in the period it falls in. | repeated "counts once" |
| W8 / E22 / OS38 | WhatIfSheet.tsx:82; EstimateSheet.tsx:149; OccurrenceSheet.tsx:225 | later ones keep their schedule / Later payments stay at their current estimate / Future occurrences are not affected | same "later ones unchanged" reassurance |

## 2.5 Long or over-explained (>~25 words) in frequently read places (not already flagged above)

| ID | File:line | Text | Reason |
|---|---|---|---|
| P8 | plan.tsx:60 | Cash flow is income minus expenses, including savings. It counts repeating and one-time items dated in this period. | definition repeated under every breakdown (also D25, D56); "repeating" vs "recurring" |
| D67 | Dashboard.tsx:702 | Weeks run Sunday to Saturday. Tap a week to see its days, and a day for its transactions. | permanent instruction on the month view; "transactions" |
| OS18 | OccurrenceSheet.tsx:131 | This was expected on {date} and hasn’t been marked {paid}. It stays in your forecast until you record what happened, change its date, or cancel it. | 31 words on every overdue item |
| S4 | Settings.tsx:38 | Your data is saved in this browser on this device. Clearing your browser’s site data removes it, so download a backup… | 30 words |
| SS47 | SourcesScreen.tsx:208 | It will stop appearing in your forecast from today. Everything you’ve already recorded stays, and any overdue payments stay visible until you update them. | 26 words; reassurance |
| F49 | forms.tsx:462 | Pay periods run from one main payday to the next. Other income still counts as money coming in during the pay period. | over-explained; "main payday" jargon |
| R10 | ReviewSheet.tsx:109 | Select what went as expected and mark it done in one step, or tap an item to record a different amount or date. | 25 words, every time the review opens |
| O67 | Onboarding.tsx:465 | Your income is all you need to see a forecast. You enter everything yourself, and it’s saved only on this device. | negative-leaning "you enter everything yourself" |
| ES8 / ES11 / ES13 | estimates.ts:308, 335, 353–354 | `${name} may change with the season. … Consider ${prop} for that payment.` etc. | 30–40 word explanations |
| SC35 / SC36 | ScenarioSheet.tsx:305, 310 | Your projected ending total improves by …, but this scenario creates a … shortfall … , back to $0 or more on … | 25–30 words; "ending total" vs "ending running total" |

## 2.6 Negative phrasing where a positive statement would do (not already flagged above)

| ID | File:line | Text | Reason |
|---|---|---|---|
| D19 | Dashboard.tsx:237 | Pay periods aren’t available yet | negative empty-state title |
| D49 | Dashboard.tsx:528 | Next expected payday was {date} | past-due framing without a next step |
| SS37 | SourcesScreen.tsx:157 | Turned off on {date}. Not included in future forecasts. | negative second sentence |
| E16 | EstimateSheet.tsx:90 | There’s no suggestion for this item right now. Its estimate stays as it is. | negative lead |
| PR2 | PeriodReviewSheet.tsx:31 | There’s no review right now. | negative lead |
| RH5 | rhythm.tsx:15 | No reviews. You can still look at your forecast anytime. | negative lead |
| SC34 | ScenarioSheet.tsx:299 | , and it doesn’t recover within this period | negative |
| R9 | ReviewSheet.tsx:107 | Nothing to review through Saturday. Everything due so far has been recorded. | negative lead; the good news comes second |
| PR21 | PeriodReviewSheet.tsx:114 | Expected {date} · not recorded | negative tag (and differs from "Overdue since") |

## 2.7 Inconsistent terms for the same thing

| ID | File:line | Text | Reason |
|---|---|---|---|
| C5 / C7 | common.tsx:161, 173 | Done / Received / Paid / Saved | completion called "Done" in places and "Paid/Received" in others |
| R14 / R2 | ReviewSheet.tsx:117, 75 | Mark {n} items done / Marked {n} items done as expected. | "done" vs "Mark paid" (OS19) for the same action |
| D57 | Dashboard.tsx:637 | Filled chip: everything that day is done (received or paid) | "done (received or paid)" omits "saved"; three words for one state |
| PR13 / PR20 | PeriodReviewSheet.tsx:82, 112 | Recorded / Paid {date} | "Recorded" as a fourth term for completed |
| SS39 | SourcesScreen.tsx:169 | {n} overdue payments need an update. | "payments" vs D9 "transactions" for the same overdue items |
| D52 / D67 / OS8 / OS9 | Dashboard.tsx:583, 702; OccurrenceSheet.tsx:63–64 | …its transactions / Transaction / This transaction no longer exists. | "transaction" vs payment / item / occurrence elsewhere |
| SC3 / SC4 / SC11 / SC70 | ScenarioSheet.tsx:27, 28, 75, 582 | Move an expected payment / Payment | income items are also called "payment" |
| D40 vs P5 / P6 | Dashboard.tsx:485; plan.tsx:53–54 | {+$x} in · {−$y} out vs Income / Expenses | "money in/out" and "income/expenses" side by side on the dashboard |
| C8 | common.tsx:182 | Money in / Liability / Bill / Subscription / Savings | kind tag mixes a direction ("Money in") with categories |
| PR5 / D77 | PeriodReviewSheet.tsx:50–58; Dashboard.tsx:802–810 | Money in / Money out vs PR11/PR12 "Expected income / Expected payments" | in/out vs income/payments in the same sheet |
| C8 / T3 / A4 | common.tsx:182; types.ts:185; App.tsx:20 | Liability / Liability payment / Liabilities | three forms for the same kind |
| D3 | Dashboard.tsx:72 | Paycheck (view tab) | tab says "Paycheck" but every label inside says "pay period" |
| R22 vs PR22 / PR23 | ReviewSheet.tsx:182; PeriodReviewSheet.tsx:116–117 | Due today / Due {date} vs Expected today / Expected {date} | "due" vs "expected" for the same state in two review sheets |
| R22 vs PR21 / OS18 | ReviewSheet.tsx:182 | Overdue since {date} | vs "Expected {date} · not recorded" vs "hasn’t been marked paid" |
| W3 vs PR15 vs OS21 | WhatIfSheet.tsx:15; PeriodReviewSheet.tsx:87; OccurrenceSheet.tsx:147 | Skip this one / Skip this one / Cancel this one | identical "Skip this one" means "leave out of a preview" in one place and "skip the review" in another; "Cancel this one" is a third near-synonym |
| SC33 vs D44 / G1 | ScenarioSheet.tsx:298 | creates a {amount} shortfall / deepens a shortfall | "shortfall" vs "timing gap" for the same thing |
| SC35 vs SC47 | ScenarioSheet.tsx:305, 361 | projected ending total / Ending running total | two names for one figure |
| D32 | Dashboard.tsx:329 | Totals for each period are still shown below. | "totals" vs "cash flow" |
| OS27 / OS42 | OccurrenceSheet.tsx:168, 241 | Delete this one-time {o.kind} (renders "bill" for an item added as a "one-time expense") | raw kind id; contradicts "One-time expenses" |
| SS57 / F43 | SourcesScreen.tsx:344; forms.tsx:409 | Add one-time bill | vs section "One-time expenses" and Onboarding "Add one-time expense" |
| O36 vs OS45 | Onboarding.tsx:165; OccurrenceSheet.tsx:249 | Remove {name} vs Delete | "remove" vs "delete" for the same one-time item |
| OS26 vs B7 | OccurrenceSheet.tsx:163; backup.tsx:115 | Restore to expected / Restore from backup | "restore" used for two unrelated actions |
| E10 / D11 / O19 / PR3 | EstimateSheet.tsx:48; Dashboard.tsx:164; Onboarding.tsx:61; PeriodReviewSheet.tsx:45 | Review / Review this week / Review / Weekly review | "review" means four different things |
| SC18 vs W4 / G17 | ScenarioSheet.tsx:163; WhatIfSheet.tsx:45; gaps.tsx:142 | Explore a scenario / What if… | two names for the hypothetical feature |
| F1–F4 / F45 / OP7 | forms.tsx:17–38, 431; operations.ts:112 | Next payment date / Next due date / Next charge date / Next expected date / "The next expected date must be today or later." | error names a field label the person never saw |
| F15 / RC6 / SC8 | forms.tsx:184; recurrence.ts:109; ScenarioSheet.tsx:35 | Once a month / Monthly on the 18th / Every month | three phrasings for monthly |
| D29 vs O44 | Dashboard.tsx:323; Onboarding.tsx:289 | Add a recurring income to start your forecast. / Add recurring income to start your forecast. | near-duplicate with different article |
| D12 / PR3 / RH10 | Dashboard.tsx:172; PeriodReviewSheet.tsx:45; rhythm.tsx:29 | Your on payday review is ready / On payday review / Monthly look-ahead review / Reviews: on payday. | cadence label pasted into sentences produces broken phrasing |

## 2.8 Unnecessary apologies, condescension, artificial enthusiasm

| ID | File:line | Text | Reason |
|---|---|---|---|
| S6 | Settings.tsx:48 | Entered something wrong from the start? Start over to erase everything… | mildly condescending framing |
| W27 / PV4 | WhatIfSheet.tsx:173; preview.ts:168 | …the payment would just drop out of it / simply drop out | minimizing "just/simply" |

(No apologies or exclamation-mark enthusiasm found in the default build.)

## 2.9 Button labels: not action-oriented, or inconsistent ellipses

| ID | File:line | Text | Reason |
|---|---|---|---|
| OS20 | OccurrenceSheet.tsx:144 | Change just this one | vague object |
| OS21 | OccurrenceSheet.tsx:147 | Cancel this one | vague; collides with "Cancel" buttons |
| OS24 | OccurrenceSheet.tsx:157 | Undo: not paid yet | a status, not an action |
| OS28 | OccurrenceSheet.tsx:181 | Change this and later ones | vague; actually navigates to another screen |
| D11 | Dashboard.tsx:165 | Review this week · 3 | count glued onto the label |
| D12 | Dashboard.tsx:172 | Your weekly review is ready | status sentence used as a button |
| D44 | Dashboard.tsx:504 | Timing gap ahead · …, by up to $X | status used as a button; "by up to" awkward |
| D36 | Dashboard.tsx:407 | Calendar key | noun, not an action |
| A14 | App.tsx:120 | Leave | bare verb (object only for screen readers) |
| O69 | Onboarding.tsx:477 | Have a backup? Restore it | question form as a button label |
| B19 | backup.tsx:185 | OK | non-descriptive |
| SC30 | ScenarioSheet.tsx:260 | Done | closes without saving; could read as "apply" |
| E38 / W18 | EstimateSheet.tsx:235; WhatIfSheet.tsx:137 | Approve… / Apply change… | ellipsis used for a confirm step here… |
| SS42 / B21 / AC5 / S9 | SourcesScreen.tsx:181; backup.tsx:214; account.tsx:60; Settings.tsx:62 | Turn off / Start over / Delete account / Explore with sample data | …but not on these, which also open a confirmation |
| G17 / W4 | gaps.tsx:142; WhatIfSheet.tsx:45 | What if… | ellipsis as title punctuation, not "more input needed" |

---

# Counts

- **Inventory entries (Section 1): 801**, covering 29 files (default build). Some entries group close variants of one string (singular/plural, the received/paid/saved verb, a label with its hint). Counted individually, that comes to roughly 1,000 distinct strings.
- **Flagged (Section 2): 165 flag rows covering 206 distinct inventory entries.** About 26% of entries are flagged.
  - "debt": 2 (O14, W20)
  - Mechanical / implementation terms / jargon: 77 rows
  - Budgeting-flavored ("set aside", "what’s left"): 6 rows
  - Repetitive reassurance: 16 rows
  - Long / over-explained: 10 rows
  - Negative phrasing: 9 rows
  - Inconsistent terms: 28 rows
  - Condescension / minimizing: 2 rows
  - Button labels / ellipses: 15 rows

# Top 25 flagged strings, ranked by how often a person sees them

| # | ID | Text | Where / how often | Reason |
|---|---|---|---|---|
| 1 | D9 | 1 transaction needs an update / N transactions need an update | Dashboard banner and sheet title whenever anything is overdue | robotic status; "transaction" vs payment/item |
| 2 | C5 / C7 / R14 | Done vs Received / Paid / Saved; "Mark 3 items done" | Status badge on every list row; review sheet | inconsistent completion terms |
| 3 | D40 vs P5/P6 | "+$x in · −$y out" vs "Income / Expenses" | Dashboard hero card and the breakdown below it, every view | money in/out vs income/expenses |
| 4 | P8 | Cash flow is income minus expenses, including savings. It counts repeating and one-time items dated in this period. | Under the dashboard breakdown, every view | repeated definition; "repeating" vs "recurring" |
| 5 | D45 | Running total stays at or above $0 this period | Dashboard hero whenever there's no gap | robotic status |
| 6 | D67 | Weeks run Sunday to Saturday. Tap a week to see its days, and a day for its transactions. | Month / Paycheck / Custom views, always | permanent instruction; "transactions" |
| 7 | D73 | “—” means the day is on or before {date}, when the running total begins. | Week lists and day-by-day timeline | anchor mechanics |
| 8 | OS29 | “Just this one” changes only the {date} occurrence. To change the amount or schedule from a date on, edit … on its screen. | Every outstanding recurring item sheet | "occurrence"; long |
| 9 | OS20 / OS21 (+W3, PR15) | Change just this one / Cancel this one / Skip this one | Every outstanding item sheet; what-if; review | vague labels; "Skip this one" means two things |
| 10 | OS18 | This was expected on {date} and hasn’t been marked paid. It stays in your forecast until you record what happened, change its date, or cancel it. | Every overdue item sheet | 31 words; system explanation |
| 11 | OS24 | Undo: not paid yet | Every completed item sheet | status, not an action |
| 12 | SS39 | N overdue payments need an update. | Item cards on Income/Expenses/Liabilities | "payments" vs D9 "transactions" |
| 13 | F32 | Changes to the amount or schedule apply starting on the date below. Earlier transactions and anything you have already recorded keep their original values. | Every edit of an item with history | versioning mechanics; long |
| 14 | F33 | Changes start with the payment on | Same edit form, date label | awkward, incomplete label |
| 15 | SS37 | Turned off on {date}. Not included in future forecasts. | Every turned-off item card | negative phrasing |
| 16 | OS26 | Restore to expected | Every canceled item sheet | jargon; "restore" overloaded |
| 17 | R16 | Done uses each item’s expected amount and date (today, for items not yet due). Each original prediction is kept. | Review sheet once anything is selected | mechanical; "prediction" |
| 18 | R22 vs PR22/PR23 | Due today / Due {date} vs Expected today / Expected {date} | Weekly review list vs period review list | due vs expected |
| 19 | D30 / D21 | …so we need at least one recurring income… / We need at least two upcoming main paydays… | Dashboard until income is set up; Paycheck view | system-explaining; long |
| 20 | D26 / D27 / O57 / O58 | The running total starts at $0 on {date}, the day before your next expected payday… because the app doesn’t know how much money you have now. | Info sheet from the hero card; onboarding review | anchor mechanics; 38-word sentence |
| 21 | D26 / O59 / G7 / SC56 | It shows timing, separate from your bank balance. | Four separate sheets | repeated disclaimer |
| 22 | SC19 / SC60 / SC78 / E24 / E51 / W9 / W19 / W21 / PR18 | Nothing here changes your plan or is saved. / Nothing is saved until you approve. / This changes your Financial OS forecast only. … | Scenario, estimate, what-if and review sheets | repetitive reassurance |
| 23 | O17 / SS26 / SS29 / F5 / SC6 | What do you set aside? / Amount you plan to set aside … | Savings step, Savings tab, savings form, scenarios | "set aside" flagged term |
| 24 | O14 | What do you pay toward debts? | Onboarding Liabilities step (once per setup) | "debt" |
| 25 | W20 | …Your debt and the payment you owe don’t change; Financial OS just leaves this one out. | What-if "Skip" on a liability with no type | "debt" fallback; "just" |
