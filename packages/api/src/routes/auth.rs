//! Signature-based authorization endpoints.
//!
//! Flow (see `docs/product-specs/api-authorization.md`):
//!   1. `GET  /v1/auth/challenge` — for a known `(chain_id, address)`, generate a
//!      fresh single-use nonce, persist it, and return the exact message to sign.
//!   2. `POST /v1/auth/verify` — verify the signature over the *stored* challenge,
//!      clear the nonce (single-use), and return a 24h JWT carrying the address'
//!      roles.
//!
//! Protected endpoints live in their own route modules and gate access with the
//! `AuthClaims` extractor (see e.g. `routes::loan_book`).
//!
//! EVM signatures are verified with EIP-191 personal_sign; Stellar signatures
//! with SEP-0053 (Freighter `signMessage`). Dispatch is by `chain_id` via
//! `shared::chains::parse_chain_type`.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, OpenApi, ToSchema};
use uuid::Uuid;

use shared::chains::{parse_chain_type, ChainKind};
use shared::signature::{verify_personal_sign, verify_stellar_personal_sign};

use crate::auth::{Claims, SecurityAddon, TOKEN_TTL_SECS};
use crate::error::ApiError;
use crate::routes::common::resolve_chain;
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Query params for `GET /v1/auth/challenge`.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ChallengeQuery {
    /// Chain ID (optional — defaults to the server's `DEFAULT_CHAIN_ID`).
    pub chain_id: Option<i64>,
    /// Wallet address requesting a challenge (EVM `0x…` or Stellar `G…`).
    pub address: String,
}

/// Response for `GET /v1/auth/challenge`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChallengeResponse {
    /// The exact message the wallet must sign. Sign its raw UTF-8 bytes (EVM
    /// personal_sign / Stellar SEP-0053 `signMessage`).
    pub message: String,
    /// The single-use nonce embedded in `message` (also persisted server-side).
    pub nonce: String,
}

/// Request body for `POST /v1/auth/verify`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct VerifyRequest {
    /// Chain ID (optional — defaults to the server's `DEFAULT_CHAIN_ID`).
    pub chain_id: Option<i64>,
    /// Wallet address that produced the signature.
    pub address: String,
    /// Signature over the challenge message: EVM → hex (optional `0x`); Stellar →
    /// base64 (Stellar-native) or hex.
    pub signature: String,
}

/// Response for `POST /v1/auth/verify`.
#[derive(Debug, Serialize, ToSchema)]
pub struct VerifyResponse {
    /// Signed JWT to send as `Authorization: Bearer <token>`.
    pub token: String,
    /// Token lifetime in seconds.
    pub expires_in: i64,
}

/// OpenAPI doc bundle for the auth routes.
#[derive(OpenApi)]
#[openapi(
    paths(challenge, verify),
    components(schemas(ChallengeResponse, VerifyRequest, VerifyResponse, Claims)),
    modifiers(&SecurityAddon),
    tags((name = "Auth", description = "Signature-based authorization"))
)]
pub struct AuthDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/challenge", get(challenge))
        .route("/auth/verify", post(verify))
}

// ── Challenge message ──────────────────────────────────────────────────────

/// Build the canonical challenge message. This is the single source of truth for
/// the bytes the wallet signs — it must be byte-identical between issuance
/// (`challenge`) and verification (`verify`).
///
/// Deliberately a **single line** (no newlines): the message is transported in a
/// JSON `message` field, and embedded newlines are escaped as `\n` there — a
/// client that signs the JSON-escaped text instead of the decoded value would
/// produce a signature over different bytes. Keeping it newline-free removes that
/// footgun entirely.
fn challenge_message(address: &str, chain_id: i64, nonce: &str) -> String {
    format!(
        "Welcome to Pipeline! Sign this message to authenticate. \
         This request will not trigger a blockchain transaction or cost any gas. \
         Address: {address} Chain ID: {chain_id} Nonce: {nonce}"
    )
}

/// Normalize an address for `auth_users` storage/lookup: EVM addresses are
/// lowercased; Stellar `G…` Strkeys are left verbatim (case-sensitive base32).
fn normalize_address(chain_kind: ChainKind, address: &str) -> String {
    match chain_kind {
        ChainKind::Evm => address.to_lowercase(),
        ChainKind::Stellar => address.to_owned(),
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/auth/challenge",
    params(ChallengeQuery),
    responses(
        (status = 200, description = "Challenge to sign", body = ChallengeResponse),
        (status = 401, description = "Address is not authorized"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Auth"
)]
async fn challenge(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChallengeQuery>,
) -> Result<Json<ChallengeResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let chain_kind = parse_chain_type(chain_id).map_err(ApiError::Internal)?;
    let address = normalize_address(chain_kind, &query.address);

    // Reject unknown addresses — only the manually-seeded allow-list may log in.
    if state
        .auth_user_repo
        .find(chain_id, &address)
        .await?
        .is_none()
    {
        return Err(ApiError::Unauthorized(
            "address is not authorized".to_owned(),
        ));
    }

    let nonce = Uuid::new_v4().to_string();
    state
        .auth_user_repo
        .set_nonce(chain_id, &address, &nonce)
        .await?;

    let message = challenge_message(&address, chain_id, &nonce);
    Ok(Json(ChallengeResponse { message, nonce }))
}

#[utoipa::path(
    post,
    path = "/v1/auth/verify",
    request_body = VerifyRequest,
    responses(
        (status = 200, description = "Signature verified; JWT issued", body = VerifyResponse),
        (status = 401, description = "Unknown address, no outstanding challenge, or bad signature"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Auth"
)]
async fn verify(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    let chain_id = resolve_chain(&state, req.chain_id);
    let chain_kind = parse_chain_type(chain_id).map_err(ApiError::Internal)?;
    let address = normalize_address(chain_kind, &req.address);

    let user = state
        .auth_user_repo
        .find(chain_id, &address)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("address is not authorized".to_owned()))?;

    let nonce = user
        .nonce
        .ok_or_else(|| ApiError::Unauthorized("no outstanding challenge".to_owned()))?;

    let message = challenge_message(&address, chain_id, &nonce);

    let verified = match chain_kind {
        ChainKind::Evm => verify_personal_sign(&message, &req.signature, &address),
        ChainKind::Stellar => verify_stellar_personal_sign(&message, &req.signature, &address),
    };
    verified.map_err(|_| ApiError::Unauthorized("signature verification failed".to_owned()))?;

    // Single-use: clear the nonce so the same signature cannot be replayed.
    state.auth_user_repo.clear_nonce(chain_id, &address).await?;

    let keys = state
        .jwt_keys
        .as_ref()
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("JWT keys not configured")))?;
    let token = keys
        .issue_token(&address, chain_id, user.roles)
        .map_err(ApiError::Internal)?;

    Ok(Json(VerifyResponse {
        token,
        expires_in: TOKEN_TTL_SECS,
    }))
}
