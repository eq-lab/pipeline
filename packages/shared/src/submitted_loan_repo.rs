//! Originator-submitted loan applications awaiting trustee review.
//!
//! Backs the loan-submission workflow (see `docs/product-specs/api-authorization.md`
//! and `routes::loan_book`). An originator submits the full set of `draw_loan`
//! inputs, stored verbatim as JSONB in `loan_data`; a trustee then approves or
//! rejects each submission. The surrogate `id` is the submission identifier — the
//! on-chain `loan_id` does not exist until the loan is actually drawn.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;

/// Lifecycle state of a submission. Stored as TEXT (with a CHECK constraint) in
/// `submitted_loans.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmissionStatus {
    /// Newly submitted, awaiting a trustee decision.
    InReview,
    /// Approved by a trustee.
    Approved,
    /// Rejected by a trustee (always carries a `reason`).
    Rejected,
}

impl SubmissionStatus {
    /// The exact string stored in the DB (and accepted in the API filter).
    pub fn as_str(&self) -> &'static str {
        match self {
            SubmissionStatus::InReview => "InReview",
            SubmissionStatus::Approved => "Approved",
            SubmissionStatus::Rejected => "Rejected",
        }
    }
}

impl fmt::Display for SubmissionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for SubmissionStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "InReview" => Ok(SubmissionStatus::InReview),
            "Approved" => Ok(SubmissionStatus::Approved),
            "Rejected" => Ok(SubmissionStatus::Rejected),
            other => Err(format!(
                "unknown submission status `{other}` (expected InReview, Approved, or Rejected)"
            )),
        }
    }
}

/// One row of `submitted_loans`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SubmittedLoanRow {
    pub id: i64,
    /// The full submitted loan payload (all `draw_loan` inputs), stored verbatim.
    pub loan_data: Value,
    /// `InReview` | `Approved` | `Rejected`.
    pub status: String,
    /// Rejection reason; `Some` iff `status = Rejected`.
    pub reason: Option<String>,
    /// The authenticated submitter (JWT `sub`).
    pub originator: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct SubmittedLoanRepo {
    pub pool: PgPool,
}

impl SubmittedLoanRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a new submission as `InReview`. Returns the new submission `id`.
    pub async fn insert(&self, loan_data: &Value, originator: &str) -> Result<i64, sqlx::Error> {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO submitted_loans (loan_data, originator) VALUES ($1, $2) RETURNING id",
        )
        .bind(loan_data)
        .bind(originator)
        .fetch_one(&self.pool)
        .await?;
        Ok(id)
    }

    /// List submissions, newest first. `None` returns all; `Some(status)` filters
    /// by lifecycle state.
    pub async fn list(
        &self,
        status: Option<SubmissionStatus>,
    ) -> Result<Vec<SubmittedLoanRow>, sqlx::Error> {
        match status {
            Some(s) => {
                sqlx::query_as::<_, SubmittedLoanRow>(
                    "SELECT id, loan_data, status, reason, originator, created_at, updated_at \
                     FROM submitted_loans WHERE status = $1 ORDER BY created_at DESC, id DESC",
                )
                .bind(s.as_str())
                .fetch_all(&self.pool)
                .await
            }
            None => {
                sqlx::query_as::<_, SubmittedLoanRow>(
                    "SELECT id, loan_data, status, reason, originator, created_at, updated_at \
                     FROM submitted_loans ORDER BY created_at DESC, id DESC",
                )
                .fetch_all(&self.pool)
                .await
            }
        }
    }

    /// Fetch a single submission by `id`.
    pub async fn find(&self, id: i64) -> Result<Option<SubmittedLoanRow>, sqlx::Error> {
        sqlx::query_as::<_, SubmittedLoanRow>(
            "SELECT id, loan_data, status, reason, originator, created_at, updated_at \
             FROM submitted_loans WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Apply a trustee decision to an `InReview` submission. Only rows still in
    /// `InReview` are updated (decisions are final), so the returned bool lets the
    /// caller distinguish "already decided" (`false`) from a successful review
    /// (`true`). `reason` must be `Some` when `new_status` is `Rejected` and `None`
    /// otherwise — the DB CHECK constraint enforces the same.
    pub async fn review(
        &self,
        id: i64,
        new_status: SubmissionStatus,
        reason: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(
            "UPDATE submitted_loans SET status = $2, reason = $3, updated_at = now() \
             WHERE id = $1 AND status = 'InReview'",
        )
        .bind(id)
        .bind(new_status.as_str())
        .bind(reason)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }
}
