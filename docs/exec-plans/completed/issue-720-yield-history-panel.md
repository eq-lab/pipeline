# Issue #720: Panel D: Yield History UI (charts)

Source: https://github.com/eq-lab/pipeline/issues/720

## Scope

Fill the Yield History panel (Protocol Dashboard, epic #712, Panel D) — currently a
`state="empty"` "Coming soon" placeholder at
`packages/frontend/src/components/dashboard/YieldHistoryPanel.tsx`. Build the panel
against the series the API actually serves today, using the existing SVG bar-chart
pattern from the home page (`usePortfolioChart.ts` + `PortfolioPlaceholderCard.tsx`).

**In scope (data that exists now):**

- **Cumulative Yield chart** — the "Cumulative Yield" card in Figma node `3283:68333`
  (headline value + a ~120-bar monotonically-increasing green bar chart). Backed by
  `GET /v1/stats/yield`'s `accrued` field (cumulative senior interest accrued, USDC),
  with the latest sample as the headline `$X.XXM` value.
- **Exchange-rate history** — sPLUSD → PLUSD rate over time, from `GET /v1/stats/prices`
  (`avg_price` series). The `useStatsPrices` hook already exists and is reused.
- **Trailing yield / APY metric cards** — the three stat cards below the charts in
  Figma (`Current APY, Net to sPLUSD` = 10.4%, `Loan Book Yield` = 10.9%,
  `Target Net to sPLUSD` = 8–12%). "Current APY / net to sPLUSD" maps to
  `GET /v1/stats` (`vaults[].apy`); "Loan Book Yield" maps to the `avg_yield` already
  surfaced by `GET /v1/loan-book`; "Target Net to sPLUSD" is a static product constant
  (8–12%) with no endpoint.
- A time-range `SegmentedTabs` selector (7D/1M/3M/1Y/All) wired to the yield + prices
  hooks, mirroring the home chart period map.
- Responsive layout per Figma (desktop `3283-12098`, mobile `3283-72387`).
- Loading / empty / error states via the shared `PanelContainer` + `PanelLoading` /
  `PanelError` / `PanelEmpty` primitives, plus retry.

**Out of scope (NOT served by the API — see Open Questions):**

- **Cumulative PLUSD minted split by source** (loan-repayment vs T-bill). `/v1/stats/yield`
  returns a single blended `accrued` series with no source breakdown.
- **Real-time T-bill accrual** (rolling accrued since last weekly USYC distribution).
  No field or endpoint exists.
- **Trailing-30d yield split into loan-yield vs T-bill contributions.** Only a single
  blended APY is available.

These three were the deliverables named in **#715**, which is closed/merged — but a
direct read of `packages/api/src/routes/{stats,portfolio}.rs` shows the API still exposes
only `/v1/stats`, `/v1/stats/prices`, `/v1/stats/vaults`, and `/v1/stats/yield`, none of
which carry a by-source split, T-bill accrual, or a decomposed trailing yield. This plan
builds every series the API serves today and leaves clearly-labelled seams (not fabricated
data) for the split series. See Open Questions #1.

Also out of scope: touch/mobile pointer interaction on the chart (deferred like the home
chart — tech-debt), and any backend/API changes (frontend-only issue).

## Assumptions and Risks

- **Chart approach = existing SVG pattern, no new dependency.** `packages/frontend/package.json`
  has **no charting library** (no recharts/visx/d3/nivo/etc.). The home page renders its
  chart as an inline SVG of stacked `<rect>` bars driven by `usePortfolioChart.ts`. The
  Figma Yield History chart is likewise ~120 thin vertical bars (each a `vector`/Line node
  in `3283:68337`). Plan reuses the SVG-bar approach — no library added. See Open Questions #2.
- **Non-wallet-gated page.** The dashboard renders with no wallet connected
  (`dashboard.tsx` pulls no wallet hooks). `useStatsPrices` and `/v1/stats/yield` both
  require `chain_id`, and `/v1/stats/prices` + `/v1/stats` need a `vault` address. Plan
  resolves these from `ENV.EVM_CHAIN_ID` + `ENV.STAKED_PLUSD_ADDRESS` (the EVM defaults),
  NOT from wallet kind (unlike the home route, which switches on `isStellar`). When the
  vault address is the zero sentinel or the series is empty, the panel shows the empty
  state rather than a fabricated curve. See Open Questions #3.
- **`/v1/stats/yield` returns `accrued` as a cumulative USDC 6-decimal string** and `apy`
  as a decimal fraction (verified in `portfolio.rs::SamplePoint`). `accrued` is
  monotonically non-decreasing in `t`, matching the Figma green cumulative bars.
- **Risk — headline value semantics.** Figma shows "$2.91M" for Cumulative Yield. The
  API `accrued` is *cumulative senior interest accrued*, not *PLUSD minted*. These are
  close but not identical to the spec's "cumulative PLUSD minted". Plan uses `accrued`
  (the closest served value) and labels the card "Cumulative Yield" per Figma. Flagged in
  Open Questions #1.
- **Risk — `/v1/stats/yield` full-history (`days` omitted) can 400** if the sample count
  exceeds 1000; the period→query map must pick a coarse enough interval for "All"
  (weekly), exactly as `useStatsPrices` already does.
- **Node-id caveat.** The placeholder currently claims `data-node-id="3283:67619"`, but
  `3283:67619` is the *entire top charts row* (TVL card + Cumulative Yield card + 3 metric
  cards), not the Yield History content alone. The other panels (#726/#727 Loan Book,
  Balance Sheet, Withdrawal Queue) already own their nodes and are merged. Yield History
  should re-anchor to the Cumulative-Yield card + metric cards (`3283:68333` and the
  `3380:1921` / `3283:68821` metric-card frames). See Open Questions #4.

## Open Questions

1. **Split/T-bill series unavailable despite #715 being closed.** The API serves no
   cumulative-minted-by-source, no real-time T-bill accrual, and no loan-vs-T-bill
   trailing-yield breakdown (confirmed by reading `stats.rs` + `portfolio.rs`). Do we
   (a) ship the blended `accrued`/`apy` series now and file a new backend issue for the
   split series, or (b) block #720 until a backend issue re-delivers #715's scope? Plan
   currently assumes (a).
2. **Charting approach.** No chart library exists. Plan reuses the home page's inline-SVG
   bar-chart pattern (no new dependency). Confirm we do NOT want to introduce a chart lib
   (e.g. recharts/visx) for this panel — adding one would be a significant, cross-cutting
   dependency decision.
3. **Chain/vault selection for a wallet-less protocol view.** Plan defaults to
   `ENV.EVM_CHAIN_ID` + `ENV.STAKED_PLUSD_ADDRESS`. Is EVM the correct canonical chain for
   the Protocol Dashboard, or should it aggregate/select differently (and what vault on
   Stellar)? Panel degrades to empty state on the zero-address default in local/dev.
4. **Panel ↔ Figma node mapping.** The Yield History placeholder claims node `3283:67619`
   (the full top row). Should Panel D own only the "Cumulative Yield" card + the 3 metric
   cards (`3283:68333` et al.), with the left "TVL / Outstanding in Loans" chart belonging
   to Balance Sheet / Deployment (already-merged panels)? Plan assumes yes and re-anchors
   the `data-node-id`.

## Implementation Steps

> **Progress:** All 8 steps completed (2026-07-01).

1. **[DONE] Add `useStatsYield` React Query hook** at
   `packages/frontend/src/api/useStatsYield.ts` (mirror `useStatsPrices.ts`):
   - `GET /v1/stats/yield?chain_id=<id>&days=<d>&interval=<i>`; response is a bare
     `SamplePoint[]` (`{ timestamp, apy: number|null, accrued: string, principal_outstanding: string }`).
   - Reuse the same `periodId → { days?, interval }` map used by `useStatsPrices`
     (7d→hourly, 1m/3m/1y→daily, all→weekly). Extract that map into a shared util (step 2)
     since it is now used in two hooks.
   - `refetchInterval: 30_000` (dashboard poll convention, per `docs/FRONTEND.md` and
     `useLoanBook`). `enabled` guarded on a valid `chain_id`.
   - Export `SampleYieldItem` / `UseStatsYieldResult` types; add to
     `packages/frontend/src/api/index.ts`.
   - Add `useStatsYield.test.tsx` (mirror `useLoanBook.test.tsx`) covering success, empty
     `[]`, and error.

2. **[DONE] Extract the period→query map into a shared util** at
   `packages/frontend/src/utils/statsPeriod.ts` (FRONTEND.md rule 3 — used by both
   `useStatsPrices` and `useStatsYield`). Export `STATS_PERIODS`, the `periodToQuery`
   function, and the `StatsPricesInterval` type. Refactor `useStatsPrices.ts` to import it.
   Add `statsPeriod.test.ts`. Register the util in `docs/frontend/utils.md`.

3. **[DONE] Add a chart-data mapping util** at
   `packages/frontend/src/utils/yieldSeries.ts`:
   - `accrualToBars(samples): { height, value, timestamp }[]` — parse `accrued` (6-dp USD
     string) to numbers, sort by timestamp, normalise heights to the max (`Math.max(2, …)`
     floor, matching `pricesToCurve`). Returns `null` on empty/invalid so the panel can
     show empty state.
   - `latestAccrued(samples)` — the final cumulative value for the headline `$X.XXM`.
   - Reuse `formatCompactUsd` (from `@/utils/formatCompactUsd`) for the headline and
     `formatOneDecimalRate` for APY metric strings (both already exist).
   - Add `yieldSeries.test.ts`; catalogue in `docs/frontend/utils.md`.

4. **[DONE] Add a reusable bar-chart view** at
   `packages/frontend/src/components/dashboard/YieldBarChart.tsx` — a small presentational
   SVG component (viewBox, `preserveAspectRatio="none"`, `<rect>` per bar) generalised from
   `PortfolioPlaceholderCard`'s inline SVG. Props: `bars`, `fill` (default
   `var(--color-pipeline-chart-positive)` — the green used in Figma), optional hover/tooltip.
   Keep hover/tooltip minimal (mouse-only; log touch as tech-debt) or omit for v1 and note it.
   One component per file (FRONTEND.md rule 1).

5. **[DONE] Add the co-located logic hook** at
   `packages/frontend/src/components/dashboard/useYieldHistoryPanel.ts` (FRONTEND.md rule 2):
   - Resolve `chainId = ENV.EVM_CHAIN_ID`, `vaultAddress = ENV.STAKED_PLUSD_ADDRESS`.
   - Own the active period id (default "all") and expose `setPeriodId`.
   - Call `useStatsYield`, `useStatsPrices`, `useStats` (for net-to-sPLUSD APY), and read
     `useLoanBook` summary `avg_yield` for the "Loan Book Yield" metric.
   - Derive: `state` (`loading`/`error`/`empty`/`ready`) — mirror `useDeploymentMonitorPanel`;
     `empty` when the vault is zero-address or all series are empty. Compute
     `cumulativeBars`, `headlineValue`, `exchangeRateBars`, and the 3 metric strings.
     "Target Net to sPLUSD" is the static string `"8–12%"`.
   - Provide a single `refetch` that refetches all queries.
   - Add `useYieldHistoryPanel.test.tsx` (mirror `useDeploymentMonitorPanel` test coverage):
     loading, error, empty (zero-address / empty series), ready with derived values.

6. **[DONE] Fill `YieldHistoryPanel.tsx`** (view = JSX only):
   - Replace the `state="empty" emptyCaption="Coming soon"` placeholder with the wired panel.
   - Render inside `PanelContainer` (keep `title="Yield History"`, pass `state`, `onRetry`,
     `errorMessage`). Decided `borderless` — inner cards carry the asymmetric depth border
     matching `DeploymentMonitorPanel`'s treatment, verified against Figma.
   - Layout: headline + `SegmentedTabs` (variant `floating`) in header row; `YieldBarChart`
     for Cumulative Yield; responsive 3-column metric cards below (stack on mobile).
   - Re-anchored `data-node-id` to `3283:68333` (Cumulative Yield card).
   - Token discipline: all via theme-token utilities and `@pipeline/ui` primitives.

7. **[DONE] Wire nothing new in `dashboard.tsx`** — the route already renders `<YieldHistoryPanel />`.
   Confirmed the panel spans full width in the single-column stack.

8. **[DONE] Lint & typecheck.** `npx tsx scripts/lint-docs.ts` (0 errors), frontend build ✓,
   TypeScript noEmit ✓, ESLint ✓.

## Test Strategy

- **Unit (Vitest):**
  - `statsPeriod.test.ts` — period→query map for every period id incl. unknown fallback.
  - `yieldSeries.test.ts` — `accrualToBars` (empty → null, single point, monotone
    normalisation, height floor), `latestAccrued`, headline formatting.
  - `useStatsYield.test.tsx` — success (populated `SamplePoint[]`), empty `[]` (panel
    empty), error; query-key/enabled behaviour; verify 30s poll option set.
  - `useYieldHistoryPanel.test.tsx` — state machine: loading, error, empty (zero-address
    vault; all-empty series), ready with derived headline + metric strings + bar arrays.
    Use the `pipeline.mock.api.*` mock-key layer (see `src/api/README.md`) or React Query
    wrappers as the existing panel tests do.
- **Component:** a `YieldHistoryPanel` render test asserting each state renders the
  expected element (`panel-loading` / `panel-error` / `panel-empty` / headline + chart +
  metric cards), and that `data-testid="dashboard-panel-yield-history"` is stable.
- **Edge cases:** `apy: null` samples (no active loans) → metric shows "—"; `avg_yield`
  null from loan-book → "—"; `days`-omitted "All" uses weekly interval (avoid 400);
  vault = zero address → empty state, no network call.
- **Regression:** `useStatsPrices` refactor to shared util must keep existing
  `useStatsPrices` tests and the home chart green.
- **Figma verification (manual, per planner contract):** compare the rendered `/dashboard`
  Yield History region against desktop `3283-12098` / node `3283:68333` and mobile
  `3283-72387` — headline size/token, green bar fill, metric-card labels/values, card
  border treatment, and responsive stacking. (No automated QA phase on the frontend flow;
  epic-level QA is #712's `qa` sub-issue.)

## Docs to Update

- `docs/frontend/utils.md` — add `statsPeriod` and `yieldSeries` utils (same commit).
- `docs/frontend/hooks.md` — add `useStatsYield` if it is intended for reuse beyond this
  panel (it fetches a shared endpoint; catalogue it).
- No product-spec change: `docs/product-specs/dashboards.md` Panel D already describes the
  intended content. If Open Question #1 resolves to "ship blended now", add a short note in
  the exec plan / a follow-up backend issue rather than editing the spec (the spec's target
  state is still correct; the API is behind it).
- `docs/exec-plans/tech-debt-tracker.md` — log: (a) Panel D lacks by-source / T-bill /
  decomposed-trailing series because the API does not serve them despite #715 being closed;
  (b) chart touch-interaction deferred (mirrors home chart).
