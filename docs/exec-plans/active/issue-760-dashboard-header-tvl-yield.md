# Issue #760: Protocol Dashboard: wire header summary strip + TVL/yield series to new /v1/dashboard/* endpoints

Source: https://github.com/eq-lab/pipeline/issues/760

## Scope

Frontend-only. Sub-issue of epic #712. Backend is already delivered (#751, closed) —
three endpoints live in `packages/api/src/routes/dashboard.rs`.

**In scope**

1. **TVL card (header summary strip, left column of the "Top" row).** New component
   rendering, from `GET /v1/dashboard/summary`:
   - eyebrow "TVL" + headline `tvl` (e.g. `$43.14M`);
   - "Outstanding in Loans" label + `outstanding_in_loans` value (muted), right-aligned;
   - a horizontal progress bar + a "…% deployed" caption **(see Open Questions — the
     percentage is not a backend-served field)**;
   - a TVL time-series bar chart backed by `GET /v1/dashboard/tvl-history`.
2. **Cumulative-yield re-wire.** Back the existing Cumulative Yield card's series with
   the dedicated `GET /v1/dashboard/yield-history` endpoint (`[{ timestamp, cumulative_yield }]`)
   instead of the derived `/v1/stats/yield` `accrued` series from #720. The headline value
   comes from `summary.cumulative_yield_total` (final point equals the last series point).
3. **Metric-card re-wire (optional, see below).** The two live metric cards ("Current APY,
   Net to sPLUSD", "Loan Book Yield") should read `summary.current_apy_net_to_splusd` and
   `summary.loan_book_yield` from `/v1/dashboard/summary` — the spec explicitly notes the
   current mapping of "Current APY" to `/v1/stats` `vaults[].apy` is a placeholder to be
   switched to the effective-haircut rate (tracked on #712). "Target Net to sPLUSD" stays
   the static `"8–12%"` label.
4. Loading / empty / error states via the existing `PanelLoading` / `PanelError` /
   `PanelEmpty` primitives (through `PanelContainer`); render `—` for `null` fields; no
   client-side metric derivation.
5. Wallet-less: `chain_id` defaults to `ENV.EVM_CHAIN_ID`; keep the existing zero-address
   vault guard behaviour where relevant. The page pulls no wallet hooks.

**Out of scope**

- Any backend change (done in #751).
- The **loan-vs-T-bill yield split** — cumulative-minted-by-source, real-time T-bill
  accrual, trailing-30d loan/T-bill breakdown. `/v1/dashboard/yield-history` is a single
  **blended** net-minted series; the split remains gated on the still-open backend issue
  **#738**. Keep the labelled `#738` seams from #720; do not fabricate the split.
- Exchange-rate history (Panel D spec item) — no endpoint; not in this issue's scope.

## Layout finding (Figma) — this is a re-shape of the existing Yield panel, not a bolt-on

Figma frame **`3283:67619` "Top"** (1136×460, first child of the white container
`3283:12101`, above Balance Sheet / Loan Book / Withdrawal Queue) is a **two-column row**:

- **Left** — `card-horizontal` `3283:67622` (560 wide): the **TVL card**
  - `3283:67623` header container (528×56): "TVL" heading + `$43.14M` headline (`3283:67626`)
    on the left half (264 wide); "Outstanding in Loans" + `$31.6M` (`3283:67629`) on the
    right half (264 wide, muted / right-aligned).
  - `3380:1410` progress-bar instance (528×4), y=64.
  - `3380:1895` "73.3% deployed" caption (Caption token), y=76.
  - `3283:67630` Chart Container (528×240): dark (ink-fill) TVL bar chart.
- **Right** — `Frame 1` `3380:1920` (560 wide): the **Cumulative Yield card** `3283:68333`
  (green bar chart, already implemented) **plus** the 3 metric cards `3380:1921`
  (`3380:1922` / `3380:1931` / `3380:1940`).

The current `YieldHistoryPanel` already renders the entire right column, and stubs the left
column with a `data-testid="yield-tvl-placeholder"` "TVL chart — Coming soon" card. So the
work is: **replace that placeholder with the real TVL card and wire the two new series +
summary.** Do this by extending the existing panel (recommended) rather than adding a
disconnected header component, because the Figma "Top" frame is a single row that pairs TVL
with Cumulative Yield side-by-side.

**Tokens (from `get_variable_defs` on `3283:67619`):** headline = Heading M (Besley,
28/36 → `--text-pipeline-heading-m`, step down to `-heading-m-mobile` below `md`, matching
the existing card); eyebrow/label + "deployed" caption = Caption (Graphik LC 12/16 →
`--text-pipeline-caption`, `--color-pipeline-ink-muted`); card gaps `size-16` (16px);
section gap `gap-xxl` (96px, already `md:gap-24` on the route). TVL chart bars are **dark**
(ink), distinct from the green yield bars — reuse `YieldBarChart` with
`fill="var(--color-pipeline-ink)"` (there is no dedicated dark-chart token; flag if a token
is preferred). "Outstanding in Loans" value colour is muted grey in the render.

## Assumptions and Risks

- **Deployment percentage is derived.** The "73.3% deployed" caption and the progress-bar
  fill are `outstanding_in_loans / tvl` — a client-side ratio the backend does not serve.
  This collides with the project rule "no frontend-computed metrics; render `—` for missing
  data" (MEMORY: no-frontend-computed-metrics; issue text: "no client-side derivation of
  metrics"). See Open Questions — the plan does **not** assume we may compute it.
- `/v1/dashboard/tvl-history` and `/v1/dashboard/yield-history` use the same `days` /
  `interval` / `MAX_SAMPLES=1000` contract as `/v1/stats/yield`, so the existing
  `periodToQuery` util (`@/utils/statsPeriod`) maps the SegmentedTabs period ids to query
  params 1:1. `"all"` omits `days` and uses `weekly` to stay under the cap. No-events →
  `200 []`.
- `/v1/dashboard/summary` takes **only** `chain_id` (`ChainQuery`), while the two series
  endpoints take `chain_id` + `days` + `interval` (`DashboardSeriesQuery`). Do not send
  `days`/`interval` to `/summary`.
- The zero-address vault guard in `useYieldHistoryPanel` gates network calls in local dev.
  The new dashboard endpoints are **protocol-level** (not vault-scoped) — they need no vault
  address. Decide whether to keep gating the whole panel on the zero-vault sentinel or fetch
  the dashboard series regardless. Recommendation: fetch summary + the two series
  unconditionally (they are cheap, wallet-less, and the panel's empty state already handles
  `200 []`), and drop the `/v1/stats/yield` + `/v1/stats/prices` dependencies that motivated
  the vault gate. Confirm no other consumer relies on the removed queries.
- Amounts are base-6 decimal strings already in human units → `formatCompactUsd`. Rates are
  decimal-fraction strings → `formatOneDecimalRate`. `cumulative_yield` / `tvl` series values
  are base-6 human-unit strings (same as `accrued`), so `yieldSeries` bar mapping applies
  directly after adding a small adapter (the new series field names differ: `cumulative_yield`
  / `tvl` vs `accrued`).
- Removing the `/v1/stats/yield` dependency changes the panel's headline source. The headline
  must now come from `summary.cumulative_yield_total`, not the last chart bar, so the number
  matches the KPI even when the chart resamples/aggregates.
- QA/verification: this is the `frontend` flow (no ux-tester phase); Figma verification is
  by screenshot comparison during implementation. The epic-level QA pass (#712 `qa`
  sub-issue) will exercise the rendered page later.

## Open Questions

- **How should the "…% deployed" progress bar be sourced?** `/v1/dashboard/summary` serves
  `tvl` and `outstanding_in_loans` but **no** deployment-ratio field. The project rule is
  "surface only backend-served values, no client-side metric derivation." Options: (a) treat
  the progress bar + "% deployed" caption as a *visualisation of two served values* (ratio of
  two backend numbers rendered as a bar) rather than a "computed metric", and render it; or
  (b) render the bar only when both values are present and show the caption as `—% deployed`
  / omit it otherwise; or (c) omit the progress bar + caption entirely until the backend
  serves a `deployed_ratio` field, and file a backend follow-up. Which interpretation does the
  team want? (This is the one decision I cannot make alone; it determines whether the header
  matches Figma pixel-for-pixel now.)
- **Should the two live metric cards switch to `/v1/dashboard/summary` in this issue?** The
  spec says the "Current APY" → `/v1/stats vaults[].apy` mapping is a placeholder to be
  switched to the effective-haircut `current_apy_net_to_splusd` (tracked on #712), and
  #760's scope is "consume the three new endpoints." Confirm switching both metric cards
  (`current_apy_net_to_splusd`, `loan_book_yield`) to `/summary` here is intended, vs.
  leaving them on `/v1/stats` + `/v1/loan-book` and only wiring TVL + the yield series.
  (Recommendation: switch them — it removes two extra fetches and matches the endpoint the
  spec designates as authoritative. Proceeding with the switch unless told otherwise.)

## Implementation Steps

1. **API types + hooks** (`packages/frontend/src/api/`):
   - Add `useDashboardSummary.ts` — `GET /v1/dashboard/summary?chain_id`. Response type
     `DashboardSummary { tvl: string; outstanding_in_loans: string | null;
     current_apy_net_to_splusd: string | null; loan_book_yield: string | null;
     cumulative_yield_total: string }`. `refetchInterval: 30_000` (dashboard poll convention,
     FRONTEND.md "Real-time updates"). Mock-key doc comment `pipeline.mock.api.GET./v1/dashboard/summary`.
   - Add `useDashboardTvlHistory.ts` — `GET /v1/dashboard/tvl-history?days&interval&chain_id`.
     Response `TvlPoint[] = { timestamp: string; tvl: string }[]`. Params `{ chainId, periodId }`;
     build query with `periodToQuery(periodId)` + `chain_id`. `refetchInterval: 30_000`.
   - Add `useDashboardYieldHistory.ts` — `GET /v1/dashboard/yield-history?days&interval&chain_id`.
     Response `YieldPoint[] = { timestamp: string; cumulative_yield: string }[]`. Same param
     shape as TVL history.
   - Export all three hooks + their types from `packages/frontend/src/api/index.ts`.
   - Follow `useStatsYield.ts` structure exactly (React Query, `apiFetch`, `URLSearchParams`,
     `enabled` param). Do not call `fetch` outside `src/api/`.
2. **Series adapter util** (`packages/frontend/src/utils/`):
   - The existing `yieldSeries.ts` (`accrualToBars`, `latestAccrued`) is keyed to
     `SampleYieldItem.accrued`. Add a generic mapper (or generalise `accrualToBars`) so a
     `[{ timestamp, value }]`-shaped series maps to `YieldBarPoint[]`. Suggested:
     a small `pointsToBars(points: {timestamp: string; value: string}[]): YieldBarPoint[] | null`
     helper, with `cumulative_yield` and `tvl` mapped to `value` at the call site. Reuse the
     same normalise-to-max + `YIELD_CHART_N` resample logic. Keep `accrualToBars` as a thin
     wrapper if #720 tests still depend on it, or migrate its callers.
   - Per FRONTEND.md rule 3 (+ rule 4 catalogue): ship a unit test in the same commit and add
     the util to `docs/frontend/utils.md`.
3. **TVL card component** (`packages/frontend/src/components/dashboard/`):
   - New `TvlCard.tsx` (view, JSX only) + `useTvlCard.ts` (logic hook, FRONTEND.md rule 2) —
     or fold the logic into the panel hook (step 5) if the panel already owns all state.
     Renders: "TVL" eyebrow + headline (`formatCompactUsd(summary.tvl)`); "Outstanding in
     Loans" label + `formatCompactUsd(summary.outstanding_in_loans)` (muted, right-aligned,
     `—` when null); the progress bar + "% deployed" caption **per the resolved Open
     Question**; and `<YieldBarChart bars={tvlBars} fill="var(--color-pipeline-ink)" />`
     (dark bars) inside a `h-[144px]` (mobile) container matching the yield chart footprint.
   - Card chrome: reuse the asymmetric-depth-border `card-horizontal` treatment already used
     by the Cumulative Yield card and `MetricCard` (border-t/l 1px + border-r/b 3px, radius
     `--radius-pipeline-card`, `bg-pipeline-surface`, `p-4`). `data-testid="dashboard-tvl-card"`,
     `data-node-id="3283:67622"`.
4. **Progress bar**: check `packages/ui` for an existing `progress-bar` primitive (Figma
   instance `3380:1410`). If one exists, reuse it; otherwise render a simple two-layer div
   (track `bg-pipeline-line`, fill `bg-pipeline-ink` sized by the resolved ratio). No new
   design token unless the review requires one. Gate the fill/caption on the Open-Question
   decision.
5. **Re-wire the panel** (`YieldHistoryPanel.tsx` + `useYieldHistoryPanel.ts`):
   - In the hook: replace `useStatsYield` with `useDashboardYieldHistory`, add
     `useDashboardTvlHistory` and `useDashboardSummary`. Derive `cumulativeBars` from the
     yield-history series via the new adapter; set `headlineValue =
     formatCompactUsd(summary.cumulative_yield_total)`. Derive `tvlBars` from the TVL series;
     expose `tvlSummary` (tvl, outstanding, deployed-ratio-or-null). Map metric cards to
     `summary.current_apy_net_to_splusd` + `summary.loan_book_yield` (pending Open Question 2);
     keep `TARGET_NET_APY_STATIC`. Remove `useStatsPrices` / `exchangeRateBars` (no
     exchange-rate chart in the "Top" frame — the second card is TVL, not exchange rate) —
     confirm nothing else consumes it.
   - Recompute loading/empty/error: `loading` while summary or either series is loading;
     `error` if summary or either series errors (surface `.message`); `empty` when the series
     are `[]` AND summary values are all null/zero. Preserve the zero-vault short-circuit only
     if step-2 Open Question keeps it; otherwise drop it (these endpoints are protocol-level).
   - In the view: replace the `yield-tvl-placeholder` block with `<TvlCard … />` as the left
     card of the existing `md:flex-row` chart-cards row; keep the Cumulative Yield card and
     the 3-metric row unchanged in structure. Preserve existing `data-testid`s
     (`yield-cumulative-card`, `yield-headline-value`, `yield-metric-*`,
     `yield-metric-cards`) so `-dashboard.test.tsx` keeps passing; add
     `dashboard-tvl-card` + a TVL headline testid.
   - Update the panel/route doc comments: the "TVL chart — Coming soon" placeholder note and
     the `#738`-for-TVL claim are now stale (TVL shipped); keep the `#738` seam note only for
     the yield **split** (by-source / T-bill / trailing-30d), which is still gated.
6. **Route** (`packages/frontend/src/routes/dashboard.tsx`): no structural change required —
   `<YieldHistoryPanel />` remains the first section and now renders the full "Top" row
   (TVL + Cumulative Yield + metrics). Update the route doc comment's "Yield History (no
   section heading)" note to reflect that this section is the Figma "Top" summary strip.
   If the team prefers a dedicated `<DashboardHeader />` component over extending the panel
   (a naming/altitude choice), that is an acceptable alternative — but it must render the same
   single Figma "Top" row, not a separate strip stacked above the yield card.
7. **Lint**: run `npx tsx scripts/lint-docs.ts` (docs structure) after editing
   `docs/frontend/utils.md`; ensure TypeScript build + ESLint pass (`no-restricted-globals`
   forbids direct `fetch`; keep all fetching in `src/api/`).

## Test Strategy

- **`useDashboardSummary` / `useDashboardTvlHistory` / `useDashboardYieldHistory`** — add
  `*.test.tsx` per hook mirroring `useStatsYield.test.tsx` / `useLoanBook.test.tsx`: use the
  `pipeline.mock.api.*` localStorage mock layer; assert URL/query construction (`chain_id`
  present; `days`/`interval` present for the series hooks and absent for `/summary`; `"all"`
  omits `days`), success parse, and error propagation.
- **Series adapter** (`pointsToBars`) — unit test in `utils/`: empty/`undefined` → `null`;
  all-zero → `null`; normalises heights to max; resamples to `YIELD_CHART_N`; ignores
  non-finite/negative values; single-point series handled.
- **`useYieldHistoryPanel.test.tsx`** — update fixtures to the new endpoints:
  - `loading` while any of the three queries is in flight;
  - `error` when summary or a series errors (message surfaced);
  - `empty` when both series are `[]` and summary is all-null;
  - `ready`: headline = `formatCompactUsd(cumulative_yield_total)`; `cumulativeBars` and
    `tvlBars` populated; metric cards map to summary fields (or the current sources, per Open
    Question 2); `—` for null summary fields; deployed-ratio behaviour per Open Question 1.
- **Route test** (`routes/-dashboard.test.tsx`) — keep existing assertions green; add a
  smoke assertion that the TVL card renders (`dashboard-tvl-card`) and the placeholder testid
  (`yield-tvl-placeholder`) is gone.
- **Figma verification** (frontend flow, no ux-tester): run the frontend, navigate to
  `/dashboard`, screenshot the "Top" row and compare against Figma `3283:67619` — TVL
  headline + "Outstanding in Loans" placement, progress bar + "% deployed" caption, dark TVL
  bars vs green yield bars, the 3 metric cards, and the desktop side-by-side / mobile stacked
  responsive behaviour. Verify `—` rendering by mocking null summary fields.
- Run `yarn workspace @pipeline/frontend test` (or repo test skill) for the unit/integration
  layer.

## Docs to Update

- `docs/frontend/utils.md` — catalogue the new series adapter util (FRONTEND.md rule 4),
  same commit as the util + its test.
- `docs/product-specs/dashboards.md` — the "Protocol Dashboard — Header" section already
  documents the three endpoints and fields; add a short note that the **frontend now
  consumes** them (TVL card + re-wired cumulative-yield series), and update the Panel D note
  that previously implied the cumulative series was derived from `/v1/stats/yield`. If Open
  Question 1 resolves to "omit the deployed %", note that the deployment ratio awaits a
  backend field.
- If the deployment-ratio Open Question resolves to "needs a backend field", file a backend
  follow-up issue (do not implement here) and reference it as a labelled seam in the code.
- No `ARCHITECTURE.md` change (no new domain boundary or dependency direction).
```
