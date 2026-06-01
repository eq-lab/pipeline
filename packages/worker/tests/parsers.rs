use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, U256},
    rpc::types::Log,
};

use alloy::sol_types::SolEvent;

use pipeline_worker::indexer::parsers::{
    parse_deposit_requested, parse_loan_closed, parse_loan_defaulted, parse_loan_drawn,
    parse_payment_recorded, parse_request_claimed, parse_staking_deposit, parse_staking_withdraw,
    parse_withdrawal_requested, parse_yield_minted,
};

// Re-declare sol! events to get correct SIGNATURE_HASH constants for test log construction.
alloy::sol! {
    event DepositRequested(uint256 indexed requestId, address indexed user, uint256 amount);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event RequestClaimed(uint256 indexed requestId, address indexed user, uint256 amount);

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    event LoanDrawn(uint256 indexed loanId, address indexed holder, string indexed metadataURI);
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

    event YieldMinted(uint256 sPlUsdAmount, uint256 treasuryAmount);
}

const CONTRACT: Address = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH: FixedBytes<32> =
    b256!("1111111111111111111111111111111111111111111111111111111111111111");

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

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![DepositRequested::SIGNATURE_HASH, topic1, topic2],
            data.into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(101),
        transaction_hash: Some(TX_HASH),
        log_index: Some(0),
        ..Default::default()
    };

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

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![RequestClaimed::SIGNATURE_HASH, topic1, topic2],
            data.into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(102),
        transaction_hash: Some(TX_HASH),
        log_index: Some(1),
        ..Default::default()
    };

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

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![WithdrawalRequested::SIGNATURE_HASH, topic1, topic2],
            data.into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(200),
        transaction_hash: Some(TX_HASH),
        log_index: Some(3),
        ..Default::default()
    };

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

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![Deposit::SIGNATURE_HASH, topic1, topic2], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(300),
        transaction_hash: Some(TX_HASH),
        log_index: Some(0),
        ..Default::default()
    };

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

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![Withdraw::SIGNATURE_HASH, topic1, topic2, topic3],
            data.into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(301),
        transaction_hash: Some(TX_HASH),
        log_index: Some(1),
        ..Default::default()
    };

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
    let holder = address!("2222222222222222222222222222222222222222");

    // LoanDrawn has 3 indexed topics: loanId, holder, metadataURI (string hash) — no non-indexed data
    let topic1: FixedBytes<32> = loan_id.into();
    let topic2: FixedBytes<32> = holder.into_word();
    // topic3: keccak256 of metadataURI string — use a dummy hash
    let topic3 = b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![LoanDrawn::SIGNATURE_HASH, topic1, topic2, topic3],
            vec![].into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(500),
        transaction_hash: Some(TX_HASH),
        log_index: Some(0),
        ..Default::default()
    };

    let ev = parse_loan_drawn(&log).expect("should decode LoanDrawn");
    assert_eq!(ev.event_name, "LoanDrawn");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["holder"], holder.to_checksum(None));
    // metadataURI is `string indexed`, so the topic is a keccak256 hash, not the URI.
    // The real URI is recovered via tokenURI(loanId) and stored in `loan_details`.
    assert!(
        ev.params.get("metadata_uri").is_none(),
        "metadata_uri must not be in LoanDrawn params (dead hash)"
    );
    assert_eq!(ev.block_number, 500);
}

#[test]
fn loan_closed_decodes() {
    let loan_id = U256::from(9u64);
    let reason: u8 = 0; // None

    let topic1: FixedBytes<32> = loan_id.into();
    let mut topic2 = [0u8; 32];
    topic2[31] = reason;

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![LoanClosed::SIGNATURE_HASH, topic1, FixedBytes::from(topic2)],
            vec![].into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(503),
        transaction_hash: Some(TX_HASH),
        log_index: Some(3),
        ..Default::default()
    };

    let ev = parse_loan_closed(&log).expect("should decode LoanClosed");
    assert_eq!(ev.event_name, "LoanClosed");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["closure_reason"], "None");
}

#[test]
fn loan_closed_other_write_down_decodes() {
    let loan_id = U256::from(10u64);
    let reason: u8 = 4; // OtherWriteDown

    let topic1: FixedBytes<32> = loan_id.into();
    let mut topic2 = [0u8; 32];
    topic2[31] = reason;

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![LoanClosed::SIGNATURE_HASH, topic1, FixedBytes::from(topic2)],
            vec![].into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(504),
        transaction_hash: Some(TX_HASH),
        log_index: Some(4),
        ..Default::default()
    };

    let ev = parse_loan_closed(&log).expect("should decode LoanClosed OtherWriteDown");
    assert_eq!(ev.event_name, "LoanClosed");
    assert_eq!(ev.params["closure_reason"], "OtherWriteDown");
}

#[test]
fn payment_recorded_decodes() {
    let token_id = U256::from(42u64);
    let repayment_id = U256::from(0u64);
    // RepaymentData struct — 7 uint256 fields ABI-encoded as a tuple (224 bytes)
    // New field order: offtakerReceived, seniorPrincipalRepaid, seniorInterest,
    //                  equityDistributed, mgmtFee, perfFee, oetAlloc
    let offtaker_received = U256::from(1000u64);
    let senior_principal_repaid = U256::from(200u64);
    let senior_interest = U256::from(10u64);
    let equity_distributed = U256::from(50u64);
    let mgmt_fee = U256::from(3u64);
    let perf_fee = U256::from(4u64);
    let oet_alloc = U256::from(5u64);

    let topic1: FixedBytes<32> = token_id.into();
    let topic2: FixedBytes<32> = repayment_id.into();

    // Non-indexed data: the ABI encoding of RepaymentData (struct = tuple, 7 × 32 bytes = 224)
    let mut data = [0u8; 224];
    data[0..32].copy_from_slice(&offtaker_received.to_be_bytes::<32>());
    data[32..64].copy_from_slice(&senior_principal_repaid.to_be_bytes::<32>());
    data[64..96].copy_from_slice(&senior_interest.to_be_bytes::<32>());
    data[96..128].copy_from_slice(&equity_distributed.to_be_bytes::<32>());
    data[128..160].copy_from_slice(&mgmt_fee.to_be_bytes::<32>());
    data[160..192].copy_from_slice(&perf_fee.to_be_bytes::<32>());
    data[192..224].copy_from_slice(&oet_alloc.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![PaymentRecorded::SIGNATURE_HASH, topic1, topic2],
            data.into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(505),
        transaction_hash: Some(TX_HASH),
        log_index: Some(5),
        ..Default::default()
    };

    let ev = parse_payment_recorded(&log).expect("should decode PaymentRecorded");
    assert_eq!(ev.event_name, "PaymentRecorded");
    assert_eq!(ev.params["loan_id"], token_id.to_string());
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
    assert_eq!(ev.block_number, 505);
}

#[test]
fn yield_minted_decodes() {
    let s_plusd_amount = U256::from(500_000u64);
    let treasury_amount = U256::from(25_000u64);

    // Both fields are non-indexed: packed as 64 bytes in `data`
    let mut data = [0u8; 64];
    data[0..32].copy_from_slice(&s_plusd_amount.to_be_bytes::<32>());
    data[32..64].copy_from_slice(&treasury_amount.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![YieldMinted::SIGNATURE_HASH], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(600),
        transaction_hash: Some(TX_HASH),
        log_index: Some(0),
        ..Default::default()
    };

    let ev = parse_yield_minted(&log).expect("should decode YieldMinted");
    assert_eq!(ev.event_name, "YieldMinted");
    assert_eq!(ev.params["s_plusd_amount"], s_plusd_amount.to_string());
    assert_eq!(ev.params["treasury_amount"], treasury_amount.to_string());
    assert_eq!(ev.block_number, 600);
}

#[test]
fn loan_defaulted_decodes() {
    let loan_id = U256::from(11u64);
    let ccr_bps: u32 = 4200;

    let topic1: FixedBytes<32> = loan_id.into();

    // Non-indexed: uint32 ccrBps, ABI-encoded as 32 bytes
    let mut data = [0u8; 32];
    data[28..32].copy_from_slice(&ccr_bps.to_be_bytes());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![LoanDefaulted::SIGNATURE_HASH, topic1], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(506),
        transaction_hash: Some(TX_HASH),
        log_index: Some(6),
        ..Default::default()
    };

    let ev = parse_loan_defaulted(&log).expect("should decode LoanDefaulted");
    assert_eq!(ev.event_name, "LoanDefaulted");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["ccr_bps"], ccr_bps);
    assert_eq!(ev.block_number, 506);
}
