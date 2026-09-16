//! LP (KYB) API group (`/v1/lps/*`).
//!
//! Backs the custom KYB workflow: an LP registers (`POST /v1/lps`), uploads its
//! supporting documents (`POST /v1/lps/{id}/documents`), staff reviews each one
//! (`POST /v1/lps/{id}/documents/{doc}/review`), and once `kyb_status` reaches
//! `Passed` the LP ties a Stellar account (`POST /v1/lps/{id}/link-address`).
//! `GET /v1/lps` is the staff-facing listing; `GET /v1/lps/{id}` is how an LP
//! reads back its own record — a trustee may also read any LP by id there.
//!
//! `review_document` is `trustee`-only (mirrors `routes::loan_book`'s and
//! `routes::ramp`'s review endpoints). `register_lp`, `upload_document`, and
//! `link_address` require only an authenticated `auth_users` entry (any role) —
//! any "registered user" may register an LP, but `upload_document`/
//! `link_address` additionally require the caller's JWT `(chain_id, sub)` to
//! match the target LP's `(owner_chain_id, owner_address)` (recorded at
//! registration): a registered user acts on their own LP only
//! ([`lp_owner_guard`]). `get_lp` uses the same guard but adds a trustee
//! bypass — read-only, it does not extend to the two write endpoints.
//! `stellar_address` is a separate identity from the login/`owner_address`
//! one — see the migration's module comment. `link_address` still trusts the
//! client-supplied `stellar_address` with no proof of key ownership over
//! *that* address; see `docs/exec-plans/tech-debt-tracker.md` TD-57.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::chains::validate_stellar_address;
use shared::kyb_document_repo::{DocType, DocumentStatus, KybDocumentRepo, KybDocumentRow};
use shared::lp_repo::LpRow;

use crate::auth::{AuthClaims, Claims, SecurityAddon, TRUSTEE_ROLE};
use crate::error::ApiError;
use crate::formatting::iso_utc;
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// One LP.
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
    /// The registering caller's JWT identity — see the module doc.
    pub owner_chain_id: i64,
    pub owner_address: String,
    /// ISO-8601 UTC.
    pub created_at: String,
}

impl From<LpRow> for LpResponse {
    fn from(row: LpRow) -> Self {
        Self {
            id: row.id,
            legal_name: row.legal_name,
            country: row.country,
            contact_email: row.contact_email,
            stellar_address: row.stellar_address,
            address_linked_at: row.address_linked_at.as_ref().map(iso_utc),
            kyb_status: row.kyb_status,
            owner_chain_id: row.owner_chain_id,
            owner_address: row.owner_address,
            created_at: iso_utc(&row.created_at),
        }
    }
}

/// Response for `GET /v1/lps`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LpsResponse {
    pub lps: Vec<LpResponse>,
}

/// Request body for `POST /v1/lps`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterLpRequest {
    pub legal_name: String,
    #[serde(default)]
    pub country: Option<String>,
    pub contact_email: String,
}

/// Response for `POST /v1/lps`.
#[derive(Debug, Serialize, ToSchema)]
pub struct RegisterLpResponse {
    pub id: i64,
}

/// One KYB document.
#[derive(Debug, Serialize, ToSchema)]
pub struct DocumentResponse {
    pub id: i64,
    pub lp_id: i64,
    /// One of [`DocType`]'s variants.
    pub doc_type: String,
    pub subject: Option<String>,
    pub file_ref: String,
    /// `NotProvided` | `Provided` | `Verified` | `Rejected`.
    pub status: String,
    pub reject_reason: Option<String>,
    pub reviewed_by: Option<String>,
    /// ISO-8601 UTC.
    pub reviewed_at: Option<String>,
    /// ISO-8601 UTC.
    pub expires_at: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
}

impl From<KybDocumentRow> for DocumentResponse {
    fn from(row: KybDocumentRow) -> Self {
        Self {
            id: row.id,
            lp_id: row.lp_id,
            doc_type: row.doc_type,
            subject: row.subject,
            file_ref: row.file_ref,
            status: row.status,
            reject_reason: row.reject_reason,
            reviewed_by: row.reviewed_by,
            reviewed_at: row.reviewed_at.as_ref().map(iso_utc),
            expires_at: row.expires_at.as_ref().map(iso_utc),
            created_at: iso_utc(&row.created_at),
        }
    }
}

/// Request body for `POST /v1/lps/{id}/documents`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UploadDocumentRequest {
    /// CertificateOfIncorporation | RegistryRecord | GoodStanding | LegalAddress |
    /// ShareholderRegister | UboId | UboProofOfAddress.
    pub doc_type: String,
    /// Which shareholder/UBO, for the personal document types (`UboId`,
    /// `UboProofOfAddress`). Omit for entity-level documents.
    #[serde(default)]
    pub subject: Option<String>,
    /// Where the uploaded file is stored (no upload transport is implemented
    /// yet — the caller supplies an already-stored file reference).
    pub file_ref: String,
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

/// Request body for `POST /v1/lps/{id}/link-address`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LinkAddressRequest {
    /// A Stellar account (`G…`) or contract (`C…`) Strkey.
    pub stellar_address: String,
}

/// OpenAPI doc bundle for the LP routes.
#[derive(OpenApi)]
#[openapi(
    paths(list_lps, get_lp, register_lp, upload_document, review_document, link_address),
    components(schemas(
        LpResponse,
        LpsResponse,
        RegisterLpRequest,
        RegisterLpResponse,
        DocumentResponse,
        UploadDocumentRequest,
        DocumentReviewDecision,
        DocumentReviewRequest,
        LinkAddressRequest
    )),
    modifiers(&SecurityAddon),
    tags((name = "Lps", description = "KYB: LP registration, documents, and Stellar address linking"))
)]
pub struct LpsDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/lps", get(list_lps).post(register_lp))
        .route("/lps/{id}", get(get_lp))
        .route("/lps/{id}/documents", post(upload_document))
        .route("/lps/{id}/documents/{doc}/review", post(review_document))
        .route("/lps/{id}/link-address", post(link_address))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

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
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }
    let lps = state.lp_repo.list().await?;
    Ok(Json(LpsResponse {
        lps: lps.into_iter().map(LpResponse::from).collect(),
    }))
}

/// Fetch a single LP: its own registered owner, or a trustee, may read any LP
/// by id ([`lp_owner_guard`]). How an LP checks its own `kyb_status` /
/// `stellar_address` after registering; the trustee case gives staff a
/// single-record complement to `list_lps`. The trustee bypass is read-only —
/// it does not extend to `upload_document`/`link_address`, which always
/// require exact ownership.
#[utoipa::path(
    get,
    path = "/v1/lps/{id}",
    params(("id" = i64, Path, description = "LP id")),
    responses(
        (status = 200, description = "The LP (caller's own, or any LP for a trustee)", body = LpResponse),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller does not own this LP and lacks the `trustee` role"),
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
    if claims.has_role(TRUSTEE_ROLE) {
        let lp = state
            .lp_repo
            .find(id)
            .await?
            .ok_or_else(|| ApiError::NotFound(format!("no LP with id {id}")))?;
        return Ok(Json(LpResponse::from(lp)));
    }
    let lp = lp_owner_guard(&claims, &state, id).await?;
    Ok(Json(LpResponse::from(lp)))
}

/// Register a new LP, owned by the caller's JWT identity. `kyb_status` starts
/// at `NotStarted`. Any authenticated `auth_users` entry may register — no
/// specific role is required.
#[utoipa::path(
    post,
    path = "/v1/lps",
    request_body = RegisterLpRequest,
    responses(
        (status = 201, description = "LP registered, owned by the caller", body = RegisterLpResponse),
        (status = 400, description = "legal_name or contact_email is empty"),
        (status = 401, description = "Missing, invalid, or expired token"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn register_lp(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterLpRequest>,
) -> Result<(StatusCode, Json<RegisterLpResponse>), ApiError> {
    let legal_name = req.legal_name.trim();
    if legal_name.is_empty() {
        return Err(ApiError::BadRequest(
            "legal_name must not be empty".to_owned(),
        ));
    }
    let contact_email = req.contact_email.trim();
    if contact_email.is_empty() {
        return Err(ApiError::BadRequest(
            "contact_email must not be empty".to_owned(),
        ));
    }
    let country = req
        .country
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty());

    let id = state
        .lp_repo
        .insert(
            legal_name,
            country,
            contact_email,
            claims.chain_id,
            &claims.sub,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(RegisterLpResponse { id })))
}

/// Upload a KYB document for an LP. Supersedes the current submission (if any)
/// for the same `(doc_type, subject)` — the prior version is kept for history,
/// not deleted. The caller must be the LP's registered owner ([`lp_owner_guard`]).
#[utoipa::path(
    post,
    path = "/v1/lps/{id}/documents",
    params(("id" = i64, Path, description = "LP id")),
    request_body = UploadDocumentRequest,
    responses(
        (status = 201, description = "Document recorded as Provided, awaiting staff review", body = DocumentResponse),
        (status = 400, description = "Invalid doc_type or empty file_ref"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller does not own this LP"),
        (status = 404, description = "No LP with this id"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn upload_document(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<UploadDocumentRequest>,
) -> Result<(StatusCode, Json<DocumentResponse>), ApiError> {
    let doc_type = DocType::from_str(req.doc_type.trim()).map_err(ApiError::BadRequest)?;
    let file_ref = req.file_ref.trim();
    if file_ref.is_empty() {
        return Err(ApiError::BadRequest(
            "file_ref must not be empty".to_owned(),
        ));
    }
    let subject = req
        .subject
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    lp_owner_guard(&claims, &state, id).await?;

    // Supersede-then-insert must be atomic: idx_kyb_documents_current would
    // otherwise reject the new row while the old one is still current.
    let mut tx = state.pool.begin().await?;
    let doc_id = KybDocumentRepo::upload(&mut tx, id, doc_type, subject, file_ref).await?;
    tx.commit().await?;

    let row = state.kyb_document_repo.find(doc_id).await?.ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!(
            "document {doc_id} vanished immediately after insert"
        ))
    })?;
    Ok((StatusCode::CREATED, Json(DocumentResponse::from(row))))
}

/// Approve or reject an LP's document. Trustee-only. A rejection must carry a
/// non-empty `reason`; a verification must not. Only a document currently
/// `Provided` can be reviewed — reviewing an already-decided or superseded
/// document returns `409 Conflict`. Mirrors `routes::ramp::review_ramp_event`.
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
        (status = 409, description = "Document is not awaiting review (already decided, or superseded by a later upload)"),
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
    if !claims.has_role(TRUSTEE_ROLE) {
        return Err(ApiError::Forbidden(format!(
            "this endpoint requires the `{TRUSTEE_ROLE}` role"
        )));
    }

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

/// LP ties a Stellar account after KYB passes. One-shot: only an LP with
/// `kyb_status = Passed` and no address linked yet is eligible. The caller must
/// be the LP's registered owner ([`lp_owner_guard`]) — this is a separate check
/// from `stellar_address` itself, which is not verified against the caller's
/// login identity (see the module doc / TD-57).
#[utoipa::path(
    post,
    path = "/v1/lps/{id}/link-address",
    params(("id" = i64, Path, description = "LP id")),
    request_body = LinkAddressRequest,
    responses(
        (status = 200, description = "Address linked", body = LpResponse),
        (status = 400, description = "stellar_address is not a valid Strkey"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 403, description = "Caller does not own this LP"),
        (status = 404, description = "No LP with this id"),
        (status = 409, description = "KYB has not passed, an address is already linked, or stellar_address is already linked to another LP"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn link_address(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<LinkAddressRequest>,
) -> Result<Json<LpResponse>, ApiError> {
    let stellar_address = validate_stellar_address("stellar_address", req.stellar_address)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    lp_owner_guard(&claims, &state, id).await?;

    let linked = state
        .lp_repo
        .link_address(id, &stellar_address)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(ref db) if db.code().as_deref() == Some("23505") => {
                ApiError::Conflict(format!(
                    "stellar_address `{stellar_address}` is already linked to another LP"
                ))
            }
            other => ApiError::from(other),
        })?;
    if !linked {
        return Err(ApiError::Conflict(format!(
            "LP {id} has not passed KYB, or already has an address linked"
        )));
    }

    let row = state.lp_repo.find(id).await?.ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!(
            "LP {id} vanished immediately after linking"
        ))
    })?;
    Ok(Json(LpResponse::from(row)))
}

// ── Guards ───────────────────────────────────────────────────────────────────

/// Shared guard for LP-facing writes on `/v1/lps/{id}/…`: the caller's JWT
/// `(chain_id, sub)` must match the target LP's `(owner_chain_id, owner_address)`
/// — the `auth_users` entry that registered it. 404 when the LP doesn't exist,
/// 403 on an owner mismatch. Used by [`upload_document`] and [`link_address`] so
/// "own LP only" cannot drift between them.
async fn lp_owner_guard(claims: &Claims, state: &AppState, id: i64) -> Result<LpRow, ApiError> {
    let lp = state
        .lp_repo
        .find(id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("no LP with id {id}")))?;
    if lp.owner_chain_id != claims.chain_id || lp.owner_address != claims.sub {
        return Err(ApiError::Forbidden(
            "this LP is registered to a different user".to_owned(),
        ));
    }
    Ok(lp)
}

// ── Compute (pure) ───────────────────────────────────────────────────────────

/// Validate a document review request and map it to the `(status, reason)` the
/// repo expects. Pure (no I/O) so it is unit-testable. Reject ⇒ a non-empty
/// `reason` is required; Verify ⇒ no reason may be supplied. Mirrors
/// `routes::ramp::resolve_ramp_review`.
///
/// Public so the unit test in `packages/api/tests/lps.rs` can exercise it
/// without the HTTP/DB layers.
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
