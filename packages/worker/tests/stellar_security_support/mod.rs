// spec: docs/references/security-registry-events.md#event-table
#![allow(dead_code, clippy::too_many_arguments)]
use pipeline_worker::indexer::stellar::parsers::StellarLog;
use pipeline_worker::indexer::stellar::rpc::RawEvent;
use shared::security_registry::SecurityEventRow;
use stellar_xdr::curr::{
    AccountId, BytesM, ContractId, Hash, Int128Parts, Limits, PublicKey, ScAddress, ScBytes, ScMap,
    ScMapEntry, ScSymbol, ScVal, ScVec, StringM, Uint256, VecM, WriteXdr,
};

pub const SECURITY: &str = "CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX";
pub const G_ADDR: &str = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
pub const C_ADDR: &str = "CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS";
pub const BASE_TS: i64 = 1_790_000_000;

pub fn b64(v: &ScVal) -> String {
    v.to_xdr_base64(Limits::none()).unwrap()
}

pub fn sym(s: &str) -> ScVal {
    let s: StringM<32> = s.try_into().unwrap();
    ScVal::Symbol(ScSymbol(s))
}

pub fn enum_val(variant: &str) -> ScVal {
    let items: VecM<ScVal> = vec![sym(variant)].try_into().unwrap();
    ScVal::Vec(Some(ScVec(items)))
}

pub fn vec_val(items: Vec<ScVal>) -> ScVal {
    let items: VecM<ScVal> = items.try_into().unwrap();
    ScVal::Vec(Some(ScVec(items)))
}

pub fn i128_val(v: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (v >> 64) as i64,
        lo: (v & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

pub fn bytes32(byte: u8) -> ScVal {
    let b: BytesM = vec![byte; 32].try_into().unwrap();
    ScVal::Bytes(ScBytes(b))
}

pub fn hex32(byte: u8) -> String {
    hex::encode([byte; 32])
}

pub fn str_val(s: &str) -> ScVal {
    ScVal::String(stellar_xdr::curr::ScString(s.try_into().unwrap()))
}

pub fn address_val(strkey: &str) -> ScVal {
    let addr = if strkey.starts_with('G') {
        let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
        ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(pk.0))))
    } else {
        let c = stellar_strkey::Contract::from_string(strkey).unwrap();
        ScAddress::Contract(ContractId(Hash(c.0)))
    };
    ScVal::Address(addr)
}

pub fn map_val(pairs: Vec<(&str, ScVal)>) -> ScVal {
    let mut sorted = pairs;
    sorted.sort_by_key(|(k, _)| *k);
    let entries: Vec<ScMapEntry> = sorted
        .into_iter()
        .map(|(k, val)| ScMapEntry { key: sym(k), val })
        .collect();
    let map: VecM<ScMapEntry> = entries.try_into().unwrap();
    ScVal::Map(Some(ScMap(map)))
}

pub fn encode_map(pairs: Vec<(&str, ScVal)>) -> String {
    b64(&map_val(pairs))
}

pub fn raw_at(name: &str, ids: &[u32], value: String, ledger: u32, ts: i64, seq: u32) -> RawEvent {
    let mut topics_base64 = vec![b64(&sym(name))];
    topics_base64.extend(ids.iter().map(|id| b64(&ScVal::U32(*id))));
    RawEvent {
        contract_id: SECURITY.to_owned(),
        event_name: name.to_owned(),
        topics_base64,
        value_base64: value,
        ledger,
        ledger_closed_at_unix: ts as u64,
        tx_hash: format!("tx{seq}"),
        tx_index: seq,
        op_index: 0,
        event_index_in_op: 0,
    }
}

pub fn raw(name: &str, ids: &[u32], value: String) -> RawEvent {
    raw_at(name, ids, value, 1_234_567, BASE_TS, 2)
}

pub fn row_from(log: StellarLog, id: i64) -> SecurityEventRow {
    SecurityEventRow {
        id,
        event_name: log.event_name,
        block_number: log.block_number as i64,
        log_index: log.log_index as i64,
        block_timestamp: log.block_timestamp as i64,
        tx_hash: log.tx_hash,
        params: log.params,
    }
}

pub fn terms_value(margin_call_at: u64) -> String {
    let terms = map_val(vec![
        ("advance_ratio_bps", ScVal::U32(8000)),
        ("margin_call_ratio_bps", ScVal::U32(8500)),
        ("default_rate", ScVal::U32(200_000)),
        ("tolerance_bps", ScVal::U32(50)),
        ("grade_tolerance_bps", ScVal::U32(100)),
        ("cure_period", ScVal::U64(604_800)),
        ("price_stale_after", ScVal::U64(172_800)),
        ("grace_period", ScVal::U64(86_400)),
        ("attestation_interval", ScVal::U64(0)),
        ("inspection_interval", ScVal::U64(0)),
        ("margin_call_at", ScVal::U64(margin_call_at)),
        ("payment_term", enum_val("Lc")),
    ]);
    encode_map(vec![("terms", terms)])
}

pub fn registered(
    loan: u32,
    rec: u32,
    lot: u32,
    protection: &str,
    ledger: u32,
    ts: i64,
    seq: u32,
) -> RawEvent {
    raw_at(
        "record_registered",
        &[loan, rec],
        encode_map(vec![
            ("lot_id", ScVal::U32(lot)),
            ("protection", enum_val(protection)),
        ]),
        ledger,
        ts,
        seq,
    )
}

pub fn perfected(loan: u32, rec: u32, byte: u8, ledger: u32, ts: i64, seq: u32) -> RawEvent {
    raw_at(
        "record_perfected",
        &[loan, rec],
        encode_map(vec![("evidence_hash", bytes32(byte))]),
        ledger,
        ts,
        seq,
    )
}

pub fn revalued(loan: u32, rec: u32, value: i128, ledger: u32, ts: i64, seq: u32) -> RawEvent {
    raw_at(
        "revalued",
        &[loan, rec],
        encode_map(vec![
            ("value_per_unit", i128_val(value)),
            ("benchmark", sym("LME")),
            ("report_hash", bytes32(0x64)),
        ]),
        ledger,
        ts,
        seq,
    )
}

pub fn handed_over(
    loan: u32,
    from: u32,
    to: u32,
    byte: u8,
    ledger: u32,
    ts: i64,
    seq: u32,
) -> RawEvent {
    raw_at(
        "record_handed_over",
        &[loan, from, to],
        encode_map(vec![("evidence_hash", bytes32(byte))]),
        ledger,
        ts,
        seq,
    )
}

pub fn margin_call(loan: u32, ltv: u32, cure_by: u64, ledger: u32, ts: i64, seq: u32) -> RawEvent {
    raw_at(
        "margin_call",
        &[loan],
        encode_map(vec![
            ("ltv_bps", ScVal::U32(ltv)),
            ("margin_call_ratio_bps", ScVal::U32(8500)),
            ("cure_by", ScVal::U64(cure_by)),
        ]),
        ledger,
        ts,
        seq,
    )
}

pub fn cured(loan: u32, ltv: u32, ledger: u32, ts: i64, seq: u32) -> RawEvent {
    raw_at(
        "margin_call_cured",
        &[loan],
        encode_map(vec![("ltv_bps", ScVal::U32(ltv))]),
        ledger,
        ts,
        seq,
    )
}

pub fn price_stale(loan: u32, ltv: u32, ledger: u32, ts: i64, seq: u32) -> RawEvent {
    raw_at(
        "price_stale",
        &[loan],
        encode_map(vec![
            ("ltv_bps", ScVal::U32(ltv)),
            ("margin_call_ratio_bps", ScVal::U32(8500)),
        ]),
        ledger,
        ts,
        seq,
    )
}

pub fn inspection_recorded(
    loan: u32,
    rec: u32,
    insp: u32,
    lot: u32,
    kind: &str,
    ledger: u32,
    ts: i64,
    seq: u32,
) -> RawEvent {
    raw_at(
        "inspection_recorded",
        &[loan, rec, insp],
        encode_map(vec![
            ("lot_id", ScVal::U32(lot)),
            ("inspector", address_val(G_ADDR)),
            ("kind", enum_val(kind)),
        ]),
        ledger,
        ts,
        seq,
    )
}

pub fn inspection_approved(
    loan: u32,
    rec: u32,
    insp: u32,
    flagged: bool,
    ledger: u32,
    ts: i64,
    seq: u32,
) -> RawEvent {
    raw_at(
        "inspection_approved",
        &[loan, rec, insp],
        encode_map(vec![
            ("approved_by", address_val(C_ADDR)),
            ("variance_reference_bps", ScVal::I32(-250)),
            ("variance_previous_bps", ScVal::I32(0)),
            ("variance_grade_bps", ScVal::I32(0)),
            ("flagged", ScVal::Bool(flagged)),
        ]),
        ledger,
        ts,
        seq,
    )
}

pub fn flag_resolved(
    loan: u32,
    rec: u32,
    insp: u32,
    outcome: &str,
    ledger: u32,
    ts: i64,
    seq: u32,
) -> RawEvent {
    raw_at(
        "flag_resolved",
        &[loan, rec],
        encode_map(vec![
            ("inspection_id", ScVal::U32(insp)),
            ("outcome", enum_val(outcome)),
            ("reason_hash", bytes32(0x77)),
        ]),
        ledger,
        ts,
        seq,
    )
}
