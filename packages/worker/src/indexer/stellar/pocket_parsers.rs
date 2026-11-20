// spec: docs/references/backend.md#stellar-pocket-indexing
use serde_json::{json, Value};

use crate::indexer::stellar::loan_registry_parsers::{extract_u32, extract_u32_from_map};
use crate::indexer::stellar::parsers::{
    extract_address, extract_i128_from_map, synthesise_log_index, StellarLog,
};
use crate::indexer::stellar::rpc::RawEvent;

pub const POCKET_EVENT_TOPICS: [(&str, &str); 5] = [
    ("pocket_opened", "PocketOpened"),
    ("released", "PocketReleased"),
    ("unreleased", "PocketUnreleased"),
    ("burned", "PocketBurned"),
    ("claimed", "PocketClaimed"),
];

fn build(raw: &RawEvent, name: &str, params: Value) -> StellarLog {
    StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: name.to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params,
    }
}

fn matches(raw: &RawEvent, topic: &str, min_topics: usize) -> bool {
    raw.event_name == topic && raw.topics_base64.len() >= min_topics
}

fn loan_id(raw: &RawEvent) -> Option<String> {
    extract_u32(&raw.topics_base64[1]).map(|v| v.to_string())
}

fn amt(raw: &RawEvent, key: &str) -> Option<String> {
    extract_i128_from_map(&raw.value_base64, key).map(|v| v.to_string())
}

pub fn parse_pocket_opened(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "pocket_opened", 2) {
        return None;
    }
    let params = json!({
        "loan_id": loan_id(raw)?,
        "amount": amt(raw, "amount")?,
        "snapshot_ledger": extract_u32_from_map(&raw.value_base64, "snapshot_ledger")?.to_string(),
        "supply_at_snapshot": amt(raw, "supply_at_snapshot")?,
    });
    Some(build(raw, "PocketOpened", params))
}

pub fn parse_pocket_released(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "released", 2) {
        return None;
    }
    let params = json!({
        "loan_id": loan_id(raw)?,
        "principal": amt(raw, "principal")?,
        "released": amt(raw, "released")?,
        "interest": amt(raw, "interest")?,
    });
    Some(build(raw, "PocketReleased", params))
}

pub fn parse_pocket_unreleased(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "unreleased", 2) {
        return None;
    }
    let params = json!({
        "loan_id": loan_id(raw)?,
        "principal": amt(raw, "principal")?,
        "interest": amt(raw, "interest")?,
    });
    Some(build(raw, "PocketUnreleased", params))
}

pub fn parse_pocket_burned(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "burned", 2) {
        return None;
    }
    let params = json!({
        "loan_id": loan_id(raw)?,
        "amount": amt(raw, "amount")?,
        "burned": amt(raw, "burned")?,
    });
    Some(build(raw, "PocketBurned", params))
}

pub fn parse_pocket_claimed(raw: &RawEvent) -> Option<StellarLog> {
    if !matches(raw, "claimed", 3) {
        return None;
    }
    let paid = extract_i128_from_map(&raw.value_base64, "paid")?;
    let params = json!({
        "loan_id": loan_id(raw)?,
        "holder": extract_address(&raw.topics_base64[2])?,
        "paid": paid.to_string(),
        "paid_zero": paid == 0,
    });
    Some(build(raw, "PocketClaimed", params))
}

pub fn dispatch_pocket(raw: &RawEvent) -> Option<StellarLog> {
    let parsed = match raw.event_name.as_str() {
        "pocket_opened" => parse_pocket_opened(raw),
        "released" => parse_pocket_released(raw),
        "unreleased" => parse_pocket_unreleased(raw),
        "burned" => parse_pocket_burned(raw),
        "claimed" => parse_pocket_claimed(raw),
        _ => return None,
    };
    if parsed.is_none() {
        tracing::warn!(
            contract_id = %raw.contract_id,
            event_name = %raw.event_name,
            tx_hash = %raw.tx_hash,
            "Pocket event failed to decode; dropped"
        );
    }
    parsed
}

pub fn is_pocket_event(event_name: &str) -> bool {
    POCKET_EVENT_TOPICS.iter().any(|(_, n)| *n == event_name)
}
