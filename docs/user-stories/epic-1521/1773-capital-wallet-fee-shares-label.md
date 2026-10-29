# User Stories: #1773 — Reversal effects name the capital wallet

Issue: [#1773](https://github.com/eq-lab/pipeline/issues/1773) (epic #1521, follow-up to #1711)
Spec: [docs/product-specs/loan-repayment-recovery.md](../../product-specs/loan-repayment-recovery.md), [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#repayment-recovery-1711)

Trustee app (`packages/trustee`), loan detail page of a Stellar loan eligible for repayment recovery, with a Risk Council wallet connected.

---

## Story 1: The reversal effects list calls the fee recipient the capital wallet

**Persona:** Trustee.

**Pre-conditions:** A Stellar loan with a non-reversed repayment that booked fees.

**Steps:**

1. Open the loan detail page and click "Open recovery".
2. Select the repayment in step 1 and read the effects list.

**Expected outcomes:**

- The effects list shows a "Capital wallet fee shares burned" row with the raw share amount as served on chain.
- No row or text in the dialog says "Treasury".
