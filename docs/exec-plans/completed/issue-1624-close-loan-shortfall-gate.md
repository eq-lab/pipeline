# Issue #1624: Trustee: Close loan enabled after a shortfall repayment (contract reverts)

Source: https://github.com/eq-lab/pipeline/issues/1624

Parent epic: #1521. Branch: `fix/1624-close-loan-shortfall-gate`.

## Scope

On the Trustee **Record Repayment — Principal** page, the first close-checklist item ("Senior
principal outstanding is zero") goes green on `record.isSuccess`:

```ts
const seniorOk = view.closeChecklist.seniorZero || record.isSuccess;
```

(`packages/trustee/src/routes/loans.$id_.record-repayment.tsx`, added by #1091). A **shortfall**
repayment (offtaker paid less than the senior outstanding, so the waterfall's
`senior_principal_returned` = `min(amount, outstanding)` is below the outstanding) still succeeds
on-chain. The checklist then turns green, Close enables, and `close_loan` reverts because senior
principal is not zero.

In scope:

1. The senior gate comes **only** from the refreshed loan-book `senior_outstanding`
   (`view.closeChecklist.seniorZero`). `record.isSuccess` no longer affects close enablement.
2. Make the post-record refetch catch up quickly so a full repayment still enables Close within
   seconds. Today `record_payment` invalidates the loan-book once, right away. That refetch races
   the indexer, and the next 30 s `refetchInterval` poll is the fallback. Use the same fix
   `useCloseLoan` already has (#1092): invalidate immediately, then again at 5 s and 15 s.
3. Update tests and the spec (`docs/frontend/trustee-flows.md`) to match.

Out of scope:

- The other checklist items (nothing-to-mint, offtaker acknowledgement). They are already served
  values.
- The record button's "Payment recorded" lock and the fully-paid-notice suppression while
  `record.isSuccess`. These stay as they are. They control the record action, not Close.
- The Record Coupon page (`loans.$id_.record-coupon.tsx`). It has no `isSuccess` close gate. It
  does share `useRecordPayment`, so it gets the faster refetch as a harmless side effect.
- The full S15 close-loan checklist screen (#982).
- Backend or indexer changes.

## Assumptions and Risks

- **Indexer lag is the reason `record.isSuccess` was there.** #1091 used it because the loan-book
  refetch lags the indexer. Removing it means that after a *full* repayment the senior row stays
  unmet (showing the stale outstanding amount) until a refetch returns `senior_outstanding = 0`.
  The 5 s / 15 s re-invalidations shorten that gap. If the indexer takes longer than 15 s, the
  30 s poll still converges it. This UX trade-off is correct: a wrong-but-enabled Close
  (the bug) is worse than a briefly disabled one.
- **No new copy for the wait.** Spec item 1 already says "the unmet row shows the current
  outstanding amount". The row keeps the served outstanding as its detail until the refetch lands.
  No "syncing…" hint is added, because that would be new UX that is not in the spec or Figma.
- `useLoanBook` / `useLoanFinancials` are mounted on this page, so invalidating `["loan-book"]` /
  `["loan-financials"]` triggers an active refetch. The waterfall key does not need delayed
  re-invalidation (the input is fully-paid-gated after refetch).
- The delayed `setTimeout`s run after unmount, the same as `useCloseLoan`. Invalidating an
  unobserved query only marks it stale, so this is harmless.
- Memory rule "no frontend-computed metrics": the fix moves the gate *toward* the served value,
  which is consistent.
- No dependency on other open issues. #1626 (already on main) is unrelated except that it is the
  base.

## Open Questions

_None_

## Implementation Steps

1. **Gate on served data only.** In
   `packages/trustee/src/routes/loans.$id_.record-repayment.tsx`:
   - Delete `const seniorOk = view.closeChecklist.seniorZero || record.isSuccess;`.
   - Use `view.closeChecklist.seniorZero` directly in `closeReady` and in the first
     `<ChecklistRow ok=… detail=…>` (both the `ok` prop and the `detail` ternary).
   - Leave the record button's `record.isSuccess` lock/label and `showFullyPaid` untouched.
   - Do not add explanatory inline comments (comment-minimal rule).
2. **Faster convergence after `record_payment`.** In
   `packages/trustee/src/api/useRecordPayment.ts`, change `onSuccess` to mirror `useCloseLoan.ts`:
   - Keep the immediate invalidation of `["loan-book"]`, `["loan-financials"]` and
     `["loan-waterfall"]`.
   - Re-invalidate `["loan-book"]` and `["loan-financials"]` via `setTimeout` at `5_000` and
     `15_000` ms.
   - Use the same shape as `useCloseLoan`: a local `invalidate` closure plus a `for` loop over the
     delays. Keep it inline; do not extract a shared helper for two call sites.
   - Update the file's header pointer only if its wording claims a single invalidation. It
     currently does not.
3. **View-model JSDoc.** In `packages/trustee/src/routes/-record-repayment.ts`, no logic change.
   `seniorZero` is already `outstandingSeniorUsd != null && outstandingSeniorUsd <= 0` from the
   loan-book. If the file is listed in `scripts/lint-comments.baseline.json`, shrink its baseline
   entry as required by AGENTS.md. Do not add comments.
4. **Spec.** Update `docs/frontend/trustee-flows.md` § "Close-loan gating — the close checklist":
   - Rewrite item 1. It is green only when the refreshed loan-book's `senior_outstanding` is `0`.
     This page's own `record_payment` success does **not** turn it green, because a shortfall
     repayment leaves senior outstanding and `close_loan` would revert (#1624). The unmet row
     shows the current outstanding amount until the refetch lands.
   - Add a sentence next to the existing #1092 paragraph. On success, `useRecordPayment` also
     invalidates loan-book/financials immediately and again at 5 s and 15 s, so a full
     repayment's zeroed senior outstanding reaches the checklist within seconds.
5. Run `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`, and the trustee
   package's lint, typecheck and tests (`yarn workspace @pipeline/trustee test` or the repo's
   `/test-fast`).

## Test Strategy

Update `packages/trustee/src/routes/-record-repayment-page.test.tsx`:

- **New, acceptance 1 (shortfall):** `mockRecord.isSuccess = true`. Use `readyWith` with
  `senior` still non-zero (for example `"1200000.000000"`), `offtaker: "0.000000"` and
  not-minted `0`. Assert:
  - `record-repayment-close-submit` is **disabled**.
  - The first `record-repayment-check-unmet` row has the text "Senior principal outstanding is
    zero" and the outstanding detail ("$1,200,000 outstanding" in `formatFullUsd` output).
  - The record button reads "Payment recorded" and is disabled.
- **New, acceptance 2 (full repayment + refetch):** `mockRecord.isSuccess = true` and the stale
  loan-book (`senior` = the default `4800000.000000`). Assert Close is disabled. Then
  `mockUseLoanBook.mockReturnValue` with `senior_outstanding: "0"` (via `readyWith({ senior: "0",
  offtaker: "0.000000" })`) and `rerender`. Assert Close is **enabled** and all three checklist
  rows are `record-repayment-check-ok`.
- **Fix existing tests that relied on `record.isSuccess` with a non-zero senior.** Each of these
  needs `senior: "0"` in its `readyWith` (the post-refetch state):
  - "ENABLES Close-loan once the terminal payment has been recorded and the refetched financials
    cover the offtaker".
  - "calls useCloseLoan with ScheduledMaturity …".
  - "calls useCloseLoan with EarlyRepayment …".
  - "keeps the just-recorded confirmation when this page's own record succeeded" (it asserts
    Close enabled). Its `fullyPaid()` helper must also set senior to `0`, or the test should
    assert disabled with a non-zero senior. Choose whichever matches the test's intent: the
    notice suppression is what it tests, so set senior `0` and keep the enabled assertion.
- Keep "keeps Close-loan DISABLED on a fully-paid offtaker while the senior outstanding is
  non-zero" passing unchanged.

Add `packages/trustee/src/api/-useRecordPayment.test.tsx`, following the
`-useRecordWireIn.test.tsx` setup (mocked `@pipeline/wallet-connect` `recordPayment` and
`useStellarWallet`, mocked `@/lib/env`, a real `QueryClient` with `invalidateQueries` spied):

- On success, `["loan-book"]`, `["loan-financials"]` and `["loan-waterfall"]` are invalidated
  immediately.
- With `vi.useFakeTimers()`, advancing 5 s and then 15 s re-invalidates `["loan-book"]` and
  `["loan-financials"]` each time.
- On failure, nothing is invalidated.

## Docs to Update

- `docs/frontend/trustee-flows.md`: "Close-loan gating — the close checklist" item 1 and the
  post-success invalidation paragraph (see Implementation step 4).
- No product-spec change: `docs/product-specs/trustee-dashboard.md` Flow 5 already requires
  "outstanding balances at zero" for a benign close. This fix makes the UI enforce it.
