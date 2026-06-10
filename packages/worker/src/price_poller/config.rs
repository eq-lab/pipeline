use anyhow::{Context, Result};
use std::env;

use crate::indexer::config::{parse_chain_type, parse_chains_env, ChainType};

pub struct PricePollerSettings {
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

impl PricePollerSettings {
    /// Parse price-poller settings for a single chain using `CHAIN_<id>_*` env vars.
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

    /// Parse price-poller settings for every chain in `CHAINS`.
    /// Returns one `PricePollerSettings` per configured chain.
    #[deprecated(note = "use all_evm_from_env to skip non-EVM chains")]
    pub fn all_from_env() -> Result<Vec<Self>> {
        Self::all_evm_from_env()
    }

    /// Parse price-poller settings for every EVM chain in `CHAINS`.
    /// Stellar chains are skipped silently (they have no EVM RPC or sPLUSD vault).
    pub fn all_evm_from_env() -> Result<Vec<Self>> {
        let chain_ids = parse_chains_env()?;
        chain_ids
            .into_iter()
            .filter_map(|id| match parse_chain_type(id) {
                Ok(ChainType::Stellar) => {
                    tracing::info!(
                        chain_id = id,
                        "price-poller skipped on Stellar chain: no EVM RPC or sPLUSD vault"
                    );
                    None
                }
                Ok(ChainType::Evm) => Some(PricePollerSettings::from_chain_env(id)),
                Err(e) => Some(Err(e)),
            })
            .collect()
    }
}
