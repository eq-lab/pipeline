//! Loan Book endpoint (`GET /v1/loan-book`).
//!
//! Read-only aggregation backing the Loan Book section of the Protocol Dashboard:
//! portfolio-level summary cards plus the active-loan table. Conventions match
//! `routes::stats` / `routes::portfolio` — Axum handler, utoipa schema, base-6
//! decimal strings for USDC amounts, decimal-fraction strings for rates, and
//! `chain_id?` defaulting to `DEFAULT_CHAIN_ID`.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive};
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};

use crate::error::ApiError;
use crate::formatting::base6_to_decimal_string;
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

// ── Constants ────────────────────────────────────────────────────────────────

/// Seconds per day. Matches `routes::portfolio::SECS_PER_DAY`; duplicated here to
/// keep this module self-contained.
const SECS_PER_DAY: i64 = 86_400;
/// Basis-points denominator (10_000 bps = 100 %).
const BPS_DENOM: i64 = 10_000;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Portfolio-level aggregates for the Loan Book header cards. Computed over the
/// *active* loan set (`origination_date <= now < effective_end`), the same
/// definition used by `routes::portfolio::compute_series`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanBookSummary {
    /// Total capital deployed = Σ (senior + equity tranche) over active loans,
    /// USDC (6-decimal string).
    pub total_deployed: String,
    /// Total collateral value = Σ (loan-registry collateral × current price).
    ///
    /// `null`: TODO #706 — no commodity price feed or collateral-quantity source
    /// is indexed yet, so live collateral valuation is not computable. Wire this
    /// once a price source exists.
    pub total_collateral: Option<String>,
    /// Senior debt coverage = `total_collateral / Σ senior_tranche`, 2-decimal
    /// string (e.g. `"1.50"`).
    ///
    /// `null` while `total_collateral` is unavailable (TODO #706).
    pub senior_debt_coverage: Option<String>,
    /// Principal-weighted senior interest rate as a decimal fraction (e.g.
    /// `"0.112000"` = 11.2 %), 6-decimal string. Weighted by per-loan principal
    /// (senior + equity). `null` when no loans are active.
    pub avg_yield: Option<String>,
    /// Principal-weighted loan term in days, rounded. `null` when no loans are active.
    pub avg_duration_days: Option<i64>,
}

/// One row in the Loan Book table.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanBookEntry {
    /// Originating party (e.g. `"Open Mineral"`).
    pub originator: String,
    /// Borrower identifier from the loan snapshot.
    pub borrower: String,
    /// Underlying commodity (e.g. `"Copper Concentrate"`).
    pub commodity: String,
    /// Principal = senior tranche + equity tranche, USDC (6-decimal string).
    pub principal: String,
    /// Collateral value = collateral quantity × current price, USDC (6-decimal string).
    ///
    /// `null`: TODO #706 — no price feed / collateral-quantity source indexed yet.
    pub collateral: Option<String>,
    /// Loan-to-value = `principal / collateral`, 4-decimal string (e.g. `"0.8511"`).
    ///
    /// `null` while `collateral` is unavailable (TODO #706).
    pub ltv: Option<String>,
    /// Original loan term in days (`maturity − origination`).
    pub duration_days: i64,
    /// Senior interest rate as a decimal fraction, 6-decimal string (e.g. `"0.112000"`
    /// = 11.2 %). Matches the `apy` / `avg_yield` format used across the API.
    pub rate: String,
    /// Trade-finance protection instrument (e.g. "LC at sight", "Doc. coll.").
    ///
    /// `null`: TODO #706 — field will be added to the loan model soon.
    pub protection: Option<String>,
    /// Loan status from the latest snapshot (`Performing`, `WatchList`, …).
    pub status: String,
}

/// Response for `GET /v1/loan-book`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanBookResponse {
    pub summary: LoanBookSummary,
    /// Active loans, sorted by `principal` descending.
    pub loans: Vec<LoanBookEntry>,
}

/// OpenAPI doc bundle for the loan-book route.
#[derive(OpenApi)]
#[openapi(
    paths(get_loan_book),
    components(schemas(LoanBookResponse, LoanBookSummary, LoanBookEntry)),
    tags((name = "LoanBook", description = "Protocol loan book aggregation"))
)]
pub struct LoanBookDoc;

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/loan-book", get(get_loan_book))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/loan-book",
    params(
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Loan book aggregates and active-loan table", body = LoanBookResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "LoanBook"
)]
async fn get_loan_book(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<LoanBookResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    handle_loan_book(&state, chain_id).await.map(Json)
}

async fn handle_loan_book(state: &AppState, chain_id: i64) -> Result<LoanBookResponse, ApiError> {
    // As-of "now" — this endpoint reports the current loan book, matching the
    // window-ends-at-now semantics of the other read endpoints.
    let to = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let loans = state
        .contract_logs_repo
        .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, to)
        .await?;

    if loans.is_empty() {
        return Ok(empty_response());
    }

    let events = state
        .contract_logs_repo
        .list_loan_lifecycle_events(&state.pool, chain_id, to)
        .await?;

    Ok(compute_loan_book(&loans, &events, to))
}

// ── Compute ──────────────────────────────────────────────────────────────────

/// Per-loan principal = senior tranche + equity tranche.
fn principal_of(loan: &LoanSnapshotRow) -> BigDecimal {
    &loan.snapshot.original_senior_tranche + &loan.snapshot.original_equity_tranche
}

/// Effective end of a loan: `min(original_maturity_date, earliest LoanClosed /
/// LoanDefaulted timestamp)`. Mirrors `routes::portfolio`'s end-resolution so the
/// "active" set is identical across endpoints.
fn effective_end(loan: &LoanSnapshotRow, events: &[LifecycleRow]) -> i64 {
    let lifecycle_end = events
        .iter()
        .filter(|e| {
            (e.event_name == "LoanClosed" || e.event_name == "LoanDefaulted")
                && e.loan_id == loan.loan_id
        })
        .map(|e| e.block_timestamp)
        .min();

    match lifecycle_end {
        Some(lc) => loan.snapshot.original_maturity_date.min(lc),
        None => loan.snapshot.original_maturity_date,
    }
}

/// Pure computation: no DB calls. Builds the Loan Book summary + active-loan table
/// from pre-fetched loan snapshots and lifecycle events as-of `to`.
///
/// "Active" = `origination_date <= to < effective_end`, matching
/// `routes::portfolio::compute_series`. Matured, closed, and defaulted loans are
/// excluded (a defaulted loan's `LoanDefaulted` event sets its `effective_end`).
///
/// `total_collateral`, `senior_debt_coverage`, and per-loan `collateral` / `ltv`
/// are always `null` for now — see the DTO docs (TODO #706: no price source).
///
/// Public so the compute-layer test in `packages/api/tests/loan_book.rs` can
/// exercise it without the HTTP/DB layers.
pub fn compute_loan_book(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    to: i64,
) -> LoanBookResponse {
    // Active loan set, sorted by principal (senior + equity) descending.
    let mut active: Vec<&LoanSnapshotRow> = loans
        .iter()
        .filter(|loan| loan.snapshot.origination_date <= to && to < effective_end(loan, events))
        .collect();
    active.sort_by_key(|loan| std::cmp::Reverse(principal_of(loan)));

    if active.is_empty() {
        return empty_response();
    }

    let mut entries = Vec::with_capacity(active.len());
    let mut total_deployed = BigDecimal::from(0);
    // Principal-weighted numerators; denominator is total_deployed.
    let mut weighted_rate_bps = BigDecimal::from(0);
    let mut weighted_duration = BigDecimal::from(0);

    for loan in &active {
        let s = &loan.snapshot;
        let principal = principal_of(loan);
        let duration_days = ((s.original_maturity_date - s.origination_date) / SECS_PER_DAY).max(0);
        // bps → decimal fraction: 1120 bps → "0.112000" (matches the API's apy format).
        let rate = (BigDecimal::from(i64::from(s.senior_interest_rate_bps))
            / BigDecimal::from(BPS_DENOM))
        .with_scale_round(6, RoundingMode::HalfUp)
        .to_plain_string();

        total_deployed += &principal;
        weighted_rate_bps += &principal * BigDecimal::from(i64::from(s.senior_interest_rate_bps));
        weighted_duration += &principal * BigDecimal::from(duration_days);

        entries.push(LoanBookEntry {
            originator: s.originator.clone(),
            borrower: s.borrower_id.clone(),
            commodity: s.commodity.clone(),
            principal: base6_to_decimal_string(&principal),
            // TODO #706: collateral value (qty × current price) — no source yet.
            collateral: None,
            // TODO #706: ltv = principal / collateral — null while collateral null.
            ltv: None,
            duration_days,
            rate,
            // TODO #706: protection instrument — field coming to the loan model soon.
            protection: None,
            status: s.status.clone(),
        });
    }

    // avg_yield = (Σ principal·rate_bps / Σ principal) / 10_000, as a decimal fraction.
    let avg_yield = (&weighted_rate_bps / &total_deployed / BigDecimal::from(BPS_DENOM))
        .with_scale_round(6, RoundingMode::HalfUp)
        .to_plain_string();

    // avg_duration_days = Σ principal·duration / Σ principal, rounded to nearest day.
    let avg_duration_days = (&weighted_duration / &total_deployed)
        .with_scale_round(0, RoundingMode::HalfUp)
        .to_i64();

    LoanBookResponse {
        summary: LoanBookSummary {
            total_deployed: base6_to_decimal_string(&total_deployed),
            // TODO #706: total_collateral = Σ (collateral qty × current price) — no source yet.
            total_collateral: None,
            // TODO #706: senior_debt_coverage = total_collateral / Σ senior_tranche.
            senior_debt_coverage: None,
            avg_yield: Some(avg_yield),
            avg_duration_days,
        },
        loans: entries,
    }
}

/// Empty loan book: zeroed deployed, null optionals, no rows. Returned when the
/// chain has no loans (or none active).
fn empty_response() -> LoanBookResponse {
    LoanBookResponse {
        summary: LoanBookSummary {
            total_deployed: base6_to_decimal_string(&BigDecimal::from(0)),
            total_collateral: None,
            senior_debt_coverage: None,
            avg_yield: None,
            avg_duration_days: None,
        },
        loans: vec![],
    }
}
