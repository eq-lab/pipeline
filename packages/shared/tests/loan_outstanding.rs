// spec: docs/exec-plans/completed/issue-1524-loanbook-outstanding.md

use bigdecimal::BigDecimal;
use shared::chains::ChainKind;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};

const MISLEADING: i64 = 999_999_999;

fn d(v: i64) -> BigDecimal {
    BigDecimal::from(v)
}

fn snapshot(disbursed: i64, repaid: i64, written_down: i64) -> LoanSnapshot {
    LoanSnapshot {
        originator: "Open Mineral".to_owned(),
        borrower_id: "BRW-1".to_owned(),
        commodity: "Copper Concentrate".to_owned(),
        corridor: "PE-CN".to_owned(),
        governing_law: "EN".to_owned(),
        protection: String::new(),
        metadata_uri: None,
        documents: Vec::new(),
        original_facility_size: d(MISLEADING),
        original_senior_tranche: d(MISLEADING),
        original_equity_tranche: d(0),
        original_offtaker_price: d(0),
        senior_interest_rate_bps: 1200,
        origination_date: 0,
        original_maturity_date: 0,
        next_economics_epochs_id: d(1),
        next_repayment_id: d(0),
        status: "Performing".to_owned(),
        current_maturity_timestamp: 0,
        current_rate: 1200,
        closure_reason: "None".to_owned(),
        carved_out: false,
        disbursed: d(disbursed),
        repaid: d(repaid),
        written_down: d(written_down),
        interest_adjustment: d(0),
        metadata_uri_onchain: String::new(),
        repayment: RepaymentSnapshot {
            offtaker_received: d(0),
            senior_principal_repaid: d(MISLEADING),
            senior_interest: d(0),
            equity_distributed: d(0),
            mgmt_fee: d(0),
            perf_fee: d(0),
            oet_alloc: d(0),
        },
    }
}

#[test]
fn fully_disbursed_with_no_repayment_is_disbursed() {
    assert_eq!(
        snapshot(1_000_000, 0, 0).outstanding_senior_principal(),
        d(1_000_000)
    );
}

#[test]
fn approved_loan_with_nothing_disbursed_is_zero() {
    assert_eq!(snapshot(0, 0, 0).outstanding_senior_principal(), d(0));
}

#[test]
fn partly_disbursed_loan_is_only_the_disbursed_part() {
    assert_eq!(
        snapshot(400_000, 0, 0).outstanding_senior_principal(),
        d(400_000)
    );
}

#[test]
fn undisbursed_reduces_outstanding() {
    assert_eq!(
        snapshot(600_000, 0, 0).outstanding_senior_principal(),
        d(600_000)
    );
}

#[test]
fn repaid_is_netted() {
    assert_eq!(
        snapshot(1_000_000, 300_000, 0).outstanding_senior_principal(),
        d(700_000)
    );
}

#[test]
fn written_down_is_netted() {
    assert_eq!(
        snapshot(1_000_000, 300_000, 200_000).outstanding_senior_principal(),
        d(500_000)
    );
}

#[test]
fn anomalous_over_repaid_floors_at_zero() {
    assert_eq!(snapshot(100, 80, 50).outstanding_senior_principal(), d(0));
}

#[test]
fn ignores_original_tranche_and_cumulative_senior_principal_repaid() {
    let s = snapshot(1_000, 0, 0);
    assert_eq!(s.original_senior_tranche, d(MISLEADING));
    assert_eq!(s.repayment.senior_principal_repaid, d(MISLEADING));
    assert_eq!(s.outstanding_senior_principal(), d(1_000));
}

#[test]
fn stellar_normalised_snapshot_yields_six_decimal_outstanding() {
    let mut s = snapshot(100_000_000, 30_000_000, 0);
    assert_eq!(s.outstanding_senior_principal(), d(70_000_000));
    s.normalize_usdc_for_display(ChainKind::Stellar);
    assert_eq!(s.outstanding_senior_principal(), d(7_000_000));
}

#[test]
fn legacy_pre_rework_row_reads_as_zero() {
    let mut v = serde_json::to_value(snapshot(1_000_000, 0, 0)).unwrap();
    let obj = v.as_object_mut().unwrap();
    for k in ["disbursed", "repaid", "written_down", "interest_adjustment"] {
        obj.remove(k);
    }
    let s: LoanSnapshot = serde_json::from_value(v).unwrap();
    assert_eq!(s.outstanding_senior_principal(), d(0));
}
