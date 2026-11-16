// spec: docs/references/access-manager-events.md#sync-loop
use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::FutureExt;
use stellar_xdr::curr::{Limits, WriteXdr};

use shared::access_manager_repo::{
    AccessManagerRepo, AmLogRow, NewScheduledOp, OpWrite, OP_EVENT_CANCELED, OP_EVENT_EXECUTED,
    OP_EVENT_SCHEDULED,
};

use crate::indexer::stellar::access_manager_parsers::{
    args_display_json, contract_invocations, execute_candidate_ids, loan_ref,
    recover_schedule_args, CanceledRow, ExecutedRow, LoanRef, ScheduledRow, TargetIds,
};
use crate::indexer::stellar::rpc::{GetTransactionResponse, StellarRpc};
use crate::indexer::stellar::supervise::KeyedBackoff;

pub const ACCESS_MANAGER_SYNC_INTERVAL: Duration = Duration::from_secs(15);
pub const ROWS_PER_CYCLE: i64 = 200;
pub const TX_FETCH_TIMEOUT: Duration = Duration::from_secs(20);
pub const CYCLE_BUDGET: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TxFetch {
    Found(String),
    BeyondRetention,
    NotYet,
}

#[async_trait]
pub trait TxEnvelopeSource: Send + Sync {
    async fn fetch(&self, tx_hash: &str, row_ledger: i64) -> Result<TxFetch>;
}

#[async_trait]
pub trait AmSyncStore: Send + Sync {
    async fn watermark(&self) -> Result<i64>;
    async fn rows_after(&self, after_id: i64, limit: i64) -> Result<Vec<AmLogRow>>;
    async fn has_pending_call(&self, target: &str, function: &str, caller: &str) -> Result<bool>;
    async fn record_loan(&self, security_contract: &str, record_id: i64) -> Result<Option<i64>>;
    async fn apply(&self, log_id: i64, write: &OpWrite) -> Result<u64>;
}

#[derive(Debug, Clone)]
pub struct AmSyncConfig {
    pub contract_id: String,
    pub ids: TargetIds,
}

#[derive(Debug)]
pub struct Retry(pub anyhow::Error);

impl From<anyhow::Error> for Retry {
    fn from(e: anyhow::Error) -> Self {
        Retry(e)
    }
}

pub fn classify_transaction(resp: &GetTransactionResponse, row_ledger: i64) -> Result<TxFetch> {
    match resp.status.as_str() {
        "SUCCESS" => match &resp.envelope_xdr_base64 {
            Some(env) => Ok(TxFetch::Found(env.clone())),
            None => Err(anyhow!("getTransaction SUCCESS without envelopeXdr")),
        },
        "NOT_FOUND" => match resp.oldest_ledger {
            Some(oldest) if row_ledger < oldest as i64 => Ok(TxFetch::BeyondRetention),
            _ => Ok(TxFetch::NotYet),
        },
        other => Err(anyhow!("getTransaction returned status {other}")),
    }
}

pub struct RpcTxSource {
    pub rpc: Arc<StellarRpc>,
}

#[async_trait]
impl TxEnvelopeSource for RpcTxSource {
    async fn fetch(&self, tx_hash: &str, row_ledger: i64) -> Result<TxFetch> {
        let resp = tokio::time::timeout(TX_FETCH_TIMEOUT, self.rpc.get_transaction(tx_hash))
            .await
            .map_err(|_| anyhow!("getTransaction timed out"))??;
        classify_transaction(&resp, row_ledger)
    }
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

async fn fetch_cached(
    row: &AmLogRow,
    tx: &dyn TxEnvelopeSource,
    cache: &mut HashMap<String, TxFetch>,
) -> Result<TxFetch, Retry> {
    if let Some(hit) = cache.get(&row.tx_hash) {
        return Ok(hit.clone());
    }
    let fetched = tx.fetch(&row.tx_hash, row.block_number).await?;
    cache.insert(row.tx_hash.clone(), fetched.clone());
    Ok(fetched)
}

fn unparsable(row: &AmLogRow) -> OpWrite {
    tracing::warn!(log_id = row.id, event_name = %row.event_name, "AccessManager row params did not parse; skipped");
    OpWrite::Skip
}

async fn resolve_schedule(
    row: &AmLogRow,
    cfg: &AmSyncConfig,
    store: &dyn AmSyncStore,
    tx: &dyn TxEnvelopeSource,
    cache: &mut HashMap<String, TxFetch>,
) -> Result<OpWrite, Retry> {
    let Some(sched) = ScheduledRow::from_params(&row.params) else {
        return Ok(unparsable(row));
    };
    let args = match fetch_cached(row, tx, cache).await? {
        TxFetch::NotYet => {
            return Err(Retry(anyhow!(
                "transaction {} not yet available",
                row.tx_hash
            )))
        }
        TxFetch::BeyondRetention => {
            tracing::warn!(log_id = row.id, tx_hash = %row.tx_hash, "schedule transaction left RPC retention; args not recoverable");
            None
        }
        TxFetch::Found(envelope) => {
            let candidates = contract_invocations(&envelope, &cfg.contract_id, "schedule");
            let recovered = recover_schedule_args(&sched, &candidates);
            if recovered.is_none() {
                tracing::warn!(log_id = row.id, tx_hash = %row.tx_hash, operation_id = %sched.operation_id, "no schedule invocation reproduces the operation id; args not stored");
            }
            recovered
        }
    };
    let mut loan_id = None;
    let mut record_id = None;
    let mut args_xdr = None;
    let mut args_json = None;
    if let Some(args) = &args {
        args_xdr = args.to_xdr_base64(Limits::none()).ok();
        args_json = Some(args_display_json(args));
        match loan_ref(&sched.target, &sched.function, args, &cfg.ids) {
            LoanRef::Loan(n) => loan_id = Some(i64::from(n)),
            LoanRef::Record(r) => {
                record_id = Some(i64::from(r));
                if let Some(security) = &cfg.ids.security_registry {
                    loan_id = store.record_loan(security, i64::from(r)).await?;
                }
            }
            LoanRef::None => {}
        }
    }
    Ok(OpWrite::Schedule(NewScheduledOp {
        operation_id: sched.operation_id,
        nonce: sched.nonce,
        caller: sched.caller,
        target: sched.target,
        function: sched.function,
        args_xdr,
        args_json,
        ready_at: sched.when,
        loan_id,
        record_id,
        schedule_tx_hash: row.tx_hash.clone(),
        schedule_ledger: row.block_number,
        scheduled_at: row.block_timestamp,
        source_log_id: row.id,
    }))
}

async fn resolve_execute(
    row: &AmLogRow,
    cfg: &AmSyncConfig,
    store: &dyn AmSyncStore,
    tx: &dyn TxEnvelopeSource,
    cache: &mut HashMap<String, TxFetch>,
) -> Result<OpWrite, Retry> {
    let Some(exec) = ExecutedRow::from_params(&row.params) else {
        return Ok(unparsable(row));
    };
    if !store
        .has_pending_call(&exec.target, &exec.function, &exec.caller)
        .await?
    {
        return Ok(OpWrite::Skip);
    }
    match fetch_cached(row, tx, cache).await? {
        TxFetch::NotYet => Err(Retry(anyhow!(
            "transaction {} not yet available",
            row.tx_hash
        ))),
        TxFetch::BeyondRetention => {
            tracing::warn!(log_id = row.id, tx_hash = %row.tx_hash, "execute transaction left RPC retention; pending row left unchanged");
            Ok(OpWrite::Skip)
        }
        TxFetch::Found(envelope) => {
            let candidates = contract_invocations(&envelope, &cfg.contract_id, "execute");
            let ids: Vec<String> = execute_candidate_ids(&exec, &candidates)
                .iter()
                .map(hex::encode)
                .collect();
            if ids.is_empty() {
                tracing::debug!(log_id = row.id, "execute matches no scheduled operation");
                return Ok(OpWrite::Skip);
            }
            Ok(OpWrite::Execute {
                ids,
                tx_hash: row.tx_hash.clone(),
                ledger: row.block_number,
            })
        }
    }
}

async fn resolve_row(
    row: &AmLogRow,
    cfg: &AmSyncConfig,
    store: &dyn AmSyncStore,
    tx: &dyn TxEnvelopeSource,
    cache: &mut HashMap<String, TxFetch>,
) -> Result<OpWrite, Retry> {
    match row.event_name.as_str() {
        OP_EVENT_SCHEDULED => resolve_schedule(row, cfg, store, tx, cache).await,
        OP_EVENT_CANCELED => Ok(match CanceledRow::from_params(&row.params) {
            Some(c) => OpWrite::Cancel {
                operation_id: c.operation_id,
                nonce: c.nonce,
                tx_hash: row.tx_hash.clone(),
                ledger: row.block_number,
            },
            None => unparsable(row),
        }),
        OP_EVENT_EXECUTED => resolve_execute(row, cfg, store, tx, cache).await,
        _ => Ok(unparsable(row)),
    }
}

pub async fn sync_once(
    store: &dyn AmSyncStore,
    tx: &dyn TxEnvelopeSource,
    cfg: &AmSyncConfig,
    backoff: &mut KeyedBackoff<i64>,
    now: Instant,
) -> Result<usize> {
    let after = store.watermark().await?;
    let rows = store.rows_after(after, ROWS_PER_CYCLE).await?;
    let mut cache: HashMap<String, TxFetch> = HashMap::new();
    let mut applied = 0;
    for row in rows {
        if !backoff.is_due(row.id, now) {
            break;
        }
        match resolve_row(&row, cfg, store, tx, &mut cache).await {
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
    tx: &dyn TxEnvelopeSource,
    cfg: &AmSyncConfig,
    backoff: &mut KeyedBackoff<i64>,
) -> usize {
    let fut = sync_once(store, tx, cfg, backoff, Instant::now());
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

pub async fn run_access_manager_sync_loop(
    rpc: Arc<StellarRpc>,
    repo: AccessManagerRepo,
    chain_id: i64,
    contract_id: String,
    ids: TargetIds,
) -> Result<()> {
    let store = RepoStore {
        repo,
        chain_id,
        contract_id: contract_id.clone(),
    };
    let source = RpcTxSource { rpc };
    let cfg = AmSyncConfig { contract_id, ids };
    let mut backoff: KeyedBackoff<i64> = KeyedBackoff::default();
    loop {
        let applied = run_cycle(chain_id, &store, &source, &cfg, &mut backoff).await;
        if (applied as i64) < ROWS_PER_CYCLE {
            tokio::time::sleep(ACCESS_MANAGER_SYNC_INTERVAL).await;
        }
    }
}
