use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, I256, U256},
    rpc::types::Log,
};

use alloy::sol_types::SolEvent;

use pipeline_worker::indexer::parsers::{
    parse_deposit_requested, parse_disbursed, parse_economics_amended, parse_interest_adjusted,
    parse_loan_closed, parse_loan_defaulted, parse_loan_drawn, parse_loan_rolled_over,
    parse_loan_status_updated, parse_loan_written_down, parse_payment_recorded,
    parse_payment_unrecorded, parse_request_claimed, parse_staking_deposit, parse_staking_withdraw,
    parse_undisbursed, parse_wire_in, parse_wire_in_assigned, parse_withdrawal_requested,
};

// Re-declare sol! events to get correct SIGNATURE_HASH constants for test log construction.
alloy::sol! {
    event DepositRequested(uint256 indexed requestId, address indexed user, uint256 amount);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event RequestClaimed(uint256 indexed requestId, address indexed user, uint256 amount);

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

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

    event WireInRecorded(uint256 indexed id, address indexed receiver, uint256 amount, uint64 valueDate, bytes32 refHash);
    event WireInAssigned(uint256 indexed id, address indexed receiver);
}

const CONTRACT: Address = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH: FixedBytes<32> =
    b256!("1111111111111111111111111111111111111111111111111111111111111111");

fn make_log(topics: Vec<FixedBytes<32>>, data: Vec<u8>, block_number: u64, log_index: u64) -> Log {
    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(topics, data.into()).unwrap(),
    };
    Log {
        inner,
        block_number: Some(block_number),
        transaction_hash: Some(TX_HASH),
        log_index: Some(log_index),
        ..Default::default()
    }
}

// --- DepositRequested tests ---

#[test]
fn deposit_requested_decodes() {
    let user = address!("1111111111111111111111111111111111111111");
    let request_id = U256::from(7u64);
    let amount = U256::from(1000u64);

    let topic1: FixedBytes<32> = request_id.into();
    let topic2: FixedBytes<32> = user.into_word();

    let mut data = [0u8; 32];
    data.copy_from_slice(&amount.to_be_bytes::<32>());

    let log = make_log(
        vec![DepositRequested::SIGNATURE_HASH, topic1, topic2],
        data.into(),
        101,
        0,
    );

    let ev = parse_deposit_requested(&log).expect("should decode");
    assert_eq!(ev.event_name, "DepositRequested");
    assert_eq!(ev.params["user"], user.to_checksum(None));
    assert_eq!(ev.params["amount"], amount.to_string());
    assert_eq!(ev.params["request_id"], request_id.to_string());
    assert_eq!(ev.block_number, 101);
}

// --- RequestClaimed tests ---

#[test]
fn request_claimed_decodes() {
    let user = address!("1111111111111111111111111111111111111111");
    let request_id = U256::from(7u64);
    let amount = U256::from(5000u64);

    let topic1: FixedBytes<32> = request_id.into();
    let topic2: FixedBytes<32> = user.into_word();

    let mut data = [0u8; 32];
    data.copy_from_slice(&amount.to_be_bytes::<32>());

    let log = make_log(
        vec![RequestClaimed::SIGNATURE_HASH, topic1, topic2],
        data.into(),
        102,
        1,
    );

    let ev = parse_request_claimed(&log).expect("should decode");
    assert_eq!(ev.event_name, "RequestClaimed");
    assert_eq!(ev.params["user"], user.to_checksum(None));
    assert_eq!(ev.params["amount"], amount.to_string());
    assert_eq!(ev.params["request_id"], request_id.to_string());
    assert_eq!(ev.block_number, 102);
}

// --- WithdrawalRequested tests ---

#[test]
fn withdrawal_requested_decodes() {
    let withdrawer = address!("1111111111111111111111111111111111111111");
    let request_id = U256::from(42u64);
    let amount = U256::from(5000u64);
    let queued = U256::from(10000u64);

    let topic1: FixedBytes<32> = withdrawer.into_word();
    let topic2: FixedBytes<32> = request_id.into();

    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&amount.to_be_bytes::<32>());
    data[32..].copy_from_slice(&queued.to_be_bytes::<32>());

    let log = make_log(
        vec![WithdrawalRequested::SIGNATURE_HASH, topic1, topic2],
        data.into(),
        200,
        3,
    );

    let ev = parse_withdrawal_requested(&log).expect("should decode");
    assert_eq!(ev.event_name, "WithdrawalRequested");
    assert_eq!(ev.params["withdrawer"], withdrawer.to_checksum(None));
    assert_eq!(ev.params["amount"], amount.to_string());
    assert_eq!(ev.params["request_id"], request_id.to_string());
    assert_eq!(ev.params["queued"], queued.to_string());
    assert_eq!(ev.block_number, 200);
    assert_eq!(ev.log_index, 3);
}

// --- Staking parser tests ---

#[test]
fn staking_deposit_decodes() {
    let sender = address!("1111111111111111111111111111111111111111");
    let owner = address!("2222222222222222222222222222222222222222");
    let assets = U256::from(1000u64);
    let shares = U256::from(950u64);

    let topic1: FixedBytes<32> = sender.into_word();
    let topic2: FixedBytes<32> = owner.into_word();

    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&assets.to_be_bytes::<32>());
    data[32..].copy_from_slice(&shares.to_be_bytes::<32>());

    let log = make_log(
        vec![Deposit::SIGNATURE_HASH, topic1, topic2],
        data.into(),
        300,
        0,
    );

    let ev = parse_staking_deposit(&log).expect("should decode StakingDeposit");
    assert_eq!(ev.event_name, "StakingDeposit");
    assert_eq!(ev.params["sender"], sender.to_checksum(None));
    assert_eq!(ev.params["owner"], owner.to_checksum(None));
    assert_eq!(ev.params["assets"], assets.to_string());
    assert_eq!(ev.params["shares"], shares.to_string());
    assert_eq!(ev.block_number, 300);
}

#[test]
fn staking_withdraw_decodes() {
    let sender = address!("1111111111111111111111111111111111111111");
    let receiver = address!("3333333333333333333333333333333333333333");
    let owner = address!("2222222222222222222222222222222222222222");
    let assets = U256::from(500u64);
    let shares = U256::from(480u64);

    let topic1: FixedBytes<32> = sender.into_word();
    let topic2: FixedBytes<32> = receiver.into_word();
    let topic3: FixedBytes<32> = owner.into_word();

    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&assets.to_be_bytes::<32>());
    data[32..].copy_from_slice(&shares.to_be_bytes::<32>());

    let log = make_log(
        vec![Withdraw::SIGNATURE_HASH, topic1, topic2, topic3],
        data.into(),
        301,
        1,
    );

    let ev = parse_staking_withdraw(&log).expect("should decode StakingWithdrawal");
    assert_eq!(ev.event_name, "StakingWithdrawal");
    assert_eq!(ev.params["sender"], sender.to_checksum(None));
    assert_eq!(ev.params["receiver"], receiver.to_checksum(None));
    assert_eq!(ev.params["owner"], owner.to_checksum(None));
    assert_eq!(ev.params["assets"], assets.to_string());
    assert_eq!(ev.params["shares"], shares.to_string());
    assert_eq!(ev.block_number, 301);
}

// --- LoanRegistry parser tests ---

#[test]
fn loan_drawn_decodes() {
    let loan_id = U256::from(1u64);
    let uri = "ipfs://QmLoanDrawn";

    let topic1: FixedBytes<32> = loan_id.into();
    let data = LoanDrawn {
        loanId: loan_id,
        metadataURI: uri.to_owned(),
    }
    .encode_data();

    let log = make_log(vec![LoanDrawn::SIGNATURE_HASH, topic1], data, 500, 0);

    let ev = parse_loan_drawn(&log).expect("should decode LoanDrawn");
    assert_eq!(ev.event_name, "LoanDrawn");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["metadata_uri"], uri);
    assert!(ev.params.get("holder").is_none());
    assert_eq!(ev.block_number, 500);
}

fn loan_closed_log(loan_id: U256, reason: u8, block_number: u64, log_index: u64) -> Log {
    let topic1: FixedBytes<32> = loan_id.into();
    let mut topic2 = [0u8; 32];
    topic2[31] = reason;

    make_log(
        vec![LoanClosed::SIGNATURE_HASH, topic1, FixedBytes::from(topic2)],
        vec![],
        block_number,
        log_index,
    )
}

#[test]
fn loan_closed_decodes() {
    let loan_id = U256::from(9u64);
    let log = loan_closed_log(loan_id, 0, 503, 3); // None

    let ev = parse_loan_closed(&log).expect("should decode LoanClosed");
    assert_eq!(ev.event_name, "LoanClosed");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["closure_reason"], "None");
}

#[test]
fn loan_closed_cancelled_decodes() {
    let loan_id = U256::from(10u64);
    let log = loan_closed_log(loan_id, 3, 504, 4); // Cancelled (post-rework)

    let ev = parse_loan_closed(&log).expect("should decode LoanClosed Cancelled");
    assert_eq!(ev.params["closure_reason"], "Cancelled");
}

#[test]
fn loan_closed_default_decodes() {
    let loan_id = U256::from(11u64);
    let log = loan_closed_log(loan_id, 4, 505, 5); // Default (post-rework)

    let ev = parse_loan_closed(&log).expect("should decode LoanClosed Default");
    assert_eq!(ev.params["closure_reason"], "Default");
}

#[test]
fn payment_recorded_decodes() {
    let loan_id = U256::from(42u64);
    let repayment_id = U256::from(0u64);
    let offtaker_received = U256::from(1000u64);
    let senior_principal_repaid = U256::from(200u64);
    let senior_interest = U256::from(10u64);
    let equity_distributed = U256::from(50u64);
    let mgmt_fee = U256::from(3u64);
    let perf_fee = U256::from(4u64);
    let oet_alloc = U256::from(5u64);
    let outstanding = U256::from(800u64);

    let topic1: FixedBytes<32> = loan_id.into();
    let topic2: FixedBytes<32> = repayment_id.into();

    let data = PaymentRecorded {
        loanId: loan_id,
        repaymentId: repayment_id,
        repayment: RepaymentData {
            offtakerReceived: offtaker_received,
            seniorPrincipalRepaid: senior_principal_repaid,
            seniorInterest: senior_interest,
            equityDistributed: equity_distributed,
            mgmtFee: mgmt_fee,
            perfFee: perf_fee,
            oetAlloc: oet_alloc,
        },
        outstanding,
    }
    .encode_data();

    let log = make_log(
        vec![PaymentRecorded::SIGNATURE_HASH, topic1, topic2],
        data,
        505,
        5,
    );

    let ev = parse_payment_recorded(&log).expect("should decode PaymentRecorded");
    assert_eq!(ev.event_name, "PaymentRecorded");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["repayment_id"], repayment_id.to_string());
    assert_eq!(
        ev.params["offtaker_received"],
        offtaker_received.to_string()
    );
    assert_eq!(
        ev.params["senior_principal_repaid"],
        senior_principal_repaid.to_string()
    );
    assert_eq!(ev.params["senior_interest"], senior_interest.to_string());
    assert_eq!(
        ev.params["equity_distributed"],
        equity_distributed.to_string()
    );
    assert_eq!(ev.params["mgmt_fee"], mgmt_fee.to_string());
    assert_eq!(ev.params["perf_fee"], perf_fee.to_string());
    assert_eq!(ev.params["oet_alloc"], oet_alloc.to_string());
    assert_eq!(ev.params["outstanding"], outstanding.to_string());
    assert_eq!(ev.block_number, 505);
}

#[test]
fn payment_unrecorded_decodes() {
    let loan_id = U256::from(42u64);
    let repayment_id = U256::from(1u64);
    let outstanding = U256::from(900u64);

    let topic1: FixedBytes<32> = loan_id.into();
    let topic2: FixedBytes<32> = repayment_id.into();
    let data = PaymentUnrecorded {
        loanId: loan_id,
        repaymentId: repayment_id,
        outstanding,
    }
    .encode_data();

    let log = make_log(
        vec![PaymentUnrecorded::SIGNATURE_HASH, topic1, topic2],
        data,
        506,
        6,
    );

    let ev = parse_payment_unrecorded(&log).expect("should decode PaymentUnrecorded");
    assert_eq!(ev.event_name, "PaymentUnrecorded");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["repayment_id"], repayment_id.to_string());
    assert_eq!(ev.params["outstanding"], outstanding.to_string());
}

#[test]
fn payment_unrecorded_not_claimed_by_payment_recorded_parser() {
    let loan_id = U256::from(42u64);
    let repayment_id = U256::from(1u64);
    let topic1: FixedBytes<32> = loan_id.into();
    let topic2: FixedBytes<32> = repayment_id.into();
    let data = PaymentUnrecorded {
        loanId: loan_id,
        repaymentId: repayment_id,
        outstanding: U256::from(1u64),
    }
    .encode_data();
    let log = make_log(
        vec![PaymentUnrecorded::SIGNATURE_HASH, topic1, topic2],
        data,
        507,
        7,
    );

    assert!(parse_payment_recorded(&log).is_none());
    assert!(parse_payment_unrecorded(&log).is_some());
}

#[test]
fn payment_recorded_not_claimed_by_payment_unrecorded_parser() {
    let loan_id = U256::from(42u64);
    let repayment_id = U256::from(1u64);
    let topic1: FixedBytes<32> = loan_id.into();
    let topic2: FixedBytes<32> = repayment_id.into();
    let data = PaymentRecorded {
        loanId: loan_id,
        repaymentId: repayment_id,
        repayment: RepaymentData {
            offtakerReceived: U256::ZERO,
            seniorPrincipalRepaid: U256::ZERO,
            seniorInterest: U256::ZERO,
            equityDistributed: U256::ZERO,
            mgmtFee: U256::ZERO,
            perfFee: U256::ZERO,
            oetAlloc: U256::ZERO,
        },
        outstanding: U256::ZERO,
    }
    .encode_data();
    let log = make_log(
        vec![PaymentRecorded::SIGNATURE_HASH, topic1, topic2],
        data,
        508,
        8,
    );

    assert!(parse_payment_unrecorded(&log).is_none());
    assert!(parse_payment_recorded(&log).is_some());
}

#[test]
fn loan_defaulted_decodes() {
    let loan_id = U256::from(11u64);
    let outstanding = U256::from(42_000u64);
    let moved = U256::from(1_000u64);

    let topic1: FixedBytes<32> = loan_id.into();
    let data = LoanDefaulted {
        loanId: loan_id,
        outstanding,
        moved,
    }
    .encode_data();

    let log = make_log(vec![LoanDefaulted::SIGNATURE_HASH, topic1], data, 506, 6);

    let ev = parse_loan_defaulted(&log).expect("should decode LoanDefaulted");
    assert_eq!(ev.event_name, "LoanDefaulted");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["outstanding"], outstanding.to_string());
    assert_eq!(ev.params["moved"], moved.to_string());
    assert!(ev.params.get("ccr_bps").is_none());
    assert_eq!(ev.block_number, 506);
}

fn loan_status_updated_log(loan_id: U256, new_status: u8, block_number: u64) -> Log {
    let topic1: FixedBytes<32> = loan_id.into();
    let mut topic2 = [0u8; 32];
    topic2[31] = new_status;

    make_log(
        vec![
            StatusUpdated::SIGNATURE_HASH,
            topic1,
            FixedBytes::from(topic2),
        ],
        vec![],
        block_number,
        0,
    )
}

#[test]
fn loan_status_updated_decodes() {
    let loan_id = U256::from(5u64);
    let log = loan_status_updated_log(loan_id, 2, 600); // WatchList (post-rework)

    let ev = parse_loan_status_updated(&log).expect("should decode LoanStatusUpdated");
    assert_eq!(ev.event_name, "LoanStatusUpdated");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["status"], "WatchList");
    assert_eq!(ev.block_number, 600);
}

#[test]
fn loan_status_updated_uses_canonical_ordinals() {
    let cases: [(u8, &str); 5] = [
        (0, "Approved"),
        (1, "Performing"),
        (2, "WatchList"),
        (3, "Default"),
        (4, "Closed"),
    ];
    for (raw, expected) in cases {
        let log = loan_status_updated_log(U256::from(50u64 + raw as u64), raw, 700 + raw as u64);
        let ev = parse_loan_status_updated(&log).expect("should decode LoanStatusUpdated");
        assert_eq!(ev.params["status"], expected);
    }
}

#[test]
fn loan_closed_every_canonical_closure_reason_ordinal() {
    let cases: [(u8, &str); 6] = [
        (0, "None"),
        (1, "ScheduledMaturity"),
        (2, "EarlyRepayment"),
        (3, "Cancelled"),
        (4, "Default"),
        (5, "OtherWriteDown"),
    ];
    for (raw, expected) in cases {
        let log = loan_closed_log(U256::from(60u64 + raw as u64), raw, 800 + raw as u64, 0);
        let ev = parse_loan_closed(&log).expect("should decode LoanClosed");
        assert_eq!(ev.params["closure_reason"], expected);
    }
}

#[test]
fn disbursed_decodes() {
    let loan_id = U256::from(20u64);
    let amount = U256::from(100_000u64);
    let outstanding = U256::from(100_000u64);

    let topic1: FixedBytes<32> = loan_id.into();
    let data = Disbursed {
        loanId: loan_id,
        amount,
        outstanding,
    }
    .encode_data();
    let log = make_log(vec![Disbursed::SIGNATURE_HASH, topic1], data, 610, 0);

    let ev = parse_disbursed(&log).expect("should decode Disbursed");
    assert_eq!(ev.event_name, "Disbursed");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["amount"], amount.to_string());
    assert_eq!(ev.params["outstanding"], outstanding.to_string());
}

#[test]
fn disbursed_not_claimed_by_undisbursed_parser() {
    let loan_id = U256::from(20u64);
    let data = Disbursed {
        loanId: loan_id,
        amount: U256::from(1u64),
        outstanding: U256::from(1u64),
    }
    .encode_data();
    let topic1: FixedBytes<32> = loan_id.into();
    let log = make_log(vec![Disbursed::SIGNATURE_HASH, topic1], data, 611, 0);

    assert!(parse_undisbursed(&log).is_none());
    assert!(parse_disbursed(&log).is_some());
}

#[test]
fn undisbursed_decodes() {
    let loan_id = U256::from(21u64);
    let amount = U256::from(50_000u64);
    let outstanding = U256::from(50_000u64);

    let topic1: FixedBytes<32> = loan_id.into();
    let data = Undisbursed {
        loanId: loan_id,
        amount,
        outstanding,
    }
    .encode_data();
    let log = make_log(vec![Undisbursed::SIGNATURE_HASH, topic1], data, 612, 0);

    let ev = parse_undisbursed(&log).expect("should decode Undisbursed");
    assert_eq!(ev.event_name, "Undisbursed");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["amount"], amount.to_string());
    assert_eq!(ev.params["outstanding"], outstanding.to_string());
}

#[test]
fn loan_written_down_decodes() {
    let loan_id = U256::from(22u64);
    let amount = U256::MAX;
    let outstanding = U256::MAX;
    let burned = U256::MAX;
    let unabsorbed = U256::MAX;

    let topic1: FixedBytes<32> = loan_id.into();
    let data = LoanWrittenDown {
        loanId: loan_id,
        amount,
        outstanding,
        burned,
        unabsorbed,
    }
    .encode_data();
    let log = make_log(vec![LoanWrittenDown::SIGNATURE_HASH, topic1], data, 613, 0);

    let ev = parse_loan_written_down(&log).expect("should decode LoanWrittenDown");
    assert_eq!(ev.event_name, "LoanWrittenDown");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["amount"], amount.to_string());
    assert_eq!(ev.params["outstanding"], outstanding.to_string());
    assert_eq!(ev.params["burned"], burned.to_string());
    assert_eq!(ev.params["unabsorbed"], unabsorbed.to_string());
}

#[test]
fn interest_adjusted_decodes_negative_delta() {
    let loan_id = U256::from(23u64);
    let delta = I256::try_from(-250_000i64).unwrap();
    let reason_hash = b256!("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");

    let topic1: FixedBytes<32> = loan_id.into();
    let data = InterestAdjusted {
        loanId: loan_id,
        delta,
        reasonHash: reason_hash,
    }
    .encode_data();
    let log = make_log(vec![InterestAdjusted::SIGNATURE_HASH, topic1], data, 614, 0);

    let ev = parse_interest_adjusted(&log).expect("should decode InterestAdjusted");
    assert_eq!(ev.event_name, "InterestAdjusted");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["delta"], "-250000");
}

#[test]
fn interest_adjusted_reason_hash_is_lowercase_hex_without_0x() {
    let loan_id = U256::from(24u64);
    let reason_hash = b256!("abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd");

    let topic1: FixedBytes<32> = loan_id.into();
    let data = InterestAdjusted {
        loanId: loan_id,
        delta: I256::ZERO,
        reasonHash: reason_hash,
    }
    .encode_data();
    let log = make_log(vec![InterestAdjusted::SIGNATURE_HASH, topic1], data, 615, 0);

    let ev = parse_interest_adjusted(&log).expect("should decode InterestAdjusted");
    let rh = ev.params["reason_hash"].as_str().unwrap();
    assert!(
        !rh.starts_with("0x"),
        "reason_hash must not have a 0x prefix"
    );
    assert_eq!(rh.len(), 64);
    assert_eq!(rh, rh.to_lowercase());
}

#[test]
fn loan_rolled_over_decodes() {
    let loan_id = U256::from(12u64);
    let new_rate: u32 = 50_000; // 5% in 1e6 units
    let new_maturity: u64 = 1_800_000_000u64;

    let topic1: FixedBytes<32> = loan_id.into();

    let mut data = [0u8; 64];
    data[28..32].copy_from_slice(&new_rate.to_be_bytes());
    data[56..64].copy_from_slice(&new_maturity.to_be_bytes());

    let log = make_log(
        vec![LoanRolledOver::SIGNATURE_HASH, topic1],
        data.into(),
        603,
        3,
    );

    let ev = parse_loan_rolled_over(&log).expect("should decode LoanRolledOver");
    assert_eq!(ev.event_name, "LoanRolledOver");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["new_rate"], new_rate);
    assert_eq!(ev.params["new_maturity_timestamp"], new_maturity);
    assert_eq!(ev.block_number, 603);
}

#[test]
fn economics_amended_decodes() {
    let loan_id = U256::from(15u64);
    let new_rate: u32 = 75_000; // 7.5% in 1e6 units
    let new_maturity: u64 = 1_900_000_000u64;

    let topic1: FixedBytes<32> = loan_id.into();

    let mut data = [0u8; 64];
    data[28..32].copy_from_slice(&new_rate.to_be_bytes());
    data[56..64].copy_from_slice(&new_maturity.to_be_bytes());

    let log = make_log(
        vec![EconomicsAmended::SIGNATURE_HASH, topic1],
        data.into(),
        604,
        4,
    );

    let ev = parse_economics_amended(&log).expect("should decode EconomicsAmended");
    assert_eq!(ev.event_name, "EconomicsAmended");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["new_rate"], new_rate);
    assert_eq!(ev.params["new_maturity_timestamp"], new_maturity);
    assert_eq!(ev.block_number, 604);
}

// --- Minter parser tests ---

#[test]
fn wire_in_decodes() {
    let id = U256::from(7u64);
    let receiver = address!("4444444444444444444444444444444444444444");
    let amount = U256::from(250_000u64);
    let value_date: u64 = 1_900_000_000;
    let ref_hash = b256!("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");

    let topic1: FixedBytes<32> = id.into();
    let topic2: FixedBytes<32> = receiver.into_word();
    let data = WireInRecorded {
        id,
        receiver,
        amount,
        valueDate: value_date,
        refHash: ref_hash,
    }
    .encode_data();

    let log = make_log(
        vec![WireInRecorded::SIGNATURE_HASH, topic1, topic2],
        data,
        700,
        0,
    );

    let ev = parse_wire_in(&log).expect("should decode WireInRecorded");
    assert_eq!(
        ev.event_name, "WireIn",
        "stored event_name must be WireIn, not WireInRecorded"
    );
    assert_eq!(ev.params["id"], id.to_string());
    assert_eq!(ev.params["receiver"], receiver.to_checksum(None));
    assert_eq!(ev.params["amount"], amount.to_string());
    assert_eq!(ev.params["value_date"], value_date.to_string());
    let rh = ev.params["ref_hash"].as_str().unwrap();
    assert!(!rh.starts_with("0x"));
    assert_eq!(rh.len(), 64);
}

#[test]
fn wire_in_assigned_decodes() {
    let id = U256::from(8u64);
    let receiver = address!("5555555555555555555555555555555555555555");

    let topic1: FixedBytes<32> = id.into();
    let topic2: FixedBytes<32> = receiver.into_word();

    let log = make_log(
        vec![WireInAssigned::SIGNATURE_HASH, topic1, topic2],
        vec![],
        701,
        1,
    );

    let ev = parse_wire_in_assigned(&log).expect("should decode WireInAssigned");
    assert_eq!(ev.event_name, "WireInAssigned");
    assert_eq!(ev.params["id"], id.to_string());
    assert_eq!(ev.params["receiver"], receiver.to_checksum(None));
}
