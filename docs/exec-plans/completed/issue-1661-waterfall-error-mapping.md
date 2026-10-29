# Issue #1661: Trustee: waterfall 422 (incomplete event history) and Default 400 show 'amount too high'

Source: https://github.com/eq-lab/pipeline/issues/1661

Parent epic: #1521. Follow-up to PR #1660 (#1630 / #1544, merged).

## Scope

`mapWaterfallError` in `packages/trustee/src/utils/userError.ts` (~L201-225) maps every 4xx from
`GET /v1/loan-book/{loan_id}/waterfall` to "This amount is too high for this loan. Enter a smaller
amount." with `details: ""`. Two 4xx responses that PR #1660 added are not plain amount problems:

| Server response (`packages/api/src/routes/waterfall.rs`) | Status | Body `error` prefix |
|---|---|---|
| `ensure_event_history_complete` (~L377-395) | 422 | `loan event history incomplete; re-index required (outstanding senior … vs … from indexed events)` |
| Default branch of the split (~L577-584, `NonZeroOnDefault`) | 400 | `loan is in Default: a payment may only repay senior principal (…) plus accrued interest headroom (…), and fees, OET and equity must be 0; amount (…) is too large` |

The trustee `apiFetch` (`packages/trustee/src/api/client.ts`) throws `ApiError(message, status)`
where `message` is the JSON body's `error` field, so `error.status` and the full server text
(`error.message`) are both available in `mapWaterfallError`. No client change is needed.

New mapping, checked in this order:

1. `null`: `null` (unchanged).
2. `chain_id` 400 (`isChainIdError`): delegate to `toUserError` (unchanged, #1602).
3. **422** (`ApiError`, `status === 422`): message
   "Loan data is incomplete — the indexer needs a re-sync. Contact support.",
   `details: error.message` (raw server text), `isSpecific: true`. No amount suggestion.
4. **Default 400** (`ApiError`, `status === 400`, message matches `/^loan is in Default\b/i`):
   message "This loan is in Default: a payment can only cover senior principal and accrued
   interest. Enter a smaller amount.", `details: error.message`, `isSpecific: true`.
5. Any other 4xx: the existing generic copy with `details: ""` (unchanged, D5 / #916).
6. Everything else: the existing "Couldn't preview this payment. Please try again." with
   `details: error.message` (unchanged).

Decision on the Default 400: the issue allows "the server's message (or a Default-specific copy)".
The plan uses **fixed Default-specific copy** with the raw text under details, because the server
string contains raw base-unit numbers (`senior principal (…)`, `headroom (…)`, `amount (…)`), and the
#916 rule (spec: `docs/frontend/trustee-flows.md` "Waterfall error mapping") says the inline message
never shows the raw backend text or numbers. Showing it verbatim inline would also show unscaled
base units.

The consumers (`packages/trustee/src/routes/-record-coupon.ts` ~L416 and
`-record-repayment.ts` ~L429) already pass `errorMessage` and `errorDetails` through to
`InlineError`. A non-empty `details` renders the "View details" trigger, so they need no changes.

Out of scope: backend changes, other `toUserError` / `matchApiStatus` copy, other waterfall 400s
(`as_of` before origination, Fixed-price offtaker overpay, invalid amount). Those keep the generic
amount copy.

## Assumptions and Risks

- The Default 400 is identified by its message prefix `loan is in Default`, because the server sends
  no machine-readable code. If the backend rewords the message, the match falls back to the generic
  amount copy. That is a safe fallback, and a unit test pins the current server prefix. The coder
  should check the prefix against `waterfall.rs` at implementation time.
- The 422 is matched on status alone. `GET …/waterfall` returns 422 only from
  `ensure_event_history_complete` (the utoipa annotation at ~L257 lists only that 422). A future 422
  with another cause would still get the re-sync copy plus raw details, which is acceptable.
- #1660 is merged to main (c66ed79e includes it), so there are no blocking dependencies.

## Open Questions

_None_ (copy for the 422 comes from the issue text; the Default 400 decision is explained in Scope.
The manager or user can override the Default copy wording at review.)

## Implementation Steps

1. `packages/trustee/src/utils/userError.ts`:
   - Add the module constants `WATERFALL_REINDEX_MESSAGE` and `WATERFALL_DEFAULT_MESSAGE` (copy as in
     Scope) and `const WATERFALL_DEFAULT_PATTERN = /^loan is in Default\b/i;`.
   - In `mapWaterfallError`, after the `isChainIdError` branch and before the generic 4xx branch,
     add the 422 branch, then the Default-400 branch. Both return `details: error.message` and
     `isSpecific: true`.
   - Keep the existing generic 4xx and fallback branches unchanged.
   - Follow the comment-minimal rule. Update the existing JSDoc above `mapWaterfallError` to one
     short spec pointer (e.g. `spec: docs/frontend/error-handling.md#waterfall-preview-…`), and
     add no new narrative comments.
2. Leave `-record-coupon.ts` and `-record-repayment.ts` unchanged. Confirm by reading that
   `errorDetails` reaches `InlineError` in both route components (`record-coupon` /
   `record-repayment` `.tsx`), so the new details show a "View details" trigger.

## Test Strategy

Extend `packages/trustee/src/utils/-userError.test.ts` (`describe("mapWaterfallError …")`):

- **422:** `new ApiError("loan event history incomplete; re-index required (outstanding senior 100 in the snapshot vs 90 from indexed events)", 422)`
  maps to the re-sync message, `details` equals the raw text, `isSpecific` is true, and the message
  does not match `/amount/i` and has no digits.
- **Default 400:** `new ApiError("loan is in Default: a payment may only repay senior principal (500) plus accrued interest headroom (20), and fees, OET and equity must be 0; amount (600) is too large", 400)`
  maps to the Default message, `details` equals the raw text, `isSpecific` is true, and the message has no digits.
- **Generic 400:** `new ApiError("amount (999) exceeds the loan's outstanding offtaker balance (…)", 400)`
  still maps to "This amount is too high for this loan. Enter a smaller amount." with
  `details: ""`.
- Existing cases keep passing: 404 generic, 500 / network fallback, null, chain_id 400.
- Run `yarn workspace` trustee lint + typecheck + vitest (or `/test-fast`).

No UI or Figma verification is needed. The change is copy only, rendered through the existing
`InlineError`.

## Docs to Update

- `docs/frontend/error-handling.md`, section "Waterfall preview: no details on the expected-input
  case (D5)": add the two exceptions (#1661). A 422 gets the re-sync copy with raw details. A 400
  starting with `loan is in Default` gets the Default copy with raw details. Also add the two rows
  to the trustee match-order table if waterfall rows are listed there.
- `docs/frontend/trustee-flows.md`, section "Waterfall error mapping (#916)": add one sentence each
  for the 422 re-index case and the Default 400 case. Note that the copy has no numbers and the raw
  server text sits only under "View details".
