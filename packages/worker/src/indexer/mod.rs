pub mod config;
pub mod mappers;
pub mod parsers;
pub mod poller;

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use sqlx::PgPool;
use tracing::Instrument;

use shared::db::EventRepo;

use config::IndexerJobSettings;
use mappers::ContractLogMapper;
use parsers::{
    parse_claimable_increased, parse_transfer, parse_withdrawal_claimed, parse_withdrawal_requested,
};
use poller::EvmEventPollerBuilder;

pub async fn run_indexer_job(settings: IndexerJobSettings, pool: PgPool) {
    let repo = Arc::new(EventRepo::new(pool));
    let chain_id = settings.chain_id;

    // Seed cursor from START_BLOCK if no existing state
    if settings.start_block > 0 {
        let current = repo.get_cursor(chain_id).await.unwrap_or(0);
        if current == 0 {
            let mut conn = repo.pool.acquire().await.expect("acquire connection");
            repo.set_cursor(&mut conn, chain_id, settings.start_block)
                .await
                .expect("seed cursor");
            tracing::info!(
                start_block = settings.start_block,
                "seeded cursor from START_BLOCK"
            );
        }
    }

    let approved: Vec<alloy::primitives::Address> = settings
        .transfer_targets
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let transfer_contracts: Vec<alloy::primitives::Address> = settings
        .transfer_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let wq_contracts: Vec<alloy::primitives::Address> = settings
        .wq_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let transfer_repo = repo.clone();
    let wq_repo = repo.clone();

    let poller = EvmEventPollerBuilder::new(
        &settings.eth_rpc_url,
        settings.polling_block_range,
        settings.polling_interval_ms,
    )
    .add_event_handler(transfer_contracts, move |log| {
        parse_transfer(log, &approved).map(|ev| {
            Box::new(ContractLogMapper::new(ev, chain_id, transfer_repo.clone()))
                as Box<dyn shared::log_mapper::LogMapper>
        })
    })
    .add_event_handler(wq_contracts, move |log| {
        parse_withdrawal_requested(log)
            .or_else(|| parse_withdrawal_claimed(log))
            .or_else(|| parse_claimable_increased(log))
            .map(|ev| {
                Box::new(ContractLogMapper::new(ev, chain_id, wq_repo.clone()))
                    as Box<dyn shared::log_mapper::LogMapper>
            })
    })
    .build();

    index_loop(
        "indexer",
        chain_id,
        settings.polling_block_range,
        settings.log_confirmations_delay,
        settings.polling_interval_ms,
        &repo,
        &poller,
    )
    .await;
}

async fn index_loop(
    job_name: &str,
    chain_id: i64,
    block_range: u64,
    confirmations_delay: u64,
    polling_interval_ms: u64,
    repo: &EventRepo,
    poller: &poller::EvmEventPoller,
) {
    loop {
        let span = tracing::info_span!("index_once", job = %job_name);
        match index_once(chain_id, block_range, confirmations_delay, repo, poller)
            .instrument(span)
            .await
        {
            Ok(()) => {
                tracing::info!(job = %job_name, "indexing completed successfully");
            }
            Err(e) => {
                tracing::error!(job = %job_name, error = %e, "indexer error — retrying in 5s");
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(polling_interval_ms)).await;
    }
}

async fn index_once(
    chain_id: i64,
    block_range: u64,
    confirmations_delay: u64,
    repo: &EventRepo,
    poller: &poller::EvmEventPoller,
) -> Result<()> {
    let cursor = repo.get_cursor(chain_id).await?;
    let latest = poller.get_latest_block().await?;

    if latest < cursor + confirmations_delay {
        return Ok(());
    }

    let end = (cursor + block_range - 1).min(latest - confirmations_delay);

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

    repo.set_cursor(&mut tx, chain_id, end + 1).await?;
    tx.commit().await?;

    tracing::info!(
        from = cursor,
        to = end,
        count = mappers.len(),
        "indexed block range"
    );
    Ok(())
}
