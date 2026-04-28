# Contract Logs & Withdrawal Queue Event Indexer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `token_transfers` table with a unified `contract_logs` table and add withdrawal queue event indexing.

**Architecture:** Refactor the existing event indexer to use a single `contract_logs` table with an `event_name` discriminator and flat union of nullable param columns. Add three new parsers for withdrawal queue events (`WithdrawalRequested`, `WithdrawalClaimed`, `ClaimableIncreased`) following the existing `LogMapper` pattern.

**Tech Stack:** Rust, sqlx (Postgres), alloy (EVM log decoding), tokio

**Spec:** `docs/superpowers/specs/2026-04-28-contract-logs-design.md`
**Issue:** #10

---

### Task 1: Database migration — replace `token_transfers` with `contract_logs`

**Files:**
- Modify: `packages/shared/migrations/20260421000002_token_transfers.sql`

- [ ] **Step 1: Replace migration file contents**

Replace the entire contents of `packages/shared/migrations/20260421000002_token_transfers.sql` with:

```sql
DROP TABLE IF EXISTS token_transfers;

CREATE TABLE contract_logs (
    id               BIGSERIAL    PRIMARY KEY,
    chain_id         BIGINT       NOT NULL,
    contract_address TEXT         NOT NULL,
    event_name       TEXT         NOT NULL,
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INT          NOT NULL,
    block_timestamp  BIGINT       NOT NULL,
    indexed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    sender           TEXT,
    receiver         TEXT,
    amount           NUMERIC,
    request_id       NUMERIC,
    cumulative       NUMERIC,
    UNIQUE (chain_id, contract_address, block_number, log_index)
);

CREATE INDEX idx_contract_logs_event ON contract_logs (event_name);
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/migrations/20260421000002_token_transfers.sql
git commit -m "feat: replace token_transfers with contract_logs table (#10)"
```

---

### Task 2: Replace `TokenTransferEvent` with `ContractLog` struct

**Files:**
- Modify: `packages/shared/src/events.rs`

- [ ] **Step 1: Replace event struct**

Replace the entire contents of `packages/shared/src/events.rs` with:

```rust
use alloy_primitives::{Address, B256, U256};

pub struct ContractLog {
    pub contract_address: Address,
    pub event_name: String,
    pub block_number: u64,
    pub tx_hash: B256,
    pub log_index: u64,
    pub block_timestamp: u64,
    pub sender: Option<Address>,
    pub receiver: Option<Address>,
    pub amount: Option<U256>,
    pub request_id: Option<U256>,
    pub cumulative: Option<U256>,
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/events.rs
git commit -m "feat: replace TokenTransferEvent with ContractLog struct (#10)"
```

---

### Task 3: Refactor `EventRepo` to use generic `contract_logs` methods

**Files:**
- Modify: `packages/shared/src/db.rs`

- [ ] **Step 1: Replace EventRepo implementation**

Replace the entire contents of `packages/shared/src/db.rs` with:

```rust
use std::str::FromStr;

use sqlx::{PgConnection, PgPool};

use crate::events::ContractLog;

pub struct EventRepo {
    pub pool: PgPool,
}

impl EventRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Returns the last indexed block for the given chain, or 0 if no cursor exists yet.
    pub async fn get_cursor(&self, chain_id: i64) -> anyhow::Result<u64> {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT last_indexed_block FROM log_collector_state WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|(b,)| b as u64).unwrap_or(0))
    }

    /// Upserts the cursor for the given chain inside an open transaction.
    pub async fn set_cursor(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        block: u64,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO log_collector_state (chain_id, last_indexed_block, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (chain_id) DO UPDATE
               SET last_indexed_block = EXCLUDED.last_indexed_block,
                   updated_at         = NOW()",
        )
        .bind(chain_id)
        .bind(block as i64)
        .execute(conn)
        .await?;

        Ok(())
    }

    pub async fn is_duplicate(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        contract: &str,
        block: u64,
        log_index: u64,
    ) -> anyhow::Result<bool> {
        let exists: (bool,) = sqlx::query_as(
            "SELECT EXISTS(
                SELECT 1 FROM contract_logs
                WHERE chain_id = $1
                  AND contract_address = $2
                  AND block_number = $3
                  AND log_index = $4
             )",
        )
        .bind(chain_id)
        .bind(contract)
        .bind(block as i64)
        .bind(log_index as i32)
        .fetch_one(conn)
        .await?;

        Ok(exists.0)
    }

    pub async fn insert_log(
        &self,
        conn: &mut PgConnection,
        event: &ContractLog,
        chain_id: i64,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO contract_logs
               (chain_id, contract_address, event_name,
                block_number, tx_hash, log_index, block_timestamp,
                sender, receiver, amount, request_id, cumulative)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        )
        .bind(chain_id)
        .bind(event.contract_address.to_checksum(None))
        .bind(&event.event_name)
        .bind(event.block_number as i64)
        .bind(format!("{:?}", event.tx_hash))
        .bind(event.log_index as i32)
        .bind(event.block_timestamp as i64)
        .bind(event.sender.map(|a| a.to_checksum(None)))
        .bind(event.receiver.map(|a| a.to_checksum(None)))
        .bind(
            event
                .amount
                .map(|v| bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")),
        )
        .bind(
            event
                .request_id
                .map(|v| bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")),
        )
        .bind(
            event
                .cumulative
                .map(|v| bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")),
        )
        .execute(conn)
        .await?;

        Ok(())
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/db.rs
git commit -m "feat: refactor EventRepo to generic contract_logs methods (#10)"
```

---

### Task 4: Replace `TokenTransferLogMapper` with `ContractLogMapper`

**Files:**
- Modify: `packages/worker/src/indexer/mappers.rs`

- [ ] **Step 1: Replace mapper implementation**

Replace the entire contents of `packages/worker/src/indexer/mappers.rs` with:

```rust
use std::sync::Arc;

use async_trait::async_trait;
use sqlx::PgConnection;

use shared::{db::EventRepo, events::ContractLog, log_mapper::LogMapper};

pub struct ContractLogMapper {
    pub event: ContractLog,
    chain_id: i64,
    repo: Arc<EventRepo>,
}

impl ContractLogMapper {
    pub fn new(event: ContractLog, chain_id: i64, repo: Arc<EventRepo>) -> Self {
        Self {
            event,
            chain_id,
            repo,
        }
    }
}

#[async_trait]
impl LogMapper for ContractLogMapper {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool> {
        self.repo
            .is_duplicate(
                conn,
                self.chain_id,
                &self.event.contract_address.to_checksum(None),
                self.event.block_number,
                self.event.log_index,
            )
            .await
    }

    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        self.repo
            .insert_log(conn, &self.event, self.chain_id)
            .await
    }

    fn block_number(&self) -> u64 {
        self.event.block_number
    }

    fn set_block_timestamp(&mut self, ts: u64) {
        self.event.block_timestamp = ts;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/worker/src/indexer/mappers.rs
git commit -m "feat: replace TokenTransferLogMapper with ContractLogMapper (#10)"
```

---

### Task 5: Refactor parsers and add withdrawal queue event decoders

**Files:**
- Modify: `packages/worker/src/indexer/parsers.rs`

- [ ] **Step 1: Write failing tests for all four parsers**

Replace the entire contents of `packages/worker/tests/parsers.rs` with:

```rust
use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, U256},
    rpc::types::Log,
};

use alloy::sol_types::SolEvent;

use pipeline_worker::indexer::parsers::{
    parse_claimable_increased, parse_transfer, parse_withdrawal_claimed,
    parse_withdrawal_requested,
};

// Re-declare sol! events to get correct SIGNATURE_HASH constants for test log construction.
alloy::sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event WithdrawalClaimed(address indexed withdrawer, uint256 indexed requestId, uint256 amount);
    event ClaimableIncreased(uint256 delta, uint256 newClaimable);
}

const CONTRACT: Address = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH: FixedBytes<32> =
    b256!("1111111111111111111111111111111111111111111111111111111111111111");

fn make_transfer_log(from: Address, to: Address, value: U256) -> Log {
    let topic1: FixedBytes<32> = from.into_word();
    let topic2: FixedBytes<32> = to.into_word();
    let mut data = [0u8; 32];
    data.copy_from_slice(&value.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![Transfer::SIGNATURE_HASH, topic1, topic2], data.into()).unwrap(),
    };

    Log {
        inner,
        block_number: Some(101),
        transaction_hash: Some(TX_HASH.into()),
        log_index: Some(0),
        ..Default::default()
    }
}

// --- Transfer tests ---

#[test]
fn transfer_correct_log_decodes() {
    let from = address!("1111111111111111111111111111111111111111");
    let to = address!("2222222222222222222222222222222222222222");
    let value = U256::from(1000u64);

    let log = make_transfer_log(from, to, value);
    let ev = parse_transfer(&log, &[to]).expect("should decode");

    assert_eq!(ev.event_name, "Transfer");
    assert_eq!(ev.sender, Some(from));
    assert_eq!(ev.receiver, Some(to));
    assert_eq!(ev.amount, Some(value));
    assert_eq!(ev.request_id, None);
    assert_eq!(ev.cumulative, None);
    assert_eq!(ev.block_number, 101);
}

#[test]
fn transfer_wrong_topic0_returns_none() {
    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![FixedBytes::ZERO], vec![].into()).unwrap(),
    };
    let log = Log {
        inner,
        ..Default::default()
    };

    assert!(parse_transfer(&log, &[]).is_none());
}

#[test]
fn transfer_zero_value_returns_none() {
    let from = address!("1111111111111111111111111111111111111111");
    let to = address!("2222222222222222222222222222222222222222");

    let log = make_transfer_log(from, to, U256::ZERO);
    assert!(parse_transfer(&log, &[to]).is_none());
}

#[test]
fn transfer_unapproved_address_returns_none() {
    let from = address!("1111111111111111111111111111111111111111");
    let to = address!("2222222222222222222222222222222222222222");
    let unrelated = address!("3333333333333333333333333333333333333333");

    let log = make_transfer_log(from, to, U256::from(100u64));
    assert!(parse_transfer(&log, &[unrelated]).is_none());
}

// --- WithdrawalRequested tests ---

#[test]
fn withdrawal_requested_decodes() {
    let withdrawer = address!("1111111111111111111111111111111111111111");
    let request_id = U256::from(42u64);
    let amount = U256::from(5000u64);
    let queued = U256::from(10000u64);

    // topics: event sig, indexed withdrawer, indexed requestId
    let topic1: FixedBytes<32> = withdrawer.into_word();
    let topic2: FixedBytes<32> = request_id.into();

    // data: amount, queued (non-indexed)
    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&amount.to_be_bytes::<32>());
    data[32..].copy_from_slice(&queued.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![WithdrawalRequested::SIGNATURE_HASH, topic1, topic2], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(200),
        transaction_hash: Some(TX_HASH.into()),
        log_index: Some(3),
        ..Default::default()
    };

    let ev = parse_withdrawal_requested(&log).expect("should decode");
    assert_eq!(ev.event_name, "WithdrawalRequested");
    assert_eq!(ev.sender, Some(withdrawer));
    assert_eq!(ev.receiver, None);
    assert_eq!(ev.amount, Some(amount));
    assert_eq!(ev.request_id, Some(request_id));
    assert_eq!(ev.cumulative, Some(queued));
    assert_eq!(ev.block_number, 200);
    assert_eq!(ev.log_index, 3);
}

// --- WithdrawalClaimed tests ---

#[test]
fn withdrawal_claimed_decodes() {
    let withdrawer = address!("1111111111111111111111111111111111111111");
    let request_id = U256::from(42u64);
    let amount = U256::from(5000u64);

    let topic1: FixedBytes<32> = withdrawer.into_word();
    let topic2: FixedBytes<32> = request_id.into();

    let mut data = [0u8; 32];
    data.copy_from_slice(&amount.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![WithdrawalClaimed::SIGNATURE_HASH, topic1, topic2], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(201),
        transaction_hash: Some(TX_HASH.into()),
        log_index: Some(1),
        ..Default::default()
    };

    let ev = parse_withdrawal_claimed(&log).expect("should decode");
    assert_eq!(ev.event_name, "WithdrawalClaimed");
    assert_eq!(ev.sender, Some(withdrawer));
    assert_eq!(ev.receiver, None);
    assert_eq!(ev.amount, Some(amount));
    assert_eq!(ev.request_id, Some(request_id));
    assert_eq!(ev.cumulative, None);
    assert_eq!(ev.block_number, 201);
}

// --- ClaimableIncreased tests ---

#[test]
fn claimable_increased_decodes() {
    let delta = U256::from(3000u64);
    let new_claimable = U256::from(15000u64);

    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&delta.to_be_bytes::<32>());
    data[32..].copy_from_slice(&new_claimable.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![ClaimableIncreased::SIGNATURE_HASH], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(202),
        transaction_hash: Some(TX_HASH.into()),
        log_index: Some(0),
        ..Default::default()
    };

    let ev = parse_claimable_increased(&log).expect("should decode");
    assert_eq!(ev.event_name, "ClaimableIncreased");
    assert_eq!(ev.sender, None);
    assert_eq!(ev.receiver, None);
    assert_eq!(ev.amount, Some(delta));
    assert_eq!(ev.request_id, None);
    assert_eq!(ev.cumulative, Some(new_claimable));
    assert_eq!(ev.block_number, 202);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package pipeline-worker --test parsers 2>&1 | head -30`
Expected: compilation error — `parse_transfer`, `parse_withdrawal_requested`, etc. don't exist yet.

- [ ] **Step 3: Implement all four parsers**

Replace the entire contents of `packages/worker/src/indexer/parsers.rs` with:

```rust
use alloy::{primitives::Address, rpc::types::Log, sol, sol_types::SolEvent};

use shared::events::ContractLog;

sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event WithdrawalClaimed(address indexed withdrawer, uint256 indexed requestId, uint256 amount);
    event ClaimableIncreased(uint256 delta, uint256 newClaimable);
}

fn extract_log_meta(log: &Log) -> Option<(Address, u64, alloy::primitives::B256, u64)> {
    Some((
        log.address(),
        log.block_number?,
        log.transaction_hash?,
        log.log_index?,
    ))
}

pub fn parse_transfer(log: &Log, approved: &[Address]) -> Option<ContractLog> {
    let decoded = Transfer::decode_log(log.as_ref(), true).ok()?;

    if decoded.value.is_zero() {
        return None;
    }

    if !approved.contains(&decoded.from) && !approved.contains(&decoded.to) {
        return None;
    }

    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "Transfer".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.from),
        receiver: Some(decoded.to),
        amount: Some(decoded.value),
        request_id: None,
        cumulative: None,
    })
}

pub fn parse_withdrawal_requested(log: &Log) -> Option<ContractLog> {
    let decoded = WithdrawalRequested::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "WithdrawalRequested".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.withdrawer),
        receiver: None,
        amount: Some(decoded.amount),
        request_id: Some(decoded.requestId),
        cumulative: Some(decoded.queued),
    })
}

pub fn parse_withdrawal_claimed(log: &Log) -> Option<ContractLog> {
    let decoded = WithdrawalClaimed::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "WithdrawalClaimed".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.withdrawer),
        receiver: None,
        amount: Some(decoded.amount),
        request_id: Some(decoded.requestId),
        cumulative: None,
    })
}

pub fn parse_claimable_increased(log: &Log) -> Option<ContractLog> {
    let decoded = ClaimableIncreased::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "ClaimableIncreased".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: None,
        receiver: None,
        amount: Some(decoded.delta),
        request_id: None,
        cumulative: Some(decoded.newClaimable),
    })
}
```

- [ ] **Step 4: Run parser tests to verify they pass**

Run: `cargo test --package pipeline-worker --test parsers 2>&1`
Expected: all 7 tests pass. If any topic hash constants in the test file are wrong (they were hand-computed), fix them by computing the correct keccak256 hashes from the sol! declarations and updating the test constants.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/indexer/parsers.rs packages/worker/tests/parsers.rs
git commit -m "feat: add withdrawal queue event parsers, refactor Transfer parser (#10)"
```

---

### Task 6: Update integration tests for `contract_logs`

**Files:**
- Modify: `packages/worker/tests/indexer_integration.rs`

- [ ] **Step 1: Update integration tests**

Replace the entire contents of `packages/worker/tests/indexer_integration.rs` with:

```rust
/// Integration tests for the indexer loop.
/// Requires DATABASE_URL to be set to a live PostgreSQL instance.
/// Skipped automatically by the pre-commit hook when DATABASE_URL is unset.
#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use alloy::primitives::{address, b256, Address, U256};
    use sqlx::PgPool;

    use shared::{db::EventRepo, events::ContractLog};

    async fn setup_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.expect("connect to test DB");
        sqlx::migrate!("../shared/migrations")
            .run(&pool)
            .await
            .expect("migrations");
        sqlx::query("DELETE FROM contract_logs")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM log_collector_state")
            .execute(&pool)
            .await
            .unwrap();
        Some(pool)
    }

    fn make_transfer(
        contract: Address,
        block: u64,
        log_index: u64,
        value: U256,
    ) -> ContractLog {
        ContractLog {
            contract_address: contract,
            event_name: "Transfer".to_owned(),
            block_number: block,
            tx_hash: b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            log_index,
            block_timestamp: 0,
            sender: Some(address!("1111111111111111111111111111111111111111")),
            receiver: Some(address!("2222222222222222222222222222222222222222")),
            amount: Some(value),
            request_id: None,
            cumulative: None,
        }
    }

    fn make_withdrawal_requested(
        contract: Address,
        block: u64,
        log_index: u64,
    ) -> ContractLog {
        ContractLog {
            contract_address: contract,
            event_name: "WithdrawalRequested".to_owned(),
            block_number: block,
            tx_hash: b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            log_index,
            block_timestamp: 0,
            sender: Some(address!("1111111111111111111111111111111111111111")),
            receiver: None,
            amount: Some(U256::from(5000u64)),
            request_id: Some(U256::from(1u64)),
            cumulative: Some(U256::from(5000u64)),
        }
    }

    async fn run_once(
        repo: &EventRepo,
        chain_id: i64,
        events: &[ContractLog],
        end_block: u64,
    ) -> usize {
        let mut tx = repo.pool.begin().await.unwrap();
        let mut inserted = 0usize;

        for ev in events {
            let dup = repo
                .is_duplicate(
                    &mut tx,
                    chain_id,
                    &ev.contract_address.to_checksum(None),
                    ev.block_number,
                    ev.log_index,
                )
                .await
                .unwrap();
            if !dup {
                repo.insert_log(&mut tx, ev, chain_id).await.unwrap();
                inserted += 1;
            }
        }

        repo.set_cursor(&mut tx, chain_id, end_block + 1)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        inserted
    }

    async fn count_logs(pool: &PgPool, chain_id: i64, event_name: Option<&str>) -> i64 {
        let (n,): (i64,) = match event_name {
            Some(name) => {
                sqlx::query_as(
                    "SELECT COUNT(*) FROM contract_logs WHERE chain_id = $1 AND event_name = $2",
                )
                .bind(chain_id)
                .bind(name)
                .fetch_one(pool)
                .await
                .unwrap()
            }
            None => {
                sqlx::query_as("SELECT COUNT(*) FROM contract_logs WHERE chain_id = $1")
                    .bind(chain_id)
                    .fetch_one(pool)
                    .await
                    .unwrap()
            }
        };
        n
    }

    async fn get_cursor(pool: &PgPool, chain_id: i64) -> i64 {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT last_indexed_block FROM log_collector_state WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_optional(pool)
        .await
        .unwrap();
        row.map(|(b,)| b).unwrap_or(0)
    }

    #[tokio::test]
    async fn inserts_events_and_advances_cursor() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract_a = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let contract_b = address!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

        sqlx::query(
            "INSERT INTO log_collector_state (chain_id, last_indexed_block) VALUES (1, 100)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let events = vec![
            make_transfer(contract_a, 101, 0, U256::from(100u64)),
            make_transfer(contract_a, 102, 0, U256::from(200u64)),
            make_transfer(contract_b, 103, 0, U256::from(300u64)),
            make_transfer(contract_b, 104, 0, U256::from(400u64)),
        ];

        let inserted = run_once(&repo, 1, &events, 104).await;

        assert_eq!(inserted, 4, "should have inserted 4 events");
        assert_eq!(count_logs(&pool, 1, None).await, 4);
        assert_eq!(get_cursor(&pool, 1).await, 105);
    }

    #[tokio::test]
    async fn dedup_skips_already_indexed_events() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let events = vec![
            make_transfer(contract, 101, 0, U256::from(100u64)),
            make_transfer(contract, 102, 0, U256::from(200u64)),
        ];

        let first = run_once(&repo, 1, &events, 102).await;
        assert_eq!(first, 2);
        assert_eq!(get_cursor(&pool, 1).await, 103);

        let second = run_once(&repo, 1, &events, 102).await;
        assert_eq!(second, 0, "dedup should prevent re-insertion");
        assert_eq!(count_logs(&pool, 1, None).await, 2);
    }

    #[tokio::test]
    async fn separate_chains_have_independent_cursors() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        let ev1 = vec![make_transfer(contract, 101, 0, U256::from(100u64))];
        run_once(&repo, 1, &ev1, 101).await;

        let ev2 = vec![make_transfer(contract, 200, 0, U256::from(999u64))];
        run_once(&repo, 2, &ev2, 200).await;

        assert_eq!(get_cursor(&pool, 1).await, 102);
        assert_eq!(get_cursor(&pool, 2).await, 201);
        assert_eq!(count_logs(&pool, 1, None).await, 1);
        assert_eq!(count_logs(&pool, 2, None).await, 1);
    }

    #[tokio::test]
    async fn mixed_event_types_coexist() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        let events = vec![
            make_transfer(contract, 101, 0, U256::from(100u64)),
            make_withdrawal_requested(contract, 101, 1),
        ];

        let inserted = run_once(&repo, 1, &events, 101).await;
        assert_eq!(inserted, 2);
        assert_eq!(count_logs(&pool, 1, Some("Transfer")).await, 1);
        assert_eq!(count_logs(&pool, 1, Some("WithdrawalRequested")).await, 1);
        assert_eq!(count_logs(&pool, 1, None).await, 2);
    }
}
```

- [ ] **Step 2: Run integration tests (if DATABASE_URL is set)**

Run: `cargo test --package pipeline-worker --test indexer_integration 2>&1`
Expected: all 4 tests pass (or skip gracefully if DATABASE_URL is unset).

- [ ] **Step 3: Commit**

```bash
git add packages/worker/tests/indexer_integration.rs
git commit -m "test: update integration tests for contract_logs table (#10)"
```

---

### Task 7: Add `wq_contracts` to config and wire handler registration

**Files:**
- Modify: `packages/worker/src/config.rs`
- Modify: `packages/worker/src/indexer/mod.rs`

- [ ] **Step 1: Add `wq_contracts` to `JobSettings`**

In `packages/worker/src/config.rs`, add `wq_contracts` field to the struct and parsing logic.

Add field to the struct after `polling_targets`:

```rust
    pub wq_contracts: Vec<String>,
```

In the disabled early-return, add after `polling_targets: vec![]`:

```rust
                wq_contracts: vec![],
```

In the parsing section, after the `polling_targets` block (after line 58), add:

```rust
        let wq_contracts: Vec<String> = env::var(format!("{prefix}WQ_CONTRACTS"))
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect();
```

In the `Ok(Self { ... })` block, add after `polling_targets`:

```rust
            wq_contracts,
```

- [ ] **Step 2: Wire handler registration in `mod.rs`**

Replace the entire contents of `packages/worker/src/indexer/mod.rs` with:

```rust
pub mod mappers;
pub mod parsers;
pub mod poller;

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use sqlx::PgPool;
use tracing::Instrument;

use shared::db::EventRepo;

use crate::config::JobSettings;
use mappers::ContractLogMapper;
use parsers::{
    parse_claimable_increased, parse_transfer, parse_withdrawal_claimed,
    parse_withdrawal_requested,
};
use poller::EvmEventPollerBuilder;

pub async fn run_job(settings: JobSettings, pool: PgPool) {
    let repo = Arc::new(EventRepo::new(pool));
    let settings = Arc::new(settings);

    let approved: Vec<alloy::primitives::Address> = settings
        .polling_targets
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let token_contracts: Vec<alloy::primitives::Address> = settings
        .polling_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let wq_contracts: Vec<alloy::primitives::Address> = settings
        .wq_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let mut builder = EvmEventPollerBuilder::new(
        &settings.eth_rpc_url,
        settings.polling_block_range,
        settings.polling_interval_ms,
    );

    // Transfer handler
    {
        let repo = repo.clone();
        let chain_id = settings.chain_id;
        builder = builder.add_event_handler(token_contracts, move |log| {
            parse_transfer(log, &approved).map(|ev| {
                Box::new(ContractLogMapper::new(ev, chain_id, repo.clone()))
                    as Box<dyn shared::log_mapper::LogMapper>
            })
        });
    }

    // Withdrawal queue handler (only if wq_contracts is non-empty)
    if !wq_contracts.is_empty() {
        let repo = repo.clone();
        let chain_id = settings.chain_id;
        builder = builder.add_event_handler(wq_contracts, move |log| {
            parse_withdrawal_requested(log)
                .or_else(|| parse_withdrawal_claimed(log))
                .or_else(|| parse_claimable_increased(log))
                .map(|ev| {
                    Box::new(ContractLogMapper::new(ev, chain_id, repo.clone()))
                        as Box<dyn shared::log_mapper::LogMapper>
                })
        });
    }

    let poller = builder.build();

    loop {
        let span = tracing::info_span!("index_once", job = %settings.name);
        match index_once(&settings, &repo, &poller).instrument(span).await {
            Ok(()) => {
                tracing::info!(job = %settings.name, "indexing completed successfully");
            }
            Err(e) => {
                tracing::error!(job = %settings.name, error = %e, "indexer error — retrying in 5s");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

async fn index_once(
    settings: &JobSettings,
    repo: &EventRepo,
    poller: &poller::EvmEventPoller,
) -> Result<()> {
    let cursor = repo.get_cursor(settings.chain_id).await?;
    let latest = poller.get_latest_block().await?;

    if latest < cursor + settings.log_confirmations_delay {
        return Ok(());
    }

    let end =
        (cursor + settings.polling_block_range - 1).min(latest - settings.log_confirmations_delay);

    let mut mappers = poller.poll(cursor, end).await?;

    let mut tx = repo.pool.begin().await?;
    let mut timestamp_cache: HashMap<u64, u64> = HashMap::new();

    for mapper in &mut mappers {
        if !mapper.is_duplicate(&mut tx).await? {
            let ts = poller
                .get_block_timestamp(mapper.block_number(), &mut timestamp_cache)
                .await?;
            mapper.set_block_timestamp(ts);
            mapper.insert(&mut tx).await?;
        }
    }

    repo.set_cursor(&mut tx, settings.chain_id, end + 1).await?;
    tx.commit().await?;

    tracing::info!(
        job   = %settings.name,
        from  = cursor,
        to    = end,
        count = mappers.len(),
        "indexed block range"
    );
    Ok(())
}
```

- [ ] **Step 3: Build to verify everything compiles**

Run: `cargo build --package pipeline-worker 2>&1`
Expected: successful compilation with no errors.

- [ ] **Step 4: Run all worker tests**

Run: `cargo test --package pipeline-worker 2>&1`
Expected: all parser tests pass. Integration tests pass or skip (if no DATABASE_URL).

- [ ] **Step 5: Run clippy**

Run: `cargo clippy --all -- -D warnings 2>&1`
Expected: no warnings or errors.

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/config.rs packages/worker/src/indexer/mod.rs
git commit -m "feat: wire withdrawal queue handler registration with wq_contracts config (#10)"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

Run: `/test-fast` skill or `cargo clippy --all -- -D warnings && cargo test --workspace 2>&1`
Expected: all checks pass.

- [ ] **Step 2: Verify all files are committed**

Run: `git status`
Expected: clean working tree on `feat/withdrawal-queue-indexer` branch.
