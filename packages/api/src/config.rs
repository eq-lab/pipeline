use std::collections::HashMap;
use std::env;

use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};

use shared::chains::{parse_chain_type, parse_chains_env, parse_default_chain_id, ChainKind};
use shared::eip712::Eip712Domain;
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

/// Multi-chain API configuration parsed from environment variables.
///
/// Environment variables:
/// ```text
/// CHAINS=1,99999               # comma-separated chain IDs; required, non-empty
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
/// ```
pub struct ChainsConfig {
    pub default_chain_id: i64,
    /// EVM voucher signing config keyed by chain_id.
    pub voucher: HashMap<i64, VoucherChainConfig>,
    /// Stellar voucher signing config keyed by chain_id.
    pub stellar_voucher: HashMap<i64, StellarVoucherChainConfig>,
}

impl ChainsConfig {
    pub fn from_env() -> Result<Self> {
        let chains = parse_chains_env()?;
        let default_chain_id = parse_default_chain_id(&chains)?;

        let mut voucher = HashMap::new();
        let mut stellar_voucher = HashMap::new();

        // Lazily read the flat STELLAR_VERIFIER_SECRET seed once (only if a Stellar chain is found).
        let mut stellar_seed_cache: Option<[u8; 32]> = None;

        for &chain_id in &chains {
            let chain_kind = parse_chain_type(chain_id)?;

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
            voucher,
            stellar_voucher,
        })
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
/// `CHAIN_<id>_STELLAR_DEPOSIT_MANAGER_ID` / `WITHDRAWAL_QUEUE_ID` /
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
