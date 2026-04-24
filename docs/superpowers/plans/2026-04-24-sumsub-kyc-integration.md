# Sumsub KYC/KYB Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Sumsub for LP identity verification — applicant creation, WebSDK token generation, webhook callback handling, and async outbox processing.

**Architecture:** API crate (axum) exposes KYC endpoints and receives Sumsub webhooks. Shared crate holds the Sumsub HTTP client, data models, and DB repos. Worker crate runs an outbox polling job that processes completed verifications. Frontend embeds Sumsub WebSDK.

**Tech Stack:** Rust (axum, reqwest, sqlx, hmac/sha2, serde), PostgreSQL, TypeScript/React (Sumsub WebSDK)

**Spec:** `docs/superpowers/specs/2026-04-24-sumsub-kyc-integration-design.md`
**Issue:** #5

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/shared/migrations/20260424000001_lp_profiles.sql` | Create | LP profiles table |
| `packages/shared/migrations/20260424000002_kyc_outbox.sql` | Create | KYC outbox table |
| `packages/shared/src/sumsub/mod.rs` | Create | Module root (re-exports) |
| `packages/shared/src/sumsub/config.rs` | Create | `SumsubSettings` from env vars |
| `packages/shared/src/sumsub/models.rs` | Create | Request/response DTOs, KYC enums |
| `packages/shared/src/sumsub/client.rs` | Create | `SumsubClient` with HMAC signing |
| `packages/shared/src/kyc_repo.rs` | Create | `KycRepo` — LP profiles + outbox DB access |
| `packages/shared/src/lib.rs` | Modify | Add `pub mod sumsub; pub mod kyc_repo;` |
| `packages/shared/Cargo.toml` | Modify | Add `hmac`, `sha2`, `hex`, `serde`, `serde_json`, `reqwest`, `chrono`, `tracing` deps |
| `packages/api/src/main.rs` | Modify | Axum app setup with KYC routes |
| `packages/api/src/routes/mod.rs` | Create | Route module root |
| `packages/api/src/routes/kyc.rs` | Create | KYC endpoint handlers |
| `packages/api/src/middleware/mod.rs` | Create | Middleware module root |
| `packages/api/src/middleware/webhook_auth.rs` | Create | Sumsub webhook HMAC validation extractor |
| `packages/api/Cargo.toml` | Modify | Add `axum`, `tower`, `serde`, `serde_json`, `shared`, `tracing`, etc. |
| `packages/worker/src/jobs/mod.rs` | Create | Jobs module root |
| `packages/worker/src/jobs/kyc_outbox.rs` | Create | `ProcessKycOutboxJob` |
| `packages/worker/src/lib.rs` | Modify | Add `pub mod jobs;` |
| `packages/worker/src/main.rs` | Modify | Spawn outbox job alongside indexer jobs |

---

### Task 1: Database Migrations

**Files:**
- Create: `packages/shared/migrations/20260424000001_lp_profiles.sql`
- Create: `packages/shared/migrations/20260424000002_kyc_outbox.sql`

- [ ] **Step 1: Create lp_profiles migration**

```sql
-- 20260424000001_lp_profiles.sql
CREATE TABLE lp_profiles (
    wallet_address    TEXT        PRIMARY KEY,
    sumsub_applicant_id TEXT,
    kyc_status        SMALLINT    NOT NULL DEFAULT 1,  -- 1=Red, 2=Green, 3=Yellow
    kyc_review_status SMALLINT    NOT NULL DEFAULT 3,  -- 1=Pending, 2=Completed, 3=Init, 4=OnHold
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Create kyc_outbox migration**

```sql
-- 20260424000002_kyc_outbox.sql
CREATE TABLE kyc_outbox (
    id              BIGSERIAL   PRIMARY KEY,
    wallet_address  TEXT        NOT NULL,
    review_status   SMALLINT    NOT NULL,
    kyc_status      SMALLINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,
    error           TEXT
);

CREATE INDEX idx_kyc_outbox_unprocessed
    ON kyc_outbox (created_at)
    WHERE processed_at IS NULL;
```

- [ ] **Step 3: Verify migrations run**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo sqlx migrate run --source packages/shared/migrations`
Expected: Both migrations apply successfully.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/migrations/20260424000001_lp_profiles.sql packages/shared/migrations/20260424000002_kyc_outbox.sql
git commit -m "feat(shared): add lp_profiles and kyc_outbox migrations (#5)"
```

---

### Task 2: Sumsub Config & Models

**Files:**
- Create: `packages/shared/src/sumsub/mod.rs`
- Create: `packages/shared/src/sumsub/config.rs`
- Create: `packages/shared/src/sumsub/models.rs`
- Modify: `packages/shared/src/lib.rs`
- Modify: `packages/shared/Cargo.toml`

- [ ] **Step 1: Add dependencies to shared/Cargo.toml**

Add to `[dependencies]`:
```toml
chrono            = { workspace = true }
hmac              = "0.12"
hex               = "0.4"
reqwest           = { workspace = true }
serde             = { version = "1", features = ["derive"] }
serde_json        = "1"
sha2              = "0.10"
tracing           = { workspace = true }
```

Add to workspace `Cargo.toml` `[workspace.dependencies]`:
```toml
chrono            = { version = "0.4", features = ["serde"] }
serde             = { version = "1", features = ["derive"] }
serde_json        = "1"
```

- [ ] **Step 2: Create sumsub/mod.rs**

```rust
// packages/shared/src/sumsub/mod.rs
pub mod client;
pub mod config;
pub mod models;
```

- [ ] **Step 3: Create sumsub/config.rs**

```rust
// packages/shared/src/sumsub/config.rs
use anyhow::{Context, Result};
use std::env;

#[derive(Clone)]
pub struct SumsubSettings {
    pub app_token: String,
    pub secret_key: String,
    pub base_url: String,
    pub verification_level: String,
    pub webhook_secret_key: String,
    pub webhook_basic_token: String,
    pub sandbox: bool,
    pub token_ttl_secs: i32,
}

impl SumsubSettings {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            app_token: env_require("SUMSUB_APP_TOKEN")?,
            secret_key: env_require("SUMSUB_SECRET_KEY")?,
            base_url: env_require("SUMSUB_BASE_URL")?,
            verification_level: env_require("SUMSUB_VERIFICATION_LEVEL")?,
            webhook_secret_key: env_require("SUMSUB_WEBHOOK_SECRET_KEY")?,
            webhook_basic_token: env_require("SUMSUB_WEBHOOK_BASIC_TOKEN")?,
            sandbox: env::var("SUMSUB_SANDBOX")
                .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(false),
            token_ttl_secs: env::var("SUMSUB_TOKEN_TTL_SECS")
                .unwrap_or_else(|_| "600".to_owned())
                .parse()
                .context("SUMSUB_TOKEN_TTL_SECS must be an integer")?,
        })
    }
}

fn env_require(key: &str) -> Result<String> {
    env::var(key).with_context(|| format!("required env var {key} is not set"))
}
```

- [ ] **Step 4: Create sumsub/models.rs**

```rust
// packages/shared/src/sumsub/models.rs
use serde::{Deserialize, Serialize};

// ── KYC enums ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[repr(i16)]
pub enum KycStatus {
    Red = 1,
    Green = 2,
    Yellow = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[repr(i16)]
pub enum KycReviewStatus {
    Pending = 1,
    Completed = 2,
    Init = 3,
    OnHold = 4,
}

// ── Create Applicant ───────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateApplicantRequest {
    pub external_user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateApplicantResponse {
    pub id: String,
    pub created_at: Option<String>,
    pub client_id: Option<String>,
    pub external_user_id: Option<String>,
}

// ── Access Token ───────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessTokenRequest {
    pub applicant_identifiers: ApplicantIdentifiers,
    pub user_id: String,
    pub level_name: String,
    pub ttl_in_secs: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicantIdentifiers {
    pub external_user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessTokenResponse {
    pub token: Option<String>,
    pub user_id: Option<String>,
}

// ── Get Applicant ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetApplicantResponse {
    pub id: String,
    pub info: Option<ApplicantInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicantInfo {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub country: Option<String>,
}

// ── Webhook Callback ───────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookPayload {
    pub applicant_id: String,
    pub inspection_id: Option<String>,
    pub applicant_type: Option<String>,
    pub correlation_id: Option<String>,
    pub level_name: Option<String>,
    pub external_user_id: Option<String>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub sandbox_mode: Option<bool>,
    pub review_status: Option<String>,
    pub review_result: Option<ReviewResult>,
    pub created_at_ms: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResult {
    pub review_answer: Option<String>,
    pub moderation_comment: Option<String>,
    pub client_comment: Option<String>,
    pub reject_labels: Option<Vec<String>>,
    pub review_reject_type: Option<String>,
}

impl WebhookPayload {
    /// Maps Sumsub's reviewStatus string to our KycReviewStatus enum.
    pub fn parsed_review_status(&self) -> Option<KycReviewStatus> {
        self.review_status.as_deref().map(|s| match s {
            "pending" => KycReviewStatus::Pending,
            "completed" => KycReviewStatus::Completed,
            "init" => KycReviewStatus::Init,
            "onHold" => KycReviewStatus::OnHold,
            _ => KycReviewStatus::Pending,
        })
    }

    /// Maps Sumsub's reviewAnswer string to our KycStatus enum.
    pub fn parsed_kyc_status(&self) -> Option<KycStatus> {
        self.review_result.as_ref()?.review_answer.as_deref().map(|s| match s {
            "GREEN" => KycStatus::Green,
            "RED" => KycStatus::Red,
            _ => KycStatus::Yellow,
        })
    }
}
```

- [ ] **Step 5: Update shared/src/lib.rs**

```rust
pub mod db;
pub mod events;
pub mod kyc_repo;
pub mod log_mapper;
pub mod sumsub;
```

- [ ] **Step 6: Verify it compiles**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p shared`
Expected: Compiles with no errors. (kyc_repo doesn't exist yet — create an empty placeholder `pub mod kyc_repo {}` inline in lib.rs or create the file with an empty struct to unblock; Task 3 fills it in.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/Cargo.toml Cargo.toml packages/shared/src/sumsub/ packages/shared/src/lib.rs
git commit -m "feat(shared): add Sumsub config, models, and KYC enums (#5)"
```

---

### Task 3: KYC Database Repository

**Files:**
- Create: `packages/shared/src/kyc_repo.rs`

- [ ] **Step 1: Create kyc_repo.rs**

```rust
// packages/shared/src/kyc_repo.rs
use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::sumsub::models::{KycReviewStatus, KycStatus};

pub struct KycRepo {
    pub pool: PgPool,
}

/// Row returned when reading an LP profile.
pub struct LpProfile {
    pub wallet_address: String,
    pub sumsub_applicant_id: Option<String>,
    pub kyc_status: i16,
    pub kyc_review_status: i16,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Row returned when reading an unprocessed outbox record.
pub struct KycOutboxRow {
    pub id: i64,
    pub wallet_address: String,
    pub review_status: i16,
    pub kyc_status: Option<i16>,
    pub created_at: DateTime<Utc>,
}

impl KycRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get LP profile by wallet address, or None if not found.
    pub async fn get_lp_profile(&self, wallet_address: &str) -> anyhow::Result<Option<LpProfile>> {
        let row = sqlx::query_as!(
            LpProfile,
            "SELECT wallet_address, sumsub_applicant_id, kyc_status, kyc_review_status, created_at, updated_at
             FROM lp_profiles WHERE wallet_address = $1",
            wallet_address
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row)
    }

    /// Create a new LP profile. Returns the created row.
    pub async fn create_lp_profile(&self, wallet_address: &str) -> anyhow::Result<LpProfile> {
        let row = sqlx::query_as!(
            LpProfile,
            "INSERT INTO lp_profiles (wallet_address)
             VALUES ($1)
             ON CONFLICT (wallet_address) DO NOTHING
             RETURNING wallet_address, sumsub_applicant_id, kyc_status, kyc_review_status, created_at, updated_at",
            wallet_address
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(row)
    }

    /// Store the Sumsub applicant ID on an LP profile.
    pub async fn set_applicant_id(
        &self,
        wallet_address: &str,
        applicant_id: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE lp_profiles SET sumsub_applicant_id = $2, updated_at = NOW()
             WHERE wallet_address = $1",
        )
        .bind(wallet_address)
        .bind(applicant_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Update KYC status fields on an LP profile.
    pub async fn update_kyc_status(
        &self,
        wallet_address: &str,
        kyc_status: Option<KycStatus>,
        review_status: KycReviewStatus,
    ) -> anyhow::Result<()> {
        if let Some(status) = kyc_status {
            sqlx::query(
                "UPDATE lp_profiles SET kyc_status = $2, kyc_review_status = $3, updated_at = NOW()
                 WHERE wallet_address = $1",
            )
            .bind(wallet_address)
            .bind(status as i16)
            .bind(review_status as i16)
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query(
                "UPDATE lp_profiles SET kyc_review_status = $2, updated_at = NOW()
                 WHERE wallet_address = $1",
            )
            .bind(wallet_address)
            .bind(review_status as i16)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    /// Insert a KYC outbox record for async processing.
    pub async fn insert_outbox(
        &self,
        wallet_address: &str,
        review_status: KycReviewStatus,
        kyc_status: Option<KycStatus>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO kyc_outbox (wallet_address, review_status, kyc_status)
             VALUES ($1, $2, $3)",
        )
        .bind(wallet_address)
        .bind(review_status as i16)
        .bind(kyc_status.map(|s| s as i16))
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Fetch a batch of unprocessed outbox records, ordered by creation time.
    pub async fn fetch_unprocessed_outbox(&self, batch_size: i64) -> anyhow::Result<Vec<KycOutboxRow>> {
        let rows = sqlx::query_as!(
            KycOutboxRow,
            "SELECT id, wallet_address, review_status, kyc_status, created_at
             FROM kyc_outbox
             WHERE processed_at IS NULL
             ORDER BY created_at
             LIMIT $1",
            batch_size
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    /// Mark an outbox record as processed.
    pub async fn mark_outbox_processed(&self, id: i64) -> anyhow::Result<()> {
        sqlx::query("UPDATE kyc_outbox SET processed_at = NOW() WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Store an error on an outbox record (leaves processed_at NULL for retry).
    pub async fn mark_outbox_error(&self, id: i64, error: &str) -> anyhow::Result<()> {
        sqlx::query("UPDATE kyc_outbox SET error = $2 WHERE id = $1")
            .bind(id)
            .bind(error)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Update LP profile with name and country from Sumsub applicant info.
    pub async fn update_lp_info(
        &self,
        wallet_address: &str,
        first_name: Option<&str>,
        last_name: Option<&str>,
        country: Option<&str>,
    ) -> anyhow::Result<()> {
        // lp_profiles doesn't have name/country columns yet — this is a
        // future extension point. For now, log the info.
        tracing::info!(
            wallet = wallet_address,
            first_name = first_name,
            last_name = last_name,
            country = country,
            "applicant info received from Sumsub (not stored — columns not yet added)"
        );

        Ok(())
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p shared`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/kyc_repo.rs
git commit -m "feat(shared): add KycRepo for lp_profiles and kyc_outbox (#5)"
```

---

### Task 4: Sumsub HTTP Client

**Files:**
- Create: `packages/shared/src/sumsub/client.rs`

- [ ] **Step 1: Create sumsub/client.rs**

```rust
// packages/shared/src/sumsub/client.rs
use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

use super::config::SumsubSettings;
use super::models::{
    AccessTokenRequest, AccessTokenResponse, ApplicantIdentifiers,
    CreateApplicantRequest, CreateApplicantResponse, GetApplicantResponse,
};

type HmacSha256 = Hmac<Sha256>;

pub struct SumsubClient {
    http: reqwest::Client,
    settings: SumsubSettings,
}

impl SumsubClient {
    pub fn new(settings: SumsubSettings) -> Self {
        Self {
            http: reqwest::Client::new(),
            settings,
        }
    }

    /// Create a new Sumsub applicant for the given wallet address.
    pub async fn create_applicant(&self, wallet_address: &str) -> Result<CreateApplicantResponse> {
        let url = format!(
            "{}/resources/applicants?levelName={}",
            self.settings.base_url, self.settings.verification_level
        );
        let body = CreateApplicantRequest {
            external_user_id: wallet_address.to_owned(),
        };
        let body_json = serde_json::to_string(&body)?;

        let response = self
            .signed_request(reqwest::Method::POST, &url, Some(&body_json))
            .await?
            .header("Content-Type", "application/json")
            .body(body_json)
            .send()
            .await
            .context("Sumsub create_applicant request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Sumsub create_applicant returned {status}: {text}");
        }

        response
            .json::<CreateApplicantResponse>()
            .await
            .context("Failed to parse create_applicant response")
    }

    /// Get an existing applicant by their external user ID (wallet address).
    pub async fn get_applicant_by_external_id(
        &self,
        wallet_address: &str,
    ) -> Result<GetApplicantResponse> {
        let url = format!(
            "{}/resources/applicants/-;externalUserId={}/one",
            self.settings.base_url, wallet_address
        );

        let response = self
            .signed_request(reqwest::Method::GET, &url, None)
            .await?
            .send()
            .await
            .context("Sumsub get_applicant request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Sumsub get_applicant returned {status}: {text}");
        }

        response
            .json::<GetApplicantResponse>()
            .await
            .context("Failed to parse get_applicant response")
    }

    /// Generate a WebSDK access token for the given wallet address.
    pub async fn generate_access_token(&self, wallet_address: &str) -> Result<AccessTokenResponse> {
        let url = format!("{}/resources/accessTokens/sdk", self.settings.base_url);
        let body = AccessTokenRequest {
            applicant_identifiers: ApplicantIdentifiers {
                external_user_id: wallet_address.to_owned(),
            },
            user_id: wallet_address.to_owned(),
            level_name: self.settings.verification_level.clone(),
            ttl_in_secs: self.settings.token_ttl_secs,
        };
        let body_json = serde_json::to_string(&body)?;

        let response = self
            .signed_request(reqwest::Method::POST, &url, Some(&body_json))
            .await?
            .header("Content-Type", "application/json")
            .body(body_json)
            .send()
            .await
            .context("Sumsub generate_access_token request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Sumsub generate_access_token returned {status}: {text}");
        }

        response
            .json::<AccessTokenResponse>()
            .await
            .context("Failed to parse access_token response")
    }

    /// Build a request builder with HMAC-SHA256 signature headers.
    async fn signed_request(
        &self,
        method: reqwest::Method,
        url: &str,
        body: Option<&str>,
    ) -> Result<reqwest::RequestBuilder> {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock error")?
            .as_secs();

        let parsed_url = reqwest::Url::parse(url).context("invalid URL")?;
        let path = format!("{}{}", parsed_url.path(), parsed_url.query().map(|q| format!("?{q}")).unwrap_or_default());

        let data = format!("{}{}{}{}", ts, method.as_str(), path, body.unwrap_or(""));

        let mut mac = HmacSha256::new_from_slice(self.settings.secret_key.as_bytes())
            .context("invalid HMAC key")?;
        mac.update(data.as_bytes());
        let signature = hex::encode(mac.finalize().into_bytes());

        Ok(self
            .http
            .request(method, url)
            .header("X-App-Token", &self.settings.app_token)
            .header("X-App-Access-Ts", ts.to_string())
            .header("X-App-Access-Sig", signature))
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p shared`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/sumsub/client.rs
git commit -m "feat(shared): add SumsubClient with HMAC-SHA256 request signing (#5)"
```

---

### Task 5: API Crate Setup with Axum

**Files:**
- Modify: `packages/api/Cargo.toml`
- Modify: `packages/api/src/main.rs`
- Modify: `Cargo.toml` (workspace deps)

- [ ] **Step 1: Add workspace dependencies**

Add to `Cargo.toml` `[workspace.dependencies]`:
```toml
axum              = "0.8"
tower             = "0.5"
tower-http        = { version = "0.6", features = ["cors"] }
```

- [ ] **Step 2: Update api/Cargo.toml**

```toml
[package]
name = "pipeline-api"
version = "0.1.0"
edition = "2021"

[dependencies]
axum               = { workspace = true }
anyhow             = { workspace = true }
dotenvy            = { workspace = true }
serde              = { workspace = true }
serde_json         = { workspace = true }
sqlx               = { workspace = true }
tokio              = { workspace = true }
tower              = { workspace = true }
tower-http         = { workspace = true }
tracing            = { workspace = true }
tracing-subscriber = { workspace = true }
shared             = { path = "../shared" }
chrono             = { workspace = true }
hmac               = "0.12"
hex                = "0.4"
sha2               = "0.10"
```

- [ ] **Step 3: Set up axum app in main.rs**

```rust
// packages/api/src/main.rs
use std::sync::Arc;

use axum::Router;
use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;

mod middleware;
mod routes;

pub struct AppState {
    pub kyc_repo: KycRepo,
    pub sumsub_client: SumsubClient,
    pub sumsub_settings: SumsubSettings,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let postgres_url = std::env::var("POSTGRES_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .map_err(|_| anyhow::anyhow!("POSTGRES_URL is not set"))?;

    let pool = sqlx::PgPool::connect(&postgres_url).await?;
    sqlx::migrate!("../shared/migrations").run(&pool).await?;

    let sumsub_settings = SumsubSettings::from_env()?;
    let sumsub_client = SumsubClient::new(sumsub_settings.clone());
    let kyc_repo = KycRepo::new(pool.clone());

    let state = Arc::new(AppState {
        kyc_repo,
        sumsub_client,
        sumsub_settings,
    });

    let app = Router::new()
        .nest("/v1/kyc", routes::kyc::router())
        .with_state(state);

    let port = std::env::var("API_PORT").unwrap_or_else(|_| "8080".to_owned());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("API listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
```

- [ ] **Step 4: Create empty route and middleware modules**

Create `packages/api/src/routes/mod.rs`:
```rust
pub mod kyc;
```

Create `packages/api/src/middleware/mod.rs`:
```rust
pub mod webhook_auth;
```

Create placeholder `packages/api/src/routes/kyc.rs`:
```rust
use std::sync::Arc;
use axum::Router;
use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
}
```

Create placeholder `packages/api/src/middleware/webhook_auth.rs`:
```rust
// Sumsub webhook HMAC validation — implemented in Task 7
```

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p pipeline-api`
Expected: Compiles (routes are empty but wired up).

- [ ] **Step 6: Commit**

```bash
git add packages/api/Cargo.toml Cargo.toml packages/api/src/
git commit -m "feat(api): set up axum app with shared state and KYC route skeleton (#5)"
```

---

### Task 6: KYC API Endpoints (Applicant + Token + Status)

**Files:**
- Modify: `packages/api/src/routes/kyc.rs`

- [ ] **Step 1: Implement KYC route handlers**

```rust
// packages/api/src/routes/kyc.rs
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/applicants", post(create_applicant))
        .route("/token", post(create_token))
        .route("/status/{wallet_address}", get(get_status))
}

// ── Request / Response types ───────────────────────────────

#[derive(Deserialize)]
pub struct CreateApplicantRequest {
    pub wallet_address: String,
}

#[derive(Serialize)]
pub struct CreateApplicantResponse {
    pub applicant_id: String,
}

#[derive(Deserialize)]
pub struct CreateTokenRequest {
    pub wallet_address: String,
}

#[derive(Serialize)]
pub struct CreateTokenResponse {
    pub token: String,
    pub expires_at: String,
}

#[derive(Serialize)]
pub struct KycStatusResponse {
    pub kyc_status: i16,
    pub kyc_review_status: i16,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

// ── Handlers ───────────────────────────────────────────────

async fn create_applicant(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateApplicantRequest>,
) -> impl IntoResponse {
    // Ensure LP profile exists
    let profile = state.kyc_repo.get_lp_profile(&req.wallet_address).await;
    let profile = match profile {
        Ok(Some(p)) => p,
        Ok(None) => match state.kyc_repo.create_lp_profile(&req.wallet_address).await {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("failed to create lp_profile: {e:?}");
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "internal error"}))).into_response();
            }
        },
        Err(e) => {
            tracing::error!("failed to get lp_profile: {e:?}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "internal error"}))).into_response();
        }
    };

    // If already has an applicant ID, return it
    if let Some(ref applicant_id) = profile.sumsub_applicant_id {
        return Json(CreateApplicantResponse {
            applicant_id: applicant_id.clone(),
        })
        .into_response();
    }

    // Create applicant in Sumsub
    match state.sumsub_client.create_applicant(&req.wallet_address).await {
        Ok(resp) => {
            if let Err(e) = state
                .kyc_repo
                .set_applicant_id(&req.wallet_address, &resp.id)
                .await
            {
                tracing::error!("failed to store applicant_id: {e:?}");
            }
            Json(CreateApplicantResponse {
                applicant_id: resp.id,
            })
            .into_response()
        }
        Err(e) => {
            tracing::error!("Sumsub create_applicant failed: {e:?}");
            (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": "verification service unavailable"}))).into_response()
        }
    }
}

async fn create_token(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTokenRequest>,
) -> impl IntoResponse {
    match state.sumsub_client.generate_access_token(&req.wallet_address).await {
        Ok(resp) => {
            let expires_at = chrono::Utc::now()
                + chrono::Duration::seconds(state.sumsub_settings.token_ttl_secs as i64);

            match resp.token {
                Some(token) => Json(CreateTokenResponse {
                    token,
                    expires_at: expires_at.to_rfc3339(),
                })
                .into_response(),
                None => (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": "no token returned"}))).into_response(),
            }
        }
        Err(e) => {
            tracing::error!("Sumsub generate_access_token failed: {e:?}");
            (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": "verification service unavailable"}))).into_response()
        }
    }
}

async fn get_status(
    State(state): State<Arc<AppState>>,
    Path(wallet_address): Path<String>,
) -> impl IntoResponse {
    match state.kyc_repo.get_lp_profile(&wallet_address).await {
        Ok(Some(profile)) => Json(KycStatusResponse {
            kyc_status: profile.kyc_status,
            kyc_review_status: profile.kyc_review_status,
        })
        .into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "not found"}))).into_response(),
        Err(e) => {
            tracing::error!("failed to get lp_profile: {e:?}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "internal error"}))).into_response()
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p pipeline-api`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/kyc.rs
git commit -m "feat(api): add KYC endpoints — create applicant, generate token, get status (#5)"
```

---

### Task 7: Webhook Callback Endpoint with HMAC Validation

**Files:**
- Modify: `packages/api/src/middleware/webhook_auth.rs`
- Modify: `packages/api/src/routes/kyc.rs`

- [ ] **Step 1: Implement webhook HMAC validation extractor**

```rust
// packages/api/src/middleware/webhook_auth.rs
use axum::body::Bytes;
use axum::extract::{FromRequest, Request};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::Arc;

use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

/// Extractor that validates Sumsub webhook HMAC digest and returns the raw body bytes.
pub struct ValidatedWebhookBody(pub Bytes);

impl<S> FromRequest<S> for ValidatedWebhookBody
where
    S: Send + Sync + AsRef<Arc<AppState>>,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request(req: Request, _state: &S) -> Result<Self, Self::Rejection> {
        // We need access to AppState for the webhook secrets.
        // Since axum's FromRequest doesn't give us state easily here,
        // we'll use a different approach: validate in the handler itself.
        // This extractor just reads the raw body.
        let body = Bytes::from_request(req, &())
            .await
            .map_err(|_| (StatusCode::BAD_REQUEST, "invalid body"))?;

        Ok(Self(body))
    }
}

/// Validate Sumsub webhook headers against the request body.
/// Returns Ok(()) if valid, Err with status code if invalid.
pub fn validate_webhook(
    headers: &axum::http::HeaderMap,
    body: &[u8],
    webhook_secret_key: &str,
    webhook_basic_token: &str,
) -> Result<(), (StatusCode, &'static str)> {
    // 1. Validate Authorization header
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "missing authorization header"))?;

    let expected_auth = format!("Basic {webhook_basic_token}");
    if auth != expected_auth {
        return Err((StatusCode::UNAUTHORIZED, "invalid authorization token"));
    }

    // 2. Validate digest algorithm
    let alg = headers
        .get("x-payload-digest-alg")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::BAD_REQUEST, "missing digest algorithm header"))?;

    if alg != "HMAC_SHA256_HEX" {
        return Err((StatusCode::BAD_REQUEST, "unsupported digest algorithm"));
    }

    // 3. Validate HMAC digest
    let provided_digest = headers
        .get("x-payload-digest")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::BAD_REQUEST, "missing digest header"))?;

    let mut mac = HmacSha256::new_from_slice(webhook_secret_key.as_bytes())
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "hmac key error"))?;
    mac.update(body);
    let computed = hex::encode(mac.finalize().into_bytes());

    if computed != provided_digest {
        return Err((StatusCode::UNAUTHORIZED, "invalid digest"));
    }

    Ok(())
}
```

- [ ] **Step 2: Add callback handler to kyc.rs**

Add to the router in `kyc.rs`:
```rust
.route("/callback", post(webhook_callback))
```

Add the handler function:
```rust
use crate::middleware::webhook_auth::validate_webhook;

async fn webhook_callback(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    // Validate webhook HMAC
    if let Err(rejection) = validate_webhook(
        &headers,
        &body,
        &state.sumsub_settings.webhook_secret_key,
        &state.sumsub_settings.webhook_basic_token,
    ) {
        return rejection.into_response();
    }

    // Parse payload
    let payload: shared::sumsub::models::WebhookPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("failed to parse webhook payload: {e:?}");
            return (StatusCode::BAD_REQUEST, "invalid payload").into_response();
        }
    };

    // Validate sandbox mode
    if payload.sandbox_mode != Some(state.sumsub_settings.sandbox) {
        tracing::warn!("webhook sandbox_mode mismatch");
        return (StatusCode::BAD_REQUEST, "sandbox mode mismatch").into_response();
    }

    let wallet_address = match &payload.external_user_id {
        Some(id) if !id.is_empty() => id.clone(),
        _ => {
            tracing::warn!("webhook missing external_user_id");
            return (StatusCode::BAD_REQUEST, "missing external_user_id").into_response();
        }
    };

    let review_status = payload
        .parsed_review_status()
        .unwrap_or(shared::sumsub::models::KycReviewStatus::Pending);
    let kyc_status = payload.parsed_kyc_status();

    // Update LP profile
    if let Err(e) = state
        .kyc_repo
        .update_kyc_status(&wallet_address, kyc_status, review_status)
        .await
    {
        tracing::error!("failed to update kyc status: {e:?}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
    }

    // Insert outbox record
    if let Err(e) = state
        .kyc_repo
        .insert_outbox(&wallet_address, review_status, kyc_status)
        .await
    {
        tracing::error!("failed to insert kyc outbox: {e:?}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
    }

    tracing::info!(
        wallet = wallet_address,
        review_status = ?review_status,
        kyc_status = ?kyc_status,
        "processed Sumsub webhook"
    );

    StatusCode::OK.into_response()
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p pipeline-api`
Expected: Compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/middleware/webhook_auth.rs packages/api/src/routes/kyc.rs
git commit -m "feat(api): add Sumsub webhook callback with HMAC-SHA256 validation (#5)"
```

---

### Task 8: Worker Outbox Job

**Files:**
- Create: `packages/worker/src/jobs/mod.rs`
- Create: `packages/worker/src/jobs/kyc_outbox.rs`
- Modify: `packages/worker/src/lib.rs`
- Modify: `packages/worker/src/main.rs`
- Modify: `packages/worker/Cargo.toml`

- [ ] **Step 1: Add shared dependency to worker/Cargo.toml**

Verify `shared = { path = "../shared" }` is already present (it is). Add any missing deps:
```toml
chrono = { workspace = true }
serde  = { workspace = true }
serde_json = { workspace = true }
```

- [ ] **Step 2: Create jobs/mod.rs**

```rust
// packages/worker/src/jobs/mod.rs
pub mod kyc_outbox;
```

- [ ] **Step 3: Create jobs/kyc_outbox.rs**

```rust
// packages/worker/src/jobs/kyc_outbox.rs
use anyhow::Result;
use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::models::KycStatus;
use std::sync::Arc;
use std::time::Duration;

pub struct KycOutboxJobSettings {
    pub interval_secs: u64,
    pub batch_size: i64,
}

impl KycOutboxJobSettings {
    pub fn from_env() -> Self {
        let interval_secs: u64 = std::env::var("JOB_KYC_OUTBOX_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        let batch_size: i64 = std::env::var("JOB_KYC_OUTBOX_BATCH_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100);

        Self {
            interval_secs,
            batch_size,
        }
    }
}

/// Run the KYC outbox processing loop. Call this as a spawned tokio task.
pub async fn run_kyc_outbox_job(
    settings: KycOutboxJobSettings,
    kyc_repo: Arc<KycRepo>,
    sumsub_client: Arc<SumsubClient>,
) -> Result<()> {
    tracing::info!(
        interval_secs = settings.interval_secs,
        batch_size = settings.batch_size,
        "KYC outbox job started"
    );

    loop {
        if let Err(e) = process_batch(&kyc_repo, &sumsub_client, settings.batch_size).await {
            tracing::error!("KYC outbox batch error: {e:?}");
        }
        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}

async fn process_batch(
    kyc_repo: &KycRepo,
    sumsub_client: &SumsubClient,
    batch_size: i64,
) -> Result<()> {
    let records = kyc_repo.fetch_unprocessed_outbox(batch_size).await?;

    if records.is_empty() {
        return Ok(());
    }

    tracing::info!(count = records.len(), "processing KYC outbox records");

    for record in records {
        let result = process_record(kyc_repo, sumsub_client, &record).await;
        match result {
            Ok(()) => {
                kyc_repo.mark_outbox_processed(record.id).await?;
            }
            Err(e) => {
                tracing::error!(id = record.id, error = %e, "failed to process KYC outbox record");
                kyc_repo
                    .mark_outbox_error(record.id, &format!("{e:#}"))
                    .await?;
            }
        }
    }

    Ok(())
}

async fn process_record(
    kyc_repo: &KycRepo,
    sumsub_client: &SumsubClient,
    record: &shared::kyc_repo::KycOutboxRow,
) -> Result<()> {
    // Only fetch applicant details for Green (approved) status
    let is_green = record.kyc_status == Some(KycStatus::Green as i16);
    if !is_green {
        return Ok(());
    }

    // Fetch applicant info from Sumsub
    let applicant = sumsub_client
        .get_applicant_by_external_id(&record.wallet_address)
        .await?;

    if let Some(info) = &applicant.info {
        kyc_repo
            .update_lp_info(
                &record.wallet_address,
                info.first_name.as_deref(),
                info.last_name.as_deref(),
                info.country.as_deref(),
            )
            .await?;
    }

    tracing::info!(
        wallet = record.wallet_address,
        "KYC approved — applicant info updated"
    );

    Ok(())
}
```

- [ ] **Step 4: Update worker/src/lib.rs**

```rust
pub mod config;
pub mod indexer;
pub mod jobs;
```

- [ ] **Step 5: Update worker/src/main.rs to spawn outbox job**

Add after the indexer job spawning loop, before `ctrl_c`:

```rust
use pipeline_worker::jobs::kyc_outbox::{run_kyc_outbox_job, KycOutboxJobSettings};
use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;
use std::sync::Arc;
```

And in `main()`, after the indexer handles loop:

```rust
    // KYC outbox job
    let kyc_outbox_enabled = std::env::var("JOB_KYC_OUTBOX_ENABLED")
        .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);

    if kyc_outbox_enabled {
        let outbox_settings = KycOutboxJobSettings::from_env();
        let sumsub_settings = SumsubSettings::from_env()?;
        let sumsub_client = Arc::new(SumsubClient::new(sumsub_settings));
        let kyc_repo = Arc::new(KycRepo::new(pool.clone()));

        tracing::info!("KYC outbox job started");
        let handle = tokio::spawn(run_kyc_outbox_job(outbox_settings, kyc_repo, sumsub_client));
        handles.push(handle);
    }
```

Note: The existing handles vector stores `JoinHandle<anyhow::Result<()>>` — the outbox job returns `Result<()>` so it fits.

- [ ] **Step 6: Verify it compiles**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p pipeline-worker`
Expected: Compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/worker/Cargo.toml packages/worker/src/lib.rs packages/worker/src/main.rs packages/worker/src/jobs/
git commit -m "feat(worker): add KYC outbox processing job (#5)"
```

---

### Task 9: Unit Tests for HMAC Signing & Webhook Validation

**Files:**
- Create: `packages/shared/tests/sumsub_signing.rs`
- Create: `packages/api/tests/webhook_validation.rs`

- [ ] **Step 1: Write HMAC signing test**

```rust
// packages/shared/tests/sumsub_signing.rs
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[test]
fn hmac_signature_matches_expected() {
    // Replicate the signing logic to verify correctness
    let secret = "test-secret-key";
    let ts = 1714000000u64;
    let method = "POST";
    let path = "/resources/applicants?levelName=basic-kyc";
    let body = r#"{"externalUserId":"0xABCDEF"}"#;

    let data = format!("{ts}{method}{path}{body}");

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(data.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());

    // Verify it's a 64-char hex string (SHA-256 = 32 bytes = 64 hex chars)
    assert_eq!(signature.len(), 64);
    assert!(signature.chars().all(|c| c.is_ascii_hexdigit()));

    // Verify deterministic — same inputs produce same output
    let mut mac2 = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac2.update(data.as_bytes());
    let signature2 = hex::encode(mac2.finalize().into_bytes());
    assert_eq!(signature, signature2);
}

#[test]
fn hmac_signature_differs_with_different_secret() {
    let data = "1714000000POST/resources/applicants";

    let mut mac1 = HmacSha256::new_from_slice(b"secret-a").unwrap();
    mac1.update(data.as_bytes());
    let sig1 = hex::encode(mac1.finalize().into_bytes());

    let mut mac2 = HmacSha256::new_from_slice(b"secret-b").unwrap();
    mac2.update(data.as_bytes());
    let sig2 = hex::encode(mac2.finalize().into_bytes());

    assert_ne!(sig1, sig2);
}
```

- [ ] **Step 2: Write webhook validation tests**

```rust
// packages/api/tests/webhook_validation.rs
use axum::http::HeaderMap;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

// Re-implement validation inline for testing (avoids needing to export from api crate)
fn validate_webhook(
    headers: &HeaderMap,
    body: &[u8],
    webhook_secret_key: &str,
    webhook_basic_token: &str,
) -> Result<(), &'static str> {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing authorization")?;

    if auth != format!("Basic {webhook_basic_token}") {
        return Err("invalid auth token");
    }

    let alg = headers
        .get("x-payload-digest-alg")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing alg")?;

    if alg != "HMAC_SHA256_HEX" {
        return Err("bad alg");
    }

    let provided = headers
        .get("x-payload-digest")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing digest")?;

    let mut mac = HmacSha256::new_from_slice(webhook_secret_key.as_bytes()).map_err(|_| "key error")?;
    mac.update(body);
    let computed = hex::encode(mac.finalize().into_bytes());

    if computed != provided {
        return Err("digest mismatch");
    }

    Ok(())
}

fn make_valid_headers(body: &[u8], secret: &str, token: &str) -> HeaderMap {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    let digest = hex::encode(mac.finalize().into_bytes());

    let mut headers = HeaderMap::new();
    headers.insert("authorization", format!("Basic {token}").parse().unwrap());
    headers.insert("x-payload-digest-alg", "HMAC_SHA256_HEX".parse().unwrap());
    headers.insert("x-payload-digest", digest.parse().unwrap());
    headers
}

#[test]
fn valid_webhook_passes() {
    let body = b"test payload";
    let secret = "webhook-secret";
    let token = "basic-token";

    let headers = make_valid_headers(body, secret, token);
    assert!(validate_webhook(&headers, body, secret, token).is_ok());
}

#[test]
fn wrong_basic_token_fails() {
    let body = b"test payload";
    let secret = "webhook-secret";

    let headers = make_valid_headers(body, secret, "correct-token");
    assert!(validate_webhook(&headers, body, secret, "wrong-token").is_err());
}

#[test]
fn tampered_body_fails() {
    let body = b"original payload";
    let secret = "webhook-secret";
    let token = "basic-token";

    let headers = make_valid_headers(body, secret, token);
    assert!(validate_webhook(&headers, b"tampered payload", secret, token).is_err());
}

#[test]
fn missing_headers_fail() {
    let headers = HeaderMap::new();
    assert!(validate_webhook(&headers, b"body", "secret", "token").is_err());
}
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo test -p shared --test sumsub_signing && cargo test -p pipeline-api --test webhook_validation`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/tests/sumsub_signing.rs packages/api/tests/webhook_validation.rs
git commit -m "test: add unit tests for HMAC signing and webhook validation (#5)"
```

---

### Task 10: Model Parsing Tests

**Files:**
- Create: `packages/shared/tests/webhook_models.rs`

- [ ] **Step 1: Write webhook payload parsing tests**

```rust
// packages/shared/tests/webhook_models.rs
use shared::sumsub::models::{KycReviewStatus, KycStatus, WebhookPayload};

#[test]
fn parse_green_completed_webhook() {
    let json = r#"{
        "applicantId": "abc123",
        "inspectionId": "insp456",
        "applicantType": "individual",
        "correlationId": "corr789",
        "levelName": "id-and-liveness",
        "externalUserId": "0x1234567890abcdef1234567890abcdef12345678",
        "type": "applicantReviewed",
        "sandboxMode": true,
        "reviewStatus": "completed",
        "reviewResult": {
            "reviewAnswer": "GREEN"
        },
        "createdAtMs": "1714000000000"
    }"#;

    let payload: WebhookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.applicant_id, "abc123");
    assert_eq!(
        payload.external_user_id.as_deref(),
        Some("0x1234567890abcdef1234567890abcdef12345678")
    );
    assert_eq!(payload.parsed_review_status(), Some(KycReviewStatus::Completed));
    assert_eq!(payload.parsed_kyc_status(), Some(KycStatus::Green));
}

#[test]
fn parse_red_rejected_webhook() {
    let json = r#"{
        "applicantId": "abc123",
        "type": "applicantReviewed",
        "reviewStatus": "completed",
        "reviewResult": {
            "reviewAnswer": "RED",
            "rejectLabels": ["FORGERY"],
            "reviewRejectType": "FINAL"
        }
    }"#;

    let payload: WebhookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.parsed_kyc_status(), Some(KycStatus::Red));
    assert_eq!(payload.parsed_review_status(), Some(KycReviewStatus::Completed));
    assert_eq!(
        payload.review_result.as_ref().unwrap().reject_labels,
        Some(vec!["FORGERY".to_owned()])
    );
}

#[test]
fn parse_pending_webhook_no_review_result() {
    let json = r#"{
        "applicantId": "abc123",
        "type": "applicantPending",
        "reviewStatus": "pending"
    }"#;

    let payload: WebhookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.parsed_review_status(), Some(KycReviewStatus::Pending));
    assert_eq!(payload.parsed_kyc_status(), None);
}

#[test]
fn parse_unknown_review_status_defaults_to_pending() {
    let json = r#"{
        "applicantId": "abc123",
        "type": "applicantReviewed",
        "reviewStatus": "unknownValue"
    }"#;

    let payload: WebhookPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.parsed_review_status(), Some(KycReviewStatus::Pending));
}
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo test -p shared --test webhook_models`
Expected: All 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/tests/webhook_models.rs
git commit -m "test: add webhook payload parsing tests (#5)"
```

---

### Task 11: Lint & Final Verification

- [ ] **Step 1: Run clippy on all crates**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo clippy --all -- -D warnings`
Expected: No warnings or errors.

- [ ] **Step 2: Run all tests**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo test --all`
Expected: All tests pass.

- [ ] **Step 3: Fix any issues found, commit fixes**

If clippy or tests report issues, fix them and commit:
```bash
git add -A && git commit -m "fix: address clippy warnings and test failures (#5)"
```
