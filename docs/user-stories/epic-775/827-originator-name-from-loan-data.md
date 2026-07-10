# User Stories: #827 — Origination table: show Originator name from loan_data instead of submitter address

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#827](https://github.com/eq-lab/pipeline/issues/827)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

Reverses the #813 field-mapping decision for the Origination table's Originator column:
it now reads `SubmissionView.loan_data.originator` (`SubmitLoanRequest.originator`) — the
originator's human-readable name as submitted with the loan — instead of the top-level
`SubmissionView.originator` (the authenticated submitter's raw wallet/address string,
not human-readable). The existing `safeString` "—" fallback still applies when
`loan_data.originator` is missing or malformed — the value is never fabricated.

---

## Story 1: The Originator column shows the loan's originator name, not the submitter address

**Persona:** Trustee operator scanning the Origination table for which originator each
submission came from.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in, and `GET /v1/loan-book/submissions` returns at least
one submission whose `loan_data.originator` differs from its top-level `originator`.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Read the "Originator" column for that submission's row.

**Expected outcomes:**

- The cell shows the originator's name from `loan_data.originator` (e.g. "Auric Andes"),
  not the top-level authenticated-submitter address/wallet string.

---

## Story 2: A submission missing `loan_data.originator` renders "—", never a fabricated value

**Persona:** Trustee operator reviewing a submission with incomplete or malformed loan
data.

**Pre-conditions:** At least one submission exists whose `loan_data.originator` is
missing, empty, or not a string (top-level `originator` may still be present).

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Locate that submission's row and read its Originator cell.

**Expected outcomes:**

- The cell renders "—", regardless of whether the top-level `originator` field has a
  value. The table never falls back to displaying the address in place of the missing
  name.
