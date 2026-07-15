//! Per-loan financials endpoint (`GET /v1/loan-book/{loan_id}/financials`).
//!
//! Read-only. Loads the loan's latest `LoanSnapshot` (status, location, immutable
//! economics, cumulative repayment) and the minted-yield total attributable to the
//! loan, then derives a small set of realized figures. All monetary values are
//! USDC base-6 in storage and serialized as 6-decimal strings.
//!
//! Field definitions (see `docs/product-specs/` for the economic model):
//! - `interest` / `fees` are **realized to date** — the cumulative repayment
//!   `senior_interest` and `mgmt_fee + perf_fee`, matching the "realized gross"
//!   set used by `routes::dashboard`. They exclude `oet_alloc` and
//!   `equity_distributed`.
//! - `minted_yield` is attributed per loan via `yield_mint_outbox` confirmed rows
//!   joined to `YieldMinted` events by `tx_hash` (see
//!   `ContractLogsRepo::minted_yield_for_loan`).
//! - `not_minted_yield` = `(interest + fees) − minted_yield`, clamped at 0.
//! - `offtaker_outstanding` = `original_offtaker_price − repayment.offtaker_received`.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bigdecimal::BigDecimal;
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};

use shared::contract_logs_repo::{EconomicsEventRow, LoanSnapshotRow};
use shared::loan_snapshot::LoanSnapshot;

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::routes::loan_book::display_status;
use crate::AppState;

/// Basis points per 100% (`10_000` bps = 100%). Matches `routes::loan_book::BPS_DENOM`.
const BPS_DENOM: i64 = 10_000;

/// The LoanRegistry contract's fixed-point `ONE` (= 100%). Economics-event rates
/// (`LoanRolledOver` / `EconomicsAmended` `new_rate`) are scaled by 1e6, so
/// `new_rate / 100` is bps (`150_000` → `1_500` bps = 15%). This is a *different
/// scale* from the snapshot's bps origination rate — see `current_epoch`, which
/// normalises event rates to bps on fold.
const ECONOMICS_RATE_ONE: i64 = 1_000_000;

// ── Response DTOs ──────────────────────────────────────────────────────────────

/// Response for `GET /v1/loan-book/{loan_id}/financials`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanFinancialsResponse {
    /// On-chain loan id (string; may exceed JS safe-int range).
    pub loan_id: String,
    /// Displayed loan status: the raw on-chain status (`Performing`, `WatchList`,
    /// `Default`, `Closed`) with the derived `Disbursing` (USDC off-ramp not yet
    /// complete) and `Past Due` (past current maturity) overrides layered on. See
    /// `routes::loan_book::display_status`.
    pub status: String,
    /// Current physical location of the collateral. `null` when never reported.
    pub location: Option<LocationView>,

    /// Original offtaker price (USDC, 6-decimal string). What the offtaker owes in
    /// total for the commodity.
    pub offtaker: String,
    /// Principal deployed: `original_senior_tranche + original_equity_tranche`.
    pub principal: String,
    /// Realized senior interest to date (cumulative `repayment.senior_interest`).
    pub interest: String,
    /// Realized fees to date (cumulative `mgmt_fee + perf_fee`).
    pub fees: String,

    /// Yield minted to sPLUSD for this loan's confirmed repayments (Σ of the
    /// matching `YieldMinted.s_plusd_amount`).
    pub minted_yield: String,
    /// Realized interest + fees not yet minted: `(interest + fees) − minted_yield`,
    /// clamped at 0.
    pub not_minted_yield: String,

    /// Offtaker amount still owed: `offtaker − repayment.offtaker_received`.
    pub offtaker_outstanding: String,

    /// Current economics epoch (rate + date window + ordinal).
    pub epoch: EpochView,
}

/// The loan's current economics epoch.
///
/// Epoch 1 opens at loan draw (`origination_date` → `original_maturity_date`, at
/// the origination rate). Each `LoanRolledOver` opens a new epoch whose start is
/// the previous epoch's maturity; an `EconomicsAmended` amends the current epoch's
/// rate/maturity in place without advancing the ordinal.
#[derive(Debug, Serialize, ToSchema)]
pub struct EpochView {
    /// 1-based epoch ordinal (1 = the original draw window).
    pub number: u32,
    /// Current APY in basis points (`1_120` = 11.2%) — the epoch's rate.
    pub current_apy_bps: u32,
    /// ISO-8601 UTC epoch start date.
    pub start_date: String,
    /// ISO-8601 UTC epoch maturity date.
    pub maturity_date: String,
}

/// Collateral location, projected from the loan snapshot's `current_location`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LocationView {
    /// Location kind (`Vessel`, `Warehouse`, `TankFarm`, `Other`).
    pub location_type: String,
    /// Free-form identifier (vessel name, warehouse id, …).
    pub location_identifier: String,
    /// Optional external tracking URL. Empty string when none.
    pub tracking_url: String,
    /// ISO-8601 UTC timestamp of the last location update.
    pub updated_at: String,
}

/// OpenAPI doc bundle for the financials route.
#[derive(OpenApi)]
#[openapi(
    paths(get_loan_financials),
    components(schemas(LoanFinancialsResponse, LocationView, EpochView)),
    modifiers(&SecurityAddon)
)]
pub struct LoanFinancialsDoc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/loan-book/{loan_id}/financials", get(get_loan_financials))
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/loan-book/{loan_id}/financials",
    params(
        ("loan_id" = String, Path, description = "On-chain loan id"),
        ("chain_id" = Option<i64>, Query, description = "Chain ID (optional — defaults to DEFAULT_CHAIN_ID)"),
    ),
    responses(
        (status = 200, description = "Per-loan realized financials", body = LoanFinancialsResponse),
        (status = 400, description = "Malformed loan id"),
        (status = 404, description = "Loan not indexed on this chain"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "LoanBook"
)]
async fn get_loan_financials(
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    Query(query): Query<ChainQuery>,
) -> Result<Json<LoanFinancialsResponse>, ApiError> {
    let chain_id = resolve_chain(&state, query.chain_id);
    let loan_id = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    // `to_unix = now`: the latest snapshot regardless of block timestamp.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let snapshots = state
        .contract_logs_repo
        .list_latest_loan_snapshots_for_chain(&state.pool, chain_id, now)
        .await?;

    let row = snapshots
        .into_iter()
        .find(|r| r.loan_id == loan_id)
        .ok_or_else(|| {
            ApiError::NotFound(format!("loan {loan_id} not indexed on chain {chain_id}"))
        })?;

    let minted_yield = state
        .contract_logs_repo
        .minted_yield_for_loan(&state.pool, chain_id, &loan_id)
        .await?;

    let economics_events = state
        .contract_logs_repo
        .list_loan_economics_events(&state.pool, chain_id, &loan_id)
        .await?;

    // USDC off-ramp completion, for the `Disbursing` status override. Absent → false.
    let off_ramp_complete = state
        .loan_disbursement_repo
        .is_complete(chain_id, &loan_id)
        .await?;

    Ok(Json(build_response(
        &row,
        &minted_yield,
        &economics_events,
        off_ramp_complete,
        now,
    )))
}

// ── Assembly (pure) ────────────────────────────────────────────────────────────

/// Assemble the response from the loan snapshot, the loan's minted-yield total,
/// and its chronologically-ordered economics events. Pure and unit-testable: no
/// DB, no clock. `pub` so the feature tests in `packages/api/tests/` can exercise
/// it directly (project rule: tests live in `tests/`, not inline in `src/`).
///
/// `off_ramp_complete` is the loan's USDC-off-ramp flag and `now` the reference clock;
/// together with the snapshot's maturity they drive the displayed `status` (the
/// `Disbursing` / `Past Due` overrides — see `display_status`).
pub fn build_response(
    row: &LoanSnapshotRow,
    minted_yield: &BigDecimal,
    economics_events: &[EconomicsEventRow],
    off_ramp_complete: bool,
    now: i64,
) -> LoanFinancialsResponse {
    let s: &LoanSnapshot = &row.snapshot;

    let principal = &s.original_senior_tranche + &s.original_equity_tranche;
    let interest = &s.repayment.senior_interest;
    let fees = &s.repayment.mgmt_fee + &s.repayment.perf_fee;

    // Realized interest + fees not yet minted. Clamp at 0: `minted_yield`
    // (net senior coupon) and `interest + fees` come from different on-chain
    // sources, so a transient over-count must not surface a negative figure.
    let realized_gross = interest + &fees;
    let not_minted = (&realized_gross - minted_yield).max(BigDecimal::from(0));

    let offtaker_outstanding = &s.original_offtaker_price - &s.repayment.offtaker_received;

    LoanFinancialsResponse {
        loan_id: row.loan_id.to_string(),
        status: display_status(&s.status, off_ramp_complete, now, s.current_maturity_timestamp),
        location: location_view(s),
        offtaker: base6_to_decimal_string(&s.original_offtaker_price),
        principal: base6_to_decimal_string(&principal),
        interest: base6_to_decimal_string(interest),
        fees: base6_to_decimal_string(&fees),
        minted_yield: base6_to_decimal_string(minted_yield),
        not_minted_yield: base6_to_decimal_string(&not_minted),
        offtaker_outstanding: base6_to_decimal_string(&offtaker_outstanding),
        epoch: current_epoch(s, economics_events),
    }
}

/// Fold the ordered economics events onto epoch 1 (seeded from origination data)
/// and project the resulting current epoch.
///
/// `LoanRolledOver` advances the ordinal and opens a new window starting at the
/// prior maturity; `EconomicsAmended` overwrites the current window's rate and
/// maturity without advancing the ordinal (per the loan-epoch model in the module
/// docs). `events` must be ordered by `(block_number, log_index)`.
fn current_epoch(s: &LoanSnapshot, events: &[EconomicsEventRow]) -> EpochView {
    let mut number: u32 = 1;
    let mut start = s.origination_date;
    let mut maturity = s.original_maturity_date;
    // Current rate in bps. The origination rate is already bps; event rates are
    // the contract's 1e6-scaled fraction, normalised to bps on fold so the two
    // scales are never mixed.
    let mut rate_bps = s.senior_interest_rate_bps;

    for e in events {
        match e.event_name.as_str() {
            "LoanRolledOver" => {
                number += 1;
                start = maturity;
                maturity = e.new_maturity_timestamp;
                rate_bps = economics_rate_to_bps(e.new_rate);
            }
            "EconomicsAmended" => {
                maturity = e.new_maturity_timestamp;
                rate_bps = economics_rate_to_bps(e.new_rate);
            }
            _ => {}
        }
    }

    EpochView {
        number,
        current_apy_bps: rate_bps,
        start_date: iso_utc_from_unix(start),
        maturity_date: iso_utc_from_unix(maturity),
    }
}

/// Contract-1e6-scaled event rate → bps: `new_rate × 10_000 / 1_000_000 = new_rate / 100`,
/// rounded half-up (`150_000` → `1_500` bps = 15%).
fn economics_rate_to_bps(new_rate: i64) -> u32 {
    let bps = (new_rate * BPS_DENOM + ECONOMICS_RATE_ONE / 2) / ECONOMICS_RATE_ONE;
    bps as u32
}

/// Project `current_location` to a `LocationView`, or `None` when no location has
/// been reported (the snapshot carries an empty `location_type` at draw time).
fn location_view(s: &LoanSnapshot) -> Option<LocationView> {
    let loc = &s.current_location;
    if loc.location_type.is_empty() {
        return None;
    }
    Some(LocationView {
        location_type: loc.location_type.clone(),
        location_identifier: loc.location_identifier.clone(),
        tracking_url: loc.tracking_url.clone(),
        updated_at: iso_utc_from_unix(loc.updated_at),
    })
}

