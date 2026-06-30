# Issue #728: Loan Book panel — render full-width per Figma (7-column table clipped in the half-width dashboard grid)

Source: https://github.com/eq-lab/pipeline/issues/728

## Scope

A **dashboard layout (grid/width) change only**, in `packages/frontend/src/routes/dashboard.tsx`. The Loan Book / Deployment Monitor panel (Panel B) currently occupies one cell of the dashboard's 2×2 grid (`md:grid-cols-2`), so it renders at ~half the content width. At that width:

- the 5 summary cards (`LoanBookSummary`) are squeezed to ~110px each with labels wrapping to 3 lines, and
- the 7-column desktop table (`LoanBookTable` → `DesktopTable`) overflows; its `overflow-x-auto` wrapper kicks in so only the first column is visible and the rest require horizontal scroll inside the panel.

The fix gives Panel B the full dashboard content width (1136px inside the 1200px frame's 32px gutters), matching Figma `3283-14431`, so all 5 cards and all 7 columns fit with no horizontal scroll.

In scope:
- The CSS grid / panel-width arrangement in `routes/dashboard.tsx`.
- Reconciling the existing `-dashboard.test.tsx` assertion that checks `md:grid-cols-2` (it will need to change — see Test Strategy).
- Updating the layout doc comment at the top of `dashboard.tsx`.

Out of scope (do **not** touch — owned by other issues):
- Panel B's internal data wiring, hooks, formatting, table/card markup — that is #717 (merged) and must stay as-is.
- Tab/card order (#726), tab count badges (#727), column-header aggregate subtitles (#729), borrower truncation (#730). This issue is layout/width only; do not change any of those behaviors.

## Assumptions and Risks

- **Dependency #717 is satisfied.** `DeploymentMonitorPanel.tsx`, `LoanBookSummary.tsx`, `LoanBookTable.tsx`, `useDeploymentMonitorPanel.ts`, and `useLoanBook.ts` all exist under `packages/frontend/src/` on the current branch (the issue was previously `blocked` on #717 / PR #725, now merged to `main`). The `blocked` comment on the issue is stale; branch off current `main`.
- **Figma `3283-12098` is a full-width single-column stack, NOT a 2×2 grid.** Verified via `get_metadata` + screenshot: the parent dashboard frame (1200px, 1136px content inside 32px gutters) stacks four full-width sections top-to-bottom — Charts (Yield History, ~1136px), Statement of Financial Position (Balance Sheet, full width with an internal Assets|Liabilities 2-column split), Loan Book (`3283-14431`, 1136px), Withdrawal Queue (`3283-14275`, 1136px). The current `md:grid-cols-2` 2×2 grid is a #716 shell approximation; the #716 exec plan explicitly flagged it as a "sensible default" to reconcile against `3283-12098` once real panels land — which is now.
- **The design intent implies all four panels are full-width, not just Panel B.** The narrow literal reading of #728 ("let Panel B span the full row") would leave A/C/D in a 2×2 grid that does not exist in the design. Making only Panel B span full width is the minimal fix that satisfies #728's stated acceptance criteria; making the whole dashboard a full-width stack matches Figma exactly. This decision affects whether A/C/D move and could brush against sibling issues' framing — see **Open Questions**.
- **`md` breakpoint contract.** Mobile (below `md`, 768px) is already a single-column stack (`grid-cols-1`); both candidate approaches preserve that — a full-width stack is single-column at every width, and a "Panel B spans full row" grid keeps `grid-cols-1` on mobile. No mobile regression either way. The internal mobile treatments of `LoanBookSummary` (horizontal scroll strip) and `LoanBookTable` (stacked cards) are untouched.
- **JSDOM has no real layout**, so the "no horizontal scroll, all 7 columns visible" acceptance criterion cannot be asserted in a unit test — it is verified visually against Figma (see Test Strategy / Figma verification). Unit tests cover the grid class structure only.
- **Risk: the existing test asserts `md:grid-cols-2`.** Whichever approach is chosen, `-dashboard.test.tsx` line ~206–211 ("lays out a responsive grid: single column on mobile, two columns at md+") must be updated to match the new structure, or it will fail. This is expected and in scope.

## Open Questions

1. **Should the fix make only Panel B full-width within the kept 2×2 grid, or convert the whole dashboard to the full-width single-column stack that Figma `3283-12098` actually shows?** The issue body is scoped "layout/width only" and phrases the fix as "let the Loan Book panel span the full dashboard row," which reads as Panel-B-only. But the authoritative Figma frame has no 2×2 grid at all — all four panels are full-width sections stacked vertically. Recommended: match Figma (full-width stack for all four), because a half-and-half grid for A/C/D is not in the design and would just reintroduce the same squeeze problem for the other multi-column panels (Balance Sheet's Assets|Liabilities split, Withdrawal Queue's wide table) as they get wired up. If the manager/human wants to keep #728 strictly minimal and defer the A/C/D re-flow to a separate issue, the plan's Step 2b (Panel-B-only) is the fallback. Need a decision before implementation since the two produce materially different grids and the coder must update the route + test to one of them.

## Implementation Steps

1. ~~**Branch.** Create `fix/728-loan-book-full-width` off current `main`.~~ ✅ Branch `feat/728-loan-book-full-width` already created.

2. ~~**Change the dashboard grid in `packages/frontend/src/routes/dashboard.tsx`**~~ ✅ Done — Approach 2a implemented (full-width single-column stack, source order preserved: Balance Sheet → Loan Book → Withdrawal Queue → Yield History). Grid class changed from `"grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8"` to `"grid grid-cols-1 gap-6 md:gap-8"`. Panel DOM order preserved per manager instruction. (the `data-testid="dashboard-grid"` container, currently `className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8"` wrapping `<BalanceSheetPanel/> <DeploymentMonitorPanel/> <WithdrawalQueuePanel/> <YieldHistoryPanel/>`). Implement the option chosen in Open Question 1:

   - **2a — Recommended (full-width stack, matches Figma `3283-12098`):** Replace the grid with a single-column flex/`grid-cols-1` stack at all breakpoints so every panel is full content width. Order the panels to match the Figma frame's top-to-bottom order: **Yield History (charts) → Balance Sheet → Loan Book → Withdrawal Queue.** Keep `gap-6` on mobile stepping to `md:gap-8` (the frame's section spacing). Each panel already fills its container width via `PanelContainer`'s `Card`, so no per-panel width class is needed.
     - Note: reordering panels in the JSX is a layout/structure change consistent with the design and the issue's "spell out the resulting grid arrangement" instruction; it is NOT the tab/card *content* ordering owned by #726. If the manager prefers to keep DOM order untouched to avoid any perceived overlap with #726, a CSS-only stack that preserves the current A→B→C→D source order is acceptable as a fallback — call this out in the PR.

   - **2b — Fallback (Panel-B-only full row, keeps 2×2 grid for A/C/D):** Keep `md:grid-cols-2` but make `<DeploymentMonitorPanel/>` span both columns via `className="md:col-span-2"` (or wrap it so the grid item gets `col-span-2`). `PanelContainer` already accepts `className` and forwards it onto the `Card`, so pass `className="md:col-span-2"` to `DeploymentMonitorPanel` and thread it through to `PanelContainer`. Mobile stays `grid-cols-1`. This satisfies #728's literal acceptance criteria (Loan Book full-width) while leaving A/C/D arrangement for a future issue.

3. ~~**Update the layout doc comment**~~ ✅ Done — updated to describe the full-width single-column stack, cites Figma `3283-12098`, removes "two-column" wording, references Issue #728.

4. ~~**No changes to** `DeploymentMonitorPanel.tsx`, etc.~~ ✅ Confirmed — no panel internal changes made.

5. **Lint.** Run `npx tsx scripts/lint-docs.ts` (docs structure) and the frontend type/lint check (`yarn workspace @pipeline/frontend lint` / `tsc`) per AGENTS.md. Fix any errors before finishing.

## Test Strategy

Tests live in `packages/frontend/src/routes/-dashboard.test.tsx`.

1. **Update the existing grid-structure test** ("lays out a responsive grid: single column on mobile, two columns at md+", ~line 206). Replace its assertions to match the chosen approach:
   - Approach 2a: assert the `dashboard-grid` container is a single-column stack at all widths (e.g. `grid-cols-1` present, `md:grid-cols-2` **absent**), and that all four panel `data-testid`s render. Optionally assert panel DOM order if step 2 reorders them.
   - Approach 2b: assert `md:grid-cols-2` is still present on the grid AND that the deployment-monitor panel (`dashboard-panel-deployment-monitor`) carries `md:col-span-2`.
2. **Keep all other existing tests green** — panel titles, the three "Coming soon" placeholders, the DeploymentMonitorPanel loading/error/empty/ready/tab-bar/responsive tests (these assert Panel B internals, which this change does not touch).
3. **Run the suite:** `yarn workspace @pipeline/frontend test` (vitest) and confirm green.
4. **Figma visual verification (acceptance criterion — cannot be unit-tested in JSDOM):** Run the app (`/dashboard` against the stage API per the issue: `VITE_API_BASE_URL=https://api.pipeline.stage.eqlab.net`) at the desktop width and confirm against Figma `3283-14431`: (a) the 5 summary cards spread across the full width with single-/two-line labels (no 3-line wrapping), and (b) all 7 table columns (Borrower/Commodity, Principal, Collateral, LTV, Duration, Rate, Protection) are visible with **no horizontal scroll** inside the panel. Also resize below `md` (≤402px) and confirm the mobile single-column stack and the panel's internal mobile treatments (summary scroll strip + stacked table cards) are intact. This visual check is the definitive sign-off for the bug; record it in the PR description.

## Docs to Update

- **`packages/frontend/src/routes/dashboard.tsx` doc comment** — update the layout description (done in Implementation Step 3).
- **No product-spec change.** `docs/product-specs/dashboards.md` describes the four panels' data/content, not grid layout; this is a pure CSS/layout fix with no behavior change.
- **No `docs/frontend/` catalogue change** — no new util or shared hook is introduced.
- If approach 2b is chosen and a `className` prop is added to `DeploymentMonitorPanel`, that is a local prop, not a shared API; no catalogue entry needed.
