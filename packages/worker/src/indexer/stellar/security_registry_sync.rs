// spec: docs/references/security-registry-events.md#sync-loop
use std::sync::Arc;

use anyhow::Result;

use shared::db::EventRepo;
use shared::security_registry::STELLAR_SECURITY_PARAMS;
use shared::security_registry_repo::SecurityRegistryRepo;

pub use crate::indexer::security_registry_sync::*;
use crate::indexer::stellar::rpc::StellarRpc;
use crate::indexer::stellar::security_registry_views::RpcSecurityViewSource;

pub async fn run_security_registry_sync_loop(
    rpc: Arc<StellarRpc>,
    repo: SecurityRegistryRepo,
    events: EventRepo,
    chain_id: i64,
    contract_id: String,
    configured_loan_registry: Option<String>,
) -> Result<()> {
    run_security_sync_loop(
        RpcSecurityViewSource::new(rpc, contract_id.clone()),
        repo,
        events,
        chain_id,
        contract_id.clone(),
        vec![contract_id],
        configured_loan_registry,
        &STELLAR_SECURITY_PARAMS,
    )
    .await
}
