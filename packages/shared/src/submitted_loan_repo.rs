//! Originator-submitted loan applications awaiting trustee review.
//!
//! Backs the loan-submission workflow (see `docs/product-specs/api-authorization.md`
//! and `routes::loan_book`). An originator submits the full set of `draw_loan`
//! inputs, stored verbatim as JSONB in `loan_data`; a trustee then approves or
//! rejects each submission. The surrogate `id` is the submission identifier — the
//! on-chain `loan_id` does not exist until the loan is actually drawn.

use std::fmt;
use std::str::FromStr;

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

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
    /// Chain the linked loan was drawn on; `None` until drawn (pre-drawn).
    pub chain_id: Option<i64>,
    /// On-chain loan id once the loan is drawn and linked (by `metadata_uri`);
    /// `None` while the submission is pre-drawn. Read-only pointer — on-chain *state*
    /// (status/CCR/repayment) is not copied here; derive it from `contract_logs`.
    pub loan_id: Option<BigDecimal>,
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
    ///
    /// Takes a caller-supplied connection (rather than `&self.pool`) so the submission
    /// endpoint can run this in the same transaction as its `loan_collateral_valuations` /
    /// `loan_fee_schedule` inserts — either all three land or none do.
    pub async fn insert(
        conn: &mut PgConnection,
        loan_data: &Value,
        originator: &str,
    ) -> Result<i64, sqlx::Error> {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO submitted_loans (loan_data, originator) VALUES ($1, $2) RETURNING id",
        )
        .bind(loan_data)
        .bind(originator)
        .fetch_one(conn)
        .await?;
        Ok(id)
    }

    /// List submissions, newest first — both pre-drawn (review queue) and drawn
    /// (linked to an on-chain loan). The stored `status` is the frozen *review*
    /// outcome; the API derives a drawn submission's live on-chain status at read time
    /// from `contract_logs` (weak bridge — on-chain state is never copied onto the
    /// submission row). `Some(status)` filters by the stored review state.
    pub async fn list(
        &self,
        status: Option<SubmissionStatus>,
    ) -> Result<Vec<SubmittedLoanRow>, sqlx::Error> {
        match status {
            Some(s) => {
                sqlx::query_as::<_, SubmittedLoanRow>(
                    "SELECT id, loan_data, status, reason, originator, chain_id, loan_id, \
                     created_at, updated_at \
                     FROM submitted_loans WHERE status = $1 \
                     ORDER BY created_at DESC, id DESC",
                )
                .bind(s.as_str())
                .fetch_all(&self.pool)
                .await
            }
            None => {
                sqlx::query_as::<_, SubmittedLoanRow>(
                    "SELECT id, loan_data, status, reason, originator, chain_id, loan_id, \
                     created_at, updated_at \
                     FROM submitted_loans \
                     ORDER BY created_at DESC, id DESC",
                )
                .fetch_all(&self.pool)
                .await
            }
        }
    }

    /// Fetch a single submission by `id` (any stage — pre- or post-drawn).
    pub async fn find(&self, id: i64) -> Result<Option<SubmittedLoanRow>, sqlx::Error> {
        sqlx::query_as::<_, SubmittedLoanRow>(
            "SELECT id, loan_data, status, reason, originator, chain_id, loan_id, \
             created_at, updated_at \
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

    /// Thin bridge: point an open submission at its freshly-drawn on-chain loan,
    /// matching by `metadata_uri` against the unlinked submission (`loan_id IS NULL`).
    /// Sets **only** the `chain_id` / `loan_id` pointer — the submission's review
    /// `status` is left frozen at its last pre-chain value, and on-chain state is NOT
    /// copied here (Approach A: derive it from `contract_logs` at read time).
    ///
    /// Takes a caller-supplied connection so it runs inside the indexer's transaction.
    /// Returns whether a submission was linked — `false` (no match) is normal (a loan
    /// may be drawn with no prior submission), so callers must not fail indexing on it.
    /// The partial unique index on `(loan_data->>'metadata_uri') WHERE loan_id IS NULL`
    /// guarantees at most one row matches.
    pub async fn link_drawn(
        conn: &mut PgConnection,
        metadata_uri: &str,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(
            "UPDATE submitted_loans \
                SET chain_id = $2, loan_id = $3, updated_at = now() \
              WHERE loan_data->>'metadata_uri' = $1 AND loan_id IS NULL",
        )
        .bind(metadata_uri)
        .bind(chain_id)
        .bind(loan_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }
}
