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
//! 1. **Cumulative targets, first disbursement → `as_of`** — the contract's own accrual
//!    (`LoanRegistry._accruedInterest`, `docs/product-specs/yield.md` §"Waterfall components"),
//!    from the loan's `Disbursed` / `Undisbursed` / `PaymentRecorded` / `PaymentUnrecorded` /
//!    `LoanDefaulted` / `LoanWrittenDown` / `EconomicsAmended` / `LoanRolledOver` events
//!    (`shared::book_weighting::LoanAccrual`): simple interest on the outstanding senior at
//!    each moment, 365.25-day year (`CONTRACT_YEAR_SECS`), accruing through Default and past
//!    maturity (no maturity cap, issue #967). Gross interest floors each constant
//!    (outstanding, rate) segment to a whole unit, as the contract floors per epoch, so with
//!    the floored bps rate it never exceeds the on-chain cap. Fees use the same
//!    `∫ outstanding dt` at their single rate:
//!    - `senior_gross_interest = max(0, Σ segments floor(outstanding × rate × Δt / year) + interest_adjustment)` (signed; a waiver is negative)
//!    - `management_fee_cum    = mgmt_rate × ∫ outstanding dt / year`
//!    - `performance_fee_cum   = (senior_gross_interest − management_fee_cum) × perf_rate`
//!    - `senior_coupon_net_cum = senior_gross_interest − management_fee_cum − performance_fee_cum`
//!    - `oet_allocation_cum    = oet_rate × ∫ outstanding dt / year`
//! 2. **Subtract what's already been recorded** (the snapshot's cumulative `repayment.*`
//!    counters — the running totals `recordPayment` maintains on-chain across every prior
//!    repayment for this loan) to get what's *newly* due since the last repayment, clamped
//!    at 0 so a prior over-record can't surface as a negative "still owed" figure:
//!    `target_x = max(0, x_cum − repayment.x)`.
//! 3. **Bound the offtaker leg — conditionally, by pricing basis (issue #963).**
//!    `original_offtaker_price` is the genesis-set total the offtaker is contracted to pay
//!    (`docs/product-specs/loans.md` §"Genesis economics") and is never rewritten, so
//!    `outstanding_offtaker = original_offtaker_price − repayment.offtaker_received`.
//!    Whether that is a *hard ceiling* depends on `PricingBasis`:
//!    - **`Fixed`** (refined metal, grain, exchange-deliverable goods): the offtaker cannot
//!      legitimately pay more than the contracted price, so `amount > outstanding_offtaker`
//!      is rejected with `400 Bad Request` rather than silently cascaded — an over-large
//!      `amount` is a data-entry error, not a valid repayment, and letting it through would
//!      land a bogus figure in `equity_distributed` (stage 4) with no trace. Deliberately
//!      **not** clamped at 0: if `repayment.offtaker_received` already exceeds
//!      `original_offtaker_price` (a prior over-record on-chain), every further `amount` —
//!      including `0` — is rejected until that's corrected, rather than reporting a
//!      healthy-looking "nothing outstanding" for a loan already in a bad state.
//!    - **`Quotational`** (a metal concentrate settling on a quotational-period average):
//!      `original_offtaker_price` is a genesis *estimate*, not a debt ceiling — a metal-price
//!      rise over the QP legitimately lifts the final settlement above it. The payment is
//!      accepted, the overage cascades into the equity residual (stage 4), and it is surfaced
//!      via `offtaker_overpaid` for the Trustee to weigh, rather than blocked with a 400 the
//!      Soroban `validate_repayment` never imposes. The pricing basis is derived from the
//!      loan's collateral `valuation_mode` (concentrate ⇒ quotational); a loan with no
//!      valuation anchor defaults to `Fixed`.
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
//!    independently off the outstanding senior, never netted out of gross interest), so it
//!    remains a separate, lower-priority tier, cascaded `min(target, remaining)` same as
//!    before.
//!
//!    `senior_principal_returned = min(outstanding_senior_principal, remaining)` is
//!    second to last, where `remaining` is `amount` less whatever higher-priority tiers
//!    already consumed — this cap is what keeps cumulative `repaid + written_down` from
//!    ever exceeding `disbursed`, the same ceiling principle as stage 3,
//!    just against a different genesis field. `equity_distributed` is last and uncapped
//!    (per `docs/product-specs/loans.md`, "The Equity tranche has no fixed rate and
//!    receives the residual") — it simply absorbs whatever remains, which stage 3's
//!    rejection has already bounded from running away.
//!
//! **Units.** All monetary values — the `amount` input and every output — are **raw
//! on-chain base units**, the same scale as the loan snapshot and `recordPayment`
//! (7-decimal USDC on Stellar/Soroban). The computation is scale-invariant: the only
//! non-monetary factors are dimensionless (`rate_bps / 10_000`, `Δt / year`), so no
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

use shared::book_weighting::{simple_interest, LoanAccrual};
use shared::collateral_valuation_repo::ValuationMode;
use shared::contract_logs_repo::LoanRateEventRow;
use shared::loan_fee_schedule_repo::FeeScheduleRow;
use shared::loan_snapshot::LoanSnapshot;

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::routes::common::{loan_registry_address, RequiredChain};
use crate::AppState;

/// Basis-points denominator (`10_000` bps = 100%).
const BPS_DENOM: i64 = 10_000;

pub const ASSUMED_MAX_FEE_BPS: i64 = 5_000;

/// How the loan's offtaker price behaves as a repayment ceiling (issue #963).
///
/// `original_offtaker_price` is fixed at genesis, but whether it is a hard ceiling depends
/// on how the deal is priced:
/// - **`Fixed`** — refined metal, grain, exchange-deliverable material priced at a reference.
///   The offtaker can never legitimately pay more than the contracted price, so an `amount`
///   above the outstanding offtaker balance is rejected (stage 3).
/// - **`Quotational`** — a metal concentrate settling on a quotational-period average (e.g.
///   2 MAMA). `original_offtaker_price` is a genesis *estimate*; if the metal price rises
///   over the QP the offtaker legitimately pays more, so the ceiling is not enforced — the
///   overage is surfaced via `offtaker_overpaid` for the Trustee to weigh instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PricingBasis {
    Fixed,
    Quotational,
}

impl PricingBasis {
    /// Derive the pricing basis from the loan's collateral valuation mode: a metal
    /// concentrate settles on a quotational-period average, everything else is a fixed
    /// reference price. Loans with no valuation anchor resolve to `Fixed` (the strict,
    /// pre-#963 behaviour).
    pub fn from_valuation_mode(mode: ValuationMode) -> Self {
        match mode {
            ValuationMode::MetalConcentrate => PricingBasis::Quotational,
            ValuationMode::StandardGoods => PricingBasis::Fixed,
        }
    }
}

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
    /// interest/fee accrual (first disbursement → this instant); must be ≥ the loan's
    /// origination date.
    pub as_of: Option<i64>,
}

// ── Response DTOs ──────────────────────────────────────────────────────────────

/// Response for `GET /v1/loan-book/{loan_id}/waterfall`. Every field is a whole-base-unit
/// integer string (see the module docs on units) and maps 1:1 to a `recordPayment` argument.
#[derive(Debug, Serialize, ToSchema)]
pub struct WaterfallResponse {
    pub chain_id: i64,
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
    /// `true` when the full planned senior tranche was disbursed and this payment's
    /// `senior_principal_returned` brings outstanding senior principal
    /// (`disbursed − repaid − written_down`) to zero — the senior debt is fully retired.
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
    /// `true` when this payment's `amount` takes cumulative `offtaker_received` **past**
    /// `original_offtaker_price` — the offtaker paid more than the genesis-contracted price.
    ///
    /// Only reachable for a `Quotational` (concentrate) loan, where a rise in the metal
    /// price over the quotational period legitimately lifts the final settlement above the
    /// genesis estimate; the overage cascades into the equity residual. For a `Fixed` loan
    /// such an `amount` is rejected upstream (stage 3), so this is always `false`. Surfaced
    /// (not rejected) so the Trustee — and the benign-close checklist — can weigh the QP
    /// overage explicitly rather than auto-greening on `received ≥ contracted price`.
    pub offtaker_overpaid: bool,
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
        RequiredChain,
        WaterfallQuery,
    ),
    responses(
        (status = 200, description = "Repayment waterfall breakdown", body = WaterfallResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id; malformed loan id / amount, or (fixed-price loans only) amount exceeds the loan's outstanding offtaker balance"),
        (status = 404, description = "Loan not indexed as of the repayment instant"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "LoanBook"
)]
async fn get_waterfall(
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    RequiredChain(chain): RequiredChain,
    Query(query): Query<WaterfallQuery>,
) -> Result<Json<WaterfallResponse>, ApiError> {
    let chain_id = chain.chain_id;
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
    // principal it had then, consistent with the first-disbursement→`as_of` accrual.
    // `get_loan_snapshot_as_of` also matches the genesis `LoanDrawn` row when `as_of`
    // falls between the loan's `origination_date` field and the draw transaction's actual
    // `block_timestamp` — those two clocks aren't guaranteed to agree (see its doc
    // comment), and `compute_waterfall` below still rejects `as_of` truly before
    // `origination_date`.
    let registry = loan_registry_address(&state, chain_id)?;
    let row = state
        .contract_logs_repo
        .get_loan_snapshot_as_of(&state.pool, chain_id, registry, &loan_id, as_of)
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

    let rate_events = state
        .contract_logs_repo
        .list_loan_rate_events_for_loan(&state.pool, chain_id, registry, &loan_id, as_of)
        .await?;

    // Pricing basis (issue #963): a metal concentrate settles on a quotational-period
    // average, so its genesis `original_offtaker_price` is an estimate, not a hard ceiling.
    // Derive it from the loan's collateral valuation mode; a loan with no valuation anchor
    // defaults to `Fixed` (the strict, pre-#963 offtaker ceiling).
    let pricing_basis = state
        .collateral_valuation_repo
        .get_anchor(chain_id, &loan_id)
        .await?
        .map_or(PricingBasis::Fixed, |anchor| {
            PricingBasis::from_valuation_mode(anchor.valuation_mode)
        });

    let breakdown = compute_waterfall(
        &row.snapshot,
        &amount,
        as_of,
        &fees,
        &rate_events,
        pricing_basis,
    )?;

    Ok(Json(build_response(chain_id, &breakdown)))
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
    /// `amount` takes cumulative `offtaker_received` past `original_offtaker_price` — only
    /// reachable for a `Quotational` loan (a `Fixed` loan rejects it at stage 3).
    pub offtaker_overpaid: bool,
}

/// Truncate a value toward zero to a whole base unit.
fn trunc(v: &BigDecimal) -> BigDecimal {
    v.with_scale_round(0, RoundingMode::Down)
}

/// Compute the waterfall from a loan snapshot, an incoming `amount` (raw base units),
/// the repayment instant `as_of` (Unix seconds), the per-loan fee schedule, and the loan's
/// raw (un-normalised) outstanding- and rate-changing events in chain order, already cut
/// off at `as_of` by the caller (`ContractLogsRepo::list_loan_rate_events_for_loan`).
/// Pure and unit-testable — no DB, no clock.
///
/// `Err(BadRequest)` when `as_of` precedes the loan's origination (negative accrual span), or when
/// `amount` exceeds the outstanding offtaker balance **on a `Fixed`-priced loan** (stage 3).
pub fn compute_waterfall(
    s: &LoanSnapshot,
    amount: &BigDecimal,
    as_of: i64,
    fees: &FeeScheduleRow,
    rate_events: &[LoanRateEventRow],
    pricing_basis: PricingBasis,
) -> Result<WaterfallBreakdown, ApiError> {
    if as_of < s.origination_date {
        return Err(ApiError::BadRequest(format!(
            "as_of ({as_of}) is before loan origination ({})",
            s.origination_date
        )));
    }

    // Stage 3 (see module docs): whether `original_offtaker_price` is a hard ceiling depends
    // on the loan's pricing basis (issue #963).
    //
    // For a `Fixed`-priced deal (refined metal, grain, exchange-deliverable material) the
    // offtaker can never legitimately pay more than the contracted price, so an `amount`
    // that would push cumulative `offtaker_received` past it is rejected — an over-large
    // `amount` is a data-entry error, not a valid repayment. Deliberately NOT clamped at 0:
    // if `offtaker_received` already exceeds `original_offtaker_price` (a prior over-record —
    // this is exactly how loan 9's bogus test repayment was found), `outstanding_offtaker`
    // goes negative and every further `amount` is rejected, loudly, until someone fixes the
    // underlying record. Flooring this at 0 would report "nothing outstanding" for an
    // already-corrupted loan — the same silent-masking failure mode as a healthy-looking CCR.
    //
    // For a `Quotational` deal (a metal concentrate settling on a quotational-period average)
    // `original_offtaker_price` is a genesis *estimate*, not a debt ceiling: a metal-price
    // rise over the QP legitimately lifts the final settlement above it. We accept the
    // payment, let the overage cascade into the equity residual, and surface it via
    // `offtaker_overpaid` for the Trustee to weigh — rather than blocking the loan's final
    // repayment with a 400 the Soroban contract itself does not impose.
    let outstanding_offtaker = &s.original_offtaker_price - &s.repayment.offtaker_received;
    let offtaker_overpaid = amount > &outstanding_offtaker;
    if offtaker_overpaid && pricing_basis == PricingBasis::Fixed {
        return Err(ApiError::BadRequest(format!(
            "amount ({amount}) exceeds the loan's outstanding offtaker balance \
             ({outstanding_offtaker} = original_offtaker_price {} − offtaker_received {})",
            s.original_offtaker_price, s.repayment.offtaker_received
        )));
    }

    let outstanding = s.outstanding_senior_principal();
    let event_refs: Vec<&LoanRateEventRow> = rate_events.iter().collect();
    let accrual = LoanAccrual::new(s.senior_interest_rate_bps, &event_refs);
    let outstanding_seconds = accrual.outstanding_seconds(as_of);

    let senior_gross_interest_cum = (accrual.accrued_floored_per_segment(as_of)
        + &s.interest_adjustment)
        .max(BigDecimal::zero());
    let management_fee_cum = trunc(&simple_interest(
        &outstanding_seconds,
        i64::from(fees.mgmt_fee_rate_bps),
    ));

    let perf_base = (&senior_gross_interest_cum - &management_fee_cum).max(BigDecimal::zero());
    let performance_fee_cum = trunc(
        &(perf_base * BigDecimal::from(fees.perf_fee_rate_bps as i64)
            / BigDecimal::from(BPS_DENOM)),
    );
    let senior_coupon_net_cum =
        &senior_gross_interest_cum - &management_fee_cum - &performance_fee_cum;
    let oet_allocation_cum = trunc(&simple_interest(
        &outstanding_seconds,
        i64::from(fees.oet_alloc_rate_bps),
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
    let (senior_coupon_net, management_fee, performance_fee) = if target_total_interest.is_zero() {
        (BigDecimal::zero(), BigDecimal::zero(), BigDecimal::zero())
    } else {
        (
            trunc(&(&interest_payment * &target_senior_coupon_net / &target_total_interest)),
            trunc(&(&interest_payment * &target_management_fee / &target_total_interest)),
            trunc(&(&interest_payment * &target_performance_fee / &target_total_interest)),
        )
    };
    let (management_fee, performance_fee) =
        cap_interest_fees(&senior_coupon_net, management_fee, performance_fee);
    remaining -= &senior_coupon_net;
    remaining -= &management_fee;
    remaining -= &performance_fee;
    let oet_room = oet_room_under_cap(&senior_coupon_net, &management_fee, &performance_fee);
    let oet_allocation = trunc(&target_oet_allocation.min(remaining.clone()).min(oet_room));
    remaining -= &oet_allocation;
    // Truncated to a whole base unit like every other component, so a fractional
    // `amount` can't leak sub-base-unit precision into the output.
    let senior_principal_returned = trunc(&outstanding.clone().min(remaining.clone()));
    remaining -= &senior_principal_returned;
    // Last in the cascade and uncapped (stage 4) — whatever's left goes to equity. Stage
    // 3's rejection already bounds this from absorbing an implausible, unvalidated figure.
    let equity_distributed = trunc(&remaining);

    let senior_principal_fully_repaid = s.disbursed >= s.original_senior_tranche
        && &outstanding - &senior_principal_returned <= BigDecimal::zero();
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
        offtaker_overpaid,
    })
}

fn cap_interest_fees(
    coupon: &BigDecimal,
    management_fee: BigDecimal,
    performance_fee: BigDecimal,
) -> (BigDecimal, BigDecimal) {
    if ASSUMED_MAX_FEE_BPS >= BPS_DENOM {
        return (management_fee, performance_fee);
    }
    let fees = &management_fee + &performance_fee;
    let limit = trunc(
        &(coupon * BigDecimal::from(ASSUMED_MAX_FEE_BPS)
            / BigDecimal::from(BPS_DENOM - ASSUMED_MAX_FEE_BPS)),
    );
    if fees <= limit {
        return (management_fee, performance_fee);
    }
    (
        trunc(&(&limit * &management_fee / &fees)),
        trunc(&(&limit * &performance_fee / &fees)),
    )
}

fn oet_room_under_cap(
    coupon: &BigDecimal,
    management_fee: &BigDecimal,
    performance_fee: &BigDecimal,
) -> BigDecimal {
    let fees = management_fee + performance_fee;
    let cap = trunc(
        &((coupon + &fees) * BigDecimal::from(ASSUMED_MAX_FEE_BPS) / BigDecimal::from(BPS_DENOM)),
    );
    (cap - fees).max(BigDecimal::zero())
}

/// Map the computed split to the response DTO. Pure and unit-testable.
pub fn build_response(chain_id: i64, b: &WaterfallBreakdown) -> WaterfallResponse {
    WaterfallResponse {
        chain_id,
        senior_principal_returned: b.senior_principal_returned.to_plain_string(),
        senior_coupon_net: b.senior_coupon_net.to_plain_string(),
        management_fee: b.management_fee.to_plain_string(),
        performance_fee: b.performance_fee.to_plain_string(),
        oet_allocation: b.oet_allocation.to_plain_string(),
        equity_distributed: b.equity_distributed.to_plain_string(),
        senior_principal_fully_repaid: b.senior_principal_fully_repaid,
        offtaker_fully_received: b.offtaker_fully_received,
        offtaker_overpaid: b.offtaker_overpaid,
    }
}
