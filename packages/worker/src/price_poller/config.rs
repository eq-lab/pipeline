// spec: docs/superpowers/specs/2026-10-12-multi-chain-price-poller-design.md#settings
use std::env;
use std::str::FromStr;

use alloy::primitives::Address;
use anyhow::{Context, Result};

use crate::indexer::config::{
    parse_chain_type, parse_chains_env, validate_chain_kind_keys, validate_contract_id, ChainType,
};

const TESTNET_STELLAR_CHAIN_ID: i64 = 99_000_001;
const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";

pub struct EvmPricePollerSettings {
    pub chain_id: i64,
    pub rpc_url: String,
    pub staked_plusd_address: Address,
    pub start_block: u64,
    pub block_interval: u64,
    pub poll_interval_secs: u64,
    pub rpc_delay_ms: u64,
}

pub struct StellarPricePollerSettings {
    pub chain_id: i64,
    pub rpc_url: String,
    pub network_passphrase: String,
    pub staked_plusd_address: String,
    pub poll_interval_secs: u64,
}

fn env_first(keys: &[String]) -> Option<(String, String)> {
    keys.iter().find_map(|k| {
        let v = env::var(k).ok()?;
        let t = v.trim();
        (!t.is_empty()).then(|| (k.clone(), t.to_owned()))
    })
}

fn parse_u64(keys: &[String], default: u64) -> Result<u64> {
    match env_first(keys) {
        Some((key, raw)) => raw
            .parse::<u64>()
            .with_context(|| format!("{key} must be a non-negative integer, got '{raw}'")),
        None => Ok(default),
    }
}

fn parse_nonzero(key: &str, fallbacks: &[String], default: u64) -> Result<u64> {
    let mut keys = vec![key.to_owned()];
    keys.extend_from_slice(fallbacks);
    let value = parse_u64(&keys, default)?;
    if value == 0 {
        anyhow::bail!("{key} must be greater than 0");
    }
    Ok(value)
}

fn required(key: &str) -> Result<String> {
    env_first(&[key.to_owned()])
        .map(|(_, v)| v)
        .with_context(|| format!("{key} is required"))
}

fn rpc_url(component_key: &str, chain_key: &str) -> Result<String> {
    let (key, raw) = env_first(&[component_key.to_owned(), chain_key.to_owned()])
        .with_context(|| format!("Neither {component_key} nor {chain_key} is set"))?;
    reqwest::Url::parse(&raw).with_context(|| format!("{key} is not a valid URL: '{raw}'"))?;
    Ok(raw)
}

impl EvmPricePollerSettings {
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let c = format!("CHAIN_{chain_id}_EVM_");
        let p = format!("{c}PRICE_POLLER_");

        let rpc_url = rpc_url(&format!("{p}RPC_URL"), &format!("{c}RPC_URL"))?;

        let addr_key = format!("{p}STAKED_PLUSD_ADDRESS");
        let raw_addr = required(&addr_key)?;
        if !raw_addr.starts_with("0x") {
            anyhow::bail!("{addr_key} must be a 0x-prefixed address, got '{raw_addr}'");
        }
        let staked_plusd_address = Address::from_str(&raw_addr)
            .with_context(|| format!("{addr_key} is not a valid 0x address: '{raw_addr}'"))?;

        let start_block = parse_u64(&[format!("{p}START_BLOCK"), format!("{c}START_BLOCK")], 0)?;
        let block_interval = parse_nonzero(&format!("{p}BLOCK_INTERVAL"), &[], 300)?;
        let poll_interval_secs = parse_nonzero(&format!("{p}POLL_INTERVAL_SECS"), &[], 60)?;
        let rpc_delay_ms = parse_u64(&[format!("{p}RPC_DELAY_MS")], 200)?;

        Ok(Self {
            chain_id,
            rpc_url,
            staked_plusd_address,
            start_block,
            block_interval,
            poll_interval_secs,
            rpc_delay_ms,
        })
    }
}

impl StellarPricePollerSettings {
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let c = format!("CHAIN_{chain_id}_STELLAR_");
        let p = format!("{c}PRICE_POLLER_");

        let rpc_url = rpc_url(&format!("{p}RPC_URL"), &format!("{c}RPC_URL"))?;

        let network_passphrase = match env_first(&[
            format!("{p}NETWORK_PASSPHRASE"),
            format!("{c}NETWORK_PASSPHRASE"),
        ]) {
            Some((_, v)) => v,
            None if chain_id == TESTNET_STELLAR_CHAIN_ID => TESTNET_PASSPHRASE.to_owned(),
            None => anyhow::bail!(
                "{p}NETWORK_PASSPHRASE (or {c}NETWORK_PASSPHRASE) is required for non-testnet Stellar chains"
            ),
        };

        let addr_key = format!("{p}STAKED_PLUSD_ADDRESS");
        let staked_plusd_address = validate_contract_id(&addr_key, required(&addr_key)?)?;
        stellar_strkey::Contract::from_string(&staked_plusd_address)
            .map_err(|e| anyhow::anyhow!("{addr_key} failed Strkey parse: {e}"))?;

        let poll_interval_secs = parse_nonzero(&format!("{p}POLL_INTERVAL_SECS"), &[], 60)?;

        Ok(Self {
            chain_id,
            rpc_url,
            network_passphrase,
            staked_plusd_address,
            poll_interval_secs,
        })
    }
}

pub enum PricePollerSettings {
    Evm(EvmPricePollerSettings),
    Stellar(StellarPricePollerSettings),
}

impl PricePollerSettings {
    pub fn all_from_env() -> Result<Vec<Self>> {
        let chain_ids = parse_chains_env()?;
        chain_ids
            .into_iter()
            .map(|id| {
                let kind = parse_chain_type(id)?;
                validate_chain_kind_keys(id, kind)?;
                match kind {
                    ChainType::Evm => Ok(PricePollerSettings::Evm(
                        EvmPricePollerSettings::from_chain_env(id)?,
                    )),
                    ChainType::Stellar => Ok(PricePollerSettings::Stellar(
                        StellarPricePollerSettings::from_chain_env(id)?,
                    )),
                }
            })
            .collect()
    }

    pub fn chain_id(&self) -> i64 {
        match self {
            PricePollerSettings::Evm(s) => s.chain_id,
            PricePollerSettings::Stellar(s) => s.chain_id,
        }
    }
}
