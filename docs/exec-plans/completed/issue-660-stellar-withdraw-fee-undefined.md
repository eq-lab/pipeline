# Issue #660: [FE] [Stellar] Withdraw side: network fee not shown; cache estimate for 1 min

Source: https://github.com/eq-lab/pipeline/issues/660

## Scope

Fix the Stellar `stellarNetworkFeeEstimate` React Query so the fee renders on the
**withdraw** side and the query function never resolves to `undefined`.

In scope:

- `packages/frontend/src/wallet/stellar/useStellarNetworkFeeEstimate.ts` —
  remove every `undefined` return path from `queryFn` (React Query rejects an
  `undefined` result with the logged error). Make the function either return a
  defined value or throw, and translate "no fee available" into a defined
  sentinel that callers still render as `feeXlm: undefined` ("—").
- Confirm caching: `staleTime` / `refetchInterval` already 60s — verify they
  remain in place and that the change stops the repeated console errors.
- Tests in `useStellarNetworkFeeEstimate.test.tsx` — extend to cover the
  no-undefined contract for the real query path (success → defined, failure →
  throws / surfaces error, not an undefined-rejection).

Out of scope:

- Any Futurenet/RPC-side fixes (transient RPC errors are tolerated, not fixed).
- The deposit/stake/unstake UI wiring (deposit already works; the same fix
  applies uniformly to all directions since they share `queryFn`).
- USD conversion or fee-format changes.

## Root cause

In `useStellarNetworkFeeEstimate.ts`, `queryFn` (typed `Promise<string | undefined>`)
returns `undefined` in two places:

1. Line ~141: `if (!isConnected || !address || !isConfigured) return undefined;`
   (guarded by `enabled`, so effectively unreachable at runtime).
2. Line ~196: the `catch {}` block returns `undefined` when the Soroban
   simulation fails.

React Query forbids an `undefined` resolution and logs:
`Query data cannot be undefined ... query key ["stellarNetworkFeeEstimate","withdraw",...]`.
On the withdraw side the simulation currently fails (transient Futurenet RPC
and/or contract state), so the catch returns `undefined`, the result is rejected,
no value reaches the UI, and `refetchInterval: 60_000` re-runs it, repeating the
error. Deposit happens to succeed right now, so it does not hit the catch.

## Assumptions and Risks

- Assumption: the withdraw simulation failure is primarily a transient
  Futurenet/RPC issue (per the issue Notes), not a client-side encoding bug in
  `buildRequestWithdrawal`. The fix makes the hook resilient regardless; if the
  failure is deterministic, the fee will surface as an error/"—" rather than a
  silent undefined-rejection, which is the correct, debuggable behavior.
- Risk: callers (`useDepositFlow.ts`, `useStakeFlow.ts`) destructure only
  `feeXlm`; the public `UseStellarNetworkFeeEstimateResult` shape (`feeXlm`,
  `isLoading`, `error`) must stay unchanged. The fix is internal to `queryFn`
  plus the final return mapping.
- Risk: choosing "throw on failure" makes `query.error` non-null and
  `query.data` undefined; the final return already maps `query.data ?? undefined`
  to `feeXlm` and surfaces `query.error`, so "—" still renders. Confirm this is
  the desired UX (vs. caching a sentinel "unavailable" success). See Open
  Questions.

## Open Questions

_None_

(Decision recorded for the coder: on simulation failure, **throw** from
`queryFn` rather than returning a sentinel. With `retry: false` this records the
error, keeps `feeXlm` undefined → renders "—", and the cached error respects
`staleTime`/`refetchInterval` so the console is not spammed. This matches the
issue's requirement (2) "returns a value or throws" and (3) graceful tolerance
of transient errors. If a reviewer prefers a non-error sentinel, that is a
cosmetic swap, not a blocker.)

## Implementation Steps

1. [x] In `packages/frontend/src/wallet/stellar/useStellarNetworkFeeEstimate.ts`:
   - Changed `queryFn`'s return type to `Promise<string>` (no `undefined`).
   - Mock fast-path inside `queryFn` already returns a string — kept.
   - Replaced the `if (!isConnected || !address || !isConfigured) return undefined;`
     guard with `throw new Error("stellar fee: not connected or configured")`.
   - Removed the `try/catch` wrapper; errors propagate directly as query errors.
2. [x] Verified `useQuery` options keep `staleTime: 60_000`, `refetchInterval: 60_000`,
   and `retry: false`. With `retry: false`, a thrown error is recorded once and
   not retried until the next 60s interval, eliminating the console spam.
3. [x] Confirmed the final return mapping still yields `feeXlm: query.data ?? undefined`
   and `error: query.error`. No caller changes needed.
4. [x] Updated the file header doc comment to reflect the new behavior (failure →
   query error; `feeXlm` still undefined so callers render "—").

## Test Strategy

In `packages/frontend/src/wallet/stellar/useStellarNetworkFeeEstimate.test.tsx`:

- Keep existing `formatFeeXlm`, mock-key (deposit + withdraw), and
  disconnected-returns-undefined tests.
- Add a real-query-path test for `direction: "withdraw"` (no mock key, connected):
  mock `@stellar/stellar-sdk`'s `rpc.Server`/`TransactionBuilder` and the
  `WithdrawalQueueClient` so `buildRequestWithdrawal` resolves to an assembled
  XDR with a known fee → assert `feeXlm` becomes the formatted string and
  `error` is null.
- Add a failure-path test: make the simulation reject → assert the hook does NOT
  produce an undefined-rejection (no `Query data cannot be undefined` console
  error), `feeXlm` is undefined, and `result.current.error` is non-null.
- Run the frontend unit suite (vitest) for this file; run
  `npx tsx scripts/lint-docs.ts` after any doc edits per AGENTS.md.

## Docs to Update

- File-level doc comment in `useStellarNetworkFeeEstimate.ts` (behavior on
  failure). No product-spec/design-doc change — this is a `fix/` with no
  user-facing behavior change beyond the fee now rendering as intended.
