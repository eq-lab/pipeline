pub mod access_manager_evm_parsers;
pub mod access_manager_evm_sync;
pub mod access_manager_sync;
pub mod asset_transfers;
pub mod chain_poller;
pub mod collateral_registry_parsers;
pub mod config;
pub mod deal_token_parsers;
pub mod deal_tokens;
pub mod evm_parsers;
pub mod loan_mapper;
pub mod loan_metadata;
pub mod loan_registry_reader;
pub mod mappers;
pub mod parsers;
pub mod plusd_transfers;
pub mod poller;
pub mod security_registry_parsers;
pub mod security_registry_sync;
pub mod security_registry_views;
pub mod stellar;
pub mod supervise;

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result};
use sqlx::PgPool;
use tracing::Instrument;

use shared::{
    contract_logs_repo::ContractLogsRepo, db::EventRepo, metadata_fetcher::MetadataFetcher,
    security_registry::EVM_SECURITY_PARAMS, security_registry_repo::SecurityRegistryRepo,
};

use access_manager_evm_parsers::{
    register_access_manager_handler, reject_access_manager_collision, EvmTargets,
};
use access_manager_evm_sync::{run_access_manager_sync_loop, EvmAmSyncConfig};
use alloy::primitives::{Address, U256};
use chain_poller::ChainEventPoller;
use config::IndexerJobSettings;
use evm_parsers::register_evm_handlers;
use loan_metadata::{
    HttpLoanMetadataFetcher, ImmutableDataResolver, LoanMetadataFetcher, MutableDataResolver,
};
use loan_registry_reader::LoanRegistryReader;
use poller::EvmEventPollerBuilder;
use security_registry_parsers::reject_security_collision;
use security_registry_sync::run_security_sync_loop;
use security_registry_views::EvmSecurityViewSource;
use shared::access_manager_repo::AccessManagerRepo;
use supervise::spawn_supervised;

pub fn parse_collateral_registry_contracts(
    chain_id: i64,
    raw: Option<&str>,
    others: &[Address],
) -> Result<Vec<Address>> {
    let Some(raw) = raw else {
        return Ok(vec![]);
    };
    let key = format!("CHAIN_{chain_id}_EVM_INDEXER_COLLATERAL_REGISTRY_ADDRESS");
    let addr: Address = raw
        .parse()
        .with_context(|| format!("{key} must be a valid EVM address, got '{raw}'"))?;
    if others.contains(&addr) {
        anyhow::bail!("{key} must differ from every other configured indexer contract address");
    }
    Ok(vec![addr])
}

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

    let parse_address = |role: &str, raw: &str| -> Result<alloy::primitives::Address> {
        raw.parse().with_context(|| {
            format!(
                "CHAIN_{}_EVM_INDEXER_{role} must be a valid EVM address, got '{raw}'",
                settings.chain_id
            )
        })
    };

    let dm_contracts = vec![parse_address(
        "DEPOSIT_MANAGER_ADDRESS",
        &settings.deposit_manager_address,
    )?];
    let wq_contracts = vec![parse_address(
        "WITHDRAWAL_QUEUE_ADDRESS",
        &settings.withdrawal_queue_address,
    )?];
    let splusd_contracts = vec![parse_address(
        "STAKED_PLUSD_ADDRESS",
        &settings.staked_plusd_address,
    )?];
    let loan_registry_contracts = vec![parse_address(
        "LOAN_REGISTRY_ADDRESS",
        &settings.loan_registry_address,
    )?];
    let yield_minter_contracts = vec![parse_address("MINTER_ADDRESS", &settings.minter_address)?];
    let loan_registry_checksum = loan_registry_contracts[0].to_checksum(None);
    let loan_registry_address = loan_registry_contracts[0];
    let minter_address = yield_minter_contracts[0];
    let collateral_registry_contracts = parse_collateral_registry_contracts(
        settings.chain_id,
        settings.collateral_registry_address.as_deref(),
        &[
            dm_contracts[0],
            wq_contracts[0],
            splusd_contracts[0],
            loan_registry_contracts[0],
            yield_minter_contracts[0],
        ],
    )?;

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
    let immutable_resolver: Arc<dyn ImmutableDataResolver<Address, U256>> = reader.clone();
    let mutable_resolver: Arc<dyn MutableDataResolver<Address, U256>> = reader.clone();

    let base_builder = EvmEventPollerBuilder::new(
        &settings.eth_rpc_url,
        settings.polling_block_range,
        settings.polling_interval_ms,
    );

    let mut core_roles = vec![
        ("DEPOSIT_MANAGER_ADDRESS", dm_contracts[0]),
        ("WITHDRAWAL_QUEUE_ADDRESS", wq_contracts[0]),
        ("STAKED_PLUSD_ADDRESS", splusd_contracts[0]),
        ("LOAN_REGISTRY_ADDRESS", loan_registry_contracts[0]),
        ("MINTER_ADDRESS", yield_minter_contracts[0]),
    ];
    core_roles.extend(
        collateral_registry_contracts
            .iter()
            .map(|a| ("COLLATERAL_REGISTRY_ADDRESS", *a)),
    );

    if let Some(sr) = &settings.security_registry {
        for (label, addr) in [
            ("SECURITY_REGISTRY_ADDRESS", sr.registry),
            ("SECURITY_RECORD_NFT_ADDRESS", sr.record_nft),
            ("SECURITY_REGISTRY_READER_ADDRESS", sr.reader),
        ] {
            reject_security_collision(chain_id, label, addr, &core_roles)?;
            core_roles.push((label, addr));
        }
        tracing::info!(
            chain_id,
            security_registry = %sr.registry,
            record_nft = %sr.record_nft,
            reader = %sr.reader,
            "EVM SecurityRegistry indexer enabled"
        );
    }

    let deal_tokens = match settings.deal_token_factory_address.as_deref() {
        Some(raw) => {
            let factory = parse_address("DEAL_TOKEN_FACTORY_ADDRESS", raw)?;
            deal_tokens::reject_core_collision(chain_id, factory, &core_roles)?;
            core_roles.push(("DEAL_TOKEN_FACTORY_ADDRESS", factory));
            let registry = Arc::new(
                deal_tokens::DealTokenRegistry::new(factory).excluding(settings.plusd_address),
            );
            let rows = contract_logs_repo.list_deal_registrations(chain_id).await?;
            let deals = registry.seed(&rows);
            tracing::info!(chain_id, deals, "deal-token registry seeded");
            Some(registry)
        }
        None => None,
    };

    let builder = register_evm_handlers(
        base_builder,
        chain_id,
        evm_parsers::EvmContractAddresses {
            dm_contracts,
            wq_contracts,
            splusd_contracts,
            loan_registry_contracts,
            yield_minter_contracts,
            collateral_registry_contracts,
            security_registry: settings
                .security_registry
                .map(|sr| (sr.registry, sr.record_nft)),
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
        deal_tokens,
    );
    let builder = match settings.asset_tracking.clone() {
        Some(tracking) => {
            asset_transfers::reject_asset_collision(chain_id, tracking.asset, &core_roles)?;
            tracing::info!(
                chain_id,
                asset = %tracking.asset,
                withdrawal_queue_wallet = ?tracking.withdrawal_queue_wallet,
                tracked = tracking.tracked.len(),
                "EVM asset-transfer tracking enabled"
            );
            asset_transfers::register_asset_transfer_handler(
                builder,
                chain_id,
                tracking,
                repo.clone(),
            )
        }
        None => builder,
    };
    let builder = match settings.plusd_address {
        Some(plusd) => {
            let mut roles = core_roles.clone();
            if let Some(tracking) = &settings.asset_tracking {
                roles.push(("ASSET_ADDRESS", tracking.asset));
            }
            plusd_transfers::reject_plusd_collision(chain_id, plusd, &roles)?;
            tracing::info!(chain_id, plusd = %plusd, "EVM PLUSD transfer indexing enabled");
            plusd_transfers::register_plusd_transfer_handler(builder, chain_id, plusd, repo.clone())
        }
        None => builder,
    };
    let (builder, _access_manager_guard) = match settings.access_manager_address {
        Some(am) => {
            let mut roles = core_roles.clone();
            if let Some(tracking) = &settings.asset_tracking {
                roles.push(("ASSET_ADDRESS", tracking.asset));
            }
            if let Some(plusd) = settings.plusd_address {
                roles.push(("PLUSD_ADDRESS", plusd));
            }
            reject_access_manager_collision(chain_id, am, &roles)?;
            tracing::info!(chain_id, access_manager = %am, "EVM AccessManager indexer enabled");
            let builder = register_access_manager_handler(builder, chain_id, am, repo.clone());
            let cfg = EvmAmSyncConfig {
                contract_id: am.to_checksum(None),
                targets: EvmTargets {
                    loan_registry: loan_registry_address,
                    minter: minter_address,
                    security_registry: settings.security_registry.map(|s| s.registry),
                    record_nft: settings.security_registry.map(|s| s.record_nft),
                },
            };
            let pool = pool.clone();
            let guard = spawn_supervised("access-manager-sync", chain_id, move || {
                run_access_manager_sync_loop(
                    AccessManagerRepo::new(pool.clone()),
                    chain_id,
                    cfg.clone(),
                )
            });
            (builder, Some(guard))
        }
        None => (builder, None),
    };
    let poller = builder.build();

    let _security_guard = match settings.security_registry {
        Some(sr) => {
            let rpc_url = settings.eth_rpc_url.clone();
            let loan_registry = loan_registry_checksum.clone();
            let confirmations = settings.log_confirmations_delay;
            let pool = pool.clone();
            Some(spawn_supervised(
                "security-registry-sync",
                chain_id,
                move || {
                    let pool = pool.clone();
                    let rpc_url = rpc_url.clone();
                    let loan_registry = loan_registry.clone();
                    async move {
                        let source = EvmSecurityViewSource::new(
                            &rpc_url,
                            sr.registry,
                            sr.record_nft,
                            sr.reader,
                            confirmations,
                        )?;
                        run_security_sync_loop(
                            source,
                            SecurityRegistryRepo::new(pool.clone()),
                            EventRepo::new(pool),
                            chain_id,
                            sr.registry.to_checksum(None),
                            vec![
                                sr.registry.to_checksum(None),
                                sr.record_nft.to_checksum(None),
                            ],
                            Some(loan_registry),
                            &EVM_SECURITY_PARAMS,
                        )
                        .await
                    }
                },
            ))
        }
        None => None,
    };

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

pub(crate) async fn index_loop<P: ChainEventPoller>(
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
