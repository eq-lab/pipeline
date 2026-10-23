# Issue #1622: Trustee: Record Coupon can submit a stale (pre-debounce) amount

Source: https://github.com/eq-lab/pipeline/issues/1622

## Scope

Record Coupon (`packages/trustee/src/routes/-record-coupon.ts` + `loans.$id_.record-coupon.tsx`)
builds the on-chain `record_payment` payload from the 400 ms-debounced amount (`debouncedAmount`
-> `amountBaseUnits` -> `buildRepaymentInput`), while the input shows the live `amountInput`.
The submit button is gated only on `recordPaymentInput == null || record.isPending`, so during
the debounce window it stays enabled with the previous amount's payload. Typing `50,000` -> `500,000`
and clicking within 400 ms records `offtaker_received` = 50,000.

What changes:

1. **Presenter-level gate (single source of truth), both flows.** `recordPaymentInput` is `null`
   unless the amount is settled, meaning `amountInput === debouncedAmount`, and a waterfall preview
   for that settled amount exists (`waterfall.data != null`). The second condition already holds
   because `buildRepaymentInput` returns `null` without data. The payload is then always built from
   the value the preview was computed for. This also covers clearing the input mid-debounce. The
   existing `isCalculating` is `false` when the live input is empty, so it cannot be the only gate.
2. **Page-level belt-and-braces.** Each page's submit `disabled` also includes
   `view.waterfall.isCalculating`, as the issue asks.
3. **Summary line.** While the amount is unsettled, `summaryText` (`"Components sum to received
   $<debounced amount>"`) shows the old amount next to the new input. It is set to `null` while
   unsettled, the same way the row values are already masked with skeletons (#1049). The same
   applies to the coupon's `isTerminal` hint, which is also derived from the debounced
   `enteredUsd`.
4. **Record Repayment check.** The page has the same structure: debounced amount -> waterfall ->
   `buildRepaymentInput`, with submit gated only on `recordPaymentInput`. It is **not exploitable
   today**. The amount input is `disabled` and is set once by the one-shot prefill, and during that
   prefill's 400 ms window `debouncedAmount` is still `""`, so `amountBaseUnits === "0"` and the
   payload is `null`. The same presenter gate (1), page gate (2) and summary gate (3) are applied
   anyway for parity, so a future editable input or a re-prefill cannot reintroduce the bug.

Verified non-issue: `useLoanWaterfall` has no `placeholderData` / `keepPreviousData`, and its
query key includes `amount`. So `waterfall.data` is always either `undefined` or the response
for the current debounced `amountBaseUnits`. There is no case where the components come from
amount A while `offtaker_received` is amount B.

Out of scope: the debounce interval itself; the "Offtaker still owed after coupon" row, which
deliberately tracks the live input (spec'd); the Close-loan checklist (#1624); `as_of` (#1626);
EVM on-chain write gating (TD-152).

## Assumptions and Risks

- Builds on main at e74b5a2b, which already has #1624 (Close gating) and #1626 (`as_of: null`).
  Neither touches the record-button gate, so no conflict is expected.
- Hiding `summaryText` / `isTerminal` during the debounce window is a small visible change: the
  green summary disappears for up to 400 ms plus the fetch while the user types. This matches the
  #1049 skeleton behaviour, and is preferable to a summary that contradicts the input.
- Existing page tests use real timers and `waitFor(...toBeEnabled())`, and the waterfall mock
  returns the same data for every amount. These keep passing because the gate only adds
  conditions that become true once the debounce settles.
- `lint-comments.baseline.json` lists all four test files and both `.tsx` routes. If the coder
  touches a listed file, the baseline must shrink, and no new comments may be added (comment-minimal
  rule).

## Open Questions

_None_

## Implementation Steps

1. `packages/trustee/src/routes/-record-coupon.ts` (`useRecordCoupon`):
   - Add `const amountSettled = amountInput === debouncedAmount;`
   - `recordPaymentInput`: return `null` unless `onChainBlockedReason === null && amountSettled`,
     otherwise `buildRepaymentInput(amountBaseUnits, waterfall.data)`.
   - `summaryText`: additionally require `amountSettled`.
   - `isTerminal`: additionally require `amountSettled`.
   - Leave `isCalculating`, rows, `amountWarning` and the third row unchanged.
   - Update the `recordPaymentInput` / `summaryText` doc comments on `RecordCouponView` only where
     they already exist. Wording: "`null` until the entered amount has settled and its preview
     resolved". Add no new comments.
2. `packages/trustee/src/routes/loans.$id_.record-coupon.tsx`: submit `disabled` becomes
   `view.recordPaymentInput == null || view.waterfall.isCalculating || record.isPending`.
3. `packages/trustee/src/routes/-record-repayment.ts` (`useRecordRepayment`): the same
   `amountSettled` gate on the returned `recordPaymentInput` and on `summaryText`. Keep the
   internal `recordPaymentInput` used for the "Originator residual" row (`equityUsd`) as is; that
   row is already skeleton-masked while calculating. Gate only the returned field:
   `onChainBlockedReason === null && amountSettled ? recordPaymentInput : null`.
4. `packages/trustee/src/routes/loans.$id_.record-repayment.tsx`: add
   `view.waterfall.isCalculating` to the submit button's `disabled` expression, alongside
   `recordPaymentInput == null`, `record.isPending` and `record.isSuccess`.
5. Run `yarn workspace @pipeline/trustee test` (or the package's vitest), `tsc`/build for the
   trustee package, `npx tsx scripts/lint-docs.ts`, and `npx tsx scripts/lint-comments.ts`.
   Shrink the baseline if a listed file's count dropped.

## Test Strategy

`packages/trustee/src/routes/-record-coupon-page.test.tsx` (acceptance test):

- **Stale amount is never submitted.** Use `mockUseLoanWaterfall.mockImplementation((_c, _l,
  amount) => ...)` so it returns a waterfall only for the matching raw amount (one fixture for
  `500000000000` = $50,000 and one for `5000000000000` = $500,000, else `undefined`). Enter
  `50000`, `waitFor` submit enabled. Change the input to `500000` and **synchronously** assert
  that submit is disabled. `fireEvent.click(submit)` and assert `mockRecord.mutateAsync` was not
  called. Then `waitFor` enabled, click, and assert `mutateAsync` was called with
  `offtaker_received: "5000000000000"` and the $500,000 fixture's components.
- **Clearing mid-debounce disables submit.** After the amount settles and submit is enabled, change
  the input to `""`. Submit is immediately disabled and a click does not record.
- **Summary hidden while unsettled.** After settling at $50,000, change to $500,000. The summary
  `"Components sum to received $50,000"` is not rendered until the new amount settles, then shows
  `$500,000`.
- Existing tests ("records the payment on-chain…", "#1049" skeleton tests, terminal-hint tests) stay
  green unchanged.

`packages/trustee/src/routes/-record-repayment-page.test.tsx`:

- **Parity regression.** With an amount-keyed waterfall mock, let the prefilled $6,150,000 settle
  and submit enable. `fireEvent.change` the amount (the input is `disabled`, but `fireEvent`
  still drives `onChange`, as the existing tests do) to a different value. Submit is immediately
  disabled, a click does not call `mutateAsync`, and after settling the payload carries the new
  `offtaker_received`.
- **Prefill window.** Immediately after render, before the prefill debounce settles, submit is
  disabled. The existing "disables until ready" test already covers this; confirm it still holds.

Hook unit tests (`-record-coupon.test.ts`, `-record-repayment.test.ts`) cover only pure helpers.
No helper changes, so no updates are needed there.

Manual check (optional, staging): on Record Coupon, type `50,000`, append `0` and click at once.
The button is disabled until the preview for 500,000 resolves. Do not drive the user's browser;
the user can confirm on their own session.

## Docs to Update

- `docs/frontend/trustee-flows.md`, section "Cash movement & lifecycle actions": add a short
  subsection after "Scale handling", e.g. "### Record action gating (#1622, both flows)". It states
  that the recorded payload is built only from the settled (debounced) amount whose waterfall
  preview has resolved; that "Record on the ledger" is disabled while the live input differs from
  the debounced value or the preview is recalculating; and that the green summary / terminal hint
  are hidden while unsettled. It also notes that Record Repayment's read-only prefill makes the
  window unreachable today, and that the gate is kept for parity.
- No product-spec change: this is a `fix/` that restores intended behaviour.
