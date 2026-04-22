use std::sync::Arc;

use alloy::primitives::U256;
use async_trait::async_trait;
use sqlx::PgConnection;

use shared::{db::EventRepo, events::TokenTransferEvent, log_mapper::LogMapper};

pub struct TokenTransferLogMapper {
    pub event: TokenTransferEvent,
    chain_id: i64,
    repo: Arc<EventRepo>,
}

impl TokenTransferLogMapper {
    pub fn new(event: TokenTransferEvent, chain_id: i64, repo: Arc<EventRepo>) -> Self {
        Self {
            event,
            chain_id,
            repo,
        }
    }
}

#[async_trait]
impl LogMapper for TokenTransferLogMapper {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> anyhow::Result<bool> {
        // Zero-value transfers are not meaningful; skip without a DB call.
        if self.event.value == U256::ZERO {
            return Ok(true);
        }

        self.repo
            .is_token_transfer_duplicate(
                conn,
                self.chain_id,
                &self.event.contract_address.to_checksum(None),
                self.event.block_number,
                self.event.log_index,
            )
            .await
    }

    async fn insert(&self, conn: &mut PgConnection) -> anyhow::Result<()> {
        self.repo
            .insert_token_transfer(conn, &self.event, self.chain_id)
            .await
    }

    fn block_number(&self) -> u64 {
        self.event.block_number
    }

    fn set_block_timestamp(&mut self, ts: u64) {
        self.event.block_timestamp = ts;
    }
}
