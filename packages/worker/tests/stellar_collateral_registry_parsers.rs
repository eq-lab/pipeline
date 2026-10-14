// spec: docs/references/collateral-registry-events.md#event-table
use pipeline_worker::indexer::stellar::collateral_registry_parsers::*;
use pipeline_worker::indexer::stellar::poller::is_loan_registry_event;
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use serde_json::json;
use stellar_xdr::curr::{
    Int128Parts, Limits, ScBytes, ScMap, ScMapEntry, ScString, ScSymbol, ScVal, StringM, VecM,
    WriteXdr,
};

fn b64(val: &ScVal) -> String {
    val.to_xdr_base64(Limits::none()).unwrap()
}

fn sym_val(s: &str) -> ScVal {
    let sym: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(sym))
}

fn encode_symbol(s: &str) -> String {
    b64(&sym_val(s))
}

fn encode_u32(v: u32) -> String {
    b64(&ScVal::U32(v))
}

fn str_val(s: &str) -> ScVal {
    ScVal::String(ScString(s.try_into().unwrap()))
}

fn enum_val(name: &str) -> ScVal {
    let items: VecM<ScVal> = vec![sym_val(name)].try_into().unwrap();
    ScVal::Vec(Some(items.into()))
}

fn i128_val(v: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (v >> 64) as i64,
        lo: (v & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

fn bytes_val(bytes: &[u8]) -> ScVal {
    ScVal::Bytes(ScBytes(bytes.to_vec().try_into().unwrap()))
}

fn map_val(pairs: Vec<(&str, ScVal)>) -> ScVal {
    let mut sorted = pairs;
    sorted.sort_by_key(|(k, _)| *k);
    let entries: Vec<ScMapEntry> = sorted
        .into_iter()
        .map(|(k, val)| ScMapEntry {
            key: sym_val(k),
            val,
        })
        .collect();
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
}

fn encode_map(pairs: Vec<(&str, ScVal)>) -> String {
    b64(&map_val(pairs))
}

const CR: &str = "CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS";
const HASH_HEX: &str = "72c162575adea091c5fc1bed0ec9321fda14c9706338e043ff9d01aeb652a6ce";

fn hash_bytes() -> Vec<u8> {
    (0..32)
        .map(|i| u8::from_str_radix(&HASH_HEX[i * 2..i * 2 + 2], 16).unwrap())
        .collect()
}

fn raw(name: &str, topics: Vec<String>, value: String) -> RawEvent {
    let mut topics_base64 = vec![encode_symbol(name)];
    topics_base64.extend(topics);
    RawEvent {
        contract_id: CR.to_owned(),
        event_name: name.to_owned(),
        topics_base64,
        value_base64: value,
        ledger: 1_234_567,
        ledger_closed_at_unix: 1_790_000_000,
        tx_hash: "abc123".to_owned(),
        tx_index: 2,
        op_index: 1,
        event_index_in_op: 3,
    }
}

fn lot_topics() -> Vec<String> {
    vec![encode_u32(7), encode_u32(3)]
}

fn lot_event(name: &str, value: String) -> RawEvent {
    raw(name, lot_topics(), value)
}

fn assert_common(log: &pipeline_worker::indexer::stellar::parsers::StellarLog, name: &str) {
    assert_eq!(log.event_name, name);
    assert_eq!(log.contract_address, CR);
    assert_eq!(log.block_number, 1_234_567);
    assert_eq!(log.block_timestamp, 1_790_000_000);
    assert_eq!(log.tx_hash, "abc123");
    assert_eq!(log.log_index, 2 * 1000 + 100 + 3);
}

fn location_val() -> ScVal {
    map_val(vec![
        ("location_type", enum_val("Vessel")),
        ("identifier", str_val("IMO9321483")),
        ("tracking_url", str_val("https://track.example/1")),
    ])
}

// ── Happy paths ───────────────────────────────────────────────────────────────

#[test]
fn pledged_empty_map_and_void_values() {
    for value in [
        encode_map(vec![]),
        b64(&ScVal::Void),
        b64(&ScVal::Map(None)),
    ] {
        let log = parse_pledged(&lot_event("pledged", value)).unwrap();
        assert_common(&log, "Pledged");
        assert_eq!(log.params, json!({"loan_id": "7", "lot_id": "3"}));
    }
}

#[test]
fn haircut_set_bps_is_number() {
    let log = parse_haircut_set(&lot_event(
        "haircut_set",
        encode_map(vec![("bps", ScVal::U32(1500))]),
    ))
    .unwrap();
    assert_common(&log, "HaircutSet");
    assert_eq!(
        log.params,
        json!({"loan_id": "7", "lot_id": "3", "bps": 1500})
    );
}

#[test]
fn floor_set_uses_two_topic_shape() {
    let log = parse_floor_set(&raw(
        "floor_set",
        vec![encode_u32(7)],
        encode_map(vec![("bps", ScVal::U32(12_000))]),
    ))
    .unwrap();
    assert_common(&log, "FloorSet");
    assert_eq!(log.params, json!({"loan_id": "7", "bps": 12000}));
}

#[test]
fn revalued_large_i128_symbol_benchmark_and_hex_hash() {
    let big: i128 = (u64::MAX as i128) * 10 + 5;
    let log = parse_revalued(&lot_event(
        "revalued",
        encode_map(vec![
            ("value_per_unit", i128_val(big)),
            ("benchmark", sym_val("PAR")),
            ("report_hash", bytes_val(&hash_bytes())),
        ]),
    ))
    .unwrap();
    assert_common(&log, "Revalued");
    assert_eq!(
        log.params,
        json!({
            "loan_id": "7",
            "lot_id": "3",
            "value_per_unit": big.to_string(),
            "benchmark": "PAR",
            "report_hash": HASH_HEX,
        })
    );
}

#[test]
fn stage_updated_without_location_is_null() {
    let log = parse_stage_updated(&lot_event(
        "stage_updated",
        encode_map(vec![
            ("stage", enum_val("InStorage")),
            ("location", ScVal::Void),
        ]),
    ))
    .unwrap();
    assert_common(&log, "StageUpdated");
    assert_eq!(
        log.params,
        json!({"loan_id": "7", "lot_id": "3", "stage": "InStorage", "location": null})
    );
}

#[test]
fn stage_updated_with_location_is_nested_object() {
    let log = parse_stage_updated(&lot_event(
        "stage_updated",
        encode_map(vec![
            ("stage", enum_val("Afloat")),
            ("location", location_val()),
        ]),
    ))
    .unwrap();
    assert_eq!(
        log.params["location"],
        json!({
            "location_type": "Vessel",
            "identifier": "IMO9321483",
            "tracking_url": "https://track.example/1",
        })
    );
    assert_eq!(log.params["stage"], "Afloat");
}

#[test]
fn control_updated_maps_reference_to_ref() {
    let log = parse_control_updated(&lot_event(
        "control_updated",
        encode_map(vec![(
            "control",
            map_val(vec![
                ("kind", enum_val("None")),
                ("reference", str_val("BL-123")),
            ]),
        )]),
    ))
    .unwrap();
    assert_common(&log, "ControlUpdated");
    assert_eq!(
        log.params["control"],
        json!({"kind": "None", "ref": "BL-123"})
    );
}

#[test]
fn doc_added_maps_sha256_to_hash() {
    let log = parse_doc_added(&lot_event(
        "doc_added",
        encode_map(vec![
            ("kind", enum_val("Ebl")),
            ("sha256", bytes_val(&hash_bytes())),
        ]),
    ))
    .unwrap();
    assert_common(&log, "DocAdded");
    assert_eq!(
        log.params,
        json!({"loan_id": "7", "lot_id": "3", "kind": "Ebl", "hash": HASH_HEX})
    );
}

#[test]
fn quantity_adjusted_renames_fields() {
    let log = parse_quantity_adjusted(&lot_event(
        "quantity_adjusted",
        encode_map(vec![
            ("old", i128_val(1_000_000_000)),
            ("new", i128_val(900_000_000)),
            ("reason", str_val("shrinkage")),
            ("sha256", bytes_val(&hash_bytes())),
        ]),
    ))
    .unwrap();
    assert_common(&log, "QuantityAdjusted");
    assert_eq!(
        log.params,
        json!({
            "loan_id": "7",
            "lot_id": "3",
            "old_quantity": "1000000000",
            "new_quantity": "900000000",
            "reason": "shrinkage",
            "hash": HASH_HEX,
        })
    );
}

#[test]
fn released_maps_qty_to_quantity() {
    let log = parse_released(&lot_event(
        "released",
        encode_map(vec![
            ("qty", i128_val(50_000_000)),
            ("reason", enum_val("Payment")),
            ("ref_hash", bytes_val(&hash_bytes())),
        ]),
    ))
    .unwrap();
    assert_common(&log, "Released");
    assert_eq!(
        log.params,
        json!({
            "loan_id": "7",
            "lot_id": "3",
            "quantity": "50000000",
            "reason": "Payment",
            "ref_hash": HASH_HEX,
        })
    );
}

#[test]
fn liquidated_sale_id_is_string() {
    let log = parse_liquidated(&lot_event(
        "liquidated",
        encode_map(vec![
            ("sale_id", ScVal::U32(42)),
            ("qty", i128_val(10_000_000)),
        ]),
    ))
    .unwrap();
    assert_common(&log, "Liquidated");
    assert_eq!(
        log.params,
        json!({"loan_id": "7", "lot_id": "3", "sale_id": "42", "quantity": "10000000"})
    );
}

#[test]
fn margin_call_bps_are_numbers() {
    let log = parse_margin_call(&raw(
        "margin_call",
        vec![encode_u32(7)],
        encode_map(vec![
            ("coverage_bps", ScVal::U32(9000)),
            ("floor_bps", ScVal::U32(12_000)),
        ]),
    ))
    .unwrap();
    assert_common(&log, "MarginCall");
    assert_eq!(
        log.params,
        json!({"loan_id": "7", "coverage_bps": 9000, "floor_bps": 12000})
    );
}

// ── Negative cases ────────────────────────────────────────────────────────────

#[test]
fn wrong_topic_name_is_none() {
    let ev = lot_event("haircut_set", encode_map(vec![("bps", ScVal::U32(1))]));
    assert!(parse_floor_set(&ev).is_none());
    assert!(parse_pledged(&ev).is_none());
}

#[test]
fn too_few_topics_is_none() {
    let ev = raw(
        "haircut_set",
        vec![encode_u32(7)],
        encode_map(vec![("bps", ScVal::U32(1))]),
    );
    assert!(parse_haircut_set(&ev).is_none());
    assert!(parse_pledged(&raw("pledged", vec![encode_u32(7)], encode_map(vec![]))).is_none());
}

#[test]
fn missing_map_field_is_none() {
    let ev = lot_event("haircut_set", encode_map(vec![("other", ScVal::U32(1))]));
    assert!(parse_haircut_set(&ev).is_none());
}

#[test]
fn wrong_scval_type_is_none() {
    let ev = lot_event("haircut_set", encode_map(vec![("bps", i128_val(1))]));
    assert!(parse_haircut_set(&ev).is_none());
}

#[test]
fn non_u32_topic_is_none() {
    let ev = raw(
        "haircut_set",
        vec![b64(&i128_val(7)), encode_u32(3)],
        encode_map(vec![("bps", ScVal::U32(1))]),
    );
    assert!(parse_haircut_set(&ev).is_none());
}

#[test]
fn short_hash_is_none() {
    let ev = lot_event(
        "doc_added",
        encode_map(vec![
            ("kind", enum_val("Other")),
            ("sha256", bytes_val(&hash_bytes()[..31])),
        ]),
    );
    assert!(parse_doc_added(&ev).is_none());
}

#[test]
fn bare_symbol_enum_is_none() {
    let ev = lot_event(
        "stage_updated",
        encode_map(vec![
            ("stage", sym_val("InStorage")),
            ("location", ScVal::Void),
        ]),
    );
    assert!(parse_stage_updated(&ev).is_none());
}

#[test]
fn malformed_location_is_none() {
    let ev = lot_event(
        "stage_updated",
        encode_map(vec![
            ("stage", enum_val("InStorage")),
            ("location", map_val(vec![("identifier", str_val("x"))])),
        ]),
    );
    assert!(parse_stage_updated(&ev).is_none());
}

// ── Enum round-trips ──────────────────────────────────────────────────────────

const LOT_STAGES: [&str; 9] = [
    "Pledged",
    "Afloat",
    "InStorage",
    "Delivered",
    "Sold",
    "Assigned",
    "Acknowledged",
    "Presented",
    "Paid",
];
const CONTROL_KINDS: [&str; 5] = [
    "None",
    "EblToOrderOfTrust",
    "NegotiableWr",
    "Cma",
    "Acknowledged",
];
const DOC_KINDS: [&str; 10] = [
    "Ebl",
    "WarehouseReceipt",
    "Assay",
    "Insurance",
    "SupplyContract",
    "OfftakeContract",
    "NoticeOfAssignment",
    "LC",
    "Inspection",
    "Other",
];
const RELEASE_REASONS: [&str; 6] = [
    "Payment",
    "LCAcceptance",
    "LOIDischarge",
    "Substitution",
    "Loss",
    "ConsentedSale",
];
const LOCATION_TYPES: [&str; 4] = ["Vessel", "Warehouse", "TankFarm", "Other"];

#[test]
fn every_stage_name_is_stored_verbatim() {
    for name in LOT_STAGES.iter().chain(["FutureStage"].iter()) {
        let log = parse_stage_updated(&lot_event(
            "stage_updated",
            encode_map(vec![("stage", enum_val(name)), ("location", ScVal::Void)]),
        ))
        .unwrap();
        assert_eq!(log.params["stage"], *name);
    }
}

#[test]
fn every_control_kind_is_stored_verbatim() {
    for name in CONTROL_KINDS.iter().chain(["FutureKind"].iter()) {
        let log = parse_control_updated(&lot_event(
            "control_updated",
            encode_map(vec![(
                "control",
                map_val(vec![("kind", enum_val(name)), ("reference", str_val("r"))]),
            )]),
        ))
        .unwrap();
        assert_eq!(log.params["control"]["kind"], *name);
    }
}

#[test]
fn every_doc_kind_is_stored_verbatim() {
    for name in DOC_KINDS.iter().chain(["FutureDoc"].iter()) {
        let log = parse_doc_added(&lot_event(
            "doc_added",
            encode_map(vec![
                ("kind", enum_val(name)),
                ("sha256", bytes_val(&hash_bytes())),
            ]),
        ))
        .unwrap();
        assert_eq!(log.params["kind"], *name);
    }
}

#[test]
fn every_release_reason_is_stored_verbatim() {
    for name in RELEASE_REASONS.iter().chain(["FutureReason"].iter()) {
        let log = parse_released(&lot_event(
            "released",
            encode_map(vec![
                ("qty", i128_val(1)),
                ("reason", enum_val(name)),
                ("ref_hash", bytes_val(&hash_bytes())),
            ]),
        ))
        .unwrap();
        assert_eq!(log.params["reason"], *name);
    }
}

#[test]
fn every_location_type_is_stored_verbatim() {
    for name in LOCATION_TYPES.iter().chain(["FutureLoc"].iter()) {
        let loc = map_val(vec![
            ("location_type", enum_val(name)),
            ("identifier", str_val("id")),
            ("tracking_url", str_val("")),
        ]);
        let log = parse_stage_updated(&lot_event(
            "stage_updated",
            encode_map(vec![("stage", enum_val("InStorage")), ("location", loc)]),
        ))
        .unwrap();
        assert_eq!(log.params["location"]["location_type"], *name);
    }
}

// ── dispatch_collateral_registry ──────────────────────────────────────────────

fn sample_for(topic: &str) -> RawEvent {
    let h = || bytes_val(&hash_bytes());
    match topic {
        "pledged" => lot_event(topic, encode_map(vec![])),
        "haircut_set" => lot_event(topic, encode_map(vec![("bps", ScVal::U32(1))])),
        "floor_set" => raw(
            topic,
            vec![encode_u32(7)],
            encode_map(vec![("bps", ScVal::U32(1))]),
        ),
        "revalued" => lot_event(
            topic,
            encode_map(vec![
                ("value_per_unit", i128_val(1)),
                ("benchmark", sym_val("PAR")),
                ("report_hash", h()),
            ]),
        ),
        "stage_updated" => lot_event(
            topic,
            encode_map(vec![("stage", enum_val("Sold")), ("location", ScVal::Void)]),
        ),
        "control_updated" => lot_event(
            topic,
            encode_map(vec![(
                "control",
                map_val(vec![("kind", enum_val("Cma")), ("reference", str_val("r"))]),
            )]),
        ),
        "doc_added" => lot_event(
            topic,
            encode_map(vec![("kind", enum_val("Other")), ("sha256", h())]),
        ),
        "quantity_adjusted" => lot_event(
            topic,
            encode_map(vec![
                ("old", i128_val(1)),
                ("new", i128_val(2)),
                ("reason", str_val("r")),
                ("sha256", h()),
            ]),
        ),
        "released" => lot_event(
            topic,
            encode_map(vec![
                ("qty", i128_val(1)),
                ("reason", enum_val("Sold")),
                ("ref_hash", h()),
            ]),
        ),
        "liquidated" => lot_event(
            topic,
            encode_map(vec![("sale_id", ScVal::U32(1)), ("qty", i128_val(1))]),
        ),
        "margin_call" => raw(
            topic,
            vec![encode_u32(7)],
            encode_map(vec![
                ("coverage_bps", ScVal::U32(1)),
                ("floor_bps", ScVal::U32(2)),
            ]),
        ),
        _ => unreachable!(),
    }
}

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

#[test]
fn dispatch_routes_all_eleven_topics() {
    for (topic, name) in TOPICS {
        let log = dispatch_collateral_registry(&sample_for(topic))
            .unwrap_or_else(|| panic!("{topic} should dispatch"));
        assert_eq!(log.event_name, name);
    }
}

#[test]
fn dispatch_ignores_unrelated_events() {
    for topic in ["loan_registry_set", "paused", "transfer"] {
        let ev = raw(topic, vec![], encode_map(vec![]));
        assert!(dispatch_collateral_registry(&ev).is_none());
    }
}

#[test]
fn dispatch_malformed_known_topic_is_none() {
    for (topic, _) in TOPICS {
        let mut ev = sample_for(topic);
        ev.value_base64 = "not-base64!".to_owned();
        if topic == "pledged" {
            continue;
        }
        assert!(dispatch_collateral_registry(&ev).is_none(), "{topic}");
    }
}

#[test]
fn is_collateral_registry_event_matches_pascal_names_only() {
    for (topic, name) in TOPICS {
        assert!(is_collateral_registry_event(name));
        assert!(!is_collateral_registry_event(topic));
        assert!(!is_loan_registry_event(name));
    }
    for other in ["LoanDrawn", "AssetTransfer", "WireIn", ""] {
        assert!(!is_collateral_registry_event(other));
    }
}
