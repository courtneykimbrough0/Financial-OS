# Financial OS — product experience specification

This document says how Financial OS should look, read and behave for the people who use it. It sits next to:
- [AGENTS.md](AGENTS.md): the rules;
- [FINANCIAL_ENGINE.md](FINANCIAL_ENGINE.md): the math;
- [DESIGN.md](DESIGN.md): the visual system that is built today.

The evidence behind it (screenshots, findings ranked by severity, and the inventory of interface wording) is in [docs/PRODUCT-AUDIT.md](docs/PRODUCT-AUDIT.md). The order of work is in [BUILD_AND_TEST_ROADMAP.md](BUILD_AND_TEST_ROADMAP.md), Phases A–F.

Written October 2026 at commit `d00a919`, as a plan: none of the proposals below is built yet. Every requirement carries one of these labels, so nobody mistakes a proposal for what exists:

| Label | Meaning |
| --- | --- |
| **Confirmed** | The product owner decided it. Build to it. |
| **Implemented** | Exists in the app today (verify against the code; it drifts). |
| **Defect** | Existing behavior that is wrong, with a planned fix. |
| **Missing** | Agreed product scope that doesn't exist yet. |
| **Proposed** | This document's recommendation, pending the product owner's review. |
| **Deferred** | Deliberately left for later. |

---

## 1. Priorities (Confirmed, October 2026)

Financial OS is in a **product experience phase**. In order:

1. Financial correctness.
2. Clear and intuitive workflows.
3. Human, natural interface language.
4. A clean, useful dashboard.
5. Dedicated reports.
6. Better support for several kinds of income.
7. Mobile-first usability.

**Paused, as a sequencing decision.** This work is preserved, not abandoned:
- hosted Supabase setup and testing;
- Firebase retirement;
- removal of legacy offline synchronization;
- Vercel deployment;
- further infrastructure;
- roadmap Step 9 (virtual allocations and transfers).

The Supabase schema, adapter, accounts and security work stay as they are, and resume in Phase F.

**Two boundaries hold for the whole phase:**
- **A visual change never changes a calculation.** Every screen keeps reading the one forecast engine (`buildForecast` and the helpers in `forecast.ts` and `plan.ts`). A financial fix ships on its own, with before-and-after tests.
- **Onboarding stays short.** A standard user enters a paycheck and their main bills and immediately sees a forecast. Detailed earnings tracking is optional, offered when someone needs it, and never a setup step.

---

## 2. Voice and tone

### 2.1 Who we sound like

A calm, competent friend who is good with money. Plain words, short sentences, specific numbers. The app talks about the person's money, not about itself.

### 2.2 Rules (Proposed; adopt in Phase B)

1. **Lead with the person's situation, in their numbers.** "You may be short $180 before your next paycheck." Prefer that to "Your projected obligations may exceed anticipated income."
2. **Short.** One idea per sentence. Most sentences under 15 words. A screen's main explanation fits in two lines on a phone. Put deeper explanation behind "How this works".
3. **Say what something is.** "Your running total starts on Oct 19, your first payday." Prefer that to "Days before Oct 19 don't have a running total."
4. **Buttons are verbs.** For example: "Record payment", "Move date", "Add income", "See what happens if…". Use "Save" only on a form whose purpose is plain.
5. **Confirm briefly, in past tense.** For example: "Payment recorded.", "Rent moved to Oct 24.", "Paycheck added." No "successfully".
6. **Warnings are calm and specific.** Say what, when and how much, then one action. "Short $600 on Oct 31. See why". No alarm words, no exclamation marks.
7. **Errors say what happened and what to do.** "Couldn't save your change. Check your connection and try again." Apologize only when the app is at fault, and at most once.
8. **Use familiar money words:**
   - paycheck, payday, bill, payment, due, paid, received, card, loan;
   - the fixed product terms (AGENTS.md section F): Cash flow, Running total, Main paycheck, Expected / Overdue / Done, Money in / Money out, Lowest running total, Timing gap.
9. **Never use "debt" in the interface.** Say liability, loan, card, line of credit or payment, whichever fits.
10. **No budgeting language or features:** no "budget", "envelope", "spending limit" or "allowance". Financial OS looks forward at cash flow.
11. **No implementation terms on screen:** "anchor", "occurrence", "record" (as a noun), "forecast start", "set aside", "revision", "data changed since…", "superseded", "virtual".
12. **Say a reassurance once, where it matters.** "Nothing is saved until you choose Apply" belongs on the scenario screen once, not on every card.
13. **No fake warmth:** no greetings by name, no "Great job!", no motivational lines, no emoji.
14. **Respect the person.** Never imply they made a mistake by having a gap; a gap is timing, and the app helps them see it early.

### 2.3 Patterns

| Situation | Pattern | Example |
| --- | --- | --- |
| Timing gap | Short $X on date · action | "Short $600 on Oct 31. See why" |
| All clear | Stays above $0 through date | "You stay above $0 through Nov 4." |
| Overdue | N to update | "2 payments to update" |
| Empty day | (not shown; see section 5) | — |
| Empty list | What goes here + one action | "No subscriptions yet." [Add subscription] |
| Record | Verb + object | "Record payment" → "Payment recorded." |
| Undo | Undo + what | "Undo payment" |
| Destructive confirm | Question + consequence | "Delete Car repair? It comes off your forecast." [Delete] [Keep] |
| Projection | "expected", "may", "planned" | "Expected Oct 27" — never "you will have" |
| Explanation | Plain sentence + "How this works" | "Cash flow is money in minus money out for this period." |

The full list of current wording to change, with replacements, is in [docs/PRODUCT-AUDIT.md](docs/PRODUCT-AUDIT.md) §4.

---

## 3. Information architecture

### 3.1 Navigation (Proposed)

**Implemented today:**
- four tabs: Dashboard, Income, Expenses (Bills / Subscriptions / Savings) and Liabilities;
- Settings behind a gear.

Three of the four tabs are for setup and maintenance, which people do rarely. The things people do daily (look ahead, record a payment, check a day) all sit on one long dashboard.

**Proposed:**

| Tab | Purpose | Holds |
| --- | --- | --- |
| **Home** | "Am I okay, and what's next?" | Summary, attention items, coming up, quick actions |
| **Calendar** | "What happens when?" | Month grid, agenda list, week and day detail |
| **Reports** | "Where does it come from and go?" | Cash flow, Income, Payments (later: Earnings) |
| **Plan** | "What I've told the app to expect" | Income, Bills, Subscriptions, Liabilities, Savings, one section each |

- **Settings** stays behind the gear.
- **Quick add** is a "+" button in the top bar on every tab. It opens a short sheet:
  - Add income
  - Add a bill or payment
  - Record a payment (picks from items due soon)
  - Log a shift or job (shown only once earnings tracking is on; section 6)
- On wide screens the tabs move to a left rail (section 7.6).

"Plan" is the working name; "Setup" is the alternative (decision D5 in section 9).

### 3.2 Home (Proposed)

**Purpose.** In five seconds, someone can answer:
- What's coming in?
- What do I have to pay?
- How does it end up?
- Does anything need me?

**Default period:** *This pay period*, from today to the day before the next main payday. It falls back to *This month* when there are no pay periods. A compact period chip changes it:
- This pay period
- Next pay period
- This month
- Next month
- Custom…

The week view moves to Calendar.

**Mobile, above the fold (390 × 844), top to bottom:**

```
┌──────────────────────────────────────┐
│ Financial OS              [+]  [⚙]   │  top bar
├──────────────────────────────────────┤
│ ⚠ Short $600 on Oct 31 · See why  ›  │  attention line — only when relevant;
│   +1 more                            │  one line, highest priority first
├──────────────────────────────────────┤
│ This pay period ▾      Oct 22 – Nov 4│
│                                      │
│   −$600                              │  cash flow, signed, red + icon if < 0
│   Cash flow                          │
│                                      │
│   In    +$1,800   Out   −$2,400      │  two figures, no duplicates
│   Lowest  −$600 on Oct 31            │  only when below $0; else
│                                      │  "Stays above $0 through Nov 4 ✓"
├──────────────────────────────────────┤
│ Coming up                   See all ›│
│ ● Paycheck      Thu Oct 22  +$1,800  │  next 4–5 items, income and payments,
│ ● Phone  overdue  since Oct 5  −$60 ✓│  overdue first; ✓ records the payment
│ ● Rent          Fri Oct 23  −$1,200  │  in one tap (undo in the toast)
│ ● Car loan      Mon Oct 26    −$350  │
└──────────────────────────────────────┘
```

**Below the fold:**
1. **Next 14 days:** a compact strip of days with chips and the running total, sharing the Calendar's encoding. Tapping it opens Calendar at today.
2. **See what happens if…:** a secondary link to scenarios. It currently sits at the top with the same weight as primary content.
3. **Reports shortcuts:** two or three one-line links with a figure each, for example "Income this month: $3,450 received, $1,800 expected ›".
4. Review rhythm entry, only when a review is due (it also appears in the attention line).

**What moves:**

| Element today | Goes to | Why |
| --- | --- | --- |
| Date heading "Sun, Oct 11" | Removed (date in the period chip) | Takes a line, says nothing |
| Overdue banner, review button, review-due entry | Merged into the attention line | Three competing banners |
| "Explore a scenario" button | Below the fold as "See what happens if…" | Advanced; was the second thing on screen |
| Month / Week / Paycheck / Custom tabs | Period chip (Home); Week view in Calendar | Four equal pills dominate the top |
| Hero card | Stays, simplified | Lowest running total only when it matters; payday line moves to Coming up |
| Full month calendar + key | Calendar tab | Needs a key to read; pushes everything else down |
| Breakdown card | Reports › Cash flow | Repeats the hero's three numbers |
| Totals by tag | Reports › Cash flow | Detail |
| Week by week | Calendar › Agenda | Detail; empty weeks add noise |

**Desktop (≥ 1024 px).** Two columns in a 1,120 px container:
- **left (≈ 60%):** summary card, then Coming up (10 items);
- **right (≈ 40%):** attention list (all items, not one line), a month calendar mini-grid with chips, and Reports shortcuts.

The month calendar only appears on Home when there is room for it without scrolling the summary away.

**Rules:**
- Home reads only `buildForecast`, `periodKpis` / `periodPlan`, `lowestPoint`, `timingGapsAhead` / `explainTimingGaps`, `overdueEntries` / `reviewEntries` and `paycheckCycles`.
- "Coming up" is an ordering of forecast entries; it computes no money.

### 3.3 Calendar (Proposed)

- **Grid** (the current month calendar, kept). Chips, flags and the key work as today. Only days with entries, or with a running total below $0, open a sheet (section 5).
- **Agenda** (a toggle next to Grid). Days with activity, grouped by week:
  - each week header shows money in, money out and the running total at week end;
  - days without activity collapse (section 5).

  This replaces "Week by week" and "Day by day".
- **Week** (from today's Week view) is the agenda filtered to one week, with previous and next.
- **Day sheet.** Unchanged in content, but the empty version is never opened.

### 3.4 Plan (Proposed)

One screen with five sections: Income, Bills, Subscriptions, Liabilities, Savings. Use a segmented control on phones and a single page with headings on desktop.

**Each recurring item is a single tappable row:** name, schedule, next date, amount. Tapping it opens the item's detail sheet, which holds:
- upcoming and recent dates (today's "See dates");
- Edit (from a date);
- Turn off;
- Delete (when allowed).

The row loses its three equal buttons and its "On" badge. Only "Off" is marked, since active is the normal state.

**Next date shows the item's true status.** When an occurrence is overdue, the row says "Overdue since Oct 5", not "Next: Nov 5". Today the same bill appears on three different dates (audit finding H5).

### 3.5 Settings (Proposed)

Order by how often people need each thing:
1. Account
2. Backups (download, restore)
3. Review rhythm (one line showing the current choice; tap to change)
4. Sample data
5. Start over (danger zone, at the end)

Today the review rhythm's four large options fill the first screen.

---

## 4. Reports (Proposed; Missing today)

Reports give depth without crowding Home. Every figure comes from the forecast engine. A report never invents data: with nothing entered, it says what would fill it.

### 4.1 Common behavior

- **Placement:** a Reports tab, plus shortcuts from Home.
- **Tabs at the top:** Cash flow · Income · Payments. Earnings appears only when earnings data exists.
- **Period filter (chip):**
  - This pay period, Last pay period, Next pay period;
  - This month, Last month, Next month;
  - Custom.

  Defaults to the Home period.
- **Time states stay apart, always labeled:**
  - **Received / Paid:** recorded actuals, history.
  - **Expected:** forecast items still to come.
  - **Overdue:** date passed, nothing recorded.
  - **Earned, not paid yet:** Phase E only; work done whose money hasn't arrived. Never part of cash flow or the running total.

  Projected income is never called available or guaranteed.
- **Drill-down:** every row opens the list of entries behind it, and each entry opens the same item sheet as everywhere else.
- **Phones:** stacked list cards (label left, amount right), no wide tables. Charts only where they answer a question better than a list (section 7.2).
- **Empty states:** a category with nothing in the period is hidden, unless the report would otherwise be blank. Then show one line saying what would appear and how to add it.

### 4.2 First release: needs only the current engine

**Cash flow report.** Sources: `periodPlan`, `periodKpis`, `paycheckCycles`, `explainTimingGaps`, `dailyTimeline`.
- Money in, money out and cash flow for the period. Money out is broken down by kind (bills, subscriptions, liability payments, savings) and by tag.
- **Pay period by pay period** (for a month or custom range): each cycle's in, out, cash flow and lowest running total.
  - `paycheckCycles` only returns pay periods from the forecast start on.
  - Past pay periods (for "last pay period") need a small history variant that lists earlier main paydays from recorded paychecks. It reports cash flow only, since there is no running total before the start.
- **Timing gaps in the period:** dates, depth and recovery date, each opening the existing gap explanation and What if….
- Received/Paid and Expected shown separately within money in and money out.

**Income report.** Sources: forecast entries of kind income in the range, and `variance`.
- By source: received so far, still expected, overdue.
- **Expected vs actual** for received income: amount difference and days early or late, from `variance`. It compares each payment with its *original* prediction (`expected*`).
- Trend across the last six months or pay periods, as a list of amounts per period. Only recorded amounts count as history.

**Payments report.** Sources: forecast entries of the expense kinds, `variance`, `overdueEntries`.
- Coming up (expected), Paid, Overdue, each with a count and total.
- **Expected vs actual** for paid items: amount and timing differences, largest first.
- By item: recurring bills, subscriptions and liability payments with their payments in the period.

**New domain code.** Pure aggregation functions in `src/domain/reports.ts` that take a `Forecast` and a range and group its entries. They do arithmetic only on amounts the forecast already placed, and they get exact-cents tests. No component computes totals.

### 4.3 Later: needs income data from Phase E

**Earnings report.** Shown only when earnings data exists:
- hours worked;
- wages;
- cash tips and card tips;
- total earned per shift and per week;
- effective hourly earnings: (wages + tips) ÷ hours, over shifts that have hours;
- freelance jobs done, payments pending and payments received;
- gig earnings waiting for payout, and payouts received.

**Earned is never added to cash flow.** Cash flow counts money when it arrives: cash tips on the shift day, payroll on payday, payouts on the deposit day.

### 4.4 Empty states for reports

| Report | No data in period | No data at all |
| --- | --- | --- |
| Cash flow | "Nothing scheduled from Oct 1 to Oct 31." | "Add your income to see cash flow." [Add income] |
| Income | "No income in this period." | "Add a paycheck or other income." [Add income] |
| Payments | "No payments in this period." | "Add your bills to see payments here." [Add a bill] |
| Expected vs actual | (section hidden) | "Record payments as they happen to compare them with what you expected." |
| Earnings | (tab hidden) | (tab hidden) |

---

## 5. Conditional visibility (Proposed)

Visibility follows the data, through rules computed from forecast output. CSS never hides content alone. A hidden element is absent from the DOM, not just from view, so screen readers and the layout agree.

**One rule overrides the others: a negative running total is never hidden.** A day or week with no transactions, but a running total below $0, is financially significant and stays visible.

| Component | Appears when | Collapses or hides when | Must stay visible | Empty behavior | Accessibility |
| --- | --- | --- | --- | --- | --- |
| Calendar day cell (grid) | Always, for structure | — | Date number; below-$0 tint and icon; overdue flag; LOW flag | No chips; not a button unless it has entries or a below-$0 running total | Inactive days are plain cells with no button and no `aria-haspopup`; active days keep their full spoken summary |
| Day sheet | The day has entries, or a running total below $0 | Never opened for an empty, non-negative day | Running total when below $0, with one line: "Short $600 at the end of this day." | — | Focus returns to the cell |
| Agenda / week day rows | The day has entries, or its running total is below $0, or it's today | Runs of empty days fold into one line: "Oct 12 – 17 · nothing scheduled" (running total shown if it changes) | Negative days; today | A week with no rows shows one line under its header: "Nothing scheduled this week" | Folded runs are text, not buttons |
| Week row (agenda header / week list) | Always within the period | A week with no entries and a running total at or above $0 (or none) has no expand control and shows "Nothing scheduled" | Running total when below $0 | No $0.00 / $0.00 / Net $0.00 columns: show the amounts only when non-zero | No `aria-expanded` on rows that can't expand |
| Running total "—" (before the forecast start) | Only where a running total column exists | Days before the start show no running total cell at all; the agenda starts at the forecast start, with one line above: "Your running total starts Oct 19, your first payday." | — | — | — |
| Home summary card | Income exists | No recurring income: replaced by the setup card (below) | — | No $0.00 hero, empty calendar or empty breakdown | — |
| Setup card (no income) | No active recurring income | Hidden once income exists | — | "Add your income to see what's ahead." [Add income] — nothing else on Home except quick add | — |
| Lowest running total line | The period's lowest is below $0 | Otherwise replaced by "Stays above $0 through …" | Always shown when below $0 | — | Status has an icon and words, not just color |
| Attention line | Overdue items, a timing gap in the next 90 days, or a review due | Nothing needs attention | Highest-priority item; "+N more" opens all | — | `role="status"` for changes; it's a button |
| Coming up | Any outstanding entries in the next 30 days | No upcoming entries: "Nothing scheduled in the next 30 days." | Overdue items first | — | List semantics |
| Breakdown / report category rows | The category has a non-zero amount in the period | Hidden when zero | — | When every category is zero, one line for the report (section 4.4) | — |
| Totals by tag | At least one tagged entry in the period | Otherwise absent | — | — | — |
| Plan section empty | No items of that kind | — | — | One line plus an Add button; no empty card with a heading | — |
| One-time lists (Plan) | Items exist | Absent when none; "Add one-time" is in the section's menu | — | — | — |
| Onboarding review lists | Items of that kind exist | Kinds with none collapse into one line: "Not added: subscriptions, savings." with Add links | — | — | — |
| Pay period view / chip option | At least one complete pay period | Option disabled with its reason ("Needs two upcoming paydays") | — | — | Disabled options say why |
| Actions that would open nothing | Never shown | — | — | e.g. no "See dates" on an item with no dates in range | — |

**Where it lives.** A pure helper in the UI layer, `src/ui/visibility.ts`, takes `DayRow` / `WeekSummary` values and returns flags. It does no money math, only tests on fields the engine already computed. Component tests cover each row of the table, including the "negative but empty" case.

---

## 6. Income experience (Proposed; mostly Missing)

### 6.1 Principles (Confirmed)

- **Baseline first.** Anyone can start by entering an expected paycheck (amount, next date, how often), exactly as today. Shifts, hours, tips, clients and payouts are optional detail added later.
- **Several kinds at once.** Income types describe each income source, not the person. One person can have a fixed paycheck, cash tips and a freelance client.
- **Money counts when it arrives.** Cash flow and the running total count income on the day the money is received or expected to arrive, not when it's earned.
- **No double counting.** Each dollar enters cash flow once, through exactly one income event.
- **Only dependable income moves the running total.** Uncertain income is shown but not counted (AGENTS.md section D) until the person marks it expected or records it.

### 6.2 Income types

| Type | Minimum setup (all of them) | Optional detail |
| --- | --- | --- |
| Fixed recurring (salary, benefits) | Name, amount, next date, frequency | — |
| Hourly | Same baseline paycheck | Hourly rate; scheduled or worked hours, to estimate the paycheck |
| Tipped | Same baseline paycheck | Shifts: hours, wage, cash tips, card tips |
| Freelance | Nothing recurring needed; a one-time expected payment, or "possible" income | Clients, jobs, amount, work done, expected and actual payment dates |
| Gig | Baseline expected payouts, or nothing | Sessions: earnings, cash received, platform payouts |
| One-time / irregular | Amount and date (exists today) | Mark as expected or possible |

**Implemented today:** recurring income (fixed amounts on a schedule), one-time income, recorded actuals with amounts and dates that can differ from the expected ones, and the main paycheck. Everything else in this table is Missing.

### 6.3 Expected, possible, received (Proposed domain addition)

- **Expected** (counts): what every income is today. Its amount and date are dependable enough to plan around. It moves the running total.
- **Possible** (new; doesn't count): income that may come but isn't dependable, such as a freelance invoice with no confirmed date, or tips beyond the baseline.
  - It appears in Coming up, in the Income report under "Possible", and in scenarios as hypothetical income.
  - It is never in cash flow or the running total.
  - One tap marks it Expected (with a date) or records it as Received.
- **Received** (counts): a recorded actual. Unchanged from today.

The data model gains an optional `certainty: 'expected' | 'possible'` on income sources and one-time income records, defaulting to `expected`. Existing data keeps meaning exactly what it means now.

### 6.4 Tipped workers

**Minimum.** A baseline paycheck, entered like any paycheck. No schedule required.

**Optional earnings tracking**, turned on per income source ("Track shifts and tips"):

- **A shift** has a date, hours (optional), hourly wage (defaults from the source), cash tips and card tips.
- **Cash tips** are money in on the shift date. Logging a shift with cash tips creates one received income entry for that amount on that date, linked to the shift.
- **Card tips and wages** are paid through payroll, so they are *not* money in on the shift date. They add to "Earned, not paid yet" until the paycheck that covers them is recorded.
- **The paycheck stays one income event.** Its expected amount is the baseline the person entered.
  - **Option A (default):** keep the baseline.
  - **Option B (opt-in):** estimate it from logged wages and card tips in that pay period, shown as a *suggestion* the person approves. The existing estimate-suggestion pattern applies: never automatic.
- **Recording the paycheck closes the loop.**
  - Its actual amount is what arrived, already including card tips.
  - Shifts in its pay period are marked "paid in the Oct 27 paycheck".
  - Their card tips and wages are never added again.
  - The Earnings report shows earned versus paid for reconciliation, and flags a difference without changing anything.
- **Totals:** per shift (wage × hours + cash tips + card tips), per week, and effective hourly earnings (total ÷ hours, over shifts with hours).

**Daily workflow.**
1. After a shift, Quick add › Log a shift.
2. Enter hours (prefilled from the schedule if there is one), cash tips and card tips. It takes about 3 fields and one tap.
3. A toast confirms: "Shift logged. $62 cash tips added to today."

**Weekly workflow (optional).** Log the week's shifts in one sheet: a row per day, blank rows ignored.

### 6.5 Freelancers

- **Clients** are optional names grouping jobs. A client can be an income source with no schedule.
- **A job** has a description, amount, status and dates:
  - **status:** Planned → Done → Paid, with Partially paid deferred;
  - **expected payment date:** optional;
  - **actual receipt date and amount.**
- **Counting.**
  - A job with an expected payment date and certainty *expected* is an expected income event on that date. It counts.
  - Without a date, or marked *possible*, it is "Pending" and doesn't count.
  - Done-but-unpaid work is "Earned, not paid yet" in reports, outside cash flow.
- **Getting paid.** Recording the payment marks the job Paid, on the actual date and amount. The original expectation is kept, as with every item today.
- **Deferred:** partial payments (one job, several payments), invoices, overdue-payment chasing.

### 6.6 Gig workers

- **A session or day** has a date and earnings, with an optional platform and an optional amount of cash received immediately.
- **Cash received immediately** is money in that day, as one received income entry.
- **Platform earnings** accumulate as "Waiting for payout" (earned, not received).
- **A payout** is the one income event that counts: recorded when it arrives, or expected on the platform's payout schedule as a recurring expected income.
  - Recording a payout links the sessions it covers. Their earnings are never counted again.
- The baseline option needs no session tracking at all: a recurring expected payout ("about $400 every Monday").

### 6.7 Reminders (Deferred; optional when built)

- **In-app first.** A Home attention item the morning after a scheduled shift: "Log last night's shift?" [Log] [Skip]. A Monday item for weekly entry. "Did Acme pay?" on a job's expected payment date. "Payout arrived?" on a gig payout date.
- **Opt-in per income source; off by default.** Snoozing or skipping never piles up (the review-rhythm rule).
- Push notifications need service-worker push and, on iPhone, an installed PWA. They come later and are never claimed as delivered without verified delivery (roadmap Step 5).

### 6.8 Domain changes (Proposed)

The existing engine is extended, not rebuilt.

**1. Income certainty.** An optional `certainty` on income `RecurringSource` and `OccurrenceRecord` (default `expected`).
- `buildForecast` gives possible income `counts: false`, with a new `possible: true` marker, so it's displayed but not totaled.
- It is never an eligible forecast start (section 8).

**2. Income type.** An optional `incomeType` on income sources, for labels and for which optional tools appear. It has no effect on the math.

**3. Work entries.** A new collection: `workEntries: WorkEntry[]` on `AppData`.

```
WorkEntry {
  id, sourceId, kind: 'shift' | 'job' | 'session', date, description?,
  hours?, wageCents?, cashTipsCents?, cardTipsCents?, earningsCents?,
  status: 'planned' | 'done' | 'paid',
  receivedImmediatelyRecordId?,   // the one income record for cash tips / cash received
  paidByOccurrenceId?             // the paycheck, payout or job payment that covered it
}
```

- Work entries never enter `buildForecast` directly. Only their linked income records do, so the no-double-counting rule is structural.
- Pure operations in `operations.ts`: `logWork`, `editWork`, `linkPayout`, `recordJobPayment`, each with undo.

**4. Reports.** `src/domain/reports.ts`, plus `earnings.ts` for hours, tips, effective hourly, and earned versus paid.

### 6.9 Persistence and database changes (Proposed)

**What has to change.** New persisted fields (`certainty`, `incomeType`, `workEntries`) need:
- `migrate` and validation in `storage.ts`, and backups;
- Supabase columns and a new `work_entries` table, with ownership, row-level security, `load_plan` / `save_plan` mapping and database tests;
- review of a check constraint: the schema requires `amount > 0`, so an optional $0 amount isn't stored that way.

**The constraint.** Firestore rules can't be deployed while Firebase is legacy (AGENTS.md section C1). A signed-in Firebase account would have saves with new fields refused.

**So:** ship new income fields behind a flag, as `REVIEW_RHYTHM_IN_ACCOUNTS` does today: available with device storage and Supabase, hidden for Firebase accounts. Alternatively, schedule income expansion after the Supabase cutover (decision D8).

---

## 7. Visual direction (Proposed)

Start from the current system ([DESIGN.md](DESIGN.md)), which already has good bones: dark-first, accessible contrast, 44 px targets, tabular figures, status never by color alone. The problem is density and competition, not taste.

### 7.1 Hierarchy and density

- **One hero per screen.** On Home it is the period summary. Everything else is lists.
- **Fewer cards.** Group related rows in one surface with hairline dividers. Stop wrapping every section in its own 24 px-radius card. Section labels stay, sentence case (not uppercase) at 15/600.
- **Type scale:**

  | Role | Size / weight |
  | --- | --- |
  | Display | 36/700 |
  | Title | 22/650 |
  | Section | 15/600 |
  | Body | 16/400 |
  | Secondary | 14/400 |
  | Caption | 12/500, used sparingly |

- **Spacing.** Keep the 4-based scale. Use 16 px screen gutters on phones, 24 px between groups and 12 px inside rows.
- **Hint text.** At most one line per screen, and only where people need it. Move explanations into "How this works" sheets.

### 7.2 Color and financial status

Colors have a single meaning each:

| Color | Meaning |
| --- | --- |
| Green | Money in |
| Neutral (primary text) with a "−" | Money out |
| Red | Below $0 / timing gap / destructive |
| Amber | Overdue / needs an update |
| Indigo | Interactive accent and focus only |

Today money out is indigo, which competes with the accent, and the calendar uses filled and outlined indigo chips.

Status always pairs color with a sign, icon or word (unchanged rule).

**Charts** are allowed only where they answer a question faster than a list: the 14-day running-total strip, and income per pay period. No decorative charts, pies or gauges.

### 7.3 Buttons and actions

- **One primary action per screen or sheet.** Secondary actions are outlined; rare ones go in a "⋯" menu.
- Item rows are tappable as a whole. Inline buttons only for the single most common action: ✓ to record a due item.
- Destructive actions sit last, as text buttons, and always confirm with the consequence stated.

### 7.4 Forms

- One column, labels above fields, and the keyboard type that matches (decimal for amounts).
- Defaults filled in: today, the source's usual amount, the usual frequency.
- Optional fields are folded under "More options".
- Errors appear inline under the field, in words.

### 7.5 Sheets versus screens

- **Bottom sheets** for one short task or one item: record a payment, a day, an item, quick add, a gap explanation.
- **Full screens** for multi-step or long content: onboarding, scenarios, reports and their drill-downs, editing a schedule with history.
- **No sheet opens another sheet more than one level deep.** Back returns to the previous sheet (as today).

### 7.6 Responsive behavior

| Width | Layout |
| --- | --- |
| < 600 px | Bottom tabs, single column |
| 600–1023 px | Bottom tabs; content max 640 px; lists may show two columns of figures |
| ≥ 1024 px | Left navigation rail; content up to 1,120 px; Home and Reports use two columns (section 3.2); sheets become side panels on the right instead of centered dialogs, so the content stays visible |

Today the desktop layout is the phone column centered at 640 px.

### 7.7 Accessibility (unchanged requirements, restated)

- WCAG AA contrast.
- 44 px targets.
- Visible 3 px focus ring.
- Focus trapped in sheets and returned on close.
- Status never by color alone.
- Live regions for toasts and attention changes.
- `prefers-reduced-motion` respected.
- Interactive elements are buttons or links, never clickable `div`s.
- Empty, non-interactive cells aren't buttons (section 5).

### 7.8 Reusable components (to define in Phase D)

- **AppShell:** top bar with Quick add and Settings; bottom tabs or rail.
- **PeriodChip:** period picker.
- **SummaryCard:** hero.
- **AttentionLine:** with "+N more".
- **EntryRow:** avatar, title, status, amount and an optional ✓.
- **DayStrip:** 14-day running total.
- **ListGroup:** one surface with dividers.
- **Sheet / SidePanel.**
- **OverflowMenu.**
- **EmptyLine:** one line plus an action.
- **StatusBadge:** existing.
- **Toast with Undo.**

`src/ui/components/common.tsx` holds today's versions; Phase D replaces them one at a time.

### 7.9 Wireframe specifications

**Dashboard (Home):** section 3.2.

**Reports:**

```
Reports                           [This month ▾]
[ Cash flow | Income | Payments ]
┌ Cash flow ─────────────────────────────────┐
│ +$922            In +$3,450  Out −$2,528   │
│ Received/paid so far  +$1,522              │
│ Still expected        −$600                │
└────────────────────────────────────────────┘
Money out by kind
  Bills                 −$2,178   ›
  Liability payments      −$350   ›
Pay periods
  Oct 22 – Nov 4  −$600   lowest −$600 ⚠  ›
Timing gaps
  Oct 31 – Nov 4  short $600  back Nov 5  ›
```

**Calendar:**

```
Calendar                 [Grid | Agenda]   ‹ October 2026 ›
(Grid: today's grid; inactive days plain; key behind (i))
(Agenda:)
Week of Oct 18          +$1,800  −$1,260   ends $540
  Thu Oct 22  Paycheck +$1,800 · Phone −$60 (overdue)  $1,740
  Fri Oct 23  Rent −$1,200                              $540
Week of Oct 25          −$1,140            ends −$600 ⚠
  Mon Oct 26  Car loan −$350                            $190
  Thu Oct 29  Electric −$90                             $100
  Sat Oct 31  Car repair −$700                 −$600 ⚠ LOW
Oct 1 – 17  · before your running total starts (3 items) ›
```

**Income (Plan › Income):**

```
Plan    [Income | Bills | Subscriptions | Liabilities | Savings]
Paycheck                      +$1,800   Every 2 weeks · Thu Oct 22  ›
   Main paycheck
Weekend job                     +$400   Every 2 weeks · Mon Oct 19  ›
One-time
Tax refund (possible)           +$600   Expected Nov 15             ›
[+ Add income]
(Item sheet: next dates · recent payments with expected vs actual ·
 Edit from a date · Track shifts and tips ▸ · Turn off · Delete)
```

**Quick entry:**

```
Add ─────────────────────────────── ✕
  Add income
  Add a bill or payment
  Record a payment            (Phone overdue, Rent Fri, …)
  Log a shift                 (only with earnings tracking)
──
Record payment: [Phone ▾]  Amount [$60.00]  Date [Today ▾]
                                   [Record payment]
```

**Onboarding.** Four steps instead of seven. Use a full screen with a progress bar.

1. **Welcome:** one sentence plus Get started; "Try with sample data" and "Restore a backup" as links.
2. **Income:** "When do you get paid?" Add one or more paychecks. With two or more, choose the main paycheck inline (default: the one paid most often, so pay periods are shortest; decision D3). Other income types are offered as "Other kinds of income (tips, freelance, gig)…", which opens the same baseline form with a type label.
3. **Bills and payments:**
   - "What do you pay regularly?" One list for bills, subscriptions and liability payments, each added with a kind picker.
   - Savings appears as "Set money aside on a schedule (optional)".
4. **Your first look:** the Home summary for the first pay period, any timing gap, the payments due before the first payday (if any), and "Looks right" (primary) / "Change something".

---

## 8. Forecast start (Confirmed decision; Defect today)

**Decision.** The running total starts on the **earliest eligible upcoming income event**, not on whichever income was entered first or marked main. The anchor stays at $0 on the day before.

The **main paycheck** keeps organizing pay periods, the payday review rhythm and "each payday" scenario savings. It no longer decides where the running total starts.

**Today.** `buildForecast` starts the running total at the next payday of `mainPaycheckId`: the income marked main, else the first active income in entry order. Income from other sources before that day falls outside the running total. A real timing gap can stay hidden: the audit reproduces a hidden $600 gap.

Root cause, algorithm, impact and tests: [docs/PRODUCT-AUDIT.md](docs/PRODUCT-AUDIT.md) §6. Implementation is roadmap Phase A1.

---

## 9. Open decisions (recommended defaults)

| # | Decision | Recommended default |
| --- | --- | --- |
| D1 | Can one-time expected income start the running total? | **No.** Recurring income only, for now. One-time income still counts once it's inside the running total. Revisit when "possible" income exists. |
| D2 | Can overdue income from a non-main source start the running total? | **No.** Only upcoming (today or later) or received-today income from other sources. The main paycheck keeps its overdue rule. Overdue items are still carried to the start, as today. |
| D3 | Which income is the main paycheck when none is marked? | Keep today's fallback until Phase A1 lands. Then propose the most frequent income (ties → the earliest next payday), asked once with a clear choice. Entry order never decides anything financial. |
| D4 | Home's default period | **This pay period** when there are pay periods; else this month. |
| D5 | Tab names | **Home, Calendar, Reports, Plan** ("Setup" as the alternative for Plan). |
| D6 | Money-out color | **Neutral with a "−" sign**; indigo becomes the accent only. |
| D7 | Light theme | Dark stays the default in the first redesign. Light theme (following the system setting) is a later, separate phase. |
| D8 | Persisting new income data while Firebase is legacy | **A feature flag**: on for device storage and Supabase, off for Firebase accounts. Full availability at the Supabase cutover. |
| D9 | Estimating a tipped paycheck from shifts | **Off by default.** The baseline paycheck stays as entered; estimates are suggestions to approve. |
| D10 | Freelance payment without a date | **Possible, not counted**, until a date is set or it's received. |
| D11 | "Cash available now" (the open item in the roadmap) | Keep deferred, but design Home so an optional starting amount can slot into the summary card later. It's the one input that would let shortfalls before payday show. |
| D12 | Savings as an expense | Unchanged (Step 9 is paused). |

---

## 10. Deferred

- Push notifications.
- Partial freelance payments.
- Invoices.
- Platform integrations for gig work.
- Light theme.
- Scenario saving and applying.
- Imports.
- Allocations and transfers (Step 9).
- Any bank connection (never; AGENTS.md section E).
