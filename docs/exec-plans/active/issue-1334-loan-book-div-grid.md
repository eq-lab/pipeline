# Issue #1334: Restructure Loan Book table to a div-grid so rows can render the Figma 4px radius

Source: https://github.com/eq-lab/pipeline/issues/1334

Parent epic: #2029 (Frontend tech debt batch). Resolves **TD-26** in `docs/exec-plans/tech-debt-tracker.md`.

## Scope

**In scope**

- `packages/frontend/src/components/dashboard/LoanBookTable.tsx` — replace the semantic
  `<table>/<colgroup>/<thead>/<tbody>/<tr>/<th>/<td>` with an ARIA div-grid
  (`role="table"` → `role="rowgroup"` → `role="row"` → `role="columnheader"` / `role="cell"`) so each
  body row can carry `rounded-[var(--radius-pipeline-card)]` (4px, the token TD-26 names), which
  matches Figma `.row` node `3704:1095`.
- Keep every current geometry rule unchanged — the restructure must be visually identical except
  for the row radius:
  - column widths: Commodity flexible (`minmax(0,1fr)`), then 112 / 112 / 112 / 96 / 96 / 128px;
  - `min-w-[1024px]` on the grid, `overflow-x-auto` wrapper (#1216, FRONTEND.md wide-content rule);
  - header caption typography + `pb-2` + 1px `--color-pipeline-line-subtle` bottom divider;
  - body 16/22 ink, `py-3`, 1px `--color-pipeline-line-subtle` top divider per row;
  - `pr-3` on the Commodity column only; Commodity truncates with an ellipsis;
  - header aggregates (`loan-book-header-{principal,collateral,ltv}-aggregate` test ids) unchanged.
- Keep the test ids `loan-book-table` and `loan-book-table-desktop` (consumed by
  `-dashboard.test.tsx`).
- Spec update in `docs/frontend/dashboard-components.md#loanbooktable` and TD-26 resolution.

**Out of scope**

- `OriginationTable.tsx` (In-Origination tab) and `WithdrawalQueueTable.tsx` stay as `<table>` —
  the issue and TD-26 name only the Loan Book Active-Loans table (see Open Questions #2).
- Trustee app: `packages/trustee` does not import `LoanBookTable` (its loans / origination pages
  have their own tables in `routes/-useLoansTable.ts` / `-useOriginationTable.ts`); the
  "loan-book shared by dashboard + trustee" note is about the data endpoint, not this component.
  No trustee change.
- No data, hook (`useDeploymentMonitorPanel.ts`) or `LoanBookRow` type changes.

## Assumptions and Risks

- **Figma file key.** The issue gives only the node id. The same Loan Book section is referenced in
  the spec (`3283-14431`, `3283-14552`, `3704:1095`) and every other dashboard Figma link in
  `docs/frontend/dashboard-components.md` is in file `A43rjYYjSwdTmiwwf5cx5n` ("Pipeline"), so the
  frame is assumed to be
  `https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3704-1095`. The Figma MCP
  and the local Dev Mode MCP were both unreachable during planning, so the row's full style could
  not be re-read.
- **What the repo already encodes for the row** (from the spec + `issue-754` plan): Figma `.row` is
  `flex items-center px-0 py-[12px]`, `border-t` 1px `#F1F1F1` (`--color-pipeline-line-subtle`,
  annotated with node `3704:1095` in `packages/ui/src/styles/theme.css`), 12px column gap after
  Commodity, 16/22 body type, and `border-radius: var(--radius-radius-l, 4px)` (TD-26). No row
  fill and no hover state are recorded anywhere. With only a top divider and no fill, a 4px radius
  is barely visible (it only tapers the divider's two ends) — see Open Questions #1.
- **Double divider risk.** Today the header `border-b` and the first row's `border-t` collapse into
  one 1px line via `border-collapse`. A grid does not collapse borders, so a naive port renders a
  2px line under the header. The plan drops the top divider on the first body row
  (`first:border-t-0` on the row element inside the body rowgroup) to keep one 1px line.
- **Truncation.** `table-layout: fixed` + `max-w-0` is what makes the Commodity cell truncate
  today. In the grid, `minmax(0,1fr)` + `min-w-0 overflow-hidden` on the cell + `truncate` on the
  inner span replaces it; `max-w-0` must not be carried over (it would collapse the cell to 0 in a
  grid).
- **Accessibility.** ARIA table roles replace native semantics; screen readers and
  Testing Library `getByRole("table" | "row" | "columnheader" | "cell")` keep working as long as
  every level carries its role (including the two `role="rowgroup"` wrappers).
- **Shared constants.** `OriginationTable.tsx` imports `headerCellClasses`,
  `firstBodyCellClasses`, `firstBodyCellInnerClasses` from `LoanBookTable.tsx`. These carry
  table-cell-specific borders (`border-b` on `<th>`, `border-t` + `max-w-0` on `<td>`) that the
  Origination `<table>` still needs, so they stay exported with identical values; the div-grid uses
  its own row/cell classes. `bodyCellClasses` / `bodyCellInnerClasses` become unused by
  `LoanBookTable` and are not imported anywhere else — remove them.
- No dependency on another open issue or PR.

## Implementation Steps

1. **Rewrite `LoanBookTable.tsx` as a div-grid** (`packages/frontend/src/components/dashboard/LoanBookTable.tsx`):
   - Replace the multi-section JSDoc/comments with a single 2–3-line spec-pointer header
     (`spec: docs/frontend/dashboard-components.md#loanbooktable`), with no field/function JSDoc and no
     inline comments (comment-minimal rule). Keep the exported `LoanBookRow`,
     `LoanBookHeaderAggregates`, `LoanBookTableProps` shapes unchanged.
   - Define one module constant for the column template, e.g.
     `const GRID_COLS = "grid grid-cols-[minmax(0,1fr)_112px_112px_112px_96px_96px_128px]";`
     and apply it to the header row and to every body row.
   - Structure:
     ```
     div[data-testid=loan-book-table]
       div[data-testid=loan-book-table-desktop].w-full.overflow-x-auto
         div[role=table][aria-label="Active Loans"].w-full.min-w-[1024px]
           div[role=rowgroup]
             div[role=row].{GRID_COLS}.border-b.border-[color:var(--color-pipeline-line-subtle)]
               div[role=columnheader] × 7   (header typography, pb-2, whitespace-nowrap, overflow-hidden, text-left; first gets pr-3)
           div[role=rowgroup]
             div[role=row].{GRID_COLS}.border-t.first:border-t-0.border-[color:var(--color-pipeline-line-subtle)].rounded-[var(--radius-pipeline-card)]   (one per row)
               div[role=cell] × 7   (body typography, py-3, whitespace-nowrap; first: min-w-0 overflow-hidden pr-3 + inner span "block truncate")
     ```
     The header divider moves from each `<th>` to the header row element (same 1px line, same
     colour); `pb-2` stays on the header cells so the 8px header→divider gap is unchanged.
   - Header aggregate spans stay byte-identical (`" · "` + value, same test ids, same
     `aria-hidden="false"`).
   - Leave `headerCellClasses`, `firstBodyCellClasses`, `firstBodyCellInnerClasses` exported with
     identical values for `OriginationTable.tsx`; delete the now-unused `bodyCellClasses` and
     `bodyCellInnerClasses` (verify with a grep across `packages/` first).
   - The `aria-label` text ("Active Loans", the tab label at `DeploymentMonitorPanel.tsx`) is the only new user-visible/AT-visible string.
2. **Update tests that assume a `<table>`**:
   - `packages/frontend/src/components/dashboard/DeploymentMonitorPanel.test.tsx` (#1216 block):
     the Loan Book case changes from `.closest("table")` to `.closest('[role="table"]')`; the
     Origination case keeps `.closest("table")`.
   - Grep `packages/frontend/src` for any other `closest("table")`, `querySelector("tr"|"td"|"th")`,
     `getAllByRole("row")` hitting the Loan Book and update them.
3. **Spec** — edit `docs/frontend/dashboard-components.md#loanbooktable`:
   - "All viewports render a semantic `<table>`" → ARIA div-grid with the role tree above.
   - Column widths paragraph: replace `table-layout: fixed` + `<colgroup>` with the grid template
     (`minmax(0,1fr)` + fixed tracks); Commodity truncation via `min-w-0` + `truncate`.
   - Spacing paragraph: dividers are on row elements (header row `border-b`, body rows `border-t`,
     first body row none), not on cells.
   - Replace the "unsupported on `<tr>` — TD-26" sentence with: rows carry
     `--radius-pipeline-card` (4px), Figma `.row` `3704:1095`.
   - In the `OriginationTable` section, the "`table-fixed` + `<colgroup>` … mirror `LoanBookTable`'s
     geometry" sentence becomes "mirror the Loan Book table's column/spacing geometry" (Origination
     stays a `<table>`).
4. **Tech debt** — in `docs/exec-plans/tech-debt-tracker.md`, mark TD-26
   `[RESOLVED 2026-11-xx / #1334]` with a one-line `Resolved:` note, matching the existing
   resolved-entry format (e.g. TD-5); fix its stale `Location` (`DesktopTable` no longer exists).
5. **Lint/build**: `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts` (if
   `LoanBookTable.tsx` appears in `scripts/lint-comments.baseline.json` after the change, shrink
   it), `yarn workspace` lint + typecheck + `vite build` for `packages/frontend`.

## Test Strategy

- Update/add unit tests in `DeploymentMonitorPanel.test.tsx` (or a new
  `LoanBookTable.test.tsx` next to the component) rendering `LoanBookTable` with 2 rows +
  aggregates and asserting:
  - `getByRole("table", { name: "Active Loans" })` exists and carries `min-w-[1024px]`;
  - 7 `columnheader`s in order Commodity, Principal, Collateral, LTV, Duration, Rate, Protection;
  - `getAllByRole("row")` length = 1 header + N body rows; each body row's class contains
    `rounded-[var(--radius-pipeline-card)]` and the shared grid template;
  - each body row has 7 `cell`s with the row values in column order;
  - header aggregate test ids still render `" · $…"`, and are absent when `headerAggregates` is
    undefined;
  - empty `rows` renders the header row only (header divider still present).
- Existing `-dashboard.test.tsx` assertions on `loan-book-table` / `loan-book-table-desktop`
  (overflow-x-auto, no `hidden`/`md:block`, DOM order) must stay green unchanged.
- `OriginationTable` tests stay green unchanged (proves the shared constants did not move).
- Run `yarn test` for `packages/frontend` (vitest) plus the lint/build commands above.
- **Figma verification (manual, live):** the human reviews `/dashboard` Loan Book → Active tab
  against `https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3704-1095` (row)
  and `node-id=3283-14552` (table container) at desktop and at the XS frame `3283-71053`: one 1px
  divider under the header (not 2px), row height and column positions identical to before, the
  Commodity ellipsis, horizontal scroll on mobile, and 4px rounded row corners. Agents do not drive
  the user's browser; if the Figma MCP is reachable at implementation time, the coder re-reads
  `3704:1095` with `get_design_context` to confirm the radius/stroke/fill before coding.

## Docs to Update

- `docs/frontend/dashboard-components.md` — `### LoanBookTable` (structure, widths, spacing,
  radius) and the cross-reference sentence in `### OriginationTable`.
- `docs/exec-plans/tech-debt-tracker.md` — TD-26 resolved.
- `scripts/lint-comments.baseline.json` — only if the touched file is listed (shrink, never grow).

## Open Questions

1. The repo records the Figma `.row` (3704:1095) as only a 1px top divider with no fill or hover,
   and Figma could not be opened during planning. A 4px radius on such a row only slightly curves
   the divider's ends, so it is barely visible. Does the Figma row have a fill or hover background
   that the dashboard is missing (which would need to be added too)? If not, is a full table → div-grid
   restructure still wanted for a change that is almost invisible, or should TD-26 be closed by
   decision?
2. Should the In-Origination tab's `OriginationTable` (same panel, same visual language, Figma
   `4116-9155`) get the same div-grid + radius so both Loan Book tabs match? The plan
   assumes no, because the issue names only `LoanBookTable`.
