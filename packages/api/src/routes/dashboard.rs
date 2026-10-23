//! Protocol Dashboard Header endpoints.
//!
//! Three endpoints that back the summary strip at the top of the Protocol Dashboard:
//!
//! - `GET /v1/dashboard/summary?chain_id?` — headline KPI cards (TVL,
//!   outstanding in loans, current net APY to sPLUSD, loan-book yield, cumulative
//!   yield total).
//! - `GET /v1/dashboard/tvl-history?days&interval&chain_id?` — running cumulative
//!   TVL time series plus `max`/`min`/`average` over the window
//!   (`{ series: [{ timestamp, tvl }], max, min, average }`).
//! - `GET /v1/dashboard/yield-history?days&interval&chain_id?` — running cumulative
//!   net yield minted time series plus `max`/`min`/`average` over the window
//!   (`{ series: [{ timestamp, cumulative_yield }], max, min, average }`).
//!
//! ## Chain scope
//!
//! `chain_id?` — omitted = the union over all configured chains, a configured id = that
//! chain, a well-formed unconfigured id = a zeroed / empty response with no DB call,
//! malformed or repeated = 400 (`LenientChainFilter`, same as `routes::financial_position`).
//! Every amount is base-6 USDC before summing: the repo readers normalise flow, legacy
//! yield and loan-snapshot amounts by chain kind, and `CashRepaid` mints (raw) are
//! normalised per loan by chain kind (same rounding approach as LoanBook's `minted_yield`). Loan data is read through each chain's
//! LoanRegistry address. Rates (`loan_book_yield`, `current_apy_net_to_splusd`) are
//! computed over the union of active loans, i.e. outstanding-senior-weighted across chains. The
//! series share one time grid and are summed point-wise; `max`/`min`/`average` come from
//! the summed step function.
//!
//! ## Data sources
//!
//!
//! | Field | Source |
//! |---|---|
//! | `tvl` | Σ `DepositRequested.amount` − Σ `WithdrawalRequested.amount` |
//! | `outstanding_in_loans` | `financial_position::compute_financial_position` → `assets.deployed.secured_loans_outstanding` |
//! | `loan_book_yield` | `loan_book::compute_loan_book` → `summary.avg_yield` |
//! | `current_apy_net_to_splusd` | effective-haircut net rate: `gross_book_rate × (Σ senior_interest / Σ (senior_interest + mgmt_fee + perf_fee))` |
//! | `cumulative_yield_total` | LP yield: legacy Σ `YieldMinted.s_plusd_amount` + Minter `CashRepaid.interest_minted` of non-carved-out loans (no `LoanDefaulted` at or before the repayment), net of `CashRepaymentReversed`; fees excluded |
//!
//! ## Conventions
//!
//! - USDC amounts as base-6 decimal strings (`"43140000.000000"`).
//! - Rates as decimal-fraction strings (`"0.104000"` = 10.4 %).
//! - Amounts are `0` ("0.000000") when empty; rates are `null` when no book exists
//!   (`current_apy_net_to_splusd` is `null` only when the gross rate is `null`).
//! - `days`/`interval`/`MAX_SAMPLES` cap mirrors `/v1/stats/yield` (`portfolio.rs`).

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use shared::chains::{normalize_usdc_amount, ChainKind};
use shared::contract_logs_repo::{
    FlowEventRow, LifecycleRow, LoanSnapshotRow, RepaymentMintRow, YieldMintRow,
};

use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::intervals::Interval;
use crate::routes::common::LenientChainFilter;
use crate::routes::financial_position::compute_financial_position;
use crate::routes::loan_book::{compute_loan_book, LoanRef, LoanSpot};
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
    /// Number of days to look back from now (omit for full history starting at
    /// the earliest flow/yield event in scope).
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
    /// Senior + equity principal outstanding over active loans. USDC (6-decimal string);
    /// `"0.000000"` when nothing is active (amounts are `0`, rates are `null`).
    pub outstanding_in_loans: Option<String>,
    /// Effective-haircut net APY accruing to sPLUSD holders (decimal-fraction string,
    /// e.g. `"0.104000"` = 10.4 %). `null` only when the gross book rate is `null`; `"0.000000"`
    /// when the gross rate is `0` over an outstanding book.
    pub current_apy_net_to_splusd: Option<String>,
    /// Outstanding-senior-weighted gross current senior interest rate (decimal-fraction string, e.g.
    /// `"0.109000"` = 10.9 %). `null` when there are no active loans or nothing is outstanding.
    pub loan_book_yield: Option<String>,
    /// Cumulative LP yield since inception: legacy `YieldMinted.s_plusd_amount` plus
    /// `CashRepaid.interest_minted` of loans not carved out at the repayment, net of
    /// `CashRepaymentReversed`; fees excluded. Not equal to Σ LoanBook `minted_yield`.
    /// USDC (6-decimal string).
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

/// Response for `GET /v1/dashboard/tvl-history`: the sampled series plus
/// `max`/`min`/`average` (time-weighted) over the queried window, USDC
/// (6-decimal strings).
#[derive(Debug, Serialize, ToSchema)]
pub struct TvlHistoryResponse {
    pub series: Vec<TvlPoint>,
    pub max: String,
    pub min: String,
    pub average: String,
}

/// Response for `GET /v1/dashboard/yield-history`: the sampled series plus
/// `max`/`min`/`average` (time-weighted) over the queried window, USDC
/// (6-decimal strings).
#[derive(Debug, Serialize, ToSchema)]
pub struct YieldHistoryResponse {
    pub series: Vec<YieldPoint>,
    pub max: String,
    pub min: String,
    pub average: String,
}

/// OpenAPI doc bundle for the dashboard routes.
#[derive(OpenApi)]
#[openapi(
    paths(get_summary, get_tvl_history, get_yield_history),
    components(schemas(
        DashboardSummaryResponse,
        TvlPoint,
        YieldPoint,
        TvlHistoryResponse,
        YieldHistoryResponse,
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
    params(LenientChainFilter),
    responses(
        (status = 200, description = "Protocol Dashboard header KPIs for the selected chain, or aggregated over all configured chains when `chain_id` is omitted; a well-formed but unconfigured `chain_id` yields zeroed values", body = DashboardSummaryResponse),
        (status = 400, description = "Malformed or repeated chain_id"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Dashboard"
)]
async fn get_summary(
    State(state): State<Arc<AppState>>,
    chain: LenientChainFilter,
) -> Result<Json<DashboardSummaryResponse>, ApiError> {
    let to = now_unix();

    let mut loans = Vec::new();
    let mut events = Vec::new();
    let mut flow_parts = Vec::new();
    let mut yield_parts = Vec::new();
    for c in chain.configured(&state.chains) {
        let chain_id = c.chain_id;
        let Some(registry) = state.loan_registry_addresses.get(&chain_id) else {
            continue;
        };
        let reads = read_chain(&state, chain_id, c.kind, registry, to).await?;
        let (chain_loans, chain_events) = tokio::try_join!(
            async {
                state
                    .contract_logs_repo
                    .list_latest_loan_snapshots(&state.pool, chain_id, registry, to)
                    .await
                    .map_err(ApiError::from)
            },
            async {
                state
                    .contract_logs_repo
                    .list_loan_lifecycle_events_for_registry(&state.pool, chain_id, registry, to)
                    .await
                    .map_err(ApiError::from)
            },
        )?;
        loans.extend(chain_loans);
        events.extend(chain_events);
        flow_parts.push(reads.flows);
        yield_parts.push(reads.yield_deltas);
    }

    let flows = merge_flows(flow_parts);
    let yield_deltas = merge_yield_deltas(yield_parts);
    Ok(Json(compute_summary(
        &loans,
        &events,
        &flows,
        &yield_deltas,
        to,
    )))
}

#[utoipa::path(
    get,
    path = "/v1/dashboard/tvl-history",
    params(
        LenientChainFilter,
        ("days" = Option<u32>, Query, description = "Number of days to look back from now (omit for full history)"),
        ("interval" = Option<String>, Query, description = "Sample interval: \"hourly\", \"daily\" (default), or \"weekly\""),
    ),
    responses(
        (status = 200, description = "TVL time series plus max/min/average over the window, summed over the selected chain or over all configured chains when `chain_id` is omitted; a well-formed but unconfigured `chain_id` yields an empty series", body = TvlHistoryResponse),
        (status = 400, description = "Malformed or repeated chain_id, or too many samples — reduce `days` or use a coarser `interval`"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Dashboard"
)]
async fn get_tvl_history(
    State(state): State<Arc<AppState>>,
    chain: LenientChainFilter,
    Query(query): Query<DashboardSeriesQuery>,
) -> Result<Json<TvlHistoryResponse>, ApiError> {
    let step = query.interval.step_secs();
    let to = now_unix();

    let mut flow_parts = Vec::new();
    for c in chain.configured(&state.chains) {
        flow_parts.push(
            state
                .contract_logs_repo
                .list_flow_events(&state.pool, c.chain_id, to)
                .await?,
        );
    }
    let flows = merge_flows(flow_parts);

    // Determine window start.
    let from = match query.days {
        Some(d) => to - i64::from(d) * SECS_PER_DAY,
        None => match flows.iter().map(|r| r.block_timestamp).min() {
            Some(earliest) => earliest,
            None => return Ok(Json(empty_tvl_history())), // no flow events yet
        },
    };

    // Sample-count cap (ceiling division).
    let est_samples = (to - from + step - 1) / step + 1;
    if est_samples > MAX_SAMPLES {
        return Err(ApiError::BadRequest(format!(
            "request could produce up to {est_samples} samples (max {MAX_SAMPLES}); reduce `days` or use a coarser `interval` (weekly allows ~19 years)"
        )));
    }

    Ok(Json(compute_tvl_history(&flows, from, to, step)))
}

#[utoipa::path(
    get,
    path = "/v1/dashboard/yield-history",
    params(
        LenientChainFilter,
        ("days" = Option<u32>, Query, description = "Number of days to look back from now (omit for full history)"),
        ("interval" = Option<String>, Query, description = "Sample interval: \"hourly\", \"daily\" (default), or \"weekly\""),
    ),
    responses(
        (status = 200, description = "Cumulative yield time series plus max/min/average over the window, summed over the selected chain or over all configured chains when `chain_id` is omitted; a well-formed but unconfigured `chain_id` yields an empty series", body = YieldHistoryResponse),
        (status = 400, description = "Malformed or repeated chain_id, or too many samples — reduce `days` or use a coarser `interval`"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "Dashboard"
)]
async fn get_yield_history(
    State(state): State<Arc<AppState>>,
    chain: LenientChainFilter,
    Query(query): Query<DashboardSeriesQuery>,
) -> Result<Json<YieldHistoryResponse>, ApiError> {
    let step = query.interval.step_secs();
    let to = now_unix();

    let mut yield_parts = Vec::new();
    for c in chain.configured(&state.chains) {
        let Some(registry) = state.loan_registry_addresses.get(&c.chain_id) else {
            continue;
        };
        yield_parts.push(read_chain_yield(&state, c.chain_id, c.kind, registry, to).await?);
    }
    let mints = merge_yield_deltas(yield_parts);

    // Determine window start.
    let from = match query.days {
        Some(d) => to - i64::from(d) * SECS_PER_DAY,
        None => match mints.iter().map(|r| r.block_timestamp).min() {
            Some(earliest) => earliest,
            None => return Ok(Json(empty_yield_history())), // no yield events yet
        },
    };

    // Sample-count cap (ceiling division).
    let est_samples = (to - from + step - 1) / step + 1;
    if est_samples > MAX_SAMPLES {
        return Err(ApiError::BadRequest(format!(
            "request could produce up to {est_samples} samples (max {MAX_SAMPLES}); reduce `days` or use a coarser `interval` (weekly allows ~19 years)"
        )));
    }

    Ok(Json(compute_yield_history(&mints, from, to, step)))
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// One chain's flow + yield reads for the summary.
struct ChainReads {
    flows: Vec<FlowEventRow>,
    yield_deltas: Vec<YieldMintRow>,
}

async fn read_chain(
    state: &AppState,
    chain_id: i64,
    kind: ChainKind,
    registry: &str,
    to: i64,
) -> Result<ChainReads, ApiError> {
    let (flows, yield_deltas) = tokio::try_join!(
        async {
            state
                .contract_logs_repo
                .list_flow_events(&state.pool, chain_id, to)
                .await
                .map_err(ApiError::from)
        },
        read_chain_yield(state, chain_id, kind, registry, to),
    )?;
    Ok(ChainReads {
        flows,
        yield_deltas,
    })
}

/// One chain's cumulative LP-yield step events: legacy `YieldMinted.s_plusd_amount` plus
/// `CashRepaid.interest_minted` of non-carved-out loans (netted against reversals), all base-6.
async fn read_chain_yield(
    state: &AppState,
    chain_id: i64,
    kind: ChainKind,
    registry: &str,
    to: i64,
) -> Result<Vec<YieldMintRow>, ApiError> {
    let (legacy, repayments) = tokio::try_join!(
        async {
            state
                .contract_logs_repo
                .list_yield_mints(&state.pool, chain_id, to)
                .await
                .map_err(ApiError::from)
        },
        async {
            state
                .contract_logs_repo
                .list_repayment_mints(&state.pool, chain_id, None, to, registry)
                .await
                .map_err(ApiError::from)
        },
    )?;
    Ok(chain_yield_deltas(kind, &legacy, &repayments))
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// One chain's cumulative LP-yield step events in base-6 USDC: the legacy `YieldMinted`
/// vault leg (already normalised by the repo) plus `CashRepaid.interest_minted`. Fees are
/// excluded, and so are repayments with a `LoanDefaulted` at or before them (carved-out
/// interest is minted to the Pocket). Per loan, the running raw interest (`+` at the mint,
/// `-` at its `CashRepaymentReversed`) is normalised with `normalize_usdc_amount(kind, …)`
/// and only its change is emitted. A reversal at or before the mint leaves the row never
/// live, matching `shared::minted_yield::is_live_at`. Intentionally differs from the sum of
/// LoanBook `minted_yield` (which includes fees and carved-out interest).
pub fn chain_yield_deltas(
    kind: ChainKind,
    legacy: &[YieldMintRow],
    repayments: &[RepaymentMintRow],
) -> Vec<YieldMintRow> {
    let mut by_loan: BTreeMap<String, Vec<(i64, BigDecimal)>> = BTreeMap::new();
    for r in repayments {
        if r.reversed_at.is_some_and(|rev| rev <= r.block_timestamp) {
            continue;
        }
        if r.carved_out {
            continue;
        }
        let raw = r.interest_minted.clone();
        let steps = by_loan.entry(r.loan_id.to_string()).or_default();
        steps.push((r.block_timestamp, raw.clone()));
        if let Some(rev) = r.reversed_at {
            steps.push((rev, -raw));
        }
    }

    let mut out: Vec<YieldMintRow> = legacy.to_vec();
    for mut steps in by_loan.into_values() {
        steps.sort_by_key(|(t, _)| *t);
        let mut raw_total = BigDecimal::from(0);
        let mut emitted = BigDecimal::from(0);
        let mut i = 0;
        while i < steps.len() {
            let t = steps[i].0;
            while i < steps.len() && steps[i].0 == t {
                raw_total += &steps[i].1;
                i += 1;
            }
            let normalised = normalize_usdc_amount(kind, &raw_total);
            let delta = &normalised - &emitted;
            if delta != 0 {
                out.push(YieldMintRow {
                    block_timestamp: t,
                    s_plusd_amount: delta,
                });
            }
            emitted = normalised;
        }
    }
    out.sort_by_key(|m| m.block_timestamp);
    out
}

/// Merge per-chain (already base-6) flow events into one list ordered by time.
pub fn merge_flows(parts: Vec<Vec<FlowEventRow>>) -> Vec<FlowEventRow> {
    let mut out: Vec<FlowEventRow> = parts.into_iter().flatten().collect();
    out.sort_by_key(|f| f.block_timestamp);
    out
}

/// Merge per-chain (already base-6) yield step events into one list ordered by time.
pub fn merge_yield_deltas(parts: Vec<Vec<YieldMintRow>>) -> Vec<YieldMintRow> {
    let mut out: Vec<YieldMintRow> = parts.into_iter().flatten().collect();
    out.sort_by_key(|m| m.block_timestamp);
    out
}

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

    // cumulative_yield_total = Σ LP-yield step events (legacy vault leg + net non-carved-out interest)
    let cumulative_yield_total = {
        let mut sum = BigDecimal::from(0);
        for m in yield_mints.iter().filter(|m| m.block_timestamp <= to) {
            sum += &m.s_plusd_amount;
        }
        base6_to_decimal_string(&sum)
    };

    // Build financial-position snapshot.
    let fp = compute_financial_position(loans, events, to);
    let outstanding_in_loans = fp.assets.deployed.secured_loans_outstanding;

    // Loan book (only avg_yield is needed here; collateral + spot + disbursement +
    // watchlist maps are irrelevant — they only affect per-loan display fields).
    let empty_collateral: HashMap<LoanRef, BigDecimal> = HashMap::new();
    let empty_spot: HashMap<LoanRef, LoanSpot> = HashMap::new();
    let empty_disbursement: HashMap<LoanRef, bool> = HashMap::new();
    let empty_watchlist_entry: HashMap<LoanRef, i64> = HashMap::new();
    let lb = compute_loan_book(
        loans,
        events,
        to,
        &empty_collateral,
        &empty_spot,
        &empty_disbursement,
        &empty_watchlist_entry,
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
/// gross_book_rate = loan_book summary.avg_yield (outstanding-senior-weighted gross current senior rate)
/// realized_net    = Σ repayment.senior_interest  (over ALL loans on chain)
/// realized_gross  = Σ (senior_interest + mgmt_fee + perf_fee)
/// haircut         = realized_gross > 0 ? realized_net / realized_gross : 1.0
/// result          = gross_book_rate × haircut
/// ```
///
/// Returns `None` only when there is no gross rate; a `0` gross rate over an outstanding
/// book yields `"0.000000"` (amounts are `0`, rates are `null`).
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
/// cumulative net yield minted (Σ of the yield step events — historical `YieldMinted`
/// plus netted `CashRepaid` mints, see `chain_yield_deltas`) at each grid point.
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

/// `TvlHistoryResponse` for a chain with no flow events yet — matches the
/// zero-valued convention `compute_summary` uses for an empty book.
fn empty_tvl_history() -> TvlHistoryResponse {
    let zero = base6_to_decimal_string(&BigDecimal::from(0));
    TvlHistoryResponse {
        series: vec![],
        max: zero.clone(),
        min: zero.clone(),
        average: zero,
    }
}

/// `YieldHistoryResponse` for a chain with no `YieldMinted` events yet.
fn empty_yield_history() -> YieldHistoryResponse {
    let zero = base6_to_decimal_string(&BigDecimal::from(0));
    YieldHistoryResponse {
        series: vec![],
        max: zero.clone(),
        min: zero.clone(),
        average: zero,
    }
}

/// `compute_tvl_series` plus `max`/`min`/`average` over `[from, to]`, computed
/// exactly from the underlying flow events (not the — possibly coarser —
/// sampled `series`), so the stats don't blur with a wide `interval`.
///
/// Public so `packages/api/tests/dashboard.rs` can exercise it without the
/// HTTP/DB layers.
pub fn compute_tvl_history(
    flows: &[FlowEventRow],
    from: i64,
    to: i64,
    step: i64,
) -> TvlHistoryResponse {
    let series = compute_tvl_series(flows, from, to, step);

    let deltas: Vec<(i64, BigDecimal)> = flows
        .iter()
        .map(|f| {
            let delta = if f.kind == "deposit" {
                f.amount.clone()
            } else {
                -f.amount.clone()
            };
            (f.block_timestamp, delta)
        })
        .collect();
    let stat = window_stats(&deltas, from, to);

    TvlHistoryResponse {
        series,
        max: base6_to_decimal_string(&stat.max),
        min: base6_to_decimal_string(&stat.min),
        average: base6_to_decimal_string(&stat.average),
    }
}

/// `compute_yield_series` plus `max`/`min`/`average` over `[from, to]`, computed
/// exactly from the underlying yield step events. See `compute_tvl_history`.
///
/// Public so `packages/api/tests/dashboard.rs` can exercise it without the
/// HTTP/DB layers.
pub fn compute_yield_history(
    mints: &[YieldMintRow],
    from: i64,
    to: i64,
    step: i64,
) -> YieldHistoryResponse {
    let series = compute_yield_series(mints, from, to, step);

    let deltas: Vec<(i64, BigDecimal)> = mints
        .iter()
        .map(|m| (m.block_timestamp, m.s_plusd_amount.clone()))
        .collect();
    let stat = window_stats(&deltas, from, to);

    YieldHistoryResponse {
        series,
        max: base6_to_decimal_string(&stat.max),
        min: base6_to_decimal_string(&stat.min),
        average: base6_to_decimal_string(&stat.average),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Max/min/time-weighted-average of a cumulative step function over
/// `[from, to]`, given `(timestamp, delta)` events sorted ascending by
/// timestamp (ties are fine — they fold in together, with zero width between
/// them, and only the value after the last event at a timestamp counts towards
/// max/min). The step function is right-continuous: its value at `t` is the sum
/// of every delta with `timestamp <= t`, matching `compute_tvl_series` /
/// `compute_yield_series`.
///
/// `average` is the integral of the step function over `[from, to]` divided by
/// `to - from` (falls back to the closing value when `to <= from`).
fn window_stats(events: &[(i64, BigDecimal)], from: i64, to: i64) -> SeriesStatValues {
    let zero = BigDecimal::from(0);

    // Fold events at or before `from` into the starting value — they contribute
    // no width to the integral, only the value the window opens with.
    let mut idx = 0;
    let mut running = zero.clone();
    while idx < events.len() && events[idx].0 <= from {
        running += &events[idx].1;
        idx += 1;
    }

    let mut max = running.clone();
    let mut min = running.clone();
    let mut integral = zero.clone();
    let mut prev_t = from;

    while idx < events.len() && events[idx].0 <= to {
        let (t, delta) = &events[idx];
        integral += &running * BigDecimal::from(t - prev_t);
        running += delta;
        idx += 1;
        while idx < events.len() && events[idx].0 == *t {
            running += &events[idx].1;
            idx += 1;
        }
        if running > max {
            max = running.clone();
        }
        if running < min {
            min = running.clone();
        }
        prev_t = *t;
    }
    integral += &running * BigDecimal::from(to - prev_t);

    let average = if to > from {
        integral / BigDecimal::from(to - from)
    } else {
        running
    };

    SeriesStatValues { max, min, average }
}

/// Unformatted counterpart of `SeriesStat` — callers format each field with
/// the series' own unit convention (e.g. `base6_to_decimal_string`) before
/// building the public response.
struct SeriesStatValues {
    max: BigDecimal,
    min: BigDecimal,
    average: BigDecimal,
}

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
