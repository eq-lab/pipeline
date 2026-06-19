# Issue #677: [FE] [Stellar] Stake page reads PLUSD balance as 0 — assetIssuer hardcoded to "" (can't stake)

Source: https://github.com/eq-lab/pipeline/issues/677

## Scope

Fix the Stellar Stake-tab PLUSD balance read in `packages/frontend/src/wallet/useStakeFlow.ts`. The
hook currently calls `useStellarSacToken` with `assetIssuer: ""`, which only works on the
localStorage mock path. On the real (non-mock) Horizon path, `useStellarSacToken` matches a balance
line on BOTH `asset_code` AND `asset_issuer` (`useStellarSacToken.ts:214-228`); an empty issuer never
matches a real line, so the hook returns `balance: "0"` / `hasTrustline: false` and the stake input/CTA
is gated off (`stellarHasBalance` is false).

In scope:
- Thread the real PLUSD classic-asset issuer into the Stake-tab `useStellarSacToken` call, using the
  same source the deposit/withdraw flow already uses: `useStellarDepositManagerAddresses()` →
  `addresses.plusdAsset.issuer` (`useDepositFlow.ts:310,321`).
- Also pass the resolved PLUSD SAC `contractId` from that same source (`addresses.plusd`) for
  consistency with the deposit flow, replacing the current reliance on `useStellarStakedPlusdAsset()`
  → `plusdContractId` for the SAC query key. Keep `useStellarStakedPlusdAsset()` only if it is still
  needed elsewhere in the file; remove the now-unused binding if not (verify with the type-check).
- Add test coverage that exercises the real Horizon-matching path (issuer-sensitive), since the
  current mock-only coverage hides the bug.
- Verify (no code change expected) the Unstake tab still shows a non-zero sPLUSD balance for a holder,
  since sPLUSD is read via `useStellarStakedPlusdBalance()` (raw bigint from the vault, not Horizon
  issuer-matching).

Out of scope:
- EVM stake/unstake (reads PLUSD via `useEvmToken`, unaffected).
- Any change to `useStellarSacToken` itself — its issuer-matching is correct; the caller passes a bad
  value.
- Trustline / authorization behavior changes.

## Assumptions and Risks

- Assumption: `useStellarDepositManagerAddresses()` resolves the same PLUSD classic issuer that
  Horizon reports for held PLUSD balances. This is the documented protocol issuer
  (`PROTOCOL_ISSUER` / `addresses.plusdAsset.issuer`) and is exactly what the deposit/withdraw flow
  already relies on, so the stake flow should use the identical source.
- Risk: `addresses` is `undefined` while loading. The deposit flow guards with
  `stellarAddresses?.plusdAsset.issuer ?? ""`. During this window the SAC query is disabled
  (issuer empty → no match), so the balance briefly reads as not-ready rather than wrong — acceptable
  and consistent with deposit. Confirm `stellarIsReady` / `isInputDisabled` degrade gracefully (input
  stays disabled until addresses resolve) rather than showing a misleading "0 / can't stake" state.
- Risk: `contractId` only feeds the React Query key and (per the hook docs) future on-chain reads; it
  is not used for matching. Switching its source must not change query behavior beyond cache-key
  identity. Low risk.
- Rules-of-Hooks: all hooks are already called unconditionally in `useStakeFlow`; adding
  `useStellarDepositManagerAddresses()` at the top level (it is already imported pattern in the
  deposit flow) preserves that. Do not call it conditionally.

## Open Questions

_None_

## Implementation Steps

1. In `packages/frontend/src/wallet/useStakeFlow.ts`, import `useStellarDepositManagerAddresses` from
   `@/wallet` (add to the existing Stellar import block, ~lines 48-59).
2. Inside `useStakeFlow`, near the other Stellar hooks (~line 240), call it unconditionally:
   `const { addresses: stellarAddresses } = useStellarDepositManagerAddresses();`
3. Replace the Stake-tab SAC call (`useStakeFlow.ts:247-251`) so it mirrors the deposit flow
   (`useDepositFlow.ts:319-323`):
   ```ts
   const stellarPlusdSac = useStellarSacToken({
     assetCode: "PLUSD",
     assetIssuer: stellarAddresses?.plusdAsset.issuer ?? "",
     contractId: stellarAddresses?.plusd ?? "",
   });
   ```
4. If `useStellarStakedPlusdAsset()` / `stellarPlusdContractId` (lines 241-242) is no longer used after
   step 3, remove the binding and the now-unused import to keep the type-check clean. If it is still
   referenced elsewhere in the file, leave it.
5. Run the TypeScript build / type-check for the frontend package and fix any unused-symbol or type
   errors introduced.

## Test Strategy

- Add a Stellar-active, non-mock-shaped test that fails on the current code and passes after the fix.
  Preferred location: a focused `useStakeFlow` test (new file
  `packages/frontend/src/wallet/useStakeFlow.test.tsx`) OR extend `src/routes/-stake.test.tsx`. The key
  requirement is that the PLUSD SAC balance is seeded via the **Horizon path** (a mocked
  `loadAccount().balances` line carrying the protocol issuer), NOT via the `balanceSacPlusd`
  localStorage mock key — the mock key ignores the issuer and would not catch the bug. Follow the
  Horizon mock pattern already in `src/wallet/stellar/useStellarSacToken.test.tsx:38-109`
  (`MockServer.loadAccount` returning balance lines with `asset_code` / `asset_issuer` / `is_authorized`).
  - Arrange: Stellar wallet connected; `useStellarDepositManagerAddresses` resolving a PLUSD
    `plusdAsset.issuer`; Horizon returns a PLUSD line with `asset_issuer` equal to that resolved issuer
    and a positive balance.
  - Assert: on the Stake tab, `StakeFlowState.balance` is the expected non-zero raw bigint and
    `hasBalance` is true for an in-range amount (equivalently, the stake input/CTA is enabled in the
    route-level test).
  - Negative guard (optional but recommended): a Horizon PLUSD line whose `asset_issuer` differs from
    the resolved issuer yields `balance` 0 / `hasBalance` false — pins the issuer-matching contract.
- Manual/verification check (record in the issue or PR, not necessarily an automated test): on the
  Unstake tab for a holder, confirm sPLUSD balance reads non-zero (sanity per the issue's "Also check"
  note). This requires no code change.
- Run the frontend unit/integration suite (`/test-fast` covers lint + unit + integration) and ensure
  it passes.

## Docs to Update

None. This is a `fix/` that restores intended behavior without changing product or design intent.
The bug's root cause and resolution are captured in this exec plan; no product-spec or design-doc
section changes are warranted.
