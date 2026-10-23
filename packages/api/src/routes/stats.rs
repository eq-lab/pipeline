use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::error::ApiError;
use crate::formatting::iso_utc;
use crate::intervals::{Interval, MAX_SAMPLES};
use crate::routes::common::{ChainScope, LenientChainFilter, RequiredChain};
use crate::AppState;
use shared::time_weighted_return::linear_apy;

/// Maximum value the `/stats` endpoint accepts for the `apy_days` query parameter.
/// Coupled by product policy to `intervals::MAX_SAMPLES` (both 1_000) but semantically
/// distinct: this is a duration in days, not a sample count.
const MAX_APY_DAYS: u32 = 1_000;

/// Minimum price-history span inside the window for a non-null `apy` (7 days).
pub use shared::time_weighted_return::MIN_APY_SPAN_SECS;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/stats", get(get_stats))
        .route("/stats/prices", get(get_daily_prices))
        .route("/stats/vaults", get(get_vaults))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_stats, get_daily_prices, get_vaults),
    components(schemas(StatsQuery, StatsResponse, VaultStatsItem, PricesQuery, Interval, PricesResponse, PriceItem, VaultsResponse, VaultItem)),
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
    /// Chain the vault is deployed on.
    pub chain_id: i64,
    pub vault_address: String,
    /// Current share price (assets per 1 share).
    pub share_price: String,
    /// Simple-interest APY `(p_latest / p_oldest − 1) × 365 / days` as a decimal (0.0725 = 7.25%)
    /// over the window's oldest-to-latest price span. Null with under 7 days of span.
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
        ("apy_days" = Option<u32>, Query, description = "Number of days for APY calculation window (default 30, max 1000). Uses the oldest available price within this window; `apy` is null with under 7 days of span."),
        LenientChainFilter,
    ),
    responses(
        (status = 200, description = "Protocol vault statistics for the selected chain, or for all configured chains (in CHAINS order) when `chain_id` is omitted; a well-formed but unconfigured `chain_id` yields an empty list", body = StatsResponse),
        (status = 400, description = "Invalid query parameters; or malformed or repeated chain_id"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Stats"
)]
async fn get_stats(
    State(state): State<Arc<AppState>>,
    LenientChainFilter(scope): LenientChainFilter,
    Query(query): Query<StatsQuery>,
) -> Result<Json<StatsResponse>, ApiError> {
    if query.apy_days > MAX_APY_DAYS {
        return Err(ApiError::BadRequest(format!(
            "apy_days exceeds maximum of {MAX_APY_DAYS}"
        )));
    }
    let apy_days = query.apy_days.max(1);
    let chain_ids = match scope {
        ChainScope::All => state.chains.iter().map(|c| c.chain_id).collect(),
        ChainScope::One(c) => vec![c.chain_id],
        ChainScope::Unconfigured(_) => Vec::new(),
    };

    let mut vaults = Vec::new();
    for chain_id in chain_ids {
        vaults.extend(compute_stats(&state, chain_id, apy_days).await?.vaults);
    }
    Ok(Json(StatsResponse { vaults }))
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

        let apy = state
            .position_repo
            .get_oldest_price_in_window(chain_id, &v.address, since)
            .await?
            .and_then(|oldest| {
                let span = (latest.block_timestamp - oldest.block_timestamp).num_seconds();
                linear_apy(&latest.price, &oldest.price, span, MIN_APY_SPAN_SECS)
            });

        vaults.push(VaultStatsItem {
            chain_id,
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
        RequiredChain,
    ),
    responses(
        (status = 200, description = "Average share prices grouped by interval", body = PricesResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id; or invalid query parameters"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Prices"
)]
async fn get_daily_prices(
    State(state): State<Arc<AppState>>,
    RequiredChain(chain): RequiredChain,
    Query(query): Query<PricesQuery>,
) -> Result<Json<PricesResponse>, ApiError> {
    let chain_id = chain.chain_id;
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
        if est_samples > MAX_SAMPLES {
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
    params(LenientChainFilter),
    responses(
        (status = 200, description = "List of registered vaults on the selected chain, or on all configured chains (in CHAINS order) when `chain_id` is omitted; a well-formed but unconfigured `chain_id` yields an empty list", body = VaultsResponse),
        (status = 400, description = "Malformed or repeated chain_id"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Vaults"
)]
async fn get_vaults(
    State(state): State<Arc<AppState>>,
    LenientChainFilter(scope): LenientChainFilter,
) -> Result<Json<VaultsResponse>, ApiError> {
    let chain_ids: Vec<i64> = match scope {
        ChainScope::All => state.chains.iter().map(|c| c.chain_id).collect(),
        ChainScope::One(c) => vec![c.chain_id],
        ChainScope::Unconfigured(_) => Vec::new(),
    };
    let mut vaults = Vec::new();
    for chain_id in chain_ids {
        let rows = state.position_repo.get_vaults(chain_id).await?;
        vaults.extend(rows.into_iter().map(|v| VaultItem {
            chain_id: v.chain_id,
            address: v.address,
            name: v.name,
            asset_decimals: v.asset_decimals,
            share_decimals: v.share_decimals,
        }));
    }
    Ok(Json(VaultsResponse { vaults }))
}
