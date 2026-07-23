//! Per-loan repayment **waterfall breakdown** (`GET /v1/loan-book/{loan_id}/waterfall`).
//!
//! Read-only. Given an incoming offtaker payment (`amount`), computes the carve-outs the
//! Trustee records with `recordPayment`: senior principal returned, the net senior coupon
//! (the vault leg), the three fee carve-outs (management / performance / OET), and the
//! Equity-tranche residual. This is the server-side twin of the client-side waterfall the
//! Operations Console shows before the Trustee broadcasts — a *baseline* the Trustee may
//! then adjust for waivers, partials, or early-repayment fees.
//!
//! The algorithm is the documented waterfall (`docs/product-specs/yield.md` §"Waterfall
//! components" and `docs/product-specs/trustee-dashboard.md` flow note A), computed in
//! four stages:
//!
//! 1. **Cumulative targets, origination → `as_of`.** Gross interest is the maturity-capped,
//!    piecewise sum across the loan's economics-epoch timeline (`shared::loan_economics`) —
//!    a rollover or economics amendment changes the rate/maturity from that point on, and
//!    accrual stops at each epoch's own maturity if it isn't rolled over.
//!    `senior_deployed = originalSeniorTranche − senior_principal_repaid` (the outstanding
//!    balance, declining as principal is repaid) — matching the on-chain
//!    `calculate_max_interest`'s declining-balance model; see the `senior_deployed`
//!    binding below for the approximation this implies for a loan repaid across
//!    multiple rollovers instead of one bullet payment. Each rate compounds via real
//!    exponentiation (`compound_growth` — `(1 + rate) ^ tenor
//!    − 1`), **not** the linear/simple-interest formula the waterfall spec
//!    (`docs/product-specs/yield.md` §"Waterfall components") and YieldMinter's on-chain
//!    `ceiling(loanId)` (§"Per-loan mint cap") both document — a deliberate choice, so this
//!    endpoint's figures no longer match either of those by construction; see
//!    `compound_growth`'s doc comment for why and its precision tradeoff. Fees compound the
//!    same way, over the same piecewise-capped tenor, at their single (non-epoch) rate:
//!    - `senior_gross_interest = Σ epochs: compound_growth(senior_deployed, epoch.rate, epoch.capped_seconds)`
//!    - `management_fee_cum    = compound_growth(senior_deployed, mgmt_rate, capped_seconds)`
//!    - `performance_fee_cum   = (senior_gross_interest − management_fee_cum) × perf_rate`
//!    - `senior_coupon_net_cum = senior_gross_interest − management_fee_cum − performance_fee_cum`
//!    - `oet_allocation_cum    = compound_growth(senior_deployed, oet_rate, capped_seconds)`
//! 2. **Subtract what's already been recorded** (the snapshot's cumulative `repayment.*`
//!    counters — the running totals `recordPayment` maintains on-chain across every prior
//!    repayment for this loan) to get what's *newly* due since the last repayment, clamped
//!    at 0 so a prior over-record can't surface as a negative "still owed" figure:
//!    `target_x = max(0, x_cum − repayment.x)`.
//! 3. **Reject an `amount` that would overpay the offtaker leg.** `original_offtaker_price`
//!    is the fixed, genesis-set total the offtaker is contracted to pay over the loan's
//!    life (`docs/product-specs/loans.md` §"Genesis economics") — it is never rewritten, so
//!    `outstanding_offtaker = original_offtaker_price − repayment.offtaker_received`
//!    is a hard ceiling: nothing legitimate can cause the offtaker to pay more than the
//!    contracted price. `amount > outstanding_offtaker` is rejected with `400 Bad Request`
//!    rather than silently accepted and cascaded — an over-large `amount` is a data-entry
//!    error (or worse), not a valid repayment, and letting it through would let a bogus
//!    figure land in `equity_distributed` (stage 4) with no trace of the mistake.
//!    Deliberately **not** clamped at 0: if `repayment.offtaker_received` already exceeds
//!    `original_offtaker_price` (a prior over-record already landed on-chain), every
//!    further `amount` — including `0` — is rejected until that's corrected, rather than
//!    reporting a healthy-looking "nothing outstanding" for a loan that is already in a
//!    bad state.
//! 4. **Cascade `amount` through the tiers** in priority order — the interest tier
//!    (senior coupon + management fee + performance fee) → OET → senior principal →
//!    Equity residual — capping each tier at its step-2 target so a shortfall shrinks
//!    lower-priority tiers instead of reporting more than the incoming payment can cover.
//!    This order is a deliberate departure from `docs/product-specs/yield.md`
//!    §"Waterfall components", which puts senior principal first; here the vault (LP) and
//!    Treasury legs are paid out ahead of principal return.
//!
//!    The interest tier is **proportional, not sequential**: coupon, management fee, and
//!    performance fee are three slices of the *same* gross-interest pool
//!    (`gross_interest = mgmt + perf + net_coupon`, `docs/product-specs/loans.md:171`,
//!    "the fees are carried inside that interest"), so a payment that falls short of the
//!    tier's full target is split across the three in the same ratio as their full-period
//!    targets, rather than the coupon/vault leg draining the payment first and leaving
//!    the fees at 0 — a small interest payment still carries its proportional share of
//!    fees, the same way a full one does. OET is *not* part of this pool (it accrues
//!    independently off `senior_deployed`, never netted out of gross interest), so it
//!    remains a separate, lower-priority tier, cascaded `min(target, remaining)` same as
//!    before.
//!
//!    `senior_principal_returned = min(outstanding_senior_principal, remaining)` is
//!    second to last, where `remaining` is `amount` less whatever higher-priority tiers
//!    already consumed — this cap is what keeps cumulative `senior_principal_repaid` from
//!    ever exceeding `original_senior_tranche`, the same ceiling principle as stage 3,
//!    just against a different genesis field. `equity_distributed` is last and uncapped
//!    (per `docs/product-specs/loans.md`, "The Equity tranche has no fixed rate and
//!    receives the residual") — it simply absorbs whatever remains, which stage 3's
//!    rejection has already bounded from running away.
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
use shared::loan_economics::{
    build_epochs, compound_growth, piecewise_capped_seconds, piecewise_interest,
};
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
    /// Portion amortising outstanding senior principal: `min(outstanding_senior_principal,
    /// remaining)`, last in the cascade priority order (see module docs) — cascade-capped
    /// by `amount` behind every other bucket on a shortfall. → `recordPayment.seniorPrincipal`.
    pub senior_principal_returned: String,
    /// Net senior coupon destined for the sPLUSD **vault** (accretes NAV for LP stakers):
    /// `senior_gross_interest − management_fee − performance_fee`, first in the cascade
    /// priority order (see module docs). → `recordPayment.seniorInterest`.
    pub senior_coupon_net: String,
    /// Management fee carve-out, cascade-capped by `amount`. → `recordPayment.mgmtFee`.
    pub management_fee: String,
    /// Performance fee carve-out, cascade-capped by `amount`. → `recordPayment.perfFee`.
    pub performance_fee: String,
    /// OET allocation carve-out, cascade-capped by `amount`. → `recordPayment.oetAlloc`.
    pub oet_allocation: String,
    /// Equity-tranche residual: whatever remains of `amount` after every higher-priority
    /// bucket above, last in the cascade and uncapped (see module docs stage 4).
    /// → `recordPayment.equityAmount`.
    pub equity_distributed: String,
    /// `true` when this payment's `senior_principal_returned` brings cumulative
    /// `senior_principal_repaid` to (or past) `original_senior_tranche` — the senior debt
    /// is fully retired by this payment.
    pub senior_principal_fully_repaid: bool,
    /// `true` when this payment's `amount` brings cumulative `offtaker_received` to (or
    /// past — never past, per stage 3's rejection) `original_offtaker_price` — the
    /// offtaker has now paid the full contracted price for the cargo.
    ///
    /// Surfaced independently from `senior_principal_fully_repaid` rather than collapsed
    /// into one "fully repaid" flag: a payment that closes out the senior debt while this
    /// is still `false` means the loan is being closed from a smaller offtaker settlement
    /// than genesis contracted for (a discount, a renegotiation, an early payoff from other
    /// capital, ...) — worth a second look before closing the loan, but not necessarily
    /// invalid, so it is surfaced for the Trustee to weigh rather than rejected outright.
    pub offtaker_fully_received: bool,
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
        (status = 400, description = "Malformed loan id / amount, or amount exceeds the loan's outstanding offtaker balance"),
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
    /// Equity-tranche residual — last in the cascade, uncapped (see module docs stage 4).
    pub equity_distributed: BigDecimal,
    pub senior_principal_fully_repaid: bool,
    pub offtaker_fully_received: bool,
}

/// Truncate a value toward zero to a whole base unit.
fn trunc(v: &BigDecimal) -> BigDecimal {
    v.with_scale_round(0, RoundingMode::Down)
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

    // Stage 3 (see module docs): `original_offtaker_price` is fixed at genesis and never
    // rewritten, so the offtaker can never legitimately pay more than it over the loan's
    // life. Reject an `amount` that would push cumulative `offtaker_received` past that
    // ceiling, rather than silently cascading it — an over-large `amount` here is a
    // data-entry error, not a valid repayment.
    //
    // Deliberately NOT clamped at 0: if `offtaker_received` already exceeds
    // `original_offtaker_price` (a prior over-record — this is exactly how loan 9's bogus
    // test repayment was found), `outstanding_offtaker` goes negative and every further
    // `amount` is rejected, loudly, until someone fixes the underlying record. Flooring
    // this at 0 would report "nothing outstanding" for an already-corrupted loan — the
    // same silent-masking failure mode as reporting a healthy-looking CCR.
    let outstanding_offtaker = &s.original_offtaker_price - &s.repayment.offtaker_received;
    if amount > &outstanding_offtaker {
        return Err(ApiError::BadRequest(format!(
            "amount ({amount}) exceeds the loan's outstanding offtaker balance \
             ({outstanding_offtaker} = original_offtaker_price {} − offtaker_received {})",
            s.original_offtaker_price, s.repayment.offtaker_received
        )));
    }

    // Epoch timeline (genesis + any rollovers/amendments) and its piecewise-capped
    // accrual seconds — an epoch past its own maturity without a rollover stops accruing
    // there, instead of a single origination→as_of span at a single (possibly stale) rate.
    let epochs = build_epochs(
        s.origination_date,
        s.original_maturity_date,
        s.senior_interest_rate_bps,
        economics_events,
    );
    let capped_seconds = piecewise_capped_seconds(&epochs, as_of);

    // Accrual base is the outstanding senior principal (original tranche less what's
    // already been repaid) — matching the on-chain `calculate_max_interest`'s
    // declining-balance model, not a fixed original-tranche base held for the loan's
    // whole life. Applies to interest, management fee, and OET alike, since all three
    // compound off the same `senior_deployed` variable.
    //
    // Approximation: this repo always recomputes gross interest from scratch (no
    // stored per-epoch checkpoint the way the contract's `epoch.accrued_interest`
    // is), so today's outstanding is applied uniformly across the *whole* piecewise
    // recompute, not just the currently-open epoch. Exact for the common case
    // (principal repaid in one bullet payment — outstanding is either the full
    // tranche or already near-final for every historical epoch); would understate
    // older epochs' interest for a loan whose principal was repaid incrementally
    // across multiple rollovers, a pattern this product doesn't currently exercise.
    let outstanding_senior = &s.original_senior_tranche - &s.repayment.senior_principal_repaid;
    // Never negative — the on-chain repaid counter can't exceed the tranche.
    let outstanding = outstanding_senior.max(BigDecimal::zero());
    let senior_deployed = &outstanding;

    // Cumulative targets, origination → `as_of` (stage 1 — see module docs). Gross
    // interest is the piecewise sum across epochs (rate-change-aware, each epoch
    // compounding independently — see `piecewise_interest`); fees compound the same way
    // over the same piecewise-capped tenor at their single (non-epoch) rate.
    let senior_gross_interest_cum = trunc(&piecewise_interest(&epochs, senior_deployed, as_of));
    let management_fee_cum = trunc(&compound_growth(
        senior_deployed,
        fees.mgmt_fee_rate_bps as i64,
        capped_seconds,
    ));

    // Clamp the base at 0 so a mgmt rate above the senior rate can't yield a negative fee.
    let perf_base = (&senior_gross_interest_cum - &management_fee_cum).max(BigDecimal::zero());
    let performance_fee_cum = trunc(
        &(perf_base * BigDecimal::from(fees.perf_fee_rate_bps as i64)
            / BigDecimal::from(BPS_DENOM)),
    );
    let senior_coupon_net_cum =
        &senior_gross_interest_cum - &management_fee_cum - &performance_fee_cum;
    let oet_allocation_cum = trunc(&compound_growth(
        senior_deployed,
        fees.oet_alloc_rate_bps as i64,
        capped_seconds,
    ));

    // Subtract what's already been recorded on-chain by prior repayments (stage 2). The
    // snapshot's `repayment.*` fields are the cumulative counters `recordPayment`
    // maintains, so this is the amount newly due since the last repayment. Clamped at 0:
    // a prior manual override that over-recorded a bucket must not surface as negative.
    let target_management_fee =
        (&management_fee_cum - &s.repayment.mgmt_fee).max(BigDecimal::zero());
    let target_performance_fee =
        (&performance_fee_cum - &s.repayment.perf_fee).max(BigDecimal::zero());
    let target_senior_coupon_net =
        (&senior_coupon_net_cum - &s.repayment.senior_interest).max(BigDecimal::zero());
    let target_oet_allocation =
        (&oet_allocation_cum - &s.repayment.oet_alloc).max(BigDecimal::zero());

    // Cascade the incoming `amount` through the priority order — the interest tier
    // (senior coupon + management + performance fee, together) → OET → senior principal
    // — capping each tier at its still-owed target (stage 3). This is a deliberate
    // departure from docs/product-specs/yield.md §"Waterfall components", which puts
    // senior principal first; here the vault (LP) and Treasury legs are paid out ahead of
    // principal return. A full/on-time payment (`amount` ≥ the sum of all targets)
    // reproduces the targets exactly; a shortfall drains `remaining` top-down so
    // lower-priority tiers shrink toward zero instead of the response reporting more
    // than the incoming payment can actually cover.
    //
    // The interest tier is **proportional**, not cascaded bucket-by-bucket: coupon,
    // management fee, and performance fee are carved from the *same* gross-interest pool
    // (`gross_interest = mgmt + perf + net_coupon`, `docs/product-specs/loans.md:171`), so
    // a payment that falls short of the full tier is split across all three in the same
    // ratio as their full-period targets — a partial interest payment still pays its share
    // of fees, rather than the coupon/vault leg draining the payment first and leaving
    // fees at 0. OET is *not* part of this pool (it accrues independently off
    // `senior_deployed`, not carved out of gross interest), so it stays a separate,
    // lower-priority tier, cascaded the same way as before.
    let mut remaining = amount.clone();
    let target_total_interest =
        &target_senior_coupon_net + &target_management_fee + &target_performance_fee;
    let interest_payment = target_total_interest.clone().min(remaining.clone());
    let (senior_coupon_net, management_fee, performance_fee) = if target_total_interest.is_zero()
    {
        (BigDecimal::zero(), BigDecimal::zero(), BigDecimal::zero())
    } else {
        (
            trunc(&(&interest_payment * &target_senior_coupon_net / &target_total_interest)),
            trunc(&(&interest_payment * &target_management_fee / &target_total_interest)),
            trunc(&(&interest_payment * &target_performance_fee / &target_total_interest)),
        )
    };
    remaining -= &senior_coupon_net;
    remaining -= &management_fee;
    remaining -= &performance_fee;
    let oet_allocation = trunc(&target_oet_allocation.min(remaining.clone()));
    remaining -= &oet_allocation;
    // Truncated to a whole base unit like every other component, so a fractional
    // `amount` can't leak sub-base-unit precision into the output.
    let senior_principal_returned = trunc(&outstanding.clone().min(remaining.clone()));
    remaining -= &senior_principal_returned;
    // Last in the cascade and uncapped (stage 4) — whatever's left goes to equity. Stage
    // 3's rejection already bounds this from absorbing an implausible, unvalidated figure.
    let equity_distributed = trunc(&remaining);

    let senior_principal_fully_repaid = &outstanding - &senior_principal_returned <= BigDecimal::zero();
    let offtaker_fully_received = &outstanding_offtaker - amount <= BigDecimal::zero();

    Ok(WaterfallBreakdown {
        senior_principal_returned,
        senior_coupon_net,
        management_fee,
        performance_fee,
        oet_allocation,
        equity_distributed,
        senior_principal_fully_repaid,
        offtaker_fully_received,
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
        equity_distributed: b.equity_distributed.to_plain_string(),
        senior_principal_fully_repaid: b.senior_principal_fully_repaid,
        offtaker_fully_received: b.offtaker_fully_received,
    }
}
