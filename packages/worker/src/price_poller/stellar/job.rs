/// `run_stellar_price_poller_job` — main loop for the Stellar price-poller.
///
/// On each tick:
/// 1. Load vaults from `PositionRepo::get_vaults(chain_id)`.
/// 2. For each vault, call `StellarPricePoller::fetch_share_price`.
/// 3. Insert the result via `PositionRepo::insert_share_price`.
/// 4. Sleep `poll_interval_secs` and repeat.
///
/// Error tolerance mirrors the EVM path: per-vault errors warn-and-continue,
/// vault-load errors fall through to `unwrap_or_default()` → empty iteration.
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use stellar_strkey::Contract;

use shared::position_repo::PositionRepo;

use crate::price_poller::config::StellarPricePollerSettings;
use crate::price_poller::stellar::poller::StellarPricePoller;

pub async fn run_stellar_price_poller_job(
    settings: StellarPricePollerSettings,
    repo: Arc<PositionRepo>,
) -> Result<()> {
    let poller = StellarPricePoller::new(&settings.rpc_url, settings.network_passphrase.clone());
    let interval = Duration::from_secs(settings.poll_interval_secs);

    loop {
        let vaults = repo.get_vaults(settings.chain_id).await.unwrap_or_default();

        for vault in &vaults {
            // Validate the vault address is a well-formed C… Strkey.
            let Ok(vault_id) = Contract::from_string(&vault.address) else {
                tracing::warn!(
                    address = %vault.address,
                    "invalid Stellar Strkey, skipping vault"
                );
                continue;
            };

            match poller
                .fetch_share_price(&vault_id, vault.share_decimals, vault.asset_decimals)
                .await
            {
                Ok(sample) => {
                    if let Err(e) = repo
                        .insert_share_price(
                            settings.chain_id,
                            &vault.address,
                            sample.ledger_seq,
                            sample.ledger_close_time,
                            &sample.normalized_price,
                        )
                        .await
                    {
                        tracing::warn!(
                            vault = %vault.address,
                            error = %e,
                            "insert_share_price failed"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        vault = %vault.address,
                        error = %e,
                        "fetch_share_price failed"
                    );
                }
            }
        }

        tokio::time::sleep(interval).await;
    }
    #[allow(unreachable_code)]
    Ok(())
}
