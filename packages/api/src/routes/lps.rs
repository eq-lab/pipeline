//! LP (KYB) API group (`/v1/lps/*`).
//!
//! Backs the custom KYB workflow (Issue #1267). The surface is split by
//! audience rather than by resource:
//!
//! **Owner** — `lps.owner_account_id` is UNIQUE, so the caller's JWT already
//! names exactly one LP and no id ever crosses the wire. `GET /v1/lps/me`
//! returns the record with its documents inline (each carrying a presigned
//! download URL); `POST /v1/lps/me` is an upsert that registers the entity and
//! uploads files in one `multipart/form-data` request;
//! `DELETE /v1/lps/me/documents/{doc}` removes one file; `POST
//! /v1/lps/me/link-address` ties a Stellar account once KYB passes.
//!
//! **Trustee** — `GET /v1/lps` lists, `GET /v1/lps/{id}` reads one (documents
//! inline, same as `/me`), and `POST /v1/lps/{id}/documents/{doc}/review`
//! records a decision.
//!
//! Two rules govern every owner write, and both exist so that a decision can
//! never be detached from what it was made about:
//!
//! 1. [`KybStatus::allows_owner_writes`] freezes the whole record while
//!    `UnderReview` or `Passed`. It reads `kyb_status` and never writes it —
//!    transitions are #1274's job, so this gate is inert until that lands.
//! 2. A `Verified` document cannot be deleted, even when the LP as a whole is
//!    writable. That matters in `Failed`, where the LP reopens with some
//!    documents approved and others rejected.
//!
//! Documents are **untyped**: no `doc_type`, no `subject`, no slots, no
//! versioning. Replacing a document is delete-then-upload, and `POST
//! /v1/lps/me`'s files are *additive* — they append to the set, they never
//! replace it, or every profile edit would wipe the LP's uploads. Profile
//! fields, by contrast, are a full replace.
//!
//! `stellar_address` is a separate identity from the login one — see the
//! migration's module comment. `link_address` still trusts the client-supplied
//! `stellar_address` with no proof of key ownership over *that* address; see
//! `docs/exec-plans/tech-debt-tracker.md` TD-57.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use shared::chains::validate_stellar_address;
use shared::kyb_document_repo::{DocumentStatus, KybDocumentRepo, KybDocumentRow};
use shared::lp_repo::{KybStatus, LpRow};
use shared::object_store::{extension_for, object_key, sniff_content_type, ACCEPTED_CONTENT_TYPES};

use crate::auth::{AuthClaims, Claims, SecurityAddon, TRUSTEE_ROLE};
use crate::config::KybLimits;
use crate::error::{is_unique_violation, ApiError};
use crate::formatting::iso_utc;
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// One LP, with its documents inline. The documents ride along because every
/// caller that reads an LP wants them: the owner renders its onboarding state
/// from them, the trustee reviews them. A separate listing route would be one
/// round trip for no benefit.
#[derive(Debug, Serialize, ToSchema)]
pub struct LpResponse {
    pub id: i64,
    pub legal_name: String,
    pub country: Option<String>,
    pub contact_email: String,
    /// Set only once `kyb_status` is `Passed`.
    pub stellar_address: Option<String>,
    /// ISO-8601 UTC.
    pub address_linked_at: Option<String>,
    /// `NotStarted` | `InProgress` | `UnderReview` | `Passed` | `Failed`.
    pub kyb_status: String,
    /// Whether the owner may still edit this record — the rendered form of
    /// [`KybStatus::allows_owner_writes`], so a client need not re-derive the
    /// rule to know whether to disable its form.
    pub writable: bool,
    /// The account that registered this LP — the authorization key.
    #[schema(value_type = String)]
    pub owner_account_id: Uuid,
    /// The registering caller's wallet identity, when it registered by wallet.
    /// Both are `null` for an email signup — see the module doc.
    pub owner_chain_id: Option<i64>,
    pub owner_address: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    pub documents: Vec<DocumentResponse>,
}

impl LpResponse {
    fn new(row: LpRow, documents: Vec<DocumentResponse>) -> Self {
        let writable = KybStatus::from_str(&row.kyb_status).is_ok_and(|s| s.allows_owner_writes());
        Self {
            id: row.id,
            legal_name: row.legal_name,
            country: row.country,
            contact_email: row.contact_email,
            stellar_address: row.stellar_address,
            address_linked_at: row.address_linked_at.as_ref().map(iso_utc),
            kyb_status: row.kyb_status,
            writable,
            owner_account_id: row.owner_account_id,
            owner_chain_id: row.owner_chain_id,
            owner_address: row.owner_address,
            created_at: iso_utc(&row.created_at),
            documents,
        }
    }
}

/// Response for `GET /v1/lps`. The listing carries no documents — it is a
/// staff overview, and presigning every document of every LP would be wasted
/// work.
#[derive(Debug, Serialize, ToSchema)]
pub struct LpsResponse {
    pub lps: Vec<LpSummary>,
}

/// One LP without its documents, for the staff listing.
#[derive(Debug, Serialize, ToSchema)]
pub struct LpSummary {
    pub id: i64,
    pub legal_name: String,
    pub country: Option<String>,
    pub contact_email: String,
    pub stellar_address: Option<String>,
    pub kyb_status: String,
    #[schema(value_type = String)]
    pub owner_account_id: Uuid,
    /// ISO-8601 UTC.
    pub created_at: String,
}

impl From<LpRow> for LpSummary {
    fn from(row: LpRow) -> Self {
        Self {
            id: row.id,
            legal_name: row.legal_name,
            country: row.country,
            contact_email: row.contact_email,
            stellar_address: row.stellar_address,
            kyb_status: row.kyb_status,
            owner_account_id: row.owner_account_id,
            created_at: iso_utc(&row.created_at),
        }
    }
}

/// One KYB document. Untyped — `original_filename` is what identifies it.
#[derive(Debug, Serialize, ToSchema)]
pub struct DocumentResponse {
    pub id: i64,
    pub lp_id: i64,
    pub original_filename: String,
    pub size_bytes: i64,
    pub content_type: String,
    /// `Provided` | `Verified` | `Rejected`.
    pub status: String,
    pub reject_reason: Option<String>,
    pub reviewed_by: Option<String>,
    /// ISO-8601 UTC.
    pub reviewed_at: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// Presigned GET, valid for `shared::object_store::DOWNLOAD_URL_TTL`.
    /// `None` only if presigning failed, which is logged — a broken link on one
    /// document must not fail the whole read.
    pub download_url: Option<String>,
}

impl DocumentResponse {
    fn new(row: KybDocumentRow, download_url: Option<String>) -> Self {
        Self {
            id: row.id,
            lp_id: row.lp_id,
            original_filename: row.original_filename,
            size_bytes: row.size_bytes,
            content_type: row.content_type,
            status: row.status,
            reject_reason: row.reject_reason,
            reviewed_by: row.reviewed_by,
            reviewed_at: row.reviewed_at.as_ref().map(iso_utc),
            created_at: iso_utc(&row.created_at),
            download_url,
        }
    }
}

/// The outcome of one file in a multi-file upload. A batch reports per file
/// rather than failing whole: the files that stored are stored, and re-sending
/// them would duplicate them.
#[derive(Debug, Serialize, ToSchema)]
pub struct FileResult {
    pub filename: String,
    /// `201` when stored, `400` when rejected.
    pub status: u16,
    /// The document's id, when it stored.
    pub id: Option<i64>,
    /// Why it was rejected, when it was.
    pub error: Option<String>,
}

/// Response for `POST /v1/lps/me`.
#[derive(Debug, Serialize, ToSchema)]
pub struct UpsertLpResponse {
    pub lp: LpResponse,
    /// One entry per file part in the request, in order. Empty when the request
    /// carried no files.
    pub files: Vec<FileResult>,
}

/// Request body for `POST /v1/lps/me/link-address`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LinkAddressRequest {
    /// A Stellar account (`G…`) or contract (`C…`) Strkey.
    pub stellar_address: String,
}

/// The staff decision in `POST /v1/lps/{id}/documents/{doc}/review`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
pub enum DocumentReviewDecision {
    Verified,
    Rejected,
}

/// Request body for `POST /v1/lps/{id}/documents/{doc}/review`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DocumentReviewRequest {
    /// `Verified` or `Rejected`.
    pub decision: DocumentReviewDecision,
    /// Required when `decision = Rejected`; must be omitted/empty otherwise.
    #[serde(default)]
    pub reason: Option<String>,
}

/// The profile half of `POST /v1/lps/me`, read from the multipart text parts.
/// A full replace: every field is taken as sent, and an absent `country` is
/// stored as `NULL`.
///
/// Internal to the parse — [`UpsertLpForm`] is what documents the wire format.
#[derive(Debug, Default)]
pub struct LpProfileForm {
    pub legal_name: String,
    pub country: Option<String>,
    pub contact_email: String,
}

/// The `multipart/form-data` body of `POST /v1/lps/me`.
///
/// Documentation only — the handler takes an [`Multipart`] extractor and never
/// deserializes this type. It exists so the OpenAPI document describes the real
/// wire format: without it Swagger UI renders the body as a single text box,
/// with no field inputs and no file picker.
///
/// `files` is declared as an array of binary strings, which is what makes
/// Swagger UI show a multi-file selector. The handler identifies a file by the
/// part carrying a `filename`, not by its name, so any part name works on the
/// wire — `files` is simply what this schema tells clients to send.
#[derive(ToSchema)]
pub struct UpsertLpForm {
    /// Registered legal name of the entity. Required, trimmed, must not be blank.
    #[schema(example = "Acme Trading Ltd")]
    pub legal_name: String,
    /// Country of registration. Optional — omit it or send it blank to clear
    /// the stored value, since the profile is a full replace.
    #[schema(example = "NL", nullable)]
    pub country: Option<String>,
    /// Contact address for KYB correspondence. Required, trimmed, must not be
    /// blank. Independent of the account's login email.
    #[schema(example = "ops@acme.example")]
    pub contact_email: String,
    /// Supporting documents, appended to the LP's existing set — never
    /// replacing it. PDF, JPEG or PNG, decided by content rather than by the
    /// declared type or the file extension. Optional: a body with no file parts
    /// is a profile-only edit.
    #[schema(value_type = Option<Vec<String>>, format = Binary)]
    pub files: Option<Vec<Vec<u8>>>,
}

/// OpenAPI doc bundle for the LP routes.
#[derive(OpenApi)]
#[openapi(
    paths(list_lps, get_lp, get_my_lp, upsert_my_lp, delete_my_document, review_document, link_address),
    components(schemas(
        LpResponse,
        LpSummary,
        LpsResponse,
        DocumentResponse,
        FileResult,
        UpsertLpResponse,
        UpsertLpForm,
        LinkAddressRequest,
        DocumentReviewDecision,
        DocumentReviewRequest,
    )),
    modifiers(&SecurityAddon),
    tags((name = "Lps", description = "KYB: LP registration, documents, and Stellar address linking"))
)]
pub struct LpsDoc;

// ── Router ───────────────────────────────────────────────────────────────────

/// `max_request_bytes` raises the body limit for the upload route **only**.
/// axum's default is 2MB, which every other route should keep — a 100MB
/// ceiling applied globally would turn any endpoint into a memory sink.
pub fn router(limits: KybLimits) -> Router<Arc<AppState>> {
    Router::new()
        .route("/lps", get(list_lps))
        .route("/lps/me", get(get_my_lp))
        .route(
            "/lps/me",
            post(upsert_my_lp).layer(DefaultBodyLimit::max(limits.max_request_bytes())),
        )
        .route("/lps/me/documents/{doc}", delete(delete_my_document))
        .route("/lps/me/link-address", post(link_address))
        .route("/lps/{id}", get(get_lp))
        .route("/lps/{id}/documents/{doc}/review", post(review_document))
}

// ── Handlers: trustee ────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/lps",
    responses(
        (status = 200, description = "All registered LPs, newest first", body = LpsResponse),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn list_lps(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
) -> Result<Json<LpsResponse>, ApiError> {
    require_trustee(&claims)?;
    let lps = state.lp_repo.list().await?;
    Ok(Json(LpsResponse {
        lps: lps.into_iter().map(LpSummary::from).collect(),
    }))
}

/// Read one LP by id, with its documents and their download URLs. Trustee-only
/// — an owner reads its own record through [`get_my_lp`], which needs no id.
#[utoipa::path(
    get,
    path = "/v1/lps/{id}",
    params(("id" = i64, Path, description = "LP id")),
    responses(
        (status = 200, description = "The LP and its documents", body = LpResponse),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No LP with this id"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn get_lp(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<LpResponse>, ApiError> {
    require_trustee(&claims)?;
    let lp = state
        .lp_repo
        .find(id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("no LP with id {id}")))?;
    Ok(Json(with_documents(&state, lp).await?))
}

/// Approve or reject an LP's document. Trustee-only. A rejection must carry a
/// non-empty `reason`; a verification must not. Only a document currently
/// `Provided` can be reviewed — reviewing an already-decided one returns
/// `409 Conflict`. Mirrors `routes::ramp::review_ramp_event`.
#[utoipa::path(
    post,
    path = "/v1/lps/{id}/documents/{doc}/review",
    params(
        ("id" = i64, Path, description = "LP id"),
        ("doc" = i64, Path, description = "kyb_documents.id"),
    ),
    request_body = DocumentReviewRequest,
    responses(
        (status = 200, description = "Decision recorded"),
        (status = 400, description = "Reject without a reason, or verify with one"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller lacks the `trustee` role"),
        (status = 404, description = "No such document for this LP"),
        (status = 409, description = "Document is not awaiting review"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn review_document(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path((id, doc)): Path<(i64, i64)>,
    Json(req): Json<DocumentReviewRequest>,
) -> Result<StatusCode, ApiError> {
    require_trustee(&claims)?;

    let (status, reason) = resolve_document_review(&req).map_err(ApiError::BadRequest)?;

    let belongs_to_lp = state
        .kyb_document_repo
        .find(doc)
        .await?
        .is_some_and(|d| d.lp_id == id);
    if !belongs_to_lp {
        return Err(ApiError::NotFound(format!("no document {doc} for LP {id}")));
    }

    let reviewed = state
        .kyb_document_repo
        .review(doc, status, reason, &claims.sub)
        .await?;
    if !reviewed {
        return Err(ApiError::Conflict(format!(
            "document {doc} is not awaiting review"
        )));
    }

    Ok(StatusCode::OK)
}

// ── Handlers: owner ──────────────────────────────────────────────────────────

/// The caller's own LP, with its documents and their download URLs.
///
/// `404` is meaningful here rather than an error: it is how a freshly verified
/// account (no LP yet) is told apart from one mid-KYB, which is what lets the
/// frontend route between "register your entity" and "account in review".
#[utoipa::path(
    get,
    path = "/v1/lps/me",
    responses(
        (status = 200, description = "The caller's LP and its documents", body = LpResponse),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 404, description = "This account has not registered an LP yet"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn get_my_lp(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
) -> Result<Json<LpResponse>, ApiError> {
    let lp = my_lp(&claims, &state).await?;
    Ok(Json(with_documents(&state, lp).await?))
}

/// Register or update the caller's LP, and upload documents, in one request.
///
/// `multipart/form-data`: text parts `legal_name`, `country`, `contact_email`
/// carry the profile (a full replace — an absent `country` clears it); every
/// part with a filename is treated as a document and **appended** to the LP's
/// set. Sending no file parts is a profile-only edit.
///
/// The profile is written first and stands on its own: a file that fails
/// validation is reported in `files` and does not undo it. Files are then
/// stored one at a time so a bad one cannot orphan an object or roll back the
/// files already stored.
#[utoipa::path(
    post,
    path = "/v1/lps/me",
    request_body(content = UpsertLpForm, content_type = "multipart/form-data"),
    responses(
        (status = 200, description = "LP updated; every file stored", body = UpsertLpResponse),
        (status = 201, description = "LP registered; every file stored", body = UpsertLpResponse),
        (status = 207, description = "LP written, but at least one file was rejected — see `files`", body = UpsertLpResponse),
        (status = 400, description = "Malformed multipart, or legal_name/contact_email empty"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 409, description = "KYB is UnderReview or Passed, or the request would exceed the per-LP document cap"),
        (status = 413, description = "A file exceeds KYB_MAX_DOCUMENT_BYTES, or the request carries too many files"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn upsert_my_lp(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    multipart: Multipart,
) -> Result<Response, ApiError> {
    let limits = state.kyb_limits;

    // Refuse a frozen LP before reading the body, not after. Draining first
    // would buffer up to max_files × max_document_bytes only to discard it, so
    // a frozen record would be the cheapest way to tie up API memory.
    let existing = state
        .lp_repo
        .find_by_owner_account_id(claims.account_id)
        .await?;
    if let Some(lp) = &existing {
        guard_writable(lp)?;
    }

    let (form, files) = read_upload(multipart, limits).await?;
    let profile = validate_profile(&form)?;

    // Only files that would actually be stored count against the cap. Counting
    // the rejected ones too would let a single unsupported attachment turn a
    // request that fits into a 409 that writes nothing — not the valid
    // documents beside it, and not the profile edit carrying them.
    let incoming = files.iter().filter(|f| f.verdict.is_ok()).count();
    let held = match &existing {
        Some(lp) => state.kyb_document_repo.count_for_lp(lp.id).await?,
        None => 0,
    };
    check_document_cap(held, incoming, limits.max_documents_per_lp)?;

    // `None` means the row was frozen between the guard above and this write —
    // the window is wide, since the whole body is read inside it. The DB
    // predicate is what actually enforces the freeze; the earlier guard only
    // saves us from draining a body we would discard.
    let (lp_id, created) = state
        .lp_repo
        .upsert_by_owner_account_id(
            profile.legal_name,
            profile.country,
            profile.contact_email,
            claims.account_id,
            claims.chain_id,
            claims.chain_id.map(|_| claims.sub.as_str()),
        )
        .await?
        .ok_or_else(|| {
            ApiError::Conflict(
                "this LP entered review while the request was being uploaded and can no longer be changed"
                    .to_owned(),
            )
        })?;

    let mut results = Vec::with_capacity(files.len());
    for file in files {
        results.push(store_one(&state, lp_id, file).await);
    }

    let lp = state.lp_repo.find(lp_id).await?.ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!(
            "LP {lp_id} vanished immediately after upsert"
        ))
    })?;
    let body = UpsertLpResponse {
        lp: with_documents(&state, lp).await?,
        files: results,
    };

    Ok((upsert_status(created, &body.files), Json(body)).into_response())
}

/// Remove one of the caller's documents — the object in Spaces and the row.
///
/// This is also how a document is replaced: with no types and no slots, there
/// is nothing to supersede, so a correction is delete-then-upload.
///
/// A `Verified` document is refused even while the LP is writable, so a passed
/// KYB always refers to the bytes that earned it.
#[utoipa::path(
    delete,
    path = "/v1/lps/me/documents/{doc}",
    params(("doc" = i64, Path, description = "kyb_documents.id")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 404, description = "No such document for the caller's LP"),
        (status = 409, description = "KYB is UnderReview or Passed, or the document is Verified"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn delete_my_document(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(doc): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let lp = my_lp(&claims, &state).await?;
    guard_writable(&lp)?;

    let row = state
        .kyb_document_repo
        .find(doc)
        .await?
        .filter(|d| d.lp_id == lp.id)
        .ok_or_else(|| ApiError::NotFound(format!("no document {doc} for this LP")))?;

    if row.is_verified() {
        return Err(ApiError::Conflict(format!(
            "document {doc} has been verified and can no longer be deleted"
        )));
    }

    // The row goes first: it is the source of truth, and its `status <>
    // 'Verified'` predicate is what closes the race against a concurrent
    // review. A failure to remove the object afterwards leaves an unreferenced
    // blob, which is wasted storage rather than a correctness problem.
    // The `Verified` case was already ruled out above, so a miss here means the
    // row went away concurrently — a double-click or a retried request. Saying
    // "it has been verified" would be wrong and would send a client down the
    // wrong branch.
    if !state.kyb_document_repo.delete(doc).await? {
        return Err(ApiError::NotFound(format!("no document {doc} for this LP")));
    }
    if let Err(e) = state.object_store.delete(&row.file_ref).await {
        tracing::warn!(
            document = doc,
            key = %row.file_ref,
            error = %e,
            "deleted kyb_documents row but could not remove its object"
        );
    }

    Ok(StatusCode::NO_CONTENT)
}

/// LP ties a Stellar account after KYB passes. One-shot: only an LP with
/// `kyb_status = Passed` and no address linked yet is eligible.
///
/// Deliberately not folded into [`upsert_my_lp`]: it requires `Passed`, which
/// is exactly when the upsert is frozen.
#[utoipa::path(
    post,
    path = "/v1/lps/me/link-address",
    request_body = LinkAddressRequest,
    responses(
        (status = 200, description = "Address linked", body = LpResponse),
        (status = 400, description = "stellar_address is not a valid Strkey"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 404, description = "This account has not registered an LP yet"),
        (status = 409, description = "KYB has not passed, an address is already linked, or stellar_address belongs to another LP"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn link_address(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Json(req): Json<LinkAddressRequest>,
) -> Result<Json<LpResponse>, ApiError> {
    let stellar_address = validate_stellar_address("stellar_address", req.stellar_address)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let lp = my_lp(&claims, &state).await?;

    let linked = state
        .lp_repo
        .link_address(lp.id, &stellar_address)
        .await
        .map_err(|e| {
            if is_unique_violation(&e) {
                return ApiError::Conflict(format!(
                    "stellar_address `{stellar_address}` is already linked to another LP"
                ));
            }
            ApiError::from(e)
        })?;
    if !linked {
        return Err(ApiError::Conflict(format!(
            "LP {} has not passed KYB, or already has an address linked",
            lp.id
        )));
    }

    let row = state.lp_repo.find(lp.id).await?.ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!(
            "LP {} vanished immediately after linking",
            lp.id
        ))
    })?;
    Ok(Json(with_documents(&state, row).await?))
}

// ── Upload plumbing ──────────────────────────────────────────────────────────

/// One accepted file part, held in memory between parsing and storage.
struct UploadedFile {
    filename: String,
    bytes: Vec<u8>,
    /// `Err` carries why the file was rejected; the part is still reported so
    /// the caller learns which of its files failed and why.
    verdict: Result<&'static str, String>,
}

/// Map a multipart parsing failure to the right status.
///
/// axum reports "the body exceeded the configured limit" and "this body is not
/// valid multipart" through the same error type, and its own `status()` is what
/// tells them apart. Without this both answer `400`, so a caller whose upload is
/// simply too large is told its encoding is broken — and the `413` this
/// endpoint documents would never be returned.
fn multipart_error(context: &str, e: &axum::extract::multipart::MultipartError) -> ApiError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        return ApiError::PayloadTooLarge(format!("{context} exceeds the upload size limit"));
    }
    ApiError::BadRequest(format!("{context}: {e}"))
}

/// Drain the multipart body into the profile fields and the file parts.
///
/// Rejects the whole request only for things that make it unprocessable — a
/// malformed body, or more file parts than `max_files_per_request`. A single
/// unacceptable file (wrong type, too large) is recorded as a per-file verdict
/// instead, so one bad attachment cannot discard a valid profile edit and the
/// files beside it.
async fn read_upload(
    mut multipart: Multipart,
    limits: KybLimits,
) -> Result<(LpProfileForm, Vec<UploadedFile>), ApiError> {
    let mut form = LpProfileForm::default();
    let mut files: Vec<UploadedFile> = Vec::new();

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| multipart_error("malformed multipart body", &e))?
    {
        let name = field.name().unwrap_or_default().to_owned();
        let filename = field.file_name().map(str::to_owned);

        // A part with no filename is a text field. `Field::text` buffers the
        // whole part, and this route's body limit is 100MB, so an unbounded
        // read here — including of a part we do not even recognise — would let
        // one request pin that much heap.
        let Some(filename) = filename else {
            let value = read_text_field(&mut field, &name).await?;
            match name.as_str() {
                "legal_name" => form.legal_name = value,
                "country" => form.country = Some(value),
                "contact_email" => form.contact_email = value,
                _ => {}
            }
            continue;
        };

        // An unfilled `<input type="file">` is still submitted, as a part with
        // an empty filename and no body. Treating it as a document would put a
        // bogus "file is empty" rejection in `files[]` and downgrade an
        // otherwise clean profile edit to 207.
        if filename.trim().is_empty() {
            let mut empty = true;
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|e| multipart_error("unreadable file part", &e))?
            {
                if !chunk.is_empty() {
                    empty = false;
                }
            }
            if empty {
                continue;
            }
            return Err(ApiError::BadRequest(
                "a file part carries no filename".to_owned(),
            ));
        }

        if files.len() >= limits.max_files_per_request {
            return Err(ApiError::PayloadTooLarge(format!(
                "at most {} files may be uploaded per request",
                limits.max_files_per_request
            )));
        }

        files.push(read_file(&mut field, filename, limits).await?);
    }

    Ok((form, files))
}

/// Read a text part, refusing one larger than [`MAX_TEXT_FIELD_BYTES`].
///
/// Chunked for the same reason files are: `Field::text` would buffer the whole
/// part before its size could be judged, and the limit that admitted it is the
/// whole-request one.
async fn read_text_field(
    field: &mut axum::extract::multipart::Field<'_>,
    name: &str,
) -> Result<String, ApiError> {
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|e| multipart_error(&format!("unreadable `{name}` field"), &e))?
    {
        if buf.len().saturating_add(chunk.len()) > MAX_TEXT_FIELD_BYTES {
            return Err(ApiError::PayloadTooLarge(format!(
                "`{name}` exceeds {MAX_TEXT_FIELD_BYTES} bytes"
            )));
        }
        buf.extend_from_slice(&chunk);
    }
    String::from_utf8(buf).map_err(|_| ApiError::BadRequest(format!("`{name}` is not valid UTF-8")))
}

/// Trim a client-supplied filename to something storable.
///
/// Counts characters rather than bytes, like the profile bounds, so a non-Latin
/// name is not cut to a third of the advertised length. Truncating rather than
/// rejecting: an over-long filename is cosmetic, and refusing an otherwise valid
/// document over it would be a worse trade.
fn truncate_filename(filename: &str) -> String {
    let trimmed = filename.trim();
    if trimmed.chars().count() <= MAX_FILENAME_LEN {
        return trimmed.to_owned();
    }
    trimmed.chars().take(MAX_FILENAME_LEN).collect()
}

/// Drain one file part, refusing to hold more than the per-file limit.
///
/// Read in chunks rather than via `Field::bytes` because that would buffer the
/// whole part before the size could be checked — and the body limit that
/// admitted the request is the *batch* ceiling, so a single part is allowed to
/// arrive far larger than any one file may be. Once the limit is passed the
/// remainder is drained and discarded: the verdict is already decided, but the
/// connection still has to be read to reach the parts that follow.
async fn read_file(
    field: &mut axum::extract::multipart::Field<'_>,
    filename: String,
    limits: KybLimits,
) -> Result<UploadedFile, ApiError> {
    // `original_filename` is unbounded TEXT, is echoed back in every read of
    // the LP, and arrives in a multipart part header — which multer does not
    // bound — so it needs the same ceiling the profile fields got.
    let filename = truncate_filename(&filename);
    let mut bytes: Vec<u8> = Vec::new();
    let mut total: usize = 0;
    let mut oversized = false;

    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|e| multipart_error(&format!("unreadable file `{filename}`"), &e))?
    {
        total = total.saturating_add(chunk.len());
        if total > limits.max_document_bytes {
            oversized = true;
            bytes = Vec::new();
            continue;
        }
        bytes.extend_from_slice(&chunk);
    }

    if oversized {
        return Ok(UploadedFile {
            filename,
            bytes: Vec::new(),
            verdict: Err(format!(
                "file is {total} bytes; the limit is {}",
                limits.max_document_bytes
            )),
        });
    }

    Ok(inspect_file(filename, bytes))
}

/// Decide whether one uploaded part is acceptable.
///
/// The declared `Content-Type` is ignored entirely: it is attacker-controlled,
/// so the leading bytes are what decide. Size is checked here rather than in
/// the extractor because the per-file limit is smaller than the per-request
/// body limit that admitted it.
fn inspect_file(filename: String, bytes: Vec<u8>) -> UploadedFile {
    // Size is not re-checked here: `read_file` aborts past the limit while
    // draining and never reaches this, which is the only caller.
    let verdict = if bytes.is_empty() {
        Err("file is empty".to_owned())
    } else {
        sniff_content_type(&bytes).ok_or_else(|| {
            format!(
                "unsupported file type — accepted types are {}",
                ACCEPTED_CONTENT_TYPES.join(", ")
            )
        })
    };

    UploadedFile {
        filename,
        bytes,
        verdict,
    }
}

/// Store one accepted file and record it, or report why it was refused.
///
/// The object goes to Spaces before the row is written: a row pointing at an
/// object that does not exist would render as a broken download, whereas an
/// object with no row is invisible and merely wasted.
///
/// A storage or database failure is reported against *this file* rather than
/// raised, because by the time it happens earlier files in the batch are
/// already stored. Failing the request would answer `500` while silently having
/// committed half the upload; a `500` entry in `files` tells the caller exactly
/// which files to retry.
async fn store_one(state: &AppState, lp_id: i64, file: UploadedFile) -> FileResult {
    let refused = |status: StatusCode, error: String| FileResult {
        filename: file.filename.clone(),
        status: status.as_u16(),
        id: None,
        error: Some(error),
    };

    let content_type = match file.verdict {
        Ok(content_type) => content_type,
        Err(ref error) => return refused(StatusCode::BAD_REQUEST, error.clone()),
    };

    let extension = extension_for(content_type).unwrap_or("bin");
    let key = object_key(lp_id, Uuid::new_v4(), extension);
    let size_bytes = file.bytes.len() as i64;

    if let Err(e) = state.object_store.put(&key, content_type, file.bytes).await {
        tracing::error!(lp = lp_id, key = %key, error = %e, "could not store a KYB document");
        return refused(
            StatusCode::INTERNAL_SERVER_ERROR,
            "could not be stored — try uploading it again".to_owned(),
        );
    }

    let insert = async {
        let mut conn = state.pool.acquire().await?;
        KybDocumentRepo::insert(
            &mut conn,
            lp_id,
            &key,
            &file.filename,
            size_bytes,
            content_type,
        )
        .await
    }
    .await;

    match insert {
        // The LP was frozen between the profile write and this file landing.
        // The object is already in the bucket with nothing pointing at it, so
        // clean it up as in the error arm below.
        Ok(None) => {
            if let Err(cleanup) = state.object_store.delete(&key).await {
                tracing::warn!(key = %key, error = %cleanup, "could not clean up an unreferenced object");
            }
            refused(
                StatusCode::CONFLICT,
                "this LP entered review before the file was recorded".to_owned(),
            )
        }
        Ok(Some(id)) => FileResult {
            filename: file.filename,
            status: StatusCode::CREATED.as_u16(),
            id: Some(id),
            error: None,
        },
        Err(e) => {
            // The object is already in the bucket with nothing pointing at it.
            // Unreferenced, so invisible to every reader — a storage leak, not a
            // correctness problem. Best-effort removal keeps it from accruing.
            tracing::error!(lp = lp_id, key = %key, error = %e, "could not record a stored KYB document");
            if let Err(cleanup) = state.object_store.delete(&key).await {
                tracing::warn!(key = %key, error = %cleanup, "could not clean up an unreferenced object");
            }
            refused(
                StatusCode::INTERNAL_SERVER_ERROR,
                "could not be recorded — try uploading it again".to_owned(),
            )
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn require_trustee(claims: &Claims) -> Result<(), ApiError> {
    if claims.has_role(TRUSTEE_ROLE) {
        return Ok(());
    }
    Err(ApiError::Forbidden(format!(
        "this endpoint requires the `{TRUSTEE_ROLE}` role"
    )))
}

/// The caller's LP, or `404`. Replaces the old `lp_owner_guard`: with the owner
/// routes keyed on `/me`, ownership is not something to check after the fact —
/// the lookup is by `owner_account_id`, so a caller can only ever reach its own.
async fn my_lp(claims: &Claims, state: &AppState) -> Result<LpRow, ApiError> {
    state
        .lp_repo
        .find_by_owner_account_id(claims.account_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("this account has not registered an LP yet".to_owned()))
}

fn guard_writable(lp: &LpRow) -> Result<(), ApiError> {
    let status =
        KybStatus::from_str(&lp.kyb_status).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    if status.allows_owner_writes() {
        return Ok(());
    }
    Err(ApiError::Conflict(format!(
        "this LP is {status} and can no longer be changed"
    )))
}

/// Load an LP's documents and attach a presigned download URL to each.
///
/// A presigning failure degrades that one document to `download_url: null`
/// rather than failing the read — the rest of the record is still useful, and
/// the client can retry.
async fn with_documents(state: &AppState, lp: LpRow) -> Result<LpResponse, ApiError> {
    let rows = state.kyb_document_repo.list_for_lp(lp.id).await?;
    let mut documents = Vec::with_capacity(rows.len());
    for row in rows {
        let url = match state
            .object_store
            .presigned_get(&row.file_ref, &row.original_filename)
            .await
        {
            Ok(url) => Some(url),
            Err(e) => {
                tracing::warn!(
                    document = row.id,
                    key = %row.file_ref,
                    error = %e,
                    "could not presign a KYB document"
                );
                None
            }
        };
        documents.push(DocumentResponse::new(row, url));
    }
    Ok(LpResponse::new(lp, documents))
}

// ── Compute (pure) ───────────────────────────────────────────────────────────

/// Ceilings on the profile's text fields.
///
/// `lps` stores them as unbounded `TEXT`, and this route's body limit is 100MB
/// — a hundred times axum's default — so without these a caller could push a
/// 100MB `legal_name` straight into the table. Generous enough that no real
/// entity name, address or country hits them.
pub const MAX_LEGAL_NAME_LEN: usize = 200;
pub const MAX_CONTACT_EMAIL_LEN: usize = 320;
pub const MAX_COUNTRY_LEN: usize = 100;
/// Ceiling on a stored `original_filename`. Over-long names are truncated
/// rather than refused — see [`truncate_filename`].
pub const MAX_FILENAME_LEN: usize = 255;

/// The most a single text part may carry before it is refused unread-in-full.
/// Bounds the unrecognised parts too, which are otherwise buffered whole only
/// to be discarded.
const MAX_TEXT_FIELD_BYTES: usize = 64 * 1024;

/// Validated, trimmed profile fields borrowed from the submitted form.
pub struct ValidatedProfile<'a> {
    pub legal_name: &'a str,
    pub country: Option<&'a str>,
    pub contact_email: &'a str,
}

/// Check the profile half of an upsert. `country` collapses blank to `None`, so
/// a form that submits an empty select clears the column rather than storing
/// `""`.
///
/// Public so the unit tests in `packages/api/tests/lps.rs` can exercise it
/// without the HTTP/DB layers.
pub fn validate_profile(form: &LpProfileForm) -> Result<ValidatedProfile<'_>, ApiError> {
    // Characters, not bytes. `str::len` would make these limits shrink with
    // script: 200 bytes is only ~66 characters of Cyrillic or CJK, so a
    // legitimate non-Latin entity name would be refused by an error claiming a
    // 200-character limit.
    let bounded = |label: &str, value: &str, max: usize| -> Result<(), ApiError> {
        if value.chars().count() > max {
            return Err(ApiError::BadRequest(format!(
                "{label} must be at most {max} characters"
            )));
        }
        Ok(())
    };

    let legal_name = form.legal_name.trim();
    if legal_name.is_empty() {
        return Err(ApiError::BadRequest(
            "legal_name must not be empty".to_owned(),
        ));
    }
    bounded("legal_name", legal_name, MAX_LEGAL_NAME_LEN)?;

    let contact_email = form.contact_email.trim();
    if contact_email.is_empty() {
        return Err(ApiError::BadRequest(
            "contact_email must not be empty".to_owned(),
        ));
    }
    bounded("contact_email", contact_email, MAX_CONTACT_EMAIL_LEN)?;
    if let Some(country) = form.country.as_deref() {
        bounded("country", country.trim(), MAX_COUNTRY_LEN)?;
    }
    Ok(ValidatedProfile {
        legal_name,
        country: form
            .country
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty()),
        contact_email,
    })
}

/// Refuse an upload that would carry an LP past the per-LP document cap.
///
/// Checked before anything is stored, and against the whole batch rather than
/// file by file, so a request either fits or is refused outright — an LP is
/// never left with a half-applied upload sitting against its quota.
pub fn check_document_cap(held: i64, incoming: usize, max: i64) -> Result<(), ApiError> {
    // `as i64` would wrap rather than saturate — usize::MAX becomes -1, which
    // compares below every cap and waves the request through.
    let total = held.saturating_add(i64::try_from(incoming).unwrap_or(i64::MAX));
    if total > max {
        return Err(ApiError::Conflict(format!(
            "this LP holds {held} documents and may hold at most {max}; \
             this request would add {incoming}"
        )));
    }
    Ok(())
}

/// The status a completed upsert answers with.
///
/// `207` whenever any file was refused — the profile still wrote and the other
/// files still stored, so neither a flat success nor a flat failure would be
/// honest about what happened.
pub fn upsert_status(created: bool, files: &[FileResult]) -> StatusCode {
    if files
        .iter()
        .any(|f| f.status != StatusCode::CREATED.as_u16())
    {
        return StatusCode::MULTI_STATUS;
    }
    if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    }
}

/// Validate a document review request and map it to the `(status, reason)` the
/// repo expects. Pure (no I/O) so it is unit-testable. Reject ⇒ a non-empty
/// `reason` is required; Verify ⇒ no reason may be supplied. Mirrors
/// `routes::ramp::resolve_ramp_review`.
pub fn resolve_document_review(
    req: &DocumentReviewRequest,
) -> Result<(DocumentStatus, Option<&str>), String> {
    match req.decision {
        DocumentReviewDecision::Rejected => {
            let reason = req
                .reason
                .as_deref()
                .map(str::trim)
                .filter(|r| !r.is_empty())
                .ok_or_else(|| {
                    "a non-empty `reason` is required to reject a document".to_owned()
                })?;
            Ok((DocumentStatus::Rejected, Some(reason)))
        }
        DocumentReviewDecision::Verified => {
            if req.reason.as_deref().is_some_and(|r| !r.trim().is_empty()) {
                return Err("`reason` must not be set when verifying a document".to_owned());
            }
            Ok((DocumentStatus::Verified, None))
        }
    }
}
