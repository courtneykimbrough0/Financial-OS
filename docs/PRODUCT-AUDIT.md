# Product experience audit (October 2026)

> **Phase R1 complete (October 2026).** The main paycheck concept and the Paycheck view have been removed. The forecast-start analysis in §6 below is preserved as a historical record; its fix (Phase A1) and the full removal (Phase R1) are described in [PRODUCT_EXPERIENCE.md](../PRODUCT_EXPERIENCE.md) §8 and [BUILD_AND_TEST_ROADMAP.md](../BUILD_AND_TEST_ROADMAP.md).

A read-only audit of the current Financial OS app against the intended product experience. The decisions and specifications that follow from it are in [PRODUCT_EXPERIENCE.md](../PRODUCT_EXPERIENCE.md), and the order of work is in [BUILD_AND_TEST_ROADMAP.md](../BUILD_AND_TEST_ROADMAP.md), Phases A–F. No application code was changed for this audit.

> **Revised by the product reduction audit** ([REDUCTION-AUDIT.md](REDUCTION-AUDIT.md)), which applies the product philosophy in AGENTS.md section A. The findings, wording table and forecast-start analysis below stand. These recommendations are superseded:
> - a Home that defaults to the pay period;
> - folding the week view into a Calendar agenda;
> - a Reports tab built around analysis;
> - one-tap recording with undo toasts.
>
> The week view, the Activity view and corrections by ordinary editing replace them (PRODUCT_EXPERIENCE.md §3–§4).

## 1. Method

- **Code.** Commit `d00a919` on `ccr-12ec4965-6tzwgr`.
- **Build.** The device-only build (`VITE_ACCOUNTS=off`, the same one `npm run e2e` uses), served by `server.mjs`.
- **Browser.** Chromium through Playwright, clock pinned to Sunday, Oct 11, 2026, 9:00.
- **Viewports.** Phone 390 × 844 and desktop 1280 × 900.
- **Data:**
  1. empty, the first-run path;
  2. a fresh setup reproducing the forecast-start report: two paychecks and rent;
  3. the built-in sample data;
  4. setup finished without income.
- **Screens captured.** 44 screenshots:
  - welcome, setup steps, the setup form and setup review;
  - Home in all four views, with the day, item, review, timing-gap, What if…, scenario, calendar-key and "how it works" sheets;
  - Income, Bills, Subscriptions, Savings, Liabilities and Settings;
  - the desktop dashboard, desktop dialog, desktop Income and desktop Settings;
  - the empty dashboard and the no-income warning.

  The screenshot script and images are kept outside the repository: they hold no source, and the `e2e-screenshots/` folder is git-ignored. Each finding below names what it saw.
- **Not captured.** The Firebase Google sign-in screen, which needs a live Firebase project, and the Supabase account screens, which need the local stack and only exist in the development build. Both were reviewed from code (`src/ui/screens/SignIn.tsx`, `src/ui/supabase/AuthScreens.tsx`) and from the account browser tests from earlier work.
- **Criteria.** For each screen:
  - Is its purpose clear?
  - Is the most important thing dominant?
  - Do elements compete?
  - Is the next action clear?
  - Are actions easy to find?
  - Is anything repeated?
  - Are labels clear?
  - Are there too many taps or dialogs?
  - Are empty or irrelevant elements shown?
  - Does it fit a phone?
  - Are errors and confirmations understandable?
  - Is it consistent with the rest of the app?

## 2. Findings ranked by severity

**Severity levels:**
- **High:** wrong or misleading financial information, or a core job that can't be done.
- **Medium:** a core job made hard or confusing.
- **Low:** polish.

### High

**H1. The running total can start too late and hide a real timing gap.** *Financial correctness, not design.*
- **Where:** `src/domain/forecast.ts` (`nextExpectedPayday`, `buildForecast`) and `src/domain/types.ts` (`mainPaycheckId`).
- **What the audit saw:** setup with "Restaurant paycheck" ($900, every 2 weeks from Oct 27) entered first, then "Weekend job" ($400, every 2 weeks from Oct 19), then Rent ($1,000 on Oct 22).
  - The setup review says "Next expected payday Oct 27".
  - It warns that "1 payment ($1,000.00) is due before your next payday… Make sure the money you have now covers it."
  - The day sheet for Oct 19 shows the $400 with running total "—".
- **What it should show:** a running total starting Oct 19 at +$400 and dropping to −$600 on Oct 22, which is a $600 timing gap.

Full analysis: §6.

**H2. A plan without income shows a dashboard of zeros.** Seen in `e02-dashboard-no-income`.
- **What it shows:** a setup card, then:
  - a $0.00 cash-flow hero;
  - an empty month calendar whose days all open empty sheets;
  - a breakdown of $0.00 / $0.00 / $0.00;
  - five week rows reading "$0.00 $0.00 Net $0.00 Running total —".
- **Where:** `Dashboard.tsx` (`IssueCard`, `PeriodBody` always renders).
- **Fix:** a single setup card with "Add income", and nothing else (PRODUCT_EXPERIENCE.md §5).

**H3. The dashboard is overcrowded, and its key numbers aren't above the fold.** Seen in `s01`/`s02` and `d02`.
- **What's stacked on a phone:**
  1. sample banner;
  2. date heading;
  3. overdue banner;
  4. "Explore a scenario";
  5. four view pills;
  6. month navigation;
  7. hero card, with its payday line cut off at the fold;
  8. calendar;
  9. key link;
  10. Breakdown;
  11. tags;
  12. Week by week.
- **Problems:**
  - The calendar starts below the fold.
  - The Breakdown repeats the hero's income, expenses and cash flow.
  - There is no "what's next" list: to see the next payments, the person scans calendar chips or opens weeks.
- **Where:** `Dashboard.tsx`.
- **Fix:** the Home structure in PRODUCT_EXPERIENCE.md §3.2.

**H4. Only fixed recurring income can be modeled.**
- **Missing:** hourly, tipped, freelance and gig income, "possible" (uncertain) income, and the distinction between earned and received.
- **Effect:** a tipped or freelance worker either enters a guess as if it were certain (overstating the forecast) or leaves it out (understating it).
- **Where:** `types.ts`, `forms.tsx`, `SourcesScreen.tsx`.
- **Fix:** PRODUCT_EXPERIENCE.md §6.

**H5. One bill appears on three dates with no explanation.** In the sample data, the phone bill is:
- overdue since Oct 5 (review sheet);
- drawn on Oct 22 in the calendar, because it is carried forward to the running total's start;
- "Next: Nov 5, 2026" on its Bills card, which ignores the overdue payment.

Each is correct by the engine's rules, but together they read as an error.
- **Where:**
  - `SourcesScreen.tsx` (next date skips overdue);
  - `Dashboard.tsx` (the calendar shows the carried-forward date with only a small amber icon);
  - the `EntryButton` sub-line "Overdue since…", which only appears inside the day sheet.
- **Fix:**
  - Bills card: "Overdue since Oct 5".
  - Calendar: on the start day, show a single "overdue" chip with the original date in its spoken label.
  - Coming up: list it first.

### Medium

**M1. Empty weeks and days take full rows.**
- **Seen in:** `s02`, `s03`, `s13`.
- **What happens:**
  - "Week by week" lists every week, including "Oct 11 – 17 · $0.00 $0.00 Net $0.00 · Running total —".
  - Expanding a week lists every day, including days with nothing, as rows of "—".
  - In the pay-period view, "Nov 1 – 4 · $0.00 $0.00 Net $0.00 · Running total −$600.00" correctly stays visible, because the running total is negative. But nothing distinguishes it from a meaningless empty week.
- **Where:** `WeekList` and `Timeline` in `Dashboard.tsx`; `dailyTimeline` returns every day by design.
- **Fix:** the visibility rules in PRODUCT_EXPERIENCE.md §5.

**M2. Every calendar day is a button, and empty days open an empty sheet.** Seen in `s04`.
- The sheet shows "Money in —", "Money out —", "Running total —" and "Nothing scheduled this day."
- **Where:** `Calendar`, `DaySheet` in `Dashboard.tsx`.
- **Fix:** only days with entries, or a running total below $0, are interactive.

**M3. Dashes and footnotes explain the engine instead of the person's money.**
- **The wording:** "Running total —" before the start, and the footnote "“—” means the day is on or before Oct 21, when the running total begins."
- **Repeated:** in the week list, the day list, the day sheet, the about sheet and the onboarding review.
- **Fix:** start the list at the running total's start, with one line above it: "Your running total starts Oct 22, your next payday." See the copy table in §4.

**M4. Wording reads as system-generated in high-traffic places.** Full table in §4. Examples:
- "1 transaction needs an update";
- "What do you pay toward debts?" (uses "debt");
- "Undo: not paid yet";
- "Pay period 1 of 12 · starts with Paycheck · next main payday Nov 5";
- the explanation paragraphs in the gap and What if… sheets.

**M5. Plan screens (Income, Bills, Subscriptions, Savings, Liabilities) are long and button-heavy.** Seen in `s15`/`s16`.
- Every card has three equal buttons (See dates / Edit / Turn off) and an "On" badge.
- Three bills fill more than a screen.
- One-time items sit in a separate section with its own empty card ("Nothing one-time yet").
- **Where:** `SourceCard` in `SourcesScreen.tsx`.
- **Fix:** tappable rows with a detail sheet (PRODUCT_EXPERIENCE.md §3.4).

**M6. Recording a payment takes four to five steps from the calendar**: day → day sheet → item → "Mark paid" → form → Save.
- The review list allows batches, but it's reached only through the overdue banner or a small "Review this week" button.
- Home has no direct "record" action.
- **Fix:** ✓ on Coming up rows, plus Quick add › Record a payment.

**M7. Navigation gives a top-level tab to Liabilities, and none to daily tasks.**
- Income, Expenses and Liabilities are setup screens, used rarely.
- The calendar and the review list, used daily, share the dashboard.
- **Where:** `App.tsx` (`NAV`).
- **Fix:** PRODUCT_EXPERIENCE.md §3.1.

**M8. Setup is long, and its review is crowded.**
- **Length:** seven steps.
- **The review page stacks:**
  - a hero;
  - an info callout;
  - the first-pay-period breakdown and tags;
  - five lists, three of them "None added." cards.
- **Toasts:** two stacked toasts ("Added Weekend job.", "Added Rent.") covered the cash-flow banner in `m08`.
- **Where:** `Onboarding.tsx`, toast placement in `common.tsx` / `styles.css`.
- **Fix:** four steps (PRODUCT_EXPERIENCE.md §7.9), one toast at a time.

**M9. The desktop is the phone layout centered at 640 px.**
- Seen in `d01`/`d02`.
- On a 1280 px screen, most of the width is empty and the page is long.
- Dialogs are centered over the content they refer to.
- **Fix:** PRODUCT_EXPERIENCE.md §7.6.

**M10. The calendar needs a key to read.**
- **The encoding:**
  - green and indigo chips;
  - filled versus outlined;
  - a 14 px amber icon for overdue;
  - a red trend icon for below $0;
  - a tiny "LOW" label.
- **Effect:** money out in indigo competes with the indigo accent used for focus and the sample banner.
- **Fix:** PRODUCT_EXPERIENCE.md §7.2.

**M11. Settings opens with the least-used setting.** Seen in `s19`.
- The review rhythm's four large radio cards fill the first screen.
- Backups and sample data are below the fold.
- **Fix:** PRODUCT_EXPERIENCE.md §3.5.

**M12. Scenario and What if… sheets explain at length before the person does anything.** Seen in `s11`, `s08`.
- **Scenario sheet:** opens with "Try a few what-ifs together and compare them with your forecast. Nothing here changes your plan or is saved." and "No changes yet. Add one to see how it would affect your forecast."
- **Gap sheet:** leads with a three-line paragraph.
- **Fix:** shorter copy (§4), and "How this works" for the rest.

### Low

- **L1. The heading names nothing.** The dashboard's heading is a date ("Sun, Oct 11"), and its purpose is only in screen-reader text.
- **L2. Hint text everywhere:**
  - "Tap a day for details."
  - "Weeks run Sunday to Saturday. Tap a week to see its days, and a day for its transactions."
  - "Cash flow is income minus expenses, including savings. It counts repeating and one-time items dated in this period."

  These sit under cards on every visit.
- **L3. The sample banner** takes about 70 px of every screen. Acceptable, but it can shrink to one line.
- **L4. The pay-period view** describes itself mechanically ("Pay period 1 of 12 · starts with Paycheck · next main payday Nov 5").
- **L5. The "On" badge** is shown on every active item. Active is the normal state; only "Off" needs marking.
- **L6. The custom range** shows two date fields and an error area permanently in the view, instead of a picker sheet.
- **L7. Sign-in (Firebase, legacy):**
  - It is clear and short.
  - "First time here? Signing in creates your account." is fine.
  - Errors pass raw Firebase messages through (`err.message`), which can be technical.

  The Supabase account screens (development only) were written with care in Step 10d. Their wording should still be checked against the voice guide when accounts reach production.

## 3. Screen by screen

| Screen | Purpose clear? | What works | What to change (finding) |
| --- | --- | --- | --- |
| Welcome | Yes | One heading, one checklist, sample data and restore links | Checklist is four sentences; "it’s saved only on this device" is phrased as a limitation (§4) |
| Setup: income | Yes | Form is short; main paycheck picker appears only with two or more incomes | "Continue without income" warning is long; only fixed income (H4) |
| Setup: bills, subscriptions, liabilities, savings | Mostly | Optional steps say so; "Skip to review" | Four separate steps; "debts" (M4, M8) |
| Setup: review | Partly | Shows next payday and lowest running total | Crowded; "None added." cards; before-payday paragraph (M8, H1) |
| Home / dashboard | Partly | Hero leads with cash flow; gaps explained; overdue surfaced | H2, H3, H5, M1, M2, M3, M6, L1, L2 |
| Calendar (inside dashboard) | Yes, with key | Good accessible labels per cell | M2, M10 |
| Week / pay period / custom views | Partly | Same anchor and running total in every view | M1, L4, L6 |
| Day sheet | Yes | In / out / running total, then items | Opens empty (M2); dashes (M3) |
| Item sheet (mark as paid, move, cancel) | Yes | Clear expected vs actual, difference line, undo | "Undo: not paid yet", "Fix what was paid" wording (M4); four equal buttons |
| Review list (overdue / this week) | Yes | Select several, Mark done, Move, Undo the batch | Intro paragraph too long; reached only from a banner (M6) |
| Timing gap sheet | Yes | Traces each gap with numbers; What if… per item | Long lead paragraph; "Running total before" rows read like a ledger (M12) |
| What if… | Yes | Shows before and after | Repeated "only changes the forecast" reassurances; implementation terms in limitations (M12, §4) |
| Scenario | Partly | Powerful; shortfall shown first | Long intro; advanced feature placed second on Home (M12, H3) |
| Estimate suggestion | Yes | Explains the method; approve needs confirmation | Dense; several "how it was worked out" lines (§4) |
| Income / Expenses / Liabilities | Yes | Effective-date edits; turn off / on | M5, H5, L5 |
| Settings | Yes | Clear sections | M11 |
| Backup and restore | Yes | Says what will be replaced; offers a backup first | Fine; keep. Wording check in §4 |
| Start over | Yes | Confirms; offers a backup | Fine |
| Save status (error / conflict) | Yes | Plain: "Your latest change hasn’t been saved." | Keep; conflict text names "somewhere else", which is fine |
| Loading | — | "Loading…" screen | Fine |
| Sign-in (Firebase) | Yes | One button | L7 |

## 4. Interface wording

Voice and tone rules: PRODUCT_EXPERIENCE.md §2. The complete inventory (about 800 entries, every string with file and line, 165 flags) is [COPY-INVENTORY.md](COPY-INVENTORY.md). The table below is the reviewed list of phrases to change, roughly in order of how often people see them. Proposed wording is a starting point for Phase B, not final copy; IDs refer to the inventory.

**Patterns behind most of the flags.** (1) Explaining the engine: "the running total starts at $0 on …, the day before …", "occurrence", "prediction", "outstanding", "recorded outcome". (2) One state, many words: Done / Received / Paid / Saved / Recorded; transaction / payment / item; Due / Expected; shortfall / timing gap; Skip / Cancel. (3) The same reassurance repeated ("Nothing is saved", "changes only your forecast", "separate from your bank balance", "counts once"). (4) Status sentences used as buttons. (5) One use of "debt" and one fallback that can render it.

**Term decisions for Phase B.** Completed income is **Received**, completed payments are **Paid**, completed savings is **Saved**. The batch action, which can mix kinds, says "Record 3 as expected"; "Done" leaves the interface. Items are **payments** (money out) and **income** (money in); "transaction" leaves the interface. A date that passed with nothing recorded is **Overdue**; anything still to come is **Expected** (for money out, "Due" is acceptable in the item's own sheet). A below-$0 stretch is a **timing gap** everywhere, including scenarios.

| # | Where (ID) | Current | Proposed | Why |
| --- | --- | --- | --- | --- |
| 1 | Dashboard overdue banner (D9) | "1 transaction needs an update" | "1 payment to update" / "Phone is overdue" (one item) | Robotic; "transaction" |
| 2 | Setup step title (O14) | "What do you pay toward debts?" | "Do you make loan or card payments?" | Never "debt" |
| 3 | What if… skip note (W20) | "…Your debt and the payment you owe don’t change; Financial OS just leaves this one out." | "This only changes your forecast. Your loan and its payments stay the same." (use the liability's type; no "debt" fallback) | "debt"; "just" |
| 4 | Hero all-clear (D45) | "Running total stays at or above $0 this period" | "You stay above $0 through Nov 4." | Status readout |
| 5 | Hero gap button (D44) | "Timing gap ahead · Oct 31, by up to $600.00" | "Short $600 on Oct 31 · See why" | Status used as a button; "by up to" |
| 6 | Hero payday (D49) | "Next expected payday was Oct 22" | "Your Oct 22 paycheck is overdue. Record it" | Past framing with no action |
| 7 | Breakdown hint (P8) | "Cash flow is income minus expenses, including savings. It counts repeating and one-time items dated in this period." | Remove from the card; in "How this works": "Cash flow is money in minus money out for this period. Savings counts as money out." | Repeated on every view; "repeating" |
| 8 | Week list hint (D67) | "Weeks run Sunday to Saturday. Tap a week to see its days, and a day for its transactions." | Remove | Permanent instruction |
| 9 | Timeline footnote (D73) | "“—” means the day is on or before Oct 21, when the running total begins." | Remove; start the list at the start date with "Your running total starts Oct 22, your next payday." | Explains the anchor |
| 10 | About sheet (D26, D27, O57, O58) | "The running total starts at $0 on Oct 21, the day before your next expected payday (Oct 22), and adds money in and subtracts money out day by day. It shows timing, separate from your bank balance…" (two paragraphs, 38-word sentence) | "Your running total starts at $0 the day before your next paycheck, then adds what comes in and subtracts what goes out. It shows whether your income arrives in time for your payments; your bank balance can differ." Then: "Payments due before Oct 22 come from the money you have now." | Engine mechanics; length |
| 11 | No-income card (D30, O70) | "Your running total starts the day before your next expected payday, so we need at least one recurring income…" | "Add your income to see what’s ahead." [Add income] | Explains the system's needs |
| 12 | Pay period empty (D19, D21) | "Pay periods aren’t available yet" / "We need at least two upcoming main paydays to show a pay period…" | "Pay periods start once your main paycheck has two upcoming paydays." | Negative; system needs |
| 13 | Pay period readout (D18) | "Pay period 1 of 12 · starts with Paycheck · next main payday Nov 5" | "Paid Oct 22 · next paycheck Nov 5" | Readout; "main payday" |
| 14 | Day sheet below $0 (D78) | "Below $0: scheduled money out is ahead of money in by $600.00 at the end of this day." | "Short $600 at the end of this day." | Restates the number mechanically |
| 15 | Setup before-payday note (O51) | "1 payment ($1,000.00) is due before your next payday. The running total starts at $0 on Oct 26, so it doesn’t include it. Make sure the money you have now covers it." | "Rent ($1,000) is due Oct 22, before your first payday. Make sure the money you have now covers it." | Anchor mechanics; 40 words (and wrong in H1's case) |
| 16 | Item sheet overdue note (OS18) | "This was expected on Oct 5 and hasn’t been marked paid. It stays in your forecast until you record what happened, change its date, or cancel it." | "Due Oct 5. Record the payment, or move it to a new date." | 31 words; system explanation |
| 17 | Item sheet buttons (OS19–OS21) | "Mark paid" · "Change just this one" · "Cancel this one" | "Record payment" · "Change date or amount" · "Skip this payment" | Vague objects; "Cancel" collides with dialog Cancel |
| 18 | Item sheet undo (OS24) | "Undo: not paid yet" | "Undo payment" | A status, not an action |
| 19 | Item sheet correct (OS22) | "Fix what was paid" | "Edit payment" | Odd verb |
| 20 | Item sheet restore (OS26) | "Restore to expected" | "Undo skip" | "Restore" also means backup restore |
| 21 | Scope hint (OS29) | "“Just this one” changes only the Oct 22 occurrence. To change the amount or schedule from a date on, edit … on its screen." | "This changes Oct 22 only. To change every payment from a date on, edit Rent." | "occurrence"; length |
| 22 | Scope button (OS28) | "Change this and later ones" | "Edit Rent" (opens the item) | It navigates; say so |
| 23 | Cancel confirm (OS37, OS38, OS41) | "Cancel this occurrence?" / "It will be removed from your forecast but kept on record as canceled. Future occurrences are not affected." / "Cancel occurrence" | "Skip the Oct 22 rent?" / "It comes off your forecast. Later payments stay." / "Skip payment" | "occurrence"; "kept on record" |
| 24 | Item sheet labels (OS3, OS4, OS33) | "Originally expected" · "Updated expectation" · "The original prediction is kept for comparison." | "Expected" · "Now expected" · (remove the sentence) | Jargon; reassurance |
| 25 | Delete one-time (OS27) | "Delete this one-time {kind}" (renders "bill" for a one-time expense) | "Delete {name}" | Raw internal kind |
| 26 | Review sheet intro (R10) | "Select what went as expected and mark it done in one step, or tap an item to record a different amount or date." | "Select what went as planned, or tap one to change it." | 25 words each time |
| 27 | Review sheet hint (R12, PR8) | "Due today or earlier. These stay in your forecast until you record them." | "Due today or earlier." | Repeated system explanation |
| 28 | Review action (R14, R16) | "Mark 3 items done" · "Done uses each item’s expected amount and date (today, for items not yet due). Each original prediction is kept." | "Record 3 as expected" · "Each is recorded at its expected amount, on its due date (or today, if it isn’t due yet)." | "done"; "prediction" |
| 29 | Review empty (R9) | "Nothing to review through Saturday. Everything due so far has been recorded." | "You’re up to date through Saturday." | Good news second |
| 30 | Review due label (R22 vs PR22) | "Due Oct 22" in one sheet, "Expected Oct 22" in the other | "Due Oct 22" for payments, "Expected Oct 22" for income, in both | Same state, two words |
| 31 | Review rhythm entry (D12) | "Your on payday review is ready" | "Time for your payday review" / "weekly review" / "monthly look-ahead" | Label pasted into a sentence |
| 32 | Sources overdue note (SS39) | "1 overdue payment needs an update." | "Overdue since Oct 5 · Update" | Status sentence |
| 33 | Sources dates hint (SS44) | "Last 60 days and next 90 days. Select one to record what happened or change just that date." | "Recent and upcoming dates. Tap one to record or change it." | Exposes the query window |
| 34 | Turned-off item (SS37) | "Turned off on Oct 5. Not included in future forecasts." | "Off since Oct 5." | Negative second sentence |
| 35 | Turn-off confirm (SS47) | "It will stop appearing in your forecast from today. Everything you’ve already recorded stays, and any overdue payments stay visible until you update them." | "It leaves your forecast from today. Payments you’ve recorded stay." | 26 words; reassurance |
| 36 | Edit schedule hint (F32) | "Changes to the amount or schedule apply starting on the date below. Earlier transactions and anything you have already recorded keep their original values." | "Changes apply from this date. Earlier payments stay as they were." | Versioning mechanics |
| 37 | Edit schedule label (F33) | "Changes start with the payment on" | "Starting with the payment on" | Incomplete label |
| 38 | Turn back on (F46) | "Nothing is added for the time it was turned off." | "Payments restart from this date." | Engine behavior; negative |
| 39 | Main paycheck hint (F49) | "Pay periods run from one main payday to the next. Other income still counts as money coming in during the pay period." | "Pay periods run from one of these paydays to the next. All income still counts." | Jargon; length |
| 40 | Setup welcome hint (O67) | "Your income is all you need to see a forecast. You enter everything yourself, and it’s saved only on this device." | "Start with your income — that’s enough for a forecast. Your data stays on this device." | Limitation framing |
| 41 | Setup restore link (O69) | "Have a backup? Restore it" | "Restore a backup" | Question as a button |
| 42 | Settings start over (S6) | "Entered something wrong from the start? Start over to erase everything…" | "Start over: erase everything and set up again. You can download a backup first." | Mildly condescending |
| 43 | Settings storage note (S4) | "Your data is saved in this browser on this device. Clearing your browser’s site data removes it, so download a backup…" | "Your data is saved in this browser. Download a backup to keep a copy or move to another device." | 30 words |
| 44 | Review rhythm intro (RH12, RH5) | "…It shows on your dashboard when it’s due; there are no notifications or emails." · "No reviews. You can still look at your forecast anytime." | "Reviews appear on Home when they’re due." · "Off" | Negative reassurance |
| 45 | Gap sheet intro (G4) | "On these dates, scheduled money out runs ahead of money in, so the running total drops below $0. Each one shows what leads to its lowest point and what brings it back." | "Your payments get ahead of your income on these dates. Here’s what causes each gap and what ends it." | 32 words |
| 46 | Gap no recovery (G14) | "The running total doesn’t return to $0 or more in the forecast, which runs through Nov 15, 2027." | "It stays below $0 through Nov 15, 2027." | Negative; horizon mechanics |
| 47 | Repeated disclaimer (D26, O59, G7, SC56) | "It shows timing, separate from your bank balance." (four places) | Once, in "How this works" | Repetition |
| 48 | Scenario intro (SC19) | "Try a few what-ifs together and compare them with your forecast. Nothing here changes your plan or is saved." | "Try changes together and see how your forecast would look. Your plan stays as it is." | Negative reassurance |
| 49 | Scenario empty (SC) | "No changes yet. Add one to see how it would affect your forecast." | "Add a change to compare." | Length |
| 50 | Scenario validation (SC29, SC32) | "One change needs attention before the scenario can be compared." · "Needs attention: …" | "Fix 1 change to see the comparison." · (the error alone) | Robotic prefix |
| 51 | Scenario term (SC33, SC35) | "creates a $600 shortfall" · "projected ending total" | "creates a $600 timing gap" · "ending running total" | Term consistency |
| 52 | Scenario / What if… / Estimate "can't compare" (W26, W27, W28, E48, E49, SN23–SN25) | "This changes your next payday from Oct 22 to Oct 23. The running total starts the day before payday, so the two forecasts would start on different days and can’t be compared directly." | "This moves your first payday, so cash flow is compared instead of running totals." | Anchor mechanics; 40 words |
| 53 | Repeated "forecast only" (E24, E51, W9, W19, W21, PR18, SC60, SC78) | e.g. "This updates your Financial OS forecast. It doesn’t change any payment arrangement outside the app." | One line per sheet, where the action is: "This changes your forecast only." | Repetition |
| 54 | Estimate explanation (E39) | "Dismiss keeps $180 and doesn’t suggest this again until your payments change. Not now closes this; the suggestion stays here for later." | Remove; button labels "Keep $180" / "Not now" say it | Explains buttons |
| 55 | Save conflict (SG4) | "Your data was changed somewhere else, such as another window. Reload to see the latest version." | "You changed your data in another window. Reload to see the latest." | "version" |
| 56 | Save blocked (ST1, ST3) | "Your latest change hasn’t been saved yet. Wait for it to save, or use Try again, then do this again." | "Saving your last change… Try this again in a moment." | Robotic; names a button |
| 57 | Restore / erase failed (B14, B24) | "The restore hasn’t been confirmed. {error}" · "Erasing hasn’t been confirmed. {error}" | "Couldn’t restore your backup. {reason}" · "Couldn’t erase your data. {reason}" | Robotic |
| 58 | Operation errors (OP9, OP11, OP12, OP20, OP23, OP24, OP27, OP28) | e.g. "Only outstanding transactions can be changed." · "This transaction was already recorded. Undo the recorded outcome first." · "Changes can only take effect today or later, so past occurrences keep their original expectations." | e.g. "This payment is already recorded. Undo it first to change it." · "Choose today or a later date." | Jargon ("outstanding", "occurrence", "recorded outcome") |
| 59 | Sample banner (A13, S8, S12) | "You’re exploring sample data. Your own data stays unchanged." (plus two more reassurances in Settings) | "Sample data" [Leave] — one reassurance, in the confirmation | Repetition |
| 60 | Calendar key items (D57) | "Filled chip: everything that day is done (received or paid)" | "Filled: received or paid" | "done" |
| 61 | Kind labels (C8, T3, A4) | "Liability" / "Liability payment" / "Liabilities" | Tag: "Loan" / "Card" / "Line of credit" (its type); section: "Liability payments" | Three forms |
| 62 | One-time naming (SS57, F43, O36 vs OS45) | "Add one-time bill" vs "One-time expenses"; "Remove" vs "Delete" | "Add one-time expense"; "Delete" everywhere | Inconsistent |
| 63 | Monthly phrasing (F15, RC6, SC8) | "Once a month" / "Monthly on the 18th" / "Every month" | "Monthly" (picker) · "Monthly on the 18th" (row) | Three phrasings |

**Not a problem, keep as is.** "Payment recorded"-style toasts already use past tense in many places (for example "Recorded Rent: $1,200.00 paid on Oct 23, 2026." can shorten to "Rent paid · $1,200 · Oct 23"). No apologies, exclamation marks, budgeting terms ("budget", "envelope", "left to spend") or artificial greetings appear in the default build. Sign-in copy is short and clear (L7 covers its raw error passthrough).

**Silent failure found while inventorying.** Entering sample data (`enterSample` in `src/state/mode.tsx`) can throw, and neither caller (`Onboarding.tsx` welcome, `Settings.tsx`) catches or shows the error. Fix in Phase B with a message: "Couldn’t open the sample data. Try again."

## 5. Dashboard, reports and visibility

These follow from H2, H3, M1–M3, M6 and M10:
- Home's structure: PRODUCT_EXPERIENCE.md §3.2;
- Reports: §4;
- conditional visibility: §5.

**Summary of the dashboard change:**
- **Stays on Home:**
  - the period summary (cash flow, with money in and out, and the lowest running total only when below $0);
  - one attention line;
  - Coming up, with one-tap recording;
  - Quick add.
- **Moves to Reports:**
  - the category breakdown;
  - totals by tag;
  - pay period by pay period;
  - expected vs actual.
- **Moves to Calendar:**
  - the month grid and key;
  - Week by week (as an agenda);
  - Day by day.
- **Becomes secondary:**
  - "See what happens if…" (scenarios), below the fold;
  - the review rhythm entry, folded into the attention line.
- **Appears only when relevant:**
  - the attention line;
  - the lowest running total line;
  - totals by tag;
  - categories with amounts;
  - weeks and days with activity or a negative running total.

## 6. Forecast start defect (H1)

### 6.1 Root cause

`buildForecast` (`src/domain/forecast.ts`) starts the running total at `nextExpectedPayday(occurrences, today, mainSourceId)`. That function only considers occurrences whose `sourceId === mainSourceId`.

`mainSourceId` comes from `mainPaycheckId` (`src/domain/types.ts`): the active income marked as main, **or else the first active income in `data.sources` order**, which is the order the income was entered. The Supabase schema keeps a `position` column for exactly this fallback.

So:
- with no main paycheck marked, entry order decides where the running total starts;
- with one marked, a different source's earlier payday is still ignored.

Income before that date is placed in the forecast and counted in period cash flow. But `dailyTimeline` gives days before `forecastStart` no running total, so that money never reaches the running total. Expenses after the earlier income but before the main payday are treated as "due before your next payday" and drop out of the running total too.

The existing test `forecast.test.ts › anchors on the main paycheck when there are several income schedules` asserts this behavior: a side job paid Oct 13 is left out of a running total that starts Oct 15.

### 6.2 Reproduction

**In the app** (audit screenshots `m04`, `m08`, `m09`, `m10`). Today is Oct 11, 2026, with:
- Restaurant paycheck: $900 every 2 weeks from Oct 27, entered first;
- Weekend job: $400 every 2 weeks from Oct 19;
- Rent: $1,000 monthly from Oct 22.

| | Today | Expected |
| --- | --- | --- |
| Running total starts | Oct 27 (anchor Oct 26) | Oct 19 (anchor Oct 18) |
| Oct 19 running total | — | +$400 |
| Oct 22 running total | — (Rent "due before your next payday") | −$600 |
| Timing gap | none shown | Oct 22 – 26, short $600 |
| Lowest running total shown | $900 on Oct 27 | −$600 on Oct 22 |

**As a test.** A failing test was written and run against the current code, then removed: production code and committed tests are unchanged. It builds the data above in both entry orders and asserts that:
- `forecastStart` is `2026-10-19` and `anchor` is `2026-10-18`;
- `tallyOn('2026-10-19')` is $400 and `tallyOn('2026-10-22')` is −$600;
- a timing gap exists;
- with the later paycheck explicitly set as main, the start is still Oct 19;
- pay periods still begin on the main paycheck's Oct 27.

Result: **2 failed, 1 passed.**
- The late-first order gives `start: 2026-10-27, anchor: 2026-10-26`.
- An explicit main paycheck gives `2026-10-27`.
- The pay-period assertion passed: pay periods already follow the main paycheck.

This test, inverted where it asserts current behavior, becomes the first regression test of Phase A1.

### 6.3 Recommended algorithm

```
candidates =
  (a) the main paycheck, by today's rule: its earliest outstanding occurrence
      (overdue included: a late paycheck hasn't arrived) or one received today
  (b) every other active recurring income: its earliest outstanding occurrence
      dated today or later, or one received today
excluded: canceled occurrences; income received before today; overdue
          occurrences of non-main income (decision D2); one-time income
          (decision D1); "possible" income once it exists (§6.3 of the spec)
forecastStart = earliest candidate date; anchor = the day before
```

- `mainSourceId` and `paycheckCycles` are unchanged: pay periods still start on main paydays, from the first one on or after the forecast start.
- Days between the start and the first main payday belong to no pay period. They still have running totals, and they show in month, week and custom views.
- Add `nextMainPayday` to `Forecast`, so screens that say "next payday" stop reading `forecastStart`.

### 6.4 Calculations and screens affected

| Area | Effect |
| --- | --- |
| `buildForecast`, `nextExpectedPayday` (`forecast.ts`) | Start chosen across income sources; returns `nextMainPayday` |
| `dailyTimeline`, `tallyOn`, `lowestPoint`, `negativeStretches`, `timingGapsAhead`, `explainTimingGaps` | No code change; results change whenever another income comes before the main payday (more days in the running total, possibly new gaps) |
| Overdue carry-forward | Items now carry to the earlier start |
| `paycheckCycles` | Unchanged; cycles start at main paydays on or after the start |
| `cadence.ts` (payday review) | Unchanged (follows the main paycheck) |
| `preview.ts` / `scenarios.ts` (`compareForecasts`, `anchor-changed`, `before-payday`) | Moving or adding non-main income can now move the start, so more previews report "can't compare". Wording must say "first payday" or "running total start". A later improvement: compare from the earlier of the two starts |
| `estimates.ts` (`previewEstimate`) | Window from the start; unchanged code |
| Dashboard hero, "Next expected payday" line, about sheet (`Dashboard.tsx`) | Must use `nextMainPayday` for payday wording and `anchor`/`forecastStart` for "running total starts" |
| Onboarding review hero and before-payday note (`Onboarding.tsx`) | Same split; the note becomes "before your first payday" |
| What if… / Scenario / Estimate messages | Copy mentions "next payday" where it means the running total's start |

### 6.5 Compatibility

- **Stored data:** no schema, migration or Supabase change.
- **People whose other income comes before the main payday** will see their running total start earlier. Lows and timing gaps may change. This is the fix, but the release note should say so.
- **People with one income, or whose main paycheck is earliest:** identical results. Regression tests pin this.
- **Historical actuals:** unchanged. Recorded items count on their actual dates. A non-main income received today now starts the running total today, matching the main-paycheck rule.

### 6.6 Regression tests for Phase A1

**Domain:**
- two recurring incomes, both entry orders → same start;
- explicit main paycheck later than another income → start is the earlier income, and pay periods follow main;
- different frequencies (weekly side job, monthly salary);
- other income received today → starts today;
- other income overdue → doesn't start the running total (D2), and is carried forward;
- canceled earlier occurrence → ignored;
- rescheduled earlier occurrence → its new date counts;
- one-time income before main payday → doesn't start it (D1);
- a source with no upcoming occurrence (ended, paused) → ignored;
- main paycheck overdue, another income later → main's overdue date still wins (unchanged);
- single-income plans → unchanged results;
- the hidden-gap case (§6.2) → gap found;
- `paycheckCycles` unchanged across all of these.

**Previews and scenarios:**
- moving a non-main income across the main payday reports the start change.

**UI:**
- the hero's "next payday" uses the main paycheck while the running total starts earlier;
- the onboarding review in the reproduction case shows the gap and no "before your next payday" note for Rent.

**Existing tests that must change:**
- `forecast.test.ts › anchors on the main paycheck when there are several income schedules`: its side job on Oct 13 must now start the running total. Expect anchor Oct 12; running total $300 on Oct 13 and $2,100 on Oct 15.

  The main-switch half of that test becomes "switching the main paycheck changes pay periods, not the start".

Any other test whose data has non-main income before the main payday will change. Candidates found by search:
- `engine-validation`;
- `saved-changes`;
- `spec-scenarios`;
- `preview`;
- `scenarios`;
- `sample`;
- `onboarding`;
- `occurrence-sheet`.

Each change is reviewed, not bulk-updated.

## 7. Missing income features

**Exists today:**
- recurring income at a fixed amount on a schedule (weekly, every 2 weeks, twice a month, monthly, custom);
- one-time income;
- recording what arrived, with a different amount or date;
- the main paycheck;
- hypothetical income in scenarios, including low, expected and high cases.

**Missing** (specified in PRODUCT_EXPERIENCE.md §6):
- income types (hourly, tipped, freelance, gig, irregular), as labels and tools;
- "possible" income that is shown but not counted;
- shift logging: hours, wage, cash tips, card tips;
- linking card tips and wages to the paycheck that pays them, to prevent double counting;
- freelance clients and jobs with Planned / Done / Paid, expected and actual payment dates, and earned-but-unpaid amounts;
- gig sessions, earnings waiting for payout, and payouts linked to sessions;
- effective hourly earnings and other earnings totals;
- an Earnings report;
- optional reminders to log shifts or confirm payments;
- history-based income estimates (FINANCIAL_ENGINE.md: "Income is not estimated").

## 8. Verification for this audit

No application code changed. Checks run on the documentation commit, October 18, 2026:

| Command | Result |
| --- | --- |
| `npm test` | 48 files, 592 tests passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm run e2e` | Passed |
| Forecast-start test (§6.2) | Run against the current code: 2 failed, 1 passed, as expected. Then removed; not committed |

**Not run:** `test:rules`, `test:db`, `test:supabase` and `e2e:supabase`. No storage, schema, rules or Supabase code changed, and the hosted work is paused.
