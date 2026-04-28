use alloy::{primitives::Address, rpc::types::Log, sol, sol_types::SolEvent};

use shared::events::ContractLog;

sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event WithdrawalClaimed(address indexed withdrawer, uint256 indexed requestId, uint256 amount);
    event ClaimableIncreased(uint256 delta, uint256 newClaimable);
}

fn extract_log_meta(log: &Log) -> Option<(Address, u64, alloy::primitives::B256, u64)> {
    Some((
        log.address(),
        log.block_number?,
        log.transaction_hash?,
        log.log_index?,
    ))
}

pub fn parse_transfer(log: &Log, approved: &[Address]) -> Option<ContractLog> {
    let decoded = Transfer::decode_log(log.as_ref(), true).ok()?;

    if decoded.value.is_zero() {
        return None;
    }

    if !approved.contains(&decoded.from) && !approved.contains(&decoded.to) {
        return None;
    }

    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "Transfer".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.from),
        receiver: Some(decoded.to),
        amount: Some(decoded.value),
        request_id: None,
        cumulative: None,
    })
}

pub fn parse_withdrawal_requested(log: &Log) -> Option<ContractLog> {
    let decoded = WithdrawalRequested::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "WithdrawalRequested".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.withdrawer),
        receiver: None,
        amount: Some(decoded.amount),
        request_id: Some(decoded.requestId),
        cumulative: Some(decoded.queued),
    })
}

pub fn parse_withdrawal_claimed(log: &Log) -> Option<ContractLog> {
    let decoded = WithdrawalClaimed::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "WithdrawalClaimed".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.withdrawer),
        receiver: None,
        amount: Some(decoded.amount),
        request_id: Some(decoded.requestId),
        cumulative: None,
    })
}

pub fn parse_claimable_increased(log: &Log) -> Option<ContractLog> {
    let decoded = ClaimableIncreased::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "ClaimableIncreased".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: None,
        receiver: None,
        amount: Some(decoded.delta),
        request_id: None,
        cumulative: Some(decoded.newClaimable),
    })
}
