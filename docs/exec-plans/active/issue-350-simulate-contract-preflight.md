# Issue #350: Frontend — pre-flight all contract writes with `simulateContract` for decodable revert reasons

Source: https://github.com/eq-lab/pipeline/issues/350

## Scope

Add a `simulateContract` (`eth_call`) pre-flight to every wallet write hook in
`packages/frontend/src/wallet/`. If the simulate call reverts, the hook sets
`writeError` to the (now decodable) error and skips the
`estimateGasCapped` → `writeContract` path entirely. If simulate succeeds, the
existing estimate/write path runs unchanged.

In scope:

1. New shared helper `simulateOrFail` co-located with `estimateGasCapped` in
   `packages/frontend/src/wallet/estimateGas.ts` (or a sibling file
   `simulate.ts` — see Open Questions).
2. Wire the helper into all 7 write hooks listed in the Issue:
   - `useApproval.ts:268` — `approve`
   - `useDepositManager.ts:339` — `requestDeposit`
   - `useDepositManager.ts:496` — `claimDeposit`
   - `useStakedPlusd.ts:446` — `deposit` (stake)
   - `useStakedPlusd.ts:622` — `redeem` (unstake)
   - `useWithdrawalQueue.ts:283` — `requestWithdrawal`
   - `useWithdrawalQueue.ts:445` — `claimWithdrawal`
3. Port custom-error entries into the remaining ABI subsets so viem can decode
   names:
   - `packages/frontend/src/wallet/abis/withdrawalQueue.ts`
   - `packages/frontend/src/wallet/abis/stakedPlusd.ts`
   - `packages/frontend/src/wallet/abis/erc20.ts` (OZ standard errors:
     `ERC20InsufficientAllowance`, `ERC20InsufficientBalance`,
     `ERC20InvalidApprover`, `ERC20InvalidReceiver`, `ERC20InvalidSender`,
     `ERC20InvalidSpender`).
4. Extend test mocks (`mockPublicClient`) in each `*.test.tsx` to include
   `simulateContract` next to `estimateContractGas`, and add success / revert
   branch coverage per hook.

Out of scope:

- The premature "done" state on Claim (#348).
- Changing `console.error` / toast wiring (#346) — only the *content* of the
  error improves as a side effect.
- Refactoring `estimateGasCapped` itself.
- Mock-mode (`?mock=...`) paths — they short-circuit before the real client.

## Assumptions and Risks

- `publicClient.simulateContract` requires the same arguments the write uses;
  passing an `account` of `undefined` would throw — we gate on
  `walletConnected` exactly like the existing path, so `address` is defined.
- The pre-flight adds one extra RPC round-trip per write. Acceptable: writes
  are user-initiated and already pay an `estimateGas` round-trip.
- Some RPCs may return a different shape between `eth_call` (simulate) and
  `eth_estimateGas`. We assume simulate is the source of truth for the revert
  reason; if it succeeds but estimate still fails (e.g. capped block gas), the
  existing estimate-error path still surfaces something — just less rich.
  This matches the Issue's framing.
- ABI error ports: source ABIs live in `docs.local/` which is gitignored.
  Risk: the local environment running the coder may not have those dumps.
  Mitigation: the coder must obtain the full ABIs (re-export from the
  contracts source repo, or fetch via `cast interface` / `forge inspect`)
  before populating the error lists. The `depositManagerAbi` entry list
  (already present) is the reference pattern.
- viem's `simulateContract` throws `ContractFunctionExecutionError` on revert;
  `err.shortMessage` includes the decoded error name when the ABI has the
  matching `error` entry. We rely on this — no custom decoding required.
- React `useCallback` dep arrays: each hook's write callback gains no new
  external dependency (the helper is a pure import), so existing deps stay
  valid.

## Open Questions

_Resolved by user (2026-05-21):_

1. **Helper location:** New file `packages/frontend/src/wallet/simulate.ts` exporting `simulateOrFail`. Do not touch `estimateGas.ts`.
2. **OZ ERC-20 v5 errors:** Add them unconditionally to `abis/erc20.ts`. Viem falls back gracefully on older tokens.

ABIs for `withdrawalQueue` and `stakedPlusd` are available in `docs.local/`; coder ports error entries directly from there — no `forge inspect` regeneration needed.

## Implementation Steps

1. **Add `simulateOrFail` helper.**
   Create `packages/frontend/src/wallet/simulate.ts` exporting:
   ```ts
   export type SimulateArgs = { publicClient, account, abi, address,
     functionName, args };
   export type SimulateResult = { ok: true } | { ok: false; error: Error };
   export async function simulateOrFail(args: SimulateArgs): Promise<SimulateResult>;
   ```
   Mirror `estimateGasCapped`'s guard semantics: undefined client → `RPC not
   ready`; undefined account → `Wallet not connected`. On success return
   `{ ok: true }`; on any throw return `{ ok: false, error }` (no re-shaping
   of viem errors — viem's `ContractFunctionExecutionError.shortMessage`
   already contains the decoded name).
2. **Port error ABIs.**
   - `abis/withdrawalQueue.ts` — append `type: "error"` entries from the
     full WithdrawalQueue ABI (obtain via `forge inspect WithdrawalQueue
     abi` or equivalent — see Risks). Pattern: copy `depositManager.ts:52-81`
     style.
   - `abis/stakedPlusd.ts` — same procedure from the StakedPLUSD ABI.
   - `abis/erc20.ts` — add the 6 OZ ERC-20 v5 custom errors listed in Scope.
3. **Wire `simulateOrFail` into each write hook.** For each of the 7 sites,
   insert immediately before the current `estimateGasCapped` call inside
   the `void (async () => { setIsEstimating(true); … })()` block:
   ```ts
   const simulated = await simulateOrFail({
     publicClient, account: address, abi: <thisAbi>,
     address: <contractAddr>, functionName: <name>, args: <args>,
   });
   if (!simulated.ok) {
     setIsEstimating(false);
     setWriteError(simulated.error);
     return;
   }
   ```
   Keep the existing `estimateGasCapped` + `writeContract` path untouched.
   Mind: `setIsEstimating(true)` already happens; on simulate failure we
   must reset it before returning (mirrors the existing failure handling
   below the `estimateGasCapped` call).
4. **Extend test mocks.** In each of:
   - `useApproval.test.tsx`
   - `useDepositManager.test.tsx`
   - `useStakedPlusd.test.tsx`
   - `useWithdrawalQueue.test.tsx`

   add `const mockSimulateContract = vi.fn().mockResolvedValue(undefined);`
   and include `simulateContract: mockSimulateContract` in `mockPublicClient`.
   Update `beforeEach` to reset it. Default behavior = resolves so existing
   tests keep passing unchanged.
5. **Add per-hook branch coverage.** For each of the 7 write hooks, add two
   focused tests:
   - "simulate reverts → writeContract not called, error surfaced": configure
     `mockSimulateContract.mockRejectedValueOnce(new Error("…"))`, drive the
     write, assert `wagmiWriteContractMock` was NOT called and that the
     returned hook's `error` reflects the rejection (matches existing
     `estimate-fail` test style — see
     `useDepositManager.test.tsx` around line 760 for the closest analog).
   - "simulate succeeds → estimate + write proceed": ambient default path
     already covered by existing happy-path tests; add an explicit assertion
     that `mockSimulateContract` was called once with the same `(abi,
     address, functionName, args, account)` tuple as the write.
6. **Verify mock-mode paths still skip the real client.** Each hook's
   `hasMock*` early-return must remain before the `simulateOrFail` call.
   Add a regression assertion: in each existing "does NOT call
   estimateContractGas when mock key is present" test, additionally assert
   `mockSimulateContract` was not called.
7. **Run lint + tests.**
   - `yarn --cwd packages/frontend lint`
   - `yarn --cwd packages/frontend test`
   - `npx tsx scripts/lint-docs.ts` from repo root (per AGENTS.md).

## Test Strategy

- Unit tests live next to each hook (`*.test.tsx`); follow the established
  vitest + RTL pattern.
- Coverage matrix (7 hooks × 2 branches + 7 mock-key regressions = 21 new
  test cases, but many can share setup helpers).
- Edge cases to cover explicitly:
  - simulate reverts with a `ContractFunctionExecutionError` carrying a
    decoded `shortMessage` → assert the message is propagated verbatim
    (no wrapping).
  - simulate rejects with a generic `Error` (network) → still surfaced.
  - Wallet not connected → `simulateOrFail` returns the `Wallet not
    connected` error (already a write-hook precondition; assert order of
    checks is unchanged).
- No new E2E tests required. `ux-tester` will validate the visible toast
  improvement against Hoodi only if the manager re-runs UX testing for
  #347's repro scenario — out of scope here.

## Docs to Update

- No product-spec change — this is a frontend resilience/observability
  improvement, not user-facing behavior.
- Update the docstring header in `estimateGas.ts` (or the new `simulate.ts`)
  to link Issue #350 alongside #342, and the docstring at the top of each
  edited ABI file to note that the error block is required for revert
  decoding.
- No `docs/FRONTEND.md` update needed; the wallet hook contract surface is
  unchanged.
- If `simulate.ts` is a new module, add a one-line entry to
  `packages/frontend/src/wallet/README.md` under the helpers section.
