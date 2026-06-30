# Issue #729: Loan Book table: column headers missing aggregate subtitles

Source: https://github.com/eq-lab/pipeline/issues/729

## Scope

Add aggregate subtitles to three of the Loan Book table's column headers, matching
Figma node `3283-14431` (verified screenshot of the header row reads:
`Principal · $31.6M    Collateral · $37.6M    LTV · 84%`). The label and the
aggregate are rendered as a single continuous caption-styled run, separated by a
middot (` · `).

In scope:

- `Principal` header → append ` · {totalDeployed}` from `summary.total_deployed`.
- `Collateral` header → append ` · {totalCollateral}` from `summary.total_collateral`;
  render NO subtitle (label only) when `total_collateral` is null.
- `LTV` header → append ` · {portfolioLtv}` computed client-side as
  `total_deployed / total_collateral`; render NO subtitle when the value is null
  (which is exactly when `total_collateral` is null). See Open Questions — the
  default below is recommended but the source of the LTV aggregate is the one
  decision the planner is flagging for confirmation.
- Both breakpoints: desktop `<table>` header cells (`DesktopTable`) and the mobile
  stacked-card field labels (`MobileCards` / `MobileField`) in
  `packages/frontend/src/components/dashboard/LoanBookTable.tsx`.

Out of scope (STRICT — all merged or owned elsewhere, do NOT touch):

- Summary cards / `LoanBookSummary.tsx` (#726).
- Tab bar `LoanBookTabBar` (#727).
- Dashboard grid / route shell (#728, #716).
- Borrower cell / row body content (#730).
- Backend `packages/api/src/routes/loan_book.rs` and the `useLoanBook` hook's
  existing fields beyond surfacing the aggregates already present on `summary`.
- Restyling the existing header-label typography (it currently renders at the
  `body-s` 14px token, not the Figma `caption` 12px token — see Open Questions).

## Assumptions and Risks

- **Aggregates already flow to the view through `summary`, not through `rows`.**
  `useDeploymentMonitorPanel` already builds a formatted `summary: LoanBookSummaryProps`
  but `LoanBookTable` only receives `rows`. The table needs the three aggregate
  strings passed in. The cleanest path is to add a small `headerAggregates` object
  (or three optional string props) to `LoanBookTableProps`, populated by the panel
  view from the hook's data. This keeps the table presentational (FRONTEND.md rule 2:
  formatting stays in the hook).
- **`total_collateral` is null in current stage data** (TODO #706 — no commodity
  price feed wired). So in production today the Collateral and LTV subtitles will
  both be absent; only the Principal subtitle will render. This is the intended
  degrade-gracefully behavior, not a bug. The Figma values (`$37.6M`, `84%`) are
  design placeholders that will appear once #706 lands.
- **LTV must be computed, not read.** The API summary exposes no portfolio/weighted
  LTV field (confirmed by reading `LoanBookSummary` DTO in `loan_book.rs`). The only
  available aggregates are `total_deployed`, `total_collateral`, `senior_debt_coverage`,
  `avg_yield`, `avg_duration_days`. `senior_debt_coverage` is `collateral/senior` — a
  different ratio — so it is NOT the LTV. Portfolio LTV must be derived client-side as
  `total_deployed / total_collateral`. Risk: divergence from any future backend-served
  weighted LTV. Mitigated by gating the subtitle on non-null collateral and matching
  the backend per-row LTV definition (`principal / collateral`).
- **Typography token mismatch risk.** Figma renders the entire header label run
  (label + aggregate) in the `caption` token (12px/16px, Graphik LC Regular 400,
  `content-test/secondary` ≈ ink-muted). The current code's header cells use `body-s`
  (14px). This plan keeps the existing label size and renders the subtitle in the same
  size as the label (so label and aggregate stay visually one run), rather than
  silently restyling the header — see Open Questions.

## Open Questions

- **LTV aggregate source (the load-bearing question):** The API serves no portfolio
  LTV field. Recommended default: compute it client-side in the panel hook as
  `total_deployed / total_collateral` (formatted with the existing `formatLtv`-style
  integer-percent rule), and render the subtitle only when `total_collateral` is
  non-null. Confirm this is acceptable versus (a) omitting the LTV subtitle entirely
  until a backend field exists, or (b) adding a `portfolio_ltv` field to the
  `/v1/loan-book` summary (out of this frontend issue's scope; would need a backend
  sub-issue). The plan below implements the recommended default; if (a)/(b) is chosen
  the LTV step is dropped/deferred.
- **Header label type size:** Figma uses the `caption` 12px token for the whole header
  run, but the shipped header cells use `body-s` 14px (from the merged #717/#727 work).
  Should this issue (1) leave the header label at 14px and render the subtitle at the
  same 14px so they read as one run (recommended — minimal, in-scope), or (2) also
  step the header label down to the 12px `caption` token to match Figma exactly? Option
  (2) edges into header-restyle territory adjacent to #727; confirm before doing it.

## Implementation Steps

1. **Add a portfolio-LTV formatter (if the recommended default in Open Questions is
   confirmed).** In `packages/frontend/src/utils/formatCompactUsd.ts`, add
   `formatPortfolioLtv(totalDeployed: string | null | undefined, totalCollateral:
   string | null | undefined): string` that returns `formatLtv`-style integer percent
   from `parseFloat(totalDeployed) / parseFloat(totalCollateral)`, returning `"—"`
   (or a sentinel the caller treats as "no subtitle") when either input is null,
   non-finite, or collateral is `0`. Reuse the existing `formatLtv` rounding rule
   (`Math.round(fraction * 100)%`). Both inputs are base-6 human-unit decimal strings,
   so a plain ratio is correct (units cancel) — do NOT use `parseUnits`.
   - Alternatively, keep this derivation inside the panel hook if a standalone util is
     overkill; but a util is preferred because it needs unit tests (FRONTEND.md rule 3)
     and the null/zero edge cases are exactly the kind that regress.

2. **Surface the three header aggregates from the panel hook.** In
   `packages/frontend/src/components/dashboard/useDeploymentMonitorPanel.ts`, extend
   `DeploymentMonitorPanelState` (and the `ready` branch) with a `headerAggregates`
   object carrying optional pre-formatted strings:
   - `principal`: `formatCompactUsd(data.summary.total_deployed)` (always present).
   - `collateral`: `data.summary.total_collateral == null ? undefined :
     formatCompactUsd(data.summary.total_collateral)`.
   - `ltv`: `formatPortfolioLtv(data.summary.total_deployed, data.summary.total_collateral)`
     mapped to `undefined` when it has no value.
   Use `undefined` (not `"—"`) for "no subtitle" so the table can omit the middot run
   entirely rather than render `Collateral · —`. For non-`ready` states (loading/error/
   empty) pass `headerAggregates: {}` (all undefined) so headers render label-only.

3. **Thread the aggregates to the table.** In
   `packages/frontend/src/components/dashboard/DeploymentMonitorPanel.tsx`, pass the
   new `headerAggregates` from the hook into `<LoanBookTable>`.

4. **Render the subtitles in `LoanBookTable.tsx`.** Extend `LoanBookTableProps` with
   `headerAggregates?: { principal?: string; collateral?: string; ltv?: string }`.
   - Desktop (`DesktopTable`): for the Principal / Collateral / LTV `<th>`, render the
     label, and when the corresponding aggregate is defined, append ` · {value}` in the
     same caption run. Keep the label and aggregate in one cell so they read as a single
     line (Figma `Principal · $31.6M`). Use the middot `·` with surrounding spaces.
   - Mobile (`MobileCards` / `MobileField`): the per-loan cards repeat the column labels
     ("Principal", "Collateral", "LTV"). Per Figma the aggregate subtitle belongs to the
     table HEADER, which the mobile card layout does not have. Confirm in Open Questions
     follow-up is NOT needed here: the mobile frame (`3283-72323`) shows no header row,
     so do NOT add aggregates to the mobile per-loan field labels. Leave `MobileField`
     untouched. (Document this explicitly in the component so a future reader doesn't
     "fix" it.)
   - Token discipline: subtitle uses the same font/size/color utilities as the existing
     `headerCellClasses` (no raw hex/font values). If Open Question #2 resolves to "match
     Figma 12px caption," apply the `caption` token to the whole header run instead.

5. **Keep the data-node-id / data-testid anchors stable.** Add a `data-testid` on each
   subtitle span (e.g. `loan-book-header-principal-aggregate`) so the new behavior is
   directly assertable and Figma-QA tooling can target it. Do not alter existing
   `data-node-id="3283:14431"` or other anchors.

## Test Strategy

- **Unit (`packages/frontend/src/utils/formatCompactUsd.test.ts`):** add a
  `describe("formatPortfolioLtv")` block (if step 1's util is added) covering:
  `("31600000.000000", "37600000.000000")` → `"84%"`; collateral null → no-value
  sentinel; deployed null → no-value sentinel; collateral `"0.000000"` → no-value
  sentinel (no divide-by-zero); non-numeric inputs → no-value sentinel; a rounding case
  to lock the `Math.round` boundary (mirror the existing `formatLtv` 0.8350/0.8351 tests).
- **Integration (`packages/frontend/src/routes/-dashboard.test.tsx`):**
  - Extend `FIXTURE_FULL` usage (or add a new fixture) where `total_deployed` is set and
    `total_collateral` is null → assert the Principal header shows `Principal · $31.6M`
    (via the new subtitle `data-testid`) and the Collateral/LTV headers show the label
    only (no `·`, no subtitle testid present).
  - Add a fixture with non-null `total_collateral` (e.g. `"37600000.000000"`) → assert
    `Collateral · $37.6M` and `LTV · 84%` both render.
  - Assert that loading/empty/error states render header labels with no aggregate
    subtitle (`headerAggregates` empty).
- Run `yarn workspace @pipeline/frontend test` (vitest) and `npx tsx scripts/lint-docs.ts`.
- **Figma verification:** compare the rendered `/dashboard` Loan Book header against
  Figma node `3283-14431` — the three subtitles must read `Principal · $31.6M`,
  `Collateral · $37.6M`, `LTV · 84%` and sit inline with their labels in the same
  caption styling. (With current stage data only Principal renders; verify the
  collateral/LTV path with a mock-key fixture that includes `total_collateral`.)

## Docs to Update

- `docs/frontend/utils.md` — add a row for `formatPortfolioLtv` (if the util is added
  in step 1), per FRONTEND.md rule 4, in the same commit.
- No product-spec change: this is a pure presentational `fix`/`bug` that surfaces an
  existing aggregate already specified by the loan-book endpoint; no user- or
  agent-facing behavior contract changes.
- If Open Question #1 resolves to "add a backend `portfolio_ltv` field," that becomes a
  separate backend sub-issue and the LTV step here is deferred — note it in the issue
  thread; do not expand this plan's scope.
