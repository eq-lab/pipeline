use std::env;

use alloy::primitives::Address;
use anyhow::{Context, Result};
use ed25519_dalek::SigningKey;
use stellar_strkey::Contract;

use crate::indexer::config::{parse_chain_type, parse_chains_env, validate_contract_id, ChainType};

// ─── EVM relayer settings ────────────────────────────────────────────────────

pub struct EvmRelayerSettings {
    pub chain_id: i64,
    pub interval_secs: u64,
    pub eth_rpc_url: String,
    pub signer_key: String,
    pub registry_address: Address,
    pub minter_addresses: Vec<Address>,
    pub sumsub_enabled: bool,
    pub crystal_enabled: bool,
    pub batch_size: usize,
}

impl EvmRelayerSettings {
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let p = format!("CHAIN_{chain_id}_RELAYER_");

        Ok(Self {
            chain_id,
            interval_secs: env_parse("JOB_RELAYER_INTERVAL_SECS", 60)?,
            eth_rpc_url: env_require(&format!("{p}ETH_RPC_URL"))
                .or_else(|_| env_require(&format!("CHAIN_{chain_id}_ETH_RPC_URL")))?,
            signer_key: env_require(&format!("{p}SIGNER_KEY"))?,
            registry_address: env_require_address(&format!("{p}REGISTRY_ADDRESS"))?,
            minter_addresses: env_address_list(&format!(
                "CHAIN_{chain_id}_YIELD_MINTER_CONTRACTS"
            ))?,
            sumsub_enabled: env_parse("JOB_RELAYER_SUMSUB_ENABLED", true)?,
            crystal_enabled: env_parse("CRYSTAL_ENABLED", true)?,
            batch_size: env_parse("JOB_RELAYER_EVM_BATCH_SIZE", 50usize)?,
        })
    }

    pub fn minter_ids(&self) -> Vec<String> {
        self.minter_addresses
            .iter()
            .map(|a| a.to_checksum(None))
            .collect()
    }
}

// ─── Stellar relayer settings ────────────────────────────────────────────────

/// Settings for the Stellar/Soroban relayer — Phase 0 (profile population),
/// Phase 2 (Elliptic KYT, when enabled), and Phase 3 (whitelist sync via
/// `access_manager.execute(set_authorized)`) run.
///
/// Sumsub respects the global `JOB_RELAYER_SUMSUB_ENABLED`. Elliptic KYT is
/// toggled by `ELLIPTIC_ENABLED` (default `false`).
pub struct StellarRelayerSettings {
    pub chain_id: i64,
    pub interval_secs: u64,
    pub rpc_url: String,
    pub network_passphrase: String,
    pub access_manager_id: Contract,
    pub plusd_sac_id: Contract,
    /// Soroban yield-minter contract id. `None` disables the yield-mint phase.
    pub yield_minter_id: Option<Contract>,
    /// Soroban loan-registry contract id — `can_yield_be_minted` view target and
    /// `PaymentRecorded` discovery filter. `None` disables the yield-mint phase.
    pub loan_registry_id: Option<Contract>,
    /// Soroban minter contract id, as the plain Strkey the matching phase binds
    /// into SQL (#1416). `None` disables the wire-in matching phase. Read from
    /// the indexer's `CHAIN_<id>_STELLAR_YIELD_MINTER_ID` — one id for one
    /// contract (renamed from `yield-minter` to `minter` by contracts #33), and
    /// this phase interprets rows that indexer wrote, so the two must never be
    /// configured apart.
    pub minter_id: Option<String>,
    pub signing_key: SigningKey,
    pub sumsub_enabled: bool,
    /// KYT via Elliptic. Enabled with ELLIPTIC_ENABLED=true.
    pub elliptic_enabled: bool,
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

        let parse_opt_contract = |suffix: &str| -> Result<Option<Contract>> {
            let key = format!("{p}{suffix}");
            match env::var(&key) {
                Err(_) => Ok(None),
                Ok(raw) => {
                    let validated = validate_contract_id(&key, raw)?;
                    let c = Contract::from_string(&validated)
                        .map_err(|e| anyhow::anyhow!("{key} failed Strkey parse: {e}"))?;
                    Ok(Some(c))
                }
            }
        };
        let yield_minter_id = parse_opt_contract("YIELD_MINTER_ID")?;
        let loan_registry_id = parse_opt_contract("LOAN_REGISTRY_ID")?;

        // Deliberately the INDEXER's key, with no relayer-scoped variant: the
        // matching phase never calls the minter, it reads rows the indexer
        // wrote. A second key could disagree with the one those rows came from,
        // and Rule A's `receiver <> minter` test would then mark escrowed wires
        // minted — the exact mistake that test exists to prevent. Bound as
        // text, so it stays a validated String, not a parsed `Contract`.
        let minter_key = format!("{indexer_p}YIELD_MINTER_ID");
        let minter_id = match env::var(&minter_key) {
            Ok(raw) if !raw.trim().is_empty() => {
                let validated = validate_contract_id(&minter_key, raw)?;
                // `validate_contract_id` checks length and alphabet, not the
                // Strkey CRC16. Parse it too — discarding the result, since the
                // phase binds the id as text — so a transposed character fails
                // startup instead of matching nothing for ever.
                Contract::from_string(&validated)
                    .map_err(|e| anyhow::anyhow!("{minter_key} failed Strkey parse: {e}"))?;
                Some(validated)
            }
            _ => None,
        };

        let interval_secs = env_parse("JOB_RELAYER_INTERVAL_SECS", 60)?;
        let sumsub_enabled = env_parse("JOB_RELAYER_SUMSUB_ENABLED", true)?;
        // Lenient parse (1/true/yes, case-insensitive) to match how the API reads
        // ELLIPTIC_ENABLED, so the two components never disagree on the same value.
        let elliptic_enabled = env_flag("ELLIPTIC_ENABLED", false);
        let batch_size = env_parse("JOB_RELAYER_STELLAR_BATCH_SIZE", 50usize)?;

        Ok(Self {
            chain_id,
            interval_secs,
            rpc_url,
            network_passphrase,
            access_manager_id,
            plusd_sac_id,
            yield_minter_id,
            loan_registry_id,
            minter_id,
            signing_key,
            sumsub_enabled,
            elliptic_enabled,
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

/// Lenient boolean flag: `1`/`true`/`yes` (case-insensitive) → true; any other
/// value → false; unset → `default`. Mirrors the API's `ELLIPTIC_ENABLED`
/// parsing so both components interpret the same value identically. (Unlike
/// `env_parse::<bool>`, which errors on anything but exact `true`/`false`.)
fn env_flag(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(v) => matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"),
        Err(_) => default,
    }
}

fn env_require_address(key: &str) -> Result<Address> {
    let v = env_require(key)?;
    v.parse()
        .with_context(|| format!("{key} must be a valid EVM address"))
}

fn env_address_list(key: &str) -> Result<Vec<Address>> {
    let Ok(raw) = env::var(key) else {
        return Ok(Vec::new());
    };
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.parse()
                .with_context(|| format!("{key} entry {s:?} must be a valid EVM address"))
        })
        .collect()
}
