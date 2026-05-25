/// DB-backed tests for `LoanMintedMapper`. Skipped when `DATABASE_URL` is unset.
#[cfg(test)]
mod tests {
    use std::str::FromStr;
    use std::sync::{Arc, Mutex};

    use alloy::primitives::{address, b256, Address, U256};
    use async_trait::async_trait;
    use bigdecimal::BigDecimal;
    use sqlx::PgPool;

    use pipeline_worker::indexer::loan_mapper::LoanMintedMapper;
    use pipeline_worker::indexer::loan_metadata::{
        ImmutableLoanData, LoanMetadataFetcher, MetadataUriResolver,
    };
    use shared::{
        db::EventRepo, events::ContractLog, loan_details_repo::LoanDetailsRepo,
        log_mapper::LogMapper,
    };

    async fn setup_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.expect("connect to test DB");
        sqlx::migrate!("../shared/migrations")
            .run(&pool)
            .await
            .expect("migrations");
        for tbl in ["contract_logs", "log_collector_state", "loan_details"] {
            sqlx::query(&format!("DELETE FROM {tbl}"))
                .execute(&pool)
                .await
                .unwrap();
        }
        Some(pool)
    }

    fn sample_immutable() -> ImmutableLoanData {
        ImmutableLoanData {
            originator: "0x2222222222222222222222222222222222222222".to_owned(),
            borrower_id: "0xaaaa".to_owned(),
            commodity: "Jet fuel JET A-1".to_owned(),
            corridor: "South Korea -> Mongolia".to_owned(),
            original_facility_size: "1000000000".to_owned(),
            original_senior_tranche: "800000000".to_owned(),
            original_equity_tranche: "200000000".to_owned(),
            original_offtaker_price: "1100000000".to_owned(),
            senior_interest_rate_bps: "1200".to_owned(),
            origination_date: "1748908800".to_owned(),
            original_maturity_date: "1764633600".to_owned(),
            governing_law: "English law, LCIA London".to_owned(),
            metadata_uri: None,
        }
    }

    fn loan_minted_event(contract: Address, loan_id: u64, block: u64) -> ContractLog {
        ContractLog {
            contract_address: contract,
            event_name: "LoanMinted".to_owned(),
            block_number: block,
            tx_hash: b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            log_index: 0,
            block_timestamp: 1_700_000_000,
            params: serde_json::json!({
                "loan_id": loan_id.to_string(),
                "holder": "0x1111111111111111111111111111111111111111",
                "initial_maturity": 1_764_633_600u64,
                "location": "US",
            }),
        }
    }

    // --- mocks ---

    struct FixedFetcher {
        data: ImmutableLoanData,
    }

    #[async_trait]
    impl LoanMetadataFetcher for FixedFetcher {
        async fn fetch_metadata(&self, _uri: &str) -> anyhow::Result<ImmutableLoanData> {
            Ok(self.data.clone())
        }
    }

    struct FailingFetcher;

    #[async_trait]
    impl LoanMetadataFetcher for FailingFetcher {
        async fn fetch_metadata(&self, _uri: &str) -> anyhow::Result<ImmutableLoanData> {
            Err(anyhow::anyhow!("simulated 503 (terminal after retries)"))
        }
    }

    struct FixedResolver {
        uri: String,
        calls: Mutex<u32>,
    }

    #[async_trait]
    impl MetadataUriResolver for FixedResolver {
        async fn metadata_uri(&self, _contract: Address, _id: U256) -> anyhow::Result<String> {
            *self.calls.lock().unwrap() += 1;
            Ok(self.uri.clone())
        }
    }

    struct FailingResolver;

    #[async_trait]
    impl MetadataUriResolver for FailingResolver {
        async fn metadata_uri(&self, _contract: Address, _id: U256) -> anyhow::Result<String> {
            Err(anyhow::anyhow!("eth_call tokenURI failed"))
        }
    }

    const CONTRACT: Address = address!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const CHAIN: i64 = 1;

    fn build_mapper(
        ev: ContractLog,
        pool: PgPool,
        fetcher: Arc<dyn LoanMetadataFetcher>,
        resolver: Arc<dyn MetadataUriResolver>,
    ) -> LoanMintedMapper {
        let event_repo = Arc::new(EventRepo::new(pool.clone()));
        let details_repo = Arc::new(LoanDetailsRepo::new(pool));
        LoanMintedMapper::new(ev, CHAIN, event_repo, details_repo, fetcher, resolver)
    }

    async fn count_loan_details(pool: &PgPool) -> i64 {
        let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM loan_details")
            .fetch_one(pool)
            .await
            .unwrap();
        n
    }

    async fn count_contract_logs(pool: &PgPool) -> i64 {
        let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM contract_logs")
            .fetch_one(pool)
            .await
            .unwrap();
        n
    }

    // --- tests ---

    #[tokio::test]
    async fn loan_minted_success_inserts_both_rows() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let fetcher: Arc<dyn LoanMetadataFetcher> = Arc::new(FixedFetcher {
            data: sample_immutable(),
        });
        let resolver: Arc<dyn MetadataUriResolver> = Arc::new(FixedResolver {
            uri: "ipfs://QmTestCid/loan.json".to_owned(),
            calls: Mutex::new(0),
        });
        let mapper = build_mapper(
            loan_minted_event(CONTRACT, 42, 500),
            pool.clone(),
            fetcher,
            resolver,
        );

        let mut tx = pool.begin().await.unwrap();
        mapper.insert(&mut tx).await.unwrap();
        tx.commit().await.unwrap();

        assert_eq!(count_contract_logs(&pool).await, 1);
        assert_eq!(count_loan_details(&pool).await, 1);

        let repo = LoanDetailsRepo::new(pool.clone());
        let got = repo
            .get_loan_details(CHAIN, &BigDecimal::from(42u64))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got.commodity, "Jet fuel JET A-1");
        assert_eq!(
            got.original_facility_size,
            BigDecimal::from_str("1000000000").unwrap()
        );
        assert_eq!(got.senior_interest_rate_bps, 1200);
    }

    #[tokio::test]
    async fn loan_minted_fetch_failure_propagates_and_rolls_back() {
        // Under the "never skip loan_details" policy, a fetch failure must propagate
        // out of `insert` so the indexer's outer transaction rolls back. The caller
        // (index_once) then re-pulls the same batch on the next polling cycle.
        let Some(pool) = setup_pool().await else {
            return;
        };
        let fetcher: Arc<dyn LoanMetadataFetcher> = Arc::new(FailingFetcher);
        let resolver: Arc<dyn MetadataUriResolver> = Arc::new(FixedResolver {
            uri: "ipfs://QmTestCid/loan.json".to_owned(),
            calls: Mutex::new(0),
        });
        let mapper = build_mapper(
            loan_minted_event(CONTRACT, 7, 501),
            pool.clone(),
            fetcher,
            resolver,
        );

        let mut tx = pool.begin().await.unwrap();
        let err = mapper
            .insert(&mut tx)
            .await
            .expect_err("fetch failure must propagate");
        assert!(format!("{err:#}").contains("metadata fetch failed"));
        // Caller would roll back; we drop the transaction to simulate that.
        drop(tx);

        assert_eq!(
            count_contract_logs(&pool).await,
            0,
            "contract_logs must NOT be committed when loan_details fetch fails"
        );
        assert_eq!(count_loan_details(&pool).await, 0);
    }

    #[tokio::test]
    async fn loan_minted_resolver_failure_propagates_and_rolls_back() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let fetcher: Arc<dyn LoanMetadataFetcher> = Arc::new(FixedFetcher {
            data: sample_immutable(),
        });
        let resolver: Arc<dyn MetadataUriResolver> = Arc::new(FailingResolver);
        let mapper = build_mapper(
            loan_minted_event(CONTRACT, 8, 502),
            pool.clone(),
            fetcher,
            resolver,
        );

        let mut tx = pool.begin().await.unwrap();
        let err = mapper
            .insert(&mut tx)
            .await
            .expect_err("resolver failure must propagate");
        assert!(format!("{err:#}").contains("tokenURI"));
        drop(tx);

        assert_eq!(count_contract_logs(&pool).await, 0);
        assert_eq!(count_loan_details(&pool).await, 0);
    }

    #[tokio::test]
    async fn loan_minted_idempotent_on_reindex() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let fetcher: Arc<dyn LoanMetadataFetcher> = Arc::new(FixedFetcher {
            data: sample_immutable(),
        });
        let resolver: Arc<dyn MetadataUriResolver> = Arc::new(FixedResolver {
            uri: "ipfs://Qm/loan.json".to_owned(),
            calls: Mutex::new(0),
        });

        // First pass.
        let m1 = build_mapper(
            loan_minted_event(CONTRACT, 500, 1000),
            pool.clone(),
            fetcher.clone(),
            resolver.clone(),
        );
        let mut tx = pool.begin().await.unwrap();
        if !m1.is_duplicate(&mut tx).await.unwrap() {
            m1.insert(&mut tx).await.unwrap();
        }
        tx.commit().await.unwrap();

        // Re-pass — contract_logs dedup kicks in, and the upsert is idempotent regardless.
        let m2 = build_mapper(
            loan_minted_event(CONTRACT, 500, 1000),
            pool.clone(),
            fetcher,
            resolver,
        );
        let mut tx = pool.begin().await.unwrap();
        if !m2.is_duplicate(&mut tx).await.unwrap() {
            m2.insert(&mut tx).await.unwrap();
        }
        tx.commit().await.unwrap();

        assert_eq!(count_contract_logs(&pool).await, 1);
        assert_eq!(count_loan_details(&pool).await, 1);
    }
}
