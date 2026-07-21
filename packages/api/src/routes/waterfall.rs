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
//! components" and `docs/product-specs/trustee-dashboard.md` flow note A), computed in
//! three stages:
//!
//! 1. **Cumulative targets, origination → `as_of`.** Gross interest is the maturity-capped,
//!    piecewise sum across the loan's economics-epoch timeline (`shared::loan_economics`),
//!    mirroring YieldMinter's on-chain `ceiling(loanId)` (`docs/product-specs/yield.md`
//!    §"Per-loan mint cap") — a rollover or economics amendment changes the rate/maturity
//!    from that point on, and accrual stops at each epoch's own maturity if it isn't rolled
//!    over. `senior_deployed = originalSeniorTranche` throughout (the accrual base never
//!    changes). Fees use the same piecewise-capped tenor at their single (non-epoch) rate:
//!    - `senior_gross_interest = Σ epochs: senior_deployed × epoch.rate × epoch.capped_ty`
//!    - `management_fee_cum    = senior_deployed × mgmt_rate × ty`
//!    - `performance_fee_cum   = (senior_gross_interest − management_fee_cum) × perf_rate`
//!    - `senior_coupon_net_cum = senior_gross_interest − management_fee_cum − performance_fee_cum`
//!    - `oet_allocation_cum    = senior_deployed × oet_rate × ty`
//! 2. **Subtract what's already been recorded** (the snapshot's cumulative `repayment.*`
//!    counters — the running totals `recordPayment` maintains on-chain across every prior
//!    repayment for this loan) to get what's *newly* due since the last repayment, clamped
//!    at 0 so a prior over-record can't surface as a negative "still owed" figure:
//!    `target_x = max(0, x_cum − repayment.x)`.
//! 3. **Cascade `amount` through the buckets** in the spec's priority order — senior
//!    principal → management fee → senior coupon → performance fee → OET allocation —
//!    capping each bucket at its step-2 target so a shortfall shrinks lower-priority
//!    buckets instead of reporting more than the incoming payment can cover:
//!    `senior_principal_returned = min(amount, outstanding_senior_principal)`, then each
//!    subsequent bucket = `min(target_x, remaining)` where `remaining` is `amount` less
//!    whatever higher-priority buckets already consumed.
//!
//! **Units.** All monetary values — the `amount` input and every output — are **raw
//! on-chain base units**, the same scale as the loan snapshot and `recordPayment`
//! (7-decimal USDC on Stellar/Soroban). The computation is scale-invariant: the only
//! non-monetary factors are dimensionless (`rate_bps / 10_000`, `tenor / year`), so no
//! decimal divisor is applied and the outputs can be handed straight to `recordPayment`.
//! Each component is truncated toward zero to a whole base unit.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::{BigDecimal, RoundingMode, Zero};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, OpenApi, ToSchema};

use shared::contract_logs_repo::EconomicsEventRow;
use shared::loan_economics::{build_epochs, piecewise_interest, piecewise_tenor_years};
use shared::loan_fee_schedule_repo::FeeScheduleRow;
use shared::loan_snapshot::LoanSnapshot;

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::routes::common::resolve_chain;
use crate::AppState;

/// Basis-points denominator (`10_000` bps = 100%).
const BPS_DENOM: i64 = 10_000;

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
    /// `senior_gross_interest − management_fee − performance_fee`, cascade-capped by
    /// `amount` behind higher-priority buckets on a shortfall (see module docs). →
    /// `recordPayment.seniorInterest`.
    pub senior_coupon_net: String,
    /// Management fee carve-out, cascade-capped by `amount`. → `recordPayment.mgmtFee`.
    pub management_fee: String,
    /// Performance fee carve-out, cascade-capped by `amount`. → `recordPayment.perfFee`.
    pub performance_fee: String,
    /// OET allocation carve-out, cascade-capped by `amount`. → `recordPayment.oetAlloc`.
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
    // `get_loan_snapshot_as_of` also matches the genesis `LoanDrawn` row when `as_of`
    // falls between the loan's `origination_date` field and the draw transaction's actual
    // `block_timestamp` — those two clocks aren't guaranteed to agree (see its doc
    // comment), and `compute_waterfall` below still rejects `as_of` truly before
    // `origination_date`.
    let row = state
        .contract_logs_repo
        .get_loan_snapshot_as_of(&state.pool, chain_id, &loan_id, as_of)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(format!("loan {loan_id} not indexed on chain {chain_id}"))
        })?;

    // Per-loan fee schedule. The loan exists (snapshot found above); a missing
    // loan_fee_schedule row just means no fee schedule has been configured, so fall back
    // to the all-zero default (every gross-interest base unit flows to the net senior
    // coupon), matching the migration's default-0 semantics.
    let fees = state
        .loan_fee_schedule_repo
        .get_fee_schedule(chain_id, &loan_id)
        .await?
        .unwrap_or_default();

    // Rate/maturity epoch timeline (genesis + rollovers/amendments), cut off at `as_of`
    // so a backdated repayment doesn't fold in a rollover that happened after it.
    let economics_events = state
        .contract_logs_repo
        .list_loan_economics_events(&state.pool, chain_id, &loan_id, as_of)
        .await?;

    let breakdown = compute_waterfall(&row.snapshot, &amount, as_of, &fees, &economics_events)?;

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
/// the repayment instant `as_of` (Unix seconds), the per-loan fee schedule, and the
/// loan's `LoanRolledOver` / `EconomicsAmended` events (chronologically ordered, already
/// cut off at `as_of` by the caller — see `ContractLogsRepo::list_loan_economics_events`).
/// Pure and unit-testable — no DB, no clock.
///
/// `Err(BadRequest)` when `as_of` precedes the loan's origination (negative tenor).
pub fn compute_waterfall(
    s: &LoanSnapshot,
    amount: &BigDecimal,
    as_of: i64,
    fees: &FeeScheduleRow,
    economics_events: &[EconomicsEventRow],
) -> Result<WaterfallBreakdown, ApiError> {
    if as_of < s.origination_date {
        return Err(ApiError::BadRequest(format!(
            "as_of ({as_of}) is before loan origination ({})",
            s.origination_date
        )));
    }

    // Epoch timeline (genesis + any rollovers/amendments) and its piecewise-capped
    // accrual tenor — an epoch past its own maturity without a rollover stops accruing
    // there, mirroring the on-chain interest ceiling instead of a single origination→
    // as_of span at a single (possibly stale) rate.
    let epochs = build_epochs(
        s.origination_date,
        s.original_maturity_date,
        s.senior_interest_rate_bps,
        economics_events,
    );
    let tenor_years = piecewise_tenor_years(&epochs, as_of);

    // Accrual base is always the original senior tranche (per spec).
    let senior_deployed = &s.original_senior_tranche;
    let outstanding_senior = &s.original_senior_tranche - &s.repayment.senior_principal_repaid;

    // Senior principal: capped at what's still outstanding (never negative — the
    // on-chain repaid counter can't exceed the tranche) and truncated to a whole base
    // unit like every other component, so a fractional `amount` can't leak sub-base-unit
    // precision into the output.
    let outstanding = outstanding_senior.max(BigDecimal::zero());
    let senior_principal_returned = trunc(amount.min(&outstanding));

    // Cumulative targets, origination → `as_of` (stage 1 — see module docs). Gross
    // interest is the piecewise sum across epochs (rate-change-aware); fees use the
    // same piecewise-capped tenor at their single (non-epoch) rate.
    let senior_gross_interest_cum = trunc(&piecewise_interest(&epochs, senior_deployed, as_of));
    let management_fee_cum = annualised(senior_deployed, fees.mgmt_fee_rate_bps as i64, &tenor_years);

    // Clamp the base at 0 so a mgmt rate above the senior rate can't yield a negative fee.
    let perf_base = (&senior_gross_interest_cum - &management_fee_cum).max(BigDecimal::zero());
    let performance_fee_cum = trunc(
        &(perf_base * BigDecimal::from(fees.perf_fee_rate_bps as i64) / BigDecimal::from(BPS_DENOM)),
    );
    let senior_coupon_net_cum =
        &senior_gross_interest_cum - &management_fee_cum - &performance_fee_cum;
    let oet_allocation_cum = annualised(senior_deployed, fees.oet_alloc_rate_bps as i64, &tenor_years);

    // Subtract what's already been recorded on-chain by prior repayments (stage 2). The
    // snapshot's `repayment.*` fields are the cumulative counters `recordPayment`
    // maintains, so this is the amount newly due since the last repayment. Clamped at 0:
    // a prior manual override that over-recorded a bucket must not surface as negative.
    let target_management_fee = (&management_fee_cum - &s.repayment.mgmt_fee).max(BigDecimal::zero());
    let target_performance_fee = (&performance_fee_cum - &s.repayment.perf_fee).max(BigDecimal::zero());
    let target_senior_coupon_net =
        (&senior_coupon_net_cum - &s.repayment.senior_interest).max(BigDecimal::zero());
    let target_oet_allocation = (&oet_allocation_cum - &s.repayment.oet_alloc).max(BigDecimal::zero());

    // Cascade the incoming `amount` through the documented priority order — senior
    // principal → management fee → senior coupon → performance fee → OET allocation
    // (docs/product-specs/yield.md §"Waterfall components") — capping each bucket at its
    // still-owed target (stage 3). A full/on-time payment (`amount` ≥ the sum of all
    // targets) reproduces the targets exactly; a shortfall drains `remaining` top-down so
    // lower-priority buckets shrink toward zero instead of the response reporting
    // interest/fees the incoming payment can't actually cover.
    let mut remaining = (amount - &senior_principal_returned).max(BigDecimal::zero());
    let management_fee = trunc(&target_management_fee.min(remaining.clone()));
    remaining -= &management_fee;
    let senior_coupon_net = trunc(&target_senior_coupon_net.min(remaining.clone()));
    remaining -= &senior_coupon_net;
    let performance_fee = trunc(&target_performance_fee.min(remaining.clone()));
    remaining -= &performance_fee;
    let oet_allocation = trunc(&target_oet_allocation.min(remaining));

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
