pub mod chain_poller;
pub mod config;
pub mod evm_parsers;
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
    contract_logs_repo::ContractLogsRepo, db::EventRepo, metadata_fetcher::MetadataFetcher,
};

use chain_poller::ChainEventPoller;
use config::IndexerJobSettings;
use evm_parsers::register_evm_handlers;
use loan_metadata::{
    HttpLoanMetadataFetcher, ImmutableDataResolver, LoanMetadataFetcher, MutableDataResolver,
};
use loan_registry_reader::LoanRegistryReader;
use poller::EvmEventPollerBuilder;

pub async fn run_indexer_job(settings: IndexerJobSettings, pool: PgPool) -> Result<()> {
    let repo = Arc::new(EventRepo::new(pool.clone()));
    let chain_id = settings.chain_id;

    // Seed cursor from START_BLOCK if no existing state.
    // A transient DB hiccup at this exact moment used to panic the spawned task
    // silently (tokio::spawn discards panics); propagate as Err instead so the
    // spawn site in worker/main.rs can log + the operator sees what happened.
    if settings.start_block > 0 {
        let current = repo.get_cursor(chain_id).await.unwrap_or(0);
        if current == 0 {
            let mut conn = repo.pool.acquire().await?;
            repo.set_cursor(&mut conn, chain_id, settings.start_block)
                .await?;
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

    let yield_minter_contracts: Vec<alloy::primitives::Address> = settings
        .yield_minter_contracts
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    // Shared deps for loan mappers.
    // `LoanRegistryReader` implements all three resolver traits; we upcast to trait objects.
    let contract_logs_repo = Arc::new(ContractLogsRepo::new(pool.clone()));
    let fetcher: Arc<dyn LoanMetadataFetcher> = Arc::new(HttpLoanMetadataFetcher::new(
        MetadataFetcher::new(reqwest::Client::new(), settings.ipfs_gateway_url.clone()),
    ));
    let reader = Arc::new(
        LoanRegistryReader::new(&settings.eth_rpc_url)
            .expect("LoanRegistryReader: valid eth_rpc_url"),
    );
    let immutable_resolver: Arc<dyn ImmutableDataResolver> = reader.clone();
    let mutable_resolver: Arc<dyn MutableDataResolver> = reader.clone();

    let base_builder = EvmEventPollerBuilder::new(
        &settings.eth_rpc_url,
        settings.polling_block_range,
        settings.polling_interval_ms,
    );

    let poller = register_evm_handlers(
        base_builder,
        chain_id,
        evm_parsers::EvmContractAddresses {
            dm_contracts,
            wq_contracts,
            splusd_contracts,
            loan_registry_contracts,
            yield_minter_contracts,
        },
        evm_parsers::EvmRepos {
            repo: repo.clone(),
            contract_logs_repo,
        },
        evm_parsers::EvmLoanDeps {
            fetcher,
            immutable_resolver,
            mutable_resolver,
        },
    )
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

    // `index_loop` never returns under normal operation (infinite poll loop);
    // this is reachable only if the loop is ever made to exit.
    Ok(())
}

async fn index_loop<P: ChainEventPoller>(
    job_name: &str,
    chain_id: i64,
    block_range: u64,
    confirmations_delay: u64,
    polling_interval_ms: u64,
    repo: &EventRepo,
    poller: &P,
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

async fn index_once<P: ChainEventPoller>(
    chain_id: i64,
    block_range: u64,
    confirmations_delay: u64,
    repo: &EventRepo,
    poller: &P,
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
