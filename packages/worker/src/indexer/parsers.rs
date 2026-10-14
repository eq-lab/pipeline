use alloy::{primitives::Address, rpc::types::Log, sol, sol_types::SolEvent};
use serde_json::json;

use shared::events::ContractLog;

use crate::indexer::loan_mapper::{closure_reason_name, loan_status_name};

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
        event LoanDrawn(uint256 indexed loanId, string metadataURI);
        event StatusUpdated(uint256 indexed loanId, uint8 indexed newStatus);
        event Disbursed(uint256 indexed loanId, uint256 amount, uint256 outstanding);
        event Undisbursed(uint256 indexed loanId, uint256 amount, uint256 outstanding);
        struct RepaymentData {
            uint256 offtakerReceived;
            uint256 seniorPrincipalRepaid;
            uint256 seniorInterest;
            uint256 equityDistributed;
            uint256 mgmtFee;
            uint256 perfFee;
            uint256 oetAlloc;
        }
        event PaymentRecorded(uint256 indexed loanId, uint256 indexed repaymentId, RepaymentData repayment, uint256 outstanding);
        event PaymentUnrecorded(uint256 indexed loanId, uint256 indexed repaymentId, uint256 outstanding);
        event LoanDefaulted(uint256 indexed loanId, uint256 outstanding, uint256 moved);
        event LoanWrittenDown(uint256 indexed loanId, uint256 amount, uint256 outstanding, uint256 burned, uint256 unabsorbed);
        event InterestAdjusted(uint256 indexed loanId, int256 delta, bytes32 reasonHash);
        event LoanClosed(uint256 indexed loanId, uint8 indexed reason);
        event LoanRolledOver(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp);
        event EconomicsAmended(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp);
    }
}

mod minter {
    use alloy::sol;
    sol! {
        event WireInRecorded(uint256 indexed id, address indexed receiver, uint256 amount, uint64 valueDate, bytes32 refHash);
        event WireInAssigned(uint256 indexed id, address indexed receiver);
        event WireInReturned(uint256 indexed id, uint256 amount, bytes32 refHash);
        event CashDisbursed(uint256 indexed loanId, uint256 entryId, uint256 amount, uint64 valueDate, bytes32 refHash);
        event CashDisbursementReversed(uint256 indexed loanId, uint256 entryId, uint256 originalId, uint256 amount, bytes32 refHash);
        event CashRepaid(uint256 indexed loanId, uint256 repaymentId, uint256 saleId, uint256 cash, uint256 interestMinted, uint256 feeShares, uint64 valueDate, bytes32 refHash);
        event CashRepaymentReversed(uint256 indexed loanId, uint256 repaymentId, uint256 cash, bytes32 refHash);
        event WireOutRequested(uint256 indexed id, address indexed lp, uint256 amount);
        event WireOutSettled(uint256 indexed id, uint256 amount, uint64 valueDate, bytes32 refHash);
        event WireOutCancelled(uint256 indexed id);
        event RampOpened(uint256 indexed id, uint8 direction, uint256 amount, bytes32 refHash);
        event RampClosed(uint256 indexed id, uint256 received, uint256 loss, bytes32 refHash);
        event CashRecorded(uint8 indexed reason, uint256 entryId, int256 delta, uint64 valueDate, bytes32 refHash);
        event CashCorrected(uint256 indexed originalId, uint256 entryId, int256 delta, bytes32 reasonHash);
        event MintCorrected(uint256 amount, bytes32 refHash);
        event LossAbsorbed(uint256 requested, uint256 pulled);
    }
}

pub(crate) fn extract_log_meta(log: &Log) -> Option<(Address, u64, alloy::primitives::B256, u64)> {
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
            "metadata_uri": decoded.metadataURI,
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
            "outstanding": decoded.outstanding.to_string(),
            "moved": decoded.moved.to_string(),
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
    let rd = &decoded.repayment;

    Some(ContractLog {
        contract_address,
        event_name: "PaymentRecorded".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "repayment_id": decoded.repaymentId.to_string(),
            "offtaker_received": rd.offtakerReceived.to_string(),
            "senior_principal_repaid": rd.seniorPrincipalRepaid.to_string(),
            "senior_interest": rd.seniorInterest.to_string(),
            "equity_distributed": rd.equityDistributed.to_string(),
            "mgmt_fee": rd.mgmtFee.to_string(),
            "perf_fee": rd.perfFee.to_string(),
            "oet_alloc": rd.oetAlloc.to_string(),
            "outstanding": decoded.outstanding.to_string(),
        }),
    })
}

pub fn parse_payment_unrecorded(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::PaymentUnrecorded::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "PaymentUnrecorded".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "repayment_id": decoded.repaymentId.to_string(),
            "outstanding": decoded.outstanding.to_string(),
        }),
    })
}

pub fn parse_disbursed(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::Disbursed::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "Disbursed".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "amount": decoded.amount.to_string(),
            "outstanding": decoded.outstanding.to_string(),
        }),
    })
}

pub fn parse_undisbursed(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::Undisbursed::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "Undisbursed".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "amount": decoded.amount.to_string(),
            "outstanding": decoded.outstanding.to_string(),
        }),
    })
}

pub fn parse_loan_written_down(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::LoanWrittenDown::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "LoanWrittenDown".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "amount": decoded.amount.to_string(),
            "outstanding": decoded.outstanding.to_string(),
            "burned": decoded.burned.to_string(),
            "unabsorbed": decoded.unabsorbed.to_string(),
        }),
    })
}

pub fn parse_interest_adjusted(log: &Log) -> Option<ContractLog> {
    let decoded = loan_registry::InterestAdjusted::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "InterestAdjusted".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "loan_id": decoded.loanId.to_string(),
            "delta": decoded.delta.to_string(),
            "reason_hash": hex::encode(decoded.reasonHash.as_slice()),
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

// --- Minter parsers ---

pub fn parse_wire_in(log: &Log) -> Option<ContractLog> {
    let decoded = minter::WireInRecorded::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "WireIn".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "id": decoded.id.to_string(),
            "receiver": decoded.receiver.to_checksum(None),
            "amount": decoded.amount.to_string(),
            "value_date": decoded.valueDate.to_string(),
            "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    })
}

pub fn parse_wire_in_assigned(log: &Log) -> Option<ContractLog> {
    let decoded = minter::WireInAssigned::decode_log(log.as_ref(), true).ok()?;
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;

    Some(ContractLog {
        contract_address,
        event_name: "WireInAssigned".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "id": decoded.id.to_string(),
            "receiver": decoded.receiver.to_checksum(None),
        }),
    })
}

fn minter_log(log: &Log, event_name: &str, params: serde_json::Value) -> Option<ContractLog> {
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

pub fn cash_reason_name(ordinal: u8) -> &'static str {
    match ordinal {
        0 => "Disbursed",
        1 => "DisbursementReversed",
        2 => "Income",
        3 => "Expense",
        4 => "Correction",
        _ => "Unknown",
    }
}

pub fn ramp_direction_name(ordinal: u8) -> &'static str {
    match ordinal {
        0 => "UsdcToBank",
        1 => "BankToUsdc",
        _ => "Unknown",
    }
}

pub fn parse_wire_in_returned(log: &Log) -> Option<ContractLog> {
    let decoded = minter::WireInReturned::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "WireInReturned",
        json!({
                "id": decoded.id.to_string(),
                "amount": decoded.amount.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_cash_disbursed(log: &Log) -> Option<ContractLog> {
    let decoded = minter::CashDisbursed::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "CashDisbursed",
        json!({
                "loan_id": decoded.loanId.to_string(),
                "entry_id": decoded.entryId.to_string(),
                "amount": decoded.amount.to_string(),
                "value_date": decoded.valueDate.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_cash_disbursement_reversed(log: &Log) -> Option<ContractLog> {
    let decoded = minter::CashDisbursementReversed::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "CashDisbursementReversed",
        json!({
                "loan_id": decoded.loanId.to_string(),
                "entry_id": decoded.entryId.to_string(),
                "original_id": decoded.originalId.to_string(),
                "amount": decoded.amount.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_cash_repaid(log: &Log) -> Option<ContractLog> {
    let decoded = minter::CashRepaid::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "CashRepaid",
        json!({
                "loan_id": decoded.loanId.to_string(),
                "repayment_id": decoded.repaymentId.to_string(),
                "sale_id": decoded.saleId.to_string(),
                "cash": decoded.cash.to_string(),
                "interest_minted": decoded.interestMinted.to_string(),
                "fee_shares": decoded.feeShares.to_string(),
                "value_date": decoded.valueDate.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_cash_repayment_reversed(log: &Log) -> Option<ContractLog> {
    let decoded = minter::CashRepaymentReversed::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "CashRepaymentReversed",
        json!({
                "loan_id": decoded.loanId.to_string(),
                "repayment_id": decoded.repaymentId.to_string(),
                "cash": decoded.cash.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_wire_out_requested(log: &Log) -> Option<ContractLog> {
    let decoded = minter::WireOutRequested::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "WireOutRequested",
        json!({
                "id": decoded.id.to_string(),
                "lp": decoded.lp.to_checksum(None),
                "amount": decoded.amount.to_string(),
        }),
    )
}

pub fn parse_wire_out_settled(log: &Log) -> Option<ContractLog> {
    let decoded = minter::WireOutSettled::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "WireOutSettled",
        json!({
                "id": decoded.id.to_string(),
                "amount": decoded.amount.to_string(),
                "value_date": decoded.valueDate.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_wire_out_cancelled(log: &Log) -> Option<ContractLog> {
    let decoded = minter::WireOutCancelled::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "WireOutCancelled",
        json!({
                "id": decoded.id.to_string(),
        }),
    )
}

pub fn parse_ramp_opened(log: &Log) -> Option<ContractLog> {
    let decoded = minter::RampOpened::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "RampOpened",
        json!({
                "id": decoded.id.to_string(),
                "direction": ramp_direction_name(decoded.direction),
                "amount": decoded.amount.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_ramp_closed(log: &Log) -> Option<ContractLog> {
    let decoded = minter::RampClosed::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "RampClosed",
        json!({
                "id": decoded.id.to_string(),
                "received": decoded.received.to_string(),
                "loss": decoded.loss.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_cash_recorded(log: &Log) -> Option<ContractLog> {
    let decoded = minter::CashRecorded::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "CashRecorded",
        json!({
                "reason": cash_reason_name(decoded.reason),
                "entry_id": decoded.entryId.to_string(),
                "delta": decoded.delta.to_string(),
                "value_date": decoded.valueDate.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_cash_corrected(log: &Log) -> Option<ContractLog> {
    let decoded = minter::CashCorrected::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "CashCorrected",
        json!({
                "original_id": decoded.originalId.to_string(),
                "entry_id": decoded.entryId.to_string(),
                "delta": decoded.delta.to_string(),
                "reason_hash": hex::encode(decoded.reasonHash.as_slice()),
        }),
    )
}

pub fn parse_mint_corrected(log: &Log) -> Option<ContractLog> {
    let decoded = minter::MintCorrected::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "MintCorrected",
        json!({
                "amount": decoded.amount.to_string(),
                "ref_hash": hex::encode(decoded.refHash.as_slice()),
        }),
    )
}

pub fn parse_loss_absorbed(log: &Log) -> Option<ContractLog> {
    let decoded = minter::LossAbsorbed::decode_log(log.as_ref(), true).ok()?;
    minter_log(
        log,
        "LossAbsorbed",
        json!({
                "requested": decoded.requested.to_string(),
                "pulled": decoded.pulled.to_string(),
        }),
    )
}

pub fn parse_minter_event(log: &Log) -> Option<ContractLog> {
    parse_wire_in(log)
        .or_else(|| parse_wire_in_assigned(log))
        .or_else(|| parse_wire_in_returned(log))
        .or_else(|| parse_cash_disbursed(log))
        .or_else(|| parse_cash_disbursement_reversed(log))
        .or_else(|| parse_cash_repaid(log))
        .or_else(|| parse_cash_repayment_reversed(log))
        .or_else(|| parse_wire_out_requested(log))
        .or_else(|| parse_wire_out_settled(log))
        .or_else(|| parse_wire_out_cancelled(log))
        .or_else(|| parse_ramp_opened(log))
        .or_else(|| parse_ramp_closed(log))
        .or_else(|| parse_cash_recorded(log))
        .or_else(|| parse_cash_corrected(log))
        .or_else(|| parse_mint_corrected(log))
        .or_else(|| parse_loss_absorbed(log))
}
