use std::sync::Arc;
use std::time::Duration;

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use anyhow::{Context, Result};
use chrono::Utc;
use shared::kyc_repo::KycRepo;

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

    let provider = ProviderBuilder::new().wallet(wallet).on_http(rpc_url);

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
        // Process allows
        match kyc_repo.fetch_profiles_to_allow().await {
            Ok(candidates) => {
                if !candidates.is_empty() {
                    tracing::info!(count = candidates.len(), "processing whitelist allows");
                }
                for candidate in candidates {
                    let addr: Address = match candidate.wallet_address.parse() {
                        Ok(a) => a,
                        Err(e) => {
                            tracing::error!(
                                wallet = candidate.wallet_address,
                                error = %e,
                                "invalid wallet address, skipping"
                            );
                            continue;
                        }
                    };

                    let until_ts = Utc::now().timestamp() as u64 + settings.ttl_secs;
                    let result = async {
                        registry
                            .allowUser(addr, U256::from(until_ts))
                            .send()
                            .await?
                            .watch()
                            .await?;
                        Ok::<(), alloy::contract::Error>(())
                    }
                    .await;

                    match result {
                        Ok(_) => {
                            let reset_at =
                                Utc::now() + chrono::Duration::seconds(settings.ttl_secs as i64);
                            if let Err(e) = kyc_repo
                                .set_whitelisted(&candidate.wallet_address, reset_at)
                                .await
                            {
                                tracing::error!(
                                    wallet = candidate.wallet_address,
                                    error = %e,
                                    "failed to update DB after allowUser tx"
                                );
                            } else {
                                tracing::info!(
                                    wallet = candidate.wallet_address,
                                    "allowUser tx confirmed"
                                );
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                wallet = candidate.wallet_address,
                                error = %e,
                                "allowUser tx failed, will retry next iteration"
                            );
                        }
                    }
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "failed to fetch profiles to allow");
            }
        }

        // Process disallows
        match kyc_repo.fetch_profiles_to_disallow().await {
            Ok(candidates) => {
                if !candidates.is_empty() {
                    tracing::info!(count = candidates.len(), "processing whitelist disallows");
                }
                for candidate in candidates {
                    let addr: Address = match candidate.wallet_address.parse() {
                        Ok(a) => a,
                        Err(e) => {
                            tracing::error!(
                                wallet = candidate.wallet_address,
                                error = %e,
                                "invalid wallet address, skipping"
                            );
                            continue;
                        }
                    };

                    let result = async {
                        registry.disallow(addr).send().await?.watch().await?;
                        Ok::<(), alloy::contract::Error>(())
                    }
                    .await;

                    match result {
                        Ok(_) => {
                            if let Err(e) = kyc_repo.set_disallowed(&candidate.wallet_address).await
                            {
                                tracing::error!(
                                    wallet = candidate.wallet_address,
                                    error = %e,
                                    "failed to update DB after disallow tx"
                                );
                            } else {
                                tracing::info!(
                                    wallet = candidate.wallet_address,
                                    "disallow tx confirmed"
                                );
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                wallet = candidate.wallet_address,
                                error = %e,
                                "disallow tx failed, will retry next iteration"
                            );
                        }
                    }
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "failed to fetch profiles to disallow");
            }
        }

        tokio::time::sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}
