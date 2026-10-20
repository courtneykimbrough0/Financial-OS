# C3 Integration Review — Financial OS

**Date:** October 19, 2026
**Reviewer session:** `session_011XiT3ZNfhArPGPG7oTaRKU`
**Merge SHA:** `abc57d69df264557d42cd7534aac8a1be2637ba5`
**Branch merged:** `ccr-12ec4965-6tzwgr` into `main`
**PR:** #11 — C3: Activity view with recorded history and month summary

---

## 1. Merge verification (Phase 0-1)

| Check | Result |
|-------|--------|
| PR #11 CI (5 jobs) | All pass |
| Typecheck, lint, unit tests, build | Pass |
| Database tests (PostgreSQL) | Pass |
| Supabase integration and browser tests | Pass |
| Browser smoke test | Pass |
| Firestore rules (emulator) | Pass |
| Merge conflicts | None |
| Post-merge `npx tsc --noEmit` | Clean |
| Post-merge `npx vitest run` | 718 tests passing (56 files) |
| Post-merge `VITE_ACCOUNTS=off npx vite build` | Clean |

PR #11 was merged at 2026-10-19T18:19:38Z. Main is at `abc57d6`.

---

## 2. Screens inspected (Phase 2)

Eight screens captured at 390px (mobile) and 1280px (desktop):

| Screen | Route | Mobile (390px) | Desktop (1280px) |
|--------|-------|----------------|-------------------|
| Home | `#/home` | OK | OK |
| Forecast | `#/forecast` | OK | OK |
| Activity | `#/activity` | OK | OK |
| Plan / Income | `#/plan/income` | OK | OK |
| Plan / Expenses | `#/plan/expenses` | OK | OK |
| Plan / Liabilities | `#/plan/liabilities` | OK | OK |
| Plan / Reserves | `#/plan/reserves` | OK | OK |
| Settings | `#/settings` | OK | OK |

### Mobile evidence

- **No horizontal overflow at 390px** on any screen.
- Navigation: bottom bar renders four items (Home, Forecast, Activity, Plan) legibly at phone width.
- Activity summary KPIs stack correctly in the card layout.
- Kind filter chips wrap as needed without overflow.
- Plan sub-navigation (Income, Expenses, Liabilities, Reserves) fits within 390px.

---

## 3. Structural verification

```
Nav: ["Home", "Forecast", "Activity", "Plan"]
Home h2: ["Oct 11 – 17", "COMING UP", "HAPPENED THIS WEEK"]
Home Progress: Cash flow so far in October
  Recorded | +$3,200.00
  Nothing was recorded on Sep 1 – 16 to compare.
  Projected October ends at +$6,165.00
Forecast Hero: Cash flow | +$6,165.00 | +$6,700.00 in · −$535.00 out
  Lowest running total $2,665.00 · Oct 25
  Running total stays above $0 this period
  Next expected payday is today · Oct 16
Activity Headings: ["Activity", "October 2026", "BY KIND", "RECORDED"]
Activity Content:
  Received +$3,200.00 | Paid $0.00 | Cash flow +$3,200.00
  BY KIND: Received +$3,200.00 | Paid $0.00 | Cash flow +$3,200.00
  RECORDED: Paycheck · Money in · Received · Expected $3,500.00 on Oct 15 · +$3,200.00
Plan Subnav: ["Income", "Expenses", "Liabilities", "Reserves"]
Settings Headings: ["Settings", "Accounts", "Your data", "Sample data"]
Settings Buttons: ["Add account", "Download backup", "Restore from backup",
                    "Start over", "Explore with sample data"]
```

---

## 4. User journey findings (Phase 3)

Ten core journeys examined through structural analysis, screenshot inspection, and partial Playwright interaction:

| # | Journey | Finding |
|---|---------|---------|
| 1 | **Add income** | Works via onboarding and Plan. Dialog fields: description, amount, next date, frequency. Item appears in Plan and generates forecast entries. |
| 2 | **Add obligation** | Works via onboarding and Plan (Expenses, Liabilities). Bill and liability dialogs each have appropriate fields and save correctly. |
| 3 | **Record received** | Home "Needs attention" shows overdue items. Tap opens OccurrenceSheet with "Mark received" pre-filling expected amount and date. Save updates the record. |
| 4 | **Record paid** | Same flow as Record received, through OccurrenceSheet with "Record payment" action. Amount is editable for actual-vs-expected tracking. |
| 5 | **Review activity** | Activity tab shows recorded entries sorted newest first, with month navigation, summary KPIs, by-kind breakdown, tag breakdown, kind filter chips, and variance sub-lines. |
| 6 | **Examine shortage** | Forecast hero shows lowest running total with date. "Stays above $0" or shortage amount visible. Gap explanations accessible through Forecast. |
| 7 | **Change item** | OccurrenceSheet opens from Activity rows and Home rows. Edit actions available for amount, date, and corrections. |
| 8 | **View transfer** | Transfers accessible through Settings (accounts section) and Home (when due). Transfer recording through OccurrenceSheet. |
| 9 | **Review reserves** | Plan/Reserves shows Strategic Reserves with allocations. Activity records reserve releases with "Saved" label in by-kind breakdown. |
| 10 | **Return home** | Single tap via bottom nav from any screen. Bottom nav is persistent and accessible on all routes except onboarding. |

### Journey observations

- **All 10 journeys are reachable** through the current navigation.
- **Recording flow is consistent**: OccurrenceSheet is the single interaction point for recording, correcting, and editing all item types.
- **Activity integrates naturally**: recorded entries that were previously only visible in the Forecast week list or Home "Happened this week" now have a dedicated, filterable history.

---

## 5. Simplification findings (Phase 4)

| # | Finding | Classification | Detail |
|---|---------|---------------|--------|
| S1 | **Activity KPI summary vs. By Kind duplication** | **Investigate** | When only one kind of activity is recorded (e.g., income only), the RecordedSummary (Received/Paid/Cash flow) and the PeriodBreakdown "By kind" section show identical numbers. With multiple kinds, By Kind adds the sub-category detail (Bills, Subscriptions, etc.) that the summary doesn't. Investigate whether to hide By Kind when only one kind has non-zero values, or accept the repetition as orientation for months with mixed activity. |
| S2 | **"Paid $0.00" in summary** | **Simplify** | When no payments are recorded, the summary shows "Paid $0.00". Consider conditional visibility: show only non-zero KPIs, matching the rule from PRODUCT_EXPERIENCE.md section 5 (breakdown rows hidden when zero). The counter-argument: all three KPIs together form a complete picture, even at zero. |
| S3 | **Kind filter chips hidden with one kind** | **Keep** | The `KindFilterChips` component already hides itself when only one kind is visible (`if (visible.length <= 1) return null`). This is correct behavior. |
| S4 | **Bottom nav + top nav redundancy** | **Keep** | Both render from the same `NAV` array. The top nav serves desktop widths; the bottom nav serves mobile. CSS controls visibility. Standard responsive pattern; no action needed. |
| S5 | **Variance sub-line format** | **Keep** | `Expected $3,500.00 on Oct 15` is clear, specific, and matches the voice rules (section 2.2 rule 1: lead with the person's situation, in their numbers). |
| S6 | **Activity empty states** | **Keep** | Two variants: "Payments you record show up here." (first time) and "Nothing recorded from Oct 1 to Oct 31." (specific month). Both match PRODUCT_EXPERIENCE.md section 4.3. |
| S7 | **Plan sub-navigation with only setup items** | **Investigate** | Plan shows four tabs (Income, Expenses, Liabilities, Reserves) even when some categories are empty. PRODUCT_EXPERIENCE.md section 5 says plan sections show "One line plus an Add button" when empty. Current behavior shows the tab with an empty state and add button, which is acceptable, but investigate whether collapsing to fewer tabs helps in early-use when only income and bills exist. |

---

## 6. Financial integrity (Phase 5)

| Check | Result |
|-------|--------|
| **Navigation changes no records** | Verified. Navigating through all 8 screens (Home, Forecast, Activity, Plan x4, Settings) and back to Home does not alter any financial data. Progress card shows identical values before and after navigation. |
| **Recorded vs. expected distinguishable** | Verified. Activity uses "Received"/"Paid"/"Saved" for recorded items; Forecast uses "Income"/"Spending"/"Set aside in reserves" for expected items. Labels are distinct and consistent with PRODUCT_EXPERIENCE.md section 4.1. |
| **Engine is authoritative** | Verified. Activity screen calls `buildForecast(data, today, { through: end })` then `activityView(forecast, start, end, kindFilter)`. All money values come from the forecast engine; no component computes totals. The `activityView` domain function uses exact-cents aggregation with 12 domain tests covering precision. |
| **Amounts are integer cents** | Verified in domain layer. `activityView` sums `entry.amountCents` (integer cents). No floating-point money anywhere in the Activity path. |
| **Visual change did not change calculation** | Verified. C3 added `activity.ts` (pure read-only aggregation over existing forecast data) and `Activity.tsx` (rendering). No existing domain, forecast, or plan code was modified. The only change to existing UI code was adding a `recorded` prop to `PeriodBreakdown` for label swapping, which is cosmetic. |

---

## 7. Roadmap alignment

### Completed through this merge

| Phase | Status |
|-------|--------|
| A1 (forecast start) | Complete |
| A2 (defects D3, D5) | Complete |
| R1 (primary-paycheck removal) | Complete |
| R2 (review states, rhythm, batch Undo) | Complete |
| C1 (week view) | Complete |
| C2 (navigation) | Complete |
| C3 (Activity view) | Complete |
| H1–H4 (Home, interface simplification) | Complete |

### Next in roadmap order

```
A1 -> A2 -> R1 -> R2 -> C1 -> C2 -> C3 -> B1 -> C4 -> C5 -> C6 -> D -> E -> F
                                             ^^
                                          you are here
```

| Phase | Description | Dependencies |
|-------|-------------|-------------|
| **B1** (next) | Wording — apply voice and tone rules from PRODUCT_EXPERIENCE.md section 2 | C3 complete |
| **C4** | Conditional visibility — hide sections with no content per PRODUCT_EXPERIENCE.md section 5 | B1 |
| **C5** | Plan screens — tappable rows, detail sheets, status display | C4 |
| **C6** | One "See what happens if..." — merge What if and scenarios | C5 |
| **D** | Visual redesign | C6 |
| **E** | Income expansion (needs separate approval and decision D8) | D |
| **F** | Hosted infrastructure (Supabase, Firebase cutover, Vercel) | Deferred |

---

## 8. Verified defects

No new defects found during this review. The C3 implementation matches PRODUCT_EXPERIENCE.md section 4 as implemented.

One pre-existing limitation noted (not a defect):
- **Dialog accessible name from Plan**: when opening "Add recurring income" from the Plan screen, the dialog may have a different accessible name than when opened from onboarding. This is a pre-existing behavior in the item sheet infrastructure, not introduced by C3. It does not affect functionality.

---

## 9. Recommended next phase

**B1: Wording** is the next phase in roadmap order. It applies the voice and tone rules from PRODUCT_EXPERIENCE.md section 2 across all screens, with no calculation or layout changes. It is a natural follow-on because:

1. The navigation and screen structure is now stable (C2 + C3 complete).
2. Wording changes are purely cosmetic and carry low risk.
3. Several screens still use implementation-oriented language that section 2.2 identifies for replacement (the full inventory is in docs/PRODUCT-AUDIT.md section 4).
4. B1 must precede C4 (conditional visibility), which in turn precedes the Plan screen refinement (C5).

---

## 10. Decisions for the product owner

| # | Decision | Context |
|---|----------|---------|
| D-S1 | **Should the "By Kind" breakdown hide when only one kind has recorded activity?** | When only income (or only payments) is recorded in a month, the KPI summary and By Kind show identical numbers. Hiding By Kind in that case reduces repetition; keeping it provides a consistent layout month to month. **Decision: deferred to C4 (visibility phase).** |
| D-S2 | **Should "Paid $0.00" be hidden from the Activity summary?** | Conditional visibility (section 5) says breakdown rows hide when zero, but the KPI summary could be treated as a fixed set of three (Received/Paid/Cash flow) for clarity. Decide whether it follows the same conditional rule. **Decision: keep "Paid $0.00". The three KPIs form a complete set.** |
| D-S7 | **Should empty Plan tabs collapse in early use?** | New users with only income and bills see four Plan tabs where two are empty. Collapsing could simplify early experience but add layout inconsistency as items are added. **Decision: keep all four Plan tabs visible. Consistent layout outweighs the cost of two empty tabs.** |
| D-B1 | **Authorize Phase B1 (Wording)?** | Next in roadmap order. Applies voice and tone rules (PRODUCT_EXPERIENCE.md section 2) across all screens. No calculation or layout changes. **Authorized and complete.** |
