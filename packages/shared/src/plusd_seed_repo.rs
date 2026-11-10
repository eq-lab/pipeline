// spec: docs/references/backend.md#plusd-balance-seed
use sqlx::PgPool;

use crate::plusd_seed::PlusdSeedRow;

pub const PLUSD_SEED_CANDIDATES_SQL: &str = "SELECT c.holder
     FROM (
         SELECT params->>'to' AS holder
           FROM contract_logs
          WHERE chain_id = $1
            AND contract_address = $2
            AND event_name = 'PlusdTransfer'
            AND block_number > $4
         UNION
         SELECT params->>'from'
           FROM contract_logs
          WHERE chain_id = $1
            AND contract_address = $2
            AND event_name = 'PlusdTransfer'
            AND block_number > $4
         UNION
         SELECT wallet_address FROM lp_profiles WHERE chain_id = $1
         UNION
         SELECT stellar_address FROM lps
         UNION
         SELECT address
           FROM lp_settlement_address_history
          WHERE chain_kind = 'stellar'
            AND (chain_id = $1 OR chain_id IS NULL)
         UNION
         SELECT UPPER(holder) FROM position_events WHERE chain_id = $1 AND block_number > $4
     ) c
     WHERE c.holder ~ '^G[A-Z2-7]{55}$'
       AND c.holder <> ALL($5::text[])
       AND NOT EXISTS (
           SELECT 1 FROM plusd_balance_seeds s
            WHERE s.chain_id = $1
              AND s.token_address = $2
              AND s.holder = c.holder)
     ORDER BY c.holder
     LIMIT $3";

pub const PLUSD_SEED_INSERT_SQL: &str = "INSERT INTO plusd_balance_seeds
         (chain_id, token_address, holder, as_of_ledger, as_of_timestamp, balance, kind)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7)
     ON CONFLICT DO NOTHING";

pub const PLUSD_LATEST_SEED_SQL: &str = "SELECT as_of_ledger,
         as_of_timestamp,
         CASE WHEN balance::text ~ '^[0-9]{1,39}$' THEN balance::text END AS balance,
         kind
     FROM plusd_balance_seeds
     WHERE chain_id = $1
       AND token_address = $2
       AND holder = $3
     ORDER BY as_of_ledger DESC
     LIMIT 1";

pub const PLUSD_SEEDED_HOLDERS_SQL: &str = "SELECT DISTINCT holder
     FROM plusd_balance_seeds
     WHERE chain_id = $1
       AND token_address = $2
     ORDER BY holder";

#[derive(Clone)]
pub struct PlusdSeedRepo {
    pool: PgPool,
}

impl PlusdSeedRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_candidates(
        &self,
        chain_id: i64,
        token: &str,
        limit: i64,
        after_ledger: i64,
        excluded: &[String],
    ) -> anyhow::Result<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(PLUSD_SEED_CANDIDATES_SQL)
            .bind(chain_id)
            .bind(token)
            .bind(limit)
            .bind(after_ledger)
            .bind(excluded)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(|(h,)| h).collect())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert(
        &self,
        chain_id: i64,
        token: &str,
        holder: &str,
        ledger: i64,
        timestamp: i64,
        balance: i128,
        kind: &str,
    ) -> anyhow::Result<bool> {
        let result = sqlx::query(PLUSD_SEED_INSERT_SQL)
            .bind(chain_id)
            .bind(token)
            .bind(holder)
            .bind(ledger)
            .bind(timestamp)
            .bind(balance.to_string())
            .bind(kind)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn latest(
        &self,
        chain_id: i64,
        token: &str,
        holder: &str,
    ) -> anyhow::Result<Option<PlusdSeedRow>> {
        let row = sqlx::query_as::<_, PlusdSeedRow>(PLUSD_LATEST_SEED_SQL)
            .bind(chain_id)
            .bind(token)
            .bind(holder)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row)
    }

    pub async fn seeded_holders(&self, chain_id: i64, token: &str) -> anyhow::Result<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(PLUSD_SEEDED_HOLDERS_SQL)
            .bind(chain_id)
            .bind(token)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(|(h,)| h).collect())
    }
}
