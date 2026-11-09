// spec: docs/references/backend.md#plusd-transfer-indexing
use pipeline_worker::indexer::stellar::parsers::{decode_sac_movement, sac_holder_strkey};
use pipeline_worker::indexer::stellar::plusd_parsers::{
    dispatch_plusd, parse_plusd_event, PLUSD_EVENT_TOPICS,
};
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use stellar_xdr::curr::{
    AccountId, ClaimableBalanceId, ContractId, Hash, Int128Parts, Limits, MuxedEd25519Account,
    PoolId, PublicKey, ScAddress, ScMap, ScMapEntry, ScString, ScSymbol, ScVal, StringM, Uint256,
    VecM, WriteXdr,
};

fn b64(val: &ScVal) -> String {
    val.to_xdr_base64(Limits::none()).unwrap()
}

fn encode_symbol(s: &str) -> String {
    let sym: StringM<32> = s.try_into().unwrap();
    b64(&ScVal::Symbol(ScSymbol(sym)))
}

fn asset_topic(s: &str) -> String {
    b64(&ScVal::String(ScString(s.try_into().unwrap())))
}

fn address_b64(addr: ScAddress) -> String {
    b64(&ScVal::Address(addr))
}

fn account(strkey: &str) -> ScAddress {
    let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
    ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(pk.0))))
}

fn contract(strkey: &str) -> ScAddress {
    let c = stellar_strkey::Contract::from_string(strkey).unwrap();
    ScAddress::Contract(ContractId(Hash(c.0)))
}

fn enc(strkey: &str) -> String {
    address_b64(if strkey.starts_with('G') {
        account(strkey)
    } else {
        contract(strkey)
    })
}

fn i128_val(v: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (v >> 64) as i64,
        lo: (v & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

fn amount_map(v: i128) -> String {
    let entries = vec![
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol("amount".try_into().unwrap())),
            val: i128_val(v),
        },
        ScMapEntry {
            key: ScVal::Symbol(ScSymbol("to_muxed_id".try_into().unwrap())),
            val: ScVal::U64(1),
        },
    ];
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    b64(&ScVal::Map(Some(ScMap(map))))
}

const PLUSD: &str = "CDGHLVGY2GH2GKIRPVA2PCC27GVYQONVYHKGEEYF2S5PXTLRP2XEN6AU";
const VAULT: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const LP: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const ADMIN: &str = "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU";
const BIG: i128 = 340_282_366_920_938_463_463;

fn raw_from(event_name: &str, topics: Vec<String>, value: String) -> RawEvent {
    let mut topics_base64 = vec![encode_symbol(event_name)];
    topics_base64.extend(topics);
    RawEvent {
        contract_id: PLUSD.to_owned(),
        event_name: event_name.to_owned(),
        topics_base64,
        value_base64: value,
        ledger: 901,
        ledger_closed_at_unix: 1_790_000_000,
        tx_hash: "ab12".to_owned(),
        tx_index: 2,
        op_index: 1,
        event_index_in_op: 3,
    }
}

fn asset() -> String {
    asset_topic("PLUSD:GAXXX")
}

#[test]
fn transfer_with_a_plain_i128() {
    let raw = raw_from(
        "transfer",
        vec![enc(LP), enc(VAULT), asset()],
        b64(&i128_val(BIG)),
    );
    let log = parse_plusd_event(&raw).unwrap();
    assert_eq!(log.event_name, "PlusdTransfer");
    assert_eq!(log.contract_address, PLUSD);
    assert_eq!(log.block_number, 901);
    assert_eq!(log.tx_hash, "ab12");
    assert_eq!(log.log_index, 2 * 1000 + 100 + 3);
    assert_eq!(log.block_timestamp, 1_790_000_000);
    assert_eq!(log.params["kind"], "transfer");
    assert_eq!(log.params["from"], LP);
    assert_eq!(log.params["to"], VAULT);
    assert_eq!(log.params["amount"], BIG.to_string());
}

#[test]
fn transfer_with_the_muxed_map_value() {
    let raw = raw_from(
        "transfer",
        vec![enc(LP), enc(VAULT), asset()],
        amount_map(77),
    );
    let log = parse_plusd_event(&raw).unwrap();
    assert_eq!(log.params["amount"], "77");
}

#[test]
fn mint_in_both_layouts_has_a_null_from() {
    let cap67 = raw_from("mint", vec![enc(LP), asset()], b64(&i128_val(5)));
    let legacy = raw_from(
        "mint",
        vec![enc(ADMIN), enc(LP), asset()],
        b64(&i128_val(5)),
    );
    for raw in [cap67, legacy] {
        let log = parse_plusd_event(&raw).unwrap();
        assert_eq!(log.params["kind"], "mint");
        assert!(log.params["from"].is_null());
        assert_eq!(log.params["to"], LP);
    }
}

#[test]
fn burn_and_clawback_have_a_null_to_in_both_layouts() {
    for name in ["burn", "clawback"] {
        let cap67 = raw_from(name, vec![enc(LP), asset()], b64(&i128_val(4)));
        let legacy = raw_from(name, vec![enc(ADMIN), enc(LP), asset()], b64(&i128_val(4)));
        for raw in [cap67, legacy] {
            let log = parse_plusd_event(&raw).unwrap();
            assert_eq!(log.params["kind"], name);
            assert_eq!(log.params["from"], LP);
            assert!(log.params["to"].is_null());
        }
    }
}

#[test]
fn classic_counterparties_are_encoded_and_the_lp_side_is_kept() {
    let balance = [7u8; 32];
    let pool = [9u8; 32];
    let muxed = MuxedEd25519Account {
        id: 5,
        ed25519: Uint256(
            stellar_strkey::ed25519::PublicKey::from_string(ADMIN)
                .unwrap()
                .0,
        ),
    };
    let cases = [
        (
            ScAddress::ClaimableBalance(ClaimableBalanceId::ClaimableBalanceIdTypeV0(Hash(
                balance,
            ))),
            stellar_strkey::ClaimableBalance::V0(balance)
                .to_string()
                .to_string(),
            'B',
        ),
        (
            ScAddress::LiquidityPool(PoolId(Hash(pool))),
            stellar_strkey::LiquidityPool(pool).to_string().to_string(),
            'L',
        ),
        (ScAddress::MuxedAccount(muxed), ADMIN.to_owned(), 'G'),
    ];
    for (addr, expected, prefix) in cases {
        assert!(expected.starts_with(prefix));
        assert_eq!(sac_holder_strkey(&addr).as_deref(), Some(expected.as_str()));
        let raw = raw_from(
            "transfer",
            vec![enc(LP), address_b64(addr), asset()],
            b64(&i128_val(3)),
        );
        let log = parse_plusd_event(&raw).unwrap();
        assert_eq!(log.params["from"], LP);
        assert_eq!(log.params["to"], expected);
    }
}

#[test]
fn account_and_contract_addresses_round_trip() {
    assert_eq!(sac_holder_strkey(&account(LP)).as_deref(), Some(LP));
    assert_eq!(sac_holder_strkey(&contract(VAULT)).as_deref(), Some(VAULT));
}

#[test]
fn admin_events_are_not_movements() {
    for name in ["approve", "set_authorized", "set_admin"] {
        let raw = raw_from(name, vec![enc(LP), asset()], b64(&ScVal::Bool(true)));
        assert!(parse_plusd_event(&raw).is_none());
        assert!(dispatch_plusd(&raw).is_none());
    }
}

#[test]
fn a_recognised_topic_that_is_not_decodable_returns_none() {
    for name in PLUSD_EVENT_TOPICS {
        let raw = raw_from(name, vec![enc(LP)], b64(&ScVal::Bool(true)));
        assert!(dispatch_plusd(&raw).is_none(), "{name}");
    }
    let short = raw_from("transfer", vec![enc(LP)], b64(&i128_val(1)));
    assert!(dispatch_plusd(&short).is_none());
}

#[test]
fn a_negative_amount_returns_none() {
    let raw = raw_from("mint", vec![enc(LP), asset()], b64(&i128_val(-1)));
    assert!(parse_plusd_event(&raw).is_none());
    assert!(decode_sac_movement(&raw).is_none());
}

#[test]
fn the_params_keys_are_exactly_kind_from_to_amount() {
    let raw = raw_from("mint", vec![enc(LP), asset()], b64(&i128_val(1)));
    let log = parse_plusd_event(&raw).unwrap();
    let mut keys: Vec<&str> = log
        .params
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["amount", "from", "kind", "to"]);
    assert!(log.params["amount"].is_string());
}
