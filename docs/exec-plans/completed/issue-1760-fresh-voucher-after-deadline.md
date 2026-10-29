# Issue #1760: LP: fetch a fresh voucher once the served deadline has passed (24-hour voucher validity)

Source: https://github.com/eq-lab/pipeline/issues/1760 (parent epic #1795)

## Scope

Source of truth: `docs/user-docs/lenders/deposit.md` (Walkthrough step 5, "Abandoned tickets", "Common deposit failure modes") and `docs/user-docs/lenders/withdraw.md` (Flow step 3, "Delays"): a voucher is valid 24 h; once it expires the app fetches a new one; a claim refused for an expired/invalid signature makes the app fetch a fresh voucher.

In scope (LP app, `packages/frontend`):

- The four voucher hooks treat a voucher whose **served** `deadline` (u64 unix seconds, string) is in the past as absent: status `pending` (not `ready`, not `failed`), `data`/`signatureBytes` hidden, and a refetch is triggered. No client-side 24 h constant; the served deadline is the only clock.
- While a voucher is ready and carries a deadline, the hook schedules its own refetch for the moment the deadline passes, so a lender who leaves the tab open sees Claim go back to pending and then ready with the fresh voucher.
- On a Stellar claim that fails with the expired/invalid-signature contract error: invalidate the voucher query once per request id, and show the docs copy.
- Claim button while the fresh voucher is in flight: the existing `pending`/loading state, never the "no voucher"/failed state.
- Hook tests, product-spec notes, user-stories doc.

Key finding from research (shapes the scope): the backend serves `deadline` **only on Stellar**. `packages/api/src/routes/vouchers.rs` sets `deadline: None` on both EVM paths (lines ~339, ~440: "`None` for EVM chains, whose signature does not cover a deadline") and `Some(now + CLAIM_DEADLINE_SECS)` on the Stellar path (`packages/shared/src/stellar_voucher.rs:31`, 24 h). EVM `claimDeposit`/`claimWithdrawal(requestId, signature)` take no deadline, so an EVM voucher never expires on-chain. The EVM hooks therefore get the same deadline branch (no-op while the field is absent), so they pick it up automatically if the backend ever serves one; nothing visible changes on EVM today.

Out of scope: backend/contract changes (adding a deadline to the EVM `VerifiedRequests` digest), any countdown/"expires in" UI (not in the docs, and would be a frontend-computed value), the Trustee console.

## Assumptions and Risks

- Comparing the served deadline with the client clock is a gating decision, not a displayed metric, so it does not breach the "no frontend-computed metrics" rule. Client clock skew vs Stellar ledger time can still let a claim with a just-expired voucher reach the chain; the claim-error retry path covers that.
- React Query `refetchInterval` returning a number of ms is used for the deadline timer; with `refetchIntervalInBackground` false (default) a hidden tab will not fire it, but `refetchOnWindowFocus`/`refetchOnMount` (staleTime 0) refetch on return, and the status derivation hides the expired voucher regardless of whether a refetch has run. A hook-level `now` must re-evaluate on render; add a `useEffect` timer that forces a re-render at the deadline (or rely on the refetch's `isFetching` transition) - coder picks the simpler one that the tests prove.
- The backend signs a new voucher on every GET (Stellar path computes `now + 24h` per request), so a refetch after expiry returns a fresh deadline. Verified by reading `vouchers.rs`; no caching layer found.
- The Soroban contract error number for "deadline passed"/"invalid signature" is not in the repo (no contract source, see `SOROBAN_ERROR_COPY` note in `packages/frontend/src/utils/userError.ts`). See Open Questions.
- Mock layer: the hooks still carry the `pipeline.mock.api` localStorage mock plumbing. Per project rule (no localStorage mocks) the new behaviour is tested with `apiFetch` mocked in Vitest and verified on staging against the real API, not via mock keys. Do not extend the mock layer.
- Comment-minimal rule: the four hooks currently carry long JSDoc headers. Do not add narrative comments; the coder may shrink touched file headers to a single 2-3 line spec pointer (`docs/product-specs/deposits.md#voucher-validity`).

## Open Questions

1. EVM vouchers carry no deadline (backend `deadline: None`, EVM signature does not cover one), so on EVM the docs' "valid for 24 hours" is not enforced anywhere and this issue changes nothing visible there. **Answered 2026-10-29:** EVM stays a no-op in this issue; backend follow-up #1798.
2. _Resolved by the manager from the contract source (pipeline-stellar-contracts @7646cef)._ `claim_request` on both the deposit manager and the withdrawal queue verifies the voucher through the shared `request-queue` crate: an expired deadline panics with `RequestQueueError::DeadlineExpired` = **`Error(Contract, #4)`**. Neither claim path raises its own `#4` (the deposit manager's claim raises no contract error of its own; the withdrawal queue's claim raises only `TooEarly` = `#2`), so `#4` on `claim_request` is unambiguous. A bad signature is not a contract code: `ed25519_verify` fails in the host (`Error(Crypto, InvalidInput)`), which means the signer changed, not that the voucher aged — do **not** retry on it. Scope the claim retry to `#4` only.

## Implementation Steps

1. `packages/frontend/src/api/voucherRetry.ts`: add `isVoucherExpired(deadline: string | undefined, nowMs: number): boolean` (true only for a `/^\d+$/` deadline with `BigInt(deadline) * 1000n <= nowMs`) and `msUntilVoucherDeadline(deadline, nowMs): number | undefined`. Keep it pure; no 24 h constant.
2. `packages/frontend/src/api/useWithdrawalVoucher.ts`: add optional `deadline?: string` to `WithdrawalVoucherResponse` (shape parity; backend already may serialize it).
3. In each of `useDepositVoucher.ts`, `useStellarDepositVoucher.ts`, `useWithdrawalVoucher.ts`, `useStellarWithdrawalVoucher.ts`:
   - `refetchInterval`: if `data.signature` and a deadline exists, return `Math.max(msUntilVoucherDeadline, 1000)`; if signature and no deadline, `false` (unchanged); otherwise unchanged 3000/false logic.
   - Status derivation: `const expired = isVoucherExpired(query.data?.deadline, Date.now())`; `ready` requires `signature && !expired`; an expired voucher yields `pending` (even if `query.error` is set from a previous poll).
   - Return `data: expired ? undefined : query.data` and (Stellar) `signatureBytes` undefined when expired, so `useDepositFlow` can never submit a stale signature.
   - Re-render at the deadline: either rely on the refetch from `refetchInterval`, or a small `useEffect` timer keyed on the deadline; whichever, the test in step 6 must prove status flips to `pending` exactly when the deadline passes.
   - Expose `invalidate: () => void` that calls `queryClient.invalidateQueries({ queryKey: [<key>, requestId, address, chainId] })` (prefix, ignoring `mockVer`).
4. `packages/frontend/src/utils/userError.ts`: add the expired/invalid-signature code(s) from Open Question 2 to `SOROBAN_ERROR_COPY` with docs copy: "The voucher expired or did not match the request. Your app fetches a fresh voucher." Add the row to `docs/frontend/error-handling.md#soroban-contract-error-table`.
5. `packages/frontend/src/wallet/useDepositFlow.ts` (Stellar step 3, around lines 1380-1535): `useEffect` on `stellarStep3Error` - if `parseSorobanContractErrorCode` returns the expired/invalid-signature code and a `useRef<Set<string>>` has not yet seen this request id, call `stellarVoucher.invalidate()` and reset the claim mutation (`stellarClaim.reset?.()` / `stellarClaimWithdrawal.reset?.()` if available) so the step returns to loading/pending; on a second failure for the same id leave the error shown. Mirror for EVM step 3 only behind the same code-match helper (EVM revert text), which today will not trigger since EVM has no deadline. Existing gates (`stellarVoucher.status === "ready"`, `stellarStep2Loading`/`evm step2 loading` include `voucher.status === "pending"`) already give the pending button state; confirm step 3 renders loading, not disabled-without-reason, while pending.
6. Tests (see Test Strategy).
7. Docs (see Docs to Update) and user story.

## Test Strategy

- `packages/frontend/src/api/voucherRetry.test.ts` (new or extend): `isVoucherExpired` for future, past, equal-to-now, missing, non-numeric deadline; `msUntilVoucherDeadline`.
- Each of the four `*.test.tsx` hook tests (vi fake timers, `apiFetch` mocked):
  - voucher with future deadline -> `ready`; advance timers past the deadline -> status `pending`, `data` undefined, `apiFetch` called again; second response with new deadline -> `ready` with the new signature.
  - voucher served already expired -> `pending`, never `ready`, refetches.
  - voucher without deadline (EVM shape) -> `ready` and stays ready; no extra fetch after 24 h of fake time.
  - `invalidate()` triggers a refetch.
- `useDepositFlow` test (existing suite under `packages/frontend/src/wallet/`): Stellar claim rejects with the expired-signature contract error -> voucher invalidated once, step 3 goes to loading; second identical failure -> error copy shown, no further invalidation.
- `userError.test.ts`: new code maps to the docs copy.
- Run `/test-fast` (lint, typecheck, unit). Manual staging check on Stellar testnet with a real request (no mocks): open a PendingClaim request whose voucher is past its deadline, Network tab shows a fresh `GET /v1/deposits/{id}/voucher` with a later `deadline`, Claim succeeds.

## Implementation Notes (coder)

- All seven steps done. Deviation: `invalidate()` uses `resetQueries` (not `invalidateQueries`) so a stale voucher is dropped immediately and a second Claim click cannot reuse it; expiry logic is shared in `voucherRetry.ts` (`voucherRefetchInterval`, `useVoucherExpired`). Step 3 `loading` is unchanged: step 2 `loading` already includes `voucher.status === "pending"`.
- Tests: new `*.deadline.test.tsx` per hook, `voucherRetry.test.ts`, `userError.test.ts`, `useDepositFlow.test.tsx`.

## Docs to Update

- `docs/product-specs/deposits.md` and `docs/product-specs/withdrawals.md`: new `### Voucher validity` section - served `deadline` (Stellar only today; EVM signature has no deadline), app treats a past deadline as no voucher and refetches, one invalidate-and-retry on an expired/invalid-signature claim error.
- `docs/frontend/error-handling.md`: Soroban error table row for the expired/invalid-signature code.
- `packages/frontend/src/api/README.md`: voucher hook section - `invalidate`, expired voucher -> `pending`.
- `docs/user-stories/epic-1795/1760-fresh-voucher-after-deadline.md`: stories for (a) returning after 24 h on Stellar deposit, (b) same for withdrawal, (c) tab left open across the deadline, (d) EVM unchanged, with Network-tab checks against the real API.
- If Open Question 1 resolves to "backend follow-up", add a row to `docs/exec-plans/tech-debt-tracker.md`.
