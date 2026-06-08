use alloy::sol;
use anyhow::Result;
use shared::kyc_repo::KycRepo;

sol! {
    #[sol(rpc)]
    contract WhitelistRegistry {
        function allow(address user) external;
        function disallow(address who) external;
        function isAllowed(address user) external view returns (bool);
    }
}

/// Phase 3: Sync whitelist state to the on-chain WhitelistRegistry.
///
/// Reads DB flags set by Phase 1 (Sumsub) and Phase 2 (Crystal) and makes
/// allow/disallow calls accordingly. Scoped to `chain_id` because lp_profiles
/// is now sharded by chain (Q1=B / Q4=A).
pub async fn phase_sync_whitelist<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    crystal_enabled: bool,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    process_allows(
        registry,
        kyc_repo,
        chain_id,
        sumsub_enabled,
        crystal_enabled,
    )
    .await;
    // disallow is intentionally skipped — the relayer only adds users to the whitelist;
    // revocation will be handled through a separate admin flow.
    // process_disallows(registry, kyc_repo, chain_id, sumsub_enabled, crystal_enabled).await;
}

async fn process_allows<T, P>(
    registry: &WhitelistRegistry::WhitelistRegistryInstance<T, P>,
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    crystal_enabled: bool,
) where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    let candidates = match kyc_repo
        .fetch_profiles_to_allow(chain_id, sumsub_enabled, crystal_enabled)
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

        // Skip if already allowed on-chain
        match registry.isAllowed(addr).call().await {
            Ok(ret) if ret._0 => {
                tracing::debug!(
                    wallet = candidate.wallet_address,
                    "already allowed on-chain, syncing DB"
                );
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(chain_id, &candidate.wallet_address)
                    .await
                {
                    tracing::error!(wallet = candidate.wallet_address, error = %e, "failed to sync DB");
                }
                continue;
            }
            Ok(_) => {} // not allowed yet, proceed
            Err(e) => {
                tracing::warn!(wallet = candidate.wallet_address, error = %e, "isAllowed check failed, proceeding with allow");
            }
        }

        let result: Result<_, alloy::contract::Error> = async {
            registry.allow(addr).send().await?.watch().await?;
            Ok(())
        }
        .await;

        match result {
            Ok(()) => {
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(chain_id, &candidate.wallet_address)
                    .await
                {
                    tracing::error!(wallet = candidate.wallet_address, error = %e, "failed to update DB after allow tx");
                } else {
                    tracing::info!(wallet = candidate.wallet_address, "allow tx confirmed");
                }
            }
            Err(e) => {
                tracing::error!(wallet = candidate.wallet_address, error = %e, "allow tx failed, will retry next iteration");
            }
        }
    }
}
