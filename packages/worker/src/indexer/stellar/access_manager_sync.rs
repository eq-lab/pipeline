// spec: docs/references/access-manager-events.md#sync-loop
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use stellar_xdr::curr::{Limits, WriteXdr};

use shared::access_manager_repo::{
    AccessManagerRepo, AmLogRow, NewScheduledOp, OpWrite, OP_EVENT_CANCELED, OP_EVENT_EXECUTED,
    OP_EVENT_SCHEDULED,
};

use crate::indexer::access_manager_sync::{
    cancel_write, loan_columns, run_sync_loop, sync_rows, unparsable_row, AmRowResolver,
};
pub use crate::indexer::access_manager_sync::{
    AmSyncStore, RepoStore, Retry, ACCESS_MANAGER_SYNC_INTERVAL, CYCLE_BUDGET, ROWS_PER_CYCLE,
};
use crate::indexer::stellar::access_manager_parsers::{
    args_display_json, contract_invocations, execute_candidate_ids, loan_ref,
    recover_schedule_args, ExecutedRow, ScheduledRow, TargetIds,
};
use crate::indexer::stellar::rpc::{GetTransactionResponse, StellarRpc};
use crate::indexer::stellar::supervise::KeyedBackoff;

pub const TX_FETCH_TIMEOUT: Duration = Duration::from_secs(20);

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

#[derive(Debug, Clone)]
pub struct AmSyncConfig {
    pub contract_id: String,
    pub ids: TargetIds,
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

async fn resolve_schedule(
    row: &AmLogRow,
    cfg: &AmSyncConfig,
    store: &dyn AmSyncStore,
    tx: &dyn TxEnvelopeSource,
    cache: &mut HashMap<String, TxFetch>,
) -> Result<OpWrite, Retry> {
    let Some(sched) = ScheduledRow::from_params(&row.params) else {
        return Ok(unparsable_row(row));
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
        let reference = loan_ref(&sched.target, &sched.function, args, &cfg.ids);
        (loan_id, record_id) =
            loan_columns(reference, cfg.ids.security_registry.as_deref(), store).await?;
    }
    Ok(OpWrite::Schedule(NewScheduledOp {
        operation_id: sched.operation_id,
        nonce: sched.nonce,
        caller: sched.caller,
        target: sched.target,
        function: sched.function,
        args_xdr,
        calldata: None,
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
        return Ok(unparsable_row(row));
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

pub struct StellarRowResolver<'a> {
    tx: &'a dyn TxEnvelopeSource,
    cfg: &'a AmSyncConfig,
    cache: HashMap<String, TxFetch>,
}

impl<'a> StellarRowResolver<'a> {
    pub fn new(tx: &'a dyn TxEnvelopeSource, cfg: &'a AmSyncConfig) -> Self {
        Self {
            tx,
            cfg,
            cache: HashMap::new(),
        }
    }
}

#[async_trait]
impl AmRowResolver for StellarRowResolver<'_> {
    fn begin_cycle(&mut self) {
        self.cache.clear();
    }

    async fn resolve(&mut self, row: &AmLogRow, store: &dyn AmSyncStore) -> Result<OpWrite, Retry> {
        match row.event_name.as_str() {
            OP_EVENT_SCHEDULED => {
                resolve_schedule(row, self.cfg, store, self.tx, &mut self.cache).await
            }
            OP_EVENT_CANCELED => Ok(cancel_write(row)),
            OP_EVENT_EXECUTED => {
                resolve_execute(row, self.cfg, store, self.tx, &mut self.cache).await
            }
            _ => Ok(unparsable_row(row)),
        }
    }
}

pub async fn sync_once(
    store: &dyn AmSyncStore,
    tx: &dyn TxEnvelopeSource,
    cfg: &AmSyncConfig,
    backoff: &mut KeyedBackoff<i64>,
    now: Instant,
) -> Result<usize> {
    let mut resolver = StellarRowResolver::new(tx, cfg);
    sync_rows(store, &mut resolver, backoff, now).await
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
    let mut resolver = StellarRowResolver::new(&source, &cfg);
    run_sync_loop(chain_id, &store, &mut resolver).await
}
