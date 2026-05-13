use alloy::sol;
use anyhow::Result;
use shared::kyc_repo::KycRepo;

sol! {
    #[sol(rpc)]
    contract WhitelistRegistry {
        function allowUser(address user) external;
        function disallow(address who) external;
    }
}

/// Phase 3: Sync whitelist state to the on-chain WhitelistRegistry.
///
/// Reads DB flags set by Phase 1 (Sumsub) and Phase 2 (Crystal) and makes
/// allowUser/disallow calls accordingly.
pub async fn phase_sync_whitelist<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    sumsub_enabled: bool,
    crystal_enabled: bool,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    process_allows(registry, kyc_repo, sumsub_enabled, crystal_enabled).await;
    // disallow is intentionally skipped — the relayer only adds users to the whitelist;
    // revocation will be handled through a separate admin flow.
    // process_disallows(registry, kyc_repo, sumsub_enabled, crystal_enabled).await;
}

async fn process_allows<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    sumsub_enabled: bool,
    crystal_enabled: bool,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    let candidates = match kyc_repo
        .fetch_profiles_to_allow(sumsub_enabled, crystal_enabled)
        .await
    {
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

        let result: Result<_, alloy::contract::Error> = async {
            registry.allowUser(addr).send().await?.watch().await?;
            Ok(())
        }
        .await;

        match result {
            Ok(_) => {
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(&candidate.wallet_address)
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

// async fn process_disallows<T, P>(
//     registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
//     kyc_repo: &KycRepo,
//     sumsub_enabled: bool,
//     crystal_enabled: bool,
// ) where
//     T: alloy::transports::Transport + Clone,
//     P: alloy::providers::Provider<T>,
// {
//     let candidates = match kyc_repo
//         .fetch_profiles_to_disallow(sumsub_enabled, crystal_enabled)
//         .await
//     {
//         Ok(c) => c,
//         Err(e) => {
//             tracing::error!(error = %e, "failed to fetch profiles to disallow");
//             return;
//         }
//     };

//     if !candidates.is_empty() {
//         tracing::info!(count = candidates.len(), "processing whitelist disallows");
//     }

//     for candidate in candidates {
//         let Some(addr) = shared::evm::parse_address(&candidate.wallet_address) else {
//             continue;
//         };

//         let result: Result<_, alloy::contract::Error> = async {
//             registry.disallow(addr).send().await?.watch().await?;
//             Ok(())
//         }
//         .await;

//         match result {
//             Ok(_) => {
//                 if let Err(e) = kyc_repo.set_disallowed(&candidate.wallet_address).await {
//                     tracing::error!(wallet = candidate.wallet_address, error = %e, "failed to update DB after disallow tx");
//                 } else {
//                     tracing::info!(wallet = candidate.wallet_address, "disallow tx confirmed");
//                 }
//             }
//             Err(e) => {
//                 tracing::error!(wallet = candidate.wallet_address, error = %e, "disallow tx failed, will retry next iteration");
//             }
//         }
//     }
// }
