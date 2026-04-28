/// Integration tests for the indexer loop.
/// Requires DATABASE_URL to be set to a live PostgreSQL instance.
/// Skipped automatically by the pre-commit hook when DATABASE_URL is unset.
#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use alloy::primitives::{address, b256, Address, U256};
    use sqlx::PgPool;

    use shared::{db::EventRepo, events::ContractLog};

    async fn setup_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.expect("connect to test DB");
        sqlx::migrate!("../shared/migrations")
            .run(&pool)
            .await
            .expect("migrations");
        sqlx::query("DELETE FROM contract_logs")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM log_collector_state")
            .execute(&pool)
            .await
            .unwrap();
        Some(pool)
    }

    fn make_transfer(contract: Address, block: u64, log_index: u64, value: U256) -> ContractLog {
        ContractLog {
            contract_address: contract,
            event_name: "Transfer".to_owned(),
            block_number: block,
            tx_hash: b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            log_index,
            block_timestamp: 0,
            sender: Some(address!("1111111111111111111111111111111111111111")),
            receiver: Some(address!("2222222222222222222222222222222222222222")),
            amount: Some(value),
            request_id: None,
            cumulative: None,
        }
    }

    fn make_withdrawal_requested(contract: Address, block: u64, log_index: u64) -> ContractLog {
        ContractLog {
            contract_address: contract,
            event_name: "WithdrawalRequested".to_owned(),
            block_number: block,
            tx_hash: b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            log_index,
            block_timestamp: 0,
            sender: Some(address!("1111111111111111111111111111111111111111")),
            receiver: None,
            amount: Some(U256::from(5000u64)),
            request_id: Some(U256::from(1u64)),
            cumulative: Some(U256::from(5000u64)),
        }
    }

    async fn run_once(
        repo: &EventRepo,
        chain_id: i64,
        events: &[ContractLog],
        end_block: u64,
    ) -> usize {
        let mut tx = repo.pool.begin().await.unwrap();
        let mut inserted = 0usize;

        for ev in events {
            let dup = repo
                .is_duplicate(
                    &mut tx,
                    chain_id,
                    &ev.contract_address.to_checksum(None),
                    ev.block_number,
                    ev.log_index,
                )
                .await
                .unwrap();
            if !dup {
                repo.insert_log(&mut tx, ev, chain_id).await.unwrap();
                inserted += 1;
            }
        }

        repo.set_cursor(&mut tx, chain_id, end_block + 1)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        inserted
    }

    async fn count_logs(pool: &PgPool, chain_id: i64, event_name: Option<&str>) -> i64 {
        let (n,): (i64,) = match event_name {
            Some(name) => sqlx::query_as(
                "SELECT COUNT(*) FROM contract_logs WHERE chain_id = $1 AND event_name = $2",
            )
            .bind(chain_id)
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap(),
            None => sqlx::query_as("SELECT COUNT(*) FROM contract_logs WHERE chain_id = $1")
                .bind(chain_id)
                .fetch_one(pool)
                .await
                .unwrap(),
        };
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

        sqlx::query(
            "INSERT INTO log_collector_state (chain_id, last_indexed_block) VALUES (1, 100)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let events = vec![
            make_transfer(contract_a, 101, 0, U256::from(100u64)),
            make_transfer(contract_a, 102, 0, U256::from(200u64)),
            make_transfer(contract_b, 103, 0, U256::from(300u64)),
            make_transfer(contract_b, 104, 0, U256::from(400u64)),
        ];

        let inserted = run_once(&repo, 1, &events, 104).await;

        assert_eq!(inserted, 4, "should have inserted 4 events");
        assert_eq!(count_logs(&pool, 1, None).await, 4);
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

        let second = run_once(&repo, 1, &events, 102).await;
        assert_eq!(second, 0, "dedup should prevent re-insertion");
        assert_eq!(count_logs(&pool, 1, None).await, 2);
    }

    #[tokio::test]
    async fn separate_chains_have_independent_cursors() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        let ev1 = vec![make_transfer(contract, 101, 0, U256::from(100u64))];
        run_once(&repo, 1, &ev1, 101).await;

        let ev2 = vec![make_transfer(contract, 200, 0, U256::from(999u64))];
        run_once(&repo, 2, &ev2, 200).await;

        assert_eq!(get_cursor(&pool, 1).await, 102);
        assert_eq!(get_cursor(&pool, 2).await, 201);
        assert_eq!(count_logs(&pool, 1, None).await, 1);
        assert_eq!(count_logs(&pool, 2, None).await, 1);
    }

    #[tokio::test]
    async fn mixed_event_types_coexist() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = Arc::new(EventRepo::new(pool.clone()));

        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        let events = vec![
            make_transfer(contract, 101, 0, U256::from(100u64)),
            make_withdrawal_requested(contract, 101, 1),
        ];

        let inserted = run_once(&repo, 1, &events, 101).await;
        assert_eq!(inserted, 2);
        assert_eq!(count_logs(&pool, 1, Some("Transfer")).await, 1);
        assert_eq!(count_logs(&pool, 1, Some("WithdrawalRequested")).await, 1);
        assert_eq!(count_logs(&pool, 1, None).await, 2);
    }
}
