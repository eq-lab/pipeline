# User stories — #726: Loan Book panel: summary cards render directly under heading; tab bar inside table container

Issue: https://github.com/eq-lab/pipeline/issues/726
Epic: https://github.com/eq-lab/pipeline/issues/712
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431

## Context

The Loan Book panel previously rendered in the order: tab bar → summary cards →
table. The Figma design (`3283:14479`) specifies the opposite vertical order:

1. The five summary cards appear **directly under the "Loan Book" heading**.
2. The tab bar ("Active Loans / In Origination") and the table are grouped in an
   inner container, with the tab bar **immediately above** the column-header row.

This issue reorders the DOM to match Figma — purely a positional change with no
data, styling, or internal markup change to any child component.

---

## Story 1 — Summary cards appear directly under the panel heading

**As a** lender viewing the Protocol Dashboard,
**I want** the five Loan Book summary cards (Total Deployed, Collateral, Senior
Debt Coverage, Avg Yield, Duration) to appear directly under the "Loan Book"
heading before any tab bar or table,
**so that** the at-a-glance summary metrics are the first content I see when I
open the panel, matching the Figma layout.

### Acceptance criteria

1. Navigate to `/dashboard` in a browser (any viewport).
2. The Loan Book panel (`data-testid="dashboard-panel-deployment-monitor"`)
   shows the five summary cards (`data-testid="loan-book-summary-cards"`)
   immediately below the "Loan Book" heading.
3. No tab bar is rendered between the heading and the summary cards.
4. The summary card labels (Total Deployed, Collateral, Senior Debt Coverage,
   Avg Yield, Duration) are all visible in that top area.

---

## Story 2 — Tab bar sits immediately above the table column headers

**As a** lender viewing the Protocol Dashboard,
**I want** the "Active Loans / In Origination" tab bar to appear immediately
above the table's column-header row (Borrower / Commodity, Principal, …),
**so that** the tabs clearly control the table below them, as shown in Figma.

### Acceptance criteria

1. Navigate to `/dashboard` in a desktop browser (viewport ≥ 1024px).
2. The Loan Book panel is in its ready state (data loaded, loans present).
3. The tab bar (`data-testid="loan-book-tab-bar"`) is visually adjacent to and
   immediately above the table's column-header row — no summary cards or other
   content appears between the tab bar and the table.
4. The "Active Loans" tab is selected (`aria-selected="true"`) and shows a
   numeric badge with the active loans count.
5. The "In Origination" tab is disabled (`aria-disabled="true"`) with no count
   badge.

---

## Story 3 — Tab bar and table are grouped inside a shared inner container

**As a** lender viewing the Protocol Dashboard,
**I want** the tab bar and the table to be visually grouped together as a single
section within the panel,
**so that** the layout matches the Figma container `3283:14479` — an inner
region that holds tabs + table, distinct from the summary cards above it.

### Acceptance criteria

1. Navigate to `/dashboard` in a browser.
2. The Loan Book panel is in its ready state.
3. The element with `data-testid="loan-book-table-container"` is present in the
   DOM, contains the tab bar (`data-testid="loan-book-tab-bar"`) and the table
   (`data-testid="loan-book-table"`), and does **not** contain the summary cards
   (`data-testid="loan-book-summary-cards"`).
4. The summary cards appear above (before in DOM order) the table container.

---

## Story 4 — Loading, empty, and error states are unaffected

**As a** lender viewing the Protocol Dashboard when data is unavailable,
**I want** the loading, empty, and error states of the Loan Book panel to be
unchanged,
**so that** the section reorder does not break non-ready states.

### Acceptance criteria

1. With no API data (simulated network delay), the panel shows the loading
   spinner / "Loading…" copy — no summary cards or tab bar are rendered.
2. With an empty loan list, the panel shows the empty-state caption — no summary
   cards or tab bar are rendered.
3. With an API error, the panel shows the error message and a "Retry" button —
   no summary cards or tab bar are rendered.
4. Clicking "Retry" in the error state triggers a refetch (no JavaScript error).
