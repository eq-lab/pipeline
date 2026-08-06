//! Trustee-entered per-loan capital movement record (`loan_capital_transfers`).
//!
//! Backs the reworked `GET /v1/capital-allocation` buckets (#1027). For each drawn
//! loan a Trustee records, via the full-upsert
//! `POST /v1/loan-book/{loan_id}/transfers`:
//!
//! - `is_loan_deployed` — gates the loan's senior tranche into `deployed`
//!   (together with the active-window check);
//! - `on_ramp_transferred` / `off_ramp_transferred` — confirmed ramp amounts,
//!   subtracted from the gross approved custody↔ramp flow to form `in_transit`;
//! - `trust_account_deposit` / `trust_account_withdrawal` — feed `trust_account`
//!   as `sum(deposits) − sum(withdrawals)`, per chain.
//!
//! One row per `(chain_id, loan_id)`. Absence of a row means "nothing recorded
//! yet" (flag false, all amounts 0) — the API serves defaults; the indexer never
//! seeds rows (unlike `loan_disbursement`).
//!
//! Amounts are **plain dollar figures**, not base-6/on-chain-scaled (same
//! rationale as `bank_transaction_repo`): cash-rail movements have no on-chain
//! native scale. `routes::capital_allocation` scales them only when combining
//! with base-6 buckets. `recorded_by` is the audit trail; callers must pass the
//! authenticated Trustee identity (JWT `sub`), never a client-supplied value.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

/// One loan's Trustee-entered capital movement record.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LoanCapitalTransfersRow {
    pub chain_id: i64,
    pub loan_id: BigDecimal,
    /// Whether the loan's capital is actually deployed — gates the loan into the
    /// `deployed` bucket (together with the active-window check).
    pub is_loan_deployed: bool,
    /// Confirmed on-ramp amount for this loan, plain dollars.
    pub on_ramp_transferred: BigDecimal,
    /// Confirmed off-ramp amount for this loan, plain dollars.
    pub off_ramp_transferred: BigDecimal,
    /// What hit the trust account for this loan, plain dollars.
    pub trust_account_deposit: BigDecimal,
    /// What left the trust account for this loan, plain dollars.
    pub trust_account_withdrawal: BigDecimal,
    /// The authenticated Trustee (JWT `sub`) who last wrote the record.
    pub recorded_by: String,
    pub updated_at: DateTime<Utc>,
}

/// The five Trustee-entered values of a record, as parsed from the POST body.
/// Split from [`LoanCapitalTransfersRow`] so the upsert signature can't drift
/// from the row shape field-by-field.
#[derive(Debug, Clone)]
pub struct LoanCapitalTransfersValues {
    pub is_loan_deployed: bool,
    pub on_ramp_transferred: BigDecimal,
    pub off_ramp_transferred: BigDecimal,
    pub trust_account_deposit: BigDecimal,
    pub trust_account_withdrawal: BigDecimal,
}

const ROW_COLUMNS: &str = "chain_id, loan_id, is_loan_deployed, on_ramp_transferred, \
     off_ramp_transferred, trust_account_deposit, trust_account_withdrawal, \
     recorded_by, updated_at";

pub struct LoanCapitalTransfersRepo {
    pool: PgPool,
}

impl LoanCapitalTransfersRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Create-or-replace a loan's record with all five values (full upsert —
    /// decision 3 on #1027). Returns the stored row.
    pub async fn upsert(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
        values: &LoanCapitalTransfersValues,
        recorded_by: &str,
    ) -> Result<LoanCapitalTransfersRow, sqlx::Error> {
        sqlx::query_as::<_, LoanCapitalTransfersRow>(&format!(
            "INSERT INTO loan_capital_transfers \
                 (chain_id, loan_id, is_loan_deployed, on_ramp_transferred, \
                  off_ramp_transferred, trust_account_deposit, trust_account_withdrawal, \
                  recorded_by) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
             ON CONFLICT (chain_id, loan_id) DO UPDATE SET \
                 is_loan_deployed         = $3, \
                 on_ramp_transferred      = $4, \
                 off_ramp_transferred     = $5, \
                 trust_account_deposit    = $6, \
                 trust_account_withdrawal = $7, \
                 recorded_by              = $8, \
                 updated_at               = now() \
             RETURNING {ROW_COLUMNS}"
        ))
        .bind(chain_id)
        .bind(loan_id)
        .bind(values.is_loan_deployed)
        .bind(&values.on_ramp_transferred)
        .bind(&values.off_ramp_transferred)
        .bind(&values.trust_account_deposit)
        .bind(&values.trust_account_withdrawal)
        .bind(recorded_by)
        .fetch_one(&self.pool)
        .await
    }

    /// A single loan's record; `None` when nothing has been recorded yet (the API
    /// serves defaults in that case).
    pub async fn get(
        &self,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<Option<LoanCapitalTransfersRow>, sqlx::Error> {
        sqlx::query_as::<_, LoanCapitalTransfersRow>(&format!(
            "SELECT {ROW_COLUMNS} FROM loan_capital_transfers \
             WHERE chain_id = $1 AND loan_id = $2"
        ))
        .bind(chain_id)
        .bind(loan_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// All records for a chain. Row count is small (at most one per drawn loan);
    /// the capital-allocation handler passes these into its pure compute layer,
    /// which does the summing.
    pub async fn list_for_chain(
        &self,
        chain_id: i64,
    ) -> Result<Vec<LoanCapitalTransfersRow>, sqlx::Error> {
        sqlx::query_as::<_, LoanCapitalTransfersRow>(&format!(
            "SELECT {ROW_COLUMNS} FROM loan_capital_transfers WHERE chain_id = $1"
        ))
        .bind(chain_id)
        .fetch_all(&self.pool)
        .await
    }
}
