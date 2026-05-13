use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, U256},
    rpc::types::Log,
};

use alloy::sol_types::SolEvent;

use pipeline_worker::indexer::parsers::{
    parse_deposit_requested, parse_request_claimed, parse_withdrawal_requested,
};

// Re-declare sol! events to get correct SIGNATURE_HASH constants for test log construction.
alloy::sol! {
    event DepositRequested(uint256 indexed requestId, address indexed user, uint256 amount);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event RequestClaimed(uint256 indexed requestId, address indexed user, uint256 amount);
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
    assert_eq!(ev.sender, Some(user));
    assert_eq!(ev.receiver, None);
    assert_eq!(ev.amount, Some(amount));
    assert_eq!(ev.request_id, Some(request_id));
    assert_eq!(ev.cumulative, None);
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
    assert_eq!(ev.sender, Some(user));
    assert_eq!(ev.receiver, None);
    assert_eq!(ev.amount, Some(amount));
    assert_eq!(ev.request_id, Some(request_id));
    assert_eq!(ev.cumulative, None);
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
    assert_eq!(ev.sender, Some(withdrawer));
    assert_eq!(ev.receiver, None);
    assert_eq!(ev.amount, Some(amount));
    assert_eq!(ev.request_id, Some(request_id));
    assert_eq!(ev.cumulative, Some(queued));
    assert_eq!(ev.block_number, 200);
    assert_eq!(ev.log_index, 3);
}
