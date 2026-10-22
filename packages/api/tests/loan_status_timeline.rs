// spec: docs/product-specs/loan-status-timeline.md
use std::collections::HashMap;

use bigdecimal::BigDecimal;

use pipeline_api::config::TransferAddressSets;
use pipeline_api::routes::capital_allocation::{compute_capital_allocation, ChainCapitalInputs};
use pipeline_api::routes::dashboard::compute_summary;
use pipeline_api::routes::financial_position::compute_financial_position;
use pipeline_api::routes::loan_book::compute_loan_book;
use pipeline_api::routes::portfolio::compute_series;
use shared::contract_logs_repo::{LifecycleRow, LoanRateEventRow, LoanSnapshotRow};
use shared::loan_capital_transfers_repo::LoanCapitalTransfersRow;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use shared::loan_status::{
    active_intervals, is_active_at, is_at_risk_at, status_at, LoanStatus, LoanTimeline,
};

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn loan(loan_id: i64, senior: i64, equity: i64, status: &str) -> LoanSnapshotRow {
    LoanSnapshotRow {
        chain_id: 1,
        loan_id: BigDecimal::from(loan_id),
        block_number: 0,
        log_index: 0,
        event_name: "LoanDrawn".to_owned(),
        block_timestamp: 0,
        snapshot: LoanSnapshot {
            originator: "orig".to_owned(),
            borrower_id: "b".to_owned(),
            commodity: "c".to_owned(),
            corridor: "cr".to_owned(),
            governing_law: "EN".to_owned(),
            protection: String::new(),
            metadata_uri: None,
            documents: Vec::new(),
            original_facility_size: usdc(senior + equity),
            original_senior_tranche: usdc(senior),
            original_equity_tranche: usdc(equity),
            original_offtaker_price: BigDecimal::from(0_i64),
            senior_interest_rate_bps: 1200,
            origination_date: 0,
            original_maturity_date: 100 * DAY,
            next_economics_epochs_id: BigDecimal::from(1_i64),
            next_repayment_id: BigDecimal::from(0_i64),
            status: status.to_owned(),
            current_maturity_timestamp: 100 * DAY,
            current_rate: 1200,
            closure_reason: "None".to_owned(),
            carved_out: false,
            disbursed: usdc(senior),
            repaid: BigDecimal::from(0_i64),
            written_down: BigDecimal::from(0_i64),
            interest_adjustment: BigDecimal::from(0_i64),
            metadata_uri_onchain: String::new(),
            repayment: RepaymentSnapshot {
                offtaker_received: BigDecimal::from(0_i64),
                senior_principal_repaid: BigDecimal::from(0_i64),
                senior_interest: BigDecimal::from(0_i64),
                equity_distributed: BigDecimal::from(0_i64),
                mgmt_fee: BigDecimal::from(0_i64),
                perf_fee: BigDecimal::from(0_i64),
                oet_alloc: BigDecimal::from(0_i64),
            },
        },
    }
}

fn base() -> LoanSnapshotRow {
    loan(1, 8_000_000, 2_000_000, "Performing")
}

fn status_ev(loan_id: i64, day: i64, status: &str) -> LifecycleRow {
    LifecycleRow {
        chain_id: 1,
        event_name: "LoanStatusUpdated".to_owned(),
        block_timestamp: day * DAY,
        loan_id: BigDecimal::from(loan_id),
        status: Some(status.to_owned()),
    }
}

fn legacy_ev(loan_id: i64, day: i64, name: &str) -> LifecycleRow {
    LifecycleRow {
        chain_id: 1,
        event_name: name.to_owned(),
        block_timestamp: day * DAY,
        loan_id: BigDecimal::from(loan_id),
        status: None,
    }
}

fn book(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    day: i64,
) -> pipeline_api::routes::loan_book::LoanBookResponse {
    let disbursed: HashMap<_, _> = loans
        .iter()
        .map(|l| {
            (
                pipeline_api::routes::loan_book::loan_ref(l.chain_id, &l.loan_id),
                true,
            )
        })
        .collect();
    compute_loan_book(
        loans,
        events,
        day * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &disbursed,
        &HashMap::new(),
    )
}

fn deployed_senior(loans: &[LoanSnapshotRow], events: &[LifecycleRow], day: i64) -> Option<String> {
    let flags: Vec<LoanCapitalTransfersRow> = loans
        .iter()
        .map(|l| LoanCapitalTransfersRow {
            chain_id: 1,
            loan_id: l.loan_id.clone(),
            is_loan_deployed: true,
            on_ramp_transferred: BigDecimal::from(0),
            off_ramp_transferred: BigDecimal::from(0),
            trust_account_deposit: BigDecimal::from(0),
            trust_account_withdrawal: BigDecimal::from(0),
            recorded_by: "t".to_owned(),
            updated_at: chrono::Utc::now(),
        })
        .collect();
    let addr: Option<&TransferAddressSets> = None;
    compute_capital_allocation(
        loans,
        events,
        day * DAY,
        &[ChainCapitalInputs {
            chain_id: 1,
            transfers: &[],
            addr,
            asset_decimals: 6,
            withdrawal_queue_balance: None,
            capital_transfers: &flags,
        }],
    )
    .buckets
    .deployed
}

fn secured(loans: &[LoanSnapshotRow], events: &[LifecycleRow], day: i64) -> Option<String> {
    compute_financial_position(loans, events, day * DAY)
        .assets
        .deployed
        .secured_loans_outstanding
}

fn rate_events(loan_id: i64, outstanding: i64) -> Vec<LoanRateEventRow> {
    vec![LoanRateEventRow {
        loan_id: BigDecimal::from(loan_id),
        event_name: "Disbursed".to_owned(),
        block_timestamp: 0,
        outstanding: Some(usdc(outstanding)),
        new_rate: None,
    }]
}

fn series_at(
    loans: &[LoanSnapshotRow],
    events: &[LifecycleRow],
    day: i64,
) -> pipeline_api::routes::portfolio::SamplePoint {
    let t = day * DAY;
    compute_series(loans, events, &rate_events(1, 8_000_000), t, t, DAY)
        .into_iter()
        .next()
        .unwrap()
}

fn accrued_at(loans: &[LoanSnapshotRow], events: &[LifecycleRow], day: i64) -> String {
    series_at(loans, events, day).accrued
}

fn accrual_for_days(days: i64) -> String {
    let v = BigDecimal::from(8_000_000_i64 * 1200 * days) / BigDecimal::from(10_000_i64 * 365);
    v.with_scale_round(6, bigdecimal::RoundingMode::Down)
        .to_plain_string()
}

// ── Past maturity ────────────────────────────────────────────────────────────

#[test]
fn past_maturity_open_loan_is_active_everywhere() {
    let loans = [base()];
    let day = 110;

    let lb = book(&loans, &[], day);
    assert_eq!(lb.summary.total_deployed, "10000000.000000");
    assert_eq!(lb.summary.avg_yield.as_deref(), Some("0.120000"));

    assert_eq!(
        secured(&loans, &[], day).as_deref(),
        Some("10000000.000000")
    );
    assert_eq!(
        deployed_senior(&loans, &[], day).as_deref(),
        Some("8000000.000000")
    );

    let summary = compute_summary(&loans, &[], &[], &[], day * DAY);
    assert_eq!(
        summary.outstanding_in_loans.as_deref(),
        Some("10000000.000000")
    );
    assert_eq!(summary.loan_book_yield.as_deref(), Some("0.120000"));

    let s = series_at(&loans, &[], day);
    assert_eq!(s.principal_outstanding, "8000000.000000");
    assert!(s.apy.is_some());
    assert_eq!(s.accrued, accrual_for_days(110));
}

#[test]
fn rollover_does_not_change_status_or_end_the_loan() {
    let loans = [base()];
    let events = [legacy_ev(1, 100, "LoanRolledOver")];
    assert_eq!(
        status_at(&loans[0], &events, 150 * DAY),
        LoanStatus::Performing
    );
    assert_eq!(
        secured(&loans, &events, 150).as_deref(),
        Some("10000000.000000")
    );
    assert_eq!(
        series_at(&loans, &events, 150).accrued,
        accrual_for_days(150)
    );
}

// ── Default / cure / close ───────────────────────────────────────────────────

#[test]
fn default_is_not_active_but_is_at_risk() {
    let loans = [base()];
    let events = [status_ev(1, 0, "Performing"), status_ev(1, 50, "Default")];
    let day = 60;

    assert!(is_active_at(&loans[0], &events, 49 * DAY));
    assert!(!is_active_at(&loans[0], &events, day * DAY));
    assert!(is_at_risk_at(&loans[0], &events, day * DAY));

    let lb = book(&loans, &events, day);
    assert_eq!(lb.summary.total_deployed, "0.000000");
    assert_eq!(lb.summary.avg_yield, None);
    assert_eq!(lb.loans.len(), 1);
    assert_eq!(lb.summary.at_risk_wl_and_default_senior, "8000000.000000");

    assert_eq!(secured(&loans, &events, day).as_deref(), Some("0.000000"));
    assert_eq!(
        deployed_senior(&loans, &events, day).as_deref(),
        Some("0.000000")
    );
    let s = series_at(&loans, &events, day);
    assert_eq!(s.apy, None);
    assert_eq!(s.accrued, accrual_for_days(50));
}

#[test]
fn watchlist_is_active_and_at_risk() {
    let loans = [base()];
    let events = [status_ev(1, 20, "WatchList")];
    assert!(is_active_at(&loans[0], &events, 30 * DAY));
    assert!(is_at_risk_at(&loans[0], &events, 30 * DAY));
    let lb = book(&loans, &events, 30);
    assert_eq!(lb.summary.total_deployed, "10000000.000000");
    assert_eq!(lb.summary.at_risk_wl_and_default_senior, "8000000.000000");
}

#[test]
fn default_then_cure_reopens_from_the_cure() {
    let loans = [base()];
    let events = [status_ev(1, 50, "Default"), status_ev(1, 70, "WatchList")];

    assert_eq!(
        active_intervals(&loans[0], &events, 90 * DAY),
        vec![(0, 50 * DAY), (70 * DAY, 90 * DAY)]
    );
    assert_eq!(secured(&loans, &events, 60).as_deref(), Some("0.000000"));
    assert_eq!(
        secured(&loans, &events, 80).as_deref(),
        Some("10000000.000000")
    );
    assert_eq!(
        book(&loans, &events, 80).summary.total_deployed,
        "10000000.000000"
    );
    assert_eq!(accrued_at(&loans, &events, 60), accrual_for_days(50));
    assert_eq!(accrued_at(&loans, &events, 90), accrual_for_days(70));
}

#[test]
fn default_cure_default_again() {
    let loans = [base()];
    let events = [
        status_ev(1, 50, "Default"),
        status_ev(1, 70, "WatchList"),
        status_ev(1, 80, "Default"),
    ];
    assert_eq!(
        active_intervals(&loans[0], &events, 120 * DAY),
        vec![(0, 50 * DAY), (70 * DAY, 80 * DAY)]
    );
    assert!(!is_active_at(&loans[0], &events, 100 * DAY));
    assert!(is_at_risk_at(&loans[0], &events, 100 * DAY));
    assert_eq!(accrued_at(&loans, &events, 120), accrual_for_days(60));
}

#[test]
fn close_is_final() {
    let loans = [base()];
    let events = [status_ev(1, 90, "Closed"), status_ev(1, 95, "WatchList")];
    assert_eq!(status_at(&loans[0], &events, 100 * DAY), LoanStatus::Closed);
    assert!(!is_active_at(&loans[0], &events, 100 * DAY));
    assert!(!is_at_risk_at(&loans[0], &events, 100 * DAY));
    assert_eq!(secured(&loans, &events, 100).as_deref(), Some("0.000000"));
    assert_eq!(accrued_at(&loans, &events, 200), accrual_for_days(90));
    assert_eq!(
        book(&loans, &events, 100)
            .summary
            .at_risk_wl_and_default_senior,
        "0.000000"
    );
}

#[test]
fn default_then_close_leaves_at_risk() {
    let loans = [base()];
    let events = [status_ev(1, 50, "Default"), status_ev(1, 60, "Closed")];
    assert!(is_at_risk_at(&loans[0], &events, 55 * DAY));
    assert!(!is_at_risk_at(&loans[0], &events, 65 * DAY));
}

// ── Legacy fallback ──────────────────────────────────────────────────────────

#[test]
fn legacy_loan_defaulted_event_ends_activity() {
    let loans = [base()];
    let events = [legacy_ev(1, 50, "LoanDefaulted")];
    assert_eq!(status_at(&loans[0], &events, 60 * DAY), LoanStatus::Default);
    assert_eq!(
        active_intervals(&loans[0], &events, 120 * DAY),
        vec![(0, 50 * DAY)]
    );
    assert!(is_at_risk_at(&loans[0], &events, 60 * DAY));
}

#[test]
fn legacy_loan_closed_event_ends_activity() {
    let loans = [base()];
    let events = [
        legacy_ev(1, 50, "LoanDefaulted"),
        legacy_ev(1, 70, "LoanClosed"),
    ];
    assert_eq!(status_at(&loans[0], &events, 60 * DAY), LoanStatus::Default);
    assert_eq!(status_at(&loans[0], &events, 80 * DAY), LoanStatus::Closed);
    assert!(!is_at_risk_at(&loans[0], &events, 80 * DAY));
}

#[test]
fn legacy_loan_without_events_uses_snapshot_status_from_origination() {
    let performing = base();
    assert_eq!(
        active_intervals(&performing, &[], 200 * DAY),
        vec![(0, 200 * DAY)]
    );
    let defaulted = loan(1, 8_000_000, 2_000_000, "Default");
    assert!(!is_active_at(&defaulted, &[], 10 * DAY));
    assert!(is_at_risk_at(&defaulted, &[], 10 * DAY));
}

#[test]
fn old_registry_watchlist_then_legacy_closed_is_closed() {
    let loans = [base()];
    let events = [
        status_ev(1, 30, "WatchList"),
        legacy_ev(1, 70, "LoanClosed"),
    ];
    assert_eq!(
        status_at(&loans[0], &events, 50 * DAY),
        LoanStatus::WatchList
    );
    assert_eq!(status_at(&loans[0], &events, 80 * DAY), LoanStatus::Closed);
    assert_eq!(
        active_intervals(&loans[0], &events, 120 * DAY),
        vec![(0, 70 * DAY)]
    );
}

#[test]
fn old_registry_watchlist_then_legacy_defaulted_is_default() {
    let loans = [base()];
    let events = [
        status_ev(1, 30, "WatchList"),
        legacy_ev(1, 50, "LoanDefaulted"),
    ];
    assert_eq!(status_at(&loans[0], &events, 60 * DAY), LoanStatus::Default);
    assert!(is_at_risk_at(&loans[0], &events, 60 * DAY));
    assert_eq!(
        active_intervals(&loans[0], &events, 120 * DAY),
        vec![(0, 50 * DAY)]
    );
}

#[test]
fn new_registry_status_and_legacy_default_in_same_tx_match_status_only() {
    let loans = [base()];
    let both = [
        status_ev(1, 50, "Default"),
        legacy_ev(1, 50, "LoanDefaulted"),
    ];
    let only = [status_ev(1, 50, "Default")];
    assert_eq!(
        active_intervals(&loans[0], &both, 120 * DAY),
        active_intervals(&loans[0], &only, 120 * DAY)
    );
    assert_eq!(status_at(&loans[0], &both, 60 * DAY), LoanStatus::Default);
}

#[test]
fn new_registry_default_with_legacy_event_then_cure_is_active() {
    let loans = [base()];
    let events = [
        status_ev(1, 50, "Default"),
        legacy_ev(1, 50, "LoanDefaulted"),
        status_ev(1, 70, "WatchList"),
    ];
    assert_eq!(
        status_at(&loans[0], &events, 80 * DAY),
        LoanStatus::WatchList
    );
    assert_eq!(
        active_intervals(&loans[0], &events, 90 * DAY),
        vec![(0, 50 * DAY), (70 * DAY, 90 * DAY)]
    );
}

#[test]
fn default_and_cure_in_the_same_second_keep_on_chain_order() {
    let loans = [base()];
    let events = [
        status_ev(1, 50, "Default"),
        legacy_ev(1, 50, "LoanDefaulted"),
        status_ev(1, 50, "WatchList"),
    ];
    assert_eq!(
        status_at(&loans[0], &events, 60 * DAY),
        LoanStatus::WatchList
    );
    assert!(is_active_at(&loans[0], &events, 60 * DAY));
}

#[test]
fn unparseable_status_rows_fall_back_to_snapshot() {
    let defaulted = loan(1, 8_000_000, 2_000_000, "Default");
    let events = [status_ev(1, 10, "Bogus")];
    assert!(!is_active_at(&defaulted, &events, 20 * DAY));
}

#[test]
fn events_of_other_loans_and_chains_are_ignored() {
    let loans = [base()];
    let mut other_chain = status_ev(1, 10, "Closed");
    other_chain.chain_id = 2;
    let events = [status_ev(2, 10, "Closed"), other_chain];
    assert!(is_active_at(&loans[0], &events, 20 * DAY));
}

#[test]
fn not_yet_originated_loan_is_inactive() {
    let mut l = base();
    l.snapshot.origination_date = 30 * DAY;
    assert!(!is_active_at(&l, &[], 10 * DAY));
    assert!(is_active_at(&l, &[], 30 * DAY));
    assert!(active_intervals(&l, &[], 10 * DAY).is_empty());
    let tl = LoanTimeline::for_loan(&l, &[]);
    assert!(!tl.is_terminal_at(10 * DAY));
}

// ── Every endpoint agrees on one fixture ─────────────────────────────────────

#[test]
fn all_endpoints_agree_on_one_fixture() {
    let loans = [
        loan(1, 8_000_000, 2_000_000, "Performing"),
        loan(2, 4_000_000, 1_000_000, "Default"),
        loan(3, 6_000_000, 1_000_000, "Closed"),
        loan(4, 2_000_000, 500_000, "WatchList"),
    ];
    let events = [
        status_ev(2, 40, "Default"),
        status_ev(3, 60, "Closed"),
        status_ev(4, 30, "WatchList"),
    ];
    let day = 150;

    let active_total = "12500000.000000";
    let lb = book(&loans, &events, day);
    assert_eq!(lb.summary.total_deployed, active_total);
    assert_eq!(secured(&loans, &events, day).as_deref(), Some(active_total));

    let summary = compute_summary(&loans, &events, &[], &[], day * DAY);
    assert_eq!(summary.outstanding_in_loans.as_deref(), Some(active_total));
    assert_eq!(summary.loan_book_yield, lb.summary.avg_yield);

    assert_eq!(
        deployed_senior(&loans, &events, day).as_deref(),
        Some("10000000.000000")
    );

    let rows: Vec<LoanRateEventRow> = [
        (1, 8_000_000),
        (2, 4_000_000),
        (3, 6_000_000),
        (4, 2_000_000),
    ]
    .into_iter()
    .flat_map(|(id, o)| rate_events(id, o))
    .collect();
    let t = day * DAY;
    let s = compute_series(&loans, &events, &rows, t, t, DAY)
        .into_iter()
        .next()
        .unwrap();
    assert_eq!(s.principal_outstanding, "10000000.000000");

    assert_eq!(lb.summary.at_risk_wl_and_default_senior, "6000000.000000");
}

// ── /v1/stats/yield accrual intervals ────────────────────────────────────────

#[test]
fn series_accrual_follows_active_intervals_across_the_grid() {
    let loans = [base()];
    let events = [status_ev(1, 50, "Default"), status_ev(1, 70, "WatchList")];
    let rows = rate_events(1, 8_000_000);
    let series = compute_series(&loans, &events, &rows, 0, 100 * DAY, 10 * DAY);
    let by_day: Vec<String> = series.iter().map(|p| p.accrued.clone()).collect();
    assert_eq!(by_day[5], accrual_for_days(50));
    assert_eq!(by_day[6], accrual_for_days(50));
    assert_eq!(by_day[7], accrual_for_days(50));
    assert_eq!(by_day[8], accrual_for_days(60));
    assert_eq!(by_day[10], accrual_for_days(80));
    assert!(series[6].apy.is_none());
    assert!(series[8].apy.is_some());
}
