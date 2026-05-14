use alloy::{primitives::Address, rpc::types::Log, sol, sol_types::SolEvent};

use shared::events::ContractLog;

sol! {
    event DepositRequested(uint256 indexed requestId, address indexed user, uint256 amount);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event RequestClaimed(uint256 indexed requestId, address indexed user, uint256 amount);
}

mod erc4626 {
    use alloy::sol;
    sol! {
        event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
        event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    }
}

fn extract_log_meta(log: &Log) -> Option<(Address, u64, alloy::primitives::B256, u64)> {
    Some((
        log.address(),
        log.block_number?,
        log.transaction_hash?,
        log.log_index?,
    ))
}

pub fn parse_deposit_requested(log: &Log) -> Option<ContractLog> {
    let decoded = DepositRequested::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "DepositRequested".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.user),
        receiver: None,
        amount: Some(decoded.amount),
        request_id: Some(decoded.requestId),
        cumulative: None,
        assets: None,
        shares: None,
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
        assets: None,
        shares: None,
    })
}

pub fn parse_request_claimed(log: &Log) -> Option<ContractLog> {
    let decoded = RequestClaimed::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "RequestClaimed".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.user),
        receiver: None,
        amount: Some(decoded.amount),
        request_id: Some(decoded.requestId),
        cumulative: None,
        assets: None,
        shares: None,
    })
}

pub fn parse_staking_deposit(log: &Log) -> Option<ContractLog> {
    let decoded = erc4626::Deposit::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "StakingDeposit".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.owner),
        receiver: None,
        amount: Some(decoded.assets),
        request_id: None,
        cumulative: None,
        assets: Some(decoded.assets),
        shares: Some(decoded.shares),
    })
}

pub fn parse_staking_withdraw(log: &Log) -> Option<ContractLog> {
    let decoded = erc4626::Withdraw::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "StakingWithdrawal".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        sender: Some(decoded.owner),
        receiver: Some(decoded.receiver),
        amount: Some(decoded.assets),
        request_id: None,
        cumulative: None,
        assets: Some(decoded.assets),
        shares: Some(decoded.shares),
    })
}
