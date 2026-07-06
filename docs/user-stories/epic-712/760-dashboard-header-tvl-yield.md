# User stories: #760 — Protocol Dashboard header summary strip + TVL/yield series

Epic: #712 — Protocol Dashboard
Issue: https://github.com/eq-lab/pipeline/issues/760
Route: `/dashboard`
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-67619

**Chain:** the dashboard is Stellar-scoped — the header hooks *and* the Loan Book (`/v1/loan-book`) + In Origination submissions (`/v1/loan-book/submissions`) requests all send `chain_id=99000001` (`ENV.STELLAR_CHAIN_ID`). The EVM chain (560048/Hoodi) carries malformed test data (#765). Verify against the Stellar chain.

---

## TVL card

**Story 1 — TVL headline renders**
Given the dashboard page loads and `/v1/dashboard/summary` returns `tvl: "43140000.000000"`,
when the "Top" row renders,
then the TVL card shows `$43.1M` as the headline (Heading M serif, left-aligned).

**Story 2 — Outstanding in Loans renders muted, right-aligned**
Given the summary returns `outstanding_in_loans: "31600000.000000"`,
when the TVL card renders,
then `$31.6M` is displayed with muted styling in the right half of the header row.

**Story 3 — Null outstanding in loans shows em-dash**
Given the summary returns `outstanding_in_loans: null`,
when the TVL card renders,
then the outstanding value shows `—`.

**Story 4 — Progress bar shows deployment ratio**
Given the summary returns `tvl: "43140000.000000"` and `outstanding_in_loans: "31600000.000000"`,
when the TVL card renders,
then the progress bar fill is approximately 73.3% wide and the caption reads `73.3% deployed`.

**Story 5 — Zero tvl guard prevents divide-by-zero**
Given the summary returns `tvl: "0.000000"`,
when the TVL card renders,
then the progress bar is empty (0% fill) and the caption reads `—% deployed`.

**Story 6 — TVL bar chart renders with dark ink fill**
Given the dashboard loads and `/v1/dashboard/tvl-history` returns a non-empty series,
when the TVL card renders,
then a bar chart with dark (ink) bars is visible inside the card.

**Story 7 — Two-column "Top" row: TVL left (full height), Cumulative Yield + metric cards right**
Given the dashboard page loads on a desktop viewport,
when the "Top" row renders,
then there are two equal columns (md:flex-row): the **left** column is the TVL card spanning the full row height, and the **right** column is a vertical stack of the Cumulative Yield card (on top) and the three metric cards row (below) — matching Figma 3283:67619.

---

## Cumulative Yield card — re-wired series

**Story 8 — Cumulative Yield headline from summary**
Given `/v1/dashboard/summary` returns `cumulative_yield_total: "2910000.000000"`,
when the Cumulative Yield card renders,
then the headline value is `$2.9M` (from `summary.cumulative_yield_total`, not from the last chart bar).

**Story 9 — Cumulative yield bars from yield-history endpoint**
Given `/v1/dashboard/yield-history` returns a non-empty series,
when the Cumulative Yield card renders,
then green bars are visible for the **full history at the default daily interval** (the hooks omit `days` and `interval`). Per Figma 3283:67619 there is **no** time-range tab selector on the card.

**Story 9b — Chart bars are single-colour with a hover tooltip**
Given the TVL or Cumulative Yield chart has data,
when the chart renders,
then each bar is a single flat colour (no glow/opacity layering, per Figma); and
when the pointer hovers over the chart, a tooltip shows the hovered bar's value and date and a faint band highlights that slot.

**Story 10 — Yield loan-vs-T-bill split is absent (#738 gated)**
Given the dashboard loads,
when the Cumulative Yield card renders,
then no loan-vs-T-bill breakdown is shown (seam gated on backend #738).

---

## Metric cards

**Story 11 — Current APY Net to sPLUSD from summary**
Given the summary returns `current_apy_net_to_splusd: "0.104"`,
when the metric cards render,
then "Current APY, Net to sPLUSD" shows `10.4%`.

**Story 12 — Loan Book Yield from summary**
Given the summary returns `loan_book_yield: "0.112"`,
when the metric cards render,
then "Loan Book Yield" shows `11.2%`.

**Story 13 — Null APY fields show em-dash**
Given the summary returns `current_apy_net_to_splusd: null` and `loan_book_yield: null`,
when the metric cards render,
then both cards show `—`.

**Story 14 — Target Net to sPLUSD is a static constant**
Given the dashboard loads,
when the metric cards render,
then "Target Net to sPLUSD" shows `8–12%` (static product constant; no endpoint serves a target APY yet — #738 seam).

---

## Panel states

**Story 15 — Loading state while data is fetching**
Given the dashboard page is loading and the three `/v1/dashboard/*` endpoints have not responded,
when the "Top" row panel renders,
then `PanelLoading` is shown.

**Story 16 — Error state when any endpoint fails**
Given any of the three `/v1/dashboard/*` endpoints returns a non-2xx response,
when the "Top" row panel renders,
then `PanelError` is shown with a Retry button.

**Story 17 — Empty state when all series are empty and summary is all-null**
Given all three endpoints return empty data (no events yet),
when the "Top" row panel renders,
then `PanelEmpty` is shown.

---

## Responsive layout

**Story 18 — Mobile stacked layout matches Figma 3283:71057**
Given a viewport narrower than `md` (768px),
when the "Top" row renders,
then the cards stack full-width in order TVL → Cumulative Yield → metric cards row, with 16px gaps; the TVL card is 404px tall with its dark chart 240px tall anchored to the bottom, and the Cumulative Yield card is 248px tall with its green chart 144px tall (matching the Figma XS frame).

**Story 19 — Metric cards scroll horizontally on mobile**
Given a viewport narrower than `md`,
when the metric card row renders,
then the three cards are horizontally scrollable (overflow-x-auto).

---

## Loan Book — LTV header marker (user-approved frontend calc)

The Loan Book table's LTV column header shows an **average-LTV** marker, computed
client-side (approved exception to the no-frontend-computed-metrics rule):
`avg = Σ(per-row LTV) / loans.count`, where each row's `ltv` (decimal fraction) is
used and **null/missing → 0** (contributes 0 but still counts in the denominator);
formatted with `formatLtv` (rounded integer `%`). Seam refs #729/#765.

**Story 20 — LTV marker is the average of per-row LTV**
Given `/v1/loan-book` returns loans with LTV values,
when the Loan Book table header renders,
then the LTV column shows `LTV · N%` where `N` = round(avg(row LTVs) × 100) — e.g. two loans at 0.80 and 0.60 → `LTV · 70%`.

**Story 21 — Null LTV rows count as 0 in the average**
Given some loans have `ltv: null`,
when the LTV marker is computed,
then null rows contribute 0 to the sum but still count in the denominator — e.g. loans at 0.80 and null → `LTV · 40%`.

**Story 22 — No LTV marker when there are no loans**
Given `/v1/loan-book` returns an empty `loans` array,
when the header renders,
then the LTV column shows the plain `LTV` label with no aggregate.

---

## Withdrawal Queue — Liquid Cover (user-approved frontend calc)

The Withdrawal Queue "Liquid Cover" card is computed client-side:
`Liquid Cover = (cash + tokenized-T-bills) / queue`, where
`cash` = `/v1/financial-position` `assets.liquid.cash_stablecoins`,
`tbills` = `assets.liquid.tokenized_tbills`, `queue` = `/v1/withdrawal-queue`
`summary.in_queue_usd`; each **null/missing → 0**; divide-by-zero (queue 0) → `—`;
formatted with `formatCoverage` (e.g. `1.5x`). Seam: cash + T-bills will be sourced
from smart contracts (on-chain) once ready — null today, so it reads `0.0x`.

**Story 23 — Liquid Cover reads "0.0x" while cash/T-bills are unsourced (current state)**
Given the queue is non-zero and `cash_stablecoins`/`tokenized_tbills` are null,
when the Liquid Cover card renders,
then it shows `0.0x` ((0 + 0) / queue).

**Story 24 — Liquid Cover guards divide-by-zero**
Given `in_queue_usd` is 0 (empty queue),
when the Liquid Cover card renders,
then it shows `—`.

**Story 25 — Liquid Cover computes a real ratio once cash is served**
Given `cash_stablecoins` equals the queue amount,
when the Liquid Cover card renders,
then it shows `1.0x`.
