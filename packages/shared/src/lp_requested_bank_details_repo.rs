// spec: docs/product-specs/deposits.md#lp-funding-details

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IssuedReferenceRow {
    pub id: i64,
    pub lp_id: i64,
    pub payment_details: String,
    pub chain_id: Option<i64>,
    pub receiver_address: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub const FIND_BY_PAYMENT_DETAILS_SQL: &str =
    "SELECT id, lp_id, payment_details, chain_id, receiver_address, created_at \
     FROM lp_requested_bank_details WHERE payment_details = $1";

#[async_trait]
pub trait IssuedReferenceLookup: Send + Sync {
    async fn find_by_payment_details(
        &self,
        canonical: &str,
    ) -> Result<Option<IssuedReferenceRow>, sqlx::Error>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertOutcome {
    Inserted,
    ReferenceTaken,
}

#[async_trait]
pub trait PaymentDetailsStore: Send + Sync {
    async fn insert(
        &self,
        lp_id: i64,
        chain_id: i64,
        receiver_address: &str,
        payment_details: &str,
    ) -> Result<InsertOutcome, sqlx::Error>;
}

pub struct LpRequestedBankDetailsRepo {
    pool: PgPool,
}

impl LpRequestedBankDetailsRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PaymentDetailsStore for LpRequestedBankDetailsRepo {
    async fn insert(
        &self,
        lp_id: i64,
        chain_id: i64,
        receiver_address: &str,
        payment_details: &str,
    ) -> Result<InsertOutcome, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO lp_requested_bank_details (lp_id, chain_id, receiver_address, payment_details) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(lp_id)
        .bind(chain_id)
        .bind(receiver_address)
        .bind(payment_details)
        .execute(&self.pool)
        .await;
        match result {
            Ok(_) => Ok(InsertOutcome::Inserted),
            Err(e)
                if e.as_database_error()
                    .is_some_and(sqlx::error::DatabaseError::is_unique_violation) =>
            {
                Ok(InsertOutcome::ReferenceTaken)
            }
            Err(e) => Err(e),
        }
    }
}

#[async_trait]
impl IssuedReferenceLookup for LpRequestedBankDetailsRepo {
    async fn find_by_payment_details(
        &self,
        canonical: &str,
    ) -> Result<Option<IssuedReferenceRow>, sqlx::Error> {
        sqlx::query_as::<_, IssuedReferenceRow>(FIND_BY_PAYMENT_DETAILS_SQL)
            .bind(canonical)
            .fetch_optional(&self.pool)
            .await
    }
}
