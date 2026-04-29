# Whitelist Sync Job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worker job that syncs LP KYC/AML status to the on-chain WhitelistRegistry via `allowUser` / `disallow` calls.

**Architecture:** New `whitelist` module in the worker crate with its own config and job loop. Queries `lp_profiles` for profiles needing allow/disallow, sends transactions via alloy signer, updates DB on success. Follows the same job pattern as `kyc_outbox`.

**Tech Stack:** Rust, sqlx (Postgres), alloy 0.8 (signers, contract calls), tokio

**Spec:** `docs/superpowers/specs/2026-04-29-whitelist-sync-design.md`
**Issue:** #12

---

### Task 1: Database migration — add whitelist columns to `lp_profiles`

**Files:**
- Create: `packages/shared/migrations/20260429000001_whitelist_columns.sql`

- [ ] **Step 1: Create migration file**

Create `packages/shared/migrations/20260429000001_whitelist_columns.sql`:

```sql
ALTER TABLE lp_profiles
    ADD COLUMN is_whitelisted BOOLEAN,
    ADD COLUMN whitelist_reset_at TIMESTAMPTZ;
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/migrations/20260429000001_whitelist_columns.sql
git commit -m "feat: add is_whitelisted and whitelist_reset_at columns to lp_profiles (#12)"
```

---

### Task 2: Add whitelist queries to `KycRepo`

**Files:**
- Modify: `packages/shared/src/kyc_repo.rs`

- [ ] **Step 1: Add `WhitelistCandidate` row type and query methods**

Add the following to the end of `packages/shared/src/kyc_repo.rs` (before the closing `}` of `impl KycRepo`):

```rust
    #[derive(sqlx::FromRow)]
    pub struct WhitelistCandidate {
        pub wallet_address: String,
    }
```

Move this struct definition above the `impl KycRepo` block (next to the other row types like `LpProfile` and `KycOutboxRow`).

Then add these methods inside `impl KycRepo`:

```rust
    pub async fn fetch_profiles_to_allow(&self) -> anyhow::Result<Vec<WhitelistCandidate>> {
        let rows = sqlx::query_as::<_, WhitelistCandidate>(
            "SELECT wallet_address FROM lp_profiles
             WHERE kyc_status = 2
               AND kyc_review_status = 2
               AND aml_status = 2
               AND (is_whitelisted IS NULL OR whitelist_reset_at <= NOW())",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn fetch_profiles_to_disallow(&self) -> anyhow::Result<Vec<WhitelistCandidate>> {
        let rows = sqlx::query_as::<_, WhitelistCandidate>(
            "SELECT wallet_address FROM lp_profiles
             WHERE (is_whitelisted = true OR is_whitelisted IS NULL)
               AND kyc_review_status = 2
               AND (kyc_status != 2 OR aml_status = 3)",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn set_whitelisted(
        &self,
        wallet_address: &str,
        whitelist_reset_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles
             SET is_whitelisted = true, whitelist_reset_at = $2, updated_at = NOW()
             WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .bind(whitelist_reset_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_disallowed(&self, wallet_address: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles
             SET is_whitelisted = false, whitelist_reset_at = NULL, updated_at = NOW()
             WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
```

- [ ] **Step 2: Verify shared package compiles**

Run: `cargo build --package shared 2>&1`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/kyc_repo.rs
git commit -m "feat: add whitelist query methods to KycRepo (#12)"
```

---

### Task 3: Add alloy signer features to workspace

**Files:**
- Modify: `Cargo.toml` (workspace root)

- [ ] **Step 1: Add signer and contract features to alloy**

In the root `Cargo.toml`, update the alloy dependency from:

```toml
alloy             = { version = "0.8", features = ["provider-http", "sol-types", "rpc-types"] }
```

to:

```toml
alloy             = { version = "0.8", features = ["provider-http", "sol-types", "rpc-types", "signers", "signer-local", "contract"] }
```

- [ ] **Step 2: Verify workspace compiles**

Run: `cargo build --workspace 2>&1`
Expected: success (new features are additive).

- [ ] **Step 3: Commit**

```bash
git add Cargo.toml
git commit -m "chore: add alloy signer and contract features (#12)"
```

---

### Task 4: Create whitelist job config

**Files:**
- Create: `packages/worker/src/whitelist/config.rs`
- Create: `packages/worker/src/whitelist/mod.rs`
- Modify: `packages/worker/src/lib.rs`

- [ ] **Step 1: Create config file**

Create `packages/worker/src/whitelist/config.rs`:

```rust
use std::env;

use anyhow::{Context, Result};

pub struct WhitelistJobSettings {
    pub interval_secs: u64,
    pub ttl_secs: u64,
    pub eth_rpc_url: String,
    pub registry_address: String,
    pub signer_key: String,
}

impl WhitelistJobSettings {
    pub fn from_env() -> Result<Self> {
        let prefix = "JOB_WHITELIST_";

        Ok(Self {
            interval_secs: env::var(format!("{prefix}INTERVAL_SECS"))
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            ttl_secs: env::var(format!("{prefix}TTL_SECS"))
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(7_776_000), // 90 days
            eth_rpc_url: env::var(format!("{prefix}ETH_RPC_URL"))
                .with_context(|| format!("{prefix}ETH_RPC_URL is not set"))?,
            registry_address: env::var(format!("{prefix}REGISTRY_ADDRESS"))
                .with_context(|| format!("{prefix}REGISTRY_ADDRESS is not set"))?,
            signer_key: env::var(format!("{prefix}SIGNER_KEY"))
                .with_context(|| format!("{prefix}SIGNER_KEY is not set"))?,
        })
    }
}
```

- [ ] **Step 2: Create module file**

Create `packages/worker/src/whitelist/mod.rs`:

```rust
pub mod config;
pub mod whitelist_sync;
```

- [ ] **Step 3: Register module in lib.rs**

In `packages/worker/src/lib.rs`, add after the existing modules:

```rust
pub mod whitelist;
```

- [ ] **Step 4: Commit**

```bash
git add packages/worker/src/whitelist/ packages/worker/src/lib.rs
git commit -m "feat: add whitelist job config and module structure (#12)"
```

---

### Task 5: Implement whitelist sync job

**Files:**
- Create: `packages/worker/src/whitelist/whitelist_sync.rs`

- [ ] **Step 1: Implement the job**

Create `packages/worker/src/whitelist/whitelist_sync.rs`:

```rust
use std::sync::Arc;
use std::time::Duration;

use alloy::{
    hex,
    network::EthereumWallet,
    primitives::{Address, U256},
    providers::ProviderBuilder,
    signers::local::PrivateKeySigner,
    sol,
};
use anyhow::Result;
use chrono::Utc;

use shared::kyc_repo::KycRepo;

use crate::whitelist::config::WhitelistJobSettings;

sol! {
    #[sol(rpc)]
    contract WhitelistRegistry {
        function allowUser(address user, uint256 until) external;
        function disallow(address who) external;
    }
}

pub async fn run_whitelist_sync_job(
    settings: WhitelistJobSettings,
    kyc_repo: Arc<KycRepo>,
) -> Result<()> {
    let key_bytes = hex::decode(settings.signer_key.trim_start_matches("0x"))?;
    let signer = PrivateKeySigner::from_bytes(&key_bytes.try_into().map_err(|_| {
        anyhow::anyhow!("SIGNER_KEY must be 32 bytes")
    })?)?;
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer))
        .on_http(settings.eth_rpc_url.parse()?);

    let registry_address: Address = settings.registry_address.parse()?;
    let registry = WhitelistRegistry::new(registry_address, &provider);

    tracing::info!(
        interval_secs = settings.interval_secs,
        ttl_secs = settings.ttl_secs,
        registry = %registry_address,
        "whitelist sync job started"
    );

    loop {
        if let Err(e) = process_allows(&kyc_repo, &registry, settings.ttl_secs).await {
            tracing::error!(error = %e, "whitelist allow batch error");
        }
        if let Err(e) = process_disallows(&kyc_repo, &registry).await {
            tracing::error!(error = %e, "whitelist disallow batch error");
        }
        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}

async fn process_allows<P: alloy::providers::Provider + alloy::contract::private::Network<alloy::network::Ethereum>>(
    kyc_repo: &KycRepo,
    registry: &WhitelistRegistry::WhitelistRegistryInstance<P>,
    ttl_secs: u64,
) -> Result<()> {
    let candidates = kyc_repo.fetch_profiles_to_allow().await?;
    if candidates.is_empty() {
        return Ok(());
    }

    tracing::info!(count = candidates.len(), "processing whitelist allows");

    for candidate in candidates {
        let wallet: Address = match candidate.wallet_address.parse() {
            Ok(addr) => addr,
            Err(e) => {
                tracing::error!(wallet = candidate.wallet_address, error = %e, "invalid wallet address — skipping");
                continue;
            }
        };

        let now_utc = Utc::now();
        let until = now_utc.timestamp() as u64 + ttl_secs;
        let reset_at = now_utc + chrono::Duration::seconds(ttl_secs as i64);

        match registry.allowUser(wallet, U256::from(until)).send().await {
            Ok(pending) => {
                match pending.watch().await {
                    Ok(_receipt) => {
                        kyc_repo.set_whitelisted(&candidate.wallet_address, reset_at).await?;
                        tracing::info!(wallet = candidate.wallet_address, until, "allowUser succeeded");
                    }
                    Err(e) => {
                        tracing::error!(wallet = candidate.wallet_address, error = %e, "allowUser tx failed");
                    }
                }
            }
            Err(e) => {
                tracing::error!(wallet = candidate.wallet_address, error = %e, "allowUser send failed");
            }
        }
    }

    Ok(())
}

async fn process_disallows<P: alloy::providers::Provider + alloy::contract::private::Network<alloy::network::Ethereum>>(
    kyc_repo: &KycRepo,
    registry: &WhitelistRegistry::WhitelistRegistryInstance<P>,
) -> Result<()> {
    let candidates = kyc_repo.fetch_profiles_to_disallow().await?;
    if candidates.is_empty() {
        return Ok(());
    }

    tracing::info!(count = candidates.len(), "processing whitelist disallows");

    for candidate in candidates {
        let wallet: Address = match candidate.wallet_address.parse() {
            Ok(addr) => addr,
            Err(e) => {
                tracing::error!(wallet = candidate.wallet_address, error = %e, "invalid wallet address — skipping");
                continue;
            }
        };

        match registry.disallow(wallet).send().await {
            Ok(pending) => {
                match pending.watch().await {
                    Ok(_receipt) => {
                        kyc_repo.set_disallowed(&candidate.wallet_address).await?;
                        tracing::info!(wallet = candidate.wallet_address, "disallow succeeded");
                    }
                    Err(e) => {
                        tracing::error!(wallet = candidate.wallet_address, error = %e, "disallow tx failed");
                    }
                }
            }
            Err(e) => {
                tracing::error!(wallet = candidate.wallet_address, error = %e, "disallow send failed");
            }
        }
    }

    Ok(())
}
```

- [ ] **Step 2: Verify worker package compiles**

Run: `cargo build --package pipeline-worker 2>&1`
Expected: success. If the alloy generic bounds on `process_allows` / `process_disallows` don't compile, adjust the type signatures to use the concrete provider type instead of generics. The concrete type is:

```rust
use alloy::providers::fillers::{FillProvider, ...};
```

If generics don't work, replace the function signatures with concrete `&WhitelistRegistry::WhitelistRegistryInstance<...>` using the actual provider type returned by `ProviderBuilder::new().wallet(...).on_http(...)`. The simplest fix is to inline the provider type or use `impl Provider` if alloy supports it.

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/whitelist/whitelist_sync.rs
git commit -m "feat: implement whitelist sync job with contract calls (#12)"
```

---

### Task 6: Register job in main.rs and update .env.example

**Files:**
- Modify: `packages/worker/src/main.rs`
- Modify: `.env.example`

- [ ] **Step 1: Register whitelist job in main.rs**

Add the following imports at the top of `packages/worker/src/main.rs`:

```rust
use pipeline_worker::whitelist::config::WhitelistJobSettings;
use pipeline_worker::whitelist::whitelist_sync::run_whitelist_sync_job;
```

Add the following block after the KYC job block (before `tokio::signal::ctrl_c().await?`):

```rust
    if env_bool("JOB_WHITELIST_ENABLED") {
        let settings = WhitelistJobSettings::from_env()?;
        let kyc_repo = Arc::new(KycRepo::new(pool.clone()));

        tracing::info!("whitelist sync job started");
        tokio::spawn(async move {
            if let Err(e) = run_whitelist_sync_job(settings, kyc_repo).await {
                tracing::error!("whitelist sync job exited with error: {e:?}");
            }
        });
    }
```

Note: If `KycRepo` is already created for the KYC job above, you can share it by cloning the `Arc`. But since the KYC job block is inside an `if` scope, create a new `Arc<KycRepo>` in the whitelist block — the `PgPool` is cheaply cloneable.

- [ ] **Step 2: Add config vars to .env.example**

Append to `.env.example` after the KYC section:

```
# ── Worker: Whitelist Sync (JOB_WHITELIST_) ───────────────────

JOB_WHITELIST_ENABLED=false
JOB_WHITELIST_INTERVAL_SECS=30                     # optional, default 30
JOB_WHITELIST_TTL_SECS=7776000                     # optional, default 90 days
JOB_WHITELIST_ETH_RPC_URL=https://mainnet.infura.io/v3/<key>
JOB_WHITELIST_REGISTRY_ADDRESS=0x...               # WhitelistRegistry contract address
JOB_WHITELIST_SIGNER_KEY=0x...                     # private key with WHITELIST_ADMIN role
```

- [ ] **Step 3: Run clippy**

Run: `cargo clippy --all -- -D warnings 2>&1`
Expected: no errors or warnings.

- [ ] **Step 4: Run tests**

Run: `cargo test --package pipeline-worker 2>&1`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/main.rs .env.example
git commit -m "feat: register whitelist sync job in main and add env config (#12)"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cargo clippy --all -- -D warnings && cargo test --workspace 2>&1`
Expected: all checks pass.

- [ ] **Step 2: Verify all files are committed**

Run: `git status`
Expected: clean working tree on `feat/whitelist-sync-job` branch.
