# Issue #1627: LP: EVM PLUSD/sPLUSD assumed 18 decimals (they are 6)

Source: https://github.com/eq-lab/pipeline/issues/1627 — critical for the EVM launch, found in the
2026-10-22 calculations review. Branch: `fix/1627-evm-plusd-decimals`.

Status: Completed 2026-10-22 — PR pending (see issue).

## Root cause

Five sites hard-coded 18 for EVM PLUSD / sPLUSD (home route `activeDecimals`, `StakeCard`
default, `useStakeFlow` `EVM_CONVERT_DECIMALS`, `renderRequestRow`, `HomeStatsStrip`), and the
`/test` scenarios plus every route test seeded 18, so the mismatch never surfaced. Live tokens are
6-decimal, so a 5,000 PLUSD balance read as 5e-9 → "zero" → home stuck in the empty state,
previews and activity rows showed 0.00.

## Decision

- Scale always comes from the token's `decimals()`: `useEvmToken(...).decimals` where the token is
  already mounted, else the new `useEvmStakeDecimals()` (`{ plusd, splusd }`).
- Display helpers (`isDisplayZero`, `formatBigintCurrency`, `formatRawDecimalUSD`,
  `formatTokenAmount`, `buildSeries`, `StakeCard.formatBigintNumber`) accept `undefined` decimals
  and render their empty value while loading, never a mis-scaled number.
- `useStakeFlow.convertDecimals` is the output token's live decimals; the "1 token" rate inputs use
  the input token's decimals.
- `renderRequestRow` takes an `evmStakeDecimals` argument (assets at PLUSD, shares at sPLUSD).
- Mocks and tests seed 6; 18-decimal fixtures rescaled ÷10^12 (1e18 rate scalars unchanged — the
  mock convert math is scale-free). The #541 "always 18" regression tests are replaced by live-
  decimals tests.

## Open Questions

_None._
