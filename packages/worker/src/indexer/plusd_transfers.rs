// spec: docs/references/backend.md#plusd-transfer-indexing
use std::sync::Arc;

use alloy::{
    primitives::Address,
    rpc::types::{Filter, Log},
    sol_types::SolEvent,
};
use anyhow::{bail, Result};
use serde_json::json;

use shared::{db::EventRepo, events::ContractLog, log_mapper::LogMapper};

use super::{
    asset_transfers::Transfer, deal_token_parsers::side, mappers::ContractLogMapper,
    parsers::extract_log_meta, poller::EvmEventPollerBuilder,
};

pub fn plusd_transfer_filter(plusd: Address) -> Filter {
    Filter::new()
        .address(plusd)
        .event_signature(Transfer::SIGNATURE_HASH)
}

pub fn parse_plusd_transfer(log: &Log, plusd: Address) -> Option<ContractLog> {
    if log.address() != plusd {
        return None;
    }
    let d = Transfer::decode_log(log.as_ref(), true).ok()?;
    let kind = if d.from == Address::ZERO {
        "mint"
    } else if d.to == Address::ZERO {
        "burn"
    } else {
        "transfer"
    };
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;
    Some(ContractLog {
        contract_address,
        event_name: "PlusdTransfer".to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params: json!({
            "kind": kind,
            "from": side(d.from),
            "to": side(d.to),
            "amount": d.value.to_string(),
        }),
    })
}

pub fn reject_plusd_collision(
    chain_id: i64,
    plusd: Address,
    roles: &[(&str, Address)],
) -> Result<()> {
    if let Some((role, _)) = roles.iter().find(|(_, addr)| *addr == plusd) {
        let key = if *role == "ASSET_ADDRESS" {
            format!("JOB_INDEXER_EVM_{chain_id}_ASSET_ADDRESS")
        } else {
            format!("CHAIN_{chain_id}_EVM_INDEXER_{role}")
        };
        bail!("CHAIN_{chain_id}_EVM_INDEXER_PLUSD_ADDRESS must not equal {key} ({plusd})");
    }
    Ok(())
}

pub fn register_plusd_transfer_handler(
    builder: EvmEventPollerBuilder,
    chain_id: i64,
    plusd: Address,
    repo: Arc<EventRepo>,
) -> EvmEventPollerBuilder {
    builder.add_filtered_event_handler(vec![plusd_transfer_filter(plusd)], move |log| {
        parse_plusd_transfer(log, plusd).map(|ev| {
            Box::new(ContractLogMapper::new(ev, chain_id, repo.clone())) as Box<dyn LogMapper>
        })
    })
}
