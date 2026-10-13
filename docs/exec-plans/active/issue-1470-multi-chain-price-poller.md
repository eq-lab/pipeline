# Issue #1470: Price-poller: per-chain settings for the EVM and Stellar arms

Source: https://github.com/eq-lab/pipeline/issues/1470

Design spec (approved, source of truth):
[`docs/superpowers/specs/2026-10-12-multi-chain-price-poller-design.md`](../../superpowers/specs/2026-10-12-multi-chain-price-poller-design.md).
Follows #1456 (per-chain env naming, merged as #1457), whose price-poller rows were defined
but deferred. Standalone issue, not part of epic #1431. Branch `feat/multi-chain-price-poller`,
draft PR #1472.

No Figma reference — backend only, no visual verification step.

## Scope

### In scope

1. **Settings** — `packages/worker/src/price_poller/config.rs` rewritten: every price-poller
   setting is per chain under `CHAIN_<id>_<EVM|STELLAR>_PRICE_POLLER_*`, with the fallbacks and
   defaults in the spec's Settings table. The four `JOB_PRICE_POLLER_*` tuning keys and the three
   `CHAIN_<id>_PRICE_POLLER_STELLAR_*` keys are no longer read. `JOB_PRICE_POLLER_ENABLED`
   stays.
2. **Vault from settings** — the required `…_PRICE_POLLER_STAKED_PLUSD_ADDRESS` is the one
   vault each chain's task samples. On task start the task reads share and asset decimals from
   chain and upserts the row into `vaults` (new `PositionRepo::upsert_vault`); the poller no
   longer calls `get_vaults`.
3. **Restructure** — the EVM arm moves out of `price_poller/mod.rs` into `price_poller/evm/`
   (`job.rs`, `poller.rs`), mirroring `price_poller/stellar/`. `mod.rs` keeps re-exports and
   `align_to_grid`. EVM entry point renamed `run_price_poller_job` → `run_evm_price_poller_job`.
4. **Decoders** — pure, testable decoders for EVM `decimals()` / `asset()` returns and Soroban
   `u32` / contract-`Address` returns.
5. **Tests, `.env.example`, docs, rename guard** — see Test Strategy and Docs to Update.

### Out of scope (per spec)

- Sampling any vault other than the one sPLUSD vault per chain.
- Removing or migrating stale `vaults` rows; editing existing seed migrations.
- Changing the sampling call or sampling behaviour (EVM grid backfill, Stellar current ledger).
- TD-18 (Stellar sample timestamp from `Utc::now()`).
- argocd manifest changes (outside this repo; rollout step 3).

## Findings from research

- **F1 — prod samples nothing today.** `pipeline/prod.yaml` (argocd) runs the poller on
  `CHAINS=99000002`, but no migration seeds a `vaults` row for `99000002`
  (`20260515000001_staking_pnl.sql` seeds `560048`, `20260617000001_seed_stellar_splusd_vault.sql`
  seeds `99000001`). The settings-driven vault fixes this as a side effect.
- **F2 — the testnet seed row is also stale.** `test.yaml` configures the Stellar indexer with
  sPLUSD `CDHSWXEG…544XM`, but the seeded `99000001` row is `CDO4X3HC…KLW5`. After this change
  `99000001` holds two `vaults` rows, and `99000001` is the API's `DEFAULT_CHAIN_ID` on test —
  see **Q1**.
- **F3 — test env relies on job-level EVM tuning.** `test.yaml` sets
  `JOB_PRICE_POLLER_START_BLOCK=3982150`, `BLOCK_INTERVAL=25`, `POLL_INTERVAL_SECS=30`,
  `RPC_DELAY_MS=1000`. Only the missing address fails loudly after the cut-over; unported tuning
  silently falls back to `0`/`300`/`60`/`200` (or the chain-wide `START_BLOCK`). Rollout step 1
  must copy all four per chain (`CHAIN_560048_EVM_PRICE_POLLER_*`).
- **F4 — `vaults.address` uniqueness is case-sensitive.** `UNIQUE(chain_id, address)` on
  `TEXT`. The seeded EVM row is EIP-55 checksummed, the Stellar rows upper-case Strkeys. The
  upsert must write the same canonical forms or it creates duplicate rows.
- **F5 — contract surface verified.** `StakedPipelineUSD.sol` overrides `decimals()` (uint8)
  and inherits OZ `ERC4626Upgradeable.asset()` (address). In the Stellar contract
  (`pipeline-stellar-contracts/contracts/staked-pipeline-usd/src/lib.rs`) `decimals` is
  `fn decimals(e) -> u32` (= `Vault::decimals`, underlying + offset); `query_asset` is the
  `FungibleVault` default `fn query_asset(e) -> Address`
  (`stellar-tokens-0.7.1/src/vault/mod.rs:54`); `convert_to_assets(e, shares: i128) -> i128`
  (`vault/mod.rs:107`). The SAC's `decimals` returns `u32`. On the wire these are `ScVal::U32`
  and `ScVal::Address(ScAddress::Contract(_))`.
- **F6 — the #1456 rename guard would trip on old-name tests.** `scripts/check-chain-env-names.sh`
  scans `packages/` (tests included) and matches `CHAIN_{id}_…` inside `format!` strings. Once
  `PRICE_POLLER_STELLAR_` is added to its retired list, tests asserting the old names are ignored
  must build those keys so the literal never appears (e.g. `["CHAIN_", &id, "_PRICE_POLLER_",
  "STELLAR_INTERVAL_SECS"].concat()`).
- **F7 — `env_parse` / `env_require` in `indexer/config.rs` are private** and treat a blank value
  as a value (blank numeric → parse error, blank string → accepted). The per-chain indexer tuning
  helper (`env_parse_chain_or_job`, #1435 D2) instead treats blank as unset. See **D2**.

## Decisions

- **D1 — settings shape.**
  ```rust
  pub struct EvmPricePollerSettings {
      pub chain_id: i64,
      pub rpc_url: String,
      pub staked_plusd_address: Address,
      pub start_block: u64,
      pub block_interval: u64,
      pub poll_interval_secs: u64,
      pub rpc_delay_ms: u64,
  }
  pub struct StellarPricePollerSettings {
      pub chain_id: i64,
      pub rpc_url: String,
      pub network_passphrase: String,
      pub staked_plusd_address: String,
      pub poll_interval_secs: u64,
  }
  ```
  `PricePollerSettings::{Evm, Stellar}`, `all_from_env` and `chain_id()` keep their current
  shape (`all_from_env` already calls `validate_chain_kind_keys`). `eth_rpc_url` → `rpc_url`
  for symmetry between arms.
- **D2 — blank means unset, everywhere in this file.** A key set to an empty or whitespace
  value resolves as if absent and the next fallback applies; a set value is trimmed before
  parsing. Matches #1435 D2 and the repo's per-chain convention. Hence one private helper in
  `price_poller/config.rs`:
  `fn env_first(keys: &[String]) -> Option<(String, String)>` returning the first key with a
  non-blank trimmed value and that value; numeric parse errors name the key that supplied the
  value. The indexer's `env_parse`/`env_require` are not reused (F7) — their blank semantics
  differ. The `shared::chains` helpers are reused via the existing `crate::indexer::config`
  re-exports: `parse_chains_env`, `parse_chain_type`, `validate_chain_kind_keys`,
  `validate_contract_id`.
- **D3 — validation at startup.** Errors, all naming the key:
  - `STAKED_PLUSD_ADDRESS` unset/blank → "`<key>` is required".
  - EVM address not a valid `0x…` `alloy::primitives::Address` → error.
  - Stellar address: `validate_contract_id` (length, `C` prefix, alphabet, upper-cases), then
    `stellar_strkey::Contract::from_string` for the CRC16, mirroring
    `indexer/config.rs:116-129`.
  - RPC URL: neither component nor chain-wide key set → error naming both; a set value that
    does not parse as `reqwest::Url` → error (replaces today's in-task
    `.parse().expect("valid RPC URL")` panic).
  - Numeric keys non-numeric → error; `BLOCK_INTERVAL == 0` or `POLL_INTERVAL_SECS == 0` → error.
    `START_BLOCK == 0` and `RPC_DELAY_MS == 0` stay legal.
  - Stellar passphrase: component key → chain-wide `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE` →
    `"Test SDF Network ; September 2015"` for `99000001` → error.
- **D4 — `START_BLOCK` fallback is parsed with the same strictness.** If the component key is
  unset, `CHAIN_<id>_EVM_START_BLOCK` is read through the same helper (blank = unset, malformed
  = error), then `0`.
- **D5 — canonical address forms (F4).** EVM rows are written with `Address::to_checksum(None)`
  (EIP-55, same form as the existing seed); Stellar rows with the upper-cased Strkey from
  `validate_contract_id`. The same string is passed to `insert_share_price` and
  `get_price_cursor`.
- **D6 — `upsert_vault` returns the row.**
  ```rust
  pub async fn upsert_vault(
      &self, chain_id: i64, address: &str, name: &str,
      asset_decimals: i16, share_decimals: i16,
  ) -> anyhow::Result<Vault>
  ```
  `INSERT … ON CONFLICT (chain_id, address) DO UPDATE SET name = EXCLUDED.name,
  asset_decimals = EXCLUDED.asset_decimals, share_decimals = EXCLUDED.share_decimals
  RETURNING id, chain_id, address, name, asset_decimals, share_decimals`. Runtime
  `sqlx::query_as::<_, Vault>` like the rest of `position_repo.rs` — no offline query cache
  involved. Returning `Vault` lets the existing EVM `collect_prices(…, &Vault)` signature stay.
- **D7 — bootstrap is the whole "decimals + upsert" step, retried as a unit.** Any failure
  (RPC error, revert, short return, decimals out of `i16` range, DB error) logs at `error` with
  `chain_id` and sleeps `poll_interval_secs` before retrying. The task never exits on bootstrap
  failure. Decimals convert `u8`/`u32` → `i16` with `i16::try_from`.
- **D8 — old keys are ignored, not rejected.** The rollout keeps old and new keys side by side
  in Vault until step 4, so startup must not fail on `JOB_PRICE_POLLER_{START_BLOCK,…}` or
  `CHAIN_<id>_PRICE_POLLER_STELLAR_*`. Tests assert they have no effect.
- **D9 — Stellar decoders live in `crate::stellar::scval`** next to `extract_i128`:
  `pub fn scval_u32(val: &ScVal) -> Option<u32>` and
  `pub fn scval_contract(val: &ScVal) -> Option<stellar_strkey::Contract>` (`ScAddress::Contract`
  only; account addresses → `None`). EVM decoders live in `price_poller/evm/poller.rs`:
  `pub fn decode_decimals(ret: &[u8]) -> anyhow::Result<u8>` and
  `pub fn decode_asset(ret: &[u8]) -> anyhow::Result<Address>`, via
  `…Call::abi_decode_returns(ret, true)` (alloy 0.8 signature, as in
  `indexer/loan_registry_reader.rs:74`).

## Assumptions and Risks

- **Rollout ordering (ops, outside this repo).** Steps 1–4 of the spec's Rollout. F3 is the
  trap: tuning that is not copied per chain silently reverts to defaults. The PR description
  must list the exact per-chain keys for `560048`, `99000001` (test) and `99000002` (prod),
  including each chain's `STAKED_PLUSD_ADDRESS` (`560048`: `0x87CD1002bdB9401423cb50A860314FC8f11440Cd`
  per the Issue; `99000001`: the indexer's `CDHSWXEG…544XM`; `99000002`: `CDT3UUNL…ZPHAW`, from
  `prod.yaml`) — to be confirmed by the user, not taken from this plan.
- **New `share_prices` series per new address.** A vault address that has no rows starts from
  `START_BLOCK` (EVM) or the current ledger (Stellar). Expected; noted for the PR.
- **Stale rows remain visible to the API (F2) — resolved as Q1 (a).** `get_vaults` keeps no
  `ORDER BY` and the frontend reads `vaults[0]`, so after rollout the stale rows must be deleted
  by hand: `99000001` `CDO4X3HC…KLW5` on test (the API default chain) and `560048` `0xD2cf…`.
  The PR description lists this as a post-rollout step after step 3 of the spec's Rollout.
- **`upsert_vault` is not exercised by tests.** Tests are pure unit tests with no Postgres
  (repo rule). The SQL is small and reviewed by eye; the decimals it writes are covered via the
  decoders.
- **Comment policy.** Every file rewritten here (`config.rs`, `evm/*.rs`, `stellar/job.rs`,
  `stellar/poller.rs`, `stellar/mod.rs`, `mod.rs`) drops its existing doc comments and carries at
  most one 2–3-line header pointing at the design spec. Untouched files (`scval.rs`,
  `position_repo.rs`) keep their existing comments; the new functions in them get none.
- **Process-global env in tests.** The new settings test binary mutates `CHAINS` and uses its own
  `ENV_LOCK` (pattern from `chain_config.rs:17`) plus synthetic chain ids.
- **No network in tests.** All RPC-facing code is behind the pure decoders; nothing in the test
  suite contacts an RPC.

## Open Questions

None. **Q1** (stale `vaults` row on the testnet default chain) was resolved by the user as
option (a): no code change; the stale rows are deleted by hand after rollout — see
**Assumptions and Risks → Stale rows**.

## Implementation Steps

1. **`PositionRepo::upsert_vault`** — add to `packages/shared/src/position_repo.rs` next to
   `get_vaults` (line 64), per **D6**. Leave `get_vaults` untouched (Q1 resolved as (a)).

2. **Stellar decoders** — add `scval_u32` and `scval_contract` to
   `packages/worker/src/stellar/scval.rs` per **D9**. No comments on the new functions.

3. **Settings** — rewrite `packages/worker/src/price_poller/config.rs` per **D1–D4**:
   - Private helpers: `env_first(keys)` (D2), `parse_u64(chain_id, keys, default) -> Result<u64>`
     (error names the supplying key), `nonzero(key_label, value) -> Result<u64>`.
   - `EvmPricePollerSettings::from_chain_env(chain_id)` with `p = CHAIN_{id}_EVM_PRICE_POLLER_`:
     `rpc_url` ← `{p}RPC_URL`, `CHAIN_{id}_EVM_RPC_URL`; `staked_plusd_address` ←
     `{p}STAKED_PLUSD_ADDRESS` (required, `Address` parse); `start_block` ← `{p}START_BLOCK`,
     `CHAIN_{id}_EVM_START_BLOCK`, `0`; `block_interval` ← `{p}BLOCK_INTERVAL`, `300`, nonzero;
     `poll_interval_secs` ← `{p}POLL_INTERVAL_SECS`, `60`, nonzero; `rpc_delay_ms` ←
     `{p}RPC_DELAY_MS`, `200`.
   - `StellarPricePollerSettings::from_chain_env(chain_id)` with
     `p = CHAIN_{id}_STELLAR_PRICE_POLLER_`: `rpc_url` ← `{p}RPC_URL`, `CHAIN_{id}_STELLAR_RPC_URL`;
     `network_passphrase` per D3; `staked_plusd_address` ← `{p}STAKED_PLUSD_ADDRESS` (required,
     `validate_contract_id` + `Contract::from_string`); `poll_interval_secs` ←
     `{p}POLL_INTERVAL_SECS`, `60`, nonzero.
   - `PricePollerSettings` enum, `all_from_env`, `chain_id()` unchanged in behaviour.
   - Strip all existing doc comments; one spec-pointer header.

4. **EVM arm → `price_poller/evm/`**:
   - `evm/mod.rs`: `pub mod job; pub mod poller; pub use job::run_evm_price_poller_job;`
   - `evm/poller.rs`: the `sol!` interface extended with `function decimals() external view
     returns (uint8); function asset() external view returns (address);` (one interface serves
     the vault and, for `decimals`, the PLUSD asset); `decode_decimals`, `decode_asset` (D9);
     `pub async fn fetch_decimals(provider, contract) -> Result<u8>`,
     `pub async fn fetch_asset(provider, vault) -> Result<Address>` (`eth_call` at latest);
     `fetch_price_and_timestamp` moved verbatim from `mod.rs` (keeping its `< 32` bytes guard,
     minus comments). `HttpProvider` type alias moves here.
   - `evm/job.rs`: `pub async fn run_evm_price_poller_job(settings, repo) -> Result<()>`:
     build the provider from the pre-validated `settings.rpc_url`; **bootstrap loop** (D7) —
     `share = fetch_decimals(vault)`, `asset = fetch_asset(vault)`,
     `asset_decimals = fetch_decimals(asset)`, then
     `repo.upsert_vault(chain_id, &addr.to_checksum(None), "sPLUSD", asset_dec, share_dec)`;
     log `info` with chain_id, address and both decimals on success; then the **sampling loop**:
     `collect_prices(&provider, &repo, &settings, addr, &vault)` + sleep `poll_interval_secs`,
     errors logged as today. `collect_prices` moves here unchanged except for comment removal
     and calling `super::super::align_to_grid` (or `crate::price_poller::align_to_grid`).

5. **Stellar arm**:
   - `stellar/poller.rs`: extract the envelope build + `simulate_transaction` + error/empty
     checks from `fetch_share_price` into a private
     `async fn simulate_view(&self, contract: &Contract, function: &str, args: Vec<ScVal>) ->
     Result<(ScVal, u32)>` (return value + `latest_ledger`); rewrite `fetch_share_price` on top
     of it (sampling maths unchanged); add `pub async fn fetch_decimals(&self, contract) ->
     Result<u32>` (`"decimals"`, `scval_u32`) and `pub async fn fetch_asset(&self, vault) ->
     Result<Contract>` (`"query_asset"`, `scval_contract`). Strip comments; keep `SamplePoint`.
   - `stellar/job.rs`: parse `Contract` from `settings.staked_plusd_address`; bootstrap loop
     (D7) — vault `decimals`, `query_asset`, asset `decimals`, `upsert_vault(chain_id,
     &settings.staked_plusd_address, "sPLUSD", …)`; then the sampling loop for that one vault
     with today's insert/warn behaviour. No `get_vaults` call.
   - `stellar/mod.rs`: header replaced with a spec pointer; exports unchanged.

6. **`price_poller/mod.rs`** — reduce to `pub mod config; pub mod evm; pub mod stellar;`,
   re-exports (`EvmPricePollerSettings`, `PricePollerSettings`, `StellarPricePollerSettings`,
   `run_evm_price_poller_job`, `run_stellar_price_poller_job`) and `align_to_grid` (unchanged
   body).

7. **`packages/worker/src/main.rs`** (lines 9-11, 92) — import and call
   `run_evm_price_poller_job`. Nothing else changes.

8. **Rename guard** — `scripts/check-chain-env-names.sh`: add `PRICE_POLLER_STELLAR_` to
   `retired`; add a second pattern for the retired job-level keys
   `JOB_PRICE_POLLER_(START_BLOCK|BLOCK_INTERVAL|POLL_INTERVAL_SECS|RPC_DELAY_MS)` checked over
   the same paths; update the header to say the price-poller is now covered (#1470). Tests that
   assert old keys are ignored build those names without the literal (F6).

9. **`.env.example`** — drop lines 68-71 (`JOB_PRICE_POLLER_*` tuning). In the EVM example block
   (after the indexer tuning lines, ~line 107) add the EVM price-poller block:
   `CHAIN_1_EVM_PRICE_POLLER_STAKED_PLUSD_ADDRESS` (required), `_RPC_URL` (optional, falls back
   to `CHAIN_1_EVM_RPC_URL`), `_START_BLOCK` (falls back to `CHAIN_1_EVM_START_BLOCK`, then 0),
   `_BLOCK_INTERVAL` (300), `_POLL_INTERVAL_SECS` (60), `_RPC_DELAY_MS` (200). Replace the Stellar
   price-poller block (lines 133-139) with the `CHAIN_99000001_STELLAR_PRICE_POLLER_*` names,
   adding `_STAKED_PLUSD_ADDRESS` and dropping the "vault address comes from the `vaults` table"
   and "`JOB_PRICE_POLLER_*` are EVM-only" sentences.

10. **Tests** — per Test Strategy.

11. **Docs** — per Docs to Update.

12. **Verify**:
    ```bash
    cargo test -p pipeline-worker --test price_poller_config --test price_poller \
      --test stellar_price_poller_decode --test chain_config --test chain_kind_keys
    cargo test --all
    cargo clippy --all --tests -- -D warnings
    scripts/check-chain-env-names.sh
    npx tsx scripts/lint-docs.ts
    ```

## Test Strategy

Pure unit tests in `packages/worker/tests/`, no `DATABASE_URL` / `POSTGRES_URL`, no Postgres,
no RPC. No inline `#[cfg(test)]`. No comments in test bodies.

**New `packages/worker/tests/price_poller_config.rs`** (own binary, `static ENV_LOCK`, lock taken
with `unwrap_or_else(PoisonError::into_inner)`; helpers that set/clear every key a test touches
on entry and exit; synthetic ids e.g. `71001`, `71002` EVM and `99000001` / `79000001` Stellar):

EVM (`EvmPricePollerSettings::from_chain_env`):
1. Only required keys (address + chain-wide RPC) → defaults `0 / 300 / 60 / 200`, RPC from
   `CHAIN_<id>_EVM_RPC_URL`.
2. All six component keys set → each wins over chain-wide / default.
3. `RPC_URL` fallback; neither set → error naming both keys.
4. `START_BLOCK` → chain-wide `CHAIN_<id>_EVM_START_BLOCK` when the component key is unset; `0`
   when both unset.
5. Address missing / blank → error naming `…_PRICE_POLLER_STAKED_PLUSD_ADDRESS`; malformed
   (`0x123`, no `0x`, non-hex) → error.
6. Non-numeric `BLOCK_INTERVAL` → error naming the key; `BLOCK_INTERVAL=0` and
   `POLL_INTERVAL_SECS=0` → error; `RPC_DELAY_MS=0` and `START_BLOCK=0` → ok.
7. Blank optional value falls through (D2); padded value is trimmed.
8. Malformed RPC URL → error.
9. Old keys ignored: `JOB_PRICE_POLLER_{START_BLOCK,BLOCK_INTERVAL,POLL_INTERVAL_SECS,RPC_DELAY_MS}`
   set to distinctive values → defaults still apply (names built by concatenation, F6).
10. Stored address round-trips to the EIP-55 form via `to_checksum(None)` for a lower-case input.

Stellar (`StellarPricePollerSettings::from_chain_env`):
11. `99000001` with address + chain-wide RPC → testnet passphrase default, interval 60.
12. Component `RPC_URL` / `NETWORK_PASSPHRASE` win over chain-wide; chain-wide used when
    component unset.
13. Non-testnet id with no passphrase → error.
14. `POLL_INTERVAL_SECS` override; `0` and non-numeric → error.
15. Address missing → error; `G…` account Strkey, wrong length, bad alphabet, bad CRC → error;
    lower-case valid address → upper-cased.
16. Old keys ignored: `CHAIN_<id>_PRICE_POLLER_STELLAR_{RPC_URL,NETWORK_PASSPHRASE,INTERVAL_SECS}`
    set alone → RPC/passphrase come from chain-wide keys and interval stays 60; with no chain-wide
    RPC, still an error.

Dispatch (`PricePollerSettings::all_from_env`):
17. `CHAINS=71001,99000001` with one chain of each type → one `Evm` and one `Stellar`, each with
    its own values; `chain_id()` correct.
18. Two EVM chains with different component values → independent settings (the issue's goal).
19. A chain in `CHAINS` without `STAKED_PLUSD_ADDRESS` → `all_from_env` errors.
20. `CHAIN_<id>_STELLAR_PRICE_POLLER_RPC_URL` on an EVM chain → rejected by
    `validate_chain_kind_keys`.

**Deleted:** `packages/worker/tests/stellar_price_poller_config.rs` — every case is superseded by
11–17 under the new names, and it hard-codes the retired names the guard now rejects.
**Edited:** `packages/worker/tests/chain_config.rs` — remove the `EvmPricePollerSettings` test and
import (lines 11, 69-80; covered by case 3) and update the file header to drop "price-poller".

**`packages/worker/tests/price_poller.rs`** — keep `test_align_to_grid`; add EVM decoder cases:
- `decode_decimals` on an ABI-encoded `uint8` 6 / 18 → `6` / `18`; on fewer than 32 bytes → error.
- `decode_asset` on an ABI-encoded address → the address; empty input → error.
(Fixtures built with `alloy::sol_types::SolValue::abi_encode`.)

**`packages/worker/tests/stellar_price_poller_decode.rs`** — keep existing cases; add:
- `scval_u32(&ScVal::U32(7)) == Some(7)`; `ScVal::I128` / `ScVal::Void` → `None`.
- `scval_contract` on `ScVal::Address(ScAddress::Contract(..))` built from the fixture vault →
  the same Strkey; an account `ScAddress` → `None`; a non-address `ScVal` → `None`.
- Envelope encoding for `"decimals"` and `"query_asset"` (no args) via `build_invoke_envelope`,
  asserting function name and empty arg list.

Regression: `cargo test --all` green, in particular `chain_kind_keys`, `indexer_tuning_overrides`
and `stellar_config`, which share `CHAIN_<id>_*` key space.

## Docs to Update

- **`.env.example`** — step 9.
- **`docs/product-specs/staking.md`** — "Share-price sampling — Stellar/Soroban" (lines 120-126):
  interval key becomes `CHAIN_<id>_STELLAR_PRICE_POLLER_POLL_INTERVAL_SECS`; replace the
  "Vault discovery is DB-driven…" paragraph with: the vault is
  `CHAIN_<id>_<TYPE>_PRICE_POLLER_STAKED_PLUSD_ADDRESS`, decimals are read from chain at task
  start and mirrored into `vaults` for the API. Add a short EVM counterpart sentence (grid
  backfill every `…_BLOCK_INTERVAL` blocks from `…_START_BLOCK`), since the section today only
  describes Stellar.
- **`docs/superpowers/specs/2026-10-09-env-naming-standardization-design.md`** — the
  "Price-poller — deferred" table (lines 160-166): retitle as implemented in #1470, change the
  interval row's target to `CHAIN_<id>_STELLAR_PRICE_POLLER_POLL_INTERVAL_SECS` with a note on
  the deviation, and add the four EVM rows plus the new `STAKED_PLUSD_ADDRESS` row. Update the
  "Out of scope" bullet (line 204) to drop the price-poller.
- **`ARCHITECTURE.md:122`** — one clause: the price-poller is configured per chain via
  `CHAIN_<id>_<TYPE>_PRICE_POLLER_*` and samples the vault named there. Small addition beyond the
  spec's Docs list, because the paragraph already describes the price-poller's per-chain
  dispatch.
- **`scripts/check-chain-env-names.sh`** header — step 8.
- No `docs/exec-plans/tech-debt-tracker.md` or `known-bugs.md` entry (Q1 resolved as (a)).
