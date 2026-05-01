use std::sync::Arc;
use std::time::Duration;

use alloy::network::EthereumWallet;
use alloy::primitives::Address;
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};
use shared::funding_repo::FundingRepo;
use shared::kyc_repo::KycRepo;
use sqlx::PgPool;

use crate::relayer::config::RelayerJobSettings;
use crate::relayer::custodian::{IWithdrawalQueue, LocalCustodianSigner, IERC20};
use crate::relayer::funding::phase_funding;
use crate::relayer::whitelist_sync::{phase_whitelist_sync, WhitelistRegistry};

pub async fn run_relayer_job(
    settings: RelayerJobSettings,
    kyc_repo: Arc<KycRepo>,
    pool: PgPool,
) -> Result<()> {
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

    let usdc_address: Address = settings
        .usdc_address
        .parse()
        .context("failed to parse USDC address")?;
    let usdc = IERC20::new(usdc_address, &provider);

    let wq_address: Address = settings
        .wq_address
        .parse()
        .context("failed to parse WQ address")?;
    let wq = IWithdrawalQueue::new(wq_address, &provider);

    let custodian_signer = LocalCustodianSigner::new(usdc, wq);
    let funding_repo = FundingRepo::new(pool);

    tracing::info!(
        interval_secs = settings.interval_secs,
        registry = %registry_address,
        wq = %wq_address,
        "relayer job running"
    );

    loop {
        // Phase 1: Whitelist sync
        phase_whitelist_sync(&registry, &kyc_repo, settings.whitelist_ttl_secs).await;

        // Phase 2: Withdrawal funding
        if let Err(e) = phase_funding(&custodian_signer, &funding_repo, &settings).await {
            tracing::error!(error = %e, "funding phase failed");
        }

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
