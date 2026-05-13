use std::sync::Arc;
use std::time::Duration;

use alloy::network::EthereumWallet;
use alloy::primitives::Address;
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};
use shared::crystal::client::CrystalClient;
use shared::crystal::config::CrystalSettings;
use shared::kyc_repo::KycRepo;

use crate::relayer::config::RelayerJobSettings;
use crate::relayer::crystal_check::phase_check_crystal;
use crate::relayer::sumsub_check::phase_check_sumsub;
use crate::relayer::whitelist::{phase_sync_whitelist, WhitelistRegistry};

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

    let registry_address: Address = settings
        .registry_address
        .parse()
        .context("failed to parse registry address")?;
    let registry = WhitelistRegistry::new(registry_address, &provider);

    // Crystal client is only created when crystal is enabled
    let crystal_client = if settings.crystal_enabled {
        let crystal_settings =
            CrystalSettings::from_env().context("Crystal is enabled but settings are missing")?;
        Some(CrystalClient::new(crystal_settings))
    } else {
        None
    };

    tracing::info!(
        interval_secs = settings.interval_secs,
        registry = %registry_address,
        sumsub_enabled = settings.sumsub_enabled,
        crystal_enabled = settings.crystal_enabled,
        "relayer job running"
    );

    loop {
        // Phase 0: Auto-populate lp_profiles from DepositRequested events
        match kyc_repo.populate_profiles_from_deposits().await {
            Ok(n) if n > 0 => {
                tracing::info!(
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

        // Phase 2: Crystal Intelligence KYT/AML risk screening
        if let Some(ref crystal) = crystal_client {
            phase_check_crystal(crystal, &kyc_repo).await;
        }

        // Phase 3: Sync whitelist to on-chain registry
        phase_sync_whitelist(
            &registry,
            &kyc_repo,
            settings.sumsub_enabled,
            settings.crystal_enabled,
        )
        .await;

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
