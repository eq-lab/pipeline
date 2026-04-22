use std::env;

use anyhow::{Context, Result};

pub struct JobSettings {
    pub name: String,
    pub enabled: bool,
    pub eth_rpc_url: String,
    pub chain_id: i64,
    pub polling_contracts: Vec<String>,
    pub polling_targets: Vec<String>,
    pub polling_block_range: u64,
    pub polling_interval_ms: u64,
    pub log_confirmations_delay: u64,
}

impl JobSettings {
    pub fn from_env(name: &str) -> Result<Self> {
        let prefix = format!("JOB_{}_", name.to_uppercase());

        let enabled = env_bool(&format!("{prefix}ENABLED")).unwrap_or(false);

        if !enabled {
            return Ok(Self {
                name: name.to_owned(),
                enabled: false,
                eth_rpc_url: String::new(),
                chain_id: 0,
                polling_contracts: vec![],
                polling_targets: vec![],
                polling_block_range: 0,
                polling_interval_ms: 0,
                log_confirmations_delay: 0,
            });
        }

        let eth_rpc_url = env_require(&format!("{prefix}ETH_RPC_URL"))?;
        let chain_id: i64 = env_require(&format!("{prefix}CHAIN_ID"))?
            .parse()
            .context("CHAIN_ID must be an integer")?;
        let polling_contracts: Vec<String> = env_require(&format!("{prefix}POLLING_CONTRACTS"))?
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect();
        if polling_contracts.is_empty() {
            anyhow::bail!("{prefix}POLLING_CONTRACTS must not be empty");
        }
        let polling_targets: Vec<String> = env_require(&format!("{prefix}POLLING_TARGETS"))?
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect();
        if polling_targets.is_empty() {
            anyhow::bail!("{prefix}POLLING_TARGETS must not be empty");
        }
        let polling_block_range = env_parse(&format!("{prefix}POLLING_BLOCK_RANGE"), 1000)?;
        let polling_interval_ms = env_parse(&format!("{prefix}POLLING_INTERVAL_MS"), 500)?;
        let log_confirmations_delay = env_parse(&format!("{prefix}LOG_CONFIRMATIONS_DELAY"), 12)?;

        Ok(Self {
            name: name.to_owned(),
            enabled,
            eth_rpc_url,
            chain_id,
            polling_contracts,
            polling_targets,
            polling_block_range,
            polling_interval_ms,
            log_confirmations_delay,
        })
    }
}

fn env_require(key: &str) -> Result<String> {
    env::var(key).with_context(|| format!("required env var {key} is not set"))
}

fn env_bool(key: &str) -> Option<bool> {
    env::var(key)
        .ok()
        .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
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
