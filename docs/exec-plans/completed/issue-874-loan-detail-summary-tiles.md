# Issue #874: Trustee loan detail summary tiles

Source: https://github.com/eq-lab/pipeline/issues/874

## Scope

Replace the loan-detail summary tile fixture values with served backend fields:

- `Facility / disbursed`: `LoanBookEntry.principal` plus `principal` when `disbursed = true`, otherwise `—`.
- `Facility / senior`: `LoanBookEntry.principal` plus `original_senior_tranche`.
- `Repaid to date`: `LoanBookEntry.repaid_to_date`.
- `Days on watchlist`: `LoanBookEntry.days_on_watchlist` and `watchlist_entered_at`.
- `Interest to distribute`: `LoanFinancialsResponse.not_minted_yield`.
- `Rate · epochs`: `LoanFinancialsResponse.epoch.current_apy_bps` and `epoch.number`.

## Resolved questions

- Backend issue #894 added the missing loan-book fields for original senior tranche, repaid-to-date, disbursement state, and watchlist age.
- The detail page can use the matching `GET /v1/loan-book` row for these fields instead of waiting for `/financials` to duplicate them.
- Values without a served field render `—`; old batch/coupon fixture sub-lines are not retained.

## Implementation steps

1. Extend the Trustee `LoanBookEntry` type with the new backend fields.
2. Add a `buildSummaryTiles` presenter in `-useLoanDetail.ts`.
3. Replace the variant-specific mock tile selection with `buildSummaryTiles(entry, financials.data, variant)`.
4. Add presenter coverage for performing, disbursing, watchlist, matured, and missing-field cases.
5. Add a user-story doc for QA.

## Verification

- `npx tsx scripts/lint-docs.ts` — passed with the repo's existing 36 warnings.
- `yarn workspace @pipeline/trustee lint` — passed.
- `yarn workspace @pipeline/trustee test` — passed, 44 files / 578 tests.
- `yarn workspace @pipeline/trustee build` — passed.
