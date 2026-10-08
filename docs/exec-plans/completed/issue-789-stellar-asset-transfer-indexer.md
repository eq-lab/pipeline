# Issue #789: Worker indexer: track Stellar asset transfers to/from custody and ramp addresses

Source: https://github.com/eq-lab/pipeline/issues/789

## Scope

Extend the Stellar branch of the `indexer` job (`packages/worker/src/indexer/stellar/`) to index Soroban asset (SAC/SEP-41) `transfer` events for a configured asset contract, keeping only transfers where **both** the sender (`from`) **and** recipient (`to`) are in the configured set of **custody** or **ramp** addresses — i.e. internal movements between tracked accounts. Transfers with an untracked counterparty (external inflows/outflows) are excluded. Matching transfers are persisted as raw `contract_logs` rows. _(Decision 2026-07-08: `&&`, not `||` — internal-movements-only.)_

**In scope**
- Per-chain env-var config: asset contract id + custody address list + ramp address list (read once at startup).
- A pure parser for the Soroban `transfer` event.
- A pure membership filter (touches custody ∪ ramp).
- Wiring the asset contract into the Stellar poller's `getEvents` contract filter and routing decoded transfers to the existing `StellarLogMapper` → `contract_logs`.
- Unit tests (parser + filter + config), no DB, no live RPC.

**Out of scope** (per issue): EVM asset transfers; role/direction labeling or aggregation; API/frontend surfacing; DB-table config or hot-reload; any schema migration.

## Assumptions and Risks

- **Storage reuse.** Transfers land in the existing `contract_logs` table via `EventRow`/`EventRepo::insert_row`. The `params` JSONB column already exists (migration `20260521000001`), so **no migration is needed**. Dedup relies on the existing unique key `(chain_id, contract_address, block_number, log_index)` and the existing `synthesise_log_index` scheme.
- **Event name.** New rows use `event_name = "AssetTransfer"`. It is deliberately **not** a staking event, so `StellarLogMapper::insert` will not run `compute_position_fields` (guarded by `is_staking_event_name`). Verified in `stellar/mappers.rs:51-62`.
- **SAC `transfer` event shape.** Standard Soroban token/SAC transfer: `topics = [Symbol("transfer"), from: Address, to: Address, (optional sep0011 asset String)]`, `value = ScVal::I128(amount)`. The parser requires `topics.len() >= 3` and reads `from = topics[1]`, `to = topics[2]`. Amount is decoded defensively: try plain `ScVal::I128` (via `crate::stellar::scval::extract_i128`) first, then fall back to a map field `amount` (`extract_i128_from_map`) to tolerate muxed/newer-protocol variants. **Risk:** if a deployment's SAC emits an unexpected value shape, amount decode returns `None` and the event is skipped (logged). Mitigated by defensive decode + tests; flagged in Open Questions.
- **Address types.** Custody/ramp addresses may be Stellar **accounts (`G…`)** or **contracts (`C…`)**. The existing `validate_contract_id` only accepts `C…`, so it cannot validate these — a new validator that accepts both is required (see step 1). `extract_address` already returns uppercase Strkeys for both `Account` (`G…`) and `Contract` (`C…`), so string-equality membership works as long as configured addresses are normalized to uppercase.
- **Activation is all-or-nothing (resolved).** Asset-transfer tracking is enabled **only when all three** are set: `CHAIN_<id>_STELLAR_ASSET_ID`, `CHAIN_<id>_CUSTODY_ADDRESSES`, and `CHAIN_<id>_RAMP_ADDRESSES`. If **none** are set, tracking ships dark (silent, like `loan_registry_id`). If **some but not all** are set (partial config), tracking is disabled and a `tracing::warn!` is emitted so the misconfiguration is visible. This avoids ever indexing the entire token's transfer history with no filter.
- **No reorg concern.** Stellar poller runs with `confirmations_delay = 0` (deterministic finality) — unchanged.
- **Soroban `getEvents` 5-contract-id-per-filter cap (materialized).** Adding the asset id pushed the poller's contract set to 6 (DM, WQ, sPLUSD, loan-registry, yield-minter, asset), which Soroban rejects with `-32602 … maximum 5 contract IDs per filter`. Fixed by chunking the ids across multiple `contract` filters (Soroban unions them) in `rpc.rs::build_contract_filters` — supports up to 25 ids (5 filters × 5).
- **Distinctness.** The asset id is added to the existing role-distinctness check so it cannot collide with DM/WQ/sPLUSD/loan-registry/yield-minter ids (which would misroute via the `dispatch_parser` if/else ladder).

## Open Questions

_Resolved (2026-07-08):_
- Empty/partial config → **tracking activates only when asset id + custody + ramp are all set**; none set = silent dark, partial = disabled with a warning log. (No "index all transfers" mode.)
- Event shape → assume the **standard** SAC/SEP-41 `transfer` (`from`/`to` topics, `i128` value); parser also handles an `amount`-map fallback defensively.

## Progress

_Implemented 2026-07-08 on `feat/indexer-stellar-asset-transfers`._ All steps below complete:
1. ✅ `validate_stellar_address` added to `shared/chains.rs` (G… or C…), sharing a `validate_strkey` base with `validate_contract_id`.
2. ✅ `StellarIndexerSettings` gains `asset_id` / `custody_addresses` / `ramp_addresses`; all-or-nothing activation with partial-config warning; asset id in distinctness check; `env_csv_addresses` helper.
3. ✅ `parse_asset_transfer` (plain-i128 + amount-map fallback) → `event_name = "AssetTransfer"`.
4. ✅ `transfer_between_tracked` pure filter (generic over hasher) — `from` AND `to` both in custody ∪ ramp (internal-movements-only, per 2026-07-08 decision).
5. ✅ `dispatch_parser` gains `asset_id` branch; sole caller updated.
6. ✅ Poller wires asset id into the `getEvents` filter + membership filter; `run_stellar_indexer_job` builds the tracked set and logs when enabled.
7. ✅ `cargo clippy --all -- -D warnings` passes.

Tests: `stellar_parsers.rs` (+11 parser/filter/dispatch, pure), `stellar_asset_transfer_config.rs` (new dedicated file, 7 config tests incl. partial-config-with-malformed-address disables without error — isolated in its own binary because the job-level `JOB_INDEXER_STELLAR_*` vars are process-global; serialized on `ENV_LOCK`), `stellar_rpc.rs` (new, 5 — `build_contract_filters` chunking), `shared/tests/chains.rs` (new, 6) — all green. `stellar_config.rs` left untouched. Docs: `docs/references/backend.md` + `.env.example` updated.

## Implementation Steps

1. **Address validator** — in `packages/shared/src/chains.rs`, add `pub fn validate_stellar_address(key: &str, raw: String) -> Result<String>` that uppercases, checks 56-char base32 (`A-Z`, `2-7`), and accepts a leading `C` **or** `G` (reuse the body of `validate_contract_id`, relaxing the prefix check). Keep `validate_contract_id` as-is for contract-only roles.

2. **Config fields** — in `packages/worker/src/indexer/config.rs`, extend `StellarIndexerSettings` with (all **job-level** `JOB_INDEXER_STELLAR_*` vars — applies to every Stellar chain, per Issue decision 2026-07-08):
   - `pub asset_id: Option<String>` — from `JOB_INDEXER_STELLAR_ASSET_ID` (optional; validated via `validate_contract_id`, C… only).
   - `pub custody_addresses: Vec<String>` — from `JOB_INDEXER_STELLAR_CUSTODY_ADDRESSES` (CSV; each validated via `validate_stellar_address`; empty when unset).
   - `pub ramp_addresses: Vec<String>` — from `JOB_INDEXER_STELLAR_RAMP_ADDRESSES` (CSV; validated the same way).
   Parse them in `from_chain_env` after the existing role parsing. Re-export `validate_stellar_address` alongside the existing `pub use shared::chains::{…}`.
   - **Activation rule (all-or-nothing):** compute `asset_tracking_enabled = asset_id.is_some() && !custody_addresses.is_empty() && !ramp_addresses.is_empty()`. When all three are present, add `asset_id` to the role-distinctness `roles` vec (label `"ASSET_ID"`). When none are present, tracking ships dark silently. When **some but not all** are present (partial config), emit a `tracing::warn!` naming the missing var(s) and leave tracking disabled — do **not** bail. Expose the resolved state so the poller only wires the asset id when enabled (e.g. keep `asset_id` populated only when enabled, or add a derived `asset_tracking_enabled` accessor).
   - Add a small CSV helper that returns `Vec<String>` for an **optional** var (unlike `env_csv_require`, absence → empty vec), or inline the parse.

3. **Transfer parser** — in `packages/worker/src/indexer/stellar/parsers.rs`, add:
   ```rust
   /// SAC / SEP-41 `transfer` event.
   /// topics: [transfer, from: Address, to: Address, (opt) sep0011 asset: String]
   /// value:  i128 amount (plain), or Map { amount: i128 } (muxed/newer variants)
   pub fn parse_asset_transfer(raw: &RawEvent) -> Option<StellarLog>
   ```
   - Guard `raw.event_name == "transfer"` and `raw.topics_base64.len() >= 3`.
   - `from = extract_address(&topics[1])?`, `to = extract_address(&topics[2])?`.
   - `amount = crate::stellar::scval::extract_i128(&raw.value_base64).or_else(|| extract_i128_from_map(&raw.value_base64, "amount"))?`.
   - `event_name = "AssetTransfer"`, `params = json!({ "from": from, "to": to, "amount": amount.to_string() })`, with the usual `contract_address`/`block_number`/`tx_hash`/`log_index` (`synthesise_log_index`)/`block_timestamp` fields.

4. **Pure membership filter** — in `parsers.rs` (or a small `stellar/mod` helper), add:
   ```rust
   /// True if `from` or `to` is present in the custody ∪ ramp address set.
   pub fn transfer_touches_tracked(from: &str, to: &str, tracked: &std::collections::HashSet<String>) -> bool
   ```
   Keep it a free function so it is unit-testable without a poller.

5. **Dispatch routing** — extend `dispatch_parser(...)` with a new param `asset_id: Option<&str>` and add a branch **before** the final `else`: `} else if asset_id == Some(raw.contract_id.as_str()) { parse_asset_transfer(raw) }`. Update the one caller in `stellar/poller.rs`.

6. **Poller wiring** — in `packages/worker/src/indexer/stellar/poller.rs`:
   - Add fields to `StellarEventPoller`: `asset_id: Option<String>` and `tracked_addresses: std::collections::HashSet<String>` (union of custody + ramp, precomputed at construction). Extend `new(...)` accordingly.
   - In `poll`, push `asset_id` into `contract_ids` when `Some` (so `getEvents` includes it).
   - Pass `self.asset_id.as_deref()` into `dispatch_parser`.
   - After a log is produced, when `log.event_name == "AssetTransfer"`, apply the filter: read `from`/`to` from `log.params` and skip the log if `!transfer_touches_tracked(...)`. Otherwise wrap in `StellarLogMapper` (it is not a loan event, so it goes through the existing `else` branch).
   - In `run_stellar_indexer_job`, build the `tracked_addresses` set from `settings.custody_addresses`/`ramp_addresses` and pass `settings.asset_id.clone()` into `StellarEventPoller::new`. Add a `tracing::info!` when asset tracking is enabled (mirroring the loan-registry log).

7. **Lint** — run `cargo clippy --all -- -D warnings` and fix any warnings (e.g. `clippy::too_many_arguments` on `StellarEventPoller::new` — add `#[allow(...)]` consistent with the existing attribute).

## Test Strategy

All tests are pure (no DB, no live RPC), following existing conventions in `packages/worker/tests/` (external test files; reuse the ScVal encode helpers already in `stellar_parsers.rs`).

- **`packages/worker/tests/stellar_parsers.rs`** (extend):
  - `parse_asset_transfer` happy path: `transfer` with `from`/`to` accounts (`G…`) and `value = I128(amount)` → correct `event_name`, `params.from/to/amount`.
  - Amount as `Map { amount: i128 }` fallback decodes correctly.
  - Contract-address (`C…`) counterparties decode (custody/ramp may be contracts).
  - Guards: wrong symbol → `None`; `< 3` topics → `None`; non-i128 value → `None`.
  - `dispatch_parser` routes an event from the configured `asset_id` to `parse_asset_transfer`, and returns `None`/warns for an unknown contract id.
- **Filter tests** (in `stellar_parsers.rs` or a new small test module): `transfer_touches_tracked` returns true when `from` ∈ set, true when `to` ∈ set, false when neither; empty set → false.
- **`packages/worker/tests/stellar_config.rs`** (extend):
  - Asset id + custody/ramp CSVs parse into the new fields (addresses uppercased).
  - Asset id unset → `asset_id == None`, both lists empty (ships dark).
  - Asset id set but both lists empty → `from_chain_env` errors.
  - Asset id duplicating another role id → distinctness error.
  - Invalid custody/ramp strkey → error; `G…` and `C…` both accepted.
- **`packages/shared`** unit test for `validate_stellar_address` (accepts `G…` and `C…`, rejects wrong length / bad alphabet / other prefixes) if the shared crate has a tests dir; otherwise cover indirectly via the config test.

## Docs to Update

- `docs/references/backend.md` — add the three new env vars (`CHAIN_<id>_STELLAR_ASSET_ID`, `CHAIN_<id>_CUSTODY_ADDRESSES`, `CHAIN_<id>_RAMP_ADDRESSES`) to the indexer configuration section, and note the new `AssetTransfer` `contract_logs` event (Stellar-only, raw from/to/amount).
- No product-spec change required: the feature is internal indexing with no user/agent-facing API or UI surface (per issue Out of scope). If reviewers consider transfer visibility a dashboard concern later, `docs/product-specs/dashboards.md` would be the home — noted, not done here.
