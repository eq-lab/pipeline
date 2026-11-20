// spec: docs/references/backend.md#loanregistry-settings-sync
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use pipeline_worker::indexer::loan_registry_settings::{sync_once, MaxFeeBpsSink, MaxFeeBpsSource};

struct FakeSource(Result<u32, &'static str>);

#[async_trait]
impl MaxFeeBpsSource for FakeSource {
    async fn max_fee_bps(&self) -> Result<u32> {
        self.0.map_err(|e| anyhow!(e))
    }
}

#[derive(Default)]
struct FakeSink {
    stored: Mutex<Vec<(i64, String, u32)>>,
    fail: bool,
}

#[async_trait]
impl MaxFeeBpsSink for FakeSink {
    async fn store(&self, chain_id: i64, registry: &str, max_fee_bps: u32) -> Result<()> {
        if self.fail {
            return Err(anyhow!("db down"));
        }
        self.stored
            .lock()
            .unwrap()
            .push((chain_id, registry.to_owned(), max_fee_bps));
        Ok(())
    }
}

#[tokio::test]
async fn sync_once_stores_the_value_under_chain_and_registry() {
    let sink = FakeSink::default();
    let value = sync_once(&FakeSource(Ok(5_000)), &sink, 560_048, "0xReg")
        .await
        .unwrap();
    assert_eq!(value, 5_000);
    assert_eq!(
        *sink.stored.lock().unwrap(),
        vec![(560_048, "0xReg".to_owned(), 5_000)]
    );
}

#[tokio::test]
async fn source_error_stores_nothing() {
    let sink = FakeSink::default();
    let err = sync_once(&FakeSource(Err("rpc down")), &sink, 1, "R").await;
    assert!(err.is_err());
    assert!(sink.stored.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sink_error_is_returned() {
    let sink = FakeSink {
        fail: true,
        ..Default::default()
    };
    assert!(sync_once(&FakeSource(Ok(1)), &sink, 1, "R").await.is_err());
}
