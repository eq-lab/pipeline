//! `lp_ledger` — append-only record of every movement of an LP's claim (see
//! `packages/shared/migrations/20260917000001_bank_transactions_lp_ledger.sql`).
//! Rows are never updated or deleted.
//!
//! Today the only writer is `routes::lp_ledger::record_deposit`, which appends
//! a `Deposit`/`Wire` row alongside its matching `bank_transactions` insert, in
//! the same transaction. `summaries` backs `GET /v1/lp-ledger`: `committed` is
//! the sum of `Deposit` deltas, `repaid` is the sum of the magnitude of
//! `Redemption` deltas, and `balance` is the net running total across every
//! reason.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

/// One row of `lp_ledger`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LpLedgerRow {
    pub id: i64,
    pub lp_id: i64,
    /// Signed. Positive = credited, negative = paid out or written down.
    pub delta: BigDecimal,
    /// `Deposit` | `InterestDistribution` | `Redemption` | `WriteDown` | `Correction`.
    pub reason: String,
    /// `Wire` | `USDC`.
    pub source: String,
    /// FK to `bank_transactions.id` (Wire) or a loan repayment id (USDC) — not
    /// a real FK constraint since it crosses tables depending on `source`.
    pub source_ref: Option<i64>,
    pub dealing_date: DateTime<Utc>,
    pub recorded_by: String,
    pub reconciled_at: Option<DateTime<Utc>>,
    /// Set by the mint (#11) once the on-chain leg lands; `None` until then.
    pub stellar_tx_hash: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Committed/repaid/balance for one LP. See the module doc for the exact sums.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LpLedgerSummaryRow {
    pub lp_id: i64,
    pub committed: BigDecimal,
    pub repaid: BigDecimal,
    pub balance: BigDecimal,
}

pub struct LpLedgerRepo {
    pool: PgPool,
}

impl LpLedgerRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Append a `Deposit`/`Wire` row. Runs on the caller's transaction so it
    /// stays atomic with the paired `bank_transactions` insert.
    pub async fn insert_deposit(
        conn: &mut PgConnection,
        lp_id: i64,
        delta: &BigDecimal,
        source_ref: i64,
        dealing_date: DateTime<Utc>,
        recorded_by: &str,
    ) -> Result<LpLedgerRow, sqlx::Error> {
        sqlx::query_as::<_, LpLedgerRow>(
            "INSERT INTO lp_ledger (lp_id, delta, reason, source, source_ref, dealing_date, recorded_by) \
             VALUES ($1, $2, 'Deposit', 'Wire', $3, $4, $5) \
             RETURNING id, lp_id, delta, reason, source, source_ref, dealing_date, recorded_by, \
                       reconciled_at, stellar_tx_hash, created_at",
        )
        .bind(lp_id)
        .bind(delta)
        .bind(source_ref)
        .bind(dealing_date)
        .bind(recorded_by)
        .fetch_one(&mut *conn)
        .await
    }

    /// Committed/repaid/balance summaries. `lp_id = Some(_)` restricts to one
    /// LP (at most one row back, none if it has no ledger activity); `None`
    /// returns every LP with at least one ledger row.
    pub async fn summaries(
        &self,
        lp_id: Option<i64>,
    ) -> Result<Vec<LpLedgerSummaryRow>, sqlx::Error> {
        sqlx::query_as::<_, LpLedgerSummaryRow>(
            "SELECT lp_id, \
                 COALESCE(SUM(delta) FILTER (WHERE reason = 'Deposit'), 0) AS committed, \
                 COALESCE(SUM(-delta) FILTER (WHERE reason = 'Redemption'), 0) AS repaid, \
                 COALESCE(SUM(delta), 0) AS balance \
             FROM lp_ledger \
             WHERE $1::bigint IS NULL OR lp_id = $1 \
             GROUP BY lp_id \
             ORDER BY lp_id",
        )
        .bind(lp_id)
        .fetch_all(&self.pool)
        .await
    }
}
