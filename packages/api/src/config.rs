use std::collections::HashMap;
use std::env;

use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};

use shared::chains::{parse_chains_env, parse_default_chain_id};
use shared::eip712::Eip712Domain;

/// Per-chain voucher signing config. Only present for chains that have
/// `CHAIN_<id>_SIGNER_KEY` set.
pub struct VoucherChainConfig {
    pub signer: PrivateKeySigner,
    pub dm_domain: Eip712Domain,
    pub wq_domain: Eip712Domain,
}

/// Multi-chain API configuration parsed from environment variables.
///
/// Environment variables:
/// ```text
/// CHAINS=1,99999               # comma-separated chain IDs; required, non-empty
/// DEFAULT_CHAIN_ID=1           # required, must be a member of CHAINS
/// # Per-chain (replace <id> with each value from CHAINS):
/// CHAIN_<id>_SIGNER_KEY=0x...  # optional; if set, DM_ADDRESS and WQ_ADDRESS are required
/// CHAIN_<id>_DM_ADDRESS=0x...  # required when SIGNER_KEY is set
/// CHAIN_<id>_WQ_ADDRESS=0x...  # required when SIGNER_KEY is set
/// ```
pub struct ChainsConfig {
    pub default_chain_id: i64,
    /// Voucher signing config keyed by chain_id. Only chains with SIGNER_KEY set appear here.
    pub voucher: HashMap<i64, VoucherChainConfig>,
}

impl ChainsConfig {
    pub fn from_env() -> Result<Self> {
        let chains = parse_chains_env()?;
        let default_chain_id = parse_default_chain_id(&chains)?;

        let mut voucher = HashMap::new();

        for &chain_id in &chains {
            let key_env = format!("CHAIN_{chain_id}_SIGNER_KEY");
            let Ok(signer_key) = env::var(&key_env) else {
                tracing::warn!(
                    chain_id,
                    "CHAIN_{chain_id}_SIGNER_KEY not set — voucher signing disabled for this chain"
                );
                continue;
            };

            let signer: PrivateKeySigner = signer_key.parse().with_context(|| {
                format!("CHAIN_{chain_id}_SIGNER_KEY must be a valid private key")
            })?;
            tracing::info!(chain_id, address = %signer.address(), "voucher signer loaded");

            let chain_id_u64 = chain_id as u64;

            let dm_addr: alloy::primitives::Address =
                env::var(format!("CHAIN_{chain_id}_DM_ADDRESS"))
                    .with_context(|| {
                        format!(
                    "CHAIN_{chain_id}_DM_ADDRESS required when CHAIN_{chain_id}_SIGNER_KEY is set"
                )
                    })?
                    .parse()
                    .with_context(|| {
                        format!("CHAIN_{chain_id}_DM_ADDRESS must be a valid address")
                    })?;

            let wq_addr: alloy::primitives::Address =
                env::var(format!("CHAIN_{chain_id}_WQ_ADDRESS"))
                    .with_context(|| {
                        format!(
                    "CHAIN_{chain_id}_WQ_ADDRESS required when CHAIN_{chain_id}_SIGNER_KEY is set"
                )
                    })?
                    .parse()
                    .with_context(|| {
                        format!("CHAIN_{chain_id}_WQ_ADDRESS must be a valid address")
                    })?;

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
        }

        Ok(Self {
            default_chain_id,
            voucher,
        })
    }
}
