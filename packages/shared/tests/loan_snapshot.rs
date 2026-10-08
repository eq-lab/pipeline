// spec: docs/exec-plans/active/issue-1432-shared-loan-data-model.md#d2--legacy-row-compatibility-remove-deny_unknown_fields-from-loansnapshot

use bigdecimal::BigDecimal;
use shared::chains::ChainKind;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};

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
        current_maturity_timestamp: 0,
        current_rate: 1200,
        closure_reason: "None".to_owned(),
        carved_out: true,
        disbursed: BigDecimal::from(amount),
        repaid: BigDecimal::from(amount),
        written_down: BigDecimal::from(amount),
        interest_adjustment: BigDecimal::from(-amount),
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
    assert_eq!(snapshot.disbursed, expected);
    assert_eq!(snapshot.repaid, expected);
    assert_eq!(snapshot.written_down, expected);
    assert_eq!(snapshot.interest_adjustment, -&expected);
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
    snapshot.current_rate = 1200;
    snapshot.carved_out = true;
    snapshot.origination_date = 1_700_000_000;

    snapshot.normalize_usdc_for_display(ChainKind::Stellar);

    // Rate/ratio/timestamp/flag fields are untouched — only currency amounts scale-fix.
    assert_eq!(snapshot.senior_interest_rate_bps, 1200);
    assert_eq!(snapshot.current_rate, 1200);
    assert!(snapshot.carved_out);
    assert_eq!(snapshot.origination_date, 1_700_000_000);
    assert_eq!(snapshot.originator, "Open Mineral");
}

#[test]
fn round_trips_through_json_with_the_new_shape() {
    let snapshot = snapshot_with(10_000_000);
    let value = serde_json::to_value(&snapshot).expect("serialize");
    let restored: LoanSnapshot = serde_json::from_value(value).expect("deserialize");
    assert_eq!(restored, snapshot);

    assert_eq!(restored.current_rate, 1200);
    assert!(restored.carved_out);
    assert_eq!(restored.disbursed, BigDecimal::from(10_000_000));
    assert_eq!(restored.repaid, BigDecimal::from(10_000_000));
    assert_eq!(restored.written_down, BigDecimal::from(10_000_000));
    assert_eq!(restored.interest_adjustment, BigDecimal::from(-10_000_000));
}

/// A pre-rework `contract_logs.params.snapshot` row: carries the removed `ccr_bps`,
/// `last_reported_ccr_timestamp` and nested `current_location`, and predates
/// `protection` / `documents` too, matching a genuinely old row.
fn legacy_row_json(location: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "originator": "Open Mineral",
        "borrower_id": "BRW-1",
        "commodity": "Copper Concentrate",
        "corridor": "PE-CN",
        "governing_law": "EN",
        "metadata_uri": null,
        "original_facility_size": "10000000",
        "original_senior_tranche": "10000000",
        "original_equity_tranche": "10000000",
        "original_offtaker_price": "10000000",
        "senior_interest_rate_bps": 1200,
        "origination_date": 0,
        "original_maturity_date": 0,
        "next_economics_epochs_id": "1",
        "next_repayment_id": "0",
        "status": "Performing",
        "ccr_bps": 15_000,
        "last_reported_ccr_timestamp": 0,
        "current_maturity_timestamp": 0,
        "closure_reason": "None",
        "current_location": location,
        "metadata_uri_onchain": "",
        "repayment": {
            "offtaker_received": "0",
            "senior_principal_repaid": "0",
            "senior_interest": "0",
            "equity_distributed": "0",
            "mgmt_fee": "0",
            "perf_fee": "0",
            "oet_alloc": "0",
        },
    })
}

fn assert_legacy_row_defaults(snapshot: &LoanSnapshot) {
    assert_eq!(snapshot.senior_interest_rate_bps, 1200);
    assert_eq!(snapshot.status, "Performing");
    assert_eq!(snapshot.protection, "");
    assert!(snapshot.documents.is_empty());
    assert_eq!(snapshot.current_rate, 0);
    assert!(!snapshot.carved_out);
    assert_eq!(snapshot.disbursed, BigDecimal::from(0));
    assert_eq!(snapshot.repaid, BigDecimal::from(0));
    assert_eq!(snapshot.written_down, BigDecimal::from(0));
    assert_eq!(snapshot.interest_adjustment, BigDecimal::from(0));
}

#[test]
fn legacy_row_with_populated_location_deserializes_and_defaults_new_fields() {
    let json = legacy_row_json(&serde_json::json!({
        "location_type": "Vessel",
        "location_identifier": "MV Example",
        "tracking_url": "https://example.com",
        "updated_at": 1_700_000_000,
    }));
    let snapshot: LoanSnapshot = serde_json::from_value(json).expect("deserialize legacy row");
    assert_legacy_row_defaults(&snapshot);
}

#[test]
fn legacy_row_with_never_reported_location_deserializes() {
    let json = legacy_row_json(&serde_json::json!({
        "location_type": "",
        "location_identifier": "",
        "tracking_url": "",
        "updated_at": 0,
    }));
    let snapshot: LoanSnapshot = serde_json::from_value(json).expect("deserialize legacy row");
    assert_legacy_row_defaults(&snapshot);
}

#[test]
fn legacy_row_with_unrelated_unknown_key_still_deserializes() {
    let mut json = legacy_row_json(&serde_json::json!({
        "location_type": "",
        "location_identifier": "",
        "tracking_url": "",
        "updated_at": 0,
    }));
    json.as_object_mut()
        .expect("object")
        .insert("foo".to_owned(), serde_json::json!("bar"));
    let snapshot: LoanSnapshot = serde_json::from_value(json).expect("deserialize legacy row");
    assert_legacy_row_defaults(&snapshot);
}
