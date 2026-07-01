//! Compute-layer tests for the financial-position API (Panel A — Statement of
//! Financial Position). Exercise `compute_financial_position` directly against
//! fixture loans + lifecycle events, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`).

use bigdecimal::BigDecimal;

use pipeline_api::routes::financial_position::{
    compute_financial_position, FinancialPositionResponse,
};
use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};
use shared::loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot};

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn repayment_with_interest(senior_interest_k: i64) -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: BigDecimal::from(0_i64),
        senior_principal_repaid: BigDecimal::from(0_i64),
        senior_interest: usdc(senior_interest_k * 1_000),
        equity_distributed: BigDecimal::from(0_i64),
        mgmt_fee: BigDecimal::from(0_i64),
        perf_fee: BigDecimal::from(0_i64),
        oet_alloc: BigDecimal::from(0_i64),
    }
}

fn zero_location() -> LocationUpdateSnapshot {
    LocationUpdateSnapshot {
        location_type: "Vessel".to_owned(),
        location_identifier: String::new(),
        tracking_url: String::new(),
        updated_at: 0,
    }
}

/// A loan with senior/equity tranches (in thousands of USDC), a maturity window
/// (in days), and cumulative senior interest received (in thousands of USDC).
fn make_loan(
    loan_id: i64,
    senior_k: i64,
    equity_k: i64,
    senior_interest_k: i64,
    start_day: i64,
    end_day: i64,
) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id: 1,
        loan_id: BigDecimal::from(loan_id),
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: "Open Mineral".to_owned(),
            borrower_id: format!("borrower-{loan_id}"),
            commodity: "Copper".to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: String::new(),
            metadata_uri: None,
            original_facility_size: usdc((senior_k + equity_k) * 1_000),
            original_senior_tranche: usdc(senior_k * 1_000),
            original_equity_tranche: usdc(equity_k * 1_000),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: 1200,
            origination_date: start_day * DAY,
            original_maturity_date: end_day * DAY,
            next_economics_epochs_id: BigDecimal::from(1_i64),
            next_repayment_id: BigDecimal::from(0_i64),
            status: "Performing".to_owned(),
            ccr_bps: 11_750,
            last_reported_ccr_timestamp: 0,
            current_maturity_timestamp: 0,
            closure_reason: "None".to_owned(),
            current_location: zero_location(),
            metadata_uri_onchain: String::new(),
            repayment: repayment_with_interest(senior_interest_k),
        },
    }
}

/// Loan A: senior 80k + equity 20k, 5k interest, day 0–180.
/// Loan B: senior 40k + equity 10k, 3k interest, day 30–120.
fn fixture_loans() -> Vec<LoanSnapshotRow> {
    vec![
        make_loan(1, 80, 20, 5, 0, 180),
        make_loan(2, 40, 10, 3, 30, 120),
    ]
}

fn at(t_day: i64, loans: &[LoanSnapshotRow], events: &[LifecycleRow]) -> FinancialPositionResponse {
    compute_financial_position(loans, events, t_day * DAY)
}

// ── Availability / shape ───────────────────────────────────────────────────────

#[test]
fn liquid_block_is_always_null() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.assets.liquid.total, None);
    assert_eq!(r.assets.liquid.cash_stablecoins, None);
    assert_eq!(r.assets.liquid.tokenized_tbills, None);
    assert_eq!(r.assets.liquid.off_chain_usd, None);
}

#[test]
fn plusd_outstanding_is_always_null() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.liabilities.senior_claims.plusd_outstanding, None);
}

// ── Deployed assets ──────────────────────────────────────────────────────────

#[test]
fn secured_loans_outstanding_sums_senior_plus_equity_over_active_loans() {
    // At day 60 both loans are active: (80k+20k) + (40k+10k) = 150k.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(
        r.assets.deployed.secured_loans_outstanding,
        Some("150000.000000".to_owned())
    );
}

#[test]
fn accrued_interest_receivable_sums_cumulative_senior_interest() {
    // At day 60 both loans active: 5k + 3k = 8k cumulative senior interest.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(
        r.assets.deployed.accrued_interest_receivable,
        Some("8000.000000".to_owned())
    );
}

#[test]
fn deployed_total_is_sum_of_its_leaves() {
    // 150k principal + 8k interest = 158k.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.assets.deployed.total, Some("158000.000000".to_owned()));
}

#[test]
fn assets_total_equals_deployed_total_while_liquid_is_null() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.assets.total, Some("158000.000000".to_owned()));
}

// ── Liabilities ────────────────────────────────────────────────────────────────

#[test]
fn junior_tranche_sums_equity_over_active_loans() {
    // At day 60: equity 20k + 10k = 30k.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(
        r.liabilities.subordinated_capital.junior_tranche,
        Some("30000.000000".to_owned())
    );
}

#[test]
fn liabilities_total_is_junior_tranche_only_while_plusd_is_null() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.liabilities.total, Some("30000.000000".to_owned()));
}

// ── Active-loan windowing ───────────────────────────────────────────────────────

#[test]
fn loans_not_yet_originated_are_excluded() {
    // At day 10 only loan A (starts day 0) is active; loan B starts day 30.
    let r = at(10, &fixture_loans(), &[]);
    // secured = 80k+20k = 100k; junior = 20k; interest = 5k.
    assert_eq!(
        r.assets.deployed.secured_loans_outstanding,
        Some("100000.000000".to_owned())
    );
    assert_eq!(
        r.liabilities.subordinated_capital.junior_tranche,
        Some("20000.000000".to_owned())
    );
    assert_eq!(
        r.assets.deployed.accrued_interest_receivable,
        Some("5000.000000".to_owned())
    );
}

#[test]
fn matured_loans_are_excluded() {
    // At day 150 loan B has matured (ends day 120); only loan A remains.
    let r = at(150, &fixture_loans(), &[]);
    assert_eq!(
        r.assets.deployed.secured_loans_outstanding,
        Some("100000.000000".to_owned())
    );
}

#[test]
fn loan_closed_before_maturity_is_excluded_from_effective_end() {
    // Loan A closed on day 90 → excluded at day 100 even though maturity is day 180.
    let events = vec![LifecycleRow {
        event_name: "LoanClosed".to_owned(),
        block_timestamp: 90 * DAY,
        loan_id: BigDecimal::from(1_i64),
    }];
    let r = at(100, &fixture_loans(), &events);
    // Only loan B (day 30–120) active: senior 40k + equity 10k = 50k.
    assert_eq!(
        r.assets.deployed.secured_loans_outstanding,
        Some("50000.000000".to_owned())
    );
}

// ── Empty book ───────────────────────────────────────────────────────────────

#[test]
fn no_active_loans_yields_zero_deployed_and_liabilities() {
    // Before any origination: computed leaves are zero, liquid/plusd still null.
    let r = at(-10, &fixture_loans(), &[]);
    assert_eq!(
        r.assets.deployed.secured_loans_outstanding,
        Some("0.000000".to_owned())
    );
    assert_eq!(r.assets.total, Some("0.000000".to_owned()));
    assert_eq!(
        r.liabilities.subordinated_capital.junior_tranche,
        Some("0.000000".to_owned())
    );
    assert_eq!(r.liabilities.total, Some("0.000000".to_owned()));
    assert_eq!(r.assets.liquid.total, None);
    assert_eq!(r.liabilities.senior_claims.plusd_outstanding, None);
}
