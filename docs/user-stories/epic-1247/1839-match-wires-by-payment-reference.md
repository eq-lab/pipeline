# User Stories: #1839 — Backend: match incoming wires to the LP by the issued payment reference

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1839](https://github.com/eq-lab/pipeline/issues/1839)
Spec: [docs/product-specs/deposits.md](../../product-specs/deposits.md#wire-matching-by-payment-reference)

Backend only, exercised against the live API with a trustee token and an LP token (LP 7 below, a second LP 12 for story 3). `REF` is a reference the LP got from `GET /v1/lps/me/payment-details?chain_id=<id>`.

---

## Story 1: The Trustee finds the LP from the reference

**Persona:** Trustee. **Steps:** the LP requests payment details. The Trustee calls `GET /v1/lps?payment_details=<REF lowercased, hyphens stripped>`.

**Expected outcomes:**

- `200` with `lps` holding exactly the LP that was issued `REF`.

---

## Story 2: Record a wire with the reference

**Persona:** Trustee. **Steps:** `POST /v1/lps/7/bank-deposits` with `payment_reference` (the bank's own, e.g. `UETR-1`), `payment_details: REF`, `amount`, `occurred_at`.

**Expected outcomes:**

- `201`, and `matched_reference` carries `payment_details` (canonical), `chain_id`, `receiver_address` and `issued_at`.
- `GET /v1/lps/7/bank-deposits` returns the same `matched_reference` on that deposit.

---

## Story 3: A reference issued to another LP is refused

**Steps:** `POST /v1/lps/12/bank-deposits` with `payment_details: REF` (issued to LP 7).

**Expected outcomes:**

- `422` naming LP 7 and LP 12.
- LP 12's deposit list and ledger are unchanged.

---

## Story 4: Unissued and malformed references

**Steps:** call the lookup and the record route with a well-formed reference nobody was issued, then with `not-a-ref`.

**Expected outcomes:**

- Unissued: `GET /v1/lps?payment_details=` returns `{ "lps": [] }`, and the record route answers `422`.
- Malformed: both answer `400`.

---

## Story 5: The same reference on a second wire

**Steps:** `POST /v1/lps/7/bank-deposits` again with `payment_details: REF` and a different `payment_reference` (`UETR-2`).

**Expected outcomes:**

- `201`. Both deposits show the same `matched_reference`.
- Repeating `UETR-2` is still `409`.

---

## Story 6: The issued reference is not the bank reference

**Steps:** `POST /v1/lps/7/bank-deposits` with `payment_reference: REF`.

**Expected outcomes:**

- `422` telling the Trustee to enter the bank's own reference and pass the issued one as `payment_details`. Nothing is written.

---

## Story 7: Hand attribution still works

**Steps:** `POST /v1/lps/7/bank-deposits` without `payment_details`.

**Expected outcomes:**

- `201` with `matched_reference: null`.
