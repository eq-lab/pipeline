use std::env;

use anyhow::{Context, Result};

pub struct WhitelistJobSettings {
    pub interval_secs: u64,
    pub ttl_secs: u64,
    pub eth_rpc_url: String,
    pub registry_address: String,
    pub signer_key: String,
}

impl WhitelistJobSettings {
    pub fn from_env() -> Result<Self> {
        let prefix = "JOB_WHITELIST_";

        Ok(Self {
            interval_secs: env::var(format!("{prefix}INTERVAL_SECS"))
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            ttl_secs: env::var(format!("{prefix}TTL_SECS"))
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(7_776_000), // 90 days
            eth_rpc_url: env::var(format!("{prefix}ETH_RPC_URL"))
                .with_context(|| format!("{prefix}ETH_RPC_URL is not set"))?,
            registry_address: env::var(format!("{prefix}REGISTRY_ADDRESS"))
                .with_context(|| format!("{prefix}REGISTRY_ADDRESS is not set"))?,
            signer_key: env::var(format!("{prefix}SIGNER_KEY"))
                .with_context(|| format!("{prefix}SIGNER_KEY is not set"))?,
        })
    }
}
