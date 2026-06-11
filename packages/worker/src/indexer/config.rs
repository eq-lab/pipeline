use std::env;

use anyhow::{Context, Result};

pub use shared::chains::parse_chains_env;

/// Discriminator for per-chain indexer type.
/// EVM is the implicit default when `CHAIN_<id>_TYPE` is unset or set to `"evm"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainType {
    Evm,
    Stellar,
}

/// Read `CHAIN_<id>_TYPE` and return the discriminator.
/// Defaults to `Evm` when unset. Returns `Err` for unknown values.
pub fn parse_chain_type(chain_id: i64) -> Result<ChainType> {
    let key = format!("CHAIN_{chain_id}_TYPE");
    match env::var(&key).as_deref() {
        Ok("stellar") => Ok(ChainType::Stellar),
        Ok("evm") | Err(_) => Ok(ChainType::Evm),
        Ok(v) => anyhow::bail!("{key} must be 'evm' or 'stellar', got '{v}'"),
    }
}

/// Settings for the Stellar Soroban event indexer.
/// Configured via `CHAIN_<id>_STELLAR_*` env vars.
pub struct StellarIndexerSettings {
    pub chain_id: i64,
    pub rpc_url: String,
    pub network_passphrase: String,
    pub start_ledger: u64,
    /// DepositManager contract — emits DepositRequested + RequestClaimed
    pub deposit_manager_id: String,
    /// WithdrawalQueue contract — emits WithdrawalRequested + RequestClaimed
    pub withdrawal_queue_id: String,
    /// StakedPLUSD vault contract — emits Vault Deposit/Withdraw (remapped to StakingDeposit/StakingWithdrawal)
    pub staked_plusd_id: String,
    /// Polling interval in milliseconds (shared with EVM via JOB_INDEXER_POLLING_INTERVAL_MS).
    pub polling_interval_ms: u64,
    /// How many ledgers to fetch per poll cycle (semantics like EVM polling_block_range).
    pub polling_ledger_range: u64,
}

impl StellarIndexerSettings {
    /// Parse Stellar indexer settings for a single chain using `CHAIN_<id>_STELLAR_*` env vars.
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        let p = format!("CHAIN_{chain_id}_STELLAR_");

        // Default network passphrase for the testnet sentinel (99000001).
        let default_passphrase = if chain_id == 99_000_001 {
            "Test SDF Network ; September 2015".to_owned()
        } else {
            String::new()
        };

        let network_passphrase =
            env::var(format!("{p}NETWORK_PASSPHRASE")).unwrap_or(default_passphrase);

        if network_passphrase.is_empty() {
            anyhow::bail!(
                "CHAIN_{chain_id}_STELLAR_NETWORK_PASSPHRASE is required for non-testnet Stellar chains"
            );
        }

        // START_LEDGER falls back to START_BLOCK for symmetry with ChainEventPoller convention.
        let start_ledger = env_parse(
            &format!("CHAIN_{chain_id}_STELLAR_START_LEDGER"),
            env_parse(&format!("CHAIN_{chain_id}_START_BLOCK"), 0_u64)?,
        )?;

        let dm_key = format!("{p}DEPOSIT_MANAGER_ID");
        let wq_key = format!("{p}WITHDRAWAL_QUEUE_ID");
        let splusd_key = format!("{p}STAKED_PLUSD_ID");
        let deposit_manager_id = validate_contract_id(&dm_key, env_require(&dm_key)?)?;
        let withdrawal_queue_id = validate_contract_id(&wq_key, env_require(&wq_key)?)?;
        let staked_plusd_id = validate_contract_id(&splusd_key, env_require(&splusd_key)?)?;

        // The three roles must be distinct contracts. `dispatch_parser`'s if/else
        // if ladder commits to the first matching branch, so a duplicate would
        // silently misroute one role's events to another role's parser group.
        let mut seen = std::collections::HashSet::new();
        for (label, id) in [
            ("DEPOSIT_MANAGER_ID", &deposit_manager_id),
            ("WITHDRAWAL_QUEUE_ID", &withdrawal_queue_id),
            ("STAKED_PLUSD_ID", &staked_plusd_id),
        ] {
            if !seen.insert(id.as_str()) {
                anyhow::bail!(
                    "CHAIN_{chain_id}_STELLAR_{label} ({id}) duplicates another \
                     configured contract id; each role must point at a distinct contract"
                );
            }
        }

        Ok(Self {
            chain_id,
            rpc_url: env_require(&format!("{p}RPC_URL"))?,
            network_passphrase,
            start_ledger,
            deposit_manager_id,
            withdrawal_queue_id,
            staked_plusd_id,
            polling_interval_ms: env_parse("JOB_INDEXER_POLLING_INTERVAL_MS", 500)?,
            polling_ledger_range: env_parse("JOB_INDEXER_POLLING_BLOCK_RANGE", 1000)?,
        })
    }
}

/// Normalize and validate a Stellar contract-id env var.
///
/// Soroban RPC returns Strkey verbatim and `dispatch_parser` compares with `==`,
/// so a `.env` value with the wrong case would silently drop events. We uppercase
/// here so both sides land in the same case, and reject malformed input loudly
/// at config load rather than silently at poll time.
fn validate_contract_id(key: &str, mut raw: String) -> Result<String> {
    raw.make_ascii_uppercase();
    let upper = raw;
    if upper.len() != 56 {
        anyhow::bail!(
            "{key} must be a 56-char Stellar Strkey, got {} chars",
            upper.len()
        );
    }
    if !upper.starts_with('C') {
        anyhow::bail!("{key} must be a Stellar contract Strkey (starts with 'C')");
    }
    if !upper
        .bytes()
        .all(|b| matches!(b, b'A'..=b'Z' | b'2'..=b'7'))
    {
        anyhow::bail!("{key} contains characters outside the Strkey base32 alphabet (A-Z, 2-7)");
    }
    Ok(upper)
}

/// Unified per-chain indexer settings returned by `IndexerSettings::all_from_env`.
pub enum IndexerSettings {
    Evm(IndexerJobSettings),
    Stellar(StellarIndexerSettings),
}

impl IndexerSettings {
    /// Dispatch per-chain indexer settings for every chain in `CHAINS`.
    /// Dispatches per `CHAIN_<id>_TYPE`; EVM is the default when unset.
    pub fn all_from_env() -> Result<Vec<Self>> {
        let chain_ids = parse_chains_env()?;
        chain_ids
            .into_iter()
            .map(|id| match parse_chain_type(id)? {
                ChainType::Evm => Ok(IndexerSettings::Evm(IndexerJobSettings::from_chain_env(
                    id,
                )?)),
                ChainType::Stellar => Ok(IndexerSettings::Stellar(
                    StellarIndexerSettings::from_chain_env(id)?,
                )),
            })
            .collect()
    }

    /// Returns the chain_id for this setting regardless of type.
    pub fn chain_id(&self) -> i64 {
        match self {
            IndexerSettings::Evm(s) => s.chain_id,
            IndexerSettings::Stellar(s) => s.chain_id,
        }
    }
}

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
