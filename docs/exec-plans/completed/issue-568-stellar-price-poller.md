# Issue #568: Stellar/Soroban: price-poller for staked_pipeline_usd vault

Source: https://github.com/eq-lab/pipeline/issues/568

## Scope

Add a price-poller task that records share-price snapshots from the Stellar `staked_pipeline_usd` (`FungibleVault` — Soroban analog of ERC-4626) into the same `share_prices` table the EVM poller already feeds. Today `PricePollerSettings::all_evm_from_env` (`packages/worker/src/price_poller/config.rs:67`) skips Stellar chains silently — this Issue extends per-chain dispatch with a Stellar variant that polls the current ledger only (no historical backfill — see §Assumptions).

This Issue also introduces a new `packages/worker/src/stellar/` module that holds chain-protocol-level encoders + decoders shared by the indexer (#528), relayer (#562), and this price-poller. The introduction is driven by the price-poller's reuse of #562's `build_invoke_envelope` and #528's `extract_i128`; rather than cross-import from job-namespaced modules, both helper groups are promoted to a shared protocol module.

### In scope

#### Shared protocol module — new `packages/worker/src/stellar/`

A new sibling module under `worker/src/` consolidates chain-protocol-level helpers:

```
packages/worker/src/stellar/
├── mod.rs          ← pub mod tx; pub mod scval;
├── tx.rs           ← moved from relayer/stellar/tx.rs
│                     build_invoke_envelope, build_set_authorized_operation_scval,
│                     sign_envelope, envelope_to_base64, compute_tx_hash,
│                     address_account, address_contract, symbol, bytes_32, map_entry
└── scval.rs        ← extract_i128 moved from indexer/stellar/parsers.rs
                      (indexer-specific log-parsing stays in indexer/stellar/parsers.rs)
```

Touchpoints in already-merged code:

- `relayer/stellar/whitelist.rs` — update imports from `crate::relayer::stellar::tx::*` to `crate::stellar::tx::*`
- `relayer/stellar/mod.rs` — drop `pub mod tx;`
- `indexer/stellar/parsers.rs` — drop `extract_i128`, keep log-shape parsers; indexer mappers re-import `extract_i128` from `crate::stellar::scval`
- Existing tests in `tests/stellar_scval.rs`, `tests/stellar_parsers.rs`, and `tests/stellar_relayer_config.rs` — update import paths

No behavior change — pure refactor. Roughly 6–8 file-import updates.

#### Config layer — rename + enum dispatch

`packages/worker/src/price_poller/config.rs`:

- Rename existing `PricePollerSettings` → `EvmPricePollerSettings`. Body of `from_chain_env` is unchanged.
- Add new `StellarPricePollerSettings`:
  - `chain_id: i64`
  - `rpc_url: String`
  - `network_passphrase: String`
  - `poll_interval_secs: u64`
- Add unified enum:
  ```rust
  pub enum PricePollerSettings {
      Evm(EvmPricePollerSettings),
      Stellar(StellarPricePollerSettings),
  }
  impl PricePollerSettings {
      pub fn all_from_env() -> Result<Vec<Self>> { /* dispatch on parse_chain_type */ }
      pub fn chain_id(&self) -> i64 { /* match */ }
  }
  ```
- `StellarPricePollerSettings::from_chain_env` reads:
  - `CHAIN_<id>_PRICE_POLLER_STELLAR_RPC_URL` — optional → fallback `CHAIN_<id>_STELLAR_RPC_URL`
  - `CHAIN_<id>_PRICE_POLLER_STELLAR_NETWORK_PASSPHRASE` — optional → fallback `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE`; default `"Test SDF Network ; September 2015"` for `chain_id == 99_000_001`; otherwise error if both unset
  - `CHAIN_<id>_PRICE_POLLER_STELLAR_INTERVAL_SECS` — per-chain Stellar cadence, default `60`. Mirrors the per-chain RPC URL / passphrase pattern. Independent of the EVM arm's `JOB_PRICE_POLLER_POLL_INTERVAL_SECS` so the two chain kinds can be tuned separately (Soroban ledgers close every ~5s; EVM blocks every ~12s).
- **No `…_VAULT_ID` env var.** The vault address comes from `PositionRepo::get_vaults(chain_id)` — the Stellar settings only configure RPC + cadence.
- Delete `all_evm_from_env` and the `#[deprecated] all_from_env` shim.

#### Price-poller Stellar module — new `packages/worker/src/price_poller/stellar/`

```
packages/worker/src/price_poller/stellar/
├── mod.rs          ← pub mod job; pub mod poller; pub use job::run_stellar_price_poller_job;
├── poller.rs       ← StellarPricePoller helper + SamplePoint
└── job.rs          ← run_stellar_price_poller_job loop
```

`poller.rs`:

```rust
pub struct StellarPricePoller {
    pub rpc: StellarRpc,
    pub network_passphrase: String,
}

pub struct SamplePoint {
    pub ledger_seq: i64,
    pub ledger_close_time: DateTime<Utc>,   // Utc::now() at sample time; TD-18 tracks canonical close-time
    pub normalized_price: BigDecimal,
}

impl StellarPricePoller {
    pub async fn fetch_share_price(
        &self,
        vault_id: &Contract,
        share_decimals: i16,
        asset_decimals: i16,
    ) -> Result<SamplePoint>;
}
```

Inside `fetch_share_price`:

1. Build `shares = 10^share_decimals` as `i128`.
2. Build envelope via `crate::stellar::tx::build_invoke_envelope` (the promoted helper) with:
   - dummy source account `Ed25519Pub([0u8; 32])` — safe for simulate-only
   - `seq_num = 0`, `fee = 0`
   - no auth entries, no `soroban_data`
   - contract = `vault_id`, function = `"convert_to_assets"`, args = `[ScVal::I128(parts(shares))]`
3. `self.rpc.simulate_transaction(envelope_b64)` — bail on `Some(error)` or empty `results`.
4. Decode the first result's `return_value_xdr_base64` as `ScVal::I128` via `crate::stellar::scval::extract_i128`. On `None`: bail with `"expected ScVal::I128 return value"`.
5. Normalize: `BigDecimal::from(raw) / BigDecimal::from(10u128.pow(asset_decimals as u32))` — same shape as EVM path at `price_poller/mod.rs:71-76`.
6. Return `SamplePoint { ledger_seq: i64::try_from(sim.latest_ledger)?, ledger_close_time: Utc::now(), normalized_price }`.

`job.rs`:

```rust
pub async fn run_stellar_price_poller_job(
    settings: StellarPricePollerSettings,
    repo: Arc<PositionRepo>,
) -> Result<()> {
    let poller = StellarPricePoller::new(&settings.rpc_url, settings.network_passphrase.clone());
    let interval = Duration::from_secs(settings.poll_interval_secs);
    loop {
        let vaults = repo.get_vaults(settings.chain_id).await.unwrap_or_default();
        for vault in &vaults {
            let Ok(vault_id) = Contract::from_string(&vault.address) else {
                tracing::warn!(address = %vault.address, "invalid Strkey, skipping");
                continue;
            };
            match poller.fetch_share_price(&vault_id, vault.share_decimals, vault.asset_decimals).await {
                Ok(sample) => {
                    if let Err(e) = repo.insert_share_price(
                        settings.chain_id, &vault.address,
                        sample.ledger_seq, sample.ledger_close_time, &sample.normalized_price,
                    ).await {
                        tracing::warn!(vault = %vault.address, error = %e, "insert_share_price failed");
                    }
                }
                Err(e) => tracing::warn!(vault = %vault.address, error = %e, "fetch_share_price failed"),
            }
        }
        tokio::time::sleep(interval).await;
    }
}
```

Error tolerance mirrors EVM: per-vault errors warn-and-continue, never panic. Vault-load errors → `unwrap_or_default()` → empty iter → sleep.

Register the module in `packages/worker/src/price_poller/mod.rs`: `pub mod stellar;`.

#### `worker/main.rs` dispatch

Replace the `JOB_PRICE_POLLER_ENABLED` block (`main.rs:75-86`):

```rust
if env_bool("JOB_PRICE_POLLER_ENABLED") {
    let settings_per_chain = PricePollerSettings::all_from_env()?;
    let position_repo = Arc::new(PositionRepo::new(pool.clone()));
    for s in settings_per_chain {
        let chain_id = s.chain_id();
        let repo = position_repo.clone();
        tracing::info!(chain_id, "price poller job started");
        tokio::spawn(async move {
            let result = match s {
                PricePollerSettings::Evm(s)     => run_price_poller_job(s, repo).await,
                PricePollerSettings::Stellar(s) => run_stellar_price_poller_job(s, repo).await,
            };
            if let Err(e) = result {
                tracing::error!(chain_id, "price poller exited with error: {e:?}");
            }
        });
    }
}
```

EVM signature harmonization: change `run_price_poller_job` in `price_poller/mod.rs:29` from `pub async fn … -> ()` to `pub async fn … -> anyhow::Result<()>` with a trailing `Ok(())` after the `loop`. The function genuinely never returns `Err` (the loop swallows everything with `tracing::error!`); the change is purely a signature-shape decision so both job arms can be logged symmetrically.

#### Vault registry — new migration

`packages/shared/migrations/20260617000001_seed_stellar_splusd_vault.sql`:

```sql
INSERT INTO vaults (chain_id, address, name, asset_decimals, share_decimals)
VALUES (99000001, 'CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5', 'sPLUSD', 7, 7)
ON CONFLICT (chain_id, address) DO NOTHING;
```

Pre-merge verification step (coder runs this before pushing):

```bash
stellar contract invoke \
  --id CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN \
  --network testnet -- decimals
```

Expected output: `7`. If it returns something else, update both `asset_decimals` and `share_decimals` in the migration to match. Reasoning: PLUSD is a SAC and SACs use 7 decimals by Stellar Classic protocol convention; the vault's `decimals_offset = 0` per `pipeline-stellar-contracts/deployments/config.json:15`, so `Vault::decimals(e) = underlying_decimals + offset = 7`.

The `vaults.address` column is `TEXT` (already holds `0x…` EVM addresses) — uppercase `C…` Strkey IDs go in verbatim, no case change.

#### `.env.example` update

Replace the existing line at `.env.example:109` (`Price-poller is automatically skipped for Stellar chains (no EVM-compatible RPC).`) with:

```env
# Price-poller (Stellar) — samples staked_pl_usd.convert_to_assets(1 share) at the current ledger.
# Vault address comes from the `vaults` DB table; this section only configures RPC + cadence.
#
# Optional — RPC URL and passphrase fall back to the indexer's CHAIN_<id>_STELLAR_* vars when unset.
# CHAIN_99000001_PRICE_POLLER_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
# CHAIN_99000001_PRICE_POLLER_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
#
# JOB_PRICE_POLLER_START_BLOCK / _BLOCK_INTERVAL / _RPC_DELAY_MS are EVM-only and are
# ignored on the Stellar path (Soroban RPC has no historical state — see issue #568).
```

The block goes immediately after the existing `CHAIN_99000001_STELLAR_PLUSD_ASSET_ID` line so it lives in the Stellar section.

### Out of scope (explicit)

- **Historical backfill.** Soroban RPC exposes `simulateTransaction` against current state only. Gaps from downtime are accepted as missing rows; `get_avg_prices` time-bucketing smooths them.
- **Canonical ledger close-time.** Tracked as TD-18 — see §Brainstorm Decisions Q3.
- **Frontend changes.** `share_prices` UI surfaces are already chain-agnostic post #439/#528.
- **Refactoring the EVM poller loop body.** Only the signature changes for symmetry.
- **`PositionRepo::get_vaults` API change.** Existing SQL already accepts Stellar `chain_id` and any `TEXT` address.
- **Multiple Stellar vaults per chain.** The implementation iterates `get_vaults(chain_id)` like the EVM path — future-proof, but only one row seeded now.
- **KMS-backed signer.** Price-poller submits no transactions — no signing key needed. Dummy zero pubkey in the simulate envelope is a property of `build_invoke_envelope`'s signature, not a security surface.
- **Mainnet (`99_000_002`) seed row.** Follows when mainnet contracts deploy.
- **Mock-RPC test.** `mockito` is not a workspace dep; deterministic encode/decode unit tests cover the testable surface. A future Issue can add it if needed.

## Assumptions and Risks

- **Soroban RPC has no historical state.** Each tick samples once at the current ledger; downtime gaps are accepted (visible as missing rows in `share_prices`). The API smooths via existing `get_avg_prices` time-bucket averaging at `position_repo.rs:143`.
- **`block_number` column for Stellar = current ledger sequence.** Soroban returns `latestLedger` as `u64` in `simulateTransaction`; on-wire schema is `u32`. Testnet sequences in 2026-06 are ~7-8 figures and grow ~17,000/day — `i64::MAX` lasts ~17 quadrillion years. No column type change. The `UNIQUE(chain_id, vault_address, block_number)` key still upserts correctly since `chain_id = 99_000_001` partitions Stellar rows from EVM rows.
- **Ledger sequence collisions are impossible in practice.** Two ticks within the same ledger close window (~5s) produce the same `block_number` and `ON CONFLICT … DO NOTHING` skips the second. `JOB_PRICE_POLLER_POLL_INTERVAL_SECS` defaults to `60` — well above the ~5s ledger close cadence.
- **`convert_to_assets(shares: i128) -> i128` is a view.** Confirmed by reading `stellar_tokens-0.7.1/src/vault/mod.rs:107`. `FungibleVault::convert_to_assets` is `Vault::convert_to_assets` — low-level, no auth checks, deterministic against current state. Simulating from any (or all-zero) source account is safe.
- **PLUSD SAC decimals = 7.** Stellar Asset Contracts use 7 decimals by protocol convention; vault `decimals_offset = 0`. **Risk mitigation:** the coder verifies against the live SAC before merging — concrete command in the migration section above.
- **Dummy source_account on simulate.** `simulateTransaction` does not validate source-account existence or sequence number — it's a pure off-chain hot-replay against current ledger state. Using `Ed25519Pub([0u8; 32])` as the placeholder is safe; documented in code. **Risk:** if a future Soroban RPC change starts validating the source account on simulate, the dummy pubkey breaks. **Mitigation:** swap to the relayer's pattern (real signer pubkey, never signs).
- **Vault address case.** Existing `position_repo` queries use `LOWER(vault_address) = LOWER($2)` — identity-preserving for the uppercase `C…` Strkey canonical form. No correctness issue.
- **Ledger close timestamp.** `simulateTransaction` returns `latestLedger` (sequence) but not its close-time. Plan ships `Utc::now()` at sample time — accurate to within the polling interval (`≤60s`). The API's downstream bucketing tolerates this skew. TD-18 tracks the canonical-close-time path.
- **Promotion refactor blast radius.** Moving `build_invoke_envelope` out of `relayer/stellar/tx.rs` and `extract_i128` out of `indexer/stellar/parsers.rs` touches already-merged code from #562 and #528. Import-path updates only — no behavior change. Existing tests (`stellar_relayer_config.rs`, `stellar_scval.rs`, `stellar_parsers.rs`) verify nothing regresses.

## Open Questions

_None._ All five brainstorm questions are resolved below.

## Brainstorm Decisions

Recorded so future readers see what was considered and chosen (2026-06-16 brainstorm session):

1. **Vault registry shape.** **DB-driven via the `vaults` table**, seeded by a new migration. Mirrors the EVM pattern, keeps API + worker reading the same registry. Alternative considered: env-var config like #562's `CHAIN_<id>_RELAYER_STELLAR_*` — rejected because the registry would diverge between EVM and Stellar.
2. **`build_invoke_envelope` and tx-helpers location.** **Promoted to new `worker/src/stellar/tx.rs`** alongside other chain-protocol helpers. Reusing in place would cross-import a `relayer/`-namespaced helper into a price-poller module. Sets the pattern for future Stellar jobs (e.g., wasm-bumper #440).
3. **Ledger close-time source.** **`Utc::now()` at sample time**, plus a follow-up TD-18 to add canonical close-time via `getLedgerEntries(LedgerHeader)` if downstream consumers ever need exact-to-the-ledger timestamps. The default ≤60s skew is below the API's hour/day bucketing granularity.
4. **EVM `run_price_poller_job` signature.** **Harmonized to `anyhow::Result<()>`** in the same PR. ~5 lines touched; both job arms log fatal exits symmetrically from `main.rs`. Alternative considered: wrap the EVM arm in a closure in `main.rs` to keep zero touch on EVM code — rejected because the signature asymmetry leaks across the dispatch site.
5. **`extract_i128` and ScVal decoders location.** **Promoted to new `worker/src/stellar/scval.rs`** alongside the encoders. Indexer-specific log-shape parsers stay in `indexer/stellar/parsers.rs` — only the generic protocol-level decoders move.

Other decisions (already settled by the planner, preserved here):

6. **Per-chain split shape.** Enum dispatch via `PricePollerSettings::{Evm, Stellar}`, mirroring `RelayerSettings::{Evm, Stellar}` from #562.
7. **Cursor/backfill on Stellar.** Dropped entirely. Soroban has no historical state.
8. **`block_number` semantics for Stellar.** Current ledger sequence at sample time. No column rename — "ledger sequence" is the Soroban-flavored block height.
9. **Env var naming.** `CHAIN_<id>_PRICE_POLLER_STELLAR_*` with fallbacks to indexer's `CHAIN_<id>_STELLAR_*`.
10. **Dummy source_account on simulate.** All-zero `Ed25519Pub` is fine for a view-call (no signing, no submit).

## Implementation Steps

### 1. [DONE] Promote chain-protocol helpers to `packages/worker/src/stellar/`

New files:

- `packages/worker/src/stellar/mod.rs` — `pub mod tx; pub mod scval;`
- `packages/worker/src/stellar/tx.rs` — move all of `packages/worker/src/relayer/stellar/tx.rs`; keep public re-exports of the same symbols
- `packages/worker/src/stellar/scval.rs` — move `extract_i128` (and any companion ScVal decoders if there are any pure-shape ones) out of `packages/worker/src/indexer/stellar/parsers.rs`

Updates:

- `packages/worker/src/relayer/stellar/mod.rs` — drop `pub mod tx;`; update `pub use` re-exports
- `packages/worker/src/relayer/stellar/whitelist.rs` — update `crate::relayer::stellar::tx::*` imports to `crate::stellar::tx::*`
- `packages/worker/src/indexer/stellar/parsers.rs` — drop `extract_i128`, keep log-shape parsers
- `packages/worker/src/indexer/stellar/mappers.rs` — import `extract_i128` from `crate::stellar::scval`
- `packages/worker/src/lib.rs` — `pub mod stellar;` so tests can reach in
- `packages/worker/tests/stellar_scval.rs`, `tests/stellar_parsers.rs`, `tests/stellar_relayer_config.rs` — update import paths

Run `cargo clippy --all -- -D warnings && cargo test -p pipeline-worker` after this step to confirm pure refactor.

### 2. [DONE] Rename `PricePollerSettings` → `EvmPricePollerSettings` and add the enum dispatcher

File: `packages/worker/src/price_poller/config.rs`

- Rename struct + `from_chain_env`. Body unchanged.
- Delete `all_evm_from_env` and the `#[deprecated] all_from_env`.
- Add `StellarPricePollerSettings` struct (fields per §Scope) and `from_chain_env(chain_id)`.
- Add `PricePollerSettings::{Evm, Stellar}` enum with `all_from_env()` dispatching on `parse_chain_type` and `chain_id() -> i64`.
- Update reference sites: `worker/main.rs`, `worker/tests/chain_config.rs` (rename `PricePollerSettings::from_chain_env(88888)` to `EvmPricePollerSettings::from_chain_env(88888)` in `price_poller_from_chain_env_missing_rpc_url_is_error`).

### 3. [DONE] Create `packages/worker/src/price_poller/stellar/`

Files (new):

- `packages/worker/src/price_poller/stellar/mod.rs` — `pub mod job; pub mod poller; pub use job::run_stellar_price_poller_job;`
- `packages/worker/src/price_poller/stellar/poller.rs` — `StellarPricePoller` + `SamplePoint` (full bodies per §Scope)
- `packages/worker/src/price_poller/stellar/job.rs` — `run_stellar_price_poller_job` (full body per §Scope)

Register: `packages/worker/src/price_poller/mod.rs` — add `pub mod stellar;` and `pub use stellar::run_stellar_price_poller_job;`.

### 4. [DONE] Harmonize EVM `run_price_poller_job` to `Result<()>`

File: `packages/worker/src/price_poller/mod.rs:29`

- Change signature to `pub async fn run_price_poller_job(settings: EvmPricePollerSettings, repo: Arc<PositionRepo>) -> anyhow::Result<()>`.
- Add trailing `#[allow(unreachable_code)] Ok(())` after the `loop` (or restructure to return from an explicit exit path — the loop body genuinely never returns).
- No behavior change to the inner loop.

### 5. [DONE] Spawn the Stellar price-poller in `worker/main.rs`

File: `packages/worker/src/main.rs`

- Replace `JOB_PRICE_POLLER_ENABLED` block (lines 75-86) with the dispatcher per §Scope. Both arms call `.await` and the unified `result` is logged via `tracing::error!` on `Err`.

### 6. [DONE] Seed the testnet Stellar sPLUSD vault row

File: `packages/shared/migrations/20260617000001_seed_stellar_splusd_vault.sql` (new) — SQL per §Scope.

Pre-merge verification: `stellar contract invoke --id CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN --network testnet -- decimals`. Expected output `7`. If different, update both columns in the migration to match before merging.

### 7. [DONE] `.env.example` update

File: `.env.example`

- Replace the existing `Price-poller is automatically skipped for Stellar chains (no EVM-compatible RPC).` comment (line 109) with the Stellar price-poller block per §Scope.
- The block goes immediately after `CHAIN_99000001_STELLAR_PLUSD_ASSET_ID`.

### 8. [DONE] Lint, test, and migration check

- `cargo clippy --all -- -D warnings`
- `cargo test -p pipeline-worker -p shared`
- `sqlx migrate run` against a throwaway DB — confirm the new migration applies cleanly and idempotently (`ON CONFLICT` makes re-run a no-op)
- `npx tsx scripts/lint-docs.ts` if any doc files are touched

### 9. [DONE] Docs updates

- `docs/product-specs/staking.md` — file already documents `totalAssets() / totalSupply()` for sPLUSD. Append a paragraph near that discussion: "On Stellar, share prices are sampled at the **current** Soroban ledger every `JOB_PRICE_POLLER_POLL_INTERVAL_SECS` seconds. Historical backfill is not possible (Soroban RPC has no historical-state replay)."
- `ARCHITECTURE.md` — extend the per-chain-task paragraph (line ~120) by one sentence: the price-poller is now polymorphic via `CHAIN_<id>_TYPE`, parallel to the indexer and relayer.
- `docs/exec-plans/tech-debt-tracker.md` — open `TD-18: Stellar price-poller uses Utc::now() instead of canonical ledger close-time`.
- No changes to `docs/design-docs/multi-chain-kyc-sharding.md` (price-poller is not KYC-shaped).
- No changes to `docs/product-specs/price-feed.md` (that's the loan-pricing CCR feed, not the share-price snapshot table).

## Test Strategy

### Unit tests for config parsing (no DB, no live RPC)

File: `packages/worker/tests/stellar_price_poller_config.rs` (new — mirrors `stellar_relayer_config.rs`'s `ENV_LOCK` pattern):

- `stellar_price_poller_settings_happy_path` — `CHAINS=99000001`, `CHAIN_99000001_TYPE=stellar`, the `PRICE_POLLER_STELLAR_*` vars set; assert `from_chain_env` returns expected fields including default testnet passphrase.
- `stellar_price_poller_settings_rpc_url_fallback` — only `CHAIN_<id>_STELLAR_RPC_URL` set; assert fallback wins.
- `stellar_price_poller_settings_passphrase_fallback` — only `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE` set; assert fallback wins.
- `price_poller_settings_dispatches_evm_and_stellar` — `CHAINS=1,99000001` with `CHAIN_99000001_TYPE=stellar`; assert one `Evm` + one `Stellar` variant in order.

### Unit tests for the encode/decode path

File: `packages/worker/tests/stellar_price_poller_decode.rs` (new):

- `convert_to_assets_envelope_encoding` — build envelope with a fixture vault id + `shares = 10^7`; assert encoded `InvokeContractArgs.function_name == "convert_to_assets"` and `args[0]` is `ScVal::I128(parts(10_000_000))`.
- `extract_i128_roundtrip` — encode `ScVal::I128(parts(12_345_678))`, base64-wrap, hand to decoder, assert it returns `12_345_678`.
- `normalize_price_matches_evm_path` — raw `i128 = 1_234_567`, `asset_decimals = 7`; assert resulting `BigDecimal == 0.1234567`.

### Regression: promotion refactor (Step 1)

Existing tests in `tests/stellar_scval.rs`, `tests/stellar_parsers.rs`, and `tests/stellar_relayer_config.rs` continue to pass after import-path updates. `cargo clippy --all -- -D warnings` clean.

Grep gate to catch missed renames:

```bash
grep -rn 'PricePollerSettings\b' packages/worker/src packages/worker/tests \
  | grep -v 'EvmPricePollerSettings\|StellarPricePollerSettings\|::{Evm, Stellar}'
```

Should return only the new enum variant matchers.

### Live testnet smoke (manual — not CI gate)

Runbook to append to this exec plan as a Manual-Test Record before closing the Issue:

1. Bring up Postgres locally, run `sqlx migrate run`.
2. Set in `.env.local`:
   ```
   CHAINS=99000001
   CHAIN_99000001_TYPE=stellar
   CHAIN_99000001_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   JOB_PRICE_POLLER_ENABLED=true
   JOB_PRICE_POLLER_POLL_INTERVAL_SECS=10
   ```
3. `cargo run -p pipeline-worker` for ~60s.
4. `SELECT chain_id, vault_address, block_number, block_timestamp, price FROM share_prices WHERE chain_id = 99000001 ORDER BY block_number DESC LIMIT 5;` — assert ≥3 rows, monotonically-increasing `block_number` (= ledger sequence), `price` in the `~1.000…` range (an empty/unyielded vault returns `1.0000000` — that's correct, not a bug).
5. Append the observed first/last `(block_number, price)` pair and the local `.env.local` config to this exec plan, then mark the Issue ready for `executed → testing`.

## Docs to Update

- `.env.example` — Stellar price-poller config block (Step 7).
- `ARCHITECTURE.md` — one-line clarification that the price-poller is now polymorphic across EVM/Stellar (Step 9).
- `docs/product-specs/staking.md` — append a paragraph near the existing `totalAssets() / totalSupply()` share-price discussion noting Soroban-current-ledger-only sampling (Step 9).
- `docs/exec-plans/tech-debt-tracker.md` — open `TD-18` (Step 9).
- This exec plan — append the live-testnet smoke record before closing #568.
