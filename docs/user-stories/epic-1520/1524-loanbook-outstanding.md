# User story: #1524 — LoanBook readers: outstanding = disbursed − repaid − written_down

**Epic:** #1520 — LoanBook readers realigned to current indexer events
**Issue:** https://github.com/eq-lab/pipeline/issues/1524
**Status:** Initial

---

## Overview

Every LoanBook reader (loan book, CCR history, collateral valuation, repayment waterfall)
now reads outstanding senior principal through one helper,
`LoanSnapshot::outstanding_senior_principal()` = `disbursed − repaid − written_down`,
floored at zero, matching both LoanRegistry contracts. The waterfall also adds the signed
`interest_adjustment` to cumulative gross senior interest before the fee split.

No Figma reference exists — this is backend-only, verified by pure unit tests in
`packages/shared/tests/loan_outstanding.rs`, `packages/api/tests/loan_book.rs` and
`packages/api/tests/waterfall.rs`.

**Note:** snapshots written before the contract rework carry no `disbursed` / `repaid` /
`written_down` and read as zero outstanding; there is no legacy fallback.

---

## Story 1 — An undisbursed loan shows zero outstanding

**Given** an `Approved` loan with senior tranche 80,000 and nothing disbursed

**When** the Trustee opens the Loans page

**Then:**

- `senior_outstanding` is `"0.000000"` and `ccr_bps` is `null`
- The loan does not contribute to `deployed_senior`
- `original_senior_tranche` still shows 80,000

---

## Story 2 — Partial disbursement, repayment and write-down are netted

**Given** a loan with 30,000 disbursed of an 80,000 tranche, or an 80,000 loan fully
disbursed with 30,000 repaid, or a `Default` loan with 30,000 disbursed and 10,000 written down

**Then:**

- `senior_outstanding` is 30,000, 50,000 and 20,000 respectively
- CCR is computed against that outstanding
- `at_risk_wl_and_default_senior` counts the 20,000 for the written-down defaulted loan

---

## Story 3 — The waterfall accrues on the contract's outstanding

**Given** a 1,000,000 senior loan at 12% over one year with 400,000 written down

**When** the Trustee requests `GET /v1/loan-book/{loan_id}/waterfall`

**Then:**

- Interest and fees accrue on 600,000
- `senior_principal_returned` is capped at 600,000

---

## Story 4 — An interest waiver reduces the coupon and performance fee

**Given** the same loan with `interest_adjustment = −20,000`

**Then:**

- Gross interest is 100,000, `management_fee` stays 10,000
- `performance_fee` is 18,000 and `senior_coupon_net` is 72,000
- A waiver larger than gross interest clamps the coupon and performance fee at zero
