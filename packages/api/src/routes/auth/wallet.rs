//! Signature-based authorization endpoints.
//!
//! Flow (see `docs/product-specs/api-authorization.md`):
//!   1. `GET  /v1/auth/challenge` — for a known `(chain_id, address)`, reuse the
//!      unexpired nonce or issue a new 5-minute one, and return the message to sign.
//!   2. `POST /v1/auth/verify` — verify the signature over the message rebuilt from
//!      the *stored* nonce, consume the nonce atomically, and return a 24h JWT carrying the address'
//!      roles and the account the address belongs to.
//!
//! Protected endpoints live in their own route modules and gate access with the
//! `AuthClaims` extractor (see e.g. `routes::loan_book`).
//!
//! EVM signatures are verified with EIP-191 personal_sign; Stellar signatures
//! with SEP-0053 (Freighter `signMessage`). `chain_id` is required on both calls and
//! dispatch is by the kind of the matching configured chain (`AppState.chains`).

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use shared::chains::ChainKind;
use shared::login_attempt_repo::AttemptScope;
use shared::signature::{verify_personal_sign, verify_stellar_personal_sign};

use super::password::client_ip;
use crate::account_status::gate_request;
use crate::auth::TOKEN_TTL_SECS;
use crate::error::ApiError;
use crate::routes::common::{require_chain_id, RequiredChain};
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Query params for `GET /v1/auth/challenge`.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ChallengeQuery {
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
    /// Chain ID. Required; a missing or unconfigured id is a 400.
    #[schema(required = true)]
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

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/challenge", get(challenge))
        .route("/auth/verify", post(verify))
}

// ── Challenge message ──────────────────────────────────────────────────────

pub const CHALLENGE_TTL_SECS: i64 = 5 * 60;

pub const CHALLENGE_REQUEST_WINDOW_SECS: i32 = 60;

pub const MAX_CHALLENGES_PER_IP: i32 = 30;

pub const AUTH_FAILED: &str = "authentication failed";

pub fn within_challenge_limit(requests_including_this: i32) -> bool {
    requests_including_this <= MAX_CHALLENGES_PER_IP
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NonceDecision {
    Reuse {
        nonce: String,
        expires_at: DateTime<Utc>,
    },
    Rotate,
}

pub fn reuse_or_rotate(
    nonce: Option<&str>,
    expires_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> NonceDecision {
    match (nonce, expires_at) {
        (Some(nonce), Some(expires_at)) if expires_at > now => NonceDecision::Reuse {
            nonce: nonce.to_owned(),
            expires_at,
        },
        _ => NonceDecision::Rotate,
    }
}

pub fn challenge_domain(app_base_url: &str) -> String {
    reqwest::Url::parse(app_base_url)
        .ok()
        .and_then(|u| {
            u.host_str().map(|h| {
                u.port()
                    .map_or_else(|| h.to_owned(), |p| format!("{h}:{p}"))
            })
        })
        .unwrap_or_else(|| app_base_url.to_owned())
}

fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn challenge_message(
    domain: &str,
    address: &str,
    chain_id: i64,
    nonce: &str,
    expires_at: DateTime<Utc>,
) -> String {
    let issued_at = expires_at - Duration::seconds(CHALLENGE_TTL_SECS);
    format!(
        "{domain} wants you to sign in with your wallet:\n\
         {address}\n\
         \n\
         Sign this message to authenticate with Pipeline. This request will not trigger a blockchain transaction or cost any gas.\n\
         \n\
         Chain ID: {chain_id}\n\
         Nonce: {nonce}\n\
         Issued At: {issued}\n\
         Expiration Time: {expires}",
        issued = iso(issued_at),
        expires = iso(expires_at),
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
    params(RequiredChain, ChallengeQuery),
    responses(
        (status = 200, description = "Challenge to sign", body = ChallengeResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id"),
        (status = 401, description = "Address is not authorized"),
        (status = 429, description = "Too many challenge requests from this client"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Auth"
)]
pub async fn challenge(
    State(state): State<Arc<AppState>>,
    RequiredChain(chain): RequiredChain,
    headers: HeaderMap,
    Query(query): Query<ChallengeQuery>,
) -> Result<Json<ChallengeResponse>, ApiError> {
    let chain_id = chain.chain_id;
    let address = normalize_address(chain.kind, &query.address);

    if let Some(ip) = client_ip(&headers) {
        let requests = state
            .login_attempt_repo
            .record(
                AttemptScope::WalletChallengeIp,
                &ip,
                CHALLENGE_REQUEST_WINDOW_SECS,
            )
            .await?;
        if !within_challenge_limit(requests) {
            return Err(ApiError::TooManyRequests(
                "too many challenge requests — try again shortly".to_owned(),
            ));
        }
    }

    // Reject unknown addresses — only the manually-seeded allow-list may log in.
    let user = state
        .auth_user_repo
        .find(chain_id, &address)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("address is not authorized".to_owned()))?;

    let (nonce, expires_at) =
        match reuse_or_rotate(user.nonce.as_deref(), user.nonce_expires_at, Utc::now()) {
            NonceDecision::Reuse { nonce, expires_at } => (nonce, expires_at),
            NonceDecision::Rotate => {
                let fresh = Uuid::new_v4().to_string();
                let issued = state
                    .auth_user_repo
                    .issue_nonce(chain_id, &address, &fresh, CHALLENGE_TTL_SECS as i32)
                    .await?;
                if let Some(expires_at) = issued {
                    (fresh, expires_at)
                } else {
                    let raced = state.auth_user_repo.find(chain_id, &address).await?;
                    raced
                        .and_then(|u| Some((u.nonce?, u.nonce_expires_at?)))
                        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("nonce not issued")))?
                }
            }
        };

    let domain = challenge_domain(&state.password_reset.app_base_url);
    let message = challenge_message(&domain, &address, chain_id, &nonce, expires_at);
    Ok(Json(ChallengeResponse { message, nonce }))
}

#[utoipa::path(
    post,
    path = "/v1/auth/verify",
    request_body = VerifyRequest,
    responses(
        (status = 200, description = "Signature verified; JWT issued", body = VerifyResponse),
        (status = 400, description = "Missing or unknown chain_id"),
        (status = 401, description = "Unknown address, no live challenge, or bad signature (one shared body)"),
        (status = 403, description = "The account behind this wallet is suspended (account_suspended)"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Auth"
)]
pub async fn verify(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    let chain = require_chain_id(&state.chains, req.chain_id)?;
    let chain_id = chain.chain_id;
    let chain_kind = chain.kind;
    let address = normalize_address(chain_kind, &req.address);

    let denied = || ApiError::Unauthorized(AUTH_FAILED.to_owned());

    let user = state
        .auth_user_repo
        .find(chain_id, &address)
        .await?
        .ok_or_else(denied)?;

    let (nonce, expires_at) =
        match reuse_or_rotate(user.nonce.as_deref(), user.nonce_expires_at, Utc::now()) {
            NonceDecision::Reuse { nonce, expires_at } => (nonce, expires_at),
            NonceDecision::Rotate => return Err(denied()),
        };

    let domain = challenge_domain(&state.password_reset.app_base_url);
    let message = challenge_message(&domain, &address, chain_id, &nonce, expires_at);

    let verified = match chain_kind {
        ChainKind::Evm => verify_personal_sign(&message, &req.signature, &address),
        ChainKind::Stellar => verify_stellar_personal_sign(&message, &req.signature, &address),
    };
    verified.map_err(|_| denied())?;

    let user = state
        .auth_user_repo
        .consume_nonce(chain_id, &address, &nonce)
        .await?
        .ok_or_else(denied)?;

    let status = state.account_repo.find_status(user.account_id).await?;
    if let Some(refusal) = gate_request(status.as_deref()) {
        return Err(refusal.into());
    }

    let keys = state
        .jwt_keys
        .as_ref()
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("JWT keys not configured")))?;
    let token = keys
        .issue_wallet_token(&address, chain_id, user.account_id, user.roles)
        .map_err(ApiError::Internal)?;

    Ok(Json(VerifyResponse {
        token,
        expires_in: TOKEN_TTL_SECS,
    }))
}
