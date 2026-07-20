//! Read access to the per-loan protocol fee schedule (`loan_fee_schedule`).
//!
//! Fees are a debt-side economic term consumed by the repayment waterfall — they
//! govern how an incoming payment is carved up, independent of collateral valuation.
//! The schedule was previously columns on `loan_parameters`; it now has its own table,
//! keyed `(chain_id, loan_id)` like the other modern per-loan tables.

use bigdecimal::BigDecimal;
use sqlx::PgPool;

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

    /// The protocol fee schedule for one loan, or `None` when the loan has no
    /// `loan_fee_schedule` row (i.e. no schedule configured — the waterfall falls back
    /// to the all-zero default).
    pub async fn get_fee_schedule(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<Option<FeeScheduleRow>, sqlx::Error> {
        sqlx::query_as::<_, FeeScheduleRow>(
            "SELECT mgmt_fee_rate_bps, perf_fee_rate_bps, oet_alloc_rate_bps \
             FROM loan_fee_schedule WHERE chain_id = $1 AND loan_id = $2",
        )
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await
    }
}
