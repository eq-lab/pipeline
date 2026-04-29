# Whitelist Sync Job — Design Spec

**Issue:** #12
**PR:** #13
**Date:** 2026-04-29

## Problem

There is no automated bridge between Sumsub KYC/AML results (stored in `lp_profiles`) and the on-chain `WhitelistRegistry` contract. LPs with completed KYC cannot deposit until someone manually calls `allowUser`. This job closes that loop.

## Schema

Add two nullable columns to `lp_profiles`:

```sql
ALTER TABLE lp_profiles
    ADD COLUMN is_whitelisted BOOLEAN,
    ADD COLUMN whitelist_reset_at TIMESTAMPTZ;
```

Semantics:
- `NULL` — never processed by the whitelist sync job
- `true` — currently whitelisted on-chain; `whitelist_reset_at` holds the UTC expiry
- `false` — actively disallowed on-chain; `whitelist_reset_at` is `NULL`

## Job logic

Runs every `INTERVAL_SECS` (default 30). Each iteration:

### 1. Fetch profiles to allow

```sql
SELECT wallet_address FROM lp_profiles
WHERE kyc_status = 2           -- Green
  AND kyc_review_status = 2    -- Completed
  AND aml_status = 2           -- Clear
  AND (is_whitelisted IS NULL
       OR whitelist_reset_at <= NOW())
```

Covers three cases:
- New profiles that passed KYC (never processed, `is_whitelisted IS NULL`)
- Expiring profiles that need re-whitelisting (`whitelist_reset_at <= NOW()`)

Does NOT re-allow `is_whitelisted = false` profiles — those were actively disallowed and need a status change to become eligible again.

### 2. Fetch profiles to disallow

```sql
SELECT wallet_address FROM lp_profiles
WHERE (is_whitelisted = true OR is_whitelisted IS NULL)
  AND kyc_review_status = 2    -- Completed (final verdict)
  AND (kyc_status != 2 OR aml_status = 3)
```

Only acts when the review is completed — ignores `Init`, `Pending`, `OnHold` statuses.

### 3. Execute contract calls

For each profile to allow:
1. Send `allowUser(lp, now_utc + ttl_secs)` transaction
2. Wait for receipt
3. Update DB: `is_whitelisted = true`, `whitelist_reset_at = now_utc + ttl_secs`

For each profile to disallow:
1. Send `disallow(lp)` transaction
2. Wait for receipt
3. Update DB: `is_whitelisted = false`, `whitelist_reset_at = NULL`

### Error handling

If a transaction fails (reverts, RPC error, etc.):
- Log the error with wallet address and reason
- Skip to the next profile
- Do NOT update the DB row — it will be retried next iteration

## Contract interaction

First contract write in the codebase. Using alloy with a local private key signer:

```rust
sol! {
    function allowUser(address user, uint256 until) external;
    function disallow(address who) external;
}

let signer = PrivateKeySigner::from_bytes(&key)?;
let provider = ProviderBuilder::new()
    .wallet(EthereumWallet::from(signer))
    .on_http(rpc_url);
```

The signer must hold the `WHITELIST_ADMIN` role on the `WhitelistRegistry` contract (typically the Relayer address).

## Config

```
JOB_WHITELIST_ENABLED=false
JOB_WHITELIST_INTERVAL_SECS=30              # polling interval
JOB_WHITELIST_TTL_SECS=7776000              # 90 days — allowedUntil offset
JOB_WHITELIST_ETH_RPC_URL=...               # RPC endpoint
JOB_WHITELIST_REGISTRY_ADDRESS=0x...        # WhitelistRegistry contract
JOB_WHITELIST_SIGNER_KEY=0x...              # private key with WHITELIST_ADMIN role
```

## Files changed

| File | Change |
|------|--------|
| `packages/shared/migrations/20260429000001_whitelist_columns.sql` | Add `is_whitelisted`, `whitelist_reset_at` to `lp_profiles` |
| `packages/shared/src/kyc_repo.rs` | Add queries: `fetch_profiles_to_allow`, `fetch_profiles_to_disallow`, `set_whitelisted`, `set_disallowed` |
| `packages/worker/src/whitelist/config.rs` | `WhitelistJobSettings` |
| `packages/worker/src/whitelist/whitelist_sync.rs` | Job loop + contract calls |
| `packages/worker/src/whitelist/mod.rs` | Module declaration |
| `packages/worker/src/main.rs` | Register whitelist job |
| `packages/worker/src/lib.rs` | Add `pub mod whitelist` |
| `packages/worker/Cargo.toml` | Add alloy signer features if needed |
| `.env.example` | New config vars |
