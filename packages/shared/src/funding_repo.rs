use bigdecimal::BigDecimal;
use sqlx::PgPool;

pub struct FundingRepo {
    pool: PgPool,
}

impl FundingRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Sum of `WithdrawalRequested` amounts where the withdrawer is currently whitelisted.
    pub async fn get_eligible_queued(&self, chain_id: i64) -> anyhow::Result<BigDecimal> {
        let row: (BigDecimal,) = sqlx::query_as(
            "SELECT COALESCE(SUM(cl.amount), 0)
             FROM contract_logs cl
             INNER JOIN lp_profiles lp ON LOWER(cl.sender) = LOWER(lp.wallet_address)
             WHERE cl.event_name = 'WithdrawalRequested'
               AND cl.chain_id = $1
               AND lp.is_whitelisted = true",
        )
        .bind(chain_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.0)
    }

    /// Sum of funded amounts in the last 24 hours for rolling cap enforcement.
    pub async fn get_rolling_24h_funded(&self, chain_id: i64) -> anyhow::Result<BigDecimal> {
        let row: (BigDecimal,) = sqlx::query_as(
            "SELECT COALESCE(SUM(amount_usdc), 0)
             FROM funding_history
             WHERE chain_id = $1
               AND funded_at > NOW() - INTERVAL '24 hours'",
        )
        .bind(chain_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.0)
    }

    /// Record a successful funding transaction.
    pub async fn insert_funding(
        &self,
        chain_id: i64,
        amount: &BigDecimal,
        tx_hash: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO funding_history (chain_id, amount_usdc, tx_hash)
             VALUES ($1, $2, $3)",
        )
        .bind(chain_id)
        .bind(amount)
        .bind(tx_hash)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
