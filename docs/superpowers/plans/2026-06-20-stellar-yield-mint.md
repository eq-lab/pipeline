# Stellar/Soroban Yield-Mint Relayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stellar/Soroban yield-mint phase to the worker relayer that mirrors EVM Phase 4 (discover → submit → confirm) but signs the Soroban `mint_yield` invocation directly with the relayer ed25519 keypair (no BitGo), running in parallel with the EVM phase.

**Architecture:** A new `relayer/stellar/yield_mint.rs` module reuses the existing `yield_mint_outbox` table and the Stellar signing/RPC plumbing (`stellar/tx.rs`, `StellarRpc`). Orchestration depends on a `StellarYieldSubmitter` trait (production impl `StellarYieldMinter`; mock in tests) so it is unit-testable without RPC. The phase is wired into the existing per-chain Stellar relayer loop and is skipped unless its contract ids are configured.

**Tech Stack:** Rust, `tokio`, `sqlx` (Postgres), `ed25519-dalek`, `stellar-xdr`, `stellar-strkey`, `base64`, `sha2`, `async-trait`, `anyhow`, `bigdecimal`.

Spec: `docs/superpowers/specs/2026-06-19-stellar-yield-mint-design.md`
Exec plan: `docs/exec-plans/active/issue-683-stellar-yield-mint.md`
Issue: https://github.com/eq-lab/pipeline/issues/683

## Global Constraints

- After any Rust change, `cargo clippy --all -- -D warnings` must pass (AGENTS.md). Treat clippy failures as build failures.
- Tests must be **pure unit tests**: no reading `DATABASE_URL` / `POSTGRES_URL` / any env var to reach a real Postgres. No DB-gated tests.
- Rust tests live in external files under `packages/<pkg>/tests/<topic>.rs`, never inline `#[cfg(test)] mod tests { ... }` in `src/`.
- Never commit to `main`. Work on branch `feat/stellar-yield-mint-relayer` (already created). Do not push or open PRs as part of this plan (the manager owns lifecycle/PR steps); local commits per task are fine.
- No regression to EVM Phase 4 or to existing Stellar deployments without a yield-minter configured.
- Soroban contract ids are `C…` strkeys (no EIP-55 checksum). `mint_yield` / `can_yield_be_minted` take `u32` ids.
- Reuse the existing `yield_mint_outbox` table — no schema migration.

---

### Task 1: Outbox persistence — Stellar discovery + submit marker

Add a Stellar-shaped discovery query and a tx-hash-at-submit marker to the outbox repo, and extend the `OutboxStore` trait. Because the trait gains a method, the existing test `InMemoryOutbox` must implement it too or `yield_mint_phase_4.rs` stops compiling.

**Files:**
- Modify: `packages/shared/src/yield_mint_outbox_repo.rs`
- Modify: `packages/worker/tests/yield_mint_phase_4.rs:333-427` (extend `InMemoryOutbox`)

**Interfaces:**
- Consumes: existing `OutboxKey`, `YieldMintOutboxRow`, `YieldMintOutboxRepo`.
- Produces:
  - `OutboxStore::mark_submitted_stellar(&self, key: &OutboxKey, tx_hash: &str) -> Result<()>`
  - `YieldMintOutboxRepo::discover_pending_stellar(&self, chain_id: i64, yield_minter_address: &str, loan_registry_contract_id: &str) -> Result<usize>`

- [ ] **Step 1: Add `mark_submitted_stellar` to the `OutboxStore` trait**

In `packages/shared/src/yield_mint_outbox_repo.rs`, inside `pub trait OutboxStore`, after `mark_submitted` (around line 61):

```rust
    /// Transition a `pending` row to `submitted`, recording the Soroban tx hash
    /// directly (Stellar path — no BitGo tx-request id). `bitgo_tx_request_id`
    /// stays NULL.
    async fn mark_submitted_stellar(&self, key: &OutboxKey, tx_hash: &str) -> Result<()>;
```

- [ ] **Step 2: Implement `mark_submitted_stellar` on `YieldMintOutboxRepo`**

In the `#[async_trait] impl OutboxStore for YieldMintOutboxRepo` block, after `mark_submitted` (around line 223):

```rust
    async fn mark_submitted_stellar(&self, key: &OutboxKey, tx_hash: &str) -> Result<()> {
        let result = sqlx::query(
            r"
            UPDATE yield_mint_outbox
               SET status = 'submitted',
                   tx_hash = $1,
                   submitted_at = NOW()
             WHERE chain_id = $2
               AND yield_minter_address = $3
               AND loan_id = $4
               AND repayment_id = $5
               AND status = 'pending'
            ",
        )
        .bind(tx_hash)
        .bind(key.chain_id)
        .bind(&key.yield_minter_address)
        .bind(&key.loan_id)
        .bind(&key.repayment_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            tracing::warn!(
                chain_id = key.chain_id,
                loan_id = %key.loan_id,
                repayment_id = %key.repayment_id,
                "yield_mint: mark_submitted_stellar matched 0 rows (row not in pending state)"
            );
        }
        Ok(())
    }
```

- [ ] **Step 3: Add `discover_pending_stellar` to the `YieldMintOutboxRepo` inherent impl**

In the `impl YieldMintOutboxRepo` block, after `discover_pending` (around line 129). This differs from `discover_pending` in two ways: `repayment_id` is read top-level (`params->>'repayment_id'`, not `params->'event'->>'repayment_id'`), and `contract_address` is a `C…` strkey (no checksum conversion):

```rust
    /// Stellar variant of [`discover_pending`].
    ///
    /// The Stellar indexer flattens `PaymentRecorded` with **top-level**
    /// `loan_id` / `repayment_id` strings (see
    /// `worker/src/indexer/stellar/loan_registry_parsers.rs`), unlike the EVM
    /// shape where `repayment_id` is nested under `params->'event'`. The
    /// loan-registry address is a Soroban `C…` strkey (no EIP-55 checksum).
    ///
    /// Returns the number of rows inserted.
    pub async fn discover_pending_stellar(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
        loan_registry_contract_id: &str,
    ) -> Result<usize> {
        let result = sqlx::query(
            r"
            INSERT INTO yield_mint_outbox
                (chain_id, yield_minter_address, loan_id, repayment_id, status)
            SELECT
                cl.chain_id,
                $1 AS yield_minter_address,
                (cl.params->>'loan_id')::numeric AS loan_id,
                (cl.params->>'repayment_id')::numeric AS repayment_id,
                'pending'
            FROM contract_logs cl
            WHERE cl.event_name = 'PaymentRecorded'
              AND cl.chain_id = $2
              AND cl.contract_address = $3
              AND NOT EXISTS (
                  SELECT 1 FROM yield_mint_outbox o
                  WHERE o.chain_id = cl.chain_id
                    AND o.yield_minter_address = $1
                    AND o.loan_id = (cl.params->>'loan_id')::numeric
                    AND o.repayment_id = (cl.params->>'repayment_id')::numeric
              )
            ON CONFLICT DO NOTHING
            ",
        )
        .bind(yield_minter_address)
        .bind(chain_id)
        .bind(loan_registry_contract_id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() as usize)
    }
```

Note: this SQL method has no isolated unit test — the project rule forbids DB-gated tests, and it is pure SQL. It is covered by code review and by the orchestration tests (Task 3) exercising the trait surface through the in-memory store. Do not add a `DATABASE_URL`-gated test.

- [ ] **Step 4: Extend the test `InMemoryOutbox` to implement the new trait method**

In `packages/worker/tests/yield_mint_phase_4.rs`, inside `impl OutboxStore for InMemoryOutbox`, after `mark_submitted` (around line 389):

```rust
    async fn mark_submitted_stellar(&self, key: &OutboxKey, tx_hash: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(row) = rows.iter_mut().find(|r| {
            r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending"
        }) {
            "submitted".clone_into(&mut row.status);
            row.tx_hash = Some(tx_hash.to_owned());
            row.submitted_at = Some(chrono::Utc::now());
        }
        Ok(())
    }
```

- [ ] **Step 5: Build and verify the workspace compiles**

Run: `cargo build -p shared -p pipeline-worker`
Expected: builds. The new trait method is implemented by both `YieldMintOutboxRepo` and `InMemoryOutbox`, so no "not all trait items implemented" error.

- [ ] **Step 6: Run the existing yield-mint tests (no regression)**

Run: `cargo test -p pipeline-worker --test yield_mint_phase_4`
Expected: all existing tests still PASS (the in-memory store change is additive).

- [ ] **Step 7: Clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/yield_mint_outbox_repo.rs packages/worker/tests/yield_mint_phase_4.rs
git commit -m "feat(relayer): add Stellar outbox discovery + submit marker for yield mint"
```

---

### Task 2: Stellar yield-mint submitter (`StellarYieldMinter` + trait + helpers)

Create the production submitter and the `StellarYieldSubmitter` trait. Add the `u32_val` ScVal helper and extract the simulate-response decoders so both the whitelist and yield-mint paths share them.

**Files:**
- Modify: `packages/worker/src/stellar/tx.rs` (add `u32_val`)
- Create: `packages/worker/src/relayer/stellar/sim_decode.rs` (extracted decoders)
- Modify: `packages/worker/src/relayer/stellar/whitelist.rs` (use extracted decoders)
- Create: `packages/worker/src/relayer/stellar/yield_mint.rs`
- Modify: `packages/worker/src/relayer/stellar/mod.rs` (register new modules)
- Test: `packages/worker/tests/stellar_yield_mint.rs` (helper tests only in this task)

**Interfaces:**
- Consumes: `stellar/tx.rs` (`build_invoke_envelope`, `sign_envelope`, `envelope_to_base64`, `address_account`, `address_contract`, `symbol`), `StellarRpc` (`simulate_transaction`, `get_account_sequence`, `send_transaction`, `get_transaction`), `SimulateResult`.
- Produces:
  - `stellar::tx::u32_val(n: u32) -> ScVal`
  - `relayer::stellar::sim_decode::{decode_soroban_data, decode_auth_entries}`
  - `relayer::stellar::yield_mint::StellarYieldSubmitter` (trait) with methods
    `can_yield_be_minted(&self, loan_id: u32, repayment_id: u32) -> Result<bool>`,
    `submit_mint_yield(&self, loan_id: u32, repayment_id: u32) -> Result<String>`,
    `check_tx(&self, tx_hash: &str) -> Result<Option<bool>>`
  - `relayer::stellar::yield_mint::StellarYieldMinter` (production impl)

- [ ] **Step 1: Write the failing helper test for `u32_val` and `check_tx` status mapping**

Create `packages/worker/tests/stellar_yield_mint.rs`:

```rust
//! Unit tests for the Stellar yield-mint relayer phase.
//!
//! Pure unit tests — no DB, no network. Orchestration is tested with a mock
//! `StellarYieldSubmitter` and an in-memory outbox; helpers are tested directly.

use stellar_xdr::curr::ScVal;

use pipeline_worker::relayer::stellar::yield_mint::map_get_transaction_status;
use pipeline_worker::stellar::tx::u32_val;

#[test]
fn u32_val_builds_scval_u32() {
    assert_eq!(u32_val(7), ScVal::U32(7));
}

#[test]
fn get_transaction_status_maps_to_tristate() {
    assert_eq!(map_get_transaction_status("SUCCESS"), Some(true));
    assert_eq!(map_get_transaction_status("FAILED"), Some(false));
    assert_eq!(map_get_transaction_status("NOT_FOUND"), None);
    assert_eq!(map_get_transaction_status("PENDING"), None);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p pipeline-worker --test stellar_yield_mint`
Expected: FAIL — `u32_val` and `map_get_transaction_status` do not exist yet (compile error).

- [ ] **Step 3: Add `u32_val` to `stellar/tx.rs`**

In `packages/worker/src/stellar/tx.rs`, in the "ScVal primitives" section after `symbol` (around line 173):

```rust
/// Build `ScVal::U32(n)`.
pub fn u32_val(n: u32) -> ScVal {
    ScVal::U32(n)
}
```

- [ ] **Step 4: Extract simulate-response decoders into `sim_decode.rs`**

Create `packages/worker/src/relayer/stellar/sim_decode.rs` (moved verbatim from `whitelist.rs:218-241`, now `pub`):

```rust
//! Shared decoders for Soroban `simulateTransaction` response fields.
//!
//! Extracted from `whitelist.rs` so the whitelist and yield-mint phases share
//! one implementation (avoids drift).

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use stellar_xdr::curr::{
    Limits, ReadXdr, SorobanAuthorizationEntry, SorobanTransactionData,
};

use crate::indexer::stellar::rpc::SimulateResult;

pub fn decode_soroban_data(b64: &str) -> Result<SorobanTransactionData> {
    let bytes = STANDARD
        .decode(b64.as_bytes())
        .context("decode SorobanTransactionData base64")?;
    SorobanTransactionData::from_xdr(bytes.as_slice(), Limits::none())
        .context("decode SorobanTransactionData XDR")
}

pub fn decode_auth_entries(results: &[SimulateResult]) -> Result<Vec<SorobanAuthorizationEntry>> {
    let mut out = Vec::new();
    for r in results {
        for entry_b64 in &r.auth_xdr_base64 {
            let bytes = STANDARD
                .decode(entry_b64.as_bytes())
                .context("decode SorobanAuthorizationEntry base64")?;
            let entry = SorobanAuthorizationEntry::from_xdr(bytes.as_slice(), Limits::none())
                .context("decode SorobanAuthorizationEntry XDR")?;
            out.push(entry);
        }
    }
    Ok(out)
}
```

- [ ] **Step 5: Point `whitelist.rs` at the extracted decoders**

In `packages/worker/src/relayer/stellar/whitelist.rs`: delete the private `decode_soroban_data` and `decode_auth_entries` fns (lines ~218-241) and import the shared ones. Add to the existing `use crate::stellar::tx::{...}` area:

```rust
use crate::relayer::stellar::sim_decode::{decode_auth_entries, decode_soroban_data};
```

Leave all call sites unchanged (same names/signatures).

- [ ] **Step 6: Create the submitter module**

Create `packages/worker/src/relayer/stellar/yield_mint.rs`:

```rust
//! Stellar/Soroban yield-mint phase.
//!
//! Mirrors the EVM Phase 4 (`relayer/yield_mint/`) discover → submit → confirm
//! cycle, but signs `yield_minter.mint_yield(caller, loan_id, repayment_id)`
//! directly with the relayer ed25519 keypair (no BitGo). Double-mint is
//! prevented on-chain by `loan_registry.consume_yield`; `can_yield_be_minted`
//! is a pre-submit optimization, not the safety mechanism.

use anyhow::{Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract as ContractStrkey};
use stellar_xdr::curr::{Limits, ReadXdr, ScVal};

use crate::indexer::stellar::rpc::StellarRpc;
use crate::relayer::stellar::sim_decode::{decode_auth_entries, decode_soroban_data};
use crate::stellar::tx::{
    address_account, build_invoke_envelope, envelope_to_base64, sign_envelope, u32_val,
};

/// Fee used for simulate-only envelopes (never charged).
const SIM_FEE: u32 = 1_000_000;
/// Minimum inclusion fee added on top of the resource fee from simulate.
const INCLUSION_FEE: u32 = 100;

/// Map a `getTransaction` status string to a tri-state confirm result:
/// `Some(true)` = SUCCESS, `Some(false)` = FAILED, `None` = not yet terminal.
pub fn map_get_transaction_status(status: &str) -> Option<bool> {
    match status {
        "SUCCESS" => Some(true),
        "FAILED" => Some(false),
        _ => None,
    }
}

/// Submitter seam — lets the phase be unit-tested without RPC.
#[async_trait]
pub trait StellarYieldSubmitter: Send + Sync {
    async fn can_yield_be_minted(&self, loan_id: u32, repayment_id: u32) -> Result<bool>;
    /// simulate → sign → send `mint_yield`; returns the tx hash. Does NOT poll.
    async fn submit_mint_yield(&self, loan_id: u32, repayment_id: u32) -> Result<String>;
    /// One `getTransaction` poll: `Some(true)`=SUCCESS, `Some(false)`=FAILED, `None`=in-flight.
    async fn check_tx(&self, tx_hash: &str) -> Result<Option<bool>>;
}

/// Production submitter: signs Soroban invocations with the relayer keypair.
pub struct StellarYieldMinter {
    pub rpc: StellarRpc,
    pub network_passphrase: String,
    pub signing_key: SigningKey,
    pub signer_pubkey: Ed25519Pub,
    pub yield_minter_id: ContractStrkey,
    pub loan_registry_id: ContractStrkey,
}

impl StellarYieldMinter {
    pub fn new(
        rpc_url: &str,
        network_passphrase: String,
        signing_key: SigningKey,
        yield_minter_id: ContractStrkey,
        loan_registry_id: ContractStrkey,
    ) -> Self {
        let signer_pubkey = Ed25519Pub(signing_key.verifying_key().to_bytes());
        Self {
            rpc: StellarRpc::new(rpc_url),
            network_passphrase,
            signing_key,
            signer_pubkey,
            yield_minter_id,
            loan_registry_id,
        }
    }
}

#[async_trait]
impl StellarYieldSubmitter for StellarYieldMinter {
    async fn can_yield_be_minted(&self, loan_id: u32, repayment_id: u32) -> Result<bool> {
        let envelope = build_invoke_envelope(
            &self.signer_pubkey,
            0,
            SIM_FEE,
            &self.loan_registry_id,
            "can_yield_be_minted",
            vec![u32_val(loan_id), u32_val(repayment_id)],
            vec![],
            None,
        );
        let envelope_b64 = envelope_to_base64(&envelope)?;
        let resp = self.rpc.simulate_transaction(&envelope_b64).await?;
        if let Some(err) = &resp.error {
            anyhow::bail!("simulate can_yield_be_minted failed: {err}");
        }
        let first = resp
            .results
            .first()
            .context("simulate can_yield_be_minted returned no results")?;
        let xdr_bytes = STANDARD
            .decode(first.return_value_xdr_base64.as_bytes())
            .context("decode can_yield_be_minted return base64")?;
        let val = ScVal::from_xdr(xdr_bytes.as_slice(), Limits::none())
            .context("decode can_yield_be_minted ScVal")?;
        Ok(matches!(val, ScVal::Bool(true)))
    }

    async fn submit_mint_yield(&self, loan_id: u32, repayment_id: u32) -> Result<String> {
        // mint_yield(caller, loan_id, repayment_id)
        let args = vec![
            address_account(&self.signer_pubkey),
            u32_val(loan_id),
            u32_val(repayment_id),
        ];

        // Step 1: simulate (seq 0 — simulate doesn't validate it).
        let probe = build_invoke_envelope(
            &self.signer_pubkey,
            0,
            SIM_FEE,
            &self.yield_minter_id,
            "mint_yield",
            args.clone(),
            vec![],
            None,
        );
        let probe_b64 = envelope_to_base64(&probe)?;
        let sim = self.rpc.simulate_transaction(&probe_b64).await?;
        if let Some(err) = sim.error {
            anyhow::bail!("simulate mint_yield failed: {err}");
        }
        let tx_data_b64 = sim
            .transaction_data_xdr_base64
            .context("simulate response missing transactionData")?;
        let min_fee = sim
            .min_resource_fee
            .context("simulate response missing minResourceFee")?;
        let soroban_data = decode_soroban_data(&tx_data_b64)?;
        let auth_entries = decode_auth_entries(&sim.results)?;

        // Step 2: real sequence.
        let current_seq = self
            .rpc
            .get_account_sequence(&self.signer_pubkey.0)
            .await?
            .context("signer account does not exist on the network — fund it first")?;
        let seq_num = current_seq.checked_add(1).context("seq overflow")?;

        // Step 3: assemble + sign.
        let total_fee = INCLUSION_FEE
            .checked_add(u32::try_from(min_fee).context("min_resource_fee > u32::MAX")?)
            .context("total fee overflow")?;
        let mut envelope = build_invoke_envelope(
            &self.signer_pubkey,
            seq_num,
            total_fee,
            &self.yield_minter_id,
            "mint_yield",
            args,
            auth_entries,
            Some(soroban_data),
        );
        sign_envelope(&mut envelope, &self.signing_key, &self.network_passphrase)?;
        let envelope_b64 = envelope_to_base64(&envelope)?;

        let send_resp = self.rpc.send_transaction(&envelope_b64).await?;
        match send_resp.status.as_str() {
            "PENDING" | "DUPLICATE" => Ok(send_resp.hash),
            other => anyhow::bail!(
                "sendTransaction mint_yield status={other} (hash={}, error_result_xdr={:?})",
                send_resp.hash,
                send_resp.error_result_xdr,
            ),
        }
    }

    async fn check_tx(&self, tx_hash: &str) -> Result<Option<bool>> {
        let resp = self.rpc.get_transaction(tx_hash).await?;
        Ok(map_get_transaction_status(&resp.status))
    }
}
```

- [ ] **Step 7: Register the new modules**

In `packages/worker/src/relayer/stellar/mod.rs`, add:

```rust
pub mod sim_decode;
pub mod yield_mint;
```

(Keep alphabetical / existing ordering; ensure `whitelist`, `job` declarations remain.)

- [ ] **Step 8: Run the helper test to verify it passes**

Run: `cargo test -p pipeline-worker --test stellar_yield_mint`
Expected: `u32_val_builds_scval_u32` and `get_transaction_status_maps_to_tristate` PASS.

- [ ] **Step 9: Verify whitelist tests still pass (decoder extraction is behavior-preserving)**

Run: `cargo test -p pipeline-worker`
Expected: existing Stellar/whitelist tests PASS.

- [ ] **Step 10: Clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add packages/worker/src/stellar/tx.rs \
        packages/worker/src/relayer/stellar/sim_decode.rs \
        packages/worker/src/relayer/stellar/whitelist.rs \
        packages/worker/src/relayer/stellar/yield_mint.rs \
        packages/worker/src/relayer/stellar/mod.rs \
        packages/worker/tests/stellar_yield_mint.rs
git commit -m "feat(relayer): add StellarYieldMinter submitter and shared sim decoders"
```

---

### Task 3: Phase orchestration (`phase_yield_mint_stellar`) + tests

Implement the discover → submit → confirm orchestration against the `StellarYieldSubmitter` trait and `YieldMintOutboxRepo`, with full unit coverage via a mock submitter and in-memory outbox.

**Files:**
- Modify: `packages/worker/src/relayer/stellar/yield_mint.rs`
- Modify: `packages/worker/tests/stellar_yield_mint.rs`

**Interfaces:**
- Consumes: `StellarYieldSubmitter`, `YieldMintOutboxRepo`, `OutboxStore`, `OutboxKey`, `YieldMintOutboxRow`.
- Produces:
  - `StellarPhase4Settings { chain_id: i64, yield_minter_id: ContractStrkey, loan_registry_id: ContractStrkey, batch_size: usize }`
  - `phase_yield_mint_stellar(settings: &StellarPhase4Settings, submitter: &dyn StellarYieldSubmitter, outbox: &YieldMintOutboxRepo) -> Result<()>`
  - `submit_pending_stellar(settings, submitter, outbox: &dyn OutboxStore) -> Result<()>` (testable with in-memory outbox)
  - `confirm_submitted_stellar(settings, submitter, outbox: &dyn OutboxStore) -> Result<()>` (testable with in-memory outbox)
  - `u32_from_bigdecimal(v: &bigdecimal::BigDecimal) -> Option<u32>` (range-check helper)

- [ ] **Step 1: Write the failing orchestration tests**

Append to `packages/worker/tests/stellar_yield_mint.rs`. First add imports at the top of the file:

```rust
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use chrono::Utc;
use stellar_strkey::Contract as ContractStrkey;

use shared::yield_mint_outbox_repo::{OutboxKey, OutboxStore, YieldMintOutboxRow};
use pipeline_worker::relayer::stellar::yield_mint::{
    confirm_submitted_stellar, submit_pending_stellar, StellarPhase4Settings, StellarYieldSubmitter,
};
```

Then add the constants, mock submitter, in-memory outbox, row helpers, and tests:

```rust
const CHAIN_ID: i64 = 99_000_001;
// 32 zero bytes → a valid C… strkey for the minter address column.
const MINTER_C: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH";

fn settings() -> StellarPhase4Settings {
    let id = ContractStrkey([0u8; 32]);
    StellarPhase4Settings {
        chain_id: CHAIN_ID,
        yield_minter_id: id,
        loan_registry_id: id,
        batch_size: 50,
    }
}

/// Mock submitter with canned, call-counting behavior.
struct MockSubmitter {
    can_mint: Box<dyn Fn() -> Result<bool> + Send + Sync>,
    submit: Box<dyn Fn() -> Result<String> + Send + Sync>,
    check: Box<dyn Fn() -> Result<Option<bool>> + Send + Sync>,
    submit_calls: Mutex<u32>,
}

impl MockSubmitter {
    fn new(
        can_mint: impl Fn() -> Result<bool> + Send + Sync + 'static,
        submit: impl Fn() -> Result<String> + Send + Sync + 'static,
        check: impl Fn() -> Result<Option<bool>> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            can_mint: Box::new(can_mint),
            submit: Box::new(submit),
            check: Box::new(check),
            submit_calls: Mutex::new(0),
        })
    }
}

#[async_trait]
impl StellarYieldSubmitter for MockSubmitter {
    async fn can_yield_be_minted(&self, _loan_id: u32, _repayment_id: u32) -> Result<bool> {
        (self.can_mint)()
    }
    async fn submit_mint_yield(&self, _loan_id: u32, _repayment_id: u32) -> Result<String> {
        *self.submit_calls.lock().unwrap() += 1;
        (self.submit)()
    }
    async fn check_tx(&self, _tx_hash: &str) -> Result<Option<bool>> {
        (self.check)()
    }
}

struct InMemoryOutbox {
    rows: Mutex<Vec<YieldMintOutboxRow>>,
}

impl InMemoryOutbox {
    fn with_rows(rows: Vec<YieldMintOutboxRow>) -> Arc<Self> {
        Arc::new(Self { rows: Mutex::new(rows) })
    }
    fn status_of(&self, loan_id: u64) -> String {
        let ld = BigDecimal::from(loan_id);
        self.rows.lock().unwrap().iter().find(|r| r.loan_id == ld).unwrap().status.clone()
    }
    fn tx_hash_of(&self, loan_id: u64) -> Option<String> {
        let ld = BigDecimal::from(loan_id);
        self.rows.lock().unwrap().iter().find(|r| r.loan_id == ld).unwrap().tx_hash.clone()
    }
}

#[async_trait]
impl OutboxStore for InMemoryOutbox {
    async fn list_pending(&self, chain_id: i64, addr: &str, limit: i64) -> Result<Vec<YieldMintOutboxRow>> {
        Ok(self.rows.lock().unwrap().iter()
            .filter(|r| r.status == "pending" && r.chain_id == chain_id && r.yield_minter_address == addr)
            .take(limit as usize).cloned().collect())
    }
    async fn list_submitted(&self, chain_id: i64, addr: &str, limit: i64) -> Result<Vec<YieldMintOutboxRow>> {
        Ok(self.rows.lock().unwrap().iter()
            .filter(|r| r.status == "submitted" && r.chain_id == chain_id && r.yield_minter_address == addr)
            .take(limit as usize).cloned().collect())
    }
    async fn mark_submitted(&self, key: &OutboxKey, bitgo_tx_request_id: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending") {
            "submitted".clone_into(&mut r.status);
            r.bitgo_tx_request_id = Some(bitgo_tx_request_id.to_owned());
            r.submitted_at = Some(Utc::now());
        }
        Ok(())
    }
    async fn mark_submitted_stellar(&self, key: &OutboxKey, tx_hash: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending") {
            "submitted".clone_into(&mut r.status);
            r.tx_hash = Some(tx_hash.to_owned());
            r.submitted_at = Some(Utc::now());
        }
        Ok(())
    }
    async fn mark_confirmed(&self, key: &OutboxKey, tx_hash: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "submitted") {
            "confirmed".clone_into(&mut r.status);
            r.tx_hash = Some(tx_hash.to_owned());
            r.confirmed_at = Some(Utc::now());
        }
        Ok(())
    }
    async fn mark_failed(&self, key: &OutboxKey, error: &str) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && (r.status == "pending" || r.status == "submitted")) {
            "failed".clone_into(&mut r.status);
            r.last_error = Some(error.to_owned());
        }
        Ok(())
    }
    async fn mark_skipped_already_minted(&self, key: &OutboxKey) -> Result<()> {
        let mut rows = self.rows.lock().unwrap();
        if let Some(r) = rows.iter_mut().find(|r| r.loan_id == key.loan_id && r.repayment_id == key.repayment_id && r.status == "pending") {
            "skipped_already_minted".clone_into(&mut r.status);
        }
        Ok(())
    }
}

fn row(loan_id: u64, repayment_id: u64, status: &str) -> YieldMintOutboxRow {
    YieldMintOutboxRow {
        chain_id: CHAIN_ID,
        yield_minter_address: MINTER_C.to_owned(),
        loan_id: BigDecimal::from(loan_id),
        repayment_id: BigDecimal::from(repayment_id),
        status: status.to_owned(),
        bitgo_tx_request_id: None,
        tx_hash: if status == "submitted" { Some("abc123".to_owned()) } else { None },
        submitted_at: None,
        confirmed_at: None,
        last_error: None,
        created_at: Utc::now(),
    }
}

#[tokio::test]
async fn submit_skips_when_guard_false() {
    let outbox = InMemoryOutbox::with_rows(vec![row(1, 1, "pending")]);
    let sub = MockSubmitter::new(|| Ok(false), || Ok("h".into()), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref()).await.unwrap();
    assert_eq!(outbox.status_of(1), "skipped_already_minted");
    assert_eq!(*sub.submit_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn submit_retries_on_guard_transient_error() {
    let outbox = InMemoryOutbox::with_rows(vec![row(2, 1, "pending")]);
    let sub = MockSubmitter::new(|| Err(anyhow!("rpc down")), || Ok("h".into()), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref()).await.unwrap();
    assert_eq!(outbox.status_of(2), "pending");
    assert_eq!(*sub.submit_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn submit_marks_submitted_with_tx_hash() {
    let outbox = InMemoryOutbox::with_rows(vec![row(3, 1, "pending")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("deadbeefhash".into()), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref()).await.unwrap();
    assert_eq!(outbox.status_of(3), "submitted");
    assert_eq!(outbox.tx_hash_of(3).as_deref(), Some("deadbeefhash"));
}

#[tokio::test]
async fn submit_leaves_pending_on_submit_error() {
    let outbox = InMemoryOutbox::with_rows(vec![row(4, 1, "pending")]);
    let sub = MockSubmitter::new(|| Ok(true), || Err(anyhow!("send failed")), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref()).await.unwrap();
    assert_eq!(outbox.status_of(4), "pending");
}

#[tokio::test]
async fn submit_fails_row_when_id_out_of_u32_range() {
    // loan_id = u32::MAX + 1
    let mut bad = row(0, 1, "pending");
    bad.loan_id = BigDecimal::from(u64::from(u32::MAX) + 1);
    let outbox = InMemoryOutbox::with_rows(vec![bad]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Ok(None));
    submit_pending_stellar(&settings(), sub.as_ref(), outbox.as_ref()).await.unwrap();
    // loan_id key for status lookup is the oversized value
    let st = outbox.rows.lock().unwrap()[0].status.clone();
    assert_eq!(st, "failed");
    assert_eq!(*sub.submit_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn confirm_marks_confirmed_on_success() {
    let outbox = InMemoryOutbox::with_rows(vec![row(5, 1, "submitted")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Ok(Some(true)));
    confirm_submitted_stellar(&settings(), sub.as_ref(), outbox.as_ref()).await.unwrap();
    assert_eq!(outbox.status_of(5), "confirmed");
}

#[tokio::test]
async fn confirm_marks_failed_on_failed() {
    let outbox = InMemoryOutbox::with_rows(vec![row(6, 1, "submitted")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Ok(Some(false)));
    confirm_submitted_stellar(&settings(), sub.as_ref(), outbox.as_ref()).await.unwrap();
    assert_eq!(outbox.status_of(6), "failed");
}

#[tokio::test]
async fn confirm_leaves_submitted_when_in_flight() {
    let outbox = InMemoryOutbox::with_rows(vec![row(7, 1, "submitted")]);
    let sub = MockSubmitter::new(|| Ok(true), || Ok("h".into()), || Ok(None));
    confirm_submitted_stellar(&settings(), sub.as_ref(), outbox.as_ref()).await.unwrap();
    assert_eq!(outbox.status_of(7), "submitted");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p pipeline-worker --test stellar_yield_mint`
Expected: FAIL — `submit_pending_stellar`, `confirm_submitted_stellar`, `StellarPhase4Settings` not defined.

- [ ] **Step 3: Implement settings, the u32 range helper, and the orchestration fns**

Append to `packages/worker/src/relayer/stellar/yield_mint.rs`. Add imports at the top:

```rust
use bigdecimal::{BigDecimal, ToPrimitive};

use shared::yield_mint_outbox_repo::{OutboxKey, OutboxStore, YieldMintOutboxRepo};
```

Then:

```rust
/// Settings consumed by the Stellar yield-mint phase.
pub struct StellarPhase4Settings {
    pub chain_id: i64,
    pub yield_minter_id: ContractStrkey,
    pub loan_registry_id: ContractStrkey,
    pub batch_size: usize,
}

/// Range-check a `NUMERIC` id into `u32`. Returns `None` if out of range.
pub fn u32_from_bigdecimal(v: &BigDecimal) -> Option<u32> {
    v.to_u32()
}

fn key_of(row: &shared::yield_mint_outbox_repo::YieldMintOutboxRow) -> OutboxKey {
    OutboxKey {
        chain_id: row.chain_id,
        yield_minter_address: row.yield_minter_address.clone(),
        loan_id: row.loan_id.clone(),
        repayment_id: row.repayment_id.clone(),
    }
}

/// Run one Stellar yield-mint cycle: discover → submit → confirm.
///
/// Per-row errors are logged and skipped. Only a DB list failure aborts the
/// cycle (returns `Err`); the relayer loop and other phases are unaffected.
pub async fn phase_yield_mint_stellar(
    settings: &StellarPhase4Settings,
    submitter: &dyn StellarYieldSubmitter,
    outbox: &YieldMintOutboxRepo,
) -> Result<()> {
    let minter_addr = settings.yield_minter_id.to_string();
    let registry_addr = settings.loan_registry_id.to_string();

    let inserted = outbox
        .discover_pending_stellar(settings.chain_id, &minter_addr, &registry_addr)
        .await?;
    if inserted > 0 {
        tracing::info!(count = inserted, "stellar yield_mint: discovered new pending rows");
    }

    submit_pending_stellar(settings, submitter, outbox).await?;
    confirm_submitted_stellar(settings, submitter, outbox).await?;
    Ok(())
}

pub async fn submit_pending_stellar(
    settings: &StellarPhase4Settings,
    submitter: &dyn StellarYieldSubmitter,
    outbox: &dyn OutboxStore,
) -> Result<()> {
    let minter_addr = settings.yield_minter_id.to_string();
    let pending = outbox
        .list_pending(settings.chain_id, &minter_addr, settings.batch_size as i64)
        .await?;

    for row in pending {
        let key = key_of(&row);
        let loan_disp = row.loan_id.to_string();
        let rep_disp = row.repayment_id.to_string();

        let (Some(loan_id), Some(repayment_id)) = (
            u32_from_bigdecimal(&row.loan_id),
            u32_from_bigdecimal(&row.repayment_id),
        ) else {
            tracing::error!(loan_id = loan_disp, repayment_id = rep_disp,
                "stellar yield_mint: id out of u32 range — marking failed");
            if let Err(e) = outbox.mark_failed(&key, "loan_id or repayment_id out of u32 range").await {
                tracing::error!(error = %e, "stellar yield_mint: DB error marking failed (range)");
            }
            continue;
        };

        match submitter.can_yield_be_minted(loan_id, repayment_id).await {
            Ok(false) => {
                tracing::info!(loan_id, repayment_id,
                    "stellar yield_mint: can_yield_be_minted=false, marking skipped_already_minted");
                if let Err(e) = outbox.mark_skipped_already_minted(&key).await {
                    tracing::error!(error = %e, "stellar yield_mint: DB error marking skipped");
                }
                continue;
            }
            Err(e) => {
                tracing::warn!(loan_id, repayment_id, error = %e,
                    "stellar yield_mint: transient guard failure, retrying next cycle");
                continue;
            }
            Ok(true) => {}
        }

        match submitter.submit_mint_yield(loan_id, repayment_id).await {
            Ok(tx_hash) => {
                tracing::info!(loan_id, repayment_id, tx_hash, "stellar yield_mint: pending -> submitted");
                if let Err(e) = outbox.mark_submitted_stellar(&key, &tx_hash).await {
                    tracing::error!(error = %e, "stellar yield_mint: DB error marking submitted");
                }
            }
            Err(e) => {
                // No terminal failure on submit errors: re-submit is safe
                // (consume_yield is idempotent on-chain).
                tracing::warn!(loan_id, repayment_id, error = %e,
                    "stellar yield_mint: submit failed, retrying next cycle");
            }
        }
    }
    Ok(())
}

pub async fn confirm_submitted_stellar(
    settings: &StellarPhase4Settings,
    submitter: &dyn StellarYieldSubmitter,
    outbox: &dyn OutboxStore,
) -> Result<()> {
    let minter_addr = settings.yield_minter_id.to_string();
    let submitted = outbox
        .list_submitted(settings.chain_id, &minter_addr, settings.batch_size as i64)
        .await?;

    for row in submitted {
        let key = key_of(&row);
        let loan_disp = row.loan_id.to_string();
        let Some(tx_hash) = row.tx_hash.clone() else {
            tracing::error!(loan_id = loan_disp, "stellar yield_mint: submitted row has no tx_hash");
            continue;
        };

        match submitter.check_tx(&tx_hash).await {
            Ok(Some(true)) => {
                tracing::info!(loan_id = loan_disp, tx_hash, "stellar yield_mint: submitted -> confirmed");
                if let Err(e) = outbox.mark_confirmed(&key, &tx_hash).await {
                    tracing::error!(error = %e, "stellar yield_mint: DB error marking confirmed");
                }
            }
            Ok(Some(false)) => {
                let msg = format!("stellar yield_mint tx FAILED on-chain: {tx_hash}");
                tracing::error!(loan_id = loan_disp, tx_hash,
                    "stellar yield_mint: tx FAILED on-chain — row terminated with status=failed (operator review)");
                if let Err(e) = outbox.mark_failed(&key, &msg).await {
                    tracing::error!(error = %e, "stellar yield_mint: DB error marking failed (on-chain FAILED)");
                }
            }
            Ok(None) => {
                tracing::info!(loan_id = loan_disp, tx_hash,
                    "stellar yield_mint: tx not yet terminal, retrying next cycle");
            }
            Err(e) => {
                tracing::warn!(loan_id = loan_disp, tx_hash, error = %e,
                    "stellar yield_mint: transient failure polling tx, retrying next cycle");
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Run the orchestration tests to verify they pass**

Run: `cargo test -p pipeline-worker --test stellar_yield_mint`
Expected: all tests PASS.

- [ ] **Step 5: Clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/relayer/stellar/yield_mint.rs packages/worker/tests/stellar_yield_mint.rs
git commit -m "feat(relayer): add Stellar yield-mint phase orchestration with unit tests"
```

---

### Task 4: Config — optional yield-minter / loan-registry contract ids

Extend `StellarRelayerSettings` with the two optional Soroban contract ids, parsed only when present so existing Stellar deployments are unaffected.

**Files:**
- Modify: `packages/worker/src/relayer/config.rs:70-143`

**Interfaces:**
- Produces: `StellarRelayerSettings.yield_minter_id: Option<Contract>`, `StellarRelayerSettings.loan_registry_id: Option<Contract>`.

- [ ] **Step 1: Add the optional fields to the struct**

In `packages/worker/src/relayer/config.rs`, in `pub struct StellarRelayerSettings` (after `plusd_sac_id`, around line 76):

```rust
    /// Soroban yield-minter contract id. `None` disables the yield-mint phase.
    pub yield_minter_id: Option<Contract>,
    /// Soroban loan-registry contract id — `can_yield_be_minted` view target and
    /// `PaymentRecorded` discovery filter. `None` disables the yield-mint phase.
    pub loan_registry_id: Option<Contract>,
```

- [ ] **Step 2: Parse the optional ids in `from_chain_env`**

In `StellarRelayerSettings::from_chain_env`, before the final `Ok(Self { ... })` (around line 130). Use a local helper that returns `Ok(None)` when the env var is absent but `Err` when present-but-invalid (so a typo is loud, not silently skipped):

```rust
        let parse_opt_contract = |suffix: &str| -> Result<Option<Contract>> {
            let key = format!("{p}{suffix}");
            match env::var(&key) {
                Err(_) => Ok(None),
                Ok(raw) => {
                    let validated = validate_contract_id(&key, raw)?;
                    let c = Contract::from_string(&validated)
                        .map_err(|e| anyhow::anyhow!("{key} failed Strkey parse: {e}"))?;
                    Ok(Some(c))
                }
            }
        };
        let yield_minter_id = parse_opt_contract("YIELD_MINTER_ID")?;
        let loan_registry_id = parse_opt_contract("LOAN_REGISTRY_ID")?;
```

Then add `yield_minter_id,` and `loan_registry_id,` to the `Ok(Self { ... })` initializer.

- [ ] **Step 3: Build**

Run: `cargo build -p pipeline-worker`
Expected: builds.

- [ ] **Step 4: Clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/relayer/config.rs
git commit -m "feat(relayer): parse optional Stellar yield-minter/loan-registry contract ids"
```

---

### Task 5: Wire the phase into the Stellar relayer loop + docs

Construct the submitter once (when configured) and run the phase each cycle after the whitelist phase. Update the stale module doc and backend reference.

**Files:**
- Modify: `packages/worker/src/relayer/stellar/job.rs`
- Modify: `docs/references/backend.md`

**Interfaces:**
- Consumes: `StellarYieldMinter::new`, `StellarPhase4Settings`, `phase_yield_mint_stellar`, `YieldMintOutboxRepo`, `StellarRelayerSettings.{yield_minter_id, loan_registry_id, ...}`, `kyc_repo.pool`.

- [ ] **Step 1: Update the module doc comment**

In `packages/worker/src/relayer/stellar/job.rs`, replace the line:

```
//! Sumsub (Phase 1) is a no-op everywhere — Sumsub statuses are populated by
//! the API's webhook handler. Crystal (Phase 2) is skipped because Crystal does
//! not support Stellar today. Phase 4 (yield-mint) has no Soroban counterpart.
```

with:

```
//! Sumsub (Phase 1) is a no-op everywhere — Sumsub statuses are populated by
//! the API's webhook handler. Crystal (Phase 2) is skipped because Crystal does
//! not support Stellar today. Phase 4 (yield-mint) runs when the yield-minter
//! and loan-registry contract ids are configured — it signs `mint_yield`
//! directly with the relayer keypair (no BitGo).
```

- [ ] **Step 2: Build the submitter before the loop**

In `run_stellar_relayer_inner`, after the `whitelister` is constructed and before `let chain_id = settings.chain_id;`, add imports at the top of the file:

```rust
use shared::yield_mint_outbox_repo::YieldMintOutboxRepo;

use crate::relayer::stellar::yield_mint::{
    phase_yield_mint_stellar, StellarPhase4Settings, StellarYieldMinter,
};
```

Then:

```rust
    // Phase 4 (yield-mint): enabled only when both contract ids are configured.
    let yield_mint = match (settings.yield_minter_id, settings.loan_registry_id) {
        (Some(yield_minter_id), Some(loan_registry_id)) => {
            let submitter = StellarYieldMinter::new(
                &settings.rpc_url,
                settings.network_passphrase.clone(),
                settings.signing_key.clone(),
                yield_minter_id,
                loan_registry_id,
            );
            let outbox = YieldMintOutboxRepo::new(kyc_repo.pool.clone());
            let phase_settings = StellarPhase4Settings {
                chain_id: settings.chain_id,
                yield_minter_id,
                loan_registry_id,
                batch_size: settings.batch_size,
            };
            tracing::info!(
                chain_id = settings.chain_id,
                yield_minter = %yield_minter_id,
                loan_registry = %loan_registry_id,
                "stellar yield-mint phase enabled"
            );
            Some((submitter, outbox, phase_settings))
        }
        _ => {
            tracing::info!(
                chain_id = settings.chain_id,
                "stellar yield-mint phase disabled (YIELD_MINTER_ID/LOAN_REGISTRY_ID unset)"
            );
            None
        }
    };
```

Note: `StellarYieldMinter::new` consumes `signing_key`; the whitelister also needs one, so this uses `settings.signing_key.clone()`. `SigningKey` is `Clone`. Confirm the whitelister construction still moves/uses `settings.signing_key` correctly — if both need it, clone for the whitelister too (it currently takes `settings.signing_key`; change that to `settings.signing_key.clone()` if the borrow checker complains after adding the yield-mint construction below it).

- [ ] **Step 3: Call the phase inside the loop**

In the `loop { ... }` body, after the `phase_sync_whitelist_stellar(...)` call and before the `tokio::time::sleep(...)`:

```rust
        // Phase 4: yield-mint (when configured).
        if let Some((submitter, outbox, phase_settings)) = yield_mint.as_ref() {
            if let Err(e) = phase_yield_mint_stellar(phase_settings, submitter, outbox).await {
                tracing::error!(error = %e,
                    "stellar phase_yield_mint: cycle aborted (other phases unaffected)");
            }
        }
```

- [ ] **Step 4: Build and run the full worker test suite**

Run: `cargo build -p pipeline-worker && cargo test -p pipeline-worker`
Expected: builds; all tests PASS (including `stellar_yield_mint` and `yield_mint_phase_4`).

- [ ] **Step 5: Document the phase and env vars in `backend.md`**

In `docs/references/backend.md`, find the relayer / Phase 4 (yield-mint) section. Add a subsection documenting the Stellar counterpart:

```markdown
#### Stellar yield-mint phase

The Stellar relayer runs a yield-mint phase parallel to EVM Phase 4. It reuses
the `yield_mint_outbox` table (discover → submit → confirm) but signs
`yield_minter.mint_yield(caller, loan_id, repayment_id)` directly with the
relayer ed25519 keypair — no BitGo. Double-mint is prevented on-chain by
`loan_registry.consume_yield`; the `can_yield_be_minted` view is a pre-submit
optimization. On-chain `FAILED` is terminal (`failed`, operator review).

The phase is enabled only when both contract ids are configured:

- `CHAIN_<id>_RELAYER_STELLAR_YIELD_MINTER_ID` — Soroban `C…` yield-minter id.
- `CHAIN_<id>_RELAYER_STELLAR_LOAN_REGISTRY_ID` — Soroban `C…` loan-registry id
  (discovery filter + `can_yield_be_minted` target).
- Batch size reuses `JOB_RELAYER_STELLAR_BATCH_SIZE` (default 50).

Operational prerequisite: the relayer signer keypair must hold the minter role on
the access-manager, and the yield-minter must hold the executor role (wired in
`pipeline-stellar-contracts`).
```

- [ ] **Step 6: Lint docs**

Run: `npx tsx scripts/lint-docs.ts`
Expected: passes.

- [ ] **Step 7: Clippy**

Run: `cargo clippy --all -- -D warnings`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/worker/src/relayer/stellar/job.rs docs/references/backend.md
git commit -m "feat(relayer): wire Stellar yield-mint phase into the relayer loop"
```

---

## Self-Review

**Spec coverage:**
- Async outbox confirm model → Tasks 2 (`submit_mint_yield` returns hash, no poll; `check_tx`) + 3 (separate confirm pass). ✓
- Terminal `failed` on on-chain FAILED → Task 3 `confirm_submitted_stellar` `Some(false)` arm. ✓
- Futurenet / network-agnostic → Task 4 env-driven config (no hardcoded network). ✓
- Reuse `yield_mint_outbox` → Task 1 (no migration). ✓
- Optional config / skip when unset → Tasks 4 + 5. ✓
- Stellar-shaped discovery (top-level `repayment_id`, `C…` address) → Task 1 `discover_pending_stellar`. ✓
- `mark_submitted_stellar` (tx hash, NULL bitgo id) → Task 1. ✓
- Testable trait seam → Task 2 `StellarYieldSubmitter`. ✓
- u32 range-check → Task 3 `u32_from_bigdecimal` + test. ✓
- Shared sim decoders / `u32_val` helper → Task 2. ✓
- Idempotency: submit errors non-terminal → Task 3 submit `Err` arm. ✓
- Tests pure (no DB) + external files → all tests in `tests/stellar_yield_mint.rs`. ✓
- Docs updates → Task 5 (module doc + backend.md). ✓

**Placeholder scan:** No TBD/TODO/"add error handling" — every code step shows full code. ✓

**Type consistency:** `StellarYieldSubmitter` methods (`can_yield_be_minted`/`submit_mint_yield`/`check_tx`) identical across Tasks 2, 3, 5. `StellarPhase4Settings` fields identical across Tasks 3, 5. `mark_submitted_stellar(key, tx_hash)` identical across Tasks 1, 3. `discover_pending_stellar(chain_id, addr, registry)` identical across Tasks 1, 3. `Option<Contract>` config fields (Task 4) matched by the `(Some, Some)` destructure (Task 5). ✓

**Known follow-up flagged inline:** Task 5 Step 2 notes the `signing_key` clone interaction with the existing whitelister construction — the implementer must confirm the borrow checker is satisfied and clone for the whitelister if needed.
