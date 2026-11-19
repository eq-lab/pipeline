# Issue #1547: Waterfall: read max_fee_bps from the LoanRegistry instead of the assumed 5000

Source: https://github.com/eq-lab/pipeline/issues/1547

Parent epic: #2129 (math correctness, 2026-11-19 review). Sibling #2124 rewrites the fee-cap
math in the same function; #2123 touches the same file. No Figma reference: backend only, no
visual verification step.

## Scope

The waterfall (`GET /v1/loan-book/{loan_id}/waterfall`) caps fees with the contracts' rule
`mgmt + perf + oet <= floor((senior_interest + mgmt + perf) × max_fee_bps / 10_000)`. Today it
uses the constant `ASSUMED_MAX_FEE_BPS = 5_000` (`packages/api/src/routes/waterfall.rs:127`).
After this change it uses the registry's live `max_fee_bps`, per chain, on both chains.

How the value is exposed on what is deployed (checked 2026-11-19, contracts frozen):

| Chain | Contract | Read surface | Live value |
|---|---|---|---|
| EVM Hoodi (560048) | LoanRegistry proxy `0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231` (source `f92d719`) | view `maxFeeBps() returns (uint32)`, selector `0xbf769a3f` (`LoanRegistryUpgradeable.sol:204`). Storage is ERC-7201 base `0x0e83…5e00`. `maxFeeBps` is packed into field 6 beside `pocket`, so no `extsload` is needed. | `cast call … "maxFeeBps()(uint32)"` → `5000` |
| Stellar testnet (99000001) | LoanRegistry `CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ` (`.env.example`) | view `max_fee_bps() -> u32` (`contracts/loan-registry/src/lib.rs:793`, since stellar-contracts #32). Instance storage defaults to `0` when unset. | `stellar contract invoke … -- max_fee_bps` → `5000` |

Both contracts use whole bps against `10_000` for this setting. On EVM it is `BPS_ONE`, not the
1e6 rate scale. Mainnet, futurenet and testnet configs are all `5000`.

### In scope

1. **Storage.** A new table `loan_registry_settings` keyed `(chain_id, contract_address)` holds
   the last value read from the chain.
2. **Worker sync, both chains.** A supervised loop per chain calls the registry view on start and
   then every 60 s, and upserts the row. EVM calls `maxFeeBps()` through `eth_call`. Stellar calls
   `max_fee_bps` through `simulateTransaction`.
3. **API.** The waterfall handler reads the value for the chain's API-scoped LoanRegistry and
   passes it into `compute_waterfall`. Missing row → `503` (see Open Questions).
4. **Waterfall math: minimal.** Remove the constant and add a `max_fee_bps: u32` parameter to
   `compute_waterfall`. Pass it to `cap_interest_fees` and `oet_room_under_cap`, replacing the
   constant. Nothing else in the cap math changes; #2124 owns that rewrite.
5. Tests and docs (see below).

### Out of scope

- The fee-cap / coupon split algorithm (#2124) and offtaker-overpayment handling (#2123).
- Indexing the `MaxFeeBpsSet` event into `contract_logs`. Rejected as the source: the first
  `setMaxFeeBps` call happens at deploy/configure time, before the indexer's start block, and
  Stellar RPC keeps events for only about 7 days. The view is the authoritative value on both
  chains.
- Calling the chain from the API. The API has no RPC configuration, and `ARCHITECTURE.md`
  §dependencies says the API reads only the DB the worker fills.
- Adding `max_fee_bps` to `WaterfallResponse`, and any Trustee UI change.
- Historical `max_fee_bps` by `as_of`. The contract checks the cap against the current value
  when `recordPayment` executes, so the current value is the right one even for a backdated
  `as_of`.
- Contract, deploy-script, or registry configuration changes (contracts are frozen).

## Assumptions and Risks

- **A1: the view is present on every supported registry.** It is verified on Hoodi and on Stellar
  testnet `CDWN5B3F…`. The local `.env` still points at the pre-rework Stellar registry
  `CDYKALTK…`, which has no `max_fee_bps` (the simulate fails). On that registry the sync logs a
  warning and the waterfall answers `503`. This is correct: the API does not support that
  registry generation anyway (see #1433 Q1).
- **A2: address normalization.** The API looks the row up with
  `loan_registry_address(&state, chain_id)`: EIP-55 for EVM, canonical `C…` Strkey for Stellar.
  The worker must write the same form. EVM already has `loan_registry_checksum` in
  `run_indexer_job`. For Stellar, normalize `settings.loan_registry_id` through
  `stellar_strkey::Contract::from_string(..)` + `to_string()` before writing. If
  `…_INDEXER_LOAN_REGISTRY_ADDRESS` and `…_API_LOAN_REGISTRY_ADDRESS` differ, no row matches and
  the waterfall returns `503`. The failure is visible, never silent.
- **A3: staleness window ≤ 60 s.** After an admin `setMaxFeeBps`, suggestions can use the old
  value for up to one sync interval. The Trustee can still override components (trustee-dashboard
  flow note A). An RPC outage keeps the last stored value, which is the same failure mode as the
  indexer itself.
- **A4: Stellar `set_max_fee_bps` does not validate the range** (EVM rejects values above
  `10_000`). The column therefore stores the full `u32` range. The math keeps the existing
  `>= 10_000` guard in `cap_interest_fees`, which skips the mgmt/perf limit there. Without it,
  `10_000 − bps` would be 0 or negative and break the limit. `oet_room_under_cap` already handles
  any value.
- **R1: conflict with #2124 (same function) and #2123 (same file).** The epic says to land them
  one after another. Contract for the merge:
  - `compute_waterfall` gets `max_fee_bps: u32` as its **last** parameter. #2123 may drop or
    reorder `pricing_basis`, so the last position survives that.
  - If #2124 has merged first and already threads a `max_fee_bps` parameter through, keep that
    parameter. This issue then changes only the handler, which passes the stored value instead of
    the constant, plus the worker and storage parts.
  - Waterfall test edits in this issue assert only the contract invariants (fee cap at the given
    bps, components sum to `amount`, no negatives). They do not assert exact coupon/fee figures in
    the cap-binding case, which #2124 changes.
- **R2: migration timestamp collision** with sibling branches of epic #2129. Pick the next free
  `YYYYMMDD00000N` at implementation time. Check `origin/main` and the open #2129 PRs.
- **R3: deploy ordering.** If the API ships before the worker runs the sync, the waterfall answers
  `503` for at most one sync cycle after the worker starts. Ship worker and API together, as the
  pipeline already does.
- **R4: Trustee UI on 503.** `packages/trustee/src/routes/-record-repayment.ts` (and
  `-record-coupon.ts`) show the error through `mapWaterfallError` / `toUserError`. A 503 shows the
  generic error state; no frontend change is planned.

## Open Questions

- **Q1: missing `max_fee_bps` row: fail closed (`503`) or fall back to `5000` with a warning?**
  The plan uses `503`: the point of the issue is to stop guessing. In practice the row is missing
  only before the first worker sync, or when the indexer and API registry addresses differ. If a
  human prefers availability, swap the helper in step 6 to return `5_000` and log `warn!`. Nothing
  else in the plan changes.

## Implementation Steps

Follow the project rules. Code is comment-less: new files get only a 2–3-line spec-pointer
header, and there are no doc or inline comments. Tests live in `packages/<pkg>/tests/`. Tests do
not use env-var DB access.

### Storage (shared)

1. [x] **Migration** `packages/shared/migrations/<next>_loan_registry_settings.sql`. The header has a
   spec pointer (`docs/references/backend.md#loanregistry-settings-sync`) and a rollback block in
   the style of `20261118000002_access_manager_operations_calldata.sql`.
   ```sql
   CREATE TABLE IF NOT EXISTS loan_registry_settings (
       chain_id         BIGINT      NOT NULL,
       contract_address TEXT        NOT NULL,
       max_fee_bps      BIGINT      NOT NULL CHECK (max_fee_bps BETWEEN 0 AND 4294967295),
       updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
       PRIMARY KEY (chain_id, contract_address)
   );
   ```
   Rollback: `DROP TABLE loan_registry_settings; DELETE FROM _sqlx_migrations WHERE version = <next>;`.
2. [x] **Repo** `packages/shared/src/loan_registry_settings_repo.rs` (register it in
   `packages/shared/src/lib.rs`). It has no state and uses free async functions that take an
   `sqlx::Executor`, like `ContractLogsRepo` methods take one, so `AppState` and its 15 test
   constructions stay untouched.
   - `pub const UPSERT_MAX_FEE_BPS_SQL`: `INSERT … VALUES ($1, $2, $3) ON CONFLICT (chain_id, contract_address) DO UPDATE SET max_fee_bps = EXCLUDED.max_fee_bps, updated_at = now()`.
   - `pub const SELECT_MAX_FEE_BPS_SQL`: `SELECT max_fee_bps FROM loan_registry_settings WHERE chain_id = $1 AND contract_address = $2`.
   - `pub async fn upsert_max_fee_bps(executor, chain_id: i64, contract_address: &str, max_fee_bps: u32) -> sqlx::Result<()>` (bind as `i64::from(max_fee_bps)`).
   - `pub async fn max_fee_bps(executor, chain_id: i64, contract_address: &str) -> anyhow::Result<Option<u32>>` (`u32::try_from` the `i64`; an out-of-range value is an `Err`).

### Worker sync (both chains)

3. [x] **EVM read** in `packages/worker/src/indexer/loan_registry_reader.rs`:
   - Add `function maxFeeBps() external view returns (uint32);` to the `ILoanRegistry` `sol!` block.
   - `pub fn decode_max_fee_bps(result: &[u8]) -> Result<u32>`: `ILoanRegistry::maxFeeBpsCall::abi_decode_returns(result, true)`, with context `"decode maxFeeBps return"`.
   - `impl LoanRegistryReader { pub async fn max_fee_bps(&self, contract: &Address) -> Result<u32> }`: `eth_call` at the latest block, built the same way as `immutable_loan_data`, with context `"eth_call maxFeeBps() on {contract} failed"`.
4. [x] **Stellar read** in `packages/worker/src/indexer/stellar/loan_registry_reader.rs`:
   - `pub fn decode_max_fee_bps(value: &ScVal) -> Result<u32>`: use `crate::stellar::scval::scval_u32`; anything else is `bail!("max_fee_bps: expected U32, got {value:?}")`.
   - `pub(crate) async fn read_max_fee_bps(rpc: &StellarRpc, registry_id: &str) -> Result<u32>`: `simulate_view(rpc, registry_id, "max_fee_bps", vec![])`, then decode.
5. [x] **Sync loop** in a new `packages/worker/src/indexer/loan_registry_settings.rs` (register it in
   `indexer/mod.rs`; spec header points at `docs/references/backend.md#loanregistry-settings-sync`):
   - `pub const LOAN_REGISTRY_SETTINGS_INTERVAL: Duration = Duration::from_mins(1);`
   - `#[async_trait] pub trait MaxFeeBpsSource: Send + Sync { async fn max_fee_bps(&self) -> Result<u32>; }`
   - `#[async_trait] pub trait MaxFeeBpsSink: Send + Sync { async fn store(&self, chain_id: i64, registry: &str, max_fee_bps: u32) -> Result<()>; }`, plus `pub struct PgMaxFeeBpsSink(pub PgPool)`, which calls `upsert_max_fee_bps`.
   - `pub struct EvmMaxFeeBpsSource { reader: LoanRegistryReader, registry: Address }` and `pub struct StellarMaxFeeBpsSource { rpc: Arc<StellarRpc>, registry_id: String }`. Both implement `MaxFeeBpsSource` through steps 3 and 4. They can live here, or the Stellar one can live beside its reader, whichever keeps module visibility simple.
   - `pub async fn sync_once(source, sink, chain_id, registry) -> Result<u32>`: read, then store. A read error stores nothing.
   - `pub async fn run_loan_registry_settings_loop(source, sink, chain_id, registry: String)`
     loops forever and never returns `Err`, following the `run_pocket_seed_loop` pattern:
     - call `sync_once`;
     - log `info!` the first time a value is stored and whenever it changes (keep `last: Option<u32>`);
     - log a failure with `warn!` on its first occurrence and with `debug!` while it repeats; a success resets this;
     - sleep `LOAN_REGISTRY_SETTINGS_INTERVAL`.
6. [x] **Spawn.**
   - EVM, in `run_indexer_job` (`packages/worker/src/indexer/mod.rs`, next to the
     `security-registry-sync` guard): `let _settings_guard = spawn_supervised("loan-registry-settings", chain_id, …)`.
     It builds `LoanRegistryReader::new(&settings.eth_rpc_url)?` and
     `EvmMaxFeeBpsSource { registry: loan_registry_address }`, with `registry = loan_registry_checksum.clone()`.
   - Stellar, in `packages/worker/src/indexer/stellar/poller.rs` (next to `_plusd_seed_guard`):
     only when `settings.loan_registry_id` is `Some`. Normalize the id per A2 and spawn
     `"loan-registry-settings"` with `StellarMaxFeeBpsSource`.
   - The guard must stay alive for the lifetime of `index_loop`: bind it to a named `_guard`,
     never `_`.

### API

7. [x] **`packages/api/src/routes/waterfall.rs`:**
   - Delete `pub const ASSUMED_MAX_FEE_BPS`.
   - Add `max_fee_bps: u32` as the **last** parameter of `compute_waterfall`. Pass it to
     `cap_interest_fees(&coupon, mgmt, perf, max_fee_bps)` and
     `oet_room_under_cap(&coupon, &mgmt, &perf, max_fee_bps)`. Inside, use
     `let bps = i64::from(max_fee_bps);` in place of the constant and keep the `bps >= BPS_DENOM`
     early return. This is the only math edit (see R1).
   - `pub fn require_max_fee_bps(value: Option<u32>, chain_id: i64, registry: &str) -> Result<u32, ApiError>`:
     `None` returns `ApiError::ServiceUnavailable(format!("max_fee_bps for LoanRegistry {registry} on chain {chain_id} is not synced yet; try again shortly"))`.
     This is the single swap point for Q1.
   - In `get_waterfall`, after the snapshot lookup (a missing loan stays `404` first), call
     `shared::loan_registry_settings_repo::max_fee_bps(&state.pool, chain_id, registry)` and then
     `require_max_fee_bps`. Pass the result to `compute_waterfall`.
   - In the `#[utoipa::path]` responses, add `(status = 503, description = "The LoanRegistry's max_fee_bps has not been read from the chain yet")`.
   - Update the module `//!` "Contract bounds" paragraph so it says the fee cap uses the
     registry's synced `max_fee_bps`. This is an edit to an existing doc header, not a new comment.
8. [x] **Call sites.** Update every `compute_waterfall(` caller: the handler,
   `packages/api/tests/waterfall.rs` (the `run` helper plus direct calls) and
   `packages/api/tests/waterfall_accrual.rs` (2 calls). Tests pass a local `const MAX_FEE_BPS: u32 = 5_000;`
   so every existing expectation is unchanged.

### Verify

9. Run `cargo clippy --all -- -D warnings`, `cargo test -p pipeline-api --test waterfall --test waterfall_accrual`,
   `cargo test -p pipeline-worker` (the new and touched test files), and
   `cargo test -p shared` if shared tests are added. Run `npx tsx scripts/lint-docs.ts` after the
   doc edits.

## Test Strategy

All of these are pure unit tests: no Postgres, no RPC, no env vars.

- **`packages/api/tests/waterfall.rs`:**
  - Replace the `ASSUMED_MAX_FEE_BPS` import with a local `MAX_FEE_BPS`. `assert_within_fee_cap(b, bps)` takes the bps as an argument.
  - New: `lower_max_fee_bps_tightens_the_cap`. Use the heavy-waiver fixture at `2_000`:
    - the cap invariant holds at 2000;
    - `mgmt + perf + oet` is strictly below the 5000 result for the same input;
    - the components sum to `amount`.
  - New: `zero_max_fee_bps_allows_no_fees`. Use the standard fixture at `0`: mgmt, perf and OET are all `0`; the components sum to `amount`; nothing is negative.
  - New: `full_max_fee_bps_leaves_mgmt_and_perf_uncapped`. Use the heavy-waiver fixture at `10_000`: mgmt/perf equal the uncapped split, `oet ≤ coupon`, and the cap invariant holds.
  - New: `max_fee_bps_above_denominator_does_not_go_negative`. At `12_000` (Stellar does not validate the range), no component is negative, the invariant holds at 12000, and the components sum to `amount`.
  - New: `standard_schedule_is_unchanged_at_5000_bps`. This is the existing `standard_schedule_is_untouched_by_the_fee_cap` with the explicit argument; keep the exact figures (the cap does not bind there).
  - New: `missing_max_fee_bps_is_service_unavailable`. `require_max_fee_bps(None, …)` is `ApiError::ServiceUnavailable`; `Some(2_000)` is `Ok(2_000)`.
  - Do not assert exact coupon/fee figures in the cap-binding cases (R1).
- **`packages/api/tests/waterfall_accrual.rs`:** pass `MAX_FEE_BPS`; the expectations are unchanged.
- **`packages/worker/tests/loan_registry_reader.rs`:**
  - `decode_max_fee_bps` on ABI-encoded `uint32 5000` is `5000`; on an empty or short buffer it is `Err`.
  - `ILoanRegistry::maxFeeBpsCall::SELECTOR == [0xbf, 0x76, 0x9a, 0x3f]` pins the deployed selector.
- **`packages/worker/tests/stellar_loan_reader.rs`:** Stellar `decode_max_fee_bps(&ScVal::U32(5000))` is `5000`; `ScVal::I128`/`ScVal::Void` is `Err`.
- **New `packages/worker/tests/loan_registry_settings.rs`** (fake source and sink):
  - `sync_once` stores the value read under the given `(chain_id, registry)`;
  - a source error stores nothing and returns `Err`;
  - a sink error is returned as `Err`.
- **Optional `packages/shared/tests/loan_registry_settings_repo.rs`:** assert that `UPSERT_MAX_FEE_BPS_SQL` upserts on `(chain_id, contract_address)` and that the select is scoped by both columns, following the existing SQL-constant test style if one exists in `packages/shared/tests/`.
- **Manual evidence, already gathered while planning; the coder may re-run it:**
  - `cast call 0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231 "maxFeeBps()(uint32)" --rpc-url <hoodi>` → `5000`
  - `stellar contract invoke --id CDWN5B3F… --send=no -- max_fee_bps` → `5000`

## Docs to Update

- `docs/references/backend.md`:
  - New subsection `#### LoanRegistry settings sync` under §Event Indexer, after "PLUSD balance seed". It covers:
    - the table and its key;
    - the 60 s view read on both chains (`maxFeeBps()` / `max_fee_bps`), outside `index_once`;
    - normalized addresses;
    - logging behaviour;
    - why the event is not the source (pre-start-block configure call, Stellar event retention);
    - rollback (`DROP TABLE loan_registry_settings`).
  - Extend the "Waterfall data source" paragraph (line ~184) with one sentence: the fee cap uses that table's `max_fee_bps`, and a missing row is a `503`.
- `docs/product-specs/yield.md` §Waterfall components: add one sentence that the fee carve-outs
  are capped at the registry's live `max_fee_bps` (read on-chain per chain by the worker), and a
  `503` when it has not been read yet. Keep the edit to that sentence so it merges cleanly with
  #2124's wording of the cap formula.
- `docs/product-specs/trustee-dashboard.md` flow note A ("Shipped as the baseline calculator…"):
  append `503` to the documented error list.
- `ARCHITECTURE.md` `packages/worker` responsibilities: add "LoanRegistry `max_fee_bps` sync
  (view read, EVM and Stellar)" next to the other per-chain sync tasks, only if that list names
  such tasks. Otherwise skip.
- `docs/exec-plans/tech-debt-tracker.md` / `known-bugs.md`: no entry exists for the assumed 5000;
  none to close.
