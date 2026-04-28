use std::str::FromStr;

use sqlx::{PgConnection, PgPool};

use crate::events::ContractLog;

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

        Ok(row.map(|(b,)| b as u64).unwrap_or(0))
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
        sqlx::query(
            "INSERT INTO contract_logs
               (chain_id, contract_address, event_name,
                block_number, tx_hash, log_index, block_timestamp,
                sender, receiver, amount, request_id, cumulative)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        )
        .bind(chain_id)
        .bind(event.contract_address.to_checksum(None))
        .bind(&event.event_name)
        .bind(event.block_number as i64)
        .bind(format!("{:?}", event.tx_hash))
        .bind(event.log_index as i32)
        .bind(event.block_timestamp as i64)
        .bind(event.sender.map(|a| a.to_checksum(None)))
        .bind(event.receiver.map(|a| a.to_checksum(None)))
        .bind(event.amount.map(|v| {
            bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")
        }))
        .bind(event.request_id.map(|v| {
            bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")
        }))
        .bind(event.cumulative.map(|v| {
            bigdecimal::BigDecimal::from_str(&v.to_string()).expect("U256 is valid decimal")
        }))
        .execute(conn)
        .await?;

        Ok(())
    }
}
