/// `StellarEventPoller` — implements `ChainEventPoller` for Stellar/Soroban chains.
///
/// Uses the hand-rolled JSON-RPC client (`StellarRpc`) to fetch `getEvents` responses
/// and the pure decoders in `parsers.rs` to produce `StellarLogMapper` or
/// `LoanEventMapper` boxes (the latter for LoanRegistry events when configured).
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use sqlx::PgPool;

use shared::{
    contract_logs_repo::ContractLogsRepo, db::EventRepo, log_mapper::LogMapper,
    metadata_fetcher::MetadataFetcher,
};

use crate::indexer::config::StellarIndexerSettings;
use crate::indexer::{
    chain_poller::ChainEventPoller,
    index_loop,
    loan_mapper::LoanEventMapper,
    loan_metadata::{
        HttpLoanMetadataFetcher, ImmutableDataResolver, LoanMetadataFetcher, MutableDataResolver,
    },
    stellar::{
        loan_registry_parsers::stellar_log_to_loan_event,
        loan_registry_reader::{StellarAddress, StellarLoanRegistryReader},
        mappers::StellarLogMapper,
        parsers::{dispatch_parser, transfer_between_tracked, transfer_touches_address},
        rpc::{EventFilter, StellarRpc},
    },
};

/// The set of `event_name` strings emitted by the LoanRegistry contract.
///
/// Used to branch between `LoanEventMapper` and `StellarLogMapper` inside `poll`.
/// Verified against `packages/worker/src/indexer/stellar/loan_registry_parsers.rs`
/// and the exec plan's event table.
fn is_loan_registry_event(event_name: &str) -> bool {
    matches!(
        event_name,
        "LoanDrawn"
            | "LoanStatusUpdated"
            | "LoanCCRUpdated"
            | "LoanLocationUpdated"
            | "LoanDefaulted"
            | "LoanClosed"
            | "PaymentRecorded"
            | "LoanRolledOver"
            | "EconomicsAmended"
    )
}

/// Optional loan-mapper dependencies.
///
/// Present when `loan_registry_id` is configured; absent otherwise (ships dark).
struct LoanMapperDeps {
    contract_logs_repo: Arc<ContractLogsRepo>,
    fetcher: Arc<dyn LoanMetadataFetcher>,
    immutable_resolver: Arc<dyn ImmutableDataResolver<StellarAddress, u32>>,
    mutable_resolver: Arc<dyn MutableDataResolver<StellarAddress, u32>>,
}

pub struct StellarEventPoller {
    rpc: Arc<StellarRpc>,
    chain_id: i64,
    repo: Arc<EventRepo>,
    deposit_manager_id: String,
    withdrawal_queue_id: String,
    /// Withdrawal Queue Wallet — the MPC custody address that holds USDC for
    /// queue settlement (distinct from `withdrawal_queue_id`, the accounting
    /// contract). `Some` only when configured for this chain; used one-sided
    /// (either side, any counterparty) in the `AssetTransfer` filter.
    withdrawal_queue_wallet_id: Option<String>,
    staked_plusd_id: String,
    loan_registry_id: Option<String>,
    yield_minter_id: Option<String>,
    /// Asset (SAC) contract whose `transfer` events are tracked. `Some` only when
    /// asset-transfer tracking is fully configured.
    asset_id: Option<String>,
    /// Union of custody + ramp addresses. A transfer is persisted only when its
    /// `from` or `to` is in this set. Empty when tracking is disabled.
    tracked_addresses: HashSet<String>,
    loan_mapper_deps: Option<LoanMapperDeps>,
}

impl StellarEventPoller {
    #[allow(clippy::too_many_arguments)]
    fn new(
        rpc: Arc<StellarRpc>,
        chain_id: i64,
        repo: Arc<EventRepo>,
        deposit_manager_id: String,
        withdrawal_queue_id: String,
        withdrawal_queue_wallet_id: Option<String>,
        staked_plusd_id: String,
        loan_registry_id: Option<String>,
        yield_minter_id: Option<String>,
        asset_id: Option<String>,
        tracked_addresses: HashSet<String>,
        loan_mapper_deps: Option<LoanMapperDeps>,
    ) -> Self {
        Self {
            rpc,
            chain_id,
            repo,
            deposit_manager_id,
            withdrawal_queue_id,
            withdrawal_queue_wallet_id,
            staked_plusd_id,
            loan_registry_id,
            yield_minter_id,
            asset_id,
            tracked_addresses,
            loan_mapper_deps,
        }
    }
}

#[async_trait]
impl ChainEventPoller for StellarEventPoller {
    async fn get_latest_block(&self) -> Result<u64> {
        self.rpc.get_latest_ledger().await
    }

    async fn poll(&self, from: u64, to: u64) -> Result<Vec<Box<dyn LogMapper>>> {
        let mut contract_ids = vec![
            self.deposit_manager_id.clone(),
            self.withdrawal_queue_id.clone(),
            self.staked_plusd_id.clone(),
        ];
        if let Some(lr_id) = &self.loan_registry_id {
            contract_ids.push(lr_id.clone());
        }
        if let Some(ym_id) = &self.yield_minter_id {
            contract_ids.push(ym_id.clone());
        }
        if let Some(asset_id) = &self.asset_id {
            contract_ids.push(asset_id.clone());
        }

        let filter = EventFilter { contract_ids };

        let (raw_events, _latest) = self.rpc.get_events(from, to, &filter).await?;

        let mut mappers: Vec<Box<dyn LogMapper>> = Vec::new();
        for raw in raw_events {
            if let Some(log) = dispatch_parser(
                &raw,
                &self.deposit_manager_id,
                &self.withdrawal_queue_id,
                &self.staked_plusd_id,
                self.loan_registry_id.as_deref(),
                self.yield_minter_id.as_deref(),
                self.asset_id.as_deref(),
            ) {
                // Asset transfers are persisted when either:
                // - one side is the Withdrawal Queue Wallet — the MPC custody
                //   address that actually holds the USDC, not the accounting
                //   contract (one-sided — any counterparty, Issue #933), or
                // - BOTH endpoints are tracked (custody ∪ ramp) — internal
                //   movements between tracked accounts (Issue #789).
                // Everything else (external inflows/outflows not touching the
                // Withdrawal Queue Wallet) is skipped.
                if log.event_name == "AssetTransfer" {
                    let from = log
                        .params
                        .get("from")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let to = log.params.get("to").and_then(|v| v.as_str()).unwrap_or("");
                    let tracked = self
                        .withdrawal_queue_wallet_id
                        .as_deref()
                        .is_some_and(|wallet| transfer_touches_address(from, to, wallet))
                        || transfer_between_tracked(from, to, &self.tracked_addresses);
                    if !tracked {
                        continue;
                    }
                    mappers.push(Box::new(
                        StellarLogMapper::new(log, self.chain_id, self.repo.clone())
                            .with_withdrawal_queue_wallet(self.withdrawal_queue_wallet_id.clone()),
                    ));
                } else if is_loan_registry_event(&log.event_name) {
                    if let Some(deps) = &self.loan_mapper_deps {
                        let loan_event = stellar_log_to_loan_event(log);
                        mappers.push(Box::new(LoanEventMapper::<StellarAddress, u32>::new(
                            loan_event,
                            self.chain_id,
                            self.repo.clone(),
                            deps.contract_logs_repo.clone(),
                            deps.fetcher.clone(),
                            deps.immutable_resolver.clone(),
                            deps.mutable_resolver.clone(),
                        )));
                    }
                    // If no loan_mapper_deps (shouldn't happen if dispatch returned a loan
                    // event with None loan_registry_id, but guard against config drift).
                } else {
                    mappers.push(Box::new(StellarLogMapper::new(
                        log,
                        self.chain_id,
                        self.repo.clone(),
                    )));
                }
            }
        }

        Ok(mappers)
    }

    async fn get_block_timestamp(
        &self,
        _block_number: u64,
        _cache: &mut HashMap<u64, u64>,
    ) -> Result<u64> {
        // Stellar events carry their ledger close timestamp from `getEvents`.
        // The `StellarLogMapper` has `block_timestamp` pre-populated at poll time.
        // This method is only called by `index_once` for events that didn't have
        // their timestamp set — which should not happen, but we return 0 as a
        // graceful fallback rather than an error.
        Ok(0)
    }
}

/// Entry point for spawning a Stellar indexer task.
///
/// Mirrors `run_indexer_job` from `mod.rs` but uses the Stellar poller.
/// Note: `confirmations_delay = 0` because Stellar has deterministic finality
/// at ledger close — no reorg risk.
pub async fn run_stellar_indexer_job(settings: StellarIndexerSettings, pool: PgPool) -> Result<()> {
    let repo = Arc::new(EventRepo::new(pool.clone()));
    let chain_id = settings.chain_id;

    // Seed cursor from START_LEDGER if no existing state.
    if settings.start_ledger > 0 {
        let current = repo.get_cursor(chain_id).await.unwrap_or(0);
        if current == 0 {
            let mut conn = repo.pool.acquire().await?;
            repo.set_cursor(&mut conn, chain_id, settings.start_ledger)
                .await?;
            tracing::info!(
                start_ledger = settings.start_ledger,
                chain_id,
                "seeded Stellar cursor from START_LEDGER"
            );
        }
    }

    let rpc = Arc::new(StellarRpc::new(&settings.rpc_url));

    // Construct LoanMapper deps only when the registry is configured.
    let loan_mapper_deps = if let Some(lr_id) = &settings.loan_registry_id {
        tracing::info!(
            loan_registry_id = %lr_id,
            chain_id,
            "Stellar LoanRegistry indexer enabled"
        );
        let reader = Arc::new(StellarLoanRegistryReader::new(rpc.clone()));
        let contract_logs_repo = Arc::new(ContractLogsRepo::new(pool.clone()));

        let fetcher: Arc<dyn LoanMetadataFetcher> = Arc::new(HttpLoanMetadataFetcher::new(
            MetadataFetcher::new(reqwest::Client::new(), settings.ipfs_gateway_url.clone()),
        ));
        let immutable_resolver: Arc<dyn ImmutableDataResolver<StellarAddress, u32>> =
            reader.clone();
        let mutable_resolver: Arc<dyn MutableDataResolver<StellarAddress, u32>> = reader.clone();

        Some(LoanMapperDeps {
            contract_logs_repo,
            fetcher,
            immutable_resolver,
            mutable_resolver,
        })
    } else {
        None
    };

    // Asset-transfer tracking (custody/ramp flows). `asset_id` is `Some` only when
    // fully configured (asset id + custody + ramp addresses); the union of both
    // address lists is the membership filter applied in `poll`.
    let tracked_addresses: HashSet<String> = settings
        .custody_addresses
        .iter()
        .chain(settings.ramp_addresses.iter())
        .cloned()
        .collect();
    if let Some(asset_id) = &settings.asset_id {
        tracing::info!(
            asset_id = %asset_id,
            chain_id,
            withdrawal_queue_wallet_id = ?settings.withdrawal_queue_wallet_id,
            custody = settings.custody_addresses.len(),
            ramp = settings.ramp_addresses.len(),
            "Stellar asset-transfer tracking enabled (withdrawal queue wallet: one-sided; custody/ramp: internal movements)"
        );
    }

    let poller = StellarEventPoller::new(
        rpc,
        chain_id,
        repo.clone(),
        settings.deposit_manager_id.clone(),
        settings.withdrawal_queue_id.clone(),
        settings.withdrawal_queue_wallet_id.clone(),
        settings.staked_plusd_id.clone(),
        settings.loan_registry_id.clone(),
        settings.yield_minter_id.clone(),
        settings.asset_id.clone(),
        tracked_addresses,
        loan_mapper_deps,
    );

    index_loop(
        "stellar-indexer",
        chain_id,
        settings.polling_ledger_range,
        0, // confirmations_delay = 0 (Stellar has deterministic finality at ledger close)
        settings.polling_interval_ms,
        &repo,
        &poller,
    )
    .await;

    // `index_loop` never returns under normal operation.
    Ok(())
}
