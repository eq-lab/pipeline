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
//!    maturity (no maturity cap, issue #967). Gross interest uses the full 1e6
//!    rate and floors once per contract epoch (opened by every outstanding event except
//!    `LoanDefaulted`, and by every rate event), so it equals the on-chain `_accruedInterest`.
//!    Fees use the same
//!    `∫ outstanding dt` at their single rate:
//!    - `senior_gross_interest = max(0, Σ epochs floor(outstanding × rate × Δt / year) + interest_adjustment)` (signed; a waiver is negative)
//!    - `management_fee_cum    = mgmt_rate × ∫ outstanding dt / year`
//!    - `performance_fee_cum   = (senior_gross_interest − management_fee_cum) × perf_rate`
//!    - `senior_coupon_net_cum = senior_gross_interest − management_fee_cum − performance_fee_cum`
//!    - `oet_allocation_cum    = oet_rate × ∫ outstanding dt / year`
//! 2. **Subtract what's already been recorded** (the loan's **latest** cumulative
//!    `repayment.*` counters — the running totals `recordPayment` maintains on-chain across
//!    every prior repayment for this loan) to get what's *newly* due since the last
//!    repayment, clamped at 0 so a prior over-record can't surface as a negative "still
//!    owed" figure: `target_x = max(0, x_cum − repayment.x)`.
//! 3. **Bound the offtaker leg** (`400` above `original_offtaker_price − latest repayment.offtaker_received`).
//! 4. **Cascade `amount` through the tiers** in priority order — the interest tier
//!    (senior coupon + management fee + performance fee) → OET → senior principal →
//!    Equity residual — capping each tier at its step-2 target (the senior coupon may exceed
//!    its own target, see below) so a shortfall shrinks lower-priority tiers instead of
//!    reporting more than the incoming payment can cover.
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
//!    fees, the same way a full one does. The coupon takes the truncation residual, and
//!    when the contract fee cap binds (`fit_interest_to_fee_cap`) it also takes the fee
//!    legs' excess, so it can exceed its own target and the fee split departs from the
//!    target ratio; total interest stays `min(target total, amount)`. OET is *not* part of this pool (it accrues
//!    independently off the outstanding senior, never netted out of gross interest), so it
//!    remains a separate, lower-priority tier, cascaded `min(target, remaining)` same as
//!    before.
//!
//!    `senior_principal_returned = min(outstanding at as_of, latest outstanding, remaining)` is
//!    second to last, where `remaining` is `amount` less whatever higher-priority tiers
//!    already consumed — this cap is what keeps cumulative `repaid + written_down` from
//!    ever exceeding `disbursed`, the same ceiling principle as stage 3,
//!    just against a different genesis field. `equity_distributed` is last and uncapped
//!    (per `docs/product-specs/loans.md`, "The Equity tranche has no fixed rate and
//!    receives the residual") — it simply absorbs whatever remains, which stage 3's
//!    rejection has already bounded from running away.
//!
//! **Backdated `as_of`.** Accrual runs to `as_of`; every running counter the registry
//! checks at execution (recorded totals, `interest_adjustment`, `offtaker_received`, status,
//! `repaid + written_down ≤ disbursed`) comes from the loan's latest indexed snapshot (#2145).
//! A loan whose latest status is outside `Performing..=Default` is a `400`, as `recordPayment`
//! reverts `WrongCurrentStatus` there on both chains.
//!
//! **Contract bounds.** The new `senior_interest + mgmt + perf` never exceeds the contract
//! headroom `max(0, floor-accrued gross + interest_adjustment − recorded(senior_interest +
//! mgmt + perf))` (`LoanRegistryInterestExceedsMax`). The fee cap `mgmt + perf + oet ≤
//! floor((senior_interest + mgmt + perf) × max_fee_bps / 10_000)` is met by moving any fee excess
//! to the net coupon, so the interest total is unchanged; OET uses only the room left under the
//! cap (`docs/product-specs/yield.md` § Waterfall components). The cap is the registry's
//! synced `max_fee_bps` (`shared::loan_registry_settings_repo`); a missing row is a `503` except for a `Default` loan.
//! For a loan whose latest status is `Default` the contract demands fees, OET and equity of 0
//! (`LoanRegistryNonZeroOnDefault`): the payment is split senior principal first, then senior
//! interest, and an `amount` above principal outstanding + headroom is a `400`. An `as_of` more
//! than 300 s ahead of now is a `400`. A snapshot whose outstanding senior the indexed events
//! cannot reproduce is a `422` (re-index required) rather than a silent 0 interest.
//!
//! **Units.** All monetary values — the `amount` input and every output — are **raw
//! on-chain base units**, the same scale as the loan snapshot and `recordPayment`
//! (7-decimal USDC on Stellar/Soroban). The computation is scale-invariant: the only
//! non-monetary factors are dimensionless (`rate / 1_000_000`, `Δt / year`), so no
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
use shared::contract_logs_repo::LoanRateEventRow;
use shared::loan_fee_schedule_repo::FeeScheduleRow;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use shared::loan_status::LoanStatus;

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::routes::common::{loan_registry_address, RequiredChain};
use crate::AppState;

/// Basis-points denominator (`10_000` bps = 100%).
const BPS_DENOM: i64 = 10_000;

pub const AS_OF_FUTURE_SKEW_SECS: i64 = 300;

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
        RequiredChain,
        WaterfallQuery,
    ),
    responses(
        (status = 200, description = "Repayment waterfall breakdown", body = WaterfallResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id; malformed loan id / amount, or amount exceeds the loan's outstanding offtaker balance"),
        (status = 400, description = "The loan's latest status is not Performing, WatchList or Default (recordPayment rejects it)"),
        (status = 400, description = "as_of is in the future, or a Default-loan payment exceeds what the contract lets it record (outstanding principal + interest headroom)"),
        (status = 404, description = "Loan not indexed as of the repayment instant"),
        (status = 422, description = "Loan event history incomplete (outstanding senior does not match the indexed events); re-index required"),
        (status = 500, description = "Internal server error"),
        (status = 503, description = "The LoanRegistry's max_fee_bps has not been read from the chain yet"),
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
    if let Some(requested) = query.as_of {
        validate_as_of_not_future(requested, now)?;
    }
    let as_of = query.as_of.unwrap_or(now);

    // The as_of snapshot drives accrual; the latest snapshot drives the registry's
    // running-state checks at execution (#2145). `get_loan_snapshot_as_of` also matches the genesis `LoanDrawn` row when `as_of`
    // falls between the loan's `origination_date` field and the draw transaction's actual
    // `block_timestamp` — those two clocks aren't guaranteed to agree (see its doc
    // comment), and `compute_waterfall` below still rejects `as_of` truly before
    // `origination_date`.
    let registry = loan_registry_address(&state, chain_id)?;
    let latest_row = state
        .contract_logs_repo
        .get_loan_snapshot_as_of(&state.pool, chain_id, registry, &loan_id, i64::MAX)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(format!("loan {loan_id} not indexed on chain {chain_id}"))
        })?;
    ensure_repayable_status(&latest_row.snapshot.status)?;
    let row = if needs_as_of_read(latest_row.block_timestamp, as_of) {
        state
            .contract_logs_repo
            .get_loan_snapshot_as_of(&state.pool, chain_id, registry, &loan_id, as_of)
            .await?
            .ok_or_else(|| {
                ApiError::NotFound(format!("loan {loan_id} not indexed on chain {chain_id}"))
            })?
    } else {
        latest_row.clone()
    };
    let latest = LatestLoanState::from(&latest_row.snapshot);

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

    ensure_event_history_complete(&row.snapshot, &rate_events, as_of, row.block_timestamp)?;

    let max_fee_bps =
        shared::loan_registry_settings_repo::max_fee_bps(&state.pool, chain_id, registry).await?;

    let breakdown = compute_waterfall(
        &row.snapshot,
        &latest,
        &amount,
        as_of,
        &fees,
        &rate_events,
        max_fee_bps,
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct LatestLoanState {
    pub status: String,
    pub disbursed: BigDecimal,
    pub outstanding_senior_principal: BigDecimal,
    pub interest_adjustment: BigDecimal,
    pub repayment: RepaymentSnapshot,
}

impl From<&LoanSnapshot> for LatestLoanState {
    fn from(s: &LoanSnapshot) -> Self {
        Self {
            status: s.status.clone(),
            disbursed: s.disbursed.clone(),
            outstanding_senior_principal: s.outstanding_senior_principal(),
            interest_adjustment: s.interest_adjustment.clone(),
            repayment: s.repayment.clone(),
        }
    }
}

pub fn needs_as_of_read(latest_block_timestamp: i64, as_of: i64) -> bool {
    latest_block_timestamp > as_of
}

pub fn ensure_repayable_status(status: &str) -> Result<(), ApiError> {
    if matches!(
        LoanStatus::parse(status),
        Some(LoanStatus::Performing | LoanStatus::WatchList | LoanStatus::Default)
    ) {
        return Ok(());
    }
    Err(ApiError::BadRequest(format!(
        "loan status is {status}: a repayment can only be recorded while the loan is Performing, \
         WatchList or Default"
    )))
}

pub fn validate_as_of_not_future(as_of: i64, now: i64) -> Result<(), ApiError> {
    if as_of > now + AS_OF_FUTURE_SKEW_SECS {
        return Err(ApiError::BadRequest(format!(
            "as_of ({as_of}) is in the future (now {now})"
        )));
    }
    Ok(())
}

pub fn ensure_event_history_complete(
    s: &LoanSnapshot,
    rate_events: &[LoanRateEventRow],
    as_of: i64,
    snapshot_block_time: i64,
) -> Result<(), ApiError> {
    if as_of < snapshot_block_time {
        return Ok(());
    }
    let event_refs: Vec<&LoanRateEventRow> = rate_events.iter().collect();
    let accrual = LoanAccrual::from_ppm(s.genesis_rate_ppm(), &event_refs);
    let from_events = accrual.outstanding_at(as_of);
    let snapshot = s.outstanding_senior_principal();
    if from_events != snapshot {
        return Err(ApiError::UnprocessableEntity(format!(
            "loan event history incomplete; re-index required (outstanding senior {snapshot} \
             in the snapshot vs {from_events} from indexed events)"
        )));
    }
    Ok(())
}

fn interest_headroom(latest: &LatestLoanState, gross_accrued: &BigDecimal) -> BigDecimal {
    let recorded =
        &latest.repayment.senior_interest + &latest.repayment.mgmt_fee + &latest.repayment.perf_fee;
    (gross_accrued + &latest.interest_adjustment - recorded).max(BigDecimal::zero())
}

/// Truncate a value toward zero to a whole base unit.
fn trunc(v: &BigDecimal) -> BigDecimal {
    v.with_scale_round(0, RoundingMode::Down)
}

/// Compute the waterfall from the as_of loan snapshot, the loan's latest running state, an incoming `amount` (raw base units),
/// the repayment instant `as_of` (Unix seconds), the per-loan fee schedule, and the loan's
/// raw (un-normalised) outstanding- and rate-changing events in chain order, already cut
/// off at `as_of` by the caller (`ContractLogsRepo::list_loan_rate_events_for_loan`).
/// Pure and unit-testable — no DB, no clock.
pub fn compute_waterfall(
    s: &LoanSnapshot,
    latest: &LatestLoanState,
    amount: &BigDecimal,
    as_of: i64,
    fees: &FeeScheduleRow,
    rate_events: &[LoanRateEventRow],
    max_fee_bps: Option<u32>,
) -> Result<WaterfallBreakdown, ApiError> {
    let amount = &trunc(amount);
    if as_of < s.origination_date {
        return Err(ApiError::BadRequest(format!(
            "as_of ({as_of}) is before loan origination ({})",
            s.origination_date
        )));
    }

    ensure_repayable_status(&latest.status)?;
    let latest_status = LoanStatus::parse(&latest.status);

    let outstanding_offtaker = &s.original_offtaker_price - &latest.repayment.offtaker_received;
    if amount > &outstanding_offtaker {
        return Err(ApiError::BadRequest(format!(
            "amount ({amount}) exceeds the loan's outstanding offtaker balance \
             ({outstanding_offtaker} = original_offtaker_price {} − offtaker_received {})",
            s.original_offtaker_price, latest.repayment.offtaker_received
        )));
    }

    let outstanding = s
        .outstanding_senior_principal()
        .min(latest.outstanding_senior_principal.clone());
    let event_refs: Vec<&LoanRateEventRow> = rate_events.iter().collect();
    let accrual = LoanAccrual::from_ppm(s.genesis_rate_ppm(), &event_refs);
    let outstanding_seconds = accrual.outstanding_seconds(as_of);

    let gross_accrued = accrual.accrued_floored_per_epoch(as_of);
    let headroom = interest_headroom(latest, &gross_accrued);
    let senior_gross_interest_cum =
        (&gross_accrued + &latest.interest_adjustment).max(BigDecimal::zero());
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

    // Stage 2: subtract the latest cumulative `repayment.*` counters; clamped at 0 so a
    // prior over-record can't surface as negative.
    let mut target_management_fee =
        (&management_fee_cum - &latest.repayment.mgmt_fee).max(BigDecimal::zero());
    let mut target_performance_fee =
        (&performance_fee_cum - &latest.repayment.perf_fee).max(BigDecimal::zero());
    let mut target_senior_coupon_net =
        (&senior_coupon_net_cum - &latest.repayment.senior_interest).max(BigDecimal::zero());
    let target_oet_allocation =
        (&oet_allocation_cum - &latest.repayment.oet_alloc).max(BigDecimal::zero());

    let fees_target = &target_management_fee + &target_performance_fee;
    if fees_target > headroom {
        target_management_fee = trunc(&(&headroom * &target_management_fee / &fees_target));
        target_performance_fee = trunc(&(&headroom * &target_performance_fee / &fees_target));
        target_senior_coupon_net = &headroom - &target_management_fee - &target_performance_fee;
    } else {
        target_senior_coupon_net = target_senior_coupon_net.min(&headroom - &fees_target);
    }

    if latest_status == Some(LoanStatus::Default) {
        return default_breakdown(
            s,
            latest,
            amount,
            &outstanding,
            &headroom,
            &outstanding_offtaker,
        );
    }

    let max_fee_bps = max_fee_bps.ok_or_else(|| {
        ApiError::ServiceUnavailable(
            "LoanRegistry max_fee_bps is not synced yet; try again shortly".to_owned(),
        )
    })?;

    let mut remaining = amount.clone();
    let target_total_interest =
        &target_senior_coupon_net + &target_management_fee + &target_performance_fee;
    let interest_payment = target_total_interest.clone().min(remaining.clone());
    let (senior_coupon_net, management_fee, performance_fee) = if target_total_interest.is_zero() {
        (BigDecimal::zero(), BigDecimal::zero(), BigDecimal::zero())
    } else {
        let management_fee =
            trunc(&(&interest_payment * &target_management_fee / &target_total_interest));
        let performance_fee =
            trunc(&(&interest_payment * &target_performance_fee / &target_total_interest));
        let senior_coupon_net = trunc(&interest_payment) - &management_fee - &performance_fee;
        (senior_coupon_net, management_fee, performance_fee)
    };
    let (senior_coupon_net, management_fee, performance_fee) = fit_interest_to_fee_cap(
        senior_coupon_net,
        management_fee,
        performance_fee,
        max_fee_bps,
    );
    remaining -= &senior_coupon_net;
    remaining -= &management_fee;
    remaining -= &performance_fee;
    let oet_room = oet_room_under_cap(
        &senior_coupon_net,
        &management_fee,
        &performance_fee,
        max_fee_bps,
    );
    let oet_allocation = trunc(&target_oet_allocation.min(remaining.clone()).min(oet_room));
    remaining -= &oet_allocation;
    // Truncated to a whole base unit like every other component, so a fractional
    // `amount` can't leak sub-base-unit precision into the output.
    let senior_principal_returned = trunc(&outstanding.clone().min(remaining.clone()));
    remaining -= &senior_principal_returned;
    // Last in the cascade and uncapped (stage 4) — whatever's left goes to equity. Stage
    // 3's rejection already bounds this from absorbing an implausible, unvalidated figure.
    let equity_distributed = trunc(&remaining);

    let senior_principal_fully_repaid = latest.disbursed >= s.original_senior_tranche
        && &latest.outstanding_senior_principal - &senior_principal_returned <= BigDecimal::zero();
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

fn default_breakdown(
    s: &LoanSnapshot,
    latest: &LatestLoanState,
    amount: &BigDecimal,
    outstanding: &BigDecimal,
    headroom: &BigDecimal,
    outstanding_offtaker: &BigDecimal,
) -> Result<WaterfallBreakdown, ApiError> {
    let senior_principal_returned = outstanding.clone().min(amount.clone());
    let senior_coupon_net = amount - &senior_principal_returned;
    if &senior_coupon_net > headroom {
        return Err(ApiError::BadRequest(format!(
            "loan is in Default: a payment may only repay senior principal ({outstanding}) plus \
             accrued interest headroom ({headroom}), and fees, OET and equity must be 0; \
             amount ({amount}) is too large"
        )));
    }
    let senior_principal_fully_repaid = latest.disbursed >= s.original_senior_tranche
        && &latest.outstanding_senior_principal - &senior_principal_returned <= BigDecimal::zero();
    Ok(WaterfallBreakdown {
        senior_principal_returned,
        senior_coupon_net,
        management_fee: BigDecimal::zero(),
        performance_fee: BigDecimal::zero(),
        oet_allocation: BigDecimal::zero(),
        equity_distributed: BigDecimal::zero(),
        senior_principal_fully_repaid,
        offtaker_fully_received: outstanding_offtaker - amount <= BigDecimal::zero(),
    })
}

pub fn fit_interest_to_fee_cap(
    coupon: BigDecimal,
    management_fee: BigDecimal,
    performance_fee: BigDecimal,
    max_fee_bps: u32,
) -> (BigDecimal, BigDecimal, BigDecimal) {
    let fees = &management_fee + &performance_fee;
    let total = &coupon + &fees;
    let cap = trunc(&(&total * BigDecimal::from(max_fee_bps) / BigDecimal::from(BPS_DENOM)));
    if fees <= cap {
        return (coupon, management_fee, performance_fee);
    }
    let performance_fee = trunc(&(&cap * &performance_fee / &fees));
    let management_fee = &cap - &performance_fee;
    (total - &cap, management_fee, performance_fee)
}

fn oet_room_under_cap(
    coupon: &BigDecimal,
    management_fee: &BigDecimal,
    performance_fee: &BigDecimal,
    max_fee_bps: u32,
) -> BigDecimal {
    let fees = management_fee + performance_fee;
    let cap =
        trunc(&((coupon + &fees) * BigDecimal::from(max_fee_bps) / BigDecimal::from(BPS_DENOM)));
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
    }
}
