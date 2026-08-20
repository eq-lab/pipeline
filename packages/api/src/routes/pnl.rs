use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::error::ApiError;
use crate::formatting::iso_utc;
use crate::intervals::{Interval, MAX_SAMPLES};
use crate::routes::common::resolve_chain;
use crate::routes::vouchers::normalise_wallet;
use crate::AppState;
use shared::chains::parse_chain_type;
use shared::position_repo::PositionHistoryBucket;

/// Serves two path prefixes: `/pnl` (point-in-time profit and loss, including
/// unrealized) and `/positions` (historical balances and cost basis). They share
/// this module because both read `PositionRepo` through the same wallet
/// normalisation and chain resolution — but they are deliberately named apart,
/// because the history series carries no unrealized PnL.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/pnl", get(get_pnl))
        .route("/positions/history", get(get_position_history))
}

#[derive(OpenApi)]
#[openapi(
    paths(get_pnl, get_position_history),
    components(schemas(
        PnlQuery,
        PnlResponse,
        VaultPnl,
        PositionHistoryQuery,
        Interval,
        PositionHistoryResponse,
        VaultPositionHistory,
        PositionHistoryItem
    )),
    tags(
        (name = "PnL", description = "Staking profit and loss"),
        (name = "Positions", description = "Historical share balances and cost basis")
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

    // Compute wallet's effective APY from its first share position to now
    let avg_apy = state
        .position_repo
        .get_first_position_timestamp(chain_id, wallet)
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

// ── Position history ─────────────────────────────────────────────────────────

#[derive(Deserialize, ToSchema)]
pub struct PositionHistoryQuery {
    pub wallet: String,
    /// Vault address (optional — omit for every vault the wallet has touched).
    pub vault: Option<String>,
    /// Number of days to look back (optional — omit for all history).
    pub days: Option<u32>,
    /// Time grouping: "hourly", "daily" (default), or "weekly".
    #[serde(default)]
    pub interval: Interval,
    /// Chain ID (optional — defaults to DEFAULT_CHAIN_ID).
    pub chain_id: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct PositionHistoryItem {
    /// ISO-8601 timestamp for the start of the bucket.
    pub timestamp: String,
    /// Share balance at the **close** of the bucket.
    pub shares_balance: String,
    /// Average buy share price at the close of the bucket.
    pub avg_cost_basis: String,
    /// Realized PnL accumulated over the wallet's full history up to and
    /// including this bucket — not just within the requested window.
    pub cumulative_realized_pnl: String,
}

#[derive(Serialize, ToSchema)]
pub struct VaultPositionHistory {
    pub vault_address: String,
    pub history: Vec<PositionHistoryItem>,
}

#[derive(Serialize, ToSchema)]
pub struct PositionHistoryResponse {
    pub wallet: String,
    pub interval: String,
    pub vaults: Vec<VaultPositionHistory>,
}

/// Position history for a wallet, bucketed like `/v1/stats/prices`.
///
/// Each entry is the **closing** position for its bucket, and buckets with no
/// activity are omitted rather than forward-filled — a position persists until
/// the next entry, so clients should step-interpolate. Emitting rows for quiet
/// periods would fabricate history the indexer never observed.
///
/// Covers every balance-moving event: staking mint/burn plus peer-to-peer
/// `ShareTransfer`, so a wallet that only ever received shares still has a
/// history.
///
/// This is a **balance and cost-basis** series, deliberately not named a PnL
/// series: it carries realized PnL (which the position ledger knows) but no
/// unrealized PnL, which would require joining the per-bucket share price from
/// `share_prices`. Use `/v1/pnl` for point-in-time unrealized and total PnL.
#[utoipa::path(
    get,
    path = "/v1/positions/history",
    params(
        ("wallet" = String, Query, description = "Wallet address"),
        ("vault" = Option<String>, Query, description = "Vault address (optional — omit for all vaults the wallet has touched)"),
        ("days" = Option<u32>, Query, description = "Number of days to look back (omit for all history)"),
        ("interval" = Option<String>, Query, description = "Time grouping: \"hourly\", \"daily\" (default), or \"weekly\""),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Position history grouped by interval", body = PositionHistoryResponse),
        (status = 400, description = "Invalid query parameters"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Positions"
)]
async fn get_position_history(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PositionHistoryQuery>,
) -> Result<Json<PositionHistoryResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);

    let chain_kind = parse_chain_type(chain_id).map_err(|e| {
        tracing::error!(error = %e, chain_id, "failed to determine chain type");
        ApiError::Internal(anyhow::anyhow!("invalid chain type configuration"))
    })?;

    let wallet = normalise_wallet(chain_kind, &query.wallet)
        .map_err(|(_, msg)| ApiError::BadRequest(msg))?;

    // Resolve the lookback window. `days = Some(d)` starts at `now - d × 86400`.
    // `days = None` means all history, bounded by the wallet's first position so
    // the sample cap below has something real to check — mirroring how
    // `/stats/prices` bounds full-history queries by the earliest recorded price.
    let since = match query.days {
        Some(d) => Some(Utc::now() - Duration::days(i64::from(d))),
        None => state
            .position_repo
            .get_first_position_timestamp(chain_id, &wallet)
            .await?
            .and_then(|ts| DateTime::from_timestamp(ts, 0)),
    };

    if let Some(start) = since {
        let step = query.interval.step_secs();
        let secs_window = (Utc::now() - start).num_seconds().max(0);
        let est_samples = secs_window / step + 1;
        if est_samples > MAX_SAMPLES {
            return Err(ApiError::BadRequest(format!(
                "request could produce up to {est_samples} samples (max {MAX_SAMPLES}); reduce `days` or use a coarser `interval`"
            )));
        }
    }

    // `since = None` here means the wallet has no indexed position at all — fall
    // through and return an empty series rather than erroring.
    let rows = state
        .position_repo
        .get_position_history(
            chain_id,
            &wallet,
            query.vault.as_deref(),
            query.interval.as_pg_trunc(),
            since,
        )
        .await?;

    Ok(Json(PositionHistoryResponse {
        wallet,
        interval: query.interval.as_str().to_owned(),
        vaults: group_history_by_vault(rows),
    }))
}

/// Fold flat history rows into one series per vault.
///
/// Relies on the repo returning rows ordered by `(vault_address, bucket)`, so a
/// change of vault starts a new group and a single pass suffices. Kept separate
/// from the handler so it is testable without a database.
pub fn group_history_by_vault(rows: Vec<PositionHistoryBucket>) -> Vec<VaultPositionHistory> {
    let mut vaults: Vec<VaultPositionHistory> = Vec::new();
    for row in rows {
        let item = PositionHistoryItem {
            timestamp: iso_utc(&row.bucket),
            shares_balance: row.shares_balance.to_string(),
            avg_cost_basis: row.avg_buy_share_price.to_string(),
            cumulative_realized_pnl: row.cumulative_realized_pnl.to_string(),
        };
        match vaults.last_mut() {
            Some(last) if last.vault_address == row.vault_address => last.history.push(item),
            _ => vaults.push(VaultPositionHistory {
                vault_address: row.vault_address,
                history: vec![item],
            }),
        }
    }
    vaults
}
