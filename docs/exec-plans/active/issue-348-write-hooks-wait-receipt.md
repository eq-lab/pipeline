# Issue #348: /deposit: Claim step flips to 'done' on broadcast instead of waiting for tx receipt

Source: https://github.com/eq-lab/pipeline/issues/348

## Scope

Make the four wagmi write hooks gate their `isSuccess` (and corresponding `isPending`/`error`) on the mined receipt instead of broadcast — mirroring what `useApproval` already does (added in #341). Affected hooks:

- `useRequestDeposit` in `packages/frontend/src/wallet/useDepositManager.ts` (~line 402)
- `useClaim` in `packages/frontend/src/wallet/useDepositManager.ts` (~line 558)
- `useRequestWithdrawal` in `packages/frontend/src/wallet/useWithdrawalQueue.ts` (~line 346)
- `useClaimWithdrawal` in `packages/frontend/src/wallet/useWithdrawalQueue.ts` (~line 507)

For each:

1. Add a `useWaitForTransactionReceipt({ hash: wagmiWrite.data, query: { enabled: walletConnected && wagmiWrite.data !== undefined } })` call (mirroring `useApproval.ts:181-184`).
2. Return `isSuccess = wagmiReceipt.isSuccess` (which already requires `receipt.status === "success"` per wagmi semantics).
3. Compute `isPending = isEstimating || wagmiWrite.isPending || (wagmiWrite.data !== undefined && wagmiReceipt.isLoading)`.
4. Surface receipt errors: `error = writeError ?? wagmiWrite.error ?? wagmiReceipt.error`.

The mock paths (`hasMockKey === true`) already settle in a microtask after broadcast and are not changed — mocks remain "broadcast = success" by design and existing tests rely on that.

Consumer (`packages/frontend/src/routes/deposit.tsx`) requires no API change; `claim.isSuccess` / `requestDeposit.isSuccess` now mean "mined success." The existing `useEffect` paths (step-3 done state, success toast, `refetchBalance()`) automatically fire on the correct edge.

Out of scope:

- The Claim-reverts-on-Hoodi investigation in #347.
- Withdrawal route UI behavior — the withdrawal hooks' consumers (`routes/withdraw.tsx` and any flow page) inherit the same semantics; we only update the hooks, not their callers.
- Refactoring the four hooks into a shared helper (could be tech-debt follow-up).

## Assumptions and Risks

- Assumption: `wagmiReceipt.isSuccess` (from `useWaitForTransactionReceipt`) is `true` only when the receipt has `status === "success"`. Confirmed by wagmi docs and by `useApproval.test.tsx:665` exercising that exact edge.
- Assumption: Callers of these hooks (`deposit.tsx`, `withdraw.tsx`) consume only the documented surface (`isSuccess`, `isPending`, `error`, `data.hash`). They do not branch on the now-removed "broadcast = success" instant.
- Risk: A consumer relying on the *fast* `isSuccess` flip (e.g. clearing form state right after the wallet returns the hash) will now keep showing pending until the receipt is mined. This is the desired correctness change but it may surface elsewhere — covered by the ux-tester pass.
- Risk: Existing `useDepositManager.test.tsx` / `useWithdrawalQueue.test.tsx` tests assert `isSuccess` flips true on broadcast. They must be updated to mock `useWaitForTransactionReceipt` and gate `isSuccess` on the receipt — same shape as `useApproval.test.tsx`.
- Risk: If a transaction is dropped/never mined, the UI will stay in `isPending` indefinitely. This matches the current `useApproval` behavior post-#341 — acceptable for now; no timeout/UX affordance is added in this fix.

## Open Questions

_None_

## Implementation Steps

1. **`useDepositManager.ts` — `useRequestDeposit`:**
   - Import `useWaitForTransactionReceipt` from `wagmi` (already imported elsewhere; verify).
   - After `const wagmiWrite = useWriteContract();`, add:
     ```ts
     const wagmiReceipt = useWaitForTransactionReceipt({
       hash: wagmiWrite.data,
       query: { enabled: walletConnected && wagmiWrite.data !== undefined },
     });
     ```
     Introduce/derive `walletConnected` (`isConnected && address !== undefined`) consistent with the existing `useWallet()` usage in the hook.
   - In the real-path return (~line 396-408):
     - `isPending: isEstimating || wagmiWrite.isPending || (wagmiWrite.data !== undefined && wagmiReceipt.isLoading)`
     - `isSuccess: wagmiReceipt.isSuccess`
     - `error: (writeError ?? wagmiWrite.error ?? wagmiReceipt.error) as Error | null`

2. **`useDepositManager.ts` — `useClaim` (same change pattern):**
   - Add `useWaitForTransactionReceipt` hook call after `const wagmiWrite = useWriteContract();` at line ~443.
   - Update the real-path return block at line ~553-564 with the same three field changes as step 1.

3. **`useWithdrawalQueue.ts` — `useRequestWithdrawal` and `useClaimWithdrawal`:**
   - Same pattern in both hooks. Update real-path return blocks at lines ~340-352 and ~501-513.

4. **Doc comments:** Update the JSDoc on each of the four hooks' `isSuccess` field to read "`true` once the tx receipt is mined with status `success`" (mirror `useApproval.ts:79-85`). If the hook uses a shared `*Result` type alias, update that type's doc comment instead.

5. **Tests:**
   - `useDepositManager.test.tsx`:
     - Mock `useWaitForTransactionReceipt` with a stable state object pattern (copy from `useApproval.test.tsx:60-90`).
     - For both `useRequestDeposit` and `useClaim`, add the four test cases already present for `useApproval`:
       (a) `isPending` stays true while receipt is loading after broadcast;
       (b) `isSuccess` does NOT flip true on broadcast alone;
       (c) `isSuccess` flips true only when `wagmiReceipt.isSuccess` flips true;
       (d) `useWaitForTransactionReceipt` is called with `query.enabled = false` when wallet is disconnected or hash is undefined.
     - Update any existing test that asserted `isSuccess: true` right after broadcast to flip the receipt mock as well.
   - `useWithdrawalQueue.test.tsx`: mirror the same set of test changes for `useRequestWithdrawal` and `useClaimWithdrawal`.

6. **Lint & build:**
   - `yarn lint` (or `npx tsx scripts/lint-docs.ts` per AGENTS.md) and `yarn workspace @pipeline/frontend test` until green.

## Test Strategy

- **Unit / integration tests** (vitest):
  - Add per-hook tests asserting:
    1. After `write()` returns a hash, `isPending` remains `true` and `isSuccess` is `false` until the mocked `useWaitForTransactionReceipt` flips.
    2. When the mocked receipt flips `isSuccess: true`, the hook's `isSuccess` flips `true`.
    3. When the mocked receipt yields an error, the hook surfaces it via `error`.
    4. `useWaitForTransactionReceipt` is invoked with `query.enabled === false` when (a) wallet disconnected, (b) hash undefined.
  - Keep existing mock-path tests intact (mock path still settles on broadcast).
- **Manual / ux-tester regression** (covered by the manager's ux-tester step since #348 has a `frontend` flow label):
  - `/deposit` happy path: step 3's "done" tick and "PLUSD claimed" toast must appear only after the claim tx is mined, not on broadcast. Balance refetch fires at the same edge.
  - `/deposit` request-deposit (step 2) happy path: success toast / state transition gated on receipt.
  - Withdrawal request + claim flows on `/withdraw` (or equivalent route): same expectation.
  - Negative path: a reverted tx (status === "reverted") should NOT show success; instead the error path runs (toast / console error).
- No Figma reference is attached to #348; no design verification step required.

## Docs to Update

- JSDoc comments on the four hooks (and any shared `*Result` types) to describe the new receipt-gated semantics — mirror `useApproval.ts` wording.
- No product-spec update required: this is a bug fix to behavior that already matches the documented intent ("step 3 done after claim succeeds"). The Issue is pure `bug` + `frontend`, no user-facing spec change.
- `docs/exec-plans/known-bugs.md`: no entry needed (this Issue tracks the bug; the plan resolves it).
