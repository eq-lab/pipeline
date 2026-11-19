# Issue #1943: Trustee: Risk Council hub, escalate, reterm, writedown and repayment recovery on EVM loans

Source: https://github.com/eq-lab/pipeline/issues/1943 (epic #1937, flow: frontend)

## Scope

Make the Risk Council hub (`/risk-council`), Escalate to Default (`/risk-council/escalate/$id`), Amend economics (`/risk-council/reterm/$id`), Default resolution (`/risk-council/writedown/$id`) and the repayment-recovery card and dialog on `/loans/$id` work for EVM loans.

The governing human directive (2026-11-17, epic #1937) is to mirror the Stellar Trustee one-to-one: #1761 (AccessManager model), #1924 (hub and per-page pending operations) and #1711 (recovery, `reverse_repay`). Deviate only where the EVM forces it. Every deviation is listed in [Differences from Stellar](#differences-from-stellar).

This plan follows the structure, conventions and decisions of #1942 (`docs/exec-plans/completed/issue-1942-trustee-evm-security-page.md`). It reuses:

- the wallet-connect EVM write client (`evm/contracts/write.ts`, `sendEvmContractCall`, `readEvmContract`);
- the AccessManager bindings (`evm/contracts/accessManager.ts`: `readEvmCanCall`, `readEvmOperationSchedule`, `relayEvm`, `readEvmScheduledOperation`, `executeEvmScheduledOperation`);
- `useChainWallet` / `pickChainWallet` (`lib/chainWallet.ts`);
- the canonical function-name mapping (`api/pendingOperations.ts` `canonicalPendingFunction`);
- `AccessManager.execute` for immediate calls (human decision 2026-11-18);
- the pending-card Execute with verbatim `calldata` and the #1923 pre-checks.

### Source of truth (checked by the planner on 2026-11-18, worktree base `2dc297ac`, which includes #1938 to #1942)

- **Stellar code to mirror:**
  - Trustee routes: `routes/{-risk-council-hub.ts, risk-council.index.tsx, -risk-council-escalate.ts, risk-council.escalate.$id.tsx, -risk-council-reterm.ts, risk-council.reterm.$id.tsx, -risk-council-writedown.ts, risk-council.writedown.$id.tsx, -risk-council-shared.ts, -risk-council-pending.ts, -repayment-recovery.ts, -useRepaymentRecoveryDialog.ts, -RepaymentRecoveryDialog.tsx}`.
  - Trustee hooks and libs: `api/{useRiskCouncil.ts, useRepaymentRecovery.ts, pendingOperations.ts}`, `lib/{targetChains.ts, accessManagerAction.ts, riskCouncilOps.ts, chainWallet.ts}`.
  - wallet-connect `stellar/contracts/{riskCouncil.ts, minter.ts (reverse_repay, readMinterRepayment), loanRegistry.ts (readNextRepaymentId, readRepaymentData, readIsRepaymentReversed)}`.
- **EVM wallet-connect today:** `evm/contracts/{write.ts, accessManager.ts, securityRegistry.ts}` (#1942) and `evm/contracts/minter.ts` (`minterRecoveryAbi`, `encodeEvmReverseRepayCalldata`, `encodeEvmRepayCalldata`, exported, unused).
- **API:** `GET /v1/loan-book` serves EVM `pending_operations` rows with `calldata` (`0x` hex, selector included), `args_xdr: null`, camelCase `function` and ABI-shaped `args` (#1941; `docs/references/access-manager-events.md#evm-args-and-operation-id`). `target_kind` is `loan_registry` / `minter` / `security_registry` by the indexer's configured addresses. `/security` serves EVM (#1940).
- **EVM contracts** `pipeline-contracts@150631a` (read only, frozen):
  - `PipelineLoanRegistry` (`restricted` wrappers over `LoanRegistryUpgradeable`):
    - Risk Council functions: `setDefault(uint256)`, `cure(uint256)`, `amendEconomics(uint256 loanId, uint32 newRate, uint64 newMaturityTimestamp)`, `adjustInterest(uint256, int256 delta, bytes32 reasonHash)`, `writeDown(uint256, uint256 amount)`, `closeDefaulted(uint256, ClosureReason)`. All are `whenNotPaused`.
    - Views: `mutableLoanData(uint256) → MutableLoanData` (`nextEconomicsEpochsId, nextRepaymentId, status, currentMaturityTimestamp, currentRate, closureReason, carvedOut, disbursed, repaid, writtenDown, interestAdjustment (int256), metadataURI`), `loanMoney(uint256) → LoanMoney` (`disbursed, repaid, writtenDown, outstanding, accruedInterest, carvedOut`).
    - Errors `LoanRegistry*` (32) and `EnforcedPause`.
  - **Units.**
    - `amendEconomics.newRate` is the 1e6 scale: `_epochInterest = dt * rate * principal / (YEAR * ONE)` with `ONE = 1_000_000`. That is bps × 100, the same as Stellar's `new_rate`. The Stellar form conversion (`rateBps * 100`) and the current-terms display (`currentRate / 100` bps) are reused unchanged.
    - Amounts are PLUSD base units, 6 dp.
    - Enums are `uint8` ordinals. `LoanStatus` is `Approved, Performing, WatchList, Default, Closed`. `ClosureReason` is `None, ScheduledMaturity, EarlyRepayment, Cancelled, Default, OtherWriteDown`, so `Default = 4` and `OtherWriteDown = 5`. The Stellar enum has no `Cancelled`.
  - `PipelineMinter`:
    - `reverseRepay(uint256 loanId, uint256 repaymentId, bytes32 refHash)` (`restricted`, not `whenNotPaused`). `refHash` is single-use (`MinterRefHashSeen`); the zero hash is skipped by the replay check. The reversal unrecords the payment on the registry, subtracts the bank cash (`MinterInsufficientBankCash`), burns the fee shares and then either `Pocket.unrelease(loanId, record.released, interest)` (carved out) or absorbs the un-booked yield.
    - `repay(...)` is `MINT_CALLER_ROLE`.
    - `extsload(bytes32) external view` exposes storage. `PipelineMinterReader.repayment` reads the `Repayment` record (`feeShares, fees, released, carvedOut, yieldEpoch`) through it at the ERC-7201 slot `0x1cb61fb8…5cc100`, field 19.
    - Events: `CashRepaid(uint256 indexed loanId, repaymentId, saleId, cash, interestMinted, feeShares, uint64 valueDate, bytes32 refHash)`, `CashRepaymentReversed(...)`.
  - **No EVM view for a recorded repayment or its reversed flag.** `LoanRegistryStorage.repayments` and `reversedRepayments` are private, and `RecordedRepayment` stores only four of the seven `RepaymentData` fields. The full `RepaymentData` exists only in `PaymentRecorded(uint256 indexed loanId, uint256 indexed repaymentId, RepaymentData, uint256 outstanding)`, and the reversal only in `PaymentUnrecorded(uint256 indexed loanId, uint256 indexed repaymentId, uint256 outstanding)`. This is the one EVM-forced design fork (Open Question 1).
  - The default Trustee EVM RPC (`https://ethereum-hoodi-rpc.publicnode.com`) rejects `eth_getLogs` over more than 50 000 blocks ("exceed maximum block range: 50000", probed 2026-11-18). Head was about 4.04 M.
- **Roles on Hoodi** (#1944): all delays are 0. The LoanRegistry Risk Council selectors share `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` with `drawLoan` / `rollover` / `closeLoan`, and `reverseRepay` shares `MINTER_OPS_ROLE` with the other Minter ops. Live testing waits for #1944.

### In scope

1. **wallet-connect, LoanRegistry Risk Council bindings:** new `src/evm/contracts/riskCouncil.ts`, the EVM counterpart of `stellar/contracts/riskCouncil.ts`. It holds the ABI (six writes, two views, errors), the function-name map, the selector, the calldata encoder from the shared `RiskCouncilCall`, the relay, the schedule read, and the `readEvmLoanChainState` / `readEvmLoanMoney` readers returning the shared `LoanChainState` / `LoanMoney` shapes.
2. **wallet-connect, Minter recovery bindings:** extend `src/evm/contracts/minter.ts`:
   - Minter errors in the ABI, the `reverseRepay` / `repay` selectors and the deterministic `evmReverseRepayRefHash`;
   - schedule, execute and schedule-read wrappers;
   - the recovery readers (Open Question 1 default): `readEvmNextRepaymentId`, `readEvmRecoveryRepayments`, `readEvmMinterRepayment`.
3. **wallet-connect, log scan helper:** new `src/evm/contracts/logs.ts`, `scanEvmLogs`, a chunked `eth_getLogs` (50 000 blocks per call) through the wagmi public client.
4. **Trustee:**
   - The chain gate becomes `riskCouncilChainReason(chainId)`. It replaces `riskCouncilBlockedReason` and `pendingRowBlockedReason`, and opens every Risk Council function and every pending row on `ENV.EVM_CHAIN_ID`.
   - `stellarOnlyActionReason` is removed from `api/useRiskCouncil.ts` (`useRiskCouncilLoanState`), `routes/-risk-council-shared.ts`, `routes/-risk-council-hub.ts`, `routes/-risk-council-pending.ts`, `api/useRepaymentRecovery.ts` and `routes/-useRepaymentRecoveryDialog.ts`. Step 2 of the recovery keeps it (Open Question 3).
   - EVM arms of `useRiskCouncilAccess`, `useRiskCouncilRelay`, `usePendingOperationExecute`, `useRiskCouncilLoanState`, `useRecoveryCandidates`, `useReverseRepayAccess` and the reverse-repay mutations.
   - EVM pending-row decoders for LoanRegistry and Minter rows.
   - Per-chain targets, per-chain amount decimals in the write-down and adjust-interest inputs, and EVM error copy by custom-error name, per target kind.
5. **Env:** new `VITE_EVM_START_BLOCK`, the log-scan start. The existing `VITE_EVM_LOAN_REGISTRY_ADDRESS`, `VITE_EVM_MINTER_ADDRESS` and `VITE_EVM_ACCESS_MANAGER_ADDRESS` get their first Risk Council use.
6. **Docs:** `docs/frontend/trustee-flows.md`, `docs/product-specs/loan-repayment-recovery.md`, `docs/frontend/wallet-flows.md` (reusers line), TD-152 status, a new TD for the browser log scan, the user stories `docs/user-stories/epic-1937/1943-trustee-evm-rc-pages.md` and the index row.

### Out of scope

- **Recovery step 2 on EVM** (the corrected `Minter.repay`). It stays with #1574 (EVM arm of `useRecordPayment`; Open Question 3). The dialog's step 2 shows the Stellar-only reason on EVM until then.
- Rollover, Update lifecycle, Record coupon / repayment and Close loan on EVM (#1574), and the EVM draw (#1573).
- Cancelling (TD-159), reconciling served rows with `getSchedule` (TD-187), any backend or contract change, the argocd values (separate repo), a Safe-aware write path (#1944 comment), and showing `default_breach` (TD-189).
- No Figma: reuse the existing Risk Council cards, the recovery dialog and the parts (`-RiskCouncilParts.tsx`, `packages/ui`). No markup change is planned.

### #1755 decision

#1943 absorbs #1755 for everything the EVM recovery needs except the corrected `repay`:

- the `reverseRepay` signing path through the AccessManager (`canCall`, then schedule or execute);
- the readers;
- the card and dialog EVM arm;
- the `reverse_repay` pending rows;
- tests, the spec update and the TD-152 pointer.

The corrected `repay` (step 2) is the EVM record-payment arm, already in #1574's scope ("record payment"). Once #1574 adds the EVM arm of `useRecordPayment` and lifts the step-2 gate, the dialog works with no other change.

**Recommended handling of #1755** (the manager does it, not the planner): when #1943's PR merges, close #1755 as completed by #1943 with a comment. The comment says that step 1 (`reverseRepay`), the readers and the dialog shipped in #1943, and that step 2 (`repay` under `MINT_CALLER_ROLE`) moves to #1574.

If Open Question 1 resolves to the API option (B), #1755 stays open instead. It is re-scoped to "EVM recovery candidates from the API, plus enabling the card", blocked on the new backend issue, and #1943 keeps the card gated (see Open Question 1).

## Decisions (planner; mirror Stellar)

1. **Logical calls stay chain-neutral**, as #1942 Decision 1:
   - `RiskCouncilCall` (snake_case `fn`), `CouncilCall`, `councilTarget`, `riskCouncilCallKey`, the session store, `PENDING_OWNERS`, labels and the action views are reused unchanged.
   - The `ReverseRepayCall` pending shape is reused.
   - Solidity names come from one map in the EVM module: `EVM_RISK_COUNCIL_FUNCTION_NAMES`, from `set_default` to `setDefault` through `close_defaulted` to `closeDefaulted`.
   - Selectors are `toFunctionSelector` of the ABI item, never hard-coded.
2. **One chain gate for the Risk Council:** `riskCouncilChainReason(chainId)` in `lib/targetChains.ts`.
   - It returns `null` for Stellar and for `chainId === ENV.EVM_CHAIN_ID`. Otherwise it returns `stellarOnlyActionReason(chainId)`, the same copy as today for an unknown chain.
   - It replaces `riskCouncilBlockedReason(chainId, fn)` and `pendingRowBlockedReason(chainId, targetKind)`. Their function and target-kind arguments existed only to split #1942 from #1943, and Stellar has no such gate.
   - `stellarOnlyActionReason` stays for every non-Risk-Council caller, including recovery step 2.
3. **Delay vs immediate, schedule and execute** are exactly #1942 Decision 3:
   - `canCall(wallet, target, selector)` drives `accessAction`;
   - schedule is `AccessManager.schedule(target, calldata, 0)`;
   - every execute, immediate or scheduled, is `AccessManager.execute(target, calldata)` (human decision 2026-11-18).
   - Targets: `ENV.EVM_LOAN_REGISTRY_ADDRESS` for LoanRegistry functions and `ENV.EVM_MINTER_ADDRESS` for `reverseRepay`.
   - The AccessManager is `ENV.EVM_ACCESS_MANAGER_ADDRESS`.
   - A missing address gives the existing per-surface "not configured" copy: "On-chain Risk Council actions are not configured for this environment." or "On-chain repayment recovery is not configured for this environment."
4. **Execute from the card** sends the served `calldata` verbatim with #1942 Decision 4's pre-checks, in order: chain gate; target equals the owner's configured id (`PendingTargetMismatchError`, case-insensitive); paused (security rows only, as Stellar); AccessManager configured; wallet connected and equals `caller`; `calldata` present; `hashOperation` equals `0x` + `operation_id`; `getSchedule ≠ 0`. Only the error ABI changes, by `target_kind`: SecurityRegistry, LoanRegistry or Minter errors.
5. **Encoding of LoanRegistry calls** (`encodeEvmRiskCouncilCalldata`) applies the Stellar encoder's validation rules unchanged:
   - `loanId`: a safe non-negative integer, then `BigInt`.
   - `amend_economics`: `rateBps` an integer from 1 to 10 000, encoded as `uint32(rateBps * 100)`; `maturity` an integer above 0, encoded as `uint64`.
   - `adjust_interest`: `delta` a signed decimal string, non-zero and within `int256`, encoded as `BigInt`; `reasonHash` matches `/^[0-9a-f]{64}$/` and is sent as `0x` + hex. The hash is `riskCouncilReasonHash`, sha256 of the trimmed reason, chain-neutral.
   - `write_down`: `amount` a decimal string above 0, encoded as `uint256`.
   - `close_defaulted`: `Default` encodes as ordinal 4 and `OtherWriteDown` as 5. Any other reason throws.
6. **Amounts per chain.** The write-down and adjust-interest inputs convert with `usdInputToSacBaseUnits(input, chainAmountDecimals(chainId))`: 6 dp on EVM, 7 on Stellar. Without this an EVM write-down would be 10 times too large. The prefill (`formatChainAmount`) is already chain-aware. The rate and maturity conversions are unchanged (the same 1e6 scale on both chains).
7. **Chain-state reads** (`useRiskCouncilLoanState` EVM arm): `readEvmLoanChainState` and `readEvmLoanMoney` on `ENV.EVM_LOAN_REGISTRY_ADDRESS`, mapped to the Stellar shapes:
   - `status` and `closureReason` are mapped from ordinals to the enum names, so the strings match Stellar's `enumTag` output, plus `Cancelled`, which exists only on EVM;
   - `currentRate`, `currentMaturity` and `metadataUri` map directly;
   - `interestAdjustment` (signed), `writtenDown`, `disbursed`, `repaid`, `outstanding` and `accruedInterest` are decimal strings;
   - `carvedOut`.
   Nothing is computed.
8. **Recovery on EVM (Open Question 1, default A: read the chain, as Stellar does):**
   - **Candidates** (`readEvmRecoveryRepayments`, returning the existing `RecoveryRow` shape):
     - `nextRepaymentId` comes from `mutableLoanData(loanId)`;
     - one chunked `eth_getLogs` pass over `[LoanRegistry, Minter]` with topic0 ∈ {`PaymentRecorded`, `PaymentUnrecorded`, `CashRepaid`} and topic1 = `loanId`, from `ENV.EVM_START_BLOCK` to `latest`, 50 000 blocks per call, decoded with `parseEventLogs`;
     - `repayment` is the seven `PaymentRecorded.repayment` fields, as snake_case decimal strings (`RepaymentInput`);
     - `reversed` is true when a `PaymentUnrecorded` exists for that id;
     - every id below `nextRepaymentId` must have a `PaymentRecorded` and a `CashRepaid` log. A missing one throws `"Repayment #N was not found on chain from block {from}; check VITE_EVM_START_BLOCK."`, never a fabricated row.
   - **Minter effects** (`MinterRepayment` shape):
     - `cash`, `interestMinted`, `feeShares` and `saleId` come from `CashRepaid`;
     - `carvedOut` and `principal` come from the Minter's own `Repayment` record (`readEvmMinterRepayment`, `Minter.extsload` at the `PipelineMinterReader` slot, words 2 and 3). `principal` is `released`, the amount `Pocket.unrelease` restores;
     - `reversed` mirrors the registry flag.
     This keeps "verbatim from chain, nothing summed client-side".
   - **refHash:** `evmReverseRepayRefHash = "0x" + sha256("pipeline:reverse_repay:{getAddress(minter)}:{loanId}:{repaymentId}")`. This is the Stellar preimage with the EIP-55 Minter address, so a reload finds the schedule. It is never the zero hash.
   - **Access:** `canCall(wallet, minter, selector(reverseRepay))` and `canCall(wallet, minter, selector(repay))`. Step 2 stays gated (Open Question 3).
9. **Error copy by name, per target kind.**
   - `evmCouncilErrorCopy(details, kind)`: the AccessManager names map for every kind. The SecurityRegistry and RecordNft names and `EnforcedPause` map only for `security_registry` (the paused copy names the SecurityRegistry). LoanRegistry errors fall through to `toUserError`, as on Stellar, where only the AccessManager codes have copy.
   - `evmRecoveryErrorCopy(details)`, mirroring `RECOVERY_ERROR_COPY`:
     - `AccessManagerNotScheduled`: execute:6 copy;
     - `AccessManagerNotReady`: execute:7 copy;
     - `AccessManagerExpired` and `MinterInsufficientBankCash`: execute:8 copy, which already names both causes;
     - `LoanRegistryRepaymentAlreadyReversed` and `MinterAlreadyReversed`: execute:25 copy;
     - `AccessManagerAlreadyScheduled`: schedule:9 copy.
   - `EVM_ERROR_NAME` also matches `LoanRegistry[A-Za-z]+` and `Minter[A-Za-z]+`.
10. **Copy is unchanged** (Open Question 2): the hub intro, the role lines, the chips, the closure table ("Risk Council only · 24 hours"), effects, gates and no-role copy. Role lines and chips already come from `canCall`.

## Differences from Stellar

Everything not listed is identical:

- routes, page layout and test ids, cards, copy;
- the `accessAction` model, the session bridge and its dedup by `operation_id`;
- ownership and link rules of the pending rows, the executed-row behaviour, the status gates;
- the close-defaulted split, invalidation keys and timings, the confirm dialogs;
- the recovery dialog structure, eligibility, suspect ordering, the reload behaviour and the step-2 gate order.

Rows 1–9, 15 and 17 of the #1942 table also apply unchanged here: write client, stages, wrong-network switch, `canCall` selector, operation id, schedule / execute calls, verbatim `calldata`, camelCase `function`, ABI `args`, address comparison and wallet.

| # | Area | Stellar (#1761, #1924, #1711) | EVM (#1943) | Reason |
|---|---|---|---|---|
| 1 | Chain gate | none (Stellar is the only chain) | `riskCouncilChainReason(chainId)`: open on `ENV.EVM_CHAIN_ID`, another EVM chain id keeps the Stellar-only copy; the #1942 per-function / per-`target_kind` split is removed | One EVM chain per deployment |
| 2 | LoanRegistry args | `u32` id, `u32` rate, `u64` maturity, `i128` delta, `u128` amount, `BytesN<32>` hash, `ClosureReason` as `scvVec([scvSymbol])` | `uint256` id, `uint32` rate (same bps × 100), `uint64` maturity, `int256` delta, `uint256` amount, `bytes32` hash (`0x` + hex), `ClosureReason` ordinal `4` / `5` | ABI types; the EVM enum has `Cancelled` at 3 |
| 3 | Amount input units | 7 dp (`usdInputToSacBaseUnits` default) | 6 dp via `chainAmountDecimals(chainId)` in write-down and adjust-interest | PLUSD has 6 decimals |
| 4 | Chain-state reads | `simulateRead` `mutable_loan_data` / `loan_money`, enum tags | `readContract` `mutableLoanData` / `loanMoney`, ordinals mapped to the same names; `closureReason` can read `Cancelled` | Different read model and enum |
| 5 | Pending `args` decode (LoanRegistry, Minter) | `[u32, …]`, `amend_economics` rate number, maturity string, `close_defaulted` `["Default"]`, `reverse_repay` `[u32, u32, hash]` | ids and `repaymentId` decimal strings within `u32`, rate number, maturity / amount / delta decimal strings, `closeDefaulted` ordinal `4` / `5`, hashes lowercase hex without `0x` | ABI display form (#1939) |
| 6 | Recovery candidates | registry views `repayment_data`, `is_repayment_reversed`, `mutable_loan_data.next_repayment_id` | `mutableLoanData.nextRepaymentId` view plus `PaymentRecorded` / `PaymentUnrecorded` logs scanned from `VITE_EVM_START_BLOCK` in 50 000-block chunks (Open Question 1) | No EVM view holds the full `RepaymentData` or the reversed flag; the default RPC caps `eth_getLogs` at 50 000 blocks |
| 7 | Reversal effects | Minter view `repayment(...)`: `cash`, `principal`, `interest_minted`, `fee_shares`, `carved_out` | `CashRepaid` log (`cash`, `interestMinted`, `feeShares`, `saleId`) plus the Minter `Repayment` record via `extsload` (`carvedOut`, `released` shown as the Pocket-unrelease principal) | No Minter view; `released` is what `Pocket.unrelease` restores |
| 8 | Reverse `refHash` | `sha256("pipeline:reverse_repay:{minterId}:{loan}:{repayment}")`, 64 hex | the same preimage with the EIP-55 Minter address, sent as `0x` + 64 hex | Address format; `bytes32` |
| 9 | Recovery role | `RISK_COUNCIL` through the AM (`reverse_repay`) | `MINTER_OPS_ROLE` (shared with other Minter ops); the UI follows `canCall`, copy unchanged | Deployment role model (#1944) |
| 10 | Recovery step 2 | `useRecordPayment` (Stellar `repay`) | gated with `stellarOnlyActionReason` until #1574 adds the EVM arm | Not EVM-forced: scope split (Open Question 3, TD-152) |
| 11 | Error copy | Soroban codes per target kind (`RISK_COUNCIL_AM_ERROR_COPY`, `RECOVERY_ERROR_COPY`) | custom-error names: `evmCouncilErrorCopy(details, kind)` (security names and `EnforcedPause` only for SecurityRegistry rows), `evmRecoveryErrorCopy` (`MinterInsufficientBankCash` and `AccessManagerExpired` share the `#8` copy; `LoanRegistryRepaymentAlreadyReversed` / `MinterAlreadyReversed` the `#25` copy) | Soroban codes collide, Solidity names do not |
| 12 | Config | `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `VITE_STELLAR_LOAN_REGISTRY_ID`, `VITE_STELLAR_YIELD_MINTER_ID` | `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS`, `VITE_EVM_MINTER_ADDRESS`, new `VITE_EVM_START_BLOCK` | Separate contracts; log-scan start |
| 13 | Live data | Stage chain 99000001 has Risk Council schedules | none on Hoodi until #1944; there a Trustee wallet holding `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` gets `execute-now` for the Risk Council functions, and the Minter must expose `extsload` (#54) | Hoodi delays are 0 and the role is shared |

## Assumptions and Risks

- **Dependencies merged:** #1938 to #1942 (PRs #1947, #1948, #2025, #2026, #2036) are on this base. #1942's hooks were kept generic over `CouncilTarget`, so this issue adds encoders, flips the gate and adds the recovery arm.
- **No live EVM target.** Hoodi delays are 0 (#1944), so every call is immediate there, and the Risk Council selectors share the Trustee role: a Trustee wallet can declare a default on Hoodi until #1944. That is a deploy fact, and the UI follows `canCall`. Coverage is unit and render tests. QA in #1945 runs after #1944 and the stage env.
- **Hoodi Minter version.** The `extsload` read needs the Minter from contracts PR #54 or later; #1944 asks for the upgrade. On an older Minter, `readEvmMinterRepayment` reverts and the dialog shows "Failed to load the repayments." with details, never a guessed value.
- **Log scan cost** (Open Question 1, default A):
  - `useRecoveryCandidates` runs for every EVM loan in `Performing..Default` that opens the loan detail page (the card needs `latestReversed`), as on Stellar.
  - With `VITE_EVM_START_BLOCK` at the LoanRegistry deploy block, this is a few `eth_getLogs` calls on Hoodi today, growing by one call about every week (about 7 200 blocks a day).
  - With the default 0 it is about 81 calls; `.env.example` says to set it.
  - Calls run with a concurrency of 4 and fail fast on the first error, keeping `retry: false` and `staleTime` 15 s.
  - Logged as tech debt with the API option as the fix.
- **RPC providers differ.** The chunk size is the publicnode cap (verified). Some paid providers allow larger ranges and some free tiers allow fewer blocks. The chunk is one constant (`EVM_LOG_CHUNK_BLOCKS`). If a provider rejects it, the error surfaces through `toUserError`.
- **Safe wallets** (#1944 comment, #1942 review finding 5): `waitForTransactionReceipt` stalls for a Safe. That is unchanged and out of scope.
- **Test mocks:** every test that mocks `@pipeline/wallet-connect` for these pages must add the new EVM functions (mechanical). The #1942 suites that pin "LoanRegistry blocked on EVM" flip.
- **The import cycle risk** between `lib/targetChains.ts` and `lib/riskCouncilOps.ts` goes away: `riskCouncilChainReason` no longer needs `councilTarget`. Drop that import.

## Decisions (human, 2026-11-18)

All open questions were resolved with the recommended defaults:

1. **EVM recovery list:** read from the chain in the browser, as on Stellar.
   - Sources: the `nextRepaymentId` view, chunked log reads from `VITE_EVM_START_BLOCK`, and Minter `extsload` for its stored record.
   - Logged as TD-190.
   - #1943 absorbs #1755 step 1. Close #1755 when this PR merges, with a comment that step 2 moved to #1574.
2. **The "24 hours" text** stays as on Stellar. The role lines and chips already show the on-chain delay.
3. **Recovery step 2** (the corrected `Minter.repay`) stays with #1574. Until then it is gated with the Stellar-only message on EVM.

## Open Questions

_None_ (resolved 2026-11-18, see Decisions).

## Implementation Steps

Run from `/Users/aabliazimov/Documents/work/pipeline-feat-1943-trustee-evm-rc-hub-pages`; yarn is `node .yarn/releases/yarn-4.13.0.cjs`. Every new file carries one `// spec:` header line and no other comments (`AGENTS.md`). The steps assume the Open Question defaults. Under 1(B), skip steps 3 and the reader parts of 4, and keep the recovery card gated in step 12.

1. [x] **wallet-connect, LoanRegistry Risk Council** `packages/wallet-connect/src/evm/contracts/riskCouncil.ts` (spec `docs/frontend/trustee-flows.md#risk-council-actions`):
   - `evmLoanRegistryRiskCouncilAbi`:
     - functions `setDefault`, `cure`, `amendEconomics(uint256,uint32,uint64)`, `adjustInterest(uint256,int256,bytes32)`, `writeDown(uint256,uint256)`, `closeDefaulted(uint256,uint8)`;
     - views `mutableLoanData(uint256)` (the 12-component tuple named exactly as `ILoanRegistry.MutableLoanData`) and `loanMoney(uint256)`;
     - the `LoanRegistry*` error entries (with their inputs, as in the contract) and `EnforcedPause`.
     - `evmRiskCouncilErrorAbi` is the error subset.
   - `EVM_RISK_COUNCIL_FUNCTION_NAMES: Record<RiskCouncilCall["fn"], string>` and `evmRiskCouncilSelector(fn): Hex`.
   - `EVM_LOAN_STATUSES = ["Approved", "Performing", "WatchList", "Default", "Closed"]` and `EVM_CLOSURE_REASONS = ["None", "ScheduledMaturity", "EarlyRepayment", "Cancelled", "Default", "OtherWriteDown"]`.
   - `encodeEvmRiskCouncilCalldata(call: RiskCouncilCall): Hex` per Decision 5. The error prefix is `encodeEvmRiskCouncilCalldata: invalid …`.
   - `relayEvmRiskCouncil({ mode, call, accessManager, registry, caller, chainId, onStageChange })`: `relayEvm` with `target = registry`, `data = encodeEvmRiskCouncilCalldata(call)` and `errorAbi = evmRiskCouncilErrorAbi`.
   - `readEvmRiskCouncilSchedule({ call, accessManager, registry, caller })`: `readEvmOperationSchedule` with the same data.
   - `readEvmLoanChainState({ registry, loanId }): LoanChainState` and `readEvmLoanMoney({ registry, loanId }): LoanMoney` (Decision 7). Both validate the address with `isAddress`, throw `"<fn>: registry must not be empty"` like `requireRegistry`, and read through `readEvmContract`. An out-of-range ordinal throws.
2. [x] **wallet-connect, Minter recovery** `src/evm/contracts/minter.ts` (spec unchanged: `docs/product-specs/loan-repayment-recovery.md`):
   - Add the Minter error entries (`Minter*` with inputs) to a new `evmMinterErrorAbi`. `evmRecoveryErrorAbi` is `[...evmMinterErrorAbi, ...evmRiskCouncilErrorAbi]`, because `reverseRepay` bubbles the LoanRegistry `unrecordPayment` errors.
   - `evmReverseRepaySelector()` and `evmRepaySelector()` from `minterRecoveryAbi`.
   - `evmReverseRepayRefHash({ minter, loanId, repaymentId }): Promise<Hex>` (Decision 8; reuse `sha256Hex` from `stellar/contracts/hash.ts`).
   - `relayEvmReverseRepay({ mode, accessManager, minter, caller, loanId, repaymentId, refHash, chainId, onStageChange })` (via `relayEvm` with `encodeEvmReverseRepayCalldata` and `evmRecoveryErrorAbi`), plus `scheduleEvmReverseRepay` / `executeEvmReverseRepay` aliases and `readEvmReverseRepaySchedule({ accessManager, minter, caller, loanId, repaymentId, refHash })`.
   - `readEvmNextRepaymentId({ registry, loanId }): number` from `mutableLoanData`.
   - `readEvmMinterRepayment({ minter, loanId, repaymentId })`:
     - `minterExtsloadAbi` (`extsload(bytes32) view returns (bytes32)`);
     - `MINTER_STORAGE_SLOT = 0x1cb61fb8c91dfac98430b399e1cf1804c4c3862229ec367a9bc71c2a7e5cc100n` and `MINTER_REPAYMENTS_FIELD = 19n`;
     - the slot is `keccak256(encodeAbiParameters([uint256, bytes32], [repaymentId, keccak256(encodeAbiParameters([uint256, bytes32], [loanId, toHex(MINTER_STORAGE_SLOT + 19n, { size: 32 })]))]))`;
     - read words +2 (`released`) and +3 (`carvedOut` = low byte ≠ 0);
     - returns `{ released: string; carvedOut: boolean }`.
   - `readEvmRecoveryRepayments({ registry, minter, loanId, fromBlock, chainId }): Promise<EvmRecoveryRepayment[]>` (Decision 8):
     - read `readEvmNextRepaymentId`, then one `scanEvmLogs` call (step 3);
     - decode with `parseEventLogs` over a small event ABI (`PaymentRecorded`, `PaymentUnrecorded`, `CashRepaid`, exactly the 150631a signatures);
     - require one `PaymentRecorded` and one `CashRepaid` per id below `next`, else throw the "not found on chain" error;
     - read `readEvmMinterRepayment` per id (`Promise.all`);
     - return `{ repaymentId, repayment: RepaymentInput, minter: MinterRepayment, reversed }` with the Stellar `MinterRepayment` field names (`principal` = `released`; `reversed` = registry flag).
   - Export everything and the param types from `src/index.ts` in the "EVM Risk Council" block.
3. [x] **wallet-connect, log scan** `src/evm/contracts/logs.ts` (spec `docs/frontend/wallet-flows.md#trustee-evm-contract-client`):
   - `EVM_LOG_CHUNK_BLOCKS = 50_000n`.
   - `scanEvmLogs({ address: Address[], topics, fromBlock: bigint, chainId, concurrency = 4 })`:
     - `getPublicClient(initEvmWalletConnect(), { chainId })` (throw "RPC not ready" like `write.ts`);
     - `getBlockNumber`;
     - split `[fromBlock, head]` into inclusive chunks;
     - run `eth_getLogs` per chunk through `publicClient.request` (raw `topics` so an OR of topic0 values and a `loanId` topic1 fit in one call);
     - concatenate in block order;
     - reject on the first failed chunk.
   - `loanIdTopic(loanId)`: `pad(toHex(BigInt(loanId)), { size: 32 })`.
4. [x] **Trustee env** `packages/trustee/src/lib/env.ts`:
   - `EVM_START_BLOCK: readNumber("VITE_EVM_START_BLOCK", 0)`, with a short doc comment like the neighbours: "Must equal the worker's `CHAIN_<id>_EVM_START_BLOCK`; the LoanRegistry deploy block".
   - Add it to `docker/trustee/entrypoint.sh` (`--arg` and the JSON object).
   - Add it to `.env.example`, with the Hoodi LoanRegistry / Minter proxies from `pipeline-contracts/deployments/hoodi-v5.json` as comments (`0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231`, `0x621BaAb0ced6b11f88019582183b081A118755f4`).
5. [x] **Chain helpers** `packages/trustee/src/lib/targetChains.ts`:
   - `riskCouncilChainReason(chainId)` (Decision 2). Delete `riskCouncilBlockedReason`, `pendingRowBlockedReason` and `evmSecurityAllowed`, and drop the `councilTarget` / `PendingTargetKind` imports.
   - Add `riskCouncilTargetId(chainId, kind: PendingTargetKind): string`:
     - Stellar: `loan_registry` gives `STELLAR_LOAN_REGISTRY_ID`, `minter` gives `STELLAR_YIELD_MINTER_ID`, `security_registry` gives `STELLAR_SECURITY_REGISTRY_ID`;
     - EVM: `EVM_LOAN_REGISTRY_ADDRESS`, `EVM_MINTER_ADDRESS`, `EVM_SECURITY_REGISTRY_ADDRESS`;
     - `other` gives `""`.
   - Update every caller: `api/useRiskCouncil.ts`, `routes/-risk-council-shared.ts`, `routes/-risk-council-hub.ts`, `routes/-risk-council-pending.ts`.
6. [x] **Error copy** `lib/accessManagerAction.ts` (Decision 9):
   - `EVM_ERROR_NAME` adds `LoanRegistry[A-Za-z]+|Minter[A-Za-z]+`.
   - `EVM_COUNCIL_ERROR_COPY` is split into `EVM_AM_ERROR_COPY` (four AccessManager names) and `EVM_SECURITY_ERROR_COPY` (SecurityRegistry names and `EnforcedPause`).
   - `evmCouncilErrorCopy(details, kind: PendingTargetKind | CouncilTarget = "security_registry")`.
   - New `evmRecoveryErrorCopy(details)` in `routes/-repayment-recovery.ts`, next to `recoveryErrorCopy`, reusing `RECOVERY_ERROR_COPY` strings by key.
   - Callers:
     - `-risk-council-shared.ts` `mapRelayError` passes `councilTarget(fn)`;
     - `-risk-council-pending.ts` `executeErrorCopy` on EVM uses `evmRecoveryErrorCopy(details) ?? evmCouncilErrorCopy(details, "minter")` for `minter` rows and `evmCouncilErrorCopy(details, kind)` otherwise;
     - `-useRepaymentRecoveryDialog.ts` `mapError` picks `evmRecoveryErrorCopy` on EVM.
7. [x] **Hooks** `api/useRiskCouncil.ts`:
   - `evmCouncilConfig(fn)` gains the LoanRegistry arm:
     - for `councilTarget(fn) === "loan_registry"`: `{ accessManager, target: ENV.EVM_LOAN_REGISTRY_ADDRESS, chainId }`, `null` when either is empty;
     - the security arm is unchanged.
     - A `null` config throws `notConfiguredFor(target)` (Stellar copy rule).
   - `useRiskCouncilAccess`:
     - `enabled = riskCouncilChainReason(chainId) === null && !!address`;
     - the EVM arm uses `evmSecuritySelector` or `evmRiskCouncilSelector` by target;
     - when delayed with a call, it reads `readEvmSecurityRegistrySchedule` or `readEvmRiskCouncilSchedule`.
   - `useRiskCouncilLoanState`: gate `riskCouncilChainReason`. The EVM arm runs `Promise.all([readEvmLoanChainState, readEvmLoanMoney])` on `ENV.EVM_LOAN_REGISTRY_ADDRESS`, and an empty address gives `NOT_CONFIGURED`. The query key is unchanged.
   - `useRiskCouncilRelay`:
     - gate `riskCouncilChainReason(chainId)`;
     - the EVM arm branches on target like the Stellar arm: pre-read the schedule in execute mode, then relay, then read once after a schedule;
     - LoanRegistry calls use `relayEvmRiskCouncil` / `readEvmRiskCouncilSchedule` / `encodeEvmRiskCouncilCalldata`, with `target = ENV.EVM_LOAN_REGISTRY_ADDRESS`;
     - security calls are unchanged.
   - `usePendingOperationExecute`:
     - gate `riskCouncilChainReason(chainId)`;
     - the EVM `errorAbi` is chosen by `targetKind`: `evmSecurityErrorAbi`, `evmRiskCouncilErrorAbi` or `evmRecoveryErrorAbi` (`other` gives `[]`);
     - everything else is unchanged.
   - `useSecurityInspectors`: gate `riskCouncilChainReason`.
   - Drop the `stellarOnlyActionReason` import.
8. [x] **Recovery hooks** `api/useRepaymentRecovery.ts`:
   - `recoveryConfig(chainId)` returns `{ kind: "stellar", … }` as today, or `{ kind: "evm", accessManager, minter, registry, fromBlock: BigInt(ENV.EVM_START_BLOCK), chainId: ENV.EVM_CHAIN_ID }`, or `null`.
   - `useRecoveryCandidates`: `enabled` uses `riskCouncilChainReason(chainId) === null`. The EVM arm calls `readEvmRecoveryRepayments`, and `latestReversed` is computed as before.
   - `useReverseRepayAccess(chainId, loanId, repaymentId, enabled)`:
     - new `chainId` first parameter, `useChainWallet(chainId)`, key `["repayment-recovery-access", chainId, address, loanId, repaymentId]`;
     - the EVM arm runs `readEvmCanCall` with `evmReverseRepaySelector()` and `evmRepaySelector()` on the Minter;
     - when delayed, it reads `readEvmReverseRepaySchedule` with `evmReverseRepayRefHash`.
   - `useReverseRepayMutation`:
     - `ReverseRepayInput.chainId` becomes required (the dialog already passes it);
     - pick the wallet with `pickChainWallet`;
     - the EVM arm mirrors the Stellar one: refHash, then schedule, or pre-read the schedule and execute, through `relayEvmReverseRepay`;
     - `onSuccess` is unchanged.
9. [x] **Shared presenter** `routes/-risk-council-shared.ts`: `useRiskCouncilLoanBase.blockedReason` and `useRiskCouncilActionView.blockedReason` use `riskCouncilChainReason(chainId)`.
10. [x] **Pages:**
    - `-risk-council-escalate.ts`, `-risk-council-reterm.ts` and `-risk-council-writedown.ts`: `expectedTarget = riskCouncilTargetId(chainId, "loan_registry")`.
    - `-risk-council-security.ts` uses `riskCouncilTargetId(chainId, "security_registry")` in place of its inline ternary.
    - Reterm: `parseSignedUsdDelta(input, chainId)` and `buildAdjustCall(loanId, deltaUsd, reasonHash, chainId)`, with decimals from `chainAmountDecimals(chainId)`; `deltaInvalid` passes `chainId`.
    - Writedown: `buildWriteDownCall(loanId, amountInput, chainId)` (Decision 6).
    - No `.tsx` change.
11. [x] **Hub** `routes/-risk-council-hub.ts`:
    - `blockedReason = riskCouncilChainReason(chainId)`;
    - `const { address } = useChainWallet(chainId)` in place of `useStellarWallet`;
    - `showInspectorsLink = blockedReason === null`.
    - The rest is unchanged. An EVM session now shows the intro, role line, scheduled table and loan index.
12. [x] **Pending presenter** `routes/-risk-council-pending.ts`:
    - `decodeEvmLoanRegistryCall(fn, args)`, strict, using the existing `evmId`:
      - `set_default` / `cure`: `[id]`;
      - `amend_economics`: `[id, rate, maturity]`, where `rate` is an integer number that is a multiple of 100 and between 1 and 10 000 bps, and `maturity` is a positive decimal string within safe integers;
      - `adjust_interest`: `[id, delta, hash]`, with a signed decimal-string delta;
      - `write_down`: `[id, amount]`, with a decimal-string amount;
      - `close_defaulted`: `[id, 4 | 5]`, mapped to `Default` / `OtherWriteDown`.
    - `decodeEvmReverseRepayCall(fn, args)`: `[id, repaymentId, hash]`, both ids decimal strings within `u32`.
    - `decodeEvmPendingCall = decodeEvmSecurityCall ?? decodeEvmLoanRegistryCall ?? decodeEvmReverseRepayCall` (replaces the alias).
    - `recordNumberOf` / `repaymentNumberOf` raw fallbacks also accept a decimal-string id (`evmId`) when `item.calldata !== null`.
    - `usePendingOperationView` uses `riskCouncilChainReason(chainId)`.
13. [x] **Recovery presenter and dialog:**
    - `routes/-useRepaymentRecoveryDialog.ts`:
      - `pendingTarget = riskCouncilTargetId(chainId, "minter")`;
      - `useReverseRepayAccess(chainId, …)`;
      - the step-2 `blockedReason` order becomes: "Reverse the repayment first.", then `stellarOnlyActionReason(chainId)` (Open Question 3; the record mutation is never called on EVM), then the existing checks;
      - `useRecoveryCard.blockedReason = entry ? riskCouncilChainReason(entry.chain_id) : null`.
    - `-repayment-recovery.ts`: `recoveryCardState` keeps the `evmBlocked` input (now true only for an unknown EVM chain id); there is no rename, to keep the diff small.
14. [x] **Lint and comments:** `npx tsx scripts/lint-comments.ts`; shrink `scripts/lint-comments.baseline.json` for any touched file listed there.
15. [x] **Docs** (see Docs to Update), then `npx tsx scripts/lint-docs.ts`.
16. [x] **Verify:**
    - `… workspace @pipeline/wallet-connect test` and `… lint`;
    - `… workspace @pipeline/trustee test`, `… lint` and `… build` (`tsc -b`);
    - `… workspace @pipeline/frontend build` (the barrel changed).
    There is no live EVM run (see Assumptions).

## Test Strategy

Vitest, colocated as the packages do (wallet-connect `*.test.ts`, Trustee `-*.test.ts(x)`). No network, no env-gated tests.

- `packages/wallet-connect/src/evm/contracts/riskCouncil.test.ts` (real viem, no mock):
  - `encodeEvmRiskCouncilCalldata` round-trips with `decodeFunctionData` for all six functions;
  - `amend_economics` `rateBps 1450` encodes `uint32 145000` (pins the shared scale);
  - `close_defaulted` encodes ordinal 4 for `Default` and 5 for `OtherWriteDown`;
  - a negative `delta` encodes as `int256`;
  - hashes are `0x`-prefixed;
  - selectors equal `toFunctionSelector` of the Solidity signatures (`setDefault(uint256)`, `amendEconomics(uint256,uint32,uint64)`, `adjustInterest(uint256,int256,bytes32)`, `writeDown(uint256,uint256)`, `closeDefaulted(uint256,uint8)`, `cure(uint256)`);
  - rejections: rate 0 / 10 001 / non-integer, maturity 0, delta `"0"` / `"1.5"` / out of `int256`, amount `"0"`, bad hash, unknown reason, negative or unsafe id.
  - With `readEvmContract` mocked: `readEvmLoanChainState` maps the ordinals (`status 3` gives `"Default"`, `closureReason 3` gives `"Cancelled"`) and the signed `interestAdjustment`; `readEvmLoanMoney` maps all six fields; an empty or invalid registry throws; `relayEvmRiskCouncil` calls `relayEvm` with the LoanRegistry error ABI.
- `src/evm/contracts/minter.test.ts` (extend):
  - `evmReverseRepayRefHash` is deterministic and `0x` + 64 hex, uses the EIP-55 address (lowercase and checksummed inputs give the same hash), and equals `0x` + `sha256("pipeline:reverse_repay:…")`;
  - the selectors;
  - the `readEvmMinterRepayment` slot equals a hand-computed nested mapping slot, the storage base equals the ERC-7201 formula for `"pipeline.storage.Minter"`, and word 3 low byte `1` gives `carvedOut: true`;
  - `readEvmRecoveryRepayments` (mock `scanEvmLogs` and the reads):
    - maps a `PaymentRecorded` + `CashRepaid` pair into the Stellar row shape;
    - a `PaymentUnrecorded` sets `reversed`;
    - `principal` is `released`;
    - a missing `PaymentRecorded` or `CashRepaid` for an id below `next` throws the "not found on chain" error;
    - logs of another loan are ignored.
- `src/evm/contracts/logs.test.ts` (mock `@wagmi/core` `getPublicClient`):
  - chunk boundaries are inclusive with 50 000 blocks per call, from `fromBlock` to head;
  - topics are passed raw (topic0 OR-array, padded loan id);
  - results stay in block order;
  - the first failing chunk rejects;
  - `fromBlock > head` yields `[]`.
- `packages/trustee/src/lib/-targetChains.test.ts`:
  - replace the #1942 per-function cases with `riskCouncilChainReason`: Stellar `null`, `ENV.EVM_CHAIN_ID` `null`, another EVM id gives the Stellar-only copy;
  - `riskCouncilTargetId` per chain and kind.
- `lib/-accessManagerAction.test.ts`:
  - `evmCouncilErrorCopy` maps `AccessManagerNotReady` for every kind;
  - `EnforcedPause` maps only for `security_registry`;
  - `LoanRegistryWrongCurrentStatus` gives `null`;
  - `evmErrorName` matches `LoanRegistry…` and `Minter…`.
- `api/-useRiskCouncil.test.tsx` (mock the new EVM functions):
  - `useRiskCouncilAccess` on EVM for `set_default` calls `readEvmCanCall` with the LoanRegistry selector and target, and reads `readEvmRiskCouncilSchedule` when delayed with a call;
  - the relay EVM schedule of `amend_economics` records `calldata` and `operationId`, and an EVM execute pre-reads and marks executed;
  - an empty `EVM_LOAN_REGISTRY_ADDRESS` gives the Risk Council not-configured copy;
  - `useRiskCouncilLoanState` EVM reads both views;
  - `usePendingOperationExecute`:
    - a `loan_registry` row on EVM executes with `evmRiskCouncilErrorAbi`;
    - a `minter` row with `evmRecoveryErrorAbi`;
    - the calldata passes unchanged;
  - flip the #1942 "LoanRegistry row on EVM is rejected" case;
  - another EVM chain id stays blocked.
- `api/-useRepaymentRecovery.test.tsx`:
  - replace "stays disabled for an EVM chain" with: EVM reads `readEvmRecoveryRepayments` and computes `latestReversed`;
  - `useReverseRepayAccess` EVM reads both selectors on the Minter and the schedule with the EVM refHash when delayed;
  - the schedule / execute mutations call the EVM relay and mark executed with the chain id;
  - not-configured copy when `EVM_MINTER_ADDRESS` is empty;
  - an unknown EVM chain id stays disabled.
- `routes/-risk-council-pending.test.ts`:
  - `decodeEvmLoanRegistryCall` accepts the reference shapes:
    - `["7"]`;
    - `["7", 145000, "1767225600"]`;
    - `["7", "-5000000", "ab…"]`;
    - `["7", "1000000"]`;
    - `["7", 4]` and `["7", 5]`.
  - It rejects:
    - a numeric id;
    - rate 145001;
    - a numeric maturity;
    - ordinal 3;
    - a `0x` hash.
  - `decodeEvmReverseRepayCall` accepts `["7", "2", "ab…"]`;
  - `fromServed` with `calldata` canonicalises `amendEconomics` to `amend_economics` and decodes it;
  - `pendingArgRows` shows "New rate: 14.50% (1450 bps)" and the write-down amount at 6 dp;
  - `usePendingOperationView` on EVM enables a ready `loan_registry` row for the caller;
  - flip the #1942 "LoanRegistry row is blocked on EVM" case to an unknown chain id.
- `routes/-risk-council-reterm.test.ts` / `-risk-council-writedown.test.ts`: `parseSignedUsdDelta("-1.5", EVM)` gives `"-1500000"` and with Stellar `"-15000000"`; `buildWriteDownCall(…, "$1,000.000001", EVM)` gives `"1000000001"`.
- Page tests (mock `useEvmWallet` and the EVM hooks; fixtures in `-riskCouncilFixtures.ts` with an EVM `pendingOp({ function: "setDefault", calldata, args_xdr: null, args: ["7"] })`):
  - `-risk-council-escalate-page.test.tsx`: an EVM loan shows the chain-state rows from the EVM read, an enabled "Declare default" for `execute-now`, and the EVM `setDefault` row with Execute; the confirm dialog fires before the mutation (flip the "Stellar only" case to an unknown chain id).
  - `-risk-council-reterm-page.test.tsx`: an EVM amend schedules with the right call; the adjust delta uses 6 dp; flip the EVM case.
  - `-risk-council-writedown-page.test.tsx`: the EVM write-down prefill and call amount are 6 dp; close-defaulted Execute is gated on `"0"`; flip the EVM case.
  - `-risk-council.index.test.tsx`: an EVM session renders the intro, the role line, the scheduled table with a decoded EVM `amendEconomics` row and its link, the loan index, and the Inspector panel link; "· this wallet" with a case-different EVM address. Replace "keeps the LoanRegistry hub blocked on an EVM session".
  - `-RepaymentRecoveryDialog.test.tsx`:
    - an EVM loan lists candidates from the EVM hook (6 dp), shows the effects (Pocket unrelease from `released`), and "Reverse repayment" calls the EVM mutation;
    - a `reverseRepay` pending row executes with `calldata`;
    - step 2 shows the Stellar-only reason after the reversal.
  - `-loans.$id.test.tsx`: the EVM recovery card is `eligible`, not `blocked-evm`.
- Existing Stellar suites (hub, escalate, reterm, writedown, recovery, security, inspectors, bridge) stay green unchanged.

## Docs to Update

- `docs/frontend/trustee-flows.md`:
  - **Risk Council actions → Sources:** add `evm/contracts/{riskCouncil,minter,logs}.ts`.
  - **Risk Council actions → `### EVM`:** rewrite.
    - The hub and the three pages are enabled on `ENV.EVM_CHAIN_ID` (#1943) through `riskCouncilChainReason`.
    - Add the EVM function table: `setDefault(uint256)`, `cure(uint256)`, `amendEconomics(uint256,uint32,uint64)` (same bps × 100 scale, `ONE = 1e6`), `adjustInterest(uint256,int256,bytes32)`, `writeDown(uint256,uint256)` (6 dp), `closeDefaulted(uint256,uint8)` (4 / 5). Target `EVM_LOAN_REGISTRY_ADDRESS`, AccessManager `EVM_ACCESS_MANAGER_ADDRESS`.
    - Reads: `mutableLoanData` / `loanMoney` with ordinal mapping.
    - Error copy by name per kind.
    - The Differences table from this plan.
  - **Repayment recovery (#1711):** replace the EVM bullet with the EVM arm:
    - target `EVM_MINTER_ADDRESS`, `canCall` on `reverseRepay` / `repay`;
    - the refHash preimage;
    - candidates from the view and the log scan (`VITE_EVM_START_BLOCK`, 50 000-block chunks), effects from `CashRepaid` and the Minter record via `extsload`;
    - step 2 gated until #1574.
    - Update the card's `blocked-evm` to "an EVM chain other than the configured one".
  - **Risk Council pending operations:**
    - the ownership table targets gain `EVM_LOAN_REGISTRY_ADDRESS` and `EVM_MINTER_ADDRESS`;
    - EVM rows: the LoanRegistry and Minter `args` shapes;
    - drop "LoanRegistry and Minter rows on EVM stay `call: null` … until #1943";
    - the Execute section: the chain gate is `riskCouncilChainReason`, and the error ABI is per `target_kind`.
  - **Not covered:** unchanged.
- `docs/product-specs/loan-repayment-recovery.md` §"Trustee" (line 85): EVM loans run step 1 from the dialog (`reverseRepay` through the AccessManager, `MINTER_OPS_ROLE` on the current scripts); step 2 on EVM waits for #1574.
- `docs/frontend/wallet-flows.md` `#trustee-evm-contract-client`: list `riskCouncil.ts`, `minter.ts` recovery and `logs.ts` (`scanEvmLogs`, 50 000-block chunks) as reusers.
- `docs/exec-plans/tech-debt-tracker.md`:
  - **TD-152:** the Risk Council pages and recovery step 1 run on EVM (#1943). What remains is rollover, Update lifecycle, record coupon / repayment (including recovery step 2) and close loan (#1574), the EVM draw (#1573) and the cash-reporter bookings. Update the "Repayment recovery (#1711)" bullet.
  - **New TD-190:** "EVM repayment recovery reads repayments by scanning logs in the browser".
    - Location: `packages/wallet-connect/src/evm/contracts/{minter,logs}.ts`, `api/useRepaymentRecovery.ts`.
    - Gap: no EVM view for `RepaymentData` / the reversed flag; the Trustee scans `eth_getLogs` from `VITE_EVM_START_BLOCK` in 50 000-block chunks and reads the Minter record via `extsload`.
    - Impact: the cost grows with chain age; it is provider-dependent; it is coupled to the Minter storage layout.
    - Suggested fix: serve per-repayment rows from the indexed logs on an existing per-loan endpoint.
  - Fix the header line: it says "Next free number: TD-189", but TD-189 exists. After adding TD-190, set it to TD-191.
- `.env.example` and `docker/trustee/entrypoint.sh`: `VITE_EVM_START_BLOCK`. The argocd values live in the separate `argocd` repo and wait for the stage EVM config (#1503) and #1944.
- `docs/user-stories/epic-1937/1943-trustee-evm-rc-pages.md` (new). Format of `1942-trustee-evm-security-page.md`: persona Risk Council member on the Trustee console, signed in on the EVM chain. The stories need #1944 and the stage env, and run in QA #1945.
  1. On an EVM session the hub shows the intro, the role line, the scheduled table (EVM rows decoded) and the loan index.
  2. Escalate on an EVM `Performing` loan: chain-state rows from chain; Declare default asks for confirmation, then executes or schedules per role.
  3. Amend economics on EVM: the new rate and maturity schedule; the pending row shows "New rate: … (… bps)".
  4. Adjust interest on EVM with a negative delta (6 dp) and a reason hash.
  5. Default resolution on EVM: write-down prefilled from chain at 6 dp; close-defaulted Execute only at outstanding `0`; cure.
  6. After the ready time, the scheduling wallet executes an EVM LoanRegistry row from the page card with nothing retyped; another wallet sees the other-wallet copy.
  7. A row whose target is another LoanRegistry is disabled with the LoanRegistry copy.
  8. Repayment recovery on an eligible EVM loan lists the repayments (mis-split first), shows the effects, and reverses (immediate or scheduled); after a reload the reversed repayment is preselected.
  9. A scheduled `reverseRepay` row executes from the dialog's Scheduled operations block.
  10. Step 2 on EVM shows the Stellar-only reason until #1574.
  11. A Trustee-only wallet sees every action read-only with the no-role copy (after #1944).
  12. A wallet on the wrong network is asked to switch before signing.
  13. The Stellar stage chain is unchanged.
- `docs/user-stories/index.md`: add the #1943 row under "Epic #1937 — EVM parity".
- No product-spec change for the pages (their behaviour is the Stellar spec, `trustee-dashboard.md` §"Type 3"). The API contracts are #1940 / #1941's.
