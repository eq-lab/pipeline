# User story: #1939 — EVM AccessManager indexer: scheduled / canceled / executed operations with calldata

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/1939
**Status:** Initial

---

## Overview

The worker indexes the EVM AccessManager's `OperationScheduled`, `OperationCanceled` and `OperationExecuted` events into `contract_logs`, and the shared `access-manager-sync` task projects each operation into `access_manager_operations` with the scheduled `calldata`, the decoded `function` and `args_json`, and the loan reference. #1941 (API) reads that table for EVM. Spec: `docs/references/access-manager-events.md#evm`.

Persona: operator (worker logs, env key, database). There is no UI or API in this issue. The key is `CHAIN_<id>_EVM_INDEXER_ACCESS_MANAGER_ADDRESS`; unset ships dark. Stories 2, 3 and 4 need a delayed role on the AccessManager; all Hoodi role delays are 0 by deployment, so they run on a local Anvil with a delayed role (or any deployment that sets one).

---

## Story 1 — The key is set and the indexer is enabled

**Given** the Hoodi AccessManager address from `.env.example` set as `CHAIN_<id>_EVM_INDEXER_ACCESS_MANAGER_ADDRESS`

**When** the worker starts

**Then:**

- It logs "EVM AccessManager indexer enabled" with the chain id and address and runs the `access-manager-sync` task
- There are no AccessManager `warn` lines
- Setting the same address as `LOAN_REGISTRY_ADDRESS`, `MINTER_ADDRESS`, `PLUSD_ADDRESS`, the SecurityRegistry keys or any other indexer key fails startup with an error naming both keys
- A value that is not a valid EVM address fails startup with an error naming the key
- A blank value is treated as unset
- With the key unset the worker polls no AccessManager logs, spawns no sync task and the EVM `access_manager_operations` rows stay empty

---

## Story 2 — A scheduled Risk Council call is projected with its calldata

**Given** the key is set, the cursor is at or before a Risk Council `schedule` of `LoanRegistry.amendEconomics(3, 145000, 1816128000)`

**When** the indexer passes the block

**Then:**

- `contract_logs` has an `AccessManagerOperationScheduled` row with `operation_id`, `caller`, `nonce`, `when`, `target` (the LoanRegistry, EIP-55) and `data`
- Within about 15 s `access_manager_operations` has a `pending` row with `function = amendEconomics`, `calldata` equal to the scheduled `data`, `args_json = ["3", 145000, "1816128000"]`, `loan_id = 3`, `ready_at` equal to the event's `when` and `expires_at = ready_at + 604800`
- `access_manager_sync_state.last_log_id` equals that row's `contract_logs.id` (or a later one)
- A `SecurityRegistry.resolveFlag` schedule has `record_id` set, and `loan_id` set once the record is indexed
- A `Minter.reverseRepay` schedule has `loan_id` set; `Minter.reverseDisburse` has none
- Role events (`RoleGranted`, `TargetFunctionRoleUpdated`, …) produce no row

---

## Story 3 — Execute and cancel close the operation

**Given** a pending `access_manager_operations` row

**When** the Risk Council executes it (through `AccessManager.execute`, or by calling the target directly) or cancels it

**Then:**

- Within about 15 s the row is `executed` (or `canceled`) with `closed_tx_hash` and `closed_ledger` set
- An immediate call that consumed no schedule emits no event and changes no row
- Re-scheduling the same call after it was closed adds a second row with `nonce + 1`; the closed row is untouched

---

## Story 4 — An operation id that does not verify is stored without arguments

**Given** a raw schedule row whose `data` does not reproduce the operation id (not possible on the stock contract; checked with a synthetic row)

**When** the sync task processes the row

**Then:**

- A `pending` row exists with `calldata`, `args_json`, `loan_id` and `record_id` all `NULL`, and a `warn` names the operation id
- The watermark advances

---

## Story 5 — Unknown calls are stored as selectors

**Given** a schedule whose target is the AccessManager itself, an unconfigured contract, or a function the ABI table does not know

**When** the sync task processes the row

**Then:**

- The row is stored with `function = 0x<selector>`, `args_json = NULL` and `calldata` set
- Both `loan_id` and `record_id` are `NULL`
