# Sumsub KYC/KYB Integration — Exec Plan

**Issue:** eq-lab/pipeline#5
**Branch:** `feat/sumsub-kyc-integration`
**Spec:** `docs/product-specs/lp-onboarding.md` § LP Wallet Onboarding (step 2)
**Design:** `docs/superpowers/specs/2026-04-24-sumsub-kyc-integration-design.md`

---

## Step Checklist

- [ ] Step 1: DB migrations — `lp_profiles` + `kyc_outbox` tables
- [ ] Step 2: `packages/shared` — Sumsub config, models, KYC enums
- [ ] Step 3: `packages/shared` — `KycRepo` (LP profiles + outbox DB access)
- [ ] Step 4: `packages/shared` — `SumsubClient` with HMAC-SHA256 request signing
- [ ] Step 5: `packages/api` — Axum app setup with shared state and route skeleton
- [ ] Step 6: `packages/api` — KYC endpoints (create applicant, generate token, get status)
- [ ] Step 7: `packages/api` — Webhook callback endpoint with HMAC digest validation
- [ ] Step 8: `packages/worker` — KYC outbox processing job
- [ ] Step 9: Unit tests — HMAC signing, webhook validation
- [ ] Step 10: Unit tests — webhook payload parsing
- [ ] Step 11: `/test-fast` passes, archive plan, commit

---

## Context

LP onboarding requires identity verification before whitelisting (see spec § LP Wallet Onboarding, step 2). This plan implements the Sumsub integration layer only — applicant creation, WebSDK token generation, webhook callback handling, and async outbox processing. Chainalysis screening, accreditation, WhitelistRegistry writes, and the compliance review queue are separate issues.

The integration follows Sumsub's standard server-side flow: create applicant, issue SDK token, receive webhook, process asynchronously.

---

## Design Decisions

**Wallet address as `externalUserId`.** LPs authenticate via wallet; no email collection at onboarding. The connected Ethereum address is the Sumsub identifier.

**Webhooks (push), not polling.** Sumsub sends verification results via HTTP callback. The API validates the HMAC-SHA256 digest and persists the result. Lower latency, fewer API calls than polling.

**Outbox pattern for async processing.** The webhook handler writes to `kyc_outbox`. The Worker polls unprocessed rows and executes downstream actions (fetch applicant details on Green status). This gives at-least-once delivery with error tracking and clean separation between event receipt and processing.

**API crate hosts endpoints.** The webhook endpoint and LP-facing KYC endpoints live in `packages/api/` (axum). The Worker processes the outbox asynchronously. Sumsub client and DB repos live in `packages/shared/` for use by both.

**`SumsubSettings` from env vars.** Config follows the existing `JobSettings::from_env` pattern. Keys: `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, `SUMSUB_BASE_URL`, `SUMSUB_VERIFICATION_LEVEL`, `SUMSUB_WEBHOOK_SECRET_KEY`, `SUMSUB_WEBHOOK_BASIC_TOKEN`, `SUMSUB_SANDBOX`, `SUMSUB_TOKEN_TTL_SECS`.

---

## Step Details

### Step 1 — DB migrations

`packages/shared/migrations/20260424000001_lp_profiles.sql`:
```sql
CREATE TABLE lp_profiles (
    wallet_address      TEXT        PRIMARY KEY,
    sumsub_applicant_id TEXT,
    kyc_status          SMALLINT    NOT NULL DEFAULT 1,  -- 1=Red, 2=Green, 3=Yellow
    kyc_review_status   SMALLINT    NOT NULL DEFAULT 3,  -- 1=Pending, 2=Completed, 3=Init, 4=OnHold
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`packages/shared/migrations/20260424000002_kyc_outbox.sql`:
```sql
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

**Test criterion:** `sqlx migrate run` applies cleanly.

---

### Step 2 — Sumsub config, models, KYC enums

Create `packages/shared/src/sumsub/` module with:

- `config.rs` — `SumsubSettings::from_env()`, loads all `SUMSUB_*` env vars. Derives `Clone`.
- `models.rs` — Request/response DTOs (`CreateApplicantRequest`, `AccessTokenRequest`, `WebhookPayload`, `ReviewResult`), KYC enums (`KycStatus`, `KycReviewStatus` as `repr(i16)` for DB mapping), helper methods `parsed_review_status()` and `parsed_kyc_status()` on `WebhookPayload`.
- `mod.rs` — re-exports.

Add dependencies to `shared/Cargo.toml`: `hmac`, `sha2`, `hex`, `serde`, `serde_json`, `reqwest`, `chrono`, `tracing`.

**Test criterion:** `cargo check -p shared` compiles.

---

### Step 3 — `KycRepo`

Create `packages/shared/src/kyc_repo.rs`:

- `get_lp_profile(wallet_address)` → `Option<LpProfile>`
- `create_lp_profile(wallet_address)` → `LpProfile` (INSERT ON CONFLICT DO NOTHING)
- `set_applicant_id(wallet_address, applicant_id)`
- `update_kyc_status(wallet_address, kyc_status, review_status)`
- `insert_outbox(wallet_address, review_status, kyc_status)`
- `fetch_unprocessed_outbox(batch_size)` → `Vec<KycOutboxRow>`
- `mark_outbox_processed(id)`
- `mark_outbox_error(id, error)`

Follows `EventRepo` pattern — wraps `PgPool`, raw sqlx queries.

**Test criterion:** `cargo check -p shared` compiles.

---

### Step 4 — `SumsubClient`

Create `packages/shared/src/sumsub/client.rs`:

- Wraps `reqwest::Client` + `SumsubSettings`
- `signed_request(method, url, body)` — computes HMAC-SHA256 of `timestamp + method + path + body`, adds `X-App-Token`, `X-App-Access-Ts`, `X-App-Access-Sig` headers
- `create_applicant(wallet_address)` — `POST /resources/applicants?levelName={level}`
- `get_applicant_by_external_id(wallet_address)` — `GET /resources/applicants/-;externalUserId={id}/one`
- `generate_access_token(wallet_address)` — `POST /resources/accessTokens/sdk`

**Test criterion:** `cargo check -p shared` compiles.

---

### Step 5 — API crate setup

Stand up axum in `packages/api/`:

- `main.rs` — loads env, connects PgPool, runs migrations, creates `AppState` (KycRepo + SumsubClient + SumsubSettings), binds axum router on `API_PORT` (default 8080).
- `routes/mod.rs` + `routes/kyc.rs` — empty router skeleton.
- `middleware/mod.rs` + `middleware/webhook_auth.rs` — placeholder.

Add workspace deps: `axum`, `tower`, `tower-http`.

**Test criterion:** `cargo check -p pipeline-api` compiles.

---

### Step 6 — KYC endpoints

Implement in `packages/api/src/routes/kyc.rs`:

- `POST /v1/kyc/applicants` — creates LP profile + Sumsub applicant, stores applicant ID.
- `POST /v1/kyc/token` — generates WebSDK access token, returns token + expiry.
- `GET /v1/kyc/status/{wallet_address}` — returns `{ kyc_status, kyc_review_status }`.

**Test criterion:** `cargo check -p pipeline-api` compiles.

---

### Step 7 — Webhook callback with HMAC validation

Implement `validate_webhook()` in `middleware/webhook_auth.rs`:
1. Verify `Authorization: Basic {token}`
2. Verify `X-Payload-Digest-Alg` = `HMAC_SHA256_HEX`
3. Verify `X-Payload-Digest` matches HMAC-SHA256 of body

Add `POST /v1/kyc/callback` handler:
- Validates headers via `validate_webhook()`
- Validates `sandbox_mode` matches config
- Updates `lp_profiles` KYC status
- Inserts `kyc_outbox` row
- Returns 200 OK

**Test criterion:** `cargo check -p pipeline-api` compiles.

---

### Step 8 — Worker outbox job

Create `packages/worker/src/jobs/kyc_outbox.rs`:

- `KycOutboxJobSettings::from_env()` — reads `JOB_KYC_OUTBOX_INTERVAL_SECS` (default 30), `JOB_KYC_OUTBOX_BATCH_SIZE` (default 100).
- `run_kyc_outbox_job(settings, kyc_repo, sumsub_client)` — loop: fetch unprocessed → process → sleep.
- Per record: if `kyc_status = Green`, fetch applicant details from Sumsub, log info. Non-Green: mark processed immediately.
- Errors stored in `kyc_outbox.error`, record left unprocessed for retry.

Register in `main.rs` — spawned as tokio task when `JOB_KYC_OUTBOX_ENABLED=true`.

**Test criterion:** `cargo check -p pipeline-worker` compiles.

---

### Step 9 — Unit tests: HMAC signing & webhook validation

`packages/shared/tests/sumsub_signing.rs`:
- HMAC-SHA256 produces deterministic 64-char hex string
- Different secrets produce different signatures

`packages/api/tests/webhook_validation.rs`:
- Valid headers + body → passes
- Wrong basic token → fails
- Tampered body → fails
- Missing headers → fails

**Test criterion:** `cargo test -p shared --test sumsub_signing && cargo test -p pipeline-api --test webhook_validation` — all pass.

---

### Step 10 — Unit tests: webhook payload parsing

`packages/shared/tests/webhook_models.rs`:
- Green/completed webhook → `KycStatus::Green`, `KycReviewStatus::Completed`
- Red/rejected webhook → `KycStatus::Red`, reject labels parsed
- Pending webhook with no review result → `KycReviewStatus::Pending`, `kyc_status = None`
- Unknown review status → defaults to `Pending`

**Test criterion:** `cargo test -p shared --test webhook_models` — all pass.

---

### Step 11 — Finalise

- Run `/test-fast`
- Move this plan to `docs/exec-plans/completed/`
- Commit: `feat: Sumsub KYC/KYB integration — closes #5`

---

## Out of Scope (this issue)

- Chainalysis address screening — separate issue
- Accreditation self-certification — separate issue
- WhitelistRegistry writes — separate issue (downstream action in outbox job)
- Compliance review queue UI/API — separate issue
- Frontend Sumsub WebSDK integration — follow-up (backend must be deployed first)
- KYB-specific flows (UBO disclosure, corporate docs) — Sumsub level configuration, not code
- Re-screening and revocation — separate issue
