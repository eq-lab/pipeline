//! `bank_transactions` — manually-entered record of what landed on the bank
//! rail (see `packages/shared/migrations/20260917000001_bank_transactions_lp_ledger.sql`).
//!
//! Presently written only by `routes::lp_ledger::record_deposit`, which sets
//! `lp_id` at insert time — there is no separate "unidentified wire" matching
//! flow yet. `idempotency_key` is caller-supplied and unique; a repeat value
//! surfaces as a `23505` violation for the caller to map to `409`.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

/// One row of `bank_transactions`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct BankTransactionRow {
    pub id: i64,
    pub transaction_type: String,
    pub amount: BigDecimal,
    pub payment_reference: Option<String>,
    pub occurred_at: DateTime<Utc>,
    pub recorded_by: String,
    pub created_at: DateTime<Utc>,
    pub lp_id: Option<i64>,
    pub idempotency_key: Option<Uuid>,
}

/// Namespace for `bank_transactions` writes. No instance state — every
/// method runs on the caller's connection/transaction so it can be composed
/// with the paired `lp_ledger` insert.
pub struct BankTransactionRepo;

impl BankTransactionRepo {
    /// Insert a Deposit row already matched to `lp_id`. Runs on the caller's
    /// transaction so it stays atomic with the paired `lp_ledger` insert
    /// (`routes::lp_ledger::record_deposit`).
    pub async fn insert_deposit(
        conn: &mut PgConnection,
        lp_id: i64,
        amount: &BigDecimal,
        payment_reference: Option<&str>,
        occurred_at: DateTime<Utc>,
        recorded_by: &str,
        idempotency_key: Uuid,
    ) -> Result<BankTransactionRow, sqlx::Error> {
        sqlx::query_as::<_, BankTransactionRow>(
            "INSERT INTO bank_transactions \
                 (transaction_type, amount, payment_reference, occurred_at, recorded_by, lp_id, idempotency_key) \
             VALUES ('Deposit', $1, $2, $3, $4, $5, $6) \
             RETURNING id, transaction_type, amount, payment_reference, occurred_at, recorded_by, \
                       created_at, lp_id, idempotency_key",
        )
        .bind(amount)
        .bind(payment_reference)
        .bind(occurred_at)
        .bind(recorded_by)
        .bind(lp_id)
        .bind(idempotency_key)
        .fetch_one(&mut *conn)
        .await
    }
}
