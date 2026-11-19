// spec: docs/references/backend.md#loanregistry-settings-sync
use std::sync::Arc;
use std::time::Duration;

use alloy::primitives::Address;
use anyhow::Result;
use async_trait::async_trait;
use sqlx::PgPool;

use super::loan_registry_reader::LoanRegistryReader;
use super::stellar::loan_registry_reader::read_max_fee_bps;
use super::stellar::rpc::StellarRpc;

pub const LOAN_REGISTRY_SETTINGS_INTERVAL: Duration = Duration::from_mins(1);

#[async_trait]
pub trait MaxFeeBpsSource: Send + Sync {
    async fn max_fee_bps(&self) -> Result<u32>;
}

#[async_trait]
pub trait MaxFeeBpsSink: Send + Sync {
    async fn store(&self, chain_id: i64, registry: &str, max_fee_bps: u32) -> Result<()>;
}

pub struct PgMaxFeeBpsSink(pub PgPool);

#[async_trait]
impl MaxFeeBpsSink for PgMaxFeeBpsSink {
    async fn store(&self, chain_id: i64, registry: &str, max_fee_bps: u32) -> Result<()> {
        shared::loan_registry_settings_repo::upsert_max_fee_bps(
            &self.0,
            chain_id,
            registry,
            max_fee_bps,
        )
        .await?;
        Ok(())
    }
}

pub struct EvmMaxFeeBpsSource {
    pub reader: LoanRegistryReader,
    pub registry: Address,
}

#[async_trait]
impl MaxFeeBpsSource for EvmMaxFeeBpsSource {
    async fn max_fee_bps(&self) -> Result<u32> {
        self.reader.max_fee_bps(&self.registry).await
    }
}

pub struct StellarMaxFeeBpsSource {
    pub rpc: Arc<StellarRpc>,
    pub registry_id: String,
}

#[async_trait]
impl MaxFeeBpsSource for StellarMaxFeeBpsSource {
    async fn max_fee_bps(&self) -> Result<u32> {
        read_max_fee_bps(&self.rpc, &self.registry_id).await
    }
}

pub async fn sync_once(
    source: &dyn MaxFeeBpsSource,
    sink: &dyn MaxFeeBpsSink,
    chain_id: i64,
    registry: &str,
) -> Result<u32> {
    let value = source.max_fee_bps().await?;
    sink.store(chain_id, registry, value).await?;
    Ok(value)
}

pub async fn run_loan_registry_settings_loop(
    source: &dyn MaxFeeBpsSource,
    sink: &dyn MaxFeeBpsSink,
    chain_id: i64,
    registry: String,
) {
    let mut last: Option<u32> = None;
    let mut failing = false;
    loop {
        match sync_once(source, sink, chain_id, &registry).await {
            Ok(value) => {
                failing = false;
                if last != Some(value) {
                    tracing::info!(chain_id, %registry, max_fee_bps = value, previous = ?last, "LoanRegistry max_fee_bps synced");
                    last = Some(value);
                }
            }
            Err(e) => {
                if failing {
                    tracing::debug!(chain_id, %registry, error = %e, "LoanRegistry max_fee_bps sync failed");
                } else {
                    tracing::warn!(chain_id, %registry, error = %e, "LoanRegistry max_fee_bps sync failed");
                    failing = true;
                }
            }
        }
        tokio::time::sleep(LOAN_REGISTRY_SETTINGS_INTERVAL).await;
    }
}
