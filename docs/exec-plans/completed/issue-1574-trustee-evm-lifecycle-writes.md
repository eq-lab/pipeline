# Issue #1574: Trustee: EVM write paths for rollover / update lifecycle / record payment / close loan (TD-152)

Scope amended 2026-11-19 by the user: the EVM arm of **Disburse** (`PipelineMinter.disburse`) is included. See [Decisions (human, 2026-11-19)](#decisions-human-2026-11-19).

Source: https://github.com/eq-lab/pipeline/issues/1574

Branch `feat/1574-trustee-evm-lifecycle-writes`, draft PR #2055. The parent follow-up is epic #1521 (EVM rollout epic #1494); the issue has no GitHub parent set.

## Scope

Human directive for all EVM work: "everything must be the same as on Stellar, the same approach". Each EVM arm below mirrors its Stellar arm: the same hook structure, guards, stage and error plumbing, idempotency and ref derivation, and UI gating. Every deviation is listed and justified in [Differences from Stellar](#differences-from-stellar).

Issue comments:
- 2026-10-28 scope correction: the EVM record arm signs `PipelineMinter.repay` (`MINT_CALLER_ROLE`), not `LoanRegistry.recordPayment`. It mirrors the Stellar arm from PR #1719:
  - `ref_hash = sha256("pipeline:repay:{registry}:{loanId}:{nextRepaymentId}")`;
  - `value_date` = UTC midnight of the page date;
  - `sale_id = 0`.
- The Minter `0xE75814…` named in that comment is the hoodi-v4 proxy. The current hoodi-v5 Minter, configured on stage, is `0x621BaAb0ced6b11f88019582183b081A118755f4`.
- 2026-11-18: reuse the #1942 write client.
- 2026-11-19: #1573 (PR #2053) and #1503 (PR #2052) are merged, so this issue is unblocked.
- 2026-11-19 (user, via the manager): repay is a direct `PipelineMinter.repay` call, and the EVM Disburse arm is in scope.

### How the Stellar arms route their calls (the shape mirrored here)

| Hook | Stellar binding (`wallet-connect/src/stellar/contracts`) | Routing | Pre-sign reads |
|---|---|---|---|
| `useRollover` | `rollover` (`loanRegistry.ts`) | AccessManager "executor": `execute(registry, "rollover", [u32 id, u32 bps×100, u64 maturity], caller)`, immediate only, no schedule path | none |
| `useUpdateLifecycle` | `updateMutable` | `execute(registry, "update_mutable", [u32, LoanStatus, String], caller)` | `useLoanMutableState` → `readLoanChainState` (status and URI for the dialog) |
| `useCloseLoan` | `closeLoan` | `execute(registry, "close_loan", [u32, ClosureReason], caller)` | none (the page's close checklist is served data) |
| `useRecordPayment` | `repay` (`minter.ts`) | **direct** `Minter.repay(caller, loan_id, RepaymentData, value_date, ref_hash, sale_id)`; the Minter checks `am.can_call(caller, minter, "repay")` itself | `readNextRepaymentId` → `repaymentRefHash`; the pages also gate on `useCashReporterAccess("repay")` (`can_call`) |
| `useDisburse` (#1898) | `disburse` (`minter.ts`) = `relay({ mode: "execute", target: minter, fn: "disburse", … })` | AccessManager "executor": `execute(minter, "disburse", [u32 id, i128 amount, u64 value_date, BytesN<32> ref_hash], caller)`. The Stellar Minter `disburse` is `#[only_owner]`, and its owner is the AM | `disburseView` (`lib/disburse.ts`) runs this chain in order: loan state (`readLoanDisbursementState`), then `deal(loan_id)` (`useDeal`), then the DEBT trustline of the NFT holder (`useDebtTrustline`), then Minter `paused()`, then the wallet, then `can_call(caller, minter, "disburse")` (`useDisburseAccess`); the card also shows `bank_cash` (`useMinterPoolState`). In the hook: `bankReferenceRefHash(reference)`, then `readRefHashSeen` (reused hashes refused), then `fetchMinterPaused` |

The EVM arms keep this split:
- The three registry writes and `disburse` go through `AccessManager.execute(target, calldata)`. This is the executor-execute shape and the human decision of 2026-11-18 for immediate EVM calls, as `drawEvmLoan` does.
- `repay` is a direct `PipelineMinter.repay` call from the wallet, as on Stellar. The user decided this on 2026-11-19; it is the only direct target call.

### Source of truth (checked by the planner on 2026-11-19, worktree base `05d5f695`)

**Contracts** `pipeline-contracts@150631a` (read only, frozen):
- `PipelineLoanRegistry` (all `external restricted`; every internal is `whenNotPaused`):
  - `rollover(uint256 loanId, uint32 newRate, uint64 newMaturityTimestamp)`:
    - requires status `Performing..WatchList` and `currentMaturityTimestamp <= block.timestamp`, otherwise `LoanRegistryNotMatured`;
    - emits `LoanRolledOver(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp)`;
    - the rate uses the `ONE = 1_000_000` scale, so bps × 100, the same as Stellar.
  - `updateMutable(uint256 loanId, LoanStatus newStatus, string metadataURI)`:
    - `Closed` reverts `LoanRegistryAlreadyClosed`;
    - from `Approved` or `Default` only the same status is allowed; otherwise only `Performing` or `WatchList`; anything else reverts `LoanRegistryWrongCurrentStatus(uint8)`;
    - always replaces the URI;
    - emits `StatusUpdated(uint256 indexed loanId, LoanStatus indexed newStatus)` only on a status change.
    - The same rule `allowedLifecycleTargets` already encodes.
  - `closeLoan(uint256 loanId, ClosureReason reason)`:
    - status `Approved..WatchList`;
    - `ScheduledMaturity` or `EarlyRepayment` need outstanding `0`, otherwise `LoanRegistryOutstandingNotZero`;
    - `Cancelled` needs `disbursed == 0`;
    - any other reason reverts `LoanRegistryInvalidClosureReason`;
    - waived accrued interest must not exceed `maxResidual`, otherwise `LoanRegistryResidualExceedsMax`;
    - emits `LoanClosed(uint256 indexed loanId, ClosureReason indexed reason)`.
  - `LoanStatus` = `Approved, Performing, WatchList, Default, Closed` (0–4).
  - `ClosureReason` = `None, ScheduledMaturity, EarlyRepayment, Cancelled, Default, OtherWriteDown` (0–5). The trustee sends 1 or 2. Stellar's enum has no `Cancelled`.
  - Roles (`script/roles/SetupLoanRegistryManager.sol`): `rollover`, `updateMutable` and `closeLoan` are on `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, together with `drawLoan` and the Risk Council functions. `recordPayment` is on `PIPELINE_MINTER_ROLE`, held only by the Minter (`SetupProtocolRoles.sol`).
- `PipelineMinter.repay(uint256 loanId, RepaymentData repaymentData, uint64 valueDate, bytes32 refHash, uint256 saleId) external restricted whenNotPaused returns (uint256 repaymentId)` (`src/minter/MinterUpgradeable.sol:293`):
  - `offtakerReceived < equityDistributed` reverts `MinterInvalidAmount`;
  - `_consumeMintRef`: the zero hash reverts `MinterMissingRef`, a repeated hash reverts `MinterRefHashSeen`;
  - `interest + fees` count against `RateLimiterExceedsTxLimit` / `RateLimiterExceedsWindowLimit`;
  - books `bankCash`, then calls `loanRegistry.recordPayment` (status `Performing..Default`);
  - books or mints the interest, mints and stakes the fees;
  - `_syncDebt` → `DealTokenFactory.syncDebt(loanId)`, which reverts `DealTokenFactoryNotRegistered(uint256)` when no deal is registered;
  - emits `CashRepaid(uint256 indexed loanId, uint256 repaymentId, uint256 saleId, uint256 cash, uint256 interestMinted, uint256 feeShares, uint64 valueDate, bytes32 refHash)`.
  - Role: `MINT_CALLER_ROLE` (`SetupMinterOperators.sol`).
  - `RepaymentData` = `(offtakerReceived, seniorPrincipalRepaid, seniorInterest, equityDistributed, mgmtFee, perfFee, oetAlloc)`, all `uint256`, in this struct order.
- `PipelineMinter.disburse(uint256 loanId, uint256 amount, uint64 valueDate, bytes32 refHash) external restricted whenNotPaused returns (uint256 entryId)` (`src/minter/MinterUpgradeable.sol:254`; the same body in the Hoodi source `f92d719:…:246`). In order:
  - `amount == 0` reverts `MinterInvalidAmount`;
  - `_consumeRef(refHash)`: **the zero hash is accepted and skips the replay check** (Stellar has the same rule, which is why the Stellar encoder rejects zero); a repeated non-zero hash reverts `MinterRefHashSeen`;
  - `_subBankCash(amount)`: reverts `MinterInsufficientBankCash(uint256 amount, uint256 bankCash)` when the booked bank cash is below the amount;
  - `loanRegistry.disburse(loanId, amount)` → `_disburse`: `whenNotPaused`; reverts `LoanRegistryInvalidAmount` on zero; requires status `Approved..WatchList` (else `LoanRegistryWrongCurrentStatus`); reverts `LoanRegistryCarvedOut` and `LoanRegistryDisbursementExceedsTranche(uint256 disbursed, uint256 originalSeniorTranche)`. The first disbursement opens epoch 0 and moves `Approved → Performing`. It emits `Disbursed(uint256 indexed loanId, uint256 amount, uint256 outstanding)`, plus `StatusUpdated(loanId, Performing)` the first time;
  - `_syncDebt` → `DealTokenFactory.syncDebt(loanId)`: reverts `DealTokenFactoryNotRegistered(uint256)` unless `registerDeal` ran; otherwise it mints DEBT to `ownerOf(loanId)` (the capital wallet) and emits `DebtSynced`. The EVM `DealToken` is an ERC-20 that only the factory can mint, burn and move, so **there is no trustline-like precondition** on EVM;
  - emits `CashDisbursed(uint256 indexed loanId, uint256 entryId, uint256 amount, uint64 valueDate, bytes32 refHash)`.
  - Role: `MINTER_OPS_ROLE` (`SetupMinterOperators.sol`, `opsSelectors[2]`). On Stellar it is `TRUSTEE` (through `only_owner`).
- `PipelineDealTokenFactory`:
  - `registerDeal(uint256 loanId) external restricted` is on `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` (`SetupLoanRegistryManager.sol`).
  - `_drawLoan` does **not** register a deal. This answers the open contracts-owner question in #1892: registration is a separate trustee call.
  - `deal(uint256) view returns (Deal { address debt })` reverts `DealTokenFactoryNotRegistered` when there is no deal. The Stellar `deal` also reverts in that case, and `readDeal` maps it to `null`.
- Minter read surface: **Hoodi and the frozen source differ.**
  - The Hoodi Minter (source `f92d719`) exposes the views `bankCash()`, `refHashSeen(bytes32)` and `paused()`, and has **no** `extsload`.
  - At `150631a` (#54) those two views moved to `PipelineMinterReader`, which reads `Minter.extsload` at the ERC-7201 base `0x1cb61fb8…5cc100`: field 8 is `bankCash`, field 20 is the `refHashesSeen` mapping (`keccak256(refHash . (base + 20))`). `paused()` stays on the Minter.
  - #1943's recovery reads are `extsload`-only and therefore revert on Hoodi today (a known caveat in trustee-flows).
- `restricted` (OpenZeppelin `AccessManaged`):
  - a direct call checks `canCall(msg.sender, target, selector)` and reverts `AccessManagedUnauthorized(address)`;
  - through `AccessManager.execute`, the manager checks the caller and reverts `AccessManagerUnauthorizedCall(address,address,bytes4)`.

**Money units:**
- EVM `RepaymentData` and the loan money are PLUSD/USDC base units at **6 dp**; Stellar uses 7 dp. `/waterfall` already serves the chain's decimals (#1603, `chainAmountDecimals`), and the Record pages pass the served fields verbatim, so the browser scales nothing.
- Rates use the 1e6 scale on both chains (bps × 100).

**Hoodi deploy vs source:**
- Hoodi runs older bytecode for some contracts: the SecurityRegistry is pre-#55 (`f92d719`), and the LoanRegistry and Minter come from `3b74e98` (#50).
- `git diff 3b74e98 150631a` shows no change to the LoanRegistry functions used here. The Minter changed (vesting, #54), but the `repay` signature is the same.
- Every write selector below is present in the live implementations (see the Hoodi check). The Minter's `extsload` is not (see the read-surface note above).

**wallet-connect, reused** (#1573/#1942/#1943):
- `evm/contracts/write.ts`:
  - `sendEvmContractCall` returns `{ hash, receipt }`;
  - its stages are `awaiting-signature` (after simulate and gas) and `confirming`;
  - it refuses mock wallets.
- `evm/contracts/accessManager.ts`: `accessManagerAbi`, `readEvmCanCall`, `relayEvm`.
- `evm/contracts/loanRegistry.ts`: `drawEvmLoan`, with the private `isContractRevert` and the "prompted" simulation-error wrap.
- `evm/contracts/riskCouncil.ts`:
  - `evmLoanRegistryErrorAbi`, `requireEvmRegistry`;
  - `readEvmMutableLoanData`, `readEvmLoanChainState` (ordinals → the Stellar status names), `EVM_LOAN_STATUSES`, `EVM_CLOSURE_REASONS`.
- `evm/contracts/minter.ts`:
  - `minterRecoveryAbi` (with `repay`), `encodeEvmRepayCalldata` (validates only `refHash`), `evmRepaySelector()`;
  - `evmMinterErrorAbi`, `readEvmNextRepaymentId`;
  - the private `recoveryEventsAbi` (with `CashRepaid`);
  - `evmReverseRepayRefHash`: the preimage with the EIP-55 address and a `0x` prefix.
- `stellar/contracts/hash.ts`: `sha256Hex`.

**Trustee, reused:**
- `lib/chainWallet.ts`: `pickChainWallet` / `useChainWallet`.
- `lib/targetChains.ts`:
  - `isStellarTarget`, `stellarOnlyActionReason`, `drawChainReason`, `riskCouncilChainReason`;
  - `recordRepaymentChainReason` and `EVM_RECORD_REPAYMENT_PENDING_COPY` (both removed here).
- `lib/env.ts`: `EVM_CHAIN_ID`, `EVM_LOAN_REGISTRY_ADDRESS`, `EVM_MINTER_ADDRESS`, `EVM_ACCESS_MANAGER_ADDRESS`. There is **no** EVM deal-token factory key yet. The Stellar one is `STELLAR_DEAL_TOKEN_FACTORY_ID`; the worker's is `CHAIN_<id>_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` (Hoodi `0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC`).
- Disburse (#1898):
  - `api/useDisburse.ts`: `disburseConfigured`, `useLoanDisbursementState`, `useDebtTrustline`, `useDisburseAccess`, `useDisburse`;
  - `lib/disburse.ts`: `disburseView`, `disburseFormError`, `disburseErrorCopy`, and the copy constants;
  - `routes/-DisburseAction.tsx`: the card, the dialog, the `-DisburseAction` gate `stellarOnlyActionReason`, `useMinterPoolState` / `useMinterPaused` from `api/useConversions.ts`;
  - `api/useDealToken.ts` `useDeal`;
  - wallet-connect `disburse`, `bankReferenceRefHash`, `readRefHashSeen`, `readLoanDisbursementState`, `readLoanOwner`, `readDebtTrustline`.
- `utils/userError.ts` `toUserError`:
  - `/simulation error/` gives "Could not verify this action on-chain. No signature was requested — safe to retry.";
  - "wallet not connected" gives "Connect your trustee wallet to approve on-chain."

### Hoodi selector and role check (2026-11-19, read only, nothing submitted)

Method:
- RPC `https://ethereum-hoodi-rpc.publicnode.com`, head ≈ 4 045 580.
- The implementation was read from the EIP-1967 slot. It matches `deployments/hoodi-v5.json`: LoanRegistry impl `0x5996682A3EE1daeC8E45b0a847A52E38bCE6bfCE`, Minter impl `0x0DaC8ed8dB6C910807435e69c2162B74Cc374eBf`.
- `cast code` of the implementation, then a grep for `PUSH4 <selector>` (`63xxxxxxxx`).
- Roles come from `AccessManager.getTargetFunctionRole` and `canCall`.
- Behaviour comes from `eth_call` (`cast call --from`).

| Function | Selector | In live bytecode | Role on Hoodi (`getTargetFunctionRole`) | `eth_call` from the trustee wallet `0x96ef761f…c04e4` |
|---|---|---|---|---|
| `PipelineLoanRegistry.rollover(uint256,uint32,uint64)` | `0x0971a074` | yes | `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` (6011017323988244727) | `AM.execute(registry, …)` reverts `LoanRegistryNonExistentLoanId()` (`0xab6bb082`): it passes the AccessManager and reaches the registry |
| `PipelineLoanRegistry.updateMutable(uint256,uint8,string)` | `0x206293ef` | yes | `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` | same: `0xab6bb082` |
| `PipelineLoanRegistry.closeLoan(uint256,uint8)` | `0xd0cdfd5a` | yes | `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` | same: `0xab6bb082` |
| `PipelineMinter.repay(uint256,(uint256×7),uint64,bytes32,uint256)` | `0x87d2050a` (pinned in `minter.test.ts`) | yes | `MINT_CALLER_ROLE` (6238967916710598249) | direct call: `0xab6bb082` (passes `restricted`, the ref and the limits, then reaches `recordPayment`); through `AM.execute`: `0xab6bb082`; direct call from `0xd3b9…a57c` (no `MINT_CALLER_ROLE`): `AccessManagedUnauthorized` (`0x068ca9d8`) |
| `PipelineLoanRegistry.mutableLoanData(uint256)` (read) | `0xd59000e4` | yes | view | `mutableLoanData(0)` reverts `0xab6bb082` |
| `AccessManager.execute(address,bytes)` / `canCall(address,address,bytes4)` | `0x1cff79cd` / `0xb7009613` | yes | — | `AM.execute(rollover)` from `0xfe17…ce40` (no LRM role) reverts `AccessManagerUnauthorizedCall` (`0x81c6f24b`) |
| `paused()` (registry, Minter) | `0x5c975abb` | yes | — | both `false`; neither target is closed |
| `PipelineMinter.disburse(uint256,uint256,uint64,bytes32)` | `0x1d492b02` | yes | `MINTER_OPS_ROLE` (8590218516126907495) | `AM.execute(minter, disburse(0, 1_000_000, …, ref))` reverts `MinterInsufficientBankCash(1000000, 0)` (`0x3d19b6a7`): it passes the AccessManager and fails at the bank-cash check because Hoodi `bankCash() = 0`; `amount = 0` reverts `MinterInvalidAmount` (`0x118f9b3d`); the same call direct from the wallet also gives `0x3d19b6a7`; from `0xd3b9…a57c` (no `MINTER_OPS_ROLE`) `AccessManagerUnauthorizedCall` (`0x81c6f24b`) |
| `PipelineMinter.bankCash()` / `refHashSeen(bytes32)` (legacy views) | `0xdeea79f0` / `0x968fe75f` | yes | view | `bankCash() = 0`; `refHashSeen(sha256("WIRE-REF-1")) = false` |
| `PipelineMinter.extsload(bytes32)` (the `150631a` read path) | `0x1e2eaeaf` | **no** | view | reverts with empty data |
| `PipelineLoanRegistry.immutableLoanData(uint256)` / `ownerOf(uint256)` / `disburse(uint256,uint256)` | `0xe070e9b7` / `0x6352211e` / `0x2a761bec` | yes | views / `PIPELINE_MINTER_ROLE` | — |
| `PipelineDealTokenFactory.deal(uint256)` / `registerDeal(uint256)` / `syncDebt(uint256)` (impl `0x11995b4e…1b508`, proxy `0xCf54e4d3…eCDC`) | `0xc959c42b` / `0x19da0d36` / `0x8972e08b` | yes | view / `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` / open | `deal(0)` reverts `DealTokenFactoryNotRegistered(0)` (`0x5c1940b0`) |

Role holders (from `RoleGranted` from block 3 700 000, then confirmed with `canCall`; all delays 0):
- `0x96ef761fee97d6e09821517554f2316b8cbc04e4` holds `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, `MINT_CALLER_ROLE` and `MINTER_OPS_ROLE` (`canCall(disburse) = (true, 0)`). It can run every action here, including `registerDeal` if #1892 ships.
- `0xd3b978148e1ee61b528354f72b39451c46dca57c` holds `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` only. It can run the lifecycle actions. The Record pages show "Only the Cash reporter can book repayments." and the Disbursement card "Only the Trustee role can disburse a loan."
- `0xfe1748f5…ce40` (the deployer) holds `MINT_CALLER_ROLE` and `MINTER_OPS_ROLE`, but not the LoanRegistry role.

**The Hoodi registry has no loans** (`nextLoanId = 0`). No end-to-end positive simulation is possible yet. Routing, roles and selector dispatch are confirmed by the bubbled `NonExistentLoanId`.

### In scope

1. **wallet-connect.**
   - EVM LoanRegistry lifecycle bindings in `evm/contracts/loanRegistry.ts`: `rollover`, `updateMutable` and `closeLoan` through `AccessManager.execute`.
   - An EVM `repay` binding in `evm/contracts/minter.ts`, with `evmRepaymentRefHash` and a repayment id read from the receipt's `CashRepaid` log.
   - An EVM `disburse` binding (`AccessManager.execute(minter, disburse calldata)`) and the Disburse reads:
     - Minter `paused()`, bank cash and `refHashSeen`, through the legacy view with an `extsload` fallback;
     - the loan's disbursement state;
     - `DealTokenFactory.deal`.
   - A shared simulation-error wrap, extracted from `drawEvmLoan`.
2. **Trustee.**
   - EVM arms of `useRollover`, `useUpdateLifecycle` (and `useLoanMutableState`), `useRecordPayment` and `useCloseLoan`, picked by the loan's `chain_id`.
   - An EVM arm of `useCashReporterAccess("repay")`.
   - An EVM arm of Disburse (#1898): `useDisburse`, `useLoanDisbursementState`, `useDisburseAccess`, an EVM deal read, EVM bank-cash and paused reads, `disburseView` without the Stellar trustline step, a decimals-aware form and EVM error copy in `lib/disburse.ts`, and `-DisburseAction.tsx`.
   - A new env key, `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS`.
   - One chain gate, `loanActionChainReason`, replaces `stellarOnlyActionReason` / `recordRepaymentChainReason` for these four actions and Disburse.
   - Lift the gates listed below. Recovery step 2 is included.
3. **Docs:** trustee-flows "Wired actions" and the related sections, TD-152, the specs that say these actions are Stellar-only, wallet-flows, and a user story.

### Stellar-only gates in the Trustee app

**Lifted by this issue** (open on Stellar and `ENV.EVM_CHAIN_ID`; any other chain keeps today's `stellarOnlyActionReason` copy):

| # | Gate | File |
|---|---|---|
| L1 | `onChainBlockedReason` (actions card `ON_CHAIN_ACTIONS`: Update lifecycle, Roll over, Record coupon, Close loan; Matured rollover card; `onOtherAction` no-op) | `routes/-useLoanDetail.ts:568`, consumed by `routes/loans.$id.tsx` |
| L2 | Record Coupon `onChainBlockedReason` (nulls `recordPaymentInput`, disables the role read) | `routes/-record-coupon.ts:281-290,458-463` |
| L3 | Record Repayment `onChainBlockedReason` (nulls `recordPaymentInput` and `closureReason`, disables the role read) | `routes/-record-repayment.ts:289-298,466-481` |
| L4 | `useLoanMutableState` `enabled` (`stellarOnlyActionReason`; the Stellar-only read) | `api/useUpdateLifecycle.ts:35` |
| L5 | Recovery step 2 `recordRepaymentChainReason` ("Recording the corrected repayment on EVM is not available yet…") | `routes/-useRepaymentRecoveryDialog.ts:167-170`; helper and copy in `lib/targetChains.ts:45-55` (deleted) |
| L6 | `useCashReporterAccess` is Stellar-only (`can_call` on the Stellar AM and Minter), so the Record pages had no EVM role read | `api/useCashReporterAccess.ts` |
| L7 | Disburse: `disburseView` step 1 (`stellarOnlyActionReason`), `useLoanDisbursementState` / `useDisburse` (`stellarOnlyActionReason`), `-DisburseAction.tsx` (`stellar` flag gating the pool, paused and access reads), and `useDisburseAccess` / `disburseConfigured` (Stellar only) | `lib/disburse.ts:80`, `api/useDisburse.ts:54-60,83,123-138,164`, `routes/-DisburseAction.tsx:81-84` |

**Kept** (out of scope; recorded in TD-152):

| # | Gate | Why |
|---|---|---|
| K1 | Register debt token (`lib/dealToken.ts`, `useDeal` / `useRegisterDeal*` in `api/useDealToken.ts`, `RegisterDebtTokenAction`) and the loan-detail "Debt token" row | #1892 (EVM `registerDeal`). Disburse reads the EVM deal through its own `useEvmDeal`, so `useDeal` and the debt row are unchanged |
| K3 | Mint PLUSD (`record_wire_in`, `-useLpBankDeposits.ts`) | #1501 |
| K4 | Bank income (`record_income`, `-cash-management-income.ts`) | TD-152 cash-reporter bookings |
| K5 | Escrowed wires, wire-outs, conversions (`unsupportedReason` in `-escrowed-wires.ts`, `-wire-outs.ts`, `-conversions.ts`) | EVM cash management, not loan lifecycle |
| K6 | `drawChainReason`, `riskCouncilChainReason` | Already open on `ENV.EVM_CHAIN_ID`; unchanged |

### Out of scope

- EVM `registerDeal` and the EVM "Debt token" row (#1892).
- Booking EVM bank cash (`recordWireIn`, #1501): Disburse only reads it.
- Moving `extsload` reads elsewhere, for example fixing #1943's recovery reads on the Hoodi Minter.
- Any contract change (frozen), and any API, indexer or worker change: the EVM `CashRepaid` / `PaymentRecorded` / `LoanRolledOver` / `LoanClosed` / `StatusUpdated` rows are already indexed and served (`parsers.rs:532`, `audit_log.rs:708`).
- A `canCall` pre-read for the three lifecycle writes. Stellar has none either; a missing role fails at simulate.
- A `paused()` pre-read for the lifecycle and repay hooks. Stellar has none for those either. Disburse keeps its Stellar pre-reads, `paused()` included.
- Scheduling a lifecycle write: Stellar has no schedule path, and every Hoodi delay is 0.

## Decisions (planner; mirror Stellar)

1. **One chain gate.** Add `loanActionChainReason(chainId)` to `lib/targetChains.ts`:
   - It returns `null` for Stellar (and a missing id) and for `ENV.EVM_CHAIN_ID`.
   - For any other chain it returns `stellarOnlyActionReason(chainId)` (copy verbatim), as `drawChainReason` and `riskCouncilChainReason` do for unknown chains (#1573 Decision 6, #1943).
   - Delete `recordRepaymentChainReason` and `EVM_RECORD_REPAYMENT_PENDING_COPY`.
   - `stellarOnlyActionReason` stays for K1.
2. **Hook API, as in `useDrawLoan` (#1573 Decision 7).** Each mutation input gains `chainId: number | null | undefined`. The hook reads `useStellarWallet()` and `useEvmWallet()` and calls `pickChainWallet(chainId, stellar, evm)`.
   - The Stellar arm is byte-for-byte unchanged. `chainId` `undefined` (legacy rows) stays on the Stellar arm.
   - EVM-arm guards run in this order, before any RPC call:
     1. `loanActionChainReason(chainId)`, thrown;
     2. the config check, with the hook's existing "not configured for this environment" copy unchanged;
     3. wallet not connected: "EVM wallet not connected.".
   - The signing chain is `ENV.EVM_CHAIN_ID`. The return shape, invalidation keys and the 5 s / 15 s re-invalidation timings are unchanged.
3. **Lifecycle calls** go through `AccessManager.execute(registry, calldata)` with `value: 0n`, through `sendEvmContractCall`.
   - The ABI is `[...accessManagerAbi, ...evmLoanRegistryErrorAbi]`, so `AccessManager*`, `LoanRegistry*` and `EnforcedPause` decode by name in the details.
   - This is the executor shape, and #1573 does the same for `drawLoan`.
4. **Record payment** is a direct `PipelineMinter.repay(...)` call from the wallet, the mirror of Stellar's direct `Minter.repay`. The user decided this on 2026-11-19.
   - The order is the same as the Stellar hook:
     1. `readEvmNextRepaymentId({ registry, loanId })`;
     2. `evmRepaymentRefHash({ registry, loanId, nextRepaymentId })`;
     3. `repayEvmLoan({ minter, caller, chainId, loanId, repayment, valueDate, refHash, saleId: 0 })`.
   - `refHash` = `0x` + `sha256("pipeline:repay:{EIP-55 registry}:{loanId}:{nextRepaymentId}")`. It is the Stellar preimage with the checksummed address, the same convention as `evmReverseRepayRefHash` (#1943).
   - The repayment id comes from the receipt's `CashRepaid` log emitted by the configured Minter (case-insensitive). `uint256` becomes `number` when safe, else `null`. The repay return value is not readable from a receipt.
   - The ABI is `minterRecoveryAbi`'s `repay` item plus a new `evmRepayErrorAbi`:
     - `evmMinterErrorAbi`, `evmLoanRegistryErrorAbi` (it carries `EnforcedPause`);
     - `RateLimiterExceedsTxLimit()`, `RateLimiterExceedsWindowLimit()`;
     - `DealTokenFactoryNotRegistered(uint256)`;
     - `AccessManagedUnauthorized(address)`, the direct-call role revert.
5. **Simulate before sign; no signature on a failed simulate.**
   - Extract `drawEvmLoan`'s `prompted` tracking and `isContractRevert` into `sendEvmContractCallChecked(label, params)` in `write.ts`.
   - A contract revert thrown before `awaiting-signature` is rethrown as `Error(\`${label}: simulation error: ${message}\`)`. Everything else passes through unchanged (wallet rejection, switch-chain rejection, RPC errors, a receipt revert after the prompt).
   - `drawEvmLoan` keeps its exact message (`drawEvmLoan: simulation error: …`).
   - Labels: `rolloverEvmLoan`, `updateEvmMutable`, `closeEvmLoan`, `repayEvmLoan`, `disburseEvmLoan`.
   - The Stellar `"<fn> simulation error: …"` and these EVM messages both map to the same `toUserError` copy.
6. **Encoders validate before any RPC call.** The Stellar `encodeRepayArgs` rules plus the EVM precedent (`encodeEvmRiskCouncilCalldata`):
   - ids are safe non-negative integers;
   - `newRateBps` is an integer from 1 to 10 000; `newMaturity` is a safe integer above 0;
   - `status` is in `EVM_LOAN_STATUSES`; `reason` is in `EVM_CLOSURE_REASONS` and not `None`;
   - `metadataUri` is a string, sent verbatim (an empty string is allowed, as on Stellar; the dialog guards blanking);
   - `valueDate` is a positive safe integer; `saleId` is a safe non-negative integer;
   - the `RepaymentData` fields are digit strings within `uint256`;
   - `refHash` is `0x` plus 64 hex and not zero.
   - Messages read `<encoder>: invalid <field> <value>`.
7. **Role pre-read on the Record pages**, as on Stellar.
   - `useCashReporterAccess(fn, enabled, chainId?)`: on `!isStellarTarget(chainId)` it reads `readEvmCanCall({ accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS, caller: evmAddress, target: ENV.EVM_MINTER_ADDRESS, selector })`.
   - The selector comes from `EVM_CASH_REPORTER_SELECTORS: Partial<Record<CashReporterFn, () => Hex>>` = `{ repay: evmRepaySelector }`. A function with no EVM selector keeps `configured = false`; its callers already pass `enabled = false` on EVM.
   - Same `cashReporterReason` copy. Same query key `["cash-reporter-access", address, fn]`: the address already differs per chain.
   - Recovery step 2 already reads `canRepay` on EVM (`useReverseRepayAccess`) and is unchanged.
8. **Update-lifecycle read.** `useLoanMutableState`:
   - EVM arm: `readEvmLoanChainState({ registry: ENV.EVM_LOAN_REGISTRY_ADDRESS, loanId })`, which maps to the same `{ status, metadataUri }`;
   - `enabled` uses `loanActionChainReason(chainId) === null` and the chain's registry being configured;
   - same key `["loan-mutable", chainId, loanId]`.
9. **Disburse (user decision 2026-11-19), mirroring #1898.**
   - **Routing:** Stellar reaches `disburse` through the executor (`relay` execute; the Minter is `only_owner`). The EVM arm is `AccessManager.execute(minter, disburseCalldata)` with `value 0n`, through `sendEvmContractCallChecked("disburseEvmLoan", …)`. The ABI is `[...accessManagerAbi, ...evmDisburseErrorAbi]`, where `evmDisburseErrorAbi` = `evmMinterErrorAbi` + `evmLoanRegistryErrorAbi` (it carries `EnforcedPause`) + `DealTokenFactoryNotRegistered(uint256)`.
   - **Encoder:** `encodeEvmDisburseCalldata({ loanId, amountRaw, valueDate, refHash })` applies the Stellar `encodeDisburseArgs` rules:
     - a safe non-negative id;
     - `amountRaw` a positive digit string within `uint256`;
     - `valueDate` a positive integer;
     - `refHash` `0x` plus 64 hex and **not zero**. The contract would silently skip the replay check for zero, the same reason as on Stellar.
   - **`ref_hash`:** `0x` + `bankReferenceRefHash(reference)`, so `sha256(reference.trim())` with the same preimage as Stellar and the backend's wire `reference_hash`. Only the `0x` prefix is added.
   - **Pre-flight order (`disburseView`), unchanged except step 5:**
     1. `loanActionChainReason`;
     2. configured: `EVM_MINTER_ADDRESS`, `EVM_ACCESS_MANAGER_ADDRESS`, `EVM_LOAN_REGISTRY_ADDRESS` and the new `EVM_DEAL_TOKEN_FACTORY_ADDRESS`, the four Stellar ids' counterparts;
     3. loan read. EVM `readEvmLoanDisbursementState` = `mutableLoanData` (status ordinal → name, `carvedOut`, `disbursed`) + `immutableLoanData.originalSeniorTranche`. Same visibility rule (`Approved` / `Performing` / `WatchList`, not carved out, `disbursed < tranche`);
     4. deal. EVM `readEvmDeal({ factory, loanId })` calls `deal(loanId)` and returns `{ debt }`, or `null` on a `DealTokenFactoryNotRegistered` revert. `null` gives the Stellar copy "Register this loan's debt token first.";
     5. DEBT trustline: **skipped on EVM**. `DisburseViewInput.trustline` becomes `DisburseQuery<DebtTrustlineRead> | null`, and `null` (EVM) means not applicable. There is no trustline on an ERC-20 the factory mints;
     6. Minter `paused()`: `readEvmMinterPaused` (the `paused()` view, on both Hoodi and `150631a`);
     7. wallet, then `canCall(wallet, minter, evmDisburseSelector())` (`readEvmCanCall`, `MINTER_OPS_ROLE`) with the same `immediate` / `delay > 0` / no-role copy ("Trustee role" wording unchanged, as #1943 kept the copy for `MINTER_OPS_ROLE`).
   - **Hook pre-sign checks**, the same order as Stellar:
     - `readEvmRefHashSeen` true gives `REUSED_DISBURSE_REFERENCE`;
     - `readEvmMinterPaused` true gives `MINTER_PAUSED`;
     - then `disburseEvmLoan`.
   - **Minter bank cash / ref-seen reads (Hoodi vs source):**
     - `readEvmMinterBankCash` and `readEvmRefHashSeen` call the legacy view first (`bankCash()`, `refHashSeen(bytes32)`; present on Hoodi).
     - When that call reverts with empty data (the function does not exist, as on a `150631a` Minter), they fall back to `extsload` (`MINTER_STORAGE_SLOT + 8`; `keccak256(abi.encode(refHash, MINTER_STORAGE_SLOT + 20))`), which is the `PipelineMinterReader` layout.
     - Any other error propagates.
     - This keeps the arm working on today's Hoodi Minter and on the frozen source. It is a planner decision: the alternative, `extsload`-only as in #1943, would leave EVM Disburse permanently blocked on Hoodi.
   - **Units:** Stellar parses and formats at 7 dp (`parseUsdDollarsToI128`, `rawToDecimal7`). The card, dialog and form switch to `chainAmountDecimals(chainId)`:
     - parse with `usdInputToSacBaseUnits(input, decimals)`;
     - format with `sacBaseUnitsToUsdDecimal(raw, decimals)`;
     - the form error reads "Enter the amount disbursed (up to {decimals} decimals).";
     - the bank-cash comparison stays a plain base-unit `BigInt` comparison.
     - The Stellar output stays byte-identical (7 dp).
   - **Error copy (`disburseErrorCopy`)** keeps the Soroban code branches. Name branches cover EVM, matched in the details because the EVM simulate wrap produces "simulation error":
     - `EnforcedPause` gives `MINTER_PAUSED` (already matched);
     - `MinterRefHashSeen` gives the reused-reference copy (already matched by `/RefHashSeen/`);
     - `MinterInsufficientBankCash` gives the bank-cash copy (code 8);
     - `MinterInvalidAmount` / `LoanRegistryInvalidAmount` give the amount copy (6 / 25);
     - `LoanRegistryDisbursementExceedsTranche` gives the tranche copy (13), with the on-chain values;
     - `LoanRegistryWrongCurrentStatus` / `LoanRegistryNonExistentLoanId` give the status copy (3 / 2);
     - `LoanRegistryCarvedOut` gives the carved-out copy (21);
     - `DealTokenFactoryNotRegistered` gives `DEBT_NOT_REGISTERED`.
   - **Card reads in `-DisburseAction.tsx`:**
     - `useStellarWallet()` becomes `useChainWallet(chainId)`;
     - `stellar` becomes `kind === "stellar"`;
     - `bankCash` = Stellar `useMinterPoolState(...).data?.bankCash`, or EVM `useEvmMinterBankCash(...)`;
     - `paused` = Stellar `useMinterPaused`, or EVM `useEvmMinterPaused`;
     - `deal` = Stellar `useDeal`, or EVM `useEvmDeal`;
     - `trustline` = Stellar `useDebtTrustline`, or `null` on EVM.
   - **Keys:**
     - `["evm-minter-bank-cash", minter]` (`refetchInterval` 30 s, as the pool state);
     - `["evm-minter-paused", minter]` (`staleTime` 30 s);
     - `useEvmDeal` reuses `["deal-token", chainId, loanId]`;
     - `INVALIDATED_KEYS` gains the two EVM keys, and the existing invalidations stay.
   - **Result:** `{ hash }` with the existing success line ("The loan book updates once indexed").

## Differences from Stellar

Identical on both chains:
- every page, dialog, card, test id and copy string; the button labels and their stage-label functions;
- the hook names, return shapes and the "not configured" / "wallet not connected" guard copy as mapped by `toUserError`;
- query keys, invalidations and the 5 s / 15 s re-invalidation;
- the close checklist and `closureReason`, the Record action gating (#1622), the principal-block rule, `value_date` from `dateInputToValueDate` (UTC midnight of the page date), `sale_id = 0`;
- the `ref_hash` preimage shape and its idempotency per repayment slot;
- the `allowedLifecycleTargets` rule;
- the recovery dialog structure (step 2 uses `originalValueDate` from the indexed `CashRepaid`, which the EVM indexer emits with `value_date`);
- Disburse: the card, dialog, test ids, copy, the pre-flight order (minus the trustline step), the form rules (value date not in the future, reference 1–140 chars, amount ≤ booked bank cash), `ref_hash = sha256(reference.trim())`, the reused-reference and paused refusals before the signature, invalidations and the success line.

| # | Area | Stellar | EVM (#1574) | Reason |
|---|---|---|---|---|
| 1 | Chain gate | none (Stellar always open) | `loanActionChainReason`: open on `ENV.EVM_CHAIN_ID`; another non-Stellar id keeps the `stellarOnlyActionReason` copy | One EVM chain per deployment (as `drawChainReason` / `riskCouncilChainReason`) |
| 2 | Lifecycle call | `executor.execute(registry, "rollover" \| "update_mutable" \| "close_loan", args, caller)` | `AccessManager.execute(registry, calldata)`, `value 0`, caller = `msg.sender` | OpenZeppelin AM takes full calldata; same AM-execute shape (decision 2026-11-18, #1573) |
| 3 | Repay call | direct `Minter.repay(caller, …)`; the Minter checks `can_call(caller)` | direct `PipelineMinter.repay(…)`; `restricted` checks `canCall(msg.sender)`; no `caller` arg | Solidity `restricted` uses `msg.sender`; direct as on Stellar (user decision 2026-11-19) |
| 4 | Rollover args | `[u32 id, u32 bps×100, u64 maturity]` | `(uint256, uint32 bps×100, uint64)` | ABI types; same 1e6 rate scale |
| 5 | Update-mutable args | `[u32, LoanStatus scvVec([symbol]), String]` | `(uint256, uint8 ordinal of EVM_LOAN_STATUSES, string)` | Solidity enum = `uint8` |
| 6 | Close-loan args | `[u32, ClosureReason scvVec([symbol])]` | `(uint256, uint8)`; `ScheduledMaturity` 1, `EarlyRepayment` 2 (EVM enum has `Cancelled` at 3) | Solidity enum ordinals |
| 7 | Repay args | `[Address caller, u32, RepaymentData map (sorted keys, u128), u64, BytesN<32>, u32 sale_id]` | `(uint256, tuple in struct order 7×uint256, uint64, bytes32, uint256 saleId)` | ABI types; `saleId` is `uint256` on EVM |
| 8 | Money units | `RepaymentData` 7-dp base units | 6-dp base units; both served by `/waterfall` at `chainAmountDecimals`, never scaled in the browser | PLUSD/USDC decimals |
| 9 | Input validation | only `encodeRepayArgs` validates (valueDate, loanId, saleId, zero hash) | the same repay rules plus `uint256` bounds; lifecycle encoders validate id, `rateBps` 1–10 000, maturity > 0, enum names (as `encodeEvmRiskCouncilCalldata`) | viem throws opaque errors on bad ints; this follows the EVM precedent and keeps a readable message |
| 10 | Simulate-failure message | `"<fn> simulation error: <Soroban error>"` from the envelope builder | a revert before `awaiting-signature` is rethrown as `"<fnEvm>: simulation error: <viem message with the decoded name>"` | Different client; the same user copy |
| 11 | Stages / button label | `awaiting-signature` during simulate, then `submitting`, `confirming` | no stage during simulate (default label "Recording…" / "Closing…" / pending), then `awaiting-signature`, `confirming`; no `submitting` | `sendEvmContractCall` (#1942): the EVM wallet signs and broadcasts in one call |
| 12 | Signing | Stellar wallet `signTransaction`, tx source = caller | EVM wallet; wrong network → `switchChain(ENV.EVM_CHAIN_ID)` first; mock wallets refused | Wallet model |
| 13 | Next repayment id | Soroban simulate `mutable_loan_data(u32).next_repayment_id` | `readEvmNextRepaymentId` (`mutableLoanData(uint256).nextRepaymentId`) | View API |
| 14 | `ref_hash` | `sha256("pipeline:repay:{registryId}:{loanId}:{next}")`, 64 lowercase hex | `0x` + `sha256("pipeline:repay:{EIP-55 registry}:{loanId}:{next}")` | `bytes32` literal; EIP-55 per the `evmReverseRepayRefHash` precedent |
| 15 | Repayment id result | return value, then the `cash_repaid` event | `CashRepaid` log of the configured Minter in the receipt; `uint256` → `number` if safe, else `null` | A tx receipt carries no return value |
| 16 | Record-page role read | `can_call(wallet, minter, "repay")` on the Stellar AM (`CASH_REPORTER`) | `canCall(wallet, minter, 0x87d2050a)` on the EVM AM (`MINT_CALLER_ROLE`) | Role model; same copy |
| 17 | Lifecycle role | `TRUSTEE`, immediate | `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, delay 0 on Hoodi; no pre-read on either chain | Deployment role model |
| 18 | Pause | Stellar `repay` has no pause check | `repay` and the three registry functions are `whenNotPaused`; `EnforcedPause` shows in the details under the generic simulate copy | Contract; no pre-read, as on Stellar |
| 19 | Update-lifecycle chain read | `readLoanChainState` (Soroban `mutable_loan_data`, enum tags) | `readEvmLoanChainState` (`mutableLoanData`, ordinals mapped to the same names) | View API |
| 20 | Error decoding | Soroban codes, no code-specific copy | custom-error names in the details (`AccessManager*`, `LoanRegistry*`, `Minter*`, `RateLimiter*`, `DealTokenFactoryNotRegistered`, `AccessManagedUnauthorized`, `EnforcedPause`); no name-specific copy | Keeps Stellar's "generic copy, details carry the cause" |
| 21 | Config | `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `VITE_STELLAR_LOAN_REGISTRY_ID`, `VITE_STELLAR_YIELD_MINTER_ID` | `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS`, `VITE_EVM_MINTER_ADDRESS` (the AM also for the repay role read) | Separate contracts |
| 22 | Wallet guard (raw) | "Stellar wallet not connected." | "EVM wallet not connected." (both map to "Connect your trustee wallet to approve on-chain.") | Wallet kind |
| 23 | Disburse call | `AM.execute(minter, "disburse", [u32 id, i128 amount, u64 value_date, BytesN<32> ref_hash], caller)` (`relay`); the Minter is `only_owner` | `AccessManager.execute(minter, disburse(uint256,uint256,uint64,bytes32))`, `value 0` | ABI vs Soroban; same executor shape |
| 24 | Disburse role | `TRUSTEE` via `can_call(caller, minter, "disburse")` | `MINTER_OPS_ROLE` via `canCall(wallet, minter, 0x1d492b02)`; the copy still says "Trustee role" | Deployment role model; the UI follows `canCall` (as #1943 did for `reverseRepay`) |
| 25 | Disburse `ref_hash` | `sha256(reference.trim())`, 64 hex; the encoder rejects zero | `0x` + the same digest; the encoder rejects zero | `bytes32` literal; the contract skips the replay check for zero on both chains |
| 26 | Disburse amount units | parse and format at 7 dp (`parseUsdDollarsToI128`, `rawToDecimal7`); "up to 7 decimals" | 6 dp via `chainAmountDecimals` (`usdInputToSacBaseUnits` / `sacBaseUnitsToUsdDecimal`); "up to 6 decimals" | PLUSD/USDC decimals |
| 27 | Disburse loan read | Soroban `mutable_loan_data` + `immutable_loan_data` (enum tag) | `mutableLoanData` + `immutableLoanData` (ordinal → name) | View API |
| 28 | Deal read | `readDeal` (factory `deal`, `NotRegistered` → `null`); `useDeal` | `readEvmDeal` (`deal(uint256)`, `DealTokenFactoryNotRegistered` → `null`); a separate `useEvmDeal` used only by Disburse | View API; `useDeal` stays Stellar-only for #1892's debt row |
| 29 | DEBT trustline step | `owner_of` + SAC `authorized(holder)`; missing gives the trustline reason | skipped (`trustline: null`) | An ERC-20 `DealToken` mint has no trustline; `syncDebt` mints to `ownerOf` unconditionally |
| 30 | Bank cash / ref-seen reads | `readMinterPoolState` (`bank_cash`) / `readRefHashSeen` | `readEvmMinterBankCash` / `readEvmRefHashSeen`: legacy views (`bankCash()`, `refHashSeen`) on the Hoodi Minter, `extsload` fallback (`PipelineMinterReader` layout, fields 8 and 20) on a `150631a` Minter | The deployed Minter and the frozen source expose different read surfaces |
| 31 | Paused read | `readMinterPaused` | `paused()` view on the Minter | View API |
| 32 | Disburse errors | Soroban codes (`1000`, `7`, `8`, `6`/`25`, `13`, `3`/`2`, `21`) | the same copy keyed by custom-error name (`EnforcedPause`, `MinterRefHashSeen`, `MinterInsufficientBankCash`, `MinterInvalidAmount`/`LoanRegistryInvalidAmount`, `LoanRegistryDisbursementExceedsTranche`, `LoanRegistryWrongCurrentStatus`/`LoanRegistryNonExistentLoanId`, `LoanRegistryCarvedOut`), plus `DealTokenFactoryNotRegistered` → "Register this loan's debt token first." | Name-decoded EVM reverts; Stellar checks the deal before signing, so it has no code for that case |
| 33 | Disburse config | `VITE_STELLAR_YIELD_MINTER_ID`, `…_LOAN_REGISTRY_EXECUTOR_ID`, `…_LOAN_REGISTRY_ID`, `…_DEAL_TOKEN_FACTORY_ID` | `VITE_EVM_MINTER_ADDRESS`, `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS`, **new** `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` (Hoodi `0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC`) | Separate contracts |

## Assumptions and Risks

- **No end-to-end positive path on Hoodi yet.** The registry holds no loans (`nextLoanId = 0`). For an EVM loan drawn from the Trustee (#1573), the on-chain preconditions are:
  - **Disburse** needs, in contract order:
    1. `amount > 0`;
    2. an unused non-zero `ref_hash`;
    3. **booked bank cash ≥ amount**. Hoodi `bankCash() = 0` today. EVM bank cash rises through `recordWireIn` (the backend relayer, or #1501 in the Trustee), and the Trustee cannot book it on EVM in this issue;
    4. the loan `Approved..WatchList`, not carved out, within the senior tranche;
    5. **a registered deal**: `_syncDebt` reverts `DealTokenFactoryNotRegistered` otherwise. `registerDeal` is #1892 and stays gated (K1), so the Trustee cannot satisfy this on EVM yet.
  - **How the UI surfaces these.** The card pre-flight stops at the first unmet read:
    - no deal: "Register this loan's debt token first." The Register debt token block on the same page shows its Stellar-only reason on EVM, so the fix is #1892 or an out-of-band `registerDeal` by a `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` wallet;
    - a paused Minter: the paused copy;
    - no role: the role copy.
    - The dialog's amount check refuses an amount above the booked bank cash with "The minter's booked bank cash ($0) is below this amount. Book the incoming wires first." before any signature.
    - Anything that slips past the reads (a race) fails at simulate, with the mapped copy and no signature request.
  - **After a disbursement**, `repay` needs `Performing..Default` and the registered deal, and `rollover` needs `Performing..WatchList` and a past maturity.
  - Exercisable right after a draw with no deal: Update lifecycle (metadata-only on `Approved`) and Close loan (`EarlyRepayment` on an undisbursed loan: outstanding is `0`).
  - The EVM arm is wired in full. Success depends only on #1892 (or an out-of-band `registerDeal`) and on booked bank cash.
- **Stage config.**
  - `VITE_EVM_ACCESS_MANAGER_ADDRESS` (Hoodi `0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992`) is being added to the stage trustee env in argocd now. The local `argocd` `origin/main` `ef24cd0` does not have it yet.
  - The SecurityRegistry keys and `VITE_EVM_START_BLOCK` still wait for #1944.
  - The new `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` (Hoodi `0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC`) must also be added there. Until it is, the Disbursement card shows "Disbursement isn't configured for this environment." on EVM. Record both keys in the PR body as deployment steps; do not change argocd here.
- **Roles.**
  - The trustee's EVM wallet needs `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` for the lifecycle writes, `MINT_CALLER_ROLE` for Record and `MINTER_OPS_ROLE` for Disburse. On Hoodi `0x96ef…c04e4` holds all three; `0xd3b9…a57c` holds only the first.
  - #1944 may add delays. A delayed role makes `execute` revert `AccessManagerNotScheduled` at simulate, with the generic copy. Scheduling these writes is not supported, as on Stellar.
- **Session chain.** The Trustee session is single-chain. A trustee signed in on Stellar who opens an EVM loan has no EVM wallet connected and gets "Connect your trustee wallet to approve on-chain." after clicking, the same post-click behaviour as #1573. The Record pages show "Connect your trustee wallet to check the Cash reporter role."
- **Repay routing (decided).** Direct `PipelineMinter.repay` is the only direct target call. A missing role gives `AccessManagedUnauthorized`, not `AccessManagerUnauthorizedCall`. Both decode in the details under the same generic copy.
- **Minter read fallback.** The legacy-view-then-`extsload` read assumes "reverts with empty data" means the function is missing. A different failure (RPC error, or a revert with data) propagates, and the card shows "Could not …" from its existing read-error branch. When the Hoodi Minter is upgraded to `150631a`, the fallback path takes over with no code change.
- **`useDeal` vs `useEvmDeal`.** Disburse reads the EVM deal through `useEvmDeal`, so the loan-detail "Debt token" row and Register debt token (K1) stay as they are. #1892 can fold `useEvmDeal` into `useDeal` later.
- **Next-repayment race.** Two trustees recording the same slot concurrently: the second fails at simulate (`MinterRefHashSeen`) or at receipt. Same as Stellar.
- **Mocks.** Every Trustee test mocking `@pipeline/wallet-connect` for these hooks must add `useEvmWallet` and the new EVM functions. The `#1537` / `#1943` tests that pin "EVM blocked" for these actions flip. The edits are mechanical.
- **`drawEvmLoan` refactor.** Moving the wrap into `write.ts` must keep `drawEvmLoan`'s message and behaviour. Its existing tests are the guard.
- **Safe multisigs.** `waitForTransactionReceipt` stalls for Safe wallets (#1942 review finding). Unchanged and out of scope.

## Decisions (human, 2026-11-19)

1. **EVM repay routing:** a direct `PipelineMinter.repay` from the wallet, mirroring Stellar's direct `Minter.repay`. This is the planner's recommended default. It is the one exception to the 2026-11-18 "no direct target call" decision, because Stellar's `repay` is itself a direct call.
2. **EVM Disburse is in scope** (against the planner's recommendation). The EVM arm of the #1898 Disburse action is added here (Decision 9). It is wired even though its deal precondition (#1892) cannot yet be met from the Trustee app on EVM. The UI surfaces this as described in Assumptions and Risks.

## Open Questions

_None_ (both resolved 2026-11-19, see Decisions (human, 2026-11-19)).

## Implementation Steps

### Part A — wallet-connect

1. `packages/wallet-connect/src/evm/contracts/write.ts`:
   - Add `sendEvmContractCallChecked(label: string, params: SendEvmContractCallParams): Promise<SendEvmContractCallResult>`. It wraps `onStageChange` to record `awaiting-signature`, calls `sendEvmContractCall`, and on a throw before the prompt where `err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError) !== null`, rethrows `new Error(\`${label}: simulation error: ${err.message}\`)`. Otherwise it rethrows as is.
   - Move `isContractRevert` here from `loanRegistry.ts`.
2. `packages/wallet-connect/src/evm/contracts/loanRegistry.ts`:
   - `drawEvmLoan` uses `sendEvmContractCallChecked("drawEvmLoan", …)`. Its behaviour and messages stay identical.
   - Add `evmLoanRegistryLifecycleAbi`, the function items with contract parameter names:
     - `rollover(uint256 loanId, uint32 newRate, uint64 newMaturityTimestamp)`;
     - `updateMutable(uint256 loanId, uint8 newStatus, string metadataURI)`;
     - `closeLoan(uint256 loanId, uint8 reason)`.
   - Add the encoders, validated per Decision 6 and imported `EVM_LOAN_STATUSES` / `EVM_CLOSURE_REASONS` from `./riskCouncil`, with the same positional signatures as the Stellar encoders:
     - `encodeEvmRolloverCalldata(loanId, newRateBps, newMaturity): Hex`: the rate is sent as `newRateBps * 100`;
     - `encodeEvmUpdateMutableCalldata(loanId, status, metadataUri): Hex`;
     - `encodeEvmCloseLoanCalldata(loanId, reason): Hex`.
   - Add `EvmLoanRegistryCallParams { accessManager, registry, caller, chainId, onStageChange? }` and three senders. Each validates the addresses with the `requireAddress` messages (`<label>: accessManager must not be empty`, `<label>: invalid registry …`), encodes, then calls `sendEvmContractCallChecked(label, { abi: [...accessManagerAbi, ...evmLoanRegistryErrorAbi], address: accessManager, functionName: "execute", args: [registry, calldata], value: 0n, account: caller, chainId, onStageChange })` and returns `{ hash }`:
     - `rolloverEvmLoan({ ...base, loanId, newRateBps, newMaturity })`;
     - `updateEvmMutable({ ...base, loanId, status, metadataUri })`;
     - `closeEvmLoan({ ...base, loanId, reason })`.
   - Stage types: reuse `RolloverStage` / `UpdateMutableStage` / `CloseLoanStage` from `stellar/contracts/loanRegistry` (chain-neutral aliases of `DrawLoanStage`).
   - Keep the single spec header; point it at `docs/frontend/trustee-flows.md#wired-actions` (it covers draw and lifecycle). No other comments.
3. `packages/wallet-connect/src/evm/contracts/minter.ts`:
   - `encodeEvmRepayCalldata`: add the Decision 6 validation (`valueDate`, `loanId`, `saleId`, the seven fields as digit strings ≤ `uint256`). Existing behaviour and tests stay valid.
   - `evmRepaymentRefHash({ registry, loanId, nextRepaymentId }): Promise<Hex>` = `0x` + `sha256Hex(\`pipeline:repay:${getAddress(registry)}:${loanId}:${nextRepaymentId}\`)`.
   - `readEvmRepaymentId(receipt: Pick<TransactionReceipt, "logs">, minter: string): number | null`: `parseEventLogs({ abi: recoveryEventsAbi, eventName: "CashRepaid", logs, strict: false })` filtered by the Minter address (case-insensitive); safe-integer conversion as `readEvmDrawnLoanId`.
   - `evmRepayErrorAbi: Abi` = `[...evmMinterErrorAbi, ...evmLoanRegistryErrorAbi, RateLimiterExceedsTxLimit, RateLimiterExceedsWindowLimit, DealTokenFactoryNotRegistered(uint256), AccessManagedUnauthorized(address)]`.
   - `repayEvmLoan({ minter, caller, chainId, loanId, repayment, valueDate, refHash, saleId = 0, onStageChange }): Promise<{ hash: Hex; repaymentId: number | null }>`:
     - validates the `minter` / `caller` addresses (`repayEvmLoan: …`);
     - encodes args through the same validation as `encodeEvmRepayCalldata` (factor out `evmRepayArgs(...)` and reuse it in both);
     - calls `sendEvmContractCallChecked("repayEvmLoan", { abi: [minterRecoveryAbi[1], ...evmRepayErrorAbi], address: minter, functionName: "repay", args, account: caller, chainId, onStageChange })`;
     - returns `{ hash, repaymentId: readEvmRepaymentId(receipt, minter) }`.
   - `RepayStage` / `RepaymentInput` come from the Stellar modules (chain-neutral).
3a. `packages/wallet-connect/src/evm/contracts/minter.ts`, **disburse** (Decision 9):
   - Add to the ABI:
     - `minterDisburseAbi`: `disburse(uint256 loanId, uint256 amount, uint64 valueDate, bytes32 refHash) returns (uint256 entryId)`, `bankCash() view returns (uint256)`, `refHashSeen(bytes32) view returns (bool)`, `paused() view returns (bool)`;
     - reuse `minterExtsloadAbi` and `MINTER_STORAGE_SLOT`;
     - add `MINTER_BANK_CASH_FIELD = 8n` and `MINTER_REF_HASHES_SEEN_FIELD = 20n` next to `MINTER_REPAYMENTS_FIELD`.
   - `encodeEvmDisburseCalldata({ loanId, amountRaw, valueDate, refHash }): Hex`, with the Decision 9 validation and the messages `encodeEvmDisburseCalldata: invalid <field> <value>`. The zero `refHash` is rejected.
   - `evmDisburseSelector(): Hex` (from the ABI; pinned `0x1d492b02`).
   - `evmDisburseErrorAbi: Abi` = `[...evmMinterErrorAbi, ...evmLoanRegistryErrorAbi, DealTokenFactoryNotRegistered(uint256)]`. Share the `DealTokenFactoryNotRegistered` entry with `evmRepayErrorAbi`.
   - `disburseEvmLoan({ accessManager, minter, caller, chainId, loanId, amountRaw, valueDate, refHash, onStageChange }): Promise<{ hash: Hex }>`:
     - address checks (`disburseEvmLoan: …`), then encode;
     - `sendEvmContractCallChecked("disburseEvmLoan", { abi: [...accessManagerAbi, ...evmDisburseErrorAbi], address: accessManager, functionName: "execute", args: [minter, calldata], value: 0n, account: caller, chainId, onStageChange })`.
   - Reads:
     - `readEvmMinterPaused({ minter })` (the `paused()` view);
     - `readEvmMinterBankCash({ minter }): Promise<string>` and `readEvmRefHashSeen({ minter, refHash }): Promise<boolean>`: the legacy view first; on a revert with empty data (`isMissingFunction(err)`: viem `ContractFunctionExecutionError` whose cause has no revert data / `0x`), fall back to `extsload` at `MINTER_STORAGE_SLOT + 8` and at `keccak256(encodeAbiParameters([bytes32, uint256], [refHash, MINTER_STORAGE_SLOT + 20]))` (non-zero means seen). Any other error propagates.
3b. `packages/wallet-connect/src/evm/contracts/riskCouncil.ts` (or `loanRegistry.ts`, next to the lifecycle reads):
   - add `immutableLoanData(uint256)` to the read ABI (only `originalSeniorTranche` is used);
   - add `readEvmLoanDisbursementState({ registry, loanId }): Promise<LoanDisbursementState>` = `mutableLoanData` (status via `EVM_LOAN_STATUSES`, `carvedOut`, `disbursed`) + `immutableLoanData.originalSeniorTranche`, as decimal strings. It reuses the Stellar `LoanDisbursementState` type.
3c. New `packages/wallet-connect/src/evm/contracts/dealTokenFactory.ts`:
   - `evmDealTokenFactoryAbi`: `deal(uint256) view returns ((address debt))` and the four factory errors;
   - `readEvmDeal({ factory, loanId }): Promise<DealRead | null>`: a `DealTokenFactoryNotRegistered` revert (decoded by name) gives `null`; otherwise `{ debt }` (checksummed). It reuses the Stellar `DealRead` type.
   - A one-line spec header pointing at `docs/frontend/trustee-flows.md#disburse-1898`.
4. `packages/wallet-connect/src/index.ts`, in the existing EVM blocks:
   - export `rolloverEvmLoan`, `updateEvmMutable`, `closeEvmLoan`, `encodeEvmRolloverCalldata`, `encodeEvmUpdateMutableCalldata`, `encodeEvmCloseLoanCalldata`, `evmLoanRegistryLifecycleAbi`, `EvmLoanRegistryCallParams`;
   - export `repayEvmLoan`, `evmRepaymentRefHash`, `readEvmRepaymentId`, `evmRepayErrorAbi`;
   - export `disburseEvmLoan`, `encodeEvmDisburseCalldata`, `evmDisburseSelector`, `evmDisburseErrorAbi`, `readEvmMinterPaused`, `readEvmMinterBankCash`, `readEvmRefHashSeen`, `readEvmLoanDisbursementState`, `readEvmDeal`, `evmDealTokenFactoryAbi`;
   - export `sendEvmContractCallChecked`.

### Part B — Trustee

5. `packages/trustee/src/lib/targetChains.ts`:
   - add `loanActionChainReason(chainId)` (Decision 1);
   - delete `recordRepaymentChainReason` and `EVM_RECORD_REPAYMENT_PENDING_COPY`;
   - `grep -rn` both names in `packages/` and replace them.
6. `packages/trustee/src/api/useRollover.ts`:
   - input `{ loanId, newRateBps, newMaturity, chainId }`; the Decision 2 structure;
   - the EVM arm checks `ENV.EVM_LOAN_REGISTRY_ADDRESS && ENV.EVM_ACCESS_MANAGER_ADDRESS` with the same "On-chain rollover is not configured for this environment." copy;
   - then `rolloverEvmLoan({ accessManager, registry, caller: wallet.address, chainId: ENV.EVM_CHAIN_ID, loanId, newRateBps, newMaturity, onStageChange: setStage })`;
   - replace the JSDoc block with the one-line spec header (comment-less rule).
7. `packages/trustee/src/api/useUpdateLifecycle.ts`:
   - `useLoanMutableState` per Decision 8;
   - `useUpdateLifecycle` input gains `chainId`; the EVM arm calls `updateEvmMutable` with the same guards and copy.
8. `packages/trustee/src/api/useCloseLoan.ts`:
   - input gains `chainId`; the EVM arm calls `closeEvmLoan`;
   - replace the JSDoc block with the spec header.
9. `packages/trustee/src/api/useRecordPayment.ts`:
   - input gains `chainId`;
   - EVM arm guards: `loanActionChainReason`; `ENV.EVM_MINTER_ADDRESS && ENV.EVM_LOAN_REGISTRY_ADDRESS` with "On-chain payment recording is not configured for this environment."; the wallet;
   - then the Decision 4 order;
   - the result type becomes `{ hash: string; repaymentId?: number | null }` (additive; the Stellar `repay` already returns it).
10. `packages/trustee/src/api/useCashReporterAccess.ts` and `lib/cashReporter.ts`: Decision 7.
    - `useCashReporterAccess(fn, enabled, chainId?)` uses `useChainWallet(chainId)` for the address.
    - `configured` per chain: Stellar unchanged; EVM `!!ENV.EVM_MINTER_ADDRESS && !!ENV.EVM_ACCESS_MANAGER_ADDRESS && EVM_CASH_REPORTER_SELECTORS[fn] != null`.
    - `EVM_CASH_REPORTER_SELECTORS` lives in `lib/cashReporter.ts`.
11. `packages/trustee/src/routes/-useLoanDetail.ts`: `onChainBlockedReason: entry ? loanActionChainReason(entry.chain_id) : null`. `routes/loans.$id.tsx`:
    - the rollover and update-lifecycle `mutateAsync` calls pass `chainId: chain`;
    - `useLoanMutableState(chain, …)` is unchanged (already chain-keyed);
    - `ON_CHAIN_ACTIONS` is unchanged.
12. `packages/trustee/src/routes/-record-coupon.ts` and `-record-repayment.ts`:
    - `onChainBlockedReason = entry ? loanActionChainReason(entry.chain_id) : null`;
    - `useCashReporterAccess("repay", …, chainId)`;
    - drop the `stellarOnlyActionReason` import.
    - `routes/loans.$id_.record-coupon.tsx` and `loans.$id_.record-repayment.tsx` `onRecord` pass `chainId: chain`; the close `mutateAsync` passes `{ loanId, reason, chainId: chain }`.
    - Remove the narrative `record_payment` / `close_loan` stage-label JSDoc lines in the touched blocks (comment-less rule).
13. `packages/trustee/src/routes/-useRepaymentRecoveryDialog.ts`:
    - step 2: `recordChainReason = loanActionChainReason(chainId)`, at the same position in the blocked-reason chain;
    - `record()` passes `chainId`.
    - `useRecoveryCard` and `-repayment-recovery.ts` are unchanged (they already use `riskCouncilChainReason`).
14. **Env:** `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS`.
    - `packages/trustee/src/lib/env.ts`: `EVM_DEAL_TOKEN_FACTORY_ADDRESS: readString("VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS", "")`, with the `-env.test.ts` case;
    - `docker/trustee/entrypoint.sh`: `--arg` plus the JSON key;
    - `.env.example`: a commented line with the Hoodi `0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC`, which must equal `CHAIN_<id>_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS`;
    - `docs/FRONTEND.md`: a row in the EVM env table.
15. **Disburse, Trustee** (Decision 9):
    - `api/useDisburse.ts`:
      - `disburseConfigured(chainId)` is per chain (Stellar unchanged; EVM: the four `EVM_*` keys).
      - `useLoanDisbursementState`: the EVM arm via `readEvmLoanDisbursementState`, `enabled` on `loanActionChainReason(chainId) === null`.
      - `useDisburseAccess(chainId, enabled)`: `useChainWallet(chainId)`. EVM calls `readEvmCanCall({ accessManager, caller, target: ENV.EVM_MINTER_ADDRESS, selector: evmDisburseSelector() })`. The key gains `chainId`.
      - New `useEvmMinterBankCash(enabled)` and `useEvmMinterPaused(enabled)`.
      - `useDisburse`: `pickChainWallet(chainId, …)`. EVM arm, in order:
        1. `loanActionChainReason`;
        2. `disburseConfigured(chainId)` (`DISBURSE_NOT_CONFIGURED`);
        3. wallet ("EVM wallet not connected.");
        4. `refHash = "0x" + await bankReferenceRefHash(reference)`;
        5. `readEvmRefHashSeen` (`REUSED_DISBURSE_REFERENCE`);
        6. `readEvmMinterPaused` (`MINTER_PAUSED`);
        7. `disburseEvmLoan({ accessManager, minter, caller, chainId: ENV.EVM_CHAIN_ID, loanId, amountRaw, valueDate, refHash, onStageChange: setStage })`.
      - `INVALIDATED_KEYS` adds `evm-minter-bank-cash` and `evm-minter-paused`.
      - `useDebtTrustline` stays Stellar-only (`enabled` also requires `isStellarTarget(chainId)`).
    - `api/useDealToken.ts`: add `useEvmDeal(chainId, loanId)`:
      - key `["deal-token", chainId, loanId]`;
      - `enabled` when `!isStellarTarget(chainId) && loanActionChainReason(chainId) === null && ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS && validLoanId`;
      - `readEvmDeal`.
      - `useDeal` and `useRegisterDeal*` are unchanged (K1).
    - `lib/disburse.ts`:
      - `disburseView`: step 1 is `loanActionChainReason`; the trustline step is skipped when `input.trustline === null`;
      - `disburseFormError` takes `decimals` (parse via `usdInputToSacBaseUnits`, copy "up to {decimals} decimals", bank-cash copy formatted at `decimals`);
      - `disburseErrorCopy` takes `decimals` for the tranche values and gains the Decision 9 name branches.
    - `routes/-DisburseAction.tsx`:
      - `useChainWallet(chainId)`; the chain-picked reads (Decision 9);
      - `usd(raw)` formats at `chainAmountDecimals(chainId)`;
      - the dialog parses the amount at those decimals and passes `decimals` to the form and error helpers;
      - `useDisburseAccess(chainId, open-gate)` replaces `useDisburseAccess(stellar)`;
      - drop the `stellarOnlyActionReason` import. The test ids and copy are unchanged.
16. Lint and build, from the worktree root (`Y="node .yarn/releases/yarn-4.13.0.cjs"`):
    - `$Y workspace @pipeline/wallet-connect lint`, `test`;
    - `$Y workspace @pipeline/trustee lint`, `test`, `build`;
    - `npx tsx scripts/lint-docs.ts`;
    - `npx tsx scripts/lint-comments.ts`, shrinking `scripts/lint-comments.baseline.json` for the touched listed files (`-useRollover.test.tsx`, `-useUpdateLifecycle.test.tsx`, `-record-coupon*.test.ts(x)`, `-record-repayment*.test.ts(x)`, `loans.$id_.record-coupon.tsx`, `loans.$id_.record-repayment.tsx`, and any Disburse file listed there).
    - No Rust change, so no clippy run is needed.

## Test Strategy

Vitest only: co-located `*.test.ts` in wallet-connect, `-*.test.ts(x)` in the Trustee. No Rust tests and no Postgres. No Figma is referenced, and the UI is unchanged except that the gates open, so there is no Figma step.

**wallet-connect, `evm/contracts/write.test.ts`.** `sendEvmContractCallChecked`:
- a `ContractFunctionExecutionError` wrapping `ContractFunctionRevertedError` before `awaiting-signature` becomes `"<label>: simulation error: …"` and keeps the original text;
- the same revert after the prompt passes through;
- `UserRejectedRequestError` passes through;
- stages are forwarded.

**wallet-connect, `evm/contracts/loanRegistry.test.ts`** (mock `./write`, as today):
- The `drawEvmLoan` tests stay green (refactor guard).
- Selectors pinned from the ABI: `rollover` `0x0971a074`, `updateMutable` `0x206293ef`, `closeLoan` `0xd0cdfd5a`.
- Round-trip each encoder through `decodeFunctionData`:
  - rollover `(7n, 145000, 1_900_000_000n)` for `newRateBps = 1450`;
  - updateMutable `WatchList` gives `2`, the URI verbatim (including `""` and leading or trailing spaces);
  - closeLoan `ScheduledMaturity` gives `1`, `EarlyRepayment` gives `2`.
- Validation throws before any `sendEvmContractCall`:
  - id `-1` or `1.5`;
  - `newRateBps` `0` or `10_001`;
  - maturity `0`;
  - status `"Matured"`;
  - reason `"None"` or `"Foo"`;
  - empty or invalid `accessManager` / `registry` / `caller`.
- Each sender calls `sendEvmContractCall` with `address: accessManager`, `functionName: "execute"`, `args: [registry, calldata]`, `value: 0n`, `account`, `chainId`. The ABI contains `execute`, `AccessManagerUnauthorizedCall`, `LoanRegistryNotMatured` and `EnforcedPause`. Each returns `{ hash }`.
- The simulation wrap uses each sender's label.

**wallet-connect, `evm/contracts/minter.test.ts`:**
- `evmRepaymentRefHash({ registry: "0xdf08fdf0f47272a8ced33a5f913f6c9d179b0231", loanId: 7, nextRepaymentId: 0 })` = `0x147c2b75249c782e7d0f48894e317f7ce065f657ed87c93b10a163c00cbb55bd`. That is the sha256 of `pipeline:repay:0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231:7:0`; the lowercase input is checksummed. The hash changes with each of the three inputs.
- `encodeEvmRepayCalldata` / `repayEvmLoan` validation:
  - `valueDate` `0`, `-1` or `1.5`;
  - `loanId` `-1`;
  - `saleId` `-1`;
  - a field `"1.5"` or above `uint256`;
  - the zero or a malformed `refHash`.
  - All throw before any send.
- `repayEvmLoan`:
  - calls `sendEvmContractCall` with `address: minter`, `functionName: "repay"`, args `[loanId, tuple, valueDate, refHash, 0n]`, `account: caller`, `chainId` (direct, not through the AM);
  - the ABI contains `MinterRefHashSeen`, `RateLimiterExceedsTxLimit`, `DealTokenFactoryNotRegistered`, `LoanRegistryWrongCurrentStatus`, `EnforcedPause` and `AccessManagedUnauthorized`;
  - `repaymentId` comes from a `CashRepaid` log of the Minter (mixed-case address);
  - `0` is returned as `0`; another address gives `null`; no log gives `null`; above `MAX_SAFE_INTEGER` gives `null`;
  - the simulation wrap label is `repayEvmLoan`.
- Disburse:
  - `evmDisburseSelector()` is `0x1d492b02`.
  - `encodeEvmDisburseCalldata` round-trips through `decodeFunctionData` (`[7n, 1_000_000n, 1_795_046_400n, ref]`).
  - The encoder rejects, with no send: id `-1`; `amountRaw` `"0"`, `"1.5"` or above `uint256`; `valueDate` `0`; the zero or a malformed `refHash`.
  - `disburseEvmLoan` sends `execute(minter, calldata)` to the AM with `value 0n`. The ABI contains `MinterInsufficientBankCash`, `LoanRegistryDisbursementExceedsTranche`, `DealTokenFactoryNotRegistered`, `EnforcedPause` and `AccessManagerUnauthorizedCall`. The simulation-wrap label is `disburseEvmLoan`.
  - `readEvmMinterBankCash` / `readEvmRefHashSeen`:
    - the legacy view result is used;
    - a revert with empty data falls back to `extsload` at the pinned slots (bank cash `MINTER_STORAGE_SLOT + 8`; the ref-seen slot for a fixed `refHash`, pinned against `cast index bytes32 <ref> <base+20>`);
    - a revert with data or an RPC error propagates;
    - `extsload` returning non-zero means seen.
  - `readEvmMinterPaused` returns the view.
- `evm/contracts/dealTokenFactory.test.ts`: `readEvmDeal` returns `{ debt }`; a `DealTokenFactoryNotRegistered` revert gives `null`; another error propagates; an invalid factory or loan id throws before any read.
- `readEvmLoanDisbursementState`: the ordinal maps to the name; `originalSeniorTranche` comes from `immutableLoanData`; values are decimal strings.

**Trustee hooks** (`api/-useRollover.test.tsx`, `-useUpdateLifecycle.test.tsx`, `-useRecordPayment.test.tsx`, add `api/-useCloseLoan.test.tsx` if absent, `-useCashReporterAccess.test.tsx`). Mocks add `useEvmWallet` and the EVM functions; the env mock adds the EVM keys. For each hook:
- The Stellar arm is unchanged with `chainId: STELLAR` and with `chainId: undefined`.
- EVM arm:
  - a missing registry or AM (or Minter) address gives "not configured" and no call;
  - disconnected gives "EVM wallet not connected." and no call;
  - an unknown chain id (`1234`) throws the `loanActionChainReason` copy with no call;
  - success threads `accessManager` / `registry` / `minter` / `caller` / `chainId: ENV.EVM_CHAIN_ID` and the args;
  - `stage` follows `onStageChange`;
  - invalidations and timings are as on Stellar.
- `useRecordPayment` EVM:
  - `readEvmNextRepaymentId` is called with `{ registry, loanId }`, then `evmRepaymentRefHash` with its result;
  - `repayEvmLoan` gets the `refHash`, `valueDate` and `saleId: 0`, and the `repayment` verbatim.
- `useLoanMutableState` EVM reads `readEvmLoanChainState`; it is disabled for an unknown chain and for an unset EVM registry.
- `useCashReporterAccess("repay", true, EVM)`:
  - reads `readEvmCanCall` with `evmRepaySelector()`;
  - `immediate` gives `null`; `(false, 0)` gives "Only the Cash reporter can book repayments."; `delay > 0` gives the delay copy;
  - no EVM address gives the connect copy;
  - `record_wire_in` on EVM is not configured and never reads.

**Trustee Disburse** (`api/-useDisburse.test.tsx`, `lib/-disburse.test.ts`, the `-DisburseAction` / `-loans.$id.test.tsx` cases):
- `useDisburse` EVM:
  - the guard order (chain, config, wallet), each with no call;
  - `refHash` = `0x` + `bankReferenceRefHash(reference)`;
  - a seen hash gives `REUSED_DISBURSE_REFERENCE` and no send;
  - paused gives `MINTER_PAUSED` and no send;
  - success passes `accessManager` / `minter` / `caller` / `chainId: ENV.EVM_CHAIN_ID` / `amountRaw` / `valueDate`;
  - invalidations include the EVM keys.
  - The Stellar arm is unchanged.
- `useLoanDisbursementState` / `useDisburseAccess` / `useEvmDeal` / `useEvmMinterBankCash` / `useEvmMinterPaused`: the EVM reads are enabled only on `ENV.EVM_CHAIN_ID` with the config set; disabled for an unknown chain.
- `disburseView`:
  - EVM with `trustline: null` goes from the deal check straight to paused;
  - a `null` EVM deal gives "Register this loan's debt token first.";
  - an unknown chain gives the Stellar-only copy;
  - the Stellar cases are unchanged (the trustline reasons are still hit).
- `disburseFormError(…, decimals)`:
  - `"1.1234567"` passes at 7 and fails at 6 ("up to 6 decimals");
  - the bank-cash comparison holds at 6 dp, and its copy formats at 6 dp.
- `disburseErrorCopy` on EVM-shaped details (`disburseEvmLoan: simulation error: … MinterInsufficientBankCash(…)` and so on) maps each name to the Stellar copy. `DealTokenFactoryNotRegistered` gives `DEBT_NOT_REGISTERED`. A wallet rejection passes through.
- Card on an EVM loan:
  - an `Approved` loan with no deal shows the deal reason and a disabled button;
  - with a deal, unpaused and the role: the button is enabled, and the dialog shows 6-dp values and submits `chainId`.

**Trustee lib and presenters:**
- `lib/-targetChains.test.ts`:
  - `loanActionChainReason` is `null` for Stellar, `null` / `undefined` and `ENV.EVM_CHAIN_ID`, and the Stellar-only copy for `1234`;
  - remove the `recordRepaymentChainReason` cases.
- `routes/-useLoanDetail-hook.test.ts` and `routes/-loans.$id.test.tsx`:
  - flip the `#1537` "EVM blocked" cases: on `ENV.EVM_CHAIN_ID`, `onChainBlockedReason` is `null` and the four actions are enabled;
  - keep an unknown-chain case blocked;
  - assert Roll over / Update lifecycle call `mutateAsync` with `chainId: chain`.
- `routes/-record-coupon.test.ts`, `-record-repayment.test.ts` and the two `-page.test.tsx`:
  - EVM loan: `onChainBlockedReason` is `null`, the role read is enabled with `chainId`, `recordPaymentInput` is built from the 6-dp served waterfall, and `closureReason` is set;
  - `onRecord` / close pass `chainId`;
  - an unknown chain stays blocked and never calls `mutateAsync`.
- `routes/-RepaymentRecoveryDialog.test.tsx` / the recovery hook tests:
  - EVM step 2 is enabled once reversed, indexed, valued and `canRepay`, and `record()` passes `chainId`;
  - remove the "not available yet" EVM expectation;
  - an unknown chain keeps the Stellar-only copy.

## Docs to Update

- **`docs/frontend/trustee-flows.md`:**
  - "Wired actions":
    - Roll over: `LoanRegistry.rollover` (Stellar via the executor; EVM `rollover(uint256,uint32,uint64)` through `AccessManager.execute`; both bps × 100);
    - Update lifecycle: `update_mutable` / `updateMutable(uint256,uint8,string)`; the chain read is `readLoanChainState` / `readEvmLoanChainState`;
    - rename the "Stellar-only gate (#1537, TD-152)" bullet to "Chain gate (#1537, #1574)": `loanActionChainReason` is open on Stellar and `ENV.EVM_CHAIN_ID`, keeps the Stellar-only copy for other chains, and only Register debt token stays Stellar-only (K1, #1892).
  - "Disburse (#1898)": add an **EVM (#1574)** block covering:
    - `AccessManager.execute(minter, disburse(uint256,uint256,uint64,bytes32))` with `MINTER_OPS_ROLE` through `canCall` (copy unchanged);
    - the pre-flight order without the trustline step, and the deal read via `deal(uint256)`;
    - the bank-cash and ref-seen reads (legacy view, then the `extsload` fallback);
    - 6-dp amounts;
    - the `0x` + `sha256(reference.trim())` `ref_hash`;
    - the name-keyed error copy;
    - the `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` config;
    - the EVM testnet caveat: `registerDeal` (#1892) and booked bank cash; Hoodi `bankCash = 0`.
    - Replace "Visible for a Stellar loan" and the "Not a Stellar loan" pre-flight step with the chain gate.
  - "Repayment recovery (#1711)" EVM bullets: step 2 runs on EVM via the `useRecordPayment` EVM arm. Remove the "not available yet" bullet and the `recordRepaymentChainReason` mention.
  - "Recording a payment — `Minter.repay` (#1712)": add the EVM arm:
    - the direct `PipelineMinter.repay` (user decision 2026-11-19);
    - `ref_hash` with the EIP-55 registry and the `0x` prefix;
    - `readEvmNextRepaymentId`;
    - `CashRepaid` for the id;
    - `MINT_CALLER_ROLE`;
    - config;
    - and replace "EVM loans stay gated … (TD-152)".
  - "Cash reporter bookings": `useCashReporterAccess(fn, enabled, chainId)`; the EVM `repay` read (`canCall`, selector `0x87d2050a`, `ENV.EVM_ACCESS_MANAGER_ADDRESS`, `ENV.EVM_MINTER_ADDRESS`). Replace "An EVM loan shows only the Stellar-only reason (no read)".
  - "Scale handling": drop "even though its on-chain write is gated (TD-152)"; EVM writes use the 6-dp served fields.
  - Add an **EVM (#1574)** subsection under "Cash movement & lifecycle actions" with the [Differences from Stellar](#differences-from-stellar) table and the Hoodi check summary. Link it from "Wired actions".
  - Risk Council "EVM" section: table row 10 becomes "`useRecordPayment` EVM arm (#1574)"; drop "Not in this issue: … (#1574)"; drop the `recordRepaymentChainReason` sentence.
- **`docs/frontend/wallet-flows.md`**, "Trustee EVM contract client":
  - add `sendEvmContractCallChecked`;
  - add the lifecycle senders (`rolloverEvmLoan`, `updateEvmMutable`, `closeEvmLoan`), `repayEvmLoan` / `evmRepaymentRefHash` / `readEvmRepaymentId`, and the Disburse bindings (`disburseEvmLoan`, `readEvmMinterBankCash`, `readEvmRefHashSeen`, `readEvmMinterPaused`, `readEvmLoanDisbursementState`, `readEvmDeal`) to the reusers list;
  - note the Minter read-surface fallback: a legacy view, then `extsload` on a `150631a` Minter.
- **`docs/exec-plans/tech-debt-tracker.md` TD-152:**
  - Mark it `[PARTIALLY RESOLVED 2026-11-?? / #1574]` with a resolution line: rollover, Update lifecycle, Record coupon / repayment (including recovery step 2), Close loan and Disburse run on the configured EVM chain.
  - What remains:
    - the cash-reporter bookings (`record_wire_in` #1501, `record_income`);
    - Register debt token (#1892). EVM Disburse and Repay revert `DealTokenFactoryNotRegistered` until then, and the Disbursement card shows the deal reason. Note in #1892's context that `drawLoan` does not auto-register and `registerDeal` is on `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`.
  - Update the "Status" and "EVM client" bullets.
  - Fix the Location line (the gate now lives in `loanActionChainReason`).
- **`docs/product-specs/loan-repay-minter.md`:** replace the "EVM: … Not wired … signing is blocked on #1573" bullet with:
  - the EVM call;
  - `MINT_CALLER_ROLE` with delay 0;
  - the `ref_hash` preimage with the EIP-55 registry;
  - the pause and `DealTokenFactoryNotRegistered` preconditions;
  - the Hoodi check (2026-11-19, `eth_call`, nothing submitted).
- **`docs/exec-plans/tech-debt-tracker.md`, new TD:** "#1943 recovery reads use `Minter.extsload`, which the Hoodi Minter (source `f92d719`) lacks, so the EVM recovery list fails there until the Minter is upgraded". Point to the #1574 legacy-view fallback as the pattern. Log it only if no TD already covers it (check TD-190).
- **`docs/FRONTEND.md`:** the `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` row.
- **`docs/product-specs/cash-reporter-bookings.md`** "EVM": Record Coupon / Repayment read `canCall(wallet, minter, repay)` and sign on EVM (#1574). Mint PLUSD and Bank income stay disabled (TD-152).
- **`docs/product-specs/loan-repayment-recovery.md`** "Trustee app": replace "Step 2 on EVM … waits for #1574 …" with "Step 2 on EVM signs `PipelineMinter.repay` (#1574)".
- **`docs/product-specs/loans-data.md`:**
  - next to `updateMutable` / `rollover` / `closeLoan`, note the EVM role (`LOAN_REGISTRY_MANAGER_ADMIN_ROLE`) and the enum ordinals;
  - fix the `rollover` parameter names (`newRate` bps × 100, `newMaturityTimestamp`) to the contract's.
- **User stories:**
  - New `docs/user-stories/epic-1521/1574-trustee-evm-lifecycle-writes.md`, with a row in `docs/user-stories/index.md`.
  - Persona: a trustee signed in on Hoodi with an EVM wallet that holds `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, `MINT_CALLER_ROLE` and `MINTER_OPS_ROLE` (Hoodi `0x96ef…c04e4`).
  - Stories:
    1. Update lifecycle on an EVM loan (status and URI from `mutableLoanData`; sign; `StatusUpdated`).
    2. Roll over a matured, performing EVM loan.
    3. Record a coupon (the role read, `repay`, then the audit log shows `CashRepaid` + `PaymentRecorded`).
    4. Record the repayment and close the loan.
    5. Recovery step 2 on EVM.
    6. A wallet without `MINT_CALLER_ROLE` sees the role reason and is never prompted.
    7. A failed simulate (for example `Approved` loan → `repay`) requests no signature and shows the decoded name in the details.
    8. A loan on an unknown chain stays blocked.
    9. Disburse an EVM loan:
       - with no deal, the card shows "Register this loan's debt token first." and the button is disabled;
       - with a deal (registered out of band) and booked bank cash, Disburse signs `AccessManager.execute`, the loan moves `Approved → Performing`, and the audit log shows `CashDisbursed`;
       - a reused reference is refused before the wallet prompt.
    10. Stellar regression.
  - Note the preconditions from Assumptions:
    - no loans on Hoodi yet;
    - `registerDeal` (#1892) is out of band;
    - Hoodi `bankCash = 0` until wires are booked;
    - the AM and DTF addresses must be in the stage env.
  - Update the stale "(TD-152)" lines in `epic-1521/1603-…md:23`, `1711-repayment-recovery.md:113` and `1712-…md:75` where they describe EVM Record as blocked, and Story 10 of `epic-1937/1943-trustee-evm-rc-pages.md`.

## Implementation notes (coder, 2026-11-19)

All Implementation Steps 1 to 16 are done. None of the points below is a new difference from Stellar, so the Differences table is unchanged.

- `sendEvmContractCallChecked(label, params, send = sendEvmContractCall)` takes an optional third argument so the wallet-connect tests can inject the mocked send; `isContractRevert` is exported from `write.ts`.
- Disburse amounts: `usdInputToSacBaseUnits` truncates extra digits and `sacBaseUnitsToUsdDecimal` pads zeros, which would change the Stellar output and accept "1.1234567" at 6 dp. The form uses `parseDisburseAmount(input, decimals)` (strict, rejects over-precise input like `parseUsdDollarsToI128`) and `rawToDecimal(raw, decimals)` (trims trailing zeros like `rawToDecimal7`), both in `lib/disburse.ts`; at 7 dp the Stellar output is byte-identical.
- `EVM_CASH_REPORTER_SELECTORS.repay` is `() => evmRepaySelector()` (lazy), so modules that mock `@pipeline/wallet-connect` without that export still load.
- The shared `DealTokenFactoryNotRegistered` error entry is `evmDealNotRegisteredErrorAbi` in `dealTokenFactory.ts`, imported by `minter.ts`.
- `useEvmDeal` shares the key `["deal-token", chainId, loanId]` with `useDeal`, as planned: once the Disbursement card has read an EVM deal, the disabled `useDeal` observer on the loan detail page sees that cached value. Superseded in review: that shared key let the disabled observer overwrite the query function, so `useEvmDeal` now uses its own `["evm-deal-token", chainId, loanId]`, also in `INVALIDATED_KEYS`.
- TD-190 got a Hoodi-Minter bullet instead of a new TD (it already covers the `extsload` recovery reads).
- `scripts/lint-comments.baseline.json` shrank by six entries (the touched Rollover, Update-lifecycle and Record page tests and the two Record route files).
