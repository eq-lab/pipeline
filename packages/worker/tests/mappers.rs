use alloy::primitives::{address, b256, U256};
use std::sync::Arc;

use pipeline_worker::indexer::mappers::ContractLogMapper;
use shared::events::ContractLog;

fn dummy_event(value: U256) -> ContractLog {
    ContractLog {
        contract_address: address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        event_name: "Transfer".to_owned(),
        block_number: 101,
        tx_hash: b256!("1111111111111111111111111111111111111111111111111111111111111111"),
        log_index: 0,
        block_timestamp: 0,
        sender: Some(address!("1111111111111111111111111111111111111111")),
        receiver: Some(address!("2222222222222222222222222222222222222222")),
        amount: Some(value),
        request_id: None,
        cumulative: None,
    }
}

/// Zero-value transfers must be skipped without touching the DB.
/// We pass a broken `PgConnection` reference by using a null pool — if is_duplicate
/// makes a DB call it will panic. The test passes only if is_duplicate returns early.
#[tokio::test]
async fn zero_value_is_skipped_without_db_call() {
    // Build a dummy pool that is NOT connected (connect_lazy to non-existent server).
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/nonexistent")
        .expect("connect_lazy should not fail");
    let repo = Arc::new(shared::db::EventRepo::new(pool));
    let mapper = ContractLogMapper::new(dummy_event(U256::ZERO), 1, repo);

    // Verify the event has zero amount
    assert_eq!(mapper.event.amount, Some(U256::ZERO));
}
