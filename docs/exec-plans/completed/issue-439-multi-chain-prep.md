# Issue #439: Multi-chain prep: make api + worker chain-agnostic

Source: https://github.com/eq-lab/pipeline/issues/439

## Scope

Refactor `packages/api` and `packages/worker` so the application layer stops treating "the chain" as a process-wide singleton. After this Issue the codebase carries a `default_chain_id` plus per-chain maps (`HashMap<i64, …>`) for everything that was previously a single value, and the worker compiles against a `ChainEventPoller` trait so a Stellar implementation can later plug in without rewriting the indexer loop, parser registry, price poller, or relayer.

**In scope:**

- **API config / env:** rename `API_CHAIN_ID` → `DEFAULT_CHAIN_ID`; introduce `CHAINS=<csv>` and per-chain keys `CHAIN_<id>_SIGNER_KEY`, `CHAIN_<id>_DM_ADDRESS`, `CHAIN_<id>_WQ_ADDRESS` (exact shape locked below — see Implementation Step 1).
- **API `AppState`:** flip `chain_id` → `default_chain_id` and turn `voucher_signer`, `dm_domain`, `wq_domain` from `Option<_>` into `HashMap<i64, _>` (entries only for EVM chains that have a signer configured).
- **API routes:** every route that currently reads `state.chain_id` accepts an optional `chain_id` query param and falls back to `state.default_chain_id`. Voucher routes additionally accept `chain_id` and 400 when the chain has no signer.
- **Worker indexer:** extract a `ChainEventPoller` trait covering `latest_block`, `fetch_logs_since`/`poll`, and `get_block_timestamp`; refactor the existing `EvmEventPoller` into the first impl; refactor `index_once` / `index_loop` / `run_indexer_job` to consume the trait rather than the concrete `EvmEventPoller`.
- **Worker parsers:** split alloy-`SolEvent` coupling out of `indexer::mod.rs` into a per-chain event handler set so Stellar-equivalent decoders can later live next to a Horizon poller.
- **Worker config (all three jobs):** indexer / price-poller / relayer all switch from a single `JOB_<X>_CHAIN_ID` + `_ETH_RPC_URL` block to a per-chain list. Worker `main.rs` spawns one task per configured chain per enabled job.
- **DB schema sharding (Q1=B, resolved 2026-06-05):** add `chain_id BIGINT NOT NULL` to `lp_profiles` and `kyc_outbox`. New PK `(chain_id, wallet_address)` for `lp_profiles`; `kyc_outbox` keeps its `BIGSERIAL id` PK and carries `chain_id` as a data column with a chain-scoped partial index. Migration **derives** the backfill `chain_id` from `contract_logs` (single distinct chain → use it; empty → fall back to `1`; multi-chain → abort with explicit error). All reads/writes scope by `chain_id`. Rationale in new design doc — see Stage F step 17 and Stage G.
- **KYC routes (`/v1/kyc/*`):** previously chain-agnostic. With `lp_profiles` and `kyc_outbox` sharded, KYC writes need a `chain_id` (optional query param falling back to `default_chain_id`, same pattern as stats routes). Audit every handler.
- **Existing chain-blind reads, fix scoped in (collision/correctness):** `kyc_repo::get_deposit_request` / `get_withdrawal_request` / `is_request_claimed` — collision risk with multi-chain `contract_logs`. `is_on_chain_allowed(wallet)` → `is_on_chain_allowed(chain_id, wallet)` — forced by sharded `lp_profiles` (Q4=A). `populate_profiles_from_deposits(chain_id)` — takes a chain filter and upserts only that chain's `(chain_id, wallet)` pairs (per-chain relayer task calls it each cycle).
- **Smoke validation:** local indexer fixture run under `chain_id = 99999` continues to write the same events end-to-end.

**Explicitly out of scope (already enumerated in the Issue body, restated here so the coder doesn't drift):**

- Any Stellar code: no Horizon poller, no Soroban price reads, no Stellar contract addresses, no Stellar event decoders.
- Stellar voucher signing (if vouchers translate to Stellar at all — product TBD).
- Cross-chain bridging logic (PLUSD/USDC).
- Renaming `block_number` / `log_index` / `tx_hash` columns — the Stellar mapping convention (`ledger_sequence → block_number`, operation order → `log_index`) is documented but no DDL change.
- Pulling `eth_rpc_url` per chain out of the relayer's `EthereumWallet` setup any further than necessary — the relayer's whitelist phase stays EVM-only for now; only its config shape changes.
- Touching `frontend/`.

## Assumptions and Risks

- **Single deployment configured for a single EVM chain stays unchanged operationally.** Default env vars (`API_CHAIN_ID`, `JOB_INDEXER_CHAIN_ID`, etc.) are being renamed; this is a breaking infra change, but staging + prod each run one chain today so the migration is a one-deploy env rewrite. Document the new shape in `.env.example` and call it out in the PR description so the deploy-time rename is not missed. We do **not** keep backward compatibility on the old names — adding fallback parsing for renamed envs doubles the surface area and obscures the new shape.
- **`AppState` voucher maps are `HashMap<i64, _>`, not concurrent maps.** They are built once at startup, never mutated; the existing `Arc<AppState>` already gives us safe shared reads. No `RwLock`.
- **Voucher fallback semantics.** `/v1/deposits/.../voucher` and `/v1/withdrawals/.../voucher` accept an **optional** `chain_id` query param and fall back to `default_chain_id`. If the resolved chain has no signer configured → HTTP 400 (`"voucher signing not configured for chain X"`), per Issue body. This replaces the previous 503-when-signer-missing path. We keep 503 only as a transient "no signer config at all loaded" guard — but in practice once `CHAINS` is set with any entry, the per-chain check produces 400 for the missing chain.
- **`/v1/stats/yield` reference pattern is kept literally.** That route already takes a required `chain_id`. The Issue body explicitly says we do **not** add a fallback there — keeping the strict contract avoids a silent behaviour shift for the dashboard caller, which always passes `chain_id`.
- **`/v1/requests` (`analytics.rs`) and `/v1/emails` stay chain-agnostic.** `/v1/kyc/*` becomes chain-scoped because `lp_profiles` and `kyc_outbox` are now sharded (Q1=B). The same `chain_id` query-param-with-default-fallback pattern applies. `populate_profiles_from_deposits` is no longer global-by-design: it now upserts per `(chain_id, wallet)`.
- **`kyc_repo::get_deposit_request` and friends lack `chain_id` scoping.** Today this isn't a bug because there is one chain; with the new code it becomes a real collision risk. Tightening these reads inside this Issue is correct scope (the voucher routes depend on them and the per-chain map of signers / domains means the wrong-chain row produces a wrong signature). `is_on_chain_allowed` is in the same bucket and gets the same fix (Q4=A).
- **DDL migration is the highest-risk change.** Adds `chain_id` columns + composite PKs to `lp_profiles` and `kyc_outbox`. Single-chain installs back-fill with `DEFAULT_CHAIN_ID`. Migration is non-reversible in practice (PK change), so it must land cleanly in one shot with a tested rollback path documented in the migration file's comment. New file under `migrations/`, numbered after the latest existing migration.
- **Per-chain task spawn changes restart semantics.** With multiple indexers, a panic in one task no longer kills the worker process (each spawned future is independent). For dev parity with today's behaviour we propagate panics by logging on join error; existing `tokio::spawn(run_indexer_job(...))` already runs detached so this is no behavioural regression.
- **Trait design risk.** The worker's `index_once` currently relies on:
  - `poller.get_latest_block() -> u64`
  - `poller.poll(from, to) -> Vec<Box<dyn LogMapper>>`
  - `poller.get_block_timestamp(block_number, cache)` for per-mapper enrichment
  - cursor semantics keyed by EVM `block_number`.
  The trait must keep `u64` cursors for the EVM impl (drop-in) but be documented as a "monotonic per-chain cursor" so a future Stellar impl can use a ledger sequence (same `u64` shape) without renaming the type. The Stellar-side note in the Issue (`ledger_sequence → block_number`, synthesised `log_index`) is captured as a doc comment on the trait, no code change.
- **Existing tests.** `packages/worker/tests/parsers.rs` exercises `parse_*` symbols directly. The parser registry refactor must keep those exported (or expose an equivalent EVM helper) so the test file still compiles. Plan keeps the free functions; the change is to group them into a per-chain `EvmParserSet` registry that the new indexer wiring consumes.
- **DB schema audit risk.** Until the design doc lands, `lp_profiles` and `kyc_outbox` are treated as global. If the audit decision goes the other way (shard by chain), it falls under the documented decision but its DDL is a follow-up Issue — flagged in Open Questions.
- **Per-chain relayer task spawn introduces a multiplier on BitGo / Crystal usage.** Each chain spawns its own relayer loop with its own signer; the BitGo `bitgo_native_symbol` is per-chain by nature. The yield-mint outbox is already keyed by `(chain_id, yield_minter_address, …)` so it shards cleanly. The Issue scopes the relayer change to "per-chain config + per-chain signer (optionally)" — the implementation should default to one signer per chain so the change is symmetric with the indexer/price-poller layout.
- **PR #496 has no code yet (only the empty start commit).** All of the work below is greenfield within this branch.

## Open Questions / Resolutions

All five resolved via `/brainstorming` on 2026-06-05.

1. **DB schema audit — `lp_profiles` and `kyc_outbox`.** **Resolved: B — shard both by chain.** Add `chain_id` columns, composite PKs `(chain_id, wallet)` for `lp_profiles` and `(chain_id, …)` for `kyc_outbox`. Backfill existing rows with `DEFAULT_CHAIN_ID`. Rationale: defense-in-depth per chain, regulator-orderable per chain (e.g. block wallet X on chain Y without affecting other chains), audit isolation. Operational consequence: a wallet that wants to use a second chain must re-KYC there. Cross-chain "admin promote" path is deferred — file as a separate Issue if/when operationally needed. See Stage G for DDL + Stage F step 17 for the design doc.

2. **Per-chain env var shape.** **Resolved: A — flat `CHAIN_<id>_*` prefix.**
   ```
   CHAINS=1,99999                       # comma-separated chain ids
   DEFAULT_CHAIN_ID=1                   # required, must be a member of CHAINS
   # Per-chain (replace <id> with each chain id from CHAINS):
   CHAIN_<id>_SIGNER_KEY=0x...          # optional; voucher signing only on chains with a signer
   CHAIN_<id>_DM_ADDRESS=0x...          # required iff SIGNER_KEY set
   CHAIN_<id>_WQ_ADDRESS=0x...          # required iff SIGNER_KEY set
   # Worker per-chain (EVM):
   CHAIN_<id>_ETH_RPC_URL=https://...
   CHAIN_<id>_DM_CONTRACTS=...          # CSV, existing JOB_INDEXER_DM_CONTRACTS contents
   CHAIN_<id>_WQ_CONTRACTS=...
   CHAIN_<id>_SPLUSD_CONTRACTS=...
   CHAIN_<id>_LOAN_REGISTRY_CONTRACTS=...
   CHAIN_<id>_YIELD_MINTER_CONTRACTS=...
   CHAIN_<id>_START_BLOCK=...
   # Per-chain relayer (Q3=A):
   CHAIN_<id>_RELAYER_SIGNER_KEY=0x...
   CHAIN_<id>_RELAYER_REGISTRY_ADDRESS=0x...
   CHAIN_<id>_RELAYER_YIELD_MINTER_ADDRESS=0x...
   CHAIN_<id>_RELAYER_LOAN_REGISTRY_ADDRESS=0x...
   # Job-level (un-sharded):
   JOB_INDEXER_ENABLED=true
   JOB_PRICE_POLLER_ENABLED=true
   JOB_RELAYER_ENABLED=true
   JOB_INDEXER_POLLING_BLOCK_RANGE=...
   JOB_INDEXER_POLLING_INTERVAL_MS=...
   JOB_INDEXER_LOG_CONFIRMATIONS_DELAY=...
   BITGO_NATIVE_SYMBOL=...
   CRYSTAL_ENABLED=true
   ```

3. **Relayer per-chain signer.** **Resolved: A — per-chain.** Each chain has its own `CHAIN_<id>_RELAYER_SIGNER_KEY` plus per-chain registry / yield-minter / loan-registry addresses (listed above). Blast radius of a key compromise is one chain; future-proof for Stellar's ed25519 key type.

4. **`is_on_chain_allowed` scoping.** **Resolved: A — strict per-chain.** Signature becomes `is_on_chain_allowed(chain_id, wallet)`. Missing `(chain_id, wallet)` row → false. Forced by Q1=B; consistent with the sharded `lp_profiles` design. Cross-chain "inherit pass-status" (option B) and "admin promote" (option C) are explicitly out of scope for this Issue.

5. **Soroban / Stellar trait shape preview.** **Resolved: A — EVM-shaped + doc comment.** Keep the trait around the EVM call sites (`latest_block`, `poll`, `get_block_timestamp`) with `u64` cursors. Add a doc comment on the trait noting the Stellar mapping convention (`ledger_sequence → block_number`, operation order → synthesised `log_index`). Refactor the trait when the Stellar impl actually lands; speculating now risks the wrong abstraction.

## Implementation Steps

### Stage A — API: env config + AppState (small, mostly mechanical)

1. [x] **Env-var parsing.** Extend `packages/api/src/main.rs` with a new helper module `pipeline_api::config::ChainsConfig` (new file `packages/api/src/config.rs`, exported via `pub mod config;` in `lib.rs`).
   - Parses `CHAINS` as a comma-separated CSV of `i64`. Must be non-empty.
   - Parses `DEFAULT_CHAIN_ID` as `i64` (must be a member of `CHAINS`; else `anyhow::bail!`).
   - For each id in `CHAINS`, builds an optional `VoucherChainConfig { signer: PrivateKeySigner, dm_domain: Eip712Domain, wq_domain: Eip712Domain }`. If `CHAIN_<id>_SIGNER_KEY` is set, the two address vars are required. If not set, the chain is voucher-disabled.
   - Returns `ChainsConfig { default_chain_id: i64, voucher: HashMap<i64, VoucherChainConfig> }`.

2. [x] **`AppState`.** In `packages/api/src/lib.rs`:
   ```rust
   pub struct AppState {
       pub pool: sqlx::PgPool,
       pub kyc_repo: KycRepo,
       pub position_repo: PositionRepo,
       pub contract_logs_repo: ContractLogsRepo,
       pub default_chain_id: i64,
       pub sumsub_client: Option<SumsubClient>,
       pub sumsub_settings: Option<SumsubSettings>,
       pub voucher_signers: HashMap<i64, PrivateKeySigner>,
       pub dm_domains: HashMap<i64, Eip712Domain>,
       pub wq_domains: HashMap<i64, Eip712Domain>,
       pub crystal_enabled: bool,
   }
   ```
   Drop `voucher_signer`, `dm_domain`, `wq_domain`, `chain_id`.

3. [x] **`packages/api/src/main.rs`** wires the new config into `AppState` and removes the old `API_CHAIN_ID` / `API_SIGNER_KEY` / `API_DM_ADDRESS` / `API_WQ_ADDRESS` reads. The voucher-signer-missing tracing warn now logs per chain that has no signer.

### Stage B — API: routes

4. [x] **Common query helper.** Add a small `routes::common::ChainQuery { chain_id: Option<i64> }` (new module `packages/api/src/routes/common.rs`) with a helper `resolve_chain(state, q.chain_id) -> i64` returning `q.chain_id.unwrap_or(state.default_chain_id)`. No validation against `CHAINS`; the worker's per-chain config is independent from the API's awareness of a chain.

5. [x] **`stats.rs`** — three routes get a `ChainQuery` merged into their existing `Query<…>` type (use `serde(flatten)` so the OpenAPI `params(…)` lists the merged fields):
   - `/v1/stats` (`StatsQuery`) — add `chain_id: Option<i64>`; pass `resolve_chain(...)` into `compute_stats`.
   - `/v1/stats/prices` (`PricesQuery`) — same; thread through into both `get_earliest_price_timestamp` and `get_avg_prices`.
   - `/v1/stats/vaults` — currently takes `()`; introduce a new `VaultsQuery { chain_id: Option<i64> }` (matches Issue Acceptance Criterion: "All existing API routes that currently read `state.chain_id` accept an optional `chain_id` query param").
   Update `#[utoipa::path]` `params(…)` blocks accordingly.

6. [x] **`pnl.rs`** — extend `PnlQuery` with `chain_id: Option<i64>`. Resolve via the helper. Update `utoipa::path` params.

7. [x] **`vouchers.rs`** — extend `WalletQuery` with `chain_id: Option<i64>`.
   - Replace `(&state.voucher_signer, &state.dm_domain)` lookups with `state.voucher_signers.get(&chain_id)` + `state.dm_domains.get(&chain_id)` (and `wq_domains` for the withdrawal route). On miss, **HTTP 400** (`"voucher signing not configured for chain {chain_id}"`).
   - Pass `chain_id` into the KYC repo lookups (see step 8) so we read the right `contract_logs` row.
   - The EIP-712 domain object already carries `chain_id` internally (`Eip712Domain.chain_id`) which must equal the query chain — assert at config-load time (Stage A step 1), not in the hot path.

8. [x] **`shared::kyc_repo` — add chain scoping (expanded by Q1=B / Q4=A).** Extend the DB methods with a `chain_id: i64` parameter (or `(chain_id, wallet)` composite where the existing key was wallet-only):
   - `get_deposit_request(chain_id, request_id, wallet)` — add `AND chain_id = $N` to the SQL.
   - `get_withdrawal_request(chain_id, request_id, wallet)` — same.
   - `is_request_claimed(chain_id, claimed_event, request_id, contract_address)` — add `AND chain_id = $N`.
   - `is_on_chain_allowed(chain_id, wallet)` — reads from sharded `lp_profiles`; missing `(chain_id, wallet)` row → `false`.
   - `populate_profiles_from_deposits(chain_id)` — takes a chain filter, scans `contract_logs.DepositRequested WHERE chain_id = $1`, and upserts the resulting `(chain_id, wallet)` pairs. Called once per cycle by each per-chain relayer task with its own `chain_id`.
   - `kyc_outbox` writes/reads — thread `chain_id` through every call site (insertion + queue drain).
   Call sites to update: `packages/api/src/routes/vouchers.rs`, `packages/api/src/routes/kyc.rs`, and any worker consumers of `kyc_outbox` (search `kyc_outbox` across `packages/worker/`).
   Update `packages/worker/tests/mappers.rs` / any other call sites where these methods may be invoked.

9. [x] **`portfolio.rs`** — no behavioural change (already takes a required `chain_id` query). Verify it still compiles after dropping `state.chain_id`.

10. [x] **`analytics.rs`, `emails.rs`** — no change (these still read across all chains by design — a "recent requests" feed and an email-collection endpoint that should not partition by chain). Add a one-line comment in `analytics.rs` near the SQL pointing out the global-across-chains semantics with a link to the new design doc (Stage F step 17). **`kyc.rs` — chain-scoped now (Q1=B).** Every handler that writes to `lp_profiles` or `kyc_outbox` accepts an optional `chain_id` query param falling back to `default_chain_id`. KYC provider callbacks (Sumsub webhooks) carry the chain in either the callback URL path/query or in a per-(chain, wallet) submission ID — whichever already exists in the Sumsub integration. Audit `kyc.rs` end-to-end; the coder should call this out in the PR description so reviewers can sanity-check the chain plumbing on each handler.

### Stage C — Worker: trait for event polling

11. [x] **New file `packages/worker/src/indexer/chain_poller.rs`.** Defines:
   ```rust
   #[async_trait::async_trait]
   pub trait ChainEventPoller: Send + Sync {
       /// Latest finalised cursor on the source (EVM block, Stellar ledger).
       async fn latest_block(&self) -> anyhow::Result<u64>;

       /// Poll all decoded events in `[from, to]` as `LogMapper` boxes.
       async fn poll(&self, from: u64, to: u64) -> anyhow::Result<Vec<Box<dyn shared::log_mapper::LogMapper>>>;

       /// Per-event timestamp enrichment. EVM impl uses `eth_getBlockByNumber`;
       /// a Stellar impl can return ledger close time. `cache` is a per-cycle scratch.
       async fn get_block_timestamp(
           &self,
           block_number: u64,
           cache: &mut std::collections::HashMap<u64, u64>,
       ) -> anyhow::Result<u64>;
   }
   ```
   Move the existing concrete `EvmEventPoller` (already in `poller.rs`) to implement this trait (`impl ChainEventPoller for EvmEventPoller`). Keep the inherent methods so older direct callers (if any) still work; this preserves backwards-compat inside the crate.

12. [x] **`indexer::mod.rs`** — change `index_once` and `index_loop` signatures from `&EvmEventPoller` to `&dyn ChainEventPoller` (or generic `<P: ChainEventPoller>`; pick generic to keep static dispatch and avoid `async fn` in trait-object pain — `async_trait` makes either work, choose static for perf parity with today). `run_indexer_job` keeps building the `EvmEventPoller` for now and passes it as `&P`.

### Stage D — Worker: parser registry

13. [x] **New file `packages/worker/src/indexer/evm_parsers.rs`** (renamed from / additive to `parsers.rs`). Refactor `run_indexer_job` so the giant `EvmEventPollerBuilder::add_event_handler(…)` chain is wrapped in a public function:
   ```rust
   pub fn register_evm_handlers(
       builder: EvmEventPollerBuilder,
       chain_id: i64,
       contracts: EvmContractAddresses,
       repos: EvmRepos,
       loan_deps: EvmLoanDeps,
   ) -> EvmEventPollerBuilder { ... }
   ```
   `EvmContractAddresses`, `EvmRepos`, `EvmLoanDeps` are small wrapper structs that group what `run_indexer_job` already collects. The point is to keep the parsing code path explicit, EVM-tagged, and reusable per-chain.

   The existing free `parse_*` functions in `parsers.rs` stay where they are (tests depend on them). The new file `evm_parsers.rs` is a thin grouping layer.

14. [x] **Per-chain spawn.** Restructure `worker/src/main.rs` `JOB_INDEXER_ENABLED` block:
   ```rust
   if env_bool("JOB_INDEXER_ENABLED") {
       let settings_per_chain = IndexerJobSettings::all_from_env()?;
       for s in settings_per_chain {
           tokio::spawn(run_indexer_job(s, pool.clone()));
       }
   }
   ```
   `IndexerJobSettings::all_from_env()` returns `Vec<IndexerJobSettings>` by iterating the `CHAINS` CSV and pulling `CHAIN_<id>_*` for each. Single-chain installs declare `CHAINS=1` and continue to work.

### Stage E — Worker: price-poller + relayer config split

15. [x] **`price_poller/config.rs`** — add `PricePollerSettings::all_from_env() -> Vec<PricePollerSettings>` reading `CHAIN_<id>_ETH_RPC_URL` per chain, falling back to `CHAIN_<id>_*` indexer-shared values if not separately overridden (mirrors today's `JOB_PRICE_POLLER_ETH_RPC_URL` fallback to `JOB_INDEXER_ETH_RPC_URL`). `run_price_poller_job` already takes a single `PricePollerSettings`; spawn one task per chain.

16. [x] **`relayer/config.rs`** — same shape: `RelayerJobSettings::all_from_env() -> Vec<RelayerJobSettings>`. `chain_id`, `eth_rpc_url`, `signer_key`, `registry_address`, `yield_minter_address`, `loan_registry_address` all come from `CHAIN_<id>_RELAYER_*`. `bitgo_native_symbol`, `yield_minter_batch_size`, `interval_secs`, `sumsub_enabled`, `crystal_enabled` stay job-level (current `CRYSTAL_ENABLED` / `BITGO_NATIVE_SYMBOL` semantics). `run_relayer_job` keeps its single-settings signature; spawn one task per chain.

   The yield-mint outbox is already chain-scoped at the row level (`yield_mint_outbox.chain_id` is part of its PK), so per-chain relayer tasks reading their own slice works without further changes to `YieldMintOutboxRepo`.

### Stage F — Schema audit + docs

17. [x] **Design doc.** New `docs/design-docs/multi-chain-kyc-sharding.md` capturing the sharding decision for `lp_profiles` and `kyc_outbox` (Q1=B). Sections:
   - **Decision:** composite key `(chain_id, wallet)` on `lp_profiles`; `chain_id` added to `kyc_outbox` as a data column (BIGSERIAL `id` retained as PK) with a chain-scoped partial index for queue drain queries. KYC pipeline runs per chain.
   - **Rationale:** defense-in-depth (compromise / regulator order isolated to one chain); per-chain audit; future-proof for Stellar where the wallet address format differs anyway, and where the regulator may treat the two chains differently.
   - **Consequences:**
     - `populate_profiles_from_deposits(chain_id)` is per-chain — each relayer task calls it with its own `chain_id`.
     - `is_on_chain_allowed(chain_id, wallet)` returns `false` when no `(chain_id, wallet)` row exists.
     - `kyc_outbox` carries `chain_id`; the Sumsub webhook updates every chain's row in one atomic `UPDATE ... WHERE wallet_address = $1 RETURNING chain_id` and then enqueues an outbox row per returned chain.
   - **Known limitation — second-chain KYC propagation:** Sumsub fires webhooks only on identity status changes, so an already-Green wallet that deposits on a new chain ends up with an `(chain_id, wallet)` row that's never reached by a webhook. The relayer's `fetch_profiles_to_allow` filter requires `sumsub_kyc_status = Green`, so the wallet is silently locked on the new chain. Workaround: operator re-submits the applicant in Sumsub to retrigger a webhook. Long-term fix: the deferred cross-chain admin promote path (see below). The design doc captures this in detail.
   - **Operational impact:** UX migration is needed to explain per-chain KYC to users when a second chain lands — out of scope for this Issue, file separately.
   - **Deferred:** cross-chain "admin promote" path (Q4 option C) — **must** ship before a second chain goes live in production, otherwise every wallet that bridges hits the second-chain KYC trap above.

   Add the new doc to `docs/design-docs/index.md`'s table.

18. [x] **`.env.example`.** Rewrite the affected sections under Q2's shape. Keep current values as commented examples for `CHAINS=1`.

19. [x] **`ARCHITECTURE.md`.** No structural change but add a one-paragraph note under "Cross-Cutting Concerns" that the indexer / price-poller / relayer run one task per configured chain and the API resolves chain by query param with a `DEFAULT_CHAIN_ID` fallback.

20. [x] **`docs/product-specs/`.** `docs/product-specs/dashboards.md` does not cite `/v1/stats/*` or `/v1/pnl` endpoints; no spec change per plan (skip-if-no-cite rule).

### Stage G — DDL migrations (sequence-critical)

Stage G must land before any code that depends on the new columns compiles cleanly. In practice the coder writes the migration file first, applies it locally, regenerates the sqlx query cache (`cargo sqlx prepare` or the project's equivalent), and only then writes the application changes in Stage B / Stage C onwards. The Edit-Compile-Run loop only works once the schema is in place.

21. [x] **New migration file** under `migrations/` — follow the existing numbering scheme (look at the latest file there for the next number and naming convention).
    - `ALTER TABLE lp_profiles ADD COLUMN chain_id BIGINT NOT NULL DEFAULT 1;` (the `DEFAULT 1` is a one-time placeholder for the backfill — the column has no default in normal operation; immediately follow with `ALTER TABLE lp_profiles ALTER COLUMN chain_id DROP DEFAULT;`).
    - `ALTER TABLE lp_profiles DROP CONSTRAINT lp_profiles_pkey;` (or the actual constraint name from `init.sql`).
    - `ALTER TABLE lp_profiles ADD PRIMARY KEY (chain_id, wallet);`
    - Same shape for `kyc_outbox`: add `chain_id` with the same backfill default, then drop/recreate its PK to include `chain_id`.
    - Backfill value is `DEFAULT_CHAIN_ID`. For now we hard-code the existing prod chain id in the migration (likely `1` for mainnet); the coder confirms by checking the current `API_CHAIN_ID` in the deployed env and `init.sql` defaults.
    - **Indexes.** Audit every index on these two tables. Any index that was `(wallet)` for fast lookup should likely become `(chain_id, wallet)` or stay as a secondary `(wallet)` index if cross-chain wallet lookup is still required by `analytics.rs` / `emails.rs`. Document in the migration file's comment which secondary indexes are kept.
    - **No rollback script in this migration** (the project follows forward-only migrations per `migrations/init.sql` precedent). If rollback is ever needed, the inverse is mechanical — document the inverse SQL in the migration file's leading comment.

22. [BLOCKED] **sqlx offline query cache regeneration.** After applying the migration locally, run `cargo sqlx prepare --workspace` (or the project's equivalent) so the `.sqlx/` query cache reflects the new schema. Commit the regenerated cache files alongside the migration. The CI build will fail without this step. NOTE: No local Postgres available; `kyc_repo.rs` uses `sqlx::query_as` with raw strings (not `sqlx::query!` macros) so the `.sqlx/` offline cache does not need regeneration for these queries. Any CI check on the cache will continue to pass.

23. [BLOCKED] **Smoke validation.** After the migration applies in a local Postgres:
    - `SELECT chain_id, COUNT(*) FROM lp_profiles GROUP BY chain_id;` → all rows on the backfill `chain_id`.
    - `SELECT chain_id, COUNT(*) FROM kyc_outbox GROUP BY chain_id;` → same.
    - Insert a row with the same `(wallet)` but a different `chain_id` → succeeds (composite key works).
    - Try to insert a duplicate `(chain_id, wallet)` → fails (PK constraint).

## Test Strategy

The Issue's acceptance criterion is "existing EVM behaviour is preserved end-to-end (smoke-test against the local indexer fixture under `chain_id=99999`)" plus `cargo clippy --all -- -D warnings` clean and `/test-fast` green. The plan keeps the surface of changes mechanical, so testing is mostly regression-shaped.

**Unit tests (new):**

- `packages/api/src/config.rs` — `ChainsConfig::from_env()`:
  - Happy path: `CHAINS=1,99999`, `DEFAULT_CHAIN_ID=1`, both chains have signer configs → returns two voucher entries.
  - Default-chain not in `CHAINS` → returns `Err`.
  - Empty `CHAINS` → `Err`.
  - Chain with `SIGNER_KEY` but missing `DM_ADDRESS` → `Err` (mirrors today's `.expect`).
  - Chain without `SIGNER_KEY` → voucher map missing that key, no error.
- `packages/worker/src/indexer/config.rs::IndexerJobSettings::all_from_env()` — happy path + missing `CHAIN_<id>_*` required key.
- `packages/worker/src/price_poller/config.rs::PricePollerSettings::all_from_env()` — same pattern.
- `packages/worker/src/relayer/config.rs::RelayerJobSettings::all_from_env()` — same pattern; verifies per-chain `RELAYER_SIGNER_KEY` is required.
- `resolve_voucher_signing(state, chain_id) -> Result<(&PrivateKeySigner, &Eip712Domain), VoucherError>` (new pure helper in `vouchers.rs`):
  - Chain present in `voucher_signers` → returns the pair.
  - Chain missing from `voucher_signers` → returns `VoucherError::ChainNotConfigured(chain_id)`.
  - Helper does not touch the DB, so it's pure-function testable without `DATABASE_URL` (per project policy).
- `is_on_chain_allowed` SQL-building helper (if extracted) — keep the SQL string construction pure-function testable; the DB query itself is exercised manually in the smoke run.

**Integration / behavioural tests:**

- `packages/api/tests/vouchers_chain_param.rs` (new) — spin up an in-process `AppState` with two chains (memory mock pool not feasible; **DB-gated**: skip the test if `DATABASE_URL` isn't set, per the MEMORY rule "tests must not depend on a live Postgres without a gate" — *correction:* the MEMORY rule forbids env-gated DB reads outright, so this test must be pure-function instead). Concretely:
  - Move voucher resolution to a pure helper `resolve_voucher_signing(state, chain_id) -> Result<(&PrivateKeySigner, &Eip712Domain), VoucherError>` and unit-test that helper directly. The HTTP layer becomes a thin shell. No DB needed.
- `packages/api/tests/portfolio_compute.rs` — unchanged, still works.
- `packages/worker/tests/parsers.rs` — unchanged. Verify the move of `parse_*` registration into `evm_parsers.rs` did not break the public `pub use` paths the test imports.

**Smoke validation (manual, per acceptance criterion):**

- Local dev: set `CHAINS=99999`, `DEFAULT_CHAIN_ID=99999`, `CHAIN_99999_ETH_RPC_URL=<local fixture>`, …, run `cargo run -p pipeline_worker` and `cargo run -p pipeline_api`, hit `/v1/stats?chain_id=99999`, `/v1/stats/yield?chain_id=99999`, and a voucher endpoint with `?chain_id=99999`. Compare against pre-refactor output if available; otherwise verify the indexer cursor advances and contract_logs rows continue to land.
- Coder records the smoke result in a PR comment.

**Pre-merge gates (unchanged from project policy):**

- `cargo clippy --all -- -D warnings`
- `npx tsx scripts/lint-docs.ts` (since `.env.example`, design docs, exec plan touched).
- `/test-fast` green.

## Docs to Update

- `docs/design-docs/multi-chain-kyc-sharding.md` (new) — sharding decision for `lp_profiles` / `kyc_outbox` (Q1=B).
- `migrations/<next>_lp_profiles_kyc_outbox_chain_id.sql` (new) — adds `chain_id`, swaps PKs, backfills existing rows with `DEFAULT_CHAIN_ID`. See Stage G step 21.
- `.sqlx/` query cache — regenerate via `cargo sqlx prepare --workspace` after the migration applies; commit alongside.
- `docs/design-docs/index.md` — add the new entry to the table.
- `.env.example` — rewrite API + worker per-chain blocks; keep the current single-chain values as a commented example.
- `ARCHITECTURE.md` — one paragraph under "Cross-Cutting Concerns" describing the per-chain task model.
- `docs/product-specs/dashboards.md` — note that `/v1/stats/*` and `/v1/pnl` accept an optional `chain_id` (only if the file already references these endpoints; otherwise no change).
- `docs/exec-plans/active/issue-439-multi-chain-prep.md` (this file) — kept until the PR merges; manager moves it to `completed/` then.
