// spec: docs/references/collateral-registry-events.md#event-table
use serde_json::{json, Map, Value};
use stellar_xdr::curr::{ScMap, ScVal};

use crate::indexer::stellar::loan_registry_parsers::{
    extract_string_from_map, extract_u32, extract_u32_from_map, get_map_entry,
};
use crate::indexer::stellar::parsers::{
    extract_bytes32_from_map, extract_i128_from_map, synthesise_log_index, StellarLog,
};
use crate::indexer::stellar::rpc::RawEvent;

const TOPICS: [(&str, &str); 11] = [
    ("pledged", "Pledged"),
    ("haircut_set", "HaircutSet"),
    ("floor_set", "FloorSet"),
    ("revalued", "Revalued"),
    ("stage_updated", "StageUpdated"),
    ("control_updated", "ControlUpdated"),
    ("doc_added", "DocAdded"),
    ("quantity_adjusted", "QuantityAdjusted"),
    ("released", "Released"),
    ("liquidated", "Liquidated"),
    ("margin_call", "MarginCall"),
];

// ── Private ScVal helpers ─────────────────────────────────────────────────────

fn scval_symbol(v: &ScVal) -> Option<String> {
    match v {
        ScVal::Symbol(s) => Some(s.0.to_utf8_string_lossy()),
        _ => None,
    }
}

fn scval_string(v: &ScVal) -> Option<String> {
    match v {
        ScVal::String(s) => Some(s.0.to_utf8_string_lossy()),
        _ => None,
    }
}

fn scval_enum_name(v: &ScVal) -> Option<String> {
    match v {
        ScVal::Vec(Some(items)) if items.0.len() == 1 => scval_symbol(&items.0[0]),
        _ => None,
    }
}

fn map_field<'a>(map: &'a ScMap, key: &str) -> Option<&'a ScVal> {
    map.0
        .iter()
        .find(|e| scval_symbol(&e.key).as_deref() == Some(key))
        .map(|e| &e.val)
}

fn enum_from_map(b64: &str, key: &str) -> Option<String> {
    scval_enum_name(&get_map_entry(b64, key)?)
}

fn i128_str(b64: &str, key: &str) -> Option<String> {
    extract_i128_from_map(b64, key).map(|v| v.to_string())
}

fn decode_location(v: &ScVal) -> Option<Value> {
    match v {
        ScVal::Void => Some(Value::Null),
        ScVal::Map(Some(map)) => Some(json!({
            "location_type": scval_enum_name(map_field(map, "location_type")?)?,
            "identifier": scval_string(map_field(map, "identifier")?)?,
            "tracking_url": scval_string(map_field(map, "tracking_url")?)?,
        })),
        _ => None,
    }
}

fn decode_control(v: &ScVal) -> Option<Value> {
    match v {
        ScVal::Map(Some(map)) => Some(json!({
            "kind": scval_enum_name(map_field(map, "kind")?)?,
            "ref": scval_string(map_field(map, "reference")?)?,
        })),
        _ => None,
    }
}

fn build(
    raw: &RawEvent,
    topic: &str,
    min_topics: usize,
) -> Option<(&'static str, Map<String, Value>)> {
    if raw.event_name != topic || raw.topics_base64.len() < min_topics {
        return None;
    }
    let name = TOPICS.iter().find(|(t, _)| *t == topic)?.1;
    let mut params = Map::new();
    params.insert(
        "loan_id".to_owned(),
        Value::String(extract_u32(&raw.topics_base64[1])?.to_string()),
    );
    if min_topics >= 3 {
        params.insert(
            "lot_id".to_owned(),
            Value::String(extract_u32(&raw.topics_base64[2])?.to_string()),
        );
    }
    Some((name, params))
}

fn finish(raw: &RawEvent, name: &str, params: Map<String, Value>) -> StellarLog {
    StellarLog {
        contract_address: raw.contract_id.clone(),
        event_name: name.to_owned(),
        block_number: raw.ledger as u64,
        tx_hash: raw.tx_hash.clone(),
        log_index: synthesise_log_index(raw.tx_index, raw.op_index, raw.event_index_in_op),
        block_timestamp: raw.ledger_closed_at_unix,
        params: Value::Object(params),
    }
}

// ── Public parsers ────────────────────────────────────────────────────────────

pub fn parse_pledged(raw: &RawEvent) -> Option<StellarLog> {
    let (name, params) = build(raw, "pledged", 3)?;
    Some(finish(raw, name, params))
}

pub fn parse_haircut_set(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "haircut_set", 3)?;
    let bps = extract_u32_from_map(&raw.value_base64, "bps")?;
    params.insert("bps".to_owned(), json!(bps));
    Some(finish(raw, name, params))
}

pub fn parse_floor_set(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "floor_set", 2)?;
    let bps = extract_u32_from_map(&raw.value_base64, "bps")?;
    params.insert("bps".to_owned(), json!(bps));
    Some(finish(raw, name, params))
}

pub fn parse_revalued(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "revalued", 3)?;
    let value_per_unit = i128_str(&raw.value_base64, "value_per_unit")?;
    let benchmark = scval_symbol(&get_map_entry(&raw.value_base64, "benchmark")?)?;
    let report_hash = extract_bytes32_from_map(&raw.value_base64, "report_hash")?;
    params.insert("value_per_unit".to_owned(), json!(value_per_unit));
    params.insert("benchmark".to_owned(), json!(benchmark));
    params.insert("report_hash".to_owned(), json!(report_hash));
    Some(finish(raw, name, params))
}

pub fn parse_stage_updated(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "stage_updated", 3)?;
    let stage = enum_from_map(&raw.value_base64, "stage")?;
    let location = decode_location(&get_map_entry(&raw.value_base64, "location")?)?;
    params.insert("stage".to_owned(), json!(stage));
    params.insert("location".to_owned(), location);
    Some(finish(raw, name, params))
}

pub fn parse_control_updated(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "control_updated", 3)?;
    let control = decode_control(&get_map_entry(&raw.value_base64, "control")?)?;
    params.insert("control".to_owned(), control);
    Some(finish(raw, name, params))
}

pub fn parse_doc_added(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "doc_added", 3)?;
    let kind = enum_from_map(&raw.value_base64, "kind")?;
    let hash = extract_bytes32_from_map(&raw.value_base64, "sha256")?;
    params.insert("kind".to_owned(), json!(kind));
    params.insert("hash".to_owned(), json!(hash));
    Some(finish(raw, name, params))
}

pub fn parse_quantity_adjusted(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "quantity_adjusted", 3)?;
    let old_quantity = i128_str(&raw.value_base64, "old")?;
    let new_quantity = i128_str(&raw.value_base64, "new")?;
    let reason = extract_string_from_map(&raw.value_base64, "reason")?;
    let hash = extract_bytes32_from_map(&raw.value_base64, "sha256")?;
    params.insert("old_quantity".to_owned(), json!(old_quantity));
    params.insert("new_quantity".to_owned(), json!(new_quantity));
    params.insert("reason".to_owned(), json!(reason));
    params.insert("hash".to_owned(), json!(hash));
    Some(finish(raw, name, params))
}

pub fn parse_released(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "released", 3)?;
    let quantity = i128_str(&raw.value_base64, "qty")?;
    let reason = enum_from_map(&raw.value_base64, "reason")?;
    let ref_hash = extract_bytes32_from_map(&raw.value_base64, "ref_hash")?;
    params.insert("quantity".to_owned(), json!(quantity));
    params.insert("reason".to_owned(), json!(reason));
    params.insert("ref_hash".to_owned(), json!(ref_hash));
    Some(finish(raw, name, params))
}

pub fn parse_liquidated(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "liquidated", 3)?;
    let sale_id = extract_u32_from_map(&raw.value_base64, "sale_id")?;
    let quantity = i128_str(&raw.value_base64, "qty")?;
    params.insert("sale_id".to_owned(), json!(sale_id.to_string()));
    params.insert("quantity".to_owned(), json!(quantity));
    Some(finish(raw, name, params))
}

pub fn parse_margin_call(raw: &RawEvent) -> Option<StellarLog> {
    let (name, mut params) = build(raw, "margin_call", 2)?;
    let coverage_bps = extract_u32_from_map(&raw.value_base64, "coverage_bps")?;
    let floor_bps = extract_u32_from_map(&raw.value_base64, "floor_bps")?;
    params.insert("coverage_bps".to_owned(), json!(coverage_bps));
    params.insert("floor_bps".to_owned(), json!(floor_bps));
    Some(finish(raw, name, params))
}

pub fn dispatch_collateral_registry(raw: &RawEvent) -> Option<StellarLog> {
    let parsed = parse_pledged(raw)
        .or_else(|| parse_haircut_set(raw))
        .or_else(|| parse_floor_set(raw))
        .or_else(|| parse_revalued(raw))
        .or_else(|| parse_stage_updated(raw))
        .or_else(|| parse_control_updated(raw))
        .or_else(|| parse_doc_added(raw))
        .or_else(|| parse_quantity_adjusted(raw))
        .or_else(|| parse_released(raw))
        .or_else(|| parse_liquidated(raw))
        .or_else(|| parse_margin_call(raw));
    if parsed.is_none() && TOPICS.iter().any(|(t, _)| *t == raw.event_name) {
        tracing::warn!(
            contract_id = %raw.contract_id,
            event_name = %raw.event_name,
            tx_hash = %raw.tx_hash,
            "CollateralRegistry event failed to decode; dropped"
        );
    }
    parsed
}

pub fn is_collateral_registry_event(event_name: &str) -> bool {
    TOPICS.iter().any(|(_, n)| *n == event_name)
}
