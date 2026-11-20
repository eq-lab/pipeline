// spec: docs/references/backend.md#stellar-pocket-indexing
use pipeline_worker::indexer::stellar::collateral_registry_parsers::is_collateral_registry_event;
use pipeline_worker::indexer::stellar::pocket_parsers::*;
use pipeline_worker::indexer::stellar::poller::is_loan_registry_event;
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use serde_json::json;
use stellar_xdr::curr::{
    AccountId, ContractId, Hash, Int128Parts, Limits, PublicKey, ScAddress, ScMap, ScMapEntry,
    ScSymbol, ScVal, StringM, Uint256, VecM, WriteXdr,
};

const POCKET: &str = "CD464CN7ZWOYRGCTHE74Q5PR3JSRPTHDRZYD4OZR4DY64ZSBJ6YZ2RA5";
const G_HOLDER: &str = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const C_HOLDER: &str = "CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS";

fn b64(val: &ScVal) -> String {
    val.to_xdr_base64(Limits::none()).unwrap()
}

fn sym_val(s: &str) -> ScVal {
    let sym: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(sym))
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
        .map(|(k, val)| ScMapEntry {
            key: sym_val(k),
            val,
        })
        .collect();
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    b64(&ScVal::Map(Some(ScMap(map))))
}

fn address_topic(strkey: &str) -> String {
    let addr = if strkey.starts_with('G') {
        let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
        ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(pk.0))))
    } else {
        let c = stellar_strkey::Contract::from_string(strkey).unwrap();
        ScAddress::Contract(ContractId(Hash(c.0)))
    };
    b64(&ScVal::Address(addr))
}

fn raw(name: &str, topics: Vec<String>, value: String) -> RawEvent {
    let mut topics_base64 = vec![b64(&sym_val(name))];
    topics_base64.extend(topics);
    RawEvent {
        contract_id: POCKET.to_owned(),
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

fn loan_topic(id: u32) -> String {
    b64(&ScVal::U32(id))
}

fn assert_common(log: &pipeline_worker::indexer::stellar::parsers::StellarLog, name: &str) {
    assert_eq!(log.event_name, name);
    assert_eq!(log.contract_address, POCKET);
    assert_eq!(log.block_number, 1_234_567);
    assert_eq!(log.block_timestamp, 1_790_000_000);
    assert_eq!(log.tx_hash, "abc123");
    assert_eq!(log.log_index, 2 * 1000 + 100 + 3);
}

const BIG: i128 = (u64::MAX as i128) * 4 + 7;

#[test]
fn pocket_opened_decodes_with_big_amounts() {
    let value = encode_map(vec![
        ("amount", i128_val(BIG)),
        ("snapshot_ledger", ScVal::U32(5_500_000)),
        ("supply_at_snapshot", i128_val(BIG + 1)),
    ]);
    let log = parse_pocket_opened(&raw("pocket_opened", vec![loan_topic(7)], value)).unwrap();
    assert_common(&log, "PocketOpened");
    assert_eq!(
        log.params,
        json!({
            "loan_id": "7",
            "amount": BIG.to_string(),
            "snapshot_ledger": "5500000",
            "supply_at_snapshot": (BIG + 1).to_string(),
        })
    );
}

#[test]
fn released_decodes() {
    let value = encode_map(vec![
        ("principal", i128_val(200)),
        ("released", i128_val(150)),
        ("interest", i128_val(BIG)),
    ]);
    let log = parse_pocket_released(&raw("released", vec![loan_topic(3)], value)).unwrap();
    assert_common(&log, "PocketReleased");
    assert_eq!(
        log.params,
        json!({"loan_id": "3", "principal": "200", "released": "150", "interest": BIG.to_string()})
    );
}

#[test]
fn unreleased_decodes() {
    let value = encode_map(vec![("principal", i128_val(40)), ("interest", i128_val(5))]);
    let log = parse_pocket_unreleased(&raw("unreleased", vec![loan_topic(3)], value)).unwrap();
    assert_common(&log, "PocketUnreleased");
    assert_eq!(
        log.params,
        json!({"loan_id": "3", "principal": "40", "interest": "5"})
    );
}

#[test]
fn burned_decodes() {
    let value = encode_map(vec![("amount", i128_val(400)), ("burned", i128_val(300))]);
    let log = parse_pocket_burned(&raw("burned", vec![loan_topic(9)], value)).unwrap();
    assert_common(&log, "PocketBurned");
    assert_eq!(
        log.params,
        json!({"loan_id": "9", "amount": "400", "burned": "300"})
    );
}

#[test]
fn claimed_paid_zero_flag() {
    let zero = parse_pocket_claimed(&raw(
        "claimed",
        vec![loan_topic(1), address_topic(G_HOLDER)],
        encode_map(vec![("paid", i128_val(0))]),
    ))
    .unwrap();
    assert_common(&zero, "PocketClaimed");
    assert_eq!(zero.params["paid"], "0");
    assert_eq!(zero.params["paid_zero"], json!(true));

    let paid = parse_pocket_claimed(&raw(
        "claimed",
        vec![loan_topic(1), address_topic(G_HOLDER)],
        encode_map(vec![("paid", i128_val(BIG))]),
    ))
    .unwrap();
    assert_eq!(paid.params["paid"], BIG.to_string());
    assert_eq!(paid.params["paid_zero"], json!(false));
}

#[test]
fn claimed_holder_is_exact_strkey_for_g_and_c() {
    for holder in [G_HOLDER, C_HOLDER] {
        let log = parse_pocket_claimed(&raw(
            "claimed",
            vec![loan_topic(1), address_topic(holder)],
            encode_map(vec![("paid", i128_val(10))]),
        ))
        .unwrap();
        assert_eq!(log.params["holder"], holder);
        assert_eq!(log.params["loan_id"], "1");
    }
}

#[test]
fn short_topics_or_missing_keys_return_none() {
    let amount_map = || encode_map(vec![("amount", i128_val(1))]);
    assert!(parse_pocket_opened(&raw("pocket_opened", vec![], amount_map())).is_none());
    assert!(
        parse_pocket_opened(&raw("pocket_opened", vec![loan_topic(1)], amount_map())).is_none()
    );
    assert!(parse_pocket_released(&raw("released", vec![loan_topic(1)], amount_map())).is_none());
    assert!(parse_pocket_burned(&raw("burned", vec![loan_topic(1)], amount_map())).is_none());
    assert!(parse_pocket_claimed(&raw(
        "claimed",
        vec![loan_topic(1)],
        encode_map(vec![("paid", i128_val(1))])
    ))
    .is_none());
    assert!(parse_pocket_claimed(&raw(
        "claimed",
        vec![loan_topic(1), address_topic(G_HOLDER)],
        encode_map(vec![])
    ))
    .is_none());
}

#[test]
fn reporters_set_and_paused_return_none() {
    let value = encode_map(vec![]);
    assert!(dispatch_pocket(&raw("reporters_set", vec![], value.clone())).is_none());
    assert!(dispatch_pocket(&raw("paused", vec![], value)).is_none());
}

#[test]
fn dispatch_maps_generic_topics_to_pocket_names() {
    let released = dispatch_pocket(&raw(
        "released",
        vec![loan_topic(1)],
        encode_map(vec![
            ("principal", i128_val(1)),
            ("released", i128_val(1)),
            ("interest", i128_val(0)),
        ]),
    ))
    .unwrap();
    assert_eq!(released.event_name, "PocketReleased");

    let burned = dispatch_pocket(&raw(
        "burned",
        vec![loan_topic(1)],
        encode_map(vec![("amount", i128_val(1)), ("burned", i128_val(1))]),
    ))
    .unwrap();
    assert_eq!(burned.event_name, "PocketBurned");

    let claimed = dispatch_pocket(&raw(
        "claimed",
        vec![loan_topic(1), address_topic(C_HOLDER)],
        encode_map(vec![("paid", i128_val(1))]),
    ))
    .unwrap();
    assert_eq!(claimed.event_name, "PocketClaimed");
}

#[test]
fn undecodable_listed_topic_dispatches_to_none() {
    assert!(dispatch_pocket(&raw("burned", vec![loan_topic(1)], encode_map(vec![]))).is_none());
}

const OTHER_STORED_NAMES: &[&str] = &[
    "DepositRequested",
    "WithdrawalRequested",
    "RequestClaimed",
    "StakingDeposit",
    "StakingWithdrawal",
    "WireIn",
    "WireInAssigned",
    "AssetTransfer",
    "ShareTransfer",
    "WireInReturned",
    "CashDisbursed",
    "CashDisbursementReversed",
    "CashRepaid",
    "CashRepaymentReversed",
    "WireOutRequested",
    "WireOutSettled",
    "WireOutCancelled",
    "RampOpened",
    "RampClosed",
    "CashRecorded",
    "MintCorrected",
    "LossAbsorbed",
    "DealRegistered",
    "DebtSynced",
    "CargoSynced",
    "DealTokenTransfer",
    "Pledged",
    "HaircutSet",
    "FloorSet",
    "Revalued",
    "StageUpdated",
    "ControlUpdated",
    "DocAdded",
    "QuantityAdjusted",
    "Released",
    "Liquidated",
    "MarginCall",
    "LoanDrawn",
    "LoanStatusUpdated",
    "LoanDefaulted",
    "LoanClosed",
    "PaymentRecorded",
    "PaymentUnrecorded",
    "LoanRolledOver",
    "EconomicsAmended",
    "Disbursed",
    "Undisbursed",
    "LoanWrittenDown",
    "InterestAdjusted",
];

#[test]
fn pocket_names_are_unique_across_stored_names() {
    for (_, name) in POCKET_EVENT_TOPICS {
        assert!(is_pocket_event(name));
        assert!(!is_loan_registry_event(name), "{name}");
        assert!(!is_collateral_registry_event(name), "{name}");
        assert!(!OTHER_STORED_NAMES.contains(&name), "{name}");
    }
    for name in OTHER_STORED_NAMES {
        assert!(!is_pocket_event(name), "{name}");
    }
}
