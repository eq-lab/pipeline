/// Unit tests for LoanRegistry Soroban event parsers.
///
/// All tests use locally constructed `RawEvent` values — no live RPC, no DB.
/// ScVal fixtures are built in-test via `stellar-xdr` helpers, mirroring
/// what soroban-sdk's `#[contractevent]` macro produces:
///   - topics[0] = ScVal::Symbol(snake_case_event_name)
///   - topics[1..n] = #[topic] fields in declaration order
///   - value = ScVal::Map with non-topic fields (sorted alphabetically)
///
/// Event shapes are taken from `pipeline-stellar-contracts/contracts/loan-registry/src/event.rs`
/// (#1433), not from whatever makes a test pass.
use alloy::primitives::U256;
use pipeline_worker::indexer::stellar::loan_registry_parsers::{
    extract_closure_reason, extract_loan_status, extract_repayment_data_from_map,
    extract_string_from_map, extract_u32, extract_u32_from_map, extract_u64_from_map,
    parse_disbursed, parse_economics_amended, parse_interest_adjusted, parse_loan_closed,
    parse_loan_defaulted, parse_loan_drawn, parse_loan_rolled_over, parse_loan_written_down,
    parse_payment_recorded, parse_payment_unrecorded, parse_status_updated, parse_undisbursed,
};
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use stellar_xdr::curr::{
    Int128Parts, Limits, ScBytes, ScMap, ScMapEntry, ScString, ScSymbol, ScVal, ScVec, StringM,
    UInt128Parts, VecM, WriteXdr,
};

// ── ScVal encode helpers ──────────────────────────────────────────────────────

fn encode_symbol(s: &str) -> String {
    let sym: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(sym))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_u32(v: u32) -> String {
    ScVal::U32(v).to_xdr_base64(Limits::none()).unwrap()
}

/// Encode a `#[contracttype]` unit enum as `ScVal::Vec([Symbol("Variant")])`.
fn encode_enum_variant(variant: &str) -> String {
    let sym: StringM<32> = variant.try_into().unwrap();
    let inner: VecM<ScVal> = vec![ScVal::Symbol(ScSymbol(sym))].try_into().unwrap();
    ScVal::Vec(Some(ScVec(inner)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_map_string(pairs: &[(&str, &str)]) -> String {
    let mut sorted = pairs.to_vec();
    sorted.sort_by_key(|(k, _)| *k);

    let entries: Vec<ScMapEntry> = sorted
        .iter()
        .map(|(k, v)| {
            let key_sym: StringM<32> = (*k).try_into().unwrap();
            let val_str: StringM<{ u32::MAX }> = (*v).try_into().unwrap();
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(key_sym)),
                val: ScVal::String(ScString(val_str)),
            }
        })
        .collect();

    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_map_u32(pairs: &[(&str, u32)]) -> String {
    let mut sorted = pairs.to_vec();
    sorted.sort_by_key(|(k, _)| *k);

    let entries: Vec<ScMapEntry> = sorted
        .iter()
        .map(|(k, v)| {
            let key_sym: StringM<32> = (*k).try_into().unwrap();
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(key_sym)),
                val: ScVal::U32(*v),
            }
        })
        .collect();

    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_map_mixed_u32_u64(u32_pairs: &[(&str, u32)], u64_pairs: &[(&str, u64)]) -> String {
    let mut entries: Vec<ScMapEntry> = Vec::new();

    for (k, v) in u32_pairs {
        let key_sym: StringM<32> = (*k).try_into().unwrap();
        entries.push(ScMapEntry {
            key: ScVal::Symbol(ScSymbol(key_sym)),
            val: ScVal::U32(*v),
        });
    }
    for (k, v) in u64_pairs {
        let key_sym: StringM<32> = (*k).try_into().unwrap();
        entries.push(ScMapEntry {
            key: ScVal::Symbol(ScSymbol(key_sym)),
            val: ScVal::U64(*v),
        });
    }
    entries.sort_by_key(|e| {
        if let ScVal::Symbol(sym) = &e.key {
            sym.0.to_utf8_string_lossy()
        } else {
            String::new()
        }
    });

    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

/// Encode a `ScVal::Map` with u128 fields (sorted alphabetically by key).
/// Mirrors the `#[contractevent]` data encoding for fields with type `u128`.
fn encode_map_u128(pairs: &[(&str, u128)]) -> String {
    let mut sorted = pairs.to_vec();
    sorted.sort_by_key(|(k, _)| *k);

    let entries: Vec<ScMapEntry> = sorted
        .iter()
        .map(|(k, v)| {
            let key_sym: StringM<32> = (*k).try_into().unwrap();
            let hi = (*v >> 64) as u64;
            let lo = (*v & 0xFFFF_FFFF_FFFF_FFFF) as u64;
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(key_sym)),
                val: ScVal::U128(UInt128Parts { hi, lo }),
            }
        })
        .collect();

    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

/// Build a `RepaymentData` sub-map (7 × u128) plus a sibling top-level `outstanding`
/// u128 field, matching the `PaymentRecorded`/`PaymentUnrecorded` data shape
/// `Map { repayment: RepaymentData, outstanding: u128 }`.
#[allow(clippy::too_many_arguments)]
fn encode_repayment_map(
    offtaker_received: u128,
    senior_principal_repaid: u128,
    senior_interest: u128,
    equity_distributed: u128,
    mgmt_fee: u128,
    perf_fee: u128,
    oet_alloc: u128,
    outstanding: u128,
) -> String {
    let mut inner_entries: Vec<ScMapEntry> = vec![
        ("equity_distributed", equity_distributed),
        ("mgmt_fee", mgmt_fee),
        ("oet_alloc", oet_alloc),
        ("offtaker_received", offtaker_received),
        ("perf_fee", perf_fee),
        ("senior_interest", senior_interest),
        ("senior_principal_repaid", senior_principal_repaid),
    ]
    .into_iter()
    .map(|(k, v)| {
        let key_sym: StringM<32> = k.try_into().unwrap();
        let hi = (v >> 64) as u64;
        let lo = (v & 0xFFFF_FFFF_FFFF_FFFF) as u64;
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol(key_sym)),
            val: ScVal::U128(UInt128Parts { hi, lo }),
        }
    })
    .collect();
    inner_entries.sort_by_key(|e| {
        if let ScVal::Symbol(sym) = &e.key {
            sym.0.to_utf8_string_lossy()
        } else {
            String::new()
        }
    });

    let inner_map: VecM<ScMapEntry> = inner_entries.try_into().unwrap();
    let inner = ScVal::Map(Some(ScMap(inner_map)));

    let repayment_key: StringM<32> = "repayment".try_into().unwrap();
    let outstanding_key: StringM<32> = "outstanding".try_into().unwrap();
    let outstanding_hi = (outstanding >> 64) as u64;
    let outstanding_lo = (outstanding & 0xFFFF_FFFF_FFFF_FFFF) as u64;
    // Alphabetical: "outstanding" < "repayment".
    let outer_entries = vec![
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol(outstanding_key)),
            val: ScVal::U128(UInt128Parts {
                hi: outstanding_hi,
                lo: outstanding_lo,
            }),
        },
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol(repayment_key)),
            val: inner,
        },
    ];
    let outer_map: VecM<ScMapEntry> = outer_entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(outer_map)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

/// Build the `InterestAdjusted` data map `Map { delta: i128, reason_hash: BytesN<32> }`.
fn encode_interest_adjusted_map(delta: i128, reason_hash: [u8; 32]) -> String {
    let delta_key: StringM<32> = "delta".try_into().unwrap();
    let hash_key: StringM<32> = "reason_hash".try_into().unwrap();
    let hi = (delta >> 64) as i64;
    let lo = (delta & 0xFFFF_FFFF_FFFF_FFFF) as u64;
    // Alphabetical: "delta" < "reason_hash".
    let entries = vec![
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol(delta_key)),
            val: ScVal::I128(Int128Parts { hi, lo }),
        },
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol(hash_key)),
            val: ScVal::Bytes(ScBytes(reason_hash.to_vec().try_into().unwrap())),
        },
    ];
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_empty_map() -> String {
    ScVal::Map(Some(ScMap(VecM::default())))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

// ── Test constants ────────────────────────────────────────────────────────────

const LR_CONTRACT: &str = "CDWGDGLKZRGYPZYVXELOWBHIVRPAHGK3DM6AF4M4J3QKQB47QPNKM2LB";

fn make_raw_event(
    contract_id: &str,
    event_name_sym: &str,
    topics_after_sym: Vec<String>,
    value: String,
) -> RawEvent {
    let mut topics = vec![encode_symbol(event_name_sym)];
    topics.extend(topics_after_sym);
    RawEvent {
        contract_id: contract_id.to_owned(),
        event_name: event_name_sym.to_owned(),
        topics_base64: topics,
        value_base64: value,
        ledger: 2_000_000,
        ledger_closed_at_unix: 1_700_100_000,
        tx_hash: "deadbeef".to_owned(),
        tx_index: 1,
        op_index: 0,
        event_index_in_op: 2,
    }
}

// ── parse_loan_drawn ──────────────────────────────────────────────────────────

#[test]
fn loan_drawn_decodes_fixture() {
    let loan_id: u32 = 42;
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_drawn",
        vec![encode_u32(loan_id)],
        encode_map_string(&[("metadata_uri", "ipfs://QmTestCid")]),
    );

    let log = parse_loan_drawn(&raw).expect("should decode LoanDrawn");
    assert_eq!(log.event_name, "LoanDrawn");
    assert_eq!(log.contract_address, LR_CONTRACT);
    assert_eq!(log.params["loan_id"], "42");
    assert!(
        log.params.get("holder").is_none(),
        "holder is no longer emitted (#1433)"
    );
    assert_eq!(log.params["metadata_uri"], "ipfs://QmTestCid");
    assert_eq!(log.block_number, 2_000_000);
    assert_eq!(log.block_timestamp, 1_700_100_000);
    // log_index = tx_index*1000 + op_index*100 + event_index = 1*1000 + 0 + 2 = 1002
    assert_eq!(log.log_index, 1002);
}

#[test]
fn loan_drawn_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "status_updated",
        vec![encode_u32(1)],
        encode_map_string(&[("metadata_uri", "ipfs://Q")]),
    );
    assert!(parse_loan_drawn(&raw).is_none());
}

/// Regression test for the Issue this plan realigns: the deployed #36 contract emits
/// a **two-topic** `loan_drawn` (`[loan_drawn, loan_id]`, no `holder`). The pre-#1433
/// parser required 3 topics and silently dropped every such event.
#[test]
fn loan_drawn_decodes_two_topic_event() {
    let raw = RawEvent {
        event_name: "loan_drawn".to_owned(),
        topics_base64: vec![encode_symbol("loan_drawn"), encode_u32(1)],
        value_base64: encode_map_string(&[("metadata_uri", "ipfs://Q")]),
        contract_id: LR_CONTRACT.to_owned(),
        ledger: 1,
        ledger_closed_at_unix: 0,
        tx_hash: String::new(),
        tx_index: 0,
        op_index: 0,
        event_index_in_op: 0,
    };
    assert!(
        parse_loan_drawn(&raw).is_some(),
        "two-topic loan_drawn (the #36 contract's actual shape) must decode"
    );
}

#[test]
fn loan_drawn_rejects_missing_loan_id_topic() {
    let raw = RawEvent {
        event_name: "loan_drawn".to_owned(),
        topics_base64: vec![encode_symbol("loan_drawn")], // missing loan_id
        value_base64: encode_map_string(&[("metadata_uri", "ipfs://Q")]),
        contract_id: LR_CONTRACT.to_owned(),
        ledger: 1,
        ledger_closed_at_unix: 0,
        tx_hash: String::new(),
        tx_index: 0,
        op_index: 0,
        event_index_in_op: 0,
    };
    assert!(parse_loan_drawn(&raw).is_none());
}

// ── parse_status_updated ──────────────────────────────────────────────────────

#[test]
fn status_updated_decodes_performing() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "status_updated",
        vec![encode_u32(7), encode_enum_variant("Performing")],
        encode_empty_map(),
    );

    let log = parse_status_updated(&raw).expect("should decode LoanStatusUpdated");
    assert_eq!(log.event_name, "LoanStatusUpdated");
    assert_eq!(log.params["loan_id"], "7");
    assert_eq!(log.params["status"], "Performing");
}

#[test]
fn status_updated_decodes_default_variant() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "status_updated",
        vec![encode_u32(3), encode_enum_variant("Default")],
        encode_empty_map(),
    );

    let log = parse_status_updated(&raw).expect("should decode Default status");
    assert_eq!(log.params["status"], "Default");
}

#[test]
fn status_updated_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_drawn",
        vec![encode_u32(1), encode_enum_variant("Performing")],
        encode_empty_map(),
    );
    assert!(parse_status_updated(&raw).is_none());
}

// ── parse_loan_defaulted ─────────────────────────────────────────────────────

#[test]
fn loan_defaulted_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_defaulted",
        vec![encode_u32(99)],
        // Post-rework data shape: Map { outstanding: u128, moved: u128 } — no `ccr` (#1433).
        encode_map_u128(&[("outstanding", 5_000_000_000), ("moved", 2_500_000_000)]),
    );

    let log = parse_loan_defaulted(&raw).expect("should decode LoanDefaulted");
    assert_eq!(log.event_name, "LoanDefaulted");
    assert_eq!(log.params["loan_id"], "99");
    assert_eq!(log.params["outstanding"], "5000000000");
    assert_eq!(log.params["moved"], "2500000000");
    assert!(
        log.params.get("ccr_bps").is_none(),
        "ccr no longer exists on the reworked contract"
    );
}

#[test]
fn loan_defaulted_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_closed",
        vec![encode_u32(1)],
        encode_map_u128(&[("outstanding", 1), ("moved", 1)]),
    );
    assert!(parse_loan_defaulted(&raw).is_none());
}

// ── parse_loan_closed ────────────────────────────────────────────────────────

#[test]
fn loan_closed_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_closed",
        vec![encode_u32(11), encode_enum_variant("ScheduledMaturity")],
        encode_empty_map(),
    );

    let log = parse_loan_closed(&raw).expect("should decode LoanClosed");
    assert_eq!(log.event_name, "LoanClosed");
    assert_eq!(log.params["loan_id"], "11");
    assert_eq!(log.params["closure_reason"], "ScheduledMaturity");
}

#[test]
fn loan_closed_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_defaulted",
        vec![encode_u32(1), encode_enum_variant("None")],
        encode_empty_map(),
    );
    assert!(parse_loan_closed(&raw).is_none());
}

// ── parse_payment_recorded ────────────────────────────────────────────────────

#[test]
fn payment_recorded_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "payment_recorded",
        vec![encode_u32(20), encode_u32(3)],
        encode_repayment_map(
            1_000_000, // offtaker_received
            500_000,   // senior_principal_repaid
            250_000,   // senior_interest
            100_000,   // equity_distributed
            10_000,    // mgmt_fee
            5_000,     // perf_fee
            2_000,     // oet_alloc
            9_500_000, // outstanding (#1433)
        ),
    );

    let log = parse_payment_recorded(&raw).expect("should decode PaymentRecorded");
    assert_eq!(log.event_name, "PaymentRecorded");
    assert_eq!(log.params["loan_id"], "20");
    assert_eq!(log.params["repayment_id"], "3");
    assert_eq!(log.params["offtaker_received"], "1000000");
    assert_eq!(log.params["senior_principal_repaid"], "500000");
    assert_eq!(log.params["senior_interest"], "250000");
    assert_eq!(log.params["equity_distributed"], "100000");
    assert_eq!(log.params["mgmt_fee"], "10000");
    assert_eq!(log.params["perf_fee"], "5000");
    assert_eq!(log.params["oet_alloc"], "2000");
    assert_eq!(log.params["outstanding"], "9500000");
}

#[test]
fn payment_recorded_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_rolled_over",
        vec![encode_u32(1), encode_u32(1)],
        encode_repayment_map(1, 2, 3, 4, 5, 6, 7, 8),
    );
    assert!(parse_payment_recorded(&raw).is_none());
}

// ── parse_payment_unrecorded ──────────────────────────────────────────────────

#[test]
fn payment_unrecorded_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "payment_unrecorded",
        vec![encode_u32(20), encode_u32(3)],
        encode_repayment_map(
            1_000_000, 500_000, 250_000, 100_000, 10_000, 5_000, 2_000, 10_000_000,
        ),
    );

    let log = parse_payment_unrecorded(&raw).expect("should decode PaymentUnrecorded");
    assert_eq!(log.event_name, "PaymentUnrecorded");
    assert_eq!(log.params["loan_id"], "20");
    assert_eq!(log.params["repayment_id"], "3");
    assert_eq!(log.params["senior_principal_repaid"], "500000");
    assert_eq!(log.params["outstanding"], "10000000");
}

#[test]
fn payment_unrecorded_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "payment_recorded",
        vec![encode_u32(1), encode_u32(1)],
        encode_repayment_map(1, 2, 3, 4, 5, 6, 7, 8),
    );
    assert!(parse_payment_unrecorded(&raw).is_none());
}

#[test]
fn payment_recorded_and_payment_unrecorded_do_not_claim_each_others_events() {
    // Same topic arity, different `event_name` guard — regression against the two
    // parsers silently cross-matching.
    let recorded_raw = make_raw_event(
        LR_CONTRACT,
        "payment_recorded",
        vec![encode_u32(1), encode_u32(1)],
        encode_repayment_map(1, 2, 3, 4, 5, 6, 7, 8),
    );
    let unrecorded_raw = make_raw_event(
        LR_CONTRACT,
        "payment_unrecorded",
        vec![encode_u32(1), encode_u32(1)],
        encode_repayment_map(1, 2, 3, 4, 5, 6, 7, 8),
    );

    assert!(parse_payment_recorded(&recorded_raw).is_some());
    assert!(parse_payment_unrecorded(&recorded_raw).is_none());
    assert!(parse_payment_unrecorded(&unrecorded_raw).is_some());
    assert!(parse_payment_recorded(&unrecorded_raw).is_none());
}

// ── parse_disbursed / parse_undisbursed ───────────────────────────────────────

#[test]
fn disbursed_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "disbursed",
        vec![encode_u32(5)],
        encode_map_u128(&[("amount", 3_000_000_000), ("outstanding", 3_000_000_000)]),
    );

    let log = parse_disbursed(&raw).expect("should decode Disbursed");
    assert_eq!(log.event_name, "Disbursed");
    assert_eq!(log.params["loan_id"], "5");
    assert_eq!(log.params["amount"], "3000000000");
    assert_eq!(log.params["outstanding"], "3000000000");
}

#[test]
fn disbursed_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "undisbursed",
        vec![encode_u32(1)],
        encode_map_u128(&[("amount", 1), ("outstanding", 1)]),
    );
    assert!(parse_disbursed(&raw).is_none());
}

#[test]
fn undisbursed_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "undisbursed",
        vec![encode_u32(5)],
        encode_map_u128(&[("amount", 1_000_000_000), ("outstanding", 2_000_000_000)]),
    );

    let log = parse_undisbursed(&raw).expect("should decode Undisbursed");
    assert_eq!(log.event_name, "Undisbursed");
    assert_eq!(log.params["loan_id"], "5");
    assert_eq!(log.params["amount"], "1000000000");
    assert_eq!(log.params["outstanding"], "2000000000");
}

#[test]
fn undisbursed_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "disbursed",
        vec![encode_u32(1)],
        encode_map_u128(&[("amount", 1), ("outstanding", 1)]),
    );
    assert!(parse_undisbursed(&raw).is_none());
}

// ── parse_loan_written_down ────────────────────────────────────────────────────

#[test]
fn loan_written_down_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_written_down",
        vec![encode_u32(8)],
        encode_map_u128(&[
            ("amount", 400_000_000),
            ("outstanding", 100_000_000),
            ("burned", 300_000_000),
            ("unabsorbed", 100_000_000),
        ]),
    );

    let log = parse_loan_written_down(&raw).expect("should decode LoanWrittenDown");
    assert_eq!(log.event_name, "LoanWrittenDown");
    assert_eq!(log.params["loan_id"], "8");
    assert_eq!(log.params["amount"], "400000000");
    assert_eq!(log.params["outstanding"], "100000000");
    assert_eq!(log.params["burned"], "300000000");
    assert_eq!(log.params["unabsorbed"], "100000000");
}

#[test]
fn loan_written_down_decodes_u128_max_fields() {
    let max = u128::MAX;
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_written_down",
        vec![encode_u32(8)],
        encode_map_u128(&[
            ("amount", max),
            ("outstanding", max),
            ("burned", max),
            ("unabsorbed", max),
        ]),
    );

    let log = parse_loan_written_down(&raw).expect("should decode u128::MAX fields");
    assert_eq!(log.params["amount"], max.to_string());
    assert_eq!(log.params["outstanding"], max.to_string());
    assert_eq!(log.params["burned"], max.to_string());
    assert_eq!(log.params["unabsorbed"], max.to_string());
}

#[test]
fn loan_written_down_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_defaulted",
        vec![encode_u32(1)],
        encode_map_u128(&[
            ("amount", 1),
            ("outstanding", 1),
            ("burned", 1),
            ("unabsorbed", 1),
        ]),
    );
    assert!(parse_loan_written_down(&raw).is_none());
}

// ── parse_interest_adjusted ────────────────────────────────────────────────────

#[test]
fn interest_adjusted_decodes_positive_delta() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "interest_adjusted",
        vec![encode_u32(12)],
        encode_interest_adjusted_map(500_000, [0xAB; 32]),
    );

    let log = parse_interest_adjusted(&raw).expect("should decode InterestAdjusted");
    assert_eq!(log.event_name, "InterestAdjusted");
    assert_eq!(log.params["loan_id"], "12");
    assert_eq!(log.params["delta"], "500000");
    assert_eq!(log.params["reason_hash"], "ab".repeat(32));
}

#[test]
fn interest_adjusted_decodes_negative_delta() {
    // Negative = waiver. Directly covers R3: a sign-extension bug here is silent.
    let raw = make_raw_event(
        LR_CONTRACT,
        "interest_adjusted",
        vec![encode_u32(12)],
        encode_interest_adjusted_map(-250_000, [0; 32]),
    );

    let log = parse_interest_adjusted(&raw).expect("should decode a negative delta");
    assert_eq!(log.params["delta"], "-250000");
}

#[test]
fn interest_adjusted_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_defaulted",
        vec![encode_u32(1)],
        encode_interest_adjusted_map(1, [0; 32]),
    );
    assert!(parse_interest_adjusted(&raw).is_none());
}

// ── parse_loan_rolled_over ────────────────────────────────────────────────────

#[test]
fn loan_rolled_over_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_rolled_over",
        vec![encode_u32(30)],
        encode_map_mixed_u32_u64(
            &[("new_rate", 850)],
            &[("new_maturity_timestamp", 1_800_000)],
        ),
    );

    let log = parse_loan_rolled_over(&raw).expect("should decode LoanRolledOver");
    assert_eq!(log.event_name, "LoanRolledOver");
    assert_eq!(log.params["loan_id"], "30");
    assert_eq!(log.params["new_rate"], 850);
    assert_eq!(log.params["new_maturity_timestamp"], "1800000");
}

#[test]
fn loan_rolled_over_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "economics_amended",
        vec![encode_u32(1)],
        encode_map_mixed_u32_u64(&[("new_rate", 100)], &[("new_maturity_timestamp", 999)]),
    );
    assert!(parse_loan_rolled_over(&raw).is_none());
}

#[test]
fn loan_rolled_over_decodes_u32_max_rate() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_rolled_over",
        vec![encode_u32(1)],
        encode_map_mixed_u32_u64(&[("new_rate", u32::MAX)], &[("new_maturity_timestamp", 1)]),
    );
    let log = parse_loan_rolled_over(&raw).expect("should decode u32::MAX new_rate");
    assert_eq!(log.params["new_rate"], u32::MAX);
}

// ── parse_economics_amended ───────────────────────────────────────────────────

#[test]
fn economics_amended_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "economics_amended",
        vec![encode_u32(55)],
        encode_map_mixed_u32_u64(
            &[("new_rate", 1200)],
            &[("new_maturity_timestamp", 2_000_000)],
        ),
    );

    let log = parse_economics_amended(&raw).expect("should decode EconomicsAmended");
    assert_eq!(log.event_name, "EconomicsAmended");
    assert_eq!(log.params["loan_id"], "55");
    assert_eq!(log.params["new_rate"], 1200);
    assert_eq!(log.params["new_maturity_timestamp"], "2000000");
}

#[test]
fn economics_amended_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_rolled_over",
        vec![encode_u32(1)],
        encode_map_mixed_u32_u64(&[("new_rate", 50)], &[("new_maturity_timestamp", 100)]),
    );
    assert!(parse_economics_amended(&raw).is_none());
}

// ── extract_u32 ScVal helper ──────────────────────────────────────────────────

#[test]
fn extract_u32_decodes_zero() {
    assert_eq!(extract_u32(&encode_u32(0)), Some(0));
}

#[test]
fn extract_u32_decodes_max() {
    assert_eq!(extract_u32(&encode_u32(u32::MAX)), Some(u32::MAX));
}

#[test]
fn extract_u32_rejects_wrong_type() {
    // Feed a symbol where U32 is expected.
    assert!(extract_u32(&encode_symbol("not_a_u32")).is_none());
}

// ── extract_loan_status / extract_closure_reason ──────────────────────────────

#[test]
fn extract_loan_status_returns_variant_name() {
    for variant in &["Performing", "WatchList", "Default", "Closed"] {
        let b64 = encode_enum_variant(variant);
        assert_eq!(extract_loan_status(&b64).as_deref(), Some(*variant));
    }
}

#[test]
fn extract_closure_reason_returns_variant_name() {
    for variant in &[
        "None",
        "ScheduledMaturity",
        "EarlyRepayment",
        "Default",
        "OtherWriteDown",
    ] {
        let b64 = encode_enum_variant(variant);
        assert_eq!(extract_closure_reason(&b64).as_deref(), Some(*variant));
    }
}

#[test]
fn extract_loan_status_rejects_non_vec() {
    // A plain Symbol is not a Vec wrapper — should return None.
    assert!(extract_loan_status(&encode_symbol("Performing")).is_none());
}

// ── extract_repayment_data_from_map ───────────────────────────────────────────

#[test]
fn extract_repayment_data_decodes_all_fields() {
    let b64 = encode_repayment_map(10, 20, 30, 40, 50, 60, 70, 0);
    let view = extract_repayment_data_from_map(&b64, "repayment")
        .expect("should decode RepaymentDataView");

    assert_eq!(view.offtaker_received, U256::from(10u128));
    assert_eq!(view.senior_principal_repaid, U256::from(20u128));
    assert_eq!(view.senior_interest, U256::from(30u128));
    assert_eq!(view.equity_distributed, U256::from(40u128));
    assert_eq!(view.mgmt_fee, U256::from(50u128));
    assert_eq!(view.perf_fee, U256::from(60u128));
    assert_eq!(view.oet_alloc, U256::from(70u128));
}

#[test]
fn extract_repayment_data_rejects_wrong_key() {
    let b64 = encode_repayment_map(1, 2, 3, 4, 5, 6, 7, 0);
    assert!(extract_repayment_data_from_map(&b64, "not_repayment").is_none());
}

// ── extract_string_from_map ───────────────────────────────────────────────────

#[test]
fn extract_string_from_map_decodes_metadata_uri() {
    let b64 = encode_map_string(&[("metadata_uri", "ipfs://QmFoo")]);
    assert_eq!(
        extract_string_from_map(&b64, "metadata_uri").as_deref(),
        Some("ipfs://QmFoo")
    );
}

#[test]
fn extract_string_from_map_returns_none_for_missing_key() {
    let b64 = encode_map_string(&[("metadata_uri", "ipfs://QmFoo")]);
    assert!(extract_string_from_map(&b64, "other_key").is_none());
}

// ── extract_u32_from_map / extract_u64_from_map ───────────────────────────────

#[test]
fn extract_u32_from_map_decodes_new_rate() {
    let b64 = encode_map_u32(&[("new_rate", 9999)]);
    assert_eq!(extract_u32_from_map(&b64, "new_rate"), Some(9999));
}

#[test]
fn extract_u64_from_map_decodes_new_maturity_timestamp() {
    let b64 = encode_map_mixed_u32_u64(&[], &[("new_maturity_timestamp", 1_234_567_890)]);
    assert_eq!(
        extract_u64_from_map(&b64, "new_maturity_timestamp"),
        Some(1_234_567_890)
    );
}
