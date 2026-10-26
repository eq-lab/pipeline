# User Stories: #1661 — Trustee: waterfall 422 (incomplete event history) and Default 400 show 'amount too high'

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1661](https://github.com/eq-lab/pipeline/issues/1661)
Spec: [docs/frontend/error-handling.md](../../frontend/error-handling.md#waterfall-preview-no-details-on-the-expected-input-case-d5)

Trustee app (`packages/trustee`), Record Coupon or Record Repayment on a loan, against an API that includes PR #1660.

---

## Story 1: A loan with incomplete event history asks for support, not a smaller amount

**Persona:** Trustee previewing a payment on a loan whose indexed event history is incomplete.

**Pre-conditions:** `GET /v1/loan-book/{loan_id}/waterfall` returns 422 (`loan event history incomplete; re-index required ...`).

**Steps:**

1. Open Record Coupon (or Record Repayment) for the loan and enter an amount.

**Expected outcomes:**

- The inline error reads "Loan data is incomplete — the indexer needs a re-sync. Contact support." with no amount suggestion and no digits.
- A "View details" trigger shows the raw server text.

---

## Story 2: A Default loan explains what a payment can cover

**Persona:** Trustee previewing a payment larger than a Default loan allows.

**Pre-conditions:** Loan in Default; the waterfall returns 400 starting with `loan is in Default`.

**Steps:**

1. Open Record Coupon (or Record Repayment) for the loan and enter an amount above senior principal plus accrued interest.

**Expected outcomes:**

- The inline error reads "This loan is in Default: a payment can only cover senior principal and accrued interest. Enter a smaller amount." with no digits.
- "View details" shows the raw server text.

---

## Story 3: Other amount errors keep the generic copy

**Persona:** Trustee entering an amount above the loan's outstanding balance.

**Steps:**

1. Enter an amount the waterfall rejects with any other 4xx.

**Expected outcomes:**

- The inline error reads "This amount is too high for this loan. Enter a smaller amount." with no "View details" trigger.
