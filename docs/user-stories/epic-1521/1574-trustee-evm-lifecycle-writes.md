# User story: #1574 — Trustee: EVM write paths for rollover / update lifecycle / record payment / close loan (TD-152)

**Epic:** #1521 (follow-up of the EVM parity work in #1937; the issue has no native parent)
**Issue:** https://github.com/eq-lab/pipeline/issues/1574
**Status:** Initial

---

## Overview

The Trustee loan actions run on the configured EVM chain (Hoodi) with the same hooks, pages, dialogs, test ids and copy as on Stellar: Roll over, Update lifecycle, Close loan and Disburse through `AccessManager.execute`, and Record coupon / Record repayment as a direct `PipelineMinter.repay`. Spec: [trustee-flows.md](../../frontend/trustee-flows.md#evm-1574) and [loan-repay-minter.md](../../product-specs/loan-repay-minter.md).

Persona: Trustee signed in on the EVM chain (Hoodi) with a real EVM wallet (mock wallets cannot send EVM writes) that holds `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, `MINT_CALLER_ROLE` and `MINTER_OPS_ROLE` with delay 0 (Hoodi `0x96ef…c04e4`). The stage env carries `VITE_EVM_LOAN_REGISTRY_ADDRESS`, `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_MINTER_ADDRESS` and `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS`. No Figma is referenced; the UI is unchanged except that the gates open.

Preconditions on Hoodi today: the registry holds no loans yet (draw one from Origination first); `registerDeal` (#1892) runs out of band, because `drawLoan` does not register a deal; the Minter's booked bank cash is `0` until wires are booked (`recordWireIn`, #1501).

---

## Story 1 — Update lifecycle on an EVM loan

**Given** an EVM loan in `Performing` on its detail page

**When** the trustee opens Update lifecycle, picks `WatchList`, keeps the stored metadata URI and confirms

**Then:**

- The dialog first shows "Reading the loan's on-chain state…", then the status and URI read from `mutableLoanData`
- One `AccessManager.execute(registry, updateMutable(...))` transaction is signed on the Hoodi chain
- Once indexed, the loan shows `WatchList`, and the audit log shows `StatusUpdated`

---

## Story 2 — Roll over a matured, performing EVM loan

**Given** a matured `Performing` EVM loan

**When** the trustee enters a rate of `14.5` (percent) and a new maturity and confirms

**Then:**

- The call is `rollover(loanId, 145000, maturity)` through `AccessManager.execute`
- The loan returns to `Performing` with the new maturity once indexed, and `LoanRolledOver` appears in the audit log

---

## Story 3 — Record a coupon

**Given** a `Performing` EVM loan that has been disbursed and has a registered deal, and a wallet with `MINT_CALLER_ROLE`

**When** the trustee opens Record Coupon, enters an amount and records

**Then:**

- No role reason shows (the page read `canCall(wallet, minter, repay)` first)
- One direct `PipelineMinter.repay` transaction is signed with the served 6-decimal split, `saleId = 0` and the repayment-slot `ref_hash`
- The audit log shows `CashRepaid` and `PaymentRecorded`

---

## Story 4 — Record the repayment and close the loan

**Given** an EVM loan whose offtaker is fully paid and senior outstanding is `0`

**When** the trustee records the repayment and then clicks Close loan

**Then:**

- Record signs `PipelineMinter.repay`; Close signs `AccessManager.execute(registry, closeLoan(loanId, reason))` with `ScheduledMaturity` or `EarlyRepayment`
- The loan becomes `Closed` once indexed and `LoanClosed` appears in the audit log

---

## Story 5 — Recovery step 2 on EVM

**Given** a repayment reversed on an EVM loan (recovery step 1) and indexed by the backend

**When** the trustee reaches step 2 and records the corrected repayment

**Then:**

- The dialog signs `PipelineMinter.repay` with the corrected split and the original value date, then shows the transaction hash

---

## Story 6 — A wallet without MINT_CALLER_ROLE is never prompted

**Given** a wallet that has `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` only (Hoodi `0xd3b9…a57c`)

**When** the trustee opens Record Coupon or Record Repayment

**Then:**

- The page shows "Only the Cash reporter can book repayments." and the record button is disabled
- Update lifecycle, Roll over and Close loan stay available

---

## Story 7 — A failed simulate requests no signature

**Given** an `Approved` EVM loan (not disbursed)

**When** the trustee forces a record (for example through a stale page) or any write that would revert

**Then:**

- No wallet signature prompt appears
- The page shows "Could not verify this action on-chain. No signature was requested — safe to retry.", and the details name the decoded error (for example `LoanRegistryWrongCurrentStatus`, `DealTokenFactoryNotRegistered`, `EnforcedPause`, `AccessManagerUnauthorizedCall`)

---

## Story 8 — A loan on an unknown chain stays blocked

**Given** a loan whose chain is neither Stellar nor the configured EVM chain

**When** the trustee opens its detail page

**Then:**

- Roll over, Update lifecycle, Record coupon and Close loan are disabled with the Stellar-only line, the Record pages and the Disbursement card show the same line, and nothing is signed

---

## Story 9 — Disburse an EVM loan

**Given** an `Approved` EVM loan on its detail page

**When** the deal is not registered

**Then:**

- The Disbursement card shows "Register this loan's debt token first." and the Disburse button is disabled

**When** the deal is registered out of band, the Minter has booked bank cash at least the amount, the Minter is not paused and the wallet holds `MINTER_OPS_ROLE`

**Then:**

- Disburse is enabled; the dialog takes the amount at up to 6 decimals, a value date and a bank reference
- One `AccessManager.execute(minter, disburse(...))` transaction is signed with `ref_hash = 0x + sha256(reference)`; the loan moves `Approved` to `Performing` and the audit log shows `CashDisbursed`
- Re-using the same bank reference is refused before the wallet prompt

---

## Story 10 — Stellar is unchanged

**Given** a Stellar loan and a Stellar wallet

**When** the trustee uses Roll over, Update lifecycle, Record coupon / repayment, Close loan and Disburse

**Then:**

- Each action behaves exactly as before: the same executor and direct Minter calls, the same stages (waiting for signature, submitting, confirming), the 7-decimal amounts and the same copy
