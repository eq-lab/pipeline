use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use bigdecimal::RoundingMode;
use bigdecimal::ToPrimitive;
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};

use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::intervals::Interval;
use crate::AppState;

// ── Constants ────────────────────────────────────────────────────────────────

/// Maximum samples per response. Caps `(now - from) / step + 1` and protects against
/// runaway compute on `days = huge` requests. 1_000 daily samples ≈ 2.7 years;
/// 1_000 weekly samples ≈ 19 years; 1_000 hourly samples ≈ 42 days.
const MAX_SAMPLES: i64 = 1_000;
/// Seconds per day (one place to change if anyone ever needs a different convention).
const SECS_PER_DAY: i64 = 86_400;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Query parameters for `GET /v1/stats/yield`. Mirrors the `days` + `interval`
/// convention from `/v1/stats/prices` — the dashboard always queries up to "now"
/// (no historical-window override) at a fixed bucketed resolution.
#[derive(Debug, Deserialize, ToSchema)]
pub struct YieldQuery {
    /// Chain ID (required).
    pub chain_id: i64,
    /// Number of days to look back from now (omit for full history starting at the
    /// earliest `origination_date` for the chain).
    pub days: Option<u32>,
    /// Sample interval: `"hourly"`, `"daily"` (default), or `"weekly"`.
    #[serde(default)]
    pub interval: Interval,
}

/// One sample in the portfolio yield time series. Mirrors the per-row output of the
/// spec's Python `snapshot(t)` function plus a timestamp. The field name `timestamp`
/// matches the convention in `stats.rs::PriceItem`.
#[derive(Debug, Serialize, ToSchema)]
pub struct SamplePoint {
    /// ISO-8601 timestamp (UTC) for this sample, e.g. `"2026-05-26T00:00:00Z"`.
    pub timestamp: String,
    /// Weighted-average book APY as a decimal fraction (e.g. `0.13` = 13 %).
    /// `null` when no loans are active at this sample.
    pub apy: Option<f64>,
    /// Cumulative senior interest accrued, USDC (6-decimal string, e.g. `"986.301369"`).
    pub accrued: String,
    /// Senior principal outstanding at this sample, USDC (6-decimal string).
    /// Pre-amortisation this equals the sum of `original_senior_tranche` over active
    /// loans; it will diverge from that name's literal meaning once partial-principal
    /// repayment is in scope.
    pub principal_outstanding: String,
}

/// OpenAPI doc bundle for the portfolio-yield route. Tagged "Yield" so it groups
/// next to the other `/v1/stats/*` endpoints in Swagger UI; the data is still
/// portfolio-level (this module is named `portfolio` accordingly).
#[derive(OpenApi)]
#[openapi(
    paths(get_yield),
    components(schemas(YieldQuery, Interval, SamplePoint)),
    tags((name = "Yield", description = "Portfolio-level yield time series"))
)]
pub struct YieldDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/stats/yield", get(get_yield))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/stats/yield",
    params(
        ("chain_id" = i64, Query, description = "Chain ID (required)"),
        ("days" = Option<u32>, Query, description = "Number of days to look back from now (omit for full history)"),
        ("interval" = Option<String>, Query, description = "Sample interval: \"hourly\", \"daily\" (default), or \"weekly\""),
    ),
    responses(
        (status = 200, description = "Portfolio yield time series", body = Vec<SamplePoint>),
        (status = 400, description = "Invalid query parameters"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Yield"
)]
async fn get_yield(
    State(state): State<Arc<AppState>>,
    Query(query): Query<YieldQuery>,
) -> Result<Json<Vec<SamplePoint>>, ApiError> {
    handle_yield(&state, query).await.map(Json)
}

async fn handle_yield(state: &AppState, query: YieldQuery) -> Result<Vec<SamplePoint>, ApiError> {
    let chain_id = query.chain_id;
    let step = query.interval.step_secs();

    // The window always ends at the current server time — this API doesn't expose
    // historical windows. Matches `/v1/stats/prices` semantics.
    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Resolve the window start:
    //   - `days = Some(d)` → `now - d * 86_400`. By construction `from <= to`.
    //   - `days = None`     → earliest `origination_date` for the chain (full history).
    //                         If no loans exist for the chain, return empty 200.
    let from = match query.days {
        Some(d) => to - i64::from(d) * SECS_PER_DAY,
        None => match state
            .contract_logs_repo
            .get_earliest_origination_date(&state.pool, chain_id)
            .await?
        {
            Some(earliest) => earliest,
            None => return Ok(vec![]),
        },
    };

    // Sample-count cap. Use ceiling division: when `(to - from)` isn't a multiple of
    // `step`, the grid generator pushes `to` as an extra final sample.
    let est_samples = (to - from + step - 1) / step + 1;
    if est_samples > MAX_SAMPLES {
        return Err(ApiError::BadRequest(format!(
            "request could produce up to {est_samples} samples (max {MAX_SAMPLES}); reduce `days` or use a coarser `interval` (weekly allows ~19 years)"
        )));
    }

    // Two independent reads on the pool — no transaction. If the indexer writes a
    // lifecycle event between the two queries, compute_series's per-loan-id filter
    // either drops the orphan event (new-loan case) or applies an early close to a
    // loan already in our snapshot. Both outcomes are valid as-of slightly different
    // indexer checkpoints; neither is an incorrect computation.
    let loans = state
        .contract_logs_repo
        .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, to)
        .await?;

    if loans.is_empty() {
        return Ok(vec![]);
    }

    let events = state
        .contract_logs_repo
        .list_loan_lifecycle_events(&state.pool, chain_id, to)
        .await?;

    Ok(compute_series(&loans, &events, from, to, step))
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// Resolved per-loan view used inside `compute_series`.
struct LoanView<'a> {
    row: &'a LoanSnapshotRow,
    /// Effective end of this loan: `min(original_maturity_date, earliest LoanClosed or LoanDefaulted timestamp)`.
    end_at: i64,
}

/// Pure computation: no DB calls. Takes pre-fetched loans and lifecycle events,
/// walks the sample grid, and returns a time series of `SamplePoint`s.
///
/// # Formulas
///
/// **Weighted-average APY (decimal fraction)** — computed over *active* loans at `t`
/// (`originationᵢ <= t < endᵢ`). `None` when no loans are active.
/// `apy = (Σᵢ Pᵢ · R_bps_i / Σᵢ Pᵢ) / 10_000`.
///
/// **Cumulative accrued senior interest** (USDC, 6dp decimal string) — summed over all
/// loans that have *started* by `t` (`originationᵢ <= t`), including matured loans
/// which contribute their final accrual frozen at `endᵢ`.
/// `accrued = Σᵢ Pᵢ · Rᵢ · (min(t, endᵢ) − startᵢ) / (365 · 86_400)`.
///
/// **Principal outstanding** (USDC, 6dp decimal string) — `Σᵢ Pᵢ` over active loans.
///
/// Public so the compute-layer test file in `packages/api/tests/portfolio_compute.rs`
/// can exercise it directly. Not intended for consumption outside this crate.
pub fn compute_series(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    from: i64,
    to: i64,
    step: i64,
) -> Vec<SamplePoint> {
    // Pre-compute per-loan end_at (earliest LoanClosed / LoanDefaulted, else scheduled).
    let loan_views: Vec<LoanView> = loans
        .iter()
        .map(|loan| {
            let lifecycle_end = events
                .iter()
                .filter(|e| {
                    (e.event_name == "LoanClosed" || e.event_name == "LoanDefaulted")
                        && e.loan_id == loan.loan_id
                })
                .map(|e| e.block_timestamp)
                .min();

            let end_at = match lifecycle_end {
                Some(lc) => loan.snapshot.original_maturity_date.min(lc),
                None => loan.snapshot.original_maturity_date,
            };

            LoanView { row: loan, end_at }
        })
        .collect();

    // Denominators for accrual formula
    let secs_per_year = BigDecimal::from(365_i64 * 86_400_i64);
    let ten_thousand = BigDecimal::from(10_000_i64);

    // Build sample grid: from, from+step, …, to (always include to as last point)
    let mut timestamps: Vec<i64> = std::iter::successors(Some(from), |&t| {
        if t < to {
            Some((t + step).min(to))
        } else {
            None
        }
    })
    .collect();
    if timestamps.last().copied() != Some(to) {
        timestamps.push(to);
    }
    timestamps.dedup();

    let mut series: Vec<SamplePoint> = Vec::with_capacity(timestamps.len());

    for t in timestamps {
        // Active loans: origination_date <= t < end_at
        let active: Vec<&LoanView> = loan_views
            .iter()
            .filter(|lv| lv.row.snapshot.origination_date <= t && t < lv.end_at)
            .collect();

        let principal_sum: BigDecimal = active
            .iter()
            .map(|lv| lv.row.snapshot.original_senior_tranche.clone())
            .sum();

        // APY as decimal fraction (e.g. 0.13).
        let apy: Option<f64> = if principal_sum == 0_i64 {
            None
        } else {
            let numerator: BigDecimal = active
                .iter()
                .map(|lv| {
                    lv.row.snapshot.original_senior_tranche.clone()
                        * BigDecimal::from(i64::from(lv.row.snapshot.senior_interest_rate_bps))
                })
                .sum();
            // Divide by 10_000 inside BigDecimal arithmetic, then convert the
            // small rate fraction to f64 — well within mantissa precision.
            let ratio = numerator / &principal_sum / &ten_thousand;
            ratio.with_scale_round(8, RoundingMode::HalfUp).to_f64()
        };

        // Cumulative accrued in USDC base units.
        let accrued_base: BigDecimal = loan_views
            .iter()
            .filter(|lv| lv.row.snapshot.origination_date <= t)
            .map(|lv| {
                // Defensive .max(0) — guards against pathological data (e.g. a
                // re-org-artifact `LoanClosed.block_timestamp < origination_date`).
                let active_secs =
                    BigDecimal::from((t.min(lv.end_at) - lv.row.snapshot.origination_date).max(0));
                lv.row.snapshot.original_senior_tranche.clone()
                    * BigDecimal::from(i64::from(lv.row.snapshot.senior_interest_rate_bps))
                    * active_secs
                    / (&ten_thousand * &secs_per_year)
            })
            .sum();

        series.push(SamplePoint {
            timestamp: iso_utc_from_unix(t),
            apy,
            accrued: base6_to_decimal_string(&accrued_base),
            principal_outstanding: base6_to_decimal_string(&principal_sum),
        });
    }

    series
}
