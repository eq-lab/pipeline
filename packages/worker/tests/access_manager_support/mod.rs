// spec: docs/references/access-manager-events.md
#![allow(dead_code)]
use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use pipeline_worker::indexer::access_manager_sync::AmSyncStore;
use shared::access_manager_repo::{AmLogRow, NewScheduledOp, OpStatus, OpWrite};

#[derive(Debug, Clone, PartialEq)]
pub struct Op {
    pub new: NewScheduledOp,
    pub expires_at: i64,
    pub status: OpStatus,
    pub closed_tx_hash: Option<String>,
}

#[derive(Default)]
pub struct StoreState {
    pub rows: Vec<AmLogRow>,
    pub watermark: i64,
    pub ops: Vec<Op>,
    pub records: HashMap<i64, i64>,
    pub fail_apply: bool,
}

#[derive(Default)]
pub struct MemStore {
    pub state: Mutex<StoreState>,
}

impl MemStore {
    pub fn with_rows(rows: Vec<AmLogRow>) -> Self {
        let store = Self::default();
        store.state.lock().unwrap().rows = rows;
        store
    }

    pub fn ops(&self) -> Vec<Op> {
        self.state.lock().unwrap().ops.clone()
    }

    pub fn watermark_now(&self) -> i64 {
        self.state.lock().unwrap().watermark
    }

    pub fn reset_watermark(&self) {
        self.state.lock().unwrap().watermark = 0;
    }
}

fn newest_before<'a>(ops: &'a mut [Op], operation_id: &str, log_id: i64) -> Option<&'a mut Op> {
    ops.iter_mut()
        .filter(|o| o.new.operation_id == operation_id && o.new.source_log_id < log_id)
        .max_by_key(|o| (o.new.schedule_ledger, o.new.source_log_id))
}

#[async_trait]
impl AmSyncStore for MemStore {
    async fn watermark(&self) -> Result<i64> {
        Ok(self.state.lock().unwrap().watermark)
    }

    async fn rows_after(&self, after_id: i64, limit: i64) -> Result<Vec<AmLogRow>> {
        let s = self.state.lock().unwrap();
        let mut rows: Vec<AmLogRow> = s.rows.iter().filter(|r| r.id > after_id).cloned().collect();
        rows.sort_by_key(|r| r.id);
        rows.truncate(limit as usize);
        Ok(rows)
    }

    async fn has_pending_call(&self, target: &str, function: &str, caller: &str) -> Result<bool> {
        let s = self.state.lock().unwrap();
        Ok(s.ops.iter().any(|o| {
            o.status == OpStatus::Pending
                && o.new.target == target
                && o.new.function == function
                && o.new.caller == caller
        }))
    }

    async fn record_loan(&self, _security_contract: &str, record_id: i64) -> Result<Option<i64>> {
        Ok(self.state.lock().unwrap().records.get(&record_id).copied())
    }

    async fn apply(&self, log_id: i64, write: &OpWrite) -> Result<u64> {
        let mut s = self.state.lock().unwrap();
        if s.fail_apply {
            return Err(anyhow!("db down"));
        }
        let mut affected = 0;
        match write {
            OpWrite::Schedule(new) => {
                let exists = s.ops.iter().any(|o| {
                    o.new.operation_id == new.operation_id
                        && o.new.nonce == new.nonce
                        && o.new.schedule_ledger == new.schedule_ledger
                });
                if !exists {
                    s.ops.push(Op {
                        expires_at: new.expires_at(),
                        new: new.clone(),
                        status: OpStatus::Pending,
                        closed_tx_hash: None,
                    });
                    affected = 1;
                }
            }
            OpWrite::Cancel {
                operation_id,
                nonce,
                tx_hash,
                ..
            } => {
                if let Some(o) = newest_before(&mut s.ops, operation_id, log_id) {
                    if o.status == OpStatus::Pending && o.new.nonce == *nonce {
                        o.status = OpStatus::Canceled;
                        o.closed_tx_hash = Some(tx_hash.clone());
                        affected += 1;
                    }
                }
            }
            OpWrite::Execute { ids, tx_hash, .. } => {
                for id in ids {
                    if let Some(o) = newest_before(&mut s.ops, id, log_id) {
                        if o.status == OpStatus::Pending {
                            o.status = OpStatus::Executed;
                            o.closed_tx_hash = Some(tx_hash.clone());
                            affected += 1;
                        }
                    }
                }
            }
            OpWrite::Skip => {}
        }
        s.watermark = s.watermark.max(log_id);
        Ok(affected)
    }
}
