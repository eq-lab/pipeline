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

/// One bucket of a wallet's position history: the **closing** position as of the
/// end of that bucket, not an average over it — averaging a balance would be
/// meaningless.
///
/// Buckets in which the position did not change are absent rather than
/// forward-filled: a position persists until the next row, so consumers should
/// step-interpolate. Emitting synthetic rows for quiet periods would fabricate
/// history the indexer never observed.
#[derive(sqlx::FromRow, Debug)]
pub struct PositionHistoryBucket {
    pub vault_address: String,
    pub bucket: DateTime<Utc>,
    pub shares_balance: bigdecimal::BigDecimal,
    pub avg_buy_share_price: bigdecimal::BigDecimal,
    /// Realized PnL accumulated from the wallet's first event up to and
    /// including this bucket — always over full history, never just the
    /// requested window.
    pub cumulative_realized_pnl: bigdecimal::BigDecimal,
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

    /// Earliest recorded `block_timestamp` in `share_prices` for a vault, or `None`
    /// if the vault has no price history yet. Used to bound full-history price queries
    /// in the API layer.
    pub async fn get_earliest_price_timestamp(
        &self,
        chain_id: i64,
        vault_address: &str,
    ) -> anyhow::Result<Option<DateTime<Utc>>> {
        let row: Option<(DateTime<Utc>,)> = sqlx::query_as(
            "SELECT block_timestamp FROM share_prices
             WHERE chain_id = $1 AND LOWER(vault_address) = LOWER($2)
             ORDER BY block_timestamp ASC
             LIMIT 1",
        )
        .bind(chain_id)
        .bind(vault_address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(t,)| t))
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

    /// Earliest timestamp (unix seconds) at which a wallet held any share
    /// position — the anchor for its effective-APY window.
    ///
    /// Reads `position_events`, so a holder who acquired shares only by
    /// `ShareTransfer` and never staked directly still has an anchor. Keying on
    /// staking alone would leave their APY undefined.
    pub async fn get_first_position_timestamp(
        &self,
        chain_id: i64,
        owner_address: &str,
    ) -> anyhow::Result<Option<i64>> {
        let owner = owner_address.to_lowercase();
        let row: Option<(Option<i64>,)> = sqlx::query_as(
            "SELECT MIN(block_timestamp) FROM position_events
             WHERE chain_id = $1
               AND holder = $2",
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

    /// A wallet's position history, bucketed by `interval`.
    ///
    /// `interval` must be a valid PostgreSQL `DATE_TRUNC` field (`'hour'`,
    /// `'day'`, `'week'`) — supplied by `Interval::as_pg_trunc`, never from raw
    /// user input. `vault` filters to a single vault; `None` returns every vault
    /// the wallet has touched. `since` bounds the returned buckets.
    ///
    /// Reads `position_events`, so staking and either side of a `ShareTransfer`
    /// all contribute — a wallet that only ever received shares still has a
    /// history.
    ///
    /// Each bucket carries the **last** position within it (`DISTINCT ON`
    /// ordered by event position descending), because a balance's closing value
    /// is the meaningful one.
    pub async fn get_position_history(
        &self,
        chain_id: i64,
        owner_address: &str,
        vault: Option<&str>,
        interval: &str,
        since: Option<DateTime<Utc>>,
    ) -> anyhow::Result<Vec<PositionHistoryBucket>> {
        let owner = owner_address.to_lowercase();

        // The cumulative realized-PnL window must run over the wallet's *whole*
        // history, so the `since` bound is applied in the outer query, after the
        // window has been computed. Filtering inside the CTE would restart the
        // running total at the window boundary and understate it.
        let query = format!(
            "WITH ev AS (
                 SELECT
                     (CASE WHEN chain_id IN (99000001, 99000002) THEN contract_address ELSE LOWER(contract_address) END) AS vault_address,
                     DATE_TRUNC('{interval}', TO_TIMESTAMP(block_timestamp)) AS bucket,
                     block_number,
                     log_index,
                     shares_balance,
                     avg_buy_share_price,
                     SUM(realized_pnl) OVER (
                         PARTITION BY chain_id, LOWER(contract_address)
                         ORDER BY block_number, log_index
                         ROWS UNBOUNDED PRECEDING
                     ) AS cumulative_realized_pnl
                 FROM position_events
                 WHERE chain_id = $1
                   AND holder = $2
                   {vault_clause}
             )
             SELECT DISTINCT ON (vault_address, bucket)
                 vault_address,
                 bucket,
                 COALESCE(shares_balance, 0) AS shares_balance,
                 COALESCE(avg_buy_share_price, 0) AS avg_buy_share_price,
                 COALESCE(cumulative_realized_pnl, 0) AS cumulative_realized_pnl
             FROM ev
             {since_clause}
             ORDER BY vault_address, bucket, block_number DESC, log_index DESC",
            vault_clause = if vault.is_some() {
                "AND LOWER(contract_address) = LOWER($3)"
            } else {
                ""
            },
            since_clause = match (vault.is_some(), since.is_some()) {
                (true, true) => "WHERE bucket >= $4",
                (false, true) => "WHERE bucket >= $3",
                _ => "",
            },
        );

        let mut q = sqlx::query_as::<_, PositionHistoryBucket>(&query)
            .bind(chain_id)
            .bind(&owner);
        if let Some(v) = vault {
            q = q.bind(v);
        }
        if let Some(s) = since {
            q = q.bind(s);
        }
        Ok(q.fetch_all(&self.pool).await?)
    }

    /// Get per-vault position summaries for a wallet (latest position + total realized PnL).
    pub async fn get_position_summaries(
        &self,
        chain_id: i64,
        owner_address: &str,
    ) -> anyhow::Result<Vec<PositionSummary>> {
        let owner = owner_address.to_lowercase();
        // `vault_address` is returned to the API client. EVM addresses are
        // case-insensitive, so lowering them is the canonical normalisation.
        // Stellar Strkeys (C…) carry a CRC16 checksum — lowering corrupts them
        // into an invalid form that downstream clients can't parse, so preserve
        // case for Stellar chain IDs (sentinel 99000001 / 99000002).
        //
        // Both halves read the `position_events` view, which normalises the
        // three position-bearing row shapes — staking rows keyed on `owner` (or
        // legacy `from`), and each side of a `ShareTransfer` — into one row per
        // holder. A holder's latest position is therefore found regardless of
        // whether it was last set by staking or by a peer-to-peer transfer.
        let rows = sqlx::query_as::<_, PositionSummary>(
            "SELECT
                 latest.vault_address,
                 latest.shares_balance,
                 latest.avg_buy_share_price,
                 COALESCE(agg.total_realized_pnl, 0) AS total_realized_pnl
             FROM (
                 SELECT DISTINCT ON (LOWER(contract_address))
                     (CASE WHEN chain_id IN (99000001, 99000002) THEN contract_address ELSE LOWER(contract_address) END) AS vault_address,
                     shares_balance,
                     avg_buy_share_price
                 FROM position_events
                 WHERE chain_id = $1
                   AND holder = $2
                   AND shares_balance > 0
                 ORDER BY LOWER(contract_address), block_number DESC, log_index DESC
             ) latest
             LEFT JOIN (
                 SELECT (CASE WHEN chain_id IN (99000001, 99000002) THEN contract_address ELSE LOWER(contract_address) END) AS vault_address,
                        SUM(realized_pnl) AS total_realized_pnl
                 FROM position_events
                 WHERE chain_id = $1
                   AND holder = $2
                 GROUP BY (CASE WHEN chain_id IN (99000001, 99000002) THEN contract_address ELSE LOWER(contract_address) END)
             ) agg ON agg.vault_address = latest.vault_address",
        )
        .bind(chain_id)
        .bind(&owner)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}
