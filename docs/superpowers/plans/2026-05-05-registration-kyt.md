# Registration, Optional Sumsub & KYT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wallet registration via signature verification, gate Sumsub endpoints behind registration, make Sumsub optional in the whitelist relayer, and add a KYT stub phase to the relayer loop.

**Architecture:** New `/v1/register` API routes with EIP-191 signature recovery using `alloy`. KycRepo gets `require_sumsub`-aware allow/disallow queries and KYT repo methods. The relayer loop gains a `phase_kyt` step after whitelist_sync. Two new DB columns (`lp_profiles.kyt_status`, `contract_logs.kyt_status`) are added via migration.

**Tech Stack:** Rust, axum, alloy (signers + primitives), sqlx, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-05-05-registration-kyt-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/migrations/2026MMDD_kyt_status.sql` | Create | Add `kyt_status` columns to `lp_profiles` and `contract_logs` |
| `packages/shared/src/kyc_repo.rs` | Modify | Add `require_sumsub` param to allow/disallow queries, add KYT repo methods |
| `packages/shared/Cargo.toml` | Modify | Add `alloy` dependency (for signature recovery) |
| `packages/shared/src/signature.rs` | Create | EIP-191 signature verification utility |
| `packages/shared/src/lib.rs` | Modify | Declare `signature` module |
| `packages/api/src/routes/register.rs` | Create | `GET /nonce` and `POST /` registration endpoints |
| `packages/api/src/routes/mod.rs` | Modify | Declare `register` module |
| `packages/api/src/routes/kyc.rs` | Modify | Add registration gate to `create_applicant` and `create_token` |
| `packages/api/src/main.rs` | Modify | Mount register routes, merge OpenAPI docs |
| `packages/worker/src/relayer/config.rs` | Modify | Add `require_sumsub` field |
| `packages/worker/src/relayer/whitelist_sync.rs` | Modify | Pass `require_sumsub` to repo queries |
| `packages/worker/src/relayer/kyt.rs` | Create | KYT phase with stub verification function |
| `packages/worker/src/relayer/mod.rs` | Modify | Declare `kyt` module |
| `packages/worker/src/relayer/relayer_job.rs` | Modify | Add KYT phase to loop, pass `require_sumsub` and pool |
| `packages/worker/src/main.rs` | Modify | Pass pool to relayer job |
| `.env.example` | Modify | Add `JOB_RELAYER_REQUIRE_SUMSUB` |

---

### Task 1: Database Migration — kyt_status Columns

**Files:**
- Create: `packages/shared/migrations/20260506000001_kyt_status.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE lp_profiles ADD COLUMN kyt_status SMALLINT;
ALTER TABLE contract_logs ADD COLUMN kyt_status SMALLINT;

CREATE INDEX idx_contract_logs_kyt_unverified
    ON contract_logs (id)
    WHERE event_name = 'Transfer' AND kyt_status IS NULL;
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/migrations/20260506000001_kyt_status.sql
git commit -m "feat: add kyt_status columns to lp_profiles and contract_logs"
```

---

### Task 2: EIP-191 Signature Verification Utility

**Files:**
- Create: `packages/shared/src/signature.rs`
- Modify: `packages/shared/src/lib.rs`
- Modify: `packages/shared/Cargo.toml`

- [ ] **Step 1: Add alloy dependency to shared**

In `packages/shared/Cargo.toml`, add:

```toml
alloy             = { workspace = true }
```

- [ ] **Step 2: Create signature verification module**

Create `packages/shared/src/signature.rs`:

```rust
use alloy::primitives::{Address, PrimitiveSignature};
use alloy::signers::Signature;
use anyhow::{Context, Result, bail};

/// Verifies an EIP-191 personal_sign signature.
///
/// Recovers the signer address from the message and signature,
/// then checks it matches the expected address (case-insensitive).
pub fn verify_personal_sign(
    message: &str,
    signature_hex: &str,
    expected_address: &str,
) -> Result<()> {
    let sig_bytes = hex::decode(signature_hex.strip_prefix("0x").unwrap_or(signature_hex))
        .context("invalid hex signature")?;

    if sig_bytes.len() != 65 {
        bail!("signature must be 65 bytes, got {}", sig_bytes.len());
    }

    // EIP-191: "\x19Ethereum Signed Message:\n" + len + message
    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
    let hash = alloy::primitives::keccak256(prefixed.as_bytes());

    let sig = PrimitiveSignature::from_bytes_and_parity(&sig_bytes[..64], sig_bytes[64] as u64)
        .context("invalid signature format")?;

    let recovered = sig
        .recover_address_from_prehash(&hash)
        .context("failed to recover address from signature")?;

    let expected: Address = expected_address
        .parse()
        .context("invalid expected address")?;

    if recovered != expected {
        bail!(
            "signature mismatch: recovered {} but expected {}",
            recovered,
            expected
        );
    }

    Ok(())
}
```

- [ ] **Step 3: Declare the module**

In `packages/shared/src/lib.rs`, add `pub mod signature;` after the existing module declarations.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p shared`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/signature.rs packages/shared/src/lib.rs packages/shared/Cargo.toml
git commit -m "feat: add EIP-191 signature verification utility"
```

---

### Task 3: Registration API Endpoints

**Files:**
- Create: `packages/api/src/routes/register.rs`
- Modify: `packages/api/src/routes/mod.rs`
- Modify: `packages/api/src/main.rs`
- Modify: `packages/api/Cargo.toml`

- [ ] **Step 1: Add uuid dependency to api**

In `packages/api/Cargo.toml`, add:

```toml
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 2: Create the register routes module**

Create `packages/api/src/routes/register.rs`:

```rust
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/nonce", get(get_nonce))
        .route("/", post(register))
}

#[derive(Serialize, ToSchema)]
pub struct NonceResponse {
    pub nonce: String,
    pub message: String,
}

#[derive(Deserialize, ToSchema)]
pub struct RegisterRequest {
    pub wallet_address: String,
    pub signature: String,
    pub nonce: String,
}

#[derive(Serialize, ToSchema)]
pub struct RegisterResponse {
    pub wallet_address: String,
}

fn build_message(nonce: &str) -> String {
    format!("Register for Pipeline\nNonce: {nonce}")
}

#[derive(OpenApi)]
#[openapi(
    paths(get_nonce, register),
    components(schemas(NonceResponse, RegisterRequest, RegisterResponse)),
    tags(
        (name = "Registration", description = "Wallet registration via signature verification")
    )
)]
pub struct ApiDoc;

#[utoipa::path(
    get,
    path = "/v1/register/nonce",
    responses(
        (status = 200, description = "Nonce generated", body = NonceResponse),
    ),
    tag = "Registration"
)]
async fn get_nonce() -> impl IntoResponse {
    let nonce = uuid::Uuid::new_v4().to_string();
    let message = build_message(&nonce);
    Json(NonceResponse { nonce, message })
}

#[utoipa::path(
    post,
    path = "/v1/register",
    request_body = RegisterRequest,
    responses(
        (status = 200, description = "Wallet registered", body = RegisterResponse),
        (status = 400, description = "Invalid signature or address"),
    ),
    tag = "Registration"
)]
async fn register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    let message = build_message(&req.nonce);

    if let Err(e) = shared::signature::verify_personal_sign(
        &message,
        &req.signature,
        &req.wallet_address,
    ) {
        tracing::warn!(
            wallet = req.wallet_address,
            error = %e,
            "signature verification failed"
        );
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid signature"})),
        )
            .into_response();
    }

    let wallet_lower = req.wallet_address.to_lowercase();

    match state.kyc_repo.get_lp_profile(&wallet_lower).await {
        Ok(Some(_)) => {
            return Json(RegisterResponse {
                wallet_address: wallet_lower,
            })
            .into_response();
        }
        Ok(None) => {}
        Err(e) => {
            tracing::error!("failed to get lp_profile: {e:?}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    }

    match state.kyc_repo.create_lp_profile(&wallet_lower).await {
        Ok(_) => Json(RegisterResponse {
            wallet_address: wallet_lower,
        })
        .into_response(),
        Err(e) => {
            tracing::error!("failed to create lp_profile: {e:?}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}
```

- [ ] **Step 3: Declare the module**

In `packages/api/src/routes/mod.rs`, add `pub mod register;` so it reads:

```rust
pub mod emails;
pub mod kyc;
pub mod register;
```

- [ ] **Step 4: Mount the routes and merge OpenAPI docs**

In `packages/api/src/main.rs`, add the register routes. After line 50 (`let mut api_docs = ...`), add:

```rust
    api_docs.merge(pipeline_api::routes::register::ApiDoc::openapi());
```

In the Router builder (after `.nest("/v1/kyc", ...)`), add:

```rust
        .nest("/v1/register", pipeline_api::routes::register::router())
```

- [ ] **Step 5: Verify it compiles**

Run: `cargo check -p pipeline-api`
Expected: compiles without errors

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/register.rs packages/api/src/routes/mod.rs packages/api/src/main.rs packages/api/Cargo.toml
git commit -m "feat: add wallet registration endpoints with signature verification"
```

---

### Task 4: Gate Sumsub Endpoints Behind Registration

**Files:**
- Modify: `packages/api/src/routes/kyc.rs`

- [ ] **Step 1: Add registration gate to create_applicant**

In `packages/api/src/routes/kyc.rs`, in the `create_applicant` function (line 76), replace the existing profile lookup (lines 80-102) with a gate that requires the profile to already exist:

```rust
async fn create_applicant(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateApplicantRequest>,
) -> impl IntoResponse {
    let profile = match state.kyc_repo.get_lp_profile(&req.wallet_address).await {
        Ok(Some(p)) => p,
        Ok(None) => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "wallet not registered — call POST /v1/register first"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!("failed to get lp_profile: {e:?}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    };
```

The rest of the function (from `if let Some(ref applicant_id)` onward) stays the same.

- [ ] **Step 2: Add registration gate to create_token**

In `packages/api/src/routes/kyc.rs`, in the `create_token` function (line 154), add a profile check at the beginning of the function body, right after the `sumsub_settings` check (after line 171):

```rust
    match state.kyc_repo.get_lp_profile(&req.wallet_address).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "wallet not registered — call POST /v1/register first"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!("failed to get lp_profile: {e:?}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    }
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p pipeline-api`
Expected: compiles without errors

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/kyc.rs
git commit -m "feat: gate sumsub endpoints behind wallet registration"
```

---

### Task 5: Optional Sumsub in Relayer Config & Whitelist Queries

**Files:**
- Modify: `packages/worker/src/relayer/config.rs`
- Modify: `packages/shared/src/kyc_repo.rs`
- Modify: `packages/worker/src/relayer/whitelist_sync.rs`
- Modify: `.env.example`

- [ ] **Step 1: Add require_sumsub to RelayerJobSettings**

In `packages/worker/src/relayer/config.rs`, add the field to the struct:

```rust
pub struct RelayerJobSettings {
    // Shared
    pub interval_secs: u64,
    pub eth_rpc_url: String,
    pub chain_id: i64,
    pub signer_key: String,
    // Whitelist phase
    pub registry_address: String,
    pub whitelist_ttl_secs: u64,
    pub require_sumsub: bool,
}
```

And in `from_env()`, add after the `whitelist_ttl_secs` line:

```rust
            require_sumsub: env_parse(&format!("{prefix}REQUIRE_SUMSUB"), true)?,
```

- [ ] **Step 2: Add require_sumsub-aware queries to KycRepo**

In `packages/shared/src/kyc_repo.rs`, replace `fetch_profiles_to_allow` (lines 151-162):

```rust
    pub async fn fetch_profiles_to_allow(
        &self,
        require_sumsub: bool,
    ) -> anyhow::Result<Vec<WhitelistCandidate>> {
        let rows = if require_sumsub {
            sqlx::query_as::<_, WhitelistCandidate>(
                "SELECT wallet_address FROM lp_profiles
                 WHERE kyc_status = 2
                   AND kyc_review_status = 2
                   AND aml_status = 2
                   AND (kyt_status IS NULL OR kyt_status != 2)
                   AND (is_whitelisted IS NULL OR whitelist_reset_at <= NOW())",
            )
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, WhitelistCandidate>(
                "SELECT wallet_address FROM lp_profiles
                 WHERE (kyt_status IS NULL OR kyt_status != 2)
                   AND (is_whitelisted IS NULL OR whitelist_reset_at <= NOW())",
            )
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows)
    }
```

Replace `fetch_profiles_to_disallow` (lines 164-174):

```rust
    pub async fn fetch_profiles_to_disallow(
        &self,
        require_sumsub: bool,
    ) -> anyhow::Result<Vec<WhitelistCandidate>> {
        let rows = if require_sumsub {
            sqlx::query_as::<_, WhitelistCandidate>(
                "SELECT wallet_address FROM lp_profiles
                 WHERE is_whitelisted = true
                   AND (whitelist_reset_at <= NOW()
                        OR kyt_status = 2
                        OR kyc_status != 2
                        OR aml_status = 3)",
            )
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, WhitelistCandidate>(
                "SELECT wallet_address FROM lp_profiles
                 WHERE is_whitelisted = true
                   AND (whitelist_reset_at <= NOW()
                        OR kyt_status = 2)",
            )
            .fetch_all(&self.pool)
            .await?
        };
        Ok(rows)
    }
```

- [ ] **Step 3: Update whitelist_sync to pass require_sumsub**

In `packages/worker/src/relayer/whitelist_sync.rs`, update the `phase_whitelist_sync` signature and its callers:

```rust
pub async fn phase_whitelist_sync<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    ttl_secs: u64,
    require_sumsub: bool,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    process_allows(registry, kyc_repo, ttl_secs, require_sumsub).await;
    process_disallows(registry, kyc_repo, require_sumsub).await;
}
```

Update `process_allows` signature:

```rust
async fn process_allows<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    ttl_secs: u64,
    require_sumsub: bool,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    let candidates = match kyc_repo.fetch_profiles_to_allow(require_sumsub).await {
```

Update `process_disallows` signature:

```rust
async fn process_disallows<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    require_sumsub: bool,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    let candidates = match kyc_repo.fetch_profiles_to_disallow(require_sumsub).await {
```

- [ ] **Step 4: Update relayer_job.rs to pass require_sumsub**

In `packages/worker/src/relayer/relayer_job.rs`, update the loop call (line 45):

```rust
        phase_whitelist_sync(&registry, &kyc_repo, settings.whitelist_ttl_secs, settings.require_sumsub).await;
```

- [ ] **Step 5: Update .env.example**

Add to the relayer section (after `JOB_RELAYER_WHITELIST_TTL_SECS`):

```
JOB_RELAYER_REQUIRE_SUMSUB=true                    # optional, default true — if false, only signature registration required
```

- [ ] **Step 6: Verify it compiles**

Run: `cargo check`
Expected: compiles without errors

- [ ] **Step 7: Commit**

```bash
git add packages/worker/src/relayer/config.rs packages/shared/src/kyc_repo.rs packages/worker/src/relayer/whitelist_sync.rs packages/worker/src/relayer/relayer_job.rs .env.example
git commit -m "feat: make sumsub optional in relayer whitelist sync"
```

---

### Task 6: KYT Phase — Repo Methods

**Files:**
- Modify: `packages/shared/src/kyc_repo.rs`

- [ ] **Step 1: Add KYT-related struct and repo methods**

Add to `packages/shared/src/kyc_repo.rs`, after the `KycOutboxRow` struct:

```rust
#[derive(sqlx::FromRow)]
pub struct UnverifiedTransfer {
    pub id: i64,
    pub sender: Option<String>,
    pub receiver: Option<String>,
    pub amount: Option<bigdecimal::BigDecimal>,
    pub tx_hash: String,
    pub chain_id: i64,
}
```

Add these methods to the `impl KycRepo` block:

```rust
    pub async fn fetch_unverified_transfers(
        &self,
        batch_size: i64,
    ) -> anyhow::Result<Vec<UnverifiedTransfer>> {
        let rows = sqlx::query_as::<_, UnverifiedTransfer>(
            "SELECT id, sender, receiver, amount, tx_hash, chain_id
             FROM contract_logs
             WHERE event_name = 'Transfer' AND kyt_status IS NULL
             ORDER BY id
             LIMIT $1",
        )
        .bind(batch_size)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn set_transfer_kyt_status(
        &self,
        log_id: i64,
        kyt_status: i16,
    ) -> anyhow::Result<()> {
        sqlx::query("UPDATE contract_logs SET kyt_status = $2 WHERE id = $1")
            .bind(log_id)
            .bind(kyt_status)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_profile_kyt_failed(&self, wallet_address: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET kyt_status = 2, updated_at = NOW() WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p shared`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/kyc_repo.rs
git commit -m "feat: add KYT repo methods for transfer verification"
```

---

### Task 7: KYT Phase — Relayer Module

**Files:**
- Create: `packages/worker/src/relayer/kyt.rs`
- Modify: `packages/worker/src/relayer/mod.rs`
- Modify: `packages/worker/src/relayer/relayer_job.rs`
- Modify: `packages/worker/src/main.rs`

- [ ] **Step 1: Create the KYT phase module**

Create `packages/worker/src/relayer/kyt.rs`:

```rust
use shared::kyc_repo::{KycRepo, UnverifiedTransfer};

/// KYT status values for contract_logs.kyt_status and lp_profiles.kyt_status
const KYT_CLEAR: i16 = 1;
const KYT_FAILED: i16 = 2;

const KYT_BATCH_SIZE: i64 = 100;

pub async fn phase_kyt(kyc_repo: &KycRepo) {
    let transfers = match kyc_repo.fetch_unverified_transfers(KYT_BATCH_SIZE).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch unverified transfers");
            return;
        }
    };

    if !transfers.is_empty() {
        tracing::info!(count = transfers.len(), "processing KYT verification");
    }

    for transfer in &transfers {
        let result = verify_transaction(transfer).await;

        let status = if result { KYT_CLEAR } else { KYT_FAILED };

        if let Err(e) = kyc_repo.set_transfer_kyt_status(transfer.id, status).await {
            tracing::error!(log_id = transfer.id, error = %e, "failed to update transfer kyt_status");
            continue;
        }

        if !result {
            if let Some(ref sender) = transfer.sender {
                tracing::warn!(
                    log_id = transfer.id,
                    sender = sender,
                    tx_hash = transfer.tx_hash,
                    "KYT verification failed — marking sender profile"
                );
                if let Err(e) = kyc_repo.set_profile_kyt_failed(sender).await {
                    tracing::error!(sender = sender, error = %e, "failed to set profile kyt_status");
                }
            }
        }
    }
}

/// Verifies a transfer against external KYT/AML service.
///
/// TODO: integrate with external KYT/AML service (provider TBD).
/// TODO: add a new column in contract_logs to store the detailed AML verification result.
async fn verify_transaction(_transfer: &UnverifiedTransfer) -> bool {
    // For now, all transfers pass verification.
    // When the external service is integrated, this function will:
    // 1. Call the KYT provider API with the transaction details
    // 2. Parse the risk score / verdict
    // 3. Return false if the transaction fails AML checks
    true
}
```

- [ ] **Step 2: Declare the kyt module**

In `packages/worker/src/relayer/mod.rs`, add `pub mod kyt;`:

```rust
pub mod config;
pub mod custodian;
pub mod kyt;
pub mod relayer_job;
pub mod whitelist_sync;
```

- [ ] **Step 3: Add KYT phase to the relayer loop**

In `packages/worker/src/relayer/relayer_job.rs`, add the import at the top (after the whitelist_sync import):

```rust
use crate::relayer::kyt::phase_kyt;
```

Update the loop body to add the KYT phase after whitelist sync:

```rust
    loop {
        phase_whitelist_sync(&registry, &kyc_repo, settings.whitelist_ttl_secs, settings.require_sumsub).await;

        phase_kyt(&kyc_repo).await;

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/relayer/kyt.rs packages/worker/src/relayer/mod.rs packages/worker/src/relayer/relayer_job.rs
git commit -m "feat: add KYT phase stub to relayer loop"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run the full check suite**

Run: `cargo clippy --all-targets`
Expected: no warnings or errors

- [ ] **Step 2: Run cargo fmt**

Run: `cargo fmt --all`

- [ ] **Step 3: Run tests**

Run: `cargo nextest run`
Expected: all tests pass

- [ ] **Step 4: Final commit if any formatting changes**

```bash
git add -A
git commit -m "chore: formatting"
```
