# Multi-chain price-poller: per-chain settings for both arms

Issue: #1470. Follows #1456 (per-chain env naming), whose price-poller rows were defined but deferred.
Standalone issue, not part of epic #1431 (whose decision 4 put the price-poller out of scope).

## Problem

The price-poller samples sPLUSD `convertToAssets(1 share)` into `share_prices`. Both arms exist
in code, but only the Stellar arm is actually configured per chain:

- The EVM arm reads its tuning from job-level `JOB_PRICE_POLLER_{START_BLOCK, BLOCK_INTERVAL,
  POLL_INTERVAL_SECS, RPC_DELAY_MS}`, so two EVM chains cannot be tuned independently.
- Both arms take the vault address and decimals from the `vaults` table, seeded by migrations.
  The only EVM row is the retired Hoodi vault (`560048`, `0xD2cf…`); `hoodi-v5` deploys sPLUSD at
  `0x87CD1002bdB9401423cb50A860314FC8f11440Cd`, and `chain_id 1` has no row at all. Adding a
  network today means a migration, not configuration.
- Stellar keys still use the pre-#1456 shape `CHAIN_<id>_PRICE_POLLER_STELLAR_*`.
- The EVM arm lives in `price_poller/mod.rs`; the Stellar arm has its own `stellar/` module.

## Goal

A network is added to the price-poller by configuration alone: its entry in `CHAINS` plus a
`CHAIN_<id>_<TYPE>_PRICE_POLLER_*` block. Every setting for a chain is readable in that block,
with no job-level fallback to resolve.

## Contract surface (unchanged)

`StakedPipelineUSD` (`pipeline-contracts/src/StakedPipelineUSD.sol`) inherits OZ
`ERC4626Upgradeable`: `convertToAssets(uint256)`, `decimals()` and `asset()` are available, and
`asset()` is `PipelineUSD`, which exposes `decimals()`. The Stellar vault is `stellar-tokens`
0.7.1 `FungibleVault`: `convert_to_assets`, `decimals`, `query_asset`; the asset is a SAC with
`decimals`. The sampling call itself does not change on either arm.

## Settings

Per chain only. `JOB_PRICE_POLLER_ENABLED` stays the single job-level key; the four
`JOB_PRICE_POLLER_*` tuning keys are removed. `…` is `CHAIN_<id>_EVM_` or `CHAIN_<id>_STELLAR_`.

| Key | EVM | Stellar | When unset |
|---|---|---|---|
| `…PRICE_POLLER_STAKED_PLUSD_ADDRESS` | required, `0x…` | required, `C…` Strkey | startup error |
| `…PRICE_POLLER_RPC_URL` | optional | optional | chain-wide `CHAIN_<id>_<TYPE>_RPC_URL` |
| `…PRICE_POLLER_NETWORK_PASSPHRASE` | — | optional | chain-wide `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE`; testnet passphrase for `99000001`; else startup error |
| `…PRICE_POLLER_POLL_INTERVAL_SECS` | optional | optional | 60 |
| `…PRICE_POLLER_START_BLOCK` | optional | — | chain-wide `CHAIN_<id>_EVM_START_BLOCK`, else 0 |
| `…PRICE_POLLER_BLOCK_INTERVAL` | optional | — | 300 |
| `…PRICE_POLLER_RPC_DELAY_MS` | optional | — | 200 |

Falling back to a chain-wide key is not a job-level fallback: chain-wide keys are facts about the
chain (#1456). `START_BLOCK` falls back to the chain's deploy block because a 0 default on
mainnet would walk ~77k empty grid points before the vault exists.

A malformed value (non-numeric interval, `0` for `BLOCK_INTERVAL` or `POLL_INTERVAL_SECS`, bad
address) is a startup error, not a silent default. Keys of the other network kind are already
rejected by `validate_chain_kind_keys`.

### Renames

| Old | New |
|---|---|
| `JOB_PRICE_POLLER_START_BLOCK` | `CHAIN_<id>_EVM_PRICE_POLLER_START_BLOCK` |
| `JOB_PRICE_POLLER_BLOCK_INTERVAL` | `CHAIN_<id>_EVM_PRICE_POLLER_BLOCK_INTERVAL` |
| `JOB_PRICE_POLLER_POLL_INTERVAL_SECS` | `CHAIN_<id>_EVM_PRICE_POLLER_POLL_INTERVAL_SECS` |
| `JOB_PRICE_POLLER_RPC_DELAY_MS` | `CHAIN_<id>_EVM_PRICE_POLLER_RPC_DELAY_MS` |
| `CHAIN_<id>_PRICE_POLLER_STELLAR_RPC_URL` | `CHAIN_<id>_STELLAR_PRICE_POLLER_RPC_URL` |
| `CHAIN_<id>_PRICE_POLLER_STELLAR_NETWORK_PASSPHRASE` | `CHAIN_<id>_STELLAR_PRICE_POLLER_NETWORK_PASSPHRASE` |
| `CHAIN_<id>_PRICE_POLLER_STELLAR_INTERVAL_SECS` | `CHAIN_<id>_STELLAR_PRICE_POLLER_POLL_INTERVAL_SECS` |
| — (from `vaults` table) | `CHAIN_<id>_<TYPE>_PRICE_POLLER_STAKED_PLUSD_ADDRESS` |

The Stellar interval deviates from the #1456 mapping (`…_INTERVAL_SECS`) so both arms spell the
same setting the same way. #1456's price-poller table is updated to match.

## Vault source: settings, mirrored into `vaults`

The configured address is the vault the poller samples. `get_vaults()` is no longer read by the
poller; it stays the source for the API (`/stats/vaults`, `stats.rs`), so the poller keeps the
table in step:

1. On task start, per chain, read decimals from chain —
   EVM: `vault.decimals()`, `vault.asset()`, `asset.decimals()` via `eth_call`;
   Stellar: `decimals()`, `query_asset()`, then the SAC's `decimals()` via `simulateTransaction`.
2. `PositionRepo::upsert_vault(chain_id, address, "sPLUSD", asset_decimals, share_decimals)` —
   `INSERT … ON CONFLICT (chain_id, address) DO UPDATE` the decimals and name.
3. Enter the existing sampling loop for that one vault.

Bootstrap failure (RPC down, call reverts) is retried every `POLL_INTERVAL_SECS` inside the
chain's task; other chains and jobs are unaffected, matching how sampling errors are handled
today. Stale rows (the Hoodi `0xD2cf…` vault) are left in place and ignored by the poller.
Existing seed migrations are not edited.

## Structure

```
price_poller/
  mod.rs        re-exports, align_to_grid
  config.rs     PricePollerSettings::{Evm, Stellar}, all_from_env
  evm/          job.rs (bootstrap + loop), poller.rs (convertToAssets, decimals, asset)
  stellar/      job.rs (bootstrap + loop), poller.rs (convert_to_assets, decimals, query_asset)
```

`main.rs` dispatch is unchanged apart from the renamed EVM entry point. Sampling behaviour is
unchanged: the EVM arm backfills on the `BLOCK_INTERVAL` grid from its cursor, the Stellar arm
samples the current ledger.

## Testing

Pure unit tests in `packages/worker/tests/`, no database:

- Settings: per-chain parsing on both arms, chain-wide fallbacks, the `99000001` passphrase
  default, required address, `0x`/Strkey validation, malformed and zero values rejected, old key
  names not read.
- Decoding of the EVM `decimals()` / `asset()` returns and the Stellar `u32` / `Address` returns.
- Existing `align_to_grid` and Stellar decode tests keep passing.

## Docs

- `.env.example`: drop the four `JOB_PRICE_POLLER_*` tuning lines; add an EVM price-poller block
  to the EVM example and rename the Stellar block.
- `docs/product-specs/staking.md`: share-price sampling section — vault from settings, per-chain
  interval key.
- `docs/superpowers/specs/2026-10-09-env-naming-standardization-design.md`: price-poller table
  marked implemented, with the `POLL_INTERVAL_SECS` deviation and the EVM rows.

## Rollout

Clean break, as in #1456 — no dual-read:

1. Add the new keys, including each chain's `STAKED_PLUSD_ADDRESS`, to Vault at
   `secrets/data/pipeline/{test,prod}/worker` alongside the old ones.
2. Merge the code change.
3. Update the argocd manifests (outside this repo) and sync.
4. Remove the old keys.

With `JOB_PRICE_POLLER_ENABLED=true`, a chain in `CHAINS` without `STAKED_PLUSD_ADDRESS` fails
startup — the intended loud failure if step 3 lags step 2.

## Out of scope

- Sampling other vaults or assets; the poller samples exactly one sPLUSD vault per chain.
- Removing or migrating stale `vaults` rows.
- TD-18 (Stellar sample timestamp uses `Utc::now()`).
