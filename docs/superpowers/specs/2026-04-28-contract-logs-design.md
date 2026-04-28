# Contract Logs Unified Table & Withdrawal Queue Event Indexer

**Issue:** #10
**Date:** 2026-04-28

## Problem

The worker event indexer stores ERC-20 Transfer events in a dedicated `token_transfers` table. Adding withdrawal queue events would require a new table per event type. Instead, consolidate into a single `contract_logs` table with an `event_name` discriminator and flat union of nullable param columns.

## Schema

Replace `token_transfers` with `contract_logs`:

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

`log_collector_state` is unchanged.

### Column mapping

| Column | `Transfer` | `WithdrawalRequested` | `WithdrawalClaimed` | `ClaimableIncreased` |
|--------|------------|----------------------|--------------------|--------------------|
| `sender` | from | withdrawer | withdrawer | — |
| `receiver` | to | — | — | — |
| `amount` | value | amount | amount | delta |
| `request_id` | — | requestId | requestId | — |
| `cumulative` | — | queued | — | newClaimable |

When future spec events land (`WithdrawalFunded`, `WithdrawalSanctionedSkip`, `WithdrawalAdminReleased`), they only use `request_id` — no new columns needed.

## Events

Three events from `WithdrawalQueueUpgradeable.sol`, plus the existing ERC-20 Transfer:

| Event | Signature |
|-------|-----------|
| `Transfer` | `(address indexed from, address indexed to, uint256 value)` |
| `WithdrawalRequested` | `(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued)` |
| `WithdrawalClaimed` | `(address indexed withdrawer, uint256 indexed requestId, uint256 amount)` |
| `ClaimableIncreased` | `(uint256 delta, uint256 newClaimable)` |

## Event struct

Replace `TokenTransferEvent` with a single `ContractLog` struct that maps 1:1 to the DB row:

```rust
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

## Parsers

Four parser functions in `parsers.rs`, each returning `Option<ContractLog>`:

- **`parse_transfer(log, approved)`** — existing logic, maps `from`→sender, `to`→receiver, `value`→amount. Returns `None` for zero-value transfers (skip logic moves here from the mapper).
- **`parse_withdrawal_requested(log)`** — maps `withdrawer`→sender, `amount`→amount, `requestId`→request_id, `queued`→cumulative.
- **`parse_withdrawal_claimed(log)`** — maps `withdrawer`→sender, `amount`→amount, `requestId`→request_id.
- **`parse_claimable_increased(log)`** — maps `delta`→amount, `newClaimable`→cumulative.

## LogMapper

Replace `TokenTransferLogMapper` with a single event-agnostic `ContractLogMapper`:

```rust
pub struct ContractLogMapper {
    pub event: ContractLog,
    chain_id: i64,
    repo: Arc<EventRepo>,
}
```

Implements `LogMapper` trait (unchanged). Dedup uses `(chain_id, contract_address, block_number, log_index)` for all event types.

## EventRepo

Collapse per-event methods into two generic methods:

- **`is_duplicate(conn, chain_id, contract_address, block_number, log_index)`** — single dedup check for all events.
- **`insert_log(conn, log: &ContractLog, chain_id)`** — single insert into `contract_logs`.

Cursor methods (`get_cursor`, `set_cursor`) are unchanged.

## Config & handler registration

Add optional `JOB_<NAME>_WQ_CONTRACTS` env var to `JobSettings` — comma-separated withdrawal queue contract addresses. Empty means no WQ indexing.

Register two handlers on the same poller in `run_job`:

```rust
let poller = EvmEventPollerBuilder::new(...)
    .add_event_handler(token_contracts, move |log| {
        parse_transfer(log, &approved).map(|ev| /* ContractLogMapper */)
    })
    .add_event_handler(wq_contracts, move |log| {
        parse_withdrawal_requested(log)
            .or_else(|| parse_withdrawal_claimed(log))
            .or_else(|| parse_claimable_increased(log))
            .map(|ev| /* ContractLogMapper */)
    })
    .build();
```

Both handlers share the same cursor, DB pool, and polling loop. If `wq_contracts` is empty, the second handler is not registered.

## Files changed

| File | Change |
|------|--------|
| `packages/shared/migrations/20260421000002_token_transfers.sql` | Replace with `contract_logs` migration |
| `packages/shared/src/events.rs` | Replace `TokenTransferEvent` with `ContractLog` |
| `packages/shared/src/db.rs` | Replace per-event methods with generic `is_duplicate` / `insert_log` |
| `packages/worker/src/indexer/parsers.rs` | Refactor `parse_token_transfer` → `parse_transfer`, add 3 WQ parsers |
| `packages/worker/src/indexer/mappers.rs` | Replace `TokenTransferLogMapper` with `ContractLogMapper` |
| `packages/worker/src/indexer/mod.rs` | Register WQ handler, update imports |
| `packages/worker/src/config.rs` | Add optional `wq_contracts` field |
