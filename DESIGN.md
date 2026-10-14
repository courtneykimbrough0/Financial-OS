# Financial OS design system

Financial OS uses a dark-first, card-based visual language. It is calm and legible, with large numbers and one consistent set of controls. Every token lives at the top of `src/styles.css`, and the shared React pieces live in `src/ui/components/common.tsx`.

The product's terms are fixed (Cash flow, Running total, Projected income, Projected expenses, Money in, Money out, Overdue, and so on). This system governs only how things look.

## Principles

1. **One surface language.** Content sits on rounded charcoal cards over a deeper charcoal canvas. Groups of cards are introduced by a small uppercase section label.
2. **Big numbers, quiet labels.** Amounts are the loudest thing on screen. Labels and supporting text are secondary gray.
3. **Meaning never rides on color alone.** Each semantic color always comes with a sign (+/−), an icon, a word, or a shape (filled vs. outlined).
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
| `--color-accent` / `--color-focus` | `#8a97ff` | Focus rings, sample-data banner |
| `--color-in` / `--color-in-fill` | `#52cf88` / `#1c6b3e` | Money in: text and outline / filled chip, income avatar |
| `--color-out` / `--color-out-fill` | `#a3adff` / `#3d4cc0` | Money out: text and outline / filled chip, expense avatar |
| `--color-liability-fill` | `#6a4fc0` | Liability avatar |
| `--color-warn` / `--color-warn-soft` | `#f5a623` / `#3a2f17` | Overdue |
| `--color-neg` / `--color-neg-soft` | `#ff7b7b` / `#3d2124` | Below $0, lowest point, destructive actions |
| `--color-ok-soft` | `#1d3327` | Done / "stays at or above $0" |

All text and icon pairings meet WCAG AA (4.5:1) against the surface they sit on, including chip text on the selected-day color.

## Type

The typeface is Inter Variable, bundled locally so it works offline, with numbers set in tabular figures.

| Role | Size / weight |
| --- | --- |
| Display (hero number) | 40px / 700, −0.02em |
| Title (screen heading) | 22px / 650 |
| Heading (card title, period) | 18–20px / 650 |
| Body | 16px / 400–500 |
| List value | 18px / 650 |
| Small / section label | 14px; section labels are 650, uppercase, 0.08em tracking |
| Caption | 12px |

## Shape and spacing

- **Radius:** cards 24px, sheets 28px (top corners on phones), inputs and callouts 14px, chips 8px, buttons and pills fully round.
- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32px. Cards use 20px padding, and hero cards use 24px.
- **Touch targets:** at least 44px everywhere. Primary buttons are 48px tall.

## Components

- **App header:** the app mark and "Financial OS", centered on phones. On wider screens it holds pill navigation.
- **Tab bar (phones):** four tabs with line icons over labels. The active tab has full-strength text and a 3px bar along its top edge.
- **Segmented control:** separate pills. The selected pill is light with dark text, and the others are raised gray.
- **Hero card:** a label, one display number, a supporting line, and a footer row with an icon (e.g. "Next expected payday in 11 days").
- **List card:** rows of icon · label (with an optional sub-label) · value, separated by hairlines. Used for the period totals.
- **Calendar:** a full grid of dark cells.
  - Today's date number sits in a light circle. The selected day fills with `--color-selected`.
  - Amount chips are pinned to the bottom of each cell: **green for money in, indigo for money out; filled once done, outlined while expected.**
  - Overdue (amber alert icon), below $0 (red trend-down icon plus a tinted cell), and the lowest point ("LOW") are flagged at the top of the cell.
  - A key and a footer strip with per-kind counts and totals sit below the grid.
- **Entry row:** a round kind avatar (income = banknote on green, expense = receipt on indigo, liability = card on violet), title, tags, amount, and chevron.
- **Badges:** small pills with an icon and a word. Expected is an outlined gray pill, Received/Paid a green tint, Overdue an amber outline, Canceled plain gray.
- **Buttons:**
  - Primary is a light pill with dark text.
  - Secondary is a transparent pill with a light outline.
  - Danger is a red pill.
  - Link buttons are underlined text.
- **Bottom sheet:** a grab handle, a sticky title row with a close button, and stacked full-width pill actions. It becomes a centered dialog on wide screens. The page behind it is inert.
- **Cash flow bar:** a pill-shaped card pinned under the header during setup, labeled "Cash flow" with the period it covers (in setup, "First pay period · Oct 15 – 28"). The value is green, or red with a trend-down icon when negative, and changes are announced to screen readers.
- **Breakdown list:** label/value rows with sub-rows indented in secondary text and the key total on a heavier divider (used for the monthly breakdown and totals by tag).
- **Tags:** small outlined pills with a tag icon. In forms they become removable chips, entered through a text field with an Add button. The only suggestions are tags the user has already created.
- **Kind avatars:** income (banknote, green), bill (receipt, indigo), subscription (repeat, blue), liability (card, violet), savings (piggy bank, teal).
- **Timing-gap banner:** a red-outlined card with a warning triangle ("2 timing gaps ahead · Next 90 days"), shown only when the tally goes below $0. It opens a sheet listing each gap's dates, length, and lowest amount. Its wording describes the gap and gives no advice.
- **Choice pills:** a required single choice (e.g. liability type: Card, Loan, Line of credit) shown as equal-width pills backed by native radio buttons. The selected pill is light, and all pills get a red outline if nothing is chosen on save.
- **Navigation:** four tabs: Dashboard, Income, Expenses (Bills, Subscriptions, Savings), and Liabilities.
- **Pill tabs:** two options inside a raised pill track, used within cards. The active option is light.
- **Totals strip / sheet stats:** three centered label-over-value columns, with values aligned on one baseline.
- **Callouts:** soft-tinted rounded blocks (info, warn, danger, ok) that always lead with an icon or a bold phrase.
- **Switch:** a pill track that turns green when on, built on a native checkbox with `role="switch"`.
- **Selection checkbox:** a native checkbox in a 44px tap target, to the left of an entry row, for picking several items (the review list). The row itself still opens the item. Batch actions sit in a sticky bar at the bottom of the sheet and appear only when something is selected.
- **Toasts:** light pills with an icon at the top of the screen, so they never cover sheet or step buttons. They are announced through a live region.

## Layout pattern: summary on the page, details in sheets

The dashboard shows only summaries. Detail opens in a bottom sheet:

- **Overdue banner:** a one-line amber pill ("1 transaction needs an update ›") that opens the overdue list.
- **Hero card:** cash flow for the period (large, signed; red with a trend-down icon when negative) with money in and out beneath it, then the lowest running total, a one-line timing-gap or all-clear callout, and the next expected payday. The (i) button explains cash flow and the running total.
- **Calendar card:** the grid, then a "Calendar key" link that opens the key.
- **Breakdown card:** income, expenses with one indented row per category that has something in the period, and cash flow.
- **Week by week:** one row per week with money in, money out, net, and the running total at the week's end. A row opens in place (chevron down/up, `aria-expanded`) to list that week's days. The week view lists its days directly.
- **Sheets:**
  - A day shows money in, money out and running total, then that day's transactions.
  - A transaction opened from a day sheet returns to that sheet when closed.

The guided setup follows the same pattern:

- **Each step:** the step's items as a list card, with an "Add" button that opens the form in a sheet. Tapping an item opens it in a sheet to edit or remove it.
- **Review step:** a hero card showing the next expected payday and the lowest point before the following payday, then uppercase-labeled list cards with an "Add" link for each type.

Shortfall and overdue warnings always stay on the page and are never hidden behind a tap.

## Accessibility rules

- Focus is always visible as a 3px indigo ring.
- Every status pairs color with an icon or a word. Chips also differ by shape (filled vs. outlined), and amounts carry +/−.
- Each calendar cell is a button with a full spoken summary. The chips inside are hidden from assistive tech, so nothing is read twice.
- Motion is limited to short color transitions and is turned off under `prefers-reduced-motion`.
