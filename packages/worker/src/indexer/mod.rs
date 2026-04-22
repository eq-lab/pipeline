pub mod mappers;
pub mod parsers;
pub mod poller;

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use sqlx::PgPool;
use tracing::Instrument;

use shared::db::EventRepo;

use crate::config::JobSettings;
use mappers::TokenTransferLogMapper;
use parsers::parse_token_transfer;
use poller::EvmEventPollerBuilder;

pub async fn run_job(settings: JobSettings, pool: PgPool) {
    let repo = Arc::new(EventRepo::new(pool));
    let settings = Arc::new(settings);

    let repo_for_handler = repo.clone();
    let settings_for_handler = settings.clone();

    let approved: Vec<alloy::primitives::Address> = settings
        .polling_targets
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let contracts: Vec<alloy::primitives::Address> = settings
        .polling_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let poller = EvmEventPollerBuilder::new(
        &settings.eth_rpc_url,
        settings.polling_block_range,
        settings.polling_interval_ms,
    )
    .add_event_handler(contracts, move |log| {
        parse_token_transfer(log, &approved).map(|ev| {
            Box::new(TokenTransferLogMapper::new(
                ev,
                settings_for_handler.chain_id,
                repo_for_handler.clone(),
            )) as Box<dyn shared::log_mapper::LogMapper>
        })
    })
    .build();

    loop {
        let span = tracing::info_span!("index_once", job = %settings.name);
        match index_once(&settings, &repo, &poller).instrument(span).await {
            Ok(()) => {
                tracing::info!(job = %settings.name, "indexing completed successfully");
            }
            Err(e) => {
                tracing::error!(job = %settings.name, error = %e, "indexer error — retrying in 5s");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

async fn index_once(
    settings: &JobSettings,
    repo: &EventRepo,
    poller: &poller::EvmEventPoller,
) -> Result<()> {
    let cursor = repo.get_cursor(settings.chain_id).await?;
    let latest = poller.get_latest_block().await?;

    if latest < cursor + settings.log_confirmations_delay {
        return Ok(());
    }

    let end =
        (cursor + settings.polling_block_range - 1).min(latest - settings.log_confirmations_delay);

    let mut mappers = poller.poll(cursor, end).await?;

    let mut tx = repo.pool.begin().await?;
    let mut timestamp_cache: HashMap<u64, u64> = HashMap::new();

    for mapper in &mut mappers {
        if !mapper.is_duplicate(&mut tx).await? {
            let ts = poller
                .get_block_timestamp(mapper.block_number(), &mut timestamp_cache)
                .await?;
            mapper.set_block_timestamp(ts);
            mapper.insert(&mut tx).await?;
        }
    }

    repo.set_cursor(&mut tx, settings.chain_id, end + 1).await?;
    tx.commit().await?;

    tracing::info!(
        job   = %settings.name,
        from  = cursor,
        to    = end,
        count = mappers.len(),
        "indexed block range"
    );
    Ok(())
}
