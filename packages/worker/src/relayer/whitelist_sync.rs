use alloy::primitives::U256;
use alloy::sol;
use anyhow::Result;
use chrono::Utc;
use shared::kyc_repo::KycRepo;

sol! {
    #[sol(rpc)]
    contract WhitelistRegistry {
        function allowUser(address user, uint256 until) external;
        function disallow(address who) external;
    }
}

pub async fn phase_whitelist_sync<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    ttl_secs: u64,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    process_allows(registry, kyc_repo, ttl_secs).await;
    process_disallows(registry, kyc_repo).await;
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
        let Some(addr) = shared::evm::parse_address(&candidate.wallet_address) else {
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
                if let Err(e) = kyc_repo
                    .set_whitelisted(&candidate.wallet_address, reset_at)
                    .await
                {
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
        let Some(addr) = shared::evm::parse_address(&candidate.wallet_address) else {
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
