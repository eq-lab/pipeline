/// `StellarLogMapper` — implements `LogMapper` for Stellar/Soroban events.
///
/// Wraps a `StellarLog` and delegates DB operations to `EventRepo::insert_row`
/// (the chain-agnostic insert path that accepts a plain `contract_address: String`).
use std::sync::Arc;

use async_trait::async_trait;
use sqlx::PgConnection;

use shared::{db::EventRepo, events::EventRow, log_mapper::LogMapper};

use crate::indexer::stellar::parsers::StellarLog;

pub struct StellarLogMapper {
    log: StellarLog,
    chain_id: i64,
    repo: Arc<EventRepo>,
}

impl StellarLogMapper {
    pub fn new(log: StellarLog, chain_id: i64, repo: Arc<EventRepo>) -> Self {
        Self {
            log,
            chain_id,
            repo,
        }
    }
}

#[async_trait]
impl LogMapper for StellarLogMapper {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool> {
        self.repo
            .is_duplicate(
                conn,
                self.chain_id,
                &self.log.contract_address,
                self.log.block_number,
                self.log.log_index,
            )
            .await
    }

    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        let row = EventRow {
            contract_address: self.log.contract_address.clone(),
            event_name: self.log.event_name.clone(),
            block_number: self.log.block_number,
            tx_hash: self.log.tx_hash.clone(),
            log_index: self.log.log_index,
            block_timestamp: self.log.block_timestamp,
            params: self.log.params.clone(),
        };
        self.repo.insert_row(conn, &row, self.chain_id).await
    }

    fn block_number(&self) -> u64 {
        self.log.block_number
    }

    /// No-op — Stellar mappers pre-populate `block_timestamp` from `ledgerClosedAt`
    /// during `poll()`. The trait method would otherwise clobber the real value with
    /// `0` from `StellarEventPoller::get_block_timestamp` (which doesn't have access
    /// to the per-event close time). The pre-populated value is authoritative.
    fn set_block_timestamp(&mut self, _ts: u64) {}
}
