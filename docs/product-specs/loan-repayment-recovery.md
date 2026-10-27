# Loan Repayment Recovery (mis-split coupon)

Procedure for a loan whose coupon was booked with the principal in `equity_distributed` (#1623, #1655). Contract facts below are read from `pipeline-contracts` (EVM) and `pipeline-stellar-contracts` (Stellar) source, not verified on chain.

## Affected loan

A loan is stuck when the API shows both:

| Source | Field | Value |
|--------|-------|-------|
| `GET /v1/loan-book/{id}/financials?chain_id=` | `offtaker_outstanding` | `0` (offtaker fully paid) |
| `GET /v1/loan-book?chain_id=` row of the loan | `senior_outstanding` | `> 0` |

Also: `onchain_status` is `Performing`, `WatchList` or `Default` (not `Closed`), and the audit feed (`/v1/audit-log`, scope `Loan #<id>`) shows a `CashRepaid` whose `PaymentRecorded` has `senior_principal_repaid = 0` and `equity_distributed` covering the missing principal. Its `repayment_id` is the one to reverse. Symptoms: `close_loan` reverts, Record Repayment shows "fully repaid" ([trustee-flows.md](../frontend/trustee-flows.md)).

Do not call `LoanRegistry.unrecordPayment` / `unrecord_payment` directly: it is minter-only on both arms (Stellar `minter.require_auth()`; EVM role `PIPELINE_MINTER_ROLE` granted to the Minter), and on EVM bypassing the Minter would leave the minted yield and fee shares un-reversed.

## Roles

| Arm | `reverse_repay` | `repay` |
|-----|-----------------|---------|
| EVM | `MinterUpgradeable.reverseRepay`, `restricted`, in the Minter ops selectors (`MINTER_OPS_ROLE`, `SetupMinterOperators.sol`) | `repay`, `restricted`, in the mint selectors (`MINT_CALLER_ROLE`) |
| Stellar | `reverse_repay(loan_id, repayment_id, ref_hash)`, `#[only_owner]` (Minter contract owner) | `repay(caller, ...)`, `ensure_can_call(caller, "repay")` via the AccessManager |

The Trustee cannot call Stellar `reverse_repay`. The scripts map selectors to roles only; which accounts hold `MINTER_OPS_ROLE` / `MINT_CALLER_ROLE` or the Stellar owner key is a deployment fact not confirmed here.

## Step 1: Minter reverse

`reverseRepay(loanId, repaymentId, refHash)` (EVM) / `reverse_repay(loan_id, repayment_id, ref_hash)` (Stellar). `refHash` is single-use across the whole Minter: a repeat reverts (`MinterRefHashSeen` / `RefHashSeen`). The zero hash is accepted and not recorded, so use a fresh non-zero hash anyway; it must differ from the original `repay` hash and from the one used in step 2.

On-chain effects, in order:

1. Registry unrecord (`PaymentUnrecorded`): `repaid` and `outstandingTotal` get the recorded `seniorPrincipalRepaid` back (`0` for a mis-split payment), and the cumulative offtaker, interest and fee totals shrink by the recorded amounts. On Stellar the event carries the reversed `RepaymentData`; on EVM only `outstanding`.
2. Bank cash: the Minter's `bankCash` decreases by the original cash (`offtaker_received − equity_distributed`). It reverts (`MinterInsufficientBankCash`) when `bankCash` is smaller.
3. Fee shares: the treasury's `feeShares` are burned from sPLUSD (`burnShares`, then the PLUSD is burned). A shortfall against the booked fees (share value fell or rounded) is absorbed from the vault.
4. Interest: a non-carved-out loan absorbs the minted interest from the vault (`LossAbsorbed`, PLUSD pulled and burned; any part the vault cannot cover is added to `unabsorbedTotal`). A carved-out loan instead calls `Pocket.unrelease(loan, released, interest)`, which burns the interest in the Pocket.
5. Debt token: `syncDebt(loan)` on the DealTokenFactory (`DebtSynced`).
6. `CashRepaymentReversed(loan_id, repayment_id, cash, ref_hash)` is emitted last.

API and indexer: the registry snapshot is re-read, so `offtaker_outstanding` rises back and `senior_outstanding` rises by the recorded principal. `/financials.minted_yield` and `cumulative_yield_total` exclude the whole reversed repayment (interest and fees) via its `CashRepaymentReversed` row ([backend.md](../references/backend.md) "Minted yield", [yield-apy-semantics.md](./yield-apy-semantics.md)). The TVL ledger subtracts the fee-share burn: EVM `Withdraw` / Stellar `shares_burned`, indexed as `StakingWithdrawal` with `sender` = the Minter, in the reversal's transaction; the Pocket interest burn comes from the `CashRepaymentReversed` row ([dashboards-tvl-ledger.md](./dashboards-tvl-ledger.md)). The audit feed lists `PaymentUnrecorded` and `CashRepaymentReversed`.

## Step 2: Minter repay with the corrected split

`repay(loanId, repaymentData, valueDate, refHash, saleId)` / `repay(caller, loan_id, repayment, value_date, ref_hash, sale_id)` with the same total but principal booked as senior:

- `senior_principal_repaid` set to the principal that was mis-booked; `equity_distributed` reduced by the same amount (`0` for the usual mis-split).
- Registry check (`_validateRepayment` / `validate_repayment`): `senior_principal_repaid + senior_interest + equity_distributed + mgmt_fee + perf_fee + oet_alloc = offtaker_received` exactly.
- `senior_interest` must not exceed the registry's accrued interest, and `mgmt_fee + perf_fee + oet_alloc` must not exceed `max_fee_bps` of `senior_interest + mgmt_fee + perf_fee`.
- `repaid + senior_principal_repaid + written_down` must not exceed `disbursed`; cumulative `offtaker_received` must not exceed `original_offtaker_price` (the reversal already removed the old amount).
- On `Default`, `equity_distributed`, `mgmt_fee`, `perf_fee` and `oet_alloc` must be `0`.
- `refHash` must be non-zero and unused; the call reverts when paused.
- The interest and fee mint passes the Minter rate limit again (`interest + fees` consumed a second time), so the budget must cover it.

Effects: `bankCash` increases by `offtaker_received − equity_distributed`, which now includes the principal that step 1 did not return to the bank. The operator must confirm that cash is physically in the bank account and was not paid out to equity. Interest PLUSD is minted to the vault (or the Pocket if carved out), fees are minted and staked for the treasury, the new repayment id gets a fresh `PaymentRecorded` and `CashRepaid`, and `senior_outstanding` falls so `close_loan` can pass its checklist.

## Limits and failure cases

- One reversal per repayment: a second `reverseRepay` of the same id reverts (`LoanRegistryRepaymentAlreadyReversed` / `RepaymentAlreadyReversed`, plus the Minter's own `reversed` flag). The corrected repayment has a new id and is reversible once itself.
- The registry unrecord needs a loan status of `Performing`..`Default` and an unpaused registry, so a `Closed` loan or a paused registry blocks recovery.
- A carved-out loan reverts in `Pocket.unrelease` once any holder has claimed from its Pocket (Stellar `AlreadyClaimed`; EVM Pocket check not read).
- `reverse_repay` needs the Minter's `bank_cash` to cover the original cash.
- If the procedure cannot run, the fallback is the Risk Council Default path ([trustee-risk-watchlist.md](./trustee-risk-watchlist.md)); it books a credit loss and burns PLUSD for principal that was actually paid, so use it only when recovery is impossible.

## LP share price

Step 1 absorbs the minted interest and burns the treasury's fee-share value, so sPLUSD share price drops by the reversed interest for the interval between the two steps; step 2 re-mints the interest to the vault and the price recovers by the same amount (fees go to the treasury, not LPs). Run both steps back to back, ideally in the same session, and expect transient dips in sPLUSD price, TVL and `cumulative_yield_total` that net out once the corrected `CashRepaid` is indexed.

## Current gap

The Trustee UI used to record payments by `LoanRegistry.record_payment` through the executor. The Stellar loan-registry (`contracts/loan-registry/src/lib.rs`, `record_payment`, `unrecord_payment`) requires `store::minter(e).require_auth()`, so only the Minter can call them. Verified on Stellar testnet (2026-10-27, read-only `simulateTransaction`): `execute(record_payment)` fails with the AccessManager's `Error(Contract, #1)` before reaching the registry, and a direct registry call fails `Error(Auth, InvalidAction)` on the Minter auth. Record Coupon and Record Repayment now sign `Minter.repay` ([loan-repay-minter.md](./loan-repay-minter.md), #1712). The wallet-connect binding for Minter `reverse_repay` and the Trustee recovery UI are tracked in follow-up issues.
