//! Per-loan USDC off-ramp completion state (`loan_disbursement`).
//!
//! Backs the `Disbursing` loan status. A loan is `Disbursing` from the moment it is
//! drawn on-chain (`off_ramp_complete = FALSE`) until a trustee marks the cash-rail
//! off-ramp complete via `POST /v1/loan-book/{loan_id}/disbursement/complete`. The
//! API layers this over the live on-chain status (see
//! `routes::loan_book::display_status`).
//!
//! Absence of a row is treated as NOT complete (Disbursing) by the API, matching the
//! "default after draw" semantics; the worker inserts a row (defaulting to FALSE) on
//! every `LoanDrawn` event via [`LoanDisbursementRepo::mark_drawn`].

use bigdecimal::BigDecimal;
use sqlx::{PgConnection, PgPool};

pub struct LoanDisbursementRepo {
    pub pool: PgPool,
}

impl LoanDisbursementRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Record a freshly-drawn loan as `Disbursing` (`off_ramp_complete = FALSE`).
    /// Idempotent — a re-indexed `LoanDrawn` must not reset a loan an operator has
    /// already marked complete, so an existing row is left untouched.
    ///
    /// Takes a caller-supplied connection so it runs inside the indexer's transaction
    /// alongside the `contract_logs` write (mirrors `SubmittedLoanRepo::link_drawn`).
    pub async fn mark_drawn(
        conn: &mut PgConnection,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO loan_disbursement (chain_id, loan_id) \
             VALUES ($1, $2) \
             ON CONFLICT (chain_id, loan_id) DO NOTHING",
        )
        .bind(chain_id)
        .bind(loan_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    /// Mark a loan's USDC off-ramp complete, recording who did it. Upserts so a loan
    /// with no prior row (e.g. drawn before this feature) can still be completed.
    /// Re-completing an already-complete loan is a no-op refresh (updates the actor /
    /// timestamp) — safe to call repeatedly.
    pub async fn mark_complete(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
        completed_by: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO loan_disbursement \
                 (chain_id, loan_id, off_ramp_complete, completed_at, completed_by) \
             VALUES ($1, $2, TRUE, now(), $3) \
             ON CONFLICT (chain_id, loan_id) DO UPDATE SET \
                 off_ramp_complete = TRUE, \
                 completed_at      = now(), \
                 completed_by      = $3, \
                 updated_at        = now()",
        )
        .bind(chain_id)
        .bind(loan_id)
        .bind(completed_by)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// All disbursement rows for a chain as `(loan_id, off_ramp_complete)` pairs.
    /// Loans absent from the result have no row — the API treats them as NOT complete
    /// (still Disbursing). Used by the loan-book aggregation to build the per-loan
    /// completion map in one query.
    pub async fn list_for_chain(
        &self,
        chain_id: i64,
    ) -> Result<Vec<(BigDecimal, bool)>, sqlx::Error> {
        sqlx::query_as::<_, (BigDecimal, bool)>(
            "SELECT loan_id, off_ramp_complete FROM loan_disbursement WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Whether a single loan's USDC off-ramp is complete. Absent row → `false`
    /// (still Disbursing). Used by the per-loan financials endpoint.
    pub async fn is_complete(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<bool, sqlx::Error> {
        let row: Option<(bool,)> = sqlx::query_as(
            "SELECT off_ramp_complete FROM loan_disbursement \
             WHERE chain_id = $1 AND loan_id = $2",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some_and(|(c,)| c))
    }
}
