use std::env;

use alloy::primitives::Address;
use anyhow::{Context, Result};
use ed25519_dalek::SigningKey;
use stellar_strkey::Contract;

use crate::indexer::config::{parse_chain_type, parse_chains_env, validate_contract_id, ChainType};

// ─── EVM relayer settings ────────────────────────────────────────────────────
//
// Renamed from `RelayerJobSettings` (Issue #562) to clarify the chain-kind split
// against the new `StellarRelayerSettings`.

pub struct EvmRelayerSettings {
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
    // Phase 4: Yield-Minter automation (always enabled when the EVM relayer runs).
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

impl EvmRelayerSettings {
    /// Parse EVM relayer settings for a single chain using `CHAIN_<id>_RELAYER_*` env vars.
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let p = format!("CHAIN_{chain_id}_RELAYER_");

        Ok(Self {
            interval_secs: env_parse("JOB_RELAYER_INTERVAL_SECS", 60)?,
            eth_rpc_url: env_require(&format!("{p}ETH_RPC_URL"))
                // Fall back to the chain's shared RPC URL
                .or_else(|_| env_require(&format!("CHAIN_{chain_id}_ETH_RPC_URL")))?,
            chain_id,
            signer_key: env_require(&format!("{p}SIGNER_KEY"))?,
            registry_address: env_require_address(&format!("{p}REGISTRY_ADDRESS"))?,
            sumsub_enabled: env_parse("JOB_RELAYER_SUMSUB_ENABLED", true)?,
            crystal_enabled: env_parse("CRYSTAL_ENABLED", true)?,
            yield_minter_address: env_require_address(&format!("{p}YIELD_MINTER_ADDRESS"))?,
            loan_registry_address: env_require_address(&format!("{p}LOAN_REGISTRY_ADDRESS"))?,
            bitgo_native_symbol: env_parse_string("BITGO_NATIVE_SYMBOL", "hteth"),
            yield_minter_batch_size: env_parse("JOB_RELAYER_YIELD_MINTER_BATCH_SIZE", 50usize)?,
        })
    }
}

// ─── Stellar relayer settings ────────────────────────────────────────────────

/// Settings for the Stellar/Soroban relayer — only Phase 0 (profile population) and
/// Phase 3 (whitelist sync via `access_manager.execute(set_authorized)`) run.
///
/// Sumsub respects the global `JOB_RELAYER_SUMSUB_ENABLED`. Crystal is forced to
/// `false` because Crystal does not support Stellar today.
pub struct StellarRelayerSettings {
    pub chain_id: i64,
    pub interval_secs: u64,
    pub rpc_url: String,
    pub network_passphrase: String,
    pub access_manager_id: Contract,
    pub plusd_sac_id: Contract,
    pub signing_key: SigningKey,
    pub sumsub_enabled: bool,
    /// Always `false` — Crystal does not support Stellar.
    pub crystal_enabled: bool,
    /// Maximum addresses processed per Phase 3 cycle.
    pub batch_size: usize,
}

impl StellarRelayerSettings {
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let p = format!("CHAIN_{chain_id}_RELAYER_STELLAR_");
        let indexer_p = format!("CHAIN_{chain_id}_STELLAR_");

        // RPC URL falls back to the indexer's RPC URL (same Soroban endpoint).
        let rpc_url = env_require(&format!("{p}RPC_URL"))
            .or_else(|_| env_require(&format!("{indexer_p}RPC_URL")))?;

        // Network passphrase falls back to the indexer's passphrase, with a default
        // for the testnet sentinel chain id (mirrors `StellarIndexerSettings`).
        let default_passphrase = if chain_id == 99_000_001 {
            "Test SDF Network ; September 2015".to_owned()
        } else {
            String::new()
        };
        let network_passphrase = env::var(format!("{p}NETWORK_PASSPHRASE"))
            .or_else(|_| env::var(format!("{indexer_p}NETWORK_PASSPHRASE")))
            .unwrap_or(default_passphrase);
        if network_passphrase.is_empty() {
            anyhow::bail!(
                "{p}NETWORK_PASSPHRASE (or {indexer_p}NETWORK_PASSPHRASE) is required for non-testnet Stellar chains"
            );
        }

        let am_key = format!("{p}ACCESS_MANAGER_ID");
        let sac_key = format!("{p}PLUSD_SAC_ID");
        let am_str = validate_contract_id(&am_key, env_require(&am_key)?)?;
        let sac_str = validate_contract_id(&sac_key, env_require(&sac_key)?)?;
        let access_manager_id = Contract::from_string(&am_str)
            .map_err(|e| anyhow::anyhow!("{am_key} failed Strkey parse: {e}"))?;
        let plusd_sac_id = Contract::from_string(&sac_str)
            .map_err(|e| anyhow::anyhow!("{sac_key} failed Strkey parse: {e}"))?;

        let signer_key = format!("{p}SIGNER_SECRET");
        let signer_strkey = env_require(&signer_key)?;
        let priv_key = stellar_strkey::ed25519::PrivateKey::from_string(&signer_strkey)
            .map_err(|e| anyhow::anyhow!("{signer_key} must be a Stellar S… Strkey: {e}"))?;
        let signing_key = SigningKey::from_bytes(&priv_key.0);

        let interval_secs = env_parse("JOB_RELAYER_INTERVAL_SECS", 60)?;
        let sumsub_enabled = env_parse("JOB_RELAYER_SUMSUB_ENABLED", true)?;
        // Crystal is force-disabled on Stellar regardless of the global toggle.
        let crystal_enabled = false;
        let batch_size = env_parse("JOB_RELAYER_STELLAR_BATCH_SIZE", 50usize)?;

        Ok(Self {
            chain_id,
            interval_secs,
            rpc_url,
            network_passphrase,
            access_manager_id,
            plusd_sac_id,
            signing_key,
            sumsub_enabled,
            crystal_enabled,
            batch_size,
        })
    }
}

// ─── Unified per-chain relayer settings ──────────────────────────────────────

pub enum RelayerSettings {
    Evm(Box<EvmRelayerSettings>),
    Stellar(Box<StellarRelayerSettings>),
}

impl RelayerSettings {
    /// Dispatch per-chain relayer settings for every chain in `CHAINS`.
    /// Dispatches per `CHAIN_<id>_TYPE`; EVM is the default when unset.
    pub fn all_from_env() -> Result<Vec<Self>> {
        let chain_ids = parse_chains_env()?;
        chain_ids
            .into_iter()
            .map(|id| match parse_chain_type(id)? {
                ChainType::Evm => Ok(RelayerSettings::Evm(Box::new(
                    EvmRelayerSettings::from_chain_env(id)?,
                ))),
                ChainType::Stellar => Ok(RelayerSettings::Stellar(Box::new(
                    StellarRelayerSettings::from_chain_env(id)?,
                ))),
            })
            .collect()
    }

    pub fn chain_id(&self) -> i64 {
        match self {
            RelayerSettings::Evm(s) => s.chain_id,
            RelayerSettings::Stellar(s) => s.chain_id,
        }
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
