use std::env;

use anyhow::{Context, Result};

pub use shared::chains::parse_chains_env;

pub struct IndexerJobSettings {
    pub eth_rpc_url: String,
    pub chain_id: i64,
    pub start_block: u64,
    pub dm_contracts: Vec<String>,
    pub wq_contracts: Vec<String>,
    pub splusd_contracts: Vec<String>,
    pub loan_registry_contracts: Vec<String>,
    pub yield_minter_contracts: Vec<String>,
    pub polling_block_range: u64,
    pub polling_interval_ms: u64,
    pub log_confirmations_delay: u64,
    pub ipfs_gateway_url: String,
}

impl IndexerJobSettings {
    /// Parse indexer settings for a single chain using `CHAIN_<id>_*` env vars.
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let p = format!("CHAIN_{chain_id}_");

        Ok(Self {
            eth_rpc_url: env_require(&format!("{p}ETH_RPC_URL"))?,
            chain_id,
            start_block: env_parse(&format!("{p}START_BLOCK"), 0)?,
            dm_contracts: env_csv_require(&format!("{p}DM_CONTRACTS"))?,
            wq_contracts: env_csv_require(&format!("{p}WQ_CONTRACTS"))?,
            splusd_contracts: env_csv_require(&format!("{p}SPLUSD_CONTRACTS"))?,
            loan_registry_contracts: env_csv_require(&format!("{p}LOAN_REGISTRY_CONTRACTS"))?,
            yield_minter_contracts: env_csv_require(&format!("{p}YIELD_MINTER_CONTRACTS"))?,
            polling_block_range: env_parse("JOB_INDEXER_POLLING_BLOCK_RANGE", 1000)?,
            polling_interval_ms: env_parse("JOB_INDEXER_POLLING_INTERVAL_MS", 500)?,
            log_confirmations_delay: env_parse("JOB_INDEXER_LOG_CONFIRMATIONS_DELAY", 12)?,
            ipfs_gateway_url: env::var("JOB_INDEXER_IPFS_GATEWAY_URL")
                .unwrap_or_else(|_| "https://ipfs.io/ipfs/".to_owned()),
        })
    }

    /// Parse per-chain indexer settings for every chain in `CHAINS`.
    /// Returns a `Vec<IndexerJobSettings>` — one entry per configured chain.
    /// Single-chain installs declare `CHAINS=1` and get one entry.
    pub fn all_from_env() -> Result<Vec<Self>> {
        let chain_ids = parse_chains_env()?;
        chain_ids
            .into_iter()
            .map(IndexerJobSettings::from_chain_env)
            .collect()
    }
}

fn env_require(key: &str) -> Result<String> {
    env::var(key).with_context(|| format!("required env var {key} is not set"))
}

fn env_csv_require(key: &str) -> Result<Vec<String>> {
    let val = env_require(key)?;
    let items: Vec<String> = val
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    if items.is_empty() {
        anyhow::bail!("{key} must not be empty");
    }
    Ok(items)
}

pub fn env_bool(key: &str) -> bool {
    env::var(key)
        .ok()
        .is_some_and(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> Result<T>
where
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match env::var(key) {
        Ok(v) => v
            .parse::<T>()
            .with_context(|| format!("{key} must be a valid number")),
        Err(_) => Ok(default),
    }
}
