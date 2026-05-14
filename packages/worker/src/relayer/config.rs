use std::env;

use anyhow::{Context, Result};

pub struct RelayerJobSettings {
    // Shared
    pub interval_secs: u64,
    pub eth_rpc_url: String,
    pub chain_id: i64,
    pub signer_key: String,
    // Whitelist phase
    pub registry_address: String,
    // Provider toggles
    pub sumsub_enabled: bool,
    pub crystal_enabled: bool,
}

impl RelayerJobSettings {
    pub fn from_env() -> Result<Self> {
        let prefix = "JOB_RELAYER_";

        Ok(Self {
            interval_secs: env_parse(&format!("{prefix}INTERVAL_SECS"), 60)?,
            eth_rpc_url: env_require(&format!("{prefix}ETH_RPC_URL"))?,
            chain_id: env_require(&format!("{prefix}CHAIN_ID"))?
                .parse()
                .context("CHAIN_ID must be an integer")?,
            signer_key: env_require(&format!("{prefix}SIGNER_KEY"))?,
            registry_address: env_require(&format!("{prefix}REGISTRY_ADDRESS"))?,
            sumsub_enabled: env_parse(&format!("{prefix}SUMSUB_ENABLED"), true)?,
            crystal_enabled: env_parse("CRYSTAL_ENABLED", true)?,
        })
    }
}

fn env_require(key: &str) -> Result<String> {
    env::var(key).with_context(|| format!("required env var {key} is not set"))
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
