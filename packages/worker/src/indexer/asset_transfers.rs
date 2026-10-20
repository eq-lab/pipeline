// spec: docs/exec-plans/active/financial-apis-multichain.md (Part B — EVM sources)
use std::sync::Arc;

use alloy::{
    primitives::{Address, B256},
    rpc::types::{Filter, Log},
    sol,
    sol_types::SolEvent,
};
use anyhow::{bail, Result};
use serde_json::json;

use shared::{db::EventRepo, events::ContractLog, log_mapper::LogMapper};

use super::{
    config::EvmAssetTracking, mappers::ContractLogMapper, parsers::extract_log_meta,
    poller::EvmEventPollerBuilder,
};

sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
}

pub fn asset_transfer_filters(tracking: &EvmAssetTracking) -> Vec<Filter> {
    let base = Filter::new()
        .address(tracking.asset)
        .event_signature(Transfer::SIGNATURE_HASH);
    let mut filters = Vec::new();
    if !tracking.tracked.is_empty() {
        let topics: Vec<B256> = tracking.tracked.iter().map(Address::into_word).collect();
        filters.push(base.clone().topic1(topics.clone()).topic2(topics));
    }
    if let Some(wallet) = tracking.withdrawal_queue_wallet {
        filters.push(base.clone().topic1(wallet.into_word()));
        filters.push(base.topic2(wallet.into_word()));
    }
    filters
}

pub fn is_tracked_transfer(tracking: &EvmAssetTracking, from: Address, to: Address) -> bool {
    tracking
        .withdrawal_queue_wallet
        .is_some_and(|w| from == w || to == w)
        || (tracking.tracked.contains(&from) && tracking.tracked.contains(&to))
}

pub fn parse_asset_transfer(log: &Log, tracking: &EvmAssetTracking) -> Option<ContractLog> {
    if log.address() != tracking.asset {
        return None;
    }
    let d = Transfer::decode_log(log.as_ref(), true).ok()?;
    if !is_tracked_transfer(tracking, d.from, d.to) {
        return None;
    }
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;
    Some(ContractLog {
        contract_address,
        event_name: "AssetTransfer".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "from": d.from.to_checksum(None),
            "to": d.to.to_checksum(None),
            "amount": d.value.to_string(),
        }),
    })
}

pub fn reject_asset_collision(
    chain_id: i64,
    asset: Address,
    core: &[(&str, Address)],
) -> Result<()> {
    if let Some((role, _)) = core.iter().find(|(_, addr)| *addr == asset) {
        bail!(
            "CHAIN_{chain_id}_EVM_INDEXER_ASSET_ADDRESS must not equal CHAIN_{chain_id}_EVM_INDEXER_{role} ({asset})"
        );
    }
    Ok(())
}

pub fn register_asset_transfer_handler(
    builder: EvmEventPollerBuilder,
    chain_id: i64,
    tracking: EvmAssetTracking,
    repo: Arc<EventRepo>,
) -> EvmEventPollerBuilder {
    let filters = asset_transfer_filters(&tracking);
    let wallet = tracking
        .withdrawal_queue_wallet
        .map(|w| w.to_checksum(None));
    builder.add_filtered_event_handler(filters, move |log| {
        parse_asset_transfer(log, &tracking).map(|ev| {
            Box::new(
                ContractLogMapper::new(ev, chain_id, repo.clone())
                    .with_withdrawal_queue_wallet(wallet.clone()),
            ) as Box<dyn LogMapper>
        })
    })
}
