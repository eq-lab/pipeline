# Issue #1114: Total Balance chart — stop plotting fabricated/irrelevant data

Source: https://github.com/eq-lab/pipeline/issues/1114

## Resolution of the open question

No per-address balance-history endpoint exists (`packages/api/src/routes/` surveyed:
`portfolio.rs` is the protocol-wide `/v1/stats/yield` series; `stats.rs` serves share
prices — neither is the user's balance history). Per the never-fabricate rule the
connected Total Balance card therefore stops charting entirely until a real series
lands: the synthetic seeded curve, the fake per-period `PERIODS` earnings, the period
tabs, and the price-series-as-balance fallback all go. A follow-up backend issue
tracks serving the real series.

## Scope

1. `PortfolioPlaceholderCard.tsx` — keep the header block (Total Balance label, real
   `balanceLabel`, `/v1/pnl` caption, CTA/mobile states A/B/C); replace the tabs +
   bars + cursor + tooltip region with an honest empty state ("Balance history will
   appear here once it's tracked."), muted, same card footprint. Props
   `activePeriodId` / `onActivePeriodChange` / `priceItems` are removed.
2. `usePortfolioChart.ts` + its test — deleted (sole consumer is the card; verified
   no other imports). `formatMoney` dies with it (only chart-internal use).
3. `routes/index.tsx` — drop the chart props, the `chartPeriodId` state, and the
   `useStatsPrices` query (the card was its only consumer).
4. Tests — `PortfolioPlaceholderCard.test.tsx`: chart/tab/tooltip tests replaced with
   empty-state + header assertions; route tests updated where they touch the removed
   props.
5. Spec — `dashboard-components.md#portfolioplaceholdercard` + home-route section
   rewritten for the no-chart state, with the re-enable path (backend series) noted.
6. File the backend follow-up issue (per-address sPLUSD balance history series).

Out of scope: the disconnected `ConnectWalletPromoCard` (marketing surface), the
Protocol Dashboard's yield chart (real backend series), any backend change.
