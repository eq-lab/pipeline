pub mod config;
pub mod loan_mapper;
pub mod loan_metadata;
pub mod loan_registry_reader;
pub mod mappers;
pub mod parsers;
pub mod poller;

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use sqlx::PgPool;
use tracing::Instrument;

use shared::{
    db::EventRepo, loan_details_repo::LoanDetailsRepo, metadata_fetcher::MetadataFetcher,
};

use config::IndexerJobSettings;
use loan_mapper::LoanMintedMapper;
use loan_metadata::{HttpLoanMetadataFetcher, LoanMetadataFetcher, MetadataUriResolver};
use loan_registry_reader::LoanRegistryReader;
use mappers::ContractLogMapper;
use parsers::{
    parse_deposit_requested, parse_loan_ccr_updated, parse_loan_closed, parse_loan_defaulted,
    parse_loan_location_updated, parse_loan_minted, parse_loan_repayment,
    parse_loan_status_updated, parse_request_claimed, parse_staking_deposit,
    parse_staking_withdraw, parse_withdrawal_requested,
};
use poller::EvmEventPollerBuilder;

pub async fn run_indexer_job(settings: IndexerJobSettings, pool: PgPool) {
    let repo = Arc::new(EventRepo::new(pool.clone()));
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

    let dm_contracts: Vec<alloy::primitives::Address> = settings
        .dm_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let wq_contracts: Vec<alloy::primitives::Address> = settings
        .wq_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let splusd_contracts: Vec<alloy::primitives::Address> = settings
        .splusd_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let loan_registry_contracts: Vec<alloy::primitives::Address> = settings
        .loan_registry_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let dm_repo = repo.clone();
    let wq_repo = repo.clone();
    let splusd_repo = repo.clone();
    let loan_event_repo = repo.clone();
    let loan_log_repo = repo.clone();

    // Shared deps for the LoanMinted mapper:
    //  - `MetadataFetcher`: HTTP/IPFS JSON fetcher (lives in shared crate).
    //  - `LoanRegistryReader`: alloy binding to ERC-721 `tokenURI(loanId)`.
    //  - `LoanDetailsRepo`: writes to the `loan_details` table.
    let details_repo = Arc::new(LoanDetailsRepo::new(pool.clone()));
    let fetcher: Arc<dyn LoanMetadataFetcher> = Arc::new(HttpLoanMetadataFetcher::new(
        MetadataFetcher::new(reqwest::Client::new(), settings.ipfs_gateway_url.clone()),
    ));
    let resolver: Arc<dyn MetadataUriResolver> = Arc::new(
        LoanRegistryReader::new(&settings.eth_rpc_url)
            .expect("LoanRegistryReader: valid eth_rpc_url"),
    );

    let poller = EvmEventPollerBuilder::new(
        &settings.eth_rpc_url,
        settings.polling_block_range,
        settings.polling_interval_ms,
    )
    .add_event_handler(dm_contracts, move |log| {
        parse_deposit_requested(log)
            .or_else(|| parse_request_claimed(log))
            .map(|ev| {
                Box::new(ContractLogMapper::new(ev, chain_id, dm_repo.clone()))
                    as Box<dyn shared::log_mapper::LogMapper>
            })
    })
    .add_event_handler(wq_contracts, move |log| {
        parse_withdrawal_requested(log)
            .or_else(|| parse_request_claimed(log))
            .map(|ev| {
                Box::new(ContractLogMapper::new(ev, chain_id, wq_repo.clone()))
                    as Box<dyn shared::log_mapper::LogMapper>
            })
    })
    .add_event_handler(splusd_contracts, move |log| {
        parse_staking_deposit(log)
            .or_else(|| parse_staking_withdraw(log))
            .map(|ev| {
                Box::new(
                    ContractLogMapper::new(ev, chain_id, splusd_repo.clone())
                        .with_position_tracking(),
                ) as Box<dyn shared::log_mapper::LogMapper>
            })
    })
    .add_event_handler(loan_registry_contracts, move |log| {
        parse_loan_minted(log)
            .or_else(|| parse_loan_status_updated(log))
            .or_else(|| parse_loan_ccr_updated(log))
            .or_else(|| parse_loan_location_updated(log))
            .or_else(|| parse_loan_defaulted(log))
            .or_else(|| parse_loan_closed(log))
            .or_else(|| parse_loan_repayment(log))
            .map(|ev| -> Box<dyn shared::log_mapper::LogMapper> {
                if ev.event_name == "LoanMinted" {
                    Box::new(LoanMintedMapper::new(
                        ev,
                        chain_id,
                        loan_event_repo.clone(),
                        details_repo.clone(),
                        fetcher.clone(),
                        resolver.clone(),
                    ))
                } else {
                    // Lifecycle and informational events (LoanClosed, LoanDefaulted,
                    // LoanStatusUpdated, LoanCCRUpdated, LoanLocationUpdated, LoanRepayment)
                    // are stored as plain contract_logs rows. Downstream APIs derive the
                    // current loan status from these events.
                    Box::new(ContractLogMapper::new(ev, chain_id, loan_log_repo.clone()))
                }
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
