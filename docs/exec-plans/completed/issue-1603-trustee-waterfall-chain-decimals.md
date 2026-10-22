# Issue #1603: Trustee: waterfall preview uses Stellar 7-decimal units for EVM loans (verify)

Source: https://github.com/eq-lab/pipeline/issues/1603 — epic #1521. Branch:
`fix/1603-trustee-waterfall-chain-decimals`.

**Status: implemented (2026-10-22)** — bug confirmed from code and fixed; trustee lint/build/test (74 files, 1060 tests), `lint-docs` and `lint-comments` green. See PR #1617.

## Verification

Confirmed from the code (2026-10-22): `useRecordCoupon` / `useRecordRepayment` run
`useLoanWaterfall(chainId, loanId, amountBaseUnits, asOf)` for any positive amount regardless of
the loan's chain — the #1537 gate only nulls `recordPaymentInput` / `closureReason`, so the preview
still renders for an EVM loan. Both presenters convert with `usdInputToSacBaseUnits` (7 decimals)
and divide response fields by 10^7, so for a 6-decimal EVM USDC loan the request amount is 10× too
large and every previewed figure 10× too small.

## Decision

Convert with the loan's own chain decimals rather than hide the preview: the preview is read-only
and useful even while the on-chain write is gated (TD-152). `chainAmountDecimals(chainId)` in
`lib/targetChains.ts` = 7 (`SAC_DECIMALS`) for the Stellar chain, 6 (EVM USDC) otherwise; the two
presenters pass it to `usdToBaseUnits` / `baseUnitsToUsd` (both already take a `decimals`
parameter; `usdInputToSacBaseUnits` / `sacBaseUnitsToUsdDecimal` are decimal-agnostic).

## Scope

`packages/trustee` only: `lib/targetChains.ts`, `routes/-record-coupon.ts`,
`routes/-record-repayment.ts`; tests (helper with 6 and 7; page tests prove the waterfall is
called with 10^6 units for an EVM loan and 10^7 for Stellar); `trustee-flows.md` Scale handling;
user-stories doc + index row.

## Open Questions

_None._

## Test Strategy

`yarn workspace @pipeline/trustee lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.

## Docs to Update

`docs/frontend/trustee-flows.md` (Scale handling); `docs/user-stories/epic-1521/1603-trustee-waterfall-chain-decimals.md` + index row.
