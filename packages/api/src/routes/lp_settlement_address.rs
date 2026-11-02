// spec: docs/product-specs/kyb-lp-verification.md#settlement-address

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use utoipa::{IntoParams, OpenApi, ToSchema};
use uuid::Uuid;

use shared::chains::{
    validate_evm_address, validate_stellar_account, validate_stellar_settlement_address, ChainKind,
};
use shared::lp_repo::{KybStatus, LinkOutcome, LpRow, SettlementLinkStore};
use shared::signature::{verify_personal_sign, verify_stellar_personal_sign};

use crate::auth::{AuthClaims, SecurityAddon};
use crate::config::ConfiguredChain;
use crate::error::ApiError;
use crate::formatting::iso_utc;
use crate::routes::auth::wallet::{challenge_domain, ChallengeResponse, CHALLENGE_TTL_SECS};
use crate::routes::common::{require_chain_id, RequiredChain};
use crate::routes::lps::{my_lp, with_documents, LpResponse};
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct LinkChallengeQuery {
    pub address: String,
    #[serde(default)]
    pub signer_address: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LinkVerifyRequest {
    #[schema(required = true)]
    pub chain_id: Option<i64>,
    pub address: String,
    #[serde(default)]
    pub signer_address: Option<String>,
    pub signature: String,
}

#[derive(OpenApi)]
#[openapi(
    paths(link_challenge, link_verify),
    components(schemas(LinkVerifyRequest, ChallengeResponse, LpResponse)),
    modifiers(&SecurityAddon)
)]
pub struct LpSettlementAddressDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/lps/me/link-address/challenge", get(link_challenge))
        .route("/lps/me/link-address/verify", post(link_verify))
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

pub const LINK_PROOF_FAILED: &str = "settlement address proof failed";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkTarget {
    pub kind: ChainKind,
    pub address: String,
    pub signer_address: String,
}

fn lp_kyb_status(lp: &LpRow) -> Result<KybStatus, ApiError> {
    KybStatus::from_str(&lp.kyb_status).map_err(|e| {
        ApiError::Internal(anyhow::anyhow!(
            "LP {} has an unparseable kyb_status: {e}",
            lp.id
        ))
    })
}

pub fn resolve_link_target(
    kind: ChainKind,
    address: &str,
    signer_address: Option<&str>,
) -> Result<LinkTarget, String> {
    let signer = signer_address.map(str::trim).filter(|s| !s.is_empty());
    let (address, signer_address) = match kind {
        ChainKind::Stellar => {
            let address = validate_stellar_settlement_address("address", address)
                .map_err(|e| e.to_string())?;
            let signer = match signer {
                Some(s) => {
                    validate_stellar_account("signer_address", s).map_err(|e| e.to_string())?
                }
                None if address.starts_with('C') => {
                    return Err("signer_address is required for a Stellar contract (C…) \
                                settlement address"
                        .to_owned())
                }
                None => address.clone(),
            };
            (address, signer)
        }
        ChainKind::Evm => {
            let address = validate_evm_address("address", address).map_err(|e| e.to_string())?;
            let signer = match signer {
                Some(s) => validate_evm_address("signer_address", s).map_err(|e| e.to_string())?,
                None => address.clone(),
            };
            (address, signer)
        }
    };
    Ok(LinkTarget {
        kind,
        address,
        signer_address,
    })
}

pub fn link_challenge_message(
    domain: &str,
    lp_id: i64,
    chain_id: i64,
    address: &str,
    signer_address: &str,
    nonce: &str,
    expires_at: DateTime<Utc>,
) -> String {
    let issued_at = expires_at - Duration::seconds(CHALLENGE_TTL_SECS);
    format!(
        "{domain} wants you to link a settlement address to your Pipeline LP account.\n\
         \n\
         Settlement address: {address}\n\
         Signed by: {signer_address}\n\
         \n\
         Sign this message to prove you control this wallet. This request will not trigger a blockchain transaction or cost any gas.\n\
         \n\
         LP ID: {lp_id}\n\
         Chain ID: {chain_id}\n\
         Nonce: {nonce}\n\
         Issued At: {issued}\n\
         Expiration Time: {expires}",
        issued = iso_utc(&issued_at),
        expires = iso_utc(&expires_at),
    )
}

pub fn link_refusal(
    lp: &LpRow,
    status: KybStatus,
    kind: ChainKind,
    holder: Option<i64>,
    address: &str,
) -> Result<(), String> {
    let name = kind.label();
    if !status.allows_address_write(lp.settlement_address(kind).is_some()) {
        return Err(match status {
            KybStatus::Failed => format!(
                "LP {} was refused at KYB and cannot set a settlement address",
                lp.id
            ),
            _ => format!(
                "LP {} has passed KYB; its {name} settlement address is fixed",
                lp.id
            ),
        });
    }
    if holder.is_some_and(|id| id != lp.id) {
        return Err(format!(
            "{name} settlement address {address} is already linked to another LP"
        ));
    }
    Ok(())
}

pub fn verify_link_signature(
    kind: ChainKind,
    message: &str,
    signature: &str,
    signer: &str,
) -> anyhow::Result<()> {
    match kind {
        ChainKind::Evm => verify_personal_sign(message, signature, signer),
        ChainKind::Stellar => verify_stellar_personal_sign(message, signature, signer),
    }
}

fn proof_failed() -> ApiError {
    ApiError::UnprocessableEntity(LINK_PROOF_FAILED.to_owned())
}

// ── Orchestration (generic over the store, so tests run it over a fake) ──────

pub async fn issue_link_challenge<S: SettlementLinkStore + ?Sized>(
    store: &S,
    lp: &LpRow,
    chain: ConfiguredChain,
    target: &LinkTarget,
    domain: &str,
    fresh_nonce: String,
) -> Result<ChallengeResponse, ApiError> {
    let status = lp_kyb_status(lp)?;
    let holder = store.address_holder(target.kind, &target.address).await?;
    link_refusal(lp, status, target.kind, holder, &target.address).map_err(ApiError::Conflict)?;

    let (nonce, expires_at) = store
        .issue_or_reuse_challenge(
            lp.id,
            chain.chain_id,
            &target.address,
            &target.signer_address,
            &fresh_nonce,
            CHALLENGE_TTL_SECS as i32,
        )
        .await?;
    let message = link_challenge_message(
        domain,
        lp.id,
        chain.chain_id,
        &target.address,
        &target.signer_address,
        &nonce,
        expires_at,
    );
    Ok(ChallengeResponse { message, nonce })
}

pub async fn verify_link<S: SettlementLinkStore + ?Sized>(
    store: &S,
    lp: &LpRow,
    chain: ConfiguredChain,
    target: &LinkTarget,
    signature: &str,
    domain: &str,
) -> Result<(), ApiError> {
    let status = lp_kyb_status(lp)?;
    let stored = store
        .find_challenge(lp.id, chain.chain_id)
        .await?
        .ok_or_else(proof_failed)?;
    if stored.address != target.address || stored.signer_address != target.signer_address {
        return Err(proof_failed());
    }

    let message = link_challenge_message(
        domain,
        lp.id,
        chain.chain_id,
        &stored.address,
        &stored.signer_address,
        &stored.nonce,
        stored.expires_at,
    );
    verify_link_signature(target.kind, &message, signature, &stored.signer_address)
        .map_err(|_| proof_failed())?;

    let consumed = store
        .consume_challenge(lp.id, chain.chain_id, &stored.nonce)
        .await?
        .ok_or_else(proof_failed)?;

    let holder = store.address_holder(target.kind, &consumed.address).await?;
    link_refusal(lp, status, target.kind, holder, &consumed.address).map_err(ApiError::Conflict)?;

    match store
        .link_settlement_address(
            lp.id,
            target.kind,
            &consumed.address,
            &consumed.signer_address,
        )
        .await?
    {
        LinkOutcome::Linked => Ok(()),
        LinkOutcome::Ineligible => Err(ApiError::Conflict(format!(
            "LP {} is no longer eligible to set a {} settlement address",
            lp.id,
            target.kind.label()
        ))),
        LinkOutcome::AddressTaken => Err(ApiError::Conflict(format!(
            "{} settlement address {} is already linked to another LP",
            target.kind.label(),
            consumed.address
        ))),
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/lps/me/link-address/challenge",
    params(RequiredChain, LinkChallengeQuery),
    responses(
        (status = 200, description = "Challenge to sign with the signer wallet", body = ChallengeResponse),
        (status = 400, description = "Missing or unknown chain_id, or a malformed address or signer_address"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 404, description = "This account has not registered an LP yet"),
        (status = 409, description = "The LP was refused at KYB, its address of this kind is fixed, or the address belongs to another LP"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn link_challenge(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    RequiredChain(chain): RequiredChain,
    Query(query): Query<LinkChallengeQuery>,
) -> Result<Json<ChallengeResponse>, ApiError> {
    let target = resolve_link_target(chain.kind, &query.address, query.signer_address.as_deref())
        .map_err(ApiError::BadRequest)?;
    let lp = my_lp(&claims, &state).await?;
    let domain = challenge_domain(&state.password_reset.app_base_url);
    let response = issue_link_challenge(
        &state.lp_repo,
        &lp,
        chain,
        &target,
        &domain,
        Uuid::new_v4().to_string(),
    )
    .await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/v1/lps/me/link-address/verify",
    request_body = LinkVerifyRequest,
    responses(
        (status = 200, description = "Address linked", body = LpResponse),
        (status = 400, description = "Missing or unknown chain_id, or a malformed address or signer_address"),
        (status = 401, description = "Missing, invalid, or expired token"),
        (status = 404, description = "This account has not registered an LP yet"),
        (status = 409, description = "The LP was refused at KYB, its address of this kind is fixed, or the address belongs to another LP"),
        (status = 422, description = "Proof failed: bad signature, unknown/expired/consumed challenge, or address/signer not matching the challenge (one shared body)"),
    ),
    security(("bearer_auth" = [])),
    tag = "Lps"
)]
async fn link_verify(
    AuthClaims(claims): AuthClaims,
    State(state): State<Arc<AppState>>,
    Json(req): Json<LinkVerifyRequest>,
) -> Result<Json<LpResponse>, ApiError> {
    let chain = require_chain_id(&state.chains, req.chain_id)?;
    let target = resolve_link_target(chain.kind, &req.address, req.signer_address.as_deref())
        .map_err(ApiError::BadRequest)?;
    let lp = my_lp(&claims, &state).await?;
    let domain = challenge_domain(&state.password_reset.app_base_url);
    verify_link(&state.lp_repo, &lp, chain, &target, &req.signature, &domain).await?;

    let refreshed = state.lp_repo.find(lp.id).await?.ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!(
            "LP {} vanished immediately after linking",
            lp.id
        ))
    })?;
    Ok(Json(with_documents(&state, refreshed).await?))
}
