// spec: docs/references/backend.md#stellar-soroban-events
use pipeline_worker::indexer::stellar::minter_parsers::*;
use pipeline_worker::indexer::stellar::parsers::dispatch_parser;
use pipeline_worker::indexer::stellar::poller::is_loan_registry_event;
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use serde_json::{json, Value};
use stellar_xdr::curr::{
    AccountId, ContractId, Hash, Int128Parts, Limits, PublicKey, ScAddress, ScBytes, ScMap,
    ScMapEntry, ScSymbol, ScVal, StringM, Uint256, VecM, WriteXdr,
};

// ── ScVal encode helpers ─────────────────────────────────────────────────────

fn b64(val: &ScVal) -> String {
    val.to_xdr_base64(Limits::none()).unwrap()
}

fn sym(s: &str) -> ScVal {
    let sym: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(sym))
}

fn enum_val(variant: &str) -> ScVal {
    let v: VecM<ScVal> = vec![sym(variant)].try_into().unwrap();
    ScVal::Vec(Some(stellar_xdr::curr::ScVec(v)))
}

fn address_contract(strkey: &str) -> ScVal {
    let c = stellar_strkey::Contract::from_string(strkey).unwrap();
    ScVal::Address(ScAddress::Contract(ContractId(Hash(c.0))))
}

fn address_account(strkey: &str) -> ScVal {
    let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
    ScVal::Address(ScAddress::Account(AccountId(
        PublicKey::PublicKeyTypeEd25519(Uint256(pk.0)),
    )))
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
        .map(|(k, val)| ScMapEntry { key: sym(k), val })
        .collect();
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MINTER: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const LP_CONTRACT: &str = "CBKT4GAN5OFKXWE332AHXVY6ZWFNPGXQGFGSIENFLOEOHWSF5WAFT2AE";
const LP_ACCOUNT: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const DM: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const WQ: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const SPLUSD: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const REGISTRY: &str = "CAPL5WN3Z7X4WBYGPEWYXRMLDZ5ZOMYQ3CIQEDWNGOGIVMQVPYUNSW5F";

const REF_HEX: &str = "72c162575adea091c5fc1bed0ec9321fda14c9706338e043ff9d01aeb652a6ce";

fn ref_bytes() -> Vec<u8> {
    (0..32)
        .map(|i| u8::from_str_radix(&REF_HEX[i * 2..i * 2 + 2], 16).unwrap())
        .collect()
}

fn rh() -> ScVal {
    bytes_val(&ref_bytes())
}

#[allow(clippy::needless_pass_by_value)]
fn raw(name: &str, topics: Vec<ScVal>, value: ScVal) -> RawEvent {
    let mut topics_base64 = vec![b64(&sym(name))];
    topics_base64.extend(topics.iter().map(b64));
    RawEvent {
        contract_id: MINTER.to_owned(),
        event_name: name.to_owned(),
        topics_base64,
        value_base64: b64(&value),
        ledger: 1_234_567,
        ledger_closed_at_unix: 1_790_000_000,
        tx_hash: "abc123".to_owned(),
        tx_index: 2,
        op_index: 1,
        event_index_in_op: 3,
    }
}

trait Dup {
    fn dup(&self) -> RawEvent;
}

impl Dup for RawEvent {
    fn dup(&self) -> RawEvent {
        RawEvent {
            contract_id: self.contract_id.clone(),
            event_name: self.event_name.clone(),
            topics_base64: self.topics_base64.clone(),
            value_base64: self.value_base64.clone(),
            ledger: self.ledger,
            ledger_closed_at_unix: self.ledger_closed_at_unix,
            tx_hash: self.tx_hash.clone(),
            tx_index: self.tx_index,
            op_index: self.op_index,
            event_index_in_op: self.event_index_in_op,
        }
    }
}

type Parser = fn(&RawEvent) -> Option<pipeline_worker::indexer::stellar::parsers::StellarLog>;

struct Case {
    topic: &'static str,
    stored: &'static str,
    keys: &'static [&'static str],
    parser: Parser,
    event: RawEvent,
    params: Value,
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            topic: "wire_in_returned",
            stored: "WireInReturned",
            keys: &["amount", "id", "ref_hash"],
            parser: parse_wire_in_returned,
            event: raw(
                "wire_in_returned",
                vec![ScVal::U32(7)],
                map_val(vec![("amount", i128_val(1_000)), ("ref_hash", rh())]),
            ),
            params: json!({"id": "7", "amount": "1000", "ref_hash": REF_HEX}),
        },
        Case {
            topic: "cash_disbursed",
            stored: "CashDisbursed",
            keys: &["amount", "entry_id", "loan_id", "ref_hash", "value_date"],
            parser: parse_cash_disbursed,
            event: raw(
                "cash_disbursed",
                vec![ScVal::U32(3)],
                map_val(vec![
                    ("entry_id", ScVal::U32(11)),
                    ("amount", i128_val(2_000)),
                    ("value_date", ScVal::U64(1_790_000_001)),
                    ("ref_hash", rh()),
                ]),
            ),
            params: json!({"loan_id": "3", "entry_id": "11", "amount": "2000",
                "value_date": "1790000001", "ref_hash": REF_HEX}),
        },
        Case {
            topic: "cash_disbursement_reversed",
            stored: "CashDisbursementReversed",
            keys: &["amount", "entry_id", "loan_id", "original_id", "ref_hash"],
            parser: parse_cash_disbursement_reversed,
            event: raw(
                "cash_disbursement_reversed",
                vec![ScVal::U32(3)],
                map_val(vec![
                    ("entry_id", ScVal::U32(12)),
                    ("original_id", ScVal::U32(11)),
                    ("amount", i128_val(2_000)),
                    ("ref_hash", rh()),
                ]),
            ),
            params: json!({"loan_id": "3", "entry_id": "12", "original_id": "11",
                "amount": "2000", "ref_hash": REF_HEX}),
        },
        Case {
            topic: "cash_repaid",
            stored: "CashRepaid",
            keys: &[
                "cash",
                "fee_shares",
                "interest_minted",
                "loan_id",
                "ref_hash",
                "repayment_id",
                "sale_id",
                "value_date",
            ],
            parser: parse_cash_repaid,
            event: raw(
                "cash_repaid",
                vec![ScVal::U32(3)],
                map_val(vec![
                    ("repayment_id", ScVal::U32(5)),
                    ("sale_id", ScVal::U32(0)),
                    ("cash", i128_val(900)),
                    ("interest_minted", i128_val(90)),
                    ("fee_shares", i128_val(9)),
                    ("value_date", ScVal::U64(1_790_000_002)),
                    ("ref_hash", rh()),
                ]),
            ),
            params: json!({"loan_id": "3", "repayment_id": "5", "sale_id": "0", "cash": "900",
                "interest_minted": "90", "fee_shares": "9", "value_date": "1790000002",
                "ref_hash": REF_HEX}),
        },
        Case {
            topic: "cash_repayment_reversed",
            stored: "CashRepaymentReversed",
            keys: &["cash", "loan_id", "ref_hash", "repayment_id"],
            parser: parse_cash_repayment_reversed,
            event: raw(
                "cash_repayment_reversed",
                vec![ScVal::U32(3)],
                map_val(vec![
                    ("repayment_id", ScVal::U32(5)),
                    ("cash", i128_val(900)),
                    ("ref_hash", rh()),
                ]),
            ),
            params: json!({"loan_id": "3", "repayment_id": "5", "cash": "900",
                "ref_hash": REF_HEX}),
        },
        Case {
            topic: "wire_out_requested",
            stored: "WireOutRequested",
            keys: &["amount", "id", "lp"],
            parser: parse_wire_out_requested,
            event: raw(
                "wire_out_requested",
                vec![ScVal::U32(4)],
                map_val(vec![
                    ("lp", address_contract(LP_CONTRACT)),
                    ("amount", i128_val(500)),
                ]),
            ),
            params: json!({"id": "4", "lp": LP_CONTRACT, "amount": "500"}),
        },
        Case {
            topic: "wire_out_settled",
            stored: "WireOutSettled",
            keys: &["amount", "id", "ref_hash", "value_date"],
            parser: parse_wire_out_settled,
            event: raw(
                "wire_out_settled",
                vec![ScVal::U32(4)],
                map_val(vec![
                    ("amount", i128_val(500)),
                    ("value_date", ScVal::U64(1_790_000_003)),
                    ("ref_hash", rh()),
                ]),
            ),
            params: json!({"id": "4", "amount": "500", "value_date": "1790000003",
                "ref_hash": REF_HEX}),
        },
        Case {
            topic: "wire_out_cancelled",
            stored: "WireOutCancelled",
            keys: &["id"],
            parser: parse_wire_out_cancelled,
            event: raw("wire_out_cancelled", vec![ScVal::U32(4)], map_val(vec![])),
            params: json!({"id": "4"}),
        },
        Case {
            topic: "ramp_opened",
            stored: "RampOpened",
            keys: &["amount", "direction", "id", "ref_hash"],
            parser: parse_ramp_opened,
            event: raw(
                "ramp_opened",
                vec![ScVal::U32(8)],
                map_val(vec![
                    ("direction", enum_val("UsdcToBank")),
                    ("amount", i128_val(700)),
                    ("ref_hash", rh()),
                ]),
            ),
            params: json!({"id": "8", "direction": "UsdcToBank", "amount": "700",
                "ref_hash": REF_HEX}),
        },
        Case {
            topic: "ramp_closed",
            stored: "RampClosed",
            keys: &["id", "loss", "received", "ref_hash"],
            parser: parse_ramp_closed,
            event: raw(
                "ramp_closed",
                vec![ScVal::U32(8)],
                map_val(vec![
                    ("received", i128_val(690)),
                    ("loss", i128_val(10)),
                    ("ref_hash", rh()),
                ]),
            ),
            params: json!({"id": "8", "received": "690", "loss": "10", "ref_hash": REF_HEX}),
        },
        Case {
            topic: "cash_recorded",
            stored: "CashRecorded",
            keys: &["delta", "entry_id", "reason", "ref_hash", "value_date"],
            parser: parse_cash_recorded,
            event: raw(
                "cash_recorded",
                vec![enum_val("Income")],
                map_val(vec![
                    ("entry_id", ScVal::U32(21)),
                    ("delta", i128_val(300)),
                    ("value_date", ScVal::U64(1_790_000_004)),
                    ("ref_hash", rh()),
                ]),
            ),
            params: json!({"reason": "Income", "entry_id": "21", "delta": "300",
                "value_date": "1790000004", "ref_hash": REF_HEX}),
        },
        Case {
            topic: "mint_corrected",
            stored: "MintCorrected",
            keys: &["amount", "ref_hash"],
            parser: parse_mint_corrected,
            event: raw(
                "mint_corrected",
                vec![],
                map_val(vec![("amount", i128_val(42)), ("ref_hash", rh())]),
            ),
            params: json!({"amount": "42", "ref_hash": REF_HEX}),
        },
        Case {
            topic: "loss_absorbed",
            stored: "LossAbsorbed",
            keys: &["pulled", "requested"],
            parser: parse_loss_absorbed,
            event: raw(
                "loss_absorbed",
                vec![],
                map_val(vec![("requested", i128_val(100)), ("pulled", i128_val(60))]),
            ),
            params: json!({"requested": "100", "pulled": "60"}),
        },
    ]
}

fn dispatch(ev: &RawEvent, minter: Option<&str>, registry: Option<&str>) -> Option<String> {
    dispatch_parser(ev, DM, WQ, SPLUSD, registry, minter, None).map(|l| l.event_name)
}

// ── Happy path ────────────────────────────────────────────────────────────────

#[test]
fn every_event_parses_to_the_exact_params_object() {
    for c in cases() {
        let log = (c.parser)(&c.event).unwrap_or_else(|| panic!("{} should parse", c.topic));
        assert_eq!(log.event_name, c.stored, "{}", c.topic);
        assert_eq!(log.contract_address, MINTER);
        assert_eq!(log.block_number, 1_234_567);
        assert_eq!(log.block_timestamp, 1_790_000_000);
        assert_eq!(log.log_index, 2 * 1000 + 100 + 3);
        assert_eq!(log.params, c.params, "{}", c.topic);
    }
}

#[test]
fn params_keys_match_the_cross_arm_contract() {
    for c in cases() {
        let log = (c.parser)(&c.event).unwrap();
        let mut keys: Vec<&str> = log
            .params
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, c.keys, "{}", c.stored);
    }
}

// ── Enums ─────────────────────────────────────────────────────────────────────

fn cash_recorded_with(kind: ScVal) -> RawEvent {
    raw(
        "cash_recorded",
        vec![kind],
        map_val(vec![
            ("entry_id", ScVal::U32(1)),
            ("delta", i128_val(1)),
            ("value_date", ScVal::U64(1)),
            ("ref_hash", rh()),
        ]),
    )
}

#[test]
fn every_cash_reason_variant_maps_to_its_name() {
    for v in [
        "Disbursed",
        "DisbursementReversed",
        "Income",
        "Expense",
        "Correction",
    ] {
        let log = parse_cash_recorded(&cash_recorded_with(enum_val(v))).unwrap();
        assert_eq!(log.params["reason"], v);
    }
}

#[test]
fn a_non_enum_cash_reason_is_rejected() {
    assert!(parse_cash_recorded(&cash_recorded_with(ScVal::U32(1))).is_none());
    assert!(parse_cash_recorded(&cash_recorded_with(sym("Income"))).is_none());
}

fn ramp_opened_with(direction: ScVal) -> RawEvent {
    raw(
        "ramp_opened",
        vec![ScVal::U32(1)],
        map_val(vec![
            ("direction", direction),
            ("amount", i128_val(1)),
            ("ref_hash", rh()),
        ]),
    )
}

#[test]
fn both_ramp_directions_map_to_their_names() {
    for v in ["UsdcToBank", "BankToUsdc"] {
        let log = parse_ramp_opened(&ramp_opened_with(enum_val(v))).unwrap();
        assert_eq!(log.params["direction"], v);
    }
}

#[test]
fn a_non_enum_ramp_direction_is_rejected() {
    assert!(parse_ramp_opened(&ramp_opened_with(ScVal::U32(0))).is_none());
}

// ── Signed / large values ─────────────────────────────────────────────────────

#[test]
fn cash_recorded_keeps_the_sign_of_a_negative_delta() {
    let ev = raw(
        "cash_recorded",
        vec![enum_val("Expense")],
        map_val(vec![
            ("entry_id", ScVal::U32(1)),
            ("delta", i128_val(-500)),
            ("value_date", ScVal::U64(1)),
            ("ref_hash", rh()),
        ]),
    );
    assert_eq!(parse_cash_recorded(&ev).unwrap().params["delta"], "-500");
}

#[test]
fn an_i128_above_u64_max_survives_as_a_decimal_string() {
    let big: i128 = (u64::MAX as i128) * 10 + 7;
    let ev = raw(
        "mint_corrected",
        vec![],
        map_val(vec![("amount", i128_val(big)), ("ref_hash", rh())]),
    );
    assert_eq!(
        parse_mint_corrected(&ev).unwrap().params["amount"],
        big.to_string()
    );
}

#[test]
fn ref_hash_is_lowercase_hex_and_a_short_one_is_rejected() {
    let log = (cases()[0].parser)(&cases()[0].event).unwrap();
    let hex = log.params["ref_hash"].as_str().unwrap();
    assert_eq!(hex.len(), 64);
    assert_eq!(hex, hex.to_lowercase());

    let ev = raw(
        "wire_in_returned",
        vec![ScVal::U32(1)],
        map_val(vec![
            ("amount", i128_val(1)),
            ("ref_hash", bytes_val(&[0xab; 31])),
        ]),
    );
    assert!(parse_wire_in_returned(&ev).is_none());
}

// ── Rejections ────────────────────────────────────────────────────────────────

#[test]
fn every_parser_rejects_a_foreign_event_name() {
    for c in cases() {
        let mut ev = c.event.dup();
        ev.event_name = "something_else".to_owned();
        assert!((c.parser)(&ev).is_none(), "{}", c.topic);
    }
}

#[test]
fn every_topic_carrying_parser_rejects_a_missing_indexed_topic() {
    for c in cases() {
        if matches!(c.topic, "mint_corrected" | "loss_absorbed") {
            continue;
        }
        let mut ev = c.event.dup();
        ev.topics_base64.truncate(1);
        assert!((c.parser)(&ev).is_none(), "{}", c.topic);
    }
}

#[test]
fn every_parser_with_data_rejects_a_missing_data_field() {
    for c in cases() {
        if c.topic == "wire_out_cancelled" {
            continue;
        }
        let mut ev = c.event.dup();
        ev.value_base64 = b64(&map_val(vec![]));
        assert!((c.parser)(&ev).is_none(), "{}", c.topic);
    }
}

#[test]
fn every_id_topic_rejects_the_wrong_scval_type() {
    for c in cases() {
        if matches!(
            c.topic,
            "mint_corrected" | "loss_absorbed" | "cash_recorded"
        ) {
            continue;
        }
        let mut ev = c.event.dup();
        ev.topics_base64[1] = b64(&ScVal::U64(1));
        assert!((c.parser)(&ev).is_none(), "{}", c.topic);
    }
}

#[test]
fn an_entry_id_of_the_wrong_type_is_rejected() {
    let ev = raw(
        "cash_disbursed",
        vec![ScVal::U32(3)],
        map_val(vec![
            ("entry_id", ScVal::U64(11)),
            ("amount", i128_val(1)),
            ("value_date", ScVal::U64(1)),
            ("ref_hash", rh()),
        ]),
    );
    assert!(parse_cash_disbursed(&ev).is_none());
}

// ── Edge shapes ───────────────────────────────────────────────────────────────

#[test]
fn wire_out_cancelled_parses_with_an_empty_map_or_a_void_value() {
    for value in [map_val(vec![]), ScVal::Void] {
        let ev = raw("wire_out_cancelled", vec![ScVal::U32(9)], value);
        assert_eq!(
            parse_wire_out_cancelled(&ev).unwrap().params,
            json!({"id": "9"})
        );
    }
}

#[test]
fn wire_out_requested_accepts_account_and_contract_lps() {
    for (addr, expected) in [
        (address_account(LP_ACCOUNT), LP_ACCOUNT),
        (address_contract(LP_CONTRACT), LP_CONTRACT),
    ] {
        let ev = raw(
            "wire_out_requested",
            vec![ScVal::U32(1)],
            map_val(vec![("lp", addr), ("amount", i128_val(1))]),
        );
        assert_eq!(
            parse_wire_out_requested(&ev).unwrap().params["lp"],
            expected
        );
    }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

#[test]
fn each_minter_topic_routes_to_its_stored_name() {
    for c in cases() {
        assert_eq!(
            dispatch(&c.event, Some(MINTER), None).as_deref(),
            Some(c.stored),
            "{}",
            c.topic
        );
    }
}

#[test]
fn uncollected_minter_topics_are_dropped() {
    for name in [
        "snapshot",
        "treasury_set",
        "rate_limit_applied",
        "tx_limit_set",
    ] {
        let ev = raw(name, vec![], map_val(vec![]));
        assert!(dispatch(&ev, Some(MINTER), None).is_none(), "{name}");
    }
}

#[test]
fn an_unset_minter_parses_nothing() {
    for c in cases() {
        assert!(dispatch(&c.event, None, None).is_none(), "{}", c.topic);
    }
}

#[test]
fn a_cash_disbursed_from_the_loan_registry_is_not_taken_as_a_minter_event() {
    let mut ev = cases()[1].event.dup();
    ev.contract_id = REGISTRY.to_owned();
    assert!(dispatch(&ev, Some(MINTER), Some(REGISTRY)).is_none());
}

// ── Poller routing guard ──────────────────────────────────────────────────────

#[test]
fn no_new_event_name_is_claimed_by_the_loan_registry_path() {
    for c in cases() {
        assert!(!is_loan_registry_event(c.stored), "{}", c.stored);
    }
}
