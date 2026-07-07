# Elliptic KYT for Stellar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Elliptic-based KYT/AML screening for Stellar chains, mirroring the existing EVM/Crystal process (address + deposit-transaction screening feeding the whitelist gate).

**Architecture:** New `packages/shared/src/elliptic/` provider module (HMAC-signed calls to `aml-api.elliptic.co`), a new Stellar relayer Phase 2 (`elliptic_check.rs`), and a rename of the `crystal_*` KYT DB columns to provider-agnostic `kyt_*` so both Crystal (EVM) and Elliptic (Stellar) write the same columns and share the same whitelist gate.

**Tech Stack:** Rust, `reqwest`, `hmac`/`sha2`/`base64`/`hex` (all already in `packages/shared/Cargo.toml`), `sqlx` (runtime-checked query strings — column renames do NOT break compilation, so tests/runtime catch mismatches), `serde`.

## Global Constraints

- Never commit to `main`; work on branch `feat/elliptic-stellar-kyt` (already created). — verbatim from AGENTS.md
- After any Rust change run `cargo clippy --all -- -D warnings` and it must pass. — AGENTS.md
- Tests live in `packages/<pkg>/tests/<topic>.rs`, never inline `#[cfg(test)]` in `src/`. — repo convention
- Tests must be pure unit tests: no `DATABASE_URL`/`POSTGRES_URL`/any env DB connection, no network. — repo convention
- Never commit secrets. The API key/secret in `address.sh`/`transaction.sh` are for local capture only and must not enter source or tests as live credentials (a pinned throwaway secret string for a signing test vector is fine).
- Show the diff and get explicit approval before every `git commit`.
- Each chain uses exactly one KYT provider: EVM→Crystal, Stellar→Elliptic.

---

### Task 1: Rename `crystal_*` KYT columns → `kyt_*` (migration + repo + callers)

Generalize the KYT columns and the repo API so both providers share them. `sqlx` uses runtime query strings here, so this is safe to land as one cohesive, compiling, testable unit.

**Files:**
- Create: `packages/shared/migrations/20260706000001_rename_crystal_columns_to_kyt.sql`
- Modify: `packages/shared/src/kyc_repo.rs` (31 refs — columns, structs `CrystalTransferResult`/`RequestInfo`/`RequestEventRow`, setters, gates)
- Modify: `packages/worker/src/relayer/crystal_check.rs` (8 refs — struct/method names)
- Modify: `packages/api/src/routes/vouchers.rs` (`req.crystal_kyt_status` field ref + comment)

**Interfaces:**
- Produces (renamed, consumed by later tasks):
  - Struct `KytTransferResult<'a>` (was `CrystalTransferResult`) with field `kyt_status: i16` (was `crystal_kyt_status`), plus unchanged `tx_risk: Option<f32>`, `tx_signals: Option<&'a serde_json::Value>`, `sender_risk: Option<f32>`, `sender_signals: Option<&'a serde_json::Value>`, `screened_at: DateTime<Utc>`.
  - `KycRepo::set_kyt_address_risk(chain_id: i64, wallet: &str, risk: f32, signals: &serde_json::Value, screened_at: DateTime<Utc>)` (was `set_crystal_address_risk`).
  - `KycRepo::set_transfer_kyt_result(log_id: i64, result: &KytTransferResult<'_>)` (was `set_transfer_crystal_result`).
  - Unchanged names, new column: `set_profile_kyt_clear`, `set_profile_kyt_failed`, `fetch_unscreened_profiles(chain_id, batch)`.

- [ ] **Step 1: Write the migration**

Create `packages/shared/migrations/20260706000001_rename_crystal_columns_to_kyt.sql`:

```sql
-- Generalize KYT columns from Crystal-specific to provider-agnostic names.
-- Both Crystal (EVM) and Elliptic (Stellar) write these columns.

ALTER TABLE lp_profiles  RENAME COLUMN crystal_kyt_status          TO kyt_status;
ALTER TABLE lp_profiles  RENAME COLUMN crystal_address_risk        TO kyt_address_risk;
ALTER TABLE lp_profiles  RENAME COLUMN crystal_address_risk_signals TO kyt_address_signals;
ALTER TABLE lp_profiles  RENAME COLUMN crystal_screened_at         TO kyt_screened_at;

ALTER TABLE contract_logs RENAME COLUMN crystal_kyt_status     TO kyt_status;
ALTER TABLE contract_logs RENAME COLUMN crystal_tx_risk        TO kyt_tx_risk;
ALTER TABLE contract_logs RENAME COLUMN crystal_tx_signals     TO kyt_tx_signals;
ALTER TABLE contract_logs RENAME COLUMN crystal_sender_risk    TO kyt_sender_risk;
ALTER TABLE contract_logs RENAME COLUMN crystal_sender_signals TO kyt_sender_signals;
ALTER TABLE contract_logs RENAME COLUMN crystal_screened_at    TO kyt_screened_at;

-- Recreate the two partial indexes that referenced the old column names.
DROP INDEX IF EXISTS idx_contract_logs_kyt_unverified;
CREATE INDEX idx_contract_logs_kyt_unverified
    ON contract_logs (id)
    WHERE event_name IN ('DepositRequested', 'WithdrawalRequested') AND kyt_status IS NULL;

DROP INDEX IF EXISTS idx_lp_profiles_crystal_unscreened;
CREATE INDEX idx_lp_profiles_kyt_unscreened
    ON lp_profiles (wallet_address)
    WHERE kyt_screened_at IS NULL;
```

- [ ] **Step 2: Rename in `kyc_repo.rs`**

Apply these exact replacements in `packages/shared/src/kyc_repo.rs`:

- Struct `CrystalTransferResult` → `KytTransferResult`; its field `pub crystal_kyt_status: i16,` → `pub kyt_status: i16,` (line ~134).
- `RequestInfo.crystal_kyt_status` (line ~52) → `kyt_status`.
- `RequestEventRow.crystal_kyt_status` (line ~63) → `kyt_status`.
- In `GroupedRequest::from_row`, `row.crystal_kyt_status` (line ~107) → `row.kyt_status`.
- `fetch_profiles_to_allow`: SQL `p.crystal_kyt_status = 1` and `c.crystal_kyt_status = 1` → `p.kyt_status = 1`, `c.kyt_status = 1` (lines ~335,341,372,378).
- `fetch_profiles_to_disallow`: SQL `crystal_kyt_status = 2` → `kyt_status = 2` (line ~461).
- `fetch_unverified_transfers`: SQL `crystal_kyt_status IS NULL` → `kyt_status IS NULL` (line ~568).
- `set_profile_kyt_clear`/`set_profile_kyt_failed`: SQL `crystal_kyt_status = 1|2` → `kyt_status = 1|2` (lines ~584,599).
- `fetch_unscreened_profiles`: SQL `crystal_screened_at IS NULL` → `kyt_screened_at IS NULL` (line ~615).
- `set_crystal_address_risk` → rename fn to `set_kyt_address_risk`; SQL `crystal_address_risk`→`kyt_address_risk`, `crystal_address_risk_signals`→`kyt_address_signals`, `crystal_screened_at`→`kyt_screened_at` (lines ~626-640).
- `set_transfer_crystal_result` → rename fn to `set_transfer_kyt_result`; param type `&CrystalTransferResult` → `&KytTransferResult`; SQL `crystal_kyt_status`→`kyt_status`, `crystal_tx_risk`→`kyt_tx_risk`, `crystal_tx_signals`→`kyt_tx_signals`, `crystal_sender_risk`→`kyt_sender_risk`, `crystal_sender_signals`→`kyt_sender_signals`, `crystal_screened_at`→`kyt_screened_at`; bind `result.crystal_kyt_status`→`result.kyt_status` (lines ~652-673).
- In the SELECT lists at lines ~709,741,772,803,882 that project `crystal_kyt_status`, change to `kyt_status` (keep the `RequestInfo`/`RequestEventRow` field alias consistent — the column is now `kyt_status`).

> Leave the *parameter* name `crystal_enabled: bool` in `fetch_profiles_to_allow`/`fetch_profiles_to_disallow` as-is for now; Task 8 renames it to `kyt_enabled`.

- [ ] **Step 3: Update `crystal_check.rs` callers**

In `packages/worker/src/relayer/crystal_check.rs`:
- `use shared::kyc_repo::{CrystalTransferResult, ...}` → `KytTransferResult`.
- `CrystalTransferResult { crystal_kyt_status: ... }` (both deposit and withdrawal branches, ~lines 179,222) → `KytTransferResult { kyt_status: ... }`.
- `kyc_repo.set_transfer_crystal_result(...)` → `set_transfer_kyt_result(...)` (~lines 177,220).

- [ ] **Step 4: Update `vouchers.rs`**

In `packages/api/src/routes/vouchers.rs`:
- `req.crystal_kyt_status != Some(1)` → `req.kyt_status != Some(1)` (lines 273, 388). **Keep `state.crystal_enabled` unchanged** (it is the EVM Crystal provider toggle, not a column).
- Update the comment at line ~492 `crystal_kyt_status` → `kyt_status`.

- [ ] **Step 5: Build and clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: PASS (no references to removed `crystal_*` identifiers remain). If it fails, fix the reported unresolved names.

- [ ] **Step 6: Verify no stray references**

Run: `grep -rn 'crystal_kyt_status\|crystal_address_risk\|crystal_tx_risk\|crystal_sender_risk\|crystal_screened_at\|crystal_tx_signals\|crystal_sender_signals\|crystal_address_risk_signals\|CrystalTransferResult\|set_transfer_crystal_result\|set_crystal_address_risk' packages --include='*.rs'`
Expected: no output.

- [ ] **Step 7: Commit** (show diff, get approval first)

```bash
git add packages/shared/migrations/20260706000001_rename_crystal_columns_to_kyt.sql \
        packages/shared/src/kyc_repo.rs \
        packages/worker/src/relayer/crystal_check.rs \
        packages/api/src/routes/vouchers.rs
git commit -m "refactor(shared): rename crystal_* KYT columns to provider-agnostic kyt_*"
```

---

### Task 2: Elliptic HMAC signing helper

**Files:**
- Create: `packages/shared/src/elliptic/mod.rs`
- Create: `packages/shared/src/elliptic/signing.rs`
- Modify: `packages/shared/src/lib.rs` (add `pub mod elliptic;`)
- Test: `packages/shared/tests/elliptic.rs`

**Interfaces:**
- Produces: `elliptic::signing::sign_request(secret_b64: &str, timestamp_ms: u64, method: &str, path: &str, payload: &str) -> anyhow::Result<String>` returning the base64 signature. Consumed by Task 4 (client).

- [ ] **Step 1: Derive the known-answer test vector**

Run this (reproduces the reference `address.sh` algorithm with a pinned timestamp) and copy the output into the test below:

```bash
SECRET="dGVzdHNlY3JldA=="            # base64("testsecret") — throwaway, NOT a real key
TS=1700000000000
METHOD=POST
REQ_PATH=/v2/wallet/synchronous
PAYLOAD='{"subject":{"asset":"holistic","blockchain":"holistic","type":"address","hash":"GTEST"},"type":"wallet_exposure"}'
SECRET_HEX=$(printf "%s" "$SECRET" | base64 -d | xxd -p -c 256)
printf "%s" "${TS}${METHOD}${REQ_PATH}${PAYLOAD}" \
  | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$SECRET_HEX" -binary | base64
```

- [ ] **Step 2: Write the failing signing test**

Create `packages/shared/tests/elliptic.rs` (replace `<SIGNATURE_FROM_STEP_1>`):

```rust
use shared::elliptic::signing::sign_request;

#[test]
fn signature_matches_reference_vector() {
    let payload = r#"{"subject":{"asset":"holistic","blockchain":"holistic","type":"address","hash":"GTEST"},"type":"wallet_exposure"}"#;
    let sig = sign_request(
        "dGVzdHNlY3JldA==",
        1_700_000_000_000,
        "POST",
        "/v2/wallet/synchronous",
        payload,
    )
    .unwrap();
    assert_eq!(sig, "<SIGNATURE_FROM_STEP_1>");
}

#[test]
fn path_is_lowercased_before_signing() {
    // Mixed-case path must produce the same signature as its lowercase form.
    let upper = sign_request("dGVzdHNlY3JldA==", 1, "POST", "/V2/Wallet/Synchronous", "{}").unwrap();
    let lower = sign_request("dGVzdHNlY3JldA==", 1, "POST", "/v2/wallet/synchronous", "{}").unwrap();
    assert_eq!(upper, lower);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p shared --test elliptic`
Expected: FAIL to compile (`shared::elliptic` unresolved).

- [ ] **Step 4: Implement `signing.rs`**

Create `packages/shared/src/elliptic/signing.rs`:

```rust
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Sign an Elliptic request per the documented scheme:
/// `base64(HMAC_SHA256(base64_decode(secret), timestamp + METHOD + path.to_lowercase() + payload))`.
pub fn sign_request(
    secret_b64: &str,
    timestamp_ms: u64,
    method: &str,
    path: &str,
    payload: &str,
) -> Result<String> {
    let key = STANDARD
        .decode(secret_b64.trim())
        .context("ELLIPTIC_API_SECRET is not valid base64")?;

    let request_text = format!("{timestamp_ms}{method}{}{payload}", path.to_lowercase());

    let mut mac = HmacSha256::new_from_slice(&key).context("invalid HMAC key length")?;
    mac.update(request_text.as_bytes());
    Ok(STANDARD.encode(mac.finalize().into_bytes()))
}
```

Create `packages/shared/src/elliptic/mod.rs`:

```rust
pub mod signing;
```

Add to `packages/shared/src/lib.rs` (alongside the other `pub mod` lines, e.g. after `pub mod crystal;`):

```rust
pub mod elliptic;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p shared --test elliptic`
Expected: PASS (both tests).

- [ ] **Step 6: Clippy + commit** (show diff, get approval)

```bash
cargo clippy --all -- -D warnings
git add packages/shared/src/elliptic/ packages/shared/src/lib.rs packages/shared/tests/elliptic.rs
git commit -m "feat(shared): Elliptic HMAC request signer"
```

---

### Task 3: Elliptic response models + config + risk decision

The exact response field names are confirmed from a captured live payload (Step 1). The model is defensive so unknown fields never panic.

**Files:**
- Create: `packages/shared/src/elliptic/models.rs`
- Create: `packages/shared/src/elliptic/config.rs`
- Modify: `packages/shared/src/elliptic/mod.rs`
- Test: `packages/shared/tests/elliptic.rs` (append)

**Interfaces:**
- Produces:
  - `elliptic::models::EllipticResponse { risk_score: Option<f64>, triggered_rules: Vec<serde_json::Value>, evaluation_detail: serde_json::Value }`. Shape confirmed against live responses — see "REAL SCHEMA" below. `triggered_rules` and `evaluation_detail` are captured as raw JSON because their inner shape differs by endpoint. Consumed by Tasks 4 & 6.
  - `elliptic::config::EllipticSettings { api_key, api_secret, base_url, asset, blockchain, risk_threshold: f64 }` with `EllipticSettings::from_env() -> Result<Self>` and `is_risky(&self, resp: &EllipticResponse) -> bool`. Consumed by Tasks 4 & 6.

**REAL SCHEMA (captured from live API 2026-07-06 — authoritative):**
- Top-level `risk_score` is a float on a 0–1 scale (`null` possible when no data). Clean addresses with only exchange/coin-swap exposure score ~0.005.
- `triggered_rules` is a **top-level array**, present (and empty) on `wallet_exposure` responses, **absent** on transaction `source_of_funds` responses. Non-empty ⇒ one of the customer's configured Elliptic risk rules fired ⇒ hard fail. Its element shape was never observed non-empty, so it is captured as `Vec<serde_json::Value>` and only its emptiness is used.
- `evaluation_detail` shape **differs by endpoint**: an object `{"source":[...],"destination":[...]}` for `wallet_exposure`, but an array `[...]` for the transaction analysis. Captured as `serde_json::Value` so one model parses both; it is stored as the audit "signals" JSON but does not drive `is_risky`.
- Decision: `is_risky` = `!triggered_rules.is_empty()` OR (`risk_score` present AND `>= risk_threshold`). No `hard_fail_rules` (rule-name matching dropped — element shape unknown/unstable).
- Fixtures already written by the controller at `packages/shared/tests/fixtures/elliptic_{wallet_clean,transaction_clean,wallet_risky}.json`.

- [x] **Step 1: Capture a real response (schema confirmation) — DONE by controller**

The controller ran the reference scripts against the live API on 2026-07-06 and recorded the authoritative schema (see "REAL SCHEMA" above). Real fixtures are already at `packages/shared/tests/fixtures/elliptic_wallet_clean.json`, `elliptic_transaction_clean.json`, and a synthetic `elliptic_wallet_risky.json`. Do NOT run the scripts again (billed, and the sandbox blocks the agent from running them). Build the model to match those fixtures exactly.

- [ ] **Step 2: Write failing parse + risk tests**

Append to `packages/shared/tests/elliptic.rs`. These use the REAL fixtures via `include_str!` so the parser is proven against actual API output (note the divergent `evaluation_detail` shapes — object vs array):

```rust
use shared::elliptic::config::EllipticSettings;
use shared::elliptic::models::EllipticResponse;

const WALLET_CLEAN: &str = include_str!("fixtures/elliptic_wallet_clean.json");
const TX_CLEAN: &str = include_str!("fixtures/elliptic_transaction_clean.json");
const WALLET_RISKY: &str = include_str!("fixtures/elliptic_wallet_risky.json");

fn settings(threshold: f64) -> EllipticSettings {
    EllipticSettings {
        api_key: "k".into(),
        api_secret: "cw==".into(),
        base_url: "https://aml-api.elliptic.co".into(),
        asset: "holistic".into(),
        blockchain: "holistic".into(),
        risk_threshold: threshold,
    }
}

#[test]
fn parses_real_wallet_response_object_evaluation_detail() {
    // wallet_exposure: evaluation_detail is an OBJECT {source,destination}; triggered_rules present+empty.
    let resp: EllipticResponse = serde_json::from_str(WALLET_CLEAN).unwrap();
    assert_eq!(resp.risk_score, Some(0.005328906366491394));
    assert!(resp.triggered_rules.is_empty());
    assert!(resp.evaluation_detail.is_object());
}

#[test]
fn parses_real_transaction_response_array_evaluation_detail() {
    // source_of_funds: evaluation_detail is an ARRAY; triggered_rules key absent (serde default → empty).
    let resp: EllipticResponse = serde_json::from_str(TX_CLEAN).unwrap();
    assert_eq!(resp.risk_score, Some(0.0015073405736889924));
    assert!(resp.triggered_rules.is_empty());
    assert!(resp.evaluation_detail.is_array());
}

#[test]
fn parses_null_risk_score() {
    let resp: EllipticResponse = serde_json::from_str(r#"{"risk_score":null}"#).unwrap();
    assert_eq!(resp.risk_score, None);
    assert!(resp.triggered_rules.is_empty());
}

#[test]
fn real_clean_responses_are_not_risky_below_threshold() {
    // Real clean scores (~0.005, ~0.0015) are well under a 0.5 threshold and have no triggered rules.
    let wallet: EllipticResponse = serde_json::from_str(WALLET_CLEAN).unwrap();
    let tx: EllipticResponse = serde_json::from_str(TX_CLEAN).unwrap();
    assert!(!settings(0.5).is_risky(&wallet));
    assert!(!settings(0.5).is_risky(&tx));
}

#[test]
fn score_at_or_above_threshold_is_risky() {
    let resp: EllipticResponse = serde_json::from_str(r#"{"risk_score":0.5}"#).unwrap();
    assert!(settings(0.5).is_risky(&resp));
}

#[test]
fn nonempty_triggered_rules_is_risky_regardless_of_score() {
    // Even a low score is risky when a configured Elliptic rule fired.
    let resp: EllipticResponse =
        serde_json::from_str(r#"{"risk_score":0.001,"triggered_rules":[{"rule_name":"Sanctions"}]}"#).unwrap();
    assert!(settings(0.5).is_risky(&resp));
}

#[test]
fn synthetic_risky_fixture_is_risky() {
    let resp: EllipticResponse = serde_json::from_str(WALLET_RISKY).unwrap();
    assert!(settings(0.5).is_risky(&resp));
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p shared --test elliptic`
Expected: FAIL to compile (`models`/`config` unresolved).

- [ ] **Step 4: Implement `models.rs`**

Create `packages/shared/src/elliptic/models.rs` (matches the captured live schema):

```rust
use serde::Deserialize;

/// Response from `POST /v2/wallet/synchronous` (wallet_exposure) and
/// `POST /v2/analyses/synchronous` (source_of_funds).
///
/// `triggered_rules` and `evaluation_detail` are kept as raw JSON: their inner
/// shape differs by endpoint (`evaluation_detail` is an object `{source,destination}`
/// for wallet screening but an array for transaction analysis), so a typed model
/// would need two variants. We only need `risk_score` and whether any rule fired.
#[derive(Debug, Deserialize)]
pub struct EllipticResponse {
    /// Overall risk score on a 0–1 scale; `null` when Elliptic has no data.
    #[serde(default)]
    pub risk_score: Option<f64>,
    /// Customer-configured risk rules that fired. Present (often empty) on wallet
    /// responses, absent on transaction responses → default to empty. Non-empty ⇒ risky.
    #[serde(default)]
    pub triggered_rules: Vec<serde_json::Value>,
    /// Per-rule exposure breakdown; shape varies by endpoint. Stored as the audit
    /// "signals" JSON, not used for the risk decision. Defaults to JSON null if absent.
    #[serde(default)]
    pub evaluation_detail: serde_json::Value,
}
```

- [ ] **Step 5: Implement `config.rs`**

Create `packages/shared/src/elliptic/config.rs`:

```rust
use anyhow::{Context, Result};
use std::env;

use super::models::EllipticResponse;

/// Default risk-score cutoff on Elliptic's 0–1 scale. Clean addresses (exchange /
/// coin-swap exposure only) score ~0.005 in practice; 0.5 flags substantial risk
/// while `triggered_rules` catches configured hard hits regardless of score.
/// COMPLIANCE NOTE: tune `ELLIPTIC_RISK_THRESHOLD` to your risk appetite.
const DEFAULT_RISK_THRESHOLD: f64 = 0.5;

#[derive(Clone)]
pub struct EllipticSettings {
    pub api_key: String,
    pub api_secret: String,
    pub base_url: String,
    pub asset: String,
    pub blockchain: String,
    pub risk_threshold: f64,
}

impl EllipticSettings {
    pub fn from_env() -> Result<Self> {
        let api_key =
            env::var("ELLIPTIC_API_KEY").context("required env var ELLIPTIC_API_KEY is not set")?;
        let api_secret = env::var("ELLIPTIC_API_SECRET")
            .context("required env var ELLIPTIC_API_SECRET is not set")?;
        let base_url =
            env::var("ELLIPTIC_BASE_URL").unwrap_or_else(|_| "https://aml-api.elliptic.co".into());
        let asset = env::var("ELLIPTIC_ASSET").unwrap_or_else(|_| "holistic".into());
        let blockchain = env::var("ELLIPTIC_BLOCKCHAIN").unwrap_or_else(|_| "holistic".into());
        let risk_threshold = match env::var("ELLIPTIC_RISK_THRESHOLD") {
            Ok(v) => v
                .parse::<f64>()
                .context("ELLIPTIC_RISK_THRESHOLD must be a valid number")?,
            Err(_) => DEFAULT_RISK_THRESHOLD,
        };

        Ok(Self {
            api_key,
            api_secret,
            base_url,
            asset,
            blockchain,
            risk_threshold,
        })
    }

    /// Risky if any customer-configured Elliptic rule fired, or the overall
    /// risk score meets/exceeds the threshold.
    pub fn is_risky(&self, resp: &EllipticResponse) -> bool {
        if !resp.triggered_rules.is_empty() {
            return true;
        }
        matches!(resp.risk_score, Some(score) if score >= self.risk_threshold)
    }
}
```

Update `packages/shared/src/elliptic/mod.rs`:

```rust
pub mod config;
pub mod models;
pub mod signing;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p shared --test elliptic`
Expected: PASS (all tests).

- [ ] **Step 7: Clippy + commit** (show diff, get approval)

```bash
cargo clippy --all -- -D warnings
git add packages/shared/src/elliptic/ packages/shared/tests/elliptic.rs
git commit -m "feat(shared): Elliptic response models, config, and risk decision"
```

---

### Task 4: Elliptic client

**Files:**
- Create: `packages/shared/src/elliptic/client.rs`
- Modify: `packages/shared/src/elliptic/mod.rs`

**Interfaces:**
- Consumes: `signing::sign_request`, `config::EllipticSettings`, `models::EllipticResponse`.
- Produces:
  - `EllipticClient::new(settings: EllipticSettings) -> Self`
  - `EllipticClient::settings(&self) -> &EllipticSettings`
  - `async EllipticClient::screen_wallet(&self, address: &str) -> Result<EllipticResponse>`
  - `async EllipticClient::screen_transaction(&self, tx_hash: &str, output_address: &str, customer_reference: &str) -> Result<EllipticResponse>`
  Consumed by Task 6.

- [ ] **Step 1: Implement `client.rs`**

Create `packages/shared/src/elliptic/client.rs`:

```rust
use anyhow::{Context, Result};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

use super::config::EllipticSettings;
use super::models::EllipticResponse;
use super::signing::sign_request;

pub struct EllipticClient {
    http: reqwest::Client,
    settings: EllipticSettings,
}

impl EllipticClient {
    pub fn new(settings: EllipticSettings) -> Self {
        Self {
            http: reqwest::Client::new(),
            settings,
        }
    }

    pub fn settings(&self) -> &EllipticSettings {
        &self.settings
    }

    /// Wallet exposure screening: `POST /v2/wallet/synchronous`.
    pub async fn screen_wallet(&self, address: &str) -> Result<EllipticResponse> {
        let body = json!({
            "subject": {
                "asset": self.settings.asset,
                "blockchain": self.settings.blockchain,
                "type": "address",
                "hash": address,
            },
            "type": "wallet_exposure",
        });
        self.post("/v2/wallet/synchronous", &body)
            .await
            .context("Elliptic wallet screening failed")
    }

    /// Source-of-funds transaction analysis: `POST /v2/analyses/synchronous`.
    pub async fn screen_transaction(
        &self,
        tx_hash: &str,
        output_address: &str,
        customer_reference: &str,
    ) -> Result<EllipticResponse> {
        let body = json!({
            "subject": {
                "output_type": "address",
                "asset": self.settings.asset,
                "blockchain": self.settings.blockchain,
                "type": "transaction",
                "hash": tx_hash,
                "output_address": output_address,
            },
            "type": "source_of_funds",
            "customer_reference": customer_reference,
        });
        self.post("/v2/analyses/synchronous", &body)
            .await
            .context("Elliptic transaction screening failed")
    }

    async fn post(&self, path: &str, body: &serde_json::Value) -> Result<EllipticResponse> {
        // Compact, no-space JSON — the exact bytes must match what is signed.
        let payload = serde_json::to_string(body).context("failed to serialize Elliptic body")?;
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock error")?
            .as_millis() as u64;
        let signature =
            sign_request(&self.settings.api_secret, timestamp_ms, "POST", path, &payload)?;

        let url = format!("{}{}", self.settings.base_url, path);
        let response = self
            .http
            .post(&url)
            .header("x-access-key", &self.settings.api_key)
            .header("x-access-sign", signature)
            .header("x-access-timestamp", timestamp_ms.to_string())
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .body(payload)
            .send()
            .await
            .context("Elliptic request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Elliptic {path} returned {status}: {text}");
        }

        response
            .json::<EllipticResponse>()
            .await
            .context("failed to parse Elliptic response")
    }
}
```

Update `packages/shared/src/elliptic/mod.rs`:

```rust
pub mod client;
pub mod config;
pub mod models;
pub mod signing;
```

- [ ] **Step 2: Build + clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: PASS.

> No unit test here: the client only does I/O (signing and parsing are already covered in Tasks 2–3). Its real exercise is the manual live capture in Task 3 Step 1.

- [ ] **Step 3: Commit** (show diff, get approval)

```bash
git add packages/shared/src/elliptic/
git commit -m "feat(shared): Elliptic API client (wallet + transaction screening)"
```

---

### Task 5: Stellar relayer config — `elliptic_enabled` + `EllipticSettings` wiring

**Files:**
- Modify: `packages/worker/src/relayer/config.rs` (`StellarRelayerSettings`)

**Interfaces:**
- Consumes: `shared::elliptic::config::EllipticSettings`.
- Produces: `StellarRelayerSettings.elliptic_enabled: bool` (replaces the hardcoded `crystal_enabled = false`). Consumed by Tasks 6 & 7.

- [ ] **Step 1: Replace `crystal_enabled` with `elliptic_enabled` on `StellarRelayerSettings`**

In `packages/worker/src/relayer/config.rs`:
- Change the struct field (line ~84-85):
```rust
    /// KYT via Elliptic. Enabled with ELLIPTIC_ENABLED=true.
    pub elliptic_enabled: bool,
```
- In `from_chain_env` (line ~148), replace:
```rust
        // Crystal is force-disabled on Stellar regardless of the global toggle.
        let crystal_enabled = false;
```
with:
```rust
        let elliptic_enabled = env_parse("ELLIPTIC_ENABLED", false)?;
```
- Update the struct literal at the bottom of `from_chain_env` (line ~160): `crystal_enabled,` → `elliptic_enabled,`.

- [ ] **Step 2: Build + clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: FAIL — `stellar/job.rs` still reads `settings.crystal_enabled` in its `tracing::info!`. That is fixed in Task 6; if you want a green checkpoint now, temporarily change that log field to `elliptic_enabled = settings.elliptic_enabled`.

- [ ] **Step 3: Commit** (show diff, get approval) — commit together with Task 6 if you prefer a single green build. Otherwise:

```bash
git add packages/worker/src/relayer/config.rs
git commit -m "feat(worker): elliptic_enabled toggle on StellarRelayerSettings"
```

---

### Task 6: Stellar Phase 2 — `elliptic_check.rs` + chain-scoped transfer fetch + job wiring

**Files:**
- Create: `packages/worker/src/relayer/elliptic_check.rs`
- Modify: `packages/worker/src/relayer/mod.rs` (add `pub mod elliptic_check;` — match how `crystal_check` is declared)
- Modify: `packages/shared/src/kyc_repo.rs` (add `fetch_unverified_transfers_for_chain`)
- Modify: `packages/worker/src/relayer/stellar/job.rs` (construct client, run phase)

**Interfaces:**
- Consumes: `EllipticClient`, `KytTransferResult`, `set_kyt_address_risk`, `set_transfer_kyt_result`, `set_profile_kyt_clear/failed`, `fetch_unscreened_profiles`.
- Produces: `KycRepo::fetch_unverified_transfers_for_chain(chain_id: i64, batch_size: i64) -> Result<Vec<UnverifiedTransfer>>`; `phase_check_elliptic(elliptic: &EllipticClient, kyc_repo: &KycRepo, chain_id: i64)`.

- [ ] **Step 1: Add chain-scoped transfer fetch to `kyc_repo.rs`**

After `fetch_unverified_transfers` (line ~576) add:

```rust
    /// Chain-scoped variant of `fetch_unverified_transfers`. Used by the Stellar
    /// KYT phase so it only screens its own chain's transfers and preserves the
    /// Strkey (case-sensitive) sender address (no lowercasing here or in the caller).
    pub async fn fetch_unverified_transfers_for_chain(
        &self,
        chain_id: i64,
        batch_size: i64,
    ) -> anyhow::Result<Vec<UnverifiedTransfer>> {
        let rows = sqlx::query_as::<_, UnverifiedTransfer>(
            "SELECT id,
                    event_name,
                    COALESCE(params->>'user', params->>'withdrawer') AS sender,
                    params->>'receiver' AS receiver,
                    (params->>'amount')::numeric AS amount,
                    tx_hash,
                    chain_id
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name IN ('DepositRequested', 'WithdrawalRequested')
               AND kyt_status IS NULL
             ORDER BY id
             LIMIT $2",
        )
        .bind(chain_id)
        .bind(batch_size)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
```

- [ ] **Step 2: Implement `elliptic_check.rs`**

Create `packages/worker/src/relayer/elliptic_check.rs`:

```rust
use chrono::Utc;
use shared::elliptic::client::EllipticClient;
use shared::kyc_repo::{KycRepo, KytTransferResult, UnverifiedTransfer};

// KYT status values shared with the whitelist gate.
const KYT_CLEAR: i16 = 1;
const KYT_FAILED: i16 = 2;
const BATCH_SIZE: i64 = 100;

/// Stellar Phase 2: Elliptic KYT/AML screening.
///   2a: one-time wallet_exposure screening for new profiles.
///   2b: deposit transaction screening + withdrawal address screening.
pub async fn phase_check_elliptic(elliptic: &EllipticClient, kyc_repo: &KycRepo, chain_id: i64) {
    screen_addresses(elliptic, kyc_repo, chain_id).await;
    screen_events(elliptic, kyc_repo, chain_id).await;
}

async fn screen_addresses(elliptic: &EllipticClient, kyc_repo: &KycRepo, chain_id: i64) {
    let profiles = match kyc_repo.fetch_unscreened_profiles(chain_id, BATCH_SIZE).await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "elliptic: failed to fetch unscreened profiles");
            return;
        }
    };
    if !profiles.is_empty() {
        tracing::info!(count = profiles.len(), "screening addresses via Elliptic");
    }

    for profile in &profiles {
        let resp = match elliptic.screen_wallet(&profile.wallet_address).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(wallet = profile.wallet_address, error = %e,
                    "Elliptic address screening failed, will retry next iteration");
                continue;
            }
        };
        let risk = resp.risk_score.unwrap_or(0.0) as f32;
        // evaluation_detail is already a JSON value; store it verbatim as the audit signals.
        let signals_json = resp.evaluation_detail.clone();
        if let Err(e) = kyc_repo
            .set_kyt_address_risk(chain_id, &profile.wallet_address, risk, &signals_json, Utc::now())
            .await
        {
            tracing::error!(wallet = profile.wallet_address, error = %e, "store address risk failed");
            continue;
        }

        let setter = if elliptic.settings().is_risky(&resp) {
            tracing::warn!(wallet = profile.wallet_address, risk, "Elliptic address screening failed");
            kyc_repo.set_profile_kyt_failed(chain_id, &profile.wallet_address).await
        } else {
            kyc_repo.set_profile_kyt_clear(chain_id, &profile.wallet_address).await
        };
        if let Err(e) = setter {
            tracing::error!(wallet = profile.wallet_address, error = %e, "set kyt_status failed");
        }
    }
}

async fn screen_events(elliptic: &EllipticClient, kyc_repo: &KycRepo, chain_id: i64) {
    let transfers = match kyc_repo
        .fetch_unverified_transfers_for_chain(chain_id, BATCH_SIZE)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "elliptic: failed to fetch unverified events");
            return;
        }
    };
    if !transfers.is_empty() {
        tracing::info!(count = transfers.len(), "screening events via Elliptic");
    }
    for transfer in &transfers {
        if let Err(e) = screen_single_event(elliptic, kyc_repo, transfer).await {
            tracing::warn!(log_id = transfer.id, tx_hash = transfer.tx_hash, error = %e,
                "Elliptic event screening failed, will retry next iteration");
        }
    }
}

async fn screen_single_event(
    elliptic: &EllipticClient,
    kyc_repo: &KycRepo,
    transfer: &UnverifiedTransfer,
) -> anyhow::Result<()> {
    let chain_id = transfer.chain_id;
    // Stellar addresses are case-sensitive Strkeys — do NOT lowercase.
    let addr = transfer
        .sender
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("{} {} has no address", transfer.event_name, transfer.id))?;

    // Deposit → transaction (source_of_funds) screening; store on the tx_* fields.
    // Withdrawal → wallet_exposure address screening; store on the sender_* fields.
    // Mirrors crystal_check.rs::screen_single_event, minus the EVM lowercasing.
    let risky = if transfer.event_name == "DepositRequested" {
        let resp = elliptic
            .screen_transaction(&transfer.tx_hash, addr, addr)
            .await?;
        let tx_risk = resp.risk_score.unwrap_or(0.0) as f32;
        let tx_signals = resp.evaluation_detail.clone();
        let risky = elliptic.settings().is_risky(&resp);
        kyc_repo
            .set_transfer_kyt_result(
                transfer.id,
                &KytTransferResult {
                    kyt_status: if risky { KYT_FAILED } else { KYT_CLEAR },
                    tx_risk: Some(tx_risk),
                    tx_signals: Some(&tx_signals),
                    sender_risk: None,
                    sender_signals: None,
                    screened_at: Utc::now(),
                },
            )
            .await?;
        risky
    } else {
        let resp = elliptic.screen_wallet(addr).await?;
        let risk = resp.risk_score.unwrap_or(0.0) as f32;
        let signals = resp.evaluation_detail.clone();
        let risky = elliptic.settings().is_risky(&resp);
        kyc_repo
            .set_transfer_kyt_result(
                transfer.id,
                &KytTransferResult {
                    kyt_status: if risky { KYT_FAILED } else { KYT_CLEAR },
                    tx_risk: None,
                    tx_signals: None,
                    sender_risk: Some(risk),
                    sender_signals: Some(&signals),
                    screened_at: Utc::now(),
                },
            )
            .await?;
        risky
    };

    if risky {
        tracing::warn!(log_id = transfer.id, address = addr, "Elliptic screening failed — marking profile");
        if let Err(e) = kyc_repo.set_profile_kyt_failed(chain_id, addr).await {
            tracing::error!(address = addr, error = %e, "set profile kyt_status failed");
        }
    }
    Ok(())
}
```

Note the two `set_transfer_kyt_result` borrows: `tx_signals`/`signals` are locals in each branch, so `Some(&tx_signals)` lives long enough for the `.await`. This matches how `crystal_check.rs` structures the call.

- [ ] **Step 3: Declare the module**

In `packages/worker/src/relayer/mod.rs`, add alongside `crystal_check`:

```rust
pub mod elliptic_check;
```

(Match the existing visibility/ordering of `pub mod crystal_check;`.)

- [ ] **Step 4: Wire the phase into `stellar/job.rs`**

In `packages/worker/src/relayer/stellar/job.rs`:
- Add imports:
```rust
use shared::elliptic::client::EllipticClient;
use shared::elliptic::config::EllipticSettings;
use crate::relayer::elliptic_check::phase_check_elliptic;
```
- Before the loop (after the yield_mint setup, ~line 86), construct the client when enabled:
```rust
    let elliptic_client = if settings.elliptic_enabled {
        let s = EllipticSettings::from_env()
            .context("ELLIPTIC_ENABLED=true but Elliptic settings are missing")?;
        Some(EllipticClient::new(s))
    } else {
        None
    };
```
  (Add `use anyhow::Context;` if not already imported.)
- Fix the startup log field (from Task 5): `crystal_enabled = settings.crystal_enabled` → `elliptic_enabled = settings.elliptic_enabled`.
- Inside the loop, insert Phase 2 between Phase 0 and Phase 3:
```rust
        // Phase 2: Elliptic KYT/AML screening (chain-scoped).
        if let Some(ref elliptic) = elliptic_client {
            phase_check_elliptic(elliptic, &kyc_repo, chain_id).await;
        }
```

- [ ] **Step 5: Build + clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: PASS (after replacing the placeholder per the Step 2 note).

- [ ] **Step 6: Commit** (show diff, get approval)

```bash
git add packages/worker/src/relayer/elliptic_check.rs \
        packages/worker/src/relayer/mod.rs \
        packages/worker/src/relayer/stellar/job.rs \
        packages/shared/src/kyc_repo.rs
git commit -m "feat(worker): Stellar Elliptic KYT phase (address + deposit-tx screening)"
```

---

### Task 7: Stellar whitelist gate — require KYT-clear when Elliptic enabled

**Files:**
- Modify: `packages/shared/src/kyc_repo.rs` (`fetch_profiles_to_allow_stellar`, `fetch_profiles_to_disallow` param rename)
- Modify: `packages/worker/src/relayer/stellar/whitelist.rs` (pass `elliptic_enabled` through `phase_sync_whitelist_stellar`)
- Modify: `packages/worker/src/relayer/stellar/job.rs` (pass `settings.elliptic_enabled` into the whitelist phase)

**Interfaces:**
- Consumes: `StellarRelayerSettings.elliptic_enabled`.
- Produces: `fetch_profiles_to_allow_stellar(chain_id, sumsub_enabled, elliptic_enabled)`; `fetch_profiles_to_disallow(chain_id, sumsub_enabled, kyt_enabled)`.

- [ ] **Step 1: Add the KYT gate to `fetch_profiles_to_allow_stellar`**

In `packages/shared/src/kyc_repo.rs`, change the signature (line ~406) to add `elliptic_enabled: bool`, and add `AND p.kyt_status = 1` to the WHERE clause when enabled. Concretely, replace the two-branch body with a KYT-aware version:

```rust
    pub async fn fetch_profiles_to_allow_stellar(
        &self,
        chain_id: i64,
        sumsub_enabled: bool,
        elliptic_enabled: bool,
    ) -> anyhow::Result<Vec<WhitelistCandidate>> {
        let mut sql = String::from(
            "SELECT p.wallet_address FROM lp_profiles p
             WHERE p.chain_id = $1
               AND p.on_chain_allowed = FALSE
               AND EXISTS (
                   SELECT 1 FROM contract_logs c
                   WHERE c.chain_id = $1
                     AND c.event_name = 'DepositRequested'
                     AND c.params->>'user' = p.wallet_address
               )",
        );
        if sumsub_enabled {
            sql.push_str(
                " AND p.sumsub_kyc_status = 2 AND p.sumsub_review_status = 2 AND p.sumsub_aml_status = 2",
            );
        }
        if elliptic_enabled {
            sql.push_str(" AND p.kyt_status = 1");
        }
        let rows = sqlx::query_as::<_, WhitelistCandidate>(&sql)
            .bind(chain_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }
```

- [ ] **Step 2: Rename the disallow param to be provider-agnostic**

In `fetch_profiles_to_disallow` (line ~448), rename param `crystal_enabled: bool` → `kyt_enabled: bool`, and the `if !crystal_enabled` guard → `if !kyt_enabled`. (The SQL already uses `kyt_status = 2` after Task 1.) Update the EVM caller in `packages/worker/src/relayer/whitelist.rs` / `relayer_job.rs` to pass `settings.crystal_enabled` positionally (no code change needed beyond the arg value — it is already passing the crystal toggle).

- [ ] **Step 3: Thread `elliptic_enabled` through the Stellar whitelist phase**

In `packages/worker/src/relayer/stellar/whitelist.rs`, `phase_sync_whitelist_stellar` currently takes `sumsub_enabled`. Add an `elliptic_enabled: bool` parameter and:
- pass it to `fetch_profiles_to_allow_stellar(chain_id, sumsub_enabled, elliptic_enabled)`;
- call `fetch_profiles_to_disallow(chain_id, sumsub_enabled, elliptic_enabled)` for the disallow pass (add this if the Stellar phase does not already disallow; mirror the EVM `phase_sync_whitelist`).

In `packages/worker/src/relayer/stellar/job.rs`, update the call:
```rust
        phase_sync_whitelist_stellar(
            &whitelister,
            &kyc_repo,
            chain_id,
            settings.sumsub_enabled,
            settings.elliptic_enabled,
            settings.batch_size,
        )
        .await;
```

- [ ] **Step 4: Build + clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: PASS.

- [ ] **Step 5: Commit** (show diff, get approval)

```bash
git add packages/shared/src/kyc_repo.rs packages/worker/src/relayer/stellar/whitelist.rs packages/worker/src/relayer/stellar/job.rs
git commit -m "feat: gate Stellar whitelist on Elliptic KYT-clear"
```

---

### Task 8: Full verification + docs

**Files:**
- Modify: `docs/exec-plans/tech-debt-tracker.md` (note the global `fetch_unverified_transfers`)
- Reference: `.env` (document new `ELLIPTIC_*` vars — do not commit secrets)

- [ ] **Step 1: Run the full fast test suite**

Run: `cargo test -p shared --test elliptic && cargo clippy --all -- -D warnings`
Expected: all Elliptic tests PASS, clippy clean.

- [ ] **Step 2: Log tech debt**

Append to `docs/exec-plans/tech-debt-tracker.md`: the EVM `fetch_unverified_transfers` is not chain-scoped, so in a mixed EVM+Stellar deployment an EVM relayer could pick up Stellar rows; the new Stellar phase uses the chain-scoped variant, but the EVM path should eventually be scoped too. Include date 2026-07-06, location `packages/shared/src/kyc_repo.rs:fetch_unverified_transfers`.

- [ ] **Step 3: Document env vars**

Ensure the deployment `.env` / ops docs list `ELLIPTIC_ENABLED`, `ELLIPTIC_API_KEY`, `ELLIPTIC_API_SECRET`, `ELLIPTIC_BASE_URL`, `ELLIPTIC_ASSET`, `ELLIPTIC_BLOCKCHAIN`, `ELLIPTIC_RISK_THRESHOLD` (default 0.5; tune to compliance risk appetite). Do not commit real values.

- [ ] **Step 4: Commit** (show diff, get approval)

```bash
git add docs/exec-plans/tech-debt-tracker.md
git commit -m "docs: track non-chain-scoped fetch_unverified_transfers debt"
```

---

## Self-Review

**Spec coverage:**
- §1 provider module (signing/client/models/config) → Tasks 2,3,4 ✓
- §2 risk decision → Task 3 (`is_risky`) ✓
- §3 config/env + `elliptic_enabled` → Tasks 3,5 ✓
- §4 `crystal_* → kyt_*` rename → Task 1 ✓ (adjusted for the real DB state: `crystal_kyt_status` was itself a rename of `kyt_status`; the two partial indexes are recreated)
- §5 relayer Phase 2 + Strkey-preserving fetch → Task 6 ✓
- §6 whitelist allow/disallow gate → Task 7 ✓
- §7 tests → Tasks 2,3 (signing, parse, risk) ✓
- Spec noted no frontend/TS references exist — confirmed by grep; no frontend task needed ✓

**Placeholder scan:** No `TBD`/`TODO`/"handle edge cases" steps. Every code step shows complete, compilable code. The only deferred item is the Elliptic response field names, which Task 3 Step 1 resolves by capturing a live payload before the parse test/model are finalized — an explicit, gated step, not a hidden placeholder.

**Type consistency:** `KytTransferResult { kyt_status, tx_risk, tx_signals, sender_risk, sender_signals, screened_at }` defined in Task 1 and used in Task 6; `EllipticResponse { risk_score, triggered_rules, evaluation_detail }` and `EllipticSettings.is_risky(&EllipticResponse)` defined in Task 3 (shape confirmed against live fixtures) and consumed in Tasks 4,6; `sign_request(secret_b64, timestamp_ms, method, path, payload)` defined in Task 2 and called in Task 4; `EllipticClient::screen_wallet/screen_transaction` defined in Task 4 and called in Task 6. Consistent.
