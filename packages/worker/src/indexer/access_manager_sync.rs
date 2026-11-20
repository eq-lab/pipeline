// spec: docs/references/access-manager-events.md#sync-loop
use std::panic::AssertUnwindSafe;
use std::time::{Duration, Instant};

use anyhow::Result;
use async_trait::async_trait;
use futures::FutureExt;
use serde_json::Value;

use shared::access_manager_repo::{AccessManagerRepo, AmLogRow, OpWrite};

use crate::indexer::supervise::KeyedBackoff;

pub const ACCESS_MANAGER_SYNC_INTERVAL: Duration = Duration::from_secs(15);
pub const ROWS_PER_CYCLE: i64 = 200;
pub const CYCLE_BUDGET: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AmTopic {
    Scheduled,
    Canceled,
    Executed,
    AllowListed,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoanRef {
    Loan(u32),
    Record(u32),
    None,
}

pub fn str_param(v: &Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(str::to_owned)
}

pub fn num_param<T: std::str::FromStr>(v: &Value, key: &str) -> Option<T> {
    v.get(key)?.as_str()?.parse().ok()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanceledRow {
    pub operation_id: String,
    pub nonce: u32,
}

impl CanceledRow {
    pub fn from_params(p: &Value) -> Option<Self> {
        Some(Self {
            operation_id: str_param(p, "operation_id")?,
            nonce: num_param(p, "nonce")?,
        })
    }
}

#[derive(Debug)]
pub struct Retry(pub anyhow::Error);

impl From<anyhow::Error> for Retry {
    fn from(e: anyhow::Error) -> Self {
        Retry(e)
    }
}

#[async_trait]
pub trait AmSyncStore: Send + Sync {
    async fn watermark(&self) -> Result<i64>;
    async fn rows_after(&self, after_id: i64, limit: i64) -> Result<Vec<AmLogRow>>;
    async fn has_pending_call(&self, target: &str, function: &str, caller: &str) -> Result<bool>;
    async fn record_loan(&self, security_contract: &str, record_id: i64) -> Result<Option<i64>>;
    async fn apply(&self, log_id: i64, write: &OpWrite) -> Result<u64>;
}

#[async_trait]
pub trait AmRowResolver: Send {
    fn begin_cycle(&mut self) {}

    async fn resolve(&mut self, row: &AmLogRow, store: &dyn AmSyncStore) -> Result<OpWrite, Retry>;
}

pub struct RepoStore {
    pub repo: AccessManagerRepo,
    pub chain_id: i64,
    pub contract_id: String,
}

#[async_trait]
impl AmSyncStore for RepoStore {
    async fn watermark(&self) -> Result<i64> {
        self.repo
            .get_watermark(self.chain_id, &self.contract_id)
            .await
    }

    async fn rows_after(&self, after_id: i64, limit: i64) -> Result<Vec<AmLogRow>> {
        self.repo
            .list_rows_after(self.chain_id, &self.contract_id, after_id, limit)
            .await
    }

    async fn has_pending_call(&self, target: &str, function: &str, caller: &str) -> Result<bool> {
        self.repo
            .has_pending_call(self.chain_id, &self.contract_id, target, function, caller)
            .await
    }

    async fn record_loan(&self, security_contract: &str, record_id: i64) -> Result<Option<i64>> {
        self.repo
            .record_loan(self.chain_id, security_contract, record_id)
            .await
    }

    async fn apply(&self, log_id: i64, write: &OpWrite) -> Result<u64> {
        self.repo
            .apply(self.chain_id, &self.contract_id, log_id, write)
            .await
    }
}

pub fn unparsable_row(row: &AmLogRow) -> OpWrite {
    tracing::warn!(log_id = row.id, event_name = %row.event_name, "AccessManager row params did not parse; skipped");
    OpWrite::Skip
}

pub fn cancel_write(row: &AmLogRow) -> OpWrite {
    match CanceledRow::from_params(&row.params) {
        Some(c) => OpWrite::Cancel {
            operation_id: c.operation_id,
            nonce: c.nonce,
            tx_hash: row.tx_hash.clone(),
            ledger: row.block_number,
        },
        None => unparsable_row(row),
    }
}

pub async fn loan_columns(
    loan_ref: LoanRef,
    security_registry: Option<&str>,
    store: &dyn AmSyncStore,
) -> Result<(Option<i64>, Option<i64>), Retry> {
    let mut loan_id = None;
    let mut record_id = None;
    match loan_ref {
        LoanRef::Loan(n) => loan_id = Some(i64::from(n)),
        LoanRef::Record(r) => {
            record_id = Some(i64::from(r));
            if let Some(security) = security_registry {
                loan_id = store.record_loan(security, i64::from(r)).await?;
            }
        }
        LoanRef::None => {}
    }
    Ok((loan_id, record_id))
}

pub async fn sync_rows(
    store: &dyn AmSyncStore,
    resolver: &mut dyn AmRowResolver,
    backoff: &mut KeyedBackoff<i64>,
    now: Instant,
) -> Result<usize> {
    let after = store.watermark().await?;
    let rows = store.rows_after(after, ROWS_PER_CYCLE).await?;
    resolver.begin_cycle();
    let mut applied = 0;
    for row in rows {
        if !backoff.is_due(row.id, now) {
            break;
        }
        match resolver.resolve(&row, store).await {
            Ok(write) => {
                if let Err(e) = store.apply(row.id, &write).await {
                    backoff.record_failure(row.id, now);
                    if backoff.first_warning(row.id) {
                        tracing::warn!(log_id = row.id, error = %e, "AccessManager projection write failed; will retry");
                    } else {
                        tracing::debug!(log_id = row.id, error = %e, "AccessManager projection write failed; will retry");
                    }
                    break;
                }
                backoff.clear(row.id);
                applied += 1;
            }
            Err(Retry(e)) => {
                backoff.record_failure(row.id, now);
                if backoff.first_warning(row.id) {
                    tracing::warn!(log_id = row.id, tx_hash = %row.tx_hash, error = %e, "AccessManager row not resolved; will retry");
                } else {
                    tracing::debug!(log_id = row.id, tx_hash = %row.tx_hash, error = %e, "AccessManager row not resolved; will retry");
                }
                break;
            }
        }
    }
    Ok(applied)
}

async fn run_cycle(
    chain_id: i64,
    store: &dyn AmSyncStore,
    resolver: &mut dyn AmRowResolver,
    backoff: &mut KeyedBackoff<i64>,
) -> usize {
    let fut = sync_rows(store, resolver, backoff, Instant::now());
    match tokio::time::timeout(CYCLE_BUDGET, AssertUnwindSafe(fut).catch_unwind()).await {
        Ok(Ok(Ok(applied))) => applied,
        Ok(Ok(Err(e))) => {
            tracing::warn!(chain_id, error = %e, "access-manager-sync cycle failed");
            0
        }
        Ok(Err(_)) => {
            tracing::error!(chain_id, "access-manager-sync cycle panicked");
            0
        }
        Err(_) => {
            tracing::warn!(chain_id, "access-manager-sync cycle exceeded its budget");
            0
        }
    }
}

pub async fn run_sync_loop(
    chain_id: i64,
    store: &dyn AmSyncStore,
    resolver: &mut dyn AmRowResolver,
) -> Result<()> {
    let mut backoff: KeyedBackoff<i64> = KeyedBackoff::default();
    loop {
        let applied = run_cycle(chain_id, store, resolver, &mut backoff).await;
        if (applied as i64) < ROWS_PER_CYCLE {
            tokio::time::sleep(ACCESS_MANAGER_SYNC_INTERVAL).await;
        }
    }
}
