// spec: docs/references/backend.md#stellar-pocket-indexing
use bigdecimal::BigDecimal;
use sqlx::PgPool;

use crate::pocket::{PocketClaimTotals, PocketEventRow, PocketSeedRow};

pub const LIST_EVENTS_SQL: &str =
    "SELECT (params->>'loan_id')::numeric, event_name, block_number, log_index,
            block_timestamp, params
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name IN ('PocketOpened','PocketReleased','PocketUnreleased','PocketBurned')
       AND params->>'loan_id' IS NOT NULL
     ORDER BY block_number, log_index";

pub const LIST_CLAIM_TOTALS_SQL: &str = "SELECT (c.params->>'loan_id')::numeric AS loan_id,
            SUM((c.params->>'paid')::numeric) AS total,
            COALESCE(SUM((c.params->>'paid')::numeric) FILTER (WHERE c.block_number > s.as_of_ledger), 0) AS after_seed
     FROM contract_logs c
     LEFT JOIN pocket_seeds s
       ON s.chain_id = c.chain_id
      AND s.pocket_address = c.contract_address
      AND s.loan_id = (c.params->>'loan_id')::numeric
     WHERE c.chain_id = $1
       AND c.contract_address = $2
       AND c.event_name = 'PocketClaimed'
       AND c.params->>'loan_id' IS NOT NULL
     GROUP BY (c.params->>'loan_id')::numeric, s.as_of_ledger";

pub const LIST_SEEDS_SQL: &str =
    "SELECT loan_id, as_of_ledger, snapshot_ledger, supply_at_snapshot, held,
            released_total, burned_total, claimed_total
     FROM pocket_seeds
     WHERE chain_id = $1 AND pocket_address = $2";

pub const LIST_HOLDER_CLAIMS_SQL: &str = "SELECT (params->>'loan_id')::numeric AS loan_id,
            (params->>'paid')::numeric AS paid,
            tx_hash,
            block_timestamp
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name = 'PocketClaimed'
       AND params->>'holder' = $3
       AND COALESCE((params->>'paid_zero')::boolean, false) = false
     ORDER BY block_number DESC, log_index DESC";

pub const LIST_SEED_CANDIDATES_SQL: &str =
    "SELECT DISTINCT (d.params->>'loan_id')::numeric AS loan_id
     FROM contract_logs d
     WHERE d.chain_id = $1
       AND d.contract_address = $2
       AND d.event_name = 'LoanDefaulted'
       AND d.params->>'loan_id' IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM contract_logs o
           WHERE o.chain_id = $1
             AND o.contract_address = $3
             AND o.event_name = 'PocketOpened'
             AND (o.params->>'loan_id')::numeric = (d.params->>'loan_id')::numeric)
       AND NOT EXISTS (
           SELECT 1 FROM pocket_seeds s
           WHERE s.chain_id = $1
             AND s.pocket_address = $3
             AND s.loan_id = (d.params->>'loan_id')::numeric)
     ORDER BY loan_id";

pub const INSERT_SEED_SQL: &str = "INSERT INTO pocket_seeds
         (chain_id, pocket_address, loan_id, as_of_ledger, snapshot_ledger,
          supply_at_snapshot, held, released_total, burned_total, claimed_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING";

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PocketClaimRow {
    pub loan_id: BigDecimal,
    pub paid: BigDecimal,
    pub tx_hash: String,
    pub block_timestamp: i64,
}

#[derive(Clone)]
pub struct PocketRepo {
    pub pool: PgPool,
}

impl PocketRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_events(
        &self,
        chain_id: i64,
        pocket: &str,
    ) -> anyhow::Result<Vec<PocketEventRow>> {
        let rows: Vec<(BigDecimal, String, i64, i32, i64, serde_json::Value)> =
            sqlx::query_as(LIST_EVENTS_SQL)
                .bind(chain_id)
                .bind(pocket)
                .fetch_all(&self.pool)
                .await?;
        Ok(rows
            .into_iter()
            .map(
                |(loan_id, event_name, block_number, log_index, block_timestamp, params)| {
                    PocketEventRow {
                        loan_id,
                        event_name,
                        block_number,
                        log_index: i64::from(log_index),
                        block_timestamp,
                        params,
                    }
                },
            )
            .collect())
    }

    pub async fn list_claim_totals(
        &self,
        chain_id: i64,
        pocket: &str,
    ) -> anyhow::Result<Vec<PocketClaimTotals>> {
        let rows = sqlx::query_as::<_, PocketClaimTotals>(LIST_CLAIM_TOTALS_SQL)
            .bind(chain_id)
            .bind(pocket)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    pub async fn list_seeds(
        &self,
        chain_id: i64,
        pocket: &str,
    ) -> anyhow::Result<Vec<PocketSeedRow>> {
        let rows = sqlx::query_as::<_, PocketSeedRow>(LIST_SEEDS_SQL)
            .bind(chain_id)
            .bind(pocket)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    pub async fn list_holder_claims(
        &self,
        chain_id: i64,
        pocket: &str,
        holder: &str,
    ) -> anyhow::Result<Vec<PocketClaimRow>> {
        let rows = sqlx::query_as::<_, PocketClaimRow>(LIST_HOLDER_CLAIMS_SQL)
            .bind(chain_id)
            .bind(pocket)
            .bind(holder)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows)
    }

    pub async fn list_seed_candidates(
        &self,
        chain_id: i64,
        registry: &str,
        pocket: &str,
    ) -> anyhow::Result<Vec<u32>> {
        let rows: Vec<(BigDecimal,)> = sqlx::query_as(LIST_SEED_CANDIDATES_SQL)
            .bind(chain_id)
            .bind(registry)
            .bind(pocket)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|(id,)| id.to_string().parse::<u32>().ok())
            .collect())
    }

    pub async fn insert_seed(
        &self,
        chain_id: i64,
        pocket: &str,
        seed: &PocketSeedRow,
    ) -> anyhow::Result<bool> {
        let result = sqlx::query(INSERT_SEED_SQL)
            .bind(chain_id)
            .bind(pocket)
            .bind(&seed.loan_id)
            .bind(seed.as_of_ledger)
            .bind(seed.snapshot_ledger)
            .bind(&seed.supply_at_snapshot)
            .bind(&seed.held)
            .bind(&seed.released_total)
            .bind(&seed.burned_total)
            .bind(&seed.claimed_total)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }
}
