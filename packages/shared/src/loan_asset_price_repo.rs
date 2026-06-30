//! Storage for the rolling window of per-asset USD prices (`loan_asset_prices`).
//!
//! Written by the asset_price_collector job. Inserts are idempotent on the
//! `(asset, timestamp)` grid; a retention helper bounds storage to the most recent
//! window. Reads expose the set of already-present grid timestamps so the job only
//! backfills the gaps.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

pub struct LoanAssetPriceRepo {
    pub pool: PgPool,
}

impl LoanAssetPriceRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Idempotently record `price_usd` for `asset` at the grid point `timestamp`.
    /// A pre-existing row for `(asset, timestamp)` is left untouched. Returns the
    /// number of rows actually inserted (0 or 1).
    pub async fn insert_price(
        &self,
        asset: &str,
        price_usd: &BigDecimal,
        timestamp: DateTime<Utc>,
    ) -> Result<u64, sqlx::Error> {
        let affected = sqlx::query(
            "INSERT INTO loan_asset_prices (asset, price_usd, timestamp) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (asset, timestamp) DO NOTHING",
        )
        .bind(asset)
        .bind(price_usd)
        .bind(timestamp)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected)
    }

    /// Timestamps already stored for `asset` at or after `since` (inclusive),
    /// ascending. The job diffs this against the expected grid to find gaps.
    pub async fn existing_timestamps_since(
        &self,
        asset: &str,
        since: DateTime<Utc>,
    ) -> Result<Vec<DateTime<Utc>>, sqlx::Error> {
        let rows: Vec<(DateTime<Utc>,)> = sqlx::query_as(
            "SELECT timestamp FROM loan_asset_prices \
             WHERE asset = $1 AND timestamp >= $2 \
             ORDER BY timestamp ASC",
        )
        .bind(asset)
        .bind(since)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(ts,)| ts).collect())
    }

    /// Retention: delete rows for `asset` older than `cutoff` (strictly before).
    /// `cutoff` is the oldest grid point the window should retain, so anything
    /// earlier is pruned. Returns the number of rows removed.
    pub async fn delete_older_than(
        &self,
        asset: &str,
        cutoff: DateTime<Utc>,
    ) -> Result<u64, sqlx::Error> {
        let affected =
            sqlx::query("DELETE FROM loan_asset_prices WHERE asset = $1 AND timestamp < $2")
                .bind(asset)
                .bind(cutoff)
                .execute(&self.pool)
                .await?
                .rows_affected();
        Ok(affected)
    }

    /// The newest stored `price_usd` per asset (one row per distinct asset, picked
    /// by latest `timestamp`). Used by the loan-book read to value collateral.
    pub async fn latest_prices(&self) -> Result<Vec<(String, BigDecimal)>, sqlx::Error> {
        let rows: Vec<(String, BigDecimal)> = sqlx::query_as(
            "SELECT DISTINCT ON (asset) asset, price_usd \
             FROM loan_asset_prices \
             ORDER BY asset, timestamp DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}
