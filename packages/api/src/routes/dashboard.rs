//! Protocol Dashboard Header endpoints.
//!
//! Three endpoints that back the summary strip at the top of the Protocol Dashboard:
//!
//! - `GET /v1/dashboard/summary?chain_id` — headline KPI cards (TVL,
//!   outstanding in loans, current net APY to sPLUSD, loan-book yield, cumulative
//!   yield total).
//! - `GET /v1/dashboard/tvl-history?days&interval&chain_id` — running cumulative
//!   TVL time series (`[{ timestamp, tvl }]`).
//! - `GET /v1/dashboard/yield-history?days&interval&chain_id` — running cumulative
//!   net yield minted time series (`[{ timestamp, cumulative_yield }]`).
//!
//! ## Data sources
//!
//! | Field | Source |
//! |---|---|
//! | `tvl` | Σ `DepositRequested.amount` − Σ `WithdrawalRequested.amount` |
//! | `outstanding_in_loans` | `financial_position::compute_financial_position` → `assets.deployed.secured_loans_outstanding` |
//! | `loan_book_yield` | `loan_book::compute_loan_book` → `summary.avg_yield` |
//! | `current_apy_net_to_splusd` | effective-haircut net rate: `gross_book_rate × (Σ senior_interest / Σ (senior_interest + mgmt_fee + perf_fee))` |
//! | `cumulative_yield_total` | Σ `YieldMinted.s_plusd_amount` |
//!
//! ## Conventions
//!
//! - USDC amounts as base-6 decimal strings (`"43140000.000000"`).
//! - Rates as decimal-fraction strings (`"0.104000"` = 10.4 %).
//! - `null` when data unavailable (e.g. no active loans → `current_apy_net_to_splusd`).
//! - `days`/`interval`/`MAX_SAMPLES` cap mirrors `/v1/stats/yield` (`portfolio.rs`).

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::{FlowEventRow, LifecycleRow, LoanSnapshotRow, YieldMintRow};

use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::intervals::Interval;
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::routes::financial_position::compute_financial_position;
use crate::routes::loan_book::{compute_loan_book, LoanSpot};
use crate::AppState;

// ── Constants ────────────────────────────────────────────────────────────────

/// Maximum samples per response. Matches `portfolio::MAX_SAMPLES` / `stats::MAX_SAMPLES`
/// (1_000) so the two dashboard series share the sibling `/v1/stats/*` cap: ≈2.7 years
/// daily, ≈19 years weekly, ≈42 days hourly.
pub const MAX_SAMPLES: i64 = 1_000;
/// Seconds per day.
const SECS_PER_DAY: i64 = 86_400;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Query parameters for the two time-series endpoints.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DashboardSeriesQuery {
    /// Chain ID (optional — defaults to DEFAULT_CHAIN_ID).
    pub chain_id: Option<i64>,
    /// Number of days to look back from now (omit for full history starting at
    /// the earliest flow/yield event for the chain).
    pub days: Option<u32>,
    /// Sample interval: `"hourly"`, `"daily"` (default), or `"weekly"`.
    #[serde(default)]
    pub interval: Interval,
}

/// Response for `GET /v1/dashboard/summary`.
#[derive(Debug, Serialize, ToSchema)]
pub struct DashboardSummaryResponse {
    /// Total value locked = Σ `DepositRequested.amount` − Σ `WithdrawalRequested.amount`
    /// as-of now. USDC (6-decimal string).
    pub tvl: String,
    /// Senior + equity principal outstanding over active loans. USDC (6-decimal string).
    /// `null` when there are no active loans.
    pub outstanding_in_loans: Option<String>,
    /// Effective-haircut net APY accruing to sPLUSD holders (decimal-fraction string,
    /// e.g. `"0.104000"` = 10.4 %). `null` when there are no active loans.
    pub current_apy_net_to_splusd: Option<String>,
    /// Principal-weighted gross senior interest rate (decimal-fraction string, e.g.
    /// `"0.109000"` = 10.9 %). `null` when there are no active loans.
    pub loan_book_yield: Option<String>,
    /// Cumulative net PLUSD minted to the sPLUSD vault (loan + T-bill legs) since
    /// inception. USDC (6-decimal string).
    pub cumulative_yield_total: String,
}

/// One sample in the TVL time series.
#[derive(Debug, Serialize, ToSchema)]
pub struct TvlPoint {
    /// ISO-8601 UTC timestamp for this sample.
    pub timestamp: String,
    /// Running cumulative net TVL at this sample, USDC (6-decimal string).
    pub tvl: String,
}

/// One sample in the cumulative yield time series.
#[derive(Debug, Serialize, ToSchema)]
pub struct YieldPoint {
    /// ISO-8601 UTC timestamp for this sample.
    pub timestamp: String,
    /// Running cumulative net yield minted at this sample, USDC (6-decimal string).
    pub cumulative_yield: String,
}

/// OpenAPI doc bundle for the dashboard routes.
#[derive(OpenApi)]
#[openapi(
    paths(get_summary, get_tvl_history, get_yield_history),
    components(schemas(
        DashboardSummaryResponse,
        TvlPoint,
        YieldPoint,
        DashboardSeriesQuery,
        Interval,
    )),
    tags((name = "Dashboard", description = "Protocol Dashboard header metrics and time series"))
)]
pub struct DashboardDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/dashboard/summary", get(get_summary))
        .route("/dashboard/tvl-history", get(get_tvl_history))
        .route("/dashboard/yield-history", get(get_yield_history))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/dashboard/summary",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Protocol Dashboard header KPIs", body = DashboardSummaryResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Dashboard"
)]
async fn get_summary(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<DashboardSummaryResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);

    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Concurrent fetches: four independent reads, each acquiring its own pooled
    // connection. Consistency as-of slightly different indexer checkpoints is
    // acceptable — matches `portfolio.rs` semantics.
    let (loans, events, flow_events, yield_mints) = tokio::try_join!(
        state
            .contract_logs_repo
            .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, to),
        state
            .contract_logs_repo
            .list_loan_lifecycle_events(&state.pool, chain_id, to),
        state
            .contract_logs_repo
            .list_flow_events(&state.pool, chain_id, to),
        state
            .contract_logs_repo
            .list_yield_mints(&state.pool, chain_id, to),
    )?;

    Ok(Json(compute_summary(
        &loans,
        &events,
        &flow_events,
        &yield_mints,
        to,
    )))
}

#[utoipa::path(
    get,
    path = "/v1/dashboard/tvl-history",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
        ("days" = Option<u32>, Query, description = "Number of days to look back from now (omit for full history)"),
        ("interval" = Option<String>, Query, description = "Sample interval: \"hourly\", \"daily\" (default), or \"weekly\""),
    ),
    responses(
        (status = 200, description = "TVL time series", body = Vec<TvlPoint>),
        (status = 400, description = "Too many samples — reduce `days` or use a coarser `interval`"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Dashboard"
)]
async fn get_tvl_history(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DashboardSeriesQuery>,
) -> Result<Json<Vec<TvlPoint>>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let step = query.interval.step_secs();

    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let flows = state
        .contract_logs_repo
        .list_flow_events(&state.pool, chain_id, to)
        .await?;

    // Determine window start.
    let from = match query.days {
        Some(d) => to - i64::from(d) * SECS_PER_DAY,
        None => match flows.iter().map(|r| r.block_timestamp).min() {
            Some(earliest) => earliest,
            None => return Ok(Json(vec![])), // no flow events yet
        },
    };

    // Sample-count cap (ceiling division).
    let est_samples = (to - from + step - 1) / step + 1;
    if est_samples > MAX_SAMPLES {
        return Err(ApiError::BadRequest(format!(
            "request could produce up to {est_samples} samples (max {MAX_SAMPLES}); reduce `days` or use a coarser `interval` (weekly allows ~19 years)"
        )));
    }

    Ok(Json(compute_tvl_series(&flows, from, to, step)))
}

#[utoipa::path(
    get,
    path = "/v1/dashboard/yield-history",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
        ("days" = Option<u32>, Query, description = "Number of days to look back from now (omit for full history)"),
        ("interval" = Option<String>, Query, description = "Sample interval: \"hourly\", \"daily\" (default), or \"weekly\""),
    ),
    responses(
        (status = 200, description = "Cumulative yield time series", body = Vec<YieldPoint>),
        (status = 400, description = "Too many samples — reduce `days` or use a coarser `interval`"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Dashboard"
)]
async fn get_yield_history(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DashboardSeriesQuery>,
) -> Result<Json<Vec<YieldPoint>>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let step = query.interval.step_secs();

    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let mints = state
        .contract_logs_repo
        .list_yield_mints(&state.pool, chain_id, to)
        .await?;

    // Determine window start.
    let from = match query.days {
        Some(d) => to - i64::from(d) * SECS_PER_DAY,
        None => match mints.iter().map(|r| r.block_timestamp).min() {
            Some(earliest) => earliest,
            None => return Ok(Json(vec![])), // no YieldMinted events yet
        },
    };

    // Sample-count cap (ceiling division).
    let est_samples = (to - from + step - 1) / step + 1;
    if est_samples > MAX_SAMPLES {
        return Err(ApiError::BadRequest(format!(
            "request could produce up to {est_samples} samples (max {MAX_SAMPLES}); reduce `days` or use a coarser `interval` (weekly allows ~19 years)"
        )));
    }

    Ok(Json(compute_yield_series(&mints, from, to, step)))
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// Pure computation: no DB calls. Assembles the summary KPIs from pre-fetched data.
///
/// Public so `packages/api/tests/dashboard.rs` can exercise it without the HTTP/DB
/// layers.
pub fn compute_summary(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    flow_events: &[FlowEventRow],
    yield_mints: &[YieldMintRow],
    to: i64,
) -> DashboardSummaryResponse {
    // TVL = Σ deposits − Σ withdrawals (request-side, USDC 6dp).
    let tvl = {
        let mut sum = BigDecimal::from(0);
        for f in flow_events {
            if f.kind == "deposit" {
                sum += &f.amount;
            } else {
                sum -= &f.amount;
            }
        }
        base6_to_decimal_string(&sum)
    };

    // cumulative_yield_total = Σ YieldMinted.s_plusd_amount
    let cumulative_yield_total = {
        let mut sum = BigDecimal::from(0);
        for m in yield_mints {
            sum += &m.s_plusd_amount;
        }
        base6_to_decimal_string(&sum)
    };

    // Build financial-position snapshot.
    let fp = compute_financial_position(loans, events, to);
    let outstanding_in_loans = fp.assets.deployed.secured_loans_outstanding;

    // Loan book (only avg_yield is needed here; collateral + spot + disbursement maps
    // are irrelevant — disbursement only affects the per-loan displayed status).
    let empty_collateral: HashMap<String, BigDecimal> = HashMap::new();
    let empty_spot: HashMap<String, LoanSpot> = HashMap::new();
    let empty_disbursement: HashMap<String, bool> = HashMap::new();
    let lb = compute_loan_book(
        loans,
        events,
        to,
        &empty_collateral,
        &empty_spot,
        &empty_disbursement,
    );
    let loan_book_yield = lb.summary.avg_yield.clone();

    // current_apy_net_to_splusd = gross_book_rate × haircut.
    let current_apy_net_to_splusd = net_apy(lb.summary.avg_yield.as_deref(), loans);

    DashboardSummaryResponse {
        tvl,
        outstanding_in_loans,
        current_apy_net_to_splusd,
        loan_book_yield,
        cumulative_yield_total,
    }
}

/// Effective-haircut net APY accruing to sPLUSD holders.
///
/// ```text
/// gross_book_rate = loan_book summary.avg_yield (principal-weighted gross senior rate)
/// realized_net    = Σ repayment.senior_interest  (over ALL loans on chain)
/// realized_gross  = Σ (senior_interest + mgmt_fee + perf_fee)
/// haircut         = realized_gross > 0 ? realized_net / realized_gross : 1.0
/// result          = gross_book_rate × haircut
/// ```
///
/// Returns `None` when there are no active loans (no `gross_book_rate`).
/// Falls back to `haircut = 1.0` (net = gross) when `realized_gross == 0`
/// (no repayment data yet — a brand-new book).
///
/// Public so `packages/api/tests/dashboard.rs` can exercise it without the HTTP/DB
/// layers.
pub fn net_apy(gross_book_rate_str: Option<&str>, loans: &[LoanSnapshotRow]) -> Option<String> {
    // No active loans → no gross rate → null.
    let gross_str = gross_book_rate_str?;

    // Parse the gross rate string back to BigDecimal.
    let gross_rate: BigDecimal = gross_str.parse().ok()?;
    let zero = BigDecimal::from(0);
    if gross_rate == zero {
        return None;
    }

    // Sum repayment data over ALL loans (not just active) — bullet loans record
    // nothing until maturity, so we use the full book to capture any repayment data.
    let mut realized_net = BigDecimal::from(0);
    let mut realized_gross = BigDecimal::from(0);
    for loan in loans {
        let r = &loan.snapshot.repayment;
        realized_net += &r.senior_interest;
        realized_gross += &r.senior_interest + &r.mgmt_fee + &r.perf_fee;
    }

    let haircut = if realized_gross > zero {
        &realized_net / &realized_gross
    } else {
        BigDecimal::from(1)
    };

    let net_rate = (gross_rate * haircut).with_scale_round(6, RoundingMode::HalfUp);

    Some(net_rate.to_plain_string())
}

/// Pure computation: no DB calls. Walks the sample grid and emits the running
/// cumulative net TVL (Σ deposits − Σ withdrawals) at each grid point.
///
/// Grid: `from, from+step, …, to` (always includes `to` as the final point).
/// Events with `block_timestamp > t` are excluded from the running sum at `t`.
/// Empty `flows` → `[]`.
///
/// Public so `packages/api/tests/dashboard.rs` can exercise it without the HTTP/DB
/// layers.
pub fn compute_tvl_series(flows: &[FlowEventRow], from: i64, to: i64, step: i64) -> Vec<TvlPoint> {
    if flows.is_empty() {
        return vec![];
    }

    let timestamps = build_grid(from, to, step);
    let mut series = Vec::with_capacity(timestamps.len());

    for t in timestamps {
        let tvl: BigDecimal =
            flows
                .iter()
                .filter(|f| f.block_timestamp <= t)
                .fold(BigDecimal::from(0), |acc, f| {
                    if f.kind == "deposit" {
                        acc + &f.amount
                    } else {
                        acc - &f.amount
                    }
                });
        series.push(TvlPoint {
            timestamp: iso_utc_from_unix(t),
            tvl: base6_to_decimal_string(&tvl),
        });
    }

    series
}

/// Pure computation: no DB calls. Walks the sample grid and emits the running
/// cumulative net yield minted (Σ `YieldMinted.s_plusd_amount`) at each grid point.
///
/// Grid: same as `compute_tvl_series`. Events with `block_timestamp > t` are
/// excluded from the running sum at `t`. Empty `mints` → `[]`.
///
/// Public so `packages/api/tests/dashboard.rs` can exercise it without the HTTP/DB
/// layers.
pub fn compute_yield_series(
    mints: &[YieldMintRow],
    from: i64,
    to: i64,
    step: i64,
) -> Vec<YieldPoint> {
    if mints.is_empty() {
        return vec![];
    }

    let timestamps = build_grid(from, to, step);
    let mut series = Vec::with_capacity(timestamps.len());

    for t in timestamps {
        let cumulative: BigDecimal = mints
            .iter()
            .filter(|m| m.block_timestamp <= t)
            .map(|m| m.s_plusd_amount.clone())
            .sum();
        series.push(YieldPoint {
            timestamp: iso_utc_from_unix(t),
            cumulative_yield: base6_to_decimal_string(&cumulative),
        });
    }

    series
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Build the sample grid: `from, from+step, …, to`.
/// Always includes `to` as the final point. Deduplicates in case `to` falls
/// exactly on a grid boundary.
fn build_grid(from: i64, to: i64, step: i64) -> Vec<i64> {
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
    timestamps
}
