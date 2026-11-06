mod deal_token_support;

use alloy::primitives::{address, Address, U256};
use deal_token_support::*;
use pipeline_worker::indexer::deal_tokens::{DealTokenKind, DealTokenRegistry};
use pipeline_worker::indexer::poller::DynamicAddressSource;
use shared::contract_logs_repo::DealRegistrationRow;

#[test]
fn observe_registers_both_tokens_idempotently() {
    let reg = DealTokenRegistry::new(FACTORY);
    let log = deal_registered(U256::from(4u64), DEBT, CARGO, 10, 0);
    let mut added = reg.observe(&log);
    added.sort();
    let mut expected = vec![DEBT, CARGO];
    expected.sort();
    assert_eq!(added, expected);

    let debt = reg.lookup(&DEBT).unwrap();
    assert_eq!(debt.loan_id, "4");
    assert_eq!(debt.kind, DealTokenKind::Debt);
    assert_eq!(reg.lookup(&CARGO).unwrap().kind, DealTokenKind::Cargo);

    assert!(reg.observe(&log).is_empty());
    assert_eq!(reg.addresses().len(), 2);
}

#[test]
fn observe_ignores_non_factory_emitter() {
    let reg = DealTokenRegistry::new(FACTORY);
    let mut log = deal_registered(U256::from(4u64), DEBT, CARGO, 10, 0);
    log.inner.address = SPLUSD;
    assert!(reg.observe(&log).is_empty());
    assert!(reg.addresses().is_empty());
}

#[test]
fn observe_ignores_other_factory_events() {
    let reg = DealTokenRegistry::new(FACTORY);
    assert!(reg
        .observe(&debt_synced(U256::from(1u64), 1, 0, 1, 0))
        .is_empty());
}

#[test]
fn seed_skips_malformed_rows() {
    let reg = DealTokenRegistry::new(FACTORY);
    let other: Address = address!("0000000000000000000000000000000000000abc");
    let rows = vec![
        DealRegistrationRow {
            loan_id: "1".into(),
            debt: DEBT.to_checksum(None),
            cargo: Some(CARGO.to_checksum(None)),
        },
        DealRegistrationRow {
            loan_id: "2".into(),
            debt: "not-an-address".into(),
            cargo: Some(other.to_checksum(None)),
        },
    ];
    assert_eq!(reg.seed(&rows), 1);
    assert_eq!(reg.addresses().len(), 2);
    assert!(reg.lookup(&other).is_none());
    assert_eq!(reg.lookup(&DEBT).unwrap().loan_id, "1");
}

#[test]
fn seed_evm_rows_track_debt_and_cargo_as_before() {
    let reg = DealTokenRegistry::new(FACTORY);
    let debt2: Address = address!("0000000000000000000000000000000000000d02");
    let cargo2: Address = address!("0000000000000000000000000000000000000c02");
    let rows = vec![
        DealRegistrationRow {
            loan_id: "1".into(),
            debt: DEBT.to_checksum(None),
            cargo: Some(CARGO.to_checksum(None)),
        },
        DealRegistrationRow {
            loan_id: "2".into(),
            debt: debt2.to_checksum(None),
            cargo: Some(cargo2.to_checksum(None)),
        },
    ];
    assert_eq!(reg.seed(&rows), 2);
    assert_eq!(reg.addresses().len(), 4);
    for (addr, loan, kind) in [
        (DEBT, "1", DealTokenKind::Debt),
        (CARGO, "1", DealTokenKind::Cargo),
        (debt2, "2", DealTokenKind::Debt),
        (cargo2, "2", DealTokenKind::Cargo),
    ] {
        let info = reg.lookup(&addr).unwrap();
        assert_eq!(info.loan_id, loan);
        assert_eq!(info.kind, kind);
    }
}

#[test]
fn seed_debt_only_row_tracks_debt() {
    let reg = DealTokenRegistry::new(FACTORY);
    let rows = vec![DealRegistrationRow {
        loan_id: "7".into(),
        debt: DEBT.to_checksum(None),
        cargo: None,
    }];
    assert_eq!(reg.seed(&rows), 1);
    assert_eq!(reg.addresses().len(), 1);
    assert_eq!(reg.lookup(&DEBT).unwrap().kind, DealTokenKind::Debt);
}

#[test]
fn seed_skips_row_with_unparseable_cargo() {
    let reg = DealTokenRegistry::new(FACTORY);
    let rows = vec![DealRegistrationRow {
        loan_id: "8".into(),
        debt: DEBT.to_checksum(None),
        cargo: Some("nope".into()),
    }];
    assert_eq!(reg.seed(&rows), 0);
    assert!(reg.addresses().is_empty());
}
