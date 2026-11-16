# Issue #1921: Stellar AccessManager indexer: scheduled / canceled / executed operations with args from the transaction

Source: https://github.com/eq-lab/pipeline/issues/1921

Parent epic: #1920, merge-order step 1. #1922 (API) reads the table this issue creates. The human decision of
2026-11-16 (epic #1920) reverses the 2026-11-03 "never index the AccessManager" decision for the three
scheduled-operation events. Role events stay out of scope. Contracts are frozen.

## Scope

### Source of truth (checked by the planner on 2026-11-16)

- **Contract:** `pipeline-stellar-contracts@e9881ac`, `contracts/access-manager/src/{lib.rs,event.rs,storage.rs}`.
  - `schedule(target, function, args: Vec<Val>, when, caller) -> (BytesN<32>, u32)`; `when = 0` means
    `now + delay`. The event carries the resolved `when`.
  - `execute(target, function, args, caller) -> Val`; consumes the schedule only for a delayed caller.
  - `cancel(target, function, args, caller, canceller) -> u32`.
  - `hash_operation` (`storage.rs:289`) = `sha256(XDR(Operation { caller, target, function, args }))`.
    `Operation` is a `#[contracttype]` struct, so the preimage is an `ScVal::Map` with `Symbol` keys in sorted
    order: `args` (`ScVal::Vec`), `caller` (`Address`), `function` (`Symbol`), `target` (`Address`).
  - `EXPIRATION = 604 800` s (`storage.rs:9`). Re-schedule after expiry, cancel or execute reuses the id with
    `nonce + 1`; a still-pending duplicate is rejected on-chain.
  - Event topic symbols (default `#[contractevent]` snake_case): `operation_scheduled`, `operation_canceled`,
    `operation_executed`, plus 8 role/target topics: `role_granted`, `role_revoked`, `role_admin_changed`,
    `role_guardian_changed`, `role_grant_delay_changed`, `target_function_role_updated`, `target_closed`,
    `target_admin_delay_updated`.
- **Testnet AccessManager** `CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW` (`addresses.json`
  `access_manager`; same value as `CHAIN_99000001_RELAYER_STELLAR_ACCESS_MANAGER_ID`).
- **Verified against live testnet data (planner, 2026-11-16, ledgers 5 637 300 to 5 758 140):**
  - 31 AM events: 27 `operation_executed`, 3 `operation_scheduled`, 1 `role_granted`.
  - `operation_scheduled` topics are `[Symbol, Bytes(32), Address]`; `value` is an `ScMap`
    `{function: Symbol, nonce: U32, target: Address, when: U64}` (map format, not a vec).
  - The three schedules (all from Risk Council wallet `GAZFDDYK…ZH6G`) are top-level `InvokeHostFunction`
    calls of `AM.schedule`; each envelope also carries one auth entry whose root invocation repeats the same call.
  - Recomputing `sha256(XDR(ScMap{args, caller, function, target}))` from the envelope args **matches** the
    event `operation_id` for all three (fixtures in the Appendix).
  - `operation_executed` is frequent and mostly immediate: the relayer and Trustee (`draw_loan`, `disburse`,
    `update_mutable`, `register_deal`) and contract callers (the Minter calls `AM.execute` for PLUSD `mint` as a
    sub-invocation, sometimes twice in one tx). The same wallet `GAZFDDYK…` is both an immediate caller
    (Trustee functions) and a delayed caller (Risk Council functions).
  - `getHealth`: `ledgerRetentionWindow = 120 960` (about 7 days at 5 s); `getTransaction` returns
    `envelopeXdr`, `ledger`, `createdAt`, `oldestLedger`, `latestLedger`.

### In scope

1. Optional env key `CHAIN_<id>_STELLAR_INDEXER_ACCESS_MANAGER_ADDRESS` (Strkey `C…`, joins the
   distinct-role check as `ACCESS_MANAGER_ADDRESS`). Unset ships dark: AM not polled, no sync task, worker boots
   as before.
2. **Indexing (`index_once`)**: poll the AM id with the other Stellar contracts, decode the three operation
   events from the event XDR alone and store them as raw `contract_logs` rows. No RPC beyond `getEvents`, no
   projection write. The chain cursor never waits on AM processing.
3. **Projection (`access-manager-sync` task)**: a separate supervised loop reads new AM raw rows past its own
   watermark, in `contract_logs.id` order, fetches transactions (`getTransaction`), recovers and verifies `args`,
   and inserts or updates `access_manager_operations`.
4. `loan_id` extraction for the known Risk Council functions (by configured target), including
   `record_id → loan_id` through the SecurityRegistry data from #1779.
5. `getTransaction` response extended with `envelopeXdr`, `ledger` and `oldestLedger`.
6. Docs: new reference `docs/references/access-manager-events.md`, `backend.md`, `security-registry-events.md`,
   `.env.example`, `ARCHITECTURE.md`, TD-177 plus one new TD, user stories for #1921.

### Out of scope

- Role / target events (`role_granted`, `target_function_role_updated`, …): allow-listed and dropped silently.
- Any EVM AccessManager indexing.
- API fields (#1922) and Trustee UI (#1923, #1924).
- Any contract or deployment change.
- Reconciling a pending row against on-chain `get_schedule` (see "Retention edge").
- A sync-interval env key: the interval is a constant, like the SecurityRegistry sync loop's 30 s.

## Decisions (human, 2026-11-16)

1. **Transaction fetch runs in a separate sync loop**, not inside `poll`. `index_once` stores only the raw AM
   rows in `contract_logs` and advances the cursor without any `getTransaction` call. An `access-manager-sync`
   task, modelled on #1779's SecurityRegistry sync loop, reads new AM rows past its own watermark, fetches the
   transactions and writes `access_manager_operations`. AM or RPC failures never stall the chain cursor.
2. **Unique key** `(chain_id, contract_address, operation_id, nonce)`, as planned.
3. **`args_xdr`** is the base64 XDR of `ScVal::Vec(args)`, the third argument of `schedule` exactly as invoked,
   as planned.
4. **No expedited stage rollout** for the 2026-11-13 operations. If the indexer is not live in time, the Risk
   Council schedules them again manually (see [Rollout and retention](#rollout-and-retention)).

## Assumptions and Risks

- **Indexing is RPC-free for the AM.** `poll` decodes the event XDR only (`dispatch_access_manager`) and pushes
  a plain `StellarLogMapper`. A decode failure logs `warn` and drops the event (same as
  `dispatch_security_registry`); it never fails `poll`.
- **Ordering.** The sync loop processes AM rows strictly in `contract_logs.id` order and never skips a row:
  - Within one `index_once` batch, mappers are inserted in event order inside one DB transaction, so ids follow
    event order (ledger, tx index, op index, event index), and the batch becomes visible atomically at commit.
  - AM rows of one chain are written only by that chain's `index_once`, which runs batches sequentially (the
    next batch starts after the previous commit). So for `(chain_id, contract_address = AM)` a higher id is never
    committed before a lower one, and an id watermark cannot skip an uncommitted row. (The shared BIGSERIAL
    sequence interleaves with other chains, which the filter excludes.)
  - Consequence: a schedule is always projected before a cancel or execute of the same id, including when both
    are in the same batch or the same transaction, because the later event has the higher id and the loop
    stops at the first row it cannot finish.
  - Cursor rewinds: rows for events not stored before get new, higher ids and are processed after the
    watermark; already-stored events are deduplicated by `contract_logs` and never reprocessed. A rewind can
    therefore append an older schedule after newer rows. That is safe because an execute or cancel that was
    already processed without a matching row was a no-op, and the schedule then lands as `pending`. This can
    only happen if the key was set after the AM already had history and the cursor was not rewound first; the
    rollout steps below rewind before the first run.
- **Per-row atomicity and restart.** Each row is applied in its own DB transaction that writes the projection
  change **and** advances `access_manager_sync_state.last_log_id` to that row's id. A crash between rows
  repeats nothing; a crash inside a row rolls back both. Writes are idempotent anyway (`INSERT … ON CONFLICT DO
  NOTHING`; updates guarded by `status = 'pending'`). On start the loop reads the watermark (missing row = 0).
- **Retries.** RPC transport errors, timeouts (20 s per `getTransaction`) and `NOT_FOUND` within retention
  (RPC node not caught up) are retryable: the cycle stops at that row without advancing the watermark, and a
  `KeyedBackoff` keyed by the row id (from `supervise.rs`, 1 min doubling to 1 h) delays the retry. First failure
  per row per process is `warn`, later ones `debug`. Head-of-line blocking is intended (it preserves ordering) and
  only delays the AM projection, never indexing. It is bounded: once the tx leaves retention the row resolves via
  the retention edge.
- **Retention edge.** `NOT_FOUND` with `row.block_number < oldestLedger` (or `oldestLedger` absent) means the tx
  left retention before the loop reached it (worker down for days, or a row stuck in retries). Schedule → insert
  the row with `args_xdr = NULL`, `args_json = NULL`, `loan_id = NULL` (`record_id = NULL`) and `warn`. Execute →
  no status change, `warn`; the row stays `pending` and reads as expired after `expires_at`. Both advance the
  watermark. New tech-debt item. A cancel never needs the tx.
- **Never guess.** Args are stored only when a candidate invocation's recomputed hash equals the row's
  `operation_id`. No candidate, a parse failure or a mismatch → `args = NULL` + `warn`, row still stored,
  watermark advances. Parse failures are never retried.
- **Where args come from.** Candidates are every `InvokeContractArgs` whose contract is the AM and whose function
  is `schedule` (or `execute`), collected from (a) top-level `InvokeHostFunction` ops and (b) every
  `SorobanAuthorizedInvocation` tree in those ops' `auth` (root and sub-invocations, recursive). Envelope kinds:
  `Tx`, `TxV0` (no Soroban ops, yields nothing) and `TxFeeBump` (inner tx). Duplicates (the op and its own auth
  root) are harmless: candidates are matched by hash. A contract wallet that calls `AM.schedule` as a plain
  sub-call without an auth entry is not recoverable (`args = NULL`); none exists today.
- **Execute matching.** The loop fetches the tx for an executed row only when `has_pending_call(target,
  function, caller)` is true. Because earlier rows are already projected, a schedule from the same batch is
  already in the table, so no in-memory batch set is needed. Immediate executes (the large majority) never fetch.
  Candidates are `AM.execute` invocations whose `target`, `function`, `caller` equal the row's; their recomputed
  ids mark the `status = 'pending'` row with the highest `nonce` as `executed`. No match → immediate call, or the
  schedule predates indexing: no change (`debug`). Two executes of the same triple in one tx: the first row marks
  every matching id, the second finds nothing; the end state is correct.
- **Projection lag.** Up to one sync interval (15 s) plus processing after the cursor passes the ledger. The
  frontend keeps its in-session state until #1923/#1924 read the API, so a short lag is invisible.
- **Backfill limit.** A Risk Council op lives `delay (24 h) + 7 d` = up to 8 days; RPC retention is about 7 days.
  An op scheduled more than the retention window ago cannot be backfilled by `getEvents` at all.
- **`loan_id` needs configured targets.** Classification compares the op's `target` with the indexer's own
  `LOAN_REGISTRY_ADDRESS`, `MINTER_ADDRESS` and `SECURITY_REGISTRY_ADDRESS`. If a key is unset, ops on that
  contract get `loan_id = NULL` (row still stored). Loan id 0 exists on testnet; `0` is a valid id.
- **`record_id → loan_id`.** Resolved when the schedule row is projected, for `contract_address = target`:
  `security_records`, then `contract_logs` `SecurityRecordRegistered`, then `security_view_snapshots`
  (`kind = 'record'`), a single-record variant of `LIST_RECORD_LOANS_SQL`. The registration happened at an earlier
  ledger, so its `contract_logs` row is committed before the AM row the loop reads. Unresolved → `loan_id = NULL`,
  `record_id` kept so #1922 can resolve it at read time.
- **Re-projection.** Resetting the watermark to 0 replays every AM row, but schedules older than retention come
  back with `args = NULL` (`ON CONFLICT DO NOTHING` keeps rows that already exist). Document: never truncate the
  table to rebuild it.
- **Supervision.** The loop is spawned with `spawn_supervised("access-manager-sync", chain_id, …)` in
  `run_stellar_indexer_job`, its `AbortOnDrop` guard held next to `_security_guard`, so it dies with the indexer
  and restarts with `restart_delay` (30 s doubling to 10 min) after an error or panic. Each cycle runs under a
  60 s budget with `catch_unwind`, like `security_registry_sync::run_step`.
- **No dependency** on unmerged work. Base `origin/main` at `1f34c2c2`. The unrelated uncommitted #1786 work in
  the main checkout does not touch these files.
- The user's auto-memory still records the 2026-11-03 "no AccessManager indexing" decision; the manager should
  mark it superseded by epic #1920 (not a repo change).

## Open Questions

_None_

## Implementation Steps

### 1. Migration

`packages/shared/migrations/20261116000001_access_manager_operations.sql` (additive). Columns (the notes after
`--` are for this plan only; the file follows the existing migrations' style):

```sql
CREATE TABLE IF NOT EXISTS access_manager_operations (
    id                BIGSERIAL   PRIMARY KEY,
    chain_id          BIGINT      NOT NULL,
    contract_address  TEXT        NOT NULL,          -- AM Strkey
    operation_id      TEXT        NOT NULL,          -- 64 lowercase hex, no 0x
    nonce             BIGINT      NOT NULL,
    caller            TEXT        NOT NULL,
    target            TEXT        NOT NULL,
    function          TEXT        NOT NULL,
    args_xdr          TEXT        NULL,              -- base64 XDR of ScVal::Vec(args), as invoked
    args_json         JSONB       NULL,
    ready_at          BIGINT      NOT NULL,          -- event `when`, unix s
    expires_at        BIGINT      NOT NULL,          -- when + 604800
    status            TEXT        NOT NULL CHECK (status IN ('pending','executed','canceled')),
    loan_id           BIGINT      NULL,
    record_id         BIGINT      NULL,
    schedule_tx_hash  TEXT        NOT NULL,
    schedule_ledger   BIGINT      NOT NULL,
    scheduled_at      BIGINT      NOT NULL,          -- ledger close, unix s
    source_log_id     BIGINT      NOT NULL,          -- contract_logs.id of the schedule row
    closed_tx_hash    TEXT        NULL,
    closed_ledger     BIGINT      NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chain_id, contract_address, operation_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_am_ops_pending_loan
    ON access_manager_operations (chain_id, loan_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_am_ops_pending_call
    ON access_manager_operations (chain_id, contract_address, target, function, caller) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS access_manager_sync_state (
    chain_id          BIGINT      NOT NULL,
    contract_address  TEXT        NOT NULL,
    last_log_id       BIGINT      NOT NULL DEFAULT 0, -- highest contract_logs.id fully applied
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address)
);
```

`expired` is never stored: #1922 derives it as `status = 'pending' AND now >= expires_at`. The partial index
`contract_logs (chain_id, contract_address, id)` is not needed: the existing unique index leads with
`(chain_id, contract_address)`; the coder confirms with `EXPLAIN` that the loop's read stays an index scan, and
adds `CREATE INDEX … ON contract_logs (chain_id, contract_address, id)` in the same migration only if it does not.

### 2. Shared repo — `packages/shared/src/access_manager_repo.rs` (new; `pub mod` in `shared/src/lib.rs`)

- `pub const EXPIRATION_SECS: i64 = 604_800;`, `pub enum OpStatus { Pending, Executed, Canceled }`.
- `pub struct AmLogRow { id, event_name, block_number, tx_hash, log_index, block_timestamp, params: Value }`.
- `pub struct NewScheduledOp { … all insert columns …; nonce: u32, ready_at: u64, … }` (`expires_at` derived).
- `AccessManagerRepo::new(pool)`:
  - `get_watermark(chain_id, contract) -> Result<i64>` (0 when no row);
  - `list_rows_after(chain_id, contract, after_id, limit) -> Result<Vec<AmLogRow>>`
    (`ORDER BY id`, event names `AccessManagerOperation*`);
  - `has_pending_call(chain_id, contract, target, function, caller) -> Result<bool>`;
  - `record_loan(chain_id, security_contract, record_id) -> Result<Option<i64>>`;
  - `apply(chain_id, contract, log_id, write: &OpWrite) -> Result<u64>`: one transaction that runs the write
    (`insert_scheduled` with `ON CONFLICT DO NOTHING`; `mark_canceled` for `(operation_id, nonce)` and
    `status='pending'`; `mark_executed` for each id on the highest-nonce pending row; or `Skip`) and upserts
    `access_manager_sync_state.last_log_id = GREATEST(last_log_id, log_id)`. Returns rows affected.
- `pub enum OpWrite { Schedule(NewScheduledOp), Cancel { operation_id, nonce, tx_hash, ledger },
  Execute { ids: Vec<String>, tx_hash, ledger }, Skip }`.
- SQL as `pub const …_SQL` strings (like `LIST_RECORD_LOANS_SQL`). Runtime `sqlx::query`, no macros.

### 3. RPC — `packages/worker/src/indexer/stellar/rpc.rs`

- Add `envelope_xdr_base64: Option<String>`, `ledger: Option<u64>`, `oldest_ledger: Option<u64>` to
  `GetTransactionResponse`.
- Move the JSON-to-struct mapping into `pub fn parse_get_transaction(result: &Value) -> GetTransactionResponse`
  so it can be unit-tested; `get_transaction` calls it. Existing callers (relayer) are unaffected.

### 4. Pure decoding — `packages/worker/src/indexer/stellar/access_manager_parsers.rs` (new)

Header: `// spec: docs/references/access-manager-events.md`.

- `ACCESS_MANAGER_ALLOW_LISTED_TOPICS: [&str; 8]` and
  `classify_access_manager_topic(&str) -> AmTopic { Scheduled, Canceled, Executed, AllowListed, Unknown }`.
- `dispatch_access_manager(raw: &RawEvent) -> Option<StellarLog>` (used by `poll`): allow-listed → `None`
  silently; unknown or undecodable → `warn`, `None`; otherwise a `StellarLog` named
  `AccessManagerOperationScheduled` / `…Canceled` / `…Executed` with params:
  - scheduled: `operation_id` (hex), `caller`, `nonce` (string), `when` (string), `target`, `function`
    (topics `[sym, Bytes(32), Address]`, value `ScMap` keys `nonce`, `when`, `target`, `function`);
  - canceled: `operation_id`, `nonce` (topics `[sym, Bytes(32)]`, value `ScMap {nonce}`);
  - executed: `target`, `function`, `caller` (topics `[sym, Address, Symbol, Address]`).
  - Reuse `sc_address_to_strkey`, `map_entry`, `synthesise_log_index`.
- Typed readers of those params for the loop: `ScheduledRow`, `CanceledRow`, `ExecutedRow`
  `::from_params(&Value) -> Option<…>`.
- `contract_invocations(envelope_b64: &str, contract: &str, function: &str) -> Vec<Vec<ScVal>>`.
- `hash_operation(caller: &ScVal, target: &ScVal, function: &ScVal, args: &ScVal) -> [u8; 32]`: sorted `ScMap`
  preimage, `sha2::Sha256` (already a worker dependency). Strkeys are converted back to `ScVal::Address`.
- `recover_schedule_args(row: &ScheduledRow, candidates: &[Vec<ScVal>]) -> Option<ScVal>`: candidates are
  `[target, function, args, when, caller]`; returns `args` of the first candidate whose hash equals the row's id.
- `execute_candidate_ids(row: &ExecutedRow, candidates: &[Vec<ScVal>]) -> Vec<[u8; 32]>`: `[target, function,
  args, caller]` filtered on the triple, hashed, deduplicated.
- `args_display_json(args: &ScVal) -> Value` (recursive, deterministic): `U32`/`I32` → number; `U64`/`I64`/
  `Timepoint`/`Duration`/`U128`/`I128`/`U256`/`I256` → decimal string; `Bool`; `Void` → `null`; `Symbol`/
  `String` → string; `Bytes` → lowercase hex; `Address` → Strkey; `Vec` → array; `Map` with all-`Symbol` keys →
  object, other maps → array of `{ "key", "value" }`; anything else → `{ "xdr": <base64> }`.
- `TargetIds { loan_registry, minter, security_registry: Option<String> }` and
  `loan_ref(target, function, args: &ScVal, ids: &TargetIds) -> LoanRef { Loan(u32), Record(u32), None }`:
  - LoanRegistry: `set_default`, `cure`, `amend_economics`, `adjust_interest`, `write_down`,
    `close_defaulted` → first arg `U32` = loan id.
  - Minter: `reverse_repay` → first arg `U32` = loan id.
  - SecurityRegistry: `set_terms` → loan id; `resolve_flag`, `release_with_consent` → record id (`Record`).
  - Anything else (`set_inspectors`, unknown function or target, non-`U32` first arg) → `None`.

### 5. Sync loop — `packages/worker/src/indexer/stellar/access_manager_sync.rs` (new)

Header: `// spec: docs/references/access-manager-events.md#sync-loop`.

- Constants: `ACCESS_MANAGER_SYNC_INTERVAL = 15 s`, `ROWS_PER_CYCLE = 200`, `TX_FETCH_TIMEOUT = 20 s`,
  `CYCLE_BUDGET = 60 s`.
- Traits (fakes in tests):
  - `TxEnvelopeSource`: `async fn fetch(&self, tx_hash, row_ledger) -> Result<TxFetch>`,
    `TxFetch { Found(envelope_b64), BeyondRetention, NotYet }`. The `StellarRpc` impl applies the timeout and maps
    `NOT_FOUND` with `row_ledger < oldest_ledger` (or no `oldest_ledger`) to `BeyondRetention`, other `NOT_FOUND`
    to `NotYet`.
  - `AmSyncStore`: `watermark`, `rows_after`, `has_pending_call`, `record_loan`, `apply(log_id, &OpWrite)`;
    `impl` over `AccessManagerRepo` with chain and AM id bound.
- `async fn resolve_row(row: &AmLogRow, ids: &TargetIds, store, tx, cache: &mut HashMap<String, TxFetch>)
  -> Result<OpWrite, Retry>`:
  - scheduled → fetch (cached per tx hash within a cycle); `Found` → `recover_schedule_args`, `args_json`,
    `loan_ref` (`Record` resolved with `record_loan`); mismatch or no candidate → `args = NULL` + `warn`;
    `BeyondRetention` → `args = NULL` + `warn`; `NotYet` or error → `Retry`;
  - canceled → `OpWrite::Cancel` (no RPC);
  - executed → `has_pending_call` false → `OpWrite::Skip` (no RPC); true → fetch; `Found` → `Execute { ids }`
    (empty ids → `Skip`); `BeyondRetention` → `Skip` + `warn`; `NotYet` or error → `Retry`;
  - params that do not parse → `Skip` + `warn` (never retried).
- `async fn sync_once(store, tx, ids, backoff: &mut KeyedBackoff<i64>, now) -> Result<usize>`: read the
  watermark, list up to `ROWS_PER_CYCLE` rows after it, and for each row in order: if its backoff is not due,
  stop; `resolve_row`; on `Ok(write)` call `store.apply(row.id, &write)` and `backoff.clear(row.id)`; on `Retry`
  record the failure (first `warn`, then `debug`) and stop the cycle. Returns rows applied. A failing
  `store.apply` also stops the cycle (DB error, retried next cycle).
- `pub async fn run_access_manager_sync_loop(rpc, repo, chain_id, contract_id, ids) -> Result<()>`: loop
  `{ step under CYCLE_BUDGET with catch_unwind (local wrapper, same pattern as security_registry_sync::run_step);
  sleep(ACCESS_MANAGER_SYNC_INTERVAL) }`. If a cycle applied `ROWS_PER_CYCLE` rows, run the next cycle without
  sleeping (catch-up after a rewind).

### 6. Config — `packages/worker/src/indexer/config.rs`

- `pub access_manager_id: Option<String>` on `StellarIndexerSettings`, read from `{ip}ACCESS_MANAGER_ADDRESS`
  with the same `validate_contract_id` + Strkey check as `SECURITY_REGISTRY_ADDRESS`.
- Push `("ACCESS_MANAGER_ADDRESS", id)` into the distinct-role list. No other new key.

### 7. Poller and supervision — `packages/worker/src/indexer/stellar/poller.rs`, `stellar/mod.rs`

- `pub mod access_manager_parsers; pub mod access_manager_sync;` in `stellar/mod.rs`.
- `StellarEventPoller` gets `access_manager_id: Option<String>`; `poll` pushes it into `contract_ids` and adds a
  branch `else if self.access_manager_id.as_deref() == Some(raw.contract_id.as_str()) {
  dispatch_access_manager(&raw) }`; the resulting log goes down the default `StellarLogMapper` path.
- `run_stellar_indexer_job`: when the key is set, log "Stellar AccessManager indexer enabled" and spawn
  `spawn_supervised("access-manager-sync", chain_id, …run_access_manager_sync_loop(…))`, holding the guard as
  `_access_manager_guard`. `TargetIds` come from `settings.loan_registry_id`, `minter_id`,
  `security_registry_id`.

### 8. Env

- `.env.example`: replace line 165 (`CHAIN_99000001_STELLAR_ACCESS_MANAGER_ID … documentation only`) with
  `# CHAIN_99000001_STELLAR_INDEXER_ACCESS_MANAGER_ADDRESS=CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW   # optional — OperationScheduled/Canceled/Executed into contract_logs + access_manager_operations via the access-manager-sync task (#1921); equals RELAYER_STELLAR_ACCESS_MANAGER_ID; cursor at/before the earliest pending schedule`,
  and add the commented chain 99000002 line with `CC7JL562I6636IBN4YLX5FYQSIFGJGYX5BXDUYPPCEN5HOC64LZDLKPR`.

### 9. Docs

Per "Docs to Update" below.

### 10. Verify

- `cargo clippy --all -- -D warnings`, `cargo test -p pipeline-worker`, `cargo test -p shared`.
- `npx tsx scripts/lint-docs.ts`.
- Comment rule: one spec-pointer header per new file, nothing else (the SQL notes in step 1 are not copied).

## Test Strategy

Pure unit tests in `packages/worker/tests/` (no DB, no `DATABASE_URL` / `POSTGRES_URL`, no network). Fixtures are
real testnet data (Appendix) plus synthetic `ScVal`s built with `stellar_xdr` and the
`pipeline_worker::stellar::tx` helpers. The loop is tested through `sync_once` with a fake `TxEnvelopeSource`
(counts calls, scripted results per hash) and an in-memory `AmSyncStore` (rows, watermark, operations table).

- `stellar_access_manager_parsers.rs`
  - `dispatch_access_manager` on the Appendix event → `AccessManagerOperationScheduled` with
    `operation_id a36a52bd…`, `nonce "1"`, `when "1794664989"`, target LoanRegistry, `amend_economics`; wrong topic
    count or non-map value → `None`;
  - canceled and executed (synthetic); allow-listed topics → `None`; unknown topic → `None`;
  - params round-trip through `ScheduledRow` / `CanceledRow` / `ExecutedRow::from_params`.
- `stellar_access_manager_hash.rs`
  - golden vector: Appendix envelope → `contract_invocations` returns the schedule args (twice: op and auth root)
    → `hash_operation` = `a36a52bd16172a03793c93aa836b7a971e2849ab7411b01319f5eee0c8e9ef3e`;
  - `recover_schedule_args`: verified (returns the `ScVal::Vec`, re-encodes to the same base64); tampered candidate
    → `None`; no candidates → `None`; other contract or function ignored;
  - fee-bump wrapping still yields the candidate; an auth-tree-only sub-invocation is found;
  - `execute_candidate_ids` filters on the triple and deduplicates.
- `stellar_access_manager_sync.rs`
  - schedule with args recovered and id verified → pending row with `args_xdr`, `args_json`, `ready_at`,
    `expires_at = ready_at + 604800`, `loan_id`, `source_log_id`; watermark = row id;
  - id mismatch → row with `args = NULL`, `loan_id = NULL`; watermark advances;
  - schedule then execute of the same id **in one batch** → `executed` with the execute `tx_hash`;
  - schedule then cancel in one batch → `canceled` with `closed_tx_hash`; cancel of an unknown op → no-op, watermark
    advances;
  - execute updates only the highest-nonce pending row; re-schedule after expiry with `nonce + 1` → second row,
    old row untouched;
  - immediate execute (no pending triple) → **zero** fetches, `Skip`, watermark advances;
  - retryable failure (`NotYet`, transport error, timeout) on row N → rows before N applied, row N and later not
    applied, watermark = N − 1; the next call before the backoff is due applies nothing; after the backoff and a
    `Found` result row N and later are applied in order;
  - retention edge: `BeyondRetention` on a schedule → row with `args = NULL`, watermark advances; on an execute →
    pending row unchanged, watermark advances;
  - restart / idempotency: running `sync_once` again from a reset watermark over the same rows leaves the table
    unchanged (no duplicate, no status regression);
  - two rows from one tx → one fetch (per-cycle cache);
  - `ROWS_PER_CYCLE` caps one call.
- `stellar_access_manager_loan_ref.rs` (table-driven)
  - each LoanRegistry function, `reverse_repay` on the Minter, `set_terms` on the SecurityRegistry → `Loan(n)`,
    including `n = 0`;
  - `resolve_flag`, `release_with_consent` → `Record(r)`, resolved through the fake store (found → loan id; not
    found → `NULL`, `record_id` kept);
  - `set_inspectors`, unknown function, unconfigured target, non-`U32` first arg → `None`;
  - `args_display_json` on the Appendix args (`[0, 145000, "1816128000"]`) and on a `set_terms` terms map (object
    with symbol keys, enum `["Lc"]`).
- `stellar_access_manager_config.rs` (env pattern of `stellar_security_registry_config.rs`): unset or blank →
  `None`; valid → `Some`; bad Strkey → error naming the key; same id as `SECURITY_REGISTRY_ADDRESS` or
  `LOAN_REGISTRY_ADDRESS` → error naming `ACCESS_MANAGER_ADDRESS`.
- `stellar_rpc.rs` (extend): `parse_get_transaction` reads `envelopeXdr`, `ledger`, `oldestLedger`, and tolerates
  their absence on `NOT_FOUND`.

Manual (user stories, run in QA #1925 or on stage): key set → "enabled" log and the `access-manager-sync` task
running; AM rows appear in `contract_logs` and then in `access_manager_operations` within about 15 s; executing a
scheduled op from the Trustee flips it to `executed`; immediate executes do not call `getTransaction`; with the RPC
URL of the sync blocked (or RPC down) the chain cursor still advances.

## Docs to Update

- **New** `docs/references/access-manager-events.md`: configuration; encoding (topics, map value); stored
  `contract_logs` names and params; allow-listed topics; **Sync loop** (watermark, ordering argument, per-row
  transaction, retries and backoff, retention edge, supervision, interval constant); args recovery and id
  verification; execute matching; the table and its status rules (expired derived); `loan_id` rules; cursor and
  retention (`getHealth` `ledgerRetentionWindow` = 120 960 on 2026-11-16; ops live up to `delay + 7 d`); known
  limitations (retention edge, re-projection loses args beyond retention). Link it from
  `docs/references/index.md`.
- `docs/references/backend.md`:
  - new "#### Stellar AccessManager indexing" under Event Indexer (key, dark default, "nothing runs inside
    `index_once` except the usual log write; the `access-manager-sync` task fetches transactions and cannot stall
    indexing", link to the reference);
  - contract-ids table: the `access_manager` row gets the worker key;
  - the "documentation only" sentence becomes `CHAIN_<id>_STELLAR_{USDC_ASSET,PLUSD_ASSET}_ID`;
  - Pocket paragraph: drop the AccessManager part of "no AccessManager or SecurityRegistry events (not indexed,
    by decision)";
  - cursor rule: `getEvents` and `getTransaction` share the RPC retention window; add the AM rollout steps.
- `docs/references/security-registry-events.md` line 55: replace "The AccessManager is not indexed." with a link to
  the new reference.
- `ARCHITECTURE.md` line 64: add "AccessManager scheduled-operation events (Stellar)".
- `docs/exec-plans/tech-debt-tracker.md`: TD-177 — indexer part done (#1921); API and UI remain (#1922–#1924).
  New TD (next free number): a raw AM row whose tx left RPC retention before the sync loop reached it yields a
  schedule with `args = NULL` (cannot be executed from the console) or an execute that leaves its row `pending`
  until it reads as expired; fix would be a `get_schedule` / `get_nonce` reconciliation.
- `.env.example` (step 8).
- **New** `docs/user-stories/epic-1920/1921-access-manager-indexer.md` (operator persona, like
  `epic-1775/1779-stellar-security-registry-indexer.md`) and an "Epic #1920" table in `docs/user-stories/index.md`.
- No product-spec change: no user-facing behaviour until #1922.

## Rollout and retention

1. Merge; wait for the worker image on pipeline-test (chain 99000001).
2. Stop the worker, set `CHAIN_99000001_STELLAR_INDEXER_ACCESS_MANAGER_ADDRESS=CDP7TUNB…WHTW`, rewind
   `log_collector_state.last_indexed_block` to at or before the earliest still-pending schedule that is within RPC
   retention (it must stay above `oldestLedger`), start. Replays of other contracts dedupe on the `contract_logs`
   unique key. The sync loop starts from watermark 0 and catches up without sleeping between full batches.
3. **Stage ops of 2026-11-13 (decision 4): no expedited rollout.** The `set_terms` (ledger 5 710 517) and
   `amend_economics` (ledger 5 710 989) schedules on loan 0 leave retention around 2026-11-20 and expire on-chain on
   2026-11-21. If the indexer is not live with the cursor rewound before they leave retention, they are not indexed
   and the Risk Council schedules them again manually. The 2026-11-16 `set_terms` (ledger 5 757 892) stays in
   retention until about 2026-11-23.
4. Check: `contract_logs` has the AM rows, `access_manager_sync_state.last_log_id` equals the highest AM row id,
   and each indexed schedule has a row with `args_xdr` set.

## Appendix: real fixtures (testnet, AM `CDP7TUNB…WHTW`)

| ledger | tx | function | target | operation_id |
|---|---|---|---|---|
| 5 710 517 | `d19f43d11d085db0e8c0c59f3276d30d02e557d54a17960a8e1cc0b68eb584c6` | `set_terms` (loan 0) | SecurityRegistry `CDTUMAT6…ZLUX` | `b59b55566161881b38f9f512b861fd70c4eb7e1b1162d6e19c75e41cdc6aadd1` |
| 5 710 989 | `b535457d20359855d6bd3ed298d46bb5ed6b68fba7dfedaff585f4cfa92b7806` | `amend_economics` `[0, 145000, 1816128000]` | LoanRegistry `CDWN5B3F…VXZQ` | `a36a52bd16172a03793c93aa836b7a971e2849ab7411b01319f5eee0c8e9ef3e` |
| 5 757 892 | `5a32be11d4529440f0647c09580be2b268f3caf474b0de34a3b6af168e808d87` | `set_terms` (loan 0) | SecurityRegistry | `429b42b3f3da3e109cdb92405901b0179a7670bb47764fade805306842d4d169` |

Caller of all three: `GAZFDDYKOOHWNMBAQWDURXBV3WNFQIT4UR2NWV5SGTKA4CCV7LIEZH6G`. Capture a `set_terms` envelope
with `getTransaction` while it is in retention if a `set_terms` fixture is wanted; after that, ids can be
reproduced with `stellar contract invoke --id CDP7TUNB…WHTW --network testnet --send=no -- hash_operation …`.

`amend_economics` event (`b535457d…`, event id `0024528510982864896-0000000000`, closed `2026-11-13T14:03:09Z`):

```
topic[0] AAAADwAAABNvcGVyYXRpb25fc2NoZWR1bGVkAA==
topic[1] AAAADQAAACCjalK9FhcqA3k8k6qDa3qXHihJq3QRsBMZ9e7gyOnvPg==
topic[2] AAAAEgAAAAAAAAAAMlGPCnOPZrAghYdI3DXdmlgifKR021eyNNQOCFX60Ew=
value    AAAAEQAAAAEAAAAEAAAADwAAAAhmdW5jdGlvbgAAAA8AAAAPYW1lbmRfZWNvbm9taWNzAAAAAA8AAAAFbm9uY2UAAAAAAAADAAAAAQAAAA8AAAAGdGFyZ2V0AAAAAAASAAAAAezeh2Ut9dnJfp6aS3VvnblcFpcV3sagsQsThCyOAvs6AAAADwAAAAR3aGVuAAAABQAAAABq+God
```

`amend_economics` `envelopeXdr`:

```
AAAAAgAAAAAyUY8Kc49msCCFh0jcNd2aWCJ8pHTbV7I01A4IVfrQTAAAZ1cAPLaDAAAAOQAAAAEAAAAAAAAAAAAAAABq9xi3AAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB3/nRoTIUMJiUyIHrEHVPwzSW7UPgXx7EHX8gAl+rf9sAAAAIc2NoZWR1bGUAAAAFAAAAEgAAAAHs3odlLfXZyX6emkt1b525XBaXFd7GoLELE4QsjgL7OgAAAA8AAAAPYW1lbmRfZWNvbm9taWNzAAAAABAAAAABAAAAAwAAAAMAAAAAAAAAAwACNmgAAAAFAAAAAGw/6gAAAAAFAAAAAAAAAAAAAAASAAAAAAAAAAAyUY8Kc49msCCFh0jcNd2aWCJ8pHTbV7I01A4IVfrQTAAAAAEAAAAAAAAAAAAAAAHf+dGhMhQwmJTIgesQdU/DNJbtQ+BfHsQdfyACX6t/2wAAAAhzY2hlZHVsZQAAAAUAAAASAAAAAezeh2Ut9dnJfp6aS3VvnblcFpcV3sagsQsThCyOAvs6AAAADwAAAA9hbWVuZF9lY29ub21pY3MAAAAAEAAAAAEAAAADAAAAAwAAAAAAAAADAAI2aAAAAAUAAAAAbD/qAAAAAAUAAAAAAAAAAAAAABIAAAAAAAAAADJRjwpzj2awIIWHSNw13ZpYInykdNtXsjTUDghV+tBMAAAAAAAAAAEAAAAAAAAABQAAAAYAAAAB3/nRoTIUMJiUyIHrEHVPwzSW7UPgXx7EHX8gAl+rf9sAAAAQAAAAAQAAAAMAAAAPAAAAClJvbGVNZW1iZXIAAAAAABIAAAAAAAAAADJRjwpzj2awIIWHSNw13ZpYInykdNtXsjTUDghV+tBMAAAADwAAAAxSSVNLX0NPVU5DSUwAAAABAAAABgAAAAHf+dGhMhQwmJTIgesQdU/DNJbtQ+BfHsQdfyACX6t/2wAAABAAAAABAAAAAgAAAA8AAAAMVGFyZ2V0Q2xvc2VkAAAAEgAAAAHs3odlLfXZyX6emkt1b525XBaXFd7GoLELE4QsjgL7OgAAAAEAAAAGAAAAAd/50aEyFDCYlMiB6xB1T8M0lu1D4F8exB1/IAJfq3/bAAAAEAAAAAEAAAADAAAADwAAABJUYXJnZXRGdW5jdGlvblJvbGUAAAAAABIAAAAB7N6HZS312cl+nppLdW+duVwWlxXexqCxCxOELI4C+zoAAAAPAAAAD2FtZW5kX2Vjb25vbWljcwAAAAABAAAABgAAAAHf+dGhMhQwmJTIgesQdU/DNJbtQ+BfHsQdfyACX6t/2wAAABQAAAABAAAABxGL/FZond5FcoJckJckuW0cEVLP+sXs1HabyBX7fIUuAAAAAQAAAAYAAAAB3/nRoTIUMJiUyIHrEHVPwzSW7UPgXx7EHX8gAl+rf9sAAAAQAAAAAQAAAAIAAAAPAAAAC1NjaGVkdWxlZE9wAAAAAA0AAAAgo2pSvRYXKgN5PJOqg2t6lx4oSat0EbATGfXu4Mjp7z4AAAAAAA5orwAAAAAAAADEAAAAAAAAZvMAAAABVfrQTAAAAEA0tk62eTiIPjuAIOD/tKjE5kkuSj2qDtlYpYnXVwSmBW6d1tQ+NG0YW7uzpy1p+cNB31zdAYUommAtH5Vu108C
```
