use alloy::primitives::{address, b256, U256};
use std::sync::Arc;

use pipeline_worker::indexer::mappers::ContractLogMapper;
use shared::{events::ContractLog, log_mapper::LogMapper};

fn dummy_event() -> ContractLog {
    ContractLog {
        contract_address: address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        event_name: "Transfer".to_owned(),
        block_number: 101,
        tx_hash: b256!("1111111111111111111111111111111111111111111111111111111111111111"),
        log_index: 0,
        block_timestamp: 0,
        sender: Some(address!("1111111111111111111111111111111111111111")),
        receiver: Some(address!("2222222222222222222222222222222222222222")),
        amount: Some(U256::from(1000u64)),
        request_id: None,
        cumulative: None,
    }
}

#[tokio::test]
async fn block_number_returns_event_block() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");
    let repo = Arc::new(shared::db::EventRepo::new(pool));
    let mapper = ContractLogMapper::new(dummy_event(), 1, repo);

    assert_eq!(mapper.block_number(), 101);
}

#[tokio::test]
async fn set_block_timestamp_updates_event() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");
    let repo = Arc::new(shared::db::EventRepo::new(pool));
    let mut mapper = ContractLogMapper::new(dummy_event(), 1, repo);

    assert_eq!(mapper.event.block_timestamp, 0);
    mapper.set_block_timestamp(1234567890);
    assert_eq!(mapper.event.block_timestamp, 1234567890);
}
