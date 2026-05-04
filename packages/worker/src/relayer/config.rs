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
    pub whitelist_ttl_secs: u64,
    // Funding phase
    pub wq_address: String,
    pub usdc_address: String,
    pub capital_wallet_address: String,
    pub per_tx_cap_usdc: u64,
    pub rolling_24h_cap_usdc: u64,
    pub bitgo_coin: String,
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
            whitelist_ttl_secs: env_parse(&format!("{prefix}WHITELIST_TTL_SECS"), 7_776_000)?,
            wq_address: env_require(&format!("{prefix}WQ_ADDRESS"))?,
            usdc_address: env_require(&format!("{prefix}USDC_ADDRESS"))?,
            capital_wallet_address: env_require(&format!("{prefix}CAPITAL_WALLET"))?,
            per_tx_cap_usdc: env_parse(&format!("{prefix}PER_TX_CAP"), 5_000_000)?,
            rolling_24h_cap_usdc: env_parse(&format!("{prefix}ROLLING_24H_CAP"), 10_000_000)?,
            bitgo_coin: env_require(&format!("{prefix}BITGO_COIN"))?,
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
