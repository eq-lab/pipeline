// spec: docs/references/backend.md#splusd-share-transfer-tracking-sharetransfer
mod deal_token_support;

use alloy::{
    primitives::{address, Address, U256},
    sol,
    sol_types::SolEvent,
};
use deal_token_support::{make_log, transfer, SPLUSD};
use pipeline_worker::indexer::parsers::parse_share_transfer;

sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
}

const VAULT: Address = SPLUSD;
const ALICE: Address = address!("a11ce00000000000000000000000000000000001");
const BOB: Address = address!("b0b0000000000000000000000000000000000002");
const OTHER: Address = address!("0700000000000000000000000000000000000003");

#[test]
fn peer_transfer_from_the_vault_decodes_to_share_transfer() {
    let log = transfer(VAULT, ALICE, BOB, 400, 77, 5);
    let ev = parse_share_transfer(&log, &[VAULT]).expect("decodes");

    assert_eq!(ev.event_name, "ShareTransfer");
    assert_eq!(ev.contract_address, VAULT);
    assert_eq!(ev.block_number, 77);
    assert_eq!(ev.log_index, 5);
    assert_eq!(ev.block_timestamp, 0);
    assert_eq!(ev.params["from"], ALICE.to_checksum(None));
    assert_eq!(ev.params["to"], BOB.to_checksum(None));
    assert_eq!(ev.params["amount"], "400");

    let mut keys: Vec<_> = ev.params.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["amount", "from", "to"]);
}

#[test]
fn mint_and_burn_are_skipped() {
    let mint = transfer(VAULT, Address::ZERO, ALICE, 10, 1, 0);
    let burn = transfer(VAULT, ALICE, Address::ZERO, 10, 1, 1);
    assert!(parse_share_transfer(&mint, &[VAULT]).is_none());
    assert!(parse_share_transfer(&burn, &[VAULT]).is_none());
}

#[test]
fn transfer_from_another_emitter_is_ignored() {
    let log = transfer(OTHER, ALICE, BOB, 10, 1, 0);
    assert!(parse_share_transfer(&log, &[VAULT]).is_none());
    assert!(parse_share_transfer(&transfer(VAULT, ALICE, BOB, 10, 1, 0), &[]).is_none());
}

#[test]
fn non_transfer_vault_log_is_ignored() {
    let ev = Deposit {
        sender: ALICE,
        owner: ALICE,
        assets: U256::from(1u64),
        shares: U256::from(1u64),
    };
    let log = make_log(VAULT, ev.encode_log_data(), 1, 0);
    assert!(parse_share_transfer(&log, &[VAULT]).is_none());
}

#[test]
fn self_transfer_decodes_with_equal_sides() {
    let log = transfer(VAULT, ALICE, ALICE, 5, 1, 0);
    let ev = parse_share_transfer(&log, &[VAULT]).expect("decodes");
    assert_eq!(ev.params["from"], ev.params["to"]);
}

#[test]
fn amount_above_u128_keeps_its_full_decimal_string() {
    let value = U256::from(u128::MAX) + U256::from(1u64);
    let ev = Transfer {
        from: ALICE,
        to: BOB,
        value,
    };
    let log = make_log(VAULT, ev.encode_log_data(), 1, 0);
    let parsed = parse_share_transfer(&log, &[VAULT]).expect("decodes");
    assert_eq!(parsed.params["amount"], value.to_string());
}

#[test]
fn zero_value_transfer_is_skipped() {
    let log = transfer(VAULT, ALICE, BOB, 0, 1, 0);
    assert!(parse_share_transfer(&log, &[VAULT]).is_none());
}
