use std::sync::Arc;
use std::time::Duration;

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use anyhow::{Context, Result};
use chrono::Utc;
use shared::kyc_repo::{KycRepo, WhitelistCandidate};

use crate::whitelist::config::WhitelistJobSettings;

sol! {
    #[sol(rpc)]
    contract WhitelistRegistry {
        function allowUser(address user, uint256 until) external;
        function disallow(address who) external;
    }
}

pub async fn run_whitelist_sync_job(
    settings: WhitelistJobSettings,
    kyc_repo: Arc<KycRepo>,
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

    tracing::info!(
        interval_secs = settings.interval_secs,
        ttl_secs = settings.ttl_secs,
        registry = %registry_address,
        "whitelist sync job running"
    );

    loop {
        process_allows(&registry, &kyc_repo, settings.ttl_secs).await;
        process_disallows(&registry, &kyc_repo).await;
        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}

async fn process_allows<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    ttl_secs: u64,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    let candidates = match kyc_repo.fetch_profiles_to_allow().await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch profiles to allow");
            return;
        }
    };

    if !candidates.is_empty() {
        tracing::info!(count = candidates.len(), "processing whitelist allows");
    }

    for candidate in candidates {
        let Some(addr) = parse_wallet(&candidate) else {
            continue;
        };

        let until_ts = Utc::now().timestamp() as u64 + ttl_secs;
        let result: Result<_, alloy::contract::Error> = async {
            registry
                .allowUser(addr, U256::from(until_ts))
                .send()
                .await?
                .watch()
                .await?;
            Ok(())
        }
        .await;

        match result {
            Ok(_) => {
                let reset_at = Utc::now() + chrono::Duration::seconds(ttl_secs as i64);
                if let Err(e) = kyc_repo.set_whitelisted(&candidate.wallet_address, reset_at).await {
                    tracing::error!(wallet = candidate.wallet_address, error = %e, "failed to update DB after allowUser tx");
                } else {
                    tracing::info!(wallet = candidate.wallet_address, "allowUser tx confirmed");
                }
            }
            Err(e) => {
                tracing::error!(wallet = candidate.wallet_address, error = %e, "allowUser tx failed, will retry next iteration");
            }
        }
    }
}

async fn process_disallows<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    let candidates = match kyc_repo.fetch_profiles_to_disallow().await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch profiles to disallow");
            return;
        }
    };

    if !candidates.is_empty() {
        tracing::info!(count = candidates.len(), "processing whitelist disallows");
    }

    for candidate in candidates {
        let Some(addr) = parse_wallet(&candidate) else {
            continue;
        };

        let result: Result<_, alloy::contract::Error> = async {
            registry.disallow(addr).send().await?.watch().await?;
            Ok(())
        }
        .await;

        match result {
            Ok(_) => {
                if let Err(e) = kyc_repo.set_disallowed(&candidate.wallet_address).await {
                    tracing::error!(wallet = candidate.wallet_address, error = %e, "failed to update DB after disallow tx");
                } else {
                    tracing::info!(wallet = candidate.wallet_address, "disallow tx confirmed");
                }
            }
            Err(e) => {
                tracing::error!(wallet = candidate.wallet_address, error = %e, "disallow tx failed, will retry next iteration");
            }
        }
    }
}

fn parse_wallet(candidate: &WhitelistCandidate) -> Option<Address> {
    match candidate.wallet_address.parse() {
        Ok(addr) => Some(addr),
        Err(e) => {
            tracing::error!(wallet = candidate.wallet_address, error = %e, "invalid wallet address, skipping");
            None
        }
    }
}
