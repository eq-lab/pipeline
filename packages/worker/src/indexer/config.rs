use std::env;

use anyhow::{Context, Result};

pub use shared::chains::{
    parse_chain_type, parse_chains_env, validate_contract_id, validate_stellar_address, ChainKind,
};

/// Type alias so existing call sites in the worker that use `ChainType` still compile.
pub type ChainType = ChainKind;

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
    /// Withdrawal Queue Wallet — the separate MPC custody address (Stellar `G…`
    /// account) that actually holds USDC for queue settlement; distinct from
    /// `withdrawal_queue_id`, which is just the accounting contract (see
    /// `docs/product-specs/withdrawals.md`). Optional; set only once the wallet
    /// address is known for this chain. When `Some`, every USDC transfer
    /// touching it (either side, any counterparty) is tracked — see `asset_id`.
    /// Read from `CHAIN_<id>_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID`.
    pub withdrawal_queue_wallet_id: Option<String>,
    /// StakedPLUSD vault contract — emits Vault Deposit/Withdraw (remapped to StakingDeposit/StakingWithdrawal)
    pub staked_plusd_id: String,
    /// LoanRegistry contract — optional; set only after the contract is deployed to the target chain.
    /// When `None`, the loan-registry indexer branch is a no-op.
    /// Read from `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID`.
    pub loan_registry_id: Option<String>,
    /// YieldMinter contract — optional; set only after the contract is deployed to the target chain.
    /// When `None`, the yield-minter indexer branch is a no-op (ships dark).
    /// Emits `YieldMinted` events routed to `contract_logs` (same as EVM).
    /// Read from `CHAIN_<id>_STELLAR_YIELD_MINTER_ID`.
    pub yield_minter_id: Option<String>,
    /// Asset (SAC / SEP-41 token) contract whose `transfer` events are tracked.
    /// `Some` enables asset-transfer polling outright — when `withdrawal_queue_wallet_id`
    /// is also set, every transfer touching it (one-sided: either side, any
    /// counterparty, see Issue #933) is persisted unconditionally, plus internal
    /// movements between `custody_addresses ∪ ramp_addresses` (both sides
    /// tracked, see Issue #789). `None` ships dark. Job-level config, read from
    /// `JOB_INDEXER_STELLAR_ASSET_ID` (applies to every Stellar chain).
    pub asset_id: Option<String>,
    /// Custody addresses (`G…` or `C…`) — see `ramp_addresses`. Only meaningful
    /// when `asset_id` is `Some`; empty otherwise. Read from
    /// `JOB_INDEXER_STELLAR_CUSTODY_ADDRESSES` (job-level).
    pub custody_addresses: Vec<String>,
    /// Ramp addresses (`G…` or `C…`) — together with `custody_addresses`, a
    /// transfer is additionally tracked when **both** `from` and `to` are in
    /// `custody_addresses ∪ ramp_addresses` (internal movement, Issue #789).
    /// Independent of `withdrawal_queue_wallet_id` tracking. Set both or neither
    /// — setting only one disables this pair (warns) without affecting
    /// withdrawal-queue-wallet tracking. Read from `JOB_INDEXER_STELLAR_RAMP_ADDRESSES`
    /// (job-level).
    pub ramp_addresses: Vec<String>,
    /// IPFS gateway URL used by the loan-metadata fetcher (mirrors `JOB_INDEXER_IPFS_GATEWAY_URL`
    /// on the EVM side). Defaults to `https://ipfs.io/ipfs/` when unset.
    pub ipfs_gateway_url: String,
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
        let lr_key = format!("{p}LOAN_REGISTRY_ID");
        let ym_key = format!("{p}YIELD_MINTER_ID");
        let deposit_manager_id = validate_contract_id(&dm_key, env_require(&dm_key)?)?;
        let withdrawal_queue_id = validate_contract_id(&wq_key, env_require(&wq_key)?)?;
        let staked_plusd_id = validate_contract_id(&splusd_key, env_require(&splusd_key)?)?;

        let loan_registry_id = match env::var(&lr_key) {
            Ok(raw) if !raw.trim().is_empty() => Some(validate_contract_id(&lr_key, raw)?),
            _ => None,
        };

        let yield_minter_id = match env::var(&ym_key) {
            Ok(raw) if !raw.trim().is_empty() => Some(validate_contract_id(&ym_key, raw)?),
            _ => None,
        };

        let wq_wallet_key = format!("{p}WITHDRAWAL_QUEUE_WALLET_ID");
        let withdrawal_queue_wallet_id = match env::var(&wq_wallet_key) {
            Ok(raw) if !raw.trim().is_empty() => {
                Some(validate_stellar_address(&wq_wallet_key, raw)?)
            }
            _ => None,
        };

        // ── Asset-transfer tracking ──────────────────────────────────────────────
        // Job-level (applies to every Stellar chain), read from `JOB_INDEXER_STELLAR_*`.
        //
        // `asset_id` alone gates whether transfer events are polled at all — once
        // set, every transfer touching `withdrawal_queue_wallet_id` (one-sided,
        // Issue #933) is tracked unconditionally, with no need to also configure
        // custody/ramp.
        // `custody_addresses`/`ramp_addresses` are an independent, optional pair
        // for the internal-movement (both-sides-tracked) filter from Issue #789;
        // set both or neither — one without the other disables just that pair.
        let asset_key = "JOB_INDEXER_STELLAR_ASSET_ID";
        let custody_key = "JOB_INDEXER_STELLAR_CUSTODY_ADDRESSES";
        let ramp_key = "JOB_INDEXER_STELLAR_RAMP_ADDRESSES";

        let asset_raw = env::var(asset_key)
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());
        let asset_id = match asset_raw {
            Some(raw) => Some(validate_contract_id(asset_key, raw)?),
            None => None,
        };

        // Custody/ramp validation is deferred to the fully-paired branch so a
        // malformed address in a partial (or absent) pairing disables that pair
        // with a warning rather than crashing the whole worker at startup. Only
        // meaningful once `asset_id` is set — inert (and warned about) otherwise.
        let (custody_addresses, ramp_addresses) = if asset_id.is_none() {
            if env::var(custody_key).is_ok() || env::var(ramp_key).is_ok() {
                tracing::warn!(
                    chain_id,
                    "custody/ramp addresses configured without JOB_INDEXER_STELLAR_ASSET_ID \
                     — ignored, asset-transfer tracking is off"
                );
            }
            (Vec::new(), Vec::new())
        } else {
            let custody_raw = split_csv_raw(env::var(custody_key).ok().as_deref());
            let ramp_raw = split_csv_raw(env::var(ramp_key).ok().as_deref());
            match (custody_raw.is_empty(), ramp_raw.is_empty()) {
                // Both paired — validate strictly (a typo fails loudly here).
                (false, false) => {
                    let custody = custody_raw
                        .into_iter()
                        .map(|a| validate_stellar_address(custody_key, a))
                        .collect::<Result<Vec<_>>>()?;
                    let ramp = ramp_raw
                        .into_iter()
                        .map(|a| validate_stellar_address(ramp_key, a))
                        .collect::<Result<Vec<_>>>()?;
                    (custody, ramp)
                }
                // Neither set — no internal-movement pair, withdrawal-queue tracking unaffected.
                (true, true) => (Vec::new(), Vec::new()),
                // Only one of the pair set — disable just this pair and warn (no validation, no error).
                (custody_empty, _ramp_empty) => {
                    let missing = if custody_empty { custody_key } else { ramp_key };
                    tracing::warn!(
                        chain_id,
                        missing,
                        "custody/ramp internal-movement tracking partially configured — \
                         disabled; set both CUSTODY_ADDRESSES and RAMP_ADDRESSES to enable \
                         (withdrawal-queue tracking is unaffected)"
                    );
                    (Vec::new(), Vec::new())
                }
            }
        };

        // All configured roles must be distinct contracts. `dispatch_parser`'s if/else
        // ladder commits to the first matching branch, so a duplicate would silently
        // misroute one role's events to another role's parser group.
        let mut seen = std::collections::HashSet::new();
        let mut roles: Vec<(&str, &String)> = vec![
            ("DEPOSIT_MANAGER_ID", &deposit_manager_id),
            ("WITHDRAWAL_QUEUE_ID", &withdrawal_queue_id),
            ("STAKED_PLUSD_ID", &staked_plusd_id),
        ];
        // Include loan_registry_id in the distinctness check when configured.
        if let Some(id) = &loan_registry_id {
            roles.push(("LOAN_REGISTRY_ID", id));
        }
        // Include yield_minter_id in the distinctness check when configured.
        if let Some(id) = &yield_minter_id {
            roles.push(("YIELD_MINTER_ID", id));
        }
        // Include the asset id when transfer tracking is enabled — it is polled
        // alongside the other roles and routed by the same if/else dispatch ladder.
        if let Some(id) = &asset_id {
            roles.push(("ASSET_ID", id));
        }
        for (label, id) in roles {
            if !seen.insert(id.as_str()) {
                anyhow::bail!(
                    "CHAIN_{chain_id}_STELLAR_{label} ({id}) duplicates another \
                     configured contract id; each role must point at a distinct contract"
                );
            }
        }

        let ipfs_gateway_url = env::var("JOB_INDEXER_IPFS_GATEWAY_URL")
            .unwrap_or_else(|_| "https://ipfs.io/ipfs/".to_owned());

        Ok(Self {
            chain_id,
            rpc_url: env_require(&format!("{p}RPC_URL"))?,
            network_passphrase,
            start_ledger,
            deposit_manager_id,
            withdrawal_queue_id,
            withdrawal_queue_wallet_id,
            staked_plusd_id,
            loan_registry_id,
            yield_minter_id,
            asset_id,
            custody_addresses,
            ramp_addresses,
            ipfs_gateway_url,
            polling_interval_ms: env_parse("JOB_INDEXER_POLLING_INTERVAL_MS", 500)?,
            polling_ledger_range: env_parse("JOB_INDEXER_POLLING_BLOCK_RANGE", 1000)?,
        })
    }
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

/// Split an optional CSV value into trimmed, non-empty **raw** entries.
///
/// No Strkey validation — presence is decided from the raw entries, and callers
/// validate only once asset-transfer tracking is fully configured (so a typo in a
/// partial/disabled config doesn't crash startup).
fn split_csv_raw(raw: Option<&str>) -> Vec<String> {
    raw.map(|v| {
        v.split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect()
    })
    .unwrap_or_default()
}

pub fn env_bool(key: &str) -> bool {
    env::var(key).is_ok_and(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
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
