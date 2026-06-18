# Issue #603: Stellar deposit/withdraw flow doesn't surface an unreachable/unconfigured DepositManager banner

Source: https://github.com/eq-lab/pipeline/issues/603

## Scope

Make the Stellar path of the deposit/withdraw page surface the existing
"DepositManager not reachable" danger banner up front when the Stellar
DepositManager / WithdrawalQueue contract is unconfigured or unreachable —
mirroring the EVM behavior. Today the Stellar branch hardcodes
`isManagerUnreachable: false` (`packages/frontend/src/wallet/useDepositFlow.ts:1133`),
so a Stellar user reaches step 2 ("Confirm") and only then gets a generic
"Deposit failed" toast from the action-time guard at
`useStellarDepositManager.ts:225`.

In scope:

- Compute a real `isManagerUnreachable` for the Stellar branch in `useDepositFlow.ts`
  and return it instead of the hardcoded `false`. The Stellar withdraw path also
  treats an empty `VITE_STELLAR_WITHDRAWAL_QUEUE_ID` as unreachable so it does
  not fall through to the action-time `WithdrawalQueue not configured` guard.
- Ensure the seeded-mock fast-path does NOT trip the banner.
- Fix the banner copy so the referenced env var is chain-correct (the banner in
  `deposit.tsx` hardcodes the EVM var `VITE_DEPOSIT_MANAGER_ADDRESS`; on Stellar it
  should read `VITE_STELLAR_DEPOSIT_MANAGER_ID`).
- Add a regression test.

Out of scope:

- Changing the action-time guard at `useStellarDepositManager.ts:225` /
  `useStellarWithdrawalQueue.ts:225` (keep as defense-in-depth).
- Any EVM behavior change.
- Reworking the banner component / Figma redesign.

## Assumptions and Risks

- Assumption: the correct "reachable" signal on Stellar is the resolved
  `stellarAddresses` from `useStellarDepositManagerAddresses()`
  (`useDepositFlow.ts:262`). That hook returns `{ addresses: undefined, isLoading: false }`
  when `depositManagerId` is empty (unconfigured short-circuit,
  `useStellarDepositManagerAddresses.ts:248`) and `{ addresses: <defined>, isLoading: false }`
  in the seeded-mock fast-path (`:234`). Keying off `stellarAddresses === undefined`
  therefore naturally excludes the mock case, satisfying the issue's requirement that
  a seeded mock must not trip the banner. This is preferable to re-reading the raw
  `depositManagerId` env, which would NOT account for the mock fast-path.
- Risk: the banner must only appear once we know the manager is genuinely
  unreachable — gate on `isStellarConnected && !stellarManagerLoading &&
stellarAddresses === undefined` so it does not flash during the initial load or
  when disconnected (the disconnected case is already handled by the earlier
  "Connect your wallet" branch in `deposit.tsx`). This mirrors the EVM guard at
  `useDepositFlow.ts:608`.
- Risk: the existing banner copy is EVM-specific
  (`VITE_DEPOSIT_MANAGER_ADDRESS`, `deposit.tsx:435`). Showing it verbatim on Stellar
  would point the user at the wrong env var. The fix must make the env-var label
  chain-aware. `FlowState` does not currently expose the chain, so the simplest
  approach is for `deposit.tsx` to use the already-available `view`/`isStellar`
  signal it computes for the page; confirm during implementation which local is in scope.
- Risk: `useStellarDepositManagerAddresses()` uses `retry: false` with infinite
  staleness, so a transient RPC failure that yields `addresses === undefined` will
  latch the banner until remount. This matches the issue's "unconfigured OR
  unreachable" intent and mirrors EVM, so it is acceptable.

## Open Questions

_None_

## Implementation Steps

1. [x] In `packages/frontend/src/wallet/useDepositFlow.ts`, in the Stellar branch
       (before the final `return` near line 1040), compute:
   ```ts
   const isStellarManagerUnreachable =
     isStellarConnected &&
     !stellarManagerLoading &&
     stellarAddresses === undefined;
   ```
   `stellarAddresses` and `stellarManagerLoading` are already destructured at
   `useDepositFlow.ts:262`. The mock fast-path returns defined `addresses`, so a
   seeded mock will not set this true.
2. [x] Replace the hardcoded `isManagerUnreachable: false` at
       `useDepositFlow.ts:1133` with `isManagerUnreachable: isStellarManagerUnreachable`.
3. [x] In `packages/frontend/src/routes/deposit.tsx`, make the
       `dm-unreachable-banner` env-var code element (currently `VITE_DEPOSIT_MANAGER_ADDRESS`
       at `:435`) chain-aware: render `VITE_STELLAR_DEPOSIT_MANAGER_ID` on the Stellar
       deposit view, `VITE_STELLAR_WITHDRAWAL_QUEUE_ID` on the Stellar withdraw view,
       and `VITE_DEPOSIT_MANAGER_ADDRESS` on EVM. Use the page's existing
       chain/`view` and direction signals; keep the `dm-unreachable-banner-env` test id intact.
4. [x] Verify no other consumer of `FlowState.isManagerUnreachable` assumes EVM-only
       semantics (`grep isManagerUnreachable packages/frontend/src`) — only `deposit.tsx`
       consumes it, and it now renders chain-aware env var text.

## Test Strategy

- [x] Add a focused unit test for the Stellar branch of `useDepositFlow`
      (new file `packages/frontend/src/wallet/useDepositFlow.test.tsx`):
  - With a Stellar wallet connected, `useStellarDepositManagerAddresses` mocked to
    `{ addresses: undefined, isLoading: false }` → `flow.isManagerUnreachable === true`. ✓
  - Same but `isLoading: true` → `isManagerUnreachable === false` (no flash during load). ✓
  - With `addresses` defined (mock fast-path / configured) → `isManagerUnreachable === false`. ✓
  - Stellar withdraw with DepositManager addresses defined but `VITE_STELLAR_WITHDRAWAL_QUEUE_ID`
    empty → `isManagerUnreachable === true`. ✓
  - Disconnected Stellar wallet → `isManagerUnreachable === false`. ✓
  - Full `useDepositFlow` render via `renderHook` with mocked sub-hooks; no pure-helper
    extraction needed — the mocking approach proved tractable.
- Optional component-level env-var assertion: skipped (unit tests are sufficient for the regression).
- [x] Run `yarn workspace @pipeline/frontend test` and `npx tsx scripts/lint-docs.ts` — both pass (pre-existing failures in AccountDropdown.test.tsx and useStellarWithdrawalQueue.test.tsx are unrelated to this issue).

## Docs to Update

- None required. This is a `fix/` that restores parity with documented EVM behavior;
  no product-spec behavior change. If a deposit/withdraw user-story doc enumerates the
  unreachable-banner behavior per chain, add the Stellar case there during
  implementation (check `docs/user-stories/epic-498/`).
