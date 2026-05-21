use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/requests", get(get_requests))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_requests),
    components(schemas(RequestsQuery, RequestsResponse, RequestItem)),
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
}

#[utoipa::path(
    get,
    path = "/v1/requests",
    params(
        ("wallet" = String, Query, description = "Wallet address"),
        ("status" = Option<String>, Query, description = "Filter: \"all\" (default) or \"pending\" (unclaimed only)"),
    ),
    responses(
        (status = 200, description = "List of requests and staking events", body = RequestsResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Analytics"
)]
async fn get_requests(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RequestsQuery>,
) -> impl IntoResponse {
    let wallet = query.wallet.to_lowercase();
    let pending_only = query.status.as_deref() == Some("pending");

    match state
        .kyc_repo
        .get_all_requests(&wallet, pending_only, state.crystal_enabled)
        .await
    {
        Ok(events) => {
            let items: Vec<RequestItem> = events
                .into_iter()
                .map(|e| RequestItem {
                    request_type: e.request_type,
                    request_id: e.request_id,
                    amount: e.amount,
                    assets: e.assets,
                    shares: e.shares,
                    status: e.status,
                    created_at: e.created_at,
                })
                .collect();
            Json(RequestsResponse { requests: items }).into_response()
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
