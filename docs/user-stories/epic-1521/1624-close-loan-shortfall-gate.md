# User Stories: #1624 — Trustee: Close loan stays disabled after a shortfall repayment

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1624](https://github.com/eq-lab/pipeline/issues/1624)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#close-loan-gating--the-close-checklist-1090-supersedes-the-884-gate)

Trustee app (`packages/trustee`) against a staging API, signed in with the trustee wallet, on a
Stellar loan that is Active with senior principal outstanding.

---

## Story 1: A shortfall repayment does not enable Close loan

**Persona:** Trustee recording a repayment where the offtaker paid less than the senior outstanding.

**Pre-conditions:** Loan with senior outstanding above the amount the offtaker paid.

**Steps:**

1. Open `/loans/<id>/record-repayment` and record the shortfall repayment.
2. Wait for the loan-book refetch (watch `GET /v1/loan-book` in the Network tab).

**Expected outcomes:**

- The record button reads "Payment recorded" and is disabled.
- The first checklist row "Senior principal outstanding is zero" stays unmet and shows the remaining outstanding amount.
- "Next step — close loan" stays disabled; `close_loan` is never submitted.

---

## Story 2: A full repayment enables Close loan within seconds

**Persona:** Trustee recording the repayment that clears the senior principal.

**Pre-conditions:** Loan whose offtaker payment covers the full senior outstanding.

**Steps:**

1. Open `/loans/<id>/record-repayment` and record the payment.
2. Watch the Network tab for `GET /v1/loan-book` requests.

**Expected outcomes:**

- Loan-book and loan-financials are refetched immediately, then again about 5 s and 15 s later.
- Once the refetched `senior_outstanding` is `0` (and nothing is left to mint), all checklist rows turn green and "Next step — close loan" enables, within about 15 s.
- Clicking it submits `close_loan` successfully.
