// spec: docs/product-specs/deposits.md#wire-matching-by-payment-reference

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
    pub requested_bank_details_id: Option<i64>,
    pub matched_payment_details: Option<String>,
    pub matched_chain_id: Option<i64>,
    pub matched_receiver_address: Option<String>,
    pub matched_issued_at: Option<DateTime<Utc>>,
}

pub const COUNT_PENDING_BANK_DEPOSITS_SQL: &str = "SELECT COUNT(*) FROM lp_bank_deposits d \
     WHERE NOT d.is_minted \
       AND NOT EXISTS ( \
           SELECT 1 FROM contract_logs w \
           WHERE w.event_name = 'WireIn' \
             AND w.params @> jsonb_build_object('ref_hash', encode(d.ref_hash, 'hex')) \
       )";

macro_rules! joined_columns {
    () => {
        "d.id, d.lp_id, d.amount, d.payment_reference, d.ref_hash, d.occurred_at, \
         d.is_minted, d.recorded_by, d.created_at, d.requested_bank_details_id, \
         r.payment_details AS matched_payment_details, r.chain_id AS matched_chain_id, \
         r.receiver_address AS matched_receiver_address, r.created_at AS matched_issued_at"
    };
}

pub const LIST_FOR_LP_SQL: &str = concat!(
    "SELECT ",
    joined_columns!(),
    " FROM lp_bank_deposits d \
     LEFT JOIN lp_requested_bank_details r ON r.id = d.requested_bank_details_id \
     WHERE d.lp_id = $1 \
     ORDER BY d.occurred_at DESC, d.id DESC"
);

pub const INSERT_SQL: &str = concat!(
    "WITH d AS ( INSERT INTO lp_bank_deposits \
         (lp_id, amount, payment_reference, ref_hash, occurred_at, recorded_by, \
          requested_bank_details_id) \
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING * ) SELECT ",
    joined_columns!(),
    " FROM d LEFT JOIN lp_requested_bank_details r ON r.id = d.requested_bank_details_id"
);

macro_rules! pending_bank_deposits_filter {
    () => {
        "NOT d.is_minted \
         AND NOT EXISTS ( \
             SELECT 1 FROM contract_logs w \
              WHERE w.event_name = 'WireIn' \
                AND w.params @> jsonb_build_object('ref_hash', encode(d.ref_hash, 'hex')) \
                AND ( NOT (w.params @> jsonb_build_object('receiver', w.contract_address)) \
                      OR EXISTS ( \
                          SELECT 1 FROM contract_logs a \
                           WHERE a.chain_id         = w.chain_id \
                             AND a.contract_address = w.contract_address \
                             AND a.event_name       = 'WireInAssigned' \
                             AND a.params->>'id'    = w.params->>'id' ) ) \
         ) \
         AND ( SELECT e.event_name FROM contract_logs e \
                WHERE e.event_name IN ('WireIn', 'WireInReturned') \
                  AND e.params @> jsonb_build_object('ref_hash', encode(d.ref_hash, 'hex')) \
                ORDER BY e.block_timestamp DESC, e.id DESC LIMIT 1 ) \
               IS DISTINCT FROM 'WireInReturned'"
    };
}

pub const PENDING_BANK_DEPOSITS_FOR_LP_SQL: &str = concat!(
    "SELECT COALESCE(SUM(d.amount), 0) FROM lp_bank_deposits d WHERE d.lp_id = $1 AND ",
    pending_bank_deposits_filter!()
);

pub const PENDING_BANK_DEPOSITS_ALL_SQL: &str = concat!(
    "SELECT COUNT(*), COALESCE(SUM(d.amount), 0) FROM lp_bank_deposits d WHERE ",
    pending_bank_deposits_filter!()
);

pub struct LpBankDepositRepo {
    pool: PgPool,
}

impl LpBankDepositRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert(
        conn: &mut PgConnection,
        lp_id: i64,
        amount: &BigDecimal,
        payment_reference: &str,
        ref_hash: &[u8],
        occurred_at: DateTime<Utc>,
        recorded_by: &str,
        requested_bank_details_id: Option<i64>,
    ) -> Result<LpBankDepositRow, sqlx::Error> {
        sqlx::query_as::<_, LpBankDepositRow>(INSERT_SQL)
            .bind(lp_id)
            .bind(amount)
            .bind(payment_reference)
            .bind(ref_hash)
            .bind(occurred_at)
            .bind(recorded_by)
            .bind(requested_bank_details_id)
            .fetch_one(&mut *conn)
            .await
    }

    pub async fn count_pending(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>(COUNT_PENDING_BANK_DEPOSITS_SQL)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn pending_bank_deposits_for_lp(
        &self,
        lp_id: i64,
    ) -> Result<BigDecimal, sqlx::Error> {
        sqlx::query_scalar(PENDING_BANK_DEPOSITS_FOR_LP_SQL)
            .bind(lp_id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn pending_bank_deposits_all(&self) -> Result<(i64, BigDecimal), sqlx::Error> {
        sqlx::query_as(PENDING_BANK_DEPOSITS_ALL_SQL)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn list_for_lp(&self, lp_id: i64) -> Result<Vec<LpBankDepositRow>, sqlx::Error> {
        sqlx::query_as::<_, LpBankDepositRow>(LIST_FOR_LP_SQL)
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
    ///
    /// "Straight to an LP" is `receiver != the minter itself`, which mirrors the
    /// contract's own branch verbatim: `record_wire_in` sets `Escrowed` iff
    /// `receiver == e.current_contract_address()` and otherwise stakes and sets
    /// `Direct` (pipeline-stellar-contracts `contracts/minter/src/lib.rs:120`; the
    /// EVM `MinterUpgradeable.recordWireIn` branches identically on `address(this)`).
    /// Should either contract ever escrow to a dedicated address instead, this test
    /// silently becomes wrong in the dangerous direction — escrowed wires would
    /// pass it and be marked minted, and nothing ever clears the flag.
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
