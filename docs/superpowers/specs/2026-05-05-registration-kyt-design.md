# Wallet Registration, Optional Sumsub, and KYT

## Overview

Extend the relayer PR with four capabilities:
1. Wallet registration endpoint (signature-based)
2. Sumsub endpoints gated behind registration
3. Optional Sumsub in the whitelist relayer job
4. KYT (Know Your Transaction) phase in the relayer loop

## 1. Wallet Registration Endpoint

Two-step nonce-based flow. No nonce storage required.

### `GET /v1/register/nonce`

Returns a nonce and the message to sign:

```json
{
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Register for Pipeline\nNonce: 550e8400-e29b-41d4-a716-446655440000"
}
```

### `POST /v1/register`

Body:

```json
{
  "wallet_address": "0xabc...",
  "signature": "0x...",
  "nonce": "550e8400-e29b-41d4-a716-446655440000"
}
```

Flow:
1. Reconstruct the expected message: `"Register for Pipeline\nNonce: {nonce}"`
2. Recover the signer address from the message + signature using `ecrecover` (EIP-191 personal_sign)
3. Verify recovered address matches `wallet_address` (case-insensitive)
4. Upsert into `lp_profiles` (create if not exists)
5. Return 200 on success, 400 if signature mismatch

## 2. Sumsub Gating

Existing KYC endpoints require registration:
- `POST /v1/kyc/applicants` — return 403 if `wallet_address` not found in `lp_profiles`
- `POST /v1/kyc/token` — return 403 if `wallet_address` not found in `lp_profiles`

`GET /v1/kyc/status/{wallet_address}` and `POST /v1/kyc/callback` remain ungated.

## 3. Relayer Whitelist — Optional Sumsub

New env var: `JOB_RELAYER_REQUIRE_SUMSUB` (default: `true`).

### When `REQUIRE_SUMSUB=true` (current behavior)

`fetch_profiles_to_allow` query:
- `kyc_status = 2` (Green)
- `kyc_review_status = 2` (Completed)
- `aml_status = 2` (Clear)
- `kyt_status IS NULL OR kyt_status != 2` (no KYT failure) — where 2 = Failed
- `is_whitelisted IS NULL OR whitelist_reset_at <= NOW()`

### When `REQUIRE_SUMSUB=false`

`fetch_profiles_to_allow` query:
- Profile exists in `lp_profiles` (registered via signature)
- `kyt_status IS NULL OR kyt_status != 2` (no KYT failure)
- `is_whitelisted IS NULL OR whitelist_reset_at <= NOW()`

### Disallow query (both modes)

Add `kyt_status = 2` (Failed) as an additional disallow condition:
- `is_whitelisted = true`
- AND (`whitelist_reset_at <= NOW()` OR `kyt_status = 2` OR — when sumsub enabled — `kyc_status != 2 OR aml_status = 3`)

The `require_sumsub` flag is passed to the KycRepo methods so they can adjust the SQL.

## 4. KYT Phase (Transaction Verification)

New phase in the relayer loop, runs after whitelist_sync.

### New columns

- `contract_logs.kyt_status SMALLINT` — per-transfer result (NULL = unverified, 1 = Clear, 2 = Failed)
- `lp_profiles.kyt_status SMALLINT` — per-user aggregate (NULL = OK, 2 = Failed)

### Flow

1. Query `contract_logs` where `event_type = 'Transfer'` and `kyt_status IS NULL`
2. For each transfer, call `verify_transaction(log)` — stub function with TODO for external service integration
3. Update `contract_logs.kyt_status` with result
4. If failed: also set `lp_profiles.kyt_status = 2` for the sender
5. Whitelist_sync picks up the profile-level `kyt_status` failure on next iteration and calls `disallow`

### Stub function

```rust
/// TODO: integrate with external KYT/AML service (provider TBD)
async fn verify_transaction(log: &ContractLog) -> KytVerificationResult {
    // TODO: add a new column in contract_logs to add AML verification result
    KytVerificationResult::Clear
}
```

## 5. Database Migration

Single migration `2026MMDD_registration_kyt.sql`:

```sql
ALTER TABLE lp_profiles ADD COLUMN kyt_status SMALLINT;
ALTER TABLE contract_logs ADD COLUMN kyt_status SMALLINT;
```

## 6. Config Changes

### New env vars

| Variable | Default | Description |
|---|---|---|
| `JOB_RELAYER_REQUIRE_SUMSUB` | `true` | Whether whitelist requires Sumsub KYC |

### Updated `.env.example`

Add `JOB_RELAYER_REQUIRE_SUMSUB=true` to the relayer section.

## 7. Files Affected

| File | Change |
|---|---|
| `packages/api/src/routes/register.rs` | New — registration endpoints |
| `packages/api/src/routes/kyc.rs` | Add registration gate to applicants + token endpoints |
| `packages/api/src/main.rs` | Mount register routes |
| `packages/shared/src/kyc_repo.rs` | Add `require_sumsub` param to allow/disallow queries, add KYT repo methods |
| `packages/worker/src/relayer/relayer_job.rs` | Add KYT phase to loop |
| `packages/worker/src/relayer/kyt.rs` | New — KYT phase + stub verify function |
| `packages/worker/src/relayer/config.rs` | Add `require_sumsub` field |
| `packages/worker/src/relayer/whitelist_sync.rs` | Pass `require_sumsub` to repo queries |
| `packages/worker/src/relayer/mod.rs` | Declare `kyt` module |
| `packages/shared/migrations/` | New migration for kyt_status columns |
| `.env.example` | Add `JOB_RELAYER_REQUIRE_SUMSUB` |
