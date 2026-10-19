# User story: #1563 — Vouchers API: deposit/withdrawal vouchers require a configured chain_id

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1563
**Status:** Initial

---

## Overview

`GET /v1/deposits/{request_id}/voucher` and `GET /v1/withdrawals/{request_id}/voucher` now require `chain_id`. There is no silent `DEFAULT_CHAIN_ID` fallback. The chain kind (EVM or Stellar) that selects the signing scheme and wallet normalisation comes from the matching entry in `CHAINS`, so the former 500 `invalid chain type configuration` path is gone. Signing (EVM EIP-712 secp256k1, Stellar Soroban ed25519), wallet normalisation, KYT / allow-list / claimed checks, the response shape and the signer env keys (`CHAIN_<id>_SIGNER_KEY`, `CHAIN_<id>_DM_ADDRESS`, `CHAIN_<id>_WQ_ADDRESS`, Stellar `CHAIN_<id>_API_STELLAR_*`) are unchanged. Backend-only; no Figma reference. The LP frontend voucher hooks already send `chain_id`.

Automated coverage is in `packages/api/tests/vouchers_chain_required.rs` (400 messages on both routes, configured-but-unsigned chains, kind dispatch, OpenAPI required flags).

---

## Story 1 — A voucher request without a valid chain_id is refused

**Given** the API is configured with `CHAINS=1,99000001`

**When** either voucher route is called without `chain_id`, with `chain_id=5`, or with `chain_id=abc`

**Then:**

- Missing returns 400 `{"error":"chain_id is required"}`
- `chain_id=5` returns 400 `unknown chain_id: 5 (configured: 1, 99000001)`
- `chain_id=abc` returns 400 `invalid chain_id: abc`
- No database access happens

## Story 2 — A configured chain without signer config is refused

**Given** chain 1 is in `CHAINS` but has no signer / domain configuration

**When** either voucher route is called with `chain_id=1`

**Then:**

- It returns 400 `voucher signing not configured for chain 1`

## Story 3 — Vouchers still work on each configured chain

**Given** an allow-listed EVM lender with a screened deposit on chain 1 and a Stellar lender with a screened withdrawal on chain 99000001

**When** each LP page requests its voucher with its `chain_id`

**Then:**

- A signed voucher is returned with the same response shape as before
- A `0x` wallet on the Stellar chain, or a `G…` wallet on the EVM chain, is rejected with 400
