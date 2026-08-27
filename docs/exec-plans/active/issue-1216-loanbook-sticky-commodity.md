# Issue #1216: Loan Book table — Commodity column scrolls out of view on small screens

Source: https://github.com/eq-lab/pipeline/issues/1216

## Scope

Keep the row-identity column visible while the LP dashboard loan tables scroll horizontally:

- `LoanBookTable` (Commodity) and `OriginationTable` (Commodity — reuses the exported cell classes): first header/body cells become `sticky left-0` with an opaque `--color-pipeline-surface` background (the panel is white), a `z-[1]` raise, a `min-w-[140px]` floor (the flexible first `<col>` otherwise collapses toward zero once the fixed columns exceed the viewport), and a right hairline (`border-r` line-subtle) so scrolled content reads as passing beneath it.
- `LoanBookSummary` checked during implementation: it is a card strip (flex of SummaryCards), not a table — no identity column to pin; left unchanged.

Out of scope: mobile column subsetting or any layout redesign; row borders/radius (TD-26) unchanged.

## Assumptions and Risks

- No hover backgrounds exist on rows, so the opaque sticky cell has no hover-state divergence to manage.
- `table-fixed` derives column widths from the first row's cells, so the `min-w` floor lives on the `<th>`; body cells keep the `max-w-0` + `truncate` flex-fill trick for wide viewports.
- Sticky table cells are well-supported (`position: sticky` on `th`/`td`); jsdom won't paint them — tests assert classes, visual check on localhost.

## Open Questions

_None_

## Implementation Steps

1. `LoanBookTable.tsx`: add exported `stickyFirstHeaderCellClasses` / `stickyFirstBodyCellClasses` (existing class sets + `sticky left-0 z-[1] bg-[color:var(--color-pipeline-surface)] min-w-[140px] border-r border-[color:var(--color-pipeline-line-subtle)]`); use them on the Commodity `<th>`/`<td>`.
2. `OriginationTable.tsx`: apply the same constants to its Commodity column.
4. Tests: `DeploymentMonitorPanel.test.tsx` (or a focused new block) asserting the sticky classes on the first header/body cells of both tables.
5. Spec: `dashboard-components.md#loanbooktable` responsive section — sticky identity-column rule (#1216).

## Test Strategy

Class assertions in the panel tests for both tables plus the summary; manual horizontal-scroll check on localhost at a narrow viewport.

## Docs to Update

`docs/frontend/dashboard-components.md#loanbooktable`.
