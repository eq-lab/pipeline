// spec: docs/product-specs/loan-security-state.md#pending-operations
use std::collections::HashMap;

use serde::Serialize;
use shared::access_manager_repo::PendingOpRow;
use utoipa::ToSchema;

use crate::formatting::iso_utc_from_unix;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PendingOperationState {
    Waiting,
    Ready,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PendingTargetKind {
    LoanRegistry,
    Minter,
    SecurityRegistry,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PendingOperation {
    pub operation_id: String,
    pub nonce: u32,
    pub caller: String,
    pub target: String,
    pub target_kind: PendingTargetKind,
    pub function: String,
    pub args_xdr: String,
    #[schema(value_type = Vec<Object>)]
    pub args: serde_json::Value,
    pub ready_at: String,
    pub expires_at: String,
    pub state: PendingOperationState,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TargetScope<'a> {
    pub loan_registry: Option<&'a str>,
    pub minter: Option<&'a str>,
    pub security_registry: Option<&'a str>,
}

impl TargetScope<'_> {
    pub fn targets(&self) -> Vec<String> {
        [self.loan_registry, self.minter, self.security_registry]
            .into_iter()
            .flatten()
            .map(str::to_owned)
            .collect()
    }

    pub fn kind(&self, target: &str) -> PendingTargetKind {
        if self.loan_registry == Some(target) {
            PendingTargetKind::LoanRegistry
        } else if self.minter == Some(target) {
            PendingTargetKind::Minter
        } else if self.security_registry == Some(target) {
            PendingTargetKind::SecurityRegistry
        } else {
            PendingTargetKind::Other
        }
    }
}

pub fn pending_state(now: i64, ready_at: i64, expires_at: i64) -> PendingOperationState {
    if now < ready_at {
        PendingOperationState::Waiting
    } else if now >= expires_at {
        PendingOperationState::Expired
    } else {
        PendingOperationState::Ready
    }
}

pub fn pending_operation(
    row: &PendingOpRow,
    scope: &TargetScope<'_>,
    now: i64,
) -> Option<PendingOperation> {
    Some(PendingOperation {
        operation_id: row.operation_id.clone(),
        nonce: u32::try_from(row.nonce).ok()?,
        caller: row.caller.clone(),
        target: row.target.clone(),
        target_kind: scope.kind(&row.target),
        function: row.function.clone(),
        args_xdr: row.args_xdr.clone(),
        args: row.args_json.clone(),
        ready_at: iso_utc_from_unix(row.ready_at),
        expires_at: iso_utc_from_unix(row.expires_at),
        state: pending_state(now, row.ready_at, row.expires_at),
    })
}

pub fn group_by_loan(
    chain_id: i64,
    rows: &[PendingOpRow],
    scope: &TargetScope<'_>,
    now: i64,
) -> HashMap<(i64, String), Vec<PendingOperation>> {
    let sorted = sorted_rows(rows);
    let mut out: HashMap<(i64, String), Vec<PendingOperation>> = HashMap::new();
    for row in sorted {
        if let Some(op) = pending_operation(row, scope, now) {
            out.entry((chain_id, row.loan_id.to_string()))
                .or_default()
                .push(op);
        }
    }
    out
}

pub fn sorted_pending(
    rows: &[PendingOpRow],
    scope: &TargetScope<'_>,
    now: i64,
) -> Vec<PendingOperation> {
    let sorted = sorted_rows(rows);
    sorted
        .into_iter()
        .filter_map(|row| pending_operation(row, scope, now))
        .collect()
}

fn sorted_rows(rows: &[PendingOpRow]) -> Vec<&PendingOpRow> {
    let mut sorted: Vec<&PendingOpRow> = rows.iter().collect();
    sorted.sort_by(|a, b| {
        (a.ready_at, &a.operation_id, a.nonce).cmp(&(b.ready_at, &b.operation_id, b.nonce))
    });
    sorted
}
