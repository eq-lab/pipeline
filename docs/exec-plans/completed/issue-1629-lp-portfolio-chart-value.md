# Issue #1629: LP: approve errors swallowed, no requests invalidation (double deposit), shares shown as USD, chart spacing

Source: https://github.com/eq-lab/pipeline/issues/1629

Parent epic: #1521. Branch: `fix/1629-lp-portfolio-chart-value` (draft PR #1950). App: LP (`packages/frontend`).

## Scope

Items 1, 2 and 5, plus the headline / `StakeCard` half of item 3, shipped in #1658 (PR #1659). The
original combined plan is `issue-1658-lp-deposit-flow-fixes.md` in `docs/exec-plans/completed/`.
This plan covers only what is left, the portfolio chart in `PortfolioPlaceholderCard`:

- **(a) Item 3, chart half: show sPLUSD value, not the share count.** The bars, the tooltip and the
  Y axis switch from `shares_balance` (shares formatted as dollars) to the served per-bucket
  `splusd_value`. That field is whole PLUSD (USD) as a 6-dp plain decimal string, from #1313.
  Bar heights come from the same value, and the axis comes from the served `splusd_value` `SeriesStat`.
  A bucket without `splusd_value` shows `—` in the tooltip and draws no bar. The frontend never
  computes shares × price.
- **(b) Item 4: plot by timestamp with step interpolation.** In series mode, each bucket covers the
  time from its own timestamp to the next bucket's timestamp. The bar sits at the centre of that
  span, and the last bucket spans one median step. Hover finds the latest bucket at or before the
  cursor time. The X-axis date labels are sampled by time, not by index. For a dense, uniform
  series (what the API serves today), all of this renders exactly as before.

**Series choice: `splusd_value`, not `total_balance`.** Here is why:

- The Issue's item 3 asks for the sPLUSD USD value. When #1629 was blocked on #1313, the
  2026-10-26 comment on #1313 also requested a "per-bucket sPLUSD value".
- The card's headline is still bound to the sPLUSD position. It shows `splusdInPlusdActive`, the
  on-chain `convertToAssets` read (#1658). See `docs/product-specs/home-screen-states.md` (states 3,
  4 and 7) and `docs/frontend/dashboard-components.md` § `stake-or-add-usd`. The chart must plot
  the same quantity as the headline above it.
- `docs/product-specs/lp-total-balance.md` describes the data for the eventual composite card.
  Switching the headline and the graph to `total_balance` together, with the "includes PLUSD"
  labelling, is #1282's composite Total Balance scope ("Total Balance is composite — the headline
  + graph"). #1282 is open and blocked.

Out of scope:

- Backend changes.
- Switching the headline or the chart to `total_balance`, and rendering `plusd_balance` or
  `wire_out_escrow`. Those belong to #1282.
- The Y-axis tick-label format. `computeAxisTicks` stays as it is, but its input is now a served USD value.
- `utils/statsPeriod.ts`. The portfolio card does not use it; it uses `PERIOD_WINDOWS` in
  `usePositionsHistory.ts`. No change is needed.
- The placeholder (zero) chart mode keeps index slots. Its timestamps are uniform already.

## Assumptions and Risks

- **The live data shape could not be checked with a populated wallet.** On 2026-11-17 I made
  read-only calls to `https://api.pipeline.stage.eqlab.net/v1/positions/history`. They returned
  `history: []` for `GCGQVOJHQNDO4UWCKQ2Y2R6JU7EUD63UT4DRME3NXMP6LPBE7DIOGQ5C` on `99000001` with
  `days=7`, `days=365` and All. `/v1/pnl` returns `positions: []` for the same wallet. The current
  Stellar vault is `CDHSWXEGZ3AOBI3JYKUK33CR7LVWZSMT3RQENAHZAPFN2Q7D2QA544XM`; history restarts at
  a vault redeploy (#1613). Other wallets found in the docs were also empty, on both `99000001` and
  `560048`. The empty response leaves out the `splusd_value` / `total_balance` stats.
  The field names and optionality come from `PositionHistoryItem` / `PositionHistoryResponse` in
  `packages/api/src/routes/pnl.rs` (L271–310, every new field `skip_serializing_if = "Option::is_none"`)
  and from `docs/product-specs/lp-total-balance.md` § API Contract. The frontend types follow
  those. Live verification needs a wallet that holds sPLUSD on the current staging vault, which the
  user or QA provides.
- **Units differ from `shares_balance`.**
  - `splusd_value` and its stats are whole-USD decimal strings, for example `"1001.503214"`.
    They are not raw integers.
  - The new mapping is `Number(str)` with no `/ 10 ** decimals`. That is the display-verbatim rule.
  - Scaling them by decimals, as `shares_balance` is scaled today, would be a bug that is easy to
    make by copying existing code. The plan removes the `decimals` argument from `buildSeries`.
- **The last bar and the headline can differ a little.**
  - The headline is the live on-chain `convertToAssets`.
  - The chart's last bucket uses the closing `share_prices` sample of `truncate(now)`.
  - Both values are served, and neither is derived on the client. A small gap between them is
    expected. Document it rather than patch it.
- **A missing `splusd_value` is a real case.** The API leaves out the field for a bucket where the
  wallet holds shares and no price sample exists at or before it. The response stat is left out
  when any bucket lacks the field. In that case the card draws no bar for those buckets and shows
  `—` on hover. The axis is not rendered, because there is no stat, and `computeAxisTicks(null)`
  already returns `null`. Bar heights then normalise against the largest served value present.
  That is the existing render-only fallback (`Math.max(...)`) narrowed to non-null values, and it
  is never shown as a number.
- **An older API that serves no `splusd_value` at all** gives a series of nulls: no bars, and `—`
  on hover. That is correct under the "missing data renders —" rule. #1313 is deployed on staging,
  per the 2026-11-16 issue comment.
- **The dense grid means the timestamp scale changes nothing visible today.** The backend densifies
  (`build_history_series`). The x-scale is defined so that a uniform grid gives exactly the
  current `slotCentreX` positions and the current `floor(fraction × count)` hover index. Existing
  tests must pass unchanged, which acts as a regression guard.
- **Comment rules.** `usePortfolioChart.ts` has a 5-line JSDoc header with stale text ("Every
  balance is 0 until … #1116"), and `usePositionsHistory.ts` has a 4-line one. Reduce each touched
  file to one 2–3-line `// spec:` header. Shrink `scripts/lint-comments.baseline.json` if it lists them.
- **`home-screen-states.md` is at 198 of 200 lines.** Any correction there must replace text in
  place, not add lines.

## Open Questions

_None_

## Implementation Steps

1. `packages/frontend/src/api/usePositionsHistory.ts` (types only):
   - `PositionHistoryItem` gains optional `splusd_value?: string`, `plusd_balance?: string`,
     `wire_out_escrow?: string` and `total_balance?: string`.
   - `PositionHistoryResponse` gains optional `splusd_value?: SeriesStat` and
     `total_balance?: SeriesStat`.
   - These mirror `pnl.rs`. Absent fields are omitted from the JSON, never `null`.
   - Header: one `// spec: docs/product-specs/lp-total-balance.md, docs/frontend/dashboard-components.md#portfolioplaceholdercard` line.
   - Change no fetch logic.

2. `packages/frontend/src/components/usePortfolioChart.ts`:
   - `ChartSeries.values` becomes `(number | null)[]`.
   - `buildSeries(history)` drops the `decimals` parameter and maps each item as follows:
     - `timestamp` goes through `Date.parse`. A non-finite timestamp still returns `null` for the
       whole series.
     - `value` is `item.splusd_value === undefined ? null : Number(item.splusd_value)`. A present
       but non-finite value also becomes `null`, a per-bucket missing value rather than a whole
       series failure.
     - It returns `null` for empty or absent history, as today.
     - Its input type is
       `{ timestamp: string; splusd_value?: string }[] | undefined`.
   - Add pure exported helpers. Unit-test them without rendering.
     - `seriesSpans(timestamps)` returns `{ t0, tEnd, step }`. `step` is the median of
       consecutive diffs, or `1` when there is a single bucket. `t0 = timestamps[0]` and
       `tEnd = timestamps.at(-1) + step`.
     - `bucketCentreX(i, timestamps, spans, width)` returns the x at the midpoint of
       `[t_i, t_{i+1} or tEnd)`, mapped linearly from `[t0, tEnd]` to `[0, width]`. For uniform
       spacing this equals `(i + 0.5) × width / n`, the current `slotCentreX`.
     - `stepIndexAt(timestamps, t)` returns the last `i` with `timestamps[i] <= t`, found by
       binary search and clamped to `[0, n − 1]`.
   - `usePortfolioChart`:
     - In series mode, `onPointerMove` maps the cursor fraction to `t = t0 + fraction × (tEnd − t0)`
       and sets `hoveredIdx = stepIndexAt(timestamps, t)`.
     - Placeholder mode keeps `Math.floor(fraction × slotCount)`.
     - `TooltipInfo.balance` becomes `number | null`. Series mode reads `series.values[i]`, which
       may be `null`. Placeholder mode keeps `0`.
     - Expose the spans, or an `xOf(i, width)` callback, in `PortfolioChartState` so the card does
       not recompute them.
   - Replace the header with a 2–3-line `// spec:` pointer.

3. `packages/frontend/src/utils/formatDate.ts`: add
   `sampleAxisDatesByTime(timestampsMs, count = 5)`. It picks, for each target
   `t0 + (i / (count − 1)) × (t_last − t0)`, the bucket whose timestamp is nearest. It then formats
   exactly as `sampleAxisDates` does, including the `'YY` suffix when a year boundary is crossed.
   Factor the shared formatting into a private helper. For a uniform grid, nearest-time picks equal
   `round(i/(count−1) × (n−1))`, so labels do not change. Keep `sampleAxisDates` for placeholder
   mode and other callers (`grep` for them).

4. `packages/frontend/src/components/PortfolioPlaceholderCard.tsx`, series branch only:
   - Bar `cx` comes from the hook's `xOf(i, VB_W)` instead of `slotCentreX(i, slotCount)`.
   - The bar-width basis `slotW` becomes the median step in viewBox px, which is
     `step / (tEnd − t0) × VB_W`. For uniform data it equals `VB_W / slotCount`, and the
     `spikeW` / `bandW` clamps are unchanged.
   - A bucket whose value is `null` renders an empty `<g data-bar-slot={i} data-missing="true" />`.
     It draws no rects, and the slot count stays one per bucket.
   - Change the `domainMax` fallback to the max over non-null values, or `0` when there are none.
   - `cursorLeftPct` uses the hovered bucket's x in series mode, and `slotCentreX` in placeholder mode.
   - Tooltip value: in series mode, `tooltip.balance === null ? "—" : formatMoney(tooltip.balance)`.
     Placeholder mode still shows `$0.00`.
   - The dates row is `sampleAxisDatesByTime(timestamps)` in series mode and
     `sampleAxisDates(timestamps)` in placeholder mode.
   - Do not change the placeholder branch, the header, the variants or the styling.

5. `packages/frontend/src/routes/index.tsx` (around L180–191):
   - `const portfolioSeries = buildSeries(positionsHistory.data?.history);`. This drops `splusdDecimals`.
   - Replace `sharesStats` with
     `const splusdValueMax = positionsHistory.data?.splusd_value?.max;`
     `const portfolioAxisMax = splusdValueMax != null && Number.isFinite(Number(splusdValueMax)) ? Number(splusdValueMax) : null;`
     There is no decimals scaling.
   - `portfolioAxis = computeAxisTicks(portfolioAxisMax)` stays. Its props already reach the mobile
     and desktop instances through `portfolioChartProps` and the explicit props near L302.
   - Headline wiring (`splusdBalanceFormatted`) is unchanged; it shipped in #1658.

6. Lint and gates:
   - `npx tsx scripts/lint-comments.ts`, shrinking `scripts/lint-comments.baseline.json` for
     touched files it lists.
   - `npx tsx scripts/lint-docs.ts`.
   - Typecheck and build `packages/frontend`.
   - `scripts/check-changes.sh`, if it covers these paths.

## Test Strategy

Use Vitest, run from inside `packages/frontend` (for example
`cd packages/frontend && npx vitest run src/components src/routes/-index.test.tsx src/utils src/api`).

- **`components/PortfolioPlaceholderCard.test.tsx`**
  - Update the `buildSeries (#1138)` block. `splusd_value` strings parse verbatim:
    `"1001.503214"` → `1001.503214`, with no decimals scaling. Make the share count differ from
    the value so the test proves `shares_balance` is ignored. An item without `splusd_value` maps
    to `null` and keeps its timestamp. A malformed timestamp still returns `null`, and empty
    history returns `null`.
  - Item 3 tooltip: hover a bucket with value `1001.5` and the tooltip shows `$1,001.50`. Hover a
    `null` bucket and the tooltip shows `—`, never `$0.00`. A `null` bucket renders a
    `[data-bar-slot]` with `data-missing="true"` and no `rect`. The placeholder hover still shows
    `$0.00` (the existing test).
  - Item 4, x positions: for `timestamps = [t, t+1h, t+10h]` with non-null values, the bar `rect`
    x centres are in time proportion. The median step is 5h (the median of 1h and 9h) and
    `tEnd = t+15h`, so the centres sit at 0.5h, 5.5h and 12.5h of the 15h domain, which is
    `680 × [1/30, 11/30, 25/30]`. Index slots would put them at `680 × [1/6, 1/2, 5/6]`. Assert
    this from the rect `x` attributes plus half the rect width.
  - Item 4, hover: mock `getBoundingClientRect` on the chart wrapper, following the existing hover
    test. A cursor inside the gap (time `t+5h`) gives tooltip timestamp `t+1h`, the earlier bucket.
    A cursor before `t+1h` gives bucket 0.
  - Regression: a dense uniform 3-bucket series gives the same `rect` x values as
    `slotCentreX`, `(i + 0.5) × 680 / 3`, and the same dates-row labels as before. The existing
    "Jul 20 / Aug 20" and `'YY` tests must pass unchanged.
- **New `components/usePortfolioChart.test.ts`**, or a describe block in the card test:
  - `stepIndexAt` returns the exact hit, a value between buckets, a value before `t0` (clamped to
    0), a value after the last bucket (the last index), and a single bucket.
  - `seriesSpans` returns the median step for uniform and gapped input, and `1` for a single bucket.
  - `bucketCentreX` equals `slotCentreX` for uniform input.
- **`utils/formatDate.test.ts`** (or the existing test file for `sampleAxisDates`):
  `sampleAxisDatesByTime` returns the same labels as `sampleAxisDates` for a uniform grid. For a
  gapped series, its middle label is the bucket nearest the time midpoint, not the index midpoint.
- **`routes/-index.test.tsx`**: make the `usePositionsHistory` mock configurable, for example a
  `mockPositionsHistory.current` ref reset in `beforeEach`. Add a case with a served response
  whose `shares_balance` differs from `splusd_value`, with `splusd_value: { max: "2000.000000", … }`:
  - The rendered home portfolio card's Y axis shows `$2K / $1K / $0`, from `splusd_value.max`
    and not from `shares_balance.max`.
  - A response without the `splusd_value` stat renders no Y axis.
  - A connected state with a series renders one `[data-bar-slot]` per bucket.
- **`api/usePositionsHistory.test.tsx`**: no behaviour change. Typecheck only.
- **Manual, staging.** This needs a wallet that holds sPLUSD on the current vault; the user or QA
  provides it.
  - In the Network tab, `/v1/positions/history` items carry `splusd_value`.
  - The tooltip on the last bar is close to the headline.
  - The tooltip shows `—` only where the item lacks the field.
  - Do not drive the user's browser; ask them to report what they see.
- **Figma.** Check styles only: no visual change is expected. The card frame is `1497:95048` and
  the series bars are `1497:95197`. The bar shape, tooltip chrome and axis typography stay
  token-exact; only the values and x positions change.

## Docs to Update

- `docs/frontend/dashboard-components.md` § PortfolioPlaceholderCard:
  - **Served series mode (#1138)**:
    - Bars and tooltip use the served `splusd_value` per bucket (whole USD, 6-dp string, parsed
      verbatim, #1313/#1629), not `shares_balance`.
    - A bucket without it draws no bar and its tooltip reads `—`.
    - `buildSeries` no longer scales by decimals.
  - Add a short **Time axis (#1629)** paragraph:
    - Buckets are placed on a timestamp scale, and each bucket spans until the next one.
    - The last bucket spans one median step.
    - Hover selects the latest bucket at or before the cursor (step interpolation).
    - Dates-row labels are sampled by time (`sampleAxisDatesByTime`).
    - A dense uniform series renders the same as index slots.
  - **Y axis (#1234)**: replace "1:1 USD over the `shares_balance` series … displays shares as
    dollars 1:1" with: "from the served `splusd_value.max` `SeriesStat` (no decimals scaling); no
    axis when the stat is absent (any bucket lacks `splusd_value`)".
  - Home-route paragraph (around L1774): "renders the served `shares_balance` history" becomes
    `splusd_value`, and the axis derivation becomes "`positionsHistory.data.splusd_value.max`,
    parsed verbatim".
  - Note that the composite `total_balance` series is #1282's scope.
- `docs/product-specs/home-screen-states.md`:
  - The state 3 and state 4 paragraphs still say `formatBigintCurrency(splusdShares…)`, which has
    been stale since #1658. Replace it in place with
    `formatBigintCurrency(splusdInPlusdActive)`, the sPLUSD value.
  - Do not add lines; the file must stay at or under 200.
- `docs/product-specs/lp-total-balance.md`: no change. The frontend consumes the contract as
  specified.
- `docs/frontend/hooks.md`: if it lists `usePositionsHistory` response fields, add the optional
  composite fields. Otherwise make no change.
