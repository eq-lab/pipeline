// spec: packages/shared/migrations/20261005000001_lp_bank_deposits_ref_hash.sql, Issue #1413

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LpBankDepositRow {
    pub id: i64,
    pub lp_id: i64,
    pub amount: BigDecimal,
    pub payment_reference: String,
    /// `sha256(payment_reference)` — the minter's `ref_hash: BytesN<32>`.
    pub ref_hash: Vec<u8>,
    pub occurred_at: DateTime<Utc>,
    /// Whether the PLUSD leg has been minted on Stellar. Nothing sets it yet.
    pub is_minted: bool,
    pub recorded_by: String,
    pub created_at: DateTime<Utc>,
}

const COLUMNS: &str = "id, lp_id, amount, payment_reference, ref_hash, occurred_at, \
                       is_minted, recorded_by, created_at";

pub struct LpBankDepositRepo {
    pool: PgPool,
}

impl LpBankDepositRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn insert(
        conn: &mut PgConnection,
        lp_id: i64,
        amount: &BigDecimal,
        payment_reference: &str,
        ref_hash: &[u8],
        occurred_at: DateTime<Utc>,
        recorded_by: &str,
    ) -> Result<LpBankDepositRow, sqlx::Error> {
        sqlx::query_as::<_, LpBankDepositRow>(&format!(
            "INSERT INTO lp_bank_deposits \
                 (lp_id, amount, payment_reference, ref_hash, occurred_at, recorded_by) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             RETURNING {COLUMNS}"
        ))
        .bind(lp_id)
        .bind(amount)
        .bind(payment_reference)
        .bind(ref_hash)
        .bind(occurred_at)
        .bind(recorded_by)
        .fetch_one(&mut *conn)
        .await
    }

    pub async fn list_for_lp(&self, lp_id: i64) -> Result<Vec<LpBankDepositRow>, sqlx::Error> {
        sqlx::query_as::<_, LpBankDepositRow>(&format!(
            "SELECT {COLUMNS} FROM lp_bank_deposits \
             WHERE lp_id = $1 \
             ORDER BY occurred_at DESC, id DESC"
        ))
        .bind(lp_id)
        .fetch_all(&self.pool)
        .await
    }
}
