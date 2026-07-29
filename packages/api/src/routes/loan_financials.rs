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
use shared::loan_economics::build_epochs;
use shared::loan_snapshot::LoanSnapshot;

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::routes::loan_book::display_status;
use crate::AppState;

/// Seconds per day, for the whole-day `days_overdue` count. Matches
/// `routes::loan_book::SECS_PER_DAY`.
const SECS_PER_DAY: i64 = 86_400;

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

    /// Next scheduled payment (Unix seconds). For today's **bullet loans** this equals
    /// the current rollover-adjusted maturity (`current_maturity_timestamp`); a distinct
    /// field future-proofs any intra-loan schedule. Mirrors the loan-book
    /// `next_payment_timestamp`.
    pub next_payment_timestamp: i64,
    /// Whole days past `next_payment_timestamp`, or `null` when `now <=
    /// next_payment_timestamp`. Pure date math, independent of loan status. Mirrors the
    /// loan-book `days_overdue`.
    pub days_overdue: Option<i64>,

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
        .list_loan_economics_events(&state.pool, chain_id, &loan_id, now)
        .await?;

    // The current epoch's `start` should be the prior epoch's real on-chain maturity.
    // The folded `LoanRolledOver` event's own `new_maturity_timestamp` param can be
    // wrong (see `ContractLogsRepo::list_loan_economics_events`'s `COALESCE(…, 0)`
    // guard), so instead look up the loan's on-chain-read snapshot from just before
    // that rollover fired — its `current_maturity_timestamp` is the real prior-epoch
    // maturity, independent of the possibly-malformed event param.
    let current_epoch_start_override = if let Some(rollover) = economics_events
        .iter()
        .rev()
        .find(|e| e.event_name == "LoanRolledOver")
    {
        state
            .contract_logs_repo
            .get_loan_snapshot_as_of(
                &state.pool,
                chain_id,
                &loan_id,
                rollover.block_timestamp - 1,
            )
            .await?
            .map(|r| r.snapshot.current_maturity_timestamp)
    } else {
        None
    };

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
        current_epoch_start_override,
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
///
/// `current_epoch_start_override`, when present, is the on-chain-read maturity of
/// the epoch prior to the current one (see `current_epoch`) — sourced by the caller
/// from `ContractLogsRepo::get_loan_snapshot_as_of` just before the current epoch's
/// opening `LoanRolledOver`, independent of that event's own possibly-malformed
/// `new_maturity_timestamp` param.
pub fn build_response(
    row: &LoanSnapshotRow,
    minted_yield: &BigDecimal,
    economics_events: &[EconomicsEventRow],
    off_ramp_complete: bool,
    now: i64,
    current_epoch_start_override: Option<i64>,
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

    // Next scheduled payment: the current rollover-adjusted maturity for a bullet loan.
    // `days_overdue` is pure date math — whole days past it, `null` until then.
    let next_payment_timestamp = s.current_maturity_timestamp;
    let days_overdue =
        (now > next_payment_timestamp).then(|| (now - next_payment_timestamp) / SECS_PER_DAY);

    LoanFinancialsResponse {
        loan_id: row.loan_id.to_string(),
        status: display_status(
            &s.status,
            off_ramp_complete,
            now,
            s.current_maturity_timestamp,
        ),
        location: location_view(s),
        offtaker: base6_to_decimal_string(&s.original_offtaker_price),
        principal: base6_to_decimal_string(&principal),
        interest: base6_to_decimal_string(interest),
        fees: base6_to_decimal_string(&fees),
        minted_yield: base6_to_decimal_string(minted_yield),
        not_minted_yield: base6_to_decimal_string(&not_minted),
        offtaker_outstanding: base6_to_decimal_string(&offtaker_outstanding),
        next_payment_timestamp,
        days_overdue,
        epoch: current_epoch(s, economics_events, current_epoch_start_override),
    }
}

/// Project the resulting current epoch from the full epoch timeline (see
/// `shared::loan_economics::build_epochs` for the fold rule). The ordinal is the
/// epoch's 1-based position in the timeline.
///
/// `start_override`, when present, replaces the folded `start` for a rolled-over
/// epoch (`number > 1`) — see `build_response`'s doc comment. Epoch 1 never needs
/// it: its start is `origination_date`, an immutable genesis field, not derived
/// from a fallible event param.
fn current_epoch(
    s: &LoanSnapshot,
    events: &[EconomicsEventRow],
    start_override: Option<i64>,
) -> EpochView {
    let epochs = build_epochs(
        s.origination_date,
        s.original_maturity_date,
        s.senior_interest_rate_bps,
        events,
    );
    // `build_epochs` always seeds at least epoch 1 — never empty.
    let number = epochs.len() as u32;
    let current = epochs.last().expect("build_epochs always seeds epoch 1");
    let start = if number > 1 {
        start_override.unwrap_or(current.start)
    } else {
        current.start
    };

    EpochView {
        number,
        current_apy_bps: current.rate_bps,
        start_date: iso_utc_from_unix(start),
        // Not `current.maturity`: this endpoint always evaluates "now" (no backdating),
        // so the snapshot's block-pinned, rollover-aware on-chain read is authoritative —
        // unlike the folded event param, it can't fall back to a defensive `0` (see
        // `ContractLogsRepo::list_loan_economics_events`).
        maturity_date: iso_utc_from_unix(s.current_maturity_timestamp),
    }
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
