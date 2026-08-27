# Issue #1216: Loan Book table — Commodity column scrolls out of view on small screens

Source: https://github.com/eq-lab/pipeline/issues/1216

## Scope

Keep the row-identity column visible while the LP dashboard loan tables scroll horizontally:

- Root cause: with `table-fixed` + flexible first `<col>`, the fixed columns (656 px) crowd out Commodity entirely once they exceed the viewport — the column collapses toward zero, so it is invisible even scrolled fully left.
- Fix (per user direction 2026-08-27: no sticky pinning, plain scroll): `min-w-[1024px]` on both tables (the Figma mobile frame's full-table width), restoring Commodity's designed share; it is readable at the left scroll end and scrolls away naturally.
- `LoanBookSummary` checked during implementation: it is a card strip (flex of SummaryCards), not a table — no identity column to pin; left unchanged.

Out of scope: mobile column subsetting or any layout redesign; row borders/radius (TD-26) unchanged.

## Assumptions and Risks

- No hover backgrounds exist on rows, so the opaque sticky cell has no hover-state divergence to manage.
- `table-fixed` derives column widths from the first row's cells, so the `min-w` floor lives on the `<th>`; body cells keep the `max-w-0` + `truncate` flex-fill trick for wide viewports.
- Sticky table cells are well-supported (`position: sticky` on `th`/`td`); jsdom won't paint them — tests assert classes, visual check on localhost.

## Open Questions

_None_

## Implementation Steps

1. `LoanBookTable.tsx` / `OriginationTable.tsx`: `min-w-[1024px]` on the `<table>` (cells unchanged).
4. Tests: `DeploymentMonitorPanel.test.tsx` (or a focused new block) asserting the sticky classes on the first header/body cells of both tables.
5. Spec: `dashboard-components.md#loanbooktable` responsive section — sticky identity-column rule (#1216).

## Test Strategy

Class assertions in the panel tests for both tables plus the summary; manual horizontal-scroll check on localhost at a narrow viewport.

## Docs to Update

`docs/frontend/dashboard-components.md#loanbooktable`.
