# Product reduction audit (October 2026)

> **Phase R1 complete (October 2026).** The main paycheck concept and the Paycheck view have been removed as this audit recommended (findings #3, #4; questions Q2, R3; replacements §5.4). The analysis below is preserved as a historical record; references to "main paycheck" describe the state before R1.

An audit of the current app against the product philosophy in [AGENTS.md](../AGENTS.md) section A: the mission, the three objectives (Establish, Simplify, Strengthen), the information model (projections, recorded activity, the week view) and the design principles.

**Central question.** What complexity can we remove while preserving, or improving, people's ability to build financial resilience?

**Scope.**
- **Code:** commit `748d9f7`.
- **Evidence:**
  - the application code and tests;
  - the screenshots and string inventory from the first audit ([PRODUCT-AUDIT.md](PRODUCT-AUDIT.md), [COPY-INVENTORY.md](COPY-INVENTORY.md));
  - a re-check of the week view in the sample data.
- **No product code was changed.**

**Labels on every finding:**
- **Verified:** seen in the code, tests or app.
- **Inferred:** a reasoned conclusion that still needs validation, ideally with real users.
- **Unresolved:** not enough evidence.

**Relationship to the first audit.** Its screen findings, wording table and forecast-start analysis stand. Three of its proposals are superseded here; [PRODUCT_EXPERIENCE.md](../PRODUCT_EXPERIENCE.md) has been revised to match.
1. Home defaulting to the pay period, and the week view folded into a Calendar agenda. The week view now has a defined purpose of its own.
2. A Reports tab built around analysis. It is narrowed to recorded activity.
3. One-tap recording with undo toasts. Corrections go through ordinary editing instead.

---

## 1. Executive summary

**Alignment with the philosophy.**
- **The engine is aligned (Verified):**
  - one forecast engine;
  - integer cents;
  - expected, latest and actual values kept apart;
  - schedule changes from a date, with history kept;
  - honest treatment of income: only income the person entered counts.
- **The experience is only partly aligned.** It asks people to manage the app rather than their money.

**Largest sources of avoidable effort and complexity:**

1. **Three overlapping "what about this week?" features, none of which does the week view's job (Verified):**
   - the dashboard's Week tab;
   - the "Review this week" sheet, opened from the overdue banner or a button;
   - the optional review rhythm, with its own sheet and Mark review done / Skip.

   The Week tab for the current sample week (Oct 11–17) shows $0, a calendar row of empty days and seven empty "Day by day" rows with "—" running totals. It doesn't show the overdue phone bill (due Oct 5) or the paycheck four days after the week ends.

   So the screen named for the week can't answer "what has happened, what's next, what needs me", while two other sheets each answer part of it.
2. **The main paycheck is an artificial hierarchy with real costs (Verified).**
   - It decides where the running total starts. That is the forecast-start defect: earlier income from any other source is ignored, and a timing gap can be hidden.
   - It defines pay periods, the Paycheck view, setup's "First pay period" cash-flow bar, the payday review and "each payday" scenario savings.
   - With no main paycheck marked, it's simply the first income entered.

   This is exactly the "arbitrary income hierarchy" the philosophy rules out. The one thing it legitimately provides, a paycheck-to-paycheck lens, can come from the actual income dates (§5).
3. **The dashboard is overcrowded (Verified).** There are twelve stacked blocks, and the Breakdown repeats the summary. Its job overlaps with the week view and with a recorded-activity view that doesn't exist yet.
4. **Recorded activity has no home (Verified).** There is no view of what actually happened across items.
   - Recorded entries appear only:
     - inside day sheets;
     - in each item's "See dates" (last 60 days);
     - in estimate sheets;
     - in the period-review sheet, which appears only when a review rhythm is on.
   - So the second perspective of the information model is missing, while the analytical "Breakdown" and "By tag" sit on the dashboard.
5. **Two hypothetical tools (Verified).**
   - What if… changes one item, from a timing-gap explanation, and can *apply* the change.
   - Explore a scenario combines several changes from the dashboard, and can't apply them.

   Together they are about 920 lines of UI (`WhatIfSheet.tsx`, `ScenarioSheet.tsx`) over two domain modules (`preview.ts`, `scenarios.ts`) for one idea: "see what happens if…".
6. **Administrative rituals and undo states (Verified):**
   - review completion states;
   - a batch Undo callout in the review sheet;
   - "Mark done" applying to items that aren't due yet, which records them as paid today;
   - an overdue banner for every unrecorded past item.

   Some of this protects accuracy and stays. Some is ritual (§3).
7. **Language that explains the engine** (see the first audit, §4). For example: "“—” means the day is on or before Oct 21, when the running total begins."

**What earns its place.**
- The forecast engine, running totals and timing-gap explanations.
- "Change just this one" vs. a schedule change from a date.
- Recording an actual with a different amount or date.
- Turning items off and on.
- Backups, restore and start over.
- Sample data.
- Estimate suggestions, which save effort and are only applied when approved.
- The month calendar.

---

## 2. Feature inventory

**Objective column:** E = Establish, S = Simplify, St = Strengthen.

| # | Feature | Where | Objective | Classification | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Forecast engine, running total, timing gaps | `forecast.ts`, `plan.ts` | E, St | **Retain** | Verified | Core. Fix the forecast start (defect D1) |
| 2 | Timing-gap explanation sheet | `gaps.tsx`, `explainTimingGaps` | St | **Simplify** | Verified | Valuable; shorten the copy (first audit §4, rows 45–47) |
| 3 | Main paycheck (marked, or first income entered) | `types.ts mainPaycheckId`, `forms.tsx MainPaycheckPicker`, `operations.ts setMainPaycheck`, `sources.main_paycheck` | — | **Remove** (approval needed) | Verified | Artificial hierarchy; causes defect D1; every use has a replacement (§5.4) |
| 4 | Paycheck view (pay period by pay period) | `Dashboard.tsx` (`cycle` view), `paycheckCycles` | St (weak) | **Remove** (approval needed); keep "until next income" as a range option | Verified (exists); Inferred (value) | Distinct from the week view. Depends on #3; with several incomes, periods are arbitrary |
| 5 | Month view and month calendar | `Dashboard.tsx` | E, St | **Retain; Relocate** to the Forecast view | Verified | Main projection view. Simplify the chip encoding (first audit M10) |
| 6 | Week tab | `Dashboard.tsx` (`week` view) | St | **Simplify and Consolidate** into the week view (§5.2) | Verified | Fails its purpose today (summary item 1) |
| 7 | "Review this week" sheet (batch Mark done / Move) | `ReviewSheet.tsx`, `reviewEntries`, `recordAsExpected`, `rescheduleSelected` | S | **Consolidate** into the week view | Verified | Its "needs an update / later this week" grouping is the week view's core; keep batch actions there |
| 8 | Overdue banner | `Dashboard.tsx` | S | **Consolidate** into the week view's "Needs attention" (and one Home attention line) | Verified | |
| 9 | Review rhythm (Off / Weekly / On payday / Monthly) with Mark review done / Skip | `cadence.ts`, `rhythm.tsx`, `PeriodReviewSheet.tsx`, Settings, `review` field, `REVIEW_RHYTHM_IN_ACCOUNTS` | St (claimed) | **Remove the completion states and the payday rhythm; Consolidate** weekly into the week view; **Investigate** the monthly look-ahead (approval needed) | Verified (behavior); Inferred (value) | Completing or skipping changes nothing financial (`completeReview` and `skipReview` only stamp a date). It's a ritual. Also hidden for Firebase accounts by a flag |
| 10 | Batch Undo in the review sheet | `ReviewSheet.tsx`, `undoBatch` | — | **Remove** (approval needed) | Verified | An interface-action undo. Per-item corrections cover real mistakes; `undoBatch` refuses when items changed since, which adds a failure state |
| 11 | "Mark done" on items not yet due | `recordAsExpected` → `defaultActualDate` | — | **Simplify** | Verified | Selecting a "later this week" item records it as paid today. That confirms a future event. Keep batch recording for items due today or earlier; for later items, offer only "Move" or an explicit "Paid early" with a date |
| 12 | Per-item "Undo: not paid yet" | `OccurrenceSheet.tsx`, `restoreOccurrence` | E (accuracy) | **Retain** as a correction, renamed "Mark as not paid" | Verified | A genuine financial correction, not interface undo |
| 13 | Per-item "Restore" (canceled → expected) | `restoreOccurrence` | E | **Retain**, renamed "Unskip" / "Add back" | Verified | Correction |
| 14 | Correct a recorded actual ("Fix what was paid") | `correctActual` | E | **Retain**, renamed "Edit payment" | Verified | |
| 15 | Record actual (different amount or date) | `OccurrenceSheet.tsx`, `recordActual` | E | **Retain; Simplify** taps (first audit M6) | Verified | |
| 16 | "Change just this one" / "Change this and later ones" | `OccurrenceSheet.tsx`, `rescheduleOccurrence`, `changeSourceSchedule` | E, S | **Retain**, reworded | Verified | Real life |
| 17 | Schedule versions from an effective date | `changeSourceSchedule`, `redefineSource` | E | **Retain** | Verified | History-preserving. Hide the mechanics in wording |
| 18 | Turn off / turn back on (paused ranges) | `deactivateSource`, `reactivateSource` | E | **Retain** | Verified | |
| 19 | One-time income and expenses | `addOneTime`, Plan screens | E | **Retain; Simplify** (one list per kind instead of separate sections) | Verified | |
| 20 | Kinds: bill, subscription, liability, savings | `types.ts` | E | **Retain** | Verified | Savings-as-expense stays (Step 9 paused) |
| 21 | Required liability type (card / loan / line of credit) | `forms.tsx`, `LIABILITY_TYPE_LABEL` | E (weak) | **Investigate** | Verified (only used for labels and one What if… note) | An extra required choice with little function. Low priority |
| 22 | Optional tags and "By tag" totals | `normalizeTags`, `TagBreakdown` | St | **Retain; Relocate** totals to the activity view | Verified (already hidden when unused) | |
| 23 | Breakdown card (income, expenses by kind, cash flow) | `plan.tsx PeriodBreakdown`, Dashboard | St | **Relocate** to Forecast and Activity; **Remove** from Home | Verified | Repeats the summary |
| 24 | Cash flow summary card | `Dashboard.tsx CashFlowHero` | St | **Retain; Simplify** | Verified | Lowest running total only when below $0; payday line moves into the week view |
| 25 | Custom date range | `Dashboard.tsx` (`custom` view) | St (weak) | **Relocate** as a range filter in Forecast and Activity | Inferred | Two date fields shown permanently |
| 26 | Calendar key | `Dashboard.tsx CalendarKey` | — | **Simplify** (an encoding that reads without a key) | Verified | |
| 27 | What if… (one change, can apply) | `WhatIfSheet.tsx`, `preview.ts` | St | **Consolidate** with #28 | Verified | |
| 28 | Explore a scenario (several changes, can't apply) | `ScenarioSheet.tsx`, `scenarios.ts` | St | **Consolidate and Relocate** (secondary, from Forecast and from gap explanations) | Verified | Keep the "shortfall despite gain" rule. Low / expected / high income cases: **Investigate** (Unresolved value) |
| 29 | Estimate suggestions | `estimates.ts`, `EstimateSheet.tsx` | S, St | **Retain; Simplify** the sheet | Verified | Saves effort and only changes values when approved |
| 30 | Guided setup (7 steps) | `Onboarding.tsx` | E | **Simplify** (income; bills and payments; first look) | Verified | Its "First pay period" bar depends on #3 |
| 31 | Setup review page | `Onboarding.tsx Review` | E | **Simplify** | Verified | Its before-payday note is wrong under D1 |
| 32 | Sample data | `mode.tsx`, `sample.ts` | E | **Retain** (shrink the banner) | Verified | |
| 33 | Backups, restore, start over | `backup.ts`, `backup.tsx` | E (safety) | **Retain** | Verified | Data-loss protection |
| 34 | Save status, conflict, retry | `store.tsx`, `backup.tsx SaveStatusBar` | E (safety) | **Retain** (wording only) | Verified | |
| 35 | Update banner | `App.tsx`, `update.ts` | E (safety) | **Retain** | Verified | |
| 36 | Settings screen | `Settings.tsx` | — | **Simplify** (shrinks once #9 goes) | Verified | |
| 37 | Navigation (Dashboard / Income / Expenses / Liabilities) | `App.tsx NAV` | — | **Simplify** (§5.1) | Verified | Three of four tabs are setup screens |
| 38 | Item cards with See dates / Edit / Turn off and an "On" badge | `SourcesScreen.tsx SourceCard` | E | **Simplify** (a row plus a detail sheet) | Verified | |
| 39 | Account sign-in (Firebase, legacy) and Supabase account screens (development) | `SignIn.tsx`, `src/ui/supabase/` | E | **Retain** (paused infrastructure) | Verified | Out of scope until Phase F |
| 40 | Recorded-activity view | — | E, St | **Missing**, within existing capabilities (§5.3) | Verified (absent) | Uses existing records and `variance`; no new data |

---

## 3. Ranked recommendations

**Ranking criteria, in order:**
1. reduction in effort;
2. decision clarity;
3. support for habits;
4. correctness;
5. implementation effort;
6. risk.

| Rank | Recommendation | Type | Why first | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| R1 | **Fix the forecast start (D1)**: the earliest eligible upcoming income from any source | Bug fix | Correctness: hidden timing gaps. Prerequisite for R3 | Medium | Low; single-income plans unchanged, pinned by tests |
| R2 | **Make the week view do its job** (§5.2), absorbing the Week tab, the "Review this week" sheet and the overdue banner | Consolidate | Removes two overlapping sheets. Answers "what now?" in one place. The weekly habit becomes simply opening the app | Medium–high | Medium; e2e flows move |
| R3 | **Remove the main paycheck** and the Paycheck view, after R1 | Remove | Removes a setup decision, a hierarchy and a hidden-gap source. Replacements are listed in §5.4 | Medium | Medium; a stored field and a Supabase column stay readable and ignored until the cutover |
| R4 | **Remove review completion states and the payday rhythm**; weekly is covered by R2 | Remove | Removes a ritual and a Settings section, and the `REVIEW_RHYTHM_IN_ACCOUNTS` branching | Low | Low; the stored `review` field becomes ignored |
| R5 | **Limit batch "record as expected" to items due today or earlier**; remove batch Undo | Simplify / Remove | Honest forecasting; removes an undo state | Low | Low |
| R6 | **Simplify Home** to a short summary plus the week's attention items (§5.1); move the Breakdown, tags and custom range | Relocate / Remove | Decisions over data | Medium | Low |
| R7 | **Add a recorded-activity view** from existing records (§5.3) | New, within existing capability | Completes the information model. Lets people learn from outcomes (Strengthen) | Medium | Low (read-only) |
| R8 | **Rewrite wording** (first audit §4, adjusted for R2–R5) | Simplify | Human language; removes engine talk | Low–medium | Low |
| R9 | **Conditional visibility** (PRODUCT_EXPERIENCE.md §5) | Simplify | Clarity | Low–medium | Low |
| R10 | **Merge What if… and scenarios** into one "See what happens if…" | Consolidate | One concept instead of two | Medium–high | Medium |
| R11 | **Shorten setup** to three steps | Simplify | Establish, faster | Medium | Low |
| R12 | **Plan screens:** item rows plus a detail sheet; one-time items inside each kind | Simplify | Less scrolling and fewer buttons | Medium | Low |
| R13 | **Investigate:** the required liability type, the monthly look-ahead, low / expected / high income cases | Investigate | Unresolved value | — | — |

---

## 4. Verified defects

Implementation defects only; design recommendations are in §3.

| ID | Defect | Severity | Components | Reproduction and evidence |
| --- | --- | --- | --- | --- |
| D1 | **Fixed in Phase A1.** The running total started at the main paycheck's next payday. Earlier income from other sources is excluded, and a timing gap can be hidden | **High** (financial correctness) | `forecast.ts` (`nextExpectedPayday`, `buildForecast`), `types.ts` (`mainPaycheckId`) | Paycheck $900 every 2 weeks from Oct 27, entered first; weekend job $400 every 2 weeks from Oct 19; rent $1,000 on Oct 22; today Oct 11. The app starts the running total on Oct 27 and says rent is "due before your next payday". Correct: start Oct 19; −$600 on Oct 22. A failing test is recorded in PRODUCT-AUDIT.md §6.2 (2 failed, 1 passed against the current code). The existing test `forecast.test.ts › anchors on the main paycheck…` asserts the defective behavior |
| D2 | **Fixed in Phase A1.** Setup review gave wrong guidance under D1 ("make sure the money you have now covers" rent, when income arrives first) | High (follows D1) | `Onboarding.tsx` `Review` | Same data; screenshot `m08` |
| D3 | "Delete this one-time bill" for an item added as a one-time *expense*: the raw kind id is shown | Low | `OccurrenceSheet.tsx` (`Delete this one-time {o.kind}`) | Code; COPY-INVENTORY OS27 |
| D4 | Broken sentence "Your on payday review is ready" (label pasted into a sentence) | Low (moot if R4) | `Dashboard.tsx` rhythm entry, `CADENCE_LABEL` | Code; COPY-INVENTORY D12 |
| D5 | Entering sample data can fail silently: `enterSample` throws, and neither caller handles it | Low | `mode.tsx`; callers in `Onboarding.tsx` and `Settings.tsx` | Code; COPY-INVENTORY "other findings" |

**Concerns not classed as defects:**
- **The week view omits overdue items from earlier weeks and income just after the week (Verified).** This is a design gap against the week view's purpose, not a calculation error. Addressed by R2.
- **Batch "Mark done" records not-yet-due items as paid today (Verified).** It behaves as designed and documented (Step 3), but conflicts with honest forecasting. Addressed by R5.
- **One bill shown on three dates (Verified, first audit H5).** Presentation; addressed by R2 and R12.
- **Shortfalls before the first income can't be shown, since cash on hand is unknown (Verified, open item).** A known product limit, not a defect; see decision Q6.

---

## 5. Proposed simplified experience

Built from existing capabilities. Two pieces are new but use only data that exists today: the recorded-activity view and the week view's grouping.

### 5.1 Structure

Four tabs, one per perspective plus setup:

| Tab | Perspective | Holds |
| --- | --- | --- |
| **This week** (the opening screen) | What to do now | §5.2 |
| **Forecast** | What's possible | Month calendar, running total and timing gaps ahead, "See what happens if…", any date range |
| **Activity** | What happened | §5.3 |
| **Plan** | Inputs | Income, bills, subscriptions, liability payments, savings; one-time items within each |

Settings sits behind the gear. "+ Add" is in the top bar.

**There is no separate dashboard** in this proposal. The week view opens the app, topped by a two-line forecast summary: the next timing gap (or "You stay above $0 through Jan 9"), and cash flow for the next four weeks. Two screens that answer "how am I doing?" would duplicate each other (summary item 3).

This is decision Q1. The alternative is a short Home plus a separate week view.

### 5.2 The week view

**Purpose:** what has happened, what's next, what needs attention, what may need a decision. Current week by default, with previous and next.

**Top to bottom, every section shown only when it has content:**

1. **Forecast line.** One or two lines:
   - the running total at the end of the week;
   - the next timing gap within the forecast's warning window, as "Short $600 on Oct 31 · See why", which opens the existing explanation.
2. **Needs attention.** Overdue items from *any* earlier date, and items due today. Each has Record and Move; several can be selected and recorded or moved together (the existing batch operations, R5 applies).
3. **Coming up this week.** Expected items by day, only days that have items. Each opens its item sheet.
4. **Happened this week.** Recorded items on their actual dates, with any difference from what was expected ("$128, expected $90"), from `variance`.
5. **Next week's first items.** The next income and any payment due in the first days of next week, so a Saturday view still shows Monday's rent.

**Removed from today's Week tab:**
- the week calendar row;
- the Breakdown and tag totals;
- seven fixed "Day by day" rows with "—";
- the footnote.

**Past weeks** show what happened and what was missed, which is the learning loop. **Future weeks** show projections only and never ask for confirmation.

**Engine use.** All of it comes from `buildForecast`, `entriesInRange`, `overdueEntries`, `reviewEntries`, `variance` and `explainTimingGaps`. No new math: a grouping helper in `forecast.ts` (or a pure UI helper) with tests.

### 5.3 Activity (recorded history)

**What it shows:**
- A list of recorded income and payments by actual date, newest first, filterable by range and kind.
- Each item shows its expected amount and date when they differ.
- A month summary at the top: received, paid, and cash flow from recorded items.
- "By kind" and "By tag" totals: today's Breakdown and tag totals, applied to what actually happened.

**What it leaves out:**
- no forecast figures;
- no analytics beyond these totals.

The Earnings report (first audit, PRODUCT_EXPERIENCE.md §4.3) is deferred until income tracking exists.

Projections and recorded activity stay visually distinct everywhere: expected is outlined and labeled "Expected"; recorded is filled and labeled "Paid" or "Received".

### 5.4 Removing the main paycheck: what replaces each use

| Use today | Replacement |
| --- | --- |
| Running-total start | The earliest eligible upcoming income (R1) |
| Paycheck view / pay periods | Removed. Forecast offers "Until next income" as a range option, from the next income date, whatever the source |
| Setup's "First pay period" cash-flow bar and review breakdown | "Next 4 weeks" (or until the second upcoming income) |
| Payday review rhythm | Removed (R4) |
| "Each payday" savings in scenarios | "On each payday of [chosen income]" |
| Picker, badge, `setMainPaycheck` | Removed. Stored `mainPaycheck` / `main_paycheck` stays readable and is ignored; the schema change waits for the Supabase cutover |

### 5.5 What stays exactly as it is

- forecast rules (apart from R1);
- history preservation;
- backups and restore;
- estimates (approval only);
- turn off and on;
- schedule changes from a date.

---

## 6. Implementation sequence

Each step is a separately authorized task with tests (AGENTS.md sections G–I). Calculation changes ship alone.

**Bug fixes:**
1. **D1 + D2**: forecast start (roadmap Phase A1).
2. **D3, D5**: small fixes, which can ride with the first wording task.

**Removals (after 1):**

3. **Main paycheck and Paycheck view (R3):** replacements per §5.4; stored fields ignored, not dropped.
4. **Review completion states, payday rhythm, batch Undo (R4, R5):** removes `REVIEW_RHYTHM_IN_ACCOUNTS` branching. Batch recording is limited to due items.

**Simplifications and consolidation:**

5. **Week view (R2):** absorbs the Week tab, the review sheet and the overdue banner.
6. **Structure and Home (R6), navigation (§5.1), conditional visibility (R9).**
7. **Wording (R8):** adjusted to the removed features, so nothing is rewritten twice.
8. **Plan screens (R12), setup (R11).**
9. **What if… + scenarios merge (R10).**

**New functionality within existing data:**

10. **Activity view (R7).**

**Visual redesign:** PRODUCT_EXPERIENCE.md §7, applied screen by screen after 5–10.

**Possible later functionality, needing new data and its own approval:**
- income types;
- "possible" income;
- shifts, jobs and payouts (PRODUCT_EXPERIENCE.md §6);
- reminders.

**Infrastructure (Phase F):** unchanged, paused.

---

## 7. Decisions requiring approval

Only decisions that change what people can do.

| # | Decision | Recommendation | Evidence |
| --- | --- | --- | --- |
| Q1 | Does the week view open the app, with no separate dashboard? | **Yes**, with a two-line forecast summary on top | Summary items 1 and 3; §5.1 |
| Q2 | Remove the main paycheck and the Paycheck view? | **Yes**, after the forecast-start fix; keep "Until next income" as a range | Verified uses and replacements, §5.4. *Counterpoint (Inferred):* people who think paycheck-to-paycheck may miss the period framing. "Until next income" keeps that framing without a stored hierarchy |
| Q3 | Remove review completion states (Mark review done / Skip) and the payday rhythm; fold weekly into the week view? | **Yes.** Keep the monthly look-ahead only if Q3a is yes | Completion changes nothing financial (`completeReview` and `skipReview` only stamp a date) |
| Q3a | Keep a quiet "month ahead" prompt at the start of each month? | **Investigate** with users; default off | Unresolved |
| Q4 | Remove batch Undo, and limit batch recording to items due today or earlier? | **Yes.** Per-item corrections remain | §2 rows 10–12 |
| Q5 | Merge What if… and scenarios, keeping Apply for single changes? | **Yes** | §2 rows 27–28 |
| Q6 | "Cash available now" (optional starting amount) | **Keep deferred.** It's the only way to show shortfalls before the first income, but it adds an input people must keep current, which goes against "actions over management" | Open item in the roadmap |
| Q7 | Overdue items: keep requiring each past item to be recorded, or let some items (for example autopay bills) count as paid as expected after their date? | **Keep the current rule** (AGENTS.md section D: nothing is marked actual merely because it was expected). Make recording fast in the week view. Revisit only with user evidence that confirmations are the main burden | Established rule. The largest recurring effort source (Inferred) |

**Established decisions not reopened:**
- savings as an expense;
- integer cents and date-only values;
- one engine;
- no bank connections;
- the paused infrastructure order;
- estimates never applied without approval.
