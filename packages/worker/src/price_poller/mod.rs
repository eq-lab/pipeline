pub mod config;

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::BlockNumberOrTag;
use alloy::sol;
use alloy::sol_types::SolCall;
use alloy::transports::http::Http;
use chrono::{DateTime, Utc};
use reqwest::Client;

use shared::position_repo::{PositionRepo, Vault};

use config::PricePollerSettings;

sol! {
    #[sol(rpc)]
    interface IERC4626 {
        function convertToAssets(uint256 shares) external view returns (uint256 assets);
    }
}

type HttpProvider = alloy::providers::RootProvider<Http<Client>>;

pub async fn run_price_poller_job(settings: PricePollerSettings, repo: Arc<PositionRepo>) {
    let provider: HttpProvider =
        ProviderBuilder::new().on_http(settings.eth_rpc_url.parse().expect("valid RPC URL"));

    let interval = Duration::from_secs(settings.poll_interval_secs);

    loop {
        let vaults = match repo.get_vaults(settings.chain_id).await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error = %e, "failed to load vaults from DB");
                tokio::time::sleep(interval).await;
                continue;
            }
        };

        for vault in &vaults {
            let Ok(addr) = vault.address.parse::<Address>() else {
                tracing::warn!(address = %vault.address, "invalid vault address, skipping");
                continue;
            };

            if let Err(e) = collect_prices(&provider, &repo, &settings, addr, vault).await {
                tracing::error!(vault = %vault.address, error = %e, "price collection failed");
            }
        }

        tokio::time::sleep(interval).await;
    }
}

/// Walk from cursor to head in `block_interval` steps, fetching share price at each block.
/// Naturally fills gaps: if the job was down for a while, it resumes from the last stored block.
async fn collect_prices(
    provider: &HttpProvider,
    repo: &PositionRepo,
    settings: &PricePollerSettings,
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

    // Align to block_interval grid from start_block
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

/// Snap `block` forward to the nearest value on the grid defined by `origin` + N * `interval`.
pub fn align_to_grid(block: u64, origin: u64, interval: u64) -> u64 {
    if block <= origin {
        return origin;
    }
    let offset = block - origin;
    let remainder = offset % interval;
    if remainder == 0 {
        block
    } else {
        block + (interval - remainder)
    }
}

/// Fetch share price and block timestamp for a specific block.
async fn fetch_price_and_timestamp(
    provider: &HttpProvider,
    vault: Address,
    shares: U256,
    block: u64,
) -> anyhow::Result<(U256, DateTime<Utc>)> {
    let call_data = IERC4626::convertToAssetsCall { shares }.abi_encode();

    let result = provider
        .call(
            &alloy::rpc::types::TransactionRequest::default()
                .to(vault)
                .input(call_data.into()),
        )
        .block(BlockNumberOrTag::Number(block).into())
        .await?;

    let assets = U256::from_be_slice(&result[result.len() - 32..]);

    let block_info = provider
        .get_block_by_number(BlockNumberOrTag::Number(block), false.into())
        .await?
        .ok_or_else(|| anyhow::anyhow!("block {block} not found"))?;

    let ts = DateTime::from_timestamp(block_info.header.timestamp as i64, 0).unwrap_or_default();

    Ok((assets, ts))
}
