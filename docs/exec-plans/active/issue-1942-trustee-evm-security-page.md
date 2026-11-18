# Issue #1942: Trustee: Risk Council security page and inspectors on EVM loans

Source: https://github.com/eq-lab/pipeline/issues/1942 (epic #1937, flow: frontend)

## Scope

Make `/risk-council/security/$id` and `/risk-council/inspectors` work for EVM loans. The governing human directive (2026-11-17, epic #1937) is to mirror the Stellar Trustee one-to-one: the security page (#1858, pending operations #1923) and the inspector panel (#1858). Deviate only where the EVM forces it. Every deviation is listed in [Differences from Stellar](#differences-from-stellar).

### Source of truth (checked by the planner on 2026-11-18, worktree base `75461cad`, which includes #2025 / #2026)

- Stellar page code: `packages/trustee/src/routes/{-risk-council-security.ts, risk-council.security.$id.tsx, -risk-council-terms.ts, -risk-council-pending.ts, -RiskCouncilParts.tsx, -risk-council-shared.ts, -risk-council-inspectors.ts, risk-council.inspectors.tsx}`, `api/{useRiskCouncil.ts, useLoanSecurity.ts, pendingOperations.ts}`, `lib/{targetChains.ts, riskCouncilOps.ts, accessManagerAction.ts}`.
- Stellar wallet-connect: `packages/wallet-connect/src/stellar/contracts/{accessManager.ts, securityRegistry.ts, scheduledOperation.ts}`.
- EVM wallet-connect today: `src/evm/{useEvmWallet.ts, config.ts (initEvmWalletConnect, memoised wagmi Config), chains.ts}` and `src/evm/contracts/minter.ts` (pure `encodeFunctionData` encoders, unused). **There is no EVM write client in `@pipeline/wallet-connect`.** The LP app signs EVM transactions with its own React hooks under `packages/frontend/src/wallet/evm/` (`simulateOrFail` then `estimateGasCapped` then `useWriteContract`, receipt-gated; see `docs/frontend/wallet-flows.md#write-pipeline`). The Trustee has no EVM write at all.
- API: `GET /v1/loan-book/{id}/security` serves EVM (#1940; `docs/product-specs/loan-security-state-evm.md`): `paused`, `inspectors` (EIP-55), `terms.default_ratio_bps`, `terms.originator_fee_rate` (1e6 scale), `default_breach`, amounts at 6 dp. `pending_operations` serves EVM rows with `calldata` (`0x` hex, selector included), `args_xdr: null`, Solidity camelCase `function`, ABI-shaped `args` (#1941; `docs/references/access-manager-events.md#evm-args-and-operation-id`).
- EVM contracts `pipeline-contracts@150631a` (read only, frozen):
  - OpenZeppelin `AccessManager`: `canCall(caller, target, bytes4) → (immediate, delay)`, `schedule(target, data, uint48 when) → (bytes32, uint32)`, `execute(target, data)` (payable; consumes a matching schedule whenever `getSchedule != 0`), `getSchedule(bytes32) → uint48` (0 when unscheduled, consumed, cancelled **or expired**), `hashOperation(caller, target, data) = keccak256(abi.encode(...))`. Errors: `AccessManagerAlreadyScheduled`, `AccessManagerNotScheduled`, `AccessManagerNotReady`, `AccessManagerExpired`, `AccessManagerUnauthorizedCall`, …
  - `SecurityRegistryUpgradeable`: `setTerms(uint256, Terms)` (15-field tuple: `advanceRatioBps u32, marginCallRatioBps u32, defaultRatioBps u32, curePeriod u64, priceStaleAfter u64, paymentTerm enum, gracePeriod u64, defaultRate u32, originatorFeeRate u32, attestationInterval u64, inspectionInterval u64, toleranceBps u32, gradeToleranceBps u32, marginCallAt u64, defaultBreachAt u64`; reverts `SecurityRegistryInvalidRatio` unless `advance ≤ marginCall ≤ default`; keeps its own `marginCallAt` / `defaultBreachAt`), `releaseWithConsent(uint256, bytes32)`, `resolveFlag(uint256, FlagOutcome, bytes32)` (`SecurityRegistryNotFlagged`), views `terms`, `record`, `recordIds`, `paused`. All writes are `restricted whenNotPaused`.
  - `PipelineSecurityRecordNft`: `setInspectors(address[])` (`restricted`; reverts `EnforcedPause` while the **registry** is paused; stores an `EnumerableSet`, so duplicates are dropped silently and `inspectors()` returns insertion order), `inspectors()`.
- Hoodi still runs the pre-#55 SecurityRegistry (deployed by contracts PR #53, 12-field `Terms`), so the `setTerms` selector of the 150631a ABI does not exist there. All Hoodi role delays are 0 until #1944. The Trustee targets the 150631a ABI; live testing waits for #1944 and the #55 redeploy.

### In scope

1. **wallet-connect, reusable EVM write client** (`src/evm/contracts/write.ts`, Open Question 1): plain async functions on the memoised wagmi `Config` (`initEvmWalletConnect()`), no React, the same shape as the Stellar `relay`: simulate, then estimate gas (capped), then sign and send, then wait for the receipt, with `onStageChange` and the shared `RelayStage` type. #1573, #1574, #1755 and #1943 reuse it.
2. **wallet-connect, AccessManager bindings** (`src/evm/contracts/accessManager.ts`): `canCall`, `getSchedule`, `hashOperation`, `schedule(target, data, 0)`, `execute(target, data)`; schedule read and verbatim-calldata execute (the EVM counterparts of `readOperationSchedule`, `relay`, `readScheduledOperation`, `executeScheduledOperation`).
3. **wallet-connect, SecurityRegistry + RecordNft bindings** (`src/evm/contracts/securityRegistry.ts`): ABI for `setTerms`, `releaseWithConsent`, `resolveFlag`, the views `terms`, `record`, `recordIds`, `paused` and the error entries; RecordNft `setInspectors`, `inspectors` and errors; calldata encoder from the shared `SecurityRegistryCall`; selector per function; `inspectors()` read; EVM address validation and EIP-55 normalisation.
4. **Trustee:** chain-aware hooks (`useRiskCouncilAccess`, `useRiskCouncilRelay`, `usePendingOperationExecute`, `useSecurityInspectors`), the chain gate lifted for SecurityRegistry functions only, `PendingOperation` / `PendingOpItem` / `ScheduledOp` carrying `calldata`, EVM function-name mapping and `args` decoder, the EVM `Terms` form fields, the inspector panel on the RecordNft with `0x` addresses, EVM error copy by custom-error name.
5. **EVM hides lifted** (`useLoanSecurity` `isStellarTarget`, loans-table `mapLtvCell` / `showLtvColumn`), which also settles the #1940 review finding N2 (Decision 6).
6. **Env:** `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_SECURITY_REGISTRY_ADDRESS`, `VITE_EVM_SECURITY_RECORD_NFT_ADDRESS`.
7. **Docs:** `docs/frontend/trustee-flows.md`, `docs/frontend/wallet-flows.md`, `docs/user-stories/epic-1937/1942-trustee-evm-security-page.md`, the user-stories index, the tech-debt tracker.

### Out of scope

- The hub, Escalate, Amend economics, Default resolution and the repayment-recovery dialog on EVM, and the LoanRegistry / Minter EVM bindings (#1943, #1755). Their actions keep the Stellar-only reason. The security rows that Escalate and Amend economics read from `/security` do render for EVM loans once `useLoanSecurity` is enabled (read-only evidence; see Assumptions).
- EVM LoanRegistry reads (`useRiskCouncilLoanState` stays Stellar-only; the security page does not use it).
- Showing `default_breach` (an EVM-only concept) anywhere in the Trustee. Logged as tech debt (Docs to Update). The page mirrors Stellar, which has no breach.
- Cancelling (TD-159), reconciling served rows with `getSchedule` (TD-187), any backend or contract change, the argocd values (separate repo), migrating the LP app's `wallet/evm` write hooks to the new client.
- No Figma: reuse the existing Risk Council cards and parts (`-RiskCouncilParts.tsx`, `packages/ui`).

## Decisions (planner; mirror Stellar)

1. **Logical calls stay chain-neutral.** `SecurityRegistryCall` (wallet-connect) keeps its snake_case `fn` discriminants (`set_terms`, `resolve_flag`, `release_with_consent`, `set_inspectors`) on both chains, so `CouncilCall`, `councilTarget`, `riskCouncilCallKey`, the session store, `PENDING_OWNERS`, labels and the action view are reused unchanged. `SecurityTermsInput` gains two optional EVM-only fields, `defaultRatioBps?: number` and `originatorFeeRate?: number`. The Stellar encoder throws when either is present (no silent drop). The EVM encoder throws when either is missing. Solidity names come from one map in the EVM module (`EVM_SECURITY_FUNCTION_NAMES`: `set_terms → setTerms`, …, `set_inspectors → setInspectors`).
2. **Chain gate per function.** New `riskCouncilBlockedReason(chainId, fn)` in `lib/targetChains.ts` replaces `stellarOnlyActionReason` inside the Risk Council hooks and presenters. It returns `null` for Stellar. For `chainId === ENV.EVM_CHAIN_ID` it returns `null` when `councilTarget(fn) === "security_registry"`. Otherwise it returns the existing `stellarOnlyActionReason` copy: LoanRegistry functions on EVM until #1943, and an EVM chain id other than the configured one. `stellarOnlyActionReason` stays for every non-Risk-Council caller. The pending-row gate uses the row's `target_kind` the same way: only `security_registry` rows can execute on EVM.
3. **Delay vs immediate**, as on Stellar: `canCall(wallet, target, selector)` drives the existing `accessAction`. `immediate` gives `execute-now`, `delay > 0` gives `schedule` or `execute-scheduled` (from `getSchedule(hashOperation(wallet, target, calldata))`), and `(false, 0)` gives `no-role`. Schedule is `AccessManager.schedule(target, calldata, 0)` (`when = 0`, the earliest time, as Stellar's `when = 0`). Every execute, immediate or scheduled, is `AccessManager.execute(target, calldata)`, one-to-one with Stellar's `AM.execute` (Open Question 2). The selector comes from the ABI (`toFunctionSelector`), never hard-coded.
4. **Execute from the card** sends the served `calldata` verbatim: no decode, no re-encode. Pre-checks, in order, before any wallet prompt: the Risk Council chain gate; the row target equals the configured EVM SecurityRegistry (`PendingTargetMismatchError`); the served registry is not paused (`RegistryPausedError`); the AccessManager is configured; the wallet is connected and equals `caller` (EVM addresses compared case-insensitively); `hashOperation(caller, target, calldata)` equals `0x` + `operation_id` (`PendingArgsMismatchError`); `getSchedule(id) ≠ 0` (`NoLongerScheduledError`); then `AccessManager.execute(target, calldata)`. The same error classes and copy as #1923 are used.
5. **Inspector panel** on EVM targets the RecordNft (`ENV.EVM_SECURITY_RECORD_NFT_ADDRESS`) and reads `RecordNft.inspectors()` on chain. This mirrors Stellar's on-chain `inspectors()` read (TD-186). Addresses are `0x` EVM addresses, normalised to EIP-55 on add (so duplicates are caught case-insensitively); the copy reads "Enter a valid EVM address (0x…)." The chain is still the session chain (`useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`), as on Stellar.
6. **N2 (`useNeedsAttention.ts:131`): no chain gate.** This issue lifts every EVM hide of the security data together: `useLoanSecurity` (`isStellarTarget`), `-useLoansTable.ts` `mapLtvCell` and `showLtvColumn`. The needs-attention row for an EVM margin call then agrees with the loans table, the loan-detail Security card and the security page. The review offered "ship this issue before setting the keys" as one of its two options, and this is that option. A test pins the EVM row in needs-attention.
7. **Config, explicit env, as on Stellar** (`STELLAR_LOAN_REGISTRY_EXECUTOR_ID` + `STELLAR_SECURITY_REGISTRY_ID`): `EVM_ACCESS_MANAGER_ADDRESS`, `EVM_SECURITY_REGISTRY_ADDRESS`, `EVM_SECURITY_RECORD_NFT_ADDRESS`. A missing one gives the existing `SECURITY_NOT_CONFIGURED` copy. Nothing is read from `authority()` or `recordNft()`.
8. **Error copy by custom-error name.** viem decodes custom errors when the ABI passed to `simulateContract` holds their `error` entries. The AccessManager call's ABI therefore also carries the SecurityRegistry and RecordNft errors and `EnforcedPause`; OpenZeppelin `execute` bubbles the target's revert data. A name-keyed `EVM_COUNCIL_ERROR_COPY` maps: `AccessManagerNotScheduled`, `AccessManagerNotReady` and `AccessManagerExpired` to the `execute:6/7/8` copy; `AccessManagerAlreadyScheduled` to the `schedule:9` copy; `SecurityRegistryWrongRecordStatus`, `SecurityRegistryNoTerms` and `SecurityRegistryNotFlagged` to the `#12/#14/#32` copy; `SecurityRegistryInvalidRatio` to "The ratios must be in order: advance ≤ margin call ≤ default."; `EnforcedPause` to `PENDING_PAUSED`. Everything else goes through `toUserError`, which already handles EIP-1193 rejections.

## Differences from Stellar

Everything not listed is identical: routes, page layout and test ids, the cards, the copy, the `accessAction` model, the session bridge and its dedup by `operation_id`, ownership and link rules of the pending card, the executed-row behaviour, invalidation keys and timings, and the confirm dialog for release.

| # | Area | Stellar (#1858, #1923) | EVM (#1942) | Chain-level reason |
|---|---|---|---|---|
| 1 | Write client | `relay`: build the Soroban envelope, `simulateTransaction` + `assembleTransaction`, the wallet kit's `signTransaction(xdr)`, `sendTransaction`, poll | `sendEvmContractCall`: `simulateContract`, `estimateContractGas` (+20 %, capped at 16 777 215, as the LP pipeline), `writeContract({ chainId })`, `waitForTransactionReceipt` (status must be `success`) | Different transaction models; the cap is the Hoodi per-tx gas limit. |
| 2 | Stages | `awaiting-signature`, `submitting`, `confirming` | `awaiting-signature`, then `confirming` once the hash returns; no separate `submitting` | An EVM wallet signs and broadcasts in one `eth_sendTransaction` call. |
| 3 | Wrong network | None (one network per deployment) | `switchChain(ENV.EVM_CHAIN_ID)` before the write when the wallet is on another chain; a rejection surfaces through `toUserError`, and `writeContract` also passes `chainId` as a backstop | EVM wallets can be on any chain. |
| 4 | `can_call` input | `can_call(caller, target, fn: Symbol)` | `canCall(caller, target, bytes4 selector)` from the ABI | OpenZeppelin keys roles by selector. |
| 5 | Operation id | `hash_operation(caller, target, fn, args)`, sha256 of XDR | `hashOperation(caller, target, data)`, keccak of `abi.encode`; compared as `0x` + the served 64 hex | Different hash preimage; same stored form (#1939). |
| 6 | Schedule / execute calls | `schedule(target, fn, args, 0, caller)`, `execute(target, fn, args, caller)` | `schedule(target, data, 0)`, `execute(target, data)`; caller is `msg.sender` | OpenZeppelin takes the full calldata. |
| 7 | Native args on a served row and in the session bridge | `args_xdr`, decoded with `decodeOperationArgs` and re-wrapped (byte-identical) | `calldata`, sent verbatim, no decode; the bridge stores `calldata` in place of `argsXdr` | Calldata is already the exact `execute` argument. |
| 8 | `function` on a served row | snake_case | Solidity camelCase, mapped to the canonical (snake_case) name with the table in `access-manager-events.md#function-names-per-chain`; an unknown name or `0x<selector>` passes through raw | Each chain stores its native name (#1941). |
| 9 | `args` display decode | XDR shapes: `u32` numbers, `u64` strings, `[Symbol]` variants, snake_case struct keys | ABI shapes: `uint256` ids and `uint64` as decimal strings, `uint32` numbers, enums as ordinals, tuple keyed by camelCase names, hashes as lowercase hex without `0x` | Different type systems (#1939). |
| 10 | `Terms` | 12-key `scvMap` sorted by symbol, `margin_call_at = 0` | 15-field tuple in declaration order; `marginCallAt = 0`, `defaultBreachAt = 0` (the contract keeps its own) | Different struct; #55 added three fields. |
| 11 | Terms form | 10 numeric fields + payment term | Adds "Default ratio (%)" (bps, after margin call ratio) and "Originator fee rate (%)" (1e6 scale like default rate, after default rate); the current-terms card and pending rows show both rows | `defaultRatioBps`, `originatorFeeRate` exist only on EVM. |
| 12 | Ratio check | `margin_call ≥ advance` (`InvalidRatio #15`) | Also `default ≥ margin_call`, with its own inline error | `setTerms` checks both. |
| 13 | Ids | `u32` | `uint256`, encoded as `BigInt` from the same safe integer; the API keeps loan ids to `u32` | Solidity ids are `uint256`. |
| 14 | Enums | `scvVec([scvSymbol(name)])` | `uint8` ordinal (`PaymentTerm`, `FlagOutcome` declaration order) | ABI enums. |
| 15 | Inspector target and read | `set_inspectors` and `inspectors()` on the SecurityRegistry (`simulateRead`) | `setInspectors` and `inspectors()` on the RecordNft (`readContract`) | On EVM the panel lives on the RecordNft. |
| 16 | Inspector addresses | Strkey `G…` / `C…`, exact match | `0x` addresses, EIP-55 normalised on add, case-insensitive dedup; the contract also drops duplicates silently | Address formats; `EnumerableSet`. |
| 17 | Contract errors | `Error(Contract, #N)`, codes collide, so the copy is chosen per target kind | Custom-error names decoded by viem, one name-keyed map | Soroban numeric codes vs Solidity custom errors. |
| 18 | Address comparison (caller vs wallet, row target vs config) | Exact Strkey | Case-insensitive (EIP-55 vs lowercase input) | Hex addresses are case-insensitive. |
| 19 | Config | `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `VITE_STELLAR_SECURITY_REGISTRY_ID` | `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_SECURITY_REGISTRY_ADDRESS`, `VITE_EVM_SECURITY_RECORD_NFT_ADDRESS`; the loan's chain must be `ENV.EVM_CHAIN_ID` | Separate contracts; one EVM chain per deployment. |
| 20 | Wallet | `useStellarWallet` (`signTransaction`) | `useEvmWallet` address; signing inside the wallet-connect client; the mock wallet cannot sign and throws, like `signMessage` | Different wallet stacks. |
| 21 | Amounts | 7 dp | 6 dp, served as strings; nothing on these two pages converts amounts (`formatChainAmount` is already chain-aware) | PLUSD has 6 decimals (#1940). |
| 22 | `default_breach` | Not served | Served, not shown (tech debt) | EVM-only concept; the page mirrors Stellar. |
| 23 | Live data | Stage chain 99000001 has Risk Council schedules | None on Hoodi until #1944 (delays) and the #55 SecurityRegistry redeploy | Hoodi delays are 0 and Hoodi runs the 12-field `Terms`. |

## Assumptions and Risks

- **Dependencies merged:** #1940 (PR #2025) and #1941 (PR #2026) are on this base. The Trustee types are still Stellar-only (`args_xdr: string`, no `calldata`). They are fixed first (issue comment from the #1941 review).
- **No live EVM target.** Hoodi runs the pre-#55 SecurityRegistry, so `setTerms(uint256, Terms15)` has a selector Hoodi does not know (simulation reverts), and every Risk Council call there is immediate (delays 0, #1944). Stage config (#1503) does not yet have the EVM AccessManager / SecurityRegistry / RecordNft keys. Coverage is unit and render tests. QA in #1945 runs after #1944, the #55 redeploy and the stage env.
- **Order matters for N2.** If the EVM API SecurityRegistry keys are set on an environment before this ships, needs-attention shows EVM margin calls that the table and security page hide. Merge #1942 before the keys are set (epic merge order step 3/4).
- **`useLoanSecurity` side effects:** enabling EVM also renders the loan-detail Security card and records card, and the Escalate / Amend economics security rows, for EVM loans. They render served strings only (6 dp is served), and their actions stay gated by #1943. The docs that say "omitted for an EVM loan (#1906)" are updated.
- **`getSchedule` returns 0 once expired** (OpenZeppelin). A row that expires between the 30 s poll and the click shows the "No longer scheduled" copy, the same as Stellar (`get_schedule` reads 0 after expiry too). The button is disabled for served `expired` rows.
- **`execute` is payable**; the client sends `value: 0`. The immediate path through `AccessManager.execute` also consumes a pending schedule of the same id (`getSchedule != 0`), so the indexer closes it. A direct target call would leave it live (Open Question 2).
- **Error decoding depends on the ABI** passed to `simulateContract`. A missing `error` entry degrades to the generic `toUserError` message, never to a wrong copy. The test pins one decoded name per contract.
- **Test mocks:** existing Trustee tests mock `@pipeline/wallet-connect` with only `useStellarWallet`. Every mock of a module that now calls `useEvmWallet` (through `useChainWallet`) must add it. Expect wide but mechanical test edits.
- **Sibling #1943** will extend the same hooks for LoanRegistry functions. Keep the EVM arms generic over `CouncilTarget` (target address resolved by a per-chain function), so #1943 adds encoders and flips `riskCouncilBlockedReason` only.
- **Wagmi API names:** wagmi is `^3.6.8` and the existing code still uses `useAccount`. The coder uses whatever `@wagmi/core` exports for the connected account in the installed version (`getAccount` or `getConnection`), plus `switchChain`, `simulateContract`, `estimateContractGas`, `writeContract`, `waitForTransactionReceipt` and `readContract`.

## Decisions (human, 2026-11-18)

1. **EVM write client:** #1942 builds the reusable wallet-connect EVM write client (`src/evm/contracts/write.ts`). #1573, #1574, #1755 and #1943 reuse it.
2. **Immediate path:** `AccessManager.execute(target, data)` for both immediate and scheduled executes, as on Stellar. No direct target call.

## Open Questions

_None_ (resolved 2026-11-18, see Decisions).

## Implementation Steps

Run from `/Users/aabliazimov/Documents/work/pipeline-feat-1942-trustee-evm-security-page`; yarn is `node .yarn/releases/yarn-4.13.0.cjs`. Every new file carries one `// spec:` header line and no other comments (`AGENTS.md`).

1. **Trustee types first** (issue comment, #1941 review):
   - `packages/trustee/src/api/pendingOperations.ts`: `args_xdr: string | null`, `calldata?: string | null` (optional: an older API omits it; read as `null`). Add `EVM_PENDING_FUNCTIONS: Record<string, string>` (camelCase to canonical: `setDefault → set_default`, `cure → cure`, `amendEconomics`, `adjustInterest`, `writeDown`, `closeDefaulted`, `reverseRepay`, `setTerms`, `resolveFlag`, `releaseWithConsent`, `setInspectors`) and `canonicalPendingFunction(fn): string` (map hit, else `fn` unchanged).
   - `api/useLoanSecurity.ts`: `LoanSecurityTerms` gains `default_ratio_bps?: number | null`, `originator_fee_rate?: number | null`. Remove the `isStellarTarget` gate: `enabled = /^\d+$/.test(loanId)`; `notConfigured` is only the 404 code.
2. **wallet-connect, EVM write client** `packages/wallet-connect/src/evm/contracts/write.ts` (spec `docs/frontend/wallet-flows.md#trustee-evm-contract-client`):
   - `EVM_TX_GAS_CAP = 16_777_215n`.
   - `readEvmContract({ abi, address, functionName, args })` via `readContract(initEvmWalletConnect(), …)`.
   - `sendEvmContractCall({ abi, address, functionName, args, account, chainId, onStageChange }): Promise<{ hash }>`:
     - mock wallet set (`readMock` of `pipeline.mock.wallet.address`): throw `"[wallet mock] EVM writes are not mockable; connect a real wallet"`;
     - connected account missing: `"EVM wallet not connected."`; different from `account` (case-insensitive): `"The connected EVM wallet changed. Reconnect {short}."`;
     - wallet chain ≠ `chainId`: `switchChain`;
     - `simulateContract({ account, … })` (revert surfaces with the decoded name);
     - `estimateContractGas` × 12 / 10, clamped to the cap;
     - `onStageChange("awaiting-signature")`, `writeContract({ …, gas, chainId })`, `onStageChange("confirming")`, `waitForTransactionReceipt({ hash, chainId })`;
     - receipt status ≠ `success`: `Error("transaction reverted: {hash}")`.
   - Reuse `RelayStage` from `stellar/contracts/accessManager.ts` as a type-only import, or move the type to a chain-neutral `src/relayStage.ts` and re-export it from both.
3. **wallet-connect, AccessManager** `src/evm/contracts/accessManager.ts` (spec `docs/frontend/trustee-flows.md#risk-council-pending-operations`):
   - `accessManagerAbi`: `canCall`, `getSchedule`, `hashOperation`, `schedule`, `execute` and the eleven `AccessManager*` errors.
   - `readEvmCanCall({ accessManager, caller, target, selector }): CanCall` (`delay` as number).
   - `readEvmOperationSchedule({ accessManager, caller, target, data }): OperationSchedule`: `operationId` is the 64 lowercase hex **without** `0x` (the API form), `readyAt` a number.
   - `relayEvm({ mode, accessManager, caller, target, data, chainId, errorAbi, onStageChange })`: `schedule` is `schedule(target, data, 0)`, `execute` is `execute(target, data)` with `value 0`, both through `sendEvmContractCall` with `abi = [...accessManagerAbi, ...errorAbi]`.
   - `readEvmScheduledOperation({ …, calldata })` and `executeEvmScheduledOperation({ …, calldata })` are thin aliases taking the served calldata verbatim (validate `/^0x([0-9a-f]{2}){4,}$/i`).
   - Validate addresses with `isAddress`; empty ids throw `"<fn>: accessManager must not be empty"` like `requireIds`.
4. **wallet-connect, SecurityRegistry and RecordNft** `src/evm/contracts/securityRegistry.ts` (spec `docs/frontend/trustee-flows.md#risk-council-security-actions`):
   - `evmSecurityRegistryAbi`: `setTerms` with the 15-component tuple named exactly as `ISecurityRegistry.Terms`, `releaseWithConsent`, `resolveFlag`, views `terms`, `record`, `recordIds`, `paused`, errors `SecurityRegistry*` and `EnforcedPause`. `evmSecurityRecordNftAbi`: `setInspectors`, `inspectors`, errors `SecurityRecordNft*` and `EnforcedPause`. `evmSecurityErrorAbi` is the union of the error entries.
   - `EVM_SECURITY_FUNCTION_NAMES` (Decision 1) and `evmSecuritySelector(fn): Hex` (`toFunctionSelector` of the ABI item).
   - `encodeEvmSecurityRegistryCalldata(call: SecurityRegistryCall): Hex`:
     - ids are safe non-negative integers converted with `BigInt`;
     - u32 and u64 range checks as in the Stellar encoder;
     - `paymentTerm` and `outcome` are their index in `SECURITY_PAYMENT_TERMS` / `FLAG_OUTCOMES`;
     - hashes come from `/^[0-9a-f]{64}$/` and are sent as `0x` + hex;
     - `defaultRatioBps` and `originatorFeeRate` are required; the ratio order is `advance ≤ marginCall ≤ default`;
     - `marginCallAt` and `defaultBreachAt` are `0n`;
     - inspectors must pass `isAddress` and are encoded as `getAddress` values, no duplicates (case-insensitive).
   - `evmSecurityTarget(fn, { registry, recordNft })`: `set_inspectors` gives the RecordNft, otherwise the registry.
   - `relayEvmSecurityRegistry({ mode, call, accessManager, registry, recordNft, caller, chainId, onStageChange })` and `readEvmSecurityRegistrySchedule({ call, … })`, the counterparts of `relaySecurityRegistry` / `readSecurityRegistrySchedule`.
   - `readEvmSecurityInspectors({ recordNft }): string[]` (EIP-55).
   - `isEvmInspectorAddress(value)` and `normalizeEvmAddress(value)`.
   - In `stellar/contracts/securityRegistry.ts`: add the two optional fields to `SecurityTermsInput`; `encodeTerms` throws `invalid defaultRatioBps (EVM only)` / `originatorFeeRate` when present.
   - Export everything (and the param types) from `src/index.ts` in a new "EVM Risk Council" block.
5. **Trustee env** `packages/trustee/src/lib/env.ts`: `EVM_ACCESS_MANAGER_ADDRESS`, `EVM_SECURITY_REGISTRY_ADDRESS`, `EVM_SECURITY_RECORD_NFT_ADDRESS` (`readString(…, "")`, short doc comment like the neighbours); `docker/trustee/entrypoint.sh` (`--arg` and the JSON object) and `.env.example` (Hoodi values from `pipeline-contracts/deployments/hoodi-v5.json` as comments, noting the #55 redeploy).
6. **Chain helpers** `packages/trustee/src/lib/targetChains.ts`:
   - `riskCouncilBlockedReason(chainId, fn)` (Decision 2; imports `councilTarget` from `lib/riskCouncilOps.ts`; check for an import cycle and move `councilTarget` into a small `lib/councilTarget.ts` if one appears);
   - `pendingRowBlockedReason(chainId, targetKind)`;
   - `sameChainAddress(chainId, a, b)` (exact on Stellar, lowercase compare on EVM).
   - New `lib/chainWallet.ts` `useChainWallet(chainId): { kind: "stellar" | "evm"; address: string | undefined; isConnected: boolean }`. It calls both `useStellarWallet` and `useEvmWallet` unconditionally and picks by `isStellarTarget(chainId)`.
7. **Session store** `lib/riskCouncilOps.ts`: `ScheduledOp` / `ScheduledOpChain` gain `calldata?: string`; `recordScheduledOp` keeps it. No other change.
8. **Hooks** `api/useRiskCouncil.ts`:
   - `evmCouncilConfig(fn)`: `{ accessManager, target: evmSecurityTarget(fn, …), registry, recordNft, chainId: ENV.EVM_CHAIN_ID }`, or `null` when an address is empty (gives `SECURITY_NOT_CONFIGURED`).
   - `useRiskCouncilAccess`: `useChainWallet(chainId)`; `enabled = riskCouncilBlockedReason(chainId, fn) === null && !!address`; query key adds `chainId`. The EVM arm runs `readEvmCanCall` with `evmSecuritySelector(fn)` and, when delayed with a call, `readEvmSecurityRegistrySchedule`.
   - `useRiskCouncilRelay`: gate by `riskCouncilBlockedReason(chainId, call.fn)`. The Stellar arm is unchanged. The EVM arm mirrors it line for line:
     - execute: pre-read the schedule (errors swallowed), then `relayEvmSecurityRegistry`;
     - schedule: read the schedule once after the transaction and return `{ hash, schedule, caller: address, target, calldata: encodeEvmSecurityRegistryCalldata(call) }`.
     - `onSuccess` is unchanged apart from passing `calldata` to `recordScheduledOp`.
   - `PendingOperationExecuteInput`: `argsXdr: string | null`, `calldata: string | null`. `usePendingOperationExecute` gates by `pendingRowBlockedReason(chainId, targetKind)` (add `targetKind` to the input). The target and paused guards are unchanged, except that the target uses `sameChainAddress`. The EVM arm follows Decision 4 (`ENV.EVM_ACCESS_MANAGER_ADDRESS`, `readEvmScheduledOperation`, compare `schedule.operationId === operationId.toLowerCase()`, `executeEvmScheduledOperation` with `errorAbi = evmSecurityErrorAbi`). The Stellar arm requires `argsXdr` non-null, and the EVM arm requires `calldata` non-null (else `PendingArgsMismatchError`).
   - `useSecurityInspectors(chainId)`: enabled when `riskCouncilBlockedReason(chainId, "set_inspectors") === null`. The EVM arm runs `readEvmSecurityInspectors` with `ENV.EVM_SECURITY_RECORD_NFT_ADDRESS`. The query key is unchanged.
   - `useRiskCouncilLoanState` stays Stellar-only (`stellarOnlyActionReason`).
9. **Error copy** `lib/accessManagerAction.ts`:
   - `EVM_COUNCIL_ERROR_COPY` (Decision 8) and `evmErrorName(details)`: the first match of `/\b(AccessManager[A-Za-z]+|SecurityRegistry[A-Za-z]+|SecurityRecordNft[A-Za-z]+|EnforcedPause)\b/`.
   - `evmCouncilErrorCopy(details)`.
   - `-risk-council-shared.ts` `mapRelayError(mode, error, fn, chainId)` tries `evmCouncilErrorCopy` first on EVM. `-risk-council-pending.ts` `executeErrorCopy` does the same.
10. **Shared presenter** `routes/-risk-council-shared.ts`: `useRiskCouncilActionView` uses `riskCouncilBlockedReason(chainId, fn)` for `blockedReason`. `useRiskCouncilLoanBase.blockedReason` keeps `stellarOnlyActionReason` (LoanRegistry pages).
11. **Pending presenter** `routes/-risk-council-pending.ts`:
    - `PendingOpItem.argsXdr: string | null`, new `calldata: string | null`.
    - `fromServed` sets `fn = canonicalPendingFunction(op.function)`, `calldata = op.calldata ?? null`, and decodes with `decodeEvmPendingCall` when `calldata` is set, else `decodePendingCall`.
    - `fromSession` needs `argsXdr` **or** `calldata`.
    - New `decodeEvmSecurityCall(fn, args)` for the canonical `set_terms` / `resolve_flag` / `release_with_consent`. The shapes come from `access-manager-events.md#evm-args-and-operation-id`, strict:
      - ids as `/^\d+$/` strings within u32;
      - tuple keys exactly the 15 camelCase names;
      - u32 numbers, u64 decimal strings;
      - `paymentTerm` 0–3 and outcome 0–2 integers;
      - hashes `/^[0-9a-f]{64}$/`;
      - `marginCallAt` and `defaultBreachAt` equal to `"0"`.
      Anything else is `null`, shown as raw JSON with Execute still allowed.
    - `decodeEvmPendingCall = decodeEvmSecurityCall` for now. LoanRegistry and Minter EVM rows stay `call: null` (raw JSON plus the owner link), and #1943 adds their decoders.
    - `termsForRows` maps `defaultRatioBps` and `originatorFeeRate`.
    - `usePendingOperationView`:
      - `useChainWallet(chainId)`;
      - `blocked = pendingRowBlockedReason(chainId, item.targetKind)`;
      - `isCaller` and `wrongTarget` via `sameChainAddress`;
      - `run` passes `argsXdr`, `calldata` and `targetKind`.
    - `callerText(item, address, chainId)` uses `sameChainAddress`.
12. **Terms form** `routes/-risk-council-terms.ts` and `-risk-council-security.ts`:
    - `formatTermsRows` adds "Default ratio" after "Margin call ratio" and "Originator fee rate" after "Default rate", only when the value is non-null (Stellar output unchanged).
    - `TermsFieldKey` gains `defaultRatio`, `originatorFeeRate`.
    - `termsFieldsFor(chainId)`: Stellar returns the current 10 fields. EVM adds `{ defaultRatio, "Default ratio (%)", "e.g. 90" }` after the margin call ratio and `{ originatorFeeRate, "Originator fee rate (%)", "e.g. 1" }` after the default rate.
    - `prefillTermsForm(terms)` fills both from served values.
    - `parseTermsForm` parses both (`percentToBpsStrict`, `percentToDefaultRate`).
    - `termsFieldEcho` handles both.
    - `buildSetTermsCall(loanId, values, chainId)` requires both on EVM and adds them to `terms`; Stellar never sets them.
    - New `DEFAULT_RATIO_ORDER_ERROR = "The default ratio must be at least the margin call ratio."`; the form view exposes `ratioOrderError` as the first failing rule.
    - `RiskCouncilSecurityView` gains `termsFields`, and the view `risk-council.security.$id.tsx` iterates `view.setTerms.fields` instead of the module constant.
    - `expectedTarget` is `ENV.EVM_SECURITY_REGISTRY_ADDRESS` on EVM.
13. **Shared UI** `routes/-RiskCouncilParts.tsx` `PendingOperationItem`: `useChainWallet(chainId)` instead of `useStellarWallet`, and `callerText(item, address, chainId)`. No markup change.
14. **Inspector panel** `routes/-risk-council-inspectors.ts`:
    - `validateInspectorDraft(draft, existing, chainId)`: on EVM it uses `isEvmInspectorAddress`, the copy `INVALID_EVM_ADDRESS = "Enter a valid EVM address (0x…)."`, and a case-insensitive duplicate check.
    - `add()` stores `normalizeEvmAddress(draft)` on EVM.
    - `buildInspectorsCall` is unchanged (it compares the normalised lists).
    - The page markup is unchanged.
15. **N2 / loans table** `routes/-useLoansTable.ts`: `mapLtvCell` drops the `isStellarTarget` early return; `showLtvColumn` drops the `isStellarTarget(e.chain_id) &&` term. `components/useNeedsAttention.ts` is unchanged (Decision 6).
16. **Lint and comments:** `npx tsx scripts/lint-comments.ts`; shrink `scripts/lint-comments.baseline.json` for any touched file listed there.
17. **Docs** (see Docs to Update), then `npx tsx scripts/lint-docs.ts`.
18. **Verify:** `… workspace @pipeline/wallet-connect test`, `… workspace @pipeline/wallet-connect lint`, `… workspace @pipeline/trustee test`, `… workspace @pipeline/trustee lint`, `… workspace @pipeline/trustee build` (`tsc -b`), and `… workspace @pipeline/frontend build` (the barrel changed). There is no live EVM run (see Assumptions).

## Test Strategy

Vitest, colocated as the packages do (wallet-connect `*.test.ts`, Trustee `-*.test.ts(x)`). No network, no env-gated tests.

- `packages/wallet-connect/src/evm/contracts/write.test.ts` (mock `@wagmi/core` and `./../config` `initEvmWalletConnect`):
  - order: simulate, estimate, write, receipt; the stages `awaiting-signature` then `confirming`;
  - gas `× 12 / 10` and clamped to the cap;
  - `chainId` passed to `writeContract`; `switchChain` called only on a chain mismatch;
  - a failed simulation never calls `writeContract`;
  - a reverted receipt throws;
  - the mock wallet throws without RPC;
  - a different connected account throws before simulation.
- `src/evm/contracts/accessManager.test.ts`:
  - `hashOperation` / `getSchedule` mapping (`0x` stripped and lowercased, `readyAt` number);
  - `canCall` tuple to `{ immediate, delay }`;
  - `relayEvm` sends `schedule(target, data, 0)` / `execute(target, data)` with the merged error ABI;
  - the verbatim executor passes the input calldata byte-identically;
  - bad calldata or an empty AccessManager throws.
- `src/evm/contracts/securityRegistry.test.ts` (real viem, no mock):
  - `encodeEvmSecurityRegistryCalldata` round-trips with `decodeFunctionData` for all four functions;
  - the `setTerms` tuple has all 15 fields in order, with `marginCallAt = defaultBreachAt = 0`, enum ordinals and `0x` hashes;
  - selectors equal `toFunctionSelector` of the Solidity signatures, with `setTerms` pinned to the 150631a tuple;
  - rejections: ratio order (both rules), missing EVM-only fields, out-of-range u32/u64, bad hash, bad or duplicate (case-insensitive) address;
  - `evmSecurityTarget` sends `set_inspectors` to the RecordNft.
  - `stellar/contracts/securityRegistry.test.ts`: the Stellar encoder rejects the EVM-only fields.
- `packages/trustee/src/lib/-targetChains.test.ts` (new or extend): `riskCouncilBlockedReason` (Stellar null; EVM null for the four security functions and the Stellar-only copy for `set_default`; another EVM chain id blocked); `pendingRowBlockedReason`; `sameChainAddress`.
- `api/-pendingOperations.test.ts`: `canonicalPendingFunction` for all ten EVM names, `cure`, `0x1234abcd`, and an unknown name.
- `api/-useLoanSecurity.test.tsx`: EVM now fetches; `notConfigured` only from the 404 code (replace the "does not fetch for an EVM chain" case).
- `api/-useRiskCouncil.test.tsx` (mock `useEvmWallet` and the new EVM functions). Replace the "disabled / rejects on EVM" cases with:
  - `useRiskCouncilAccess` EVM calls `readEvmCanCall` with the security selector and the RecordNft target for `set_inspectors`, and is still disabled on EVM for `set_default`;
  - relay EVM schedule records `operationId`, `readyAt` and `calldata`; EVM execute pre-reads and marks executed; not-configured copy when an EVM address is empty;
  - `usePendingOperationExecute` EVM:
    - a wallet that is not the caller rejects without RPC, and a case-only address difference is accepted;
    - an id mismatch never calls `executeEvmScheduledOperation`;
    - `readyAt 0` throws `NoLongerScheduledError`;
    - success passes the calldata unchanged and the AccessManager from env;
    - target-mismatch and paused guards;
    - a LoanRegistry row on EVM is rejected with the Stellar-only reason;
  - `useSecurityInspectors` EVM reads the RecordNft.
- `routes/-risk-council-pending.test.ts`:
  - `decodeEvmSecurityCall` accepts the reference examples (`["7", {…15 keys…}]`, `["3", 1, "ab…"]`, `["3", "cd…"]`) and rejects a missing key, a numeric id, an enum out of range, a non-zero `marginCallAt`, and `0x`-prefixed hashes;
  - `fromServed` with `calldata` canonicalises `setTerms` to `set_terms` and the owner to `security`, while `setDefault` keeps the escalate owner with `call: null`;
  - `pendingArgRows` adds the two EVM rows;
  - `mergePendingOps` with EVM session ops (`calldata`, no `argsXdr`);
  - `usePendingOperationView` on EVM:
    - enabled for a ready security row from the same wallet (case-insensitive);
    - the other-wallet copy;
    - the target compare is case-insensitive;
    - a LoanRegistry row is blocked;
    - `run` passes `calldata`.
  - Update the "blocks on an EVM chain" case to a LoanRegistry row.
- `routes/-risk-council-security.test.ts`:
  - `termsFieldsFor` per chain;
  - prefill of `default_ratio_bps` / `originator_fee_rate`;
  - `buildSetTermsCall` on EVM requires both fields, and Stellar never sets them;
  - both ratio-order errors;
  - echoes;
  - `formatTermsRows` is unchanged for Stellar terms and includes the two rows for EVM terms;
  - the EVM error-name copy mapping through `mapRelayError`.
- `routes/-risk-council-security-page.test.tsx` (mock `useEvmWallet`; fixture `pendingOp({ calldata, args_xdr: null, function: "setTerms", args: [...] })` in `-riskCouncilFixtures.ts`), EVM loan (`chain=560048`):
  - the form shows 12 inputs;
  - the Set terms button is enabled per access;
  - the Scheduled operations card lists the EVM row with decoded args and "· this wallet";
  - Execute calls the mutation with `calldata`;
  - `release` still asks for confirmation;
  - the EVM `setDefault` row shows the "Open Escalate to Default" link and no Execute.
  - The Stellar cases stay green.
- `routes/-risk-council-inspectors.test.ts` and `-risk-council-inspectors-page.test.tsx`: an EVM session validates `0x` addresses (`INVALID_EVM_ADDRESS`), normalises them to EIP-55, refuses a lowercase duplicate of a current entry, and builds `set_inspectors` with checksummed addresses; the Stellar cases are unchanged.
- `routes/-useLoansTable.test.ts`: the two EVM cases now expect the LTV cell and column (flip "is blank for an EVM row" and "ignores EVM rows").
- `components/-NeedsAttention.test.tsx` (or the hook test): an EVM loan with `margin_call_open: true` appears with its chain label (pins Decision 6).
- `routes/-loanSecurity.test.ts`: an EVM `/security` payload (6 dp strings) builds a ready card.
- Existing suites (hub, escalate, reterm, writedown, repayment recovery, bridge) stay green after the type change. Their EVM expectations (Stellar-only reason) are unchanged.

## Docs to Update

- `docs/frontend/trustee-flows.md`:
  - **Risk Council security actions:**
    - Sources and code: add the three EVM modules and `lib/chainWallet.ts`.
    - New `### EVM` subsection: the target table (`setTerms` / `resolveFlag` / `releaseWithConsent` on `EVM_SECURITY_REGISTRY_ADDRESS`, `setInspectors` on `EVM_SECURITY_RECORD_NFT_ADDRESS`, AccessManager `EVM_ACCESS_MANAGER_ADDRESS`), the encoding (15-field tuple, ordinals, `0x` hashes, `marginCallAt` / `defaultBreachAt` 0), the two EVM form fields with units and the second ratio rule, `0x` inspector input, error names, and the Differences table from this plan.
    - Replace "EVM: read-only with `stellarOnlyActionReason`".
  - **Risk Council pending operations:**
    - EVM rows: `calldata`, the function-name mapping, the ABI `args` decode, the Execute path of Decision 4.
    - The ownership table: the security row is "SecurityRegistry (`STELLAR_SECURITY_REGISTRY_ID` / `EVM_SECURITY_REGISTRY_ADDRESS`)".
    - The source sentence: "`[]` on EVM" no longer holds; say "`[]` without the AccessManager indexer key".
  - **Risk Council actions → `### EVM`:** the security page and the inspector panel are enabled on EVM (#1942); the other pages stay read-only until #1943.
  - **Security card / Security records card:** enabled on every chain. The **hidden** state is only `security_registry_not_configured`.
  - **Escalate / Amend economics:** delete "omitted for an EVM loan (#1906)".
  - Loans table LTV column: EVM rows included. Needs Attention: EVM margin-call rows by design (#1942, N2).
- `docs/frontend/wallet-flows.md`: new `### Trustee EVM contract client` under "EVM integration". It covers the plain-async client in `@pipeline/wallet-connect` (`write.ts`), its pipeline (switch chain, simulate, capped gas, write, receipt), the stages, the mock-wallet rule, and its reusers (#1573, #1574, #1755, #1943). The LP hooks keep their own pipeline.
- `docs/user-stories/epic-1937/1942-trustee-evm-security-page.md` (new, format of `1941-evm-pending-operations-api.md`, persona Risk Council member on the Trustee console, stories need #1944, the #55 redeploy and the stage env, and run in QA #1945):
  1. An EVM loan's security page shows the served terms, including default ratio and originator fee rate, and the LTV line.
  2. With an immediate role, Set terms executes at once and the new terms show after the fold.
  3. With a delayed role, Schedule terms creates a row ("Waiting · executable from …") and the set-terms notice.
  4. After the ready time, the scheduling wallet executes the row with nothing retyped.
  5. Another wallet sees the other-wallet copy.
  6. An expired row and a paused registry block Execute.
  7. A cancelled-but-served row shows "No longer scheduled" and sends nothing.
  8. Resolve flag and release with consent on EVM (release asks for confirmation).
  9. On an EVM session, the inspector panel lists and changes the RecordNft panel with `0x` addresses and refuses a bad address.
  10. A Trustee-only wallet sees every action read-only with the no-role copy.
  11. An EVM margin-call loan shows in Needs Attention, the loans table LTV column and the Security card consistently.
  12. The wallet on the wrong network is asked to switch before signing.
- `docs/user-stories/index.md`: add the #1942 row under "Epic #1937 — EVM parity".
- `docs/exec-plans/tech-debt-tracker.md`:
  - TD-186: add the EVM read location (`readEvmSecurityInspectors`, RecordNft).
  - TD-152: add a note that the reusable EVM client exists (#1942), if Open Question 1 resolves to the default.
  - New entry (next free number): "Trustee does not show the EVM `default_breach`". Location: the security page and the loan-detail Security card. Gap: `/security` serves `default_breach` for EVM (#1940), and nothing renders it. Suggested fix: a "Default breach" row and notes mirroring the margin-call row.
- `.env.example` and `docker/trustee/entrypoint.sh`: the three new variables. The argocd values live in the separate `argocd` repo and wait for the stage EVM config (#1503) and the #55 redeploy.
- No product-spec change. The API contract is #1940 / #1941's `loan-security-state.md` and `loan-security-state-evm.md`; this issue only consumes them.
