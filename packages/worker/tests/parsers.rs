use alloy::{
    primitives::{address, b256, fixed_bytes, Address, FixedBytes, LogData, U256},
    rpc::types::Log,
};

use pipeline_worker::indexer::parsers::parse_token_transfer;

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC: FixedBytes<32> =
    fixed_bytes!("ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");

fn make_transfer_log(from: Address, to: Address, value: U256) -> Log {
    let topic1: FixedBytes<32> = from.into_word();
    let topic2: FixedBytes<32> = to.into_word();
    let mut data = [0u8; 32];
    data.copy_from_slice(&value.to_be_bytes::<32>());

    let inner = alloy::primitives::Log {
        address: address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        data: LogData::new(vec![TRANSFER_TOPIC, topic1, topic2], data.into()).unwrap(),
    };

    Log {
        inner,
        block_number: Some(101),
        transaction_hash: Some(b256!(
            "1111111111111111111111111111111111111111111111111111111111111111"
        )),
        log_index: Some(0),
        ..Default::default()
    }
}

#[test]
fn correct_log_decodes() {
    let from = address!("1111111111111111111111111111111111111111");
    let to = address!("2222222222222222222222222222222222222222");
    let value = U256::from(1000u64);

    let log = make_transfer_log(from, to, value);
    let ev = parse_token_transfer(&log, &[to]).expect("should decode");

    assert_eq!(ev.from, from);
    assert_eq!(ev.to, to);
    assert_eq!(ev.value, value);
    assert_eq!(ev.block_number, 101);
}

#[test]
fn wrong_topic0_returns_none() {
    let inner = alloy::primitives::Log {
        address: address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        data: LogData::new(
            vec![FixedBytes::ZERO], // wrong topic0
            vec![].into(),
        )
        .unwrap(),
    };
    let log = Log {
        inner,
        ..Default::default()
    };

    assert!(parse_token_transfer(&log, &[]).is_none());
}
