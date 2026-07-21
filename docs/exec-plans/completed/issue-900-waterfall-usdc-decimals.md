# Issue #900: Trustee waterfall: convert USD input to USDC base units

Source: https://github.com/eq-lab/pipeline/issues/900

## Scope

Update the Trustee Record Coupon and Record Repayment flows so operator-entered USD amounts are converted to Stellar SAC raw base units before calling the waterfall endpoint, backend waterfall response amounts are normalized back to USD for display, and `recordPayment` payloads preserve backend-returned raw base-unit values exactly. Also include the year in coupon/final period date ranges so long durations are unambiguous.

Out of scope: backend endpoint changes, contract changes, and changing registry-sourced loan-book/financials scaling behavior.

## Assumptions and Risks

The issue body is the source of truth for `DECIMALS = 7` examples. Trustee code must not import from `packages/frontend`, so SAC conversion helpers should live in Trustee-local utilities and mirror existing frontend SAC behavior. Existing route comments contain stale #882/#884 statements saying waterfall values are already display dollars; those comments must be corrected with the implementation to avoid future regressions. Tests should guard exact decimal-string conversion and contract payload preservation because floating-point math would silently drift.

## Open Questions

_None_

## Implementation Steps

1. [x] Add Trustee-local SAC unit helpers in `packages/trustee/src/utils/stellarSacUnits.ts` for `SAC_DECIMALS = 7`, exact USD display-string to raw base-unit conversion, raw base-unit to display decimal conversion, and positive input validation.
2. [x] Update `packages/trustee/src/routes/-record-coupon.ts` to parse the debounced amount with the new helper, send raw base units to `useLoanWaterfall`, divide waterfall response fields by `10^7` for display/terminal calculations, preserve backend raw fields in `buildRepaymentInput`, and format coupon periods as `D Mon YYYY → D Mon YYYY · N days`.
3. [x] Update `packages/trustee/src/routes/-record-repayment.ts` with the same conversion/display behavior and final-period year formatting, while preserving repayment-specific principal and close-loan logic.
4. [x] Update `packages/trustee/src/api/useLoanWaterfall.ts` comments to document that callers pass raw on-chain base units and responses are raw base units.
5. [x] Update unit and page tests in the affected Record Coupon/Record Repayment test files so fractional input such as `123.45678` sends `1234567800`, display values normalize from backend raw fields, invalid/empty/zero/negative inputs keep the query disabled, and smart-contract payloads use backend raw values exactly.

## Test Strategy

Run focused Trustee tests for Record Coupon, Record Repayment, and `useLoanWaterfall` behavior after updating fixtures. Then run `yarn workspace @pipeline/trustee test`, `yarn workspace @pipeline/trustee lint`, `yarn workspace @pipeline/trustee build`, and `npx tsx scripts/lint-docs.ts`.

## Docs to Update

_None_
