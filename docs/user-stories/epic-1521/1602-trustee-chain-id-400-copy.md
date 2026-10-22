# User Stories: #1602 — Trustee: clear copy for unknown/missing chain_id 400s

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1602](https://github.com/eq-lab/pipeline/issues/1602)
Spec: [docs/frontend/error-handling.md#trustee-mapping-layer](../../frontend/error-handling.md#trustee-mapping-layer)

Trustee app (`packages/trustee`) against an API whose `CHAINS` does not include the app's EVM
chain (prod today: Trustee `VITE_EVM_CHAIN_ID=1`, API `CHAINS=99000002`; or a local API with
`CHAINS` narrowed). Sign-in itself must succeed on a served chain (Stellar).

---

## Story 1: Submitting a loan to an unserved chain names the cause

**Persona:** Trustee submitting a loan.

**Steps:**

1. On `/origination/new` choose the EVM chain in "Target chain", fill the form, submit.

**Expected outcomes:**

- The API answers `400 unknown chain_id: 1 (configured: …)`; the inline error reads "This network isn't enabled on the server. Contact your administrator." — not "This request was invalid."
- "View details" shows the raw server text.

---

## Story 2: A waterfall preview for a loan on an unserved chain does not say "amount too high"

**Persona:** Trustee on Record Coupon for a loan whose `chain_id` the API no longer serves.

**Steps:**

1. Open `/loans/<id>/record-coupon?chain=<unserved id>` and enter an amount.

**Expected outcomes:**

- The preview error reads "This network isn't enabled on the server…" with details, not "This amount is too high for this loan."

---

## Story 3: Other 400s keep their copy

**Persona:** Trustee submitting an invalid payload (e.g. an empty `metadata_uri` the server rejects).

**Expected outcomes:**

- "This request was invalid." as before, with the raw text under details.
