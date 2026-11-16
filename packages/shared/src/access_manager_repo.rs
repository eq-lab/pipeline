// spec: docs/references/access-manager-events.md#table
use serde_json::Value;
use sqlx::PgPool;

pub const EXPIRATION_SECS: i64 = 604_800;

pub const OP_EVENT_SCHEDULED: &str = "AccessManagerOperationScheduled";
pub const OP_EVENT_CANCELED: &str = "AccessManagerOperationCanceled";
pub const OP_EVENT_EXECUTED: &str = "AccessManagerOperationExecuted";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpStatus {
    Pending,
    Executed,
    Canceled,
}

impl OpStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            OpStatus::Pending => "pending",
            OpStatus::Executed => "executed",
            OpStatus::Canceled => "canceled",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AmLogRow {
    pub id: i64,
    pub event_name: String,
    pub block_number: i64,
    pub tx_hash: String,
    pub log_index: i64,
    pub block_timestamp: i64,
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewScheduledOp {
    pub operation_id: String,
    pub nonce: u32,
    pub caller: String,
    pub target: String,
    pub function: String,
    pub args_xdr: Option<String>,
    pub args_json: Option<Value>,
    pub ready_at: u64,
    pub loan_id: Option<i64>,
    pub record_id: Option<i64>,
    pub schedule_tx_hash: String,
    pub schedule_ledger: i64,
    pub scheduled_at: i64,
    pub source_log_id: i64,
}

impl NewScheduledOp {
    pub fn expires_at(&self) -> i64 {
        self.ready_at as i64 + EXPIRATION_SECS
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum OpWrite {
    Schedule(NewScheduledOp),
    Cancel {
        operation_id: String,
        nonce: u32,
        tx_hash: String,
        ledger: i64,
    },
    Execute {
        ids: Vec<String>,
        tx_hash: String,
        ledger: i64,
    },
    Skip,
}

pub const GET_WATERMARK_SQL: &str = "SELECT last_log_id FROM access_manager_sync_state
     WHERE chain_id = $1 AND contract_address = $2";

pub const LIST_ROWS_AFTER_SQL: &str = "SELECT id, event_name, block_number, tx_hash, log_index,
            block_timestamp, params
     FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND id > $3
       AND event_name IN ('AccessManagerOperationScheduled',
                          'AccessManagerOperationCanceled',
                          'AccessManagerOperationExecuted')
     ORDER BY id
     LIMIT $4";

pub const HAS_PENDING_CALL_SQL: &str = "SELECT EXISTS (
         SELECT 1 FROM access_manager_operations
         WHERE chain_id = $1
           AND contract_address = $2
           AND target = $3
           AND function = $4
           AND caller = $5
           AND status = 'pending')";

pub const RECORD_LOAN_SQL: &str = "SELECT loan_id FROM security_records
     WHERE chain_id = $1 AND contract_address = $2 AND record_id = $3
     UNION ALL
     SELECT (params->>'loan_id')::bigint FROM contract_logs
     WHERE chain_id = $1
       AND contract_address = $2
       AND event_name = 'SecurityRecordRegistered'
       AND (params->>'record_id')::bigint = $3
       AND params->>'loan_id' IS NOT NULL
     UNION ALL
     SELECT loan_id FROM security_view_snapshots
     WHERE chain_id = $1
       AND contract_address = $2
       AND kind = 'record'
       AND entity_id = $3
       AND loan_id IS NOT NULL
     LIMIT 1";

pub const INSERT_SCHEDULED_SQL: &str = "INSERT INTO access_manager_operations
         (chain_id, contract_address, operation_id, nonce, caller, target, function,
          args_xdr, args_json, ready_at, expires_at, status, loan_id, record_id,
          schedule_tx_hash, schedule_ledger, scheduled_at, source_log_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $14, $15, $16, $17)
     ON CONFLICT (chain_id, contract_address, operation_id, nonce) DO NOTHING";

pub const MARK_CANCELED_SQL: &str = "UPDATE access_manager_operations
     SET status = 'canceled', closed_tx_hash = $5, closed_ledger = $6, updated_at = now()
     WHERE chain_id = $1
       AND contract_address = $2
       AND operation_id = $3
       AND nonce = $4
       AND status = 'pending'";

pub const MARK_EXECUTED_SQL: &str = "UPDATE access_manager_operations
     SET status = 'executed', closed_tx_hash = $4, closed_ledger = $5, updated_at = now()
     WHERE id = (
         SELECT id FROM access_manager_operations
         WHERE chain_id = $1
           AND contract_address = $2
           AND operation_id = $3
           AND status = 'pending'
         ORDER BY nonce DESC
         LIMIT 1)";

pub const ADVANCE_WATERMARK_SQL: &str = "INSERT INTO access_manager_sync_state
         (chain_id, contract_address, last_log_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (chain_id, contract_address) DO UPDATE
     SET last_log_id = GREATEST(access_manager_sync_state.last_log_id, EXCLUDED.last_log_id),
         updated_at = now()";

type LogTuple = (i64, String, i64, String, i32, i64, Value);

#[derive(Clone)]
pub struct AccessManagerRepo {
    pool: PgPool,
}

impl AccessManagerRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn get_watermark(&self, chain_id: i64, contract: &str) -> anyhow::Result<i64> {
        let row: Option<(i64,)> = sqlx::query_as(GET_WATERMARK_SQL)
            .bind(chain_id)
            .bind(contract)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map_or(0, |(id,)| id))
    }

    pub async fn list_rows_after(
        &self,
        chain_id: i64,
        contract: &str,
        after_id: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<AmLogRow>> {
        let rows: Vec<LogTuple> = sqlx::query_as(LIST_ROWS_AFTER_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(after_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(
                |(id, event_name, block_number, tx_hash, log_index, block_timestamp, params)| {
                    AmLogRow {
                        id,
                        event_name,
                        block_number,
                        tx_hash,
                        log_index: i64::from(log_index),
                        block_timestamp,
                        params,
                    }
                },
            )
            .collect())
    }

    pub async fn has_pending_call(
        &self,
        chain_id: i64,
        contract: &str,
        target: &str,
        function: &str,
        caller: &str,
    ) -> anyhow::Result<bool> {
        let (exists,): (bool,) = sqlx::query_as(HAS_PENDING_CALL_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(target)
            .bind(function)
            .bind(caller)
            .fetch_one(&self.pool)
            .await?;
        Ok(exists)
    }

    pub async fn record_loan(
        &self,
        chain_id: i64,
        security_contract: &str,
        record_id: i64,
    ) -> anyhow::Result<Option<i64>> {
        let row: Option<(i64,)> = sqlx::query_as(RECORD_LOAN_SQL)
            .bind(chain_id)
            .bind(security_contract)
            .bind(record_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|(loan,)| loan))
    }

    pub async fn apply(
        &self,
        chain_id: i64,
        contract: &str,
        log_id: i64,
        write: &OpWrite,
    ) -> anyhow::Result<u64> {
        let mut tx = self.pool.begin().await?;
        let affected = match write {
            OpWrite::Schedule(op) => sqlx::query(INSERT_SCHEDULED_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(&op.operation_id)
                .bind(i64::from(op.nonce))
                .bind(&op.caller)
                .bind(&op.target)
                .bind(&op.function)
                .bind(&op.args_xdr)
                .bind(&op.args_json)
                .bind(op.ready_at as i64)
                .bind(op.expires_at())
                .bind(op.loan_id)
                .bind(op.record_id)
                .bind(&op.schedule_tx_hash)
                .bind(op.schedule_ledger)
                .bind(op.scheduled_at)
                .bind(op.source_log_id)
                .execute(&mut *tx)
                .await?
                .rows_affected(),
            OpWrite::Cancel {
                operation_id,
                nonce,
                tx_hash,
                ledger,
            } => sqlx::query(MARK_CANCELED_SQL)
                .bind(chain_id)
                .bind(contract)
                .bind(operation_id)
                .bind(i64::from(*nonce))
                .bind(tx_hash)
                .bind(ledger)
                .execute(&mut *tx)
                .await?
                .rows_affected(),
            OpWrite::Execute {
                ids,
                tx_hash,
                ledger,
            } => {
                let mut total = 0;
                for id in ids {
                    total += sqlx::query(MARK_EXECUTED_SQL)
                        .bind(chain_id)
                        .bind(contract)
                        .bind(id)
                        .bind(tx_hash)
                        .bind(ledger)
                        .execute(&mut *tx)
                        .await?
                        .rows_affected();
                }
                total
            }
            OpWrite::Skip => 0,
        };
        sqlx::query(ADVANCE_WATERMARK_SQL)
            .bind(chain_id)
            .bind(contract)
            .bind(log_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(affected)
    }
}
