//! EVM twin of `relayer::stellar::job`. See `docs/exec-plans/active/evm-relayer-v5.md`.

use std::sync::Arc;
use std::time::Duration;

use alloy::network::EthereumWallet;
use alloy::providers::fillers::{ChainIdFiller, GasFiller, NonceFiller, SimpleNonceManager};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};
use shared::crystal::client::CrystalClient;
use shared::crystal::config::CrystalSettings;
use shared::kyc_repo::KycRepo;
use shared::lp_bank_deposit_repo::LpBankDepositRepo;

use crate::relayer::config::EvmRelayerSettings;
use crate::relayer::crystal_check::phase_check_crystal;
use crate::relayer::evm::whitelist::{phase_sync_whitelist_evm, EvmWhitelister};
use crate::relayer::sumsub_check::phase_check_sumsub;
use crate::relayer::wire_in_match::phase_match_wire_ins;

pub(crate) async fn run_evm_relayer_inner(
    settings: EvmRelayerSettings,
    kyc_repo: Arc<KycRepo>,
) -> Result<()> {
    let signer: PrivateKeySigner = settings
        .signer_key
        .parse()
        .context("failed to parse signer key")?;
    let signer_address = signer.address();

    let rpc_url = settings
        .eth_rpc_url
        .parse()
        .context("failed to parse ETH RPC URL")?;

    let provider = ProviderBuilder::new()
        .filler(GasFiller)
        .filler(NonceFiller::<SimpleNonceManager>::default())
        .filler(ChainIdFiller::new(Some(settings.chain_id as u64)))
        .wallet(EthereumWallet::from(signer))
        .on_http(rpc_url);

    let whitelister = EvmWhitelister::new(
        settings.chain_id,
        settings.registry_address,
        &provider,
        signer_address,
    );

    let crystal_client = if settings.crystal_enabled {
        let crystal_settings =
            CrystalSettings::from_env().context("Crystal is enabled but settings are missing")?;
        Some(CrystalClient::new(crystal_settings))
    } else {
        None
    };

    let minter_ids = settings.minter_ids();
    let wire_in_matching = if minter_ids.is_empty() {
        tracing::info!(
            chain_id = settings.chain_id,
            "evm wire-in matching phase disabled — set CHAIN_<id>_YIELD_MINTER_CONTRACTS (the INDEXER key)"
        );
        None
    } else {
        tracing::info!(
            chain_id = settings.chain_id,
            minters = ?minter_ids,
            "evm wire-in matching phase enabled"
        );
        Some(LpBankDepositRepo::new(kyc_repo.pool.clone()))
    };

    tracing::info!(
        chain_id = settings.chain_id,
        interval_secs = settings.interval_secs,
        signer = %whitelister.signer,
        registry = %whitelister.registry_address(),
        sumsub_enabled = settings.sumsub_enabled,
        crystal_enabled = settings.crystal_enabled,
        "evm relayer job running"
    );

    let chain_id = settings.chain_id;

    loop {
        match kyc_repo.populate_profiles_from_deposits(chain_id).await {
            Ok(n) if n > 0 => {
                tracing::info!(
                    chain_id,
                    count = n,
                    "created new profiles from DepositRequested events"
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "phase 0: failed to populate profiles");
            }
            _ => {}
        }

        if settings.sumsub_enabled {
            phase_check_sumsub().await;
        }

        if let Some(ref crystal) = crystal_client {
            phase_check_crystal(crystal, &kyc_repo, chain_id).await;
        }

        phase_sync_whitelist_evm(
            &whitelister,
            &kyc_repo,
            chain_id,
            settings.sumsub_enabled,
            settings.crystal_enabled,
            settings.batch_size,
        )
        .await;

        if let Some(matcher) = wire_in_matching.as_ref() {
            for minter_id in &minter_ids {
                if let Err(e) = phase_match_wire_ins(matcher, chain_id, minter_id).await {
                    tracing::error!(error = %e, minter = %minter_id,
                        "evm phase_match_wire_ins: cycle aborted (other phases unaffected)");
                }
            }
        }

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
