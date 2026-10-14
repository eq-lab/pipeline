// spec: docs/references/backend.md#stellar-deal-token-factory-indexing
use pipeline_worker::indexer::stellar::deal_token_factory_parsers::{
    parse_cargo_synced, parse_deal_registered, parse_deal_token_movement, parse_debt_synced,
    route_deal_token_events, DealTokenKind, DealTokenRef, DealTokenSet,
};
use pipeline_worker::indexer::stellar::parsers::dispatch_parser;
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use serde_json::json;
use shared::contract_logs_repo::DealRegistrationRow;
use stellar_xdr::curr::{
    AccountId, ContractId, Hash, Int128Parts, Limits, PublicKey, ScAddress, ScMap, ScMapEntry,
    ScString, ScSymbol, ScVal, StringM, Uint256, VecM, WriteXdr,
};

fn b64(val: &ScVal) -> String {
    val.to_xdr_base64(Limits::none()).unwrap()
}

fn encode_symbol(s: &str) -> String {
    let sym: StringM<32> = s.try_into().unwrap();
    b64(&ScVal::Symbol(ScSymbol(sym)))
}

fn encode_string(s: &str) -> String {
    b64(&ScVal::String(ScString(s.try_into().unwrap())))
}

fn encode_u32(v: u32) -> String {
    b64(&ScVal::U32(v))
}

fn contract_val(strkey: &str) -> ScVal {
    let c = stellar_strkey::Contract::from_string(strkey).unwrap();
    ScVal::Address(ScAddress::Contract(ContractId(Hash(c.0))))
}

fn account_val(strkey: &str) -> ScVal {
    let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
    ScVal::Address(ScAddress::Account(AccountId(
        PublicKey::PublicKeyTypeEd25519(Uint256(pk.0)),
    )))
}

fn encode_address(strkey: &str) -> String {
    if strkey.starts_with('G') {
        b64(&account_val(strkey))
    } else {
        b64(&contract_val(strkey))
    }
}

fn i128_val(v: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (v >> 64) as i64,
        lo: (v & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

fn encode_map(pairs: Vec<(&str, ScVal)>) -> String {
    let mut sorted = pairs;
    sorted.sort_by_key(|(k, _)| *k);
    let entries: Vec<ScMapEntry> = sorted
        .into_iter()
        .map(|(k, val)| {
            let key_sym: StringM<32> = k.try_into().unwrap();
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(key_sym)),
                val,
            }
        })
        .collect();
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    b64(&ScVal::Map(Some(ScMap(map))))
}

const FACTORY: &str = "CAIBACM665EPLGJTVC4IXWTDV7PTJH7NSLY5TGRDAMHQZX7TCQ74OSIP";
const DEBT: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const CARGO: &str = "CBKT4GAN5OFKXWE332AHXVY6ZWFNPGXQGFGSIENFLOEOHWSF5WAFT2AE";
const DEBT_2: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const CARGO_2: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const UNKNOWN: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const HOLDER: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const ADMIN: &str = "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU";
const BIG: i128 = 340_282_366_920_938_463_463; // > u64::MAX

fn raw_from(contract: &str, event_name: &str, topics: Vec<String>, value: String) -> RawEvent {
    let mut topics_base64 = vec![encode_symbol(event_name)];
    topics_base64.extend(topics);
    RawEvent {
        contract_id: contract.to_owned(),
        event_name: event_name.to_owned(),
        topics_base64,
        value_base64: value,
        ledger: 777,
        ledger_closed_at_unix: 1_790_000_000,
        tx_hash: "ff00".to_owned(),
        tx_index: 1,
        op_index: 0,
        event_index_in_op: 2,
    }
}

fn deal_registered_event() -> RawEvent {
    raw_from(
        FACTORY,
        "deal_registered",
        vec![encode_u32(42)],
        encode_map(vec![
            ("cargo", contract_val(CARGO)),
            ("debt", contract_val(DEBT)),
        ]),
    )
}

fn debt_synced_event(minted: i128, clawed: i128) -> RawEvent {
    raw_from(
        FACTORY,
        "debt_synced",
        vec![encode_u32(42)],
        encode_map(vec![
            ("clawed", i128_val(clawed)),
            ("minted", i128_val(minted)),
            ("previous", i128_val(10)),
            ("target", i128_val(BIG)),
        ]),
    )
}

fn cargo_synced_event(minted: i128, burned: i128) -> RawEvent {
    raw_from(
        FACTORY,
        "cargo_synced",
        vec![encode_u32(42)],
        encode_map(vec![
            ("burned", i128_val(burned)),
            ("minted", i128_val(minted)),
            ("previous", i128_val(5)),
            ("target", i128_val(7)),
        ]),
    )
}

fn debt_ref() -> DealTokenRef {
    DealTokenRef {
        loan_id: "42".to_owned(),
        kind: DealTokenKind::Debt,
    }
}

fn cargo_ref() -> DealTokenRef {
    DealTokenRef {
        loan_id: "42".to_owned(),
        kind: DealTokenKind::Cargo,
    }
}

fn asset_topic(code: &str) -> String {
    encode_string(&format!("{code}:{ADMIN}"))
}

fn dispatch(raw: &RawEvent, factory: Option<&str>) -> Option<String> {
    dispatch_parser(
        raw,
        "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO",
        "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL",
        "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
        None,
        None,
        None,
        factory,
    )
    .map(|l| l.event_name)
}

// ── Factory events ───────────────────────────────────────────────────────────

#[test]
fn deal_registered_decodes_loan_id_and_token_ids() {
    let log = parse_deal_registered(&deal_registered_event()).unwrap();
    assert_eq!(log.event_name, "DealRegistered");
    assert_eq!(log.contract_address, FACTORY);
    assert_eq!(log.block_number, 777);
    assert_eq!(
        log.params,
        json!({ "loan_id": "42", "debt": DEBT, "cargo": CARGO })
    );
}

#[test]
fn deal_registered_rejects_wrong_name_missing_topic_and_missing_key() {
    let mut wrong = deal_registered_event();
    wrong.event_name = "debt_synced".to_owned();
    assert!(parse_deal_registered(&wrong).is_none());

    let mut no_topic = deal_registered_event();
    no_topic.topics_base64.truncate(1);
    assert!(parse_deal_registered(&no_topic).is_none());

    let missing_key = raw_from(
        FACTORY,
        "deal_registered",
        vec![encode_u32(42)],
        encode_map(vec![("debt", contract_val(DEBT))]),
    );
    assert!(parse_deal_registered(&missing_key).is_none());
}

#[test]
fn debt_synced_decodes_all_amounts_as_strings() {
    let log = parse_debt_synced(&debt_synced_event(3, 0)).unwrap();
    assert_eq!(log.event_name, "DebtSynced");
    assert_eq!(
        log.params,
        json!({
            "loan_id": "42",
            "target": BIG.to_string(),
            "previous": "10",
            "minted": "3",
            "clawed": "0",
        })
    );
}

#[test]
fn no_op_syncs_are_decoded_not_dropped() {
    let debt = parse_debt_synced(&debt_synced_event(0, 0)).unwrap();
    assert_eq!(debt.params["minted"], "0");
    assert_eq!(debt.params["clawed"], "0");
    let cargo = parse_cargo_synced(&cargo_synced_event(0, 0)).unwrap();
    assert_eq!(cargo.params["minted"], "0");
    assert_eq!(cargo.params["burned"], "0");
}

#[test]
fn cargo_synced_decodes_all_amounts_as_strings() {
    let log = parse_cargo_synced(&cargo_synced_event(9, 2)).unwrap();
    assert_eq!(log.event_name, "CargoSynced");
    assert_eq!(
        log.params,
        json!({
            "loan_id": "42",
            "target": "7",
            "previous": "5",
            "minted": "9",
            "burned": "2",
        })
    );
}

#[test]
fn sync_parsers_reject_other_event_names() {
    assert!(parse_debt_synced(&cargo_synced_event(1, 1)).is_none());
    assert!(parse_cargo_synced(&debt_synced_event(1, 1)).is_none());
}

// ── Token movements ──────────────────────────────────────────────────────────

#[test]
fn cap67_mint_has_null_from_and_the_recipient_as_to() {
    let raw = raw_from(
        DEBT,
        "mint",
        vec![encode_address(HOLDER), asset_topic("DEBT0042")],
        b64(&i128_val(BIG)),
    );
    let log = parse_deal_token_movement(&raw, &debt_ref()).unwrap();
    assert_eq!(log.event_name, "DealTokenTransfer");
    assert_eq!(log.contract_address, DEBT);
    assert_eq!(
        log.params,
        json!({
            "loan_id": "42",
            "token_kind": "debt",
            "token": DEBT,
            "from": null,
            "to": HOLDER,
            "amount": BIG.to_string(),
        })
    );
}

#[test]
fn legacy_mint_takes_the_last_address_not_the_admin() {
    let raw = raw_from(
        DEBT,
        "mint",
        vec![
            encode_address(ADMIN),
            encode_address(HOLDER),
            asset_topic("DEBT0042"),
        ],
        b64(&i128_val(5)),
    );
    let log = parse_deal_token_movement(&raw, &debt_ref()).unwrap();
    assert_eq!(log.params["to"], HOLDER);
    assert!(log.params["from"].is_null());
}

#[test]
fn clawback_has_null_to_in_both_layouts() {
    let modern = raw_from(
        DEBT,
        "clawback",
        vec![encode_address(HOLDER), asset_topic("DEBT0042")],
        b64(&i128_val(4)),
    );
    let legacy = raw_from(
        DEBT,
        "clawback",
        vec![
            encode_address(ADMIN),
            encode_address(HOLDER),
            asset_topic("DEBT0042"),
        ],
        b64(&i128_val(4)),
    );
    for raw in [modern, legacy] {
        let log = parse_deal_token_movement(&raw, &debt_ref()).unwrap();
        assert_eq!(log.params["from"], HOLDER);
        assert!(log.params["to"].is_null());
        assert_eq!(log.params["amount"], "4");
    }
}

#[test]
fn cargo_burn_has_null_to_and_cargo_kind() {
    let raw = raw_from(
        CARGO,
        "burn",
        vec![encode_address(FACTORY), asset_topic("CARGO0042")],
        b64(&i128_val(11)),
    );
    let log = parse_deal_token_movement(&raw, &cargo_ref()).unwrap();
    assert_eq!(log.params["token_kind"], "cargo");
    assert_eq!(log.params["token"], CARGO);
    assert_eq!(log.params["from"], FACTORY);
    assert!(log.params["to"].is_null());
}

#[test]
fn transfer_sets_both_sides_and_accepts_the_map_value() {
    let plain = raw_from(
        DEBT,
        "transfer",
        vec![
            encode_address(HOLDER),
            encode_address(ADMIN),
            asset_topic("DEBT0042"),
        ],
        b64(&i128_val(8)),
    );
    let muxed = raw_from(
        DEBT,
        "transfer",
        vec![
            encode_address(HOLDER),
            encode_address(ADMIN),
            asset_topic("DEBT0042"),
        ],
        encode_map(vec![
            ("amount", i128_val(8)),
            ("to_muxed_id", ScVal::U64(1)),
        ]),
    );
    for raw in [plain, muxed] {
        let log = parse_deal_token_movement(&raw, &debt_ref()).unwrap();
        assert_eq!(log.params["from"], HOLDER);
        assert_eq!(log.params["to"], ADMIN);
        assert_eq!(log.params["amount"], "8");
    }
}

#[test]
fn transfer_with_too_few_topics_is_rejected() {
    let raw = raw_from(
        DEBT,
        "transfer",
        vec![encode_address(HOLDER)],
        b64(&i128_val(8)),
    );
    assert!(parse_deal_token_movement(&raw, &debt_ref()).is_none());
}

#[test]
fn admin_events_are_not_movements() {
    for name in ["set_authorized", "set_admin", "approve"] {
        let raw = raw_from(
            DEBT,
            name,
            vec![encode_address(HOLDER), asset_topic("DEBT0042")],
            b64(&ScVal::Bool(true)),
        );
        assert!(parse_deal_token_movement(&raw, &debt_ref()).is_none());
    }
}

#[test]
fn movement_params_have_exactly_the_cross_arm_key_set() {
    let raw = raw_from(
        DEBT,
        "mint",
        vec![encode_address(HOLDER), asset_topic("DEBT0042")],
        b64(&i128_val(1)),
    );
    let log = parse_deal_token_movement(&raw, &debt_ref()).unwrap();
    let mut keys: Vec<&str> = log
        .params
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec!["amount", "from", "loan_id", "to", "token", "token_kind"]
    );
}

// ── DealTokenSet ─────────────────────────────────────────────────────────────

#[test]
fn absorb_inserts_both_tokens_with_the_right_kind() {
    let log = parse_deal_registered(&deal_registered_event()).unwrap();
    let mut set = DealTokenSet::default();
    assert!(set.absorb_deal_registered(&log));
    assert_eq!(set.len(), 2);
    assert_eq!(set.get(DEBT), Some(debt_ref()));
    assert_eq!(set.get(CARGO), Some(cargo_ref()));
}

#[test]
fn absorb_ignores_other_logs_and_malformed_params() {
    let mut set = DealTokenSet::default();
    let synced = parse_debt_synced(&debt_synced_event(1, 0)).unwrap();
    assert!(!set.absorb_deal_registered(&synced));

    let mut malformed = parse_deal_registered(&deal_registered_event()).unwrap();
    malformed.params = json!({ "loan_id": "42" });
    assert!(!set.absorb_deal_registered(&malformed));
    assert!(set.is_empty());
}

#[test]
fn contract_ids_are_sorted_and_reinsert_is_idempotent() {
    let mut set = DealTokenSet::default();
    assert_eq!(set.insert_deal("1", DEBT_2, CARGO_2), 2);
    assert_eq!(set.insert_deal("2", DEBT, CARGO), 2);
    assert_eq!(set.insert_deal("2", DEBT, CARGO), 0);
    let ids = set.contract_ids();
    let mut sorted = ids.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(ids, sorted);
    assert_eq!(ids.len(), 4);
}

#[test]
fn seed_loads_rows_from_any_factory_and_skips_non_stellar_addresses() {
    let rows = vec![
        DealRegistrationRow {
            loan_id: "1".into(),
            debt: DEBT_2.into(),
            cargo: CARGO_2.into(),
        },
        DealRegistrationRow {
            loan_id: "2".into(),
            debt: DEBT.into(),
            cargo: CARGO.into(),
        },
        DealRegistrationRow {
            loan_id: "3".into(),
            debt: "0x1111111111111111111111111111111111111111".into(),
            cargo: "0x2222222222222222222222222222222222222222".into(),
        },
    ];
    let mut set = DealTokenSet::default();
    assert_eq!(set.seed(&rows), 4);
    assert_eq!(set.len(), 4);
    assert_eq!(set.get(DEBT_2).unwrap().loan_id, "1");
    assert_eq!(set.get(CARGO).unwrap().loan_id, "2");
}

// ── Routing ──────────────────────────────────────────────────────────────────

#[test]
fn route_decodes_known_tokens_and_skips_unknown_and_non_movements() {
    let mut set = DealTokenSet::default();
    set.insert_deal("42", DEBT, CARGO);

    let known = raw_from(
        DEBT,
        "mint",
        vec![encode_address(HOLDER), asset_topic("DEBT0042")],
        b64(&i128_val(1)),
    );
    let unknown = raw_from(
        UNKNOWN,
        "mint",
        vec![encode_address(HOLDER), asset_topic("DEBT0099")],
        b64(&i128_val(1)),
    );
    let admin = raw_from(
        CARGO,
        "set_authorized",
        vec![encode_address(HOLDER), asset_topic("CARGO0042")],
        b64(&ScVal::Bool(true)),
    );
    let logs = route_deal_token_events(&[known, unknown, admin], &set);
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].contract_address, DEBT);
    assert_eq!(logs[0].params["loan_id"], "42");
}

// ── dispatch_parser ──────────────────────────────────────────────────────────

#[test]
fn dispatch_routes_the_three_factory_events() {
    assert_eq!(
        dispatch(&deal_registered_event(), Some(FACTORY)).as_deref(),
        Some("DealRegistered")
    );
    assert_eq!(
        dispatch(&debt_synced_event(1, 0), Some(FACTORY)).as_deref(),
        Some("DebtSynced")
    );
    assert_eq!(
        dispatch(&cargo_synced_event(1, 0), Some(FACTORY)).as_deref(),
        Some("CargoSynced")
    );
}

#[test]
fn dispatch_returns_none_for_undecodable_debt_synced() {
    let raw = raw_from(
        FACTORY,
        "debt_synced",
        vec![encode_u32(42)],
        encode_map(vec![("target", i128_val(1))]),
    );
    assert!(dispatch(&raw, Some(FACTORY)).is_none());
}

#[test]
fn dispatch_ignores_factory_admin_events() {
    let raw = raw_from(FACTORY, "issuers_set", vec![], b64(&ScVal::Void));
    assert!(dispatch(&raw, Some(FACTORY)).is_none());
}

#[test]
fn dispatch_without_a_configured_factory_hits_the_unexpected_contract_branch() {
    assert!(dispatch(&deal_registered_event(), None).is_none());
}
