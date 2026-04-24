# Sumsub KYC/KYB Integration Design

**Issue:** #5 — Add Sumsub AML/KYC/KYB verification
**Date:** 2026-04-24
**Status:** Draft

## Context

Pipeline requires identity verification for LPs before they can deposit. The LP onboarding spec (`docs/product-specs/lp-onboarding.md`) defines a multi-step pipeline: Sumsub KYC/KYB, accreditation self-certification, Chainalysis address screening, and WhitelistRegistry writes.

This design covers the **Sumsub integration only** — applicant creation, WebSDK token generation, webhook handling, and KYC status persistence. Chainalysis, accreditation, whitelist writes, and the compliance review queue are separate issues that plug into the outbox job as downstream actions.

The design follows Sumsub's standard server-side integration flow, adapted to Pipeline's Rust + TypeScript stack.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LP identity mapping | Wallet address as `externalUserId` | LPs authenticate via wallet; no email collection at onboarding |
| Integration mode | Webhooks (push from Sumsub) | Lower latency than polling, fewer API calls |
| Webhook endpoint location | API crate | Natural home for HTTP endpoints; Worker handles async outbox processing |
| Async processing | Outbox pattern with Worker polling job | Proven reliable at-least-once processing with error tracking |

## Data Model

### `lp_profiles`

Links wallet address to Sumsub applicant and KYC state.

| Column | Type | Notes |
|--------|------|-------|
| `wallet_address` | `TEXT PRIMARY KEY` | Ethereum address (checksummed) |
| `sumsub_applicant_id` | `TEXT` | Set after applicant creation |
| `kyc_status` | `SMALLINT NOT NULL DEFAULT 1` | 1=Red, 2=Green, 3=Yellow |
| `kyc_review_status` | `SMALLINT NOT NULL DEFAULT 3` | 1=Pending, 2=Completed, 3=Init, 4=OnHold |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |

### `kyc_outbox`

Outbox for reliable async processing of webhook events.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGSERIAL PRIMARY KEY` | |
| `wallet_address` | `TEXT NOT NULL` | |
| `review_status` | `SMALLINT NOT NULL` | |
| `kyc_status` | `SMALLINT` | Nullable; not all callbacks carry a final status |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |
| `processed_at` | `TIMESTAMPTZ` | Null until processed |
| `error` | `TEXT` | Error message if processing failed |

Partial index: `CREATE INDEX ON kyc_outbox (processed_at) WHERE processed_at IS NULL;`

### Enums

```rust
enum KycStatus { Red = 1, Green = 2, Yellow = 3 }
enum KycReviewStatus { Pending = 1, Completed = 2, Init = 3, OnHold = 4 }
```

## Sumsub HTTP Client

Module: `packages/shared/src/sumsub/`

### `SumsubClient` (`client.rs`)

Wraps `reqwest::Client`. Every request signed with HMAC-SHA256:
`signature = HMAC-SHA256(timestamp + method + path + body, secret_key)`

Headers added: `X-App-Token`, `X-App-Access-Ts`, `X-App-Access-Sig`.

Methods:
- `create_applicant(wallet_address, level_name)` — `POST /resources/applicants`
- `get_applicant_by_external_id(wallet_address)` — `GET /resources/applicants/-;externalUserId={id}/one`
- `generate_access_token(wallet_address, level_name, ttl)` — `POST /resources/accessTokens/sdk`

### Models (`models.rs`)

Serde-derived request/response structs:
- `CreateApplicantRequest { external_user_id, email? }`
- `CreateApplicantResponse { id, created_at, client_id, ... }`
- `AccessTokenRequest { applicant_identifiers, user_id, level_name, ttl_in_secs }`
- `AccessTokenResponse { token, user_id }`
- `GetApplicantResponse { id, info: ApplicantInfo { first_name, last_name, country, ... } }`
- `WebhookPayload { applicant_id, external_user_id, review_status, review_result, sandbox_mode, ... }`
- `ReviewResult { review_answer: KycStatus?, reject_labels?, review_reject_type? }`

### Config (`config.rs`)

`SumsubSettings` loaded from environment variables:

| Env var | Field |
|---------|-------|
| `SUMSUB_APP_TOKEN` | `app_token` |
| `SUMSUB_SECRET_KEY` | `secret_key` |
| `SUMSUB_BASE_URL` | `base_url` |
| `SUMSUB_VERIFICATION_LEVEL` | `verification_level` |
| `SUMSUB_WEBHOOK_SECRET_KEY` | `webhook_secret_key` |
| `SUMSUB_WEBHOOK_BASIC_TOKEN` | `webhook_basic_token` |
| `SUMSUB_SANDBOX` | `sandbox` |
| `SUMSUB_TOKEN_TTL_SECS` | `token_ttl_secs` (default: 600) |

## API Endpoints

Framework: `axum` (standard Rust async web framework, pairs with tokio).

### `POST /v1/kyc/applicants` — Create applicant

- **Auth:** Wallet signature (LP proves ownership)
- Looks up or creates `lp_profiles` row
- Calls `SumsubClient::create_applicant(wallet_address, level)`
- Stores `sumsub_applicant_id` on the profile
- Returns `{ applicant_id }`

### `POST /v1/kyc/token` — Generate WebSDK access token

- **Auth:** Wallet signature
- Calls `SumsubClient::generate_access_token(wallet_address, level, ttl)`
- Returns `{ token, expires_at }`

### `GET /v1/kyc/status/{wallet_address}` — Read KYC status

- **Auth:** Public (no sensitive data, just status enums)
- Returns `{ kyc_status, kyc_review_status }` from `lp_profiles`

### `POST /v1/kyc/callback` — Sumsub webhook

- **Auth:** Anonymous + HMAC digest validation
  1. Verify `Authorization: Basic {webhook_basic_token}`
  2. Verify `X-Payload-Digest` = HMAC-SHA256(body, `webhook_secret_key`)
  3. Verify `X-Payload-Digest-Alg` = `HMAC_SHA256_HEX`
- Validate `sandbox_mode` matches config
- Update `lp_profiles.kyc_status` and `kyc_review_status`
- Insert `kyc_outbox` row
- Return 200 OK

Webhook validation implemented as an axum extractor/middleware.

## Worker Outbox Job

New job: `ProcessKycOutboxJob` in `packages/worker/`.

**Polling:** Configurable interval (default 30s via `JOB_KYC_OUTBOX_INTERVAL_SECS`), batch size (default 100 via `JOB_KYC_OUTBOX_BATCH_SIZE`).

**Per record (kyc_status = Green only):**
1. Fetch applicant details via `SumsubClient::get_applicant_by_external_id(wallet_address)`
2. Update `lp_profiles` with name/country from Sumsub
3. Mark `kyc_outbox.processed_at = now()`

**Non-Green statuses:** Mark as processed immediately (status already persisted on `lp_profiles`).

**Errors:** Log message in `kyc_outbox.error`, leave `processed_at` null for retry on next tick.

**Extension point:** Downstream actions (WhitelistRegistry writes, Chainalysis screening) plug in here in future issues.

## Frontend Integration

LP Dashboard in `packages/frontend/`:

1. LP connects wallet → frontend calls `GET /v1/kyc/status/{wallet_address}`
2. If `kyc_status != Green` → show "Verify Identity" CTA
3. On click → `POST /v1/kyc/applicants` (if needed) → `POST /v1/kyc/token`
4. Initialize Sumsub WebSDK with the returned token (embedded verification widget)
5. On completion/close → poll `GET /v1/kyc/status/{wallet_address}` for updated status
6. Display status: Pending (yellow), Approved (green), Rejected (red)

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/shared/migrations/NNNNNN_lp_profiles.sql` | Create `lp_profiles` table |
| `packages/shared/migrations/NNNNNN_kyc_outbox.sql` | Create `kyc_outbox` table |
| `packages/shared/src/sumsub/mod.rs` | Module root |
| `packages/shared/src/sumsub/client.rs` | `SumsubClient` with HMAC signing |
| `packages/shared/src/sumsub/models.rs` | Request/response DTOs, enums |
| `packages/shared/src/sumsub/config.rs` | `SumsubSettings` from env |
| `packages/shared/src/db.rs` | Add `LpProfileRepo` and `KycOutboxRepo` |
| `packages/shared/Cargo.toml` | Add `hmac`, `sha2` dependencies |
| `packages/api/src/main.rs` | Set up axum router with KYC routes |
| `packages/api/src/routes/kyc.rs` | Endpoint handlers |
| `packages/api/src/middleware/webhook_auth.rs` | Sumsub digest validation |
| `packages/api/Cargo.toml` | Add `axum`, `tower` dependencies |
| `packages/worker/src/jobs/kyc_outbox.rs` | `ProcessKycOutboxJob` |
| `packages/worker/src/main.rs` | Register outbox job |
| `packages/frontend/` | KYC status check + Sumsub WebSDK embed |

## Verification

1. **Unit tests:** Sumsub client HMAC signing, webhook digest validation, outbox job processing logic
2. **Integration tests:** Full webhook → outbox → processing flow against test DB
3. **Manual test:** Sumsub sandbox — create applicant, complete verification in WebSDK, receive webhook, verify status updates in DB
4. **Lint:** `cargo clippy --all -- -D warnings` passes
