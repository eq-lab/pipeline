//! Stellar/Soroban price-poller for the `staked_pipeline_usd` vault.
//!
//! Samples `FungibleVault::convert_to_assets(1 share)` at the current Soroban
//! ledger and inserts the result into the `share_prices` table, mirroring the
//! EVM price-poller path but using `simulateTransaction` instead of `eth_call`.
//!
//! Soroban RPC has no historical-state replay, so only the current ledger is
//! sampled on each tick. Downtime gaps are accepted as missing rows.

pub mod job;
pub mod poller;

pub use job::run_stellar_price_poller_job;
