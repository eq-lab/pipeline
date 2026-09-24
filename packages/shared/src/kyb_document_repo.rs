//! KYB supporting documents (`kyb_documents`).
//!
//! Backs `routes::lps`. Each row is one file an LP uploaded, stored in the
//! Spaces bucket at `file_ref` (see `object_store`). Documents are **untyped**:
//! there is no `doc_type` and no per-person `subject`, so there are no slots,
//! no versioning, and no supersede — replacing a document is
//! [`delete`](KybDocumentRepo::delete) followed by a fresh
//! [`insert`](KybDocumentRepo::insert). See
//! `packages/shared/migrations/20260924000001_kyb_documents_untyped_and_storage.sql`.
//!
//! `original_filename` is what tells a reviewer what a file is, now that no
//! type does.

use std::fmt;

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

/// Review state of a `kyb_documents` row. Stored as TEXT (with a CHECK
/// constraint) in `kyb_documents.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentStatus {
    /// Legacy member of the CHECK constraint; no row is ever written with it.
    NotProvided,
    /// Uploaded, awaiting staff review.
    Provided,
    /// Approved by staff. Frozen — the owner may not delete it.
    Verified,
    /// Rejected by staff (always carries `reject_reason`).
    Rejected,
}

impl DocumentStatus {
    /// The exact string stored in the DB.
    pub fn as_str(&self) -> &'static str {
        match self {
            DocumentStatus::NotProvided => "NotProvided",
            DocumentStatus::Provided => "Provided",
            DocumentStatus::Verified => "Verified",
            DocumentStatus::Rejected => "Rejected",
        }
    }
}

impl fmt::Display for DocumentStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One row of `kyb_documents`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct KybDocumentRow {
    pub id: i64,
    pub lp_id: i64,
    /// The object key in the Spaces bucket (`lps/<lp_id>/<uuid>.<ext>`).
    pub file_ref: String,
    /// The name the file was uploaded under — the only label a reviewer has.
    pub original_filename: String,
    pub size_bytes: i64,
    pub content_type: String,
    /// `NotProvided` | `Provided` | `Verified` | `Rejected`.
    pub status: String,
    pub reject_reason: Option<String>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl KybDocumentRow {
    /// Whether staff have approved this document. A verified document is frozen
    /// — `routes::lps` refuses to delete one, so a passed KYB always refers to
    /// the bytes that earned it.
    pub fn is_verified(&self) -> bool {
        self.status == DocumentStatus::Verified.as_str()
    }
}

const COLUMNS: &str = "id, lp_id, file_ref, original_filename, size_bytes, content_type, \
                       status, reject_reason, reviewed_by, reviewed_at, expires_at, created_at";

pub struct KybDocumentRepo {
    pub pool: PgPool,
}

impl KybDocumentRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Record an uploaded document. Runs on the caller's connection so a batch
    /// upload can insert each file as its own unit — one bad file in a batch
    /// must not roll back the ones already stored in Spaces.
    pub async fn insert(
        conn: &mut PgConnection,
        lp_id: i64,
        file_ref: &str,
        original_filename: &str,
        size_bytes: i64,
        content_type: &str,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar(
            "INSERT INTO kyb_documents \
             (lp_id, file_ref, original_filename, size_bytes, content_type) \
             VALUES ($1, $2, $3, $4, $5) RETURNING id",
        )
        .bind(lp_id)
        .bind(file_ref)
        .bind(original_filename)
        .bind(size_bytes)
        .bind(content_type)
        .fetch_one(&mut *conn)
        .await
    }

    /// An LP's documents, newest first.
    pub async fn list_for_lp(&self, lp_id: i64) -> Result<Vec<KybDocumentRow>, sqlx::Error> {
        sqlx::query_as::<_, KybDocumentRow>(&format!(
            "SELECT {COLUMNS} FROM kyb_documents WHERE lp_id = $1 \
             ORDER BY created_at DESC, id DESC"
        ))
        .bind(lp_id)
        .fetch_all(&self.pool)
        .await
    }

    /// How many documents an LP holds. Bounds the per-LP cap; because
    /// [`delete`](Self::delete) removes rows outright, this counts only live
    /// documents (see the accepted tradeoff in Issue #1267).
    pub async fn count_for_lp(&self, lp_id: i64) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar("SELECT COUNT(*) FROM kyb_documents WHERE lp_id = $1")
            .bind(lp_id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn find(&self, id: i64) -> Result<Option<KybDocumentRow>, sqlx::Error> {
        sqlx::query_as::<_, KybDocumentRow>(&format!(
            "SELECT {COLUMNS} FROM kyb_documents WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Remove a document that is not `Verified`. The status is part of the
    /// `WHERE` rather than a prior read so a concurrent review cannot slip
    /// between the check and the delete; the returned bool lets the caller
    /// distinguish "already gone" from "verified, refused".
    pub async fn delete(&self, id: i64) -> Result<bool, sqlx::Error> {
        let affected =
            sqlx::query("DELETE FROM kyb_documents WHERE id = $1 AND status <> 'Verified'")
                .bind(id)
                .execute(&self.pool)
                .await?
                .rows_affected();
        Ok(affected > 0)
    }

    /// Apply a staff decision (`Verified` or `Rejected`) to a document still
    /// awaiting review. Only a row in `Provided` is updated — terminal states
    /// are left untouched, so the returned bool lets the caller 409 on "not
    /// eligible for review", the same pattern as `SubmittedLoanRepo::review`.
    pub async fn review(
        &self,
        id: i64,
        new_status: DocumentStatus,
        reject_reason: Option<&str>,
        reviewed_by: &str,
    ) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(
            "UPDATE kyb_documents SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now() \
             WHERE id = $1 AND status = 'Provided'",
        )
        .bind(id)
        .bind(new_status.as_str())
        .bind(reject_reason)
        .bind(reviewed_by)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }
}
