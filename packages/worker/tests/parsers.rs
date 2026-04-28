use alloy::{
    primitives::{address, b256, Address, FixedBytes, LogData, U256},
    rpc::types::Log,
};

use alloy::sol_types::SolEvent;

use pipeline_worker::indexer::parsers::{
    parse_claimable_increased, parse_transfer, parse_withdrawal_claimed, parse_withdrawal_requested,
};

// Re-declare sol! events to get correct SIGNATURE_HASH constants for test log construction.
alloy::sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued);
    event WithdrawalClaimed(address indexed withdrawer, uint256 indexed requestId, uint256 amount);
    event ClaimableIncreased(uint256 delta, uint256 newClaimable);
}

const CONTRACT: Address = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const TX_HASH: FixedBytes<32> =
    b256!("1111111111111111111111111111111111111111111111111111111111111111");

fn make_transfer_log(from: Address, to: Address, value: U256) -> Log {
    let topic1: FixedBytes<32> = from.into_word();
    let topic2: FixedBytes<32> = to.into_word();
    let mut data = [0u8; 32];
    data.copy_from_slice(&value.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![Transfer::SIGNATURE_HASH, topic1, topic2], data.into()).unwrap(),
    };

    Log {
        inner,
        block_number: Some(101),
        transaction_hash: Some(TX_HASH),
        log_index: Some(0),
        ..Default::default()
    }
}

// --- Transfer tests ---

#[test]
fn transfer_correct_log_decodes() {
    let from = address!("1111111111111111111111111111111111111111");
    let to = address!("2222222222222222222222222222222222222222");
    let value = U256::from(1000u64);

    let log = make_transfer_log(from, to, value);
    let ev = parse_transfer(&log, &[to]).expect("should decode");

    assert_eq!(ev.event_name, "Transfer");
    assert_eq!(ev.sender, Some(from));
    assert_eq!(ev.receiver, Some(to));
    assert_eq!(ev.amount, Some(value));
    assert_eq!(ev.request_id, None);
    assert_eq!(ev.cumulative, None);
    assert_eq!(ev.block_number, 101);
}

#[test]
fn transfer_wrong_topic0_returns_none() {
    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![FixedBytes::ZERO], vec![].into()).unwrap(),
    };
    let log = Log {
        inner,
        ..Default::default()
    };

    assert!(parse_transfer(&log, &[]).is_none());
}

#[test]
fn transfer_zero_value_returns_none() {
    let from = address!("1111111111111111111111111111111111111111");
    let to = address!("2222222222222222222222222222222222222222");

    let log = make_transfer_log(from, to, U256::ZERO);
    assert!(parse_transfer(&log, &[to]).is_none());
}

#[test]
fn transfer_unapproved_address_returns_none() {
    let from = address!("1111111111111111111111111111111111111111");
    let to = address!("2222222222222222222222222222222222222222");
    let unrelated = address!("3333333333333333333333333333333333333333");

    let log = make_transfer_log(from, to, U256::from(100u64));
    assert!(parse_transfer(&log, &[unrelated]).is_none());
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

// --- WithdrawalClaimed tests ---

#[test]
fn withdrawal_claimed_decodes() {
    let withdrawer = address!("1111111111111111111111111111111111111111");
    let request_id = U256::from(42u64);
    let amount = U256::from(5000u64);

    let topic1: FixedBytes<32> = withdrawer.into_word();
    let topic2: FixedBytes<32> = request_id.into();

    let mut data = [0u8; 32];
    data.copy_from_slice(&amount.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(
            vec![WithdrawalClaimed::SIGNATURE_HASH, topic1, topic2],
            data.into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(201),
        transaction_hash: Some(TX_HASH),
        log_index: Some(1),
        ..Default::default()
    };

    let ev = parse_withdrawal_claimed(&log).expect("should decode");
    assert_eq!(ev.event_name, "WithdrawalClaimed");
    assert_eq!(ev.sender, Some(withdrawer));
    assert_eq!(ev.receiver, None);
    assert_eq!(ev.amount, Some(amount));
    assert_eq!(ev.request_id, Some(request_id));
    assert_eq!(ev.cumulative, None);
    assert_eq!(ev.block_number, 201);
}

// --- ClaimableIncreased tests ---

#[test]
fn claimable_increased_decodes() {
    let delta = U256::from(3000u64);
    let new_claimable = U256::from(15000u64);

    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&delta.to_be_bytes::<32>());
    data[32..].copy_from_slice(&new_claimable.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: CONTRACT,
        data: LogData::new(vec![ClaimableIncreased::SIGNATURE_HASH], data.into()).unwrap(),
    };
    let log = Log {
        inner,
        block_number: Some(202),
        transaction_hash: Some(TX_HASH),
        log_index: Some(0),
        ..Default::default()
    };

    let ev = parse_claimable_increased(&log).expect("should decode");
    assert_eq!(ev.event_name, "ClaimableIncreased");
    assert_eq!(ev.sender, None);
    assert_eq!(ev.receiver, None);
    assert_eq!(ev.amount, Some(delta));
    assert_eq!(ev.request_id, None);
    assert_eq!(ev.cumulative, Some(new_claimable));
    assert_eq!(ev.block_number, 202);
}
