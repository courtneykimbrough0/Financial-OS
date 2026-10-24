# Financial OS — central design system

**Status:** Owner-directed design specification, October 24, 2026. **This is the single authoritative source for visual design and interaction presentation.** [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md) remains authoritative for financial behavior; [docs/C0-FINANCIAL-ACCEPTANCE-EXAMPLES.md](docs/C0-FINANCIAL-ACCEPTANCE-EXAMPLES.md) defines corresponding examples while its PR is pending. This revision is **documentation only**; it does not claim the live app already reflects the design.

## 1. Visual reference and limits

The owner supplied five mobile screenshots of a polished budgeting application as a **design reference**. Borrow design *principles*: a high-contrast dark canvas, strong numerical hierarchy, carefully spaced content, elegant grouped transaction rows, easy-to-read calendars, prominent but calm summary cards, contextual drill-down, and coherent motion/interaction from summary to detail.

**Never copy the reference application's functionality, control model, wording, brand, proprietary artwork, icons/assets or exact screens.** In particular: no mandatory bank connection, no automatic categorization or financial decision-making that displaces the user, no assumption that the app controls the user's finances, and no requirement to replicate unrelated offers or marketing features. This is a Financial OS design language, not a replica or an interface license. Reference screenshots inform visual critique; original implementation must be created for Financial OS.

**Governing product-experience principle:** **User-directed planning. System-managed calculations. Connected financial information.** Automated calculations keep views consistent; only the user decides projected dates, amounts, recurrence and splits, and explicitly records actual outcomes.

## 2. Single source of visual truth

All new UI uses this document plus a **single centralized token/component implementation**. `src/styles.css` is the current token implementation; `src/ui/components/common.tsx` and other shared components are current building blocks. An implementation checkpoint must inventory existing tokens and reusable components, then adapt them rather than introducing independent screen-specific color systems or competing component libraries.

The token values below are the **documented current starting palette**, not color samples reverse-engineered from external screenshots. Exact adjustments may be proposed in an owner-reviewed visual specimen. Changes happen through tokens and shared components; no arbitrary per-screen hard-coded values.

## 3. Design principles

### 3.1 Clear focus, quiet support

Every screen communicates its most important answer first. Use a single clear hero number where appropriate; concise labels, readable dates, and focused primary actions. Supporting activity, breakdowns and advanced information live lower on the page or behind an intentional drill-down. Do not fill Home with every available statistic. A number without its period and projected/recorded context is incomplete.

### 3.2 Connected context and progressive disclosure

The user can move from summary → relevant transactions → one obligation or occurrence → edit/record/review → updated summary. The context (selected dates, item, view) remains legible and is preserved when returning. Detail surfaces use bottom sheets on phones when short, full screens for longer flows, and a dialog on desktop when appropriate.

### 3.3 User control is visible

Show editable projected amount/date/schedule and linked installment details. No screen implies income actually arrived until recorded. Automatic recalculation after a user decision is encouraged; autonomous changes to payment plans are not. A calculated result such as **Left to Spend** must not look like a user-entered recurring expense.

### 3.4 Dense enough to be useful, never crowded

Group related items on continuous surfaces with subtle dividers. Avoid a separate floating card for every row. Prioritize at-a-glance readability over decorative dashboard clutter. Hide empty data-only breakdowns; offer one useful empty-state action.

### 3.5 Consistency across all time scales

Week, month, custom range, calendar day and item detail reference **the same financial records and calculation engine**. Changing the visible period updates all relevant amounts, counts, status indicators and remaining totals dynamically. The **user chooses the forecast starting date**. No view silently reanchors to payday or a first-entered income source.

## 4. Foundation: palette, typography, spacing and shape

Use semantic tokens so visual consistency survives theme refinements. The existing dark-first starting token set is:

- Canvas `--color-bg: #1c1c1e`; content surface `--color-surface: #2a2a2c`; raised surface `--color-surface-raised: #333336`; sunken `--color-surface-sunken: #232325`; hairline `--color-border: #3a3a3d`; sheet `--color-sheet: #2c2c2e`.
- Primary text `--color-text: #f5f5f7`; secondary `--color-text-secondary: #a1a1a6`. Accent/focus `--color-accent: #8a97ff`. Income/positive `--color-in: #52cf88`; warning `--color-warn: #f5a623`; shortfall/error `--color-neg: #ff7b7b`. Cash outflows display a minus sign and neutral text, not alarming red.
- Font is currently Inter Variable, with **tabular numerals for money**. Display amounts approximately 36px; screen heading 22px; sheet/period headings 18px; section label 15px; body 16px; supporting text 14px. Caption text around 12px only where accessible and genuinely useful; do not use tiny gray type for important financial information.
- Space scale: **4/8/12/16/20/24/32px**. Default mobile page inset 16px. Separate large logical sections by ~24px. Each list row has enough vertical padding and label-value separation for scanning; avoid clipping on narrow screens or with large text.
- Starting corner radii: grouped cards ~18px, sheets ~28px on phone top corners, inputs ~14px, fully rounded button/choice pills. Apply by component token, not visual one-offs.
- Minimum touch targets 44×44px; primary actions about 48px high. Respect focus rings, text contrast, dynamic type, screen readers and reduced motion.

The visual reference suggests polished restraint rather than brighter/saturated UI. Proposed token changes must be reviewed across Home, Forecast, Plan, Activity, onboarding and sheets together. Use one meaning per color with **text/icon/shape**, never color as the only status signal.

## 5. Reusable component language

**Hero summary:** one lead number, a small contextual label identifying time period and projection basis, optional brief explanation, and at most one primary action. Avoid stacking competing hero cards on Home. Left to Spend is computed, never editable as an expense.

**Compact supporting summary:** short label, exact amount and useful trend/period context. Only show supporting totals when they help explain the hero; don't replicate the same number in several cards.

**Grouped transaction list:** shared surface containing repeatable rows. Each row: a consistent type avatar, name, useful secondary schedule/date/status, a right-aligned tabular amount, and a clear navigation affordance if interactive. Use a hairline divider between rows. Reflect projected/recorded state with concise text or chip, not just color.

**Recurring Expenses grouping:** summary and Upcoming/All controls may be used where they meaningfully change the presented list. Bills, Subscriptions and liability payments share the aggregate, while identities and a dedicated Liabilities view remain intact. Grouped summary and individual entry show the **same** money once.

**Period selector:** always visible or easy to reach on forecasts and relevant summaries; supports user-selected starting date and dynamic period. Do not reset silently when moving between week/month/calendar/detail. Labels show the effective start and end.

**Calendar:** intentionally designed monthly/weekly/date views, clear selected/today states, compact legible markers for money in, money out and recorded activity, with a short contextual day detail on selection. Avoid filling tiny cells with lengthy labels; provide accessible alternatives for screen readers. A tap on a day reveals that day's projected and recorded items without losing the selected period.

**Contextual detail sheet:** selecting an obligation or occurrence reveals its amount, timing, projected/recorded state, related plan, recorded history and only the relevant user actions. Short flows remain in a bottom sheet; multi-step or long flows use a full-screen view. Preserve navigation context and focus; avoid nested modal stacks.

**Status indicators:** projected (not “guaranteed”), recorded/received/paid, overdue-but-unrecorded, canceled and edited are legible in text; no subjective income-certainty badges. A past date never converts an item to an actual.

**Primary actions and empty states:** one clear next action per local context; concise plain-language prompts; optional Advanced controls for uncommon needs. Avoid empty cards filled with explanation or multiple simultaneous primary buttons.

**Motion:** subtle transitions when opening details, switching time periods or reflecting a completed user action. Honor reduced-motion preferences. Motion clarifies origin/destination and state, not decoration; no delayed or animated financial results that conceal updated amounts.

## 6. Screen-by-screen experience contract

### Home

A calm hierarchy with **Left to Spend as the primary projected result for the displayed period**, clearly indicating the date range. Show an accessible way to change the period and starting date. Below, provide only immediately actionable upcoming activity and a small amount of explanatory context (for example Recurring Expenses, reserves, or timing warnings when meaningful). An item opens the same underlying occurrence/detail used everywhere. Separate projected and recorded information; never suggest an actual account balance if one has not been established.

### Forecast / calendar

A coherent calendar/timeline for the **user-chosen forecast start and visible end**. Week/month/custom views recalculate dates and totals from the same entries. Selecting a date opens that day's transactions; selecting a transaction opens the relevant occurrence, from which the user can record or revise it. Present timing gaps when applicable, including an expense before later projected income, without claiming a bank account shortage without a verified opening basis.

### Plan / Recurring Expenses

An understandable inventory of recurring Bills, Subscriptions and liability payments, with useful Upcoming and All states where appropriate. An individual item shows amount, obligation recurrence, payment dates, recorded installments, planned installments and remaining amount as applicable. One-time expenses are accessible from a simple separate entry action, **not** disguised as a “Left to Spend” category.

### Liabilities

Retain a dedicated route/detail focused on balances and payment progress. Show which figures are user-provided, projected or recorded; don't invent lender posting, principal reductions, amortization assumptions or promises of payoff dates. Payment split data should link to the same underlying obligation as Recurring Expenses.

### Income

Simple source/amount/date or repeat schedule on first view. One-time and recurring income belong here. Hourly, tipped, gig and freelance tools are optional additional inputs for producing the projection, not eligibility checks or certainty grading.

### Strategic Reserves

Dedicated set-aside detail including planned and recorded allocations/releases, purpose and impact on **available** cash. Never present allocations as external spending or releases as income. Keep the setup minimal.

### Activity

Readable recorded history with clear dates and actual amounts, alongside appropriate ways to inspect earlier plans and differences. Do not imply future scheduled entries are actual activity. User can move from a record to relevant obligation detail.

### Five-section onboarding

Exactly five **financial entry sections** in sequence: Income, Bills, Subscriptions, Liabilities, Strategic Reserves; Review is a final action/stage, not an additional category. Each has one short explanation, a clear Add action, previously entered items, Back/Continue/Skip and easy return. Users can get an initial forecast early. Never request a Left to Spend amount. Offer simple entry; put complex recurrence, tips, account routing or installment plans behind Advanced. The design helps people remember items **section by section** instead of overwhelming them with a single giant payments list.

## 7. Split payment visual and interaction rules

An obligation's amount/cycle and the chosen dates/amounts of its installments are related but separate. Provide optional **Split payments** from an obligation detail or optional advanced entry. The basic flow stays one scheduled payment.

Show the base obligation, each planned installment and its date, total scheduled, total actually recorded and **remaining unrecorded amount** together when useful. Each view answers its time scale: a weekly view shows installments relevant to that week, a monthly view shows the corresponding monthly obligation and progress, and a liability view shows relevant balance/progress independently.

When a payment is recorded, update linked totals and views automatically. Preserve the user's planned schedule and recorded outcomes; do not silently reschedule future installments. Catch-up amounts may be spread across chosen dates. A user can review any difference between remaining obligation and remaining planned installments. Prevent double counting between an obligation and its installments.

The connected experience is vital: enter or record a payment in one location and the forecast, Recurring Expenses, obligation detail and Left to Spend **all update from the same source of truth**.

## 8. Controls, accessibility and responsive design

On phones, primary navigation remains stable and obvious; avoid requiring users to learn a new hierarchy for each feature. On wider screens, allow more horizontal space and side-by-side summary/details only where this genuinely aids comprehension. Do not design desktop as an enlarged phone screenshot.

Keyboard and screen-reader users must be able to traverse grouped lists, change periods, operate calendars, navigate forms and close sheets without losing context. Use accessible dialog focus management, labels and announcements for important updated calculated amounts. Avoid relying on gesture-only affordances or icons without accessible labels. Test narrow viewport, high zoom, reduced motion, light/dark accessibility as supported, and long amounts/labels.

Never use a tiny decorative icon to conceal a required action; contextual tooltips supplement understandable labels. Error and empty states tell the user what happened and how to proceed, without blaming them.

## 9. Copy rules

Use concise, everyday language: **Left to Spend, Recurring Expenses, Liabilities, Strategic Reserves, Projected, Recorded, Paid, Received**. Forecast wording explains that a future entry is planned, not certain. Do not use prohibited finance terms specified in PRODUCT_CONTRACT.md in new user-facing copy. Do not introduce robotic coaching language, probability assessments, unnecessary motivational text or fictional certainty.

## 10. Implementation and visual-acceptance protocol

This spec documents **design requirements only**. It is not permission to redesign every screen or introduce new features now. Follow the approved corrective checkpoints, with small reviewable PRs and a functioning Vercel preview.

Before implementing a screen, document (a) current screenshot/behavior, (b) proposed layout using shared components/tokens, (c) precise owner-approved product actions, (d) financial/status states including projected, recorded, zero, empty and negative, and (e) narrow-phone and accessibility verification. Show the owner a real preview of each important screen; green CI alone is not visual acceptance. Do not treat this design document as authority to change calculation rules, data models or business semantics.

**Design non-goals:** no redesign by copying another application's screens; no forced bank integration; no automated plan changes without user instruction; no replacement of working financial features merely for visual resemblance; no independent per-screen styling systems.

---

## Legacy design documentation (historical implementation reference only)

The following content is preserved to help engineers identify current CSS, components, and historical decisions. It describes parts of the pre-realignment implementation and may conflict with the requirements above. **It is not an alternative design system.** Reconcile any conflicting examples against the authoritative sections above and PRODUCT_CONTRACT.md before implementing.

# Financial OS design system

> **PRODUCT EXPERIENCE OVERRIDE (October 23, 2026):** [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md) controls the content and structure of financial workflows. The onboarding experience has five guided sections, must support simple-first / Advanced detail, and must not force a Varied Spending entry. Recurring Expenses aggregation and a dedicated Liabilities progress experience are separate from onboarding. Any contradictory historic design examples below require review before implementation; no code changes are implied by this documentation update.

Financial OS uses a dark-first, card-based visual language. It is calm and legible, with large numbers and one consistent set of controls. Every token lives at the top of `src/styles.css`, and the shared React pieces live in `src/ui/components/common.tsx`.

This file describes the visual system **as built**. The redesign direction is [PRODUCT_EXPERIENCE.md](PRODUCT_EXPERIENCE.md) section 7, built in roadmap Phase D one checkpoint at a time. **D1 (shared foundation) is built:** the type scale, one meaning per color (money out is neutral with a "−"; indigo is the accent only), sentence-case section labels, a smaller card radius, and the `ListGroup` and `EmptyLine` components. **D2 (Home), D3 (Forecast), D4 (Plan and Activity), D5 (setup and sheets) and D6 (desktop) are built** (see the layout pattern below).

The product's terms are fixed (Cash flow, Running total, Projected income, Projected expenses, Money in, Money out, Overdue, and so on). This system governs only how things look.

## Principles

1. **One surface language.** Content sits on rounded charcoal surfaces over a deeper charcoal canvas; related rows share one surface with hairline dividers (`ListGroup`). Groups are introduced by a sentence-case section label.
2. **Big numbers, quiet labels.** Amounts are the loudest thing on screen. Labels and supporting text are secondary gray.
3. **One meaning per color, and never color alone.** Green is money in; money out is neutral with a "−"; red is below $0, a timing gap or destructive; amber is overdue; indigo is the interactive accent and focus only. Each color always comes with a sign (+/−), an icon, a word, or a shape (filled vs. outlined).
4. **Pills for choices, cards for content.** Segmented controls and buttons are full pills. Cards and sheets use large radii.
5. **One icon set.** Lucide line icons at a 1.75 stroke, sized 14–24px, decorative unless they carry a label.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `#1c1c1e` | App canvas, tab bar, calendar footer |
| `--color-surface` | `#2a2a2c` | Cards, calendar grid |
| `--color-surface-raised` | `#333336` | Inputs, unselected pills, calendar header row, detail tables |
| `--color-surface-sunken` | `#232325` | Calendar days outside the period |
| `--color-sheet` | `#2c2c2e` | Bottom sheets (modals) |
| `--color-border` | `#3a3a3d` | Hairline dividers, grid lines |
| `--color-text` | `#f5f5f7` | Primary text, primary button fill, selected pill fill |
| `--color-text-secondary` | `#a1a1a6` | Labels, captions, hints |
| `--color-selected` | `#2f3a70` | Selected calendar day |
| `--color-accent` / `--color-focus` | `#8a97ff` | Interactive accent and focus rings only |
| `--color-in` / `--color-in-fill` | `#52cf88` / `#1c6b3e` | Money in: text and outline / filled chip, income avatar |
| `--color-out` | `var(--color-text)` | Money out amounts: neutral, with a "−" |
| `--color-out-line` / `--color-out-fill` | `#8e8e93` / `#4a4f5c` | Money out: outlined chip border / filled chip and bill avatar (slate) |
| `--color-liability-fill` | `#6a4fc0` | Liability avatar |
| `--color-warn` / `--color-warn-soft` | `#f5a623` / `#3a2f17` | Overdue |
| `--color-neg` / `--color-neg-soft` | `#ff7b7b` / `#3d2124` | Below $0, lowest point, destructive actions |
| `--color-ok-soft` | `#1d3327` | Done / "stays at or above $0" |

All text and icon pairings meet WCAG AA (4.5:1) against the surface they sit on, including chip text on the selected-day color; chip outlines and avatar icons meet 3:1.

## Type

The typeface is Inter Variable, bundled locally so it works offline, with numbers set in tabular figures.

| Role | Size / weight |
| --- | --- |
| Display (hero number) | 36px / 700, −0.02em (`--text-display`) |
| Title (screen heading) | 22px / 650 (`--text-title`) |
| Heading (sheet title, period) | 18px / 650 (`--text-heading`) |
| Section label | 15px / 600, sentence case (`--text-section`) |
| Body | 16px / 400–500 (`--text-body`) |
| Secondary | 14px / 400 (`--text-small`); subheads 14px / 600 |
| Caption | 12px / 500, used sparingly (`--text-caption`) |

## Shape and spacing

- **Radius:** cards and list groups 18px, sheets 28px (top corners on phones), inputs and callouts 14px, chips 8px, buttons and pills fully round.
- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32px. 16px screen gutters on phones, 24px between groups, 12px inside rows. Cards use 20px padding, list groups 16px, and hero cards 24px.
- **Touch targets:** at least 44px everywhere. Primary buttons are 48px tall.

## Components

- **App header:** the app mark and "Financial OS", centered on phones. On wider screens it holds pill navigation.
- **Tab bar (phones):** four tabs with line icons over labels. The active tab has full-strength text and a 3px bar along its top edge.
- **Segmented control:** separate pills. The selected pill is light with dark text, and the others are raised gray.
- **Hero card:** a label, one display number, a supporting line, and a footer row with an icon (e.g. "Next expected payday in 11 days").
- **List card:** rows of icon · label (with an optional sub-label) · value, separated by hairlines. Used for the period totals.
- **Calendar:** a full grid of dark cells.
  - Today's date number sits in a light circle. The selected day fills with `--color-selected`.
  - Amount chips are pinned to the bottom of each cell: **green for money in, neutral (slate fill, gray outline) for money out; filled once done, outlined while expected.**
  - Overdue (amber alert icon), below $0 (red trend-down icon plus a tinted cell), and the lowest point ("LOW") are flagged at the top of the cell.
  - A key and a footer strip with per-kind counts and totals sit below the grid.
- **Entry row:** a round kind avatar (income = banknote on green, bill = receipt on slate, liability = card on violet), title, tags, amount, and chevron.
- **Badges:** small pills with an icon and a word. Expected is an outlined gray pill, Received a green tint (money in), Paid and Set aside a neutral raised pill with a check, Overdue an amber outline, Canceled plain gray.
- **List group (`ListGroup`):** related rows on one surface with hairline dividers, instead of a card per row or per section.
- **Empty line (`EmptyLine`):** what an empty section shows: one line of text and at most one action, never an empty card with a heading.
- **Buttons:**
  - Primary is a light pill with dark text.
  - Secondary is a transparent pill with a light outline.
  - Danger is a red pill.
  - Link buttons are underlined text.
- **Bottom sheet:** a grab handle, a sticky title row with a close button, and stacked full-width pill actions. It becomes a centered dialog on wide screens. The page behind it is inert.
- **Cash flow bar:** a pill-shaped card pinned under the header during setup, labeled "Cash flow" with the period it covers (in setup, "First period · Oct 15 – 28"). The value is green, or red with a trend-down icon when negative, and changes are announced to screen readers.
- **Breakdown list:** label/value rows with sub-rows indented in secondary text and the key total on a heavier divider (used for the monthly breakdown and totals by tag).
- **Tags:** small outlined pills with a tag icon. In forms they become removable chips, entered through a text field with an Add button. The only suggestions are tags the user has already created.
- **Kind avatars:** income (banknote, green), bill (receipt, slate), subscription (repeat, blue), liability (card, violet), Strategic Reserves (piggy bank, teal), varied spending (bag, plum).
- **Timing-gap banner:** a red-outlined card with a warning triangle ("2 timing gaps ahead · Next 90 days"), shown only when the tally goes below $0. It opens a sheet listing each gap's dates, length, and lowest amount. Its wording describes the gap and gives no advice.
- **Choice pills:** a required single choice (e.g. liability type: Card, Loan, Line of credit) shown as equal-width pills backed by native radio buttons. The selected pill is light, and all pills get a red outline if nothing is chosen on save.
- **Navigation:** tabs for Home, Forecast, Activity and Plan; Settings behind the gear. One tab bar: at the bottom on phones, a left rail (icon and label rows) from 1024 px; tablets show the same routes as pills in the top bar. Sheets are bottom sheets on phones, centered dialogs on tablets and a right-hand panel from 1024 px. Plan has a row of section pills (Income, Expenses, Liabilities, Reserves) that fits a phone width without scrolling (below 375 px the four share the width equally); Expenses keeps its Bills, Subscriptions and Varied tabs.
- **Pill tabs:** two options inside a raised pill track, used within cards. The active option is light.
- **Totals strip / sheet stats:** three centered label-over-value columns, with values aligned on one baseline.
- **Callouts:** soft-tinted rounded blocks (info, warn, danger, ok) that always lead with an icon or a bold phrase.
- **Switch:** a pill track that turns green when on, built on a native checkbox with `role="switch"`.
- **Selection checkbox:** a native checkbox in a 44px tap target, to the left of an entry row, for picking several due items (Home's Needs attention). The row itself still opens the item. Batch actions appear below the list only when something is selected.
- **Toasts:** light pills with an icon at the top of the screen, so they never cover sheet or step buttons. They are announced through a live region.

## Layout pattern: summary on the page, details in sheets

Home and the Forecast screen show only summaries. Detail opens in a bottom sheet:

- **Plan** (since D4): each section's recurring items are rows in one `ListGroup`; an item that is off keeps its row, with an "Off" badge.
- **Freelance jobs** (since E3): Plan › Income gets "Add job" beside the recurring Add until there are jobs, then a Freelance jobs section: a client filter (pills) for two or more clients, "Done, not paid yet" as one label-and-amount row, Not paid yet and Paid lists. A row is the job, its client and work, its payment state on its own line (amber only when overdue) and the amount, muted when it isn't counted. One job sheet adds, changes, records and deletes; a small Clients sheet renames and removes. Job payments are ordinary received rows elsewhere, and their sheet points to the job.
- **Gig income** (since E4): the same section as Shifts, worded for sessions: "Waiting for payout" (split by platform when there are more than one), the latest sessions (date, hours, platform, earnings and cash, paid out or waiting) and Log a session. Session cash is an ordinary received row ("Cash · DoorDash") whose sheet points to the session.
- **Hourly and tipped income** (since E2): the income's sheet opens with Shifts: "Earned, not paid yet" as one label-and-amount row, a one-line explanation, the latest shifts (date, hours and tips, paid or not, and what was earned, without the green of money in), and Log a shift. Logging and correcting a shift is one sheet that replaces the income's sheet and returns to it. Shift cash tips are ordinary received rows on Home and Activity, and their sheet points to the shift.
- **Possible income** (since E1): a dashed, neutral "Possible" badge and a muted amount, never struck through (nothing was canceled) and never the green of money in. Rows say "Not counted until expected or received". On Home it has its own "Possible" list, apart from Coming up; its sheet explains it isn't counted and offers Record received and Mark as expected. The Expected / Possible choice on income forms appears only where the storage keeps it.
- **Activity** (since D4): one summary card leads with recorded cash flow, then Received, Paid, a row per classification (only when more than one has activity) and reserves; the recorded items are one `ListGroup`. Empty months and filters are `EmptyLine`s. **Earnings (since E5):** with shifts, sessions or jobs, an Earnings card follows the summary (label-and-amount rows; earned amounts neutral, only received money green) with Details opening a read-only sheet; a Possible list (dashed badge, muted amount) shows possible income in the month. Neither appears without its data.
- **Home** (the opening screen) carries what needs attention (see README, Home); the forecast screen no longer has an overdue banner. Since D2:
  - One progress card leads: the recorded cash flow so far this month (or the projected month, labeled, when nothing is recorded), one comparison line, then short label-and-amount rows for the projected month, last month and the difference. Red only for figures below $0; up and down in words with an arrow.
  - Needs attention, Coming up and Happened this week are each one `ListGroup`. Coming up puts each day as a small label inside its group instead of a card per day. Overdue payments say so in amber. An empty week is an `EmptyLine`.
  - Below 375 px the kind avatar is hidden on Home rows so item names keep their width.
- **Hero card (since D3, the one summary):** cash flow for the period (large, signed; red with a trend-down icon when negative), then its breakdown: income, spending with one indented row per classification that has something in the period, and reserves (rows with nothing in them are left out). Below $0: the lowest running total as a red row and a "Short $X / Timing gap · dates" callout that opens the explanation; otherwise one all-clear line. The footer gives the next expected payday, and says the running total starts then when it starts after the period. The (i) button explains cash flow and the running total.
- **Calendar card:** the grid, then a "Calendar key" link that opens the key.
- **Week by week:** one `ListGroup`, one row per week with money in, money out, reserves, net (only when more than one of those moved) and the running total at the week's end. An open week lists only the amounts each day has. A row opens in place (chevron down/up, `aria-expanded`) to list that week's days. The week view lists its days directly.
- **Sheets:**
  - A day shows money in, money out and running total, then that day's transactions.
  - A transaction opened from a day sheet returns to that sheet when closed.

- **Sheets (since D5):** one primary action each (Record on a payment, Edit on an item, Add a change or Apply change in "See what happens if…"), with secondary actions below and closing as a quiet link. In a timing gap, each expected payment is one tappable row that opens "See what happens if…". A payment's status sits with its kind under the amount.

The guided setup follows the same pattern:

- **Each step:** the step's items as a list card, with an "Add" button that opens the form in a sheet. Tapping an item opens it in a sheet to edit or remove it.
- **Review step:** a hero card showing the next expected payday and the lowest running total over the next four weeks, then section-labeled list cards with an "Add" link for each type that has items, and one "Not added: …" line for the rest.

Shortfall and overdue warnings always stay on the page and are never hidden behind a tap.

## Accessibility rules

- Focus is always visible as a 3px indigo ring.
- Every status pairs color with an icon or a word. Chips also differ by shape (filled vs. outlined), and amounts carry +/−.
- Each calendar cell is a button with a full spoken summary. The chips inside are hidden from assistive tech, so nothing is read twice.
- Motion is limited to short color transitions and is turned off under `prefers-reduced-motion`.
