/// Unit tests for the Stellar minter's `wire_in` / `wire_in_assigned` parsers
/// (Issue #1416). Locally constructed `RawEvent` values — no RPC, no DB.
///
/// `#[contractevent]` encodes `topics[0]` as the snake_case name, `topics[1..]`
/// as the `#[topic]` fields in declaration order, and `value` as an `ScVal::Map`
/// of the remaining fields keyed by Symbol and sorted alphabetically.
use pipeline_worker::indexer::stellar::parsers::{parse_wire_in, parse_wire_in_assigned};
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use stellar_xdr::curr::{
    AccountId, ContractId, Hash, Int128Parts, Limits, PublicKey, ScAddress, ScBytes, ScMap,
    ScMapEntry, ScSymbol, ScVal, StringM, Uint256, VecM, WriteXdr,
};

// ── ScVal encode helpers ─────────────────────────────────────────────────────

fn b64(val: &ScVal) -> String {
    val.to_xdr_base64(Limits::none()).unwrap()
}

fn encode_symbol(s: &str) -> String {
    let sym: StringM<32> = s.try_into().unwrap();
    b64(&ScVal::Symbol(ScSymbol(sym)))
}

fn encode_u32(v: u32) -> String {
    b64(&ScVal::U32(v))
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

/// Encode a Symbol-keyed map, sorted alphabetically like the macro does.
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MINTER_CONTRACT: &str = "CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX";
const LP_CONTRACT: &str = "CBKT4GAN5OFKXWE332AHXVY6ZWFNPGXQGFGSIENFLOEOHWSF5WAFT2AE";
const LP_ACCOUNT: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";

/// `sha256("WIRE-REF-1")` — the same value `POST /v1/lps/{id}/bank-deposits`
/// stores in `lp_bank_deposits.ref_hash`.
const REF_HASH_HEX: &str = "72c162575adea091c5fc1bed0ec9321fda14c9706338e043ff9d01aeb652a6ce";

fn ref_hash_bytes() -> Vec<u8> {
    (0..32)
        .map(|i| u8::from_str_radix(&REF_HASH_HEX[i * 2..i * 2 + 2], 16).unwrap())
        .collect()
}

fn raw_event(event_name: &str, topics_after_name: Vec<String>, value: String) -> RawEvent {
    let mut topics_base64 = vec![encode_symbol(event_name)];
    topics_base64.extend(topics_after_name);
    RawEvent {
        contract_id: MINTER_CONTRACT.to_owned(),
        event_name: event_name.to_owned(),
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

fn wire_in_event(receiver: ScVal, ref_hash: &[u8]) -> RawEvent {
    raw_event(
        "wire_in",
        vec![encode_u32(7)],
        encode_map(vec![
            ("receiver", receiver),
            ("amount", i128_val(50_000_000_000)),
            ("value_date", ScVal::U64(1_790_000_000)),
            ("ref_hash", bytes_val(ref_hash)),
        ]),
    )
}

// ── parse_wire_in ─────────────────────────────────────────────────────────────

#[test]
fn wire_in_carries_every_field_into_params() {
    let log = parse_wire_in(&wire_in_event(
        address_contract(LP_CONTRACT),
        &ref_hash_bytes(),
    ))
    .expect("a well-formed wire_in should parse");

    assert_eq!(log.event_name, "WireIn");
    assert_eq!(log.contract_address, MINTER_CONTRACT);
    assert_eq!(log.block_number, 1_234_567);
    assert_eq!(log.block_timestamp, 1_790_000_000);
    assert_eq!(log.params["id"], 7);
    assert_eq!(log.params["receiver"], LP_CONTRACT);
    assert_eq!(log.params["amount"], "50000000000");
    assert_eq!(log.params["value_date"], "1790000000");
    assert_eq!(log.params["ref_hash"], REF_HASH_HEX);
}

#[test]
fn wire_in_ref_hash_is_lowercase_hex() {
    let log = parse_wire_in(&wire_in_event(
        address_contract(LP_CONTRACT),
        &ref_hash_bytes(),
    ))
    .expect("should parse");
    let hex = log.params["ref_hash"].as_str().expect("a string");
    assert_eq!(hex.len(), 64, "32 bytes render as 64 hex chars, got {hex}");
    assert_eq!(hex, hex.to_lowercase(), "hex must be lowercase: {hex}");
}

#[test]
fn wire_in_accepts_an_account_receiver() {
    let log = parse_wire_in(&wire_in_event(
        address_account(LP_ACCOUNT),
        &ref_hash_bytes(),
    ))
    .expect("a G… receiver is as valid as a C… one");
    assert_eq!(log.params["receiver"], LP_ACCOUNT);
}

#[test]
fn wire_in_rejects_a_foreign_event_name() {
    let mut raw = wire_in_event(address_contract(LP_CONTRACT), &ref_hash_bytes());
    raw.event_name = "wire_out_requested".to_owned();
    assert!(parse_wire_in(&raw).is_none());
}

#[test]
fn wire_in_rejects_a_missing_id_topic() {
    let raw = raw_event(
        "wire_in",
        vec![],
        encode_map(vec![
            ("receiver", address_contract(LP_CONTRACT)),
            ("amount", i128_val(1)),
            ("value_date", ScVal::U64(1)),
            ("ref_hash", bytes_val(&ref_hash_bytes())),
        ]),
    );
    assert!(parse_wire_in(&raw).is_none(), "id lives in topics[1]");
}

#[test]
fn wire_in_rejects_an_absent_ref_hash() {
    let raw = raw_event(
        "wire_in",
        vec![encode_u32(7)],
        encode_map(vec![
            ("receiver", address_contract(LP_CONTRACT)),
            ("amount", i128_val(1)),
            ("value_date", ScVal::U64(1)),
        ]),
    );
    assert!(parse_wire_in(&raw).is_none());
}

#[test]
fn wire_in_rejects_a_ref_hash_that_is_not_32_bytes() {
    for len in [31usize, 33] {
        let raw = wire_in_event(address_contract(LP_CONTRACT), &vec![0xab; len]);
        assert!(
            parse_wire_in(&raw).is_none(),
            "{len} bytes must be refused, never padded or truncated"
        );
    }
}

#[test]
fn wire_in_rejects_a_missing_amount() {
    let raw = raw_event(
        "wire_in",
        vec![encode_u32(7)],
        encode_map(vec![
            ("receiver", address_contract(LP_CONTRACT)),
            ("value_date", ScVal::U64(1)),
            ("ref_hash", bytes_val(&ref_hash_bytes())),
        ]),
    );
    assert!(parse_wire_in(&raw).is_none());
}

// ── parse_wire_in_assigned ────────────────────────────────────────────────────

#[test]
fn wire_in_assigned_carries_id_and_receiver() {
    let raw = raw_event(
        "wire_in_assigned",
        vec![encode_u32(7)],
        encode_map(vec![("receiver", address_contract(LP_CONTRACT))]),
    );
    let log = parse_wire_in_assigned(&raw).expect("a well-formed wire_in_assigned should parse");

    assert_eq!(log.event_name, "WireInAssigned");
    assert_eq!(log.params["id"], 7);
    assert_eq!(log.params["receiver"], LP_CONTRACT);
    assert_eq!(
        log.params.get("ref_hash"),
        None,
        "the assignment event carries no reference — it is joined to its wire_in by id"
    );
}

#[test]
fn wire_in_assigned_rejects_a_foreign_event_name() {
    let raw = raw_event(
        "wire_in",
        vec![encode_u32(7)],
        encode_map(vec![("receiver", address_contract(LP_CONTRACT))]),
    );
    assert!(parse_wire_in_assigned(&raw).is_none());
}

#[test]
fn wire_in_assigned_rejects_a_missing_id_topic() {
    let raw = raw_event(
        "wire_in_assigned",
        vec![],
        encode_map(vec![("receiver", address_contract(LP_CONTRACT))]),
    );
    assert!(parse_wire_in_assigned(&raw).is_none());
}

#[test]
fn wire_in_assigned_rejects_a_missing_receiver() {
    let raw = raw_event("wire_in_assigned", vec![encode_u32(7)], encode_map(vec![]));
    assert!(parse_wire_in_assigned(&raw).is_none());
}

// ── Routing ───────────────────────────────────────────────────────────────────

const DM_CONTRACT: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const WQ_CONTRACT: &str = "CB5CTBW2GALG7CT2FU3AEIHHWPYMME6WWIZWQ6M3V4VJO5JJ6CMOG2SL";
const SPLUSD_CONTRACT: &str = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";

/// The routed event's stored name, or `None` when nothing claimed it.
/// `StellarLog` is crate-private, so the name is what crosses the boundary.
///
/// The minter is configured under its former name — the `yield_minter_id`
/// argument — because contracts #33 renamed `yield-minter` to `minter`.
fn dispatched_event_name(raw: &RawEvent, minter_id: Option<&str>) -> Option<String> {
    pipeline_worker::indexer::stellar::parsers::dispatch_parser(
        raw,
        DM_CONTRACT,
        WQ_CONTRACT,
        SPLUSD_CONTRACT,
        None,
        minter_id,
        None,
    )
    .map(|log| log.event_name)
}

#[test]
fn a_minter_wire_in_routes_to_the_wire_in_parser() {
    let raw = wire_in_event(address_contract(LP_CONTRACT), &ref_hash_bytes());
    assert_eq!(
        dispatched_event_name(&raw, Some(MINTER_CONTRACT)).as_deref(),
        Some("WireIn")
    );
}

#[test]
fn a_minter_wire_in_assigned_routes_to_its_parser() {
    let raw = raw_event(
        "wire_in_assigned",
        vec![encode_u32(7)],
        encode_map(vec![("receiver", address_contract(LP_CONTRACT))]),
    );
    assert_eq!(
        dispatched_event_name(&raw, Some(MINTER_CONTRACT)).as_deref(),
        Some("WireInAssigned")
    );
}

#[test]
fn with_no_minter_configured_its_events_are_not_parsed() {
    let raw = wire_in_event(address_contract(LP_CONTRACT), &ref_hash_bytes());
    assert!(
        dispatched_event_name(&raw, None).is_none(),
        "unset minter_id must leave the branch non-existent — the job ships dark"
    );
}
