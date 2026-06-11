/// `StellarEventPoller` — implements `ChainEventPoller` for Stellar/Soroban chains.
///
/// Uses the hand-rolled JSON-RPC client (`StellarRpc`) to fetch `getEvents` responses
/// and the pure decoders in `parsers.rs` to produce `StellarLogMapper` boxes.
use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use sqlx::PgPool;

use shared::{db::EventRepo, log_mapper::LogMapper};

use crate::indexer::config::StellarIndexerSettings;
use crate::indexer::{
    chain_poller::ChainEventPoller,
    index_loop,
    stellar::{
        mappers::StellarLogMapper,
        parsers::dispatch_parser,
        rpc::{EventFilter, StellarRpc},
    },
};

pub struct StellarEventPoller {
    rpc: StellarRpc,
    chain_id: i64,
    repo: Arc<EventRepo>,
    deposit_manager_id: String,
    withdrawal_queue_id: String,
    staked_plusd_id: String,
}

impl StellarEventPoller {
    fn new(
        rpc_url: &str,
        chain_id: i64,
        repo: Arc<EventRepo>,
        deposit_manager_id: String,
        withdrawal_queue_id: String,
        staked_plusd_id: String,
    ) -> Self {
        Self {
            rpc: StellarRpc::new(rpc_url),
            chain_id,
            repo,
            deposit_manager_id,
            withdrawal_queue_id,
            staked_plusd_id,
        }
    }
}

#[async_trait]
impl ChainEventPoller for StellarEventPoller {
    async fn get_latest_block(&self) -> Result<u64> {
        self.rpc.get_latest_ledger().await
    }

    async fn poll(&self, from: u64, to: u64) -> Result<Vec<Box<dyn LogMapper>>> {
        let filter = EventFilter {
            contract_ids: vec![
                self.deposit_manager_id.clone(),
                self.withdrawal_queue_id.clone(),
                self.staked_plusd_id.clone(),
            ],
        };

        let (raw_events, _latest) = self.rpc.get_events(from, to, &filter).await?;

        let mut mappers: Vec<Box<dyn LogMapper>> = Vec::new();
        for raw in raw_events {
            if let Some(log) = dispatch_parser(
                &raw,
                &self.deposit_manager_id,
                &self.withdrawal_queue_id,
                &self.staked_plusd_id,
            ) {
                mappers.push(Box::new(StellarLogMapper::new(
                    log,
                    self.chain_id,
                    self.repo.clone(),
                )));
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

    let poller = StellarEventPoller::new(
        &settings.rpc_url,
        chain_id,
        repo.clone(),
        settings.deposit_manager_id.clone(),
        settings.withdrawal_queue_id.clone(),
        settings.staked_plusd_id.clone(),
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
