use std::sync::Arc;
use std::time::Duration;

use alloy::network::EthereumWallet;
use alloy::primitives::Address;
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};
use shared::kyc_repo::KycRepo;

use crate::relayer::config::RelayerJobSettings;
use crate::relayer::whitelist_sync::{phase_whitelist_sync, WhitelistRegistry};

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

    tracing::info!(
        interval_secs = settings.interval_secs,
        registry = %registry_address,
        "relayer job running"
    );

    loop {
        phase_whitelist_sync(
            &registry,
            &kyc_repo,
            settings.whitelist_ttl_secs,
            settings.require_sumsub,
        )
        .await;

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
