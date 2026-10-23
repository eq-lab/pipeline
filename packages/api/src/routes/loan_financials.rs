//! Per-loan financials endpoint (`GET /v1/loan-book/{loan_id}/financials`).
//!
//! Read-only. Loads the loan's latest `LoanSnapshot` (status, immutable
//! economics, cumulative repayment) and the minted-yield total attributable to the
//! loan, then derives a small set of realized figures. All monetary values are
//! USDC base-6 in storage and serialized as 6-decimal strings.
//!
//! Field definitions (see `docs/product-specs/` for the economic model):
//! - `interest` / `fees` are **realized to date** — the cumulative repayment
//!   `senior_interest` and `mgmt_fee + perf_fee`, matching the "realized gross"
//!   set used by `routes::dashboard`. They exclude `oet_alloc` and
//!   `equity_distributed`; `not_minted_yield` still counts `oet_alloc` (below).
//! - `minted_yield` = legacy `YieldMinted` (via `yield_mint_outbox`) + Minter
//!   `CashRepaid` interest and fee PLUSD net of `CashRepaymentReversed` (see
//!   `shared::minted_yield`).
//! - `not_minted_yield` = `(interest + fees + oet_alloc) − minted_yield`, clamped at 0 —
//!   `minted_yield` already includes the `oet_alloc` fee leg, so both sides count it.
//! - `offtaker_outstanding` = `original_offtaker_price − repayment.offtaker_received`.

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, State};
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
use crate::routes::common::{loan_registry_address, RequiredChain};
use crate::routes::loan_book::display_status;
use crate::AppState;

/// Seconds per day, for the whole-day `days_overdue` count. Matches
/// `routes::loan_book::SECS_PER_DAY`.
const SECS_PER_DAY: i64 = 86_400;

// ── Response DTOs ──────────────────────────────────────────────────────────────

/// Response for `GET /v1/loan-book/{loan_id}/financials`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanFinancialsResponse {
    pub chain_id: i64,
    /// On-chain loan id (string; may exceed JS safe-int range).
    pub loan_id: String,
    /// Displayed loan status: the raw on-chain status (`Performing`, `WatchList`,
    /// `Default`, `Closed`) with the derived `Disbursing` (USDC off-ramp not yet
    /// complete) and `Past Due` (past current maturity) overrides layered on. See
    /// `routes::loan_book::display_status`.
    pub status: String,
    /// Raw on-chain loan status from the latest snapshot, with no display overrides:
    /// `Approved` | `Performing` | `WatchList` | `Default` | `Closed` (`Unknown` for an
    /// unrecognised on-chain value). Use it when the real chain state matters (e.g. a
    /// `Disbursing` / `Past Due` loan that is `WatchList` on chain). Old-registry loans
    /// may read shifted, see "Known limitation" in docs/product-specs/loan-status-timeline.md.
    pub onchain_status: String,

    /// Original offtaker price (USDC, 6-decimal string). What the offtaker owes in
    /// total for the commodity.
    pub offtaker: String,
    /// Principal deployed: `original_senior_tranche + original_equity_tranche`.
    pub principal: String,
    /// Realized senior interest to date (cumulative `repayment.senior_interest`).
    pub interest: String,
    /// Realized fees to date (cumulative `mgmt_fee + perf_fee`).
    pub fees: String,

    /// Yield minted for this loan: legacy `YieldMinted` plus Minter `CashRepaid`
    /// interest and fee PLUSD, net of reversed repayments.
    pub minted_yield: String,
    /// Realized interest + fees + OET not yet minted: `(interest + fees + oet_alloc) − minted_yield`,
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

/// OpenAPI doc bundle for the financials route.
#[derive(OpenApi)]
#[openapi(
    paths(get_loan_financials),
    components(schemas(LoanFinancialsResponse, EpochView)),
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
        RequiredChain,
    ),
    responses(
        (status = 200, description = "Per-loan realized financials", body = LoanFinancialsResponse),
        (status = 400, description = "Missing, malformed, or unknown chain_id; or malformed loan id"),
        (status = 404, description = "Loan not indexed on this chain"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "LoanBook"
)]
async fn get_loan_financials(
    State(state): State<Arc<AppState>>,
    Path(loan_id): Path<String>,
    RequiredChain(chain): RequiredChain,
) -> Result<Json<LoanFinancialsResponse>, ApiError> {
    let chain_id = chain.chain_id;
    let loan_id = BigDecimal::from_str(loan_id.trim())
        .map_err(|_| ApiError::BadRequest(format!("invalid loan_id: {loan_id}")))?;

    // `to_unix = now`: the latest snapshot regardless of block timestamp.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let registry = loan_registry_address(&state, chain_id)?;

    let snapshots = state
        .contract_logs_repo
        .list_latest_loan_snapshots(&state.pool, chain_id, registry, now)
        .await?;

    let row = snapshots
        .into_iter()
        .find(|r| r.loan_id == loan_id)
        .ok_or_else(|| {
            ApiError::NotFound(format!("loan {loan_id} not indexed on chain {chain_id}"))
        })?;

    let (legacy_minted, repayment_mints) = tokio::try_join!(
        state.contract_logs_repo.legacy_yield_minted_raw_for_loan(
            &state.pool,
            chain_id,
            &loan_id,
            registry
        ),
        state.contract_logs_repo.list_repayment_mints(
            &state.pool,
            chain_id,
            Some(&loan_id),
            now,
            registry
        ),
    )?;
    let minted_yield = shared::minted_yield::loan_minted_yield(
        shared::chains::parse_chain_type(chain_id)?,
        &legacy_minted,
        &repayment_mints,
        now,
    );

    let economics_events = state
        .contract_logs_repo
        .list_loan_economics_events(&state.pool, chain_id, registry, &loan_id, now)
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
///
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

    // Realized interest + fees + OET not yet minted (`minted_yield` includes the OET
    // leg). Clamp at 0: the two sides come from different on-chain sources, so a
    // transient over-count must not surface a negative figure.
    let realized_gross = interest + &fees + &s.repayment.oet_alloc;
    let not_minted = (&realized_gross - minted_yield).max(BigDecimal::from(0));

    let offtaker_outstanding = &s.original_offtaker_price - &s.repayment.offtaker_received;

    // Next scheduled payment: the current rollover-adjusted maturity for a bullet loan.
    // `days_overdue` is pure date math — whole days past it, `null` until then.
    let next_payment_timestamp = s.current_maturity_timestamp;
    let days_overdue =
        (now > next_payment_timestamp).then(|| (now - next_payment_timestamp) / SECS_PER_DAY);

    LoanFinancialsResponse {
        chain_id: row.chain_id,
        loan_id: row.loan_id.to_string(),
        status: display_status(
            &s.status,
            off_ramp_complete,
            now,
            s.current_maturity_timestamp,
        ),
        onchain_status: s.status.clone(),
        offtaker: base6_to_decimal_string(&s.original_offtaker_price),
        principal: base6_to_decimal_string(&principal),
        interest: base6_to_decimal_string(interest),
        fees: base6_to_decimal_string(&fees),
        minted_yield: base6_to_decimal_string(minted_yield),
        not_minted_yield: base6_to_decimal_string(&not_minted),
        offtaker_outstanding: base6_to_decimal_string(&offtaker_outstanding),
        next_payment_timestamp,
        days_overdue,
        epoch: current_epoch(s, economics_events),
    }
}

/// Project the resulting current epoch from the full epoch timeline (see
/// `shared::loan_economics::build_epochs` for the fold rule). The ordinal is the
/// epoch's 1-based position in the timeline.
fn current_epoch(s: &LoanSnapshot, events: &[EconomicsEventRow]) -> EpochView {
    let epochs = build_epochs(
        s.origination_date,
        s.original_maturity_date,
        s.senior_interest_rate_bps,
        events,
    );
    // `build_epochs` always seeds at least epoch 1 — never empty.
    let number = epochs.len() as u32;
    let current = epochs.last().expect("build_epochs always seeds epoch 1");

    EpochView {
        number,
        current_apy_bps: current.rate_bps,
        start_date: iso_utc_from_unix(current.start),
        maturity_date: iso_utc_from_unix(s.current_maturity_timestamp),
    }
}
