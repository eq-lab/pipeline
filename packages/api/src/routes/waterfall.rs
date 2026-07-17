//! Per-loan repayment **waterfall breakdown** (`GET /v1/loan-book/{loan_id}/waterfall`).
//!
//! Read-only. Given an incoming offtaker payment (`amount`), computes the carve-outs the
//! Trustee records with `recordPayment`: senior principal returned, the net senior coupon
//! (the vault leg), and the three fee carve-outs (management / performance / OET). This is
//! the server-side twin of the client-side waterfall the Operations Console shows before
//! the Trustee broadcasts — a *baseline* the Trustee may then adjust for waivers, partials,
//! or early-repayment fees.
//!
//! The algorithm is the documented waterfall (`docs/product-specs/yield.md` §"Waterfall
//! components" and `docs/product-specs/trustee-dashboard.md` flow note A), with
//! `senior_deployed = originalSeniorTranche` (the accrual base) and `ty = tenor / 365`
//! (years):
//! - `senior_principal_returned = min(amount, outstanding_senior_principal)`
//! - `senior_gross_interest     = senior_deployed × senior_rate × ty`  (intermediate)
//! - `management_fee            = senior_deployed × mgmt_rate × ty`
//! - `performance_fee           = (senior_gross_interest − management_fee) × perf_rate`
//! - `senior_coupon_net         = senior_gross_interest − management_fee − performance_fee`  (→ vault)
//! - `oet_allocation            = senior_deployed × oet_rate × ty`
//!
//! **Units.** All monetary values — the `amount` input and every output — are **raw
//! on-chain base units**, the same scale as the loan snapshot and `recordPayment`
//! (7-decimal USDC on Stellar/Soroban). The computation is scale-invariant: the only
//! non-monetary factors are dimensionless (`rate_bps / 10_000`, `tenor / year`), so no
//! decimal divisor is applied and the outputs can be handed straight to `recordPayment`.
//! Each component is truncated toward zero to a whole base unit.
//!
//! **Baseline approximations** (documented so consumers don't over-read the split, and
//! matching the spec's single-rate / single-tenor Flow note A rather than the on-chain
//! piecewise-epoch ceiling):
//! - The senior rate is the **genesis** `seniorInterestRateBps`; rollovers / economics
//!   amendments are not folded in.
//! - The tenor runs origination → `as_of` with no maturity cap — a repayment past
//!   maturity keeps accruing in this baseline.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode, Zero};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, OpenApi, ToSchema};

use shared::loan_parameters_repo::FeeScheduleRow;
use shared::loan_snapshot::LoanSnapshot;

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::routes::common::resolve_chain;
use crate::AppState;

/// Basis-points denominator (`10_000` bps = 100%).
const BPS_DENOM: i64 = 10_000;

/// Seconds in the 365-day interest year used by the `tenor / 365` factor.
const YEAR_SECONDS: i64 = 365 * 86_400;

// ── Query ────────────────────────────────────────────────────────────────────

/// Query parameters for the waterfall endpoint.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WaterfallQuery {
    /// Incoming offtaker payment, in **raw on-chain base units** (same scale as
    /// `recordPayment.offtakerAmount` — 7-decimal USDC on Stellar). Required;
    /// non-negative. Passed as a string to preserve values beyond JS safe-int range.
    pub amount: String,
    /// Repayment date, Unix epoch **seconds**. Optional — defaults to now. Drives the
    /// interest/fee tenor (origination → this instant); must be ≥ the loan's
    /// origination date.
    pub as_of: Option<i64>,
    /// Chain ID (optional — defaults to `DEFAULT_CHAIN_ID`).
    pub chain_id: Option<i64>,
}

// ── Response DTOs ──────────────────────────────────────────────────────────────

/// Response for `GET /v1/loan-book/{loan_id}/waterfall`. Every field is a whole-base-unit
/// integer string (see the module docs on units) and maps 1:1 to a `recordPayment` argument.
#[derive(Debug, Serialize, ToSchema)]
pub struct WaterfallResponse {
    /// Portion amortising outstanding senior principal
    /// (`min(amount, outstanding_senior_principal)`). → `recordPayment.seniorPrincipal`.
    pub senior_principal_returned: String,
    /// Net senior coupon destined for the sPLUSD **vault** (accretes NAV for LP stakers):
    /// `senior_gross_interest − management_fee − performance_fee`. → `recordPayment.seniorInterest`.
    pub senior_coupon_net: String,
    /// Management fee carve-out. → `recordPayment.mgmtFee`.
    pub management_fee: String,
    /// Performance fee carve-out. → `recordPayment.perfFee`.
    pub performance_fee: String,
    /// OET allocation carve-out. → `recordPayment.oetAlloc`.
    pub oet_allocation: String,
}

/// OpenAPI doc bundle for the waterfall route.
#[derive(OpenApi)]
#[openapi(
    paths(get_waterfall),
    components(schemas(WaterfallResponse)),
    modifiers(&SecurityAddon)
)]
pub struct WaterfallDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/loan-book/{loan_id}/waterfall", get(get_waterfall))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/loan-book/{loan_id}/waterfall",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id"),
        WaterfallQuery,
    ),
    responses(
        (status = 200, description = "Repayment waterfall breakdown", body = WaterfallResponse),
        (status = 400, description = "Malformed loan id / amount"),
        (status = 404, description = "Loan not indexed as of the repayment instant"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "LoanBook"
)]
async fn get_waterfall(
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    Query(query): Query<WaterfallQuery>,
) -> Result<Json<WaterfallResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let loan_id = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    let amount = BigDecimal::from_str(query.amount.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid amount: {}", query.amount)))?;
    if amount < BigDecimal::zero() {
        return Err(ApiError::BadRequest(format!(
            "amount ({amount}) must be ≥ 0"
        )));
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let as_of = query.as_of.unwrap_or(now);

    // Loan snapshot as of the repayment instant (status, immutable economics, cumulative
    // repayment) — cut off at `as_of` so a backdated repayment sees the outstanding
    // principal it had then, consistent with the origination→`as_of` accrual tenor.
    let snapshots = state
        .contract_logs_repo
        .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, as_of)
        .await?;
    let row = snapshots
        .into_iter()
        .find(|r| r.loan_id == loan_id)
        .ok_or_else(|| {
            ApiError::NotFound(format!("loan {loan_id} not indexed on chain {chain_id}"))
        })?;

    // Per-loan fee schedule (loan_parameters is keyed by loan_id alone). The loan exists
    // (snapshot found above); a missing loan_parameters row just means no fee schedule has
    // been configured, so fall back to the all-zero default (every gross-interest base unit
    // flows to the net senior coupon), matching the migration's default-0 semantics.
    let fees = state
        .loan_parameters_repo
        .get_fee_schedule(&loan_id)
        .await?
        .unwrap_or_default();

    let breakdown = compute_waterfall(&row.snapshot, &amount, as_of, &fees)?;

    Ok(Json(build_response(&breakdown)))
}

// ── Pure core (testable: no DB, no clock) ───────────────────────────────────────

/// The whole-base-unit carve-outs (all integers, truncated toward zero). These are the
/// components the response exposes, each mapping 1:1 to a `recordPayment` argument.
#[derive(Debug, Clone, PartialEq)]
pub struct WaterfallBreakdown {
    pub senior_principal_returned: BigDecimal,
    /// Net senior coupon destined for the sPLUSD vault (`gross_interest − mgmt − perf`).
    pub senior_coupon_net: BigDecimal,
    pub management_fee: BigDecimal,
    pub performance_fee: BigDecimal,
    pub oet_allocation: BigDecimal,
}

/// Truncate a value toward zero to a whole base unit.
fn trunc(v: &BigDecimal) -> BigDecimal {
    v.with_scale_round(0, RoundingMode::Down)
}

/// `base × (rate_bps / 10_000) × tenor_years`, truncated to a whole base unit. Used for
/// the annualised carve-outs (gross interest, management fee, OET allocation).
fn annualised(base: &BigDecimal, rate_bps: i64, tenor_years: &BigDecimal) -> BigDecimal {
    trunc(&(base * BigDecimal::from(rate_bps) / BigDecimal::from(BPS_DENOM) * tenor_years))
}

/// Compute the waterfall from a loan snapshot, an incoming `amount` (raw base units),
/// the repayment instant `as_of` (Unix seconds), and the per-loan fee schedule. Pure
/// and unit-testable — no DB, no clock.
///
/// `Err(BadRequest)` when `as_of` precedes the loan's origination (negative tenor).
pub fn compute_waterfall(
    s: &LoanSnapshot,
    amount: &BigDecimal,
    as_of: i64,
    fees: &FeeScheduleRow,
) -> Result<WaterfallBreakdown, ApiError> {
    let tenor_seconds = as_of - s.origination_date;
    if tenor_seconds < 0 {
        return Err(ApiError::BadRequest(format!(
            "as_of ({as_of}) is before loan origination ({})",
            s.origination_date
        )));
    }
    let tenor_years = BigDecimal::from(tenor_seconds) / BigDecimal::from(YEAR_SECONDS);

    // Accrual base is always the original senior tranche (per spec).
    let senior_deployed = &s.original_senior_tranche;
    let outstanding_senior = &s.original_senior_tranche - &s.repayment.senior_principal_repaid;

    // Senior principal: capped at what's still outstanding (never negative — the
    // on-chain repaid counter can't exceed the tranche) and truncated to a whole base
    // unit like every other component, so a fractional `amount` can't leak sub-base-unit
    // precision into the output.
    let outstanding = outstanding_senior.max(BigDecimal::zero());
    let senior_principal_returned = trunc(amount.min(&outstanding));

    // Gross interest and management fee (annualised over the tenor).
    let senior_gross_interest = annualised(senior_deployed, s.senior_interest_rate_bps as i64, &tenor_years);
    let management_fee = annualised(senior_deployed, fees.mgmt_fee_rate_bps as i64, &tenor_years);

    // Performance fee: a fraction of (gross interest − management fee). Clamp the base at
    // 0 so a mgmt rate above the senior rate can't yield a negative fee.
    let perf_base = (&senior_gross_interest - &management_fee).max(BigDecimal::zero());
    let performance_fee = trunc(
        &(perf_base * BigDecimal::from(fees.perf_fee_rate_bps as i64) / BigDecimal::from(BPS_DENOM)),
    );

    // Net senior coupon destined for the vault (interest left after the fee carve-outs).
    let senior_coupon_net = &senior_gross_interest - &management_fee - &performance_fee;

    // OET allocation (annualised).
    let oet_allocation = annualised(senior_deployed, fees.oet_alloc_rate_bps as i64, &tenor_years);

    Ok(WaterfallBreakdown {
        senior_principal_returned,
        senior_coupon_net,
        management_fee,
        performance_fee,
        oet_allocation,
    })
}

/// Map the computed split to the response DTO. Pure and unit-testable.
pub fn build_response(b: &WaterfallBreakdown) -> WaterfallResponse {
    WaterfallResponse {
        senior_principal_returned: b.senior_principal_returned.to_plain_string(),
        senior_coupon_net: b.senior_coupon_net.to_plain_string(),
        management_fee: b.management_fee.to_plain_string(),
        performance_fee: b.performance_fee.to_plain_string(),
        oet_allocation: b.oet_allocation.to_plain_string(),
    }
}
