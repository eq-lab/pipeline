# User stories: #760 — Protocol Dashboard header summary strip + TVL/yield series

Epic: #712 — Protocol Dashboard
Issue: https://github.com/eq-lab/pipeline/issues/760
Route: `/dashboard`
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-67619

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

**Story 7 — TVL card is the left column, Cumulative Yield is the right column**
Given the dashboard page loads on a desktop viewport,
when the "Top" row renders,
then the TVL card and Cumulative Yield card are side by side (md:flex-row).

---

## Cumulative Yield card — re-wired series

**Story 8 — Cumulative Yield headline from summary**
Given `/v1/dashboard/summary` returns `cumulative_yield_total: "2910000.000000"`,
when the Cumulative Yield card renders,
then the headline value is `$2.9M` (from `summary.cumulative_yield_total`, not from the last chart bar).

**Story 9 — Cumulative yield bars from yield-history endpoint**
Given `/v1/dashboard/yield-history` returns a non-empty series,
when the Cumulative Yield card renders,
then green bars are visible and the period tabs (7d / 1m / 3m / 1y / All) change the series range.

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

**Story 14 — Target Net to sPLUSD is static**
Given the dashboard loads,
when the metric cards render,
then "Target Net to sPLUSD" always shows `8–12%` (static product constant, #738 seam).

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

**Story 18 — Mobile stacked layout**
Given a viewport narrower than `md` (768px),
when the "Top" row renders,
then the TVL card and Cumulative Yield card stack vertically (flex-col).

**Story 19 — Metric cards scroll horizontally on mobile**
Given a viewport narrower than `md`,
when the metric card row renders,
then the three cards are horizontally scrollable (overflow-x-auto).
