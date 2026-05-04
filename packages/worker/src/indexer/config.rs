use std::env;

use anyhow::{Context, Result};

pub struct IndexerJobSettings {
    pub eth_rpc_url: String,
    pub chain_id: i64,
    pub start_block: u64,
    pub transfer_contracts: Vec<String>,
    pub transfer_targets: Vec<String>,
    pub wq_contracts: Vec<String>,
    pub polling_block_range: u64,
    pub polling_interval_ms: u64,
    pub log_confirmations_delay: u64,
}

impl IndexerJobSettings {
    pub fn from_env() -> Result<Self> {
        let prefix = "JOB_INDEXER_";

        Ok(Self {
            eth_rpc_url: env_require(&format!("{prefix}ETH_RPC_URL"))?,
            chain_id: env_require(&format!("{prefix}CHAIN_ID"))?
                .parse()
                .context("CHAIN_ID must be an integer")?,
            start_block: env_parse(&format!("{prefix}START_BLOCK"), 0)?,
            transfer_contracts: env_csv_require(&format!("{prefix}TRANSFER_CONTRACTS"))?,
            transfer_targets: env_csv_require(&format!("{prefix}TRANSFER_TARGETS"))?,
            wq_contracts: env_csv_require(&format!("{prefix}WQ_CONTRACTS"))?,
            polling_block_range: env_parse(&format!("{prefix}POLLING_BLOCK_RANGE"), 1000)?,
            polling_interval_ms: env_parse(&format!("{prefix}POLLING_INTERVAL_MS"), 500)?,
            log_confirmations_delay: env_parse(&format!("{prefix}LOG_CONFIRMATIONS_DELAY"), 12)?,
        })
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
        .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
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
