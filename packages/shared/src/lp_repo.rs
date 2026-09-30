//! LP (business entity) registry for the custom KYB service.
//!
//! Backs `routes::lps`. An `lps` row is created at registration — `kyb_status`
//! defaults to `NotStarted` — and identified internally by `id`, not by wallet.
//! The LP links a Stellar account via `link_address`, which is not gated on
//! reaching `Passed` (see [`KybStatus::allows_address_write`]).
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
//!
//! `kyb_status` moves only through [`submit_for_review`](LpRepo::submit_for_review)
//! and [`decide_kyb`](LpRepo::decide_kyb) (Issue #1274); `Failed` is terminal
//! and freezes the record permanently, which is why the account it belongs to
//! is suspended in the same transaction — `lps.owner_account_id` is UNIQUE, so
//! that account can never register a second LP.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// KYB lifecycle state of an LP. Stored as TEXT (with a CHECK constraint) in
/// `lps.kyb_status`. [`may_transition_to`](Self::may_transition_to) is the
/// transition table (spec § KYB Review Lifecycle, Issue #1274); whether the
/// owner may write the record is [`allows_owner_writes`](Self::allows_owner_writes),
/// whether a document may be reviewed is
/// [`allows_document_review`](Self::allows_document_review), and whether
/// `stellar_address` may be written is
/// [`allows_address_write`](Self::allows_address_write) — there is no longer a
/// DB constraint backing that last one (Issue #1379).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KybStatus {
    NotStarted,
    InProgress,
    UnderReview,
    ChangesRequested,
    Passed,
    Failed,
}

impl KybStatus {
    /// Every variant, for tests that must be total over the enum without
    /// re-listing it.
    pub const ALL: [KybStatus; 6] = [
        KybStatus::NotStarted,
        KybStatus::InProgress,
        KybStatus::UnderReview,
        KybStatus::ChangesRequested,
        KybStatus::Passed,
        KybStatus::Failed,
    ];

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
        KybStatus::ChangesRequested,
    ];

    /// The stored spellings of [`OWNER_WRITABLE`](Self::OWNER_WRITABLE), for
    /// binding into a query.
    pub fn owner_writable_strs() -> Vec<&'static str> {
        Self::OWNER_WRITABLE.iter().map(KybStatus::as_str).collect()
    }

    /// The statuses from which an LP owner may submit for review — distinct
    /// from [`OWNER_WRITABLE`](Self::OWNER_WRITABLE): `InProgress` is writable
    /// but unreachable, so nothing ever submits from it (spec § KYB Review
    /// Lifecycle). Kept consistent with
    /// [`may_transition_to`](Self::may_transition_to)`(UnderReview)` by a test
    /// rather than derived from it, so an edit to either is caught.
    pub const SUBMITTABLE: [KybStatus; 2] = [KybStatus::NotStarted, KybStatus::ChangesRequested];

    /// The stored spellings of [`SUBMITTABLE`](Self::SUBMITTABLE), for binding
    /// into `submit_for_review`'s query. Not `owner_writable_strs()` — the two
    /// sets differ by `InProgress`, so reusing it here would let an
    /// unsubmittable status through.
    pub fn submittable_strs() -> Vec<&'static str> {
        Self::SUBMITTABLE.iter().map(KybStatus::as_str).collect()
    }

    /// Whether the LP's owner may still change the record — both its profile
    /// fields and its documents (Issue #1267).
    ///
    /// `UnderReview`, `Passed` and `Failed` are frozen; `ChangesRequested` is
    /// the only status that reopens a record, when a trustee returns it for
    /// correction. `Failed` is terminal rather than reopening as it once was:
    /// the decision suspends the owning account alongside the LP (Issue
    /// #1274), so the UNIQUE-`owner_account_id` argument for keeping it
    /// writable no longer applies — that account cannot register a second LP
    /// either way.
    pub fn allows_owner_writes(&self) -> bool {
        Self::OWNER_WRITABLE.contains(self)
    }

    /// Whether `self` may move to `to` (spec § KYB Review Lifecycle).
    ///
    /// `NotStarted` and `ChangesRequested` reach `UnderReview` by owner submit;
    /// `UnderReview` reaches `Passed`, `ChangesRequested` or `Failed` by
    /// trustee decision. Every other pair, including every self-transition and
    /// `InProgress -> UnderReview`, is refused: `InProgress` is a legal stored
    /// value that nothing produces and nothing consumes, so it is writable
    /// ([`allows_owner_writes`](Self::allows_owner_writes)) without being
    /// submittable.
    pub fn may_transition_to(self, to: KybStatus) -> bool {
        matches!(
            (self, to),
            (
                KybStatus::NotStarted | KybStatus::ChangesRequested,
                KybStatus::UnderReview
            ) | (
                KybStatus::UnderReview,
                KybStatus::Passed | KybStatus::ChangesRequested | KybStatus::Failed
            )
        )
    }

    /// Whether an individual document of this LP may be reviewed now (spec §
    /// KYB Review Lifecycle).
    ///
    /// Only while `UnderReview`: submitting is what declares the set ready to
    /// be judged, and a `Verified` document can never be deleted, so verifying
    /// one earlier would permanently pin a file into a record its owner is
    /// still assembling, closing the only correction path there is
    /// (delete-then-upload). Stated as `matches!` over `UnderReview` alone
    /// rather than as an exclusion list, so a new status is refused by
    /// default rather than silently admitted.
    pub fn allows_document_review(&self) -> bool {
        matches!(self, KybStatus::UnderReview)
    }

    /// Whether the settlement address may be written now — `has_address` is
    /// whether one is already linked (spec § Settlement Address).
    ///
    /// It may be set at any status short of a terminal verdict, and replaced
    /// freely until the decision is final. `Passed` fixes the address already
    /// held — downstream systems treat it from then on as the account money
    /// moves to — but an LP that passed before naming one may still name it
    /// once. `Failed` refuses outright: the column is UNIQUE across LPs, so a
    /// refused applicant left writable could burn real LPs' addresses, and a
    /// refused LP will never settle, so even a first write buys nothing. That
    /// does not lean on the suspension `Failed` also sets (#1380), which is
    /// enforced nowhere yet. Mirrored by the
    /// `kyb_status <> 'Failed' AND (stellar_address IS NULL OR kyb_status <> 'Passed')`
    /// predicate in [`LpRepo::link_address`], which is what actually enforces
    /// it — this is where the rule is *stated*, and the SQL must keep
    /// restating it faithfully. Deliberately not folded into
    /// [`allows_owner_writes`](Self::allows_owner_writes) — the two policies
    /// still cross at `UnderReview` (address open, profile frozen) and at
    /// `Passed` with no address yet (one address write allowed, profile
    /// frozen), but `Failed` now closes both, for independent reasons: this
    /// rule rests on `stellar_address` being UNIQUE, the other on the decision
    /// being final. Owner-writable now *implies* address-writable, so the
    /// containment is one-directional rather than a two-way crossing; they
    /// stay two policies because they answer different questions.
    pub fn allows_address_write(&self, has_address: bool) -> bool {
        match self {
            KybStatus::Failed => false,
            KybStatus::Passed => !has_address,
            KybStatus::NotStarted
            | KybStatus::InProgress
            | KybStatus::UnderReview
            | KybStatus::ChangesRequested => true,
        }
    }

    /// The exact string stored in the DB.
    pub fn as_str(&self) -> &'static str {
        match self {
            KybStatus::NotStarted => "NotStarted",
            KybStatus::InProgress => "InProgress",
            KybStatus::UnderReview => "UnderReview",
            KybStatus::ChangesRequested => "ChangesRequested",
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
            "ChangesRequested" => Ok(KybStatus::ChangesRequested),
            "Passed" => Ok(KybStatus::Passed),
            "Failed" => Ok(KybStatus::Failed),
            other => Err(format!(
                "unknown kyb status `{other}` (expected NotStarted, InProgress, UnderReview, \
                 ChangesRequested, Passed, or Failed)"
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
    /// Settable at any status short of a terminal verdict; fixed once `Passed`
    /// holds one, never settable at `Failed` (see
    /// [`KybStatus::allows_address_write`]).
    pub stellar_address: Option<String>,
    pub address_linked_at: Option<DateTime<Utc>>,
    /// `NotStarted` | `InProgress` | `UnderReview` | `ChangesRequested` |
    /// `Passed` | `Failed`.
    pub kyb_status: String,
    /// When the owner last submitted for review. `None` until the first
    /// submit.
    pub kyb_submitted_at: Option<DateTime<Utc>>,
    /// The deciding trustee's `sub`, from the latest verdict. `None` until a
    /// decision is made; never exposed by any endpoint (Issue #1274).
    pub kyb_decided_by: Option<String>,
    /// When the latest verdict was recorded.
    pub kyb_decided_at: Option<DateTime<Utc>>,
    /// The latest verdict's free-text reason, if the trustee gave one.
    pub kyb_decision_reason: Option<String>,
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

const COLUMNS: &str = "id, legal_name, country, contact_email, stellar_address, \
                       address_linked_at, kyb_status, kyb_submitted_at, kyb_decided_by, \
                       kyb_decided_at, kyb_decision_reason, owner_account_id, owner_chain_id, \
                       owner_address, created_at, updated_at";

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
        sqlx::query_as::<_, LpRow>(&format!(
            "SELECT {COLUMNS} FROM lps WHERE owner_account_id = $1"
        ))
        .bind(owner_account_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// List all LPs, newest first.
    pub async fn list(&self) -> Result<Vec<LpRow>, sqlx::Error> {
        sqlx::query_as::<_, LpRow>(&format!(
            "SELECT {COLUMNS} FROM lps ORDER BY created_at DESC, id DESC"
        ))
        .fetch_all(&self.pool)
        .await
    }

    /// Fetch a single LP by `id`.
    pub async fn find(&self, id: i64) -> Result<Option<LpRow>, sqlx::Error> {
        sqlx::query_as::<_, LpRow>(&format!("SELECT {COLUMNS} FROM lps WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Sets or replaces an LP's settlement address. Refused outright at
    /// `Failed`, and at `Passed` only when the LP already holds an address —
    /// see [`KybStatus::allows_address_write`], which this predicate restates
    /// in SQL. `address_linked_at` is rewritten on every successful set. The
    /// returned bool distinguishes "not eligible" from success, the same
    /// pattern as `SubmittedLoanRepo::review`. A unique violation on
    /// `stellar_address` (another LP already linked this address) surfaces as
    /// a DB error for the caller to map to `409`.
    pub async fn link_address(&self, id: i64, stellar_address: &str) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(
            "UPDATE lps SET stellar_address = $2, address_linked_at = now(), updated_at = now() \
             WHERE id = $1 AND kyb_status <> 'Failed' \
               AND (stellar_address IS NULL OR kyb_status <> 'Passed')",
        )
        .bind(id)
        .bind(stellar_address)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }

    /// Move the LP to `UnderReview`. Returns `false` when the row was not in a
    /// submittable status or the document invariants did not hold — the
    /// caller has already read the documents to build the precise refusal
    /// message, and this predicate is what actually enforces it.
    pub async fn submit_for_review(&self, id: i64) -> Result<bool, sqlx::Error> {
        let affected = sqlx::query(
            "UPDATE lps SET kyb_status = 'UnderReview', kyb_submitted_at = now(), \
             updated_at = now() \
             WHERE id = $1 AND kyb_status = ANY($2) \
               AND EXISTS (SELECT 1 FROM kyb_documents WHERE lp_id = $1) \
               AND NOT EXISTS (SELECT 1 FROM kyb_documents \
                                WHERE lp_id = $1 AND status = 'Rejected')",
        )
        .bind(id)
        .bind(KybStatus::submittable_strs())
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }

    /// Record a trustee verdict on an LP sitting at `UnderReview`. `Failed`
    /// also suspends the owning account, in the same transaction: the two
    /// facts are worthless apart, and an account left `Active` after a
    /// terminal refusal could keep using the API. `Passed` is folded into the
    /// same `WHERE` rather than checked separately: it is refused unless every
    /// document is `Verified`, which is vacuously true on an empty set — but
    /// submit already required at least one document, so a `Passed` with zero
    /// documents cannot occur; the invariant is carried by submit, not by this
    /// predicate. The route layer, not this method, constrains `decision` to
    /// one of the three verdicts and checks `may_transition_to` first.
    pub async fn decide_kyb(
        &self,
        id: i64,
        decision: KybStatus,
        reason: Option<&str>,
        decided_by: &str,
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        let owner: Option<(Uuid,)> = sqlx::query_as(
            "UPDATE lps SET kyb_status = $2, kyb_decided_by = $3, kyb_decided_at = now(), \
             kyb_decision_reason = $4, updated_at = now() \
             WHERE id = $1 AND kyb_status = 'UnderReview' \
               AND ($2 <> 'Passed' \
                    OR NOT EXISTS (SELECT 1 FROM kyb_documents \
                                   WHERE lp_id = $1 AND status <> 'Verified')) \
             RETURNING owner_account_id",
        )
        .bind(id)
        .bind(decision.as_str())
        .bind(decided_by)
        .bind(reason)
        .fetch_optional(&mut *tx)
        .await?;

        let Some((owner_account_id,)) = owner else {
            tx.rollback().await?;
            return Ok(false);
        };

        if decision == KybStatus::Failed {
            sqlx::query(
                "UPDATE accounts SET status = 'Suspended', updated_at = now() WHERE id = $1",
            )
            .bind(owner_account_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(true)
    }
}
