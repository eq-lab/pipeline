/// DB-backed tests for `LoanDetailsRepo`. Skipped when `DATABASE_URL` is unset.
#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use bigdecimal::BigDecimal;
    use sqlx::PgPool;

    use shared::loan_details_repo::{LoanDetailsRepo, LoanDetailsRow};

    async fn setup_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.expect("connect to test DB");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations");
        sqlx::query("DELETE FROM loan_details")
            .execute(&pool)
            .await
            .unwrap();
        Some(pool)
    }

    fn sample_row(chain_id: i64, loan_id: u64) -> LoanDetailsRow {
        LoanDetailsRow {
            chain_id,
            loan_id: BigDecimal::from(loan_id),
            originator: "0x2222222222222222222222222222222222222222".to_owned(),
            borrower_id: "0xaaaa".to_owned(),
            commodity: "Jet fuel JET A-1".to_owned(),
            corridor: "South Korea -> Mongolia".to_owned(),
            original_facility_size: BigDecimal::from_str("1000000000").unwrap(),
            original_senior_tranche: BigDecimal::from_str("800000000").unwrap(),
            original_equity_tranche: BigDecimal::from_str("200000000").unwrap(),
            original_offtaker_price: BigDecimal::from_str("1100000000").unwrap(),
            senior_interest_rate_bps: 1200,
            origination_date: 1_748_908_800,
            original_maturity_date: 1_764_633_600,
            governing_law: "English law, LCIA London".to_owned(),
            metadata_uri: None,
        }
    }

    #[tokio::test]
    async fn upsert_insert_then_idempotent_update() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = LoanDetailsRepo::new(pool.clone());

        let row = sample_row(1, 7);
        let mut conn = pool.acquire().await.unwrap();
        repo.upsert_loan_details(&mut conn, &row).await.unwrap();
        repo.upsert_loan_details(&mut conn, &row).await.unwrap();

        let got = repo
            .get_loan_details(1, &BigDecimal::from(7u64))
            .await
            .unwrap()
            .expect("row should exist");
        assert_eq!(got.commodity, row.commodity);
        assert_eq!(got.original_facility_size, row.original_facility_size);
        assert_eq!(got.senior_interest_rate_bps, 1200);
    }

    #[tokio::test]
    async fn upsert_overwrites_immutable_fields_on_conflict() {
        // A re-fetch with corrected data (e.g. after a content fix at the URI) must heal
        // the prior row rather than insert a duplicate.
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = LoanDetailsRepo::new(pool.clone());

        let mut row = sample_row(1, 9);
        let mut conn = pool.acquire().await.unwrap();
        repo.upsert_loan_details(&mut conn, &row).await.unwrap();

        row.commodity = "Crude oil Brent".to_owned();
        row.metadata_uri = Some("ipfs://QmNew".to_owned());
        repo.upsert_loan_details(&mut conn, &row).await.unwrap();

        let got = repo
            .get_loan_details(1, &BigDecimal::from(9u64))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got.commodity, "Crude oil Brent");
        assert_eq!(got.metadata_uri.as_deref(), Some("ipfs://QmNew"));
    }

    #[tokio::test]
    async fn get_loan_details_missing_returns_none() {
        let Some(pool) = setup_pool().await else {
            return;
        };
        let repo = LoanDetailsRepo::new(pool);
        assert!(repo
            .get_loan_details(1, &BigDecimal::from(999u64))
            .await
            .unwrap()
            .is_none());
    }
}
