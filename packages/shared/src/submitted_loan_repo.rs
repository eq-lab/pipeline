//! Originator-submitted loan applications awaiting trustee review.
//!
//! Backs the loan-submission workflow (see `docs/product-specs/api-authorization-loan-submission.md`
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
    /// Sent back to the originator with feedback; non-final — may still be
    /// reviewed to Approved/Rejected. Always carries a `reason`.
    ChangesRequested,
}

impl SubmissionStatus {
    /// The exact string stored in the DB (and accepted in the API filter).
    pub fn as_str(&self) -> &'static str {
        match self {
            SubmissionStatus::InReview => "InReview",
            SubmissionStatus::Approved => "Approved",
            SubmissionStatus::Rejected => "Rejected",
            SubmissionStatus::ChangesRequested => "ChangesRequested",
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
            "ChangesRequested" => Ok(SubmissionStatus::ChangesRequested),
            other => Err(format!(
                "unknown submission status `{other}` (expected InReview, Approved, Rejected, or ChangesRequested)"
            )),
        }
    }
}

pub const INSERT_SUBMISSION_SQL: &str =
    "INSERT INTO submitted_loans (loan_data, originator, target_chain_id) \
     VALUES ($1, $2, $3) RETURNING id";

pub const LIST_SUBMISSIONS_SQL: &str =
    "SELECT id, loan_data, status, reason, originator, target_chain_id, \
     chain_id, loan_id, created_at, updated_at \
     FROM submitted_loans \
     WHERE ($1::text IS NULL OR status = $1) AND ($2::bigint IS NULL OR target_chain_id = $2) \
     ORDER BY created_at DESC, id DESC";

pub const FIND_SUBMISSION_SQL: &str =
    "SELECT id, loan_data, status, reason, originator, target_chain_id, \
     chain_id, loan_id, created_at, updated_at \
     FROM submitted_loans WHERE id = $1";

pub const RESUBMIT_SQL: &str = "UPDATE submitted_loans \
        SET loan_data = $2, status = 'InReview', reason = NULL, updated_at = now() \
      WHERE id = $1 AND status = 'ChangesRequested'";

pub const LINK_DRAWN_SQL: &str = "UPDATE submitted_loans \
        SET chain_id = $2, loan_id = $3, updated_at = now() \
      WHERE loan_data->>'metadata_uri' = $1 \
        AND loan_id IS NULL \
        AND target_chain_id = $2 \
        AND NOT EXISTS (SELECT 1 FROM submitted_loans o WHERE o.chain_id = $2 AND o.loan_id = $3) \
     RETURNING id";

pub const UNLINKED_DRAW_CANDIDATES_SQL: &str =
    "SELECT id, target_chain_id, chain_id, loan_id FROM submitted_loans \
      WHERE (chain_id = $2 AND loan_id = $3) \
         OR (loan_data->>'metadata_uri' = $1 AND loan_id IS NULL)";

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct LinkCandidate {
    pub id: i64,
    pub target_chain_id: i64,
    pub chain_id: Option<i64>,
    pub loan_id: Option<BigDecimal>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkOutcome {
    Linked {
        submission_id: i64,
    },
    NoSubmission,
    AlreadyLinked {
        submission_id: i64,
    },
    TargetMismatch {
        submission_id: i64,
        target_chain_id: i64,
    },
    Conflict {
        linked_submission_id: i64,
        candidate_submission_id: i64,
    },
}

impl LinkOutcome {
    pub fn is_unexpected(&self) -> bool {
        matches!(
            self,
            LinkOutcome::TargetMismatch { .. } | LinkOutcome::Conflict { .. }
        )
    }
}

pub fn classify_unlinked_draw(
    candidates: &[LinkCandidate],
    chain_id: i64,
    loan_id: &BigDecimal,
) -> LinkOutcome {
    let linked = candidates
        .iter()
        .find(|c| c.chain_id == Some(chain_id) && c.loan_id.as_ref() == Some(loan_id));
    let open = candidates.iter().find(|c| c.loan_id.is_none());
    match (linked, open) {
        (Some(l), Some(o)) if o.target_chain_id == chain_id => LinkOutcome::Conflict {
            linked_submission_id: l.id,
            candidate_submission_id: o.id,
        },
        (Some(l), _) => LinkOutcome::AlreadyLinked {
            submission_id: l.id,
        },
        (None, Some(o)) if o.target_chain_id == chain_id => LinkOutcome::Conflict {
            linked_submission_id: o.id,
            candidate_submission_id: o.id,
        },
        (None, Some(o)) => LinkOutcome::TargetMismatch {
            submission_id: o.id,
            target_chain_id: o.target_chain_id,
        },
        (None, None) => LinkOutcome::NoSubmission,
    }
}

/// One row of `submitted_loans`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SubmittedLoanRow {
    pub id: i64,
    /// The full submitted loan payload (all `draw_loan` inputs), stored verbatim.
    pub loan_data: Value,
    /// `InReview` | `Approved` | `Rejected` | `ChangesRequested`.
    pub status: String,
    /// Rejection/feedback reason; `Some` iff `status` is `Rejected` or
    /// `ChangesRequested`.
    pub reason: Option<String>,
    /// The authenticated submitter (JWT `sub`).
    pub originator: String,
    pub target_chain_id: i64,
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
        target_chain_id: i64,
    ) -> Result<i64, sqlx::Error> {
        let id: i64 = sqlx::query_scalar(INSERT_SUBMISSION_SQL)
            .bind(loan_data)
            .bind(originator)
            .bind(target_chain_id)
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
        target_chain_id: Option<i64>,
    ) -> Result<Vec<SubmittedLoanRow>, sqlx::Error> {
        sqlx::query_as::<_, SubmittedLoanRow>(LIST_SUBMISSIONS_SQL)
            .bind(status.map(|s| s.as_str()))
            .bind(target_chain_id)
            .fetch_all(&self.pool)
            .await
    }

    /// Fetch a single submission by `id` (any stage — pre- or post-drawn).
    pub async fn find(&self, id: i64) -> Result<Option<SubmittedLoanRow>, sqlx::Error> {
        sqlx::query_as::<_, SubmittedLoanRow>(FIND_SUBMISSION_SQL)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Apply a trustee decision to a submission still open for review. Only rows in
    /// `InReview` or `ChangesRequested` are updated — `Approved`/`Rejected` are
    /// terminal — so the returned bool lets the caller distinguish "already decided"
    /// (`false`) from a successful review (`true`). `reason` must be `Some` when
    /// `new_status` is `Rejected` or `ChangesRequested`, and `None` otherwise — the
    /// DB CHECK constraint enforces the same.
    pub async fn review(
        &self,
        id: i64,
        new_status: SubmissionStatus,
        reason: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(
            "UPDATE submitted_loans SET status = $2, reason = $3, updated_at = now() \
             WHERE id = $1 AND status IN ('InReview', 'ChangesRequested')",
        )
        .bind(id)
        .bind(new_status.as_str())
        .bind(reason)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }

    /// Replace an originator's `ChangesRequested` submission and reopen it for review.
    /// Overwrites `loan_data`, resets `status` to `InReview`, and clears `reason` — but
    /// only when the row is currently `ChangesRequested`, the sole state an originator
    /// may resubmit from. `InReview`/`Approved`/`Rejected` rows are left untouched, so
    /// the returned bool lets the caller return `409` for a non-resubmittable state
    /// (the same pattern as [`review`](Self::review)).
    ///
    /// Takes a caller-supplied connection so it shares the transaction that also rewrites
    /// the submission's `loan_collateral_valuations` / `loan_fee_schedule` rows — either
    /// the whole replacement lands or none of it does. May surface a unique violation
    /// (`23505`) on `submitted_loans_metadata_uri_unlinked_uk` if the new `metadata_uri`
    /// collides with another undrawn submission; the caller maps that to `409`.
    pub async fn resubmit(
        conn: &mut PgConnection,
        id: i64,
        loan_data: &Value,
    ) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(RESUBMIT_SQL)
            .bind(id)
            .bind(loan_data)
            .execute(conn)
            .await?
            .rows_affected();
        Ok(affected > 0)
    }

    /// Thin bridge: point an open submission at its freshly-drawn on-chain loan,
    /// matching the draw chain against `target_chain_id` and `metadata_uri` against the
    /// unlinked submission (`loan_id IS NULL`). Sets **only** the `chain_id` / `loan_id`
    /// pointer; on-chain state is never copied here (derive it from `contract_logs`).
    ///
    /// Takes a caller-supplied connection so it runs inside the indexer's transaction.
    /// Never links a `(chain_id, loan_id)` that is already linked. A non-link is
    /// reported through [`LinkOutcome`] and must not fail indexing.
    pub async fn link_drawn(
        conn: &mut PgConnection,
        metadata_uri: &str,
        chain_id: i64,
        loan_id: &BigDecimal,
    ) -> Result<LinkOutcome, sqlx::Error> {
        let linked: Option<i64> = sqlx::query_scalar(LINK_DRAWN_SQL)
            .bind(metadata_uri)
            .bind(chain_id)
            .bind(loan_id)
            .fetch_optional(&mut *conn)
            .await?;
        if let Some(submission_id) = linked {
            return Ok(LinkOutcome::Linked { submission_id });
        }
        let candidates = sqlx::query_as::<_, LinkCandidate>(UNLINKED_DRAW_CANDIDATES_SQL)
            .bind(metadata_uri)
            .bind(chain_id)
            .bind(loan_id)
            .fetch_all(&mut *conn)
            .await?;
        Ok(classify_unlinked_draw(&candidates, chain_id, loan_id))
    }
}
