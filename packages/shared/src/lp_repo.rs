//! LP (business entity) registry for the custom KYB service.
//!
//! Backs `routes::lps`. An `lps` row is created at registration — `kyb_status`
//! defaults to `NotStarted` — and identified internally by `id`, not by wallet,
//! until KYB passes and the LP links a Stellar account via `link_address`.
//! `lps.stellar_address` is a separate, deliberately unrelated identity space
//! from the wallet-keyed `lp_profiles`/`kyc_outbox` (individual KYC via
//! Sumsub) — see `packages/shared/migrations/20260915000001_kyb_lps_and_documents.sql`.
//!
//! `owner_account_id` (the registering caller's account — the authorization key,
//! UNIQUE, so one account owns at most one LP) is distinct from
//! `stellar_address` (the eventual settlement identity) — see the migration's
//! module comment. `owner_chain_id`/`owner_address` record the wallet a
//! wallet-registered LP came in on and are `NULL` for an email registration;
//! they are history, not authorization (TD-82).

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

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
    /// The statuses in which an LP's owner may still change the record.
    ///
    /// Single source of truth for the freeze: [`allows_owner_writes`] answers
    /// from it, and `upsert_by_owner_account_id` binds it as the update's
    /// predicate rather than repeating the list in SQL. A hardcoded `IN (…)`
    /// would silently diverge the moment this policy changed, and the freeze is
    /// exactly the rule that must not drift.
    ///
    /// [`allows_owner_writes`]: KybStatus::allows_owner_writes
    pub const OWNER_WRITABLE: [KybStatus; 3] = [
        KybStatus::NotStarted,
        KybStatus::InProgress,
        KybStatus::Failed,
    ];

    /// The stored spellings of [`OWNER_WRITABLE`](Self::OWNER_WRITABLE), for
    /// binding into a query.
    pub fn owner_writable_strs() -> Vec<&'static str> {
        Self::OWNER_WRITABLE.iter().map(KybStatus::as_str).collect()
    }

    /// Whether the LP's owner may still change the record — both its profile
    /// fields and its documents (Issue #1267).
    ///
    /// `UnderReview` and `Passed` are frozen. Otherwise an LP could swap files
    /// while a reviewer is mid-review, or alter the legal entity after it was
    /// approved, either of which detaches the decision from what was decided
    /// on. `Failed` stays open deliberately: `lps.owner_account_id` is UNIQUE,
    /// so an account whose LP is frozen at `Failed` could neither fix it nor
    /// register another — the record would be permanently dead.
    pub fn allows_owner_writes(&self) -> bool {
        Self::OWNER_WRITABLE.contains(self)
    }

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
    /// The account that registered this LP — the authorization key. See the
    /// module doc.
    pub owner_account_id: Uuid,
    /// The `auth_users` chain_id that registered this LP, when it registered by
    /// wallet. `None` for an email signup — history only, never authorization.
    pub owner_chain_id: Option<i64>,
    /// The `auth_users` address that registered this LP, when it registered by
    /// wallet. `None` for an email signup — history only, never authorization.
    pub owner_address: Option<String>,
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

    fn writable_statuses() -> Vec<String> {
        KybStatus::owner_writable_strs()
            .into_iter()
            .map(str::to_owned)
            .collect()
    }

    /// Create or update the LP owned by `owner_account_id` (Issue #1267).
    ///
    /// The account is the key: `lps_owner_account_unique` already guarantees one
    /// LP per account, so `ON CONFLICT` turns what was a `409` into the update
    /// path and `POST /v1/lps/me` serves both registration and correction. The
    /// profile is a **full replace** — `country` is set to whatever is passed,
    /// `NULL` included — so a caller resubmitting the form can never leave a
    /// stale field behind.
    ///
    /// `owner_chain_id`/`owner_address` are written on insert only: they record
    /// the wallet a registration arrived on and are `None` for an email signup.
    /// They are history, not authorization (TD-82), so a later edit must not
    /// rewrite them.
    ///
    /// The `WHERE` on the update path is the freeze ([`KybStatus::allows_owner_writes`])
    /// expressed in SQL rather than trusted from a prior read. The handler
    /// reads the LP, then drains a multipart body that may be a hundred
    /// megabytes, and only then writes — a trustee moving the record to
    /// `UnderReview` inside that window would otherwise have it changed
    /// underneath them, which is exactly what the freeze exists to prevent.
    /// `None` means the row existed but was frozen. `KybDocumentRepo`'s
    /// `insert` and `delete` carry the same predicate, so every owner write —
    /// profile, upload, removal — is gated in SQL rather than on a prior read.
    ///
    /// Returns the LP's `id` and whether this call created it.
    pub async fn upsert_by_owner_account_id(
        &self,
        legal_name: &str,
        country: Option<&str>,
        contact_email: &str,
        owner_account_id: Uuid,
        owner_chain_id: Option<i64>,
        owner_address: Option<&str>,
    ) -> Result<Option<(i64, bool)>, sqlx::Error> {
        sqlx::query_as::<_, (i64, bool)>(
            "INSERT INTO lps (legal_name, country, contact_email, owner_account_id, \
             owner_chain_id, owner_address) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             ON CONFLICT (owner_account_id) DO UPDATE SET \
             legal_name = EXCLUDED.legal_name, country = EXCLUDED.country, \
             contact_email = EXCLUDED.contact_email, updated_at = now() \
             WHERE lps.kyb_status = ANY($7) \
             RETURNING id, (xmax = 0) AS created",
        )
        .bind(legal_name)
        .bind(country)
        .bind(contact_email)
        .bind(owner_account_id)
        .bind(owner_chain_id)
        .bind(owner_address)
        .bind(Self::writable_statuses())
        .fetch_optional(&self.pool)
        .await
    }

    /// The LP owned by `owner_account_id`, if the account has registered one.
    ///
    /// The only lookup the owner-facing `/v1/lps/me` routes need: the JWT
    /// identifies exactly one LP, so no id ever crosses the wire. `None` is how
    /// a freshly verified account is distinguished from one mid-KYB.
    pub async fn find_by_owner_account_id(
        &self,
        owner_account_id: Uuid,
    ) -> Result<Option<LpRow>, sqlx::Error> {
        sqlx::query_as::<_, LpRow>(
            "SELECT id, legal_name, country, contact_email, stellar_address, \
             address_linked_at, kyb_status, owner_account_id, owner_chain_id, owner_address, \
             created_at, updated_at \
             FROM lps WHERE owner_account_id = $1",
        )
        .bind(owner_account_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// List all LPs, newest first.
    pub async fn list(&self) -> Result<Vec<LpRow>, sqlx::Error> {
        sqlx::query_as::<_, LpRow>(
            "SELECT id, legal_name, country, contact_email, stellar_address, \
             address_linked_at, kyb_status, owner_account_id, owner_chain_id, owner_address, \
             created_at, updated_at \
             FROM lps ORDER BY created_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await
    }

    /// Fetch a single LP by `id`.
    pub async fn find(&self, id: i64) -> Result<Option<LpRow>, sqlx::Error> {
        sqlx::query_as::<_, LpRow>(
            "SELECT id, legal_name, country, contact_email, stellar_address, \
             address_linked_at, kyb_status, owner_account_id, owner_chain_id, owner_address, \
             created_at, updated_at \
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
