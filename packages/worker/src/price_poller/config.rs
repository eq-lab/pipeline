use anyhow::{Context, Result};
use std::env;

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
    pub fn from_env() -> Result<Self> {
        let prefix = "JOB_PRICE_POLLER_";

        let eth_rpc_url = env::var(format!("{prefix}ETH_RPC_URL"))
            .or_else(|_| env::var("JOB_INDEXER_ETH_RPC_URL"))
            .context("JOB_PRICE_POLLER_ETH_RPC_URL (or JOB_INDEXER_ETH_RPC_URL) is not set")?;

        let chain_id: i64 = env::var(format!("{prefix}CHAIN_ID"))
            .or_else(|_| env::var("JOB_INDEXER_CHAIN_ID"))
            .context("JOB_PRICE_POLLER_CHAIN_ID (or JOB_INDEXER_CHAIN_ID) is not set")?
            .parse()
            .context("CHAIN_ID must be an integer")?;

        let start_block: u64 = env::var(format!("{prefix}START_BLOCK"))
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        let block_interval: u64 = env::var(format!("{prefix}BLOCK_INTERVAL"))
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(300);

        let poll_interval_secs: u64 = env::var(format!("{prefix}POLL_INTERVAL_SECS"))
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60);

        let rpc_delay_ms: u64 = env::var(format!("{prefix}RPC_DELAY_MS"))
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
