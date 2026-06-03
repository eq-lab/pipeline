use std::env;

use alloy::primitives::Address;
use anyhow::{Context, Result};

pub struct RelayerJobSettings {
    // Shared
    pub interval_secs: u64,
    pub eth_rpc_url: String,
    pub chain_id: i64,
    pub signer_key: String,
    // Whitelist phase
    pub registry_address: Address,
    // Provider toggles
    pub sumsub_enabled: bool,
    pub crystal_enabled: bool,
    // Phase 4: Yield-Minter automation (always enabled when the relayer runs).
    /// PipelineYieldMinter contract address. Value doubles as the
    /// `yield_minter_address` column stored in every outbox row.
    pub yield_minter_address: Address,
    /// LoanRegistry contract address — used as the `canYieldBeMinted` view target
    /// during Phase 4 submission, and to filter `contract_logs.PaymentRecorded`
    /// during discovery.
    pub loan_registry_address: Address,
    /// BitGo coin symbol for native gas (e.g. `"hteth"` on Hoodi, `"eth"` on mainnet).
    pub bitgo_native_symbol: String,
    /// Maximum outbox rows processed per Phase 4 cycle (default 50).
    pub yield_minter_batch_size: usize,
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
            registry_address: env_require_address(&format!("{prefix}REGISTRY_ADDRESS"))?,
            sumsub_enabled: env_parse(&format!("{prefix}SUMSUB_ENABLED"), true)?,
            crystal_enabled: env_parse("CRYSTAL_ENABLED", true)?,
            yield_minter_address: env_require_address(&format!("{prefix}YIELD_MINTER_ADDRESS"))?,
            loan_registry_address: env_require_address(&format!("{prefix}LOAN_REGISTRY_ADDRESS"))?,
            bitgo_native_symbol: env_parse_string("BITGO_NATIVE_SYMBOL", "hteth"),
            yield_minter_batch_size: env_parse(
                &format!("{prefix}YIELD_MINTER_BATCH_SIZE"),
                50usize,
            )?,
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

fn env_parse_string(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_owned())
}

fn env_require_address(key: &str) -> Result<Address> {
    let v = env_require(key)?;
    v.parse()
        .with_context(|| format!("{key} must be a valid EVM address"))
}
