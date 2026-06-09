use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::error::ApiError;
use crate::formatting::iso_utc;
use crate::intervals::Interval;
use crate::routes::common::resolve_chain;
use crate::AppState;

/// Maximum sample count for `/stats/prices` responses. Caps `(now - from) / step + 1`
/// at 1_000 (≈ 2.7 years daily, ≈ 19 years weekly, ≈ 42 days hourly). Matches the
/// cap used by `/stats/yield` (see `routes::portfolio::MAX_SAMPLES`).
const MAX_SAMPLES: u32 = 1_000;

/// Maximum value the `/stats` endpoint accepts for the `apy_days` query parameter.
/// Coupled by product policy to `MAX_SAMPLES` (both 1_000) but semantically distinct:
/// this is a duration in days, not a sample count.
const MAX_APY_DAYS: u32 = 1_000;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/stats", get(get_stats))
        .route("/stats/prices", get(get_daily_prices))
        .route("/stats/vaults", get(get_vaults))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_stats, get_daily_prices, get_vaults),
    components(schemas(StatsQuery, StatsResponse, VaultStatsItem, PricesQuery, Interval, PricesResponse, PriceItem, VaultsQuery, VaultsResponse, VaultItem)),
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
    /// Chain ID (optional — defaults to the server's DEFAULT_CHAIN_ID).
    pub chain_id: Option<i64>,
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
        ("apy_days" = Option<u32>, Query, description = "Number of days for APY calculation window (default 30, max 1000). Uses the oldest available price within this window."),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Protocol vault statistics", body = StatsResponse),
        (status = 400, description = "Invalid query parameters"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Stats"
)]
async fn get_stats(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StatsQuery>,
) -> Result<Json<StatsResponse>, ApiError> {
    if query.apy_days > MAX_APY_DAYS {
        return Err(ApiError::BadRequest(format!(
            "apy_days exceeds maximum of {MAX_APY_DAYS}"
        )));
    }
    let apy_days = query.apy_days.max(1);
    let chain_id = resolve_chain(&state, query.chain_id);

    Ok(Json(compute_stats(&state, chain_id, apy_days).await?))
}

async fn compute_stats(
    state: &AppState,
    chain_id: i64,
    apy_days: u32,
) -> anyhow::Result<StatsResponse> {
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
pub struct PricesQuery {
    /// Vault address.
    pub vault: String,
    /// Number of days to look back (optional — omit for all history).
    pub days: Option<u32>,
    /// Time grouping: "hourly", "daily" (default), or "weekly".
    #[serde(default)]
    pub interval: Interval,
    /// Chain ID (optional — defaults to DEFAULT_CHAIN_ID).
    pub chain_id: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct PriceItem {
    /// ISO-8601 timestamp for the start of the bucket.
    pub timestamp: String,
    /// Average share price for the period.
    pub avg_price: String,
}

#[derive(Serialize, ToSchema)]
pub struct PricesResponse {
    pub vault_address: String,
    pub interval: String,
    pub prices: Vec<PriceItem>,
}

#[utoipa::path(
    get,
    path = "/v1/stats/prices",
    params(
        ("vault" = String, Query, description = "Vault address"),
        ("days" = Option<u32>, Query, description = "Number of days to look back (omit for all history)"),
        ("interval" = Option<String>, Query, description = "Time grouping: \"hourly\", \"daily\" (default), or \"weekly\""),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Average share prices grouped by interval", body = PricesResponse),
        (status = 400, description = "Invalid query parameters"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Prices"
)]
async fn get_daily_prices(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PricesQuery>,
) -> Result<Json<PricesResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let step = query.interval.step_secs();

    // Resolve the lookback window. With `days = Some(d)` the start is `now - d × 86400`.
    // With `days = None` we look up the earliest recorded price and treat that as the
    // implicit window start — this mirrors `/stats/yield`, where full-history queries
    // are bounded by the earliest origination_date. Without this, full-history /prices
    // could silently return thousands of rows on long-running chains.
    let since = match query.days {
        Some(d) => Some(Utc::now() - Duration::days(i64::from(d))),
        None => {
            state
                .position_repo
                .get_earliest_price_timestamp(chain_id, &query.vault)
                .await?
        }
    };

    if let Some(start) = since {
        let secs_window = (Utc::now() - start).num_seconds().max(0);
        let est_samples = secs_window / step + 1;
        if est_samples > i64::from(MAX_SAMPLES) {
            return Err(ApiError::BadRequest(format!(
                "request could produce up to {est_samples} samples (max {MAX_SAMPLES}); reduce `days` or use a coarser `interval`"
            )));
        }
    }

    // When `since` is `None` here, the vault has no recorded prices yet — fall through
    // and return the (empty) result rather than erroring.
    let rows = state
        .position_repo
        .get_avg_prices(chain_id, &query.vault, query.interval.as_pg_trunc(), since)
        .await?;
    let prices = rows
        .into_iter()
        .map(|r| PriceItem {
            timestamp: iso_utc(&r.bucket),
            avg_price: r.avg_price.to_string(),
        })
        .collect();

    Ok(Json(PricesResponse {
        vault_address: query.vault,
        interval: query.interval.as_str().to_owned(),
        prices,
    }))
}

#[derive(Deserialize, ToSchema, Default)]
pub struct VaultsQuery {
    /// Chain ID (optional — defaults to DEFAULT_CHAIN_ID).
    pub chain_id: Option<i64>,
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
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "List of registered vaults", body = VaultsResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Vaults"
)]
async fn get_vaults(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VaultsQuery>,
) -> Result<Json<VaultsResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let rows = state.position_repo.get_vaults(chain_id).await?;
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
    Ok(Json(VaultsResponse { vaults }))
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
