# Issue #1501: Trustee: mint the PLUSD leg of a bank deposit on EVM via PipelineMinter.recordWireIn

Source: https://github.com/eq-lab/pipeline/issues/1501 (sub-issue of epic #1494)

## Scope

Add an EVM write path to the Trustee "Mint PLUSD" action on the LP counterparty detail's bank-deposits section (#1449), parallel to the existing Soroban `record_wire_in` path.

In scope:
- New `packages/wallet-connect/src/evm/contracts/minter.ts`: `recordWireIn` over `@wagmi/core` (`simulateContract` -> `writeContract` -> `waitForTransactionReceipt`) with a minimal `pipelineMinterAbi` (function + `WireInRecorded` event + custom errors), exported from `packages/wallet-connect/src/index.ts`.
- Chain selection in the trustee: EVM when the minting address resolves on EVM, Stellar otherwise (existing behaviour unchanged).
- Env: `VITE_EVM_MINTER_ADDRESS` and `VITE_EVM_CAPITAL_WALLET_ADDRESS` in `packages/trustee/src/lib/env.ts`, `docker/trustee/entrypoint.sh`, trustee `.env.example` (if present) and the deploy values that set the Stellar twins.
- EVM error mapping in `mintError` (trustee `-useLpBankDeposits.ts` / `utils/userError.ts`).
- Spec: `docs/product-specs/deposits.md` "EVM PLUSD Mint Leg"; `docs/frontend/trustee-flows.md` LP bank deposits section.

Out of scope: escrow flow (`assignWireIn` / `returnWireIn`), relayer matching (#1500), settlement-address API/UI (#1499), counterparty list display of EVM addresses (#1499), LP app changes.

### Contract surface (hoodi-v5, `eq-lab/pipeline-contracts` `src/minter/MinterUpgradeable.sol`, proxy `0xE75814d9618285AE4d789D4424672597DC494D3E` on 560048)

```solidity
function recordWireIn(address receiver, uint256 amount, uint64 valueDate, bytes32 refHash)
    external restricted whenNotPaused returns (uint256 id);
event WireInRecorded(uint256 indexed id, address indexed receiver, uint256 amount, uint64 valueDate, bytes32 refHash);
error MinterInvalidAmount(); error MinterMissingRef(); error MinterRefHashSeen();
error MinterReceiverNotAllowed(address receiver);
```
`restricted` = OZ AccessManager (`AccessManagedUnauthorized(address)` when the caller lacks the role, i.e. `CASH_REPORTER`); `whenNotPaused` -> `EnforcedPause()`; `_applyRateLimits` adds rate-limit reverts (copy their error names from `src/` rate limiter when writing the ABI). `receiver == address(minter)` escrows; any other receiver is staked directly and must pass `plUsd.hasAccess(receiver)` (whitelist) else `MinterReceiverNotAllowed`.

## Assumptions and Risks

Assumptions from upstream (not yet implemented):
- **#1499**: `LpDetail` (`packages/trustee/src/api/useLps.ts`) gains `evm_address: string | null` and a per-address linked-at field (assumed `evm_address_linked_at` alongside the kept `stellar_address` / `address_linked_at`). The coder must read the merged #1499 shape and adapt names; if #1499 is not merged when implementation starts, this issue is blocked.
- **#1500**: the EVM relayer flips `lp_bank_deposits.is_minted` by joining `WireIn` rows on `ref_hash` for chain 560048. Until it ships, an EVM mint stays "Pending -> Waiting for the indexer" and falls back to unminted after the ~2 min window (the UI never fakes the flag). The served `ref_hash` is the same `sha256(payment_reference)` hex for both chains, passed as `bytes32` unchanged.
- The trustee's EVM wallet (already wired for sign-in, #791, via `EvmWalletProvider` / `useEvmWallet`) holds `CASH_REPORTER` on the hoodi-v5 AccessManager. Not verified; a missing role surfaces as the "not authorized" copy.
- `amount` served as a plain-dollar decimal string is scaled to 6 dp (USDC/PLUSD on EVM) with a new `parseUsdDollarsToUint256(…, 6)` helper; more than 6 fractional digits is rejected, never rounded.

Risks:
- The trustee may be signed in with one wallet kind only; minting on EVM requires a connected EVM wallet on `ENV.EVM_CHAIN_ID`. Wrong network must be caught before sending (compare `useEvmWallet().chainId`, prompt `switchChain` per the #1497 wrong-network convention: native wallet prompt, no standalone banner).
- Capital-wallet fallback on EVM must hold PLUSD access (whitelist) or the mint reverts `MinterReceiverNotAllowed`.

## Open Questions

- Chain choice when an LP has **both** a linked Stellar and a linked EVM address (if #1499 allows both): which wins, or should the trustee pick per deposit (e.g. a chain selector in the row)? Plan default pending answer: none chosen; must be decided.
- Chain choice when the LP has **no** linked address: the issue says "mint to the chain's capital wallet" but does not say which chain. Options: (a) the chain of the trustee's currently connected wallet, (b) always Stellar (status quo) unless EVM is linked. Plan proposes (b) for safety.
- EVM no-address fallback: use the new `VITE_EVM_CAPITAL_WALLET_ADDRESS` (issue's instruction, mirrors Stellar `Direct`), or pass the minter's own address so the wire is `Escrowed` and assigned later via `assignWireIn` (native EVM mechanism, no extra whitelisted wallet)? Plan follows the issue (capital wallet); confirm, and supply the staging value for it.
- The issue lists only `VITE_EVM_CAPITAL_WALLET_ADDRESS`; the write also needs the minter address. Confirm adding `VITE_EVM_MINTER_ADDRESS` (staging: `0xE75814d9618285AE4d789D4424672597DC494D3E`) vs. reading it from an existing shared config var.
- Exact field names from #1499 (`evm_address`, per-address linked-at) — to be confirmed once #1499's plan/PR settles.

## Implementation Steps

1. **ABI + write helper** — `packages/wallet-connect/src/evm/contracts/minterAbi.ts` (`as const` ABI: `recordWireIn`, `WireInRecorded`, the Minter errors listed above, `AccessManagedUnauthorized`, `EnforcedPause`, rate-limit errors). `packages/wallet-connect/src/evm/contracts/minter.ts`:
   - `parseUsdDollarsToUint256(decimalStr: string, decimals = 6): bigint` (strict decimal regex, reject >6 fractional digits, zero, negatives).
   - `recordWireInEvm({ config, minterAddress, account, chainId, receiver, amount, valueDate, refHash, onStageChange })` returning `{ hash, wireId: bigint | null }`; stages reuse `RecordWireInStage` (`awaiting-signature` -> `submitting` -> `confirming`). Validate `refHash` as 32-byte hex (`0x`-prefix it if served without), `receiver` with viem `isAddress`. Simulate first so reverts surface decoded (`ContractFunctionRevertedError.data.errorName`) before the signature prompt; decode `wireId` from the receipt's `WireInRecorded` log via `parseEventLogs`; throw if receipt `status === "reverted"`.
   - Export both from `packages/wallet-connect/src/index.ts` (name: `recordWireInEvm` to avoid clashing with the Stellar `recordWireIn`).
   - Get the wagmi `config` the same way `useEvmWallet` does (check `evm/config.ts`); if no accessor exists, expose one rather than constructing a second config.
2. **Env** — `packages/trustee/src/lib/env.ts`: `EVM_MINTER_ADDRESS` (`VITE_EVM_MINTER_ADDRESS`, default `""`) and `EVM_CAPITAL_WALLET_ADDRESS` (`VITE_EVM_CAPITAL_WALLET_ADDRESS`, default `""`); add both `--arg` / JSON lines to `docker/trustee/entrypoint.sh`; add to trustee `.env.example` and wherever `VITE_STELLAR_CAPITAL_WALLET_ID` is set in deploy config (`grep -rn VITE_STELLAR_CAPITAL_WALLET_ID` outside `packages/`).
3. **Receiver + chain resolution** — `packages/trustee/src/routes/-useLpBankDeposits.ts`: replace `wireInReceiver` with `resolveWireInTarget(lp, { stellarCapital, evmCapital })` returning `{ chain: "stellar" | "evm", receiver, isCapitalWallet } | null`, implementing the rule chosen in Open Questions (default: linked EVM address -> EVM; else linked Stellar -> Stellar; else Stellar capital wallet). Pure function, unit-tested.
4. **Mint hook** — `packages/trustee/src/api/useRecordWireIn.ts`: accept `chain` in `UseRecordWireInInput`; dispatch to the Stellar path (unchanged) or to `recordWireInEvm` using `useEvmWallet()` (`address`, `isConnected`, `chainId`), `ENV.EVM_MINTER_ADDRESS`, `ENV.EVM_CHAIN_ID`. EVM guards: minter unset -> "On-chain PLUSD minting is not configured for this environment."; wallet not connected -> "EVM wallet not connected."; wrong chain -> request `switchChain` and abort if declined. Same invalidations on success.
5. **Disabled reasons** — in `mintDisabledReason`, check the wallet and minter config for the resolved target's chain (EVM: `useEvmWallet`, `ENV.EVM_MINTER_ADDRESS`; Stellar: unchanged). Generalise the no-receiver copy: "This LP has no linked settlement address and no capital wallet is configured."; show the target chain in the button's hint (e.g. "Mints on Hoodi" via `evmChainInfo(ENV.EVM_CHAIN_ID).name`).
6. **Error mapping** — extend `mintError` in `-useLpBankDeposits.ts` (and, if decoding needs it, `toUserError` in `packages/trustee/src/utils/userError.ts`) to match decoded viem error names:
   - `MinterRefHashSeen` -> existing RefHashSeen copy (regex `/RefHashSeen/` already matches; add a test).
   - `MinterReceiverNotAllowed` -> "The receiver is not whitelisted for PLUSD."
   - `AccessManagedUnauthorized` -> "Your wallet is not authorized to record wire-ins (CASH_REPORTER)."
   - `EnforcedPause` -> "The minter is paused."
   - chain mismatch (`ChainMismatchError` / our pre-check) -> "Switch your wallet to <chain name> to mint."
   - user rejection keeps the existing `toUserError` mapping.
7. **Wire-up check** — `packages/trustee/src/main.tsx` already mounts `EvmWalletProvider`; confirm the EVM wallet can be connected in the trustee session without disturbing sign-in (`TrusteeSessionProvider.tsx`). If the session forbids a second wallet kind, stop and raise it.
8. **Docs** — see Docs to Update. Every new file starts with the one-line `// spec:` header; no narrative comments.

## Test Strategy

- `packages/wallet-connect/src/evm/contracts/minter.test.ts`: amount scaling (`"1"` -> `1000000n`, `"0.000001"`, reject `"0.0000001"`, `"0"`, `"-1"`, garbage); refHash normalisation; `recordWireInEvm` with mocked `@wagmi/core` — stage order, args passed exactly `[receiver, amount, BigInt valueDate, refHash]`, `wireId` decoded from a fixture `WireInRecorded` log, reverted receipt throws, simulate revert surfaces `MinterRefHashSeen`.
- `packages/trustee/src/api/-useRecordWireIn.test.tsx`: EVM dispatch (env/wallet/chain threaded through), guards (minter unset, not connected, wrong chain), Stellar path unchanged.
- `-useLpBankDeposits` / `-LpBankDepositsSection.test.tsx`: `resolveWireInTarget` matrix (EVM linked, Stellar linked, both, neither with/without each capital wallet); disabled-reason ordering for the EVM target; `mintError` mapping for each EVM error name.
- `pnpm` lint, typecheck, and test-fast for `wallet-connect` and `trustee`.
- Manual staging check (user-driven, not automated in their browser): with a CASH_REPORTER EVM wallet on 560048, mint a recorded deposit for an LP with a linked EVM address; confirm `WireInRecorded` on hoodi.etherscan for the proxy, and (once #1500 is live) `is_minted` flips. Replay the same deposit to see the RefHashSeen copy.

## Docs to Update

- `docs/product-specs/deposits.md`: new "EVM PLUSD Mint Leg" section after "Stellar PLUSD Mint Leg" — signature, `restricted` (`CASH_REPORTER` via AccessManager), 6-dp scaling, `valueDate`, `bytes32 refHash` single-use (`MinterMissingRef` / `MinterRefHashSeen`), receiver rule and whitelist requirement (`MinterReceiverNotAllowed`), Direct vs Escrowed (minter self-address), `WireInRecorded` -> indexer `WireIn` -> #1500 matcher.
- `docs/frontend/trustee-flows.md` § LP bank deposits: chain selection rule, EVM wallet + network requirement, new disabled reasons and error copy, new env vars.
- `docs/frontend/wallet-flows.md` only if `@pipeline/wallet-connect` export list is documented there.
