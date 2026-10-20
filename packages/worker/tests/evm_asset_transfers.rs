// spec: docs/exec-plans/active/financial-apis-multichain.md (Part B — EVM sources)
mod deal_token_support;

use std::sync::Mutex;

use alloy::{
    primitives::{address, Address},
    rpc::types::{Filter, Log},
};
use async_trait::async_trait;
use deal_token_support::*;
use pipeline_worker::indexer::asset_transfers::{
    asset_transfer_filters, is_tracked_transfer, parse_asset_transfer, reject_asset_collision,
};
use pipeline_worker::indexer::config::EvmAssetTracking;
use pipeline_worker::indexer::poller::{fetch_filtered_logs, LogFetcher};

const USDC: Address = address!("a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
const OTHER_TOKEN: Address = address!("dac17f958d2ee523a2206206994597c13d831ec7");
const CUSTODY: Address = address!("c000000000000000000000000000000000000001");
const RAMP: Address = address!("a000000000000000000000000000000000000001");
const WALLET: Address = address!("b000000000000000000000000000000000000001");
const EXTERNAL: Address = address!("e000000000000000000000000000000000000001");

fn tracking(wallet: Option<Address>, tracked: Vec<Address>) -> EvmAssetTracking {
    EvmAssetTracking {
        asset: USDC,
        withdrawal_queue_wallet: wallet,
        tracked,
    }
}

fn matches(filter: &Filter, log: &Log) -> bool {
    if !filter.address.matches(&log.address()) {
        return false;
    }
    let topics = log.topics();
    filter
        .topics
        .iter()
        .enumerate()
        .all(|(i, set)| set.is_empty() || topics.get(i).is_some_and(|t| set.matches(t)))
}

struct FilterFetcher {
    logs: Vec<Log>,
    address_calls: Mutex<usize>,
    filter_calls: Mutex<Vec<(Option<u64>, Option<u64>)>>,
}

impl FilterFetcher {
    fn new(logs: Vec<Log>) -> Self {
        Self {
            logs,
            address_calls: Mutex::new(0),
            filter_calls: Mutex::new(vec![]),
        }
    }
}

#[async_trait]
impl LogFetcher for FilterFetcher {
    async fn get_logs(&self, _: Vec<Address>, _: u64, _: u64) -> anyhow::Result<Vec<Log>> {
        *self.address_calls.lock().unwrap() += 1;
        Ok(vec![])
    }

    async fn get_filtered_logs(&self, filter: Filter) -> anyhow::Result<Vec<Log>> {
        self.filter_calls
            .lock()
            .unwrap()
            .push((filter.get_from_block(), filter.get_to_block()));
        Ok(self
            .logs
            .iter()
            .filter(|l| matches(&filter, l))
            .cloned()
            .collect())
    }
}

#[test]
fn filters_cover_internal_movements_and_both_wallet_sides() {
    let filters = asset_transfer_filters(&tracking(Some(WALLET), vec![CUSTODY, RAMP]));
    assert_eq!(filters.len(), 3);
    let internal = transfer(USDC, CUSTODY, RAMP, 1, 1, 0);
    let wallet_out = transfer(USDC, WALLET, EXTERNAL, 1, 1, 1);
    let wallet_in = transfer(USDC, EXTERNAL, WALLET, 1, 1, 2);
    let external = transfer(USDC, CUSTODY, EXTERNAL, 1, 1, 3);
    let other_token = transfer(OTHER_TOKEN, CUSTODY, RAMP, 1, 1, 4);
    assert!(matches(&filters[0], &internal));
    assert!(!matches(&filters[0], &external));
    assert!(matches(&filters[1], &wallet_out));
    assert!(!matches(&filters[1], &wallet_in));
    assert!(matches(&filters[2], &wallet_in));
    for f in &filters {
        assert!(!matches(f, &other_token));
        assert!(!matches(f, &external));
    }
}

#[test]
fn filters_follow_what_is_configured() {
    assert_eq!(
        asset_transfer_filters(&tracking(Some(WALLET), vec![])).len(),
        2
    );
    assert_eq!(
        asset_transfer_filters(&tracking(None, vec![CUSTODY, RAMP])).len(),
        1
    );
    assert!(asset_transfer_filters(&tracking(None, vec![])).is_empty());
}

#[test]
fn tracked_transfer_is_wallet_touching_or_internal() {
    let t = tracking(Some(WALLET), vec![CUSTODY, RAMP]);
    assert!(is_tracked_transfer(&t, CUSTODY, RAMP));
    assert!(is_tracked_transfer(&t, RAMP, CUSTODY));
    assert!(is_tracked_transfer(&t, WALLET, EXTERNAL));
    assert!(is_tracked_transfer(&t, EXTERNAL, WALLET));
    assert!(!is_tracked_transfer(&t, CUSTODY, EXTERNAL));
    assert!(!is_tracked_transfer(&t, EXTERNAL, RAMP));
    let no_wallet = tracking(None, vec![CUSTODY, RAMP]);
    assert!(!is_tracked_transfer(&no_wallet, WALLET, CUSTODY));
}

#[test]
fn parse_emits_asset_transfer_with_checksummed_sides() {
    let t = tracking(Some(WALLET), vec![CUSTODY, RAMP]);
    let ev = parse_asset_transfer(&transfer(USDC, CUSTODY, RAMP, 1_250_000, 7, 3), &t).unwrap();
    assert_eq!(ev.event_name, "AssetTransfer");
    assert_eq!(ev.contract_address, USDC);
    assert_eq!(ev.block_number, 7);
    assert_eq!(ev.log_index, 3);
    assert_eq!(ev.params["from"], CUSTODY.to_checksum(None));
    assert_eq!(ev.params["to"], RAMP.to_checksum(None));
    assert_eq!(ev.params["amount"], "1250000");
}

#[test]
fn parse_ignores_other_tokens_and_untracked_transfers() {
    let t = tracking(Some(WALLET), vec![CUSTODY, RAMP]);
    assert!(parse_asset_transfer(&transfer(OTHER_TOKEN, CUSTODY, RAMP, 1, 1, 0), &t).is_none());
    assert!(parse_asset_transfer(&transfer(USDC, CUSTODY, EXTERNAL, 1, 1, 0), &t).is_none());
    assert!(parse_asset_transfer(&transfer(USDC, EXTERNAL, WALLET, 1, 1, 0), &t).is_some());
}

#[tokio::test]
async fn fetch_dedups_logs_matched_by_several_filters_and_skips_address_fetch() {
    let t = tracking(Some(WALLET), vec![CUSTODY, WALLET]);
    let logs = vec![
        transfer(USDC, CUSTODY, WALLET, 1, 5, 0),
        transfer(USDC, WALLET, EXTERNAL, 1, 5, 1),
        transfer(USDC, CUSTODY, EXTERNAL, 1, 5, 2),
        transfer(OTHER_TOKEN, CUSTODY, WALLET, 1, 5, 3),
    ];
    let fetcher = FilterFetcher::new(logs);
    let got = fetch_filtered_logs(&fetcher, &asset_transfer_filters(&t), 10, 20)
        .await
        .unwrap();
    let indexes: Vec<u64> = got.iter().map(|l| l.log_index.unwrap()).collect();
    assert_eq!(indexes.len(), 2);
    assert!(indexes.contains(&0) && indexes.contains(&1));
    assert_eq!(*fetcher.address_calls.lock().unwrap(), 0);
    let calls = fetcher.filter_calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 3);
    assert!(calls.iter().all(|c| *c == (Some(10), Some(20))));
}

#[test]
fn asset_equal_to_core_contract_is_rejected() {
    let roles = [
        ("DEPOSIT_MANAGER_ADDRESS", CUSTODY),
        ("MINTER_ADDRESS", USDC),
    ];
    let msg = reject_asset_collision(1, USDC, &roles)
        .unwrap_err()
        .to_string();
    assert!(msg.contains("CHAIN_1_EVM_INDEXER_ASSET_ADDRESS"), "{msg}");
    assert!(msg.contains("MINTER_ADDRESS"), "{msg}");
    assert!(reject_asset_collision(1, USDC, &[("MINTER_ADDRESS", RAMP)]).is_ok());
}
