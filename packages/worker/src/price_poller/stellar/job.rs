// spec: docs/superpowers/specs/2026-10-12-multi-chain-price-poller-design.md#vault-source-settings-mirrored-into-vaults
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use stellar_strkey::Contract;

use shared::position_repo::{PositionRepo, Vault};

use crate::price_poller::config::StellarPricePollerSettings;
use crate::price_poller::stellar::poller::StellarPricePoller;

pub async fn run_stellar_price_poller_job(
    settings: StellarPricePollerSettings,
    repo: Arc<PositionRepo>,
) -> Result<()> {
    let poller = StellarPricePoller::new(&settings.rpc_url, settings.network_passphrase.clone());
    let interval = Duration::from_secs(settings.poll_interval_secs);
    let vault_id = Contract::from_string(&settings.staked_plusd_address)
        .map_err(|e| anyhow::anyhow!("invalid staked sPLUSD Strkey: {e}"))?;

    let vault = loop {
        match bootstrap_vault(&poller, &repo, &settings, &vault_id).await {
            Ok(v) => break v,
            Err(e) => {
                tracing::error!(chain_id = settings.chain_id, error = %e, "price-poller vault bootstrap failed");
                tokio::time::sleep(interval).await;
            }
        }
    };

    tracing::info!(
        chain_id = settings.chain_id,
        vault = %vault.address,
        share_decimals = vault.share_decimals,
        asset_decimals = vault.asset_decimals,
        "price-poller vault ready"
    );

    loop {
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
                    tracing::warn!(vault = %vault.address, error = %e, "insert_share_price failed");
                }
            }
            Err(e) => {
                tracing::warn!(vault = %vault.address, error = %e, "fetch_share_price failed");
            }
        }

        tokio::time::sleep(interval).await;
    }
}

async fn bootstrap_vault(
    poller: &StellarPricePoller,
    repo: &PositionRepo,
    settings: &StellarPricePollerSettings,
    vault_id: &Contract,
) -> Result<Vault> {
    let share_decimals = poller.fetch_decimals(vault_id).await?;
    let asset_id = poller.fetch_asset(vault_id).await?;
    let asset_decimals = poller.fetch_decimals(&asset_id).await?;
    repo.upsert_vault(
        settings.chain_id,
        &settings.staked_plusd_address,
        "sPLUSD",
        i16::try_from(asset_decimals).context("asset decimals out of i16 range")?,
        i16::try_from(share_decimals).context("share decimals out of i16 range")?,
    )
    .await
}
