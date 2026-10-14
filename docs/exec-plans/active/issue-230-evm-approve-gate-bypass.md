# Issue #230: Deposit: Approve gate bypassed when VITE_DEPOSIT_MANAGER_ADDRESS is unset (allowance check skipped)

Source: https://github.com/eq-lab/pipeline/issues/230
Parent epic: #1494 (EVM support for the LP app)

## Scope

Root cause (confirmed by reading code, not the issue's race hypothesis): the EVM **deposit** gate in
`packages/frontend/src/wallet/useDepositFlow.ts` is written negatively. `evmDepositNeedsApproval`
is `false` whenever `depositAllowance === undefined`, and `undefined` is what `useApproval` returns
while the allowance read is in flight, when the spender is the zero address (env unset), or when the
read errors. Three gates then key off `!evmDepositNeedsApproval`:

- `evmDepositStep1State` -> `"success"` (Approve shows Done),
- `canEvmConfirmDeposit` -> Confirm enabled,
- `evmIsDepositInputFaded` -> input faded as if approved.

So an unknown allowance is treated as sufficient. This is not only a dev/zero-address issue: with a
real `hoodi-v5` DepositManager, Step 1 flashes Done and Confirm is clickable during the allowance
read. The withdraw path (`evmHasSufficientWithdrawAllowance`) and the stake path in
`useStakeFlow.ts` (`evmHasSufficientAllowance`) already gate positively and are correct.

In scope:
- Make the deposit gate pessimistic: approval is only considered satisfied when the allowance is
  known and `>= amount`.
- Mask allowance in `useEvmToken` when the caller passes the zero address as spender (issue's second
  point), so an unconfigured spender reads as "unknown", not as an approval branch.
- Unit tests for the deposit-flow gate states.

Out of scope: setting `hoodi-v5` addresses (#1503), withdraw/stake flows (already correct), spec
realignment (#1504), mock-layer changes.

## Assumptions and Risks

- Live re-verification against the `hoodi-v5` DepositManager (per the #230 comment) depends on #1503
  landing the staging addresses. The code fix and unit tests do not depend on it; the live check
  should be done (or handed to the #1495 QA pass) once #1503 is merged.
- With an unset `VITE_DEPOSIT_MANAGER_ADDRESS`, after the fix the Approve button stays disabled
  (needsApproval is also false when allowance is unknown) and Confirm stays disabled. The deposit
  flow is therefore inert in that config, which is the correct behaviour (no spender to approve).
- Risk: any existing `useDepositFlow.test.tsx` case that relied on `allowance: undefined` meaning
  "approved" will flip; update those to set an explicit sufficient allowance.

## Open Questions

- With an unconfigured DepositManager (zero address), should the deposit card surface an explicit
  "Deposits not configured on this network" message, or is a disabled Approve/Confirm pair enough?
  The plan assumes disabled-only (no new UI copy) unless the user says otherwise.

## Implementation Steps

1. `packages/frontend/src/wallet/useDepositFlow.ts` (EVM derived state, ~line 583):
   - Add `evmHasSufficientDepositAllowance = depositAllowance !== undefined && amountBig > 0n && depositAllowance >= amountBig`
     (mirrors `evmHasSufficientWithdrawAllowance`).
   - Keep `evmDepositNeedsApproval` as-is (it correctly requires a known, short allowance to enable Approve).
2. Same file, step gates (~lines 769-820, 855):
   - `canEvmConfirmDeposit`: replace `!evmDepositNeedsApproval` with `evmHasSufficientDepositAllowance`.
   - `evmDepositStep1State`: replace `(!evmDepositNeedsApproval && amountBig > 0n && isEvmConnected)`
     with `(evmHasSufficientDepositAllowance && isEvmConnected)`.
   - `evmIsDepositInputFaded`: replace `!evmDepositNeedsApproval && amountBig > 0n` with
     `evmHasSufficientDepositAllowance`.
   - grep the file for any other `!evmDepositNeedsApproval` use and convert it the same way.
3. `packages/frontend/src/wallet/evm/useEvmToken.ts`: treat `spender === ZERO_ADDRESS` like an
   omitted spender for the masked fields (`spenderOmitted = spender === undefined || spender === ZERO_ADDRESS`),
   so allowance/approve are `undefined` for an unconfigured spender regardless of mock keys. Keep
   `useApproval` unchanged.
4. Do not add inline narrative comments (project convention); the file header pointer is enough.

## Test Strategy

`packages/frontend/src/wallet/useDepositFlow.test.tsx` — new `describe("useDepositFlow — EVM approve gate (#230)")`
with the existing mocked `useEvmToken`, deposit tab, connected EVM wallet, balance and minDeposit met:
- allowance `undefined` (loading / unconfigured): step1 state `"idle"`, step1 disabled, step2 disabled,
  input not faded.
- allowance `0n`, amount 2000 USDC: step1 `"idle"` and enabled, step2 disabled.
- allowance `>= amount`: step1 `"success"`, step2 enabled, input faded.
- allowance `< amount` but `> 0`: Approve enabled, Confirm disabled.

`packages/frontend/src/wallet/evm/useEvmToken.test.tsx`:
- spender = zero address with an allowance mock key set -> `allowance`, `approve`, `isSufficient` are `undefined`.

Run `pnpm --filter frontend test`, lint and typecheck (`test-fast`). Manual: once #1503 lands, on
staging with a `hoodi-v5` EVM wallet with zero USDC allowance, confirm Step 1 shows Approve (never a
transient Done) and Confirm stays disabled until the approve receipt is mined.

## Docs to Update

- None required for behaviour (it restores the specified approve -> confirm order).
- If `packages/frontend/src/wallet/README.md` describes `useToken` zero-spender behaviour, update the
  line to say a zero-address spender is masked like an omitted one.
