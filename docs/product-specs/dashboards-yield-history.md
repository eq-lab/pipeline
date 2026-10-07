# Protocol Dashboard — Panel D: Yield History

Split out of [dashboards.md](./dashboards.md) (size limit) — Panel D of the Protocol Dashboard.

**Cumulative yield minted (issue #760)**
- The "Top" row (Figma frame `3283:67619`) is a two-column layout: TVL card (left) and Cumulative Yield card (right). The Cumulative Yield series is backed by `GET /v1/dashboard/yield-history` (net minted to sPLUSD, blended single series). The loan-vs-T-bill yield split remains gated on the backend issue #738 — the labelled `#738` seams in the code are preserved. The prior `GET /v1/stats/yield` gross-accrual estimate is no longer the headline source; `summary.cumulative_yield_total` drives the KPI value.
- Time series of cumulative PLUSD minted into the sPLUSD vault. Loan-vs-T-bill split (two distinct series: loan repayment yield and T-bill yield) is gated on #738.

**Real-time T-bill accrual**
- Rolling accrued T-bill yield since the last weekly distribution. Resets to zero after each weekly mint event. Informational only — does not affect sPLUSD NAV until the weekly distribution fires.

**Exchange rate history**
- Time series of the sPLUSD → PLUSD exchange rate.

**Trailing yield**
- Trailing 30-day annualised yield to the senior tranche, with breakdown into loan-yield contribution and T-bill-yield contribution.
