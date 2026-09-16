//! LP (business entity) registry for the custom KYB service.
//!
//! Backs `routes::lps`. An `lps` row is created at registration — `kyb_status`
//! defaults to `NotStarted` — and identified internally by `id`, not by wallet,
//! until KYB passes and the LP links a Stellar account via `link_address`.
//! `lps.stellar_address` is a separate, deliberately unrelated identity space
//! from the wallet-keyed `lp_profiles`/`kyc_outbox` (individual KYC via
//! Sumsub) — see `packages/shared/migrations/20260915000001_kyb_lps_and_documents.sql`.
//!
//! `owner_chain_id`/`owner_address` (the registering caller's JWT identity, an
//! `auth_users` entry) are distinct from `stellar_address` (the eventual
//! settlement identity) — see the migration's module comment.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use sqlx::PgPool;

/// KYB lifecycle state of an LP. Stored as TEXT (with a CHECK constraint) in
/// `lps.kyb_status`. `stellar_address` may only be set once this reaches `Passed`
/// (enforced by the `lps_stellar_address_passed_ck` DB constraint).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KybStatus {
    NotStarted,
    InProgress,
    UnderReview,
    Passed,
    Failed,
}

impl KybStatus {
    /// The exact string stored in the DB.
    pub fn as_str(&self) -> &'static str {
        match self {
            KybStatus::NotStarted => "NotStarted",
            KybStatus::InProgress => "InProgress",
            KybStatus::UnderReview => "UnderReview",
            KybStatus::Passed => "Passed",
            KybStatus::Failed => "Failed",
        }
    }
}

impl fmt::Display for KybStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for KybStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "NotStarted" => Ok(KybStatus::NotStarted),
            "InProgress" => Ok(KybStatus::InProgress),
            "UnderReview" => Ok(KybStatus::UnderReview),
            "Passed" => Ok(KybStatus::Passed),
            "Failed" => Ok(KybStatus::Failed),
            other => Err(format!(
                "unknown kyb status `{other}` (expected NotStarted, InProgress, UnderReview, Passed, or Failed)"
            )),
        }
    }
}

/// One row of `lps`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LpRow {
    pub id: i64,
    pub legal_name: String,
    pub country: Option<String>,
    pub contact_email: String,
    /// Set only once `kyb_status` is `Passed` (see [`KybStatus`]).
    pub stellar_address: Option<String>,
    pub address_linked_at: Option<DateTime<Utc>>,
    /// `NotStarted` | `InProgress` | `UnderReview` | `Passed` | `Failed`.
    pub kyb_status: String,
    /// The `auth_users` chain_id that registered this LP — see the module doc.
    pub owner_chain_id: i64,
    /// The `auth_users` address that registered this LP — see the module doc.
    pub owner_address: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct LpRepo {
    pub pool: PgPool,
}

impl LpRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Register a new LP, owned by `(owner_chain_id, owner_address)` — the
    /// registering caller's JWT identity, which must already be on the
    /// `auth_users` allow-list (enforced by `lps_owner_fk`). `kyb_status` starts
    /// at `NotStarted` (the column default). Returns the new LP's `id`.
    pub async fn insert(
        &self,
        legal_name: &str,
        country: Option<&str>,
        contact_email: &str,
        owner_chain_id: i64,
        owner_address: &str,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar(
            "INSERT INTO lps (legal_name, country, contact_email, owner_chain_id, owner_address) \
             VALUES ($1, $2, $3, $4, $5) RETURNING id",
        )
        .bind(legal_name)
        .bind(country)
        .bind(contact_email)
        .bind(owner_chain_id)
        .bind(owner_address)
        .fetch_one(&self.pool)
        .await
    }

    /// List all LPs, newest first.
    pub async fn list(&self) -> Result<Vec<LpRow>, sqlx::Error> {
        sqlx::query_as::<_, LpRow>(
            "SELECT id, legal_name, country, contact_email, stellar_address, \
             address_linked_at, kyb_status, owner_chain_id, owner_address, created_at, updated_at \
             FROM lps ORDER BY created_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await
    }

    /// Fetch a single LP by `id`.
    pub async fn find(&self, id: i64) -> Result<Option<LpRow>, sqlx::Error> {
        sqlx::query_as::<_, LpRow>(
            "SELECT id, legal_name, country, contact_email, stellar_address, \
             address_linked_at, kyb_status, owner_chain_id, owner_address, created_at, updated_at \
             FROM lps WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Link a Stellar address to an LP whose KYB has passed. Only rows with
    /// `kyb_status = 'Passed'` and no address linked yet are updated — the
    /// returned bool lets the caller distinguish "not eligible" (KYB not
    /// passed, or already linked) from success, the same pattern as
    /// `SubmittedLoanRepo::review`. A unique violation on `stellar_address`
    /// (another LP already linked this address) surfaces as a DB error for the
    /// caller to map to `409`.
    pub async fn link_address(&self, id: i64, stellar_address: &str) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(
            "UPDATE lps SET stellar_address = $2, address_linked_at = now(), updated_at = now() \
             WHERE id = $1 AND kyb_status = 'Passed' AND stellar_address IS NULL",
        )
        .bind(id)
        .bind(stellar_address)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }
}
