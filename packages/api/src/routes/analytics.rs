use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::config::ConfiguredChain;
use crate::formatting::iso_utc_from_unix;
use crate::routes::common::{ChainScope, LenientChainFilter};
use crate::routes::loan_book::loan_key;
use crate::AppState;
use shared::chains::ChainKind;
use shared::kyc_repo::kyt_gate_for_kind;
use shared::pocket_repo::{PocketClaimRow, PocketRepo};

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/requests", get(get_requests))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_requests),
    components(schemas(RequestsQuery, RequestsResponse, RequestItem, PocketClaimItem)),
    tags(
        (name = "Analytics", description = "Transaction history and activity feed")
    )
)]
pub struct AnalyticsDoc;

#[derive(Deserialize, ToSchema)]
pub struct RequestsQuery {
    pub wallet: String,
    /// "all" (default) or "pending" (only unclaimed requests).
    #[serde(default)]
    pub status: Option<String>,
}

/// A single request or staking event in the activity feed.
#[derive(Serialize, ToSchema)]
pub struct RequestItem {
    /// Chain the request or staking event was indexed on.
    pub chain_id: i64,
    /// Event type: "Deposit", "Withdraw", "Stake", or "Unstake".
    #[serde(rename = "type")]
    pub request_type: String,
    /// Deposit/Withdraw request ID (absent for Stake/Unstake).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// Amount in the underlying token (USDC for Deposit/Withdraw, PLUSD for Stake/Unstake).
    pub amount: String,
    /// ERC-4626 vault assets (only for Stake/Unstake).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assets: Option<String>,
    /// ERC-4626 vault shares (only for Stake/Unstake).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shares: Option<String>,
    /// Status: "PendingVerification", "PendingClaim", "Completed", or "VerificationFailed".
    pub status: String,
    /// ISO-8601 timestamp.
    pub created_at: String,
}

/// Response wrapper for the requests endpoint.
#[derive(Serialize, ToSchema)]
pub struct RequestsResponse {
    pub requests: Vec<RequestItem>,
    pub pocket_claims: Vec<PocketClaimItem>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PocketClaimItem {
    pub chain_id: i64,
    pub loan_id: String,
    pub amount: String,
    pub tx_hash: String,
    pub created_at: String,
}

pub fn includes_pocket_claims(status: Option<&str>) -> bool {
    status != Some("pending")
}

pub fn pocket_claim_items(chain_id: i64, rows: Vec<PocketClaimRow>) -> Vec<PocketClaimItem> {
    rows.into_iter()
        .map(|r| PocketClaimItem {
            chain_id,
            loan_id: loan_key(&r.loan_id),
            amount: r.paid.to_plain_string(),
            tx_hash: r.tx_hash,
            created_at: iso_utc_from_unix(r.block_timestamp),
        })
        .collect()
}

async fn pocket_claims(
    state: &AppState,
    scope: ChainScope,
    wallet: &str,
) -> anyhow::Result<Vec<PocketClaimItem>> {
    let chains: Vec<ConfiguredChain> = match scope {
        ChainScope::All => state.chains.clone(),
        ChainScope::One(c) => vec![c],
        ChainScope::Unconfigured(_) => Vec::new(),
    };
    let repo = PocketRepo::new(state.pool.clone());
    let mut out = Vec::new();
    for chain in chains {
        if chain.kind != ChainKind::Stellar {
            continue;
        }
        let Some(pocket) = state.pocket_addresses.get(&chain.chain_id) else {
            continue;
        };
        let rows = repo
            .list_holder_claims(chain.chain_id, pocket, wallet)
            .await?;
        out.extend(pocket_claim_items(chain.chain_id, rows));
    }
    Ok(out)
}

#[utoipa::path(
    get,
    path = "/v1/requests",
    params(
        ("wallet" = String, Query, description = "Wallet address"),
        ("status" = Option<String>, Query, description = "Filter: \"all\" (default) or \"pending\" (unclaimed only)"),
        LenientChainFilter,
    ),
    responses(
        (status = 200, description = "List of requests and staking events", body = RequestsResponse),
        (status = 400, description = "Malformed or repeated chain_id"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Analytics"
)]
async fn get_requests(
    State(state): State<Arc<AppState>>,
    LenientChainFilter(scope): LenientChainFilter,
    Query(query): Query<RequestsQuery>,
) -> impl IntoResponse {
    let wallet = query.wallet.to_lowercase();
    let pending_only = query.status.as_deref() == Some("pending");

    let chain_id = match scope {
        ChainScope::All => None,
        ChainScope::One(c) => Some(c.chain_id),
        ChainScope::Unconfigured(_) => {
            return Json(RequestsResponse {
                requests: Vec::new(),
                pocket_claims: Vec::new(),
            })
            .into_response();
        }
    };

    let kyt_gate = |id: i64| {
        let kind = state
            .chains
            .iter()
            .find(|c| c.chain_id == id)
            .map_or(ChainKind::Evm, |c| c.kind);
        kyt_gate_for_kind(kind, state.crystal_enabled, state.elliptic_enabled)
    };

    match state
        .kyc_repo
        .get_all_requests(&wallet, pending_only, kyt_gate, chain_id)
        .await
    {
        Ok(events) => {
            let items: Vec<RequestItem> = events
                .into_iter()
                .map(|e| RequestItem {
                    chain_id: e.chain_id,
                    request_type: e.request_type,
                    request_id: e.request_id,
                    amount: e.amount,
                    assets: e.assets,
                    shares: e.shares,
                    status: e.status,
                    created_at: e.created_at,
                })
                .collect();
            let claims = if includes_pocket_claims(query.status.as_deref()) {
                pocket_claims(&state, scope, query.wallet.trim()).await
            } else {
                Ok(Vec::new())
            };
            match claims {
                Ok(pocket_claims) => Json(RequestsResponse {
                    requests: items,
                    pocket_claims,
                })
                .into_response(),
                Err(e) => {
                    tracing::error!(error = %e, "failed to fetch pocket claims");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": "internal error"})),
                    )
                        .into_response()
                }
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch requests");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}
