# User stories — #728: Loan Book panel renders full-width per Figma

Issue: https://github.com/eq-lab/pipeline/issues/728
Epic: https://github.com/eq-lab/pipeline/issues/712
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431&m=dev

## Context

The Protocol Dashboard (`/dashboard`) previously rendered its four panels in a
2×2 grid at desktop widths (`md:grid-cols-2`). This squeezed the Loan Book
panel (Panel B) to ~half the content width, causing:

- The 5 summary cards to wrap labels onto 3 lines (should be 1–2 lines).
- The 7-column desktop table to overflow, with only the first column visible
  and the other 6 requiring horizontal scroll inside the panel.

Fix: the dashboard grid is now a full-width single-column stack at all
viewports (`grid-cols-1` only), matching Figma frame `3283-12098`. Every panel
spans the full ~1136px content width (inside the `max-w-[1200px] px-8` shell).

---

## Story 1 — Loan Book summary cards fit on one or two lines

**As a** lender viewing the Protocol Dashboard,  
**I want** the five Loan Book summary cards (Total Deployed, Collateral, Senior
Debt Coverage, Avg Yield, Duration) to be displayed side-by-side across the
full content width,  
**so that** each card's label fits on one or two lines rather than three,
making the dashboard easy to scan.

### Acceptance criteria

1. Navigate to `/dashboard` in a desktop browser (viewport ≥ 1024px).
2. The Loan Book panel (`data-testid="dashboard-panel-deployment-monitor")
   spans the full content width (≈1136px — measured as the same width as the
   page heading "Protocol Dashboard").
3. All five summary card labels (Total Deployed, Collateral, Senior Debt
   Coverage, Avg Yield, Duration) are visible without horizontal scroll inside
   the panel.
4. No summary card label wraps onto more than two lines.

---

## Story 2 — Loan Book table shows all 7 columns without horizontal scroll

**As a** lender viewing the Protocol Dashboard,  
**I want** the Loan Book's desktop table to show all seven columns (Borrower /
Commodity, Principal, Collateral, LTV, Duration, Rate, Protection) side by
side,  
**so that** I can read all loan attributes at a glance without scrolling.

### Acceptance criteria

1. Navigate to `/dashboard` in a desktop browser (viewport ≥ 1024px).
2. The Loan Book panel's desktop table (`data-testid="loan-book-table-desktop"`)
   is visible.
3. All seven column headers are visible simultaneously with no horizontal
   overflow or scroll bar inside the panel.
4. No column is clipped or requires horizontal scroll to reveal.

---

## Story 3 — All four dashboard panels span the full content width

**As a** lender viewing the Protocol Dashboard,  
**I want** all four panels (Balance Sheet, Loan Book, Withdrawal Queue, Yield
History) to be stacked vertically each at full content width,  
**so that** the layout matches the Figma design (frame `3283-12098`) and none
of the panels is squeezed into a narrow half-width column.

### Acceptance criteria

1. Navigate to `/dashboard` in a desktop browser (viewport ≥ 1024px).
2. The four panels render in source order: Balance Sheet → Loan Book →
   Withdrawal Queue → Yield History.
3. Each panel is the same width as the page heading ("Protocol Dashboard"),
   confirming it spans the full content column.
4. No 2×2 grid arrangement is present at any desktop viewport width.

---

## Story 4 — Mobile single-column stack is preserved

**As a** lender on a mobile device,  
**I want** the dashboard panels to continue stacking in a single column,  
**so that** the mobile layout is unaffected by the desktop full-width change.

### Acceptance criteria

1. Navigate to `/dashboard` on a mobile viewport (≤ 402px wide).
2. All four panels render in the same vertical stack order as on desktop.
3. The Loan Book panel's internal mobile treatment (horizontal scroll strip for
   summary cards, stacked card rows for the table) is intact and unchanged.
4. No horizontal overflow appears at the page level.
