use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::routes::common::resolve_chain;
use crate::routes::vouchers::normalise_wallet;
use crate::AppState;
use shared::chains::parse_chain_type;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/pnl", get(get_pnl))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_pnl),
    components(schemas(PnlQuery, PnlResponse, VaultPnl)),
    tags(
        (name = "PnL", description = "Staking profit and loss")
    )
)]
pub struct PnlDoc;

#[derive(Deserialize, ToSchema)]
pub struct PnlQuery {
    pub wallet: String,
    /// Chain ID (optional — defaults to DEFAULT_CHAIN_ID).
    pub chain_id: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct VaultPnl {
    pub vault_address: String,
    pub shares_balance: String,
    pub avg_cost_basis: String,
    pub current_share_price: String,
    pub unrealized_pnl: String,
    pub realized_pnl: String,
    pub total_pnl: String,
}

#[derive(Serialize, ToSchema)]
pub struct PnlResponse {
    pub wallet: String,
    pub positions: Vec<VaultPnl>,
    pub total_unrealized_pnl: String,
    pub total_realized_pnl: String,
    pub total_pnl: String,
    /// Wallet's effective annualized return across all positions. Null if no history.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_apy: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/pnl",
    params(
        ("wallet" = String, Query, description = "Wallet address"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Staking PnL for the wallet", body = PnlResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "PnL"
)]
async fn get_pnl(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PnlQuery>,
) -> impl IntoResponse {
    let chain_id = resolve_chain(&state, query.chain_id);

    let chain_kind = match parse_chain_type(chain_id) {
        Ok(k) => k,
        Err(e) => {
            tracing::error!(error = %e, chain_id, "failed to determine chain type");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "invalid chain type configuration"})),
            )
                .into_response();
        }
    };

    let wallet = match normalise_wallet(chain_kind, &query.wallet) {
        Ok(w) => w,
        Err((status, msg)) => {
            return (status, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    };

    match compute_pnl(&state, &wallet, chain_id).await {
        Ok(response) => Json(response).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to compute PnL");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

async fn compute_pnl(state: &AppState, wallet: &str, chain_id: i64) -> anyhow::Result<PnlResponse> {
    let summaries = state
        .position_repo
        .get_position_summaries(chain_id, wallet)
        .await?;

    let zero = BigDecimal::from(0);
    let mut total_unrealized = zero.clone();
    let mut total_realized = zero.clone();
    let mut total_cost = zero.clone();
    let mut total_value = zero.clone();
    let mut positions = Vec::with_capacity(summaries.len());

    for s in summaries {
        let current_price = state
            .position_repo
            .get_latest_share_price(chain_id, &s.vault_address)
            .await?
            .map_or_else(|| s.avg_buy_share_price.clone(), |s| s.price);

        let unrealized = &s.shares_balance * (&current_price - &s.avg_buy_share_price);
        let realized = &s.total_realized_pnl;
        let total = &unrealized + realized;

        total_cost = &total_cost + &s.shares_balance * &s.avg_buy_share_price;
        total_value = &total_value + &s.shares_balance * &current_price;
        total_unrealized = &total_unrealized + &unrealized;
        total_realized = &total_realized + realized;

        positions.push(VaultPnl {
            vault_address: s.vault_address,
            shares_balance: s.shares_balance.to_string(),
            avg_cost_basis: s.avg_buy_share_price.to_string(),
            current_share_price: current_price.to_string(),
            unrealized_pnl: unrealized.to_string(),
            realized_pnl: realized.to_string(),
            total_pnl: total.to_string(),
        });
    }

    let total_pnl = &total_unrealized + &total_realized;

    // Compute wallet's effective APY from first stake to now
    let avg_apy = state
        .position_repo
        .get_first_stake_timestamp(chain_id, wallet)
        .await?
        .and_then(|first_ts| {
            let now_ts = Utc::now().timestamp();
            #[allow(clippy::cast_precision_loss)]
            let days = (now_ts - first_ts) as f64 / 86400.0;
            if days < 1.0 {
                return None;
            }
            let cost_f = f64::from_str(&total_cost.to_string()).ok()?;
            let value_f = f64::from_str(&total_value.to_string()).ok()?;
            if cost_f <= 0.0 || value_f <= 0.0 {
                return None;
            }
            let overall_return = value_f / cost_f;
            let apy = overall_return.powf(365.0 / days) - 1.0;
            if apy.is_finite() {
                Some(apy)
            } else {
                None
            }
        });

    Ok(PnlResponse {
        wallet: wallet.to_owned(),
        positions,
        total_unrealized_pnl: total_unrealized.to_string(),
        total_realized_pnl: total_realized.to_string(),
        total_pnl: total_pnl.to_string(),
        avg_apy: avg_apy.map(|v| format!("{v:.6}")),
    })
}
