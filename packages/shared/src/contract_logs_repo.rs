use bigdecimal::BigDecimal;
use sqlx::PgPool;

/// A loan-end event row fetched from `contract_logs`.
///
/// Used by the portfolio yield endpoint to determine each loan's `effective_end`:
/// `min(scheduled_maturity, earliest LoanClosed / LoanDefaulted block_timestamp)`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LifecycleRow {
    pub event_name: String,
    pub block_timestamp: i64,
    pub loan_id: BigDecimal,
}

pub struct ContractLogsRepo {
    pub pool: PgPool,
}

impl ContractLogsRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Return all `LoanClosed` and `LoanDefaulted` events for a given `chain_id` with
    /// `block_timestamp <= to_unix`, ordered by `(block_timestamp, log_index)`.
    ///
    /// Generic over `Executor` so callers can run this inside a transaction alongside
    /// other reads for a consistent snapshot.
    pub async fn list_loan_lifecycle_events<'e, E>(
        &self,
        executor: E,
        chain_id: i64,
        to_unix: i64,
    ) -> anyhow::Result<Vec<LifecycleRow>>
    where
        E: sqlx::Executor<'e, Database = sqlx::Postgres>,
    {
        let event_names = vec!["LoanClosed", "LoanDefaulted"];
        let rows = sqlx::query_as::<_, LifecycleRow>(
            "SELECT
                 event_name,
                 block_timestamp,
                 (params->>'loan_id')::numeric AS loan_id
             FROM contract_logs
             WHERE chain_id = $1
               AND event_name = ANY($2)
               AND block_timestamp <= $3
             ORDER BY block_timestamp, log_index",
        )
        .bind(chain_id)
        .bind(&event_names)
        .bind(to_unix)
        .fetch_all(executor)
        .await?;
        Ok(rows)
    }
}
