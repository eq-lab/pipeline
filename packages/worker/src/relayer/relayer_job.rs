use std::sync::Arc;
use std::time::Duration;

use alloy::network::EthereumWallet;
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};
use shared::bitgo::client::BitgoClient;
use shared::bitgo::config::BitgoSettings;
use shared::crystal::client::CrystalClient;
use shared::crystal::config::CrystalSettings;
use shared::kyc_repo::KycRepo;
use shared::yield_mint_outbox_repo::YieldMintOutboxRepo;

use crate::relayer::config::RelayerJobSettings;
use crate::relayer::crystal_check::phase_check_crystal;
use crate::relayer::sumsub_check::phase_check_sumsub;
use crate::relayer::whitelist::{phase_sync_whitelist, WhitelistRegistry};
use crate::relayer::yield_mint::{
    on_chain::{OnChainCanYieldBeMinted, OnChainTransactionReceipt},
    HttpProvider, Phase4Settings,
};

pub async fn run_relayer_job(settings: RelayerJobSettings, kyc_repo: Arc<KycRepo>) -> Result<()> {
    let signer: PrivateKeySigner = settings
        .signer_key
        .parse()
        .context("failed to parse signer key")?;

    let wallet = EthereumWallet::from(signer);

    let rpc_url = settings
        .eth_rpc_url
        .parse()
        .context("failed to parse ETH RPC URL")?;

    let provider = ProviderBuilder::new()
        .with_recommended_fillers()
        .wallet(wallet)
        .on_http(rpc_url);

    let registry = WhitelistRegistry::new(settings.registry_address, &provider);

    // Crystal client is only created when crystal is enabled
    let crystal_client = if settings.crystal_enabled {
        let crystal_settings =
            CrystalSettings::from_env().context("Crystal is enabled but settings are missing")?;
        Some(CrystalClient::new(crystal_settings))
    } else {
        None
    };

    // Phase 4: Yield-Minter relayer setup (always enabled — required env vars
    // are validated at `RelayerJobSettings::from_env` time).
    let bitgo_settings =
        BitgoSettings::from_env().context("BitGo settings are required for Phase 4")?;
    let bitgo = Arc::new(BitgoClient::new(bitgo_settings));

    // Build a plain HTTP provider for eth_call (no wallet needed for view calls).
    let view_provider: HttpProvider = {
        let url = settings
            .eth_rpc_url
            .parse()
            .context("failed to parse ETH RPC URL for Phase 4 view")?;
        alloy::providers::ProviderBuilder::new().on_http(url)
    };
    let receipt_view = Arc::new(OnChainTransactionReceipt::new(view_provider.clone()));
    let view = Arc::new(OnChainCanYieldBeMinted::new(view_provider));

    let phase4_settings = Phase4Settings {
        chain_id: settings.chain_id,
        yield_minter_address: format!("{:#x}", settings.yield_minter_address),
        loan_registry_address: settings.loan_registry_address,
        bitgo_native_symbol: settings.bitgo_native_symbol.clone(),
        yield_minter_batch_size: settings.yield_minter_batch_size,
    };

    let outbox = Arc::new(YieldMintOutboxRepo::new(kyc_repo.pool.clone()));

    tracing::info!(
        chain_id = settings.chain_id,
        interval_secs = settings.interval_secs,
        registry = %settings.registry_address,
        sumsub_enabled = settings.sumsub_enabled,
        crystal_enabled = settings.crystal_enabled,
        yield_minter = %settings.yield_minter_address,
        "relayer job running"
    );

    let chain_id = settings.chain_id;

    loop {
        // Phase 0: Auto-populate lp_profiles from DepositRequested events for this chain
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

        // Phase 1: Sumsub KYC/KYB/AML status checks (placeholder)
        if settings.sumsub_enabled {
            phase_check_sumsub().await;
        }

        // Phase 2: Crystal Intelligence KYT/AML risk screening (chain-scoped)
        if let Some(ref crystal) = crystal_client {
            phase_check_crystal(crystal, &kyc_repo, chain_id).await;
        }

        // Phase 3: Sync whitelist to on-chain registry (chain-scoped)
        phase_sync_whitelist(
            &registry,
            &kyc_repo,
            chain_id,
            settings.sumsub_enabled,
            settings.crystal_enabled,
        )
        .await;

        // Phase: Yield-Minter automation
        if let Err(e) = crate::relayer::yield_mint::phase_yield_mint(
            &phase4_settings,
            bitgo.as_ref(),
            outbox.as_ref(),
            view.as_ref(),
            receipt_view.as_ref(),
        )
        .await
        {
            tracing::error!(error = %e, "phase_yield_mint: cycle aborted (other phases unaffected)");
        }

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
