use sqlx::{PgConnection, PgPool};

use crate::events::{ContractLog, EventRow};

pub struct EventRepo {
    pub pool: PgPool,
}

impl EventRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Returns the last indexed block for the given chain, or 0 if no cursor exists yet.
    pub async fn get_cursor(&self, chain_id: i64) -> anyhow::Result<u64> {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT last_indexed_block FROM log_collector_state WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map_or(0, |(b,)| b as u64))
    }

    /// Upserts the cursor for the given chain inside an open transaction.
    pub async fn set_cursor(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        block: u64,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO log_collector_state (chain_id, last_indexed_block, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (chain_id) DO UPDATE
               SET last_indexed_block = EXCLUDED.last_indexed_block,
                   updated_at         = NOW()",
        )
        .bind(chain_id)
        .bind(block as i64)
        .execute(conn)
        .await?;

        Ok(())
    }

    pub async fn is_duplicate(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        contract: &str,
        block: u64,
        log_index: u64,
    ) -> anyhow::Result<bool> {
        let exists: (bool,) = sqlx::query_as(
            "SELECT EXISTS(
                SELECT 1 FROM contract_logs
                WHERE chain_id = $1
                  AND contract_address = $2
                  AND block_number = $3
                  AND log_index = $4
             )",
        )
        .bind(chain_id)
        .bind(contract)
        .bind(block as i64)
        .bind(log_index as i32)
        .fetch_one(conn)
        .await?;

        Ok(exists.0)
    }

    pub async fn insert_log(
        &self,
        conn: &mut PgConnection,
        event: &ContractLog,
        chain_id: i64,
    ) -> anyhow::Result<()> {
        self.insert_log_raw(
            conn,
            chain_id,
            &event.contract_address.to_checksum(None),
            &event.event_name,
            event.block_number,
            &format!("{:?}", event.tx_hash),
            event.log_index,
            event.block_timestamp,
            &event.params,
        )
        .await
    }

    /// Chain-agnostic insert — accepts a pre-formatted `contract_address` string
    /// (Strkey for Stellar, EVM checksum for EVM). Used by the Stellar indexer.
    pub async fn insert_row(
        &self,
        conn: &mut PgConnection,
        row: &EventRow,
        chain_id: i64,
    ) -> anyhow::Result<()> {
        self.insert_log_raw(
            conn,
            chain_id,
            &row.contract_address,
            &row.event_name,
            row.block_number,
            &row.tx_hash,
            row.log_index,
            row.block_timestamp,
            &row.params,
        )
        .await
    }

    /// Private primitive that both `insert_log` and `insert_row` delegate to.
    /// All fields arrive as primitives; no alloy or chain-specific types here.
    #[allow(clippy::too_many_arguments)]
    async fn insert_log_raw(
        &self,
        conn: &mut PgConnection,
        chain_id: i64,
        contract_address: &str,
        event_name: &str,
        block_number: u64,
        tx_hash: &str,
        log_index: u64,
        block_timestamp: u64,
        params: &serde_json::Value,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO contract_logs
               (chain_id, contract_address, event_name,
                block_number, tx_hash, log_index, block_timestamp,
                params)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(chain_id)
        .bind(contract_address)
        .bind(event_name)
        .bind(block_number as i64)
        .bind(tx_hash)
        .bind(log_index as i32)
        .bind(block_timestamp as i64)
        .bind(sqlx::types::Json(params))
        .execute(conn)
        .await?;

        Ok(())
    }
}
