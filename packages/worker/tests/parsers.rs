use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, U256},
    rpc::types::Log,
};

use alloy::sol_types::SolEvent;

use pipeline_worker::indexer::parsers::{
    parse_deposit_requested, parse_loan_ccr_updated, parse_loan_closed, parse_loan_defaulted,
    parse_loan_location_updated, parse_loan_minted, parse_loan_repayment,
    parse_loan_status_updated, parse_request_claimed, parse_staking_deposit,
    parse_staking_withdraw, parse_withdrawal_requested,
};

// Re-declare sol! events to get correct SIGNATURE_HASH constants for test log construction.
alloy::sol! {
    event DepositRequested(uint256 indexed requestId, address indexed user, uint256 amount);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event RequestClaimed(uint256 indexed requestId, address indexed user, uint256 amount);

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    event LoanMinted(uint256 indexed loanId, address indexed holder, string indexed metadataURI, uint64 initialMaturity, string location);
    event StatusUpdated(uint256 indexed loanId, uint8 indexed newStatus);
    event CCRUpdated(uint256 indexed loanId, uint32 newCcrBps);
    event LocationUpdated(uint256 indexed loanId, string indexed newLocation);
    event LoanDefaulted(uint256 indexed loanId, uint32 ccrBps);
    event LoanClosed(uint256 indexed loanId, uint8 indexed reason);
    event Repayment(uint256 indexed tokenId, uint256 offtakerAmount, uint256 seniorPrincipal, uint256 seniorInterest, uint256 equityAmount);
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
fn loan_minted_decodes() {
    let loan_id = U256::from(1u64);
    let holder = address!("2222222222222222222222222222222222222222");
    let initial_maturity: u64 = 1_700_000_000;
    let location = b"US";

    // LoanMinted has indexed: loanId, holder, metadataURI (string hash) — non-indexed: initialMaturity, location
    let topic1: FixedBytes<32> = loan_id.into();
    let topic2: FixedBytes<32> = holder.into_word();
    // topic3: keccak256 of metadataURI string — use a dummy hash
    let topic3 = b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    // ABI-encode non-indexed params: (uint64 initialMaturity, string location)
    // Layout:
    //   [0x00..0x1f] uint64 right-aligned
    //   [0x20..0x3f] offset to string = 0x40
    //   [0x40..0x5f] string length = 2
    //   [0x60..0x7f] string bytes "US" + 30 zero bytes
    let mut data = vec![0u8; 128];
    // uint64 in last 8 bytes of first slot
    data[24..32].copy_from_slice(&initial_maturity.to_be_bytes());
    // offset = 64 = 0x40
    data[63] = 0x40;
    // length = 2
    data[95] = 0x02;
    // string bytes
    data[96] = location[0];
    data[97] = location[1];

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![LoanMinted::SIGNATURE_HASH, topic1, topic2, topic3],
            data.into(),
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

    let ev = parse_loan_minted(&log).expect("should decode LoanMinted");
    assert_eq!(ev.event_name, "LoanMinted");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["holder"], holder.to_checksum(None));
    assert_eq!(ev.params["initial_maturity"], initial_maturity);
    assert_eq!(ev.params["location"], "US");
    // The event field is `string indexed`, so the topic is a keccak256 hash, not the URI.
    // The real URI is recovered via tokenURI(loanId) and stored in `loan_details`.
    assert!(
        ev.params.get("metadata_uri").is_none(),
        "metadata_uri must not be in LoanMinted params (dead hash) — see issue #363 Scope #9"
    );
    assert_eq!(ev.block_number, 500);
}

#[test]
fn loan_status_updated_decodes() {
    let loan_id = U256::from(5u64);
    let new_status: u8 = 1; // WatchList

    let topic1: FixedBytes<32> = loan_id.into();
    let mut topic2 = [0u8; 32];
    topic2[31] = new_status;

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![
                StatusUpdated::SIGNATURE_HASH,
                topic1,
                FixedBytes::from(topic2),
            ],
            vec![].into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(501),
        transaction_hash: Some(TX_HASH),
        log_index: Some(1),
        ..Default::default()
    };

    let ev = parse_loan_status_updated(&log).expect("should decode LoanStatusUpdated");
    assert_eq!(ev.event_name, "LoanStatusUpdated");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["status"], "WatchList");
}

#[test]
fn loan_ccr_updated_decodes() {
    let loan_id = U256::from(3u64);
    let ccr_bps: u32 = 7500;

    let topic1: FixedBytes<32> = loan_id.into();

    // Non-indexed: uint32 newCcrBps, ABI-encoded as 32 bytes
    let mut data = [0u8; 32];
    data[28..32].copy_from_slice(&ccr_bps.to_be_bytes());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![CCRUpdated::SIGNATURE_HASH, topic1], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(502),
        transaction_hash: Some(TX_HASH),
        log_index: Some(2),
        ..Default::default()
    };

    let ev = parse_loan_ccr_updated(&log).expect("should decode LoanCCRUpdated");
    assert_eq!(ev.event_name, "LoanCCRUpdated");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    assert_eq!(ev.params["ccr_bps"], ccr_bps);
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
fn loan_repayment_decodes() {
    let token_id = U256::from(42u64);
    let offtaker = U256::from(100u64);
    let senior_principal = U256::from(200u64);
    let senior_interest = U256::from(10u64);
    let equity = U256::from(50u64);

    let topic1: FixedBytes<32> = token_id.into();

    // Non-indexed: offtakerAmount, seniorPrincipal, seniorInterest, equityAmount
    let mut data = [0u8; 128];
    data[0..32].copy_from_slice(&offtaker.to_be_bytes::<32>());
    data[32..64].copy_from_slice(&senior_principal.to_be_bytes::<32>());
    data[64..96].copy_from_slice(&senior_interest.to_be_bytes::<32>());
    data[96..128].copy_from_slice(&equity.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![Repayment::SIGNATURE_HASH, topic1], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(504),
        transaction_hash: Some(TX_HASH),
        log_index: Some(4),
        ..Default::default()
    };

    let ev = parse_loan_repayment(&log).expect("should decode LoanRepayment");
    assert_eq!(ev.event_name, "LoanRepayment");
    assert_eq!(ev.params["loan_id"], token_id.to_string());
    assert_eq!(ev.params["offtaker_amount"], offtaker.to_string());
    assert_eq!(ev.params["senior_principal"], senior_principal.to_string());
    assert_eq!(ev.params["senior_interest"], senior_interest.to_string());
    assert_eq!(ev.params["equity_amount"], equity.to_string());
}

#[test]
fn loan_location_updated_decodes() {
    let loan_id = U256::from(7u64);
    let topic1: FixedBytes<32> = loan_id.into();
    // newLocation is indexed (string) — topic2 is keccak256 of the string; non-indexed data is empty
    let topic2 = b256!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![LocationUpdated::SIGNATURE_HASH, topic1, topic2],
            vec![].into(),
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

    let ev = parse_loan_location_updated(&log).expect("should decode LoanLocationUpdated");
    assert_eq!(ev.event_name, "LoanLocationUpdated");
    assert_eq!(ev.params["loan_id"], loan_id.to_string());
    // newLocation is indexed (hashed on-chain) — the decoded value is the hash, not the string
    assert!(ev.params.get("location").is_some());
    assert_eq!(ev.block_number, 505);
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
