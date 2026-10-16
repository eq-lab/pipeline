# User Stories: #1536 — Trustee: loan submission form selects the target chain

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1536](https://github.com/eq-lab/pipeline/issues/1536)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#submit-a-loan-originationnew-1100),
[docs/product-specs/api-authorization-loan-submission.md](../../product-specs/api-authorization-loan-submission.md)

Trustee app (`packages/trustee`) against a staging API whose `CHAINS` includes both the Stellar
testnet (`99000001`) and Hoodi (`560048`). No Figma for any of these screens (the submission form
never had one; the Chain column and the Approve gate line are implementer-derived).

---

## Story 1: The form defaults to Stellar and sends the chain as a query parameter

**Persona:** Trustee submitting a loan.

**Pre-conditions:** Signed in to the Trustee app, on `/origination/new`.

**Steps:**

1. Look at the first field of "Loan & metadata".
2. Fill the form (Import from JSON with the #1100 example, then the two missing blocks) and click Submit.

**Expected outcomes:**

- The first field is a "Target chain" dropdown showing "Stellar" selected, with "Hoodi" as the other option; the next field is labelled "Mint to (address on the target chain)".
- The Network tab shows `POST /v1/loan-book/loan?chain_id=99000001`; the JSON body has no `target_chain_id`.
- The app returns to `/origination`, where the new row's Chain column reads "Stellar".

---

## Story 2: Choosing Hoodi targets the EVM chain

**Persona:** Trustee submitting an EVM loan.

**Pre-conditions:** As Story 1, with an EVM `to` address (0x…) and a fresh `metadata_uri`.

**Steps:**

1. Select "Hoodi" in Target chain, then Import from JSON (same example).
2. Fill the missing blocks, set `to` to an EVM address, submit.

**Expected outcomes:**

- The selector still reads "Hoodi" after the import (import does not reset it; a JSON carrying `"target_chain_id": 560048` would also select it).
- The request is `POST /v1/loan-book/loan?chain_id=560048`.
- On `/origination` the new row's Chain column reads "Hoodi"; `GET /v1/loan-book/submissions` carries no `chain_id` and the list shows both Stellar and Hoodi submissions.

---

## Story 3: An EVM-targeted submission cannot be approved from the Trustee app

**Persona:** Trustee reviewing the Story 2 submission.

**Pre-conditions:** Story 2 submission `InReview`; trustee wallet connected.

**Steps:**

1. Open the submission from the table.
2. Try Approve; then open Request changes.

**Expected outcomes:**

- Deal Details starts with "Target chain · Hoodi".
- Above the footer buttons a muted line reads "Approve & draw runs on Stellar only — drawing on Hoodi from the Trustee app is not supported yet. Reject or request changes instead."; the Approve button is disabled and no wallet prompt or dialog appears.
- Reject and Request changes work as before (reason dialog, `POST …/review`).

---

## Story 4: A Stellar-targeted submission approves as before

**Persona:** Trustee reviewing the Story 1 submission.

**Steps:**

1. Open it; click Approve and confirm in the mint dialog.

**Expected outcomes:**

- Deal Details shows "Target chain · Stellar"; no blocked line; Approve is enabled.
- The chain-first flow runs unchanged (simulate → wallet signature → `POST …/review`), and the row flips to "Approved".
