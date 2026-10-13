//! EVM twin of `relayer::stellar::whitelist`: `WhitelistRegistry.allow` in place of
//! `access_manager.execute(set_authorized)`. See `docs/exec-plans/active/evm-relayer-v5.md` (D2).

use std::time::Duration;

use alloy::primitives::{Address, TxHash};
use alloy::providers::Provider;
use alloy::sol;
use alloy::transports::Transport;
use anyhow::{Context, Result};
use shared::kyc_repo::KycRepo;

const CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);

sol! {
    #[sol(rpc)]
    contract WhitelistRegistry {
        function allow(address user) external;
        function isAllowed(address user) external view returns (bool);
    }
}

pub struct EvmWhitelister<T, P> {
    pub chain_id: i64,
    pub signer: Address,
    registry: WhitelistRegistry::WhitelistRegistryInstance<T, P>,
}

impl<T, P> EvmWhitelister<T, P>
where
    T: Transport + Clone,
    P: Provider<T>,
{
    pub fn new(chain_id: i64, registry_address: Address, provider: P, signer: Address) -> Self {
        Self {
            chain_id,
            signer,
            registry: WhitelistRegistry::new(registry_address, provider),
        }
    }

    pub fn registry_address(&self) -> Address {
        *self.registry.address()
    }

    pub async fn is_already_allowed(&self, user: Address) -> Result<bool> {
        let ret = self
            .registry
            .isAllowed(user)
            .call()
            .await
            .context("isAllowed call failed")?;
        Ok(ret._0)
    }

    pub async fn submit_allow(&self, user: Address) -> Result<TxHash> {
        let pending = self
            .registry
            .allow(user)
            .send()
            .await
            .context("allow send failed")?;
        let tx_hash = *pending.tx_hash();
        let receipt = pending
            .with_timeout(Some(CONFIRM_TIMEOUT))
            .get_receipt()
            .await
            .with_context(|| {
                format!(
                    "allow tx {tx_hash} did not reach a receipt within {}s",
                    CONFIRM_TIMEOUT.as_secs()
                )
            })?;
        if !receipt.status() {
            anyhow::bail!("allow tx {tx_hash} reverted");
        }
        Ok(tx_hash)
    }
}

pub async fn phase_sync_whitelist_evm<T, P>(
    whitelister: &EvmWhitelister<T, P>,
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    crystal_enabled: bool,
    batch_size: usize,
) where
    T: Transport + Clone,
    P: Provider<T>,
{
    process_allows(
        whitelister,
        kyc_repo,
        chain_id,
        sumsub_enabled,
        crystal_enabled,
        batch_size,
    )
    .await;
    process_disallows(kyc_repo, chain_id, sumsub_enabled, crystal_enabled).await;
}

async fn process_allows<T, P>(
    whitelister: &EvmWhitelister<T, P>,
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    crystal_enabled: bool,
    batch_size: usize,
) where
    T: Transport + Clone,
    P: Provider<T>,
{
    let candidates = match kyc_repo
        .fetch_profiles_to_allow(chain_id, sumsub_enabled, crystal_enabled)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "evm: failed to fetch profiles to allow");
            return;
        }
    };

    if candidates.is_empty() {
        return;
    }

    tracing::info!(
        chain_id,
        count = candidates.len(),
        "evm: processing whitelist allows"
    );

    for candidate in candidates.into_iter().take(batch_size) {
        let Ok(user) = candidate.wallet_address.parse::<Address>() else {
            tracing::warn!(
                wallet = %candidate.wallet_address,
                "evm: lp_profiles row is not a valid EVM address; skipping"
            );
            continue;
        };

        match whitelister.is_already_allowed(user).await {
            Ok(true) => {
                tracing::debug!(
                    wallet = %candidate.wallet_address,
                    "evm: already allowed on-chain, syncing DB"
                );
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(chain_id, &candidate.wallet_address)
                    .await
                {
                    tracing::error!(wallet = %candidate.wallet_address, error = %e, "evm: failed to sync DB");
                }
                continue;
            }
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(
                    wallet = %candidate.wallet_address,
                    error = %e,
                    "evm: isAllowed check failed, proceeding with submit"
                );
            }
        }

        match whitelister.submit_allow(user).await {
            Ok(tx_hash) => {
                if let Err(e) = kyc_repo
                    .set_on_chain_allowed(chain_id, &candidate.wallet_address)
                    .await
                {
                    tracing::error!(
                        wallet = %candidate.wallet_address,
                        %tx_hash,
                        error = %e,
                        "evm: failed to update DB after allow tx"
                    );
                } else {
                    tracing::info!(
                        wallet = %candidate.wallet_address,
                        %tx_hash,
                        "evm: allow tx confirmed"
                    );
                }
            }
            Err(e) => {
                tracing::error!(
                    wallet = %candidate.wallet_address,
                    error = %e,
                    "evm: allow tx failed, will retry next iteration"
                );
            }
        }
    }
}

async fn process_disallows(
    kyc_repo: &KycRepo,
    chain_id: i64,
    sumsub_enabled: bool,
    crystal_enabled: bool,
) {
    let to_disallow = match kyc_repo
        .fetch_profiles_to_disallow(chain_id, sumsub_enabled, crystal_enabled)
        .await
    {
        Ok(d) => d,
        Err(e) => {
            tracing::error!(error = %e, "evm: failed to fetch profiles to disallow");
            return;
        }
    };

    for candidate in to_disallow {
        if let Err(e) = kyc_repo
            .set_disallowed(chain_id, &candidate.wallet_address)
            .await
        {
            tracing::error!(
                wallet = %candidate.wallet_address,
                error = %e,
                "evm: failed to set_disallowed in DB"
            );
        } else {
            tracing::info!(
                wallet = %candidate.wallet_address,
                "evm: set_disallowed (DB-only; on-chain disallow not yet implemented, TD-31)"
            );
        }
    }
}
