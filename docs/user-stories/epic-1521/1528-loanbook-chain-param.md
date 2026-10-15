# User story: #1528 — LoanBook API: chain parameter foundation

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1528
**Status:** Initial

---

## Overview

Backend-only building blocks: the API now knows its configured chain list and has two `chain_id` query extractors (`ChainFilter`, optional; `RequiredChain`, required). No endpoint uses them yet, so there is no user-visible change and no Figma reference. Stories 1 and 2 are verified by the automated tests in `packages/api/tests/chain_param.rs` and `packages/api/tests/chains_config.rs`.

---

## Story 1 — API refuses a duplicate chain list at startup

**Given** the API environment has `CHAINS=1,1` and `DEFAULT_CHAIN_ID=1`

**When** the API starts

**Then:**

- Startup fails with `CHAINS contains duplicate chain id 1`
- With `CHAINS=1,2` the API starts and existing endpoints behave exactly as before

## Story 2 — chain_id parsing rules (verified by unit tests)

**Given** the configured chains are `1` (EVM) and `99000001` (Stellar)

**When** a `chain_id` query value is parsed

**Then:**

- Optional: no `chain_id` means all configured chains; `1` and `99000001` resolve with their kind; ` 1 ` is trimmed
- Required: a missing `chain_id` returns 400 `{"error":"chain_id is required"}`
- An unknown id returns 400 `unknown chain_id: 5 (configured: 1, 99000001)`
- A non-integer or empty value returns 400 `invalid chain_id: <raw>`
- A repeated `chain_id` returns 400 `invalid chain_id: must appear at most once`

## Story 3 — Existing endpoints are unchanged

**Given** the API is running against the dev stack

**When** an existing endpoint such as `GET /v1/loan-book` is called with and without `chain_id`

**Then:**

- Responses are identical to before this change (default chain fallback still applies)
