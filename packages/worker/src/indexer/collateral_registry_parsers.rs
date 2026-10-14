// spec: docs/references/collateral-registry-events.md#evm-arm
use alloy::{primitives::B256, rpc::types::Log, sol_types::SolEvent};
use serde_json::{json, Value};

use shared::events::ContractLog;

use crate::indexer::parsers::extract_log_meta;

mod cr {
    use alloy::sol;
    sol! {
        struct Location {
            uint8 locationType;
            string identifier;
            string trackingUrl;
        }
        struct Control {
            uint8 kind;
            string reference;
        }
        event Pledged(uint256 indexed loanId, uint256 indexed lotId);
        event HaircutSet(uint256 indexed loanId, uint256 indexed lotId, uint32 bps);
        event FloorSet(uint256 indexed loanId, uint32 bps);
        event Revalued(uint256 indexed loanId, uint256 indexed lotId, uint256 valuePerUnit, bytes32 benchmark, bytes32 reportHash);
        event StageUpdated(uint256 indexed loanId, uint256 indexed lotId, uint8 stage, bool hasLocation, Location location);
        event ControlUpdated(uint256 indexed loanId, uint256 indexed lotId, Control control);
        event DocAdded(uint256 indexed loanId, uint256 indexed lotId, uint8 kind, bytes32 hash);
        event QuantityAdjusted(uint256 indexed loanId, uint256 indexed lotId, uint256 oldQuantity, uint256 newQuantity, string reason, bytes32 hash);
        event Released(uint256 indexed loanId, uint256 indexed lotId, uint256 quantity, uint8 reason, bytes32 refHash);
        event Liquidated(uint256 indexed loanId, uint256 indexed lotId, uint256 saleId, uint256 quantity);
        event MarginCall(uint256 indexed loanId, uint32 coverageBps, uint32 floorBps);
    }
}

// ── Enum ordinal tables ───────────────────────────────────────────────────────

pub fn lot_stage_name(v: u8) -> &'static str {
    match v {
        0 => "Pledged",
        1 => "Afloat",
        2 => "InStorage",
        3 => "Delivered",
        4 => "Sold",
        5 => "Assigned",
        6 => "Acknowledged",
        7 => "Presented",
        8 => "Paid",
        _ => "Unknown",
    }
}

pub fn location_type_name(v: u8) -> &'static str {
    match v {
        0 => "Vessel",
        1 => "Warehouse",
        2 => "TankFarm",
        3 => "Other",
        _ => "Unknown",
    }
}

pub fn control_kind_name(v: u8) -> &'static str {
    match v {
        0 => "None",
        1 => "EblToOrderOfTrust",
        2 => "NegotiableWr",
        3 => "Cma",
        4 => "Acknowledged",
        _ => "Unknown",
    }
}

pub fn doc_kind_name(v: u8) -> &'static str {
    match v {
        0 => "Ebl",
        1 => "WarehouseReceipt",
        2 => "Assay",
        3 => "Insurance",
        4 => "SupplyContract",
        5 => "OfftakeContract",
        6 => "NoticeOfAssignment",
        7 => "LC",
        8 => "Inspection",
        9 => "Other",
        _ => "Unknown",
    }
}

pub fn release_reason_name(v: u8) -> &'static str {
    match v {
        0 => "Payment",
        1 => "LCAcceptance",
        2 => "LOIDischarge",
        3 => "Substitution",
        4 => "Loss",
        5 => "ConsentedSale",
        _ => "Unknown",
    }
}

pub fn benchmark_string(b: &B256) -> String {
    let bytes = b.as_slice();
    let end = bytes.iter().rposition(|&c| c != 0).map_or(0, |i| i + 1);
    let trimmed = &bytes[..end];
    if !trimmed.is_empty() && trimmed.iter().all(|c| (0x20..=0x7e).contains(c)) {
        String::from_utf8_lossy(trimmed).into_owned()
    } else {
        hex::encode(bytes)
    }
}

fn build(log: &Log, event_name: &str, params: Value) -> Option<ContractLog> {
    let (contract_address, block_number, tx_hash, log_index) = extract_log_meta(log)?;
    Some(ContractLog {
        contract_address,
        event_name: event_name.to_owned(),
        block_number,
        tx_hash,
        log_index,
        block_timestamp: 0,
        params,
    })
}

// ── Per-event parsers ─────────────────────────────────────────────────────────

pub fn parse_cr_pledged(log: &Log) -> Option<ContractLog> {
    let d = cr::Pledged::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "Pledged",
        json!({ "loan_id": d.loanId.to_string(), "lot_id": d.lotId.to_string() }),
    )
}

pub fn parse_cr_haircut_set(log: &Log) -> Option<ContractLog> {
    let d = cr::HaircutSet::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "HaircutSet",
        json!({ "loan_id": d.loanId.to_string(), "lot_id": d.lotId.to_string(), "bps": d.bps }),
    )
}

pub fn parse_cr_floor_set(log: &Log) -> Option<ContractLog> {
    let d = cr::FloorSet::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "FloorSet",
        json!({ "loan_id": d.loanId.to_string(), "bps": d.bps }),
    )
}

pub fn parse_cr_revalued(log: &Log) -> Option<ContractLog> {
    let d = cr::Revalued::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "Revalued",
        json!({
            "loan_id": d.loanId.to_string(),
            "lot_id": d.lotId.to_string(),
            "value_per_unit": d.valuePerUnit.to_string(),
            "benchmark": benchmark_string(&d.benchmark),
            "report_hash": hex::encode(d.reportHash.as_slice()),
        }),
    )
}

pub fn parse_cr_stage_updated(log: &Log) -> Option<ContractLog> {
    let d = cr::StageUpdated::decode_log(log.as_ref(), true).ok()?;
    let location = if d.hasLocation {
        json!({
            "location_type": location_type_name(d.location.locationType),
            "identifier": d.location.identifier,
            "tracking_url": d.location.trackingUrl,
        })
    } else {
        Value::Null
    };
    build(
        log,
        "StageUpdated",
        json!({
            "loan_id": d.loanId.to_string(),
            "lot_id": d.lotId.to_string(),
            "stage": lot_stage_name(d.stage),
            "location": location,
        }),
    )
}

pub fn parse_cr_control_updated(log: &Log) -> Option<ContractLog> {
    let d = cr::ControlUpdated::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "ControlUpdated",
        json!({
            "loan_id": d.loanId.to_string(),
            "lot_id": d.lotId.to_string(),
            "control": {
                "kind": control_kind_name(d.control.kind),
                "ref": d.control.reference,
            },
        }),
    )
}

pub fn parse_cr_doc_added(log: &Log) -> Option<ContractLog> {
    let d = cr::DocAdded::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "DocAdded",
        json!({
            "loan_id": d.loanId.to_string(),
            "lot_id": d.lotId.to_string(),
            "kind": doc_kind_name(d.kind),
            "hash": hex::encode(d.hash.as_slice()),
        }),
    )
}

pub fn parse_cr_quantity_adjusted(log: &Log) -> Option<ContractLog> {
    let d = cr::QuantityAdjusted::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "QuantityAdjusted",
        json!({
            "loan_id": d.loanId.to_string(),
            "lot_id": d.lotId.to_string(),
            "old_quantity": d.oldQuantity.to_string(),
            "new_quantity": d.newQuantity.to_string(),
            "reason": d.reason,
            "hash": hex::encode(d.hash.as_slice()),
        }),
    )
}

pub fn parse_cr_released(log: &Log) -> Option<ContractLog> {
    let d = cr::Released::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "Released",
        json!({
            "loan_id": d.loanId.to_string(),
            "lot_id": d.lotId.to_string(),
            "quantity": d.quantity.to_string(),
            "reason": release_reason_name(d.reason),
            "ref_hash": hex::encode(d.refHash.as_slice()),
        }),
    )
}

pub fn parse_cr_liquidated(log: &Log) -> Option<ContractLog> {
    let d = cr::Liquidated::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "Liquidated",
        json!({
            "loan_id": d.loanId.to_string(),
            "lot_id": d.lotId.to_string(),
            "sale_id": d.saleId.to_string(),
            "quantity": d.quantity.to_string(),
        }),
    )
}

pub fn parse_cr_margin_call(log: &Log) -> Option<ContractLog> {
    let d = cr::MarginCall::decode_log(log.as_ref(), true).ok()?;
    build(
        log,
        "MarginCall",
        json!({
            "loan_id": d.loanId.to_string(),
            "coverage_bps": d.coverageBps,
            "floor_bps": d.floorBps,
        }),
    )
}

pub fn parse_collateral_registry_log(log: &Log) -> Option<ContractLog> {
    parse_cr_pledged(log)
        .or_else(|| parse_cr_haircut_set(log))
        .or_else(|| parse_cr_floor_set(log))
        .or_else(|| parse_cr_revalued(log))
        .or_else(|| parse_cr_stage_updated(log))
        .or_else(|| parse_cr_control_updated(log))
        .or_else(|| parse_cr_doc_added(log))
        .or_else(|| parse_cr_quantity_adjusted(log))
        .or_else(|| parse_cr_released(log))
        .or_else(|| parse_cr_liquidated(log))
        .or_else(|| parse_cr_margin_call(log))
}
