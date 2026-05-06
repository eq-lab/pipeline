# Crystal Intelligence KYT Integration — Design Spec

**Date:** 2026-05-06
**Branch:** `feat/relayer-job`

## Context

The relayer job loop needs Crystal Intelligence Risk API integration to perform KYT (Know Your Transaction) and AML risk screening. Currently, `verify_transaction()` in `kyt.rs` is a stub that passes all transfers. The relayer must:

1. Screen every new LP address via Crystal once at registration time
2. Screen every on-chain Transfer transaction from LPs
3. Disallow profiles that fail Crystal risk checks

Crystal's Risk API provides two endpoints:
- `GET /explorer/address/{addr}` — address risk score + 24 signal breakdown
- `GET /explorer/tx/{hash}` — transaction risk score + 24 signal breakdown

Authentication: `X-Auth-Apikey` header. Base URL per chain (e.g., `https://apieth.crystalblockchain.com`).

## Provider Enable/Disable Settings

Both Sumsub and Crystal are independently toggle-able. When a provider is disabled, its phase is skipped and Phase 3 excludes its checks from allow/disallow decisions. When disabled, the provider's configuration env vars become optional (not required at startup).

| Setting | Default | Effect when `false` |
|---------|---------|---------------------|
| `JOB_RELAYER_SUMSUB_ENABLED` | `true` | Phase 1 skipped; Phase 3 ignores `kyc_status`, `kyc_review_status`, `aml_status`; Sumsub env vars (`SUMSUB_APP_TOKEN`, etc.) not required |
| `JOB_RELAYER_CRYSTAL_ENABLED` | `true` | Phase 2 skipped; Phase 3 ignores `kyt_status`; Crystal env vars (`CRYSTAL_API_KEY`, etc.) not required |

## Relayer Loop — 3-Phase Architecture

The current 2-phase loop (whitelist sync + KYT stub) is restructured into 3 phases with clear separation of concerns:

```
Loop (every JOB_RELAYER_INTERVAL_SECS):
  Phase 1: phase_check_sumsub()          — Sumsub KYC/KYB/AML status (placeholder)
  Phase 2: phase_check_crystal()         — Crystal address + tx screening → DB columns
  Phase 3: phase_sync_whitelist()        — reads DB flags → on-chain allowUser/disallow
  Sleep
```

### Phase 1: `phase_check_sumsub`

**Replaces:** the Sumsub-status-reading part of current `phase_whitelist_sync`.

**Behavior:** Currently, Sumsub statuses (`kyc_status`, `kyc_review_status`, `aml_status`) are written by the Sumsub webhook handler in the API service. Phase 1 is the logical home for any future Sumsub polling or re-verification. For now, this phase is an empty placeholder — the webhook continues to set DB columns.

**Skipped entirely** when `JOB_RELAYER_SUMSUB_ENABLED=false`.

### Phase 2: `phase_check_crystal`

**Replaces:** current `phase_kyt` stub.

**Skipped entirely** when `JOB_RELAYER_CRYSTAL_ENABLED=false`.

**Two sub-tasks:**

#### 2a. Address Screening (one-time, new profiles only)

- Query: `SELECT wallet_address FROM lp_profiles WHERE crystal_screened_at IS NULL`
- For each address, call `CrystalClient::screen_address(addr)`
- Store on `lp_profiles`: `crystal_address_risk`, `crystal_address_risk_signals`, `crystal_screened_at`
- **Address is screened exactly once.** The `crystal_screened_at IS NULL` filter ensures re-screening never happens. Once screened, the result is permanent.
- Evaluate risk:
  - If `riskscore.value > CRYSTAL_RISK_SCORE_THRESHOLD` → set `kyt_status = 2`
  - If any signal in `CRYSTAL_HARD_FAIL_SIGNALS` has a non-zero value → set `kyt_status = 2`
  - Otherwise → leave `kyt_status` as NULL (no failure)

#### 2b. Transfer Screening (unverified transactions)

- Query: existing `fetch_unverified_transfers()` (WHERE `event_name = 'Transfer' AND kyt_status IS NULL`)
- For each transfer:
  1. Call `CrystalClient::screen_transaction(tx_hash)` — evaluate tx risk
  2. Call `CrystalClient::screen_address(sender)` — evaluate sender risk
  3. Store Crystal response on `contract_logs`: `crystal_tx_risk`, `crystal_tx_signals` (JSONB), `crystal_sender_risk`, `crystal_sender_signals` (JSONB), `crystal_screened_at`
  4. Either check failing → set `contract_logs.kyt_status = 2` + `lp_profiles.kyt_status = 2`
  5. Both pass → set `contract_logs.kyt_status = 1` (Clear)
- On Crystal API error (timeout, 5xx, rate limit): skip transfer, leave as NULL, retry next loop iteration

### Phase 3: `phase_sync_whitelist`

**Replaces:** the on-chain call part of current `phase_whitelist_sync`.

Phase 3 reads DB flags set by Phases 1 and 2 (and the Sumsub webhook) and makes on-chain calls. The SQL conditions adapt based on which providers are enabled.

**Allow conditions** (all must be true):
- If `crystal_enabled`: `kyt_status IS NULL OR kyt_status != 2` (no Crystal failure)
- If `sumsub_enabled`: `kyc_status = 2 AND kyc_review_status = 2 AND aml_status = 2`
- `is_whitelisted IS NULL OR whitelist_reset_at <= NOW()` (not already active)

**Disallow conditions** (whitelisted AND any of):
- `whitelist_reset_at <= NOW()` (expired)
- If `crystal_enabled`: `kyt_status = 2` (Crystal failure)
- If `sumsub_enabled`: `kyc_status != 2 OR aml_status = 3`

**On-chain calls:** Same as current — `allowUser(addr, until)` / `disallow(addr)` via WhitelistRegistry.

## Crystal Client — `packages/shared/src/crystal/`

Following the BitGo client pattern (config/client/models/mod.rs):

### `config.rs`

```rust
pub struct CrystalSettings {
    pub api_key: String,
    pub base_url: String,                    // default: https://apieth.crystalblockchain.com
    pub risk_score_threshold: f64,           // default: 0.7
    pub hard_fail_signals: Vec<String>,      // default: all 24 signals
}
```

Environment variables (all optional when `JOB_RELAYER_CRYSTAL_ENABLED=false`):
- `CRYSTAL_API_KEY` — required when enabled
- `CRYSTAL_BASE_URL` — optional, default `https://apieth.crystalblockchain.com`
- `CRYSTAL_RISK_SCORE_THRESHOLD` — optional, default `0.7`
- `CRYSTAL_HARD_FAIL_SIGNALS` — optional, comma-separated list, default: all 24 signals

### `client.rs`

```rust
pub struct CrystalClient {
    http: reqwest::Client,
    settings: CrystalSettings,
}

impl CrystalClient {
    pub fn new(settings: CrystalSettings) -> Self;
    pub async fn screen_address(&self, address: &str) -> Result<AddressRiskResponse>;
    pub async fn screen_transaction(&self, tx_hash: &str) -> Result<TxRiskResponse>;
}
```

Authentication: `X-Auth-Apikey` header on every request.

Error handling:
- Non-success HTTP status → `anyhow::bail!` with status + body (same as BitGo pattern)
- Caller (Phase 2) catches errors and skips the item, retrying next loop

### `models.rs`

```rust
// Address screening response
pub struct AddressRiskResponse {
    pub address: String,
    pub riskscore: RiskScore,
    pub balance: Option<f64>,
    pub status: Option<String>,
}

// Transaction screening response
pub struct TxRiskResponse {
    pub hash: String,
    pub riskscore: RiskScore,
    pub input: TxParty,   // sender
    pub output: TxParty,  // receiver
    pub amount: Option<f64>,
}

pub struct TxParty {
    pub address: String,
    pub riskscore: Option<f64>,
}

pub struct RiskScore {
    pub value: f64,
    pub signals: RiskSignals,
}

pub struct RiskSignals {
    pub sanctions: f64,
    pub terrorism_financing: f64,
    pub stolen_coins: f64,
    pub dark_market: f64,
    pub dark_service: f64,
    pub scam: f64,
    pub ransom: f64,
    pub child_exploitation: f64,
    pub mixer: f64,
    pub enforcement_action: f64,
    pub exchange_fraudulent: f64,
    pub exchange_licensed: f64,
    pub exchange_unlicensed: f64,
    pub gambling: f64,
    pub illegal_service: f64,
    pub liquidity_pools: f64,
    pub marketplace: f64,
    pub miner: f64,
    pub other: f64,
    pub p2p_exchange_licensed: f64,
    pub p2p_exchange_unlicensed: f64,
    pub payment: f64,
    pub seized_assets: f64,
    pub atm: f64,
    pub wallet: f64,
}

pub struct CrystalMeta {
    pub calls_left: i64,
    pub calls_used: i64,
    pub error_code: i32,
    pub error_message: String,
}
```

### Risk Evaluation Helper

```rust
impl CrystalSettings {
    /// Returns true if the risk score or any hard-fail signal exceeds thresholds.
    pub fn is_risky(&self, riskscore: &RiskScore) -> bool;
}
```

Checks:
1. `riskscore.value > self.risk_score_threshold` → risky
2. For each signal in `self.hard_fail_signals`: if signal value > 0.0 → risky
3. Otherwise → not risky

## Database Changes

### New migration

Add columns to `lp_profiles`:
```sql
ALTER TABLE lp_profiles ADD COLUMN crystal_address_risk REAL;
ALTER TABLE lp_profiles ADD COLUMN crystal_address_risk_signals JSONB;
ALTER TABLE lp_profiles ADD COLUMN crystal_screened_at TIMESTAMPTZ;
```

Add columns to `contract_logs` for Crystal response details:
```sql
ALTER TABLE contract_logs ADD COLUMN crystal_tx_risk REAL;
ALTER TABLE contract_logs ADD COLUMN crystal_tx_signals JSONB;
ALTER TABLE contract_logs ADD COLUMN crystal_sender_risk REAL;
ALTER TABLE contract_logs ADD COLUMN crystal_sender_signals JSONB;
ALTER TABLE contract_logs ADD COLUMN crystal_screened_at TIMESTAMPTZ;
```

Existing columns unchanged:
- `lp_profiles.kyt_status` — aggregate Crystal failure flag (NULL=OK, 2=Failed)
- `contract_logs.kyt_status` — per-transfer result (1=Clear, 2=Failed)

### New repo methods in `kyc_repo.rs`

- `fetch_unscreened_profiles(batch_size) -> Vec<WhitelistCandidate>` — WHERE `crystal_screened_at IS NULL`
- `set_crystal_address_risk(wallet, risk, signals, screened_at)` — stores address screening result on `lp_profiles`
- `set_transfer_crystal_result(log_id, tx_risk, tx_signals, sender_risk, sender_signals, screened_at)` — stores Crystal response on `contract_logs`
- Updated `fetch_profiles_to_allow` / `fetch_profiles_to_disallow` — accept `sumsub_enabled` and `crystal_enabled` booleans to adapt SQL conditions
- Existing methods reused: `set_transfer_kyt_status`, `set_profile_kyt_failed`, `fetch_unverified_transfers`

## File Changes Summary

| File | Change |
|------|--------|
| `packages/shared/src/crystal/config.rs` | **New** — CrystalSettings |
| `packages/shared/src/crystal/client.rs` | **New** — CrystalClient |
| `packages/shared/src/crystal/models.rs` | **New** — API response structs |
| `packages/shared/src/crystal/mod.rs` | **New** — module export |
| `packages/shared/src/lib.rs` | **Edit** — add `pub mod crystal` |
| `packages/shared/src/kyc_repo.rs` | **Edit** — add new repo methods, update allow/disallow queries |
| `packages/shared/migrations/` | **New** — Crystal columns on both `lp_profiles` and `contract_logs` |
| `packages/worker/src/relayer/kyt.rs` | **Rewrite** → `crystal_check.rs` — real Crystal API calls |
| `packages/worker/src/relayer/whitelist_sync.rs` | **Rewrite** → `whitelist.rs` — on-chain only, reads DB flags |
| `packages/worker/src/relayer/relayer_job.rs` | **Edit** — 3-phase loop, conditional phase execution, inject CrystalClient |
| `packages/worker/src/relayer/config.rs` | **Edit** — add `sumsub_enabled`/`crystal_enabled`, conditional settings loading |
| `packages/worker/src/relayer/mod.rs` | **Edit** — update module names |

## Verification

1. **Unit tests:** `CrystalSettings::is_risky()` with various score/signal combinations
2. **Integration test:** Mock Crystal API responses, verify Phase 2 sets correct DB columns (including `crystal_tx_risk`, `crystal_sender_risk`, signals JSONB)
3. **Toggle tests:** Verify relayer starts and operates correctly with each combination: both enabled, sumsub-only, crystal-only, neither
4. **Manual smoke test:** Run relayer against testnet with real Crystal API key, verify:
   - New profile gets one-time Crystal address screening
   - Transfer gets tx + sender screening with response details stored
   - Failed screening prevents whitelisting
   - Passing screening allows whitelisting
5. **Rate limit check:** Confirm `meta.calls_left` is logged for monitoring
