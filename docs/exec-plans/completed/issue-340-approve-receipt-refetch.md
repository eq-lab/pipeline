# Issue #340: /deposit: Approve button stays active after successful approval (allowance not refetched on receipt)

Source: https://github.com/eq-lab/pipeline/issues/340

## Scope

In scope:

- Fix `packages/frontend/src/wallet/useApproval.ts` so that `isSuccess` and the auto-refetch of `allowance` reflect the **mined receipt** of the approve transaction (real wagmi path), not the broadcast/wallet-accept event.
- Use wagmi's `useWaitForTransactionReceipt({ hash })` to track the receipt, gated on the in-flight approve tx hash, and trigger `allowanceRead.refetch()` once the receipt status is `success`.
- Re-export `isSuccess` (and `isPending`) so the surrounding UI (`useToken` → `deposit.tsx`) sees:
  - `isApprovePending = true` from broadcast until the receipt is mined (so the "Approving USDC…" toast stays pending across the entire mine window).
  - `isApproveSuccess = true` only after the receipt confirms (so the "Approval confirmed" toast and step 1 → step 2 transition happen together).
- Preserve the mock path (`pipeline.mock.wallet.contract.<token>.approve`) behavior exactly — `mockState.isSuccess` already settles after the allowance has been observed, and tests rely on the microtask ordering.
- Verify the fix on `/deposit`, `/withdraw`, and `/stake` paths since they all flow through `useToken` → `useApproval`.

Out of scope:

- Reworking toast copy or splitting "broadcast" vs "confirmed" into two distinct toasts (a single pending→success update is sufficient).
- Changing `useRequestDeposit` / `useClaim` "broadcast-accepted" semantics (called out in the JSDoc on `isSuccess` — that comment will be updated since `useApproval` is now receipt-based).
- Polling for externally-changed allowances (already explicitly out per existing JSDoc on `refetch`).

## Assumptions and Risks

- Wagmi v2 exposes `useWaitForTransactionReceipt({ hash, query: { enabled } })` returning `{ data, isLoading, isSuccess, isError }`. The hook returns `isSuccess: false` until a receipt with status `success` is observed; this matches what we need.
- The hook must be unconditionally called (React rules of hooks). When `wagmiWrite.data` is `undefined` (no tx in flight) we pass `hash: undefined` and rely on the wagmi default of disabling the watcher.
- Reset flow: `wagmiWrite.reset()` must clear `wagmiWrite.data` so a subsequent approve starts a new receipt watch. Existing `reset()` already calls `wagmiWrite.reset()`. We rely on wagmi clearing `data` on reset (it does in v2).
- The mock path keeps using `mockState.isSuccess`. Because the mock allowance is updated through localStorage/`useMock` and the approve "settles" in a microtask, the existing tests that assert `refetch()` fires after mock approval continue to pass.
- Risk — flaky behavior on chains with slow finality: pending toast may now be visible longer (until the block confirms). This is the desired UX since the user should not believe the approval is done before it lands.
- Risk — if a user disconnects mid-flight, `wagmiWrite.data` may still hold the previous hash. We will gate the receipt-wait `enabled` on `walletConnected && wagmiWrite.data !== undefined` to avoid stale watches.
- Risk — replacing/cancelling the approve tx (speed-up / cancel from wallet) changes the hash. We accept the standard wagmi behavior here; the original tx's receipt fetch will simply never resolve and the user can retry. Out of scope for this fix.

## Open Questions

_None_

## Implementation Steps

1. [x] Edit `packages/frontend/src/wallet/useApproval.ts`:
   - Import `useWaitForTransactionReceipt` from `wagmi` alongside `useReadContract` / `useWriteContract`.
   - After the `wagmiWrite = useWriteContract()` call, add:
     ```ts
     const wagmiReceipt = useWaitForTransactionReceipt({
       hash: wagmiWrite.data,
       query: { enabled: walletConnected && wagmiWrite.data !== undefined },
     });
     ```
   - Redefine the real-path `isSuccess` and `isPending` semantics:
     - `realIsPending = wagmiWrite.isPending || (wagmiWrite.data !== undefined && wagmiReceipt.isLoading)`
     - `realIsSuccess = wagmiReceipt.isSuccess`
   - Update the top-level `isSuccess` constant used to drive the auto-refetch effect:
     - `const isSuccess = hasApproveMock ? mockState.isSuccess : realIsSuccess;`
   - Update the real-path return object so `isPending` and `isSuccess` use the new values; surface receipt errors via `wagmiReceipt.error` in the error union.
   - Update the JSDoc on `UseApprovalResult.isSuccess` to state: "real path: `true` once the approve tx receipt is mined and status is `success`; mock path: `true` after the mocked approve settles in the next microtask. (This differs from `useRequestDeposit` / `useClaim`, which fire on broadcast.)"
   - Adjust the JSDoc on `UseApprovalResult.isPending` to say: "real path: `true` from broadcast until the receipt is mined; mock path: `true` while the mocked approve is settling."
   - Update the comment on the auto-refetch `useEffect` to note that it now reads against the post-mine allowance, eliminating the stale-cache window described in #340.

2. [x] Verify call sites do **not** need code changes (they already consume `isApprovePending` / `isApproveSuccess` semantically):
   - `packages/frontend/src/wallet/useToken.ts` — passes through unchanged.
   - `packages/frontend/src/routes/deposit.tsx` — `prevIsApproveSuccess` edge-triggered toast and `step1State` derivation now fire after the receipt, exactly as desired. No source change required.
   - `packages/frontend/src/routes/withdraw.tsx` and `packages/frontend/src/routes/stake.tsx` — sanity-check the call sites. Expected to be a no-op; if they read `isApproveSuccess` for similar gating they benefit automatically.

3. [x] Update tests in `packages/frontend/src/wallet/useApproval.test.tsx`:
   - Add a wagmi mock for `useWaitForTransactionReceipt` alongside `useReadContract` / `useWriteContract`, using a mutable `stableReceiptState = { data, isLoading, isSuccess, isError, error }` and a `mockUseWaitForTransactionReceipt` returning it (same pattern as `stableWriteContractState`).
   - Existing "auto-refetch after successful approve (real path)" describe block (line 506+) must be updated:
     - Setting `wagmiWrite.isSuccess = true` alone must NOT trigger `refetch()` (assert `mockRefetch` not called).
     - Setting `wagmiReceipt.isSuccess = true` (after the hash lands) MUST trigger `refetch()` and flip `isSuccess` true.
     - Cover the in-between state: between broadcast and receipt, `isPending` is true and `isSuccess` is false.
   - Add a case for the disconnected guard: `useWaitForTransactionReceipt` query must be disabled when wallet is not connected.
   - Confirm the mock-path auto-refetch test (line 557+) still passes unchanged.
   - Ensure no test regresses the "approve mock key bypasses RPC" path — neither `useWriteContract` nor `useWaitForTransactionReceipt` should be invoked with non-undefined args in the mock path.

4. [x] Run the frontend lint + unit suite:
   - `yarn workspace @pipeline/frontend test --run packages/frontend/src/wallet/useApproval.test.tsx`
   - `yarn workspace @pipeline/frontend test --run` (full FE unit pass)
   - `npx tsx scripts/lint-docs.ts`
   - `yarn workspace @pipeline/frontend build` to confirm no type regression.

5. [ ] Manual smoke (handled by ux-tester once the manager moves the issue forward):
   - On `/deposit`, with a connected wallet that has zero prior allowance, enter an amount ≥ `minDeposit`, click **Approve**, confirm in wallet. While the tx is in the mempool: step 1 stays in idle/pending visual, toast reads "Approving USDC…", step 2 stays disabled. Once mined: step 1 flips to `success`, toast updates to "Approval confirmed", step 2 becomes enabled. No hard refresh required.
   - On `/withdraw` and `/stake`: same Approve gate should still complete and unlock the next step.

## Test Strategy

Automated (vitest, `useApproval.test.tsx`):

- New: `refetch` is NOT called when `wagmiWrite.isSuccess` flips true but `wagmiReceipt.isSuccess` is still false.
- New: `refetch` IS called once `wagmiReceipt.isSuccess` flips true, and `result.current.isSuccess` becomes `true` at the same render.
- New: `isPending` is `true` during the window between `wagmiWrite.isPending` finishing and `wagmiReceipt.isSuccess` flipping true (i.e. while `wagmiReceipt.isLoading === true` and `wagmiWrite.data !== undefined`).
- New: `useWaitForTransactionReceipt` is called with `query.enabled === false` when wallet is disconnected or hash is `undefined`.
- Preserved: mock-path auto-refetch and microtask settle order tests continue to pass without modification.
- Preserved: zero-address / disconnected guard returns expected defaults.

Manual (covered under ux-tester after `executing`):

- `/deposit` happy path on testnet with a real wallet — verify step 1 → step 2 transition only after receipt, and toast copy matches.
- Same on `/withdraw` and `/stake` to catch shared-hook regressions.

## Docs to Update

- JSDoc inside `packages/frontend/src/wallet/useApproval.ts` for `UseApprovalResult.isSuccess` and `isPending` (semantics change from "broadcast-accepted" to "receipt-confirmed" for the real path).
- `packages/frontend/src/wallet/README.md` — if it documents the approve flow semantics, add a one-line note that `useApproval.isSuccess` is receipt-gated (unlike `useRequestDeposit` / `useClaim`).
- No product-spec change required: this is a bug fix that brings observed behavior in line with the intended `/deposit` three-step UX already documented in `docs/product-specs/` and `docs/exec-plans/active/issue-235-three-step-deposit.md`.
- No design-doc change.
