# sPLUSD Stake/Unstake Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Index ERC-4626 Deposit/Withdraw events from the sPLUSD vault and expose them in the `/v1/requests` API as Stake/Unstake entries.

**Architecture:** Add `assets`/`shares` columns to the existing `contract_logs` table. New event parsers feed into the same indexer pipeline via a new `add_event_handler` for sPLUSD contracts. Extract the `/v1/requests` handler into an analytics module with a restructured response covering all four event types.

**Tech Stack:** Rust, SQLx, Alloy (EVM ABI decoding), Axum, PostgreSQL

---

### Task 1: Database Migration — add `assets` and `shares` columns

**Files:**
- Create: `packages/shared/migrations/20260514000001_staking_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE contract_logs ADD COLUMN assets NUMERIC;
ALTER TABLE contract_logs ADD COLUMN shares NUMERIC;
```

- [ ] **Step 2: Verify migration compiles**

Run: `cargo build -p shared 2>&1 | tail -20`
Expected: successful build (migrations are embedded at compile time via `sqlx::migrate!`)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/migrations/20260514000001_staking_columns.sql
git commit -m "feat(db): add assets and shares columns to contract_logs"
```

---

### Task 2: Extend `ContractLog` struct with `assets` and `shares`

**Files:**
- Modify: `packages/shared/src/events.rs`

- [ ] **Step 1: Add fields to ContractLog**

Add two new fields after `cumulative`:

```rust
pub assets: Option<U256>,
pub shares: Option<U256>,
```

The full struct becomes:

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
    pub assets: Option<U256>,
    pub shares: Option<U256>,
}
```

- [ ] **Step 2: Fix all existing parser call sites**

In `packages/worker/src/indexer/parsers.rs`, add `assets: None, shares: None` to all three existing `ContractLog` constructors (`parse_deposit_requested`, `parse_withdrawal_requested`, `parse_request_claimed`).

For `parse_deposit_requested` (and similarly for the other two):

```rust
Some(ContractLog {
    contract_address,
    event_name: "DepositRequested".to_owned(),
    block_number,
    tx_hash,
    log_index,
    block_timestamp: 0,
    sender: Some(decoded.user),
    receiver: None,
    amount: Some(decoded.amount),
    request_id: Some(decoded.requestId),
    cumulative: None,
    assets: None,
    shares: None,
})
```

For `parse_withdrawal_requested`:

```rust
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
    assets: None,
    shares: None,
})
```

For `parse_request_claimed`:

```rust
Some(ContractLog {
    contract_address,
    event_name: "RequestClaimed".to_owned(),
    block_number,
    tx_hash,
    log_index,
    block_timestamp: 0,
    sender: Some(decoded.user),
    receiver: None,
    amount: Some(decoded.amount),
    request_id: Some(decoded.requestId),
    cumulative: None,
    assets: None,
    shares: None,
})
```

- [ ] **Step 3: Extend `insert_log` in EventRepo**

In `packages/shared/src/db.rs`, update the `insert_log` method to include the two new columns:

```rust
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
            sender, receiver, amount, request_id, cumulative,
            assets, shares)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
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
    .bind(event.amount.map(|v| {
        bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")
    }))
    .bind(event.request_id.map(|v| {
        bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")
    }))
    .bind(event.cumulative.map(|v| {
        bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")
    }))
    .bind(event.assets.map(|v| {
        bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")
    }))
    .bind(event.shares.map(|v| {
        bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")
    }))
    .execute(conn)
    .await?;

    Ok(())
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo build -p shared -p worker 2>&1 | tail -20`
Expected: successful build

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.rs packages/shared/src/db.rs packages/worker/src/indexer/parsers.rs
git commit -m "feat(shared): add assets/shares fields to ContractLog and insert_log"
```

---

### Task 3: Add staking event parsers

**Files:**
- Modify: `packages/worker/src/indexer/parsers.rs`

- [ ] **Step 1: Add ERC-4626 event declarations**

Add a second `sol!` block after the existing one (Alloy's `sol!` macro generates Rust types from Solidity declarations — a separate block avoids name collisions with the existing `DepositRequested` etc.):

```rust
sol! {
    event StakingDeposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event StakingWithdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
}
```

Note: We use `StakingDeposit` / `StakingWithdraw` as the Solidity event names to avoid colliding with the OZ `Deposit`/`Withdraw` names. The ABI encoding is determined by the parameter types and indexed flags, not the event name — but we need to match the actual on-chain event signature. So instead, declare them with their real names in a separate module:

```rust
mod erc4626 {
    use alloy::sol;
    sol! {
        event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
        event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    }
}
```

- [ ] **Step 2: Add `parse_staking_deposit` function**

```rust
pub fn parse_staking_deposit(log: &Log) -> Option<ContractLog> {
    let decoded = erc4626::Deposit::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "StakingDeposit".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.owner),
        receiver: None,
        amount: Some(decoded.assets),
        request_id: None,
        cumulative: None,
        assets: Some(decoded.assets),
        shares: Some(decoded.shares),
    })
}
```

- [ ] **Step 3: Add `parse_staking_withdraw` function**

```rust
pub fn parse_staking_withdraw(log: &Log) -> Option<ContractLog> {
    let decoded = erc4626::Withdraw::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "StakingWithdrawal".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.owner),
        receiver: Some(decoded.receiver),
        amount: Some(decoded.assets),
        request_id: None,
        cumulative: None,
        assets: Some(decoded.assets),
        shares: Some(decoded.shares),
    })
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo build -p worker 2>&1 | tail -20`
Expected: successful build

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/indexer/parsers.rs
git commit -m "feat(indexer): add ERC-4626 staking event parsers"
```

---

### Task 4: Add sPLUSD config and handler registration

**Files:**
- Modify: `packages/worker/src/indexer/config.rs`
- Modify: `packages/worker/src/indexer/mod.rs`

- [ ] **Step 1: Add `splusd_contracts` to config**

In `packages/worker/src/indexer/config.rs`, add the field to `IndexerJobSettings`:

```rust
pub struct IndexerJobSettings {
    pub eth_rpc_url: String,
    pub chain_id: i64,
    pub start_block: u64,
    pub dm_contracts: Vec<String>,
    pub wq_contracts: Vec<String>,
    pub splusd_contracts: Vec<String>,
    pub polling_block_range: u64,
    pub polling_interval_ms: u64,
    pub log_confirmations_delay: u64,
}
```

In `from_env()`, add after the `wq_contracts` line:

```rust
splusd_contracts: env_csv_require(&format!("{prefix}SPLUSD_CONTRACTS"))?,
```

- [ ] **Step 2: Register sPLUSD handler in `mod.rs`**

In `packages/worker/src/indexer/mod.rs`:

Update the imports line to include the new parsers:

```rust
use parsers::{
    parse_deposit_requested, parse_request_claimed, parse_staking_deposit,
    parse_staking_withdraw, parse_withdrawal_requested,
};
```

Add address parsing after the `wq_contracts` block:

```rust
let splusd_contracts: Vec<alloy::primitives::Address> = settings
    .splusd_contracts
    .iter()
    .filter_map(|a| a.parse().ok())
    .collect();
```

Add `let splusd_repo = repo.clone();` after `let wq_repo = repo.clone();`.

Add a new `.add_event_handler` call before `.build()`:

```rust
.add_event_handler(splusd_contracts, move |log| {
    parse_staking_deposit(log)
        .or_else(|| parse_staking_withdraw(log))
        .map(|ev| {
            Box::new(ContractLogMapper::new(ev, chain_id, splusd_repo.clone()))
                as Box<dyn shared::log_mapper::LogMapper>
        })
})
```

- [ ] **Step 3: Add env var to `.env`**

Add after the `JOB_INDEXER_WQ_CONTRACTS` line:

```
JOB_INDEXER_SPLUSD_CONTRACTS=0x4C414d0948D8392b1E78e25cb54b4074616Af2B6
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo build -p worker 2>&1 | tail -20`
Expected: successful build

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/indexer/config.rs packages/worker/src/indexer/mod.rs .env
git commit -m "feat(indexer): register sPLUSD vault event handler"
```

---

### Task 5: Extract analytics module and restructure `/v1/requests` response

**Files:**
- Create: `packages/api/src/routes/analytics.rs`
- Modify: `packages/api/src/routes/vouchers.rs`
- Modify: `packages/api/src/routes/mod.rs`
- Modify: `packages/api/src/main.rs`
- Modify: `packages/shared/src/kyc_repo.rs`

- [ ] **Step 1: Update `GroupedRequest` response model in `kyc_repo.rs`**

In `packages/shared/src/kyc_repo.rs`, update the `GroupedRequest` struct to drop `request_id` and use the new response shape:

```rust
#[derive(serde::Serialize)]
pub struct GroupedRequest {
    #[serde(rename = "type")]
    pub request_type: String,
    pub amount: String,
    pub status: String,
    pub created_at: String,
}
```

Update the `From<RequestEventRow>` impl to handle all four event types and use `Completed` instead of `Claimed`:

```rust
impl From<RequestEventRow> for GroupedRequest {
    fn from(row: RequestEventRow) -> Self {
        let request_type = match row.event_name.as_str() {
            "DepositRequested" => "Deposit",
            "WithdrawalRequested" => "Withdraw",
            "StakingDeposit" => "Stake",
            "StakingWithdrawal" => "Unstake",
            other => other,
        };

        let status = match row.event_name.as_str() {
            "StakingDeposit" | "StakingWithdrawal" => "Completed",
            _ => {
                if row.is_claimed {
                    "Completed"
                } else {
                    match row.crystal_kyt_status {
                        Some(1) => "PendingClaim",
                        Some(_) => "VerificationFailed",
                        None => "PendingVerification",
                    }
                }
            }
        };

        let created_at = chrono::DateTime::from_timestamp(row.block_timestamp, 0)
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .unwrap_or_default();

        Self {
            request_type: request_type.to_owned(),
            amount: row.amount.map(|a| a.to_string()).unwrap_or_default(),
            status: status.to_owned(),
            created_at,
        }
    }
}
```

- [ ] **Step 2: Update `get_all_requests` query to include staking events**

In `packages/shared/src/kyc_repo.rs`, update the `get_all_requests` method. The IN clause now includes the staking event types:

```rust
pub async fn get_all_requests(
    &self,
    wallet: &str,
    pending_only: bool,
) -> anyhow::Result<Vec<GroupedRequest>> {
    let base = "SELECT r.event_name, r.request_id, r.amount, r.crystal_kyt_status,
                       r.block_timestamp,
                       EXISTS (
                           SELECT 1 FROM contract_logs c2
                           WHERE c2.event_name = 'RequestClaimed'
                             AND c2.request_id = r.request_id
                       ) AS is_claimed
                FROM contract_logs r
                WHERE LOWER(r.sender) = $1
                  AND r.event_name IN ('DepositRequested', 'WithdrawalRequested', 'StakingDeposit', 'StakingWithdrawal')";

    let query = if pending_only {
        format!(
            "{base}
                  AND NOT EXISTS (
                      SELECT 1 FROM contract_logs c2
                      WHERE c2.event_name = 'RequestClaimed'
                        AND c2.request_id = r.request_id
                  )
                  AND r.event_name NOT IN ('StakingDeposit', 'StakingWithdrawal')
                ORDER BY r.block_timestamp DESC, r.id DESC"
        )
    } else {
        format!("{base} ORDER BY r.block_timestamp DESC, r.id DESC")
    };

    let rows = sqlx::query_as::<_, RequestEventRow>(&query)
        .bind(wallet)
        .fetch_all(&self.pool)
        .await?;
    Ok(rows.into_iter().map(GroupedRequest::from).collect())
}
```

Note: When `pending_only` is true, staking events are excluded (they are always completed, never pending).

- [ ] **Step 3: Create `analytics.rs` module**

Create `packages/api/src/routes/analytics.rs`:

```rust
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use utoipa::{OpenApi, ToSchema};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/requests", get(get_requests))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_requests),
    components(schemas(RequestsQuery)),
    tags(
        (name = "Analytics", description = "Transaction history and activity feed")
    )
)]
pub struct AnalyticsDoc;

#[derive(Deserialize, ToSchema)]
pub struct RequestsQuery {
    pub wallet: String,
    /// "all" (default) or "pending" (only unclaimed requests).
    #[serde(default)]
    pub status: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/requests",
    params(
        ("wallet" = String, Query, description = "Wallet address"),
        ("status" = Option<String>, Query, description = "Filter: \"all\" (default) or \"pending\" (unclaimed only)"),
    ),
    responses(
        (status = 200, description = "List of requests"),
    ),
    tag = "Analytics"
)]
async fn get_requests(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RequestsQuery>,
) -> impl IntoResponse {
    let wallet = query.wallet.to_lowercase();
    let pending_only = query.status.as_deref() == Some("pending");

    match state.kyc_repo.get_all_requests(&wallet, pending_only).await {
        Ok(events) => Json(serde_json::json!({"requests": events})).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch requests");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}
```

- [ ] **Step 4: Remove `get_requests` from `vouchers.rs`**

In `packages/api/src/routes/vouchers.rs`:

Remove the `/requests` route from the router:

```rust
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/deposits/{request_id}/voucher", get(deposit_voucher))
        .route("/withdrawals/{request_id}/voucher", get(withdrawal_voucher))
}
```

Remove `RequestsQuery` struct (lines 36-42).

Remove the `get_requests` function (lines 352-382).

Update the `VouchersDoc` derive to remove `get_requests` and `RequestsQuery`:

```rust
#[derive(OpenApi)]
#[openapi(
    paths(deposit_voucher, withdrawal_voucher),
    components(schemas(WalletQuery, VoucherResponse)),
    tags(
        (name = "Vouchers", description = "Deposit/withdrawal voucher signing")
    )
)]
pub struct VouchersDoc;
```

- [ ] **Step 5: Register new module in `routes/mod.rs`**

In `packages/api/src/routes/mod.rs`, add the analytics module:

```rust
pub mod analytics;
pub mod emails;
pub mod kyc;
pub mod vouchers;
```

- [ ] **Step 6: Wire up analytics routes in `main.rs`**

In `packages/api/src/main.rs`, add the analytics doc merge and route registration.

Add to the OpenAPI doc merges (after the vouchers merge):

```rust
api_docs.merge(pipeline_api::routes::analytics::AnalyticsDoc::openapi());
```

Add the analytics route registration. Since both vouchers and analytics nest under `/v1`, add after the vouchers line:

```rust
.nest("/v1", pipeline_api::routes::analytics::router())
```

- [ ] **Step 7: Verify it compiles**

Run: `cargo build -p api 2>&1 | tail -20`
Expected: successful build

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routes/analytics.rs packages/api/src/routes/vouchers.rs packages/api/src/routes/mod.rs packages/api/src/main.rs packages/shared/src/kyc_repo.rs
git commit -m "feat(api): extract analytics module, restructure /v1/requests response"
```

---

### Task 6: Build and lint verification

**Files:** None (verification only)

- [ ] **Step 1: Full workspace build**

Run: `cargo build --workspace 2>&1 | tail -30`
Expected: successful build with no errors

- [ ] **Step 2: Run clippy**

Run: `cargo clippy --all -- -D warnings 2>&1 | tail -30`
Expected: no warnings or errors

- [ ] **Step 3: Run tests**

Run: `cargo test --workspace 2>&1 | tail -30`
Expected: all tests pass

- [ ] **Step 4: Fix any issues found and commit**

If any issues are found, fix them and commit:

```bash
git add -A
git commit -m "fix: address clippy/build issues"
```
