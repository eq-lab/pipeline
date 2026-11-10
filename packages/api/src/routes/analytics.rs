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
use crate::minter_cash_book::{
    build_lp_wire_ins, build_wire_outs, to_base6_string, CashBookWireIn, WireOutStatus,
};
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
    components(schemas(
        RequestsQuery,
        RequestsResponse,
        RequestItem,
        LpWireOutItem,
        LpWireInItem,
        PocketClaimItem
    )),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Stellar Withdraw only: cumulative PLUSD queue offset including this request, raw integer at token decimals (queued_ahead = queued_through - amount).
    pub queued_through: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Stellar Withdraw only, once claimed: USDC paid, raw integer at token decimals, floor(amount x rate at the claim / 1e6).
    pub usdc_paid: Option<String>,
}

/// Response wrapper for the requests endpoint.
#[derive(Serialize, ToSchema)]
pub struct RequestsResponse {
    pub requests: Vec<RequestItem>,
    pub pocket_claims: Vec<PocketClaimItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wire_outs: Option<Vec<LpWireOutItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wire_ins: Option<Vec<LpWireInItem>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LpWireInItem {
    pub chain_id: i64,
    pub id: i64,
    pub status: String,
    pub amount: String,
    pub value_date: String,
    pub ref_hash: String,
    pub recorded_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_at: Option<String>,
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

pub fn degrade_minter_list<T>(
    what: &str,
    result: anyhow::Result<Option<Vec<T>>>,
) -> Option<Vec<T>> {
    result.unwrap_or_else(|e| {
        tracing::warn!(error = %e, list = what, "failed to fetch a minter list; omitting it");
        None
    })
}

pub fn lp_wire_in_items(per_chain: Vec<(i64, Vec<CashBookWireIn>)>) -> Vec<LpWireInItem> {
    let mut items: Vec<(i64, LpWireInItem)> = per_chain
        .into_iter()
        .flat_map(|(chain_id, wires)| {
            wires.into_iter().map(move |w| {
                let sort_at = w.assigned_at.unwrap_or(w.recorded_at);
                (
                    sort_at,
                    LpWireInItem {
                        chain_id,
                        id: w.id,
                        status: w.status.as_str().to_owned(),
                        amount: to_base6_string(w.amount),
                        value_date: iso_utc_from_unix(w.value_date),
                        ref_hash: w.ref_hash,
                        recorded_at: iso_utc_from_unix(w.recorded_at),
                        assigned_at: w.assigned_at.map(iso_utc_from_unix),
                    },
                )
            })
        })
        .collect();
    items.sort_by(|(ta, a), (tb, b)| {
        tb.cmp(ta)
            .then_with(|| a.chain_id.cmp(&b.chain_id))
            .then_with(|| a.id.cmp(&b.id))
    });
    items.into_iter().map(|(_, i)| i).collect()
}

async fn lp_wire_ins(
    state: &AppState,
    scope: ChainScope,
    wallet_strkey: &str,
    pending_only: bool,
) -> anyhow::Result<Option<Vec<LpWireInItem>>> {
    let minters = minter_chains_in_scope(scope, &state.chains, &state.minter_addresses);
    if minters.is_empty() {
        return Ok(None);
    }
    if pending_only {
        return Ok(Some(Vec::new()));
    }
    let mut per_chain = Vec::new();
    for (chain_id, minter) in minters {
        if wallet_strkey == minter {
            continue;
        }
        let rows = state
            .contract_logs_repo
            .list_lp_wire_in_events(chain_id, &minter, wallet_strkey)
            .await?;
        per_chain.push((chain_id, build_lp_wire_ins(&rows, &minter, wallet_strkey)));
    }
    Ok(Some(lp_wire_in_items(per_chain)))
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
            .list_lp_wire_out_events(chain_id, &minter, &wallet.to_uppercase())
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
                wire_outs: None,
                wire_ins: None,
                pocket_claims: Vec::new(),
            })
            .into_response();
        }
    };

    let chain_kind = |id: i64| {
        state
            .chains
            .iter()
            .find(|c| c.chain_id == id)
            .map(|c| c.kind)
    };
    let kyt_gate =
        |kind: ChainKind| kyt_gate_for_kind(kind, state.crystal_enabled, state.elliptic_enabled);

    let claims_wanted = includes_pocket_claims(query.status.as_deref());
    let wire_in_wallet = wallet.to_uppercase();
    let (requests, wire_outs, wire_ins, claims) = tokio::join!(
        state
            .kyc_repo
            .get_all_requests(&wallet, pending_only, chain_kind, kyt_gate, chain_id),
        lp_wire_outs(&state, scope, &wallet, pending_only),
        lp_wire_ins(&state, scope, &wire_in_wallet, pending_only),
        async {
            if claims_wanted {
                pocket_claims(&state, scope, query.wallet.trim()).await
            } else {
                Ok(Vec::new())
            }
        },
    );
    let wire_outs = degrade_minter_list("wire-outs", wire_outs);
    let wire_ins = degrade_minter_list("wire-ins", wire_ins);

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
                    queued_through: e.queued_through,
                    usdc_paid: e.usdc_paid,
                })
                .collect();
            match claims {
                Ok(pocket_claims) => Json(RequestsResponse {
                    requests: items,
                    pocket_claims,
                    wire_outs,
                    wire_ins,
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
