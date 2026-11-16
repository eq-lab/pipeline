# User story: #1921 — Stellar AccessManager indexer: scheduled / canceled / executed operations with args from the transaction

**Epic:** #1920
**Issue:** https://github.com/eq-lab/pipeline/issues/1921
**Status:** Initial

---

## Overview

The worker indexes the Stellar AccessManager's `OperationScheduled`, `OperationCanceled` and `OperationExecuted` events into `contract_logs`, and a separate `access-manager-sync` task recovers each scheduled call's arguments from its transaction and projects the operation into `access_manager_operations`. #1922 (API) reads that table. Spec: `docs/references/access-manager-events.md`.

Persona: operator (worker logs, env key, database). There is no UI or API in this issue. The key is `CHAIN_<id>_STELLAR_INDEXER_ACCESS_MANAGER_ADDRESS`; unset ships dark. Stories 3 and 4 need testnet writes on the AccessManager and run in the epic QA pass #1925 or on stage.

---

## Story 1 — The key is set and the indexer is enabled

**Given** the testnet AccessManager id from `.env.example` set as `CHAIN_99000001_STELLAR_INDEXER_ACCESS_MANAGER_ADDRESS`

**When** the worker starts

**Then:**

- It logs "Stellar AccessManager indexer enabled" with the id and runs the `access-manager-sync` task
- There are no AccessManager `warn` lines
- Setting the same id as `SECURITY_REGISTRY_ADDRESS`, `LOAN_REGISTRY_ADDRESS` or any other indexer key fails startup with an error naming `ACCESS_MANAGER_ADDRESS`
- A value that is not a valid `C…` Strkey fails startup with an error naming the key
- With the key unset the worker polls no AccessManager events, spawns no sync task and `access_manager_operations` stays empty

---

## Story 2 — A scheduled operation is projected with its arguments

**Given** the key is set, the cursor is at or before the Risk Council's `amend_economics` schedule on loan 0 (ledger 5 710 989, operation id `a36a52bd…ef3e`) and that ledger is still within RPC retention

**When** the indexer passes the ledger

**Then:**

- `contract_logs` has an `AccessManagerOperationScheduled` row with `operation_id`, `caller`, `nonce`, `when`, `target` (the LoanRegistry) and `function = amend_economics`
- Within about 15 s `access_manager_operations` has a `pending` row with `args_xdr` set, `args_json = [0, 145000, "1816128000"]`, `loan_id = 0`, `ready_at` equal to the event's `when` and `expires_at = ready_at + 604800`
- `access_manager_sync_state.last_log_id` equals that row's `contract_logs.id` (or a later one)
- Role events (`role_granted`, `target_function_role_updated`, …) produce no row

---

## Story 3 — Execute and cancel close the operation

**Given** a pending `access_manager_operations` row

**When** the Risk Council executes it from the Trustee (or cancels it)

**Then:**

- Within about 15 s the row is `executed` (or `canceled`) with `closed_tx_hash` and `closed_ledger` set
- Immediate executes by the relayer or the Trustee (no pending row for the same target, function and caller) produce no `getTransaction` call and change no row
- Re-scheduling the same call after it was closed adds a second row (`nonce + 1`, or `nonce = 1` again once the contract's entry lapsed about 8 days later); the closed row is untouched

---

## Story 4 — An RPC problem never stalls the chain cursor

**Given** the key is set and `getTransaction` calls from the worker fail (RPC down or blocked for the sync task)

**When** new ledgers are indexed

**Then:**

- `log_collector_state.last_indexed_block` keeps advancing and other contracts' rows keep landing
- `access_manager_sync_state.last_log_id` stops at the last row that was applied; one `warn` per stuck row, later retries at `debug`
- When the RPC returns, the sync task resumes in order without manual steps

---

## Story 5 — A transaction beyond retention is stored without arguments

**Given** an AccessManager schedule row whose transaction left RPC retention before the sync task reached it

**When** the sync task processes the row

**Then:**

- A `pending` row exists with `args_xdr`, `args_json`, `loan_id` and `record_id` all `NULL`, and a `warn` names the transaction
- An execute row in the same situation leaves its operation `pending`, with a `warn`
- The watermark advances in both cases
