# Issue #1133: LP dashboard + home charts: add endpoint-date x-axis labels per new Figma design

Source: https://github.com/eq-lab/pipeline/issues/1133

## Scope

Add the new x-axis treatment — a single bottom row with **two endpoint date labels** (series
start left-aligned, series end right-aligned, `MMM D` format) — to three LP charts:

1. **TVL card** — `packages/frontend/src/components/dashboard/TvlCard.tsx`, Figma node
   `3283:67622` (dates container node `6002:9267`).
2. **Cumulative Yield card** — `packages/frontend/src/components/dashboard/YieldHistoryPanel.tsx`
   (right-column card), Figma node `3283:68333` (dates container node `6002:9279`).
3. **Total Balance card** (home) — `packages/frontend/src/components/PortfolioPlaceholderCard.tsx`,
   Figma node `1497:95125` (labels track the selected period tab, e.g. "Aug 13" ⟷ "Aug 20" on 7D).

Design tokens extracted from Figma (via the local Dev Mode MCP, node `6002:9279`
"Minted Dates Container"): full-chart-width flex row, `justify-between`, height 16px,
body font (`--font-body`) regular, 12px / 16px line-height (the caption tokens), color
secondary ink `rgba(50,56,55,0.6)` → `--color-pipeline-ink-muted`; each label `flex-1`
truncating, right label `text-right`. No intermediate ticks, no gridlines.

Out of scope: any chart-body changes; the real Total Balance history (backend #1116);
trustee-app charts.

## Assumptions and Risks

- Both dashboard series already carry real timestamps: `YieldBarPoint.timestamp` (unix ms,
  `packages/frontend/src/utils/yieldSeries.ts`), sorted ascending by `pointsToBars`. Endpoint
  labels are formatted from `bars[0].timestamp` / `bars[bars.length - 1].timestamp` — served
  values, never fabricated.
- **Total Balance decision (resolves the issue's open point):** the placeholder card already
  shows window timestamps in its hover tooltip (`formatTime(tooltip.timestamp, period.fmt)` —
  existing, approved placeholder behavior from #1082/#1115). Deriving the two endpoint labels
  from the same period samples (first/last point of the active period's curve) introduces no
  new fabrication — it reuses the exact timestamps the tooltip already exposes. When #1116
  lands, the real series replaces the placeholder wholesale, labels included.
- Risk: single-point series → both labels render the same date (left and right). Accept; do
  not special-case.
- Risk: several candidate test files are pre-existing #1003-broken (`localStorage` undefined:
  `-dashboard.test.tsx`; possibly others). Verify any failure is the known TypeError on a
  clean tree before touching anything; don't fix #1003 inline.
- The two dashboard cards render bars via the shared `YieldBarChart`; the Total Balance card
  draws its own SVG curve — so the dates row must be a standalone piece, not a `YieldBarChart`
  feature.

## Open Questions

_None_ — the issue's only open point (placeholder-card dates) is resolved above: the card
already displays the same window timestamps in its tooltip, so endpoint labels from the same
samples are consistent with approved behavior, not new fabrication.

## Implementation Steps

1. ✅ **Shared dates row** — new `packages/frontend/src/components/ChartDatesRow.tsx`:
   `ChartDatesRow({ start, end }: { start: string; end: string })` rendering the Figma row
   (flex `justify-between`, caption tokens, `--color-pipeline-ink-muted`, right label
   `text-right`, both truncating). One 2–3-line header comment with a spec pointer to
   `docs/frontend/dashboard-components.md#chartdatesrow` (add that section). Render nothing
   from the callers when either label is unavailable (callers gate; the component stays dumb).
2. ✅ **Date formatting** — check for an existing `MMM D` formatter (grep `formatTime` /
   `Intl.DateTimeFormat` in `packages/frontend/src/utils/`); reuse it if one fits, otherwise
   add `formatAxisDate(tsMs: number): string` next to `yieldSeries.ts` utils using
   `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })`.
3. ✅ **TvlCard** (`TvlCard.tsx`): below the existing `YieldBarChart` block, when
   `tvlBars` is non-null and non-empty render
   `<ChartDatesRow start={fmt(tvlBars[0])} end={fmt(last(tvlBars))} />`; hidden otherwise
   (no invented dates). Add the dates-container node id (`6002:9267`) as the row's
   `data-node-id`.
4. ✅ **Cumulative Yield card** (`YieldHistoryPanel.tsx`): same pattern under its
   `YieldBarChart`, from `cumulativeBars` endpoints; node id `6002:9279`.
5. ✅ **Total Balance card** (`PortfolioPlaceholderCard.tsx`): render the row under the curve
   using the active period's first/last sample timestamps (the same series the tooltip
   reads), formatted with the shared axis formatter (not `period.fmt`, which is
   tooltip-grained). Labels update when the period tab changes.
6. ✅ **Gate**: `npx tsx scripts/lint-docs.ts`; `yarn build` + `npx tsc --noEmit` in
   `packages/frontend`; targeted vitest files; `/test-fast`.

## Post-plan additions (user-directed, same branch)

- **#1138 — Total Balance real series:** backend #1116/#1135 landed mid-implementation
  (PRs #1134/#1136/#1137), so the card now charts `GET /v1/positions/history` —
  `usePositionsHistory(periodId)` fetch owned by the home route, `buildSeries` mapping,
  `series` prop into the (still presentational) card; axis labels come from the served
  series' endpoints in that mode, placeholder-window dates otherwise.
- **Cross-year axis labels:** when the two endpoints fall in different calendar years both
  labels gain a `'YY` suffix via `formatAxisDateRange` ("Aug 20 '25" ⟷ "Aug 20 '26") —
  1Y/All tabs were showing two identical "Aug 20" labels. Same-year windows stay
  Figma-exact.

## Test Strategy

(✅ implemented: new TvlCard.test.tsx covers row/edge cases directly — `-dashboard.test.tsx` is #1003-broken; PortfolioPlaceholderCard.test.tsx gained window-endpoint + period-tab assertions. Chart heights reduced by the 16px row (TVL 240→224, cumulative mobile 144→128) so the card regions match Figma.)

- `ChartDatesRow` — tiny render test (left/right text, testids) or cover via card tests only
  (coder's call; avoid over-testing a dumb row).
- TvlCard / YieldHistoryPanel tests (extend the existing dashboard component/hook test files
  that currently run): with a non-empty series, the row shows the first/last timestamps
  formatted `MMM D`; with `tvlBars`/`cumulativeBars` null → no dates row in the DOM.
- `PortfolioPlaceholderCard.test.tsx`: endpoint labels present and change with the period tab
  (e.g. 7D vs 1M produce different start labels); assert they equal the first/last sample
  timestamps formatted, not hard-coded strings (the curve timestamps derive from "now").
- Edge cases: single-point series (both labels equal — assert no crash), empty series (row
  absent).
- #1003 caveat: if a target test file fails wholesale with the jsdom `localStorage`
  TypeError, verify it does so on a clean tree and leave it; put the assertions in the files
  that run.
- Visual/token verification against the three Figma nodes is the ux-tester pass.

## Docs to Update

- `docs/frontend/dashboard-components.md` — `#tvlcard` and the Yield-history/Cumulative
  Yield sections: document the endpoint-dates row (source: series first/last timestamps,
  hidden when the series is absent); new `#chartdatesrow` section for the shared component
  (Figma nodes `6002:9267` / `6002:9279`); the Total Balance / PortfolioPlaceholderCard
  section: labels derive from the active period's samples until #1116 serves real history.
