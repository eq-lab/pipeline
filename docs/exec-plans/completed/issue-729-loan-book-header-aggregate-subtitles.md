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

1. ~~**Add a portfolio-LTV formatter**~~ — **SKIPPED** per resolved open question #1: LTV
   subtitle omitted entirely. `formatPortfolioLtv` was NOT added to `formatCompactUsd.ts`.
   The LTV column header renders plain text only until a backend `portfolio_ltv` field
   exists (future sub-issue).

2. **[DONE] Surface the header aggregates from the panel hook.** In
   `packages/frontend/src/components/dashboard/useDeploymentMonitorPanel.ts`, extended
   `DeploymentMonitorPanelState` with a `headerAggregates: LoanBookHeaderAggregates` field
   carrying optional pre-formatted strings:
   - `principal`: `formatCompactUsd(data.summary.total_deployed)` (always present when ready).
   - `collateral`: `undefined` when `total_collateral == null`, else `formatCompactUsd(...)`.
   - LTV field intentionally absent — do NOT add it.
   Non-`ready` states (loading/error/empty) return `EMPTY_HEADER_AGGREGATES = {}`.

3. **[DONE] Thread the aggregates to the table.** In
   `packages/frontend/src/components/dashboard/DeploymentMonitorPanel.tsx`, passed
   `headerAggregates` from the hook into `<LoanBookTable>`.

4. **[DONE] Render the subtitles in `LoanBookTable.tsx`.** Added `LoanBookHeaderAggregates`
   interface and `headerAggregates?: LoanBookHeaderAggregates` to `LoanBookTableProps`.
   - Desktop (`DesktopTable`): Principal and Collateral `<th>` render the aggregate span
     when the value is non-null; LTV header is always plain.
   - Mobile (`MobileCards` / `MobileField`): left untouched — no aggregates in the mobile
     card field labels (Figma node 3283-72323 has no header row). Documented with a comment.
   - Header typography updated to 12px caption token (`--text-pipeline-caption`) per
     resolved open question #2 — stepping down from 14px body-s to match Figma exactly.

5. **[DONE] data-testid anchors added.** `data-testid="loan-book-header-principal-aggregate"`
   and `data-testid="loan-book-header-collateral-aggregate"` on the subtitle `<span>`
   elements. Existing `data-node-id="3283:14431"` unchanged.

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
