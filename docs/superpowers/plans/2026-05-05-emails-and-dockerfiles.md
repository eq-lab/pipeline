# Email Endpoint + Dockerfiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `POST /v1/emails` endpoint that saves waitlist emails to PostgreSQL, and a multi-stage Dockerfile that builds both API and worker images.

**Architecture:** New `emails` table via sqlx migration. New `emails.rs` route module in the API, wired into the existing Axum router. Single Dockerfile at repo root with `build`, `api`, and `worker` stages.

**Tech Stack:** Rust, Axum, sqlx (PostgreSQL), Docker multi-stage builds

---

### Task 1: Database Migration

**Files:**
- Create: `packages/shared/migrations/20260505000001_emails.sql`

- [ ] **Step 1: Write the migration**

```sql
-- packages/shared/migrations/20260505000001_emails.sql
CREATE TABLE emails (
    email TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Verify migration compiles with sqlx**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p pipeline-api`
Expected: compiles (migration is picked up by `sqlx::migrate!`)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/migrations/20260505000001_emails.sql
git commit -m "feat: add emails table migration"
```

---

### Task 2: Email Route Handler

**Files:**
- Create: `packages/api/src/routes/emails.rs`
- Modify: `packages/api/src/routes/mod.rs`
- Modify: `packages/api/src/main.rs`

- [ ] **Step 1: Create the email route module**

```rust
// packages/api/src/routes/emails.rs
use std::sync::Arc;

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use utoipa::{OpenApi, ToSchema};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", post(create_email))
}

#[derive(Deserialize, ToSchema)]
pub struct CreateEmailRequest {
    pub email: String,
}

#[derive(OpenApi)]
#[openapi(
    paths(create_email),
    components(schemas(CreateEmailRequest)),
    tags(
        (name = "Emails", description = "Waitlist email collection")
    )
)]
pub struct EmailsDoc;

fn is_valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty() && domain.contains('.') && domain.len() >= 3
}

#[utoipa::path(
    post,
    path = "/v1/emails",
    request_body = CreateEmailRequest,
    responses(
        (status = 201, description = "Email saved"),
        (status = 400, description = "Invalid email format"),
    ),
    tag = "Emails"
)]
async fn create_email(
    State(state): axum::extract::State<Arc<AppState>>,
    Json(req): Json<CreateEmailRequest>,
) -> impl IntoResponse {
    let email = req.email.trim().to_lowercase();

    if !is_valid_email(&email) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid email format"})),
        )
            .into_response();
    }

    match sqlx::query("INSERT INTO emails (email) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(&email)
        .execute(&state.pool)
        .await
    {
        Ok(_) => StatusCode::CREATED.into_response(),
        Err(e) => {
            tracing::error!("failed to insert email: {e:?}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}
```

- [ ] **Step 2: Add `pool` to `AppState`**

In `packages/api/src/main.rs`, add the `pool` field to `AppState`:

```rust
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub kyc_repo: KycRepo,
    pub sumsub_client: SumsubClient,
    pub sumsub_settings: SumsubSettings,
}
```

And update the state construction:

```rust
    let state = Arc::new(AppState {
        pool: pool.clone(),
        kyc_repo,
        sumsub_client,
        sumsub_settings,
    });
```

- [ ] **Step 3: Wire the emails router into the app**

In `packages/api/src/routes/mod.rs`, add:

```rust
pub mod emails;
pub mod kyc;
```

In `packages/api/src/main.rs`, update the router:

```rust
    let app = Router::new()
        .nest("/v1/kyc", routes::kyc::router())
        .nest("/v1/emails", routes::emails::router())
        .merge(
            SwaggerUi::new("/swagger")
                .url("/api-docs/openapi.json", routes::kyc::ApiDoc::openapi()),
        )
        .with_state(state);
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo check -p pipeline-api`
Expected: compiles with no errors

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/emails.rs packages/api/src/routes/mod.rs packages/api/src/main.rs
git commit -m "feat: add POST /v1/emails endpoint for waitlist signup"
```

---

### Task 3: Email Endpoint Tests

**Files:**
- Create: `packages/api/tests/emails.rs`

- [ ] **Step 1: Write integration tests**

These tests need a running PostgreSQL instance. They use the same test pattern as the existing codebase — direct sqlx queries for setup/verification.

```rust
// packages/api/tests/emails.rs
use axum::http::StatusCode;
use axum::body::Body;
use axum::Router;
use tower::ServiceExt;
use std::sync::Arc;
use axum::http::Request;

// Helper to build a test app with a real database
async fn test_app() -> (Router, sqlx::PgPool) {
    dotenvy::dotenv().ok();
    let db_url = std::env::var("POSTGRES_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("POSTGRES_URL or DATABASE_URL must be set for tests");

    let pool = sqlx::PgPool::connect(&db_url).await.unwrap();
    sqlx::migrate!("../shared/migrations").run(&pool).await.unwrap();

    // Clean up test data
    sqlx::query("DELETE FROM emails WHERE email LIKE '%@test-pipeline.example'")
        .execute(&pool)
        .await
        .unwrap();

    let sumsub_settings = shared::sumsub::config::SumsubSettings {
        app_token: "test".into(),
        secret_key: "test".into(),
        base_url: "http://localhost".into(),
        verification_level: "test".into(),
        webhook_secret_key: "test".into(),
        sandbox: true,
        token_ttl_secs: 600,
    };
    let sumsub_client = shared::sumsub::client::SumsubClient::new(sumsub_settings.clone());
    let kyc_repo = shared::kyc_repo::KycRepo::new(pool.clone());

    let state = Arc::new(pipeline_api::AppState {
        pool: pool.clone(),
        kyc_repo,
        sumsub_client,
        sumsub_settings,
    });

    let app = Router::new()
        .nest("/v1/emails", pipeline_api::routes::emails::router())
        .with_state(state);

    (app, pool)
}

#[tokio::test]
async fn valid_email_returns_201() {
    let (app, _pool) = test_app().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/emails")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":"valid@test-pipeline.example"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn duplicate_email_still_returns_201() {
    let (app, _pool) = test_app().await;

    let make_req = || {
        Request::builder()
            .method("POST")
            .uri("/v1/emails")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"email":"dupe@test-pipeline.example"}"#))
            .unwrap()
    };

    let resp1 = app.clone().oneshot(make_req()).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::CREATED);

    let resp2 = app.oneshot(make_req()).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn invalid_email_returns_400() {
    let (app, _pool) = test_app().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/emails")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":"not-an-email"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn empty_email_returns_400() {
    let (app, _pool) = test_app().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/emails")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":""}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 2: Make `AppState` and `routes` public for tests**

In `packages/api/src/main.rs`, add a `lib.rs` or make the struct and modules public. The simplest approach: create `packages/api/src/lib.rs` that re-exports what tests need:

```rust
// packages/api/src/lib.rs
mod middleware;
pub mod routes;

use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub kyc_repo: KycRepo,
    pub sumsub_client: SumsubClient,
    pub sumsub_settings: SumsubSettings,
}
```

Then update `packages/api/src/main.rs` to use the lib:

```rust
// packages/api/src/main.rs
use std::sync::Arc;

use axum::Router;
use pipeline_api::AppState;
use shared::kyc_repo::KycRepo;
use shared::sumsub::client::SumsubClient;
use shared::sumsub::config::SumsubSettings;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

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
        pool: pool.clone(),
        kyc_repo,
        sumsub_client,
        sumsub_settings,
    });

    let app = Router::new()
        .nest("/v1/kyc", pipeline_api::routes::kyc::router())
        .nest("/v1/emails", pipeline_api::routes::emails::router())
        .merge(
            SwaggerUi::new("/swagger")
                .url(
                    "/api-docs/openapi.json",
                    pipeline_api::routes::kyc::ApiDoc::openapi(),
                ),
        )
        .with_state(state);

    let port = std::env::var("API_PORT").unwrap_or_else(|_| "8080".to_owned());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("API listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo test -p pipeline-api -- emails`
Expected: all 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/lib.rs packages/api/src/main.rs packages/api/tests/emails.rs
git commit -m "test: add integration tests for email endpoint"
```

---

### Task 4: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Dockerfile
# Build stage — compiles the entire Rust workspace
FROM rust:1.87-slim AS build
WORKDIR /sln

# Install system deps needed by sqlx (OpenSSL, pkg-config)
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for layer caching
COPY Cargo.toml Cargo.lock ./
COPY packages/api/Cargo.toml packages/api/Cargo.toml
COPY packages/worker/Cargo.toml packages/worker/Cargo.toml
COPY packages/shared/Cargo.toml packages/shared/Cargo.toml

# Create dummy source files so cargo can resolve the workspace and cache deps
RUN mkdir -p packages/api/src packages/worker/src packages/shared/src \
    && echo "fn main() {}" > packages/api/src/main.rs \
    && echo "fn main() {}" > packages/worker/src/main.rs \
    && echo "" > packages/shared/src/lib.rs

# Set sqlx to offline mode (no DB needed at build time)
ENV SQLX_OFFLINE=true

# Cache dependency build
RUN cargo build --release --bin pipeline-api --bin pipeline-worker 2>/dev/null || true

# Copy actual source code
COPY packages/ packages/

# Touch source files to invalidate the dummy build cache
RUN touch packages/api/src/main.rs packages/worker/src/main.rs packages/shared/src/lib.rs

# Build the real binaries
RUN cargo build --release --bin pipeline-api --bin pipeline-worker

# Worker image
FROM debian:bookworm-slim AS worker
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /sln/target/release/pipeline-worker ./worker

ENTRYPOINT ["./worker"]

# API image
FROM debian:bookworm-slim AS api
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /sln/target/release/pipeline-api ./api

EXPOSE 8080

ENTRYPOINT ["./api"]
```

- [ ] **Step 2: Verify image builds**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && docker build --target api -t pipeline-api .`
Expected: builds successfully, final image is small (< 100MB)

Run: `cd /Users/aabliazimov/Documents/work/pipeline && docker build --target worker -t pipeline-worker .`
Expected: builds successfully

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile for api and worker images"
```

---

### Task 5: Lint, Test, and Final Verification

- [ ] **Step 1: Run clippy**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo clippy --all -- -D warnings`
Expected: no warnings

- [ ] **Step 2: Run all tests**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && cargo test --all`
Expected: all tests pass

- [ ] **Step 3: Run doc linter**

Run: `cd /Users/aabliazimov/Documents/work/pipeline && npx tsx scripts/lint-docs.ts`
Expected: passes

- [ ] **Step 4: Fix any issues and commit**

If any failures, fix and commit the fixes.
