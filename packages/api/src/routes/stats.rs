use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/stats", get(get_stats))
        .route("/stats/prices", get(get_daily_prices))
        .route("/stats/vaults", get(get_vaults))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_stats, get_daily_prices, get_vaults),
    components(schemas(StatsQuery, StatsResponse, VaultStatsItem, DailyPricesQuery, DailyPricesResponse, DailyPriceItem, VaultsResponse, VaultItem)),
    tags(
        (name = "Stats", description = "Protocol-level vault statistics"),
        (name = "Prices", description = "Share price history"),
        (name = "Vaults", description = "Vault registry")
    )
)]
pub struct StatsDoc;

#[derive(Deserialize, ToSchema)]
pub struct StatsQuery {
    /// Number of days for APY calculation window (default 30).
    #[serde(default = "default_apy_days")]
    pub apy_days: u32,
}

fn default_apy_days() -> u32 {
    30
}

#[derive(Serialize, ToSchema)]
pub struct VaultStatsItem {
    pub vault_address: String,
    /// Current share price (assets per 1 share).
    pub share_price: String,
    /// APY as a decimal (e.g. 0.0725 = 7.25%). Null if insufficient price history.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apy: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct StatsResponse {
    pub vaults: Vec<VaultStatsItem>,
}

#[utoipa::path(
    get,
    path = "/v1/stats",
    params(
        ("apy_days" = Option<u32>, Query, description = "Number of days for APY calculation window (default 30). Uses the oldest available price within this window."),
    ),
    responses(
        (status = 200, description = "Protocol vault statistics", body = StatsResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Stats"
)]
async fn get_stats(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StatsQuery>,
) -> impl IntoResponse {
    let apy_days = query.apy_days.max(1);

    match compute_stats(&state, apy_days).await {
        Ok(response) => Json(response).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to compute stats");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

async fn compute_stats(state: &AppState, apy_days: u32) -> anyhow::Result<StatsResponse> {
    let chain_id = state.chain_id;
    let since = Utc::now() - Duration::days(i64::from(apy_days));

    let db_vaults = state.position_repo.get_vaults(chain_id).await?;
    let mut vaults = Vec::new();

    for v in &db_vaults {
        let Some(latest) = state
            .position_repo
            .get_latest_share_price(chain_id, &v.address)
            .await?
        else {
            continue;
        };

        // Get the oldest price within the window, then compute APY from actual time delta
        let apy = state
            .position_repo
            .get_oldest_price_in_window(chain_id, &v.address, since)
            .await?
            .and_then(|oldest| {
                let actual_secs = (latest.block_timestamp - oldest.block_timestamp).num_seconds();
                #[allow(clippy::cast_precision_loss)] // seconds in a 30-day window fits f64
                let actual_days = actual_secs as f64 / 86400.0;
                if actual_days < 1.0 {
                    return None;
                }
                compute_apy(&latest.price, &oldest.price, actual_days)
            });

        vaults.push(VaultStatsItem {
            vault_address: v.address.clone(),
            share_price: latest.price.to_string(),
            apy: apy.map(|v| format!("{v:.6}")),
        });
    }

    Ok(StatsResponse { vaults })
}

#[derive(Deserialize, ToSchema)]
pub struct DailyPricesQuery {
    /// Vault address.
    pub vault: String,
    /// Number of days to look back (optional — omit for all history).
    pub days: Option<u32>,
}

#[derive(Serialize, ToSchema)]
pub struct DailyPriceItem {
    /// Date (YYYY-MM-DD).
    pub date: String,
    /// Average share price for the day.
    pub avg_price: String,
}

#[derive(Serialize, ToSchema)]
pub struct DailyPricesResponse {
    pub vault_address: String,
    pub prices: Vec<DailyPriceItem>,
}

#[utoipa::path(
    get,
    path = "/v1/stats/prices",
    params(
        ("vault" = String, Query, description = "Vault address"),
        ("days" = Option<u32>, Query, description = "Number of days to look back (omit for all history)"),
    ),
    responses(
        (status = 200, description = "Daily average share prices", body = DailyPricesResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Prices"
)]
async fn get_daily_prices(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DailyPricesQuery>,
) -> impl IntoResponse {
    let vault = query.vault.clone();
    let since = query
        .days
        .map(|d| Utc::now() - Duration::days(i64::from(d)));

    match state
        .position_repo
        .get_daily_avg_prices(state.chain_id, &vault, since)
        .await
    {
        Ok(rows) => {
            let prices = rows
                .into_iter()
                .map(|r| DailyPriceItem {
                    date: r.day.format("%Y-%m-%dT00:00:00Z").to_string(),
                    avg_price: r.avg_price.to_string(),
                })
                .collect();
            Json(DailyPricesResponse {
                vault_address: vault,
                prices,
            })
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch daily prices");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct VaultItem {
    pub chain_id: i64,
    pub address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub asset_decimals: i16,
    pub share_decimals: i16,
}

#[derive(Serialize, ToSchema)]
pub struct VaultsResponse {
    pub vaults: Vec<VaultItem>,
}

#[utoipa::path(
    get,
    path = "/v1/stats/vaults",
    responses(
        (status = 200, description = "List of registered vaults", body = VaultsResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Vaults"
)]
async fn get_vaults(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.position_repo.get_vaults(state.chain_id).await {
        Ok(rows) => {
            let vaults = rows
                .into_iter()
                .map(|v| VaultItem {
                    chain_id: v.chain_id,
                    address: v.address,
                    name: v.name,
                    asset_decimals: v.asset_decimals,
                    share_decimals: v.share_decimals,
                })
                .collect();
            Json(VaultsResponse { vaults }).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch vaults");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

/// Compute APY: (current / past) ^ (365 / actual_days) - 1
fn compute_apy(
    current: &bigdecimal::BigDecimal,
    past: &bigdecimal::BigDecimal,
    actual_days: f64,
) -> Option<f64> {
    if *past == 0i64 || actual_days < 1.0 {
        return None;
    }

    let current_f = f64::from_str(&current.to_string()).ok()?;
    let past_f = f64::from_str(&past.to_string()).ok()?;

    if past_f <= 0.0 || current_f <= 0.0 {
        return None;
    }

    let periods_per_year = 365.0 / actual_days;
    let period_return = current_f / past_f;
    let apy = period_return.powf(periods_per_year) - 1.0;

    if apy.is_finite() {
        Some(apy)
    } else {
        None
    }
}
