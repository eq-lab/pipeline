# Issue #1712: Trustee records repayments via LoanRegistry.record_payment, but the Stellar registry accepts it only from the Minter

Source: https://github.com/eq-lab/pipeline/issues/1712

Branch: `fix/1712-trustee-repay-via-minter` (draft PR #1719). No parent epic. The user-stories doc goes under `docs/user-stories/epic-1521/`, next to the #1655 / #1661 material.

## Findings (research done at planning time, 2026-10-27)

### 1. Contract code: who may call `record_payment` / `recordPayment`

Sources are shallow clones of `eq-lab/pipeline-stellar-contracts` @ `ee87852` (2026-10-27) and `eq-lab/pipeline-contracts` @ `3b74e98`. There is no local checkout next to this repo.

**Stellar**
- `contracts/loan-registry/src/lib.rs:271-273`. `record_payment(e, loan_id: u32, repayment: RepaymentData) -> (u32, bool)` starts with `store::minter(e).require_auth()`. Only the Minter contract can satisfy that, by being the direct invoker. No account signature can.
- `contracts/access-manager/src/lib.rs:384-408`. The trustee's "executor" (`execute`) calls `caller.require_auth()` and checks `can_call(caller, target, function)`, then `e.invoke_contract(target, …)`. The invoker of `record_payment` is therefore the AccessManager, never the Minter. So the executor path cannot pass the registry's auth check even when the role check passes.
- `deployments/justfile:717,725-729`. `record_payment` is not mapped to any role, so it falls back to `ADMIN`. `draw_loan / update_mutable / rollover / close_loan` map to `TRUSTEE`. Minter `record_wire_in / repay / record_income` map to `CASH_REPORTER`.
- `contracts/minter/src/lib.rs:287-362` `repay(caller, loan_id, repayment, value_date: u64, ref_hash: BytesN<32>, sale_id: u32) -> u32`:
  - `ensure_can_call(caller, "repay")` checks `caller.require_auth()` and AccessManager `can_call` (`lib.rs:823-828`).
  - `consume_mint_ref`: the zero hash is refused (`MissingRef` #28) and a repeated hash is refused (`RefHashSeen` #7).
  - `apply_budget(interest + fees)` enforces `ExceedsTxLimit` #22 and `ExceedsWindowLimit` #23.
  - It books `bank_cash += offtaker_received − equity_distributed`, then calls `registry.record_payment`.
  - It mints the interest as PLUSD to sPLUSD, or to the Pocket when the loan is carved out. It mints the fees and stakes them for the treasury, then calls `factory_sync_debt`.
  - It emits `cash_repaid [loan_id]` carrying `{repayment_id, sale_id, cash, interest_minted, fee_shares, value_date, ref_hash}`.
  - Stellar `repay` has no `when_not_paused`.
- `sale_id = 0` means "not a collateral sale" (`docs/references/backend.md:311`).
- No `#[contracterror]` enum ships in the deployed Minter's spec. Codes come from source `contracts/minter/src/error.rs`: Unauthorized=4, RefHashSeen=7, ReceiverNotAuthorized=15, ExceedsTxLimit=22, ExceedsWindowLimit=23, MissingRef=28. The registry's codes are `NonExistentLoanId`=1 and `WrongCurrentStatus`=3.

**EVM**
- `src/PipelineLoanRegistry.sol:48-53`: `recordPayment` is `restricted`.
- `script/roles/SetupProtocolRoles.sol:30,51,54`: that selector maps to `PIPELINE_MINTER_ROLE`, which is granted only to the `PipelineMinter`.
- `src/minter/MinterUpgradeable.sol:285-306`: `repay(loanId, repaymentData, valueDate, refHash, saleId)` is `restricted whenNotPaused` and calls `loanRegistry.recordPayment`.
- `script/roles/SetupMinterOperators.sol:23,46-47`: `repay` maps to `MINT_CALLER_ROLE`.
- Conclusion: on both chains only the Minter can record a payment.

### 2. Testnet verification (read-only `simulateTransaction`, nothing submitted)

Setup:
- RPC `https://soroban-testnet.stellar.org`.
- Contract ids are the trustee's (`../argocd/pipeline/test.yaml` trustee block), matching `deployments/networks/testnet/addresses.json`:
  - AccessManager / "executor": `CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW`
  - LoanRegistry: `CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ`
  - Minter (`VITE_STELLAR_YIELD_MINTER_ID`): `CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK`
- Tool: Node with the repo's `@stellar/stellar-sdk@15.1.0` (`simulateTransaction` with auth modes). The `stellar` CLI is not installed.

Results:

| Check | Result |
|---|---|
| Deployed registry spec | `record_payment(loan_id: u32, repayment: RepaymentData) -> (u32, bool)` |
| Deployed Minter spec | `repay(caller: Address, loan_id: u32, repayment: RepaymentData, value_date: u64, ref_hash: BytesN<32>, sale_id: u32) -> u32`. This matches the issue. `ref_hash_seen`, `reverse_repay` are present. **No `mint_yield`.** |
| `registry.minter()` | `CAPL5WN3…AIFK` (the configured Minter) |
| `am.get_target_function_role(registry, record_payment)` | `ADMIN` |
| `am.get_target_function_role(minter, repay)` | `CASH_REPORTER` |
| `am.can_call(<any trustee>, registry, record_payment)` | `immediate: false` for all 4 configured trustee/cash-reporter accounts |
| `am.can_call(GCGQVOJ…, minter, repay)` / `has_role(CASH_REPORTER, GCGQVOJ…)` | `immediate: true` / `is_member: true` |
| `am.can_call(GC72TZ…, minter, repay)` (third configured trustee) | `immediate: false`: this trustee lacks `CASH_REPORTER` |
| **[A] Today's trustee call**: `am.execute(registry, "record_payment", [loan, rep], GCGQVOJ…)` | `HostError: Error(Contract, #1)` raised by the AccessManager = `AccessManagerError::Unauthorized`. **It fails before reaching the registry.** |
| [B] Direct `registry.record_payment` from GCGQVOJ…, `authMode: enforce` | `Error(Auth, InvalidAction)` "Unauthorized function call for address CAPL5WN3…AIFK", which is the registry's `minter.require_auth()` |
| [C] `minter.repay(caller=GCGQVOJ…, …, ref_hash=0xab…ab, sale_id=0)` | It passes the Minter's role and ref checks and reaches `record_payment` as the Minter. It then fails with registry `#1 NonExistentLoanId` (see the next row). |
| [C0] Same call with the zero `ref_hash` | Minter `#28 MissingRef` |
| [C-] `minter.repay(caller=GC72TZ…)` | Minter `#4 Unauthorized` |
| `registry.next_loan_id()` | `0`: the testnet registry currently holds **no loans**, and there were no registry or Minter events in the RPC's 7-day window. A fully successful `repay` simulation needs a drawn and disbursed loan (see Risks). |

**Verdict: confirmed.** Record Coupon and Record Repayment cannot succeed on the current Stellar contracts. They fail at simulation with `Error(Contract, #1)`, the page shows "Could not verify this action on-chain", and nothing is submitted. Even if the role were remapped, the registry would still reject the call because the Minter is not the invoker. `Minter.repay` signed by a `CASH_REPORTER` trustee wallet is the working path.

Reproduce without Node:

```bash
# today's trustee path. Expect Error(Contract, #1) from the AccessManager
stellar contract invoke --network testnet --source-account <trustee G…> --send=no \
  --id CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW -- \
  can_call --caller <trustee G…> --target CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ --function record_payment
# Minter path role check. Expect {"immediate":true,…} for a CASH_REPORTER wallet
stellar contract invoke --network testnet --source-account <trustee G…> --send=no \
  --id CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW -- \
  can_call --caller <trustee G…> --target CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK --function repay
```

### 3. What the trustee signs today

- `packages/trustee/src/api/useRecordPayment.ts:61-71` calls `recordPayment({ executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID, targetId: ENV.STELLAR_LOAN_REGISTRY_ID, caller, loanId, repayment })`.
- That reaches `packages/wallet-connect/src/stellar/contracts/loanRegistry.ts:1006-1053` (`buildRecordPaymentEnvelope`), which builds `execute(target, "record_payment", vec[u32 loan_id, map RepaymentData], caller)`.
- The pages call it from `routes/loans.$id_.record-coupon.tsx` and `routes/loans.$id_.record-repayment.tsx:233-240`, with `view.recordPaymentInput` from `-record-coupon.ts` / `-record-repayment.ts:88-117,341` (`buildRepaymentInput`).
- The `RepaymentData` encoding (`encodeRepaymentData`, `loanRegistry.ts:968-978`, a sorted-key u128 map) matches `contracts/loan-registry/src/types.rs:112-120` and can be reused unchanged.
- The wire-in precedent is `packages/wallet-connect/src/stellar/contracts/minter.ts` (`recordWireIn`). It is a direct Minter call with `caller` = the trustee wallet = the tx source. It uses `hexToBytes32ScVal` and a u64 `value_date`, and returns the id from `returnValue`. `repay` follows the same pattern.

### 4. `value_date`, `ref_hash`, indexer

- **`value_date`.** Both presenters expose `dateInput = todayDateInput()` (UTC `YYYY-MM-DD`). It is fixed to today, not editable (#916) (`-record-repayment.ts:39-41,260`, `-record-coupon.ts:260`). The waterfall is fetched with `asOf = null` (`useLoanWaterfall(chainId, loanId, amount, null)`), so there is no separate `as_of` to reuse. Use the UTC-midnight Unix seconds of `dateInput`. On-chain, `value_date` is only stored and emitted in `cash_repaid`; it is not validated.
- **`ref_hash`.**
  - The API has one convention, `ref_hash = sha256(payment_reference)` for LP bank deposits (`packages/api/src/routes/lp_bank_deposits.rs:264-272`, `packages/shared/src/lp_bank_deposit_repo.rs:15`). There is no repayment record in the API and no repayment reference field in the UI or Figma.
  - Nothing in the backend correlates a repayment by `ref_hash`. `list_repayment_mints` joins `CashRepaid` to `PaymentRecorded` by `tx_hash + loan_id + repayment_id` (`packages/shared/src/contract_logs_repo.rs:195-225`), and the audit log only displays it (`packages/api/src/routes/audit_log.rs:693`).
  - So the hash only has to be unique, non-zero and preferably idempotent. Plan: `sha256("pipeline:repay:" + loanRegistryId + ":" + loanId + ":" + nextRepaymentId)`, where `nextRepaymentId` is read from the registry's `mutable_loan_data(loan_id).next_repayment_id` (`types.rs:70-72`) just before building the transaction.
  - This makes a double submit of the same repayment slot fail with `RefHashSeen` instead of minting twice. The slot advances after every recorded payment, and reversed payments keep their ids, so a corrected re-record (#1655) gets a fresh hash. The registry id in the preimage keeps hashes unique across redeploys. See Open Question 1.
- **Indexer and API already consume the Minter path.**
  - `packages/worker/src/indexer/stellar/minter_parsers.rs:94` (`parse_cash_repaid`) and `parsers.rs:45,628` index `cash_repaid`.
  - `/financials.minted_yield` and `cumulative_yield_total` are built from `CashRepaid` joined to its same-transaction `PaymentRecorded` (`contract_logs_repo.rs:1052-1075`). The close checklist's "nothing to mint" depends on that.
  - A bare `PaymentRecorded` with no `CashRepaid` is excluded from minted yield. So the Minter path is also what the backend expects. No API or indexer change is needed.

### 5. Chain scope

- **Stellar: in scope.**
- **EVM: stays gated.** `stellarOnlyActionReason` (`packages/trustee/src/lib/targetChains.ts:37-42`) already blocks both Record pages for non-Stellar loans (TD-152; TD-151 for `draw_loan`; #1573/#1574). There is no EVM write binding in `wallet-connect` for any loan action. EVM `repay` (`MINT_CALLER_ROLE`) is the same shape and is recorded in the TD-152 suggested fix, but this issue does not build it.
- The per-network pages already take the chain from the route's `chain` search param, and the gate keeps it Stellar.

## Scope

In scope:
- **`@pipeline/wallet-connect` (Stellar).** Replace the dead registry `recordPayment` binding with a Minter `repay` binding:
  - build, simulate, sign, submit and poll the transaction, returning `{ hash, repaymentId }`
  - a read-only `next_repayment_id` reader
  - a deterministic `ref_hash` helper
- **Trustee.** `useRecordPayment` signs `Minter.repay` with:
  - `caller` = the connected wallet
  - `value_date` from the page date
  - `ref_hash` derived as above
  - `sale_id = 0`

  It is gated on `ENV.STELLAR_YIELD_MINTER_ID` and `ENV.STELLAR_LOAN_REGISTRY_ID` instead of the executor id. Both Record pages pass the value date. The payload (`RepaymentInput` from the waterfall, verbatim) is unchanged.
- **Tests** for the above.
- **Specs and docs** describing the Minter path, plus the on-chain check, recorded in the specs.

Out of scope:
- EVM arm (TD-152).
- Any backend, API or indexer change.
- A trustee on-chain `disburse` (see Risks).
- Repayment reversal UI (#1655 follow-ups).
- Changing which accounts hold `CASH_REPORTER` (a deployment fact for the contracts team).
- The other executor-based writes (`draw_loan`, `rollover`, `update_mutable`, `close_loan`). Those are mapped to `TRUSTEE` and are not affected.

## Assumptions and Risks

- **No end-to-end positive simulation was possible.** The testnet registry has `next_loan_id = 0`. Auth and ref behaviour are confirmed. Success also depends on:
  - the loan being `Performing..Default`, which requires the first `Minter.disburse` (`registry.disburse` moves `Approved → Performing`, `loan-registry/src/lib.rs:165-216`)
  - `repaid + principal ≤ disbursed`
  - the fee cap, interest ≤ accrued, and the Minter tx and window budget
- **On-chain disbursement.** The trustee app has no on-chain disbursement: "Disbursement complete" is DB-only (`docs/frontend/trustee-flows.md:570,608`). So a loan drawn from the trustee stays `Approved` on-chain, and `repay` reverts with registry `#3 WrongCurrentStatus` until someone calls `Minter.disburse` (`only_owner`, which means through the AccessManager, role `TRUSTEE`). This is pre-existing and also blocked the old path. The coder logs it in `docs/exec-plans/tech-debt-tracker.md` as a new TD ("Trustee has no on-chain Minter.disburse"). It is not built here.
- **Roles.** The trustee wallet must hold `CASH_REPORTER`. On testnet GCGQVOJ… does. GC72TZ… (listed under `access.trustee` in `deployments/networks/testnet/config.json`) does not, and would get Minter `#4`. This is surfaced through the generic error copy (see step 5). Record it as a deployment requirement in the specs.
- **Rate limits.** `interest + fees` count against the Minter's mint budget (testnet `tx_limit` 1e13 = $1,000,000 at 7 decimals). A large coupon can revert with `#22` or `#23`.
- **Stellar relayer Phase 4 (backend, not fixed here).**
  - `packages/worker/src/relayer/stellar/yield_mint.rs:110-160` signs `mint_yield` against `CHAIN_99000001_RELAYER_STELLAR_YIELD_MINTER_ID` = the same Minter `CAPL5…`, which has **no `mint_yield`**.
  - It discovers work from `PaymentRecorded` (`yield_mint_outbox_repo.rs:150-180`).
  - Once repayments actually land, every one will create an outbox row whose simulation fails ("non-existent contract function") on every cycle. It cannot double-mint, but it is noise and a stuck row.
  - The coder logs this in `docs/exec-plans/known-bugs.md` (backend, outside this frontend issue). EVM already deleted its phase for the same reason (TD at `tech-debt-tracker.md:1970`).
- **Possibly stale error mapping (unrelated).** `mintError` in `packages/trustee/src/routes/-useLpBankDeposits.ts:62` maps Minter code `13` to "no authorized PLUSD trustline". Current source has `13 = NonExistentRepayment` and `15 = ReceiverNotAuthorized`. Log it in `known-bugs.md`; do not fix it inline.
- **The pages' "Your key · no cash moves" chip** (`loans.$id_.record-coupon.tsx:248`, and the repayment page) stays true for USDC, since no token moves from the wallet. But the signature now mints PLUSD (interest to sPLUSD, fees to treasury) and books Minter `bank_cash` (Open Question 2).
- **Exports.** Removing `recordPayment` / `buildRecordPaymentEnvelope` / `encodeRecordPaymentArgs` and their types from `packages/wallet-connect/src/index.ts:125-138` is a breaking change for any other consumer. A grep shows only the trustee uses them; re-check before deleting.

## Open Questions

1. **`ref_hash` source.** The plan derives it deterministically as `sha256("pipeline:repay:{loanRegistryId}:{loanId}:{next_repayment_id}")`. This needs no UI change and is idempotent per repayment slot. Alternatively, should the trustee enter the offtaker's bank payment reference, hashed as `sha256(reference)` like LP wire-ins? That would add a form field that is not in Figma, and would make `ref_hash` traceable to the bank record. The plan proceeds with the deterministic hash unless told otherwise.
2. **Copy for the new side effects.** Recording now mints PLUSD (interest into sPLUSD, fees staked for treasury) and books bank cash in the same signature. Should the "Your key · no cash moves" chip and the "Record on the ledger" wording stay as they are, which the plan assumes (no USDC moves from the wallet), or change to say that recording mints yield?

## Implementation Steps

1. **wallet-connect: share the `RepaymentData` encoder.** In `packages/wallet-connect/src/stellar/contracts/loanRegistry.ts`:
   - Export `encodeRepaymentData` and keep the `RepaymentInput` type there.
   - Delete `RecordPaymentStage/Params/Result`, `encodeRecordPaymentArgs`, `buildRecordPaymentEnvelope` and `recordPayment` (`~L910-1118`).
   - Add `readNextRepaymentId({ registryId, loanId, rpcUrl, networkPassphrase }): Promise<number>`. It simulates `mutable_loan_data(u32 loan_id)` read-only, reusing the null-source pattern of `sacBalance.ts:42-130`, and returns `next_repayment_id`. It throws a clear error when the simulation fails, for example with registry `#1`.
   - Drop the long narrative block comment for the removed section, per the comment-minimal rule.
2. **wallet-connect: Minter `repay` binding.** In `packages/wallet-connect/src/stellar/contracts/minter.ts`, mirroring `recordWireIn`:
   - `RepayStage` (same three stages); `RepayArgs { caller, loanId, repayment: RepaymentInput, valueDate, refHash, saleId? = 0 }`.
   - `encodeRepayArgs(args): xdr.ScVal[]` → `[Address caller, u32 loan_id, encodeRepaymentData(repayment), u64 value_date, BytesN<32> ref_hash, u32 sale_id]`. Validate `valueDate` the same way as `encodeRecordWireInArgs`. Reject the all-zero hash before simulation (it would be Minter `#28`).
   - `buildRepayEnvelope({ minterId, rpcUrl, networkPassphrase, ...args })`: getAccount(caller) → `contract.call("repay", …)` → simulate → `assembleTransaction`. A simulation error throws `repay simulation error: …`, matching the `/simulation error/` shape that `toUserError` recognises.
   - `repay(params): Promise<{ hash: string; repaymentId: number | null }>`: sign, send, poll. The id comes from `returnValue` (u32), falling back to the `cash_repaid` event (topic `[cash_repaid, loan_id]`, `repayment_id` in data). Generalise `toWireId` / the event reader instead of duplicating it.
   - `repaymentRefHash({ registryId, loanId, nextRepaymentId }): Promise<string>` returns lowercase 64-hex `sha256` of `pipeline:repay:${registryId}:${loanId}:${nextRepaymentId}`, using `crypto.subtle.digest` (browser, and Node 20 in vitest).
   - Keep the file's single `// spec:` header and point it at `docs/product-specs/loans-data.md` (Minter `repay`) as well as the existing deposits anchor, or keep one pointer. No other comments.
3. **wallet-connect exports.** `packages/wallet-connect/src/index.ts`: remove the `recordPayment` group (`L125-138`). Export `repay`, `buildRepayEnvelope`, `encodeRepayArgs`, `repaymentRefHash`, `readNextRepaymentId`, `encodeRepaymentData`, and the `RepayStage/RepayArgs/RepayParams/RepayResult` types. Keep the `RepaymentInput` export. Then `grep -rn "recordPayment\|RecordPayment" packages --include='*.ts*'` to confirm no other consumer.
4. **Trustee hook.** `packages/trustee/src/api/useRecordPayment.ts`. Keep the hook name and return shape so the pages and the invalidation tests change minimally.
   - Input becomes `{ loanId, repayment, valueDate: number }`.
   - Guard `ENV.STELLAR_YIELD_MINTER_ID && ENV.STELLAR_LOAN_REGISTRY_ID`, keeping the "not configured for this environment" copy so `matchPreflightGuard` still applies. Keep the wallet-connected guard.
   - In `mutationFn`:
     - `nextRepaymentId = await readNextRepaymentId(...)`
     - `refHash = await repaymentRefHash(...)`
     - `repay({ minterId: ENV.STELLAR_YIELD_MINTER_ID, caller: address, loanId, repayment, valueDate, refHash, saleId: 0, rpcUrl, networkPassphrase, signTransaction, onStageChange: setStage })`
   - Keep the result type `{ hash, repaymentId }`. Stage type comes from `RepayStage`.
   - In `onSuccess`, keep the current invalidations: `loan-book` / `loan-financials` now, again at 5 s and 15 s, and `loan-waterfall`.
   - Replace the narrative JSDoc header with a single 2-3-line spec pointer (`docs/frontend/trustee-flows.md#cash-movement--lifecycle-actions`).
5. **Trustee presenters and pages.**
   - In `-record-coupon.ts` and `-record-repayment.ts`, add `valueDate: number` to the view model, from a pure exported helper `dateInputToValueDate(dateInput) = Date.parse(`${dateInput}T00:00:00Z`) / 1000`. Duplicate it per presenter, per the existing per-route duplication convention in `trustee-flows.md` "Architecture".
   - In `loans.$id_.record-coupon.tsx` and `loans.$id_.record-repayment.tsx` `onRecord`, pass `valueDate: view.valueDate`.
   - Remove the `{/* Confirm — trustee-wallet-signed on-chain record_payment (#884) … */}` narrative JSX comments in the touched blocks, per the comment-minimal rule.
   - Error copy stays `toUserError(record.error, "Failed to record this payment.")`. Contract codes collide across the Minter and the registry (a nested registry `#1` surfaces as `Error(Contract, #1)` too), so add **no** global `SOROBAN_ERROR_COPY` entries. The simulation-shape copy plus "View details" covers role, limit and status failures.
   - Do not change the chip copy unless Open Question 2 is answered otherwise.
6. **Lint baseline.** If any touched file is listed in `scripts/lint-comments.baseline.json`, shrink its entry.
7. **Logging (no inline fixes).**
   - `docs/exec-plans/known-bugs.md`: (a) the Stellar relayer Phase 4 `mint_yield` against a Minter without that function; (b) `mintError` code `13` vs `ReceiverNotAuthorized = 15`.
   - `docs/exec-plans/tech-debt-tracker.md`: (a) new TD, "Trustee has no on-chain `Minter.disburse`; trustee-drawn Stellar loans stay `Approved` on-chain, so `repay` reverts `WrongCurrentStatus`"; (b) amend TD-152's suggested fix so the EVM record arm is `PipelineMinter.repay` (`MINT_CALLER_ROLE`), not `LoanRegistry.recordPayment`.

## Test Strategy

- **`packages/wallet-connect/src/stellar/contracts/minter.test.ts`** (extend, mirroring the `recordWireIn` tests):
  - `encodeRepayArgs` returns 6 args in order with types `address, u32, map, u64, bytes(32), u32`. The map has sorted keys and u128 values. `sale_id` defaults to `0`.
  - It rejects a non-integer or non-positive `valueDate`, a malformed hex `refHash`, and the zero hash.
  - `buildRepayEnvelope`:
    - calls `repay` on `minterId` with `caller` as the tx source
    - throws `repay simulation error: …` on a simulation error
    - throws on an empty `minterId` or `caller`
  - `repay`: stages `awaiting-signature → submitting → confirming`; `repaymentId` from `returnValue`, with the `cash_repaid` event fallback; throws on ERROR send or a non-SUCCESS poll.
  - `repaymentRefHash` is deterministic, 64 lowercase hex, and changes with each of registryId, loanId and nextRepaymentId. Pin a known vector, for example sha256 of `pipeline:repay:CREG:7:0`.
- **`loanRegistry.test.ts`.** Delete the `recordPayment` / `encodeRecordPaymentArgs` / `buildRecordPaymentEnvelope` cases. Keep an `encodeRepaymentData` key-order test. Add `readNextRepaymentId` tests: it simulates `mutable_loan_data`, returns `next_repayment_id`, and throws on a simulation error.
- **`packages/trustee/src/api/-useRecordPayment.test.tsx`.** Mock `repay`, `readNextRepaymentId` and `repaymentRefHash`, and set the ENV mock to include `STELLAR_YIELD_MINTER_ID`. Assert:
  - `repay` gets `minterId`, `caller`, `loanId`, `repayment` verbatim, `valueDate`, the derived `refHash` and `saleId: 0`
  - the "not configured" guard when the Minter id or registry id is empty
  - the existing invalidation timing tests still pass
- **Presenter and page tests** (`-record-coupon-page.test.tsx`, `-record-repayment-page.test.tsx`, plus any presenter unit tests): `dateInputToValueDate("2026-10-27") === 1793059200`, and `onRecord` calls `mutateAsync` with `{ loanId, repayment, valueDate }`. The EVM-gated case still shows the blocked reason and never calls `mutateAsync`.
- **Commands:**
  - `yarn workspace @pipeline/wallet-connect test`
  - `yarn workspace @pipeline/trustee test`
  - the `tsc` builds for both (`yarn build` in each)
  - `npx tsx scripts/lint-docs.ts`
  - `npx tsx scripts/lint-comments.ts`
- **Manual (staging, human-run).** Use a Stellar loan that is `Performing` on-chain and a trustee wallet holding `CASH_REPORTER`.
  - Record a coupon. Freighter shows a `repay` invocation on `CAPL5…`.
  - After indexing, the audit log shows `CashRepaid` + `PaymentRecorded` in one transaction, and `/financials.minted_yield` rises.
  - A second identical submit before the slot advances fails at simulation.
  - Not runnable on testnet today without a disbursed loan (see Risks).

## Docs to Update

- **`docs/product-specs/loans-data.md`**:
  - `recordPayment` in the API block: callable only by the Minter (Stellar `minter.require_auth()`, EVM `PIPELINE_MINTER_ROLE`), reached through `Minter.repay`. Replace "TRUSTEE, no timelock".
  - Add a bullet next to the `record_wire_in` one for Stellar `repay(caller, loan_id, repayment: RepaymentData, value_date: u64, ref_hash: BytesN<32>, sale_id: u32) -> u32` and EVM `repay(loanId, repaymentData, valueDate, refHash, saleId)`. Cover: `CASH_REPORTER` / `MINT_CALLER_ROLE`; single-use non-zero `ref_hash`; mint budget; side effects (bank cash, interest mint, fee shares); the `cash_repaid` event; the trustee's `ref_hash` derivation; and that the trustee wallet needs `CASH_REPORTER`.
  - Rewrite the "pure accounting / cannot mint" security bullets (`L189-198`) to the Minter reality.
- **`docs/frontend/trustee-flows.md`** "Cash movement & lifecycle actions":
  - State that Record Coupon and Record Repayment sign `Minter.repay` (not the executor `record_payment`): `value_date` = UTC midnight of the page date, `ref_hash` derivation, `sale_id = 0`, and the env vars (`VITE_STELLAR_YIELD_MINTER_ID`, `VITE_STELLAR_LOAN_REGISTRY_ID`).
  - Rename "`record_payment` payload" mentions where they describe the transaction rather than the registry struct.
  - Keep the EVM gate statement (TD-152).
- **`docs/product-specs/loan-repayment-recovery.md:70`**: replace "This is code reading, not verified on chain" with the testnet verification summary (AccessManager `Unauthorized` on `execute(record_payment)`, and the registry's `minter.require_auth()`), and state that the trustee now uses `Minter.repay`.
- **Remove stale "Trustee calls `recordPayment` on LoanRegistry" role statements** in `docs/product-specs/smart-contracts-registry.md:13,23`, `docs/product-specs/smart-contracts.md:132,148`, `docs/product-specs/trustee-dashboard.md:74,183`, `docs/product-specs/yield.md:65` and `docs/product-specs/loans.md:169`. Point them to `Minter.repay` in `loans-data.md` (one-line edits; do not rewrite the legacy YieldMinter narrative wholesale). If a section is too entangled to fix in one line, log it as tech debt instead.
- **`docs/user-stories/epic-1521/1712-trustee-repay-via-minter.md`** (new, shaped like `1661-waterfall-error-mapping.md`). Stories:
  1. A coupon records through `Minter.repay`, and the audit log shows `CashRepaid` + `PaymentRecorded`.
  2. Repayment principal records the same way, and the close checklist's "nothing to mint" clears after indexing.
  3. A wallet without `CASH_REPORTER` gets the on-chain verification error with details, and no signature is requested.
  4. An EVM loan stays blocked.
- **`docs/exec-plans/known-bugs.md` and `docs/exec-plans/tech-debt-tracker.md`**: the entries listed in step 7.
