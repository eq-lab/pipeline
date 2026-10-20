mod deal_token_support;

use std::sync::{Arc, Mutex};

use alloy::{
    primitives::{Address, U256},
    rpc::types::{Filter, Log},
};
use async_trait::async_trait;
use deal_token_support::*;
use pipeline_worker::indexer::deal_token_parsers::parse_deal_token_transfer;
use pipeline_worker::indexer::deal_tokens::DealTokenRegistry;
use pipeline_worker::indexer::poller::{
    fetch_chunk_logs, DynamicAddressSource, LogFetcher, MAX_DYNAMIC_ADDRESSES_PER_REQUEST,
};

struct FakeFetcher {
    logs: Vec<Log>,
    calls: Mutex<Vec<Vec<Address>>>,
}

impl FakeFetcher {
    fn new(logs: Vec<Log>) -> Self {
        Self {
            logs,
            calls: Mutex::new(vec![]),
        }
    }

    fn calls(&self) -> Vec<Vec<Address>> {
        self.calls.lock().unwrap().clone()
    }
}

#[async_trait]
impl LogFetcher for FakeFetcher {
    async fn get_logs(
        &self,
        addresses: Vec<Address>,
        from: u64,
        to: u64,
    ) -> anyhow::Result<Vec<Log>> {
        self.calls.lock().unwrap().push(addresses.clone());
        Ok(self
            .logs
            .iter()
            .filter(|l| addresses.contains(&l.address()))
            .filter(|l| {
                let b = l.block_number.unwrap();
                b >= from && b <= to
            })
            .cloned()
            .collect())
    }

    async fn get_filtered_logs(&self, _filter: Filter) -> anyhow::Result<Vec<Log>> {
        Ok(vec![])
    }
}

fn sorted(mut v: Vec<Address>) -> Vec<Address> {
    v.sort();
    v
}

fn assert_no_empty_calls(f: &FakeFetcher) {
    assert!(f.calls().iter().all(|c| !c.is_empty()));
}

fn sources(reg: &Arc<DealTokenRegistry>) -> Vec<Arc<dyn DynamicAddressSource>> {
    vec![reg.clone() as Arc<dyn DynamicAddressSource>]
}

#[tokio::test]
async fn no_sources_one_call_static_only() {
    let f = FakeFetcher::new(vec![wire_in(10, 0)]);
    let logs = fetch_chunk_logs(&f, &[FACTORY, SPLUSD], &[], 0, 100)
        .await
        .unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(f.calls(), vec![vec![FACTORY, SPLUSD]]);
    assert_no_empty_calls(&f);
}

#[tokio::test]
async fn same_chunk_discovery_triggers_second_fetch() {
    let registered = deal_registered(U256::from(1u64), DEBT, CARGO, 10, 0);
    let mint = transfer(DEBT, Address::ZERO, HOLDER, 500, 10, 3);
    let f = FakeFetcher::new(vec![mint, registered]);
    let reg = Arc::new(DealTokenRegistry::new(FACTORY));
    let logs = fetch_chunk_logs(&f, &[FACTORY], &sources(&reg), 0, 100)
        .await
        .unwrap();

    let calls = f.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0], vec![FACTORY]);
    assert_eq!(sorted(calls[1].clone()), sorted(vec![DEBT, CARGO]));
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].log_index, Some(0));
    assert_eq!(logs[1].address(), DEBT);
    assert_no_empty_calls(&f);
}

#[tokio::test]
async fn seeded_registry_core_and_token_calls_are_separate() {
    let reg = Arc::new(DealTokenRegistry::new(FACTORY));
    reg.insert_deal("1", DEBT, CARGO);
    let f = FakeFetcher::new(vec![transfer(DEBT, Address::ZERO, HOLDER, 9, 20, 1)]);
    let logs = fetch_chunk_logs(&f, &[FACTORY], &sources(&reg), 0, 100)
        .await
        .unwrap();
    let calls = f.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0], vec![FACTORY]);
    assert_eq!(sorted(calls[1].clone()), sorted(vec![DEBT, CARGO]));
    assert_eq!(logs.len(), 1);
}

#[tokio::test]
async fn empty_registry_without_discovery_one_call() {
    let reg = Arc::new(DealTokenRegistry::new(FACTORY));
    let f = FakeFetcher::new(vec![wire_in(5, 0)]);
    fetch_chunk_logs(&f, &[FACTORY], &sources(&reg), 0, 100)
        .await
        .unwrap();
    assert_eq!(f.calls().len(), 1);
    assert_no_empty_calls(&f);
}

#[tokio::test]
async fn merged_logs_sorted_by_block_and_index() {
    let registered = deal_registered(U256::from(1u64), DEBT, CARGO, 10, 0);
    let synced = debt_synced(U256::from(1u64), 500, 0, 10, 3);
    let mint = transfer(DEBT, Address::ZERO, HOLDER, 500, 10, 2);
    let f = FakeFetcher::new(vec![registered, synced, mint]);
    let reg = Arc::new(DealTokenRegistry::new(FACTORY));
    let logs = fetch_chunk_logs(&f, &[FACTORY], &sources(&reg), 0, 100)
        .await
        .unwrap();
    let order: Vec<u64> = logs.iter().map(|l| l.log_index.unwrap()).collect();
    assert_eq!(order, vec![0, 2, 3]);
}

#[test]
fn transfer_from_unregistered_emitter_is_not_decoded() {
    let reg = DealTokenRegistry::new(FACTORY);
    reg.insert_deal("1", DEBT, CARGO);
    let log = transfer(SPLUSD, Address::ZERO, HOLDER, 1, 1, 0);
    let decoded = reg
        .lookup(&log.address())
        .and_then(|info| parse_deal_token_transfer(&log, &info));
    assert!(decoded.is_none());
}

fn token_addr(i: u64) -> Address {
    Address::left_padding_from(&(0x1000 + i).to_be_bytes())
}

fn seeded_registry(deals: u64) -> Arc<DealTokenRegistry> {
    let reg = Arc::new(DealTokenRegistry::new(FACTORY));
    for i in 0..deals {
        reg.insert_deal(&i.to_string(), token_addr(i * 2), token_addr(i * 2 + 1));
    }
    reg
}

struct FailingFetcher {
    calls: Mutex<usize>,
    fail_on: usize,
}

#[async_trait]
impl LogFetcher for FailingFetcher {
    async fn get_logs(&self, _: Vec<Address>, _: u64, _: u64) -> anyhow::Result<Vec<Log>> {
        let mut n = self.calls.lock().unwrap();
        *n += 1;
        if *n == self.fail_on {
            anyhow::bail!("address limit exceeded");
        }
        Ok(vec![])
    }

    async fn get_filtered_logs(&self, _filter: Filter) -> anyhow::Result<Vec<Log>> {
        Ok(vec![])
    }
}

#[tokio::test]
async fn many_tokens_are_batched_apart_from_core() {
    let deals = 40;
    let reg = seeded_registry(deals);
    let n = (deals * 2) as usize;
    let f = FakeFetcher::new(vec![]);
    fetch_chunk_logs(&f, &[FACTORY, SPLUSD], &sources(&reg), 0, 100)
        .await
        .unwrap();
    let calls = f.calls();
    let max = MAX_DYNAMIC_ADDRESSES_PER_REQUEST;
    assert_eq!(calls.len(), 1 + n.div_ceil(max));
    assert_eq!(calls[0], vec![FACTORY, SPLUSD]);
    let mut tokens = Vec::new();
    for c in &calls[1..] {
        assert!(c.len() <= max && !c.is_empty());
        assert!(!c.contains(&FACTORY) && !c.contains(&SPLUSD));
        tokens.extend(c.iter().copied());
    }
    assert_eq!(tokens.len(), n);
    assert_eq!(
        sorted(tokens),
        sorted((0..n as u64).map(token_addr).collect())
    );
    assert_no_empty_calls(&f);
}

#[tokio::test]
async fn empty_core_with_tokens_skips_core_call() {
    let reg = seeded_registry(2);
    let f = FakeFetcher::new(vec![]);
    fetch_chunk_logs(&f, &[], &sources(&reg), 0, 100)
        .await
        .unwrap();
    assert_eq!(f.calls().len(), 1);
    assert_no_empty_calls(&f);
}

#[tokio::test]
async fn token_batch_failure_fails_the_chunk() {
    let reg = seeded_registry(40);
    let f = FailingFetcher {
        calls: Mutex::new(0),
        fail_on: 3,
    };
    let res = fetch_chunk_logs(&f, &[FACTORY], &sources(&reg), 0, 100).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn core_failure_fails_the_chunk() {
    let reg = seeded_registry(1);
    let f = FailingFetcher {
        calls: Mutex::new(0),
        fail_on: 1,
    };
    let res = fetch_chunk_logs(&f, &[FACTORY], &sources(&reg), 0, 100).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn ordering_preserved_across_core_and_token_batches() {
    let reg = seeded_registry(30);
    let late = token_addr(59);
    let early = token_addr(0);
    let logs = vec![
        transfer(late, Address::ZERO, HOLDER, 1, 10, 1),
        wire_in(10, 2),
        transfer(early, Address::ZERO, HOLDER, 1, 10, 0),
        transfer(early, Address::ZERO, HOLDER, 1, 5, 7),
    ];
    let f = FakeFetcher::new(logs);
    let out = fetch_chunk_logs(&f, &[FACTORY, SPLUSD], &sources(&reg), 0, 100)
        .await
        .unwrap();
    let order: Vec<(u64, u64)> = out
        .iter()
        .map(|l| (l.block_number.unwrap(), l.log_index.unwrap()))
        .collect();
    assert_eq!(order, vec![(5, 7), (10, 0), (10, 1), (10, 2)]);
}
