# User story: #1739 — Stellar indexer never skips a ledger and says when it falls out of RPC retention

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/1739
**Status:** Initial

---

## Overview

The Stellar indexer commits its cursor only up to the ledger the RPC has ingested, reports a cursor that fell below RPC retention with an actionable log line, and every outbound HTTP client has a timeout. Spec: `docs/references/backend.md#stellar-indexer-cursor-and-rpc-retention` and `#http-client-timeouts`.

Persona: Operator running the worker against a load-balanced Stellar RPC.

---

## Story 1 — Lagging getEvents node

**Given** the cursor is 100, `getLatestLedger` returns 110 and `getEvents` reports `latestLedger` 109

**When** the indexer polls

**Then:**

- Events up to ledger 109 are stored and `log_collector_state.last_indexed_block` becomes 110
- The `indexed block range` log shows `to = 109` and `requested_to = 110`
- Ledger 110 is polled again on the next cycle

---

## Story 2 — RPC has not reached the cursor

**Given** every `getEvents` response reports a `latestLedger` below the cursor

**When** the indexer polls

**Then:**

- Nothing is committed and the cursor is unchanged
- The next poll retries

---

## Story 3 — Cursor below retention

**Given** the cursor is below the RPC `oldestLedger` and `getEvents` fails

**When** the indexer polls

**Then:**

- One `error!` line per poll names `chain_id`, `cursor`, `oldest_ledger` and `missing_ledgers`
- The cursor is not moved
- The operator follows the runbook in `docs/references/backend.md#stellar-indexer-cursor-and-rpc-retention` to reset it or to use an archival RPC

---

## Story 4 — Hung upstream

**Given** an RPC, IPFS gateway or vendor API that accepts a connection and never answers

**When** a worker or API client calls it

**Then:**

- The call fails with a timeout after at most 30 s (5 s to connect) instead of hanging
- The caller retries on its next cycle
