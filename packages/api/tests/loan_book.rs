//! Compute-layer tests for the loan-book API: exercise `compute_loan_book`
//! directly against fixture loans + lifecycle events, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`).

use bigdecimal::BigDecimal;

use pipeline_api::routes::loan_book::{compute_loan_book, LoanBookResponse};
use shared::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};
use shared::loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot};

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn zero_repayment() -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: BigDecimal::from(0_i64),
        senior_principal_repaid: BigDecimal::from(0_i64),
        senior_interest: BigDecimal::from(0_i64),
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

#[allow(clippy::too_many_arguments)]
fn make_loan(
    loan_id: i64,
    senior_k: i64,
    equity_k: i64,
    rate_bps: u32,
    start_day: i64,
    end_day: i64,
    originator: &str,
    commodity: &str,
    protection: &str,
) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id: 1,
        loan_id: BigDecimal::from(loan_id),
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: originator.to_owned(),
            borrower_id: format!("borrower-{loan_id}"),
            commodity: commodity.to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: protection.to_owned(),
            metadata_uri: None,
            // `*_k` args are in thousands of USDC.
            original_facility_size: usdc((senior_k + equity_k) * 1_000),
            original_senior_tranche: usdc(senior_k * 1_000),
            original_equity_tranche: usdc(equity_k * 1_000),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: rate_bps,
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
            repayment: zero_repayment(),
        },
    }
}

/// Loan A: senior 80k + equity 20k = 100k @ 12% (1200 bps), day 0–180.
/// Loan B: senior 40k + equity 10k =  50k @ 15% (1500 bps), day 30–120.
fn fixture_loans() -> Vec<LoanSnapshotRow> {
    vec![
        make_loan(
            1,
            80,
            20,
            1200,
            0,
            180,
            "Open Mineral",
            "Copper Concentrate",
            "LC at sight",
        ),
        make_loan(2, 40, 10, 1500, 30, 120, "Trafalgar", "Alumina", ""),
    ]
}

fn at(t_day: i64, loans: &[LoanSnapshotRow], events: &[LifecycleRow]) -> LoanBookResponse {
    compute_loan_book(loans, events, t_day * DAY)
}

#[test]
fn principal_is_senior_plus_equity() {
    // At day 0 only loan A is active. principal = senior 80k + equity 20k = 100k.
    let r = at(0, &fixture_loans(), &[]);
    assert_eq!(r.loans.len(), 1);
    assert_eq!(r.loans[0].principal, "100000.000000");
    assert_eq!(r.summary.total_deployed, "100000.000000");
}

#[test]
fn total_deployed_sums_both_tranches_over_active_loans() {
    // Day 60: both active. 100k + 50k = 150k.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.loans.len(), 2);
    assert_eq!(r.summary.total_deployed, "150000.000000");
}

#[test]
fn avg_yield_is_principal_weighted() {
    // Day 60: (100k·1200 + 50k·1500) / 150k = 1300 bps → 0.13.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.avg_yield.as_deref(), Some("0.130000"));
}

#[test]
fn avg_duration_is_principal_weighted() {
    // Day 60: terms A=180d, B=90d. (100k·180 + 50k·90) / 150k = 150.
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.avg_duration_days, Some(150));
}

#[test]
fn loans_sorted_by_principal_descending() {
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.loans[0].originator, "Open Mineral"); // 100k
    assert_eq!(r.loans[1].originator, "Trafalgar"); // 50k
}

#[test]
fn entry_carries_expected_fields() {
    let r = at(0, &fixture_loans(), &[]);
    let e = &r.loans[0];
    assert_eq!(e.originator, "Open Mineral");
    assert_eq!(e.borrower, "borrower-1");
    assert_eq!(e.commodity, "Copper Concentrate");
    assert_eq!(e.duration_days, 180);
    assert_eq!(e.rate, "0.120000");
    assert_eq!(e.status, "Performing");
}

#[test]
fn protection_maps_nonempty_to_some_and_empty_to_none() {
    // Loan A (Open Mineral) has protection "LC at sight"; loan B (Trafalgar) has "".
    let r = at(60, &fixture_loans(), &[]);
    let a = r
        .loans
        .iter()
        .find(|e| e.originator == "Open Mineral")
        .unwrap();
    let b = r
        .loans
        .iter()
        .find(|e| e.originator == "Trafalgar")
        .unwrap();
    assert_eq!(a.protection.as_deref(), Some("LC at sight"));
    assert_eq!(b.protection, None);
}

#[test]
fn matured_loan_excluded() {
    // Day 150: A active (0–180), B matured (ends day 120).
    let r = at(150, &fixture_loans(), &[]);
    assert_eq!(r.loans.len(), 1);
    assert_eq!(r.loans[0].originator, "Open Mineral");
    assert_eq!(r.summary.total_deployed, "100000.000000");
    assert_eq!(r.summary.avg_yield.as_deref(), Some("0.120000"));
    assert_eq!(r.summary.avg_duration_days, Some(180));
}

#[test]
fn closed_loan_excluded_via_lifecycle_event() {
    // LoanClosed for A at day 100 → effective_end = min(180, 100) = 100.
    // At day 110: A closed, B still active (30–120).
    let events = vec![LifecycleRow {
        event_name: "LoanClosed".to_owned(),
        block_timestamp: 100 * DAY,
        loan_id: BigDecimal::from(1_i64),
    }];
    let r = at(110, &fixture_loans(), &events);
    assert_eq!(r.loans.len(), 1);
    assert_eq!(r.loans[0].originator, "Trafalgar");
}

#[test]
fn no_active_loans_returns_empty_book() {
    // Day 500: both matured.
    let r = at(500, &fixture_loans(), &[]);
    assert!(r.loans.is_empty());
    assert_eq!(r.summary.total_deployed, "0.000000");
    assert_eq!(r.summary.avg_yield, None);
    assert_eq!(r.summary.avg_duration_days, None);
}

#[test]
fn empty_registry_returns_empty_book() {
    let r = compute_loan_book(&[], &[], 0);
    assert!(r.loans.is_empty());
    assert_eq!(r.summary.total_deployed, "0.000000");
    assert_eq!(r.summary.avg_yield, None);
}

#[test]
fn collateral_coverage_are_null_for_now() {
    // TODO #706: collateral valuation and coverage have no data source yet — they
    // must serialize as null until a price feed is wired. (Protection is now
    // sourced from the loan metadata; see `protection_maps_*`.)
    let r = at(60, &fixture_loans(), &[]);
    assert_eq!(r.summary.total_collateral, None);
    assert_eq!(r.summary.senior_debt_coverage, None);
    for e in &r.loans {
        assert_eq!(e.collateral, None);
        assert_eq!(e.ltv, None);
    }
}
