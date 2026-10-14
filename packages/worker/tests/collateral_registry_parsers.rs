use alloy::{
    primitives::{address, b256, keccak256, Address, Bytes, FixedBytes, LogData, B256, U256},
    rpc::types::Log,
    sol_types::SolEvent,
};
use serde_json::{json, Value};

use pipeline_worker::indexer::collateral_registry_parsers::{
    benchmark_string, control_kind_name, doc_kind_name, location_type_name, lot_stage_name,
    parse_collateral_registry_log, release_reason_name,
};

alloy::sol! {
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

    event WireInAssigned(uint256 indexed id, address indexed receiver);
}

const CONTRACT: Address = address!("b3D45A8E4816321F806a5eDCB62330CAaC23b26f");
const TX_HASH: B256 = b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

fn log_from(data: LogData) -> Log {
    Log {
        inner: alloy::primitives::Log {
            address: CONTRACT,
            data,
        },
        block_number: Some(100),
        transaction_hash: Some(TX_HASH),
        log_index: Some(3),
        ..Default::default()
    }
}

fn u(n: u64) -> U256 {
    U256::from(n)
}

fn h(byte: u8) -> B256 {
    FixedBytes::<32>::repeat_byte(byte)
}

fn padded(s: &str) -> B256 {
    let mut b = [0u8; 32];
    b[..s.len()].copy_from_slice(s.as_bytes());
    B256::from(b)
}

fn parse(data: LogData) -> (String, Value) {
    let ev = parse_collateral_registry_log(&log_from(data)).expect("decodes");
    assert_eq!(ev.contract_address, CONTRACT);
    assert_eq!(ev.block_number, 100);
    assert_eq!(ev.tx_hash, TX_HASH);
    assert_eq!(ev.log_index, 3);
    assert_eq!(ev.block_timestamp, 0);
    (ev.event_name, ev.params)
}

// ── Per-event decoding ────────────────────────────────────────────────────────

#[test]
fn pledged_decodes() {
    let (name, params) = parse(
        Pledged {
            loanId: u(7),
            lotId: u(3),
        }
        .encode_log_data(),
    );
    assert_eq!(name, "Pledged");
    assert_eq!(params, json!({ "loan_id": "7", "lot_id": "3" }));
}

#[test]
fn haircut_set_decodes_bps_as_number() {
    let (name, params) = parse(
        HaircutSet {
            loanId: u(7),
            lotId: u(3),
            bps: 2500,
        }
        .encode_log_data(),
    );
    assert_eq!(name, "HaircutSet");
    assert_eq!(
        params,
        json!({ "loan_id": "7", "lot_id": "3", "bps": 2500 })
    );
    assert!(params["bps"].is_u64());
}

#[test]
fn floor_set_decodes() {
    let (name, params) = parse(
        FloorSet {
            loanId: u(7),
            bps: 11000,
        }
        .encode_log_data(),
    );
    assert_eq!(name, "FloorSet");
    assert_eq!(params, json!({ "loan_id": "7", "bps": 11000 }));
}

#[test]
fn revalued_decodes_with_ascii_benchmark() {
    let (name, params) = parse(
        Revalued {
            loanId: u(7),
            lotId: u(3),
            valuePerUnit: u(1_000_000),
            benchmark: padded("PAR"),
            reportHash: h(0xab),
        }
        .encode_log_data(),
    );
    assert_eq!(name, "Revalued");
    assert_eq!(
        params,
        json!({
            "loan_id": "7",
            "lot_id": "3",
            "value_per_unit": "1000000",
            "benchmark": "PAR",
            "report_hash": "ab".repeat(32),
        })
    );
}

#[test]
fn stage_updated_with_location_nests_object() {
    let (name, params) = parse(
        StageUpdated {
            loanId: u(7),
            lotId: u(3),
            stage: 2,
            hasLocation: true,
            location: Location {
                locationType: 1,
                identifier: "WH-12".to_owned(),
                trackingUrl: "https://track/1".to_owned(),
            },
        }
        .encode_log_data(),
    );
    assert_eq!(name, "StageUpdated");
    assert_eq!(
        params,
        json!({
            "loan_id": "7",
            "lot_id": "3",
            "stage": "InStorage",
            "location": {
                "location_type": "Warehouse",
                "identifier": "WH-12",
                "tracking_url": "https://track/1",
            },
        })
    );
}

#[test]
fn stage_updated_without_location_is_null_even_with_nonzero_tuple() {
    let (_, params) = parse(
        StageUpdated {
            loanId: u(7),
            lotId: u(3),
            stage: 1,
            hasLocation: false,
            location: Location {
                locationType: 2,
                identifier: "stale".to_owned(),
                trackingUrl: "https://stale".to_owned(),
            },
        }
        .encode_log_data(),
    );
    assert_eq!(
        params,
        json!({ "loan_id": "7", "lot_id": "3", "stage": "Afloat", "location": null })
    );
}

#[test]
fn control_updated_nests_kind_and_ref() {
    let (name, params) = parse(
        ControlUpdated {
            loanId: u(7),
            lotId: u(3),
            control: Control {
                kind: 2,
                reference: "WR-9".to_owned(),
            },
        }
        .encode_log_data(),
    );
    assert_eq!(name, "ControlUpdated");
    assert_eq!(
        params,
        json!({
            "loan_id": "7",
            "lot_id": "3",
            "control": { "kind": "NegotiableWr", "ref": "WR-9" },
        })
    );
}

#[test]
fn control_kind_ordinal_zero_is_none() {
    let (_, params) = parse(
        ControlUpdated {
            loanId: u(1),
            lotId: u(1),
            control: Control {
                kind: 0,
                reference: String::new(),
            },
        }
        .encode_log_data(),
    );
    assert_eq!(params["control"], json!({ "kind": "None", "ref": "" }));
}

#[test]
fn doc_added_decodes() {
    let (name, params) = parse(
        DocAdded {
            loanId: u(7),
            lotId: u(3),
            kind: 7,
            hash: h(0x01),
        }
        .encode_log_data(),
    );
    assert_eq!(name, "DocAdded");
    assert_eq!(
        params,
        json!({ "loan_id": "7", "lot_id": "3", "kind": "LC", "hash": "01".repeat(32) })
    );
}

#[test]
fn quantity_adjusted_decodes() {
    let (name, params) = parse(
        QuantityAdjusted {
            loanId: u(7),
            lotId: u(3),
            oldQuantity: u(100),
            newQuantity: u(90),
            reason: "shrinkage".to_owned(),
            hash: h(0x02),
        }
        .encode_log_data(),
    );
    assert_eq!(name, "QuantityAdjusted");
    assert_eq!(
        params,
        json!({
            "loan_id": "7",
            "lot_id": "3",
            "old_quantity": "100",
            "new_quantity": "90",
            "reason": "shrinkage",
            "hash": "02".repeat(32),
        })
    );
}

#[test]
fn released_decodes() {
    let (name, params) = parse(
        Released {
            loanId: u(7),
            lotId: u(3),
            quantity: u(40),
            reason: 5,
            refHash: h(0x03),
        }
        .encode_log_data(),
    );
    assert_eq!(name, "Released");
    assert_eq!(
        params,
        json!({
            "loan_id": "7",
            "lot_id": "3",
            "quantity": "40",
            "reason": "ConsentedSale",
            "ref_hash": "03".repeat(32),
        })
    );
}

#[test]
fn liquidated_decodes() {
    let (name, params) = parse(
        Liquidated {
            loanId: u(7),
            lotId: u(3),
            saleId: u(12),
            quantity: u(5),
        }
        .encode_log_data(),
    );
    assert_eq!(name, "Liquidated");
    assert_eq!(
        params,
        json!({ "loan_id": "7", "lot_id": "3", "sale_id": "12", "quantity": "5" })
    );
}

#[test]
fn margin_call_decodes_bps_as_numbers() {
    let (name, params) = parse(
        MarginCall {
            loanId: u(7),
            coverageBps: 9000,
            floorBps: 11000,
        }
        .encode_log_data(),
    );
    assert_eq!(name, "MarginCall");
    assert_eq!(
        params,
        json!({ "loan_id": "7", "coverage_bps": 9000, "floor_bps": 11000 })
    );
}

#[test]
fn repeated_margin_calls_decode_independently() {
    let data = MarginCall {
        loanId: u(7),
        coverageBps: 9000,
        floorBps: 11000,
    }
    .encode_log_data();
    let first = parse_collateral_registry_log(&log_from(data.clone())).unwrap();
    let mut second_log = log_from(data);
    second_log.log_index = Some(4);
    let second = parse_collateral_registry_log(&second_log).unwrap();
    assert_eq!(first.params, second.params);
    assert_ne!(first.log_index, second.log_index);
}

#[test]
fn uint256_max_round_trips_as_decimal_string() {
    let (_, params) = parse(
        Revalued {
            loanId: u(1),
            lotId: u(1),
            valuePerUnit: U256::MAX,
            benchmark: padded("PAR"),
            reportHash: h(0),
        }
        .encode_log_data(),
    );
    assert_eq!(params["value_per_unit"], U256::MAX.to_string());
    let (_, params) = parse(
        Released {
            loanId: u(1),
            lotId: u(1),
            quantity: U256::MAX,
            reason: 0,
            refHash: h(0),
        }
        .encode_log_data(),
    );
    assert_eq!(params["quantity"], U256::MAX.to_string());
}

#[test]
fn out_of_range_enum_is_unknown_not_dropped() {
    let (_, params) = parse(
        DocAdded {
            loanId: u(1),
            lotId: u(1),
            kind: 200,
            hash: h(0),
        }
        .encode_log_data(),
    );
    assert_eq!(params["kind"], "Unknown");
}

// ── Ordinal tables ────────────────────────────────────────────────────────────

#[test]
fn lot_stage_ordinals() {
    let names = [
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
    for (i, n) in names.iter().enumerate() {
        assert_eq!(lot_stage_name(i as u8), *n);
    }
    assert_eq!(lot_stage_name(9), "Unknown");
}

#[test]
fn location_type_ordinals() {
    let names = ["Vessel", "Warehouse", "TankFarm", "Other"];
    for (i, n) in names.iter().enumerate() {
        assert_eq!(location_type_name(i as u8), *n);
    }
    assert_eq!(location_type_name(4), "Unknown");
}

#[test]
fn control_kind_ordinals() {
    let names = [
        "None",
        "EblToOrderOfTrust",
        "NegotiableWr",
        "Cma",
        "Acknowledged",
    ];
    for (i, n) in names.iter().enumerate() {
        assert_eq!(control_kind_name(i as u8), *n);
    }
    assert_eq!(control_kind_name(5), "Unknown");
}

#[test]
fn doc_kind_ordinals() {
    let names = [
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
    for (i, n) in names.iter().enumerate() {
        assert_eq!(doc_kind_name(i as u8), *n);
    }
    assert_eq!(doc_kind_name(10), "Unknown");
}

#[test]
fn release_reason_ordinals() {
    let names = [
        "Payment",
        "LCAcceptance",
        "LOIDischarge",
        "Substitution",
        "Loss",
        "ConsentedSale",
    ];
    for (i, n) in names.iter().enumerate() {
        assert_eq!(release_reason_name(i as u8), *n);
    }
    assert_eq!(release_reason_name(6), "Unknown");
}

// ── benchmark_string ──────────────────────────────────────────────────────────

#[test]
fn benchmark_trims_trailing_nuls() {
    assert_eq!(benchmark_string(&padded("PAR")), "PAR");
}

#[test]
fn benchmark_all_zero_falls_back_to_hex() {
    assert_eq!(benchmark_string(&B256::ZERO), "0".repeat(64));
}

#[test]
fn benchmark_non_ascii_falls_back_to_hex() {
    let mut b = [0u8; 32];
    b[0] = 0xff;
    b[1] = b'A';
    assert_eq!(benchmark_string(&B256::from(b)), hex::encode(b));
}

#[test]
fn benchmark_interior_nul_falls_back_to_hex() {
    let mut b = [0u8; 32];
    b[0] = b'A';
    b[2] = b'B';
    assert_eq!(benchmark_string(&B256::from(b)), hex::encode(b));
}

#[test]
fn benchmark_full_width_ascii_is_not_trimmed() {
    let s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
    assert_eq!(benchmark_string(&padded(s)), s);
}

// ── Negative routing ──────────────────────────────────────────────────────────

#[test]
fn pocket_released_is_rejected() {
    let topic0 = keccak256("Released(uint256,uint256,uint256,uint256)");
    assert_ne!(topic0, Released::SIGNATURE_HASH);
    let mut payload = Vec::new();
    payload.extend_from_slice(u(1).to_be_bytes::<32>().as_slice());
    payload.extend_from_slice(u(2).to_be_bytes::<32>().as_slice());
    let data = LogData::new(vec![topic0, h(0x07)], payload.into()).unwrap();
    assert!(parse_collateral_registry_log(&log_from(data)).is_none());
}

#[test]
fn unrelated_topic0_is_rejected() {
    let data = WireInAssigned {
        id: u(1),
        receiver: address!("1111111111111111111111111111111111111111"),
    }
    .encode_log_data();
    assert!(parse_collateral_registry_log(&log_from(data)).is_none());
}

#[test]
fn missing_log_meta_returns_none() {
    let data = Pledged {
        loanId: u(1),
        lotId: u(1),
    }
    .encode_log_data();
    let mut log = log_from(data);
    log.block_number = None;
    assert!(parse_collateral_registry_log(&log).is_none());
}

#[test]
fn wrong_topic_count_returns_none() {
    let data = Pledged {
        loanId: u(1),
        lotId: u(1),
    }
    .encode_log_data();
    let topics = vec![data.topics()[0], data.topics()[1]];
    let truncated = LogData::new(topics, data.data.clone()).unwrap();
    assert!(parse_collateral_registry_log(&log_from(truncated)).is_none());
}

#[test]
fn truncated_data_returns_none() {
    let data = StageUpdated {
        loanId: u(1),
        lotId: u(1),
        stage: 1,
        hasLocation: true,
        location: Location {
            locationType: 0,
            identifier: "IMO-1".to_owned(),
            trackingUrl: "u".to_owned(),
        },
    }
    .encode_log_data();
    let cut = data.data.slice(..40);
    let truncated = LogData::new(data.topics().to_vec(), cut).unwrap();
    assert!(parse_collateral_registry_log(&log_from(truncated)).is_none());
}

#[test]
fn malformed_known_topic_returns_none() {
    let mut data = Pledged {
        loanId: u(1),
        lotId: u(2),
    }
    .encode_log_data();
    data = LogData::new_unchecked(vec![data.topics()[0], h(1)], data.data.clone());
    assert!(parse_collateral_registry_log(&log_from(data)).is_none());
}

#[test]
fn unrelated_topic_returns_none() {
    let data = LogData::new_unchecked(vec![h(0xee), h(1)], Bytes::default());
    assert!(parse_collateral_registry_log(&log_from(data)).is_none());
}
