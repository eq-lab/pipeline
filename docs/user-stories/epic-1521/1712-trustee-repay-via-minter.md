# User Stories: #1712 — Trustee records repayments through Minter.repay, not LoanRegistry.record_payment

Issue: [#1712](https://github.com/eq-lab/pipeline/issues/1712) (no parent epic; filed with the #1521 / #1655 material)
Spec: [docs/product-specs/loan-repay-minter.md](../../product-specs/loan-repay-minter.md), [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#recording-a-payment--minterrepay-1712)

Trustee app (`packages/trustee`), Record Coupon and Record Repayment on a Stellar loan, with a Stellar wallet connected.

---

## Story 1: A coupon records through Minter.repay

**Persona:** Trustee whose wallet holds `CASH_REPORTER`.

**Pre-conditions:** A Stellar loan that is `Performing` on chain (first `Minter.disburse` done); `VITE_STELLAR_YIELD_MINTER_ID` and `VITE_STELLAR_LOAN_REGISTRY_ID` are set.

**Steps:**

1. Open Record Coupon for the loan, enter the coupon received and wait for the waterfall to resolve.
2. Click "Record on the ledger" and approve the wallet prompt.
3. After indexing, open the audit log.

**Expected outcomes:**

- The wallet shows a `repay` invocation on the Minter contract, not an executor `execute` call.
- The audit log shows `CashRepaid` and `PaymentRecorded` in one transaction, and the loan's minted yield rises.
- Submitting the same repayment again before the slot advances fails at simulation and requests no signature.

---

## Story 2: A repayment of principal records the same way

**Persona:** Trustee whose wallet holds `CASH_REPORTER`.

**Pre-conditions:** As Story 1, with an offtaker payment that covers senior principal.

**Steps:**

1. Open Record Repayment for the loan and click "Record on the ledger", then approve the wallet prompt.
2. After indexing, open the loan's close checklist.

**Expected outcomes:**

- The signed transaction is a Minter `repay` carrying the waterfall payload unchanged.
- The close checklist's "nothing to mint" item clears once `CashRepaid` is indexed.

---

## Story 3: A wallet without CASH_REPORTER sees the verification error and signs nothing

**Persona:** Trustee whose wallet lacks the `CASH_REPORTER` role.

**Steps:**

1. Open Record Coupon, enter an amount and click "Record on the ledger".

**Expected outcomes:**

- The page shows "Could not verify this action on-chain. No signature was requested — safe to retry."
- A "View details" trigger shows the raw simulation error (Minter `#4`).
- No wallet prompt appears and nothing is submitted.

---

## Story 4: An EVM loan stays blocked

**Persona:** Trustee viewing a loan on an EVM chain.

**Steps:**

1. Open Record Coupon or Record Repayment for the EVM loan.

**Expected outcomes:**

- The page shows the Stellar-only reason line and the record button stays disabled.
- No transaction is built or signed (TD-152).
