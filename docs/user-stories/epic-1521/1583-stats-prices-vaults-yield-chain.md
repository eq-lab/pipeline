# User story: #1583 — Stats, Prices, Vaults, Yield API: chain_id handling for multi-chain

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1583
**Status:** Initial

---

## Overview

`GET /v1/stats/prices` and `GET /v1/stats/yield` now require `chain_id` with the same JSON 400 errors as the other required-chain routes; there is no silent `DEFAULT_CHAIN_ID` fallback. `GET /v1/stats` and `GET /v1/stats/vaults` take an optional `chain_id` filter: omitted returns every configured chain, in `CHAINS` order. `VaultStatsItem` (the `/v1/stats` item) gains `chain_id`; `VaultItem` already had it. APY / share price, price history and yield computation are unchanged; the all-chains answer is the per-chain results concatenated. Backend-only; no Figma reference. The LP frontend `useStats`, `useStatsPrices` and `useStatsYield` already send `chain_id`; `/v1/stats/vaults` has no frontend caller.

Automated coverage is in `packages/api/tests/stats_prices_vaults_yield_chain.rs` (400 messages, malformed / repeated / unconfigured handling, OpenAPI flags and the `VaultStatsItem.chain_id` schema field).

---

## Story 1 — Prices and yield without a valid chain_id are refused

**Given** the API is configured with `CHAINS=1,99000001`

**When** `GET /v1/stats/prices` or `GET /v1/stats/yield` is called without `chain_id`, with `chain_id=5`, or with `chain_id=abc`

**Then:**

- Missing returns 400 `{"error":"chain_id is required"}`
- `chain_id=5` returns 400 `unknown chain_id: 5 (configured: 1, 99000001)`
- `chain_id=abc` returns 400 `invalid chain_id: abc`
- No database access happens

## Story 2 — Stats and vaults can be filtered by chain

**Given** vaults with price history on chains 1 and 99000001

**When** `GET /v1/stats` or `GET /v1/stats/vaults` is called with no `chain_id`, with `chain_id=1`, with `chain_id=5`, and with `chain_id=abc`

**Then:**

- No `chain_id` returns the vaults of all configured chains, in `CHAINS` order
- `chain_id=1` returns only chain 1's vaults
- `chain_id=5` (well-formed, not in `CHAINS`) returns 200 `{"vaults":[]}` without touching the database
- `chain_id=abc`, or `chain_id` given twice, returns 400
- Every `/v1/stats` item carries `chain_id`; the APY window `apy_days` applies per chain as before
