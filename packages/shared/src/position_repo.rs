use chrono::{DateTime, Utc};
use sqlx::PgPool;

pub struct PositionRepo {
    pub pool: PgPool,
}

#[derive(sqlx::FromRow, Debug, Clone)]
pub struct Vault {
    pub id: i64,
    pub chain_id: i64,
    pub address: String,
    pub name: Option<String>,
    pub asset_decimals: i16,
    pub share_decimals: i16,
}

#[derive(sqlx::FromRow, Debug)]
pub struct SharePriceSnapshot {
    pub price: bigdecimal::BigDecimal,
    pub block_timestamp: DateTime<Utc>,
}

#[derive(sqlx::FromRow, Debug)]
pub struct AvgPriceBucket {
    pub bucket: DateTime<Utc>,
    pub avg_price: bigdecimal::BigDecimal,
}

#[derive(sqlx::FromRow, Debug)]
pub struct PositionSummary {
    pub vault_address: String,
    pub shares_balance: bigdecimal::BigDecimal,
    pub avg_buy_share_price: bigdecimal::BigDecimal,
    pub total_realized_pnl: bigdecimal::BigDecimal,
}

impl PositionRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get all vaults for a chain.
    pub async fn get_vaults(&self, chain_id: i64) -> anyhow::Result<Vec<Vault>> {
        let rows = sqlx::query_as::<_, Vault>(
            "SELECT id, chain_id, address, name, asset_decimals, share_decimals
             FROM vaults WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn insert_share_price(
        &self,
        chain_id: i64,
        vault_address: &str,
        block_number: i64,
        block_timestamp: DateTime<Utc>,
        price: &bigdecimal::BigDecimal,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO share_prices (chain_id, vault_address, block_number, block_timestamp, price)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (chain_id, vault_address, block_number) DO NOTHING",
        )
        .bind(chain_id)
        .bind(vault_address)
        .bind(block_number)
        .bind(block_timestamp)
        .bind(price)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Get the latest share price for a vault.
    pub async fn get_latest_share_price(
        &self,
        chain_id: i64,
        vault_address: &str,
    ) -> anyhow::Result<Option<SharePriceSnapshot>> {
        let row = sqlx::query_as::<_, SharePriceSnapshot>(
            "SELECT price, block_timestamp FROM share_prices
             WHERE chain_id = $1 AND LOWER(vault_address) = LOWER($2)
             ORDER BY block_number DESC
             LIMIT 1",
        )
        .bind(chain_id)
        .bind(vault_address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// Get the oldest share price within a recent window (block_timestamp >= now - N days).
    /// Returns None if no price data exists in the window.
    pub async fn get_oldest_price_in_window(
        &self,
        chain_id: i64,
        vault_address: &str,
        since: DateTime<Utc>,
    ) -> anyhow::Result<Option<SharePriceSnapshot>> {
        let row = sqlx::query_as::<_, SharePriceSnapshot>(
            "SELECT price, block_timestamp FROM share_prices
             WHERE chain_id = $1 AND LOWER(vault_address) = LOWER($2)
               AND block_timestamp >= $3
             ORDER BY block_timestamp ASC
             LIMIT 1",
        )
        .bind(chain_id)
        .bind(vault_address)
        .bind(since)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// Get average prices grouped by time interval.
    /// `interval` must be a valid PostgreSQL DATE_TRUNC field: `'hour'`, `'day'`, or `'week'`.
    pub async fn get_avg_prices(
        &self,
        chain_id: i64,
        vault_address: &str,
        interval: &str,
        since: Option<DateTime<Utc>>,
    ) -> anyhow::Result<Vec<AvgPriceBucket>> {
        let query = format!(
            "SELECT DATE_TRUNC('{interval}', block_timestamp) AS bucket, AVG(price) AS avg_price
             FROM share_prices
             WHERE chain_id = $1 AND LOWER(vault_address) = LOWER($2)
             {since_clause}
             GROUP BY bucket
             ORDER BY bucket ASC",
            since_clause = if since.is_some() {
                "AND block_timestamp >= $3"
            } else {
                ""
            },
        );

        let rows = if let Some(since) = since {
            sqlx::query_as::<_, AvgPriceBucket>(&query)
                .bind(chain_id)
                .bind(vault_address)
                .bind(since)
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query_as::<_, AvgPriceBucket>(&query)
                .bind(chain_id)
                .bind(vault_address)
                .fetch_all(&self.pool)
                .await?
        };
        Ok(rows)
    }

    /// Get the earliest stake timestamp for a wallet (unix seconds).
    pub async fn get_first_stake_timestamp(
        &self,
        chain_id: i64,
        owner_address: &str,
    ) -> anyhow::Result<Option<i64>> {
        let owner = owner_address.to_lowercase();
        let row: Option<(Option<i64>,)> = sqlx::query_as(
            "SELECT MIN(block_timestamp) FROM contract_logs
             WHERE chain_id = $1
               AND LOWER(params->>'owner') = $2
               AND event_name = 'StakingDeposit'",
        )
        .bind(chain_id)
        .bind(&owner)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.and_then(|(v,)| v))
    }

    /// Get the highest block number we have a price for (per vault).
    pub async fn get_price_cursor(
        &self,
        chain_id: i64,
        vault_address: &str,
    ) -> anyhow::Result<Option<i64>> {
        let row: Option<(Option<i64>,)> = sqlx::query_as(
            "SELECT MAX(block_number) FROM share_prices
             WHERE chain_id = $1 AND LOWER(vault_address) = LOWER($2)",
        )
        .bind(chain_id)
        .bind(vault_address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.and_then(|(v,)| v))
    }

    /// Get per-vault position summaries for a wallet (latest position + total realized PnL).
    pub async fn get_position_summaries(
        &self,
        chain_id: i64,
        owner_address: &str,
    ) -> anyhow::Result<Vec<PositionSummary>> {
        let owner = owner_address.to_lowercase();
        let rows = sqlx::query_as::<_, PositionSummary>(
            "SELECT
                 latest.vault_address,
                 latest.shares_balance,
                 latest.avg_buy_share_price,
                 COALESCE(agg.total_realized_pnl, 0) AS total_realized_pnl
             FROM (
                 SELECT DISTINCT ON (LOWER(contract_address))
                     LOWER(contract_address) AS vault_address,
                     (params->>'shares_balance')::numeric AS shares_balance,
                     (params->>'avg_buy_share_price')::numeric AS avg_buy_share_price
                 FROM contract_logs
                 WHERE chain_id = $1
                   AND LOWER(params->>'owner') = $2
                   AND event_name IN ('StakingDeposit', 'StakingWithdrawal')
                   AND params ? 'shares_balance'
                   AND (params->>'shares_balance')::numeric > 0
                 ORDER BY LOWER(contract_address), block_number DESC, log_index DESC
             ) latest
             LEFT JOIN (
                 SELECT LOWER(contract_address) AS vault_address,
                        SUM((params->>'realized_pnl')::numeric) AS total_realized_pnl
                 FROM contract_logs
                 WHERE chain_id = $1
                   AND LOWER(params->>'owner') = $2
                   AND event_name IN ('StakingDeposit', 'StakingWithdrawal')
                   AND params ? 'realized_pnl'
                 GROUP BY LOWER(contract_address)
             ) agg ON agg.vault_address = latest.vault_address",
        )
        .bind(chain_id)
        .bind(&owner)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}
