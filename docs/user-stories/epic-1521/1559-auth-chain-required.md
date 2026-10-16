# User story: #1559 — Wallet auth: chain_id is required on challenge and verify

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1559
**Status:** Initial

---

## Overview

`GET /v1/auth/challenge` and `POST /v1/auth/verify` now require `chain_id` (query parameter on challenge, body field on verify). There is no silent `DEFAULT_CHAIN_ID` fallback. The chain kind (EVM or Stellar) that selects the signature scheme and address normalisation comes from the matching entry in `CHAINS`. Signature verification, nonce handling, `auth_users` lookup and JWT contents are unchanged; the password, OTP and reset endpoints are untouched. Backend-only; no Figma reference. The Trustee client already sends `chain_id` on both calls.

Automated coverage is in `packages/api/tests/auth_chain_required.rs` (400 messages on both endpoints, kind dispatch, OpenAPI required flags).

---

## Story 1 — A challenge without a valid chain_id is refused

**Given** the API is configured with `CHAINS=1,99000001`

**When** `GET /v1/auth/challenge?address=<addr>` is called without `chain_id`, with `chain_id=5`, or with `chain_id=abc`

**Then:**

- Missing returns 400 `{"error":"chain_id is required"}`
- `chain_id=5` returns 400 `unknown chain_id: 5 (configured: 1, 99000001)`
- `chain_id=abc` returns 400 `invalid chain_id: abc`
- No nonce is written

## Story 2 — A verify without a valid chain_id is refused

**Given** the same configuration

**When** `POST /v1/auth/verify` is called with `{address, signature}` and no `chain_id`, or with `chain_id: 5`

**Then:**

- Missing returns 400 `chain_id is required` (not a 422)
- `chain_id: 5` returns 400 `unknown chain_id: 5 (configured: 1, 99000001)`
- No token is issued and the stored nonce is not consumed

## Story 3 — Sign-in still works on each configured chain

**Given** an allow-listed EVM address on chain 1 and an allow-listed Stellar address on chain 99000001

**When** each wallet requests a challenge with its `chain_id`, signs it, and posts it to verify with the same `chain_id`

**Then:**

- A JWT is issued, carrying the normalised address and that chain id as before
- The Trustee sign-in flow in the browser works unchanged
