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
6. Docs: trustee-flows (Register debt token, EVM (#1574) table, Disburse EVM testnet caveat), TD-152, product specs, FRONTEND.md / `.env.example` consumer notes, a new user-stories doc, and the #1766 user-story update.
7. Log the EVM indexer `DealRegistered` decoder mismatch as a known bug (see [Backend](#backend-what-is-served-and-indexed)).

Out of scope:
- Any contract change (contracts are frozen).
- Chaining registration into Approve. It stays a separate, explicit signature, as on Stellar.
- Calling `syncDebt`. Stellar does not call it from this action either.
- Cancelling a scheduled registration (`AccessManager.cancel`). Stellar has no cancel either (TD-159).
- The worker fix for the EVM `DealRegistered` decoder (Open Question 1, recommended as a separate backend issue).
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
| History | factory logs from block 3 800 000 to head: only the four deploy/init logs (Upgraded, AuthorityUpdated, LoanRegistrySet, Initialized) in blocks 3 950 000–3 999 999; no `DealRegistered` yet |

**Correction to the brief.** The Hoodi factory is **not** the `(debt, cargo)` build. Its bytecode has the DEBT-only interface, and `f92d719` and `150631a` have identical `src/dealTokenFactory/` (the cargo variant was removed in `a2e692f`, #51, before both). The `(debt, cargo)` shape belongs to the legacy *Stellar* factories (#1766 user story, "returns `Deal` as `{ cargo, debt }`") and to pre-#51 EVM factories. `readEvmDeal` decodes only the first word (`debt`), so it would read either shape correctly anyway.

### Backend: what is served and indexed

- **Served debt address.** None. `GET /v1/loan-book` and the per-loan endpoints carry no debt-token field on either chain (`packages/api/src/routes/loan_book.rs`). The Stellar "Debt token" row is an on-chain `deal()` read, so the EVM row is `readEvmDeal`, the same approach.
- **Indexer config.** `CHAIN_<id>_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` (`worker/src/indexer/config.rs`, `mod.rs`) enables the EVM factory handler, and the unblock comment says it is set for 560048.
- **Indexer bug (BUG-39, new).** The EVM decoder (`worker/src/indexer/deal_token_parsers.rs`) declares only the legacy `event DealRegistered(uint256 indexed loanId, address debt, address cargo)`. `decode_log(…, true)` checks topic0, so the DEBT-only event that the Hoodi factory and the frozen source emit is silently dropped. As a result:
  - `parse_deal_registered` returns `None`, so no `DealRegistered` row reaches `contract_logs` and the audit log (`api/src/routes/audit_log.rs` lists `DealRegistered`) never shows an EVM registration;
  - `DealTokenRegistry::observe` never learns the DEBT token, so its `Transfer` (mint / burn from `syncDebt`) is never indexed as `DealTokenTransfer`;
  - `DebtSynced` (unchanged signature) is still indexed.
  The Stellar indexer already accepts both shapes (#1788). This bug predates #1892: it also hits a registration made out of band. The trustee UI does not depend on it, because registration state comes from `deal()` on chain on both arms. It is logged in `known-bugs.md` and raised as Open Question 1 rather than fixed here. It is a Rust worker change in a `frontend` issue, and AGENTS.md says to log, not fix, adjacent bugs.

## Assumptions and Risks

- **No live end-to-end test on Hoodi before merge.** The registry holds no loans, so only the eth_call checks above were possible. The first real registration needs an EVM loan drawn from Origination (#1573). Mitigation: unit tests pin the calldata to the bytes verified on Hoodi (`0x19da0d36` + uint256), and the user story covers the live run.
- **The schedule path is untestable on Hoodi** (role delay 0). It is implemented to mirror Stellar and is covered by unit tests only. `AccessManager.schedule(target, data, 0)` and `getSchedule(hashOperation(caller, target, data))` are the same bindings the Risk Council EVM arm (#1942/#1943) already uses.
- **Shared-key regression.** `useDeal` and `useEvmDeal` must keep separate keys (`deal-token` / `evm-deal-token`): a shared key let a disabled observer overwrite the query function (#1574 review). The new `useLoanDeal` only calls both hooks and picks a result; it never merges keys. A test asserts that an EVM registration refetches `readEvmDeal` and never calls `readDeal`.
- **Indexer lag.** Like Stellar, the UI re-reads `deal()` on chain after success, so the row and banner update immediately. The audit-log entry will not appear on EVM until BUG-39 is fixed (documented as a difference).
- **RPC read-after-write.** The publicnode RPC is load-balanced, so an immediate `deal()` re-read can hit a node that is one block behind. The 5 s re-invalidation (same as Stellar) covers it.
- **Copy says "Trustee role"** while the EVM role is `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`. This follows the #1574 precedent (Disburse row 24: copy unchanged). Both Hoodi trustee wallets hold the role.
- **Dependency:** none open. #1942, #1573 and #1574 are merged, and `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` is set on stage (eq-lab/argocd#517, per the unblock comment).

## Open Questions

1. **EVM indexer drops the DEBT-only `DealRegistered` (BUG-39).** Should the worker fix (accept both `DealRegistered(uint256,address)` and the legacy `(uint256,address,address)` per log, `cargo` → JSON `null`, as #1788 did for Stellar; tests in `packages/worker/tests/deal_token_parsers.rs` and `deal_token_registry.rs`, no DB) be folded into this PR so the EVM audit log shows registrations like Stellar does? **Recommended default:** no. Keep #1892 frontend-only, log BUG-39 in `known-bugs.md`, and have the manager open a separate `backend` sub-issue (Flow A, human plan review). The UI does not depend on the indexer, and the bug predates this issue.

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

### 6. Lint and comments

- Run `npx tsx scripts/lint-comments.ts` and `npx tsx scripts/lint-docs.ts`; shrink `scripts/lint-comments.baseline.json` for any touched file it lists. No new comments beyond the single spec-pointer header per file.

## Test Strategy

Vitest only. There is no Rust change, so no Rust tests (if Open Question 1 is overridden, the worker tests go in `packages/worker/tests/`, pure decoding, no Postgres, no env DB URL). Commands, from the worktree:

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
```

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

## Docs to Update

- `docs/frontend/trustee-flows.md`
  - § Register debt token (#1766):
    - drop "Stellar only; … #1892";
    - add an **EVM (#1892)** sub-block: the call, role, selector, access read, schedule path, error-name mapping, config, Hoodi check (the table above, condensed) and "no trustline / no issuer step";
    - "After success" adds `evm-deal-token`;
    - state that the EVM worker does not index the DEBT-only `DealRegistered` yet (BUG-39).
  - § Wired actions, Chain gate: "Only Register debt token stays Stellar-only (#1892)" becomes "Register debt token uses the same gate (#1892)".
  - § Disburse EVM (#1574): step 4 and the testnet caveat now point at Register debt token instead of "out of band"; `useDeal` / `useEvmDeal` are used by the Debt token row too (via `useLoanDeal`).
  - § EVM (#1574): row 28 ("used only by Disburse") becomes "used by Disburse, Register debt token and the Debt token row"; drop `registerDeal (#1892)` from "Not in the app".
  - § Chain-first Approve, EVM draw: drop "Not covered: the Debt token block keeps its Stellar-only reason on EVM until #1892".
  - Add the **Differences from Stellar** table from this plan as the EVM (#1892) block's table, rows numbered on from 34, or as its own table. Pick one and keep it consistent.
- `docs/exec-plans/tech-debt-tracker.md` TD-152:
  - Register debt token is resolved by #1892;
  - what remains is the cash reporter bookings (`record_wire_in` #1501, `record_income`);
  - update the status line and title tag (`PARTIALLY RESOLVED … / #1892`).
- `docs/exec-plans/known-bugs.md`: add **BUG-39**: the EVM indexer decodes only the legacy `DealRegistered(uint256,address,address)`, and Hoodi and `150631a` emit `DealRegistered(uint256,address)`. Include the location (`packages/worker/src/indexer/deal_token_parsers.rs`, `deal_tokens.rs`), the symptom (no `DealRegistered` row and no audit-log entry for EVM registrations, DEBT `Transfer`s not tracked), the root cause (`decode_log` validates topic0), the workaround (none; the UI reads `deal()` on chain), and the fix sketch (#1788 pattern). Also note that `docs/references/backend.md` § EVM DealTokenFactory (#1485) still describes "a DEBT and a CARGO DealToken per loan".
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
  Also list the BUG-39 caveat: the audit log shows no `DealRegistered` on EVM yet.
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
| 18 | Indexed event | `deal_registered` indexed (both shapes, #1788); audit log shows it | `DealRegistered(uint256 indexed loanId, address debt)` (topic0 `0xc272178e…`) is **not** indexed yet (BUG-39); the UI does not depend on it | Pre-existing worker decoder mismatch; Open Question 1 |
