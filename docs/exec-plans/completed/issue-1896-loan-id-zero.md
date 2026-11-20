# Issue #1896: Trustee: Approve shows no 'View loan' link for loan id 0 (toLoanId drops 0)

Source: https://github.com/eq-lab/pipeline/issues/1896 (sub-issue of epic #1776; logs BUG-35)

## Scope

- `toLoanId` in `packages/wallet-connect/src/stellar/contracts/loanRegistry.ts` (~:307) accepts any
  integer in `[0, 2^32 - 1]` (LoanRegistry `next_loan_id` starts at 0, ids are `u32`).
- `toWireId` in `packages/wallet-connect/src/stellar/contracts/minter.ts` (~:175) accepts 0 too
  (minter `next_id` starts at 0), matching the #1765 / BUG-33 fix in `wireInEscrow.ts` /
  `wireOutSettlement.ts`.
- Tests for id 0 on both parsers; BUG-35 moved to `## Resolved` in `docs/exec-plans/known-bugs.md`.

Audit of other trustee guards (done during planning, no change needed):
- `ApprovedBanner` in `packages/trustee/src/routes/origination.$id.tsx` (~:323) renders the link on
  `loanId != null`, so 0 shows "View loan #0".
- `useDrawLoan` maps `mutation.data?.loanId ?? null` (`??`, not `||`); `-useOriginationReview.ts`
  passes it through.
- `/loans/$id` (`loans.$id.tsx` ~:1246) uses `Number(id)`; `useLoanMutableState` and
  `useRiskCouncilLoanBase` gate on `Number.isInteger` / `!== null`; string-id hooks
  (`useLoanValuation`, `useLoanCcrHistory`, `useRecoveryCandidates`, `useLoanWaterfall`) gate on
  `loanId.length > 0`, so `"0"` passes. No `> 0` or truthiness check on a loan id was found.

Out of scope: backend / indexer handling of loan 0, BUG-34 bookkeeping.

## Assumptions and Risks

- The u32 upper bound is defensive only; chain values are `u32` already. The existing
  `toId(native, 0)` callers (repayment ids, `minter.ts` ~:384/:400) keep working if the cap is
  added inside `toId`; repayment ids are `u32` as well.
- With 0 now valid, `extractDrawnLoanId` / `extractWireId` return the return-value id directly
  instead of falling through to the event scan. Correct behavior.
- Live verification of loan 0 needs a fresh registry; unit tests cover it instead.

## Open Questions

_None_

## Implementation Steps

1. `packages/wallet-connect/src/stellar/contracts/loanRegistry.ts`: change `toLoanId` to
   `Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : null`. Drop the narrative JSDoc above it
   ("positive integer"); the file already has its `// spec:` header.
2. `packages/wallet-connect/src/stellar/contracts/minter.ts`: add the `n <= 0xffffffff` cap to `toId`
   and change `toWireId` to `toId(native, 0)` (or inline `toId(..., 0)` at both call sites and
   delete `toWireId`).
3. `packages/wallet-connect/src/stellar/contracts/loanRegistry.test.ts` (`describe("drawLoan")`
   ~:406): add cases where `returnValue` is `{ __native: 0n }` -> `loanId: 0`, and
   `{ __native: -1n }` / `{ __native: 2n ** 32n }` -> `loanId: null`.
4. `packages/wallet-connect/src/stellar/contracts/minter.test.ts` (`describe("recordWireIn")`
   ~:315): add a case where `returnValue` is `{ __native: 0n }` -> `wireId: 0`.
5. `packages/trustee/src/routes/-origination-detail-page.test.tsx` (next to the #876 test ~:435):
   add `mockReview({ mintedLoanId: 0 })` -> the link reads "View loan #0" and points to `/loans/0`,
   so a later truthiness check cannot regress it.
6. `docs/exec-plans/known-bugs.md`: move BUG-35 from `## Open` to `## Resolved`, title suffixed
   `[FIXED 2026-11-11 / #1896]`, plus a `- **Resolved:** 2026-11-11 by #1896 — toLoanId and toWireId
   accept any u32 including 0; tests cover id 0.` line (BUG-33 pattern).
7. Run lint, typecheck and unit tests for `wallet-connect` and `trustee`
   (`/test-fast`).

## Test Strategy

- Unit: steps 3–5 (id 0 accepted, negative and > u32 rejected, banner renders link for 0).
- Existing tests (`loanId: 42`, `wireId: 42` / `7`, null when no return value) must stay green.
- No UI change, so no Figma or ux-tester pass.

## Docs to Update

- `docs/exec-plans/known-bugs.md` (BUG-35 -> Resolved).
- No product-spec change: `docs/frontend/trustee-flows.md` (~:1824) already says the link shows
  when the drawn `loanId` is known.
