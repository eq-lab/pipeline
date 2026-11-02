# User Stories: #1831 — Backend: let an LP change its linked settlement address at any time (including after KYB Passed)

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1831](https://github.com/eq-lab/pipeline/issues/1831)
Spec: [docs/product-specs/kyb-lp-verification.md](../../product-specs/kyb-lp-verification.md#settlement-address) (§ Link history), [docs/product-specs/deposits.md](../../product-specs/deposits.md) § LP Funding Details

Backend-only. The stories run against a running API and its database with `curl` and `psql`. Replace `$API` and `$TOKEN` with the API base URL and the LP session's bearer token, `$STELLAR_CHAIN_ID` / `$EVM_CHAIN_ID` with configured chain ids. Each link is the signed flow of [#1824](./1824-signed-settlement-address.md): a challenge request, a signature of the returned `message`, then a verify. The LP app change is #1825.

Set the LP's status with `UPDATE lps SET kyb_status = '<status>' WHERE id = <id>` where a story names one.

---

## Story 1: Relink at every status except `Failed`, for both kinds

**Persona:** LP that already holds a Stellar address and an EVM address.

**Steps:**

1. For each status of `NotStarted`, `InProgress`, `UnderReview`, `ChangesRequested`, `Passed`: set it, then link a new Stellar address and a new EVM address through challenge and verify.
2. Set `Failed` and request a challenge.

**Expected outcomes:**

- Every verify in step 1 is `200` and the LP record shows the new address, a new signer and a fresh `*_linked_at`.
- Step 2 is `409 LP <id> was refused at KYB and cannot set a settlement address`.

---

## Story 2: Repeated relinks, and an old challenge cannot be replayed

**Persona:** `Passed` LP with a Stellar address.

**Steps:**

1. Link address A, then B, then A again, each with its own challenge and signature. Keep the signature of the first verify.
2. Send the first verify request again.

**Expected outcomes:**

- Each verify in step 1 is `200`.
- Step 2 is `422 settlement address proof failed`; the challenge was consumed.

---

## Story 3: Relink to a previous address and to the same address

**Persona:** `Passed` LP whose Stellar address was linked before the signed flow (`stellar_signer_address IS NULL`).

**Steps:**

1. Link the **same** address through challenge and verify.
2. Link another address, then link the first one again.

**Expected outcomes:**

- Step 1 is `200`; `stellar_signer_address` is now non-null. This replaces the unsigned-address proof asked for in #1829.
- Step 2 is `200` for both links.

---

## Story 4: Payment details after a relink

**Persona:** `Passed` LP with a linked Stellar address.

**Steps:**

1. `GET $API/v1/lps/me/payment-details?chain_id=$STELLAR_CHAIN_ID`; note `payment_details` and `receiver_address`.
2. Relink to a new Stellar address.
3. Request payment details again.
4. `SELECT payment_details, receiver_address FROM lp_requested_bank_details WHERE lp_id = <id> ORDER BY id`.

**Expected outcomes:**

- Step 3 returns a new reference and the new `receiver_address`.
- Step 4 shows the first reference with the old receiver and the second with the new one.

---

## Story 5: One history row per link

**Persona:** LP that links twice.

**Steps:**

1. Link a Stellar address for the first time.
2. Relink to another Stellar address.
3. `SELECT chain_kind, chain_id, address, signer_address, previous_address, previous_signer_address, linked_by_account_id, created_at FROM lp_settlement_address_history WHERE lp_id = <id> ORDER BY created_at, id`.

**Expected outcomes:**

- Two rows. The first has `previous_address` and `previous_signer_address` NULL; the second has both set to the first row's values.
- `chain_id` is the verify call's chain, `linked_by_account_id` is the LP owner's account, and `created_at` equals `lps.address_linked_at` for the latest row.
- Rows written by the migration for addresses linked earlier have `chain_id IS NULL` and `linked_by_account_id IS NULL`.

---

## Story 6: No history row on a refusal or a failed proof

**Persona:** LP, a `Failed` LP, and an address held by another LP.

**Steps:**

1. Count the rows of `lp_settlement_address_history` for the LP.
2. As the `Failed` LP, attempt a link; as the LP, attempt to link an address another LP holds; verify with a wrong signature.
3. Count again.

**Expected outcomes:**

- The count is unchanged.

---

## Story 7: A released address can be linked by another LP

**Persona:** Two LPs, the first relinks away from address A.

**Steps:**

1. LP 1 relinks from A to B.
2. LP 2 requests a challenge for A, signs it, and verifies.

**Expected outcomes:**

- Step 2 is `200`, and `lps.stellar_address = A` for LP 2.
- Before step 1, the same request for LP 2 was `409 … is already linked to another LP`.
