# Issue #342: /deposit Claim fails with 'transaction gas limit too high (cap: 16777216, tx: 21000000)'

Source: https://github.com/eq-lab/pipeline/issues/342

## Scope

Fix the wallet write hooks so that contract writes never fall through to viem's hard-coded 21 M gas default, and so revert reasons surfaced by `eth_estimateGas` are mapped to the hook's `error` field instead of being swallowed. The user-visible bug is a `Claim` click on `/deposit` that bounces with `transaction gas limit too high (cap: 16777216, tx: 21000000)` — the chain caps tx gas at `0x1000000` (16,777,216) and viem's fallback exceeds that.

In scope:

- Pre-estimate gas in every wallet write hook before calling `writeContract`. Hooks affected:
  - `useClaim` in `packages/frontend/src/wallet/useDepositManager.ts` (the immediate symptom).
  - `useRequestDeposit` in the same file.
  - `useClaimWithdrawal` and `useRequestWithdrawal` in `packages/frontend/src/wallet/useWithdrawalQueue.ts`.
  - `useStake` and `useUnstake` in `packages/frontend/src/wallet/useStakedPlusd.ts`.
  - `useApproval` in `packages/frontend/src/wallet/useApproval.ts` (ERC-20 `approve` — same `writeContract` pattern, same fallback risk).
- Use viem's `publicClient.estimateContractGas(...)` (obtained via wagmi's `usePublicClient()`) before calling `writeContract`. Apply a +20 % buffer (`gas * 12n / 10n`) and clamp the result below the per-tx cap `EVM_TX_GAS_CAP = 16_777_216n - 1n`. Pass the clamped value as the `gas` field on the `writeContract` call so viem never falls back to its 21 M default.
- When estimation throws (revert / network error), surface the underlying error on the hook's `error` result and **do not** call `writeContract`. The existing toast wiring (`Claim failed`, `Deposit failed`, etc.) becomes useful again because the error has a real message.
- Centralise the estimation logic in a new helper module `packages/frontend/src/wallet/estimateGas.ts` so the six-ish hooks do not each reimplement the same pattern. Helper signature roughly:
  ```ts
  type EstimateGasArgs = {
    publicClient: PublicClient | undefined;
    account: `0x${string}` | undefined;
    abi: Abi;
    address: `0x${string}`;
    functionName: string;
    args: readonly unknown[];
  };
  type EstimateGasResult =
    | { ok: true; gas: bigint }
    | { ok: false; error: Error };
  async function estimateGasCapped(args: EstimateGasArgs): Promise<EstimateGasResult>
  ```
  The helper applies the buffer + cap and returns a typed result the hook branches on.
- Export a single `EVM_TX_GAS_CAP` constant (currently `16_777_216n - 1n`; see Open Questions about reading it from env) from `packages/frontend/src/wallet/chain.ts` or a new `wallet/gas.ts`. Reference from `estimateGas.ts`.
- Update each write hook's existing `write` callback to:
  1. Skip estimation entirely when a mock key is present (preserve current zero-RPC mock behaviour) — the early `mockRaw !== undefined` branch stays first.
  2. Skip estimation when the zero-address / wallet-not-connected guard would fire — the existing typed error stays exactly as today.
  3. Otherwise call `estimateGasCapped({...})`. If it returns `ok: false`, surface the error via the existing `useState<Error | null>` write-error state (same channel as the zero-address error today) and return without calling `writeContract`.
  4. If it returns `ok: true`, call `wagmiWrite.writeContract({ ..., gas })` with the clamped value.
- Track the estimation phase in the hook's `isPending` so the UI's Claim/Deposit/Approve button shows the pending state while `eth_estimateGas` is in flight. Implementation: introduce a local `isEstimating` boolean state and expose `isPending: isEstimating || wagmiWrite.isPending`.
- Refresh unit tests in the six affected `*.test.tsx` files to:
  - Assert `writeContract` is called with an explicit `gas` field (buffered, capped).
  - Assert that an estimation failure produces a hook-level `error` without ever calling `writeContract`.
  - Preserve all existing mock-path / zero-address / args-pass-through coverage.
- Update `packages/frontend/src/wallet/README.md` with a short "Gas estimation" subsection documenting the cap, the buffer, and the error-surfacing semantics.

Out of scope:

- Renegotiating the on-chain gas cap (chain-side concern).
- Fixing whatever underlying revert is currently masked on `/deposit` — once estimation surfaces the revert reason, a separate Issue can be filed for the actual root cause (e.g. stale voucher, signer mismatch, double-claim).
- Refactoring the localStorage mock layer.
- A product-spec change. This is a bug fix in the wallet wiring; protocol behaviour and Claim UX semantics are unchanged.
- Any UI-side error formatting beyond the existing "Claim failed" / "Deposit failed" toast tones.

## Assumptions and Risks

- **Wagmi v2 `usePublicClient()` is available in this project.** Verified — `packages/frontend/package.json` pins `wagmi@^3.6.8` and `viem@^2.48.4`; both expose `usePublicClient()` and `publicClient.estimateContractGas({...})`. The hook must always be called (React hooks rule) — branching happens after the call.
- **`publicClient` may be `undefined`.** Until `WagmiProvider` resolves a transport, `usePublicClient()` returns `undefined`. The estimation helper treats `publicClient === undefined` as "skip estimation and fall through to `writeContract` without an explicit gas field" — same behaviour as today; the existing bug only manifests once estimation runs and returns nothing. Alternatively we could `setWriteError(new Error("RPC unavailable"))`; pick the more conservative "fall through" since `useWriteContract` itself queues the call. Implementer should pick the path that matches the existing behaviour for "wallet ready, RPC not yet connected" (see Open Questions).
- **Estimation requires an `account`.** `estimateContractGas` accepts `{ account }`. For `useClaim` etc. the account is the connected wallet; thread it in via `useWallet()` (already imported by `useStakedPlusd.ts`; will need to be added to `useDepositManager.ts` and `useWithdrawalQueue.ts`). When `account === undefined` and the hook does not already short-circuit on that condition, skip estimation and fall through (same rationale as the `publicClient === undefined` case).
- **The per-tx cap value `0x1000000` (16,777,216).** Confirmed by the Issue body and by the chain RPC's own error message. Encode as a constant; do not duplicate the literal. The plan picks `16_777_216n - 1n` (one below the cap) as the clamp ceiling so a buffered estimate that lands exactly on the cap still passes. If a future chain uses a different cap, expose it via env (see Open Questions).
- **+20 % buffer is the standard viem/wagmi pattern.** `gas * 12n / 10n` matches what the Issue body suggests. The buffer must be applied **before** the cap clamp, not after, so the clamp ceiling is respected.
- **Existing mock path stays intact.** The `pipeline.mock.wallet.contract.depositManager.claim` and friends keys must still produce `isSuccess: true` without any RPC call — including no estimation call. Tests pin this.
- **Lifecycle order matters for `isPending`.** The Claim toast (`deposit.tsx:306`) flips to "Claiming…" on `isPending` and to "Claim failed" on `error`. With estimation in front of `writeContract`, `isPending` must be true while estimation runs, then continue to be true while `writeContract` is in flight, then resolve. A naïve `isPending: wagmiWrite.isPending` skips the estimation window and the toast would not appear if estimation rejects before wagmi sees the call. Solution: locally track `isEstimating` and OR it with `wagmiWrite.isPending`. This is the only behavioural change visible to consumers besides the new `error` payloads.
- **Risk: re-entrant `write` calls.** A user could click Claim twice in quick succession. The hook should ignore the second invocation while `isEstimating === true` to avoid stacking estimations. Same applies to the existing wagmi flow (wagmi already de-dups internally but `isEstimating` is our state, so guard it explicitly).
- **Risk: estimation succeeds but the real send still reverts.** Possible — chain state can change between estimate and send. Acceptable; the existing wagmi `error` channel surfaces the post-send revert as today. The fix here removes a specific failure mode (silent 21 M default), it does not promise estimation accuracy.
- **No dependency on unfinished work.** All affected files are merged and in production. No other PR / Issue blocks this.

## Open Questions

_Resolved by user (2026-05-21):_

1. **Cap configuration:** Hard-code `EVM_TX_GAS_CAP` in `wallet/gas.ts`. No env var, no `.env.example` change.
2. **Missing `publicClient` at write time:** Surface `Error("RPC not ready")` via the hook's `error` channel and bail. Do not fall through to `writeContract` without `gas`.
3. **Public API:** Keep `EVM_TX_GAS_CAP` internal to `wallet/gas.ts`. Do not re-export from `wallet/index.ts`.

## Implementation Steps

1. **Create `packages/frontend/src/wallet/gas.ts`.**
   - Export `EVM_TX_GAS_CAP` as `bigint`. Default value `16_777_216n - 1n`. Either hard-coded or read from `ENV.EVM_TX_GAS_CAP` per the Open Questions resolution.
   - Export `GAS_BUFFER_NUMERATOR = 12n` and `GAS_BUFFER_DENOMINATOR = 10n` (or a single `applyGasBuffer(gas: bigint): bigint` helper).
   - Export `clampGas(gas: bigint): bigint` that returns `gas > EVM_TX_GAS_CAP ? EVM_TX_GAS_CAP : gas`.
   - JSDoc the file: why the cap exists, link to the Issue.

2. **Create `packages/frontend/src/wallet/estimateGas.ts`.**
   - Import `Abi`, `PublicClient` types from `viem`. Import `applyGasBuffer`, `clampGas` from `./gas`.
   - Export `estimateGasCapped({ publicClient, account, abi, address, functionName, args })` returning `Promise<{ ok: true; gas: bigint } | { ok: false; error: Error }>`.
   - Implementation: if `publicClient === undefined` return `{ ok: true, gas: 0n }` with a flag that the caller can interpret as "skip the gas field" — or return `{ ok: true, gas: undefined }` and let the caller spread `gas !== undefined ? { gas } : {}` into `writeContract`. Pick the variant with the cleanest call sites.
   - Wrap `publicClient.estimateContractGas({ account, abi, address, functionName, args })` in try/catch. On throw, return `{ ok: false, error }` with the original viem `BaseError`-typed message preserved (`error.shortMessage ?? error.message`).
   - On success: `clampGas(applyGasBuffer(estimated))`.

3. **Update `useDepositManager.ts`.**
   - Import `usePublicClient` from `wagmi`; `useWallet` (already imported elsewhere) for the connected `address`.
   - Add `const publicClient = usePublicClient()` and `const { address } = useWallet()` at the top of `useRequestDeposit` and `useClaim`.
   - Introduce `const [isEstimating, setIsEstimating] = useState(false)`.
   - Replace the `wagmiWrite.writeContract({ ... })` call in `write` with:
     1. `setIsEstimating(true)`.
     2. `const result = await estimateGasCapped({...})`.
     3. `setIsEstimating(false)`.
     4. If `result.ok === false`: `setWriteError(result.error)` (rename `zeroAddrError` → a generic `writeError` mirroring `useStakedPlusd.ts`'s naming, or add a second state — pick whichever keeps the diff small).
     5. Else `wagmiWrite.writeContract({ ..., ...(result.gas !== undefined ? { gas: result.gas } : {}) })`.
   - Update the returned `isPending` to `isEstimating || wagmiWrite.isPending` on the wagmi path.
   - Make `write` `async` (callback already supports it via `useCallback` returning `void`; wrap with `void (async () => {...})()` to keep the public signature `(...) => void`).
   - Guard re-entry: at the top of `write`, `if (isEstimating) return`.

4. **Update `useWithdrawalQueue.ts`.**
   - Apply the same pattern as step 3 to `useRequestWithdrawal` and `useClaimWithdrawal`. They already follow `useDepositManager`'s shape so the diff is mechanical.
   - Add `useWallet` import; thread `address` into `estimateContractGas` as the `account`.

5. **Update `useStakedPlusd.ts`.**
   - Apply the same pattern to `useStake` and `useUnstake`. `useWallet` is already imported.

6. **Update `useApproval.ts`.**
   - Apply the same pattern to the `approve` write. The pre-existing `walletConnected`, `tokenIsZero`, `spenderIsZero` guards already short-circuit before `writeContract`; the new estimation runs only when those pass.

7. **Update `packages/frontend/src/wallet/index.ts`.**
   - Re-export `EVM_TX_GAS_CAP` only if the Open Questions resolve to "expose publicly". Otherwise no barrel change.

8. **Update unit tests.**
   - `useDepositManager.test.tsx`, `useWithdrawalQueue.test.tsx`, `useStakedPlusd.test.tsx`, `useApproval.test.tsx`.
   - Add a top-level `vi.mock("wagmi", ...)` extension to mock `usePublicClient` returning an object with a `vi.fn()` `estimateContractGas`.
   - For each write hook test add three new cases:
     - **Happy path with explicit gas:** estimateContractGas resolves to e.g. `1_000_000n`; assert `writeContract` is called with `gas: 1_200_000n` (1M × 12 / 10) and `gas` ≤ `EVM_TX_GAS_CAP`.
     - **Cap clamp:** estimate returns a value whose +20 % buffer exceeds the cap (e.g. `20_000_000n`); assert `gas: EVM_TX_GAS_CAP` (i.e. `16_777_215n`).
     - **Estimation rejects:** mock `estimateContractGas` to reject with `new Error("execution reverted: stale voucher")`. Assert hook `error` matches that message and `writeContract` is NOT called.
   - Preserve all existing tests (mock-path bypass, zero-address bypass, args pass-through). The args-pass-through tests must be updated to assert on `gas` too, or relaxed to not care about extra fields — pick the stricter "exact object match including gas" form to lock in regression coverage.

9. **Manual smoke test.**
   - Run `yarn workspace @pipeline/frontend dev`. With a wallet connected and a deposit in `PendingClaim` state, click Claim and confirm: (a) the toast shows "Claiming…" while estimation runs, (b) on success the tx broadcasts with a sane gas value (`< 16,777,216`), (c) on failure the toast shows "Claim failed" with the actual revert reason in the `error` (visible in the React DevTools / a temporary `console.error` left out of the commit).

10. **Lint and typecheck.**
    - `yarn workspace @pipeline/frontend lint` (boundary lint — `viem` types must only be imported from inside `wallet/`).
    - `yarn workspace @pipeline/frontend tsc --noEmit`.
    - `npx tsx scripts/lint-docs.ts`.
    - `yarn workspace @pipeline/frontend test`.

## Test Strategy

Coverage in the six existing wallet hook test files. The patterns mirror Issue #211's tests for consistency. Concretely:

- **`useClaim` — explicit gas after estimation.**
  - Mock `estimateContractGas` → `1_000_000n`. Call `write(1n, "0xsig")`. Assert `writeContract` was called with `args` matching the function args **and** `gas === 1_200_000n` (buffered) and `gas < EVM_TX_GAS_CAP`.
- **`useClaim` — cap clamp.**
  - Mock `estimateContractGas` → `20_000_000n`. Assert `gas === EVM_TX_GAS_CAP` (== `16_777_215n`), confirming the buffer is applied before the clamp.
- **`useClaim` — estimation reverts.**
  - Mock `estimateContractGas` to throw `new Error("execution reverted: stale voucher")`. Call `write(1n, "0xsig")`. `waitFor(() => expect(result.current.error?.message).toMatch(/stale voucher/))`. Assert `writeContract` was never called.
- **`useClaim` — `isPending` during estimation.**
  - Use a deferred promise for `estimateContractGas`. Assert `result.current.isPending === true` between the `write()` call and the deferred resolution. After resolution and `writeContract` returning a hash, assert `isPending` settles to `false`.
- **`useClaim` — mock key still bypasses estimation.**
  - Existing test extended: with the `pipeline.mock.wallet.contract.depositManager.claim` key set, call `write` and assert `estimateContractGas` was NOT called.
- **`useClaim` — re-entrant `write` ignored.**
  - With a deferred estimation, call `write` twice. Assert `estimateContractGas` was called once.
- **`useClaim` — `publicClient === undefined` falls through.** (Or surfaces an error, depending on Open Questions resolution.) Pin whichever path is chosen.
- Mirror the same six cases for `useRequestDeposit`, `useRequestWithdrawal`, `useClaimWithdrawal`, `useStake`, `useUnstake`, and `useApproval` (six cases × six hooks; some of them — like the `isPending` during estimation — can be a single shared test if a helper is extracted).

Edge cases explicitly pinned:
- Zero-address short-circuit still wins over estimation (no estimation call when env is zero).
- Wallet-not-connected guard (where present) still wins over estimation.
- `reset()` clears both `writeError` and any in-flight `isEstimating` flag.
- A buffered gas of exactly `EVM_TX_GAS_CAP` passes (no clamp triggered).
- A buffered gas of `EVM_TX_GAS_CAP + 1` clamps down to `EVM_TX_GAS_CAP`.

Manual / UX testing: covered by step 9 above. No Figma reference applies (this is wallet plumbing).

## Docs to Update

- `packages/frontend/src/wallet/README.md` — add a short "Gas estimation" subsection under Public API documenting: (a) every write hook pre-estimates gas, (b) the +20 % buffer, (c) the per-tx cap, (d) estimation failures surface on `error` and skip the broadcast.
- `docs/frontend/hooks.md` — no new rows (no new public hooks). Update the row notes for the six affected hooks if the existing format calls for it.
- `.env.example` — add `VITE_EVM_TX_GAS_CAP=16777216` **only if** Open Questions resolves to "env-driven cap". Otherwise no change.
- No product-spec change. The protocol-level deposit/claim semantics are unchanged; this fixes the LP UI's wallet wiring.
- No `docs/design-docs/` change.
- If estimation surfaces a real revert reason for the current `/deposit` failure during manual testing, file a separate Issue for that root cause and link it from a comment on #342. Do not silently fold a second fix into this PR.
