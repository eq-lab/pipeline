# Issue #389: Replace home Portfolio chart silhouette with stacked-bars monotonic-growth interactive chart

Source: https://github.com/eq-lab/pipeline/issues/389

## Scope

Replace the static decorative bar-chart silhouette inside `PortfolioPlaceholderCard` (`packages/frontend/src/components/PortfolioPlaceholderCard.tsx`, home connected state, top-left slot) with an interactive **stacked-bars monotonic-growth** chart prototyped in `docs.local/stacked_bars_natural_monotonic_growth.html`. The new chart must:

- Render 100 stacked tri-rect bars (widths 3 / 2 / 1, heights 30% / 60% / 100% of bar height) coloured with the design-system positive token.
- Compute a deterministic procedurally-generated monotonic-growth balance curve per selected period (`7D / 1M / 3M / 1Y / All`), using the prototype's `periods` map and growth algorithm verbatim (so values match the prototype's behaviour).
- Expose a vertical hover cursor + tooltip showing the balance and a period-appropriate timestamp at the hovered slot, clamped inside the chart bounds.
- Drive a `+$X earning` caption in the card header (next to the balance) that updates with the selected period.
- Keep the `$0.00` balance literal until the aggregation endpoint exists (per the issue body: values remain placeholder).
- Remain a placeholder — **no API calls**, no React Query usage. The synthetic generator is the data source until a real aggregation endpoint ships.

In scope:

- Rewrite the chart body inside `PortfolioPlaceholderCard.tsx`.
- Add an internal balance-history generator + chart hover state managed via a co-located `usePortfolioChart` hook (per `docs/FRONTEND.md` "view + co-located hook" rule).
- Wire period selection to re-render the chart and update the earning caption.
- Update tests (`PortfolioPlaceholderCard.test.tsx`) to cover the new behaviour.
- Update `docs/STORIES.md` story TC-250-2 / TC-250-3 (or add new TC-389-* test cases) so manual UX testing reflects the new behaviour, including hover + tooltip + earning caption.
- Update the JSDoc at the top of `PortfolioPlaceholderCard.tsx` to describe the new chart and its placeholder rule.

Out of scope (explicitly excluded by the issue body):

- Backend / aggregation endpoint for real balance history.
- Extracting a reusable `<Chart>` primitive into `@pipeline/ui` (defer until a second consumer appears).
- Disconnected state — `ConnectWalletPromoCard` is unchanged.
- Replacing `$0.00` with a real per-period balance figure (caption updates; balance stays `$0.00`).

## Assumptions and Risks

- **Design-token mapping.** Open Question 1 below assumes `--color-pipeline-positive` (`#1a6600`) is the right token for the bars in lieu of the prototype's raw `#2D7B1F`. The hues are close enough that the visual character (saturated dark green) is preserved.
- **Card surface.** Open Question 2 below: the prototype's `#F4F6E0` is hardcoded, while the existing card uses `Card variant="yellow"` (`--color-pipeline-promo` = `rgb(211 235 117 / 0.16)`). These render very differently against the white parent card. We keep `variant="yellow"` (the issue's "Card grid layout does not shift" criterion implies the surface stays).
- **`$0.00` balance vs. prototype.** Prototype shows `$1,042.80` and `+$42.80 earning`. The issue explicitly states "Values remain placeholder until the aggregation endpoint exists", so the displayed balance stays `$0.00` while the earning caption uses the prototype's per-period synthetic value. This is an intentional inconsistency that callers must accept — the earning caption is a visual demo of the interaction, not a real number.
- **No touch support.** Mouse-only hover (per prototype) is acceptable; touch is a "TBD" in the issue (Open Question 6). We default to mouse-only and log a tech-debt entry if needed.
- **SegmentedTabs prop shape.** `SegmentedTabs` is already used here; we keep its `{ tabs, activeId, onSelect }` API and route `onSelect` through the hook so the chart and caption update together.
- **Determinism.** The prototype's growth curve is deterministic given a period (no `Math.random`); the only time-dependent value is the timestamp axis, which is anchored to `Date.now()` at render time. Snapshots in tests will need to mock `Date.now` if they assert timestamps, but most tests will assert structural behaviour (number of bars, tab switching, hover, etc.) rather than exact pixel positions.
- **Risk: pointer math on resize.** The prototype reads `wrap.getBoundingClientRect()` on every `mousemove`, which works because the chart is responsive. We mirror that — no extra `ResizeObserver` needed.
- **Risk: accessibility.** The current card has `aria-hidden="true"` on the chart. With interactivity we will expose a `role="img"` with an `aria-label` describing the current trend (period + earning) and keep the bars themselves decorative. A more elaborate hidden data table is deferred (Open Question 5).
- **Risk: tests rely on `aria-hidden='true'`.** The existing test `chart wrapper has aria-hidden='true'` (lines 113-120 of `PortfolioPlaceholderCard.test.tsx`) will need to be replaced — the new chart is interactive and must NOT be hidden from assistive tech.

## Open Questions

1. **Bar colour token.** Use `--color-pipeline-positive` (`#1a6600`) — the closest existing token. Acceptable, or do we need a dedicated `--color-pipeline-chart-positive` matching the prototype's lighter `#2D7B1F`?
2. **Earning caption colour.** Should the `+$X earning` caption reuse `--color-pipeline-positive`, or stay neutral (`--color-pipeline-ink-muted`)? Prototype uses the green; recommendation: `--color-pipeline-positive` so the gain reads as positive.
3. **Accessibility depth.** Is an `aria-label` with the current period and earning sufficient, or do we also need a hidden `<table>` of the 100 data points for screen-reader parity? Recommendation: `aria-label` only — the chart is placeholder data; a 100-row table is noise.
4. **Touch / mobile interaction.** Mouse-only (matches prototype) acceptable for the placeholder phase, or do we add touch-drag tooltip support now? Recommendation: mouse-only; log a tech-debt note for future touch support.
5. **Snap behaviour at edges.** Prototype clamps the tooltip horizontally to keep it inside the chart but does not clamp the cursor line. Keep that asymmetry, or also clamp the cursor to the nearest slot's centre? Recommendation: keep prototype behaviour verbatim.

## Implementation Steps

1. **Add a co-located hook** `packages/frontend/src/components/usePortfolioChart.ts` exporting `usePortfolioChart()` that owns:
   - `activeId: string` and `setActiveId(id)` (default `"7d"`).
   - A `periods` map keyed by tab id with `{ days, earning, fmt }` matching the prototype:
     - `7d`  → `{ days: 7,   earning: 42.80,  fmt: "datetime" }`
     - `1m`  → `{ days: 30,  earning: 92.80,  fmt: "date" }`
     - `3m`  → `{ days: 90,  earning: 192.80, fmt: "date" }`
     - `1y`  → `{ days: 365, earning: 542.80, fmt: "month" }`
     - `all` → `{ days: 730, earning: 842.80, fmt: "month" }`
   - `endBalance = 1042.80` and growth-curve generator (verbatim port of the prototype's `render(period)` math): produces `balances[]`, `heights[]`, `timestamps[]` for `N = 100` bars.
   - Hover state: `{ idx: number | null }` and a `onPointerMove(event, rect)` / `onPointerLeave()` API that maps a pointer X to the nearest slot index.
   - Derived values: `earning` (from `periods[activeId]`), `tooltip = { balance, timestamp } | null` computed from `idx`.
   - Helpers (also exported for unit tests): `generateCurve(period, now?)` (pure function — takes a `now` for deterministic tests), `formatMoney(n)`, `formatTime(ts, fmt)`. The `now` parameter defaults to `Date.now()`.
   - No React Query, no API calls, no localStorage reads.
2. **Rewrite `packages/frontend/src/components/PortfolioPlaceholderCard.tsx`** to:
   - Import and call `usePortfolioChart()` for state and derived data.
   - Render the header with three lines in the left stack:
     - `Total Balance` eyebrow (unchanged).
     - `$0.00` heading (unchanged).
     - `+$X earning` caption immediately below the balance, using `--color-pipeline-positive` (subject to Open Question 2).
     - Keep `Get PLUSD to start` link as a fourth line (per the issue's recommendation in Open Question 4 of the body).
   - Keep `SegmentedTabs` in the top-right (unchanged props except `onSelect` now wires through the hook).
   - Replace the static `<svg>` body with a responsive `<svg viewBox="0 0 680 120" preserveAspectRatio="none">` wrapper that renders 100 tri-rect groups from the hook's `heights[]`. Use `var(--color-pipeline-positive)` as the fill.
   - Wrap the `<svg>` in a `<div className="bal-wrap" ref={wrapRef}>` with `onPointerMove` / `onPointerLeave` handlers, forwarding the event + `wrapRef.current.getBoundingClientRect()` to the hook. The wrap is `position: relative` so the absolute cursor / tooltip overlays sit correctly.
   - Render an absolutely-positioned vertical cursor line (`<div>`) and a tooltip (`<div>`) whose `left` is computed in the component from `idx`, mirroring the prototype's clamp logic (`half = 70`). Cursor + tooltip are hidden when `idx === null`.
   - Add `role="img"` + `aria-label={`Total balance for ${periodLabel}: $0.00 (+${formatMoney(earning)} earning)`}` on the chart wrap. Remove the chart's `aria-hidden="true"`.
   - Replace the JSDoc block (lines 5-45 of the current file) with a description of the new chart, its placeholder rule, and the placement of the earning caption.
3. **Tooling alignment.** No new dependencies. Use plain React + SVG (no `d3`, no `recharts`); the prototype's algorithm is < 30 lines.
4. **Tokens.** Use `var(--color-pipeline-positive)` for bars and the earning caption (pending Open Question 1 / 2). Keep the card surface at `Card variant="yellow"`. Tooltip: `bg-[var(--color-pipeline-ink)]` (`#262524`) + `text-[var(--color-pipeline-on-dark)]` to match the prototype's `#0a0a0a` / `#fff`.
5. **Update tests** `packages/frontend/src/components/PortfolioPlaceholderCard.test.tsx`:
   - Keep: renders without throwing; `Total Balance` eyebrow; `$0.00` heading; `Get PLUSD to start` link → `/deposit`; default tab `7D` aria-selected; other tabs inactive; clicking `1M` switches active tab.
   - Replace: `chart wrapper has aria-hidden='true'` with `chart wrapper has role="img" and a descriptive aria-label`.
   - Add: `clicking '1M' updates the earning caption from '+$42.80 earning' to '+$92.80 earning'`.
   - Add: `clicking 'All' updates the earning caption to '+$842.80 earning'`.
   - Add: `chart renders 100 bar slots` (assert 100 `<g data-bar-slot>` or 300 `<rect>` if we tag them; pick one and document).
   - Add: hover behaviour smoke test — fire `pointerMove` on the chart wrap and assert a tooltip element appears with `+$` and `$1,` substrings; fire `pointerLeave` and assert the tooltip is gone (`opacity-0` or removed from the DOM, whichever the implementation chooses — pick `opacity-0` toggled via `aria-hidden` so the element stays mounted and React Testing Library can find it deterministically).
6. **Add a unit test** for the pure helpers in `packages/frontend/src/components/usePortfolioChart.test.ts` (new file):
   - `generateCurve("7d", fixedNow)` returns 100 entries with `balances[99] === 1042.80` and `balances[0] === 1000.00` (start = end − earning).
   - `generateCurve("1m", fixedNow)` returns `balances[99] === 1042.80` and `balances[0] === 950.00`.
   - Heights are monotonically non-decreasing (curve is monotonic growth).
   - `formatMoney(1042.8)` → `"$1,042.80"`.
   - `formatTime(ts, "month")` returns `"<MonthName> <year>"`; `formatTime(ts, "date")` returns `"<MonthName> <day>, <year>"`; `formatTime(ts, "datetime")` returns `"<MonthName> <day>, HH:MM"`.
7. **Update `docs/STORIES.md`**:
   - Edit TC-250-2 to remove "A muted bar-chart silhouette fills the body of the card" and replace with "A 100-bar stacked monotonic-growth chart in the design-system positive green fills the body".
   - Edit TC-250-3 to swap "The chart silhouette and $0.00 balance do not change" → "The chart re-renders for the 1M period and the '+$X earning' caption updates to '+$92.80 earning'. The $0.00 balance does not change. No network request is logged."
   - Add a new section `## S-389 — Home Portfolio chart: stacked-bars monotonic-growth + hover tooltip` with test cases:
     - **TC-389-1:** Connected — chart renders 100 green stacked bars; earning caption shows "+$42.80 earning" for the default 7D period.
     - **TC-389-2:** Period switch — clicking 1M / 3M / 1Y / All updates the chart and the caption to `+$92.80 / +$192.80 / +$542.80 / +$842.80 earning` respectively; no network request fires.
     - **TC-389-3:** Hover — moving the mouse across the chart shows a vertical cursor line and a tooltip with a `$1,XXX.XX` balance + a period-appropriate timestamp; tooltip stays inside the chart bounds at the left and right edges.
     - **TC-389-4:** Mouse leave — cursor and tooltip disappear.
     - **TC-389-5:** Card grid does not reflow when switching tabs or hovering (same `min-h-[274px]`).
8. **Update `docs/FRONTEND.md` only if** the new hook is reused elsewhere; per the rule (component-local hooks following the "view + co-located hook" rule are excluded), `usePortfolioChart` stays out of `docs/frontend/hooks.md`. No catalogue updates required.
9. **Lint and tests.** Run `cd packages/frontend && yarn vitest run PortfolioPlaceholderCard usePortfolioChart`; run `npx tsx scripts/lint-docs.ts`; run repo-level lint per `AGENTS.md`.

## Test Strategy

Unit tests (`PortfolioPlaceholderCard.test.tsx` + `usePortfolioChart.test.ts`):

1. **Smoke** — renders without throwing; default state shows `Total Balance`, `$0.00`, `Get PLUSD to start` link to `/deposit`, `7D` aria-selected, others aria-not-selected.
2. **Caption present** — `+$42.80 earning` visible by default.
3. **Period switching** — clicking each non-default tab updates the earning caption to the prototype's per-period value (`92.80 / 192.80 / 542.80 / 842.80`).
4. **Chart structure** — chart wrap has `role="img"` and an `aria-label` containing the active period name and earning; bars rendered count is exactly 100 (3 rects per bar = 300 if we count rects, choose one mode and assert deterministically).
5. **Hover** — `pointerMove` on the wrap shows a tooltip with a `$1,` prefix and the slot's timestamp; `pointerLeave` hides it.
6. **Curve generator** — `generateCurve` is monotonic, ends at `1042.80`, starts at `endBalance − periods[period].earning`, returns 100 entries.
7. **Formatters** — `formatMoney`, `formatTime` cases (datetime / date / month).

Edge cases to cover:

- Hovering at `x = 0` returns slot 0 (does not throw on `floor`).
- Hovering past the right edge clamps to slot 99.
- Tooltip `left` is clamped at half-width (`70px`) from both edges.

Manual UX testing (`docs/STORIES.md`): TC-389-1 through TC-389-5 as described in step 7 above. The `ux-tester` will exercise the connected state (mock wallet) and verify the chart, tabs, caption, and hover behaviour against this plan. A Figma comparison is **not** part of this issue — the prototype HTML is the visual source of truth, not a Figma node.

## Docs to Update

- **`packages/frontend/src/components/PortfolioPlaceholderCard.tsx`** — replace the file-level JSDoc to describe the new chart + placeholder rule + a11y posture.
- **`docs/STORIES.md`** — patch TC-250-2 and TC-250-3 (chart silhouette wording); add the new S-389 section with TC-389-1…5.
- **`docs/exec-plans/active/issue-389-portfolio-stacked-bars-chart.md`** — this file, kept updated as work progresses.
- **No product-spec change required** — there is no portfolio chart specification in `docs/product-specs/`; the placeholder rule is already documented inline in the component. The aggregation endpoint that would graduate the placeholder belongs to a separate, future issue.
- **`docs/frontend/hooks.md`** — no entry (component-local hook by rule 2).
- **`docs/frontend/utils.md`** — no entry (utilities are local to `usePortfolioChart`, not lifted to `src/utils/`).
