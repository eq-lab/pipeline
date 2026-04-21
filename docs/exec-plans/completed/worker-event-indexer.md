# Worker: On-Chain Event Indexer — Exec Plan

**Issue:** eq-lab/pipeline#1
**Branch:** `feat/worker-event-indexer`
**Spec:** `docs/product-specs/bridge-service.md` § 1. On-Chain Event Listening

---

## Step Checklist

- [x] Step 1: `crates/shared` — typed event structs
- [x] Step 2: DB migrations — `token_transfers` table + `log_collector_state` cursor table
- [x] Step 3: `crates/shared` — `LogMapper` trait + `EventRepo` + `TokenTransferLogMapper`
- [x] Step 4: Worker wiring — job settings, job registry, per-job `tokio::spawn`
- [x] Step 5: `EvmEventPoller` + `EvmEventPollerBuilder` — `eth_getLogs` batching with pluggable handlers
- [x] Step 6: `TokenTransfer` event parser (alloy-sol-types)
- [x] Step 7: `TokenTransferLogMapper` — implements `LogMapper`
- [x] Step 8: Main indexer loop — per-iteration transaction: cursor → confirm delay → poll → persist → advance → commit
- [x] Step 9: Unit tests — parser, mapper zero-value skip, cursor arithmetic
- [x] Step 10: Integration test — full loop against PostgreSQL
- [x] Step 11: `/test-fast` passes, archive plan, commit

---

## Context

The bridge service must react to on-chain events (see spec §1). This first version indexes only **ERC-20 `Transfer` events**. The token is identified by `contract_address` in the config — no hardcoded token assumption.

Additional event types (`WithdrawalRequested`, `LoanMinted`, `RepaymentSettled`, `TreasuryYieldDistributed`) will be added in follow-up issues using the same patterns established here.

On restart, the bridge must rebuild in-memory state by replaying persisted events from the DB rather than re-scanning chain from genesis. The indexer is the component that keeps that DB current.

---

## Design Decisions

**Typed table per event type.** `Transfer` events go into `token_transfers`. Future event types get their own tables. This keeps queries typed and schema explicit.

**Cursor per chain.** A single `log_collector_state` row keyed by `chain_id` tracks `last_indexed_block`. All watched contracts share the same cursor — they are queried in a single `eth_getLogs` call per tick.

**`LogMapper` trait for extensibility.** Each event type implements `LogMapper`, which owns both the duplicate check and the insert. Adding a new event type means: define a struct, parse it in `parse_<event>`, implement `LogMapper` on it, and register it with `EvmEventPollerBuilder::add_event_handler`. The indexer loop is unchanged.

**`EvmEventPollerBuilder` pattern.** At startup, the caller registers one or more event handlers via `add_event_handler::<ERC20Transfer>(decode_fn, contract_addresses)`. Each handler receives a raw log, decodes it into a typed struct, and wraps it in a `Box<dyn LogMapper>`. The builder produces an `EvmEventPoller` that returns `Vec<Box<dyn LogMapper>>` per poll — one entry per matched log.

**Per-iteration transaction scope.** Each tick opens a new DB transaction. The cursor is read, events are written, and the cursor is advanced — all within the same transaction. If any step fails, the transaction is rolled back and the cursor stays at its previous position. The loop retries from the same block on the next tick.

**Confirmation delay.** If `latest_block < cursor + LOG_CONFIRMATIONS_DELAY`, the tick is skipped (not an error — just not enough new blocks yet). Default: 12 blocks.

**Inner batch chunking.** `EvmEventPoller` subdivides large ranges into sub-ranges of `POLLING_BLOCK_RANGE` blocks per RPC call (default: 1000), with a short sleep between calls to avoid RPC rate limits.

**Deduplication.** `token_transfers` has a `UNIQUE (chain_id, contract_address, block_number, log_index)` constraint. Before inserting, the mapper checks for an existing row. On retry after partial failure, duplicates are silently skipped.

**Multi-job system.** Multiple jobs can run in parallel, each with its own `JobSettings` (chain ID, RPC URL, contract addresses, polling params, `enabled` flag). Each enabled job is spawned as an independent `tokio::task` with its own `sqlx::PgPool` connection. Jobs are discovered from a `[[jobs]]` config section or per-job env vars (`JOB_<NAME>_*`).

**Error recovery.** The main loop is wrapped in `loop { match index_once(...) { Err(e) => { log; sleep 5s; continue } } }`. Any failure leaves the cursor untouched and the loop retries from the same position.

**PostgreSQL.** All persistence uses `sqlx` with the `postgres` feature.

**Ethereum client.** `alloy` crate (`alloy-provider` + `alloy-sol-types`).

---

## Step Details

### Step 1 — `crates/shared` crate

Add `crates/shared` to the Cargo workspace (`Cargo.toml` `members`).

Create `crates/shared/src/events.rs` with the typed `TokenTransfer` event struct:

```rust
use alloy::primitives::{Address, B256, U256};

pub struct TokenTransferEvent {
    pub contract_address: Address,
    pub from:             Address,
    pub to:               Address,
    pub value:            U256,
    pub block_number:     u64,
    pub tx_hash:          B256,
    pub log_index:        u64,
    pub block_timestamp:  u64,
}
```

No DB logic in this crate — plain data types only.

**Test criterion:** `cargo build -p shared` compiles.

---

### Step 2 — DB migrations

Place migrations in `crates/shared/migrations/`.

`<timestamp>_log_collector_state.sql`:
```sql
CREATE TABLE log_collector_state (
    chain_id           BIGINT PRIMARY KEY,
    last_indexed_block BIGINT NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`<timestamp>_token_transfers.sql`:
```sql
CREATE TABLE token_transfers (
    id               BIGSERIAL PRIMARY KEY,
    chain_id         BIGINT NOT NULL,
    contract_address TEXT   NOT NULL,
    sender           TEXT   NOT NULL,
    receiver         TEXT   NOT NULL,
    amount           NUMERIC NOT NULL,
    block_number     BIGINT NOT NULL,
    tx_hash          TEXT   NOT NULL,
    log_index        INT    NOT NULL,
    block_timestamp  TIMESTAMPTZ NOT NULL,
    indexed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chain_id, contract_address, block_number, log_index)
);
```

**Test criterion:** `sqlx migrate run` applies cleanly against a local PostgreSQL instance.

---

### Step 3 — `LogMapper` trait + `EventRepo` + `TokenTransferLogMapper`

#### `LogMapper` trait (`crates/shared/src/log_mapper.rs`)

The extensibility contract. Each event type that the indexer can persist implements this trait:

```rust
use sqlx::PgConnection;

#[async_trait::async_trait]
pub trait LogMapper: Send {
    /// Returns true if this event already exists in the DB (dedup check).
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool>;

    /// Inserts this event into the DB. Called only when is_duplicate returns false.
    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()>;
}
```

#### `EventRepo` (`crates/shared/src/db.rs`)

Low-level DB operations; no business filtering:

```rust
pub struct EventRepo { pool: PgPool }

impl EventRepo {
    pub async fn get_cursor(&self, chain_id: i64) -> anyhow::Result<u64>;
    pub async fn set_cursor(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        block: u64,
    ) -> anyhow::Result<()>;
    pub async fn is_token_transfer_duplicate(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        contract: &str,
        block: u64,
        log_index: u64,
    ) -> anyhow::Result<bool>;
    pub async fn insert_token_transfer(
        &self,
        conn: &mut PgConnection,
        event: &TokenTransferEvent,
        chain_id: i64,
    ) -> anyhow::Result<()>;
}
```

`get_cursor` returns 0 if no row exists for `chain_id`.

`set_cursor` does an upsert (`INSERT ... ON CONFLICT DO UPDATE`).

**Test criterion:** Compiles; covered by integration test in Step 10.

---

### Step 4 — Worker wiring

#### Job settings (`packages/worker/src/config.rs`)

```rust
pub struct JobSettings {
    pub name:                   String,
    pub enabled:                bool,
    pub postgres_url:           String,  // postgres connection string
    pub eth_rpc_url:            String,
    pub chain_id:               i64,
    pub contracts:              Vec<String>,
    pub polling_block_range:    u64,   // default 1000
    pub polling_interval_ms:    u64,   // default 500
    pub log_confirmations_delay: u64, // default 12
}
```

Config is loaded from environment variables. Each job's settings are namespaced by job name: `JOB_<NAME>_ENABLED`, `JOB_<NAME>_POSTGRES_URL`, `JOB_<NAME>_ETH_RPC_URL`, `JOB_<NAME>_CHAIN_ID`, `JOB_<NAME>_CONTRACTS` (comma-separated), etc.

A list of job names to discover is read from `JOB_NAMES` (comma-separated, e.g. `ethereum,polygon`).

#### `main.rs`

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let job_names = std::env::var("JOB_NAMES")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();

    let mut handles = vec![];

    for name in &job_names {
        let settings = JobSettings::from_env(name)?;
        if !settings.enabled {
            tracing::info!(job = name, "job disabled — skipping");
            continue;
        }
        let pool = sqlx::PgPool::connect(&settings.postgres_url).await?;
        sqlx::migrate!("../../crates/shared/migrations").run(&pool).await?;
        let handle = tokio::spawn(run_job(settings, pool));
        handles.push(handle);
    }

    if handles.is_empty() {
        tracing::warn!("no jobs enabled");
    }

    tokio::signal::ctrl_c().await?;
    Ok(())
}
```

Each enabled job gets its own `PgPool` and runs as an independent `tokio::task`.

**Test criterion:** Binary starts; with no enabled jobs it logs a warning and waits for Ctrl-C; with an invalid `POSTGRES_URL` it exits with a clear error.

---

### Step 5 — `EvmEventPoller` + `EvmEventPollerBuilder`

```rust
// packages/worker/src/indexer/poller.rs

pub struct EvmEventPoller {
    provider:    Arc<dyn Provider>,
    handlers:    Vec<HandlerEntry>,   // registered via builder
    block_range: u64,
    interval_ms: u64,
}

struct HandlerEntry {
    addresses: Vec<Address>,
    decode:    Box<dyn Fn(&Log) -> Option<Box<dyn LogMapper>> + Send + Sync>,
}

pub struct EvmEventPollerBuilder {
    provider:    Arc<dyn Provider>,
    handlers:    Vec<HandlerEntry>,
    block_range: u64,
    interval_ms: u64,
}

impl EvmEventPollerBuilder {
    pub fn new(provider: Arc<dyn Provider>, block_range: u64, interval_ms: u64) -> Self { ... }

    /// Register a handler for a specific event type.
    /// `decode_fn` receives a raw log and returns Some(Box<dyn LogMapper>) on match, None otherwise.
    pub fn add_event_handler(
        mut self,
        addresses: Vec<Address>,
        decode_fn: impl Fn(&Log) -> Option<Box<dyn LogMapper>> + Send + Sync + 'static,
    ) -> Self { ... }

    pub fn build(self) -> EvmEventPoller { ... }
}

impl EvmEventPoller {
    pub async fn get_latest_block(&self) -> anyhow::Result<u64> { ... }

    /// Fetches logs for [from_block, to_block] in chunks.
    /// For each log, tries all registered handlers in order.
    /// Skips logs with removed=true (reorg indicator).
    /// Returns one LogMapper per matched log.
    pub async fn poll(
        &self,
        from_block: u64,
        to_block: u64,
    ) -> anyhow::Result<Vec<Box<dyn LogMapper>>> {
        let all_addresses: Vec<Address> = self.handlers.iter()
            .flat_map(|h| h.addresses.iter().cloned())
            .collect();

        let mut result = vec![];
        let mut current = from_block;

        while current <= to_block {
            let chunk_end = (current + self.block_range - 1).min(to_block);
            let filter = Filter::new()
                .address(all_addresses.clone())
                .from_block(current)
                .to_block(chunk_end);

            let logs = self.provider.get_logs(&filter).await?;
            for log in logs {
                if log.removed.unwrap_or(false) { continue; }
                for handler in &self.handlers {
                    if let Some(mapper) = (handler.decode)(&log) {
                        result.push(mapper);
                        break;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(self.interval_ms)).await;
            current = chunk_end + 1;
        }

        Ok(result)
    }
}
```

**Test criterion:** `add_event_handler` is called once per event type at startup; `poll` returns `LogMapper` instances for matched logs and skips removed logs and unrecognised topics.

---

### Step 6 — `TokenTransfer` event parser

```rust
// packages/worker/src/indexer/parsers.rs
use alloy_sol_types::sol;

sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
}

/// Decodes a raw log into a TokenTransferEvent. Returns None for non-Transfer logs.
/// block_timestamp must be fetched by the caller before invoking this.
pub fn parse_token_transfer(
    log: &Log,
    contract_address: Address,
    block_timestamp: u64,
) -> Option<TokenTransferEvent> { ... }
```

**Test criterion:** Unit tests with hardcoded raw log fixtures — correct topic0 produces `TokenTransferEvent`; wrong topic0 and missing indexed field return `None`.

---

### Step 7 — `TokenTransferLogMapper`

Implements `LogMapper` for `TokenTransferEvent`. Owns the business rules for this event type:

```rust
// packages/worker/src/indexer/mappers.rs

pub struct TokenTransferLogMapper {
    event:    TokenTransferEvent,
    chain_id: i64,
    repo:     Arc<EventRepo>,
}

#[async_trait::async_trait]
impl LogMapper for TokenTransferLogMapper {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool> {
        if self.event.value == U256::ZERO {
            return Ok(true); // treat zero-value as "skip"
        }
        self.repo.is_token_transfer_duplicate(
            conn,
            self.chain_id,
            &self.event.contract_address.to_checksum(None),
            self.event.block_number,
            self.event.log_index,
        ).await
    }

    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        self.repo.insert_token_transfer(conn, &self.event, self.chain_id).await
    }
}
```

The decode function registered with `EvmEventPollerBuilder` creates a `TokenTransferLogMapper` for each matched log.

**Test criterion:** Zero-value transfer returns `is_duplicate = true` without a DB call.

---

### Step 8 — Main indexer loop

```rust
// packages/worker/src/indexer/mod.rs

pub async fn run_job(settings: JobSettings, pool: PgPool) {
    let repo    = Arc::new(EventRepo::new(pool.clone()));
    let provider = alloy_provider::http(&settings.eth_rpc_url);
    let repo_clone = repo.clone();

    let poller = EvmEventPollerBuilder::new(
        Arc::new(provider),
        settings.polling_block_range,
        settings.polling_interval_ms,
    )
    .add_event_handler(
        settings.contracts.iter().map(|a| a.parse().unwrap()).collect(),
        move |log| {
            let timestamp = 0u64; // TODO: fetch from block in production path
            parse_token_transfer(log, log.address, timestamp).map(|ev| {
                Box::new(TokenTransferLogMapper {
                    event: ev,
                    chain_id: settings.chain_id,
                    repo: repo_clone.clone(),
                }) as Box<dyn LogMapper>
            })
        },
    )
    .build();

    loop {
        match index_once(&settings, &repo, &poller).await {
            Ok(()) => {}
            Err(e) => {
                tracing::error!(job = %settings.name, error = %e, "indexer error — retrying in 5s");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

async fn index_once(
    settings: &JobSettings,
    repo: &EventRepo,
    poller: &EvmEventPoller,
) -> anyhow::Result<()> {
    // 1. Load cursor
    let cursor  = repo.get_cursor(settings.chain_id).await?;
    let latest  = poller.get_latest_block().await?;

    // 2. Confirmation delay check — not enough new blocks yet
    if latest < cursor + settings.log_confirmations_delay {
        return Ok(());
    }

    // 3. Compute range
    let end = (cursor + settings.polling_block_range - 1)
        .min(latest - settings.log_confirmations_delay);

    // 4. Fetch logs → decode → produce LogMapper instances
    let mappers = poller.poll(cursor, end).await?;

    // 5. Open transaction; persist all events + advance cursor atomically
    let mut conn = repo.pool.acquire().await?;
    let mut tx   = conn.begin().await?;

    for mapper in &mappers {
        if !mapper.is_duplicate(&mut tx).await? {
            mapper.insert(&mut tx).await?;
        }
    }

    repo.set_cursor(&mut tx, settings.chain_id, end + 1).await?;
    tx.commit().await?;

    tracing::info!(
        job    = %settings.name,
        from   = cursor,
        to     = end,
        events = mappers.len(),
        "indexed block range"
    );
    Ok(())
}
```

The cursor advances only inside the committed transaction. Any failure before `tx.commit()` leaves the cursor unchanged and the loop retries from the same position.

**Test criterion:** On `index_once` returning `Err`, the error is logged and the loop retries without exiting.

---

### Step 9 — Unit tests

- `parse_token_transfer`: correct fixture → `Some(TokenTransferEvent)`, wrong topic0 → `None`
- `TokenTransferLogMapper::is_duplicate`: zero-value event → returns `true` without querying DB
- Cursor arithmetic: `latest < cursor + delay` → skip tick; `end` block clamping
- `EvmEventPollerBuilder`: multiple handlers registered; correct handler is called for matching log, others are skipped

---

### Step 10 — Integration test

Requires `DATABASE_URL` pointing at a live PostgreSQL instance (provided by CI):

1. Run migrations via `sqlx::migrate!`
2. Seed `log_collector_state` with `last_indexed_block = 100`
3. Construct 4 raw `TokenTransfer` log fixtures at blocks 101–104 (two different contracts)
4. Run `index_once` with `latest_block = 116`, `confirmations_delay = 12` → `end = 104`
5. Assert 4 rows in `token_transfers`
6. Assert cursor advanced to 105
7. Re-run with the same fixtures → 0 new rows (dedup), cursor stays at 105 (already past 104)
8. Run with a zero-value fixture → 0 new rows in `token_transfers`
9. Seed a second job's `log_collector_state` with `chain_id = 2`; assert it does not interact with chain 1's cursor

---

### Step 11 — Finalise

- Run `/test-fast`
- Move this plan to `docs/exec-plans/completed/`
- Commit: `feat(worker): on-chain event indexer — closes #1`

---

## Out of Scope (this issue)

- Additional event types (`WithdrawalRequested`, `LoanMinted`, etc.) — follow-up issues
- Block timestamp fetching — currently passed as 0; add RPC call or cache in follow-up
- WebSocket subscriptions — deferred
- Deep reorg handling beyond the confirmation delay — deferred
- Quartz-style cron scheduling — jobs run immediately and loop indefinitely; cron is deferred
