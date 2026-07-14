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

use shared::contract_logs_repo::LoanSnapshotRow;
use shared::loan_snapshot::LoanSnapshot;

use crate::auth::SecurityAddon;
use crate::error::ApiError;
use crate::formatting::{base6_to_decimal_string, iso_utc_from_unix};
use crate::routes::common::{resolve_chain, ChainQuery};
use crate::AppState;

// ── Response DTOs ──────────────────────────────────────────────────────────────

/// Response for `GET /v1/loan-book/{loan_id}/financials`.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoanFinancialsResponse {
    /// On-chain loan id (string; may exceed JS safe-int range).
    pub loan_id: String,
    /// Loan status (`Performing`, `WatchList`, `Default`, `Closed`).
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
    components(schemas(LoanFinancialsResponse, LocationView)),
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

    Ok(Json(build_response(&row, &minted_yield)))
}

// ── Assembly (pure) ────────────────────────────────────────────────────────────

/// Assemble the response from the loan snapshot and the loan's minted-yield total.
/// Pure and unit-testable: no DB, no clock.
fn build_response(row: &LoanSnapshotRow, minted_yield: &BigDecimal) -> LoanFinancialsResponse {
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
        status: s.status.clone(),
        location: location_view(s),
        offtaker: base6_to_decimal_string(&s.original_offtaker_price),
        principal: base6_to_decimal_string(&principal),
        interest: base6_to_decimal_string(interest),
        fees: base6_to_decimal_string(&fees),
        minted_yield: base6_to_decimal_string(minted_yield),
        not_minted_yield: base6_to_decimal_string(&not_minted),
        offtaker_outstanding: base6_to_decimal_string(&offtaker_outstanding),
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

#[cfg(test)]
mod tests {
    use super::*;
    use shared::loan_snapshot::{LocationUpdateSnapshot, RepaymentSnapshot};

    fn repayment(senior_interest: i64, mgmt: i64, perf: i64, offtaker_recv: i64) -> RepaymentSnapshot {
        RepaymentSnapshot {
            offtaker_received: BigDecimal::from(offtaker_recv),
            senior_principal_repaid: BigDecimal::from(0),
            senior_interest: BigDecimal::from(senior_interest),
            equity_distributed: BigDecimal::from(0),
            mgmt_fee: BigDecimal::from(mgmt),
            perf_fee: BigDecimal::from(perf),
            oet_alloc: BigDecimal::from(0),
        }
    }

    fn snapshot(
        status: &str,
        senior_tranche: i64,
        equity_tranche: i64,
        offtaker_price: i64,
        repayment: RepaymentSnapshot,
        location: LocationUpdateSnapshot,
    ) -> LoanSnapshot {
        LoanSnapshot {
            originator: String::new(),
            borrower_id: String::new(),
            commodity: String::new(),
            corridor: String::new(),
            governing_law: String::new(),
            protection: String::new(),
            metadata_uri: None,
            documents: vec![],
            original_facility_size: BigDecimal::from(senior_tranche + equity_tranche),
            original_senior_tranche: BigDecimal::from(senior_tranche),
            original_equity_tranche: BigDecimal::from(equity_tranche),
            original_offtaker_price: BigDecimal::from(offtaker_price),
            senior_interest_rate_bps: 1_200,
            origination_date: 0,
            original_maturity_date: 0,
            next_economics_epochs_id: BigDecimal::from(0),
            next_repayment_id: BigDecimal::from(0),
            status: status.to_owned(),
            ccr_bps: 12_000,
            last_reported_ccr_timestamp: 0,
            current_maturity_timestamp: 0,
            closure_reason: String::new(),
            current_location: location,
            metadata_uri_onchain: String::new(),
            repayment,
        }
    }

    fn empty_location() -> LocationUpdateSnapshot {
        LocationUpdateSnapshot {
            location_type: String::new(),
            location_identifier: String::new(),
            tracking_url: String::new(),
            updated_at: 0,
        }
    }

    fn row(snapshot: LoanSnapshot) -> LoanSnapshotRow {
        LoanSnapshotRow {
            chain_id: 1,
            loan_id: BigDecimal::from(42),
            block_number: 0,
            log_index: 0,
            event_name: "PaymentRecorded".to_owned(),
            block_timestamp: 0,
            snapshot,
        }
    }

    #[test]
    fn derives_realized_figures_and_outstanding() {
        // 1000 USDC offtaker, 900 principal (800 senior + 100 equity),
        // 50 interest + (30 mgmt + 20 perf) fees realized, 40 minted,
        // 600 offtaker received.
        let snap = snapshot(
            "Performing",
            800_000_000,
            100_000_000,
            1_000_000_000,
            repayment(50_000_000, 30_000_000, 20_000_000, 600_000_000),
            empty_location(),
        );
        let resp = build_response(&row(snap), &BigDecimal::from(40_000_000));

        assert_eq!(resp.loan_id, "42");
        assert_eq!(resp.status, "Performing");
        assert!(resp.location.is_none());
        assert_eq!(resp.offtaker, "1000.000000");
        assert_eq!(resp.principal, "900.000000");
        assert_eq!(resp.interest, "50.000000");
        assert_eq!(resp.fees, "50.000000");
        assert_eq!(resp.minted_yield, "40.000000");
        // (50 + 50) − 40 = 60
        assert_eq!(resp.not_minted_yield, "60.000000");
        // 1000 − 600 = 400
        assert_eq!(resp.offtaker_outstanding, "400.000000");
    }

    #[test]
    fn not_minted_yield_clamps_at_zero() {
        let snap = snapshot(
            "Performing",
            100_000_000,
            0,
            100_000_000,
            repayment(10_000_000, 0, 0, 0),
            empty_location(),
        );
        // minted (25) exceeds realized interest+fees (10) → clamp to 0.
        let resp = build_response(&row(snap), &BigDecimal::from(25_000_000));
        assert_eq!(resp.not_minted_yield, "0.000000");
    }

    #[test]
    fn location_projected_when_reported() {
        let snap = snapshot(
            "WatchList",
            100_000_000,
            0,
            100_000_000,
            repayment(0, 0, 0, 0),
            LocationUpdateSnapshot {
                location_type: "Vessel".to_owned(),
                location_identifier: "MV Example".to_owned(),
                tracking_url: "https://track.example/1".to_owned(),
                updated_at: 0,
            },
        );
        let resp = build_response(&row(snap), &BigDecimal::from(0));
        let loc = resp.location.expect("location present");
        assert_eq!(loc.location_type, "Vessel");
        assert_eq!(loc.location_identifier, "MV Example");
        assert_eq!(loc.updated_at, "1970-01-01T00:00:00Z");
    }
}
