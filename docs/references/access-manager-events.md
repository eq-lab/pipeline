# AccessManager scheduled operations (Stellar)

Indexing of the Stellar AccessManager's scheduled-operation events (#1921, epic #1920). The worker stores `OperationScheduled`, `OperationCanceled` and `OperationExecuted` as raw `contract_logs` rows, then a separate task recovers each scheduled call's arguments from the transaction and projects the operation into `access_manager_operations`. The read API is described in [API read](#api-read); the Trustee pages are #1923 and #1924. Role and target events are out of scope.

Contract source: `pipeline-stellar-contracts@e9881ac`, `contracts/access-manager/src/{lib.rs,event.rs,storage.rs}`. Contracts are frozen.

## Configuration

`CHAIN_<id>_STELLAR_INDEXER_ACCESS_MANAGER_ADDRESS` (optional, Strkey `C…`). Unset ships dark: the AccessManager is not polled, no sync task runs and the worker boots as before. The key joins the distinct-role check as `ACCESS_MANAGER_ADDRESS`, so it must differ from every other indexer contract key. It equals `CHAIN_<id>_RELAYER_STELLAR_ACCESS_MANAGER_ID` on a given chain (testnet `CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW`). The worker logs "Stellar AccessManager indexer enabled" when the key is set and spawns the supervised `access-manager-sync` task.

The `loan_id` rules compare an operation's `target` with the indexer's own `LOAN_REGISTRY_ADDRESS`, `MINTER_ADDRESS` and `SECURITY_REGISTRY_ADDRESS`. A key that is unset leaves `loan_id` `NULL` for operations on that contract (the row is still stored).

## Encoding

All three events are `#[contractevent]`s with the default format: `topics[0]` is the snake_case symbol, `#[topic]` fields follow, `value` is a map of the remaining fields (map format with `Symbol` keys, not a vec).

| On-chain topic | Topics after the symbol | Value map | Stored `event_name` | Stored `params` |
|---|---|---|---|---|
| `operation_scheduled` | `operation_id: BytesN<32>`, `caller: Address` | `nonce: u32`, `when: u64`, `target: Address`, `function: Symbol` | `AccessManagerOperationScheduled` | `operation_id` (64 lowercase hex), `caller`, `nonce` (decimal string), `when` (decimal string, unix s, resolved by the contract), `target`, `function` |
| `operation_canceled` | `operation_id` | `nonce: u32` | `AccessManagerOperationCanceled` | `operation_id`, `nonce` |
| `operation_executed` | `target: Address`, `function: Symbol`, `caller: Address` | none | `AccessManagerOperationExecuted` | `target`, `function`, `caller` |

Addresses are exact Strkeys (`G…` or `C…`). The event carries no arguments, so `args` come from the transaction (see [Args recovery](#args-recovery)).

Allow-listed and dropped silently, with no row: `role_granted`, `role_revoked`, `role_admin_changed`, `role_guardian_changed`, `role_grant_delay_changed`, `target_function_role_updated`, `target_closed`, `target_admin_delay_updated`. An unrecognised topic, or one of the three that fails to decode, logs `warn` and is dropped; it never fails `poll`.

Indexing is RPC-free for the AccessManager: `poll` decodes the event XDR only and pushes a plain log mapper. Nothing else runs inside `index_once`, so AccessManager or RPC problems never stall the chain cursor.

## Table

Migration `20261116000001_access_manager_operations.sql` (additive). Key `UNIQUE (chain_id, contract_address, operation_id, nonce)`.

| Column | Meaning |
|---|---|
| `operation_id` | `sha256(XDR(Operation { caller, target, function, args }))`, 64 lowercase hex, no `0x` |
| `nonce` | the contract's per-id counter; a re-schedule after expiry, cancel or execute reuses the id with `nonce + 1` |
| `caller`, `target`, `function` | from the event |
| `args_xdr` | base64 XDR of `ScVal::Vec(args)`, the third argument of `schedule` exactly as invoked; `NULL` when not recoverable |
| `args_json` | deterministic display form of the same value; `NULL` with `args_xdr` |
| `ready_at` | the event's `when`, unix seconds (the contract resolves `when = 0` to `now + delay`) |
| `expires_at` | `ready_at + 604800` (`EXPIRATION`, `storage.rs`) |
| `status` | `pending`, `executed` or `canceled` |
| `loan_id`, `record_id` | see [Loan id](#loan-id) |
| `schedule_tx_hash`, `schedule_ledger`, `scheduled_at` | the schedule event's transaction, ledger and ledger close time |
| `source_log_id` | `contract_logs.id` of the schedule row |
| `closed_tx_hash`, `closed_ledger` | the cancel or execute that closed it |

`expired` is never stored. A consumer derives it as `status = 'pending' AND now >= expires_at`.

Status rules: a schedule inserts `pending` (`ON CONFLICT DO NOTHING`). A cancel marks the row with that `(operation_id, nonce)` `canceled` only while it is `pending`. An execute marks the `pending` row with the highest `nonce` of each matching id `executed`. Rows never leave a closed status.

Never truncate `access_manager_operations` to rebuild it: schedules older than RPC retention cannot be recovered again (see [Known limitations](#known-limitations)).

## Sync loop

The `access-manager-sync` task (interval constant 15 s, no env key) reads the AccessManager's raw rows in `contract_logs.id` order past its own watermark `access_manager_sync_state.last_log_id`, fetches transactions with `getTransaction`, and writes `access_manager_operations`. It is spawned under `spawn_supervised`, so it dies with the indexer and restarts with the usual backoff (30 s doubling to 10 min) after an error or panic. Each cycle runs under a 60 s budget and a panic guard. A cycle that applied 200 rows (`ROWS_PER_CYCLE`) runs the next one without sleeping, so a rewind catches up quickly.

**Ordering.** Rows are processed strictly by id and the loop never skips a row. Within one `index_once` batch the mappers are inserted in event order inside one database transaction, and AccessManager rows of a chain are written only by that chain's `index_once`, which runs batches sequentially. A higher id is therefore never committed before a lower one for `(chain_id, contract_address)`, and an id watermark cannot skip an uncommitted row. A schedule is always projected before a cancel or execute of the same id, including when both are in the same batch or transaction.

**Per-row transaction.** Each row is applied in its own database transaction that writes the projection change and advances `last_log_id` to that row's id. A crash between rows repeats nothing; a crash inside a row rolls both back. Writes are idempotent anyway (`ON CONFLICT DO NOTHING`; updates guarded by `status = 'pending'`).

**Retries.** An RPC transport error, a 20 s timeout `NOT_FOUND` within retention or without `oldestLedger` (the RPC node is not caught up), and a failed projection write are retryable: the cycle stops at that row without advancing the watermark, and a per-row backoff (1 min doubling to 1 h) delays the retry. The first failure per row per process logs `warn`, later ones `debug`. Head-of-line blocking is intended: it preserves ordering and only delays the projection, never indexing. A row whose params do not parse, or whose transaction has no matching call, is never retried.

**Retention edge.** `NOT_FOUND` with the row's ledger provably below `oldestLedger` means the transaction left RPC retention before the loop reached it. A `NOT_FOUND` without `oldestLedger` is treated as not yet available and retried. A schedule is stored with `args_xdr`, `args_json`, `loan_id` and `record_id` all `NULL` and a `warn`. An execute changes nothing, logs `warn`, and the row stays `pending` until it reads as expired. Both advance the watermark. A cancel never needs the transaction.

**Re-projection.** Resetting the watermark to 0 replays every row. Rows that already exist are kept (`ON CONFLICT DO NOTHING`); schedules older than retention that were never projected come back with `args = NULL`.

## Args recovery

The event carries neither `args` nor the transaction. The loop fetches `getTransaction` (`envelopeXdr`, `ledger`, `oldestLedger`) and collects candidate invocations: every call to the AccessManager's `schedule` (or `execute`) from the top-level `InvokeHostFunction` operations and from every authorized-invocation tree in those operations' auth entries (root and sub-invocations, recursively). Plain, `TxV0` (yields nothing) and fee-bump envelopes are handled; a fee bump uses its inner transaction. Duplicates (the operation and its own auth root) are harmless because candidates are matched by hash.

**Never guess.** Arguments are stored only when a candidate's recomputed hash equals the row's `operation_id`. The preimage is the `ScVal::Map` with `Symbol` keys in sorted order `args` (`Vec`), `caller` (`Address`), `function` (`Symbol`), `target` (`Address`), XDR-encoded and hashed with SHA-256, as `hash_operation` in `storage.rs` does. No candidate, a parse failure or a mismatch stores the row with `args = NULL` and a `warn`; the watermark advances. A contract wallet that calls `AccessManager.schedule` as a plain sub-call without an auth entry is not recoverable.

**Execute matching.** The loop fetches the transaction for an executed row only when a pending row exists for the same `(target, function, caller)`. Candidates are `AccessManager.execute` calls with that triple; their recomputed ids mark the highest-nonce pending row of each id `executed`. No match means an immediate call (the large majority: relayer and Trustee calls, the Minter's sub-calls) or a schedule from before indexing: no change.

## Loan id

Resolved when the schedule row is projected, only when `args` were recovered, by `target`:

| Target (indexer key) | Function | `loan_id` / `record_id` |
|---|---|---|
| LoanRegistry | `set_default`, `cure`, `amend_economics`, `adjust_interest`, `write_down`, `close_defaulted` | first arg is the loan id |
| Minter | `reverse_repay` | first arg is the loan id |
| SecurityRegistry | `set_terms` | first arg is the loan id |
| SecurityRegistry | `resolve_flag`, `release_with_consent` | first arg is `record_id`; `loan_id` is looked up |
| any other | `set_inspectors`, unknown functions, unconfigured targets, a non-`u32` first arg | both `NULL` |

Loan id `0` is valid. The record lookup, for the SecurityRegistry contract, tries `security_records`, then the `SecurityRecordRegistered` rows in `contract_logs`, then `security_view_snapshots` (`kind = 'record'`); see [security-registry-events.md](./security-registry-events.md). An unresolved lookup leaves `loan_id` `NULL` with `record_id` kept, so the API can resolve it at read time.

`args_json` display form: `u32` / `i32` as numbers; `u64`, `i64`, `u128`, `i128`, `u256`, `i256`, timepoints and durations as decimal strings; `bool`; `void` as `null`; symbols and strings as strings; bytes as lowercase hex; addresses as Strkeys; vectors as arrays; maps with all-`Symbol` keys as objects, other maps as arrays of `{ "key", "value" }`; anything else as `{ "xdr": <base64> }`. The amend example `[0, 145000, 1816128000]` reads `[0, 145000, "1816128000"]`.

## Cursor and retention

`getEvents` and `getTransaction` share the Soroban RPC retention window (`getHealth` `ledgerRetentionWindow` was 120 960 ledgers, about 7 days, on 2026-11-16). A Risk Council operation lives up to `delay (24 h) + 7 d` (about 8 days), longer than retention, so an operation scheduled more than the window ago cannot be backfilled.

Rollout, per chain:

1. Merge and wait for the worker image.
2. Stop the worker, set `CHAIN_<id>_STELLAR_INDEXER_ACCESS_MANAGER_ADDRESS`, rewind `log_collector_state.last_indexed_block` to at or before the earliest still-pending schedule that is within retention (it must stay above `oldestLedger`), start. Replays of other contracts dedupe on the `contract_logs` unique key. The sync loop starts at watermark 0 and catches up.
3. Check: `contract_logs` has the AccessManager rows, `access_manager_sync_state.last_log_id` equals the highest AccessManager row id, and each indexed schedule has a row with `args_xdr` set.

Setting the key without a rewind indexes only from the current cursor.

## API read

`GET /v1/loan-book` and `GET /v1/loan-book/{loan_id}/security` serve `pending_operations` from this table (#1922); fields and states in [loan-security-state.md](../product-specs/loan-security-state.md#pending-operations). One statement per Stellar chain (one loan on `/security`):

- `status = 'pending'` only, `target` equal to the API LoanRegistry, Minter or SecurityRegistry address, `args_xdr` and `args_json` set.
- Loan is `COALESCE(loan_id, record lookup)`; the lookup (same three sources as [Loan id](#loan-id)) runs only for SecurityRegistry rows with `loan_id` `NULL` and `record_id` set. Rows still without a loan are not served.
- A row is dropped when a later schedule of the same `(chain_id, contract_address, operation_id)` exists, compared by `(schedule_ledger, source_log_id)`, not by `nonce`: the contract nonce restarts at 1 after the temporary entry lapses.
- `expired` is derived at read time (`now >= expires_at`); the table never closes an expired row.

## Known limitations

- A raw row whose transaction left retention before the loop reached it yields a schedule with `args = NULL` (the operation cannot be executed from the console) or an execute that leaves its row `pending` until it reads as expired. Reconciliation against the contract's `get_schedule` / `get_nonce` is tech debt (TD-187).
- A schedule made by a contract as a plain sub-call without an auth entry is not recoverable.
- An `execute` of a delayed operation made by a contract as a plain sub-call without an auth entry yields no candidate; its row stays `pending` until it reads as expired (TD-187).
- An immediate `execute` (caller delay 0) of the same arguments as a still-pending schedule marks that schedule `executed` although it is still live on chain (TD-187).
- A schedule of the same operation id, arguments and caller made after the contract's temporary entry lapsed restarts the nonce at 1 and collides with the old row on the unique key; the indexer drops it (BUG-38, #1927).
- Re-projection from watermark 0 loses arguments of schedules older than retention (see [Sync loop](#sync-loop)).
