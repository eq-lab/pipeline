//! Read access to the per-loan protocol fee schedule (`loan_fee_schedule`).
//!
//! Fees are a debt-side economic term consumed by the repayment waterfall — they
//! govern how an incoming payment is carved up, independent of collateral valuation.
//! The table is keyed by `submitted_loan_id`: it is written by the loan-book
//! submission endpoint at submission time, before `chain_id`/`loan_id` exist.
//! `get_fee_schedule` joins through `submitted_loans` (which owns the
//! `(chain_id, loan_id)` pointer, set once the loan is drawn) to look a schedule up
//! by on-chain identity.

use bigdecimal::BigDecimal;
use sqlx::{PgConnection, PgPool};

/// The per-loan protocol fee schedule, all in basis points (1 bp = 1/10_000).
///
/// Consumed by the repayment waterfall (`GET /v1/loan-book/{loan_id}/waterfall`):
/// `mgmt_fee_rate_bps` / `oet_alloc_rate_bps` are annualised (applied against
/// `senior_deployed × tenor/365`); `perf_fee_rate_bps` is a plain fraction of
/// `(gross interest − management fee)` with no tenor factor. Defaults are 0 (see the
/// `20260720000001_loan_fee_schedule_table` migration), so an unconfigured loan carves
/// out no fees and the full gross interest flows to the net senior coupon.
#[derive(Debug, Clone, Default, PartialEq, Eq, sqlx::FromRow)]
pub struct FeeScheduleRow {
    pub mgmt_fee_rate_bps: i32,
    pub perf_fee_rate_bps: i32,
    pub oet_alloc_rate_bps: i32,
}

pub struct LoanFeeScheduleRepo {
    pub pool: PgPool,
}

impl LoanFeeScheduleRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a fee schedule authored by a loan-book submission, keyed by
    /// `submitted_loan_id`. Reachable via `get_fee_schedule` only once the loan is
    /// drawn on-chain and `submitted_loans.chain_id`/`loan_id` are set by
    /// `SubmittedLoanRepo::link_drawn`.
    ///
    /// Takes a caller-supplied connection so it runs inside the submission endpoint's
    /// transaction, atomically with the `submitted_loans` insert.
    pub async fn insert_pending(
        conn: &mut PgConnection,
        submitted_loan_id: i64,
        mgmt_fee_rate_bps: i32,
        perf_fee_rate_bps: i32,
        oet_alloc_rate_bps: i32,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO loan_fee_schedule \
                (submitted_loan_id, mgmt_fee_rate_bps, perf_fee_rate_bps, oet_alloc_rate_bps) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(submitted_loan_id)
        .bind(mgmt_fee_rate_bps)
        .bind(perf_fee_rate_bps)
        .bind(oet_alloc_rate_bps)
        .execute(conn)
        .await?;
        Ok(())
    }

    /// Delete a submission's fee-schedule row (PK'd on `submitted_loan_id`). Used when
    /// an originator resubmits a `ChangesRequested` submission: the prior row is dropped
    /// so the replacement payload's schedule can be inserted fresh. Runs on the caller's
    /// connection to stay inside the resubmit transaction; a no-op if no row exists.
    pub async fn delete_for_submission(
        conn: &mut PgConnection,
        submitted_loan_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM loan_fee_schedule WHERE submitted_loan_id = $1")
            .bind(submitted_loan_id)
            .execute(conn)
            .await?;
        Ok(())
    }

    /// The protocol fee schedule for one loan, or `None` when the loan has no
    /// `loan_fee_schedule` row (i.e. no schedule configured — the waterfall falls back
    /// to the all-zero default).
    pub async fn get_fee_schedule(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<Option<FeeScheduleRow>, sqlx::Error> {
        sqlx::query_as::<_, FeeScheduleRow>(
            "SELECT lfs.mgmt_fee_rate_bps, lfs.perf_fee_rate_bps, lfs.oet_alloc_rate_bps \
             FROM loan_fee_schedule lfs \
             JOIN submitted_loans sl ON sl.id = lfs.submitted_loan_id \
             WHERE sl.chain_id = $1 AND sl.loan_id = $2",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await
    }
}
