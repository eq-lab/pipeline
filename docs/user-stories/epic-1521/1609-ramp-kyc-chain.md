# User story: #1609 — Ramp + KYC API: migrate chain_id handling off the DEFAULT_CHAIN_ID fallback

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1609
**Status:** Initial

---

## Overview

`POST /v1/kyc/applicants`, `POST /v1/kyc/token`, `GET /v1/kyc/status/{wallet_address}` and `GET /v1/ramp/addresses` now require `chain_id` (`RequiredChain`): missing is `400 chain_id is required`, malformed is `400 invalid chain_id: …`, not in `CHAINS` is `400 unknown chain_id: …`. The check runs before any database or Sumsub call. The KYC wallet kind comes from `CHAINS`, so the old `500 invalid chain type configuration` is gone. The LP profile is per `(chain, wallet)`, so KYC has no all-chains mode. `POST /v1/kyc/callback` (Sumsub webhook) is unchanged.

`GET /v1/ramp/events` takes an optional `chain_id` like the audit log: omitted merges the pending events of every configured chain that has ramp/custody addresses, newest first (`created_at` desc, then `id` desc); a configured id returns that chain; a well-formed but unconfigured id is `200 {"events":[]}` with no database call; malformed or repeated is `400`. Each event carries `chain_id`, and is classified with that chain's own address sets. `POST /v1/ramp/events/{id}/review` takes the chain from the event itself and documents no `chain_id` parameter.

Backend-only; no Figma reference. Frontend follow-up: the Trustee ramp hooks and any LP KYC caller must send `chain_id`. Automated coverage is in `packages/api/tests/ramp_kyc_chain.rs`.

---

## Story 1 — KYC requires a configured chain

**Given** `CHAINS=1,99000001`

**When** a client calls any of the three KYC routes without `chain_id`, with `chain_id=abc`, or with `chain_id=5`

**Then:**

- The response is 400 with `chain_id is required`, `invalid chain_id: abc` or `unknown chain_id: 5 (configured: 1, 99000001)`
- No database or Sumsub call happens
- With `chain_id=99000001` a `0x…` wallet is rejected as an invalid Stellar address

## Story 2 — Ramp addresses are per chain

**Given** chain 1 has ramp addresses configured and chain 99000001 has none

**When** a client calls `GET /v1/ramp/addresses?chain_id=1`, then `?chain_id=99000001`, then without `chain_id`

**Then:**

- Chain 1 returns its sorted ramp addresses; chain 99000001 returns `{"ramp_addresses":[]}`
- A missing, malformed or unknown `chain_id` is 400

## Story 3 — The Trustee lists ramp events across chains

**Given** pending ramp-boundary transfers exist on two configured chains

**When** the Trustee calls `GET /v1/ramp/events` without `chain_id`, with one configured id, and with `chain_id=5`

**Then:**

- Omitted returns both chains' events newest first, each with its `chain_id` and an amount normalized with its own chain's decimals
- A configured id returns only that chain's events
- `chain_id=5` returns `{"events":[]}` without a database call
- `chain_id=abc` or a repeated `chain_id` is 400
