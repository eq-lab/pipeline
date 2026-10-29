# Loan Repayment — `Minter.repay`

> How the Trustee records a repayment on chain. Registry write signatures are in [loans-data.md](./loans-data.md); the Trustee UI flow is in [trustee-flows.md](../frontend/trustee-flows.md#recording-a-payment--minterrepay-1712).

---

Recording a repayment is a Minter call on both chains. `LoanRegistry.recordPayment` / `record_payment` is restricted to the Minter and cannot be called by a trustee account, directly or through the AccessManager executor (the executor, not the Minter, would be the invoker).

- Stellar: `repay(caller: Address, loan_id: u32, repayment: RepaymentData, value_date: u64, ref_hash: BytesN<32>, sale_id: u32) -> u32` (returns the repayment id). `caller` is the connected wallet and the transaction source; it must hold `CASH_REPORTER` (`am.can_call(caller, minter, repay)`), otherwise the Minter reverts `#4 Unauthorized`.
- EVM: `PipelineMinter.repay(loanId, repaymentData, valueDate, refHash, saleId)`, role `MINT_CALLER_ROLE`, `restricted whenNotPaused`. Not wired in the trustee app (TD-152); pure calldata encoders exist in `@pipeline/wallet-connect` (`evm/contracts/minter.ts`), signing is blocked on #1573.
- `value_date`: stored and emitted only, not validated. The trustee app sends UTC midnight (Unix seconds) of the page date.
- `ref_hash`: single-use and non-zero (zero reverts `#28 MissingRef`, a repeat reverts `#7 RefHashSeen`). The trustee app sends `sha256("pipeline:repay:{registryId}:{loanId}:{next_repayment_id}")` as 64 lowercase hex, with `next_repayment_id` read from the registry's `mutable_loan_data(loan_id)` just before building the transaction. A double submit of the same repayment slot therefore fails at simulation; a corrected re-record after a reversal gets a fresh slot and hash.
- `sale_id = 0` means "not a collateral sale".
- Mint budget: `interest + fees` count against the Minter's per-transaction and window limits (`#22 ExceedsTxLimit`, `#23 ExceedsWindowLimit`).
- Side effects in one signature: books `bank_cash += offtaker_received - equity_distributed`; calls `registry.record_payment`; mints the interest as PLUSD to sPLUSD (to the Pocket when the loan is carved out); mints the fees and stakes them for the treasury; syncs factory debt; emits `cash_repaid [loan_id]` with `{repayment_id, sale_id, cash, interest_minted, fee_shares, value_date, ref_hash}`. The indexer joins `CashRepaid` to the same-transaction `PaymentRecorded` for `/financials.minted_yield`.
- The registry rejects the payment unless the loan is `Performing..Default`, so the loan must have had its first `Minter.disburse` (TD-157), and `repaid + principal <= disbursed`.
- Verified read-only on Stellar testnet (2026-10-27, `simulateTransaction`, nothing submitted): `am.execute(registry, "record_payment", ...)` fails with the AccessManager's `Error(Contract, #1)`; a direct registry call fails `Error(Auth, InvalidAction)` on `minter.require_auth()`; `Minter.repay` from a `CASH_REPORTER` wallet passes the role and ref checks and reaches the registry.
- Deployment requirement: every trustee wallet that records repayments needs `CASH_REPORTER`.
- Correcting a mis-split repayment (Minter `reverse_repay` through the AccessManager, then a corrected `repay`) is in [loan-repayment-recovery.md](./loan-repayment-recovery.md); the Trustee app drives both steps from the loan detail page (#1711).
