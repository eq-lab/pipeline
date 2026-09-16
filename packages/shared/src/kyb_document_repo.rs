//! Versioned KYB supporting documents (`kyb_documents`).
//!
//! Backs `routes::lps`. Each row is one submission of one required document for
//! an LP; a resubmission after rejection supersedes the prior row rather than
//! overwriting it (`is_current` flips to `false`) so review history stays
//! queryable. `idx_kyb_documents_current` (a partial unique index) enforces
//! exactly one current row per `(lp_id, doc_type, subject)` — see
//! `packages/shared/migrations/20260915000001_kyb_lps_and_documents.sql`.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

/// Which KYB document a `kyb_documents` row represents. Stored as TEXT (with a
/// CHECK constraint) in `kyb_documents.doc_type`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocType {
    CertificateOfIncorporation,
    RegistryRecord,
    GoodStanding,
    LegalAddress,
    ShareholderRegister,
    UboId,
    UboProofOfAddress,
}

impl DocType {
    /// The exact string stored in the DB.
    pub fn as_str(&self) -> &'static str {
        match self {
            DocType::CertificateOfIncorporation => "CertificateOfIncorporation",
            DocType::RegistryRecord => "RegistryRecord",
            DocType::GoodStanding => "GoodStanding",
            DocType::LegalAddress => "LegalAddress",
            DocType::ShareholderRegister => "ShareholderRegister",
            DocType::UboId => "UboId",
            DocType::UboProofOfAddress => "UboProofOfAddress",
        }
    }
}

impl fmt::Display for DocType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for DocType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "CertificateOfIncorporation" => Ok(DocType::CertificateOfIncorporation),
            "RegistryRecord" => Ok(DocType::RegistryRecord),
            "GoodStanding" => Ok(DocType::GoodStanding),
            "LegalAddress" => Ok(DocType::LegalAddress),
            "ShareholderRegister" => Ok(DocType::ShareholderRegister),
            "UboId" => Ok(DocType::UboId),
            "UboProofOfAddress" => Ok(DocType::UboProofOfAddress),
            other => Err(format!(
                "unknown doc_type `{other}` (expected CertificateOfIncorporation, RegistryRecord, \
                 GoodStanding, LegalAddress, ShareholderRegister, UboId, or UboProofOfAddress)"
            )),
        }
    }
}

/// Review state of a `kyb_documents` row. Stored as TEXT (with a CHECK
/// constraint) in `kyb_documents.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentStatus {
    /// No row exists for a required doc_type — never itself stored; derived by
    /// absence.
    NotProvided,
    /// Uploaded, awaiting staff review.
    Provided,
    /// Approved by staff.
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
    /// One of [`DocType`]'s variants.
    pub doc_type: String,
    /// Which shareholder/UBO, for the personal document types. `None` for
    /// entity-level documents.
    pub subject: Option<String>,
    pub file_ref: String,
    /// `NotProvided` | `Provided` | `Verified` | `Rejected`.
    pub status: String,
    pub reject_reason: Option<String>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    /// Whether this is the current (latest) submission for its
    /// `(lp_id, doc_type, subject)` — see the module doc.
    pub is_current: bool,
}

pub struct KybDocumentRepo {
    pub pool: PgPool,
}

impl KybDocumentRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Upload a document, superseding the current submission (if any) for the
    /// same `(lp_id, doc_type, subject)`. Runs on the caller's transaction so
    /// the supersede-then-insert is atomic — `idx_kyb_documents_current` would
    /// otherwise reject the new row while the old one is still current. Uses
    /// `IS NOT DISTINCT FROM` to match `subject = NULL` rows (regular `=`
    /// never matches NULL). Returns the new row's `id`.
    pub async fn upload(
        conn: &mut PgConnection,
        lp_id: i64,
        doc_type: DocType,
        subject: Option<&str>,
        file_ref: &str,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query(
            "UPDATE kyb_documents SET is_current = FALSE \
             WHERE lp_id = $1 AND doc_type = $2 AND subject IS NOT DISTINCT FROM $3 AND is_current",
        )
        .bind(lp_id)
        .bind(doc_type.as_str())
        .bind(subject)
        .execute(&mut *conn)
        .await?;

        sqlx::query_scalar(
            "INSERT INTO kyb_documents (lp_id, doc_type, subject, file_ref) \
             VALUES ($1, $2, $3, $4) RETURNING id",
        )
        .bind(lp_id)
        .bind(doc_type.as_str())
        .bind(subject)
        .bind(file_ref)
        .fetch_one(&mut *conn)
        .await
    }

    /// List an LP's documents, current submissions only, newest first.
    pub async fn list_current_for_lp(
        &self,
        lp_id: i64,
    ) -> Result<Vec<KybDocumentRow>, sqlx::Error> {
        sqlx::query_as::<_, KybDocumentRow>(
            "SELECT id, lp_id, doc_type, subject, file_ref, status, reject_reason, \
             reviewed_by, reviewed_at, expires_at, created_at, is_current \
             FROM kyb_documents WHERE lp_id = $1 AND is_current \
             ORDER BY created_at DESC, id DESC",
        )
        .bind(lp_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Fetch a single document by `id`, any version (current or superseded).
    pub async fn find(&self, id: i64) -> Result<Option<KybDocumentRow>, sqlx::Error> {
        sqlx::query_as::<_, KybDocumentRow>(
            "SELECT id, lp_id, doc_type, subject, file_ref, status, reject_reason, \
             reviewed_by, reviewed_at, expires_at, created_at, is_current \
             FROM kyb_documents WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Apply a staff decision (`Verified` or `Rejected`) to a document still
    /// awaiting review. Only the current row, in `Provided`, is updated —
    /// terminal states and superseded rows are left untouched, so the returned
    /// bool lets the caller 409 on "not eligible for review", the same pattern
    /// as `SubmittedLoanRepo::review`.
    pub async fn review(
        &self,
        id: i64,
        new_status: DocumentStatus,
        reject_reason: Option<&str>,
        reviewed_by: &str,
    ) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(
            "UPDATE kyb_documents SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now() \
             WHERE id = $1 AND status = 'Provided' AND is_current",
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
