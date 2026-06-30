//! Read access to `loan_parameters` for the asset_price_collector job.
//!
//! Each row pins a loan's collateral `asset` to a `price_provider` key. The
//! collector operates on the **distinct (asset, price_provider)** set; this repo
//! exposes exactly that projection. Row population (manual/seed/other flow) is out
//! of scope here.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

/// One row of `loan_parameters`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LoanParametersRow {
    /// On-chain loan identifier (NUMERIC(78,0)).
    pub loan_id: BigDecimal,
    /// Valuation discount in `[0, 1]`.
    pub discount: BigDecimal,
    /// Collateral asset symbol.
    pub asset: String,
    /// Registry key selecting the `PriceProvider` implementation.
    pub price_provider: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A distinct `(asset, price_provider)` pairing derived from `loan_parameters`.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct AssetProvider {
    pub asset: String,
    pub price_provider: String,
}

pub struct LoanParametersRepo {
    pub pool: PgPool,
}

impl LoanParametersRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// The distinct set of `(asset, price_provider)` pairs across all loans.
    ///
    /// An asset that is configured with more than one provider yields multiple rows
    /// here (one per provider); the collector detects that conflict and skips the
    /// asset rather than guessing which provider to trust.
    pub async fn distinct_asset_providers(&self) -> Result<Vec<AssetProvider>, sqlx::Error> {
        sqlx::query_as::<_, AssetProvider>(
            "SELECT DISTINCT asset, price_provider FROM loan_parameters ORDER BY asset, price_provider",
        )
        .fetch_all(&self.pool)
        .await
    }

    /// Every loan parameter row. Used by the loan-book read to map each loan to its
    /// collateral asset and discount.
    pub async fn list_all(&self) -> Result<Vec<LoanParametersRow>, sqlx::Error> {
        sqlx::query_as::<_, LoanParametersRow>(
            "SELECT loan_id, discount, asset, price_provider, created_at, updated_at \
             FROM loan_parameters",
        )
        .fetch_all(&self.pool)
        .await
    }
}
