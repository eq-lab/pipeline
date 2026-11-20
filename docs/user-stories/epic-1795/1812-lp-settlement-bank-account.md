# User story: #1812 — LP settlement bank account for bank wire-outs

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1812
**Status:** Initial

---

## Overview

An LP names the USD bank account its wire-outs are paid to while its KYB record is open. The Trustee reads the full account to settle; the LP and everyone else see at most a masked view. Spec: `docs/product-specs/kyb-lp-verification.md#settlement-bank-account`.

Backend only, so every check is an API call on the test environment with a real session. Open DevTools Network (or use curl with the bearer token) before starting. Use an LP in `NotStarted` or `ChangesRequested`, a Trustee token, and a Stellar chain with a minter that has a `Pending` wire-out for that LP.

---

## Story 1 — An LP saves its account during KYB and sees it masked

**Given** an LP whose KYB status is `NotStarted`

**When** it calls `POST /v1/lps/me` with the profile and `settlement_bank_account` `{ account_holder_name, bank_name, iban: "GB82 WEST 1234 5698 7654 32", swift_bic_code: "WESTGB2L" }`

**Then:**

- The response is 200 or 201 with `settlement_bank_account: { account_holder_name, bank_name, account_last4: "5432" }`
- The response has no `settlement_bank_account_details` key
- `GET /v1/lps/me` and the responses of the documents upload, submit and link-address verify show the same masked object
- A later `POST /v1/lps/me` without `settlement_bank_account`, or with `null`, leaves the account unchanged

---

## Story 2 — An invalid account is a 400 that names the field

**Given** the same LP

**When** it posts an `iban` with one digit changed, or only an `account_number` with no `swift_bic_code` or `routing_number`

**Then:**

- The response is 400 and the message names the field, for example `settlement_bank_account.iban`
- The message does not contain the submitted value
- The stored account is unchanged

---

## Story 3 — The Trustee reads the full account on the LP detail

**Given** the LP of Story 1 and a Trustee token

**When** the Trustee calls `GET /v1/lps/{id}`

**Then:**

- The response has `settlement_bank_account` (masked) and `settlement_bank_account_details` with every field, the IBAN normalized to `GB82WEST12345698765432`
- The `POST /v1/lps/{id}/kyb` response carries the same two keys

---

## Story 4 — The account is frozen with the KYB record

**Given** the LP has submitted for review and is `UnderReview`, then `Passed`

**When** it calls `POST /v1/lps/me` with a different `settlement_bank_account`

**Then:**

- The response is 409 and says the profile and settlement bank account can no longer be changed
- Resubmitting the identical profile and account, or omitting the account, still succeeds and updates `notify_on_review`
- After the Trustee returns the record as `ChangesRequested`, a different account is accepted

---

## Story 5 — A pending wire-out carries the destination

**Given** the LP has a `Pending` wire-out, and a settled and a cancelled one

**When** the Trustee calls `GET /v1/cash-book?chain_id=<stellar chain>`

**Then:**

- The `Pending` row has `bank_account` with every field
- The settled and cancelled rows have no `bank_account` key
- A row whose LP is not resolved has no `bank_account` key
- A non-Trustee token gets 403

---

## Story 6 — No bank data on public endpoints

**When** anyone calls `GET /v1/requests` and `GET /v1/audit-log`

**Then:**

- No response field contains the account holder, bank name, IBAN, account number, SWIFT/BIC or routing number
