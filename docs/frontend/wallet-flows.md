# Wallet flows

Architecture and behavior specs for the chain-agnostic deposit / withdraw / stake flows in
`packages/frontend/src/wallet/**`. This is the home for flow-shape knowledge that previously lived
as file-header docblocks inside the hooks — see [`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

The source hooks carry only code-level comments plus a one-line pointer back to the relevant
section here.

> **Migration status** ([issue #991](https://github.com/eq-lab/pipeline/issues/991), sub-issue #995):
> the deposit/withdraw and stake/unstake adapters below are migrated. The lower-level EVM and
> Stellar integration hooks are scaffolds pending the rest of #995. Do not delete a source comment
> until its content lives in a section here.

## Deposit / withdraw adapter (`useDepositFlow`)

**Source:** `packages/frontend/src/wallet/useDepositFlow.ts`
**Consumer:** the deposit/withdraw route, `packages/frontend/src/routes/deposit.tsx`.

A chain-agnostic adapter that exposes a single `FlowState` shape so the route never calls
EVM- or Stellar-specific hooks directly.

### Architecture

All hooks — both EVM and Stellar, both deposit and withdraw directions — are called
**unconditionally** inside `useDepositFlow` (this is required by the Rules of Hooks; the original
`deposit.tsx` likewise called both directions unconditionally and branched by direction). Inactive
chain/direction hooks disable themselves via their own `enabled` / `requestId === undefined` guards.
At the end the hook selects the active-chain, active-direction values and returns them as
`FlowState`.

### The `FlowState` contract

- The component reads **only** from `FlowState`; all chain-specific detail is hidden inside the hook.
- Per-step toast-state helpers (`step1Tx`, `step2Tx`, `step3Tx`, each `{ isPending, isSuccess,
  error }`) are included so the component can emit toasts without knowing which chain is active.
- `amountBig` is passed **in** from the component (parsed from the text input); the hook does not own
  the input.

### Design choices & invariants

- **Stellar balance scale.** Stellar balances arrive from Horizon as human-decimal strings (e.g.
  `"1.5"`) and are converted to `bigint` at 7 dp (`sacDisplayToRaw`) for amount comparisons.
- **Trustline array invariant.** `FlowState.trustlines` is always `[PLUSD (index 0), USDC (index 1)]`
  on Stellar — both rendered as steps inside the `StepsCard` regardless of direction — and always
  `[]` on EVM (no trustline UI).
- **USDC balance source.** On Stellar the deposit input balance comes from `useStellarToken` — the
  *same* source as the TopBar wallet pill — so the deposit page's balance check can never disagree
  with the header. (The SAC hook reads a separate mock key / issuer and would diverge, surfacing a
  false "Add funds" banner when the user actually holds USDC.)

### Business rules

- **Stellar minimum deposit is $1,000, frontend-owned.** `STELLAR_MIN_DEPOSIT = 1000 × 10^7`.
  Soroban exposes no on-chain minimum getter, so this stays a Stellar-specific frontend rule until
  the contract or API provides a network value. (History: #598 lowered it to $1; #641 restored
  $1,000.) EVM takes its minimum from the on-chain `useDepositManagerMinDeposit`.
- **Both trustlines before Confirm.** On Stellar, both the PLUSD and USDC trustlines must be present
  before the Confirm step can proceed (per issue #604, Q3).

### Request state model

- **Active request.** The active request is the most recent `Deposit`/`Withdraw` in
  `PendingVerification` or `PendingClaim`; it locks the amount input and drives step gating.
- **Completed-deposit reset (fires once).** When the latest deposit settles to `Completed` (and no
  newer `Pending*` exists), the hook raises `isDepositCompleted` so the page resets the form to its
  initial state — there is no terminal "done" layout. The signal is gated by
  `depositCompletedRequestId` / `dismissedDepositRequestId` so the reset fires exactly once per
  completed deposit. The completed request is tracked separately from the active set (a claimed
  request drops out of the active filter); waiting for it to clear avoids re-enabling Claim during
  the API's `PendingClaim` lag.
- **Stellar recovery (API may be empty).** Until the backend request-list sub-issue lands, the
  Stellar API list can be empty, so steps are driven from **on-chain reads + a `localStorage`
  in-flight record**. The in-flight record is written when `request_deposit` succeeds and is only
  cleared by a successful claim through this browser. If the request was claimed any other way
  (different device, the API `Completed` reset, …) the record would linger and pin the form as
  "confirmed" forever. To prevent that, when the on-chain request reads back as already claimed the
  record is treated as inactive (`*InflightActive`) and physically cleared. A claimed request is
  terminal, so this reconciliation never races a genuinely in-flight one.
- **PLUSD authorization window.** When the PLUSD trustline exists but the issuer has not yet
  authorized it, Claim is blocked (it would fail with "balance is deauthorized", contract error
  #11) and the step label reads "Claim your PLUSD — awaiting authorization".
- **Claim voucher `deadline`.** The live on-chain `claim_request(request_id, verifier_signature,
  deadline)` shape (see #800) requires a `deadline`; a voucher missing or with a malformed deadline
  is not treated as claimable.

### Step model

Steps are labelled per (chain, direction):

| Step | EVM deposit | EVM withdraw | Stellar deposit | Stellar withdraw |
|------|-------------|--------------|-----------------|------------------|
| 1 | Approve USDC | Approve PLUSD | Enable PLUSD (trustline) | Enable USDC (trustline) |
| 2 | Confirm USDC transfer | Confirm PLUSD burn | Confirm USDC transfer | Confirm PLUSD burn |
| 3 | Claim PLUSD | Claim USDC | Claim PLUSD | Claim USDC |

### Step error state

Added by #1024, after a failed `requestWithdrawal` left the stepper looking fully successful (the
burn had succeeded on-chain, so the backend indexed the request as `PendingClaim` and step 2 showed
its green check) while the only failure signal was a console error and a transient toast.

- `StepState` is `"idle" | "success" | "error"`. The request step (2) and claim step (3) derive
  `"error"` from their underlying mutation: `mutation.error` set and the mutation not pending. The
  success conditions **win over error** — if the backend/on-chain state says the step genuinely
  completed (e.g. the request is `PendingClaim`), the flow is recoverable and the step stays green.
- `StepInfo.errorMessage` carries the mutation's error message only while `state === "error"`.
- Rendering (`@pipeline/ui` `StepRow`): the error state red-tints the numbered badge and shows the
  message as a red line under the label, but **keeps the action button** so the user can retry —
  unlike the success state, which replaces the button with the green check pill. Error and loading
  rows always render at full opacity.

## Stake / unstake adapter (`useStakeFlow`)

**Source:** `packages/frontend/src/wallet/useStakeFlow.ts`
**Consumer:** the stake/unstake route, `packages/frontend/src/routes/stake.tsx`.

Mirrors `useDepositFlow`: a chain-agnostic adapter exposing a single `StakeFlowState` so the route
never calls chain-specific hooks directly.

### Architecture

All hooks (both EVM and Stellar, both stake and unstake tabs) are called **unconditionally**;
inactive-tab hooks disable themselves via `undefined` arguments. The hook selects the active-chain,
active-tab values and returns `StakeFlowState`. The component reads **only** from `StakeFlowState`;
`amountBig` is passed in from the component; `step1Tx` / `step2Tx` carry per-step toast state.

### Design choices

- **Convert scale differs by chain.** `convertDecimals` — the output scale of the convert/preview
  hooks — is **18** on EVM (`RATE_SCALE = 1e18`) and **7** on Stellar (`SAC_DECIMALS`). Exchange-rate
  rows are truncated (not rounded) to 4 dp.
- **`stellarUsdcToken` is mounted but unused** in the stake flow — called only to satisfy the Rules
  of Hooks (`void stellarUsdcToken`).

### Steps shape by (chain, tab)

| Chain / tab | Steps (StepsCard rows) |
|-------------|------------------------|
| EVM stake | `[Approve PLUSD, Stake]` |
| EVM unstake | `[Unstake]` |
| Stellar stake | `[Enable sPLUSD (trustline), Stake]` |
| Stellar unstake | `[Enable PLUSD (trustline), Unstake]` |

### Trustline model

- **Stake** needs an **sPLUSD** trustline; **unstake** needs a **PLUSD** trustline (same as the
  deposit flow).
- The sPLUSD step uses the fail-safe `trustlineStatus` discriminator: "success" shows **only** when
  the trustline is confirmed `satisfied` (or `not_required` for Soroban-native shares). While the
  share asset is loading or errored, the step stays "idle" and staking is blocked — never a
  false-ready state.

## EVM integration

_Scaffold — to be migrated from `packages/frontend/src/wallet/evm/**` under #995._

## Stellar integration

_Scaffold — to be migrated from `packages/frontend/src/wallet/stellar/**` under #995._

### Withdrawal request decode

`request_withdrawal`'s on-chain return shape changed without notice: the interface doc
(`docs/generated/stellar-protocol-contracts.md`, fetched 2026-06-10) records `-> u128` (the bare
request id), but the deployed contract returns a tuple `(request_id, amount)`. `scValToNative`
turns that tuple into a JS array, and the original `BigInt(String(native))` decode threw
`Cannot convert 0,500000000000 to a BigInt` (the comma is `String([0n, 500000000000n])`) — after
the burn had already succeeded on-chain, so the request id was never persisted and the Claim step
dead-ended (#1024).

`decodeRequestId` (in `useStellarWithdrawalQueue.ts`) therefore accepts **both** shapes: an
array/tuple's first element is the id; a bare bigint/number/string is used as-is. Anything else
throws, preserving the caller's decode-error message. Regenerate the interface doc when the
`stellar` CLI is available to pin the exact tuple types.

### Error normalization

Wallet kits and RPC layers can reject with plain objects, which `new Error(String(err))` rendered
as `[object Object]` (#1024). `toError` (same file) normalizes any thrown value into an `Error`:
real `Error`s pass through; objects with a string `.message` use it; strings become the message;
everything else falls back to JSON, then `String`. All withdrawal-queue mutation catches route
through it.
