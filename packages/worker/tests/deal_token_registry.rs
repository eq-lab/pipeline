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
            cargo: CARGO.to_checksum(None),
        },
        DealRegistrationRow {
            loan_id: "2".into(),
            debt: "not-an-address".into(),
            cargo: other.to_checksum(None),
        },
    ];
    assert_eq!(reg.seed(&rows), 1);
    assert_eq!(reg.addresses().len(), 2);
    assert!(reg.lookup(&other).is_none());
    assert_eq!(reg.lookup(&DEBT).unwrap().loan_id, "1");
}
