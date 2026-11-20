// spec: docs/references/access-manager-events.md#evm-sync-loop
use std::time::Instant;

use alloy::primitives::Address;
use anyhow::Result;
use async_trait::async_trait;

use shared::access_manager_repo::{
    AccessManagerRepo, AmLogRow, NewScheduledOp, OpWrite, OP_EVENT_CANCELED, OP_EVENT_EXECUTED,
    OP_EVENT_SCHEDULED,
};

use crate::indexer::access_manager_evm_parsers::{
    decode_call, hash_operation, loan_ref, EvmExecutedRow, EvmScheduledRow, EvmTargets,
};
use crate::indexer::access_manager_sync::{
    cancel_write, loan_columns, run_sync_loop, sync_rows, unparsable_row, AmRowResolver,
    AmSyncStore, RepoStore, Retry,
};
use crate::indexer::supervise::KeyedBackoff;

#[derive(Debug, Clone)]
pub struct EvmAmSyncConfig {
    pub contract_id: String,
    pub targets: EvmTargets,
}

pub struct EvmRowResolver<'a> {
    cfg: &'a EvmAmSyncConfig,
}

impl<'a> EvmRowResolver<'a> {
    pub fn new(cfg: &'a EvmAmSyncConfig) -> Self {
        Self { cfg }
    }
}

fn calldata_bytes(raw: &str) -> Option<Vec<u8>> {
    let bytes = hex::decode(raw.strip_prefix("0x")?).ok()?;
    (bytes.len() >= 4).then_some(bytes)
}

async fn resolve_schedule(
    row: &AmLogRow,
    cfg: &EvmAmSyncConfig,
    store: &dyn AmSyncStore,
) -> Result<OpWrite, Retry> {
    let Some(sched) = EvmScheduledRow::from_params(&row.params) else {
        return Ok(unparsable_row(row));
    };
    let parsed = (
        sched.caller.parse::<Address>(),
        sched.target.parse::<Address>(),
        calldata_bytes(&sched.data),
    );
    let (Ok(caller), Ok(target), Some(data)) = parsed else {
        return Ok(unparsable_row(row));
    };
    let decoded = decode_call(target, &data, &cfg.targets);
    let verified = hex::encode(hash_operation(caller, target, &data)) == sched.operation_id;
    let mut calldata = None;
    let mut args_json = None;
    let mut loan_id = None;
    let mut record_id = None;
    if verified {
        calldata = Some(format!("0x{}", hex::encode(&data)));
        args_json = decoded.args_json.clone();
        if let Some(args) = &decoded.args {
            let reference = loan_ref(target, &decoded.function, args, &cfg.targets);
            let security = cfg.targets.security_registry.map(|a| a.to_checksum(None));
            (loan_id, record_id) = loan_columns(reference, security.as_deref(), store).await?;
        }
    } else {
        tracing::warn!(log_id = row.id, tx_hash = %row.tx_hash, operation_id = %sched.operation_id, "no schedule reproduces the operation id; args not stored");
    }
    Ok(OpWrite::Schedule(NewScheduledOp {
        operation_id: sched.operation_id,
        nonce: sched.nonce,
        caller: sched.caller,
        target: sched.target,
        function: decoded.function,
        args_xdr: None,
        calldata,
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

fn resolve_execute(row: &AmLogRow) -> OpWrite {
    match EvmExecutedRow::from_params(&row.params) {
        Some(exec) => OpWrite::Execute {
            ids: vec![exec.operation_id],
            tx_hash: row.tx_hash.clone(),
            ledger: row.block_number,
        },
        None => unparsable_row(row),
    }
}

#[async_trait]
impl AmRowResolver for EvmRowResolver<'_> {
    async fn resolve(&mut self, row: &AmLogRow, store: &dyn AmSyncStore) -> Result<OpWrite, Retry> {
        match row.event_name.as_str() {
            OP_EVENT_SCHEDULED => resolve_schedule(row, self.cfg, store).await,
            OP_EVENT_CANCELED => Ok(cancel_write(row)),
            OP_EVENT_EXECUTED => Ok(resolve_execute(row)),
            _ => Ok(unparsable_row(row)),
        }
    }
}

pub async fn sync_once(
    store: &dyn AmSyncStore,
    cfg: &EvmAmSyncConfig,
    backoff: &mut KeyedBackoff<i64>,
    now: Instant,
) -> Result<usize> {
    let mut resolver = EvmRowResolver::new(cfg);
    sync_rows(store, &mut resolver, backoff, now).await
}

pub async fn run_access_manager_sync_loop(
    repo: AccessManagerRepo,
    chain_id: i64,
    cfg: EvmAmSyncConfig,
) -> Result<()> {
    let store = RepoStore {
        repo,
        chain_id,
        contract_id: cfg.contract_id.clone(),
    };
    let mut resolver = EvmRowResolver::new(&cfg);
    run_sync_loop(chain_id, &store, &mut resolver).await
}
