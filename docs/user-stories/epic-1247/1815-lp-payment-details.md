# User Stories: #1815 — Backend: GET /v1/lps/me/payment-details

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1815](https://github.com/eq-lab/pipeline/issues/1815)
Spec: [docs/product-specs/deposits.md](../../product-specs/deposits.md) § LP Funding Details

Backend-only. The stories are exercised against a running API with `curl` (or Swagger UI at `/swagger-ui`) and read the
database to confirm what was stored. The frontend wiring is #1817, and wire matching by issued reference is a follow-up.
Replace `$API` and `$TOKEN` with the API base URL and the LP session's bearer token, and `$STELLAR_CHAIN_ID` / `$EVM_CHAIN_ID` with configured chain ids (`chain_id` is required since #1824).

---

## Story 1: A Passed LP with a linked address gets the bank details and a new reference

**Persona:** LP whose KYB is `Passed` and who has a linked settlement address.

**Pre-conditions:** `system_configuration` row `system_bank_details` filled per the runbook in
[deposits.md](../../product-specs/deposits.md) § Filling the bank details. The LP's `GET /v1/lps/me` shows
`kyb_status: "Passed"` and a non-null `stellar_address`.

**Steps:**

1. `curl -i -H "Authorization: Bearer $TOKEN" $API/v1/lps/me/payment-details?chain_id=$STELLAR_CHAIN_ID`

**Expected outcomes:**

- `200 OK` with a JSON body of exactly nine keys: seven strings (`company_name`, `bank_name`, `bank_address`,
  `account_number`, `iban`, `swift_bic_code`, `payment_details`), integer `chain_id` (the one requested) and string
  `receiver_address` (the LP's `stellar_address`).
- The six bank fields equal the values in `system_configuration`; an empty field is served as `""`.
- `payment_details` matches `^PL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$`.
- The response carries `Cache-Control: no-store`.
- `lp_requested_bank_details` has one new row for this LP holding the same `payment_details`, the requested `chain_id` and the `receiver_address`.

---

## Story 2: Every call issues a new reference and keeps the history

**Persona:** The same LP opening the funding details twice.

**Pre-conditions:** Story 1 done.

**Steps:**

1. Call `GET /v1/lps/me/payment-details?chain_id=$STELLAR_CHAIN_ID` a second time.
2. Query `lp_requested_bank_details` for this LP.

**Expected outcomes:**

- The second `payment_details` differs from the first; the bank fields are identical.
- The LP has two rows, both references still stored, with increasing `created_at`.

---

## Story 3: An LP that is not eligible is refused and no reference is issued

**Persona:** LP that is `UnderReview`, or `Passed` without a linked address.

**Steps:**

1. Call the endpoint with that LP's token.
2. Count rows in `lp_requested_bank_details` for the LP.

**Expected outcomes:**

- `409 Conflict`; the body names every unmet precondition, e.g. "payment details require a linked settlement address and
  KYB status Passed (this LP is UnderReview with no linked address)".
- The row count is unchanged.

---

## Story 3b: The gate is per chain kind

**Persona:** `Passed` LP with a linked Stellar address and no EVM address.

**Steps:**

1. Call the endpoint with `chain_id=$EVM_CHAIN_ID`.
2. Call it with no `chain_id`, and with `chain_id=999999`.

**Expected outcomes:**

- Step 1 is `409` naming "a linked EVM settlement address" (this LP is Passed with no linked EVM address); no row is added.
- Step 2 is `400` (`chain_id is required`, then `unknown chain_id: 999999 (configured: …)`).
- After linking an EVM address (#1824 stories), the EVM call is `200` with `chain_id` and the lowercase `evm_address` as `receiver_address`.

---

## Story 4: Accounts without an LP and unauthenticated callers

**Persona:** A trustee account (owns no LP) and a caller with no token.

**Steps:**

1. Call the endpoint with a trustee token.
2. Call the endpoint with no `Authorization` header.

**Expected outcomes:**

- The trustee gets `404` ("this account has not registered an LP yet").
- The anonymous caller gets `401`.
- Neither call adds a row to `lp_requested_bank_details`.

---

## Story 5: A missing bank-details record is a server error and issues nothing

**Persona:** Operator who deleted the `system_bank_details` row.

**Steps:**

1. Delete the row, then call the endpoint as an eligible LP.

**Expected outcomes:**

- `500` with the generic internal-error body; no partial body.
- No row is added to `lp_requested_bank_details`.
- Restoring the row restores `200`.

---

## Story 6: The DB refuses a malformed bank-details edit

**Persona:** Operator editing the bank details by hand.

**Steps:**

1. `UPDATE system_configuration SET value = value - 'iban' WHERE type = 'system_bank_details';`
2. `UPDATE system_configuration SET value = jsonb_set(value, '{iban}', '123') WHERE type = 'system_bank_details';`

**Expected outcomes:**

- Both statements fail on `system_configuration_bank_details_shape_ck`; the stored row is unchanged.

---

## Story 7: An unconfigured bank-details record is refused and issues nothing

**Persona:** Eligible LP (Passed, linked address) calling before the operator has filled the record.

**Pre-conditions:** The seeded all-empty row, or a row whose `swift_bic_code` is `""`.

**Steps:**

1. Count rows in `lp_requested_bank_details`, then call the endpoint as the eligible LP.
2. Call it as an LP that is `UnderReview`.
3. Fill the record (Story 8) and call again as the eligible LP.

**Expected outcomes:**

- Step 1 is `503` with a JSON `error` saying the funding details are not configured; no `payment_details` in the body,
  and the row count is unchanged. The server log names the blank fields, not their values.
- Step 2 is still `409` (the access gate runs first).
- Step 3 is `200` with the filled fields.

---

## Story 8: An operator fills the record with the runbook

**Persona:** Operator with `psql` access to the environment's database.

**Steps:**

1. Run the template from [deposits.md](../../product-specs/deposits.md) § Filling the bank details with the environment's
   values.
2. Call the endpoint as an eligible LP, without restarting the API.

**Expected outcomes:**

- The `UPDATE` reports `UPDATE 1` and the `SELECT` shows the new values.
- The next call serves them (`200`); no restart is needed.
