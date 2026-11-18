# AccessManager scheduled operations

Indexing of the AccessManager's scheduled-operation events on Stellar (#1921, epic #1920) and EVM (#1939, epic #1937). On both chains the worker stores `OperationScheduled`, `OperationCanceled` and `OperationExecuted` as raw `contract_logs` rows, then a separate supervised `access-manager-sync` task resolves each scheduled call (arguments and loan reference) and projects the operation into `access_manager_operations`. The table, the status rules, the watermark and the loop are shared; only the per-chain row resolver differs. The sections down to [Known limitations](#known-limitations) describe Stellar; [EVM](#evm) covers the EVM indexer and ends with [Differences from Stellar](#differences-from-stellar). The read API is described in [API read](#api-read); the Trustee pages are #1923 and #1924. Role and target events are out of scope.

Contract sources: `pipeline-stellar-contracts@e9881ac`, `contracts/access-manager/src/{lib.rs,event.rs,storage.rs}`; `pipeline-contracts@150631a`, stock OpenZeppelin `AccessManager`. Contracts are frozen.

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

Migrations `20261116000001_access_manager_operations.sql` (additive), `20261117000001_access_manager_operations_schedule_key.sql`, which swaps the unique key for `UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce)` (`access_manager_operations_schedule_key`), and `20261118000002_access_manager_operations_calldata.sql` (#1939), which adds the nullable `calldata` column and the CHECK. One row per schedule event.

| Column | Meaning |
|---|---|
| `operation_id` | `sha256(XDR(Operation { caller, target, function, args }))`, 64 lowercase hex, no `0x` |
| `nonce` | the contract's per-id counter; it increments on a re-schedule while the contract's temporary entry exists and restarts at 1 once it lapses (`schedule_ttl`: 7 d + 1 d after execute or cancel, about 1 d after expiry), so `(operation_id, nonce)` is not unique over time |
| `caller`, `target`, `function` | from the event |
| `args_xdr` | Stellar: base64 XDR of `ScVal::Vec(args)`, the third argument of `schedule` exactly as invoked; `NULL` when not recoverable, and always `NULL` on EVM |
| `calldata` | EVM: `0x` + lowercase hex of the `data` argument of `schedule` (selector + ABI-encoded arguments), exactly as invoked; `NULL` when the operation id did not verify, and always `NULL` on Stellar. A CHECK (`access_manager_operations_one_args_encoding`) keeps `args_xdr` and `calldata` exclusive |
| `args_json` | deterministic display form of the same arguments; `NULL` with `args_xdr` / `calldata` |
| `ready_at` | the event's `when`, unix seconds (the contract resolves `when = 0` to `now + delay`) |
| `expires_at` | `ready_at + 604800` on both chains (`EXPIRATION` on Stellar, `storage.rs`; `expiration()` is the constant `1 weeks` on the EVM `AccessManager`) |
| `status` | `pending`, `executed` or `canceled` |
| `loan_id`, `record_id` | see [Loan id](#loan-id) |
| `schedule_tx_hash`, `schedule_ledger`, `scheduled_at` | the schedule event's transaction, ledger and ledger close time |
| `source_log_id` | `contract_logs.id` of the schedule row |
| `closed_tx_hash`, `closed_ledger` | the cancel or execute that closed it |

`expired` is never stored. A consumer derives it as `status = 'pending' AND now >= expires_at`.

Status rules: a schedule inserts `pending` (`ON CONFLICT DO NOTHING`). A cancel or execute closes the newest row of its `operation_id` (by `(schedule_ledger, source_log_id)`) among the rows logged before the closing event, and only if that row is `pending` (a cancel also needs the event's `nonce`); never by `nonce`. Rows never leave a closed status.

The status rules, the close SQL and `expires_at` apply to both chains unchanged.

Never truncate `access_manager_operations` to rebuild a Stellar chain: schedules older than RPC retention cannot be recovered again (see [Known limitations](#known-limitations)). An EVM chain has no such limit ([EVM cursor and rollout](#evm-cursor-and-rollout)).

## Sync loop

The loop, the watermark, the ordering, the per-row transaction and the backoff are shared by both chains (`indexer/access_manager_sync.rs`); only the per-chain row resolver differs. The text below is the Stellar resolver.

The `access-manager-sync` task (interval constant 15 s, no env key) reads the AccessManager's raw rows in `contract_logs.id` order past its own watermark `access_manager_sync_state.last_log_id`, fetches transactions with `getTransaction`, and writes `access_manager_operations`. It is spawned under `spawn_supervised`, so it dies with the indexer and restarts with the usual backoff (30 s doubling to 10 min) after an error or panic. Each cycle runs under a 60 s budget and a panic guard. A cycle that applied 200 rows (`ROWS_PER_CYCLE`) runs the next one without sleeping, so a rewind catches up quickly.

**Ordering.** Rows are processed strictly by id and the loop never skips a row. Within one `index_once` batch the mappers are inserted in event order inside one database transaction, and AccessManager rows of a chain are written only by that chain's `index_once`, which runs batches sequentially. A higher id is therefore never committed before a lower one for `(chain_id, contract_address)`, and an id watermark cannot skip an uncommitted row. A schedule is always projected before a cancel or execute of the same id, including when both are in the same batch or transaction.

**Per-row transaction.** Each row is applied in its own database transaction that writes the projection change and advances `last_log_id` to that row's id. A crash between rows repeats nothing; a crash inside a row rolls both back. Writes are idempotent anyway (`ON CONFLICT DO NOTHING`; updates guarded by `status = 'pending'`). Closes only see schedules logged before the closing row, so a replay never closes a later schedule.

**Retries.** An RPC transport error, a 20 s timeout `NOT_FOUND` within retention or without `oldestLedger` (the RPC node is not caught up), and a failed projection write are retryable: the cycle stops at that row without advancing the watermark, and a per-row backoff (1 min doubling to 1 h) delays the retry. The first failure per row per process logs `warn`, later ones `debug`. Head-of-line blocking is intended: it preserves ordering and only delays the projection, never indexing. A row whose params do not parse, or whose transaction has no matching call, is never retried.

**Retention edge.** `NOT_FOUND` with the row's ledger provably below `oldestLedger` means the transaction left RPC retention before the loop reached it. A `NOT_FOUND` without `oldestLedger` is treated as not yet available and retried. A schedule is stored with `args_xdr`, `args_json`, `loan_id` and `record_id` all `NULL` and a `warn`. An execute changes nothing, logs `warn`, and the row stays `pending` until it reads as expired. Both advance the watermark. A cancel never needs the transaction.

**Re-projection.** Resetting the watermark to 0 replays every row. Rows that already exist are kept (`ON CONFLICT DO NOTHING`); schedules older than retention that were never projected come back with `args = NULL`.

## Args recovery

The event carries neither `args` nor the transaction. The loop fetches `getTransaction` (`envelopeXdr`, `ledger`, `oldestLedger`) and collects candidate invocations: every call to the AccessManager's `schedule` (or `execute`) from the top-level `InvokeHostFunction` operations and from every authorized-invocation tree in those operations' auth entries (root and sub-invocations, recursively). Plain, `TxV0` (yields nothing) and fee-bump envelopes are handled; a fee bump uses its inner transaction. Duplicates (the operation and its own auth root) are harmless because candidates are matched by hash.

**Never guess.** Arguments are stored only when a candidate's recomputed hash equals the row's `operation_id`. The preimage is the `ScVal::Map` with `Symbol` keys in sorted order `args` (`Vec`), `caller` (`Address`), `function` (`Symbol`), `target` (`Address`), XDR-encoded and hashed with SHA-256, as `hash_operation` in `storage.rs` does. No candidate, a parse failure or a mismatch stores the row with `args = NULL` and a `warn`; the watermark advances. A contract wallet that calls `AccessManager.schedule` as a plain sub-call without an auth entry is not recoverable.

**Execute matching.** The loop fetches the transaction for an executed row only when a pending row exists for the same `(target, function, caller)`. Candidates are `AccessManager.execute` calls with that triple; their recomputed ids close the newest row of each id, if it is `pending`, as `executed`. No match means an immediate call (the large majority: relayer and Trustee calls, the Minter's sub-calls) or a schedule from before indexing: no change.

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

`GET /v1/loan-book` and `GET /v1/loan-book/{loan_id}/security` serve `pending_operations` from this table (#1922, EVM #1941); fields and states in [loan-security-state.md](../product-specs/loan-security-state.md#pending-operations). One statement per chain with a configured target, Stellar or EVM (one loan on `/security`):

- `status = 'pending'` only, `target` equal to the API LoanRegistry, Minter or SecurityRegistry address, `args_xdr` or `calldata` set, and `args_json` set. EVM addresses are EIP-55 strings on both sides (the indexer and the API config both use `to_checksum(None)`) and are compared exactly, so no `lower()` is applied and the index is used.
- Loan is `COALESCE(loan_id, record lookup)`; the lookup (same three sources as [Loan id](#loan-id)) runs only for SecurityRegistry rows with `loan_id` `NULL` and `record_id` set. Rows still without a loan are not served.
- A row is dropped when a later schedule of the same `(chain_id, contract_address, operation_id)` exists, compared by `(schedule_ledger, source_log_id)`, not by `nonce`: the contract nonce restarts at 1 after the temporary entry lapses.
- `expired` is derived at read time (`now >= expires_at`); the table never closes an expired row.

### Function names per chain

The API serves `function` and `args` as stored and adds no mapping. Consumers (the Trustee) map the name per chain from this table (#1941).

| Owner contract | Stellar | EVM |
|---|---|---|
| LoanRegistry | `set_default` | `setDefault` |
| LoanRegistry | `cure` | `cure` |
| LoanRegistry | `amend_economics` | `amendEconomics` |
| LoanRegistry | `adjust_interest` | `adjustInterest` |
| LoanRegistry | `write_down` | `writeDown` |
| LoanRegistry | `close_defaulted` | `closeDefaulted` |
| Minter | `reverse_repay` | `reverseRepay` |
| SecurityRegistry | `set_terms` | `setTerms` |
| SecurityRegistry | `resolve_flag` | `resolveFlag` |
| SecurityRegistry | `release_with_consent` | `releaseWithConsent` |

## Known limitations

- A raw row whose transaction left retention before the loop reached it yields a schedule with `args = NULL` (the operation cannot be executed from the console) or an execute that leaves its row `pending` until it reads as expired. Reconciliation against the contract's `get_schedule` / `get_nonce` is tech debt (TD-187).
- A schedule made by a contract as a plain sub-call without an auth entry is not recoverable.
- An `execute` of a delayed operation made by a contract as a plain sub-call without an auth entry yields no candidate; its row stays `pending` until it reads as expired (TD-187).
- An immediate `execute` (caller delay 0) of the same arguments as a still-pending schedule marks that schedule `executed` although it is still live on chain (TD-187).
- Re-projection from watermark 0 loses arguments of schedules older than retention (see [Sync loop](#sync-loop)).

## EVM

The EVM indexer (#1939, epic #1937) mirrors the Stellar one: raw `contract_logs` rows from `index_once`, the shared supervised `access-manager-sync` loop with its watermark, the unchanged Stellar insert and close SQL, the 604 800 s expiry constant. Everything not listed in [Differences from Stellar](#differences-from-stellar) is identical.

Contract source: `pipeline-contracts@150631a`, stock OpenZeppelin `AccessManager` (`lib/openzeppelin-contracts/contracts/access/manager/AccessManager.sol`), deployed plain (`script/deployers/DeployAccessManager.sol`). Hoodi AccessManager `0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992`. All Hoodi role delays are 0, so nothing is scheduled there until #1944.

### EVM configuration

`CHAIN_<id>_EVM_INDEXER_ACCESS_MANAGER_ADDRESS` (optional, EVM address). Blank is unset. An invalid address is a startup error naming the key. Unset ships dark: no log handler, no sync task, the worker boots as before. The address must differ from every other indexer contract key, `PLUSD_ADDRESS`, `JOB_INDEXER_EVM_<id>_ASSET_ADDRESS` and the SecurityRegistry, RecordNft and Reader keys: `run_indexer_job` rejects a clash with an error naming both keys (`reject_access_manager_collision`, the counterpart of Stellar's distinct-role loop). When set, the worker logs `info` "EVM AccessManager indexer enabled" and spawns `access-manager-sync`.

The SecurityRegistry, RecordNft and Reader keys (`CHAIN_<id>_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS`, `…_SECURITY_RECORD_NFT_ADDRESS`, `…_SECURITY_REGISTRY_READER_ADDRESS`) are shared with #1938 and set together (all or none; a partial set fails startup naming the first missing key). Targets for decoding and `loan_id` come from the indexer's own `LOAN_REGISTRY_ADDRESS`, `MINTER_ADDRESS` and, when set, the SecurityRegistry and RecordNft keys. An unset SecurityRegistry group leaves `loan_id` `NULL` for those operations; the row is still stored.

### EVM encoding

All three events are stock OpenZeppelin events decoded with `alloy` (`indexer/access_manager_evm_parsers.rs`).

| On-chain event (topic0) | Stored `event_name` | Stored `params` |
|---|---|---|
| `OperationScheduled(bytes32 indexed operationId, uint32 indexed nonce, uint48 schedule, address caller, address target, bytes data)` `0x82a2da5d…15f3b4` | `AccessManagerOperationScheduled` | `operation_id` (64 lowercase hex, no `0x`), `caller` (EIP-55), `nonce` (decimal string), `when` (decimal string; the event's resolved `schedule`), `target` (EIP-55), `data` (`0x` + lowercase hex) |
| `OperationCanceled(bytes32 indexed operationId, uint32 indexed nonce)` `0xbd9ac67a…e7b9f7` | `AccessManagerOperationCanceled` | `operation_id`, `nonce` |
| `OperationExecuted(bytes32 indexed operationId, uint32 indexed nonce)` `0x76a2a469…de614d` | `AccessManagerOperationExecuted` | `operation_id`, `nonce` |

`OperationExecuted` fires only when a schedule is consumed (`AccessManager.execute`, or a target's `restricted` modifier through `consumeScheduledOp`); immediate calls emit nothing.

Allow-listed and dropped silently, with no row (nine topic0 values): `RoleLabel`, `RoleGranted`, `RoleRevoked`, `RoleAdminChanged`, `RoleGuardianChanged`, `RoleGrantDelayChanged`, `TargetClosed`, `TargetFunctionRoleUpdated`, `TargetAdminDelayUpdated`. A log from another address is ignored. An unrecognised topic, or one of the three that fails to decode, logs `warn` and is dropped; it never fails `poll`. `block_timestamp` is set by `index_once`. `parse_access_manager_log` is pure, and no RPC call runs for the AccessManager.

### EVM sync loop

The `EvmRowResolver` turns one raw row into one `OpWrite`; the shared loop applies it with the row's watermark in one transaction.

- No RPC: the schedule's `data` is in the raw row, so nothing is retried for RPC reasons. Only a failed projection write is retried, with the shared backoff.
- A schedule resolves as in [EVM args and operation id](#evm-args-and-operation-id) and [EVM loan id](#evm-loan-id).
- A cancel uses the shared `cancel_write`: `MARK_CANCELED_SQL` closes the newest schedule of the id logged before it, only if it is `pending` and its `nonce` matches.
- An execute is `OpWrite::Execute { ids: [operation_id] }` straight from the row, with `MARK_EXECUTED_SQL`. The event's `nonce` is not used, as on Stellar. On EVM the newest schedule before a close is always the one it refers to: the nonce never resets, and a re-schedule needs the previous schedule closed or expired.
- Params that do not parse, hex that does not decode, or `data` shorter than 4 bytes are skipped with a `warn`; the watermark advances.

### EVM args and operation id

`calldata` is the `data` argument of `schedule` exactly as invoked (`0x` lowercase hex, selector included), which is what `execute(target, data)` and `cancel(caller, target, data)` take.

**Never guess.** The resolver recomputes `keccak256(abi.encode(caller, target, data))`, as `AccessManager.hashOperation` does.

- Equal: `calldata`, `function`, `args_json`, `loan_id` and `record_id` are filled.
- Different: the row is stored with `calldata`, `args_json`, `loan_id` and `record_id` all `NULL` (`function` still comes from the selector) and a `warn`. This cannot happen on the stock contract.

`function` is the contract's native Solidity name (camelCase), decoded from the selector with the ABI of the configured target (LoanRegistry, Minter, SecurityRegistry, RecordNft; every external non-view function except `initialize` and the ERC-721 transfers; `upgradeToAndCall(address,bytes)` is included on all four, where Stellar has `upgrade`, and is not loan-scoped). An unknown selector, or a target that is not one of the four (the AccessManager itself, or an unconfigured SecurityRegistry), stores `function = 0x` + 8 lowercase hex, `args_json = NULL` and keeps `calldata`. A known selector whose arguments fail to decode keeps the name, stores `args_json = NULL` and logs `warn`.

`args_json` display form, a positional array: `uint8` to `uint32` and `int8` to `int32` (enums included) as numbers; wider integers as decimal strings; `bool`; `address` as EIP-55; `bytes` and `bytesN` as lowercase hex without `0x`; strings and arrays as such; tuples as objects keyed by the Solidity component names. `setTerms(7, terms)` reads `["7", {"advanceRatioBps": 7000, …, "defaultBreachAt": "0"}]`. NUL never appears.

### EVM loan id

Resolved when the schedule row is projected, only when the operation id verified, by `target`:

| Target (indexer key) | Function | `loan_id` / `record_id` |
|---|---|---|
| LoanRegistry | `setDefault`, `cure`, `amendEconomics`, `adjustInterest`, `writeDown`, `closeDefaulted` | argument 0 is the loan id |
| Minter | `reverseRepay` | argument 0 is the loan id (`reverseDisburse` is decoded but not loan-scoped, as on Stellar) |
| SecurityRegistry | `setTerms` | argument 0 is the loan id |
| SecurityRegistry | `releaseWithConsent`, `resolveFlag` | argument 0 is `record_id`; `loan_id` is looked up |
| any other | `setInspectors` (RecordNft), other functions, unknown selectors, unconfigured targets | both `NULL` |

Loan id `0` is valid. An id above `u32::MAX` gives no reference and a `warn`. The record lookup is the Stellar code path (`AmSyncStore::record_loan`, `RECORD_LOAN_SQL`) with the SecurityRegistry's EIP-55 address: `security_records`, then the `SecurityRecordRegistered` rows in `contract_logs`, then `security_view_snapshots`. A miss leaves `loan_id` `NULL` with `record_id` kept; the read-time `COALESCE` lookup of [API read](#api-read) resolves it later. There is no write-side backfill, and no RPC in the sync loop or in `index_once`.

### EVM cursor and rollout

`eth_getLogs` keeps full history, so there is no retention limit. The projection runs in `contract_logs.id` order (shared with Stellar), and a close matches only a schedule with a lower id. The cursor rewind must therefore be done when the key is first enabled, to the AccessManager deploy block or earlier than the earliest relevant schedule. If the key is enabled without a rewind and a deeper rewind follows later, an `OperationExecuted` can be indexed before its `OperationScheduled`: the execute is a no-op and the schedule then stays `pending` until it expires. Resetting the watermark and rebuilding `access_manager_operations` replays the same id order and does not repair this; the AccessManager raw rows in `contract_logs` would have to be deleted and re-indexed.

Rollout, per chain:

1. Merge and wait for the worker image.
2. Stop the worker, set `CHAIN_<id>_EVM_INDEXER_ACCESS_MANAGER_ADDRESS`, rewind `log_collector_state.last_indexed_block` in the same step, to the AccessManager deploy block or earlier than the earliest relevant schedule, start. Replays of other contracts dedupe on the `contract_logs` unique key. The sync loop starts at watermark 0 and catches up.
3. Check: `contract_logs` has the AccessManager rows, `access_manager_sync_state.last_log_id` equals the highest AccessManager row id for the EIP-55 address, and each indexed schedule has a row with `calldata` set.

Setting the key without a rewind indexes only from the current cursor, and a deeper rewind later is not safe (see above). The API serves them (#1941); see [API read](#api-read).

### EVM known limitations

- If an `OperationScheduled` failed to decode (no raw row), a later execute of the same id could close an older, expired `pending` row of that id. A decode failure logs `warn` and cannot happen for the stock event.
- A schedule made by the AccessManager against itself (`grantRole`, …) is stored with `function = 0x<selector>`, `args_json = NULL`.
- An expired, then re-scheduled operation keeps the old row `pending` (it reads as expired); the API's "later schedule supersedes" rule handles it.
- The Stellar limitations about immediate executes and sub-calls without an auth entry do not exist on EVM: only a consumed schedule emits `OperationExecuted`.

### Differences from Stellar

| # | Area | Stellar (#1921 / #1927) | EVM (#1939) | Chain-level reason |
|---|---|---|---|---|
| 1 | Where args come from | The sync loop fetches `getTransaction` and recovers `schedule` args from the envelope and auth trees. | From the raw row's `data` param. No RPC in the resolver. | `OperationScheduled` carries the full calldata; the Soroban event carries no args. |
| 2 | Scheduled raw-row params | `{operation_id, caller, nonce, when, target, function}` | `{operation_id, caller, nonce, when, target, data}`; `function` is derived in the sync loop. | The EVM event has no function name, only the selector inside `data`. |
| 3 | Executed raw-row params | `{target, function, caller}` | `{operation_id, nonce}` | OpenZeppelin emits `OperationExecuted(operationId, nonce)`. |
| 4 | Execute resolution | `has_pending_call` gate, transaction fetch, re-hash of `execute` candidates. | `ids = [operation_id]` from the row. Same `OpWrite::Execute` and `MARK_EXECUTED_SQL`. | The EVM event names the operation. |
| 5 | When an execute event fires | For every `execute`, including immediate ones (TD-187). | Only when a schedule is consumed. | `_consumeScheduledOp` is the only emitter. |
| 6 | Operation id | `sha256(XDR(Map{args, caller, function, target}))`, used to select the args among candidates. | `keccak256(abi.encode(caller, target, data))`, used to verify the event's own `data`. A mismatch stores the row without args and logs `warn`. | Different hash preimage per contract. |
| 7 | Native args column | `args_xdr` | `calldata`; a CHECK keeps the two exclusive. | Different native call encodings. |
| 8 | `function` value | Event `Symbol`, snake_case. | Solidity name (camelCase) via the target's ABI; unknown gives `0x<selector>` with `args_json = NULL`. | ABI calldata is not self-describing. |
| 9 | `args_json` types | XDR types. | ABI types: up to 32-bit ints as numbers, wider as strings, EIP-55, tuples as objects. | Different type systems. |
| 10 | Loan id width | First arg must be `ScVal::U32`. | First arg is `uint256`; above `u32::MAX` gives no reference. | Solidity ids are `uint256`. |
| 11 | Nonce | Resets to 1 after the temporary entry lapses; the key and the "newest before" rule handle it. | Never resets; the same key and rule apply. | Persistent `_schedules[id].nonce`. |
| 12 | Formats | Strkeys, tx hash 64 hex, `schedule_ledger` = ledger. | EIP-55, tx hash `0x…`, `schedule_ledger` = block number. | Per-chain `contract_logs` conventions. |
| 13 | Allow-listed events | 8 snake_case topics. | 9 OpenZeppelin topic0 values. | Different event sets. |
| 14 | Config validation | `StellarIndexerSettings::from_chain_env` distinct-role loop. | Parse in `IndexerJobSettings::from_chain_env`; clash check in `run_indexer_job`. | The EVM indexer checks optional-key clashes there. |
| 15 | Retention and re-projection | RPC retention of about 7 days (TD-187). | None; the rewind must be done when the key is first enabled (the projection runs in `contract_logs.id` order). | `eth_getLogs` keeps full history. |
| 16 | API args filter | `args_xdr IS NOT NULL` (absent means out of retention) | `(args_xdr IS NOT NULL OR calldata IS NOT NULL)` (absent means the operation id did not verify); `args_json IS NOT NULL` on both. | Different native encodings. |
| 17 | API Minter target key | `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` (also enables the cash book) | `CHAIN_<id>_EVM_API_MINTER_ADDRESS` in the same map; every Stellar-shaped Minter reader reads the map through `routes::common::stellar_minter`, which returns nothing for an EVM chain, so it scopes `pending_operations` only. | EVM has no cash book. |
| 18 | Expired, then canceled | The schedule lapses about a day after expiry and can no longer be canceled. | `cancel` works on an expired schedule at any time; the row closes and leaves the API. | OpenZeppelin `cancel` checks only that the schedule exists. |
