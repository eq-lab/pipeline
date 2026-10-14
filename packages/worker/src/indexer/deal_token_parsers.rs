// spec: docs/references/backend.md#evm-dealtokenfactory-1485
use alloy::{
    primitives::{Address, U256},
    rpc::types::Log,
    sol,
    sol_types::SolEvent,
};
use serde_json::{json, Value};

use shared::events::ContractLog;

use super::deal_tokens::DealTokenInfo;
use super::parsers::extract_log_meta;

mod deal_token_factory {
    use alloy::sol;
    sol! {
        event DealRegistered(uint256 indexed loanId, address debt, address cargo);
        event DebtSynced(uint256 indexed loanId, uint256 target, uint256 previous, uint256 minted, uint256 clawed);
        event CargoSynced(uint256 indexed loanId, uint256 target, uint256 previous, uint256 minted, uint256 burned);
    }
}

sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
}

pub fn decode_deal_registered(log: &Log) -> Option<(U256, Address, Address)> {
    let decoded = deal_token_factory::DealRegistered::decode_log(log.as_ref(), true).ok()?;
    Some((decoded.loanId, decoded.debt, decoded.cargo))
}

fn contract_log(log: &Log, event_name: &str, params: Value) -> Option<ContractLog> {
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;
    Some(ContractLog {
        contract_address,
        event_name: event_name.to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params,
    })
}

pub fn parse_deal_registered(log: &Log) -> Option<ContractLog> {
    let (loan_id, debt, cargo) = decode_deal_registered(log)?;
    contract_log(
        log,
        "DealRegistered",
        json!({
            "loan_id": loan_id.to_string(),
            "debt": debt.to_checksum(None),
            "cargo": cargo.to_checksum(None),
        }),
    )
}

pub fn parse_debt_synced(log: &Log) -> Option<ContractLog> {
    let d = deal_token_factory::DebtSynced::decode_log(log.as_ref(), true).ok()?;
    contract_log(
        log,
        "DebtSynced",
        json!({
            "loan_id": d.loanId.to_string(),
            "target": d.target.to_string(),
            "previous": d.previous.to_string(),
            "minted": d.minted.to_string(),
            "clawed": d.clawed.to_string(),
        }),
    )
}

pub fn parse_cargo_synced(log: &Log) -> Option<ContractLog> {
    let d = deal_token_factory::CargoSynced::decode_log(log.as_ref(), true).ok()?;
    contract_log(
        log,
        "CargoSynced",
        json!({
            "loan_id": d.loanId.to_string(),
            "target": d.target.to_string(),
            "previous": d.previous.to_string(),
            "minted": d.minted.to_string(),
            "burned": d.burned.to_string(),
        }),
    )
}

fn side(addr: Address) -> Value {
    if addr == Address::ZERO {
        Value::Null
    } else {
        Value::String(addr.to_checksum(None))
    }
}

pub fn parse_deal_token_transfer(log: &Log, info: &DealTokenInfo) -> Option<ContractLog> {
    let d = Transfer::decode_log(log.as_ref(), true).ok()?;
    contract_log(
        log,
        "DealTokenTransfer",
        json!({
            "loan_id": info.loan_id,
            "token_kind": info.kind.as_str(),
            "token": log.address().to_checksum(None),
            "from": side(d.from),
            "to": side(d.to),
            "amount": d.value.to_string(),
        }),
    )
}
