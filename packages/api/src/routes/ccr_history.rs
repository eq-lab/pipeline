//! Per-loan CCR history endpoint (`GET /v1/loan-book/{loan_id}/ccr-history`).
//!
//! Read-only. Produces a time series of Collateral Coverage Ratio (CCR) points for
//! charting on the loan-detail page. The series is **price-derived**: it reuses the
//! exact valuation machinery of `routes::collateral_valuation`
//! (`shared::collateral_valuation::compute_collateral` + `ccr_bps`) and re-evaluates
//! it at each point of a fixed sampling grid, varying **only** the reference prices —
//! sampled from the stored `loan_asset_prices` history. A concentrate prices each
//! payable metal independently, so one price series is walked **per metal-asset**
//! (gold→XAU, silver→XAG) under the loan's `price_provider`; standard goods walks the
//! single headline asset. A grid point is emitted only once every required asset has a
//! known price at or before it.
//!
//! The caller supplies a `from` timestamp and a `step` (dt) in seconds; the grid is
//! `from, from+step, …` up to `to` (default: now). At each grid point the price is the
//! latest sample at or before that instant (an as-of walk seeded by the last price
//! before `from`).
//!
//! Two deliberate approximations, both inherent to "only price varies" (documented so
//! consumers don't over-read the curve):
//! - Non-price inputs (quantity / assay / offtake) are held at their **current**
//!   values across the whole window — the valuation record is not historically
//!   versioned.
//! - The CCR denominator (outstanding senior principal) is held at the **current**
//!   loan-snapshot value rather than reconstructed per point from repayment history.
//!
//! Thresholds (`watchlist` / `default` guide-lines) are protocol-wide config, echoed
//! for chart annotation — see `AppState::ccr_watchlist_bps` / `ccr_default_bps`.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, OpenApi, ToSchema};

use shared::collateral_valuation::{asset_for_metal, ccr_bps, compute_collateral};
use shared::collateral_valuation_repo::{
    AssayRow, CollateralValuationRow, OfftakeTermsRow, ValuationMode,
};

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::formatting::iso_utc_from_unix;
use crate::routes::common::resolve_chain;
use crate::AppState;

/// On-chain USDC fixed-point scale (`1e6`). Senior principal is stored base-6 but the
/// CCR ratio is taken against a plain-USD collateral value, so it is scaled down first
/// (matches `routes::collateral_valuation::USDC_SCALE`).
const USDC_SCALE: i64 = 1_000_000;

/// Upper bound on grid points per request. Each point runs a full collateral
/// valuation, so an unbounded `(to - from) / step` would be a cheap way to burn CPU.
/// ~10k points covers a year at hourly resolution; finer needs a coarser `step`.
const MAX_POINTS: i64 = 10_000;

// ── Query ────────────────────────────────────────────────────────────────────

/// Default sampling interval: one day, in seconds.
const DEFAULT_STEP_SECONDS: i64 = 86_400;

/// Query parameters for the CCR history endpoint.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CcrHistoryQuery {
    /// Series start, Unix epoch **seconds** (inclusive). Required.
    pub from: i64,
    /// Series end, Unix epoch seconds (inclusive). Optional — defaults to now.
    pub to: Option<i64>,
    /// Sampling interval (dt) in **seconds**. Optional — defaults to 86400 (one day);
    /// must be ≥ 1.
    pub step: Option<i64>,
    /// Chain ID (optional — defaults to `DEFAULT_CHAIN_ID`).
    pub chain_id: Option<i64>,
}

// ── Response DTOs ──────────────────────────────────────────────────────────────

/// Response for `GET /v1/loan-book/{loan_id}/ccr-history`.
#[derive(Debug, Serialize, ToSchema)]
pub struct CcrHistoryResponse {
    pub loan_id: String,
    pub chain_id: i64,
    /// Echo of the resolved window (ISO-8601 UTC) and step.
    pub from: String,
    pub to: String,
    pub step_seconds: i64,
    /// CCR samples, ascending by time. A grid point with no known price yet (before
    /// the first stored sample) is omitted, so the series starts where data begins.
    pub points: Vec<CcrPoint>,
}

/// One CCR sample.
#[derive(Debug, Serialize, ToSchema)]
pub struct CcrPoint {
    /// ISO-8601 UTC timestamp of the grid point.
    pub timestamp: String,
    /// CCR in basis points (`12_000` = 120%).
    pub ccr_bps: u32,
}

/// OpenAPI doc bundle for the CCR history route.
#[derive(OpenApi)]
#[openapi(
    paths(get_ccr_history),
    components(schemas(CcrHistoryResponse, CcrPoint)),
    modifiers(&SecurityAddon)
)]
pub struct CcrHistoryDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/loan-book/{loan_id}/ccr-history", get(get_ccr_history))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/loan-book/{loan_id}/ccr-history",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id"),
        CcrHistoryQuery,
    ),
    responses(
        (status = 200, description = "Per-loan CCR time series", body = CcrHistoryResponse),
        (status = 400, description = "Malformed loan id or invalid from/step/to range"),
        (status = 404, description = "No valuation anchor for this loan"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "LoanBook"
)]
async fn get_ccr_history(
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    Query(query): Query<CcrHistoryQuery>,
) -> Result<Json<CcrHistoryResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let loan_id = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let to = query.to.unwrap_or(now);
    let step = query.step.unwrap_or(DEFAULT_STEP_SECONDS);

    // Validate the grid before touching the DB.
    validate_window(query.from, step, to)?;

    let repo = &state.collateral_valuation_repo;
    let anchor = repo.get_anchor(chain_id, &loan_id).await?.ok_or_else(|| {
        ApiError::NotFound(format!(
            "no valuation for loan {loan_id} on chain {chain_id}"
        ))
    })?;

    // Current (constant across the window) valuation inputs. Quantity is not fetched
    // separately — it lives on `anchor` itself.
    let assay = repo.latest_assay(chain_id, &loan_id).await?;
    let offtake = repo.latest_offtake(chain_id, &loan_id).await?;

    // CCR denominator: current outstanding senior principal, in USD.
    let senior_usd = loan_snapshot_senior_usd(&state, chain_id, &loan_id, now).await?;

    // The assets this loan must price: each payable metal's own asset for a concentrate
    // (gold→XAU, silver→XAG), or the headline asset for standard goods. All share the
    // anchor's provider.
    let required_assets = required_assets(&anchor, offtake.as_ref());

    // One as-of price series per required asset: a seed at `from` plus every sample in
    // (from, to]. Merged into a per-grid-point price map keyed by asset.
    let from_dt = unix_to_utc(query.from)?;
    let to_dt = unix_to_utc(to)?;
    let mut per_asset = Vec::with_capacity(required_assets.len());
    for asset in &required_assets {
        let seed = state
            .loan_asset_price_repo
            .price_at_or_before(asset, &anchor.price_provider, from_dt)
            .await?
            .map(|(ts, p)| (ts.timestamp(), p));
        let window: Vec<(i64, BigDecimal)> = state
            .loan_asset_price_repo
            .prices_in_window(asset, &anchor.price_provider, from_dt, to_dt)
            .await?
            .into_iter()
            .map(|(ts, p)| (ts.timestamp(), p))
            .collect();
        per_asset.push((
            asset.clone(),
            resolve_grid(query.from, to, step, seed, &window),
        ));
    }

    let points = merge_price_grids(query.from, to, step, &per_asset);

    build_response(
        &loan_id,
        chain_id,
        query.from,
        to,
        step,
        &anchor,
        assay.as_ref(),
        offtake.as_ref(),
        senior_usd.as_ref(),
        &points,
    )
    .map(Json)
}

/// Outstanding senior principal in USD = `(original_senior_tranche -
/// senior_principal_repaid) / 1e6`, read from the latest loan snapshot. `None` when the
/// loan has no snapshot (never indexed). Mirrors
/// `routes::collateral_valuation::loan_snapshot_senior_usd`.
async fn loan_snapshot_senior_usd(
    state: &AppState,
    chain_id: i64,
    loan_id: &BigDecimal,
    now: i64,
) -> Result<Option<BigDecimal>, ApiError> {
    let snapshots = state
        .contract_logs_repo
        .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, now)
        .await?;

    let Some(row) = snapshots.into_iter().find(|r| &r.loan_id == loan_id) else {
        return Ok(None);
    };

    let outstanding_micro =
        &row.snapshot.original_senior_tranche - &row.snapshot.repayment.senior_principal_repaid;
    Ok(Some(outstanding_micro / BigDecimal::from(USDC_SCALE)))
}

/// Convert Unix seconds to a UTC datetime, rejecting an out-of-range value.
fn unix_to_utc(secs: i64) -> Result<DateTime<chrono::Utc>, ApiError> {
    DateTime::from_timestamp(secs, 0)
        .ok_or_else(|| ApiError::BadRequest(format!("timestamp out of range: {secs}")))
}

// ── Pure core (testable: no DB, no clock) ──────────────────────────────────────

/// Validate the sampling grid: `from`/`to` non-negative, `step ≥ 1`, `from ≤ to`, and
/// the resulting point count within `MAX_POINTS`. `to - from` uses `checked_sub` so an
/// extreme `from` can't overflow (debug panic / release wraparound) before the count
/// check runs.
pub fn validate_window(from: i64, step: i64, to: i64) -> Result<(), ApiError> {
    if from < 0 {
        return Err(ApiError::BadRequest(format!("from ({from}) must be ≥ 0")));
    }
    if to < 0 {
        return Err(ApiError::BadRequest(format!("to ({to}) must be ≥ 0")));
    }
    if step < 1 {
        return Err(ApiError::BadRequest(format!(
            "step must be ≥ 1 second, got {step}"
        )));
    }
    if from > to {
        return Err(ApiError::BadRequest(format!(
            "from ({from}) must be ≤ to ({to})"
        )));
    }
    let span = to.checked_sub(from).ok_or_else(|| {
        ApiError::BadRequest(format!("from ({from})/to ({to}) span out of range"))
    })?;
    let points = span / step + 1;
    if points > MAX_POINTS {
        return Err(ApiError::BadRequest(format!(
            "range/step yields {points} points (max {MAX_POINTS}); use a larger step or narrower window"
        )));
    }
    Ok(())
}

/// Resolve the as-of price at each grid point `from, from+step, …, ≤ to`.
///
/// `seed` is the last price at or before `from` (or `None`); `window` is every sample
/// in `(from, to]`, ascending. A single forward walk assigns each grid point the most
/// recent price at or before it. Points before any known price resolve to `None`.
pub fn resolve_grid(
    from: i64,
    to: i64,
    step: i64,
    seed: Option<(i64, BigDecimal)>,
    window: &[(i64, BigDecimal)],
) -> Vec<(i64, Option<BigDecimal>)> {
    let mut out = Vec::new();
    let mut current: Option<BigDecimal> = seed.map(|(_, p)| p);
    let mut idx = 0usize;
    let mut t = from;
    while t <= to {
        while idx < window.len() && window[idx].0 <= t {
            current = Some(window[idx].1.clone());
            idx += 1;
        }
        out.push((t, current.clone()));
        t += step;
    }
    out
}

/// The assets a loan must price over the window: each payable metal's own asset for a
/// concentrate (resolved via [`asset_for_metal`], deduplicated), or the anchor's headline
/// asset for standard goods. A concentrate with no offtake yet, or a metal that maps to no
/// known symbol, yields fewer (or zero) assets — the loan then reads unpriced and the
/// series is empty, which `compute_collateral` enforces per point anyway.
pub fn required_assets(
    anchor: &CollateralValuationRow,
    offtake: Option<&OfftakeTermsRow>,
) -> Vec<String> {
    match anchor.valuation_mode {
        ValuationMode::MetalConcentrate => {
            let mut assets: Vec<String> = offtake
                .map(|o| {
                    o.payable_terms
                        .0
                        .iter()
                        .filter_map(|t| asset_for_metal(&t.metal))
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            assets.sort();
            assets.dedup();
            assets
        }
        ValuationMode::StandardGoods => vec![anchor.asset.clone()],
    }
}

/// One asset's resolved as-of price series: its symbol paired with the per-grid-point
/// price (`None` before its first known sample), as produced by [`resolve_grid`].
pub type AssetPriceGrid = (String, Vec<(i64, Option<BigDecimal>)>);

/// Merge per-asset as-of grids (each aligned to the same `from`/`to`/`step`) into one
/// price map per grid point. Only assets with a known price at a point appear in that
/// point's map, so a point where some required asset is not yet priced yields an
/// incomplete map — which `compute_collateral` treats as unpriced. Pure/testable.
pub fn merge_price_grids(
    from: i64,
    to: i64,
    step: i64,
    per_asset: &[AssetPriceGrid],
) -> Vec<(i64, HashMap<String, BigDecimal>)> {
    let mut out = Vec::new();
    let mut t = from;
    let mut i = 0usize;
    while t <= to {
        let mut prices = HashMap::new();
        for (asset, grid) in per_asset {
            if let Some((_, Some(p))) = grid.get(i) {
                prices.insert(asset.clone(), p.clone());
            }
        }
        out.push((t, prices));
        t += step;
        i += 1;
    }
    out
}

/// Assemble the response from the (constant) valuation inputs and the resolved
/// per-grid-point price maps. Pure and unit-testable — no DB, no clock. Re-runs
/// `compute_collateral` per grid point (only the prices differ) and takes CCR against the
/// fixed senior-principal denominator.
///
/// A point whose price map is incomplete for the loan's required assets (an early point
/// before a metal's first sample) makes `compute_collateral` return `None` and is skipped
/// — so, unlike the single-price case, we cannot short-circuit on the first `None`: a
/// later point may become fully priced. `Err` only propagates a malformed-stored-number
/// data-integrity failure. When a structural input (assay/offtake) or the senior-principal
/// denominator is missing, no CCR is computable and `points` is empty.
#[allow(clippy::too_many_arguments)]
pub fn build_response<S: std::hash::BuildHasher>(
    loan_id: &BigDecimal,
    chain_id: i64,
    from: i64,
    to: i64,
    step: i64,
    anchor: &CollateralValuationRow,
    assay: Option<&AssayRow>,
    offtake: Option<&OfftakeTermsRow>,
    senior_usd: Option<&BigDecimal>,
    grid: &[(i64, HashMap<String, BigDecimal, S>)],
) -> Result<CcrHistoryResponse, ApiError> {
    let mut points = Vec::new();
    if let Some(senior) = senior_usd {
        for (ts, prices) in grid {
            // `None` ⇒ price map incomplete at this point (or structurally unpriceable);
            // skip and keep walking — a later point may be fully priced.
            let Some(computation) =
                compute_collateral(anchor, assay, offtake, prices).map_err(ApiError::Internal)?
            else {
                continue;
            };
            points.push(CcrPoint {
                timestamp: iso_utc_from_unix(*ts),
                ccr_bps: ccr_bps(&computation.collateral_value, senior),
            });
        }
    }

    Ok(CcrHistoryResponse {
        loan_id: loan_id.to_plain_string(),
        chain_id,
        from: iso_utc_from_unix(from),
        to: iso_utc_from_unix(to),
        step_seconds: step,
        points,
    })
}
