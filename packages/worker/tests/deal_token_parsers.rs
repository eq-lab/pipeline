mod deal_token_support;

use alloy::primitives::{Address, U256};
use deal_token_support::*;
use pipeline_worker::indexer::deal_token_parsers::{
    decode_deal_registered, parse_cargo_synced, parse_deal_registered, parse_deal_token_transfer,
    parse_debt_synced,
};
use pipeline_worker::indexer::deal_tokens::{DealTokenInfo, DealTokenKind};
use serde_json::{json, Value};

fn keys(v: &Value) -> Vec<String> {
    let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
    k.sort();
    k
}

fn debt_info() -> DealTokenInfo {
    DealTokenInfo {
        loan_id: "7".to_owned(),
        kind: DealTokenKind::Debt,
    }
}

#[test]
fn deal_registered_params() {
    let loan = U256::from(u64::MAX) + U256::from(5u64);
    let log = deal_registered(loan, DEBT, CARGO, 10, 0);
    let ev = parse_deal_registered(&log).unwrap();
    assert_eq!(ev.event_name, "DealRegistered");
    assert_eq!(ev.contract_address, FACTORY);
    assert_eq!(keys(&ev.params), vec!["cargo", "debt", "loan_id"]);
    assert_eq!(ev.params["loan_id"], "18446744073709551620");
    assert_eq!(ev.params["debt"], DEBT.to_checksum(None));
    assert_eq!(ev.params["cargo"], CARGO.to_checksum(None));
    assert_eq!(decode_deal_registered(&log), Some((loan, DEBT, CARGO)));
}

#[test]
fn debt_synced_params() {
    let ev = parse_debt_synced(&debt_synced(U256::from(3u64), 100, 4, 11, 1)).unwrap();
    assert_eq!(ev.event_name, "DebtSynced");
    assert_eq!(
        keys(&ev.params),
        vec!["clawed", "loan_id", "minted", "previous", "target"]
    );
    assert_eq!(
        ev.params,
        json!({"loan_id": "3", "target": "100", "previous": "0", "minted": "100", "clawed": "4"})
    );
}

#[test]
fn cargo_synced_params() {
    let ev = parse_cargo_synced(&cargo_synced(U256::from(3u64), 50, 2, 11, 2)).unwrap();
    assert_eq!(ev.event_name, "CargoSynced");
    assert_eq!(
        keys(&ev.params),
        vec!["burned", "loan_id", "minted", "previous", "target"]
    );
    assert_eq!(ev.params["burned"], "2");
}

#[test]
fn noop_syncs_still_parse() {
    let loan = U256::from(3u64);
    let d = parse_debt_synced(&debt_synced(loan, 0, 0, 12, 0)).unwrap();
    assert_eq!(d.params["minted"], "0");
    assert_eq!(d.params["clawed"], "0");
    let c = parse_cargo_synced(&cargo_synced(loan, 0, 0, 12, 1)).unwrap();
    assert_eq!(c.params["burned"], "0");
}

#[test]
fn transfer_mint_has_null_from() {
    let log = transfer(DEBT, Address::ZERO, HOLDER, 250, 10, 3);
    let ev = parse_deal_token_transfer(&log, &debt_info()).unwrap();
    assert_eq!(ev.event_name, "DealTokenTransfer");
    assert_eq!(ev.contract_address, DEBT);
    assert_eq!(
        keys(&ev.params),
        vec!["amount", "from", "loan_id", "to", "token", "token_kind"]
    );
    assert_eq!(ev.params["from"], Value::Null);
    assert_eq!(ev.params["to"], HOLDER.to_checksum(None));
    assert_eq!(ev.params["amount"], "250");
    assert_eq!(ev.params["loan_id"], "7");
    assert_eq!(ev.params["token_kind"], "debt");
    assert_eq!(ev.params["token"], DEBT.to_checksum(None));
}

#[test]
fn transfer_burn_has_null_to_and_cargo_kind() {
    let info = DealTokenInfo {
        loan_id: "9".to_owned(),
        kind: DealTokenKind::Cargo,
    };
    let log = transfer(CARGO, HOLDER, Address::ZERO, 5, 10, 4);
    let ev = parse_deal_token_transfer(&log, &info).unwrap();
    assert_eq!(ev.params["to"], Value::Null);
    assert_eq!(ev.params["from"], HOLDER.to_checksum(None));
    assert_eq!(ev.params["token_kind"], "cargo");
}

#[test]
fn parsers_reject_foreign_events() {
    let loan = U256::from(1u64);
    let debt = debt_synced(loan, 1, 0, 1, 0);
    assert!(parse_cargo_synced(&debt).is_none());
    assert!(parse_deal_registered(&debt).is_none());
    let wire = wire_in(1, 1);
    assert!(parse_deal_registered(&wire).is_none());
    assert!(parse_debt_synced(&wire).is_none());
    assert!(parse_cargo_synced(&wire).is_none());
    assert!(parse_deal_token_transfer(&wire, &debt_info()).is_none());
    assert!(decode_deal_registered(&wire).is_none());
}
