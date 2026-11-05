use std::collections::HashMap;
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
use crate::minter_cash_book::{build_wire_outs, to_base6_string, WireOutStatus};
use crate::routes::common::{ChainScope, LenientChainFilter};
use crate::AppState;
use shared::chains::ChainKind;
use shared::kyc_repo::kyt_gate_for_kind;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/requests", get(get_requests))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_requests),
    components(schemas(RequestsQuery, RequestsResponse, RequestItem, LpWireOutItem)),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wire_outs: Option<Vec<LpWireOutItem>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LpWireOutItem {
    pub chain_id: i64,
    pub id: i64,
    pub status: String,
    pub amount: String,
    pub requested_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<String>,
}

pub fn minter_chains_in_scope<S: std::hash::BuildHasher>(
    scope: ChainScope,
    chains: &[ConfiguredChain],
    minter_addresses: &HashMap<i64, String, S>,
) -> Vec<(i64, String)> {
    let in_scope: Vec<i64> = match scope {
        ChainScope::All => chains.iter().map(|c| c.chain_id).collect(),
        ChainScope::One(c) => vec![c.chain_id],
        ChainScope::Unconfigured(_) => Vec::new(),
    };
    in_scope
        .into_iter()
        .filter_map(|id| minter_addresses.get(&id).map(|m| (id, m.clone())))
        .collect()
}

pub fn degrade_wire_outs(
    result: anyhow::Result<Option<Vec<LpWireOutItem>>>,
) -> Option<Vec<LpWireOutItem>> {
    result.unwrap_or_else(|e| {
        tracing::warn!(error = %e, "failed to fetch wire-outs; omitting them");
        None
    })
}

async fn lp_wire_outs(
    state: &AppState,
    scope: ChainScope,
    wallet: &str,
    pending_only: bool,
) -> anyhow::Result<Option<Vec<LpWireOutItem>>> {
    let minters = minter_chains_in_scope(scope, &state.chains, &state.minter_addresses);
    if minters.is_empty() {
        return Ok(None);
    }
    let mut items: Vec<(i64, LpWireOutItem)> = Vec::new();
    for (chain_id, minter) in minters {
        let rows = state
            .contract_logs_repo
            .list_lp_wire_out_events(chain_id, &minter, wallet)
            .await?;
        for w in build_wire_outs(&rows) {
            if pending_only && w.status != WireOutStatus::Pending {
                continue;
            }
            items.push((
                w.requested_at,
                LpWireOutItem {
                    chain_id,
                    id: w.id,
                    status: w.status.as_str().to_owned(),
                    amount: to_base6_string(w.amount),
                    requested_at: iso_utc_from_unix(w.requested_at),
                    settled_at: w.settled_at.map(iso_utc_from_unix),
                    value_date: w.value_date.map(iso_utc_from_unix),
                    ref_hash: w.ref_hash,
                    cancelled_at: w.cancelled_at.map(iso_utc_from_unix),
                },
            ));
        }
    }
    items.sort_by(|(ta, a), (tb, b)| {
        tb.cmp(ta)
            .then_with(|| a.chain_id.cmp(&b.chain_id))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(Some(items.into_iter().map(|(_, i)| i).collect()))
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
                wire_outs: None,
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

    let (requests, wire_outs) = tokio::join!(
        state
            .kyc_repo
            .get_all_requests(&wallet, pending_only, kyt_gate, chain_id),
        lp_wire_outs(&state, scope, &wallet, pending_only),
    );
    let wire_outs = degrade_wire_outs(wire_outs);

    match requests {
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
            Json(RequestsResponse {
                requests: items,
                wire_outs,
            })
            .into_response()
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
