# Issue #1892: Trustee: EVM arm of debt-token registration (PipelineDealTokenFactory.registerDeal after drawLoan)

Source: https://github.com/eq-lab/pipeline/issues/1892

Branch `feat/1892-trustee-evm-register-deal`, draft PR #2064. Parent epic #1795. The EVM arm was split out of #1766 (decision 2026-11-11: #1766 ships Stellar-only).

## Scope

Binding human directive for all EVM work: "everything the same as on Stellar, the same approach". This issue opens the gate that #1574 kept (K1): **Register debt token** and the loan-detail **Debt token** row on an EVM loan. The EVM arm mirrors the Stellar arm from #1766 exactly: the same hooks (`useDeal` family, `useRegisterDealAccess`, `useRegisterDeal`), the same component (`-RegisterDebtTokenAction.tsx`) on the same two mount points (inline under the "Approved & drawn" banner on the origination detail, card on every loan-detail layout), the same test ids, copy, `accessAction` gating (execute now / schedule / execute scheduled / no role) and invalidation. Every deviation is listed in [Differences from Stellar](#differences-from-stellar).

Issue facts (2026-11-19 unblock comment), re-verified on Hoodi below:
- Registration is not automatic. `DealTokenFactoryUpgradeable.registerDeal(uint256 loanId) external restricted returns (Deal)` (`pipeline-contracts@150631a`), and `PipelineLoanRegistry.drawLoan` never calls it. `script/roles/SetupLoanRegistryManager.sol` puts it on `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, the role that also holds `drawLoan`, `rollover`, `updateMutable` and `closeLoan`.
- The trustee therefore sends `AccessManager.execute(factory, registerDeal(loanId))`, the same routing as every non-repay EVM write (#1942, #1573, #1574).

In scope:
1. `@pipeline/wallet-connect`: the `registerDeal` calldata encoder, selector and relay (execute and schedule) in `evm/contracts/dealTokenFactory.ts`, going through `sendEvmContractCallChecked`.
2. Trustee hooks (`api/useDealToken.ts`): EVM arms of `useRegisterDealAccess` and `useRegisterDeal`, picked by the loan's `chain_id`. A chain-picking `useLoanDeal` keeps `useDeal` (`["deal-token", …]`) and `useEvmDeal` (`["evm-deal-token", …]`) as two separate caches.
3. Trustee lib (`lib/dealToken.ts`): the chain gate moves from `stellarOnlyActionReason` to `loanActionChainReason`; EVM custom-error names map to the existing copy.
4. `-RegisterDebtTokenAction.tsx` and `-useLoanDetail.ts`: chain-aware wallet, deal read and config.
5. After a successful EVM registration both deal caches are invalidated, so the EVM Disburse card's "Register this loan's debt token first." clears without a reload.
6. Docs: trustee-flows (Register debt token, EVM (#1574) table, Disburse EVM testnet caveat), TD-152, product specs (incl. audit-logging), backend.md § EVM DealTokenFactory, FRONTEND.md / `.env.example` consumer notes, a new user-stories doc, and the #1766 / #1485 user-story updates.
7. **Backend (decided by the user 2026-11-19, the answer to the former Open Question 1):** fix the EVM worker so it indexes the DEBT-only `DealRegistered(uint256,address)` that the Hoodi factory and `150631a` emit. Today it decodes only the legacy `(uint256,address,address)` and drops everything else. The fix follows the #1788 structure for Stellar: per-log shape detection, `"cargo": null` for the DEBT-only shape, and the DEBT token tracked alone. See [Implementation step 6](#6-worker-accept-both-dealregistered-shapes-bug-39). The fix is logged as BUG-39 under "Resolved" in `known-bugs.md`.

Out of scope:
- Any contract change (contracts are frozen).
- Chaining registration into Approve. It stays a separate, explicit signature, as on Stellar.
- Calling `syncDebt`. Stellar does not call it from this action either.
- Cancelling a scheduled registration (`AccessManager.cancel`). Stellar has no cancel either (TD-159).
- Any database migration or change to the shared `contract_logs_repo` query. #1788 already made `DealRegistrationRow.cargo` an `Option` and dropped the `cargo IS NOT NULL` seed predicate, and `DealTokenRegistry::seed` already seeds DEBT alone for a `None` cargo.
- Rewording the audit-log action "Deal tokens registered" for a single-token deal (#1788 kept it on Stellar too).
- Removing the legacy `CargoSynced` parser. It stays for pre-#51 factories, as `parse_cargo_synced` does on Stellar.
- A served debt address in the loan-book API. Neither chain serves one, and the row is an on-chain read on both.

### Stellar arm being mirrored (#1766, current code)

| Piece | File | Behaviour |
|---|---|---|
| Deal read | `api/useDealToken.ts` `useDeal(chainId, loanId)` | key `["deal-token", chainId, loanId]`, `staleTime` 15 s, `retry: false`, enabled only for Stellar + configured factory + valid id; `readDeal` returns `null` on `Error(Contract, #4)` |
| Access read | `useRegisterDealAccess(loanId, enabled)` | key `["register-deal-access", address, loanId]`; `readCanCall(AM, caller, factory, "register_deal")`, then `readOperationSchedule` when `!immediate && delay > 0` |
| Mutation | `useRegisterDeal()` | guards in order: chain (`stellarOnlyActionReason`), config (`DEBT_TOKEN_NOT_CONFIGURED`), wallet ("Stellar wallet not connected."); then `registerDeal({ mode, … })` (`relay` → `AM.execute`/`AM.schedule`); on success invalidates `deal-token`, `register-deal-access`, `audit-log` now and at 5 s |
| View | `lib/dealToken.ts` `debtTokenView` | chain reason → blocked; unconfigured → blocked; pending/error → hidden; `null` → unregistered; otherwise registered |
| Errors | `registerDealError(mode, err)` | rejection or a non-simulation specific error passes through; AM codes `#6`–`#9` per mode (`riskCouncilErrorCopy`); factory codes `#1`/`#2`/`#3`/`#5` in execute mode only; otherwise the generic simulation copy |
| Component | `routes/-RegisterDebtTokenAction.tsx` | `variant="card"` (loan detail, all three layouts) / `"inline"` (origination banner); idle labels "Register debt token" / "Schedule registration" / "Execute registration"; `riskCouncilRoleLine` note; inline registered state "Debt token registered · <address>" |
| Row | `routes/-useLoanDetail.ts` `buildRegistryState(…, deal)` | "Debt token", tag `chain`, `Deal.debt` verbatim or "—" |

There is **no DEBT trustline step in the Stellar registration flow**. `register_deal` is a single relay. The DEBT trustline of the loan-NFT holder (SAC `authorized(holder)`, added out of band by ops with `just new-deal <id>`) is only a Disburse pre-flight (step 5). On Stellar the issuer's `set_admin(factory)` must precede registration (error `#5`). On EVM neither exists: `registerDeal` itself deploys the per-loan `DealToken` with CREATE2 (`new DealToken{salt: bytes32(loanId)}`), an ERC-20 that only the factory can mint or burn. Its holder needs no trustline and there is no issuer. Disburse already skips the trustline on EVM (#1574, `trustline: null`).

### Hoodi verification (2026-11-19, read-only `eth_call` / `cast`, nothing submitted)

RPC `https://ethereum-hoodi-rpc.publicnode.com`, addresses from `pipeline-contracts/deployments/hoodi-v5.json`.

| Check | Result |
|---|---|
| Factory proxy / implementation | `0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC` → impl `0x11995b4e065Da8fcDA7Bc087278db97F4841b508` (EIP-1967); `authority()` = AccessManager `0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992`; `loanRegistry()` = `0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231`; `isTargetClosed(factory)` = false |
| Selector | `registerDeal(uint256)` = `0x19da0d36` is in the implementation bytecode, and so is `deal(uint256)` = `0xc959c42b` |
| Role | `getTargetFunctionRole(factory, 0x19da0d36)` = `6011017323988244727` (`0x536b6c688f09d8f7` = `bytes8(keccak256("LOAN_REGISTRY_MANAGER_ADMIN_ROLE"))`), the same id as `drawLoan` on the registry |
| Holders | `hasRole` / `canCall(w, factory, 0x19da0d36)` = `(true, 0)` for both `0x96ef761fee97d6e09821517554f2316b8cbc04e4` and `0xd3b978148e1ee61b528354f72b39451c46dca57c` (delay 0, so the schedule path is not reachable on Hoodi) |
| Unregistered read | `deal(0)` reverts `0x5c1940b0…00` = `DealTokenFactoryNotRegistered(0)` (what `readEvmDeal` maps to `null`) |
| Execute, role holder | `eth_call AccessManager.execute(factory, 0x19da0d36…00)` from `0x96ef…c04e4` passes the AccessManager and reaches the factory, which reverts `0xab6bb082` = `LoanRegistryNonExistentLoanId()` (no args): `registerDeal` first calls `loanRegistry.outstanding(loanId)`, and the registry holds no loans (`outstanding(0)` reverts the same) |
| Execute, no role | the same call from `0x…dEaD` reverts `AccessManagerUnauthorizedCall(0x…dEaD, factory, 0x19da0d36)` (`0x81c6f24b`) |
| Event | the implementation contains topic0 `0xc272178e…49156c42` = `DealRegistered(uint256 indexed loanId, address debt)` and **not** `0x32ae7784…2e5e530` = the legacy `DealRegistered(uint256,address,address)`; it also lacks `cargoAddress(uint256)` (`0x6748ba70`), `syncCargo(uint256)` (`0xcd7ca877`) and `collateralRegistry()` (`0xd330fadd`) |
| Deploy block | **3 955 455**: tx `0x62a97a8f158a57709dd0fc6fc2db1ca367caec0c1482dc419bc6bbfa03839034` is the proxy's contract creation (`receipt.contractAddress` = the factory, `to` = null, status 1). Its four logs are `Upgraded(0x11995b…b508)`, `AuthorityUpdated`, `LoanRegistrySet` and `Initialized` |
| History | `eth_getLogs` over the factory from block 3 800 000 (before the deploy) to head 4 046 167, in ≤ 50 000-block calls: only those four logs. There is no later `Upgraded`, so the implementation has not changed since deploy, and **no `DealRegistered` of either shape exists** |

**Correction to the brief.** The Hoodi factory is **not** the `(debt, cargo)` build. Its bytecode has the DEBT-only interface, and `f92d719` and `150631a` have identical `src/dealTokenFactory/` (the cargo variant was removed in `a2e692f`, #51, before both). The `(debt, cargo)` shape belongs to the legacy *Stellar* factories (#1766 user story, "returns `Deal` as `{ cargo, debt }`") and to pre-#51 EVM factories. `readEvmDeal` decodes only the first word (`debt`), so it would read either shape correctly anyway.

### Backend: what is served and indexed

- **Served debt address.** None. `GET /v1/loan-book` and the per-loan endpoints carry no debt-token field on either chain (`packages/api/src/routes/loan_book.rs`). The Stellar "Debt token" row is an on-chain `deal()` read, so the EVM row is `readEvmDeal`, the same approach.
- **Indexer config.** `CHAIN_<id>_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` (`worker/src/indexer/config.rs`, `mod.rs`) enables the EVM factory handler, and the unblock comment says it is set for 560048.
- **Indexer bug (BUG-39, fixed here).** The EVM decoder (`worker/src/indexer/deal_token_parsers.rs`) declares only the legacy `event DealRegistered(uint256 indexed loanId, address debt, address cargo)`. `decode_log(…, true)` checks topic0 (`0x32ae7784…`), so the DEBT-only event the Hoodi factory and the frozen source emit (topic0 `0xc272178e…`) is silently dropped. As a result:
  - `parse_deal_registered` returns `None`, so no `DealRegistered` row reaches `contract_logs` and the audit log (`api/src/routes/audit_log.rs` lists `DealRegistered`) never shows an EVM registration;
  - `DealTokenRegistry::observe` never learns the DEBT token, so its `Transfer` (mint / burn from `syncDebt`) is never indexed as `DealTokenTransfer`;
  - `DebtSynced` (unchanged signature) is still indexed.

  The bug predates #1892; it would also hit a registration made out of band. The user decided (2026-11-19) to fix it in this PR so the EVM arm matches Stellar end to end.
- **How #1788 fixed the same thing on Stellar (the structure to mirror).**
  - **Parser:** accepts both shapes per event, with no per-address mode. The legacy shape gives `{loan_id, debt, cargo}`, the HEAD shape gives `{loan_id, debt, "cargo": null}` (D1: the key is kept and set to null), and a malformed `cargo` rejects the event (D2).
  - **Token set:** `insert_deal(loan_id, debt, cargo: Option<…>)` tracks DEBT alone when there is no cargo (D5).
  - **Seeding:** `seed` takes the optional cargo.
  - **Already shared with EVM since #1788:** `DealRegistrationRow.cargo: Option<String>`, the seed query without the `cargo IS NOT NULL` predicate, and the EVM `DealTokenRegistry::seed` / private `insert_tokens` that seed DEBT alone for `None` (#1788 D4).
  - **Audit log:** `pass(params, &["debt", "cargo"])` already renders `cargo: null`.

  Only the EVM *decode* and *observe* paths are left. On EVM, alloy's topic0 check tells the two shapes apart, so the per-log choice is "try the DEBT-only event, then the legacy event". Their topic0s differ, so at most one can match. D2 has no EVM analogue: an ABI-decoded `address` is always well-formed.

### Backfill decision (stage, chain 560048)

**No cursor rewind is needed.** The factory was created at block 3 955 455, and `eth_getLogs` over the factory from 3 800 000 to head (4 046 167) holds only the four deploy/init logs. No `DealRegistered` of either shape has ever been emitted, so the current worker has dropped nothing. The worker's `CHAIN_560048_EVM_START_BLOCK` is 3 808 700, before the deploy, so the factory has been in range since it was created.

**Ordering rule for the rollout.**
- Deploy the new worker image before the first EVM `registerDeal` on Hoodi, whether from the app or out of band.
- If a registration lands while the old image runs, rewind the shared cursor to the registration block: `UPDATE log_collector_state SET last_indexed_block = <block − 1> WHERE chain_id = 560048`, with the worker stopped. Replays skip stored rows on the unique key, and the `DealRegistered` row then seeds the DEBT token on the next start.
- The coder re-runs the scan (`cast logs --address 0xCf54…eCDC --from-block 3955455 --to-block latest` in ≤ 50 000-block chunks, topic0 `0xc272178e…` or `0x32ae7784…`) just before merge and records the result in the PR.

## Assumptions and Risks

- **No live end-to-end test on Hoodi before merge.** The registry holds no loans, so only the eth_call checks above were possible. The first real registration needs an EVM loan drawn from Origination (#1573). Mitigation: unit tests pin the calldata to the bytes verified on Hoodi (`0x19da0d36` + uint256), and the user story covers the live run.
- **The schedule path is untestable on Hoodi** (role delay 0). It is implemented to mirror Stellar and is covered by unit tests only. `AccessManager.schedule(target, data, 0)` and `getSchedule(hashOperation(caller, target, data))` are the same bindings the Risk Council EVM arm (#1942/#1943) already uses.
- **Shared-key regression.** `useDeal` and `useEvmDeal` must keep separate keys (`deal-token` / `evm-deal-token`): a shared key let a disabled observer overwrite the query function (#1574 review). The new `useLoanDeal` only calls both hooks and picks a result; it never merges keys. A test asserts that an EVM registration refetches `readEvmDeal` and never calls `readDeal`.
- **Indexer lag.** Like Stellar, the UI re-reads `deal()` on chain after success, so the row and banner update immediately. The audit-log "Deal tokens registered" row appears once the worker indexes the block (with the BUG-39 fix in this PR).
- **Mixed PR (frontend + worker).** The issue is labelled `frontend`, but the PR now also changes the Rust worker. The manager may want to add the `backend` label and route the PR through human review (Flow A rules), since only the label owner can decide that. The worker change is small, has no migration and no new env keys, and its tests are pure.
- **Worker rollout safety (mirrors #1788's checklist).**
  - Migrations: none.
  - New env keys: none.
  - RPC reads added: none (decoding is pure).
  - Rollback: the old image keeps booting. It ignores DEBT-only events, exactly as today. A DEBT-only row written by the new image is already accepted by the old seed (#1788 shared code), so the old image still tracks the DEBT token after a rollback.
  - API: no change. `details.cargo` on EVM `DealRegistered` can now be `null`, which Stellar rows already are.
  - Legacy EVM rows: the behaviour is unchanged (both tokens seeded and observed; pinned by the existing tests).
  - Post-deploy check: the startup line `deal-token registry seeded` (`deals`) for 560048 must stay `0` until the first registration, then rise.
- **Gap between merge and worker deploy.** A registration in that window is dropped by the old worker. The ordering rule in [Backfill decision](#backfill-decision-stage-chain-560048) covers it.
- **RPC read-after-write.** The publicnode RPC is load-balanced, so an immediate `deal()` re-read can hit a node that is one block behind. The 5 s re-invalidation (same as Stellar) covers it.
- **Copy says "Trustee role"** while the EVM role is `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`. This follows the #1574 precedent (Disburse row 24: copy unchanged). Both Hoodi trustee wallets hold the role.
- **Dependency:** none open. #1942, #1573 and #1574 are merged, and `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` is set on stage (eq-lab/argocd#517, per the unblock comment).

## Open Questions

_None_

### Resolved questions

- **Q1 (2026-11-19, the user, via the manager):** should the EVM worker fix for the DEBT-only `DealRegistered` (BUG-39) be in this PR? **Yes.** It is in scope (Implementation step 6), not a separate issue.

## Implementation Steps

### 1. wallet-connect: `registerDeal` binding (`packages/wallet-connect/src/evm/contracts/dealTokenFactory.ts`)

1. Extend `evmDealTokenFactoryAbi` with:
   - `function registerDeal(uint256 loanId) returns ((address debt) dealData)` (`stateMutability: "nonpayable"`);
   - `event DealRegistered(uint256 indexed loanId, address debt)`.
   Keep the existing `deal` entry and the four `DealTokenFactory*` errors.
2. `export function evmRegisterDealSelector(): Hex` → `toFunctionSelector(<the registerDeal entry>)` (must equal `0x19da0d36`).
3. `export function encodeEvmRegisterDealCalldata(loanId: number): Hex`. It validates a safe non-negative integer (`encodeEvmRegisterDealCalldata: invalid loanId <v>`, before any RPC call, like the #1574 encoders), then `encodeFunctionData({ abi, functionName: "registerDeal", args: [BigInt(loanId)] })`.
4. `export const evmRegisterDealErrorAbi: Abi = [...evmDealTokenFactory errors, ...evmLoanRegistryErrorAbi]`. Import `evmLoanRegistryErrorAbi` from `./riskCouncil` (it contains `LoanRegistryNonExistentLoanId()`, which `registerDeal` bubbles from `outstanding`). `riskCouncil.ts` does not import `dealTokenFactory.ts`, so there is no cycle.
5. `export function relayEvmRegisterDeal(params: { mode: RelayMode; accessManager: string; factory: string; caller: string; loanId: number; chainId: number; onStageChange?: (s: RelayStage) => void }): Promise<{ hash: Hex }>`:
   - validate `accessManager`, `factory` and `caller` with `isAddress` (`registerEvmDeal: invalid <name> <v>`) and encode the calldata, all before any RPC call;
   - `sendEvmContractCallChecked("registerEvmDeal", { abi: [...accessManagerAbi, ...evmRegisterDealErrorAbi], address: accessManager, functionName: mode, args: mode === "schedule" ? [factory, calldata, 0] : [factory, calldata], ...(mode === "execute" ? { value: 0n } : {}), account: caller, chainId, onStageChange })`;
   - return `{ hash }`.
   This is `relayEvm`'s argument shape with the #1574 simulate-before-sign wrap. `relayEvm` itself uses the unchecked sender, so do not reuse it. `registerDealError` relies on the `simulation error` marker, as it does on Stellar.
6. Export the new symbols from `packages/wallet-connect/src/index.ts` next to `readEvmDeal` (`evmRegisterDealSelector`, `encodeEvmRegisterDealCalldata`, `evmRegisterDealErrorAbi`, `relayEvmRegisterDeal`, and its params type).
7. Update the spec-pointer header of `dealTokenFactory.ts` to `docs/frontend/trustee-flows.md#register-debt-token-1766` if a single header must cover both read and write (keep one header).

### 2. Trustee hooks (`packages/trustee/src/api/useDealToken.ts`)

1. `dealTokenConfigured(chainId?: number | null)`:
   - EVM (`!isStellarTarget(chainId)`): `!!ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS && !!ENV.EVM_ACCESS_MANAGER_ADDRESS`;
   - otherwise the existing Stellar pair.
   This mirrors `disburseConfigured(chainId)`.
2. Keep `useDeal` (Stellar, `["deal-token", …]`) and `useEvmDeal` (`["evm-deal-token", …]`) unchanged. Add `useLoanDeal(chainId, loanId)`, which calls both hooks unconditionally (hook order is stable) and returns `isStellarTarget(chainId) ? stellar : evm`. The keys are never merged.
3. `useRegisterDealAccess(chainId, loanId, enabled)` gains `chainId` as its first argument:
   - wallet from `useChainWallet(chainId)`;
   - key `["register-deal-access", chainId ?? null, address, loanId ?? null]`;
   - `enabled: enabled && !!address && loanActionChainReason(chainId) === null && dealTokenConfigured(chainId) && validLoanId(loanId)`.
   EVM `queryFn`:
   - `readEvmCanCall({ accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS, caller: address, target: ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS, selector: evmRegisterDealSelector() })`;
   - when `!immediate && delay > 0`, also `readEvmOperationSchedule({ …same, data: encodeEvmRegisterDealCalldata(loanId) })`;
   - return `{ canCall, schedule }`.
   The Stellar `queryFn` is unchanged.
4. `useRegisterDeal()`:
   - take `useStellarWallet()` and `useEvmWallet()`, and pick the arm with `pickChainWallet(chainId, stellar, evm)`;
   - guards, in order: `loanActionChainReason(chainId)` (thrown as the error), `dealTokenConfigured(chainId)` (`DEBT_TOKEN_NOT_CONFIGURED`), wallet ("EVM wallet not connected." / "Stellar wallet not connected.");
   - EVM call: `relayEvmRegisterDeal({ mode, accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS, factory: ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS, caller: wallet.address, loanId, chainId: ENV.EVM_CHAIN_ID, onStageChange: setStage })`;
   - the Stellar call is unchanged;
   - the return shape stays `{ hash }`.
5. `invalidateDealToken` keys: `["deal-token", "evm-deal-token", "register-deal-access", "audit-log"]`, both arms, now and again at 5 s (unchanged cadence). The `evm-deal-token` prefix also refreshes the Disburse card's `useEvmDeal`, which clears "Register this loan's debt token first.".
6. Spec header stays `#register-debt-token-1766`.

### 3. Trustee lib (`packages/trustee/src/lib/dealToken.ts`)

1. `debtTokenView`: replace `stellarOnlyActionReason(chainId)` with `loanActionChainReason(chainId)`. Stellar and `ENV.EVM_CHAIN_ID` open; any other chain keeps the Stellar-only copy.
2. Add `REGISTER_DEAL_EVM_ERROR_COPY: Record<string, string>`:
   - `DealTokenFactoryAlreadyRegistered` → `REGISTER_DEAL_ERROR_COPY["3"]`;
   - `LoanRegistryNonExistentLoanId` → `REGISTER_DEAL_ERROR_COPY["1"]`.
   There are no EVM counterparts of `#2` (uint256 id) or `#5` (no issuer).
3. `registerDealError(mode, err)` keeps the existing structure. After the Stellar lookup, when no copy was found, it also tries:
   - the EVM AccessManager name: `evmErrorName(details)` → `EVM_AM_ERROR_COPY[name]` (`NotScheduled` / `NotReady` / `Expired` / `AlreadyScheduled` map to the same `#6`/`#7`/`#8`/`#9` copy);
   - in `execute` mode only, the first `REGISTER_DEAL_EVM_ERROR_COPY` name found in `details`.
   Do not widen the shared `EVM_ERROR_NAME` regex in `accessManagerAction.ts` (it would change `evmCouncilErrorCopy`). Match the factory names locally with `details.includes(name)`. `LoanRegistryNonExistentLoanId` is already matched by `evmErrorName`, but the `REGISTER_DEAL_EVM_ERROR_COPY` lookup handles it.
4. `DEBT_TOKEN_NO_ROLE`, `DEBT_TOKEN_CONNECT_WALLET`, `DEBT_TOKEN_NOT_CONFIGURED` and `registerDealAccessReason`: unchanged copy on both chains.

### 4. Component (`packages/trustee/src/routes/-RegisterDebtTokenAction.tsx`)

1. Replace `useStellarWallet()` with `useChainWallet(chainId)` (`@/lib/chainWallet`).
2. `const deal = useLoanDeal(chainId, loanId)`, `dealTokenConfigured(chainId)`, `useRegisterDealAccess(chainId, loanId, view.kind === "unregistered")`.
3. Nothing else changes: markup, test ids (`register-debt-token`, `-button`, `-note`, `-error`, `-registered`), labels, `accessAction` / `riskCouncilRoleLine` / `stageLabel` usage and `mutateAsync({ mode, loanId, chainId })`.
4. The registered inline line prints `Deal.debt` verbatim. On EVM that is the EIP-55 address `readEvmDeal` returns.
5. The mount points `origination.$id.tsx` (`ApprovedBanner`, `chainId = detail.targetChainId`) and `loans.$id.tsx` (three layouts, `chainId = chain` search param) need no change.

### 5. Loan detail row (`packages/trustee/src/routes/-useLoanDetail.ts`)

1. Replace `useDeal(chainId, …)` with `useLoanDeal(chainId, …)` in `useLoanDetail`. `buildRegistryState` is unchanged: the "Debt token" row shows `debtTokenRegistered(deal).debt ?? "—"`, which is now the EVM address on the configured EVM chain. On another chain both reads are disabled, so the row shows "—".

### 6. Worker: accept both `DealRegistered` shapes (BUG-39)

Follow #1788 (`docs/exec-plans/completed/issue-1788-stellar-debt-only-deal-registered.md`); EVM differs only where decoding differs.

1. `packages/worker/src/indexer/deal_token_parsers.rs`
   - Keep the legacy module and rename it for clarity: `mod deal_token_factory_legacy { sol! { event DealRegistered(uint256 indexed loanId, address debt, address cargo); event CargoSynced(…); } }`.
   - Add `mod deal_token_factory { sol! { event DealRegistered(uint256 indexed loanId, address debt); event DebtSynced(…); } }` (the `150631a` / Hoodi interface). The two `DealRegistered` must live in separate modules because `sol!` names collide.
   - `pub fn decode_deal_registered(log: &Log) -> Option<(U256, Address, Option<Address>)>`:
     - try `deal_token_factory::DealRegistered::decode_log(log.as_ref(), true)` → `(loanId, debt, None)`;
     - otherwise try the legacy event → `(loanId, debt, Some(cargo))`;
     - otherwise `None`.
     Both calls validate topic0, so the choice is per log, with no per-address mode (#1788 F2: an in-place upgrade or a redeploy needs no switch).
   - `parse_deal_registered` emits `json!({ "loan_id": …, "debt": debt.to_checksum(None), "cargo": cargo.map(|c| c.to_checksum(None)) })`, so the key set is always `loan_id, debt, cargo`, and `cargo` is JSON `null` for the DEBT-only shape (#1788 D1).
   - `parse_debt_synced`, `parse_cargo_synced`, `Transfer` and `parse_deal_token_transfer` are unchanged.
   - The spec header stays `docs/references/backend.md#evm-dealtokenfactory-1485`.
2. `packages/worker/src/indexer/deal_tokens.rs`
   - `pub fn insert_deal(&self, loan_id: &str, debt: Address, cargo: Option<Address>) -> Vec<Address>` delegates to the existing private `insert_tokens` with DEBT plus the optional CARGO. This mirrors Stellar's `insert_deal(…, cargo: Option<&str>)` (#1788 D5); the only callers are `observe` and the tests.
   - `observe`: `Some((loan_id, debt, cargo)) => self.insert_deal(&loan_id.to_string(), debt, cargo)`.
   - `seed` is unchanged; it already handles `row.cargo == None` (#1788 D4).
   - The excluded-PLUSD guard and the idempotency are unchanged.
3. Leave `packages/worker/src/indexer/evm_parsers.rs` (`register_deal_token_handlers`) as it is: it already routes every factory log through `parse_deal_registered` → `parse_debt_synced` → `parse_cargo_synced`, and the token handler's `lookup` picks up a DEBT-only token once `observe` adds it, in the same chunk (two-phase fetch). Verify that no other caller of `decode_deal_registered` / `insert_deal` exists (today: `deal_tokens.rs`, `worker/tests/deal_token_parsers.rs`, `deal_token_registry.rs`, `evm_dynamic_poll.rs`).
4. `packages/shared` and `packages/api`: no code change. `list_deal_registrations` already returns `cargo` as `NULL`, and `audit_log.rs` `pass()` already gives `cargo: null`. Update the `AuditLogItem.details` doc line in `audit_log.rs:199` from "(Stellar, from contracts #38)" to "(Stellar from contracts #38; EVM from contracts #51)". This is a doc string only; check that the generated OpenAPI snapshot, if any, still passes.
5. Run `cargo clippy --all -- -D warnings` and `cargo test -p pipeline-worker --test deal_token_parsers --test deal_token_registry --test evm_dynamic_poll` (+ `-p pipeline-api --test dashboard_auditlog_chain` if it is touched). Note known-bugs BUG-22 (an unknown-lint failure on older toolchains): if clippy fails only on that, record it in the PR and do not fix it here.

### 7. Lint and comments

- Run `npx tsx scripts/lint-comments.ts` and `npx tsx scripts/lint-docs.ts`; shrink `scripts/lint-comments.baseline.json` for any touched file it lists. No new comments beyond the single spec-pointer header per file (Rust included).

## Test Strategy

TypeScript: vitest. Rust: pure unit tests only, in `packages/worker/tests/<topic>.rs` (never inline `#[cfg(test)]` in `src/`). No test reads `DATABASE_URL`, `POSTGRES_URL` or any env var, and none reaches Postgres. Commands, from the worktree:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/wallet-connect test src/evm/contracts/dealTokenFactory.test.ts
node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/trustee test src/api/-useDealToken.test.tsx src/lib/-dealToken.test.ts src/routes/-RegisterDebtTokenAction.test.tsx src/routes/-useLoanDetail-hook.test.ts src/routes/-useLoanDetail-fetch.test.tsx src/routes/-DisburseAction.test.tsx src/api/-useDisburse.test.tsx
node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/wallet-connect test
node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/trustee test
node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/trustee build      # tsc -b + vite build
node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/trustee lint
node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/wallet-connect lint
npx tsx scripts/lint-docs.ts && npx tsx scripts/lint-comments.ts
cargo test -p pipeline-worker --test deal_token_parsers --test deal_token_registry --test evm_dynamic_poll
cargo clippy --all -- -D warnings
```

Worker (Rust, pure):
- `packages/worker/tests/deal_token_support/mod.rs`:
  - add a nested `mod head { sol! { event DealRegistered(uint256 indexed loanId, address debt); } }`, plus a helper `deal_registered_debt_only(loan, debt, block, idx) -> Log` emitted by `FACTORY`;
  - keep `deal_registered(…, cargo, …)` for the legacy shape.
- `packages/worker/tests/deal_token_parsers.rs`:
  - `deal_registered_debt_only_params`: keys are `cargo, debt, loan_id`, `cargo` is `Value::Null`, `debt` is checksummed, `loan_id` is a decimal string (a value above `u64::MAX` too), and `decode_deal_registered` gives `Some((loan, DEBT, None))`.
  - `deal_registered_debt_only_topic_is_hoodi_topic`: the helper's topic0 is `0xc272178e5556e8231a7c82e997e13098dca27aa84ecc3c032872356d49156c42` and the legacy helper's is `0x32ae778469dceb9ab8e5aae14ba7b896fd508033a5cb741979a381ca5d21e530`. This pins both against the Hoodi bytecode.
  - The existing `deal_registered_params` (legacy) now asserts `Some((loan, DEBT, Some(CARGO)))`.
  - `parsers_reject_foreign_events` adds: a DEBT-only log is not parsed by `parse_debt_synced` / `parse_cargo_synced`, and a log with the DEBT-only topic0 but truncated data gives `None` from both `decode_deal_registered` and `parse_deal_registered` (no panic).
- `packages/worker/tests/deal_token_registry.rs`:
  - `observe_debt_only_registers_debt`: returns `[DEBT]` with kind `Debt` and loan id, does not insert `CARGO`, is idempotent on a second observe, and `addresses().len() == 1`;
  - `observe_ignores_non_factory_emitter` also covers the DEBT-only shape;
  - `observe_excludes_plusd_debt_only`: with `.excluding(Some(DEBT))`, the DEBT-only observe adds nothing;
  - the legacy observe test is unchanged.
- `packages/worker/tests/evm_dynamic_poll.rs`:
  - change the three `insert_deal(…, CARGO)` calls to `Some(CARGO)`;
  - add `same_chunk_discovery_debt_only`: a DEBT-only `DealRegistered` and a DEBT `Transfer` in the same chunk lead to a second fetch for `[DEBT]` only, and the transfer is decoded (the `FakeFetcher` pattern of `same_chunk_discovery_triggers_second_fetch`).
- `packages/api/tests/dashboard_auditlog_chain.rs` (optional; extend the pure `act` / `format_action` test `deal_token_factory_events_render_on_both_arms`, which does not use the pool): `ChainKind::Evm` with `{"loan_id":"7","debt":"0xD","cargo":null}` gives "Deal tokens registered" and details `{"debt":"0xD","cargo":null}`.

`packages/wallet-connect/src/evm/contracts/dealTokenFactory.test.ts` (extend; it mocks `./write`, so add `sendEvmContractCallChecked` to the mock):
- `evmRegisterDealSelector()` is `0x19da0d36`.
- `encodeEvmRegisterDealCalldata(0)` is exactly `0x19da0d36` + 64 zeros (the bytes verified on Hoodi); `7` encodes `…0007`. `-1`, `1.5`, `NaN` and `Number.MAX_SAFE_INTEGER + 1` throw `encodeEvmRegisterDealCalldata: invalid loanId` with no send.
- `relayEvmRegisterDeal` execute: one `sendEvmContractCallChecked` call with label `registerEvmDeal`, `address` = AM, `functionName: "execute"`, `args: [factory, calldata]`, `value: 0n`, `account`, `chainId`, `onStageChange` forwarded; returns `{ hash }`.
- schedule: `functionName: "schedule"`, `args: [factory, calldata, 0]`, no `value`.
- An invalid AM, factory or caller throws before any send.
- The ABI passed includes `DealTokenFactoryAlreadyRegistered`, `LoanRegistryNonExistentLoanId` and the AccessManager errors (so viem decodes by name).
- A revert encoded with `DealTokenFactoryAlreadyRegistered` decodes against `evmRegisterDealErrorAbi`.

`packages/trustee/src/api/-useDealToken.test.tsx` (extend the mocks with `readEvmCanCall`, `readEvmOperationSchedule`, `relayEvmRegisterDeal`, `evmRegisterDealSelector`, `encodeEvmRegisterDealCalldata`, `useEvmWallet`; add `EVM_ACCESS_MANAGER_ADDRESS` to the env):
- `useRegisterDealAccess(EVM, 7, true)` reads `readEvmCanCall` with the factory and selector and no schedule for `(true, 0)`; with `(false, 3600)` it also reads `readEvmOperationSchedule` with the calldata; the key includes the chain id.
- It is disabled on a non-configured chain (e.g. 1), without the EVM wallet, when the factory or AM is unset, or when `enabled` is false.
- `useRegisterDeal` on EVM: calls `relayEvmRegisterDeal` with `mode`, AM, factory, the EVM wallet address, `loanId` and `chainId: ENV.EVM_CHAIN_ID`, never `registerDeal`. On success it invalidates `deal-token`, `evm-deal-token`, `register-deal-access` and `audit-log`, and again after 5 s (fake timers).
- Guard order on EVM: chain 1 → Stellar-only reason; unconfigured → `DEBT_TOKEN_NOT_CONFIGURED`; disconnected → "EVM wallet not connected."; no relay call in each case.
- Cache separation: with `useEvmDeal(EVM, 7)` and `useDeal(EVM, 7)` mounted, an EVM registration refetches `readEvmDeal` and never calls `readDeal`.
- `useLoanDeal` returns the Stellar query for Stellar and the EVM query for EVM.
- The existing Stellar cases stay green. Update the "rejects before relaying for EVM" case: EVM is now allowed, and a non-configured chain is the blocked case.

`packages/trustee/src/lib/-dealToken.test.ts`:
- `debtTokenView(EVM_CHAIN_ID, true, …)` gives unregistered / registered; chain `1` is still blocked with the Stellar-only copy.
- `registerDealError("execute", "registerEvmDeal: simulation error: … DealTokenFactoryAlreadyRegistered(7)")` gives the `#3` copy; `LoanRegistryNonExistentLoanId()` gives the `#1` copy.
- In schedule mode the factory names fall back to the generic simulation copy.
- `AccessManagerNotReady` / `AccessManagerAlreadyScheduled` give the AM copy.
- `AccessManagerUnauthorizedCall` gives the generic simulation copy with the raw details.
- A wallet rejection passes through.

`packages/trustee/src/routes/-RegisterDebtTokenAction.test.tsx` (mock `@/lib/chainWallet` `useChainWallet`, replace the `useDeal` mock with `useLoanDeal`):
- An EVM loan renders the card with "Register debt token" enabled for an immediate role, and clicking calls `mutateAsync({ mode: "execute", loanId: 7, chainId: 560048 })`.
- The schedule / execute-scheduled labels for an EVM delayed role.
- The inline variant shows "Debt token registered · 0x…" (checksummed) verbatim.
- The "blocks EVM loans" case becomes chain `1` (not configured), which still gets the Stellar-only reason and no button.
- The disconnected EVM wallet shows the connect copy.

`packages/trustee/src/routes/-useLoanDetail-hook.test.ts` and `-useLoanDetail-fetch.test.tsx`:
- mock `useLoanDeal`;
- an EVM loan's Registry card shows the EVM debt address in "Debt token", and "—" when unregistered or on a read error;
- Stellar is unchanged.

Regression:
- `-DisburseAction.test.tsx` and `-useDisburse.test.tsx` must stay green, since Disburse still calls `useDeal` / `useEvmDeal` directly.
- The full trustee and wallet-connect suites, plus `tsc -b`.

Live check (after merge, from the user story, not a gate):
- draw an EVM loan on Hoodi;
- register from the banner;
- confirm `deal(id)` returns the CREATE2 address equal to `debtAddress(id)`;
- confirm the Disburse card moves past "Register this loan's debt token first.".
- once indexed, confirm the Audit Log shows "Deal tokens registered" (`cargo` null), and after a Disburse confirm a `DealTokenTransfer` mint row for the DEBT token in `contract_logs`.

## Docs to Update

- `docs/frontend/trustee-flows.md`
  - § Register debt token (#1766):
    - drop "Stellar only; … #1892";
    - add an **EVM (#1892)** sub-block: the call, role, selector, access read, schedule path, error-name mapping, config, Hoodi check (the table above, condensed) and "no trustline / no issuer step";
    - "After success" adds `evm-deal-token`;
    - the "After success" line keeps "the worker already indexes `DealRegistered`", now true on both chains (EVM since #1892, BUG-39).
  - § Wired actions, Chain gate: "Only Register debt token stays Stellar-only (#1892)" becomes "Register debt token uses the same gate (#1892)".
  - § Disburse EVM (#1574): step 4 and the testnet caveat now point at Register debt token instead of "out of band"; `useDeal` / `useEvmDeal` are used by the Debt token row too (via `useLoanDeal`).
  - § EVM (#1574): row 28 ("used only by Disburse") becomes "used by Disburse, Register debt token and the Debt token row"; drop `registerDeal (#1892)` from "Not in the app".
  - § Chain-first Approve, EVM draw: drop "Not covered: the Debt token block keeps its Stellar-only reason on EVM until #1892".
  - Add the **Differences from Stellar** table from this plan as the EVM (#1892) block's table, rows numbered on from 34, or as its own table. Pick one and keep it consistent.
- `docs/exec-plans/tech-debt-tracker.md` TD-152:
  - Register debt token is resolved by #1892;
  - what remains is the cash reporter bookings (`record_wire_in` #1501, `record_income`);
  - update the status line and title tag (`PARTIALLY RESOLVED … / #1892`).
- `docs/exec-plans/known-bugs.md`: add **BUG-39** directly under `## Resolved`, titled `[FIXED 2026-11-19 / #1892]`. This follows the repo convention, e.g. BUG-38 found while planning #1922 and fixed by #1927. Fields:
  - **Date:** 2026-11-19.
  - **Tracked:** #1892; found while planning #1892.
  - **Location:** `packages/worker/src/indexer/deal_token_parsers.rs`, `deal_tokens.rs`.
  - **Symptom:** an EVM `registerDeal` leaves no `DealRegistered` row and no audit-log entry, and the DEBT token's `Transfer`s are not indexed.
  - **Root cause:** the decoder declares only the legacy `DealRegistered(uint256,address,address)`, `decode_log` validates topic0, and Hoodi / `150631a` emit `DealRegistered(uint256,address)`.
  - **Workaround:** none needed for the UI (it reads `deal()` on chain).
  - **Resolved:** #1892 accepts both shapes per log (`cargo: null` for DEBT-only) and tracks the DEBT token alone. No Hoodi registration existed before the fix (scan 3 955 455 to head), so nothing needs a backfill.
- `docs/references/backend.md` § EVM DealTokenFactory (#1485):
  - "mints a DEBT and a CARGO `DealToken` per loan" becomes: a DEBT `DealToken` per loan (current factories, contracts #51 and later, including Hoodi v5), plus a CARGO token on legacy factories only;
  - the `DealRegistered` row of the table becomes `loan_id`, `debt`, `cargo` (JSON `null` for a DEBT-only `DealRegistered(uint256 indexed loanId, address debt)`);
  - add the sentence "Both shapes (legacy `(uint256,address,address)` and current `(uint256,address)`) are accepted per log from the same factory address, told apart by topic0; a DEBT-only deal tracks its DEBT token only (#1892)", mirroring the Stellar paragraph;
  - mark `CargoSynced` "legacy factories only";
  - fix "a row without `cargo` seeds DEBT only, which never happens on EVM" in § Runtime address discovery: it now happens for every current-factory deal.
- `docs/product-specs/audit-logging.md` line 73: `details.cargo` is `null` for Stellar deals registered after contracts #38 **and EVM deals on factories from contracts #51 (Hoodi v5)**.
- `docs/user-stories/epic-1478/1485-evm-deal-token-factory-events.md` Story 1: note that a current factory emits `DealRegistered` with `debt` only, so `params.cargo` is `null` and only the DEBT token is tracked (#1892).
- `docs/product-specs/loans.md` line 57: drop "EVM is #1892"; on both chains the Trustee registers the token after the draw (Stellar `register_deal`, EVM `registerDeal` through `AccessManager.execute`).
- `docs/product-specs/loans-data.md` § security considerations (line 194): add the EVM `PipelineDealTokenFactory` bullet:
  - `registerDeal(uint256) restricted` on `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, not called by `drawLoan`;
  - `deal(uint256)` reverts `DealTokenFactoryNotRegistered(loanId)` when unregistered;
  - `debtAddress` is deterministic (CREATE2, salt = loan id) and is not a registration signal;
  - `Deal` is `{ debt }`;
  - `DealRegistered(uint256 indexed loanId, address debt)`;
  - `registerDeal` reverts `LoanRegistryNonExistentLoanId()` for an unknown id and `DealTokenFactoryAlreadyRegistered(loanId)` on a repeat.
- `docs/product-specs/loan-repay-minter.md`: the "(`syncDebt` reverts `DealTokenFactoryNotRegistered` until `registerDeal`, #1892)" note now points at the Trustee's Register debt token action.
- `docs/FRONTEND.md` (EVM env paragraph) and `.env.example` (line 333 comment): `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` is read by the Disbursement card **and Register debt token / the Debt token row (#1892)**; Register also needs `VITE_EVM_ACCESS_MANAGER_ADDRESS`.
- `docs/frontend/wallet-flows.md` § Trustee EVM contract client: add `relayEvmRegisterDeal` / `encodeEvmRegisterDealCalldata` / `evmRegisterDealSelector` (#1892) to the reuser list and bindings.
- `docs/user-stories/epic-1795/1892-trustee-evm-register-deal.md` (new, status Initial). Persona: a Trustee on Hoodi with a real EVM wallet holding `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` delay 0 (`0x96ef…c04e4`). Stories:
  1. Register right after an EVM Approve (inline block; one `AccessManager.execute(factory, registerDeal(id))`, Hoodi chain; the stage labels; "Debt token registered · 0x…").
  2. Register from the loan detail card (performing / watchlist / matured; the row shows "—", then the address).
  3. An already registered EVM loan (no card; the row shows the `deal()` address; `debtAddress` not used).
  4. Disburse unblocks (the Disburse card's "Register this loan's debt token first." clears after registration without a reload).
  5. A wallet without the role ("Only the Trustee role…", disabled).
  6. Contract errors (already registered, unknown loan id; no signature requested; "View details" holds the decoded name).
  7. An unconfigured EVM environment or another EVM chain (not-configured copy / Stellar-only copy, no button).
  8. No trustline or issuer step on EVM.
  Story 9 (backend): after the worker indexes the registration block, the Audit Log shows "Deal tokens registered" for the EVM loan with `debt` = the `deal()` address and `cargo` = null, and the first `syncDebt` mint (Disburse) appears as a `DealTokenTransfer` row in `contract_logs` (not in the audit log; `DealTokenTransfer` is excluded there).
- `docs/user-stories/epic-1795/1766-register-debt-token.md` Story 6: an EVM loan on the configured chain is now covered by #1892; the blocked case is a loan on a non-configured chain. Update the overview line "Stellar only; EVM `registerDeal` is #1892".
- `docs/user-stories/index.md`: add the #1892 row under "Epic #1795".

## Differences from Stellar

Everything not listed is identical (component, test ids, labels, notes, `accessAction` states, gating order, stage label helper, invalidation cadence, separate signature after Approve).

| # | Area | Stellar (#1766) | EVM (#1892) | Why |
|---|---|---|---|---|
| 1 | Chain gate | `stellarOnlyActionReason` (Stellar only) | `loanActionChainReason`: open on `ENV.EVM_CHAIN_ID`; another non-Stellar id keeps the Stellar-only copy | The #1574 gate for all loan actions; this lifts K1 |
| 2 | Call | `AM.execute(factory, "register_deal", [u32 loan_id], caller)` / `AM.schedule(…)` via `relay` | `AccessManager.execute(factory, registerDeal(uint256))`, `value 0` / `AccessManager.schedule(factory, data, 0)`; caller = `msg.sender` | EVM AccessManager takes calldata, and the sender is the caller |
| 3 | Selector / encoding | symbol `register_deal`, `u32` arg | `0x19da0d36`, `uint256` arg; the encoder rejects ids that are not safe non-negative integers before any RPC call | Solidity ABI; same validate-first rule as the #1574 encoders |
| 4 | Role / access read | `TRUSTEE`, `can_call(caller, factory, "register_deal")` | `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` (`0x536b6c688f09d8f7`), `canCall(wallet, factory, 0x19da0d36)`; copy still says "Trustee role" | The contract's role; the copy is kept as in #1574 row 24 |
| 5 | Schedule lookup | `readOperationSchedule` (`hash_operation(caller, factory, fn, args)` + `get_schedule`) | `readEvmOperationSchedule` (`hashOperation(caller, factory, calldata)` + `getSchedule`) | EVM operation id is over calldata; same as the Risk Council EVM arm |
| 6 | Deal read | `readDeal` via `useDeal`, key `["deal-token", …]`, `Error(Contract, #4)` → `null` | `readEvmDeal` via `useEvmDeal`, key `["evm-deal-token", …]`, `DealTokenFactoryNotRegistered` → `null`; the consumer picks through `useLoanDeal` | Separate caches are required (the #1574 shared-key bug) |
| 7 | Debt address shown | Soroban contract id `C…` verbatim | EIP-55 checksummed `0x…` verbatim (`readEvmDeal` applies `getAddress`) | Chain address format; never shortened or recomputed |
| 8 | Error mapping | Soroban codes in execute mode: `#1` unknown loan, `#2` id too large, `#3` already registered, `#5` issuer has not set the admin; AM `#6`–`#9` by mode | custom-error names: `LoanRegistryNonExistentLoanId` → `#1` copy, `DealTokenFactoryAlreadyRegistered` → `#3` copy (execute only); `AccessManagerNotScheduled/NotReady/Expired/AlreadyScheduled` → the `#6`–`#9` copy; no `#2` / `#5` analogue | uint256 ids cannot overflow; there is no issuer on EVM |
| 9 | Issuer precondition | the DEBT issuer must sign `set_admin(factory)` first (`#5`) | none: `registerDeal` deploys the `DealToken` itself (CREATE2, salt = loan id) | Contract design |
| 10 | DEBT trustline | not part of registration (only Disburse step 5; ops runs `just new-deal <id>`) | none anywhere: ERC-20 minted only by the factory; Disburse already skips it (`trustline: null`) | No trustlines on EVM |
| 11 | Simulate failure | `relay` throws `"<mode> simulation error: <Soroban error>"` | `sendEvmContractCallChecked` throws `"registerEvmDeal: simulation error: <viem message>"`; same user copy | The #1574 simulate-before-sign wrap (row 10 there) |
| 12 | Stages | `awaiting-signature` during simulate, then `submitting`, `confirming` | no stage during simulate, then `awaiting-signature`, `confirming`; no `submitting` | One EVM call signs and broadcasts (#1574 row 11) |
| 13 | Signing | Stellar wallet `signTransaction`, tx source = caller | EVM wallet; a wrong network switches to `ENV.EVM_CHAIN_ID` first; mock wallets are refused | `sendEvmContractCall` behaviour (#1574 row 12) |
| 14 | Wallet guard (raw) | "Stellar wallet not connected." | "EVM wallet not connected." (same mapped copy) | Matches every EVM arm |
| 15 | Config | `VITE_STELLAR_DEAL_TOKEN_FACTORY_ID`, `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID` | `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS`, `VITE_EVM_ACCESS_MANAGER_ADDRESS`; same not-configured copy | Per-chain env |
| 16 | Invalidation | `deal-token`, `register-deal-access`, `audit-log` (now and at 5 s) | the same list plus `evm-deal-token` (both arms invalidate all four) | Refreshes the EVM row and the Disburse card's `useEvmDeal` |
| 17 | Access key | `["register-deal-access", address, loanId]` | `["register-deal-access", chainId, address, loanId]` (both arms) | A wallet address can't collide across chains, but the chain id makes the key explicit; prefix invalidation is unchanged |
| 18 | Indexed event | `deal_registered` `Map{debt}` or legacy `Map{cargo, debt}`, told apart per event by the map keys (#1788) | `DealRegistered(uint256 indexed loanId, address debt)` (topic0 `0xc272178e…`) or legacy `(…, address cargo)` (`0x32ae7784…`), told apart per log by topic0 (#1892, BUG-39). The same `contract_logs` row (`cargo: null` for DEBT-only), the same audit-log "Deal tokens registered", and DEBT-only token tracking | Solidity events are keyed by signature hash, Soroban events by map keys; the outcome is identical |
