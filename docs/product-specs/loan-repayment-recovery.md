# Loan Repayment Recovery (mis-split coupon)

Procedure for a loan whose coupon was booked with the principal in `equity_distributed` (#1623, #1655). Contract facts below are read from `pipeline-contracts` (EVM) and `pipeline-stellar-contracts` (Stellar) source, not verified on chain.

## Affected loan

A loan is stuck when the API shows both:

| Source                                        | Field                  | Value                     |
| --------------------------------------------- | ---------------------- | ------------------------- |
| `GET /v1/loan-book/{id}/financials?chain_id=` | `offtaker_outstanding` | `0` (offtaker fully paid) |
| `GET /v1/loan-book?chain_id=` row of the loan | `senior_outstanding`   | `> 0`                     |

Also: `onchain_status` is `Performing`, `WatchList` or `Default` (not `Closed`), and the audit feed (`/v1/audit-log`, scope `Loan #<id>`) shows a `CashRepaid` whose `PaymentRecorded` has `senior_principal_repaid = 0` and `equity_distributed` covering the missing principal. Its `repayment_id` is the one to reverse. Symptoms: `close_loan` reverts, Record Repayment shows "fully repaid" ([trustee-flows.md](../frontend/trustee-flows.md)).

Do not call `LoanRegistry.unrecordPayment` / `unrecord_payment` directly: it is minter-only on both arms (Stellar `minter.require_auth()`; EVM role `PIPELINE_MINTER_ROLE` granted to the Minter), and on EVM bypassing the Minter would leave the minted yield and fee shares un-reversed.

## Roles

| Arm     | `reverse_repay`                                                                                                                                                                                         | `repay`                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| EVM     | `MinterUpgradeable.reverseRepay`, `restricted`, in the Minter ops selectors (`MINTER_OPS_ROLE`, `SetupMinterOperators.sol`)                                                                             | `repay`, `restricted`, in the mint selectors (`MINT_CALLER_ROLE`)                                    |
| Stellar | `reverse_repay(loan_id, repayment_id, ref_hash)`, `#[only_owner]`; the Minter's owner is the AccessManager, so it runs through `AM.execute(minter, "reverse_repay", args, caller)`, role `RISK_COUNCIL` | `repay(caller, ...)`, `ensure_can_call(caller, "repay")` via the AccessManager, role `CASH_REPORTER` |

The Risk Council operates the reversal; the Trustee role cannot reverse a repayment ([fiduciary-trustee.md](../user-docs/governance/fiduciary-trustee.md)). The corrected `repay` stays with the Cash reporter. A bare `Minter.reverse_repay` call from an account fails `#[only_owner]`. The scripts map selectors to roles only; which accounts hold `RISK_COUNCIL`, `CASH_REPORTER`, `MINTER_OPS_ROLE` or `MINT_CALLER_ROLE`, and whether the Risk Council wallet is in the API's `auth_users` trustee allow-list (needed to sign into the Trustee app), are deployment facts.

### Stellar: two paths to `reverse_repay`

| Path                          | When                                                                  | Calls                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Immediate (documented target) | `can_call(caller, minter, "reverse_repay")` returns `immediate: true` | one `AM.execute(minter, "reverse_repay", [loan_id, repayment_id, ref_hash], caller)` signature                                        |
| Delayed (current deployment)  | `can_call` returns `immediate: false, delay > 0`                      | `AM.schedule(minter, "reverse_repay", args, 0, caller)`, wait for the delay, then `AM.execute` with identical args by the same caller |

- The user docs set the target: a repayment reversal executes at once for the Risk Council, while every other Risk Council action waits 24 h ([risk-committee.md](../user-docs/governance/risk-committee.md), [multisig-roles.md](../user-docs/governance/multisig-roles.md), [protocol-layer.md](../user-docs/how-it-works/protocol-layer.md)).
- The current deployment time-locks the whole `RISK_COUNCIL` role (`risk_council` delay `86400` in `deployments/networks/*/config.json`; `deployments/justfile` maps `reverse_repay` to `RISK_COUNCIL`). The gap is tracked in #1756 (backend); once it lands `can_call` returns `immediate: true` and the immediate path applies with no app change.
- `when = 0` schedules at the earliest time (now plus the delay). The operation id (`hash_operation(caller, target, function, args)`) covers the caller and the args, so only the scheduling wallet can execute, with byte-identical args including `ref_hash`. An operation expires 7 days after it is ready. `AM.execute` before it is ready fails `OperationNotReady` (#7); with no schedule, `OperationNotScheduled` (#6); after expiry, `OperationExpired` (#8). A duplicate pending schedule fails `OperationAlreadyScheduled` (#9).
- Cancelling a scheduled reversal (`AM.cancel`) is admin or guardian only for others and is not in the app.
- Read-only testnet check (2026-10-28, `simulateTransaction`, nothing submitted): `get_target_function_role(minter, reverse_repay)` = `RISK_COUNCIL`; `get_target_function_role(minter, repay)` = `CASH_REPORTER`; `can_call(<Risk Council wallet>, minter, reverse_repay)` = `{ immediate: false, delay: 86400 }`.

## Step 1: Minter reverse

`reverseRepay(loanId, repaymentId, refHash)` (EVM) / `reverse_repay(loan_id, repayment_id, ref_hash)` (Stellar). `refHash` is single-use across the whole Minter: a repeat reverts (`MinterRefHashSeen` / `RefHashSeen`). The zero hash is accepted and not recorded, so use a fresh non-zero hash anyway; it must differ from the original `repay` hash and from the one used in step 2.

The Trustee app derives it as `sha256("pipeline:reverse_repay:{minterId}:{loanId}:{repaymentId}")` (lowercase hex). A repayment reverses at most once, so the hash is unique per repayment, and the delayed path can rebuild the same args after a reload (the app reads `hash_operation` then `get_schedule`; nothing is stored in the browser).

On-chain effects, in order:

1. Registry unrecord (`PaymentUnrecorded`): `repaid` and `outstandingTotal` get the recorded `seniorPrincipalRepaid` back (`0` for a mis-split payment), and the cumulative offtaker, interest and fee totals shrink by the recorded amounts. On Stellar the event carries the reversed `RepaymentData`; on EVM only `outstanding`.
2. Bank cash: the Minter's `bankCash` decreases by the original cash (`offtaker_received − equity_distributed`). It reverts (`MinterInsufficientBankCash`) when `bankCash` is smaller.
3. Fee shares: the capital wallet's `feeShares` (the contracts call the recipient `treasury`) are burned from sPLUSD (`burnShares`, then the PLUSD is burned). A shortfall against the booked fees (share value fell or rounded) is absorbed from the vault.
4. Interest: a non-carved-out loan absorbs the minted interest from the vault (`LossAbsorbed`, PLUSD pulled and burned; any part the vault cannot cover is added to `unabsorbedTotal`). A carved-out loan instead calls `Pocket.unrelease(loan, released, interest)`, which burns the interest in the Pocket.
5. Debt token: `syncDebt(loan)` on the DealTokenFactory (`DebtSynced`).
6. `CashRepaymentReversed(loan_id, repayment_id, cash, ref_hash)` is emitted last.

API and indexer: the registry snapshot is re-read, so `offtaker_outstanding` rises back and `senior_outstanding` rises by the recorded principal. `/financials.minted_yield` and `cumulative_yield_total` exclude the whole reversed repayment (interest and fees) via its `CashRepaymentReversed` row ([backend.md](../references/backend.md) "Minted yield", [yield-apy-semantics.md](./yield-apy-semantics.md)). The TVL ledger subtracts the fee-share burn: EVM `Withdraw` / Stellar `shares_burned`, indexed as `StakingWithdrawal` with `sender` = the Minter, in the reversal's transaction; the Pocket interest burn comes from the `CashRepaymentReversed` row ([dashboards-tvl-ledger.md](./dashboards-tvl-ledger.md)). The audit feed lists `PaymentUnrecorded` and `CashRepaymentReversed`.

## Step 2: Minter repay with the corrected split

`repay(loanId, repaymentData, valueDate, refHash, saleId)` / `repay(caller, loan_id, repayment, value_date, ref_hash, sale_id)` with the same total but principal booked as senior:

- `senior_principal_repaid` set to the principal that was mis-booked; `equity_distributed` reduced by the same amount (`0` for the usual mis-split). The Trustee app takes the split from the backend waterfall (`GET /v1/loan-book/{id}/waterfall`, the same path as Record Repayment) at the original `offtaker_received` (registry `repayment_data`, verbatim) and the original `value_date` (the `CashRepaid` audit row), since a repayment is "applied by the priority of payments, booked on-chain and split into senior principal, senior interest, fees and the equity distribution" ([reference-transaction.md](../user-docs/start-here/reference-transaction.md)). `repay` is sent with that original `value_date`; without one the step is disabled.
- Registry check (`_validateRepayment` / `validate_repayment`): `senior_principal_repaid + senior_interest + equity_distributed + mgmt_fee + perf_fee + oet_alloc = offtaker_received` exactly.
- `senior_interest` must not exceed the registry's accrued interest, and `mgmt_fee + perf_fee + oet_alloc` must not exceed `max_fee_bps` of `senior_interest + mgmt_fee + perf_fee`.
- `repaid + senior_principal_repaid + written_down` must not exceed `disbursed`; cumulative `offtaker_received` must not exceed `original_offtaker_price` (the reversal already removed the old amount).
- On `Default`, `equity_distributed`, `mgmt_fee`, `perf_fee` and `oet_alloc` must be `0`.
- `refHash` must be non-zero and unused; the call reverts when paused.
- The interest and fee mint passes the Minter rate limit again (`interest + fees` consumed a second time), so the budget must cover it.

Effects: `bankCash` increases by `offtaker_received − equity_distributed`, which now includes the principal that step 1 did not return to the bank. The operator must confirm that cash is physically in the bank account and was not paid out to equity. Interest PLUSD is minted to the vault (or the Pocket if carved out), fees are minted and staked for the capital wallet, the new repayment id gets a fresh `PaymentRecorded` and `CashRepaid`, and `senior_outstanding` falls so `close_loan` can pass its checklist.

## Limits and failure cases

- One reversal per repayment: a second `reverseRepay` of the same id reverts (`LoanRegistryRepaymentAlreadyReversed` / `RepaymentAlreadyReversed`, plus the Minter's own `reversed` flag). The corrected repayment has a new id and is reversible once itself.
- The registry unrecord needs a loan status of `Performing`..`Default` and an unpaused registry, so a `Closed` loan or a paused registry blocks recovery.
- A carved-out loan reverts in `Pocket.unrelease` once any holder has claimed from its Pocket (Stellar `AlreadyClaimed`; EVM Pocket check not read).
- `reverse_repay` needs the Minter's `bank_cash` to cover the original cash.
- If the procedure cannot run, the fallback is the Risk Council Default path ([trustee-risk-watchlist.md](./trustee-risk-watchlist.md)); it books a credit loss and burns PLUSD for principal that was actually paid, so use it only when recovery is impossible.

## LP share price

Step 1 absorbs the minted interest and burns the capital wallet's fee-share value, so sPLUSD share price drops by the reversed interest for the interval between the two steps; step 2 re-mints the interest to the vault and the price recovers by the same amount (fees go to the capital wallet, not LPs). Run both steps back to back, ideally in the same session, and expect transient dips in sPLUSD price, TVL and `cumulative_yield_total` that net out once the corrected `CashRepaid` is indexed.

## Trustee app

The loan detail page shows a "Repayment recovery" card for an eligible Stellar loan (offtaker outstanding `0`, senior outstanding `> 0`, `Performing`..`Default`), and keeps it after step 1 while the latest repayment is reversed on chain. The dialog reads each repayment from the registry (`repayment_data`, `is_repayment_reversed`) and the Minter (`repayment`), lists the non-reversed ones with the mis-split first, shows the reversal effects verbatim, and runs both steps. Each step is gated by the connected wallet's on-chain `can_call`; a Trustee-only wallet can open the dialog but cannot reverse. Details: [trustee-flows.md](../frontend/trustee-flows.md#repayment-recovery-1711). EVM loans keep the Stellar-only gate: pure calldata encoders for `reverseRepay` / `repay` exist in `@pipeline/wallet-connect` (`evm/contracts/minter.ts`), but there is no EVM signing path (TD-152, #1573).

## Why `record_payment` is not used

The Trustee UI used to record payments by `LoanRegistry.record_payment` through the executor. The Stellar loan-registry (`contracts/loan-registry/src/lib.rs`, `record_payment`, `unrecord_payment`) requires `store::minter(e).require_auth()`, so only the Minter can call them. Verified on Stellar testnet (2026-10-27, read-only `simulateTransaction`): `execute(record_payment)` fails with the AccessManager's `Error(Contract, #1)` before reaching the registry, and a direct registry call fails `Error(Auth, InvalidAction)` on the Minter auth. Record Coupon and Record Repayment sign `Minter.repay` ([loan-repay-minter.md](./loan-repay-minter.md), #1712).
