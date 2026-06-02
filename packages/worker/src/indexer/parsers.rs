use alloy::{primitives::Address, rpc::types::Log, sol, sol_types::SolEvent};
use serde_json::json;

use shared::events::ContractLog;

use crate::indexer::loan_mapper::loan_status_name;

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
        // ClosureReason: 0=None, 1=ScheduledMaturity, 2=EarlyRepayment, 3=Default, 4=OtherWriteDown
        event LoanDrawn(uint256 indexed loanId, address indexed holder, string indexed metadataURI);
        event StatusUpdated(uint256 indexed loanId, uint8 indexed newStatus);
        event CCRUpdated(uint256 indexed loanId, uint32 newCcr);
        event LocationUpdated(uint256 indexed loanId, string indexed newLocation);
        event LoanDefaulted(uint256 indexed loanId, uint32 ccrBps);
        event LoanClosed(uint256 indexed loanId, uint8 indexed reason);
        struct RepaymentData {
            uint256 offtakerReceived;
            uint256 seniorPrincipalRepaid;
            uint256 seniorInterest;
            uint256 equityDistributed;
            uint256 mgmtFee;
            uint256 perfFee;
            uint256 oetAlloc;
        }
        event PaymentRecorded(uint256 indexed tokenId, uint256 indexed repaymentId, RepaymentData repaymentData);
        event LoanRolledOver(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp);
        event EconomicsAmended(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp);
    }
}

mod yield_minter {
    use alloy::sol;
    sol! {
        event YieldMinted(uint256 sPlUsdAmount, uint256 treasuryAmount);
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

/// Map a numeric ClosureReason ordinal to its string name.
/// Matches ILoanRegistry.sol: 0=None, 1=ScheduledMaturity, 2=EarlyRepayment, 3=Default, 4=OtherWriteDown
fn closure_reason_name(ordinal: u8) -> &'static str {
    match ordinal {
        0 => "None",
        1 => "ScheduledMaturity",
        2 => "EarlyRepayment",
        3 => "Default",
        4 => "OtherWriteDown",
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

pub fn parse_loan_drawn(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::LoanDrawn::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanDrawn".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "holder": decoded.holder.to_checksum(None),
            // metadataURI is string indexed — topic is keccak256 hash of the URI,
            // not the URI itself. The real URI is recovered via tokenURI(loanId).
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

pub fn parse_payment_recorded(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::PaymentRecorded::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;
    let rd = &decoded.repaymentData;

    Some(ContractLog {
        contract_address,
        event_name: "PaymentRecorded".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.tokenId.to_string(),
            "repayment_id": decoded.repaymentId.to_string(),
            "offtaker_received": rd.offtakerReceived.to_string(),
            "senior_principal_repaid": rd.seniorPrincipalRepaid.to_string(),
            "senior_interest": rd.seniorInterest.to_string(),
            "equity_distributed": rd.equityDistributed.to_string(),
            "mgmt_fee": rd.mgmtFee.to_string(),
            "perf_fee": rd.perfFee.to_string(),
            "oet_alloc": rd.oetAlloc.to_string(),
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
            "new_ccr": decoded.newCcr,
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
            // newLocation is string indexed — topic carries keccak256 hash, not the value.
            // The canonical string is recovered from mutableLoanData via block-pinned eth_call.
            "loan_id": decoded.loanId.to_string(),
        }),
    })
}

pub fn parse_loan_rolled_over(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::LoanRolledOver::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanRolledOver".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "new_rate": decoded.newRate,
            "new_maturity_timestamp": decoded.newMaturityTimestamp,
        }),
    })
}

pub fn parse_economics_amended(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::EconomicsAmended::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "EconomicsAmended".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "new_rate": decoded.newRate,
            "new_maturity_timestamp": decoded.newMaturityTimestamp,
        }),
    })
}

pub fn parse_yield_minted(log: &Log) -> Option<ContractLog> {
    let decoded = yield_minter::YieldMinted::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "YieldMinted".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "s_plusd_amount": decoded.sPlUsdAmount.to_string(),
            "treasury_amount": decoded.treasuryAmount.to_string(),
        }),
    })
}
