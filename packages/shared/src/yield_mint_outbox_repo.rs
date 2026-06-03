use anyhow::Result;
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

/// A row in the `yield_mint_outbox` table.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct YieldMintOutboxRow {
    pub chain_id: i64,
    pub yield_minter_address: String,
    pub loan_id: BigDecimal,
    pub repayment_id: BigDecimal,
    pub status: String,
    pub bitgo_tx_request_id: Option<String>,
    pub tx_hash: Option<String>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Composite key identifying a unique outbox row.
pub struct OutboxKey {
    pub chain_id: i64,
    pub yield_minter_address: String,
    pub loan_id: BigDecimal,
    pub repayment_id: BigDecimal,
}

/// Trait over the outbox state-mutation and list operations.
///
/// `YieldMintOutboxRepo` implements this trait, and `InMemoryOutbox` (test
/// helper) also implements it. Production code in `yield_mint/mod.rs` accepts
/// `&dyn OutboxStore` so it can be tested without a real DB.
///
/// `discover_pending` is intentionally NOT part of this trait because it joins
/// `contract_logs` — a DB-only operation — and is irrelevant to the in-memory
/// test store.
#[async_trait]
pub trait OutboxStore: Send + Sync {
    /// Return all rows in status `pending` for the given chain + minter,
    /// up to `limit` rows.
    async fn list_pending(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
        limit: i64,
    ) -> Result<Vec<YieldMintOutboxRow>>;

    /// Return all rows in status `submitted` for the given chain + minter,
    /// up to `limit` rows.
    async fn list_submitted(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
        limit: i64,
    ) -> Result<Vec<YieldMintOutboxRow>>;

    /// Transition a `pending` row to `submitted`.
    async fn mark_submitted(&self, key: &OutboxKey, bitgo_tx_request_id: &str) -> Result<()>;

    /// Transition a `submitted` row to `confirmed`.
    async fn mark_confirmed(&self, key: &OutboxKey, tx_hash: &str) -> Result<()>;

    /// Transition a `pending` or `submitted` row to `failed`.
    async fn mark_failed(&self, key: &OutboxKey, error: &str) -> Result<()>;

    /// Transition a `pending` row to `skipped_already_minted`.
    async fn mark_skipped_already_minted(&self, key: &OutboxKey) -> Result<()>;
}

/// Repository for the `yield_mint_outbox` table.
pub struct YieldMintOutboxRepo {
    pool: PgPool,
}

impl YieldMintOutboxRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Step A: INSERT pending rows for every `PaymentRecorded` event in
    /// `contract_logs` (filtered to `loan_registry_address_checksum`) that is
    /// not yet tracked in `yield_mint_outbox`.
    ///
    /// `loan_registry_address_checksum` must be an EIP-55 checksum address
    /// string (e.g. produced by `address.to_checksum(None)`), because the
    /// indexer stores `contract_address` in that format.
    ///
    /// Returns the number of rows inserted.
    pub async fn discover_pending(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
        loan_registry_address_checksum: &str,
    ) -> Result<usize> {
        let result = sqlx::query(
            r"
            INSERT INTO yield_mint_outbox
                (chain_id, yield_minter_address, loan_id, repayment_id, status)
            SELECT
                cl.chain_id,
                $1 AS yield_minter_address,
                (cl.params->>'loan_id')::numeric AS loan_id,
                (cl.params->'event'->>'repayment_id')::numeric AS repayment_id,
                'pending'
            FROM contract_logs cl
            WHERE cl.event_name = 'PaymentRecorded'
              AND cl.chain_id = $2
              AND cl.contract_address = $3
              AND NOT EXISTS (
                  SELECT 1 FROM yield_mint_outbox o
                  WHERE o.chain_id = cl.chain_id
                    AND o.yield_minter_address = $1
                    AND o.loan_id = (cl.params->>'loan_id')::numeric
                    AND o.repayment_id = (cl.params->'event'->>'repayment_id')::numeric
              )
            ON CONFLICT DO NOTHING
            ",
        )
        .bind(yield_minter_address)
        .bind(chain_id)
        .bind(loan_registry_address_checksum)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() as usize)
    }
}

#[async_trait]
impl OutboxStore for YieldMintOutboxRepo {
    async fn list_pending(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
        limit: i64,
    ) -> Result<Vec<YieldMintOutboxRow>> {
        let rows = sqlx::query_as::<_, YieldMintOutboxRow>(
            r"
            SELECT chain_id, yield_minter_address, loan_id, repayment_id,
                   status, bitgo_tx_request_id, tx_hash,
                   submitted_at, confirmed_at, last_error, created_at
            FROM yield_mint_outbox
            WHERE chain_id = $1
              AND yield_minter_address = $2
              AND status = 'pending'
            ORDER BY created_at
            LIMIT $3
            ",
        )
        .bind(chain_id)
        .bind(yield_minter_address)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn list_submitted(
        &self,
        chain_id: i64,
        yield_minter_address: &str,
        limit: i64,
    ) -> Result<Vec<YieldMintOutboxRow>> {
        let rows = sqlx::query_as::<_, YieldMintOutboxRow>(
            r"
            SELECT chain_id, yield_minter_address, loan_id, repayment_id,
                   status, bitgo_tx_request_id, tx_hash,
                   submitted_at, confirmed_at, last_error, created_at
            FROM yield_mint_outbox
            WHERE chain_id = $1
              AND yield_minter_address = $2
              AND status = 'submitted'
            ORDER BY submitted_at
            LIMIT $3
            ",
        )
        .bind(chain_id)
        .bind(yield_minter_address)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Transition a `pending` row to `submitted`.
    ///
    /// Checks `rows_affected()` and warns if 0 (row was not in `pending`
    /// state — possible concurrent update or stale read).
    async fn mark_submitted(&self, key: &OutboxKey, bitgo_tx_request_id: &str) -> Result<()> {
        let result = sqlx::query(
            r"
            UPDATE yield_mint_outbox
               SET status = 'submitted',
                   bitgo_tx_request_id = $1,
                   submitted_at = NOW()
             WHERE chain_id = $2
               AND yield_minter_address = $3
               AND loan_id = $4
               AND repayment_id = $5
               AND status = 'pending'
            ",
        )
        .bind(bitgo_tx_request_id)
        .bind(key.chain_id)
        .bind(&key.yield_minter_address)
        .bind(&key.loan_id)
        .bind(&key.repayment_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            tracing::warn!(
                chain_id = key.chain_id,
                loan_id = %key.loan_id,
                repayment_id = %key.repayment_id,
                "yield_mint: mark_submitted matched 0 rows (row not in pending state)"
            );
        }
        Ok(())
    }

    /// Transition a `submitted` row to `confirmed`.
    ///
    /// Checks `rows_affected()` and warns if 0 (row was not in `submitted`
    /// state).
    async fn mark_confirmed(&self, key: &OutboxKey, tx_hash: &str) -> Result<()> {
        let result = sqlx::query(
            r"
            UPDATE yield_mint_outbox
               SET status = 'confirmed',
                   tx_hash = $1,
                   confirmed_at = NOW()
             WHERE chain_id = $2
               AND yield_minter_address = $3
               AND loan_id = $4
               AND repayment_id = $5
               AND status = 'submitted'
            ",
        )
        .bind(tx_hash)
        .bind(key.chain_id)
        .bind(&key.yield_minter_address)
        .bind(&key.loan_id)
        .bind(&key.repayment_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            tracing::warn!(
                chain_id = key.chain_id,
                loan_id = %key.loan_id,
                repayment_id = %key.repayment_id,
                "yield_mint: mark_confirmed matched 0 rows (row not in submitted state)"
            );
        }
        Ok(())
    }

    /// Transition a `pending` or `submitted` row to `failed`, recording the
    /// error message.
    ///
    /// Checks `rows_affected()` and warns if 0 (row was not in an expected
    /// state).
    async fn mark_failed(&self, key: &OutboxKey, error: &str) -> Result<()> {
        let result = sqlx::query(
            r"
            UPDATE yield_mint_outbox
               SET status = 'failed',
                   last_error = $1
             WHERE chain_id = $2
               AND yield_minter_address = $3
               AND loan_id = $4
               AND repayment_id = $5
               AND status IN ('pending', 'submitted')
            ",
        )
        .bind(error)
        .bind(key.chain_id)
        .bind(&key.yield_minter_address)
        .bind(&key.loan_id)
        .bind(&key.repayment_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            tracing::warn!(
                chain_id = key.chain_id,
                loan_id = %key.loan_id,
                repayment_id = %key.repayment_id,
                "yield_mint: mark_failed matched 0 rows (row not in pending/submitted state)"
            );
        }
        Ok(())
    }

    /// Transition a `pending` row to `skipped_already_minted`.
    ///
    /// Checks `rows_affected()` and warns if 0 (row was not in `pending`
    /// state).
    async fn mark_skipped_already_minted(&self, key: &OutboxKey) -> Result<()> {
        let result = sqlx::query(
            r"
            UPDATE yield_mint_outbox
               SET status = 'skipped_already_minted'
             WHERE chain_id = $1
               AND yield_minter_address = $2
               AND loan_id = $3
               AND repayment_id = $4
               AND status = 'pending'
            ",
        )
        .bind(key.chain_id)
        .bind(&key.yield_minter_address)
        .bind(&key.loan_id)
        .bind(&key.repayment_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            tracing::warn!(
                chain_id = key.chain_id,
                loan_id = %key.loan_id,
                repayment_id = %key.repayment_id,
                "yield_mint: mark_skipped_already_minted matched 0 rows (row not in pending state)"
            );
        }
        Ok(())
    }
}
