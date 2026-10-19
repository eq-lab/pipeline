# User story: #1565 — Analytics, PnL, Positions API: chain_id handling for multi-chain

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1565
**Status:** Initial

---

## Overview

`GET /v1/pnl` and `GET /v1/positions/history` now require `chain_id`, with no silent `DEFAULT_CHAIN_ID` fallback. The chain kind that drives wallet normalisation comes from the matching entry in `CHAINS`, so the former 500 `invalid chain type configuration` path is gone. `GET /v1/requests` gains an optional `chain_id` filter and every returned item carries its `chain_id`. PnL / history computation, interval / days / sample-cap handling and the response shapes are unchanged. Backend-only; no Figma reference. The LP frontend `usePnl` and `usePositionsHistory` already send `chain_id`; `useRequests` sends none and keeps receiving all chains.

Automated coverage is in `packages/api/tests/analytics_pnl_positions_chain.rs` (400 messages on both PnL routes, `/v1/requests` malformed / repeated / unconfigured handling, OpenAPI flags and the `RequestItem.chain_id` schema field).

---

## Story 1 — PnL and position history without a valid chain_id are refused

**Given** the API is configured with `CHAINS=1,99000001`

**When** `GET /v1/pnl` or `GET /v1/positions/history` is called without `chain_id`, with `chain_id=5`, or with `chain_id=abc`

**Then:**

- Missing returns 400 `{"error":"chain_id is required"}`
- `chain_id=5` returns 400 `unknown chain_id: 5 (configured: 1, 99000001)`
- `chain_id=abc` returns 400 `invalid chain_id: abc`
- No database access happens

## Story 2 — Wallet format follows the configured chain kind

**Given** chain 99000001 is a Stellar chain and chain 1 is an EVM chain

**When** either route is called with `chain_id=99000001` and a `0x…` wallet

**Then:**

- It returns 400 with an `invalid Stellar wallet address` message
- On the EVM chain the wallet is only lowercased, so a wrong-format wallet is not a 400 — it simply matches no positions

## Story 3 — The activity feed can be filtered by chain

**Given** a wallet with requests on chains 1 and 99000001

**When** `GET /v1/requests?wallet=…` is called with no `chain_id`, with `chain_id=1`, with `chain_id=5`, and with `chain_id=abc`

**Then:**

- No `chain_id` returns the rows of all chains, as before
- `chain_id=1` returns only chain 1's rows
- `chain_id=5` (well-formed, not in `CHAINS`) returns 200 `{"requests":[]}` without touching the database
- `chain_id=abc`, or `chain_id` given twice, returns 400
- Every item carries `chain_id`, the chain the row was indexed on

## Story 4 — A claim on one chain does not complete a request on another

**Given** two requests with the same `request_id` and contract address on different chains, and a `RequestClaimed` log only on chain 1

**When** `GET /v1/requests` is called for the wallet

**Then:**

- The chain 1 request is `Completed`
- The chain 99000001 request is not marked claimed, and appears under `status=pending`
