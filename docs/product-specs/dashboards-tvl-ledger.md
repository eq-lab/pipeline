# Dashboards: TVL ledger

Backs `tvl` in `GET /v1/dashboard/summary` and the series of `GET /v1/dashboard/tvl-history`. Issue #1631.

## Definition

TVL is what the protocol owes LPs: **PLUSD in circulation** (wallets, the sPLUSD vault, the withdrawal queue, the Pocket) plus **pending deposits** (USDC already at the custodian whose PLUSD is not yet minted). It is the running sum of an event-sourced ledger over `contract_logs`, one rule for EVM and Stellar. No on-chain sampling: Stellar PLUSD is a SAC with no `total_supply`.

## Ledger

Reader: `ContractLogsRepo::list_plusd_ledger` (`PLUSD_LEDGER_SQL`). Rows are `(block_timestamp, block_number, log_index, delta)`, ordered by `(block_number, log_index)`.

| Path | Sign | `event_name` | Emitter | `params` key |
|---|---|---|---|---|
| Deposit request (counted from request, including pending and failed-KYT) | + | `DepositRequested` | DepositManager | `amount` |
| Wire-in (record mints; `WireInAssigned` only stakes the minted PLUSD) | + | `WireIn` | Minter | `amount` |
| Repayment interest, minted to the vault or, when carved out, to the Pocket | + | `CashRepaid` | Minter | `interest_minted` |
| Repayment fees, minted then staked for the treasury | + | `PaymentRecorded` (same tx, loan, repayment) | LoanRegistry | `event.mgmt_fee + perf_fee + oet_alloc` |
| Income (`recordIncome` mints to the vault) | + | `CashRecorded`, reason `Income` | Minter | `delta` |
| Legacy yield mint (vault and treasury legs; the treasury leg was plain PLUSD). Matches historical rows only, no parser emits `YieldMinted` any more | + | `YieldMinted` | YieldMinter | `s_plusd_amount + treasury_amount` |
| Wire-in returned | − | `WireInReturned` | Minter | `amount` |
| Wire-out settled (burn) | − | `WireOutSettled` | Minter | `amount` |
| Withdrawal claim (burn) | − | `RequestClaimed` | WithdrawalQueue only | `amount` |
| Loss absorbed (`recordExpense`, ramp loss, `correctVaultMint`, reversal shortfall) | − | `LossAbsorbed` | Minter | `pulled` |
| Write-down burn from the Pocket | − | `LoanWrittenDown` | LoanRegistry | `event.burned` |
| Repayment reversal: treasury fee-share burn | − | `StakingWithdrawal` in the reversal's tx with `sender` = the reversal's Minter | sPLUSD | `assets` |
| Repayment reversal of a carved-out repayment: Pocket interest burn | − | `CashRepaymentReversed` | Minter | original `CashRepaid.interest_minted` |

Rules:

- **Withdrawals leave at claim.** `WithdrawalRequested` moves PLUSD into the queue (still in circulation) and has no ledger row. A `RequestClaimed` row counts only when a `WithdrawalRequested` with the same `request_id` exists on the same contract address, which scopes it to the WithdrawalQueue (DepositManager emits the same event name).
- **Deposit claims have no row.** The mint at claim is already counted at the request.
- **Carve-out stays.** PLUSD moved to the Pocket (default carve-out, carved-out interest) is still in circulation and stays in TVL until a write-down burns it. A carved-out repayment is a `CashRepaid` after a registry `LoanDefaulted` for the loan.
- **Fee-share burn.** On EVM `burnShares` emits an ERC-4626 `Withdraw(minter, minter, treasury, ...)`. On Stellar `burn_shares` emits only `shares_burned`, which the worker indexes as a `StakingWithdrawal` with `sender` = `receiver` = the minter contract id (#1614). The reversal row subtracts only `StakingWithdrawal` rows of its own transaction whose `sender` equals the `CashRepaymentReversed` emitter (case-insensitive), so a batched transaction's other withdrawals are ignored. The treasury address is not available to the API, so `owner` is not filtered. `shares_burned` events from before this change need a Stellar re-index to appear.
- **Scoping.** Only `PaymentRecorded`, `LoanDefaulted` and `LoanWrittenDown` are scoped to the chain's LoanRegistry. Every other event is chain-scoped only, because the Minter, DepositManager and WithdrawalQueue addresses are not available to the API. After a redeploy on the same chain this can only overstate TVL. `RequestClaimed` is scoped by its same-contract `WithdrawalRequested`.
- **No row for pure bookkeeping.** `MintCorrected` (its burn is the `LossAbsorbed.pulled` of the same call), `CashCorrected`, `WireInAssigned`, `WireOutRequested` / `WireOutCancelled`, `CashDisbursed` and the other cash events do not change PLUSD supply.
- **Normalisation.** Per chain, the running raw total is normalised to base-6 by chain kind (Stellar divides by 10 and truncates) and only its change is emitted (`normalise_plusd_ledger`), then chains are summed. A chain with no configured LoanRegistry address is skipped, like the summary's other readers.

## Series and stats

Same grid, `MAX_SAMPLES` cap and time-weighted `max` / `min` / `average` as before; the final point equals summary `tvl`.

## Known gaps

The Pocket contract is not indexed. Its `Burned` equals `LoanWrittenDown.burned` and its `Unreleased` interest burn is derived from the reversed `CashRepaid`. An asset-admin mint or burn of Stellar PLUSD outside the Minter, DepositManager and WithdrawalQueue is not visible. Events before the indexer start block are missing.
