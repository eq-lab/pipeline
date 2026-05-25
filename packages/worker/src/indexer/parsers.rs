use alloy::{primitives::Address, rpc::types::Log, sol, sol_types::SolEvent};
use serde_json::json;

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

mod loan_registry {
    use alloy::sol;
    sol! {
        // LoanStatus:    0=Performing, 1=WatchList, 2=Default, 3=Closed
        // ClosureReason: 0=None, 1=ScheduledMaturity, 2=EarlyRepayment, 3=Default
        event LoanMinted(uint256 indexed loanId, address indexed holder, string indexed metadataURI, uint64 initialMaturity, string location);
        event StatusUpdated(uint256 indexed loanId, uint8 indexed newStatus);
        event CCRUpdated(uint256 indexed loanId, uint32 newCcrBps);
        event LocationUpdated(uint256 indexed loanId, string indexed newLocation);
        event LoanDefaulted(uint256 indexed loanId, uint32 ccrBps);
        event LoanClosed(uint256 indexed loanId, uint8 indexed reason);
        event Repayment(uint256 indexed tokenId, uint256 offtakerAmount, uint256 seniorPrincipal, uint256 seniorInterest, uint256 equityAmount);
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

/// Map a numeric LoanStatus ordinal to its string name.
/// Matches ILoanRegistry.sol: 0=Performing, 1=WatchList, 2=Default, 3=Closed
fn loan_status_name(ordinal: u8) -> &'static str {
    match ordinal {
        0 => "Performing",
        1 => "WatchList",
        2 => "Default",
        3 => "Closed",
        _ => "Unknown",
    }
}

/// Map a numeric ClosureReason ordinal to its string name.
/// Matches ILoanRegistry.sol: 0=None, 1=ScheduledMaturity, 2=EarlyRepayment, 3=Default
fn closure_reason_name(ordinal: u8) -> &'static str {
    match ordinal {
        0 => "None",
        1 => "ScheduledMaturity",
        2 => "EarlyRepayment",
        3 => "Default",
        _ => "Unknown",
    }
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
        params: json!({
            "user": decoded.user.to_checksum(None),
            "amount": decoded.amount.to_string(),
            "request_id": decoded.requestId.to_string(),
        }),
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
        params: json!({
            "withdrawer": decoded.withdrawer.to_checksum(None),
            "amount": decoded.amount.to_string(),
            "request_id": decoded.requestId.to_string(),
            "queued": decoded.queued.to_string(),
        }),
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
        params: json!({
            "user": decoded.user.to_checksum(None),
            "amount": decoded.amount.to_string(),
            "request_id": decoded.requestId.to_string(),
        }),
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
        params: json!({
            "sender": decoded.sender.to_checksum(None),
            "owner": decoded.owner.to_checksum(None),
            "assets": decoded.assets.to_string(),
            "shares": decoded.shares.to_string(),
        }),
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
        params: json!({
            "sender": decoded.sender.to_checksum(None),
            "receiver": decoded.receiver.to_checksum(None),
            "owner": decoded.owner.to_checksum(None),
            "assets": decoded.assets.to_string(),
            "shares": decoded.shares.to_string(),
        }),
    })
}

// --- LoanRegistry parsers ---

pub fn parse_loan_minted(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::LoanMinted::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanMinted".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "holder": decoded.holder.to_checksum(None),
            "initial_maturity": decoded.initialMaturity,
            "location": decoded.location,
        }),
    })
}

pub fn parse_loan_status_updated(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::StatusUpdated::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanStatusUpdated".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "status": loan_status_name(decoded.newStatus),
        }),
    })
}

pub fn parse_loan_ccr_updated(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::CCRUpdated::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanCCRUpdated".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "ccr_bps": decoded.newCcrBps,
        }),
    })
}

pub fn parse_loan_location_updated(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::LocationUpdated::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanLocationUpdated".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "location": decoded.newLocation,
        }),
    })
}

pub fn parse_loan_defaulted(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::LoanDefaulted::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanDefaulted".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "ccr_bps": decoded.ccrBps,
        }),
    })
}

pub fn parse_loan_closed(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::LoanClosed::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanClosed".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "closure_reason": closure_reason_name(decoded.reason),
        }),
    })
}

pub fn parse_loan_repayment(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::Repayment::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanRepayment".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.tokenId.to_string(),
            "offtaker_amount": decoded.offtakerAmount.to_string(),
            "senior_principal": decoded.seniorPrincipal.to_string(),
            "senior_interest": decoded.seniorInterest.to_string(),
            "equity_amount": decoded.equityAmount.to_string(),
        }),
    })
}
