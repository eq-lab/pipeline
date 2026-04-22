/// Integration tests for the indexer loop.
/// Requires DATABASE_URL to be set to a live PostgreSQL instance.
/// Skipped automatically by the pre-commit hook when DATABASE_URL is unset.
#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use alloy::primitives::{address, b256, Address, U256};
    use sqlx::PgPool;

    use shared::{db::EventRepo, events::TokenTransferEvent};

    /// Returns `None` when `DATABASE_URL` is not set — tests that receive `None` return early.
    async fn setup_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.expect("connect to test DB");
        sqlx::migrate!("../shared/migrations")
            .run(&pool)
            .await
            .expect("migrations");
        // Clean slate for each test run
        sqlx::query("DELETE FROM token_transfers")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM log_collector_state")
            .execute(&pool)
            .await
            .unwrap();
        Some(pool)
    }

    fn make_transfer(
        contract: Address,
        block: u64,
        log_index: u64,
        value: U256,
    ) -> TokenTransferEvent {
        TokenTransferEvent {
            contract_address: contract,
            from: address!("1111111111111111111111111111111111111111"),
            to: address!("2222222222222222222222222222222222222222"),
            value,
            block_number: block,
            tx_hash: b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            log_index,
            block_timestamp: 0,
        }
    }

    /// Runs index_once logic inline: dedup + insert events, advance cursor.
    async fn run_once(
        repo: &EventRepo,
        chain_id: i64,
        events: &[TokenTransferEvent],
        end_block: u64,
    ) -> usize {
        let mut tx = repo.pool.begin().await.unwrap();
        let mut inserted = 0usize;

        for ev in events {
            let dup = repo
                .is_token_transfer_duplicate(
                    &mut tx,
                    chain_id,
                    &ev.contract_address.to_checksum(None),
                    ev.block_number,
                    ev.log_index,
                )
                .await
                .unwrap();
            if !dup && ev.value != U256::ZERO {
                repo.insert_token_transfer(&mut tx, ev, chain_id)
                    .await
                    .unwrap();
                inserted += 1;
            }
        }

        repo.set_cursor(&mut tx, chain_id, end_block + 1)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        inserted
    }

    async fn count_transfers(pool: &PgPool, chain_id: i64) -> i64 {
        let (n,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM token_transfers WHERE chain_id = $1")
                .bind(chain_id)
                .fetch_one(pool)
                .await
                .unwrap();
        n
    }

    async fn get_cursor(pool: &PgPool, chain_id: i64) -> i64 {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT last_indexed_block FROM log_collector_state WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_optional(pool)
        .await
        .unwrap();
        row.map(|(b,)| b).unwrap_or(0)
    }

    #[tokio::test]
    async fn inserts_events_and_advances_cursor() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract_a = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let contract_b = address!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

        // Seed cursor at block 100
        sqlx::query(
            "INSERT INTO log_collector_state (chain_id, last_indexed_block) VALUES (1, 100)",
        )
        .execute(&pool)
        .await
        .unwrap();

        // 4 events at blocks 101-104, two contracts
        let events = vec![
            make_transfer(contract_a, 101, 0, U256::from(100u64)),
            make_transfer(contract_a, 102, 0, U256::from(200u64)),
            make_transfer(contract_b, 103, 0, U256::from(300u64)),
            make_transfer(contract_b, 104, 0, U256::from(400u64)),
        ];

        // end = min(116 - 12, 100 + 1000 - 1) = 104
        let inserted = run_once(&repo, 1, &events, 104).await;

        assert_eq!(inserted, 4, "should have inserted 4 events");
        assert_eq!(count_transfers(&pool, 1).await, 4);
        assert_eq!(get_cursor(&pool, 1).await, 105);
    }

    #[tokio::test]
    async fn dedup_skips_already_indexed_events() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let events = vec![
            make_transfer(contract, 101, 0, U256::from(100u64)),
            make_transfer(contract, 102, 0, U256::from(200u64)),
        ];

        let first = run_once(&repo, 1, &events, 102).await;
        assert_eq!(first, 2);
        assert_eq!(get_cursor(&pool, 1).await, 103);

        // Re-run with the same events — cursor is already at 103, but we simulate
        // a retry by running index logic again with the same events.
        let second = run_once(&repo, 1, &events, 102).await;
        assert_eq!(second, 0, "dedup should prevent re-insertion");
        assert_eq!(count_transfers(&pool, 1).await, 2);
    }

    #[tokio::test]
    async fn zero_value_transfer_is_not_inserted() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let events = vec![make_transfer(contract, 101, 0, U256::ZERO)];

        let inserted = run_once(&repo, 1, &events, 101).await;
        assert_eq!(inserted, 0);
        assert_eq!(count_transfers(&pool, 1).await, 0);
    }

    #[tokio::test]
    async fn separate_chains_have_independent_cursors() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        // chain 1: insert at block 101
        let ev1 = vec![make_transfer(contract, 101, 0, U256::from(100u64))];
        run_once(&repo, 1, &ev1, 101).await;

        // chain 2: insert at block 200
        let ev2 = vec![make_transfer(contract, 200, 0, U256::from(999u64))];
        run_once(&repo, 2, &ev2, 200).await;

        assert_eq!(get_cursor(&pool, 1).await, 102);
        assert_eq!(get_cursor(&pool, 2).await, 201);
        assert_eq!(count_transfers(&pool, 1).await, 1);
        assert_eq!(count_transfers(&pool, 2).await, 1);
    }
}
