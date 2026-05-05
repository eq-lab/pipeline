/// Integration tests for FundingRepo.
/// Requires DATABASE_URL to be set to a live PostgreSQL instance.
#[cfg(test)]
mod tests {
    use alloy::primitives::{address, b256, Address, U256};
    use bigdecimal::BigDecimal;
    use sqlx::PgPool;

    use shared::db::EventRepo;
    use shared::events::ContractLog;
    use shared::funding_repo::FundingRepo;

    const CHAIN_ID: i64 = 1;

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
        sqlx::query("DELETE FROM funding_history")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM lp_profiles")
            .execute(&pool)
            .await
            .unwrap();
        Some(pool)
    }

    async fn insert_lp_profile(pool: &PgPool, wallet: &str, is_whitelisted: bool) {
        sqlx::query(
            "INSERT INTO lp_profiles (wallet_address, is_whitelisted)
             VALUES ($1, $2)
             ON CONFLICT (wallet_address) DO UPDATE SET is_whitelisted = $2",
        )
        .bind(wallet)
        .bind(is_whitelisted)
        .execute(pool)
        .await
        .unwrap();
    }

    fn make_withdrawal_requested(
        contract: Address,
        block: u64,
        log_index: u64,
        sender: Address,
        amount: U256,
    ) -> ContractLog {
        ContractLog {
            contract_address: contract,
            event_name: "WithdrawalRequested".to_owned(),
            block_number: block,
            tx_hash: b256!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            log_index,
            block_timestamp: 1_000_000,
            sender: Some(sender),
            receiver: None,
            amount: Some(amount),
            request_id: Some(U256::from(log_index)),
            cumulative: Some(amount),
        }
    }

    #[tokio::test]
    async fn eligible_queued_sums_whitelisted_only() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = FundingRepo::new(pool.clone());
        let event_repo = EventRepo::new(pool.clone());
        let contract = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        let lp_a = address!("1111111111111111111111111111111111111111");
        let lp_b = address!("2222222222222222222222222222222222222222");

        // LP A is whitelisted, LP B is not
        insert_lp_profile(&pool, &lp_a.to_checksum(None), true).await;
        insert_lp_profile(&pool, &lp_b.to_checksum(None), false).await;

        // Insert withdrawal requests
        let events = vec![
            make_withdrawal_requested(contract, 100, 0, lp_a, U256::from(1_000_000u64)),
            make_withdrawal_requested(contract, 100, 1, lp_b, U256::from(2_000_000u64)),
            make_withdrawal_requested(contract, 101, 0, lp_a, U256::from(500_000u64)),
        ];

        let mut tx = pool.begin().await.unwrap();
        for event in &events {
            event_repo
                .insert_log(&mut tx, event, CHAIN_ID)
                .await
                .unwrap();
        }
        tx.commit().await.unwrap();

        // Only LP A's requests should count: 1_000_000 + 500_000 = 1_500_000
        let eligible = repo.get_eligible_queued(CHAIN_ID).await.unwrap();
        assert_eq!(eligible, BigDecimal::from(1_500_000));
    }

    #[tokio::test]
    async fn eligible_queued_zero_when_no_requests() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = FundingRepo::new(pool);

        let eligible = repo.get_eligible_queued(CHAIN_ID).await.unwrap();
        assert_eq!(eligible, BigDecimal::from(0));
    }

    #[tokio::test]
    async fn rolling_24h_funded_tracks_recent() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = FundingRepo::new(pool.clone());

        repo.insert_funding(CHAIN_ID, &BigDecimal::from(1_000_000), "0xaaa")
            .await
            .unwrap();
        repo.insert_funding(CHAIN_ID, &BigDecimal::from(2_000_000), "0xbbb")
            .await
            .unwrap();

        // Insert an old record (>24h ago)
        sqlx::query(
            "INSERT INTO funding_history (chain_id, amount_usdc, tx_hash, funded_at)
             VALUES ($1, $2, $3, NOW() - INTERVAL '25 hours')",
        )
        .bind(CHAIN_ID)
        .bind(BigDecimal::from(5_000_000))
        .bind("0xccc")
        .execute(&pool)
        .await
        .unwrap();

        // Only recent: 1_000_000 + 2_000_000 = 3_000_000
        let rolling = repo.get_rolling_24h_funded(CHAIN_ID).await.unwrap();
        assert_eq!(rolling, BigDecimal::from(3_000_000));
    }
}
