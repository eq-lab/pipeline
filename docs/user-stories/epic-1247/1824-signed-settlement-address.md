# User Stories: #1824 — Backend: signed settlement-address linking (Stellar + EVM) + chain-aware payment-details

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1824](https://github.com/eq-lab/pipeline/issues/1824)
Spec: [docs/product-specs/kyb-lp-verification.md](../../product-specs/kyb-lp-verification.md#settlement-address), [docs/product-specs/api-authorization.md](../../product-specs/api-authorization.md), [docs/product-specs/deposits.md](../../product-specs/deposits.md) § LP Funding Details

Backend-only. The stories run against a running API and its database with `curl` (or Swagger UI at `/swagger-ui`). The LP app
linking UI is #1825, the Trustee display is #1826, and the Funding details modal is #1817. Replace `$API` and `$TOKEN` with the
API base URL and the LP session's bearer token, `$STELLAR_CHAIN_ID` / `$EVM_CHAIN_ID` with configured chain ids. Signatures come
from a wallet or a script: Stellar SEP-0053 `signMessage` (base64 or hex), EVM EIP-191 `personal_sign` (hex).

---

## Story 1: Link a Stellar account (`G…`) that signs for itself

**Persona:** LP (any status short of `Failed`) holding the key of a `G…` account.

**Steps:**

1. `curl -H "Authorization: Bearer $TOKEN" "$API/v1/lps/me/link-address/challenge?chain_id=$STELLAR_CHAIN_ID&address=$G"`
2. Sign the returned `message` with the key of `$G`.
3. `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"chain_id":'$STELLAR_CHAIN_ID',"address":"'$G'","signature":"'$SIG'"}' $API/v1/lps/me/link-address/verify`

**Expected outcomes:**

- Step 1 is `200` with `{ message, nonce }`; the message starts `<domain> wants you to link a settlement address to your Pipeline LP account.`
- The message is a single line and contains no line break, and `Issued At` is exactly 1 hour before `Expiration Time`.
- Step 2 signs the `message` as returned; no `\n` unescaping is needed because the message has none.
- Step 3 is `200` with the LP record: `stellar_address` and `stellar_signer_address` both equal `$G`, `address_linked_at` is set.
- `lp_address_challenges` has no row for this LP and chain any more.

---

## Story 2: Link a Stellar contract (`C…`) through a `G…` signer

**Persona:** LP whose settlement address is a contract and whose signer is a `G…` account.

**Steps:**

1. Request the challenge with only `address=$C`.
2. Request it again with `address=$C&signer_address=$G`, sign the message with `$G`, and verify with `signer_address` in the body.

**Expected outcomes:**

- Step 1 is `400` with `signer_address is required for a Stellar contract (C…) settlement address`.
- Step 2 verifies with `200`: `stellar_address = $C`, `stellar_signer_address = $G`.
- A mistyped `$C` (bad checksum) is refused at the challenge with `400`.

---

## Story 3: Link an EVM address

**Persona:** LP with an EVM wallet.

**Steps:**

1. Request the challenge with `chain_id=$EVM_CHAIN_ID&address=<EIP-55 checksummed address>`.
2. Sign the message with `personal_sign` and verify.

**Expected outcomes:**

- `200` with `evm_address` and `evm_signer_address` stored **lowercase**, and `evm_address_linked_at` set.
- A mixed-case address with a wrong checksum is `400 address is not a valid EIP-55 checksum`.
- An LP that is `Passed` with a Stellar address but no EVM address can still link this one.

---

## Story 4: A bad proof is refused with `422` and the session survives

**Persona:** LP with a live challenge.

**Steps:**

1. Verify with a signature made by another key.
2. Wait past the 1-hour expiry (or set `expires_at` in the past), then verify with the right signature.
3. Verify a successful link a second time with the same signature (replay).
4. Verify with a signature over the sign-in message from `GET /v1/auth/challenge`.
5. Verify with an `address` or `signer_address` different from the challenge.
6. Call `GET /v1/lps/me` afterwards.

**Expected outcomes:**

- Every step 1-5 is `422` with the single body `{"error":"settlement address proof failed"}`.
- A wrong-key signature (step 1) leaves the challenge row in place; the others find none.
- Step 6 is `200`: the token is still valid. No call in this story returns `401`.

---

## Story 5: Ineligible LPs get `409`

**Persona:** An LP refused at KYB. A `Passed` LP may relink: see the #1831 stories.

**Steps:**

1. As the `Failed` LP, request a challenge. (A suspended account is refused earlier, with `403 account_suspended`.)
2. Request a challenge for an address another LP already holds.
3. Request a challenge, then mark the LP `Failed` in the database, then verify with the right signature.

**Expected outcomes:**

- Step 1 is `409 LP <id> was refused at KYB and cannot set a settlement address`.
- Step 2 is `409 <Kind> settlement address <address> is already linked to another LP`.
- Step 3 is `409`, and the challenge row is gone: a valid signature followed by a refused link spends the challenge.

---

## Story 6: Two concurrent verifies link at most once

**Persona:** Operator replaying the same verify request twice at once.

**Steps:**

1. Obtain a challenge and a valid signature.
2. Send the identical `verify` request twice in parallel.

**Expected outcomes:**

- Exactly one request is `200`; the other is `422 settlement address proof failed`, because only one `DELETE ... RETURNING` finds the row.
- The LP row shows one link and one signer.

---

## Story 7: The unsigned endpoint is gone

**Persona:** Any client of the old API.

**Steps:**

1. `curl -i -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"stellar_address":"'$G'"}' $API/v1/lps/me/link-address`

**Expected outcomes:**

- `404` with an empty body, and `stellar_address` is unchanged.
- `/api-docs/openapi.json` has no `/v1/lps/me/link-address` path, only `.../challenge` and `.../verify`.

---

## Story 8: Addresses linked before this change are kept as unproven

**Persona:** LP linked through the old unsigned endpoint.

**Steps:**

1. `GET /v1/lps/me` for that LP.
2. Run `UPDATE lps SET updated_at = now() WHERE id = <id>` and a KYB decision on it.

**Expected outcomes:**

- `stellar_address` is set, `stellar_signer_address` is `null` (unproven).
- Both statements succeed: no constraint rejects the legacy row.
- Linking again through Story 1 (where the status rule allows) fills in the signer.

---

## Story 9: Payment details are per chain

**Persona:** `Passed` LP with a linked Stellar address and no EVM address.

**Steps:**

1. `GET $API/v1/lps/me/payment-details?chain_id=$STELLAR_CHAIN_ID`
2. `GET $API/v1/lps/me/payment-details?chain_id=$EVM_CHAIN_ID`
3. Link an EVM address (Story 3) and repeat step 2.
4. Query `lp_requested_bank_details` for this LP.

**Expected outcomes:**

- Step 1 is `200` with nine keys; `chain_id` is the Stellar id and `receiver_address` is `stellar_address`.
- Step 2 is `409` naming "a linked EVM settlement address"; no row is added.
- Step 3 is `200` with `chain_id = $EVM_CHAIN_ID` and `receiver_address = evm_address`.
- The new rows carry `chain_id` and `receiver_address`.

---

## Story 10: The database enforces the new rules

**Persona:** Operator with SQL access.

**Steps:**

1. `INSERT INTO lp_requested_bank_details (lp_id, payment_details) VALUES (<id>, 'PL-AAAA-AAAA-AAAA');`
2. `SELECT count(*) FROM lp_requested_bank_details WHERE chain_id IS NULL;` on a database that had references before the migration.
3. `UPDATE lps SET evm_address = '0xABC…' WHERE id = <id>;`

**Expected outcomes:**

- Step 1 fails on `lp_requested_bank_details_chain_id_nn`: every new row must carry a chain and receiver.
- Step 2 counts the legacy rows, whose `receiver_address` equals their LP's `stellar_address`; they stay readable and are never validated.
- Step 3 fails on `lps_evm_address_ck` (lowercase required).
