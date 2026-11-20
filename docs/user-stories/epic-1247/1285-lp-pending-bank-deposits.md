# User Stories: #1285 — Backend: serve the LP's pending bank deposits on GET /v1/lps/me

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1285](https://github.com/eq-lab/pipeline/issues/1285)
Spec: [docs/product-specs/deposits.md](../../product-specs/deposits.md) § LP Pending Bank Deposits

Backend-only. The stories run against a running API with `curl` and read the database to set up and confirm state. Replace `$API` and `$TOKEN` with the API base URL and the LP session's bearer token. The frontend wiring is #1820.

---

## Story 1: An LP with no recorded wires sees zero

**Persona:** LP with no rows in `lp_bank_deposits`.

**Steps:**

1. `curl -s -H "Authorization: Bearer $TOKEN" $API/v1/lps/me`

**Expected outcomes:**

- `200 OK`; the body has `pending_bank_deposits` equal to the string `"0.00"`.

---

## Story 2: A recorded, unminted wire is pending

**Persona:** LP for whom the Trustee recorded a `1500.00` wire (`POST /v1/lps/{id}/bank-deposits`) that has not been minted.

**Steps:**

1. Record the wire as the Trustee.
2. `curl -s -H "Authorization: Bearer $TOKEN" $API/v1/lps/me`

**Expected outcomes:**

- `pending_bank_deposits` is the string `"1500.00"`, and the Trustee `GET /v1/lps` rows carry no such field.

---

## Story 3: A minted wire leaves the pending figure

**Persona:** The LP from Story 2, after the Trustee mints the wire straight to the LP and the relayer's matching phase sets `is_minted = true`.

**Steps:**

1. `curl -s -H "Authorization: Bearer $TOKEN" $API/v1/lps/me`

**Expected outcomes:**

- `pending_bank_deposits` is `"0.00"`.

---

## Story 4: An escrowed wire stays pending until assigned

**Persona:** LP whose recorded wire was minted into escrow (`receiver` is the minter).

**Steps:**

1. Read `GET /v1/lps/me` before `assign_wire_in`, then again after the relayer matches the `WireInAssigned` event.

**Expected outcomes:**

- Before assignment `pending_bank_deposits` is the full amount; after it is `"0.00"`.

---

## Story 5: A returned wire is excluded

**Persona:** LP whose recorded wire was escrowed and then returned (`WireInReturned` indexed with the same minter `id`).

**Steps:**

1. `curl -s -H "Authorization: Bearer $TOKEN" $API/v1/lps/me`

**Expected outcomes:**

- `pending_bank_deposits` excludes that wire although `is_minted` is still `false`.

---

## Story 6: The Trustee single-LP read carries the field

**Persona:** Trustee.

**Steps:**

1. `curl -s -H "Authorization: Bearer $TRUSTEE_TOKEN" $API/v1/lps/$LP_ID`

**Expected outcomes:**

- The body has `pending_bank_deposits` equal to the figure the LP sees.
