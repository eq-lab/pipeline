# Issue #528: Stellar/Soroban event indexer

Source: https://github.com/eq-lab/pipeline/issues/528

## Scope

Add a `StellarEventPoller` as the second concrete `ChainEventPoller` impl (the trait was shipped by Issue #439) and wire it into the worker's per-chain task spawn loop. The actual `#[contractevent]` declarations emitted by the **four event-emitting contracts** deployed on Stellar testnet (DepositManager, WithdrawalQueue, StakedPipelineUSD — plus AccessManager which is event-less in this iteration) land in `contract_logs` with a Stellar-sentinel `chain_id`, alongside the existing EVM indexer rows. No DDL change: `contract_address` is already `TEXT`, `block_number` is `BIGINT` (fits a `u32` ledger sequence), `log_index` is `INT` (fits Soroban's small per-tx operation/event counters), and `params` is `JSONB`.

**Event inventory** (verified against `pipeline-stellar-contracts` at commit `e569269`):

| Contract | Testnet ID | Events indexed | `event_name` stored |
|---|---|---|---|
| DepositManager | `CDM4Z2EM…` | `DepositRequested { request_id [t], user [t], amount }`, `RequestClaimed { request_id [t], user [t], amount }` *(from shared lib)* | `DepositRequested`, `RequestClaimed` |
| WithdrawalQueue | `CBERV5WQ…` | `WithdrawalRequested { withdrawer [t], request_id [t], amount, queued }`, `RequestClaimed { request_id [t], user [t], amount }` *(from shared lib)* | `WithdrawalRequested`, `RequestClaimed` |
| StakedPipelineUSD | `CDO4X3HC…` | `Deposit { operator [t], from [t], receiver [t], assets, shares }`, `Withdraw { operator [t], receiver [t], owner [t], assets, shares }` (inherited from `stellar_tokens::vault`) | **remapped to** `StakingDeposit`, `StakingWithdrawal` for EVM parity |
| AccessManager | `CBJUO44G…` | (no `#[contractevent]` declarations; timelock lib events deferred — see Q5) | n/a |

**Also emitted but not indexed** (mirrors the EVM-side indexer, which skips admin/governance events): `CustodianSet { new_custodian }` and `VerifierSet { new_verifier }` on both DM and WQ. These are admin operations with no API/UI consumer today — same precedent as EVM where the indexer doesn't track ownership-rotation events. If/when an operator console audit page wants them, file a follow-up issue.

**Notable shifts from the original issue body:**
- The planner's earlier inventory had `RequestEnqueued`/`RequestClaimed` only — that was incomplete; the deployed contracts also publish their own contract-specific `DepositRequested` / `WithdrawalRequested` from the **same call sites** where the shared `request_queue::enqueue_request` lib publishes `RequestEnqueued`. **Both fire per request.** The plan **indexes the contract-specific events only** and skips the generic `RequestEnqueued` to avoid double-writing rows with overlapping data (`DepositRequested`/`WithdrawalRequested` carry strictly more info — `WithdrawalRequested` adds `queued`, and the contract-specific name keeps EVM-side analytics SQL unchanged).
- **`RequestClaimed` IS emitted** by both DM and WQ via the shared `request_queue::claim_request` lib. Indexed normally; the API's `kyc_repo::is_request_claimed(chain_id, "RequestClaimed", request_id, contract_address)` already takes a contract address to disambiguate deposit-claim vs withdrawal-claim — no special-casing needed for cross-chain.
- **`WithdrawalRequested` has a new `queued: i128` field** (cumulative queued amount at this request's position) — not present on the EVM side. Mapper writes `params->>'queued'` so the FIFO position can be surfaced in the UI.
- **`StakedPipelineUSD` is a new contract** (commit `648273d`, deployed at `CDO4X3HC…`), the analog of the EVM sPLUSD ERC4626 vault. It uses `stellar_tokens::vault::Vault` so its events come from that library — `Deposit { operator, from, receiver, assets, shares }` and `Withdraw { operator, receiver, owner, assets, shares }`. **Remap** to `event_name='StakingDeposit'` / `'StakingWithdrawal'` at parse time so they merge with the existing EVM ERC4626 rows for cross-chain analytics symmetry.
- The shared-token `Transfer`/`Mint`/`Approve` events (also emitted by StakedPipelineUSD via `FungibleToken`) are **not indexed** — low signal for the API and would multiply row volume.

**In scope:**

- **New module `packages/worker/src/indexer/stellar/`** — split across:
  - `mod.rs` — re-exports the public surface.
  - `poller.rs` — `StellarEventPoller` implementing `ChainEventPoller` via the chosen Soroban RPC crate.
  - `parsers.rs` — pure decoder functions for the four events (`RequestEnqueued`, `RequestClaimed`, `CustodianSet`, `VerifierSet`) parsing the base64-encoded ScVal topic/value arrays from `getEvents`.
  - `mappers.rs` — Stellar variant of `ContractLogMapper` (Strkey addresses are `String`, not alloy `Address`).
  - `rpc.rs` — thin JSON-RPC wrapper around `getEvents`, `getLatestLedger` (and the `latestLedger` field on `getEvents` responses, since calling `getLatestLedger` separately is an extra round-trip we can avoid).
- **Per-chain config dispatch** — extend `packages/worker/src/indexer/config.rs` with a `CHAIN_<id>_TYPE=evm|stellar` discriminator (Open Q2, default A — see Open Questions). EVM remains the implicit default when the var is missing, so single-chain EVM installs stay byte-identical to the post-#439 shape.
- **New Stellar settings struct** — `StellarIndexerSettings` lives alongside `IndexerJobSettings` in `config.rs`. It reads the `CHAIN_<id>_STELLAR_*` block and shares the job-level `JOB_INDEXER_*` tuning knobs (polling interval, confirmations delay, etc.) with the EVM path.
- **Per-chain spawn refactor** — `worker/src/main.rs`'s `JOB_INDEXER_ENABLED` block dispatches per chain: an EVM-typed chain spawns `run_indexer_job` (unchanged); a Stellar-typed chain spawns `run_stellar_indexer_job` (new). Price-poller and relayer keep iterating but **skip Stellar-typed chains** (Soroban has no sPlUSD share token, no whitelist registry, no yield minter outbox today — see "Out of scope").
- **Shared write path stays chain-agnostic** — `EventRepo::insert_log` currently takes `event.contract_address.to_checksum(None)` on an alloy `Address`. Refactor: introduce an `EventRow` (the new, chain-agnostic shape — `contract_address: String`) and a parallel `EventRepo::insert_row(conn, row, chain_id)` that bypasses alloy. The existing `ContractLog` struct and `insert_log` stay for EVM callers (so the EVM mapper code path is untouched and the change is purely additive on the repo).
- **Event decoders + ScVal parsing** — use `stellar-xdr` (the official xdr-rs crate) to decode base64 ScVal blobs into native types: `u128` / `i128` / `Address` (Strkey G…/C…) / `BytesN<32>`. The four events all use `#[topic]` markers, so:
  - `RequestEnqueued`: topics = `[event_name_sym, request_id_u128, user_address]`, value = `i128` (amount).
  - `RequestClaimed`: same shape.
  - `CustodianSet`: topics = `[event_name_sym, new_custodian_address]`, value = unit.
  - `VerifierSet`: topics = `[event_name_sym, new_verifier_bytesn32]`, value = unit.
  - The `event_name_sym` topic is the canonical Soroban discriminator and how the parser dispatches.
- **New env vars under the `CHAIN_<id>_*` prefix** (issue body §"In scope"):
  - `CHAIN_<id>_TYPE=stellar`
  - `CHAIN_<id>_STELLAR_RPC_URL` (e.g. `https://soroban-testnet.stellar.org`)
  - `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE` (defaults to `Test SDF Network ; September 2015` for the testnet sentinel; required otherwise)
  - `CHAIN_<id>_STELLAR_DEPOSIT_MANAGER_ID` — emits `DepositRequested` + `RequestClaimed` *(`CustodianSet`/`VerifierSet` not indexed)*
  - `CHAIN_<id>_STELLAR_WITHDRAWAL_QUEUE_ID` — emits `WithdrawalRequested` + `RequestClaimed` *(`CustodianSet`/`VerifierSet` not indexed)*
  - `CHAIN_<id>_STELLAR_STAKED_PLUSD_ID` — sPLUSD vault analog. Emits `Deposit` / `Withdraw` (Vault), remapped to `StakingDeposit` / `StakingWithdrawal` for EVM parity.
  - `CHAIN_<id>_STELLAR_ACCESS_MANAGER_ID`, `_USDC_ASSET_ID`, `_PLUSD_ASSET_ID` — documented in `.env.example` for completeness; not used by the indexer in this iteration.
  - `CHAIN_<id>_START_LEDGER` — mapped to the `u64` cursor via the trait's "monotonic per-chain cursor" doc convention.
- **Smoke recipe in the PR description** — trigger a `request_deposit` against the deployed testnet DepositManager via the Stellar CLI (`stellar contract invoke …`) and SELECT the row out of `contract_logs`. Recipe lists the exact CLI invocation, expected row, and how to set `CHAINS=99000001` for a Stellar-only local run.

**Explicitly out of scope (file separately when needed):**

- **Stellar voucher signing on the API side.** The Soroban contracts use an on-chain ECDSA verifier (see `CHAIN_<id>_STELLAR_VERIFIER_KEY` in the contracts repo's `deployments/config.json`), not EIP-712 vouchers. Different model, needs its own design.
- **Stellar relayer / whitelist phase.** Soroban contracts have no `WhitelistRegistry` analog. The verifier signature replaces it. The relayer task **skips** Stellar chains; the issue body confirms this.
- **AccessManager governance event indexing.** `stellar_governance::timelock` emits operation-state events but they're not part of this cut. File separately if Phase-4-equivalent observability is needed on Stellar.
- **Frontend wiring.** Covered by epic #444.
- **Stellar mainnet deployment.** Testnet only. The mainnet sentinel (`99000002`) is reserved but not exercised here.
- **Soroban-side contract changes.** Contracts are assumed deployed and stable at the IDs in `pipeline-stellar-contracts/deployments/testnet.json`.
- **Touching the existing EVM code paths.** Any change that affects EVM behaviour is rejected. The discriminator in Open Q2 was specifically picked to keep the EVM `IndexerJobSettings::from_chain_env` untouched.

## Assumptions and Risks

- **Soroban RPC crate choice = `stellar-rpc-client` (Open Q1 default).** This is the SDF-maintained crate, currently published on crates.io, and depends on `stellar-xdr` for ScVal decoding. Risk: the crate's API has churned in late 2025 across the `21.x`/`22.x` series. The coder must pin a specific version in `Cargo.toml` and add it to the workspace deps. Mitigation: the only surface we need from it is `Client::new(rpc_url)`, `get_latest_ledger()`, and `get_events(GetEventsRequest { start_ledger, filters, pagination })`. If the published crate doesn't expose a clean enough Rust binding, we fall back to a hand-rolled JSON-RPC client (Soroban RPC is plain JSON-RPC over HTTP — already supported by `reqwest`, which is in workspace deps) plus `stellar-xdr` for ScVal decoding. The plan budgets ~2h for this fallback if the SDK crate proves uncooperative.
- **Soroban RPC has a 7-day lookback limit.** Per the SDF docs, `getEvents` only serves the last ~7 days of ledgers (RPC nodes prune older data; archival requires an indexer like Mercury or running a custom archival node). For a fresh deploy this is fine — `CHAIN_<id>_START_LEDGER` should be set to a value within the last 7 days. **Risk:** if the worker crashes for >7 days, the cursor falls outside the lookback window and the indexer cannot catch up. Mitigation: log a loud warning when the configured `start_ledger` (or current cursor) is more than 5 days behind `latestLedger`; the operator must either pick a fresh start ledger or run a Mercury-style backfill (out of scope for this issue). Document this in the smoke recipe.
- **ScVal `u128` and `i128` decoding.** Both encode as a pair of `u64` parts (`hi`, `lo`) per the XDR spec. The decoder must reassemble them into a `u128` / `i128` for storage as a JSON string (we never round-trip through JS `number`; `params->>'amount'` is already a string-encoded numeric in EVM rows, so this is consistent).
- **Address normalization (Open Q4) = store as-is.** Stellar Strkey addresses (G…/C…) are case-sensitive, have a built-in CRC-16 checksum, and are 56 chars wide. Lowercasing would corrupt the checksum. Decision: store raw Strkey. EVM addresses continue to use `to_checksum`. The mapper layer is the only place where these two conventions meet, so this is a per-mapper concern, not a repo concern. **Impact on queries:** `params->>'user' = $1` SQL queries on Stellar rows must pass the exact Strkey the user submitted; case-folding is not safe.
- **`chain_id` sentinel (Open Q3) = `99000001` (testnet), `99000002` (mainnet).** Both are well outside the EIP-155 ID space (which currently allocates up to ~9-digit integers, but is reserved to be globally unique on EVM). The `99M+` range is unused and obvious-on-sight as a non-EVM marker. The `BIGINT` column needs no DDL change. We document this scheme in `docs/design-docs/multi-chain-kyc-sharding.md` (already created by #439) and in `.env.example`.
- **`EventRepo::insert_log` is alloy-coupled** (`event.contract_address.to_checksum(None)`). Adding `insert_row(&EventRow, chain_id)` introduces a small parallel write path so the Stellar mapper never sees an alloy `Address`. Risk: drift between the two paths if a column is added to `contract_logs`. Mitigation: both call the same INSERT SQL (extract a private `insert_log_raw(conn, contract_address: &str, event_name, block_number, tx_hash, log_index, ts, params, chain_id)` helper). Two thin wrappers feed it. This is mechanical and keeps both code paths honest.
- **`is_duplicate` already takes `&str`** so the Stellar mapper plugs in unchanged.
- **The Soroban event `id` field is globally unique** (TOID + zero-padded event index). It would be a perfect natural key, but `contract_logs` keys on `(chain_id, contract_address, block_number, log_index)`. We synthesise `log_index = transaction_index * 1000 + operation_index * 100 + event_index` to fit in the existing `INT` column. **Risk:** if any Soroban tx ever emits >100 events from a single operation, or >10 operations per tx, the synthesis collapses. Mitigation: the events we care about each fire once per operation, and Soroban's per-op resource limits make >10 ops/tx unusual. Document the synthesis formula on the mapper. If we hit a collision in practice, we'd revisit `log_index` width — but that's a follow-up issue, not this one.
- **`block_timestamp` from `ledgerClosedAt`.** Soroban returns an ISO-8601 string (`2026-06-09T12:34:56Z`). We parse to Unix seconds (`chrono::DateTime::parse_from_rfc3339`) before storing. The `block_timestamp` column is `BIGINT` Unix seconds — same convention as EVM. The `ChainEventPoller::get_block_timestamp` for Stellar can avoid a second RPC call entirely because `getEvents` already returns `ledgerClosedAt` per event; the poller stores the parsed timestamp on the mapper at poll time (the trait's `get_block_timestamp(block_number, cache)` becomes a cache lookup with the result pre-populated by the poller). This is consistent with the trait shape; no refactor needed.
- **Empty-range polls** — `getEvents` requires a non-empty `start_ledger` window. The poller must guard against `from > latestLedger` and return early (`Ok(vec![])`), mirroring the EVM `index_once` check.
- **Confirmations delay.** EVM uses `log_confirmations_delay` (default 12 blocks) because of reorgs. Stellar has **deterministic finality at ledger close** (no reorgs), so the Stellar poller can read up to `latestLedger` with no safety margin. The `IndexerJobSettings` and `StellarIndexerSettings` both share `log_confirmations_delay`, but the Stellar poller passes `0` when calling `index_once` (override at the `run_stellar_indexer_job` level). Document this.
- **Multi-chain DDL precondition (from #439).** The lp_profiles/kyc_outbox sharding migration aborts when `contract_logs` has rows on >1 distinct `chain_id`. **First Stellar event ever indexed will push `contract_logs` to 2 chains.** This is fine on a fresh stage/prod deploy that has already run the #439 migration — the migration runs once, before this Stellar code lands. **Risk:** if a deploy is set up where #439's migration has not yet run, adding Stellar would block it. Mitigation: the issue/PR description must call out "run all migrations first, then enable the Stellar indexer." This is a deploy ordering concern, not a code change.
- **Dependency on the new Soroban RPC crate.** Adding `stellar-rpc-client` and `stellar-xdr` to `Cargo.toml` brings in a substantial dep tree (the Stellar ecosystem pulls in `wasmi`, `soroban-env-common`, etc. transitively). Build-time impact: +30–60s on a clean build. Workspace lock file grows by ~50 entries. Acceptable for the value delivered. If the dep tree is genuinely unmanageable, the hand-rolled JSON-RPC + minimal `stellar-strkey` + minimal `stellar-xdr` fallback (just the ScVal subset) cuts the tree to ~5 crates.
- **Test policy: pure unit tests only.** The MEMORY rule forbids env-gated DB or live-RPC tests. The plan covers parser tests against fixture JSON snapshots of `getEvents` responses (recorded once by hand against the deployed contracts; saved under `packages/worker/tests/fixtures/stellar/`). No live network in CI.
- **PR #529 is the open draft for this branch.** The branch already has an empty start commit; all code below is greenfield in this branch.

## Open Questions / Resolutions

All resolved via `/brainstorming` on 2026-06-09. Q1–Q5 confirmed the planner's defaults. Q6 was surfaced during the contracts-review pass, then resolved within the same pass after re-reading the shared `request_queue` lib (which **does** emit `RequestClaimed` from `claim_request()` — the planner had missed it but for a different reason than I initially diagnosed).

1. **Rust Soroban SDK choice.** **Resolved: A — `stellar-rpc-client` + `stellar-xdr` + `stellar-strkey`** (SDF-maintained crates). Documented fallback if the SDK's pinned version has unusable API churn: hand-rolled JSON-RPC via the existing `reqwest` dep + minimal `stellar-xdr`/`stellar-strkey` (half-day coding budget). Community `soroban-rs` ruled out (less maintained).

2. **EVM vs Stellar config discrimination.** **Resolved: A — `CHAIN_<id>_TYPE=evm|stellar` explicit discriminator.** EVM is the implicit default when the var is missing, so existing single-chain EVM installs need no env change. Cleanest extension path if a third chain family lands later. Auto-detect (option B) ruled out as ambiguous; parallel structs (option C) ruled out as the typo-silently-drops-chain risk is too high.

3. **Stellar `chain_id` integer.** **Resolved: A — sentinel range `99000001` (testnet) / `99000002` (mainnet).** Well outside the realistic EVM EIP-155 space, obvious-on-sight as non-EVM markers. BIP-44 coin type 148 (option B) ruled out — small numbers in the EIP-155 space risk silent collision with Coinbase-derivative EVM chains. Passphrase-hash (option C) ruled out — opaque large numbers hurt log readability.

4. **Address normalization for Stellar rows.** **Resolved: A — store Strkey G…/C… addresses as-is** (uppercase, with CRC-16 checksum, no transformation). Lowercasing corrupts the checksum and breaks SDK round-trips. EVM rows continue to use `to_checksum`. The two conventions live side-by-side in `contract_address: TEXT`; the mapper layer is the only place they touch.

5. **AccessManager / timelock events.** **Resolved: A — defer to a separate issue.** Verified by reading `contracts/access-manager/src/lib.rs`: the AccessManager itself declares no `#[contractevent]`, only inheriting from `stellar_governance::timelock` v0.7. With `min_delay = 0` in `deployments/config.json`, it's effectively a role-gated multisig. The downstream effects of timelock-driven changes (verifier/custodian rotation, contract upgrade) are already captured by `VerifierSet` / `CustodianSet` on DepositManager/WithdrawalQueue — what's missing is the governance *lineage* (who proposed/executed/canceled which op), and there's no API/UI consumer for that today. Matches the EVM-side pattern: pipeline doesn't deeply index Foundation Multisig (Safe) events either; operators reconstruct lineage on-demand from Stellar Lab when compliance asks. **Follow-up:** file a separate backlog issue once a consumer (operator console audit page, compliance report) asks for the trail. The follow-up would need to inventory `stellar_governance::timelock`'s actual event declarations first (~30 min).

6. **Claim-state tracking for Stellar requests.** **Resolved: parse `RequestClaimed` normally.** Originally flagged as an open question after a partial reading of the contracts (looking at each contract's own `event.rs` but missing that `request_queue::claim_request` publishes `RequestClaimed { request_id, user, amount }` from inside the library — both DM and WQ inherit this behaviour). The EVM-side API already queries `event_name='RequestClaimed'` with a contract address filter to disambiguate deposit-vs-withdrawal claims; Stellar rows slot into the same SQL with zero special-casing. No new contracts needed in scope; no `Mint`/`Transfer` event indexing required.

## Implementation Steps

### Stage A — Workspace deps

1. **Add Soroban deps to `Cargo.toml`.** In the workspace `[workspace.dependencies]` table:
   ```toml
   stellar-rpc-client = "21"   # pin to the latest stable on crates.io at coding time
   stellar-xdr        = { version = "21", features = ["std", "base64", "serde"] }
   stellar-strkey     = "0.0.13"
   ```
   In `packages/worker/Cargo.toml` add the three crates under `[dependencies]` (referencing `{ workspace = true }`).
   - The coder MUST verify the latest stable versions at code time via `cargo search stellar-rpc-client stellar-xdr stellar-strkey` and pin specific versions in the workspace table. The versions above are placeholders — confirm before committing.
   - If `stellar-rpc-client` fails to build on the current Rust toolchain (1.82+), fall back to direct `reqwest`-based JSON-RPC + the two utility crates. The plan budgets one half-day for this contingency.

### Stage B — Config: discriminator + Stellar settings

2. **Discriminator in `packages/worker/src/indexer/config.rs`.** Add a `pub enum ChainType { Evm, Stellar }` and a `pub fn parse_chain_type(chain_id: i64) -> ChainType` that reads `CHAIN_<id>_TYPE` (defaulting to `Evm` when unset or set to `"evm"`; returns `Stellar` when set to `"stellar"`; errors on any other value). EVM-only deployments need no env change.

3. **New `StellarIndexerSettings` struct in `config.rs`** (alongside `IndexerJobSettings`):
   ```rust
   pub struct StellarIndexerSettings {
       pub chain_id: i64,
       pub rpc_url: String,
       pub network_passphrase: String,
       pub start_ledger: u64,
       pub deposit_manager_id: String,                // emits DepositRequested + RequestClaimed
       pub withdrawal_queue_id: String,               // emits WithdrawalRequested + RequestClaimed
       pub staked_plusd_id: String,                   // emits Vault Deposit + Withdraw (remapped to Staking*)
       pub polling_interval_ms: u64,                  // shared JOB_INDEXER_POLLING_INTERVAL_MS
       pub polling_ledger_range: u64,                 // shared JOB_INDEXER_POLLING_BLOCK_RANGE semantics, ledger-count
   }

   impl StellarIndexerSettings {
       pub fn from_chain_env(chain_id: i64) -> Result<Self> { ... }
   }
   ```
   `START_LEDGER` falls back to `START_BLOCK` for symmetry with `ChainEventPoller`'s "monotonic cursor" doc convention. `polling_ledger_range` reuses `JOB_INDEXER_POLLING_BLOCK_RANGE` (default 1000) because Soroban RPC supports range queries up to ~7 days. The three `*_id` fields are all required — they're the contract addresses in the event filter; missing any of them aborts startup with a clear error.

   **Not in the struct** (env vars exist in `.env.example` for documentation but the indexer ignores them):
   - `CHAIN_<id>_STELLAR_ACCESS_MANAGER_ID` — its events aren't indexed (Q5), the indexer doesn't need its address.
   - `CHAIN_<id>_STELLAR_USDC_ASSET_ID`, `_PLUSD_ASSET_ID` — informational only; not in any event filter.

4. **Unified collection API.** Add a new enum to `config.rs`:
   ```rust
   pub enum IndexerSettings {
       Evm(IndexerJobSettings),
       Stellar(StellarIndexerSettings),
   }

   impl IndexerSettings {
       pub fn all_from_env() -> Result<Vec<Self>> { ... }   // dispatches per parse_chain_type
       pub fn chain_id(&self) -> i64 { ... }                // helper for log spans
   }
   ```
   `IndexerJobSettings::all_from_env()` (added by #439) **stays as-is** to avoid touching the EVM call site shape; the new `IndexerSettings::all_from_env()` is what `worker/main.rs` consumes after step 11.

### Stage C — Stellar RPC client

5. **New file `packages/worker/src/indexer/stellar/rpc.rs`** — a thin async wrapper around the Soroban RPC `getEvents` and `getLatestLedger` endpoints. Public surface:
   ```rust
   pub struct StellarRpc { /* client + url */ }

   pub struct EventFilter {
       pub contract_ids: Vec<String>,
       pub topic_filters: Vec<Vec<TopicMatcher>>,   // OR of topic patterns
   }

   pub struct RawEvent {
       pub contract_id: String,
       pub event_name: String,                       // decoded from topic[0] (Sym)
       pub topics_base64: Vec<String>,               // raw, the parser decodes
       pub value_base64: String,
       pub ledger: u32,
       pub ledger_closed_at_unix: u64,
       pub tx_hash: String,
       pub tx_index: u32,
       pub op_index: u32,
       pub event_index_in_op: u32,
   }

   impl StellarRpc {
       pub async fn get_latest_ledger(&self) -> Result<u64>;
       pub async fn get_events(
           &self,
           start_ledger: u64,
           end_ledger: u64,
           filter: &EventFilter,
       ) -> Result<(Vec<RawEvent>, u64 /* latest_ledger from response */)>;
   }
   ```
   Implementation note: prefer the `stellar-rpc-client` crate's typed bindings if its API is stable on the chosen version; otherwise use `reqwest` to POST JSON-RPC directly. Either way, ScVal decoding lives in `parsers.rs`, not here — this file only handles transport + envelope.

### Stage D — Parsers

6. **New file `packages/worker/src/indexer/stellar/parsers.rs`** — pure decoder functions, one per declared `#[contractevent]`. Each parser inspects `raw.topics_base64[0]` (the canonical Soroban event symbol) and returns `None` on mismatch, otherwise produces a `StellarLog` with the parsed `params` JSON. The `event_name` stored in `contract_logs` is shown in the second column (remapped for vault events to match the EVM analytics shape).

   | Parser | Source event | Stored `event_name` | `params` keys |
   |---|---|---|---|
   | `parse_deposit_requested` | DepositManager `DepositRequested` | `DepositRequested` | `request_id`, `user`, `amount` |
   | `parse_withdrawal_requested` | WithdrawalQueue `WithdrawalRequested` | `WithdrawalRequested` | `withdrawer`, `request_id`, `amount`, `queued` |
   | `parse_request_claimed` | DM **or** WQ `RequestClaimed` *(via shared `request_queue` lib)* | `RequestClaimed` | `request_id`, `user`, `amount` |
   | `parse_vault_deposit` | StakedPipelineUSD `Deposit` | **`StakingDeposit`** *(remapped)* | `operator`, `from`, `receiver`, `assets`, `shares` |
   | `parse_vault_withdraw` | StakedPipelineUSD `Withdraw` | **`StakingWithdrawal`** *(remapped)* | `operator`, `receiver`, `owner`, `assets`, `shares` |

   **Skipped events** (mirroring the EVM-side indexer, which only parses request lifecycle + vault events):
   - **`RequestEnqueued`** — the shared lib publishes this from `enqueue_request()` at the same call sites where DM/WQ publish their contract-specific events. Indexing both would double-write rows for the same logical event; the contract-specific events carry strictly more info (`WithdrawalRequested` adds `queued`). The poller's event filter excludes the `RequestEnqueued` topic.
   - **`CustodianSet` / `VerifierSet`** — admin/governance events on DM and WQ. No API/UI consumer; EVM-side indexer doesn't track equivalents. File a follow-up if an audit page ever needs them.
   - **Vault `Transfer` / `Mint` / `Approve`** (also emitted by StakedPipelineUSD via `FungibleToken`) — low signal, would multiply row volume on every share transfer. EVM-side similarly only indexes the ERC4626 `Deposit`/`Withdraw` events on sPLUSD, not the underlying ERC-20 transfers.

   ScVal decoding via `stellar_xdr::ScVal::from_xdr_base64`:
   - `request_id`: `ScVal::U128` (decode `Parts { hi: u64, lo: u64 }` → `u128`; serialize as decimal string to keep parity with EVM `params->>'request_id'` shape).
   - Addresses (`user`/`withdrawer`/`operator`/`receiver`/`owner`/`new_custodian`): `ScVal::Address` (Account or Contract). Decode via `stellar_strkey::ed25519::PublicKey` or `stellar_strkey::Contract` based on the variant; render as the 56-char uppercase Strkey (Q4 = store as-is).
   - `new_verifier`: `ScVal::Bytes` of length 32 — render as `0x` + lowercase hex (parity with EVM `BytesN<32>`).
   - `amount` / `assets` / `shares`: `ScVal::I128` — serialize as decimal string (consistent with EVM amount handling, never JS `number`).
   - `queued` (WithdrawalRequested only): `ScVal::I128` — same string treatment.

   The `StellarLog` struct (step 7) carries the parsed `params` JSON, the raw `contract_id` Strkey, the synthesised `log_index`, and the carried-through `ledger`, `ledger_closed_at_unix`, `tx_hash`.

   **Note on the vault Mint/Transfer/Approve events** (also emitted by StakedPipelineUSD via `FungibleToken`): not parsed in this iteration. They'd multiply row volume (every share transfer between users) and the API has no consumer for them today. Q6 may pull them back in if claim-state tracking goes with option A.

7. **`StellarLog` struct.** Chain-agnostic shape that maps cleanly to `EventRow`:
   ```rust
   pub struct StellarLog {
       pub contract_address: String,   // Strkey as-is
       pub event_name: String,
       pub block_number: u64,          // ledger sequence
       pub tx_hash: String,            // hex tx hash
       pub log_index: u64,             // synthesised: tx_index*1000 + op_index*100 + event_index_in_op
       pub block_timestamp: u64,       // pre-populated from ledger_closed_at
       pub params: serde_json::Value,
   }
   ```
   This deliberately mirrors `shared::events::ContractLog` field-for-field except `contract_address: String` (vs alloy `Address`). The mapper in step 9 calls the new chain-agnostic `EventRepo::insert_row` helper added in step 10.

### Stage E — Shared repo refactor (chain-agnostic insert)

8. **Extract `EventRepo::insert_log_raw` in `packages/shared/src/db.rs`** — a private helper that takes all fields as primitives:
   ```rust
   async fn insert_log_raw(
       &self,
       conn: &mut PgConnection,
       chain_id: i64,
       contract_address: &str,
       event_name: &str,
       block_number: u64,
       tx_hash: &str,
       log_index: u64,
       block_timestamp: u64,
       params: &serde_json::Value,
   ) -> anyhow::Result<()>
   ```
   Then refactor `insert_log` to call this helper (passing `event.contract_address.to_checksum(None)` etc.) — semantics unchanged for EVM callers.
   Add a new public method `insert_row(conn, row: &EventRow, chain_id)` that also delegates to `insert_log_raw` — for Stellar callers.
   Add a parallel `EventRow` struct in `shared::events`:
   ```rust
   pub struct EventRow {
       pub contract_address: String,
       pub event_name: String,
       pub block_number: u64,
       pub tx_hash: String,
       pub log_index: u64,
       pub block_timestamp: u64,
       pub params: serde_json::Value,
   }
   ```
   No DDL change. The new struct is purely an internal type used by chain-agnostic write paths.

### Stage F — Mapper + poller

9. **New file `packages/worker/src/indexer/stellar/mappers.rs`** — `StellarLogMapper` that implements `LogMapper`:
   - `is_duplicate`: calls `EventRepo::is_duplicate(conn, chain_id, &row.contract_address, row.block_number, row.log_index)` — the existing method takes `&str`, so Strkey passes through unchanged.
   - `insert`: calls `EventRepo::insert_row(conn, &self.row, self.chain_id)`.
   - `block_number`: returns the ledger sequence.
   - `set_block_timestamp`: a no-op or sanity-overwrite; the poller pre-populates `block_timestamp` from `ledger_closed_at_unix` at poll time.

10. **New file `packages/worker/src/indexer/stellar/poller.rs`** — `StellarEventPoller`:
    ```rust
    pub struct StellarEventPoller {
        rpc: StellarRpc,
        chain_id: i64,
        repo: Arc<EventRepo>,
        deposit_manager_id: String,
        withdrawal_queue_id: String,
        access_manager_id: String,
    }

    #[async_trait::async_trait]
    impl ChainEventPoller for StellarEventPoller {
        async fn get_latest_block(&self) -> Result<u64> {
            self.rpc.get_latest_ledger().await
        }
        async fn poll(&self, from: u64, to: u64) -> Result<Vec<Box<dyn LogMapper>>> {
            // Build EventFilter over the three contract IDs.
            // Call rpc.get_events(from, to, &filter).
            // For each RawEvent, run the parser that matches event_name and produce a StellarLogMapper.
            // Return the Vec<Box<dyn LogMapper>>.
        }
        async fn get_block_timestamp(&self, ledger: u64, cache: &mut HashMap<u64, u64>) -> Result<u64> {
            // Stellar poller pre-populates block_timestamp on each mapper at poll time,
            // so this trait method is only invoked when set_block_timestamp wasn't pre-called.
            // Implementation: look up the cache; if missing, fall back to the timestamp already
            // baked into the most recent matching mapper (or 0 — non-fatal, the row is still inserted).
        }
    }
    ```
    Then a top-level `run_stellar_indexer_job(settings: StellarIndexerSettings, pool: PgPool) -> Result<()>` that mirrors `run_indexer_job`:
    - Seeds cursor from `START_LEDGER` if no existing cursor.
    - Builds the `StellarEventPoller`.
    - Calls `index_loop("stellar-indexer", chain_id, polling_ledger_range, 0, polling_interval_ms, &repo, &poller)` — note `confirmations_delay = 0` (Stellar has finality on ledger close; no reorg gap needed).

### Stage G — Wire into worker main

11. **`packages/worker/src/main.rs`** — swap the indexer block to consume the new `IndexerSettings` enum:
    ```rust
    if env_bool("JOB_INDEXER_ENABLED") {
        let settings_per_chain = IndexerSettings::all_from_env()?;
        for s in settings_per_chain {
            let pool = pool.clone();
            match s {
                IndexerSettings::Evm(s) => {
                    tracing::info!(chain_id = s.chain_id, chain_type = "evm", "indexer job started");
                    tokio::spawn(async move { if let Err(e) = run_indexer_job(s, pool).await { tracing::error!("evm indexer exited: {e:?}"); } });
                }
                IndexerSettings::Stellar(s) => {
                    tracing::info!(chain_id = s.chain_id, chain_type = "stellar", "indexer job started");
                    tokio::spawn(async move { if let Err(e) = run_stellar_indexer_job(s, pool).await { tracing::error!("stellar indexer exited: {e:?}"); } });
                }
            }
        }
    }
    ```

12. **Skip Stellar chains in price-poller + relayer spawn loops.** In `worker/main.rs`'s `JOB_PRICE_POLLER_ENABLED` and `JOB_RELAYER_ENABLED` blocks, iterate `parse_chains_env()?`, call `parse_chain_type(chain_id)`, and only build `PricePollerSettings::from_chain_env(chain_id)` / `RelayerJobSettings::from_chain_env(chain_id)` when the chain is `Evm`. Log an `info!` line per Stellar chain explaining "price-poller skipped on Stellar chain {id}: no sPlUSD vault" (similar for relayer). This prevents the existing per-chain spawn from panicking on missing `CHAIN_<id>_ETH_RPC_URL`.
    - Concretely: `PricePollerSettings::all_from_env()` and `RelayerJobSettings::all_from_env()` (added by #439) iterate **all** chains and call EVM-shaped `from_chain_env`. Both need an `evm_chains_only()` helper or inline filter to skip Stellar entries. Add `pub fn all_evm_from_env() -> Result<Vec<Self>>` on both settings types and switch `main.rs` to it; keep `all_from_env` for back-compat with anyone who imports it but mark it deprecated in a doc comment.

### Stage H — `.env.example` + docs

13. **`.env.example`** — append a "Stellar chain example" block under the existing per-chain example:
    ```bash
    # Example for adding Stellar testnet alongside the EVM chain (CHAINS=1,99000001):
    # CHAIN_99000001_TYPE=stellar
    # CHAIN_99000001_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
    # CHAIN_99000001_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
    # CHAIN_99000001_STELLAR_DEPOSIT_MANAGER_ID=CDM4Z2EMF46JTUX7VZVYQ6JD3PALEDTTLPJHSNCT7GTBQ6YWJYNRLWUW
    # CHAIN_99000001_STELLAR_WITHDRAWAL_QUEUE_ID=CBERV5WQYDFHTB3SL6KL72N5GFCJYTD6FAFZ6PJ3XSDURYILM2COFNQS
    # CHAIN_99000001_STELLAR_STAKED_PLUSD_ID=CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5
    # CHAIN_99000001_STELLAR_ACCESS_MANAGER_ID=CBJUO44GFUU3NTDTTNJTLLIIC6RGNAS6NLPNIJYYZKFY5NSZ3IMMZ4Q5
    # CHAIN_99000001_STELLAR_USDC_ASSET_ID=CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7
    # CHAIN_99000001_STELLAR_PLUSD_ASSET_ID=CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN
    # CHAIN_99000001_START_LEDGER=0      # set to a ledger within the last 7 days at startup
    ```

14. **`ARCHITECTURE.md`** — extend the per-chain task paragraph (added by #439) with a single sentence noting that the indexer is now polymorphic via `CHAIN_<id>_TYPE` and that Stellar chains skip the price-poller/relayer. No structural change.

15. **`docs/design-docs/multi-chain-kyc-sharding.md`** — append a short subsection "Stellar `chain_id` convention" documenting the `99000001` / `99000002` sentinels and the rationale for the `99M+` range. Cross-link from `.env.example`.

16. **`docs/references/index.md` (if applicable)** — add a one-line entry pointing at the Soroban RPC docs (`https://developers.stellar.org/docs/data/apis/rpc`) and the contracts repo (`pipeline-stellar-contracts`). Read first to confirm it's the right pattern for that index.

## Test Strategy

All new tests are **pure unit tests** — no live network, no DB. Fixtures live under `packages/worker/tests/fixtures/stellar/`.

### Fixture capture (one-time, manual, not part of CI)

- Trigger a `request_deposit` on the deployed testnet DepositManager via the Stellar CLI. Curl the Soroban RPC `getEvents` endpoint with the contract ID filter. Save the JSON response (one event per file) under `tests/fixtures/stellar/request_enqueued.json`, `request_claimed.json`, etc.
- Capture the 4 event shapes. For `CustodianSet` / `VerifierSet`, hand-craft a fixture by base64-encoding a synthetic ScVal payload if the testnet has never emitted them — both are admin-only and rare.

### New unit tests

- `packages/worker/tests/stellar_parsers.rs`:
  - `parse_request_enqueued_decodes_fixture` — loads `request_enqueued.json`, asserts `event_name`, `params.request_id` (string-encoded `u128`), `params.user` (Strkey), `params.amount` (string-encoded `i128`).
  - `parse_request_claimed_decodes_fixture` — same shape.
  - `parse_custodian_set_decodes_synthetic` — synthetic fixture, asserts `params.new_custodian` is the Strkey.
  - `parse_verifier_set_decodes_synthetic` — synthetic fixture, asserts `params.new_verifier` is 0x-prefixed hex of the 32 bytes.
  - `parser_returns_none_on_event_name_mismatch` — feed a `RawEvent` with `event_name = "Unknown"` into each parser, expect `None`.
  - `parser_rejects_short_topics` — feed a `RawEvent` with too few topics, expect `None`.
- `packages/worker/tests/stellar_log_index.rs`:
  - `synthesise_log_index_collision_guard` — table of `(tx_index, op_index, event_index)` triples, asserts each maps to a unique `u64` and the formula stays within `i32::MAX` for realistic inputs.
- `packages/worker/tests/stellar_config.rs`:
  - `parse_chain_type_defaults_to_evm` — unset → `Evm`.
  - `parse_chain_type_reads_stellar` — `CHAIN_<id>_TYPE=stellar` → `Stellar`.
  - `parse_chain_type_rejects_unknown` — `CHAIN_<id>_TYPE=foo` → `Err`.
  - `stellar_settings_from_env_happy_path` — all `CHAIN_99000001_STELLAR_*` set → `Ok`.
  - `stellar_settings_from_env_missing_rpc_url` → `Err`.
  - `indexer_settings_all_from_env_mixed` — `CHAINS=1,99000001`, `CHAIN_99000001_TYPE=stellar`, returns `[Evm(_), Stellar(_)]`.
- `packages/worker/tests/stellar_scval.rs` (low-level decoder unit tests, only if the parsers expose helpers — `extract_u128(scval)`, `extract_address(scval)`, `extract_bytesn32(scval)`):
  - Round-trip a `u128` through `stellar-xdr` and confirm decode produces the original value.
  - Round-trip an `Address::Contract(C…)` Strkey and confirm the decoder yields the same string.
  - Sanity-check `i128` boundary values (`i128::MIN`, `i128::MAX`, `0`).
- Tests are run via the existing `cargo nextest run --workspace` / `/test-fast` harness. No new test runner.

### Pre-merge gates (unchanged)

- `cargo clippy --workspace --all-targets -- -D warnings` clean.
- `cargo nextest run --workspace` green.
- `npx tsx scripts/lint-docs.ts` green (since `.env.example` + design doc touched).
- `/test-fast` green.

### Manual smoke test (documented in PR description, not gated on CI)

- Set `CHAINS=99000001`, `DEFAULT_CHAIN_ID=99000001` (or any EVM chain — `DEFAULT_CHAIN_ID` must be a member; if Stellar-only local dev, set it to the Stellar sentinel — API routes that depend on EVM-only state may 400, that's fine for the worker smoke).
- Populate the `CHAIN_99000001_STELLAR_*` block per `.env.example`.
- Set `CHAIN_99000001_START_LEDGER` to a recent ledger (within last 7 days).
- `cargo run -p pipeline_worker`. Confirm `tracing` logs:
  - `indexer job started chain_id=99000001 chain_type=stellar`
  - At least one `indexed block range count=N` after a polling cycle.
- Invoke `request_deposit` on the testnet DepositManager via Stellar CLI:
  ```bash
  stellar contract invoke \
    --id CDM4Z2EMF46JTUX7VZVYQ6JD3PALEDTTLPJHSNCT7GTBQ6YWJYNRLWUW \
    --source <your-G…-key> \
    --network testnet \
    -- request_deposit --amount 1000000
  ```
- After ~1 minute, run `SELECT chain_id, contract_address, event_name, params FROM contract_logs WHERE chain_id = 99000001 ORDER BY id DESC LIMIT 5;` and confirm a `RequestEnqueued` row with the expected `request_id`, `user`, `amount` in `params`.
- Coder records the smoke result + the actual ledger range + sample row in a PR comment.

## Docs to Update

- `.env.example` — append Stellar chain example block (Implementation Step 13).
- `ARCHITECTURE.md` — one sentence in the per-chain task paragraph noting indexer polymorphism via `CHAIN_<id>_TYPE` (Step 14).
- `docs/design-docs/multi-chain-kyc-sharding.md` — append "Stellar `chain_id` convention" subsection with the sentinel scheme (Step 15).
- `docs/references/index.md` — optional one-line entry for Soroban RPC docs + Stellar contracts repo (Step 16; only if the index already references similar external docs).
- `docs/exec-plans/active/issue-528-stellar-soroban-indexer.md` (this file) — kept until the PR merges; the manager moves it to `completed/` on close.
- **No product spec update.** The change is a worker-internal feature (indexing infrastructure). No user-facing or agent-facing behaviour shifts in the API. The `chore`-of-feature rule applies: spec stays untouched.
