/// Unit tests for LoanRegistry Soroban event parsers.
///
/// All tests use locally constructed `RawEvent` values — no live RPC, no DB.
/// ScVal fixtures are built in-test via `stellar-xdr` helpers, mirroring
/// what soroban-sdk's `#[contractevent]` macro produces:
///   - topics[0] = ScVal::Symbol(snake_case_event_name)
///   - topics[1..n] = #[topic] fields in declaration order
///   - value = ScVal::Map with non-topic fields (sorted alphabetically)
use alloy::primitives::U256;
use pipeline_worker::indexer::stellar::loan_registry_parsers::{
    extract_closure_reason, extract_loan_status, extract_repayment_data_from_map,
    extract_string_from_map, extract_u32, extract_u32_from_map, extract_u64_from_map,
    parse_ccr_updated, parse_economics_amended, parse_loan_closed, parse_loan_defaulted,
    parse_loan_drawn, parse_loan_rolled_over, parse_location_updated, parse_payment_recorded,
    parse_status_updated,
};
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use stellar_xdr::curr::{
    AccountId, Limits, PublicKey, ScAddress, ScMap, ScMapEntry, ScString, ScSymbol, ScVal, ScVec,
    StringM, UInt128Parts, Uint256, VecM, WriteXdr,
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

fn encode_string_val(s: &str) -> String {
    let inner: StringM<{ u32::MAX }> = s.try_into().unwrap();
    ScVal::String(ScString(inner))
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_account(strkey: &str) -> String {
    let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
    ScVal::Address(ScAddress::Account(AccountId(
        PublicKey::PublicKeyTypeEd25519(Uint256(pk.0)),
    )))
    .to_xdr_base64(Limits::none())
    .unwrap()
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

/// Build a `RepaymentData` sub-map and wrap it in an outer map under key `"repayment"`.
fn encode_repayment_map(
    offtaker_received: u128,
    senior_principal_repaid: u128,
    senior_interest: u128,
    equity_distributed: u128,
    mgmt_fee: u128,
    perf_fee: u128,
    oet_alloc: u128,
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
    let outer_entry = ScMapEntry {
        key: ScVal::Symbol(ScSymbol(repayment_key)),
        val: inner,
    };
    let outer_map: VecM<ScMapEntry> = vec![outer_entry].try_into().unwrap();
    ScVal::Map(Some(ScMap(outer_map)))
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
const USER_G: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";

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
        vec![encode_u32(loan_id), encode_account(USER_G)],
        encode_map_string(&[("metadata_uri", "ipfs://QmTestCid")]),
    );

    let log = parse_loan_drawn(&raw).expect("should decode LoanDrawn");
    assert_eq!(log.event_name, "LoanDrawn");
    assert_eq!(log.contract_address, LR_CONTRACT);
    assert_eq!(log.params["loan_id"], "42");
    assert_eq!(log.params["holder"], USER_G);
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
        vec![encode_u32(1), encode_account(USER_G)],
        encode_map_string(&[("metadata_uri", "ipfs://Q")]),
    );
    assert!(parse_loan_drawn(&raw).is_none());
}

#[test]
fn loan_drawn_rejects_short_topics() {
    let raw = RawEvent {
        event_name: "loan_drawn".to_owned(),
        topics_base64: vec![encode_symbol("loan_drawn"), encode_u32(1)], // missing holder
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

// ── parse_ccr_updated ────────────────────────────────────────────────────────

#[test]
fn ccr_updated_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "ccr_updated",
        vec![encode_u32(10)],
        encode_map_u32(&[("new_ccr", 12500)]),
    );

    let log = parse_ccr_updated(&raw).expect("should decode LoanCCRUpdated");
    assert_eq!(log.event_name, "LoanCCRUpdated");
    assert_eq!(log.params["loan_id"], "10");
    assert_eq!(log.params["new_ccr"], 12500);
}

#[test]
fn ccr_updated_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "location_updated",
        vec![encode_u32(1)],
        encode_map_u32(&[("new_ccr", 100)]),
    );
    assert!(parse_ccr_updated(&raw).is_none());
}

// ── parse_location_updated ────────────────────────────────────────────────────

#[test]
fn location_updated_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "location_updated",
        vec![encode_u32(5), encode_string_val("TANK_FARM_US_HOUSTON")],
        encode_empty_map(),
    );

    let log = parse_location_updated(&raw).expect("should decode LoanLocationUpdated");
    assert_eq!(log.event_name, "LoanLocationUpdated");
    assert_eq!(log.params["loan_id"], "5");
    assert_eq!(log.params["new_location"], "TANK_FARM_US_HOUSTON");
}

#[test]
fn location_updated_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "ccr_updated",
        vec![encode_u32(1), encode_string_val("LOC")],
        encode_empty_map(),
    );
    assert!(parse_location_updated(&raw).is_none());
}

// ── parse_loan_defaulted ─────────────────────────────────────────────────────

#[test]
fn loan_defaulted_decodes_fixture() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_defaulted",
        vec![encode_u32(99)],
        encode_map_u32(&[("ccr", 500)]),
    );

    let log = parse_loan_defaulted(&raw).expect("should decode LoanDefaulted");
    assert_eq!(log.event_name, "LoanDefaulted");
    assert_eq!(log.params["loan_id"], "99");
    assert_eq!(log.params["ccr"], 500);
}

#[test]
fn loan_defaulted_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_closed",
        vec![encode_u32(1)],
        encode_map_u32(&[("ccr", 100)]),
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
}

#[test]
fn payment_recorded_rejects_wrong_event_name() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "loan_rolled_over",
        vec![encode_u32(1), encode_u32(1)],
        encode_repayment_map(1, 2, 3, 4, 5, 6, 7),
    );
    assert!(parse_payment_recorded(&raw).is_none());
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
    let b64 = encode_repayment_map(10, 20, 30, 40, 50, 60, 70);
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
    let b64 = encode_repayment_map(1, 2, 3, 4, 5, 6, 7);
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
fn extract_u32_from_map_decodes_new_ccr() {
    let b64 = encode_map_u32(&[("new_ccr", 9999)]);
    assert_eq!(extract_u32_from_map(&b64, "new_ccr"), Some(9999));
}

#[test]
fn extract_u64_from_map_decodes_new_maturity_timestamp() {
    let b64 = encode_map_mixed_u32_u64(&[], &[("new_maturity_timestamp", 1_234_567_890)]);
    assert_eq!(
        extract_u64_from_map(&b64, "new_maturity_timestamp"),
        Some(1_234_567_890)
    );
}

// ── u32 boundary values ────────────────────────────────────────────────────────

#[test]
fn u32_max_in_ccr_updated() {
    let raw = make_raw_event(
        LR_CONTRACT,
        "ccr_updated",
        vec![encode_u32(1)],
        encode_map_u32(&[("new_ccr", u32::MAX)]),
    );
    let log = parse_ccr_updated(&raw).expect("should decode u32::MAX ccr");
    assert_eq!(log.params["new_ccr"], u32::MAX);
}
