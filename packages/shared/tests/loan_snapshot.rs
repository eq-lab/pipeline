//! Unit tests for `LoanSnapshot::normalize_usdc_for_display` /
//! `RepaymentSnapshot::normalize_usdc_for_display`.
//!
//! No env vars, no DB — pure struct mutation. `contract_logs` itself must always
//! store the raw on-chain value; these methods are only ever called when reading
//! data back out for API/display use (see #901).

use bigdecimal::BigDecimal;
use shared::chains::ChainKind;
use shared::loan_snapshot::{LoanSnapshot, LocationUpdateSnapshot, RepaymentSnapshot};

fn repayment_with(v: i64) -> RepaymentSnapshot {
    RepaymentSnapshot {
        offtaker_received: BigDecimal::from(v),
        senior_principal_repaid: BigDecimal::from(v),
        senior_interest: BigDecimal::from(v),
        equity_distributed: BigDecimal::from(v),
        mgmt_fee: BigDecimal::from(v),
        perf_fee: BigDecimal::from(v),
        oet_alloc: BigDecimal::from(v),
    }
}

fn snapshot_with(amount: i64) -> LoanSnapshot {
    LoanSnapshot {
        originator: "Open Mineral".to_owned(),
        borrower_id: "BRW-1".to_owned(),
        commodity: "Copper Concentrate".to_owned(),
        corridor: "PE-CN".to_owned(),
        governing_law: "EN".to_owned(),
        protection: String::new(),
        metadata_uri: None,
        documents: Vec::new(),
        original_facility_size: BigDecimal::from(amount),
        original_senior_tranche: BigDecimal::from(amount),
        original_equity_tranche: BigDecimal::from(amount),
        original_offtaker_price: BigDecimal::from(amount),
        senior_interest_rate_bps: 1200,
        origination_date: 0,
        original_maturity_date: 0,
        next_economics_epochs_id: BigDecimal::from(1),
        next_repayment_id: BigDecimal::from(0),
        status: "Performing".to_owned(),
        ccr_bps: 15_000,
        last_reported_ccr_timestamp: 0,
        current_maturity_timestamp: 0,
        closure_reason: "None".to_owned(),
        current_location: LocationUpdateSnapshot {
            location_type: "Vessel".to_owned(),
            location_identifier: String::new(),
            tracking_url: String::new(),
            updated_at: 0,
        },
        metadata_uri_onchain: String::new(),
        repayment: repayment_with(amount),
    }
}

#[test]
fn evm_normalization_is_a_no_op() {
    let mut snapshot = snapshot_with(10_000_000);
    let before = snapshot.clone();
    snapshot.normalize_usdc_for_display(ChainKind::Evm);
    assert_eq!(snapshot, before);
}

#[test]
fn stellar_normalization_divides_every_monetary_field_by_ten() {
    // $1,000 at native 7-decimal Stellar scale -> $1,000 at canonical 6-decimal (#901).
    let mut snapshot = snapshot_with(10_000_000);
    snapshot.normalize_usdc_for_display(ChainKind::Stellar);

    let expected = BigDecimal::from(1_000_000);
    assert_eq!(snapshot.original_facility_size, expected);
    assert_eq!(snapshot.original_senior_tranche, expected);
    assert_eq!(snapshot.original_equity_tranche, expected);
    assert_eq!(snapshot.original_offtaker_price, expected);
    assert_eq!(snapshot.repayment.offtaker_received, expected);
    assert_eq!(snapshot.repayment.senior_principal_repaid, expected);
    assert_eq!(snapshot.repayment.senior_interest, expected);
    assert_eq!(snapshot.repayment.equity_distributed, expected);
    assert_eq!(snapshot.repayment.mgmt_fee, expected);
    assert_eq!(snapshot.repayment.perf_fee, expected);
    assert_eq!(snapshot.repayment.oet_alloc, expected);
}

#[test]
fn stellar_normalization_does_not_touch_non_monetary_fields() {
    let mut snapshot = snapshot_with(10_000_000);
    snapshot.senior_interest_rate_bps = 1200;
    snapshot.ccr_bps = 15_000;
    snapshot.origination_date = 1_700_000_000;

    snapshot.normalize_usdc_for_display(ChainKind::Stellar);

    // Rate/ratio/timestamp fields are untouched — only currency amounts scale-fix.
    assert_eq!(snapshot.senior_interest_rate_bps, 1200);
    assert_eq!(snapshot.ccr_bps, 15_000);
    assert_eq!(snapshot.origination_date, 1_700_000_000);
    assert_eq!(snapshot.originator, "Open Mineral");
}
