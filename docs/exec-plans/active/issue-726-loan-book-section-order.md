# Issue #726: Loan Book panel: tabs render above the summary cards; Figma places cards under the heading and tabs inside the table container

Source: https://github.com/eq-lab/pipeline/issues/726

## Scope

Reorder the vertical sections of the Loan Book panel (Protocol Dashboard Panel B)
to match Figma node `3283-14431` (container `3283-14479`).

Current DOM order (in `DeploymentMonitorPanel.tsx`):

```
heading → tab bar → summary cards → table
```

Target order (Figma):

```
heading
row of 5 summary cards          (directly under the heading)
container {
  tab bar (Active Loans / In Origination)   (top of the container)
  table (column-header row + body rows)      (immediately below the tabs)
}
```

Figma structure confirmed via metadata: frame `3283:14479` ("Container") nests
the `tabs` instance (`3283:14480`) at the top, then a `Table container`
(`3283:14552`) whose first child is the column-header `Header` slot followed by
the data rows. The 5 summary cards ("Second card pair" frame) sit ABOVE this
container, directly under the "Loan Book" heading.

**In scope**

- Move the `<LoanBookSummary>` block so it renders first in the panel body,
  directly under the heading.
- Move the tab bar (`<LoanBookTabBar>`) so it renders INSIDE a container that
  also wraps `<LoanBookTable>`, with the tab bar positioned immediately above the
  table's column-header row.
- Introduce the inner table container wrapper to group tabs + table together as
  a single visual section (matching Figma container `3283-14479`).

**Out of scope (do NOT touch)**

- The tab bar's INTERNAL markup, styling, badges, or count logic — that is
  #727's domain (already merged; see Assumptions). This change only moves the
  tab bar's POSITION in the DOM; it must not re-specify `LoanBookTabBar`'s class
  constants, badge classes, `role`/`aria` attributes, or the
  `activeLoansCount` wiring.
- The dashboard grid / full-width layout (#728, merged).
- The table columns' content (#729).
- The borrower cell (#730).
- `useDeploymentMonitorPanel.ts` data flow — no data, formatting, or state
  change. This is purely DOM/section ordering.
- The summary-card internals (`LoanBookSummary.tsx`) and table internals
  (`LoanBookTable.tsx`) — only their ordering/nesting in the parent changes.

## Assumptions and Risks

- **#727 is already MERGED to main (PR #732), contrary to the task framing
  that described it as an open PR.** Verified: commit `9576ab5` ("Implement
  #727") is an ancestor of this branch (`feat/726-loan-book-section-order`,
  branched from `e699eb8` = the #732 merge commit). The tab bar in
  `DeploymentMonitorPanel.tsx` already carries the #727 badges and restyle.
  - Consequence: there is NO live merge-order conflict to manage — #726 builds
    on top of #727. The coordination intent still holds and is the reason for the
    strict out-of-scope rule above: this plan moves only the tab bar's DOM
    position and must leave `LoanBookTabBar`'s internals byte-for-byte intact, so
    the two changes remain cleanly separable in history.
  - Residual risk: if the manager re-bases or if any #727 follow-up reopens, a
    conflict would land in `DeploymentMonitorPanel.tsx` around the panel-body
    JSX (lines ~117-144) and the `LoanBookTabBar` component. The conflict would
    be a positional one (where the `<LoanBookTabBar/>` element sits), trivially
    resolvable by keeping #727's tab internals and #726's placement.
- The bordered "container" in Figma (`3283-14479`) is an INNER region of the
  panel — the summary cards are siblings ABOVE it, not inside it. The existing
  `PanelContainer` already provides the OUTER white card surface and the
  heading. So the new inner wrapper must NOT duplicate the panel's outer card
  chrome; it groups tabs + table only. Risk: over-styling the inner wrapper
  (adding a second card border/shadow) would diverge from Figma. Keep the inner
  wrapper minimal — a `flex flex-col gap` container is sufficient unless Figma's
  design-context shows a distinct border/background on `3283-14479` (see Open
  Questions).
- The existing test `DeploymentMonitorPanel — tab bar` asserts the tab bar
  renders and behaves; reordering must keep `data-testid="loan-book-tab-bar"`
  and its child testids intact so those tests keep passing.

## Open Questions

- Figma container `3283-14479` is drawn with what looks like a 1px border in the
  screenshot. Should the inner tabs+table wrapper carry its own visible border /
  background (a distinct sub-card), or is that border just the outer panel
  `Card` edge? The plan defaults to NO extra border on the inner wrapper (treat
  the outer `PanelContainer` card as the only surface) to avoid a double border,
  but if UX review against Figma shows a distinct inner container chrome, the
  coder should add a token-based border to the wrapper. Resolve by inspecting
  `get_design_context` for node `3283-14479` during implementation; if it
  specifies a fill/stroke/radius, apply the matching `--color-pipeline-*` /
  `--radius-pipeline-*` tokens to the inner wrapper.

## Implementation Steps

1. **`packages/frontend/src/components/dashboard/DeploymentMonitorPanel.tsx`** —
   reorder the panel body JSX inside `DeploymentMonitorPanel`. Replace the
   current single flex column:

   ```
   <div className="flex flex-col gap-4">
     <LoanBookTabBar activeLoansCount={activeLoansCount} />
     <LoanBookSummary ... />
     <LoanBookTable rows={rows} />
   </div>
   ```

   with the Figma order — cards first, then an inner container grouping the tab
   bar above the table:

   ```
   <div className="flex flex-col gap-4">
     <LoanBookSummary ... />          {/* cards directly under the heading */}
     <div className="flex flex-col gap-4" data-testid="loan-book-table-container">
       <LoanBookTabBar activeLoansCount={activeLoansCount} />  {/* tabs at top of container */}
       <LoanBookTable rows={rows} />                            {/* table immediately below */}
     </div>
   </div>
   ```

   - Keep the `<LoanBookSummary ... />` prop list exactly as-is.
   - Keep `<LoanBookTabBar activeLoansCount={activeLoansCount} />` exactly as-is
     (no prop, class, or attribute changes — #727 owns its internals).
   - Add a `data-testid="loan-book-table-container"` anchor on the new inner
     wrapper for the ordering test (step in Test Strategy).
   - Use the existing `gap-4` rhythm; do not introduce new spacing tokens unless
     the Open Question resolves toward a distinct inner container chrome.

2. **Do NOT modify** `LoanBookTabBar` (lines ~79-113), the tab/badge class
   constants (lines ~43-77), `LoanBookSummary.tsx`, `LoanBookTable.tsx`, or
   `useDeploymentMonitorPanel.ts`. The only edit is the body-JSX reordering in
   step 1 (plus the optional inner-wrapper border if the Open Question resolves
   that way).

3. Run the TypeScript/lint gate: `npx tsx scripts/lint-docs.ts` for docs, and
   the frontend type-check/build per the package's scripts. Fix any error before
   handing off.

## Test Strategy

File: `packages/frontend/src/routes/-dashboard.test.tsx` (existing
DeploymentMonitorPanel integration suite).

- **Add** an ordering assertion in the `DeploymentMonitorPanel` ready-state
  block: render with `FIXTURE_FULL`, then assert the DOM order is
  cards → tab bar → table. Use `Node.compareDocumentPosition` (or
  `getByTestId(...).compareDocumentPosition(...)`) on
  `loan-book-summary-cards`, `loan-book-tab-bar`, and `loan-book-table`:
  - `summary-cards` precedes `tab-bar` (cards come first now — this is the
    regression guard; previously the tab bar preceded the cards).
  - `tab-bar` precedes `loan-book-table` (tabs sit above the table).
  - Assert `loan-book-tab-bar` is a descendant of
    `loan-book-table-container` (tabs are inside the table container), using
    `tableContainer.contains(tabBar)` and `tableContainer.contains(table)`.
- **Verify unchanged**: the existing `DeploymentMonitorPanel — tab bar` tests
  (active/disabled state, live count badge, no In-Origination badge) and the
  responsive-structure test must still pass without edits — proves the tab bar
  internals were not disturbed.
- Edge cases: ordering test only needs the ready state (cards + tabs + table all
  present). Loading/empty/error states render `PanelLoading`/`PanelEmpty`/
  `PanelError` instead of children, so ordering does not apply there — no new
  assertions needed for those.
- Run the full frontend unit/integration suite for `packages/frontend` and
  confirm green.

### Figma verification

- Reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431
  (container `3283-14479`).
- After implementation, the rendered `/dashboard` Loan Book panel must read
  top-to-bottom: heading → 5 summary cards → [tabs → column headers → rows],
  with the tabs visually adjacent to (immediately above) the column-header row
  and the cards immediately under the heading. This is the QA pass's
  responsibility per the frontend flow (no testing phase in this plan beyond the
  unit ordering guard); the QA agent (epic #712 `qa` sub-issue) verifies the
  rendered page against this Figma node.

## Docs to Update

- None required. This is a pure DOM/section-ordering `fix/` with no user- or
  agent-facing behavior change, no new component, and no new shared hook/util
  (FRONTEND.md catalogue rules do not trigger). No product-spec or design-doc
  update needed.
- If the Open Question resolves toward adding a distinct inner-container border,
  no doc change is still needed (it consumes existing `--color-pipeline-*` /
  `--radius-pipeline-*` tokens already documented in FRONTEND.md).
