// spec: docs/product-specs/deposits.md#lp-funding-details

use async_trait::async_trait;
use sqlx::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertOutcome {
    Inserted,
    ReferenceTaken,
}

#[async_trait]
pub trait PaymentDetailsStore: Send + Sync {
    async fn insert(&self, lp_id: i64, payment_details: &str)
        -> Result<InsertOutcome, sqlx::Error>;
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
        payment_details: &str,
    ) -> Result<InsertOutcome, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO lp_requested_bank_details (lp_id, payment_details) VALUES ($1, $2)",
        )
        .bind(lp_id)
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
