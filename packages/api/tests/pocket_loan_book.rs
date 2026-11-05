// spec: docs/references/backend.md#stellar-pocket-indexing
use std::collections::HashMap;

use bigdecimal::BigDecimal;
use pipeline_api::routes::loan_book::{
    attach_pockets, compute_loan_book, loan_pocket, loan_ref, LoanRef,
};
use shared::chains::ChainKind;
use shared::contract_logs_repo::LoanSnapshotRow;
use shared::loan_snapshot::{LoanSnapshot, RepaymentSnapshot};
use shared::pocket::PocketFold;

const DAY: i64 = 86_400;

fn usdc(whole: i64) -> BigDecimal {
    BigDecimal::from(whole * 1_000_000)
}

fn make_loan(chain_id: i64, loan_id: i64) -> LoanSnapshotRow {
    let zero = || BigDecimal::from(0_i64);
    LoanSnapshotRow {
        chain_id,
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
            documents: Vec::new(),
            original_facility_size: usdc(100_000),
            original_senior_tranche: usdc(80_000),
            original_equity_tranche: usdc(20_000),
            original_offtaker_price: zero(),
            senior_interest_rate_bps: 1200,
            origination_date: 0,
            original_maturity_date: 180 * DAY,
            next_economics_epochs_id: BigDecimal::from(1_i64),
            next_repayment_id: zero(),
            status: "Performing".to_owned(),
            current_maturity_timestamp: 180 * DAY,
            current_rate: 1200,
            closure_reason: "None".to_owned(),
            carved_out: false,
            disbursed: usdc(80_000),
            repaid: zero(),
            written_down: zero(),
            interest_adjustment: zero(),
            metadata_uri_onchain: String::new(),
            repayment: RepaymentSnapshot {
                offtaker_received: zero(),
                senior_principal_repaid: zero(),
                senior_interest: zero(),
                equity_distributed: zero(),
                mgmt_fee: zero(),
                perf_fee: zero(),
                oet_alloc: zero(),
            },
        },
    }
}

fn fold(complete: bool) -> PocketFold {
    PocketFold {
        snapshot_ledger: 5_500_000,
        supply_at_snapshot: BigDecimal::from(10_000_000_000_i64),
        opened: complete.then(|| BigDecimal::from(5_000_000_000_i64)),
        held: BigDecimal::from(2_000_000_000_i64),
        released_total: BigDecimal::from(3_500_000_000_i64),
        burned_total: BigDecimal::from(3_000_000_000_i64),
        claimed_total: BigDecimal::from(3_100_000_000_i64),
        complete,
    }
}

#[test]
fn loan_pocket_formats_stellar_seven_decimals_to_six() {
    let pocket = loan_pocket(ChainKind::Stellar, &fold(true));
    assert_eq!(pocket.snapshot_ledger, 5_500_000);
    assert_eq!(pocket.supply_at_snapshot, "10000000000");
    assert_eq!(pocket.opened.as_deref(), Some("500.000000"));
    assert_eq!(pocket.held, "200.000000");
    assert_eq!(pocket.released_total, "350.000000");
    assert_eq!(pocket.burned_total, "300.000000");
    assert_eq!(pocket.claimed_total, "310.000000");
    assert!(pocket.complete);
}

#[test]
fn loan_pocket_opened_is_null_when_incomplete() {
    let pocket = loan_pocket(ChainKind::Stellar, &fold(false));
    assert_eq!(pocket.opened, None);
    assert!(!pocket.complete);
}

#[test]
fn attach_pockets_fills_only_the_matching_chain_and_loan() {
    let loans = vec![make_loan(1, 1), make_loan(1, 2), make_loan(2, 1)];
    let mut resp = compute_loan_book(
        &loans,
        &[],
        10 * DAY,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
    );
    let mut pockets: HashMap<LoanRef, (ChainKind, PocketFold)> = HashMap::new();
    pockets.insert(
        loan_ref(1, &BigDecimal::from(2)),
        (ChainKind::Stellar, fold(true)),
    );
    attach_pockets(&mut resp, &pockets);

    let json = serde_json::to_value(&resp).unwrap();
    let rows = json["loans"].as_array().unwrap();
    assert_eq!(rows.len(), 3);
    for row in rows {
        let matches = row["chain_id"] == 1 && row["loan_id"] == "2";
        if matches {
            assert_eq!(row["pocket"]["held"], "200.000000");
            assert_eq!(row["pocket"]["complete"], true);
        } else {
            assert!(row.get("pocket").is_some(), "pocket key must be present");
            assert!(row["pocket"].is_null());
        }
    }
}
