// spec: packages/shared/migrations/20261005000001_lp_bank_deposits_ref_hash.sql, Issue #1413

use anyhow::Result;
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LpBankDepositRow {
    pub id: i64,
    pub lp_id: i64,
    pub amount: BigDecimal,
    pub payment_reference: String,
    /// `sha256(payment_reference)` — the minter's `ref_hash: BytesN<32>`.
    pub ref_hash: Vec<u8>,
    pub occurred_at: DateTime<Utc>,
    /// Whether the PLUSD leg has been minted on Stellar. Nothing sets it yet.
    pub is_minted: bool,
    pub recorded_by: String,
    pub created_at: DateTime<Utc>,
}

const COLUMNS: &str = "id, lp_id, amount, payment_reference, ref_hash, occurred_at, \
                       is_minted, recorded_by, created_at";

pub struct LpBankDepositRepo {
    pool: PgPool,
}

impl LpBankDepositRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn insert(
        conn: &mut PgConnection,
        lp_id: i64,
        amount: &BigDecimal,
        payment_reference: &str,
        ref_hash: &[u8],
        occurred_at: DateTime<Utc>,
        recorded_by: &str,
    ) -> Result<LpBankDepositRow, sqlx::Error> {
        sqlx::query_as::<_, LpBankDepositRow>(&format!(
            "INSERT INTO lp_bank_deposits \
                 (lp_id, amount, payment_reference, ref_hash, occurred_at, recorded_by) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             RETURNING {COLUMNS}"
        ))
        .bind(lp_id)
        .bind(amount)
        .bind(payment_reference)
        .bind(ref_hash)
        .bind(occurred_at)
        .bind(recorded_by)
        .fetch_one(&mut *conn)
        .await
    }

    pub async fn list_for_lp(&self, lp_id: i64) -> Result<Vec<LpBankDepositRow>, sqlx::Error> {
        sqlx::query_as::<_, LpBankDepositRow>(&format!(
            "SELECT {COLUMNS} FROM lp_bank_deposits \
             WHERE lp_id = $1 \
             ORDER BY occurred_at DESC, id DESC"
        ))
        .bind(lp_id)
        .fetch_all(&self.pool)
        .await
    }
}

/// The store seam the relayer's wire-in matching phase works against (#1416),
/// so the phase can be tested without a database.
///
/// Every statement is scoped to both `chain_id` and the emitting
/// `contract_address` — on the `contract_logs` side only. `lp_bank_deposits`
/// has no chain column, so the deposit side is not scoped at all (TD-117).
/// The contract scope is not redundant: a minter redeploy
/// leaves the previous deployment's `WireIn` rows in `contract_logs`, and those
/// rows carry the *old* minter as `receiver` — so Rule A's `receiver <> minter`
/// test would be true for them and would mark every escrowed deposit of that
/// deployment minted.
#[async_trait]
pub trait WireInMatcher: Send + Sync {
    /// Rule A — a `WireIn` staked straight to an LP. Returns rows flipped.
    async fn mark_minted_direct(&self, chain_id: i64, minter_id: &str) -> Result<u64>;
    /// Rule B — an escrowed `WireIn` resolved by `WireInAssigned`. Returns rows flipped.
    async fn mark_minted_assigned(&self, chain_id: i64, minter_id: &str) -> Result<u64>;
    /// Indexed `WireIn` events from this minter whose `ref_hash` matches no deposit.
    async fn count_unmatched_wire_ins(&self, chain_id: i64, minter_id: &str) -> Result<i64>;
}

#[async_trait]
impl WireInMatcher for LpBankDepositRepo {
    async fn mark_minted_direct(&self, chain_id: i64, minter_id: &str) -> Result<u64> {
        let result = sqlx::query(
            "UPDATE lp_bank_deposits d \
                SET is_minted = true \
               FROM contract_logs l \
              WHERE l.chain_id         = $1 \
                AND l.contract_address = $2 \
                AND l.event_name       = 'WireIn' \
                AND l.params->>'receiver' <> $2 \
                AND d.ref_hash   = decode(l.params->>'ref_hash', 'hex') \
                AND NOT d.is_minted",
        )
        .bind(chain_id)
        .bind(minter_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    async fn mark_minted_assigned(&self, chain_id: i64, minter_id: &str) -> Result<u64> {
        let result = sqlx::query(
            "UPDATE lp_bank_deposits d \
                SET is_minted = true \
               FROM contract_logs a \
               JOIN contract_logs w \
                 ON  w.chain_id         = a.chain_id \
                 AND w.contract_address = a.contract_address \
                 AND w.event_name       = 'WireIn' \
                 AND w.params->>'id'    = a.params->>'id' \
              WHERE a.chain_id         = $1 \
                AND a.contract_address = $2 \
                AND a.event_name       = 'WireInAssigned' \
                AND d.ref_hash   = decode(w.params->>'ref_hash', 'hex') \
                AND NOT d.is_minted",
        )
        .bind(chain_id)
        .bind(minter_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    async fn count_unmatched_wire_ins(&self, chain_id: i64, minter_id: &str) -> Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM contract_logs l \
              WHERE l.chain_id         = $1 \
                AND l.contract_address = $2 \
                AND l.event_name       = 'WireIn' \
                AND NOT EXISTS ( \
                    SELECT 1 FROM lp_bank_deposits d \
                     WHERE d.ref_hash = decode(l.params->>'ref_hash', 'hex') \
                )",
        )
        .bind(chain_id)
        .bind(minter_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }
}
