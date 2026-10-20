use std::collections::{HashMap, HashSet};
use std::env;

use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};

use shared::chains::{
    parse_chain_type, parse_chains_env, parse_default_chain_id, validate_chain_kind_keys,
    validate_stellar_address, ChainKind,
};
use shared::eip712::Eip712Domain;
use shared::object_store::ObjectStore;
use shared::stellar_voucher::{StellarVoucherDomain, StellarVoucherSigner};

/// Per-chain EVM voucher signing config. Only present for chains that have
/// `CHAIN_<id>_SIGNER_KEY` set.
pub struct VoucherChainConfig {
    pub signer: PrivateKeySigner,
    pub dm_domain: Eip712Domain,
    pub wq_domain: Eip712Domain,
}

/// Per-chain Stellar voucher signing config.
///
/// Environment variables (replace `<id>` with the chain ID, e.g. `99000001`):
/// ```text
/// STELLAR_VERIFIER_SECRET=S...                     # flat, chain-agnostic ed25519 seed (Strkey S…)
/// CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID=C...       # DepositManager Strkey (parallel to indexer's DEPOSIT_MANAGER_ID)
/// CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID=C...       # WithdrawalQueue Strkey (parallel to indexer's WITHDRAWAL_QUEUE_ID)
/// CHAIN_<id>_API_STELLAR_NETWORK_PASSPHRASE=...    # defaults to testnet passphrase for chain 99000001
/// ```
///
/// Note: these env vars are deliberately **parallel** to (not aliases of) the
/// indexer's `CHAIN_<id>_STELLAR_*` vars.  The API and the indexer may target
/// different deployments and evolve independently.
#[derive(Debug)]
pub struct StellarVoucherChainConfig {
    pub signer: StellarVoucherSigner,
    pub domain_dm: StellarVoucherDomain,
    pub domain_wq: StellarVoucherDomain,
}

/// A chain listed in `CHAINS`, with its parsed kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConfiguredChain {
    pub chain_id: i64,
    pub kind: ChainKind,
}

/// Multi-chain API configuration parsed from environment variables.
///
/// Environment variables:
/// ```text
/// CHAINS=1,99999               # comma-separated chain IDs; required, non-empty; ids must be unique
/// DEFAULT_CHAIN_ID=1           # required, must be a member of CHAINS
/// # Per EVM chain (replace <id> with each value from CHAINS):
/// CHAIN_<id>_SIGNER_KEY=0x...  # optional; if set, DM_ADDRESS and WQ_ADDRESS are required
/// CHAIN_<id>_DM_ADDRESS=0x...  # required when SIGNER_KEY is set
/// CHAIN_<id>_WQ_ADDRESS=0x...  # required when SIGNER_KEY is set
/// # Per Stellar chain (replace <id> with each value from CHAINS where CHAIN_<id>_TYPE=stellar):
/// STELLAR_VERIFIER_SECRET=S...
/// CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID=C...
/// CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID=C...
/// CHAIN_<id>_API_STELLAR_NETWORK_PASSPHRASE=...
/// # Capital Allocation bucket sourcing (optional, per Stellar chain):
/// CHAIN_<id>_API_STELLAR_CUSTODY_ADDRESSES=G...,C...              # in_transit
/// CHAIN_<id>_API_STELLAR_RAMP_ADDRESSES=G...,C...                 # in_transit
/// CHAIN_<id>_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID=G...          # withdrawal_queue
/// CHAIN_<id>_API_STELLAR_ASSET_DECIMALS=7                         # shared, default 7
/// # Capital Allocation bucket sourcing (optional, per EVM chain):
/// CHAIN_<id>_EVM_API_CUSTODY_ADDRESSES=0x...,0x...                # in_transit
/// CHAIN_<id>_EVM_API_RAMP_ADDRESSES=0x...,0x...                   # in_transit
/// CHAIN_<id>_EVM_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS=0x...        # withdrawal_queue
/// CHAIN_<id>_EVM_API_ASSET_DECIMALS=6                             # shared, default 6
/// # LoanRegistry the LoanBook readers are scoped to (required per chain; must equal the
/// # indexer's CHAIN_<id>_{EVM,STELLAR}_INDEXER_LOAN_REGISTRY_ADDRESS):
/// CHAIN_<id>_EVM_API_LOAN_REGISTRY_ADDRESS=0x...                  # EVM chains
/// CHAIN_<id>_STELLAR_API_LOAN_REGISTRY_ADDRESS=C...               # Stellar chains
/// ```
pub struct ChainsConfig {
    pub default_chain_id: i64,
    /// Every configured chain, in `CHAINS` order.
    pub chains: Vec<ConfiguredChain>,
    /// EVM voucher signing config keyed by chain_id.
    pub voucher: HashMap<i64, VoucherChainConfig>,
    /// Stellar voucher signing config keyed by chain_id.
    pub stellar_voucher: HashMap<i64, StellarVoucherChainConfig>,
    /// Custody + ramp address sets keyed by chain_id, for the Capital Allocation
    /// `in_transit` bucket. Only present for chains where BOTH lists are configured.
    pub transfer_addresses: HashMap<i64, TransferAddressSets>,
    /// Withdrawal Queue Wallet address (Stellar `G…` Strkey, EVM EIP-55) keyed by
    /// chain_id, for the Capital Allocation `withdrawal_queue` bucket (Issue #933).
    /// Only present for chains where `CHAIN_<id>_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID`
    /// / `CHAIN_<id>_EVM_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS` is configured;
    /// independent of `transfer_addresses` (custody/ramp).
    pub withdrawal_queue_wallets: HashMap<i64, String>,
    /// The tracked asset's on-chain decimal scale (e.g. 7 for the Stellar USDC
    /// SAC), keyed by chain_id — shared by the `in_transit` and `withdrawal_queue`
    /// buckets to normalize raw on-chain amounts to the endpoint's canonical
    /// 6-decimal USD base units. Read from `CHAIN_<id>_API_STELLAR_ASSET_DECIMALS`
    /// (default 7) / `CHAIN_<id>_EVM_API_ASSET_DECIMALS` (default 6) for every chain,
    /// independent of whether custody/ramp or the withdrawal queue wallet are
    /// configured.
    pub asset_decimals: HashMap<i64, u32>,
    /// LoanRegistry address keyed by chain_id, in the form the indexer writes to
    /// `contract_logs.contract_address` (EIP-55 on EVM, `C…` Strkey on Stellar).
    /// Every configured chain has an entry (startup fails otherwise).
    pub loan_registry_addresses: HashMap<i64, String>,
}

/// Custody + ramp address sets used to classify indexed `AssetTransfer`
/// events into the `in_transit` bucket's gross approved ramp flow (both legs,
/// absolute — #1027).
///
/// Parsed from per-chain, API-specific env vars (parallel to the worker's
/// indexer vars — the API and worker are decoupled), in the form the indexer
/// writes (`G…`/`C…` Strkey on Stellar, EIP-55 on EVM):
/// ```text
/// CHAIN_<id>_API_STELLAR_CUSTODY_ADDRESSES=G...,C...
/// CHAIN_<id>_API_STELLAR_RAMP_ADDRESSES=G...,C...
/// CHAIN_<id>_EVM_API_CUSTODY_ADDRESSES=0x...
/// CHAIN_<id>_EVM_API_RAMP_ADDRESSES=0x...
/// ```
/// Both address lists must be set for `in_transit` to be sourced; otherwise it
/// stays `null`. `asset_decimals` mirrors `ChainsConfig::asset_decimals` for this
/// chain (same value, populated from the same independent parse) — kept here too
/// so `routes::ramp` (#936) can read it straight off the address sets it already
/// has in hand, without needing a second lookup into `AppState::asset_decimals`.
#[derive(Debug)]
pub struct TransferAddressSets {
    pub custody: HashSet<String>,
    pub ramp: HashSet<String>,
    pub asset_decimals: u32,
}

/// The endpoint-canonical amount scale (6-decimal USDC base units) that all
/// capital-allocation buckets are expressed in.
pub const CANONICAL_AMOUNT_DECIMALS: u32 = 6;

/// Default IPFS gateway used to resolve `ipfs://` metadata URIs when
/// `IPFS_GATEWAY_URL` is unset. Mirrors the worker's default.
const DEFAULT_IPFS_GATEWAY_URL: &str = "https://ipfs.io/ipfs/";

/// IPFS gateway URL used by the loan-submission `metadata_uri` validator to resolve
/// `ipfs://` documents. Reads `IPFS_GATEWAY_URL`, falling back to the public gateway.
pub fn ipfs_gateway_url_from_env() -> String {
    env::var("IPFS_GATEWAY_URL").unwrap_or_else(|_| DEFAULT_IPFS_GATEWAY_URL.to_owned())
}

impl ChainsConfig {
    pub fn from_env() -> Result<Self> {
        let chains = parse_chains_env()?;
        let mut unique_ids = HashSet::new();
        for &id in &chains {
            if !unique_ids.insert(id) {
                anyhow::bail!("CHAINS contains duplicate chain id {id}");
            }
        }
        let default_chain_id = parse_default_chain_id(&chains)?;

        let mut configured = Vec::with_capacity(chains.len());
        let mut voucher = HashMap::new();
        let mut stellar_voucher = HashMap::new();
        let mut transfer_addresses = HashMap::new();
        let mut withdrawal_queue_wallets = HashMap::new();
        let mut asset_decimals = HashMap::new();
        let mut loan_registry_addresses = HashMap::new();

        // Lazily read the flat STELLAR_VERIFIER_SECRET seed once (only if a Stellar chain is found).
        let mut stellar_seed_cache: Option<[u8; 32]> = None;

        for &chain_id in &chains {
            let chain_kind = parse_chain_type(chain_id)?;
            validate_chain_kind_keys(chain_id, chain_kind)?;
            configured.push(ConfiguredChain {
                chain_id,
                kind: chain_kind,
            });
            load_loan_registry_address(chain_id, chain_kind, &mut loan_registry_addresses)?;
            let decimals = load_asset_decimals(chain_id, chain_kind)?;
            load_transfer_addresses(chain_id, chain_kind, decimals, &mut transfer_addresses)?;
            load_withdrawal_queue_wallet(chain_id, chain_kind, &mut withdrawal_queue_wallets)?;
            asset_decimals.insert(chain_id, decimals);

            match chain_kind {
                ChainKind::Evm => {
                    load_evm_voucher_config(chain_id, &mut voucher)?;
                }
                ChainKind::Stellar => {
                    // Load STELLAR_VERIFIER_SECRET once and cache the raw seed bytes.
                    if stellar_seed_cache.is_none() {
                        let secret = env::var("STELLAR_VERIFIER_SECRET").with_context(|| {
                            "STELLAR_VERIFIER_SECRET is required for Stellar chains"
                        })?;
                        let pk = stellar_strkey::ed25519::PrivateKey::from_string(&secret)
                            .map_err(|e| {
                                anyhow::anyhow!(
                                    "STELLAR_VERIFIER_SECRET must be a valid S… Strkey: {e}"
                                )
                            })?;
                        let seed = pk.0;
                        let pubkey = ed25519_dalek::SigningKey::from_bytes(&seed)
                            .verifying_key()
                            .to_bytes();
                        tracing::info!(
                            pubkey = %hex::encode(pubkey),
                            "Stellar voucher signer loaded"
                        );
                        stellar_seed_cache = Some(seed);
                    }
                    load_stellar_voucher_config(
                        chain_id,
                        stellar_seed_cache.unwrap(),
                        &mut stellar_voucher,
                    )?;
                }
            }
        }

        Ok(Self {
            default_chain_id,
            chains: configured,
            voucher,
            stellar_voucher,
            transfer_addresses,
            withdrawal_queue_wallets,
            asset_decimals,
            loan_registry_addresses,
        })
    }
}

/// Load the LoanRegistry address the LoanBook readers are scoped to from
/// `CHAIN_<id>_{EVM,STELLAR}_API_LOAN_REGISTRY_ADDRESS` (required), normalized to the
/// form the indexer stores in `contract_logs.contract_address`.
fn load_loan_registry_address(
    chain_id: i64,
    kind: ChainKind,
    out: &mut HashMap<i64, String>,
) -> Result<()> {
    let key = match kind {
        ChainKind::Evm => format!("CHAIN_{chain_id}_EVM_API_LOAN_REGISTRY_ADDRESS"),
        ChainKind::Stellar => format!("CHAIN_{chain_id}_STELLAR_API_LOAN_REGISTRY_ADDRESS"),
    };
    let raw = env::var(&key).unwrap_or_default();
    let raw = raw.trim();
    if raw.is_empty() {
        anyhow::bail!(
            "{key} is required for chain {chain_id} (LoanRegistry address the LoanBook readers are scoped to)"
        );
    }
    let normalized = match kind {
        ChainKind::Evm => raw
            .parse::<alloy::primitives::Address>()
            .with_context(|| format!("{key} must be a valid 0x… EVM address"))?
            .to_checksum(None),
        ChainKind::Stellar => {
            let contract = stellar_strkey::Contract::from_string(raw)
                .map_err(|e| anyhow::anyhow!("{key} must be a valid C… contract Strkey: {e}"))?;
            format!("{contract}")
        }
    };
    tracing::info!(chain_id, loan_registry = %normalized, "API LoanRegistry scope loaded");
    out.insert(chain_id, normalized);
    Ok(())
}

/// API env key for one capital-allocation source on a chain: the legacy
/// `CHAIN_<id>_API_STELLAR_<stellar>` on Stellar, `CHAIN_<id>_EVM_API_<evm>` on EVM.
fn capital_source_key(chain_id: i64, kind: ChainKind, stellar: &str, evm: &str) -> String {
    match kind {
        ChainKind::Stellar => format!("CHAIN_{chain_id}_API_STELLAR_{stellar}"),
        ChainKind::Evm => format!("CHAIN_{chain_id}_EVM_API_{evm}"),
    }
}

/// Load custody/ramp address sets for one chain from the API-specific
/// `CHAIN_<id>_API_STELLAR_{CUSTODY,RAMP}_ADDRESSES` /
/// `CHAIN_<id>_EVM_API_{CUSTODY,RAMP}_ADDRESSES` vars. Both must be non-empty
/// for `in_transit` to be sourced; a partial config is disabled with a warning
/// (matches the worker's all-or-nothing behaviour for the same real accounts).
fn load_transfer_addresses(
    chain_id: i64,
    kind: ChainKind,
    asset_decimals: u32,
    out: &mut HashMap<i64, TransferAddressSets>,
) -> Result<()> {
    let custody_key = capital_source_key(chain_id, kind, "CUSTODY_ADDRESSES", "CUSTODY_ADDRESSES");
    let ramp_key = capital_source_key(chain_id, kind, "RAMP_ADDRESSES", "RAMP_ADDRESSES");
    let custody = parse_address_csv(kind, &custody_key)?;
    let ramp = parse_address_csv(kind, &ramp_key)?;

    match (custody.is_empty(), ramp.is_empty()) {
        (false, false) => {
            out.insert(
                chain_id,
                TransferAddressSets {
                    custody,
                    ramp,
                    asset_decimals,
                },
            );
        }
        (true, true) => { /* not configured — in_transit stays null */ }
        _ => {
            tracing::warn!(
                chain_id,
                "only one of {custody_key} / {ramp_key} set — in_transit disabled (need both)"
            );
        }
    }
    Ok(())
}

/// Load the Withdrawal Queue Wallet address for one chain from
/// `CHAIN_<id>_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID` /
/// `CHAIN_<id>_EVM_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS` (optional; parallel to the
/// worker's `CHAIN_<id>_STELLAR_INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS` /
/// `JOB_INDEXER_EVM_<id>_WITHDRAWAL_QUEUE_WALLET_ADDRESS` — API and
/// worker are decoupled). Unset → the `withdrawal_queue` bucket stays `null`.
fn load_withdrawal_queue_wallet(
    chain_id: i64,
    kind: ChainKind,
    out: &mut HashMap<i64, String>,
) -> Result<()> {
    let key = capital_source_key(
        chain_id,
        kind,
        "WITHDRAWAL_QUEUE_WALLET_ID",
        "WITHDRAWAL_QUEUE_WALLET_ADDRESS",
    );
    if let Ok(raw) = env::var(&key) {
        if !raw.trim().is_empty() {
            out.insert(chain_id, parse_chain_address(kind, &key, raw.trim())?);
        }
    }
    Ok(())
}

/// The tracked asset's on-chain decimal scale for one chain, from
/// `CHAIN_<id>_API_STELLAR_ASSET_DECIMALS` (default 7 = Stellar USDC SAC) /
/// `CHAIN_<id>_EVM_API_ASSET_DECIMALS` (default 6 = ERC-20 USDC). Independent of
/// custody/ramp/withdrawal-queue-wallet configuration — always resolved for every
/// chain so either bucket can normalize amounts.
fn load_asset_decimals(chain_id: i64, kind: ChainKind) -> Result<u32> {
    let decimals_key = capital_source_key(chain_id, kind, "ASSET_DECIMALS", "ASSET_DECIMALS");
    let default = match kind {
        ChainKind::Stellar => 7,
        ChainKind::Evm => CANONICAL_AMOUNT_DECIMALS,
    };
    let asset_decimals: u32 = match env::var(&decimals_key) {
        Ok(v) => v
            .trim()
            .parse()
            .with_context(|| format!("{decimals_key} must be a non-negative integer"))?,
        Err(_) => default,
    };
    if asset_decimals > 18 {
        anyhow::bail!("{decimals_key} must be ≤ 18 (got {asset_decimals})");
    }
    Ok(asset_decimals)
}

/// Parse an optional CSV of chain addresses from `key`, validated and normalized via
/// `parse_chain_address`. Unset/empty → empty set.
fn parse_address_csv(kind: ChainKind, key: &str) -> Result<HashSet<String>> {
    let Ok(val) = env::var(key) else {
        return Ok(HashSet::new());
    };
    val.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| parse_chain_address(kind, key, s))
        .collect()
}

/// Validate one address and normalize it to the form the indexer writes to
/// `contract_logs.params`: a `G…`/`C…` Strkey on Stellar, EIP-55 on EVM.
fn parse_chain_address(kind: ChainKind, key: &str, raw: &str) -> Result<String> {
    match kind {
        ChainKind::Stellar => validate_stellar_address(key, raw.to_owned()),
        ChainKind::Evm => Ok(raw
            .parse::<alloy::primitives::Address>()
            .with_context(|| format!("{key} must contain valid 0x… EVM addresses"))?
            .to_checksum(None)),
    }
}

fn load_evm_voucher_config(
    chain_id: i64,
    voucher: &mut HashMap<i64, VoucherChainConfig>,
) -> Result<()> {
    let key_env = format!("CHAIN_{chain_id}_SIGNER_KEY");
    let Ok(signer_key) = env::var(&key_env) else {
        tracing::warn!(
            chain_id,
            "CHAIN_{chain_id}_SIGNER_KEY not set — voucher signing disabled for this chain"
        );
        return Ok(());
    };

    let signer: PrivateKeySigner = signer_key
        .parse()
        .with_context(|| format!("CHAIN_{chain_id}_SIGNER_KEY must be a valid private key"))?;
    tracing::info!(chain_id, address = %signer.address(), "EVM voucher signer loaded");

    let chain_id_u64 = chain_id as u64;

    let dm_addr: alloy::primitives::Address = env::var(format!("CHAIN_{chain_id}_DM_ADDRESS"))
        .with_context(|| {
            format!("CHAIN_{chain_id}_DM_ADDRESS required when CHAIN_{chain_id}_SIGNER_KEY is set")
        })?
        .parse()
        .with_context(|| format!("CHAIN_{chain_id}_DM_ADDRESS must be a valid address"))?;

    let wq_addr: alloy::primitives::Address = env::var(format!("CHAIN_{chain_id}_WQ_ADDRESS"))
        .with_context(|| {
            format!("CHAIN_{chain_id}_WQ_ADDRESS required when CHAIN_{chain_id}_SIGNER_KEY is set")
        })?
        .parse()
        .with_context(|| format!("CHAIN_{chain_id}_WQ_ADDRESS must be a valid address"))?;

    let dm_domain = Eip712Domain {
        name: "PipelineDepositManager".to_owned(),
        version: "v1".to_owned(),
        chain_id: chain_id_u64,
        verifying_contract: dm_addr,
    };
    let wq_domain = Eip712Domain {
        name: "PipelineWithdrawalQueue".to_owned(),
        version: "v1".to_owned(),
        chain_id: chain_id_u64,
        verifying_contract: wq_addr,
    };

    voucher.insert(
        chain_id,
        VoucherChainConfig {
            signer,
            dm_domain,
            wq_domain,
        },
    );
    Ok(())
}

/// Load Stellar voucher config for a single chain.
///
/// Builds a `StellarVoucherSigner` from the shared `STELLAR_VERIFIER_SECRET` seed bytes
/// (already parsed by the caller) and reads the three per-chain API vars:
/// - `CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID`
/// - `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID`
/// - `CHAIN_<id>_API_STELLAR_NETWORK_PASSPHRASE` (defaults to testnet for 99000001)
///
/// These are parallel API-specific vars, deliberately decoupled from the indexer's
/// `CHAIN_<id>_STELLAR_INDEXER_DEPOSIT_MANAGER_ADDRESS` / `..._WITHDRAWAL_QUEUE_ADDRESS` /
/// `NETWORK_PASSPHRASE` vars.
fn load_stellar_voucher_config(
    chain_id: i64,
    seed: [u8; 32],
    stellar_voucher: &mut HashMap<i64, StellarVoucherChainConfig>,
) -> Result<()> {
    let dm_key = format!("CHAIN_{chain_id}_API_STELLAR_DM_CONTRACT_ID");
    let wq_key = format!("CHAIN_{chain_id}_API_STELLAR_WQ_CONTRACT_ID");
    let pp_key = format!("CHAIN_{chain_id}_API_STELLAR_NETWORK_PASSPHRASE");

    // Both contract IDs are required for Stellar voucher signing to be active.
    let Ok(dm_str) = env::var(&dm_key) else {
        tracing::warn!(
            chain_id,
            "{dm_key} not set — Stellar voucher signing disabled for this chain"
        );
        return Ok(());
    };
    let Ok(wq_str) = env::var(&wq_key) else {
        tracing::warn!(
            chain_id,
            "{wq_key} not set — Stellar voucher signing disabled for this chain"
        );
        return Ok(());
    };

    // Default network passphrase for testnet sentinel (matches StellarIndexerSettings).
    let default_passphrase = if chain_id == 99_000_001 {
        "Test SDF Network ; September 2015".to_owned()
    } else {
        String::new()
    };
    let passphrase = env::var(&pp_key).unwrap_or(default_passphrase);
    if passphrase.is_empty() {
        anyhow::bail!("{pp_key} is required for non-testnet Stellar chains (chain_id={chain_id})");
    }

    let dm_contract = stellar_strkey::Contract::from_string(&dm_str)
        .with_context(|| format!("{dm_key} must be a valid C… Strkey, got '{dm_str}'"))?;
    let wq_contract = stellar_strkey::Contract::from_string(&wq_str)
        .with_context(|| format!("{wq_key} must be a valid C… Strkey, got '{wq_str}'"))?;

    let domain_dm = StellarVoucherDomain::from_passphrase(&dm_contract, &passphrase);
    let domain_wq = StellarVoucherDomain::from_passphrase(&wq_contract, &passphrase);

    // Build a StellarVoucherSigner from the shared seed bytes.
    let signer = StellarVoucherSigner::from_seed(seed);

    tracing::info!(
        chain_id,
        dm = %dm_str,
        wq = %wq_str,
        "Stellar voucher config loaded"
    );

    stellar_voucher.insert(
        chain_id,
        StellarVoucherChainConfig {
            signer,
            domain_dm,
            domain_wq,
        },
    );
    Ok(())
}

/// KYB document storage: a private S3-compatible bucket (DigitalOcean Spaces)
/// plus the limits that bound what may be put in it (Issue #1267).
///
/// Environment variables:
/// ```text
/// SPACES_ACCESS_KEY_ID=...
/// SPACES_SECRET_ACCESS_KEY=...
/// SPACES_ENDPOINT=https://fra1.digitaloceanspaces.com
/// SPACES_REGION=fra1
/// SPACES_BUCKET=pipeline-kyb
/// KYB_MAX_DOCUMENT_BYTES=10485760     # per file; default 10MB, matches the frontend
/// KYB_MAX_FILES_PER_REQUEST=10        # per upload request
/// KYB_MAX_DOCUMENTS_PER_LP=20         # per LP, across all requests
/// ```
///
/// The five `SPACES_*` variables are **required**: an API that boots without
/// them would accept signups and registrations and only fail at the upload
/// step, long after the misconfiguration was deployed. The three limits have
/// defaults.
pub struct KybStorageConfig {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub limits: KybLimits,
}

/// Bounds on KYB uploads. Separated from the credentials so handlers can carry
/// the limits without the secrets.
#[derive(Debug, Clone, Copy)]
pub struct KybLimits {
    /// Largest single document, in bytes.
    pub max_document_bytes: usize,
    /// Most files one upload request may carry.
    pub max_files_per_request: usize,
    /// Most documents one LP may hold at once.
    pub max_documents_per_lp: i64,
}

/// Default per-file ceiling — 10MB, mirroring `MAX_FILE_BYTES` in
/// `packages/frontend/src/components/kybFileValidation.ts`.
pub const DEFAULT_KYB_MAX_DOCUMENT_BYTES: usize = 10 * 1024 * 1024;
pub const DEFAULT_KYB_MAX_FILES_PER_REQUEST: usize = 10;
pub const DEFAULT_KYB_MAX_DOCUMENTS_PER_LP: i64 = 20;

impl KybLimits {
    /// Headroom over the raw file total, for multipart framing: the boundary
    /// between every part, each part's headers, and the three text fields all
    /// count toward the body limit. Without it, ten files of exactly
    /// `max_document_bytes` — every one of them legal — would overflow the
    /// ceiling by a few hundred bytes and be refused.
    const MULTIPART_OVERHEAD_BYTES: usize = 1024 * 1024;

    /// The request body ceiling implied by these limits: every allowed file at
    /// its full size, plus framing. Applied per-route, never globally — axum's
    /// default is 2MB and the rest of the API wants to keep it.
    pub fn max_request_bytes(&self) -> usize {
        self.max_document_bytes
            .saturating_mul(self.max_files_per_request)
            .saturating_add(Self::MULTIPART_OVERHEAD_BYTES)
    }

    fn from_env() -> Result<Self> {
        let limits = Self {
            max_document_bytes: parse_env_or(
                "KYB_MAX_DOCUMENT_BYTES",
                DEFAULT_KYB_MAX_DOCUMENT_BYTES,
            )?,
            max_files_per_request: parse_env_or(
                "KYB_MAX_FILES_PER_REQUEST",
                DEFAULT_KYB_MAX_FILES_PER_REQUEST,
            )?,
            max_documents_per_lp: parse_env_or(
                "KYB_MAX_DOCUMENTS_PER_LP",
                DEFAULT_KYB_MAX_DOCUMENTS_PER_LP,
            )?,
        };
        limits.validate()?;
        Ok(limits)
    }

    /// Reject a limit of zero or less.
    ///
    /// Each one silently disables uploading rather than failing loudly:
    /// `KYB_MAX_FILES_PER_REQUEST=0` drops the route's body limit to the
    /// framing allowance so every upload `413`s, and
    /// `KYB_MAX_DOCUMENTS_PER_LP=0` (or a negative, which `i64` parses happily)
    /// makes every upload `409` forever. The five `SPACES_*` variables beside
    /// these are already rejected when blank; a typo in a number deserves the
    /// same treatment.
    fn validate(&self) -> Result<()> {
        if self.max_document_bytes == 0 {
            anyhow::bail!("KYB_MAX_DOCUMENT_BYTES must be greater than zero");
        }
        if self.max_files_per_request == 0 {
            anyhow::bail!("KYB_MAX_FILES_PER_REQUEST must be greater than zero");
        }
        if self.max_documents_per_lp <= 0 {
            anyhow::bail!("KYB_MAX_DOCUMENTS_PER_LP must be greater than zero");
        }
        Ok(())
    }
}

fn parse_env_or<T>(key: &str, default: T) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match env::var(key) {
        Err(_) => Ok(default),
        Ok(raw) => raw
            .trim()
            .parse()
            .map_err(|e| anyhow::anyhow!("{key} is not a valid number: {e}")),
    }
}

impl KybStorageConfig {
    pub fn from_env() -> Result<Self> {
        let required = |key: &str| -> Result<String> {
            let value = env::var(key)
                .with_context(|| format!("{key} is required for KYB document storage"))?;
            if value.trim().is_empty() {
                anyhow::bail!("{key} is required for KYB document storage but is empty");
            }
            Ok(value)
        };

        Ok(Self {
            access_key_id: required("SPACES_ACCESS_KEY_ID")?,
            secret_access_key: required("SPACES_SECRET_ACCESS_KEY")?,
            endpoint: required("SPACES_ENDPOINT")?,
            region: required("SPACES_REGION")?,
            bucket: required("SPACES_BUCKET")?,
            limits: KybLimits::from_env()?,
        })
    }

    pub fn object_store(&self) -> ObjectStore {
        ObjectStore::new(
            &self.access_key_id,
            &self.secret_access_key,
            &self.endpoint,
            &self.region,
            &self.bucket,
        )
    }
}
