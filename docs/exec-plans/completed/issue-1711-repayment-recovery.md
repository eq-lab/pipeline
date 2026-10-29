# Issue #1711: Trustee + wallet-connect: Minter reverse_repay / repay bindings and loan repayment recovery UI (#1655)

Source: https://github.com/eq-lab/pipeline/issues/1711

Branch: `feat/1711-minter-reverse-repay-recovery`. Parent epic #1521. Follow-up to #1655 (spec `docs/product-specs/loan-repayment-recovery.md`) and #1712 (`Minter.repay`, spec `docs/product-specs/loan-repay-minter.md`).

## Findings (research at planning time, 2026-10-28)

Contract sources: shallow clones of `eq-lab/pipeline-stellar-contracts` @ `7646cef` (2026-10-28) and `eq-lab/pipeline-contracts` @ `3b74e98`. There is no local checkout of either repo.

### Stellar `reverse_repay` signature and access (this differs from the issue text)

- `contracts/minter/src/lib.rs:366-367`: `#[only_owner] pub fn reverse_repay(e, loan_id: u32, repayment_id: u32, ref_hash: BytesN<32>)`. It returns nothing.
  - It fails with `AlreadyReversed` (#25) when the Minter record is already reversed.
  - `consume_ref`: the zero hash is accepted and not recorded; a repeated hash fails `RefHashSeen` (#7).
  - `sub_bank_cash(rec.cash)` fails `InsufficientBankCash` (#8).
  - Then `registry.unrecord_payment`, the fee-share burn and absorb, `pocket_unrelease` or `absorb(interest_minted)`, and `factory_sync_debt`.
  - It emits `CashRepaymentReversed { loan_id, repayment_id, cash, ref_hash }`.
  - It has no `when_not_paused`.
- **The Minter owner is the AccessManager.** Deploy: `deployments/justfile:385`, `owner(access-manager)`. So `#[only_owner]` means "relayed through `AM.execute`", not "a single owner key":
  - `deployments/justfile:729` maps `reverse_repay` to **`RISK_COUNCIL`**, together with `reverse_disburse`, `record_correction` and `correct_vault_mint`.
  - `justfile:756` grants it with "risk actions + reversals, time-locked".
  - `deployments/networks/*/config.json` sets `risk_council` delay `86400` on testnet, futurenet and mainnet.
- Testnet check (read-only `simulateTransaction`; AM `CDP7TUNB…WHTW`, Minter `CAPL5WN3…AIFK`; nothing submitted):
  - `get_target_function_role(minter, reverse_repay)` = `RISK_COUNCIL`.
  - `get_target_function_role(minter, repay)` = `CASH_REPORTER`.
  - `can_call(GAZFDDYK…ZH6G, minter, reverse_repay)` = `{ immediate: false, delay: 86400 }`.
  - `registry.next_loan_id()` = `0`, so there is still no loan to run against end to end.
- The AccessManager delayed path (`contracts/access-manager/src/lib.rs`) has five calls:
  - `schedule(target, function: Symbol, args: Vec<Val>, when: u64, caller) -> (BytesN<32>, u32)`.
    - `when = 0` means "earliest", i.e. now + delay.
    - It fails `Unauthorized` (#1) for an immediate caller or a non-member.
    - It fails `OperationAlreadyScheduled` (#9) while a matching operation is still pending.
  - `execute(target, function, args, caller) -> Val`:
    - A delayed member must have a matching scheduled operation, which `execute` consumes.
    - Errors: `OperationNotScheduled` #6, `OperationNotReady` #7, `OperationExpired` #8.
    - Operations expire 7 days after their ready time (`storage.rs:9`).
  - `hash_operation(caller, target, function, args) -> BytesN<32>` and `get_schedule(id) -> u64` are read-only. `get_schedule` returns `0` when the operation is not scheduled, already executed, cancelled or expired.
  - `cancel(target, function, args, caller, canceller)`.
  - The operation id covers `caller` and `args`. So only the wallet that scheduled the operation can execute it, with byte-identical args, including `ref_hash`.
- **Target behaviour (user docs, source of truth since #1747):** a repayment reversal executes at once for the Risk Council; every other Risk Council action waits 24 h. See `docs/user-docs/governance/risk-committee.md` (L9, L28), `docs/user-docs/governance/multisig-roles.md` (L16, L71) and `docs/user-docs/how-it-works/protocol-layer.md` (L64-65).
- **Deployment gap (#1756, backend):** the current deployment time-locks the whole `RISK_COUNCIL` role (testnet `can_call` returns delay 86400 for `reverse_repay`). Until #1756 lands, the reversal needs schedule → wait → execute.
- **Roles:** the Risk Council operates the reversal. The Trustee role cannot reverse a repayment (`docs/user-docs/governance/fiduciary-trustee.md` L28). The corrected `Minter.repay` stays with the Cash reporter (`CASH_REPORTER`).
- **Consequence: the UI is driven by on-chain `can_call(caller, minter, "reverse_repay")`**, and both paths are built and tested:
  - **Immediate** (`immediate: true`, the documented target): one signature by the Risk Council wallet. Because the Minter's owner is the AccessManager, "direct" still means `AM.execute(minter, "reverse_repay", args, caller)` with no prior schedule. A bare `Minter.reverse_repay` call from an account would fail `#[only_owner]`. Same stage callbacks as `repay`.
  - **Delayed** (`delay > 0`, today's deployment): the Risk Council wallet calls `AM.schedule`. After the delay (and within 7 days), the same wallet calls `AM.execute`.
  - Then a `CASH_REPORTER` wallet signs the corrected `Minter.repay`.

  The execute step and the corrected repay can run back to back, which is what limits the sPLUSD price dip described in the spec. The issue's "UI may only prepare the transaction for the owner to sign" is superseded: the AM relay is the owner path, and the app can drive it.
- Read-only on-chain data available for display, shown verbatim (no client math):
  - Registry `repayment_data(loan_id, repayment_id) -> RepaymentData`, readable after reversal too.
  - Registry `is_repayment_reversed(loan_id, repayment_id) -> bool`.
  - Registry `mutable_loan_data(loan_id).next_repayment_id`.
  - Minter `repayment(loan_id, repayment_id) -> Repayment { cash: i128, principal: i128, interest_minted: i128, fee_shares: i128, carved_out: bool, sale_id: u32, reversed: bool }` (`types.rs:130-142`). These are exactly the reversal effects:
    - `cash` leaves `bank_cash`;
    - `fee_shares` are burned from the treasury;
    - `interest_minted` is absorbed from the vault, or, when `carved_out`, unreleased in the Pocket together with `principal`.

### EVM

- `src/minter/MinterUpgradeable.sol:331` has `reverseRepay(uint256 loanId, uint256 repaymentId, bytes32 refHash) external restricted`, in the `MINTER_OPS_ROLE` selectors (`script/roles/SetupMinterOperators.sol:31`, granted with `minterOpsDelay`).
- `:285` has `repay(uint256 loanId, ILoanRegistry.RepaymentData repaymentData, uint64 valueDate, bytes32 refHash, uint256 saleId) restricted whenNotPaused returns (uint256)`. Its `RepaymentData` tuple order is `offtakerReceived, seniorPrincipalRepaid, seniorInterest, equityDistributed, mgmtFee, perfFee, oetAlloc` (`ILoanRegistry.sol:55-63`).
- `@pipeline/wallet-connect` already depends on `viem` (`package.json:24`) but has no EVM contract module. There is no EVM write client: #1573 is open and `blocked`, and TD-151 / TD-152 apply.

**Decision:** pure calldata encoders for EVM `reverseRepay` and `repay` (`viem.encodeFunctionData` over a minimal ABI) **are in scope**, with round-trip tests. There is no EVM hook, no send, and no UI arm. EVM loans keep the existing `stellarOnlyActionReason` gate. Whether a delayed `MINTER_OPS_ROLE` needs EVM `AccessManager.schedule` is a deployment fact for the follow-up. **Follow-up:** "Trustee: EVM arm of repayment recovery (reverseRepay / repay signing)", blocked on #1573 / TD-152. The manager files it; the coder adds a pointer in TD-152.

### Data sources for the UI

- Eligibility comes from backend fields, as in the spec's "Affected loan" table:
  - `/financials.offtaker_outstanding` is `0` (`useLoanFinancials`);
  - loan-book `senior_outstanding` is `> 0` (`useLoanBook`);
  - `onchain_status` is in `Performing | WatchList | Default`.
- `GET /v1/audit-log` details:
  - `PaymentRecorded` carries only `senior_interest` and `senior_principal_repaid`, with no `repayment_id`;
  - `CashRepaid` carries `repayment_id, sale_id, value_date, fee_shares, cash, interest_minted`;
  - `CashRepaymentReversed` carries `repayment_id, cash`.

  The full split therefore comes from the registry read, not the API.
- **Corrected split (decided):** the user docs say a repayment "is applied by the priority of payments, booked on-chain and split into senior principal, senior interest, fees and the equity distribution" (`docs/user-docs/start-here/reference-transaction.md` L79). So step 2 uses the backend waterfall:
  - `GET /v1/loan-book/{id}/waterfall?amount=&as_of=&chain_id=` (`useLoanWaterfall`);
  - `amount` = the original `offtaker_received` (on-chain `repayment_data`, verbatim);
  - `as_of` = the original `CashRepaid.value_date` from the audit log;
  - mapped by the already exported `buildRepaymentInput` (`routes/-record-repayment.ts:92`), the same path Record Repayment uses;
  - `repay` is sent with that original `value_date`. If no `value_date` is found, step 2 is disabled with explanatory copy.
- Signing step 2 reuses `useRecordPayment` (`api/useRecordPayment.ts`, #1712) unchanged.

## Scope

In scope:

1. **`@pipeline/wallet-connect`, Stellar:**
   - `reverse_repay` arg encoding plus a deterministic `ref_hash`;
   - a generic AccessManager relay (`schedule` / `execute`, with simulate → sign → submit → poll and stage callbacks); `execute` alone is the immediate path;
   - read-only readers for `can_call`, the operation schedule, Minter `repayment`, registry `repayment_data` and `is_repayment_reversed`;
   - `reverseRepay` wrappers: `scheduleReverseRepay`, `executeReverseRepay` (used both for the immediate path and after a schedule).
   - Existing `repay` / `encodeRepayArgs` / `repaymentRefHash` / `readNextRepaymentId` are reused unchanged.
2. **`@pipeline/wallet-connect`, EVM:** calldata encoders only (see the decision above).
3. **Trustee:** a "Repayment recovery" card on the loan detail page and a two-step dialog: pick the repayment, see its effects, reverse it (Risk Council wallet: one signature when `can_call` is immediate, schedule then execute when delayed), then sign the corrected repayment (Cash reporter wallet). Each step is gated by the connected wallet's on-chain `can_call`; a Trustee-only wallet can open the dialog but cannot reverse. Also link to it from the existing Record Repayment senior-outstanding notice.
4. Tests, specs, the frontend flow doc and a user-stories doc.

Out of scope:

- EVM signing and UI (follow-up above).
- Cancelling a scheduled reversal. `AM.cancel` is admin or guardian only for others. Note it in the spec.
- Any backend, API or indexer change. The indexer already handles `CashRepaymentReversed` and `PaymentUnrecorded`.
- Removing the `RISK_COUNCIL` delay for `reverse_repay` (backend/deployment, #1756).
- Role grants. Who holds `RISK_COUNCIL` / `CASH_REPORTER`, and whether that account is in the API's `auth_users` trustee allow-list, are deployment facts.
- Risk Council pages (mocked; unrelated).

## Assumptions and Risks

- **Timelock (delayed path only, until #1756):** 24 h on every configured network for `RISK_COUNCIL` today. Once #1756 removes the delay for `reverse_repay`, `can_call` returns `immediate: true` and the UI takes the single-signature path with no code change.
  - On the delayed path, the UI must survive reloads between scheduling and executing without local state. That works because the operation id is reproducible from on-chain data:
    - `caller` is the connected wallet;
    - `args` are `[loan_id, repayment_id, ref_hash]`;
    - `ref_hash = sha256("pipeline:reverse_repay:{minterId}:{loanId}:{repaymentId}")`, unique because a repayment reverses at most once.
  - The UI reads `hash_operation` and then `get_schedule`. No `localStorage`.
- **Two wallets.** The Risk Council key must be able to sign into the trustee app (API `auth_users` with the `trustee` role). If not, step 1 cannot run from the app. This is a deployment requirement, recorded in the spec.
- **"Ready" check without client clock math.** The UI shows the on-chain ready timestamp verbatim, formatted as a date and time. "Execute" is always enabled while a schedule exists. A not-yet-ready attempt fails at simulation with AM `#7 OperationNotReady`; map that code to copy in the dialog only, not in global `SOROBAN_ERROR_COPY`, because codes collide across contracts.
- **Indexing lag between steps.** Step 2's waterfall depends on the backend snapshot reflecting the reversal. Gate step 2 on all three of:
  - Minter `repayment(...).reversed === true` on chain;
  - `/financials.offtaker_outstanding > 0`;
  - the waterfall query resolving.

  Invalidate and refetch with the same 0 / 5 s / 15 s pattern as `useRecordPayment`.
- **Card visibility after step 1.** Once reversed, the loan is no longer "eligible" by the backend rule (offtaker outstanding > 0). The card must stay visible in an "awaiting corrected repayment" state. On-chain rule: the latest repayment id (`next_repayment_id − 1`) has `is_repayment_reversed = true`. Only read this for Stellar loans in `Performing..Default`. That costs two simulations per detail view, so keep it under one React Query key with `staleTime`.
- **No end-to-end testnet run is possible** (`next_loan_id = 0`, TD-157: no trustee `Minter.disburse`). Verification is unit tests plus read-only simulations, the same as #1712.
- **`bank_cash`.** `reverse_repay` reverts `#8` when `bank_cash < cash`. The simulation surfaces it through `toUserError` and View details.
- **Carved-out loans.** `pocket_unrelease` reverts `AlreadyClaimed` once a holder has claimed. The simulation surfaces it, and the spec's fallback (Risk Council Default) applies.
- **Mint budget.** Step 2 consumes `interest + fees` budget again (`#22` / `#23`). This is surfaced the same way.
- **Lint baseline.** `packages/trustee/src/routes/loans.$id.tsx` is in `scripts/lint-comments.baseline.json:854`. Touching it means shrinking its entry, and removing narrative comments in the touched blocks only.

## Open Questions

_None_

Open Question 1 (corrected split source) was decided by the user on 2026-10-28: backend waterfall with the original `offtaker_received` and value date, per `docs/user-docs/start-here/reference-transaction.md`. See Findings, "Corrected split".

## Implementation Steps

1. **wallet-connect: shared read helper.** Readers are being added, so extract a private `simulateRead(contractId, fn, args, { rpcUrl, networkPassphrase })` into `packages/wallet-connect/src/stellar/contracts/simulateRead.ts`.
   - It uses `READ_SIMULATION_SOURCE` from `stellar/sacBalance.ts:48`.
   - It throws `${fn} simulation error: …` and returns `scValToNative(retval)`.
   - Refactor `readNextRepaymentId` (`loanRegistry.ts:942`) onto it. Behaviour and tests stay unchanged.
2. **wallet-connect: registry readers** in `stellar/contracts/loanRegistry.ts`:
   - `readRepaymentData({ registryId, loanId, repaymentId, rpcUrl, networkPassphrase }): Promise<RepaymentInput>` returns raw u128 values as decimal strings.
   - `readIsRepaymentReversed(...)`: Promise<boolean>.
3. **wallet-connect: AccessManager relay.** New file `stellar/contracts/accessManager.ts`, with one spec-pointer header to `docs/product-specs/loan-repayment-recovery.md`:
   - `readCanCall({ accessManagerId, caller, target, fn, ... }): Promise<{ immediate: boolean; delay: number }>`.
   - `readOperationSchedule({ accessManagerId, caller, target, fn, args: xdr.ScVal[], ... }): Promise<{ operationId: string; readyAt: number }>`. It calls `hash_operation` and then `get_schedule`. `readyAt` is the raw u64 seconds, and `0` means none.
   - `buildRelayEnvelope({ accessManagerId, mode: "schedule" | "execute", caller, target, fn, args, rpcUrl, networkPassphrase })`:
     - `schedule` builds `schedule(Address target, Symbol fn, Vec args, u64 0, Address caller)`;
     - `execute` builds `execute(Address target, Symbol fn, Vec args, Address caller)`;
     - both follow the `buildCloseLoanEnvelope` pattern (`loanRegistry.ts:1053`): getAccount(caller) → simulate → `assembleTransaction`. A simulation failure throws `${mode} simulation error: …`.
   - `relay(params & { signTransaction, onStageChange })`: Promise<{ hash: string }>. Stages are `RecordWireInStage`.
4. **wallet-connect: Minter `reverse_repay`** in `stellar/contracts/minter.ts`, reusing `hexToBytes32ScVal` and `ZERO_REF_HASH`:
   - `encodeReverseRepayArgs({ loanId, repaymentId, refHash }) → [u32, u32, BytesN<32>]`. It validates integer ids ≥ 0 and rejects the zero hash. The spec asks for a fresh non-zero hash; the zero hash would also skip the replay record.
   - `reverseRepayRefHash({ minterId, loanId, repaymentId })` returns lowercase 64-hex `sha256("pipeline:reverse_repay:{minterId}:{loanId}:{repaymentId}")`, sharing a private digest helper with `repaymentRefHash`.
   - `readMinterRepayment({ minterId, loanId, repaymentId, ... })` returns `{ cash, principal, interestMinted, feeShares }` as raw decimal strings, plus `carvedOut`, `saleId` and `reversed`.
   - `scheduleReverseRepay(params)` and `executeReverseRepay(params)` are thin wrappers over `relay` with `target = minterId` and `fn = "reverse_repay"`.
   - `readReverseRepaySchedule(params)` wraps `readOperationSchedule`.
   - Keep the file's single `// spec:` header (repoint or extend it to `loan-repayment-recovery.md`). No other comments.
5. **wallet-connect: EVM calldata.** New file `packages/wallet-connect/src/evm/contracts/minter.ts`:
   - a minimal `as const` ABI for `reverseRepay(uint256,uint256,bytes32)` and `repay(uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256),uint64,bytes32,uint256)`;
   - `encodeEvmReverseRepayCalldata({ loanId, repaymentId, refHash }): Hex`;
   - `encodeEvmRepayCalldata({ loanId, repayment: RepaymentInput, valueDate, refHash, saleId = 0 }): Hex`. It maps snake_case `RepaymentInput` to the tuple in contract order, with raw base-unit strings passed as `BigInt` verbatim (no rescaling).
   - Both reject the zero hash and a malformed `0x`+64-hex hash.
6. **wallet-connect exports** (`src/index.ts`): the new functions and types above. Grep for name collisions with the existing `repay` exports.
7. **Trustee: env.** No new variable. Use `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` (the AccessManager), `STELLAR_YIELD_MINTER_ID` and `STELLAR_LOAN_REGISTRY_ID`. A missing value gives the existing "not configured for this environment" copy.
8. **Trustee: hooks.** New file `packages/trustee/src/api/useRepaymentRecovery.ts`, with one spec-pointer header.
   - `useRecoveryCandidates(chainId, loanId, enabled)` (React Query, key `["repayment-recovery", chainId, loanId]`):
     - read `readNextRepaymentId`;
     - for each id `0..next-1`, read `readRepaymentData`, `readIsRepaymentReversed` and `readMinterRepayment`;
     - return rows verbatim plus `latestReversed` (whether the last id is reversed).
     - Enabled only for Stellar loans (`stellarOnlyActionReason(chainId) === null`) with `onchain_status` in `Performing | WatchList | Default`.
   - `useReverseRepayAccess(loanId, repaymentId)` reads `readCanCall` for the connected wallet on `(minter, "reverse_repay")` and `(minter, "repay")`, and `readReverseRepaySchedule`.
   - Two mutations: `useScheduleReverseRepay` and `useExecuteReverseRepay`.
     - Wallet guard as in `useRecordPayment`.
     - `refHash` from `reverseRepayRefHash`.
     - Expose `stage`.
     - On success, invalidate `repayment-recovery`, the access/schedule key, `loan-book`, `loan-financials`, `loan-waterfall` and `audit-log`, with re-invalidation at 5 s and 15 s.
   - Step 2 calls the existing `useRecordPayment().mutateAsync({ loanId, repayment, valueDate })`. Do not duplicate it.
9. **Trustee: presenter.** New file `packages/trustee/src/routes/-repayment-recovery.ts`, pure and unit-testable:
   - `isRecoveryEligible({ offtakerOutstanding, seniorOutstanding, onchainStatus })` uses the backend strings: offtaker is `0`, senior is `> 0`, status is in range. These are comparisons only, no arithmetic.
   - `recoveryCardState`: `"hidden" | "eligible" | "awaiting-corrected-repayment" | "blocked-evm"`, from the eligibility and `latestReversed`.
   - `candidateRows(rows)`: all non-reversed repayments with on-chain fields formatted from raw units by `chainAmountDecimals` (display formatting only). Rows with `senior_principal_repaid === "0"` and `equity_distributed !== "0"` are listed first and preselected.
   - `reversalEffects(minterRepayment)`: labelled rows, verbatim:
     - "Cash removed from bank" = `cash`;
     - "Treasury fee shares burned" = `fee_shares`, shown as raw share units;
     - if `carved_out`: "Pocket unrelease: principal / interest" = `principal`, `interest_minted`;
     - otherwise "Interest absorbed from the vault" = `interest_minted`.
   - `reverseAction(access, schedule)`: `"execute-now"` (`immediate: true`, single signature, the documented target) | `"schedule"` (delay > 0 and `readyAt === 0`) | `"execute-scheduled"` (`readyAt > 0`) | `"no-role"` (not a Risk Council member, e.g. a Trustee-only wallet). On the immediate path the schedule read is skipped. The delay and `readyAt` are rendered verbatim, as hours and a UTC date-time.
   - `correctedRepaymentInput(original, waterfall)` delegates to `buildRepaymentInput` imported from `./-record-repayment`. Do not re-implement it.
   - `originalValueDate(auditItems, chainId, loanId, repaymentId)` finds the `CashRepaid` row's `details.value_date`, or `null`.
10. **Trustee: UI.** No Figma. Follow the existing dialog shell (`DisbursementConfirmDialog` in `loans.$id.tsx:611`, `-RejectReasonDialog.tsx`) and `DetailCard` / `KeyValueRow` / `BandButton` components.
    - New `packages/trustee/src/routes/-RepaymentRecoveryDialog.tsx`:
      - Step 1:
        - repayment radio list;
        - original split (key-value rows);
        - reversal effects;
        - the role state line (for example "Risk Council: reverses at once", "Risk Council: 24 h delay on this deployment", "Scheduled — executable from <date>", or "Only the Risk Council can reverse a repayment");
        - the primary button "Reverse repayment" (immediate) / "Schedule reversal" / "Execute reversal";
        - stage text and an `InlineError` with `toUserError` plus View details;
        - dialog-local copy for AM codes #6, #7 and #8 and Minter #8, #25.
      - Step 2, enabled per the gate in Risks:
        - corrected split rows from the waterfall;
        - original `value_date`;
        - "Record corrected repayment" (needs the Cash reporter role, `CASH_REPORTER`; otherwise "Only the Cash reporter can record the corrected repayment").
        - On success, show the hash and close. The close checklist on Record Repayment then applies.
    - In `loans.$id.tsx`, add a `RepaymentRecoveryCard` (title "Repayment recovery", one muted line and an "Open recovery" button) in the performing and watchlist layouts, after `OtherActionsCard`, when `recoveryCardState !== "hidden"`. For EVM loans, show `detail.onChainBlockedReason` with the button disabled. Wire the dialog open state like `confirmOpen`. Shrink the file's lint baseline entry.
    - In `loans.$id_.record-repayment.tsx`, change the `record-repayment-senior-outstanding` notice's trailing "Escalate to the Risk Council." to a link to the loan detail page ("Open repayment recovery"). Search param `chain` is preserved.
11. **Logging.**
    - `docs/exec-plans/tech-debt-tracker.md`: amend TD-152 with the EVM recovery arm (calldata encoders exist in `evm/contracts/minter.ts`; signing is blocked on #1573).
    - Add a TD: there is no UI to cancel a scheduled `reverse_repay`.

## Test Strategy

- **`packages/wallet-connect/src/stellar/contracts/minter.test.ts`** (extend):
  - `encodeReverseRepayArgs`: 3 args with types `u32, u32, bytes(32)`; it rejects a negative or non-integer id, malformed hex and the zero hash.
  - `reverseRepayRefHash`: deterministic, 64 lowercase hex, changes with each input. Pin a vector, for example `pipeline:reverse_repay:CMINT:7:0`.
  - `readMinterRepayment`: maps the simulated struct to strings and booleans; throws on a simulation error.
  - `scheduleReverseRepay` / `executeReverseRepay` (both paths: `executeReverseRepay` alone for the immediate path, and after `scheduleReverseRepay` for the delayed path):
    - call `schedule` / `execute` on the AccessManager id;
    - `target` is the Minter, `fn` is the `reverse_repay` symbol, and the args vec equals `encodeReverseRepayArgs`;
    - `when = 0` for `schedule`;
    - `caller` is the tx source;
    - stage order;
    - ERROR send or non-SUCCESS poll throws.
- **`accessManager.test.ts`** (new): `readCanCall` parsing; `readOperationSchedule` (hash_operation, then get_schedule; `0` passes through); relay envelope arg layout for both modes; empty-id guards.
- **`loanRegistry.test.ts`:** `readRepaymentData` (sorted map to strings), `readIsRepaymentReversed`, and `readNextRepaymentId` still passing after the `simulateRead` refactor.
- **`packages/wallet-connect/src/evm/contracts/minter.test.ts`** (new):
  - the selector equals `toFunctionSelector("reverseRepay(uint256,uint256,bytes32)")` and the repay tuple signature;
  - `decodeFunctionData` round-trips every field in contract tuple order, with raw values unchanged;
  - zero and malformed hashes are rejected.
- **Trustee presenter** `routes/-repayment-recovery.test.ts`:
  - eligibility truth table (offtaker `0` and senior `0`, `>0` and `>0`, status `Closed` or `Approved`);
  - card state, including `awaiting-corrected-repayment` and `blocked-evm`;
  - candidate ordering and preselection;
  - effect rows for carved-out and non-carved-out loans, with values verbatim and nothing summed;
  - all four `reverseAction` states, including immediate (`execute-now`) and delayed;
  - `originalValueDate` found and missing;
  - `correctedRepaymentInput` equals `buildRepaymentInput`'s output.
- **Trustee hooks** `api/-useRepaymentRecovery.test.tsx`:
  - mock the wallet-connect readers and relays;
  - the "not configured" and "wallet not connected" guards;
  - the derived `refHash` is passed to both schedule and execute;
  - invalidation keys and timing;
  - candidates disabled for an EVM chain.
- **Trustee UI** `routes/-RepaymentRecoveryDialog.test.tsx` and additions to `-loans.$id.test.tsx`:
  - the card is hidden for a healthy loan, shown for an eligible one, shown in the awaiting state, and disabled with the EVM reason;
  - immediate path (`can_call` immediate): one "Reverse repayment" click calls `executeReverseRepay` with no schedule read or call, stages render, then step 2 unlocks per the gate;
  - delayed path:
    - schedule (delay wallet), then a reload shows the scheduled state from mocked `readyAt`;
    - execute, then step 2 stays disabled until the reversed flag plus backend `offtaker_outstanding > 0`;
    - then `useRecordPayment.mutateAsync` receives `{ loanId, repayment: <waterfall-mapped>, valueDate: <original> }`;
  - a no-role wallet (Trustee-only) gets the "Only the Risk Council…" line and a disabled reverse button; a wallet without `CASH_REPORTER` gets a disabled step-2 button;
  - simulation error copy for AM #7.
- **`-record-repayment-page.test.tsx`:** the senior-outstanding notice links to the loan detail page.
- **Commands:**
  - `yarn workspace @pipeline/wallet-connect test`
  - `yarn workspace @pipeline/trustee test`
  - `yarn build` in both packages
  - `npx tsx scripts/lint-docs.ts`
  - `npx tsx scripts/lint-comments.ts`
- **Manual (staging, human-run, once a disbursed Stellar loan exists):**
  - read-only: `simulateTransaction` of `schedule(minter, reverse_repay, …)` from the `RISK_COUNCIL` wallet passes the role check;
  - the dialog shows the Minter `repayment` values matching `stellar contract invoke … repayment`.

## Docs to Update

- **`docs/product-specs/loan-repayment-recovery.md`:**
  - Roles table, Stellar row: `reverse_repay` is `#[only_owner]` and the owner is the AccessManager, so it is reached through `AM.execute`, role `RISK_COUNCIL`. Describe both paths:
    - target (user docs `governance/risk-committee.md`, `governance/multisig-roles.md`, `how-it-works/protocol-layer.md`): the reversal executes at once, one `AM.execute` signature;
    - current deployment: the whole role is time-locked (86400 s), so `AM.schedule` → wait → `AM.execute` by the same caller, expiry 7 days; deployment gap tracked in #1756.
  - Roles: the Risk Council operates the reversal; the Trustee role cannot (`governance/fiduciary-trustee.md`); the corrected repay stays with the Cash reporter. Replace "The Trustee cannot call Stellar `reverse_repay`" with this.
  - Record the testnet read-only check.
  - Step 1: the app's `ref_hash` derivation.
  - Step 2: the backend waterfall at the original `offtaker_received` and `value_date`, citing `user-docs/start-here/reference-transaction.md` (priority of payments), and the original `value_date` sent to `repay`.
  - "Current gap": replace with the shipped UI and the EVM follow-up.
- **`docs/product-specs/loan-repay-minter.md`:** link the recovery flow; EVM line: calldata encoders exist, signing is still TD-152.
- **`docs/product-specs/loans-data.md`:** add a Minter `reverse_repay(loan_id: u32, repayment_id: u32, ref_hash: BytesN<32>)` bullet next to `repay`, with `RISK_COUNCIL` via AM and the time lock, plus EVM `reverseRepay(uint256,uint256,bytes32)` / `MINTER_OPS_ROLE`.
- **`docs/frontend/trustee-flows.md`:**
  - new subsection under "Loan detail" / "Wired actions", "Repayment recovery (#1711)": card states, dialog steps, gating by `can_call` (Risk Council reverses, immediate or scheduled; Cash reporter records the corrected repayment; Trustee-only wallets cannot reverse), schedule persistence via `hash_operation` / `get_schedule`, the step-2 gate, error copy, and the EVM gate;
  - update the `record-repayment-senior-outstanding` paragraph (L782) to mention the link.
- **`docs/user-stories/epic-1521/1711-repayment-recovery.md`** (new, shaped like `1712-trustee-repay-via-minter.md`). Stories:
  1. An eligible loan shows the card, and a healthy loan does not.
  2. A Risk Council wallet with immediate access reverses with one signature.
  3. On a delayed deployment (#1756 open), a Risk Council wallet schedules and after a reload sees the ready time; executing before it shows the not-ready error.
  4. After execution and indexing, a cash-reporter wallet records the corrected repayment, and the close checklist turns green.
  5. A wallet without either role sees disabled actions.
  6. An EVM loan shows the Stellar-only reason.
- **`docs/exec-plans/tech-debt-tracker.md`:** TD-152 amendment, and a new TD for cancelling a scheduled reversal (step 11).

## Progress

All implementation steps (1-11) and the Docs to Update list are completed.

Deviations from the plan:

- `simulateRead` takes an optional `label` so `readNextRepaymentId` keeps its existing error text.
- `useRecoveryCandidates(chainId, loanId, onchainStatus)` derives `enabled` itself; `RECOVERY_STATUSES` and `RecoveryRow` live in `api/useRepaymentRecovery.ts` to keep `api` independent of `routes`.
- Dialog state and the card view live in an extra file, `routes/-useRepaymentRecoveryDialog.ts` (route `.tsx` stays render-only).
- Step 2 keeps the recorded hash in dialog-local state (`useRecordPayment` exposes no data).
- Dialog-local AM error copy for #9 (already scheduled) and Minter #25 added; AM #8 and Minter #8 collide on `execute`, so one combined message covers both.
- The new debt entry is TD-159.
