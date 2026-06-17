use anyhow::{Context, Result};
use std::env;

use crate::indexer::config::{parse_chain_type, parse_chains_env, ChainType};

// ─── EVM price-poller settings ────────────────────────────────────────────────

/// Settings for the EVM price-poller — renamed from `PricePollerSettings` (Issue #568)
/// to clarify the chain-kind split against `StellarPricePollerSettings`.
pub struct EvmPricePollerSettings {
    pub eth_rpc_url: String,
    pub chain_id: i64,
    /// Block to start collecting prices from.
    pub start_block: u64,
    /// Collect a price snapshot every N blocks.
    pub block_interval: u64,
    /// Seconds to sleep between RPC polling cycles.
    pub poll_interval_secs: u64,
    /// Milliseconds to sleep between individual RPC calls within a backfill.
    pub rpc_delay_ms: u64,
}

impl EvmPricePollerSettings {
    /// Parse EVM price-poller settings for a single chain using `CHAIN_<id>_*` env vars.
    /// Falls back to `CHAIN_<id>_ETH_RPC_URL` from the indexer config (same URL).
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let p = format!("CHAIN_{chain_id}_");

        let eth_rpc_url = env::var(format!("{p}ETH_RPC_URL"))
            .with_context(|| format!("CHAIN_{chain_id}_ETH_RPC_URL is not set"))?;

        let start_block: u64 = env::var("JOB_PRICE_POLLER_START_BLOCK")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        let block_interval: u64 = env::var("JOB_PRICE_POLLER_BLOCK_INTERVAL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(300);

        let poll_interval_secs: u64 = env::var("JOB_PRICE_POLLER_POLL_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60);

        let rpc_delay_ms: u64 = env::var("JOB_PRICE_POLLER_RPC_DELAY_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(200);

        Ok(Self {
            eth_rpc_url,
            chain_id,
            start_block,
            block_interval,
            poll_interval_secs,
            rpc_delay_ms,
        })
    }
}

// ─── Stellar price-poller settings ───────────────────────────────────────────

/// Settings for the Stellar/Soroban price-poller (Issue #568).
///
/// Vault addresses come from `PositionRepo::get_vaults(chain_id)` — no `…_VAULT_ID`
/// env var. This section only configures RPC connectivity + cadence.
pub struct StellarPricePollerSettings {
    pub chain_id: i64,
    pub rpc_url: String,
    pub network_passphrase: String,
    pub poll_interval_secs: u64,
}

impl StellarPricePollerSettings {
    /// Parse Stellar price-poller settings for a single chain.
    ///
    /// - `CHAIN_<id>_PRICE_POLLER_STELLAR_RPC_URL` — optional, falls back to
    ///   `CHAIN_<id>_STELLAR_RPC_URL` (shared indexer RPC URL).
    /// - `CHAIN_<id>_PRICE_POLLER_STELLAR_NETWORK_PASSPHRASE` — optional, falls back to
    ///   `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE`; defaults to testnet passphrase for
    ///   `chain_id == 99_000_001`; otherwise error if both unset.
    /// - `CHAIN_<id>_PRICE_POLLER_STELLAR_INTERVAL_SECS` — per-chain Stellar cadence, default 60.
    ///   Mirrors the existing per-chain RPC URL / passphrase pattern; independent of the
    ///   EVM arm's `JOB_PRICE_POLLER_POLL_INTERVAL_SECS` so the two chain kinds can be
    ///   tuned separately (Soroban ledgers close every ~5s; EVM blocks every ~12s).
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let poller_p = format!("CHAIN_{chain_id}_PRICE_POLLER_STELLAR_");
        let indexer_p = format!("CHAIN_{chain_id}_STELLAR_");

        // RPC URL: price-poller-specific var, falling back to the indexer's var.
        let rpc_url = env::var(format!("{poller_p}RPC_URL"))
            .or_else(|_| env::var(format!("{indexer_p}RPC_URL")))
            .with_context(|| {
                format!(
                    "Neither {poller_p}RPC_URL nor {indexer_p}RPC_URL is set for Stellar chain {chain_id}"
                )
            })?;

        // Network passphrase: price-poller-specific var, falling back to the indexer's var,
        // with a default for the testnet sentinel chain id.
        let default_passphrase = if chain_id == 99_000_001 {
            "Test SDF Network ; September 2015".to_owned()
        } else {
            String::new()
        };
        let network_passphrase = env::var(format!("{poller_p}NETWORK_PASSPHRASE"))
            .or_else(|_| env::var(format!("{indexer_p}NETWORK_PASSPHRASE")))
            .unwrap_or(default_passphrase);
        if network_passphrase.is_empty() {
            anyhow::bail!(
                "{poller_p}NETWORK_PASSPHRASE (or {indexer_p}NETWORK_PASSPHRASE) is required for non-testnet Stellar chains"
            );
        }

        let poll_interval_secs: u64 = env::var(format!("{poller_p}INTERVAL_SECS"))
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60);

        Ok(Self {
            chain_id,
            rpc_url,
            network_passphrase,
            poll_interval_secs,
        })
    }
}

// ─── Unified per-chain price-poller settings ─────────────────────────────────

/// Unified per-chain price-poller settings dispatched by `CHAIN_<id>_TYPE`.
///
/// Mirrors `RelayerSettings::{Evm, Stellar}` from Issue #562.
pub enum PricePollerSettings {
    Evm(EvmPricePollerSettings),
    Stellar(StellarPricePollerSettings),
}

impl PricePollerSettings {
    /// Parse price-poller settings for every chain in `CHAINS`, dispatching per
    /// `CHAIN_<id>_TYPE` (EVM is the default when unset).
    pub fn all_from_env() -> Result<Vec<Self>> {
        let chain_ids = parse_chains_env()?;
        chain_ids
            .into_iter()
            .map(|id| match parse_chain_type(id)? {
                ChainType::Evm => Ok(PricePollerSettings::Evm(
                    EvmPricePollerSettings::from_chain_env(id)?,
                )),
                ChainType::Stellar => Ok(PricePollerSettings::Stellar(
                    StellarPricePollerSettings::from_chain_env(id)?,
                )),
            })
            .collect()
    }

    /// Returns the `chain_id` regardless of chain kind.
    pub fn chain_id(&self) -> i64 {
        match self {
            PricePollerSettings::Evm(s) => s.chain_id,
            PricePollerSettings::Stellar(s) => s.chain_id,
        }
    }
}
