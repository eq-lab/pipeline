// spec: docs/superpowers/specs/2026-10-12-multi-chain-price-poller-design.md#vault-source-settings-mirrored-into-vaults
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
use anyhow::Context;

use shared::position_repo::{PositionRepo, Vault};

use crate::price_poller::align_to_grid;
use crate::price_poller::config::EvmPricePollerSettings;
use crate::price_poller::evm::poller::{
    fetch_asset, fetch_decimals, fetch_price_and_timestamp, HttpProvider,
};

pub async fn run_evm_price_poller_job(
    settings: EvmPricePollerSettings,
    repo: Arc<PositionRepo>,
) -> anyhow::Result<()> {
    let provider: HttpProvider = ProviderBuilder::new().on_http(
        settings
            .rpc_url
            .parse()
            .context("price-poller RPC URL must be valid")?,
    );
    let interval = Duration::from_secs(settings.poll_interval_secs);
    let addr = settings.staked_plusd_address;

    let vault = loop {
        match bootstrap_vault(&provider, &repo, &settings).await {
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
        if let Err(e) = collect_prices(&provider, &repo, &settings, addr, &vault).await {
            tracing::error!(vault = %vault.address, error = %e, "price collection failed");
        }
        tokio::time::sleep(interval).await;
    }
}

async fn bootstrap_vault(
    provider: &HttpProvider,
    repo: &PositionRepo,
    settings: &EvmPricePollerSettings,
) -> anyhow::Result<Vault> {
    let addr = settings.staked_plusd_address;
    let share_decimals = fetch_decimals(provider, addr).await?;
    let asset = fetch_asset(provider, addr).await?;
    let asset_decimals = fetch_decimals(provider, asset).await?;
    repo.upsert_vault(
        settings.chain_id,
        &addr.to_checksum(None),
        "sPLUSD",
        i16::from(asset_decimals),
        i16::from(share_decimals),
    )
    .await
}

async fn collect_prices(
    provider: &HttpProvider,
    repo: &PositionRepo,
    settings: &EvmPricePollerSettings,
    addr: Address,
    vault: &Vault,
) -> anyhow::Result<()> {
    let vault_addr = &vault.address;
    let one_share = U256::from(10u64).pow(U256::from(vault.share_decimals as u64));
    let scale = bigdecimal::BigDecimal::from_str(
        &U256::from(10u64)
            .pow(U256::from(vault.asset_decimals as u64))
            .to_string(),
    )
    .expect("valid decimal literal");

    let cursor = repo.get_price_cursor(settings.chain_id, vault_addr).await?;

    let start = match cursor {
        Some(last_block) => (last_block as u64) + settings.block_interval,
        None => settings.start_block,
    };

    let latest = provider.get_block_number().await?;

    if start > latest {
        return Ok(());
    }

    let first_aligned = align_to_grid(start, settings.start_block, settings.block_interval);
    let mut block = first_aligned;

    let mut count = 0u64;
    while block <= latest {
        match fetch_price_and_timestamp(provider, addr, one_share, block).await {
            Ok((price_raw, block_ts)) => {
                let price = bigdecimal::BigDecimal::from_str(&price_raw.to_string())
                    .expect("U256 is valid decimal");
                let normalized = &price / &scale;

                repo.insert_share_price(
                    settings.chain_id,
                    vault_addr,
                    block as i64,
                    block_ts,
                    &normalized,
                )
                .await?;
                count += 1;
            }
            Err(e) => {
                tracing::warn!(vault = %vault_addr, block, error = %e, "failed to fetch price at block, skipping");
            }
        }

        block += settings.block_interval;
        tokio::time::sleep(Duration::from_millis(settings.rpc_delay_ms)).await;
    }

    if count > 0 {
        tracing::info!(
            vault = %vault_addr,
            from = first_aligned,
            to = block - settings.block_interval,
            count,
            "collected share prices"
        );
    }

    Ok(())
}
