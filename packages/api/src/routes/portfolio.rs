use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use bigdecimal::RoundingMode;
use bigdecimal::ToPrimitive;
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::book_weighting::{normalise_rate_events, weighted_mean, LoanAccrual};
use shared::chains::ChainKind;
use shared::contract_logs_repo::{LifecycleRow, LoanRateEventRow, LoanSnapshotRow};
use shared::loan_status::LoanTimeline;

use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::intervals::{Interval, MAX_SAMPLES};
use crate::routes::common::{loan_registry_address, RequiredChain};
use crate::AppState;

// ── Constants ────────────────────────────────────────────────────────────────

/// Seconds per day (one place to change if anyone ever needs a different convention).
const SECS_PER_DAY: i64 = 86_400;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Query parameters for `GET /v1/stats/yield`. Mirrors the `days` + `interval`
/// convention from `/v1/stats/prices` — the dashboard always queries up to "now"
/// (no historical-window override) at a fixed bucketed resolution.
#[derive(Debug, Deserialize, ToSchema)]
pub struct YieldQuery {
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
    /// Cumulative senior interest accrued, USDC (6-decimal string, e.g. `"985.626283"`).
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
        ("days" = Option<u32>, Query, description = "Number of days to look back from now (omit for full history)"),
        ("interval" = Option<String>, Query, description = "Sample interval: \"hourly\", \"daily\" (default), or \"weekly\""),
        RequiredChain,
    ),
    responses(
        (status = 200, description = "Portfolio yield time series", body = Vec<SamplePoint>),
        (status = 400, description = "Missing, malformed, or unknown chain_id; or invalid query parameters"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Yield"
)]
async fn get_yield(
    State(state): State<Arc<AppState>>,
    RequiredChain(chain): RequiredChain,
    Query(query): Query<YieldQuery>,
) -> Result<Json<Vec<SamplePoint>>, ApiError> {
    handle_yield(&state, chain.chain_id, chain.kind, query)
        .await
        .map(Json)
}

async fn handle_yield(
    state: &AppState,
    chain_id: i64,
    kind: ChainKind,
    query: YieldQuery,
) -> Result<Vec<SamplePoint>, ApiError> {
    let step = query.interval.step_secs();
    let registry = loan_registry_address(state, chain_id)?;

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
            .get_earliest_origination_date_for_registry(&state.pool, chain_id, registry)
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
        .list_latest_loan_snapshots(&state.pool, chain_id, registry, to)
        .await?;

    if loans.is_empty() {
        return Ok(vec![]);
    }

    let events = state
        .contract_logs_repo
        .list_loan_lifecycle_events_for_registry(&state.pool, chain_id, registry, to)
        .await?;

    // Event `outstanding` is raw on-chain units (7 dp on Stellar); the snapshots and the
    // `accrued` output are base-6, so normalise per chain kind before integrating.
    let mut rate_events = state
        .contract_logs_repo
        .list_loan_rate_events_for_registry(&state.pool, chain_id, registry, to)
        .await?;
    normalise_rate_events(kind, &mut rate_events);

    Ok(compute_series(
        &loans,
        &events,
        &rate_events,
        from,
        to,
        step,
    ))
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// Resolved per-loan view used inside `compute_series`.
struct LoanView<'a> {
    row: &'a LoanSnapshotRow,
    /// This loan's outstanding- and rate-changing events, in chain order.
    accrual: LoanAccrual,
    /// Status timeline of this loan (`shared::loan_status`).
    timeline: LoanTimeline,
}

/// Pure computation: no DB calls. Takes pre-fetched loans and lifecycle events,
/// walks the sample grid, and returns a time series of `SamplePoint`s.
///
/// # Formulas
///
/// **Weighted-average APY (decimal fraction)** — computed over *active* loans at `t`
/// (originated and Approved / Performing / WatchList at `t`), weighted by each loan's outstanding senior at `t`
/// (`Oᵢ(t)`, the `outstanding` of its latest outstanding-changing event, else 0) at the
/// rate in force at `t` (`R_bps_i(t)`: genesis rate updated by `EconomicsAmended` /
/// `LoanRolledOver`). `None` when no loans are active or `Σᵢ Oᵢ(t) = 0`.
/// `apy = (Σᵢ Oᵢ(t) · R_bps_i(t) / Σᵢ Oᵢ(t)) / 10_000`.
///
/// **Cumulative accrued senior interest** (USDC, 6dp decimal string) — summed over all
/// loans that have *started* by `t` (`originationᵢ <= t`), including closed loans
/// which contribute their final accrual frozen at the close. Only active time counts:
/// accrual runs past maturity, pauses in Default, resumes after a cure and stops at Close.
/// `accrued = Σᵢ ∫ Oᵢ(s) · R_bps_i(s) ds / (10_000 · 31_557_600)` over the active `[from, until)`
/// intervals clipped to `t` (`shared::book_weighting::accrued_over_intervals`).
///
/// **Principal outstanding** (USDC, 6dp decimal string) — `Σᵢ Pᵢ` over active loans.
///
/// Public so the compute-layer test file in `packages/api/tests/portfolio_compute.rs`
/// can exercise it directly. Not intended for consumption outside this crate.
pub fn compute_series(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    rate_events: &[LoanRateEventRow],
    from: i64,
    to: i64,
    step: i64,
) -> Vec<SamplePoint> {
    let mut rate_events_by_loan: HashMap<String, Vec<&LoanRateEventRow>> = HashMap::new();
    for e in rate_events {
        rate_events_by_loan
            .entry(e.loan_id.normalized().to_string())
            .or_default()
            .push(e);
    }

    let loan_views: Vec<LoanView> = loans
        .iter()
        .map(|loan| {
            let rate_events = rate_events_by_loan
                .get(&loan.loan_id.normalized().to_string())
                .map_or(&[][..], Vec::as_slice);

            LoanView {
                row: loan,
                accrual: LoanAccrual::new(loan.snapshot.senior_interest_rate_bps, rate_events),
                timeline: LoanTimeline::for_loan(loan, events),
            }
        })
        .collect();

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
        let active: Vec<&LoanView> = loan_views
            .iter()
            .filter(|lv| lv.timeline.is_active_at(t))
            .collect();

        let principal_sum: BigDecimal = active
            .iter()
            .map(|lv| lv.row.snapshot.original_senior_tranche.clone())
            .sum();
        // APY as decimal fraction (e.g. 0.13), outstanding-weighted at `t`.
        let apy: Option<f64> = weighted_mean(active.iter().map(|lv| {
            (
                lv.accrual.outstanding_at(t),
                BigDecimal::from(i64::from(lv.accrual.rate_bps_at(t))),
            )
        }))
        .and_then(|bps| {
            (bps / BigDecimal::from(10_000_i64))
                .with_scale_round(8, RoundingMode::HalfUp)
                .to_f64()
        });

        // Cumulative accrued in USDC base units.
        let accrued_base: BigDecimal = loan_views
            .iter()
            .filter(|lv| lv.row.snapshot.origination_date <= t)
            .map(|lv| lv.accrual.accrued(&lv.timeline.active_intervals(t)))
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
