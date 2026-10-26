// spec: docs/product-specs/book-rate-weighting.md
use std::collections::HashMap;

use bigdecimal::BigDecimal;

use pipeline_api::routes::dashboard::net_apy;
use pipeline_api::routes::loan_book::compute_loan_book;
use pipeline_api::routes::portfolio::compute_series;
use shared::book_weighting::{current_rate_bps, current_tenor_days, outstanding_at, rate_bps_at};
use shared::contract_logs_repo::{LoanRateEventRow, LoanSnapshotRow};
use shared::loan_economics::economics_rate_to_bps;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn zero_repayment() -> RepaymentSnapshot {
    let z = || BigDecimal::from(0_i64);
    RepaymentSnapshot {
        offtaker_received: z(),
        senior_principal_repaid: z(),
        senior_interest: z(),
        equity_distributed: z(),
        mgmt_fee: z(),
        perf_fee: z(),
        oet_alloc: z(),
    }
}

struct L {
    id: i64,
    senior: i64,
    equity: i64,
    disbursed: i64,
    repaid: i64,
    rate_bps: u32,
    current_rate: u32,
    start_day: i64,
    end_day: i64,
    current_end_day: i64,
}

impl L {
    fn new(id: i64, senior: i64, disbursed: i64, repaid: i64, rate_bps: u32) -> Self {
        Self {
            id,
            senior,
            equity: 0,
            disbursed,
            repaid,
            rate_bps,
            current_rate: rate_bps,
            start_day: 0,
            end_day: 100,
            current_end_day: 100,
        }
    }

    fn row(&self) -> LoanSnapshotRow {
        LoanSnapshotRow {
            chain_id: 1,
            loan_id: BigDecimal::from(self.id),
            block_number: 0,
            log_index: 0,
            event_name: "Disbursed".to_owned(),
            block_timestamp: 0,
            snapshot: LoanSnapshot {
                originator: "o".to_owned(),
                borrower_id: "b".to_owned(),
                commodity: "c".to_owned(),
                corridor: "cr".to_owned(),
                governing_law: "EN".to_owned(),
                protection: String::new(),
                metadata_uri: None,
                documents: Vec::new(),
                original_facility_size: usdc(self.senior + self.equity),
                original_senior_tranche: usdc(self.senior),
                original_equity_tranche: usdc(self.equity),
                original_offtaker_price: BigDecimal::from(0_i64),
                senior_interest_rate_bps: self.rate_bps,
                origination_date: self.start_day * DAY,
                original_maturity_date: self.end_day * DAY,
                next_economics_epochs_id: BigDecimal::from(1_i64),
                next_repayment_id: BigDecimal::from(0_i64),
                status: "Performing".to_owned(),
                current_maturity_timestamp: self.current_end_day * DAY,
                current_rate: self.current_rate,
                closure_reason: "None".to_owned(),
                carved_out: false,
                disbursed: usdc(self.disbursed),
                repaid: usdc(self.repaid),
                written_down: BigDecimal::from(0_i64),
                interest_adjustment: BigDecimal::from(0_i64),
                metadata_uri_onchain: String::new(),
                repayment: zero_repayment(),
            },
        }
    }
}

fn book(loans: &[LoanSnapshotRow]) -> pipeline_api::routes::loan_book::LoanBookResponse {
    compute_loan_book(
        loans,
        &[],
        50 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
    )
}

fn outstanding_event(loan_id: i64, name: &str, day: i64, outstanding: i64) -> LoanRateEventRow {
    LoanRateEventRow {
        loan_id: BigDecimal::from(loan_id),
        event_name: name.to_owned(),
        block_timestamp: day * DAY,
        outstanding: Some(usdc(outstanding)),
        new_rate: None,
    }
}

fn rate_event(loan_id: i64, name: &str, day: i64, new_rate_ppm: i64) -> LoanRateEventRow {
    LoanRateEventRow {
        loan_id: BigDecimal::from(loan_id),
        event_name: name.to_owned(),
        block_timestamp: day * DAY,
        outstanding: None,
        new_rate: Some(new_rate_ppm),
    }
}

fn apy_at(loans: &[LoanSnapshotRow], rate_events: &[LoanRateEventRow], day: i64) -> Option<f64> {
    let t = day * DAY;
    compute_series(loans, &[], rate_events, t, t, DAY)
        .pop()
        .unwrap()
        .apy
}

// ── LoanBook / dashboard ─────────────────────────────────────────────────────

#[test]
fn repaid_loan_weighs_by_outstanding_not_original_senior() {
    let loans = vec![
        L::new(1, 10_000_000, 10_000_000, 9_000_000, 1000).row(),
        L::new(2, 10_000_000, 10_000_000, 0, 2000).row(),
    ];
    let s = book(&loans).summary;
    assert_eq!(s.avg_yield.as_deref(), Some("0.190909"));
    assert_eq!(s.weighted_rate, s.avg_yield);
}

#[test]
fn issue_example_fully_disbursed_no_repayments() {
    let a = L {
        equity: 200,
        ..L::new(1, 800, 800, 0, 1000)
    };
    let b = L {
        equity: 500,
        ..L::new(2, 500, 500, 0, 2000)
    };
    let s = book(&[a.row(), b.row()]).summary;
    assert_eq!(s.avg_yield.as_deref(), Some("0.138462"));
}

#[test]
fn undisbursed_loan_contributes_zero_weight() {
    let loans = vec![
        L::new(1, 1000, 1000, 0, 1000).row(),
        L::new(2, 1000, 0, 0, 3000).row(),
    ];
    assert_eq!(book(&loans).summary.avg_yield.as_deref(), Some("0.100000"));
}

#[test]
fn all_repaid_or_undisbursed_gives_null() {
    let loans = vec![
        L::new(1, 1000, 1000, 1000, 1000).row(),
        L::new(2, 1000, 0, 0, 2000).row(),
    ];
    let s = book(&loans).summary;
    assert_eq!(s.avg_yield, None);
    assert_eq!(s.weighted_rate, None);
    assert_eq!(s.avg_duration_days, None);
    assert_eq!(s.weighted_tenor_days, None);
}

#[test]
fn amended_current_rate_replaces_genesis_rate() {
    let amended = L {
        current_rate: 2000,
        ..L::new(1, 1000, 1000, 0, 1000)
    };
    let loans = vec![amended.row(), L::new(2, 1000, 1000, 0, 1000).row()];
    let s = book(&loans).summary;
    assert_eq!(s.avg_yield.as_deref(), Some("0.150000"));
}

#[test]
fn pre_rework_zero_current_rate_falls_back_to_genesis() {
    let legacy = L {
        current_rate: 0,
        ..L::new(1, 1000, 1000, 0, 1200)
    };
    assert_eq!(current_rate_bps(&legacy.row().snapshot), 1200);
    let s = book(&[legacy.row()]).summary;
    assert_eq!(s.avg_yield.as_deref(), Some("0.120000"));
    assert_eq!(book(&[legacy.row()]).loans[0].rate, "0.120000");
}

#[test]
fn per_loan_rate_is_current_rate() {
    let amended = L {
        current_rate: 1500,
        ..L::new(1, 1000, 1000, 0, 1000)
    };
    assert_eq!(book(&[amended.row()]).loans[0].rate, "0.150000");
}

#[test]
fn duration_is_weighted_by_outstanding_senior() {
    let short = L {
        end_day: 90,
        current_end_day: 90,
        ..L::new(1, 3000, 3000, 0, 1000)
    };
    let long = L {
        end_day: 180,
        current_end_day: 180,
        ..L::new(2, 1000, 1000, 0, 1000)
    };
    let s = book(&[short.row(), long.row()]).summary;
    assert_eq!(s.avg_duration_days, Some(113));
    assert_eq!(s.weighted_tenor_days, Some(113));
}

#[test]
fn duration_uses_rollover_current_maturity() {
    let rolled = L {
        end_day: 90,
        current_end_day: 150,
        ..L::new(1, 1000, 1000, 0, 1000)
    };
    assert_eq!(current_tenor_days(&rolled.row().snapshot), 150);
    let s = book(&[rolled.row()]).summary;
    assert_eq!(s.avg_duration_days, Some(150));
    assert_eq!(book(&[rolled.row()]).loans[0].duration_days, 150);
}

#[test]
fn duration_falls_back_to_original_maturity_when_current_absent() {
    let l = L {
        end_day: 90,
        current_end_day: 0,
        ..L::new(1, 1000, 1000, 0, 1000)
    };
    assert_eq!(current_tenor_days(&l.row().snapshot), 90);
}

#[test]
fn net_apy_uses_the_outstanding_weighted_gross_rate() {
    let loans = vec![
        L::new(1, 10_000_000, 10_000_000, 9_000_000, 1000).row(),
        L::new(2, 10_000_000, 10_000_000, 0, 2000).row(),
    ];
    let gross = book(&loans).summary.avg_yield;
    assert_eq!(
        net_apy(gross.as_deref(), &loans).as_deref(),
        Some("0.190909")
    );
}

#[test]
fn net_apy_is_zero_for_a_zero_gross_rate_and_null_only_without_a_gross_rate() {
    let loans = vec![L::new(1, 10_000_000, 10_000_000, 0, 0).row()];
    assert_eq!(
        net_apy(Some("0.000000"), &loans).as_deref(),
        Some("0.000000")
    );
    assert_eq!(net_apy(None, &loans), None);
}

// ── /v1/stats/yield apy series ───────────────────────────────────────────────

fn series_fixture() -> (Vec<LoanSnapshotRow>, Vec<LoanRateEventRow>) {
    let loans = vec![
        L::new(1, 10_000_000, 10_000_000, 0, 1000).row(),
        L::new(2, 10_000_000, 10_000_000, 0, 2000).row(),
    ];
    let events = vec![
        outstanding_event(1, "Disbursed", 0, 10_000_000),
        outstanding_event(2, "Disbursed", 0, 10_000_000),
    ];
    (loans, events)
}

fn assert_apy(got: Option<f64>, want: f64) {
    let g = got.expect("apy present");
    assert!((g - want).abs() < 1e-8, "got {g}, want {want}");
}

#[test]
fn series_weights_by_outstanding_after_repayment() {
    let (loans, mut events) = series_fixture();
    assert_apy(apy_at(&loans, &events, 10), 0.15);
    events.push(outstanding_event(1, "PaymentRecorded", 20, 1_000_000));
    assert_apy(apy_at(&loans, &events, 10), 0.15);
    assert_apy(apy_at(&loans, &events, 20), 0.190_909_09);
}

#[test]
fn series_undisbursed_loan_has_zero_weight() {
    let (loans, mut events) = series_fixture();
    events.retain(|e| e.loan_id != 2_i64);
    assert_apy(apy_at(&loans, &events, 10), 0.10);
    events.push(outstanding_event(2, "Disbursed", 30, 10_000_000));
    assert_apy(apy_at(&loans, &events, 29), 0.10);
    assert_apy(apy_at(&loans, &events, 30), 0.15);
}

#[test]
fn series_undisbursed_event_resets_outstanding() {
    let (loans, mut events) = series_fixture();
    events.push(outstanding_event(2, "Undisbursed", 15, 0));
    assert_apy(apy_at(&loans, &events, 15), 0.10);
}

#[test]
fn series_null_when_all_repaid_or_no_events() {
    let (loans, mut events) = series_fixture();
    assert_eq!(apy_at(&loans, &[], 10), None);
    events.push(outstanding_event(1, "PaymentRecorded", 20, 0));
    events.push(outstanding_event(2, "PaymentRecorded", 20, 0));
    assert_eq!(apy_at(&loans, &events, 20), None);
    assert_apy(apy_at(&loans, &events, 19), 0.15);
}

#[test]
fn series_payment_unrecorded_restores_outstanding() {
    let (loans, mut events) = series_fixture();
    events.push(outstanding_event(1, "PaymentRecorded", 20, 0));
    events.push(outstanding_event(1, "PaymentUnrecorded", 25, 10_000_000));
    assert_apy(apy_at(&loans, &events, 22), 0.20);
    assert_apy(apy_at(&loans, &events, 25), 0.15);
}

#[test]
fn series_default_and_write_down_events_set_outstanding() {
    let (loans, mut events) = series_fixture();
    events.push(outstanding_event(2, "LoanDefaulted", 40, 5_000_000));
    events.push(outstanding_event(2, "LoanWrittenDown", 45, 2_000_000));
    assert_apy(
        apy_at(&loans, &events, 40),
        (10.0 * 10.0 + 5.0 * 20.0) / 15.0 / 100.0,
    );
    assert_apy(
        apy_at(&loans, &events, 45),
        (10.0 * 10.0 + 2.0 * 20.0) / 12.0 / 100.0,
    );
}

#[test]
fn series_amendment_changes_rate_from_its_timestamp() {
    let (loans, mut events) = series_fixture();
    events.push(rate_event(1, "EconomicsAmended", 20, 200_000));
    assert_apy(apy_at(&loans, &events, 19), 0.15);
    assert_apy(apy_at(&loans, &events, 20), 0.20);
}

#[test]
fn series_rollover_changes_rate_and_later_event_wins() {
    let (loans, mut events) = series_fixture();
    events.push(rate_event(1, "LoanRolledOver", 30, 150_000));
    events.push(rate_event(1, "EconomicsAmended", 35, 300_000));
    assert_apy(apy_at(&loans, &events, 30), 0.175);
    assert_apy(apy_at(&loans, &events, 36), 0.25);
}

#[test]
fn series_events_of_other_loans_are_ignored() {
    let (loans, mut events) = series_fixture();
    events.push(outstanding_event(99, "PaymentRecorded", 5, 0));
    events.push(rate_event(99, "EconomicsAmended", 5, 900_000));
    assert_apy(apy_at(&loans, &events, 10), 0.15);
}

// Fixture: 10M USDC each, rates 1000 / 2000 bps, 10 days, YEAR = 31_557_600.
// Before: 10M x (0.10 + 0.20) x 10 d / 365.25 d = 82_135.523613.
// After (loan 1 -> 9000 bps from day 5, loan 2 repaid to 0 at day 5):
//   loan 1: 10M x (0.10 x 5 + 0.90 x 5) / 365.25 = 136_892.539357
//   loan 2: 10M x 0.20 x 5 / 365.25 = 27_378.507871
//   total 164_271.047227
#[test]
fn series_accrued_follows_rate_and_outstanding_events() {
    let (loans, mut events) = series_fixture();
    let t = 10 * DAY;
    let before = compute_series(&loans, &[], &events, t, t, DAY)
        .pop()
        .unwrap();
    assert_eq!(before.accrued, "82135.523613");
    events.push(rate_event(1, "EconomicsAmended", 5, 900_000));
    events.push(outstanding_event(2, "PaymentRecorded", 5, 0));
    let after = compute_series(&loans, &[], &events, t, t, DAY)
        .pop()
        .unwrap();
    assert_eq!(after.accrued, "164271.047227");
}

#[test]
fn series_accrued_is_zero_without_outstanding_events() {
    let (loans, _) = series_fixture();
    let t = 10 * DAY;
    let s = compute_series(&loans, &[], &[], t, t, DAY).pop().unwrap();
    assert_eq!(s.accrued, "0.000000");
}

#[test]
fn rate_event_ppm_to_bps_floors_like_the_snapshot() {
    let (loans, mut events) = series_fixture();
    events.push(rate_event(1, "EconomicsAmended", 5, 112_550));
    events.push(rate_event(2, "EconomicsAmended", 5, 112_550));
    assert_apy(apy_at(&loans, &events, 10), 0.1125);
    assert_eq!(economics_rate_to_bps(112_550), 1125);
    assert_eq!(economics_rate_to_bps(112_599), 1125);
    assert_eq!(economics_rate_to_bps(112_550) as i64, 112_550 / 100);
}

// ── helper functions ─────────────────────────────────────────────────────────

#[test]
fn helper_latest_event_at_or_before_t_wins_and_ties_keep_input_order() {
    let a = outstanding_event(1, "Disbursed", 5, 100);
    let b = outstanding_event(1, "PaymentRecorded", 5, 40);
    let c = outstanding_event(1, "PaymentRecorded", 9, 10);
    let refs = vec![&a, &b, &c];
    assert_eq!(outstanding_at(&refs, 4 * DAY), BigDecimal::from(0_i64));
    assert_eq!(outstanding_at(&refs, 5 * DAY), usdc(40));
    assert_eq!(outstanding_at(&refs, 100 * DAY), usdc(10));
    assert_eq!(rate_bps_at(1234, &refs, 100 * DAY), 1234);
}
