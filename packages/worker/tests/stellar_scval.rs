/// Low-level ScVal round-trip tests for the parser helpers.
///
/// Verifies that `extract_u128`, `extract_i128`, and `extract_address`
/// correctly decode values encoded by the `stellar-xdr` crate.
use pipeline_worker::indexer::stellar::parsers::{extract_address, extract_i128, extract_u128};
use stellar_xdr::curr::{
    AccountId, Int128Parts, Limits, PublicKey, ReadXdr, ScAddress, ScVal, StringM, UInt128Parts,
    Uint256, WriteXdr,
};

// ── extract_u128 ──────────────────────────────────────────────────────────────

fn encode_u128_scval(v: u128) -> String {
    let hi = (v >> 64) as u64;
    let lo = (v & 0xFFFF_FFFF_FFFF_FFFF) as u64;
    ScVal::U128(UInt128Parts { hi, lo })
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_i128_scval(v: i128) -> String {
    let hi = (v >> 64) as i64;
    let lo = (v & 0xFFFF_FFFF_FFFF_FFFF) as u64;
    ScVal::I128(Int128Parts { hi, lo })
        .to_xdr_base64(Limits::none())
        .unwrap()
}

fn encode_account_scval(strkey: &str) -> String {
    let pk = stellar_strkey::ed25519::PublicKey::from_string(strkey).unwrap();
    ScVal::Address(ScAddress::Account(AccountId(
        PublicKey::PublicKeyTypeEd25519(Uint256(pk.0)),
    )))
    .to_xdr_base64(Limits::none())
    .unwrap()
}

#[test]
fn extract_u128_zero() {
    assert_eq!(extract_u128(&encode_u128_scval(0)), Some(0));
}

#[test]
fn extract_u128_max() {
    assert_eq!(extract_u128(&encode_u128_scval(u128::MAX)), Some(u128::MAX));
}

#[test]
fn extract_u128_typical_request_id() {
    let v: u128 = 12345;
    assert_eq!(extract_u128(&encode_u128_scval(v)), Some(v));
}

#[test]
fn extract_u128_returns_none_for_wrong_type() {
    // Feed an I128 ScVal where U128 is expected
    let b64 = encode_i128_scval(42);
    assert_eq!(extract_u128(&b64), None);
}

// ── extract_i128 ──────────────────────────────────────────────────────────────

#[test]
fn extract_i128_zero() {
    assert_eq!(extract_i128(&encode_i128_scval(0)), Some(0));
}

#[test]
fn extract_i128_min() {
    assert_eq!(extract_i128(&encode_i128_scval(i128::MIN)), Some(i128::MIN));
}

#[test]
fn extract_i128_max() {
    assert_eq!(extract_i128(&encode_i128_scval(i128::MAX)), Some(i128::MAX));
}

#[test]
fn extract_i128_negative() {
    let v: i128 = -1_000_000;
    assert_eq!(extract_i128(&encode_i128_scval(v)), Some(v));
}

#[test]
fn extract_i128_returns_none_for_wrong_type() {
    // Feed a U128 ScVal where I128 is expected
    let b64 = encode_u128_scval(42);
    assert_eq!(extract_i128(&b64), None);
}

// ── extract_address ───────────────────────────────────────────────────────────

const USER_G: &str = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";

#[test]
fn extract_address_account_round_trips() {
    let b64 = encode_account_scval(USER_G);
    let decoded = extract_address(&b64).expect("should decode account address");
    assert_eq!(decoded, USER_G);
}

#[test]
fn extract_address_contract_round_trips() {
    use stellar_xdr::curr::{ContractId, Hash, ScAddress, ScVal};

    // Use a known contract Strkey
    let contract_str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
    let contract = stellar_strkey::Contract::from_string(contract_str).unwrap();
    let b64 = ScVal::Address(ScAddress::Contract(ContractId(Hash(contract.0))))
        .to_xdr_base64(Limits::none())
        .unwrap();

    let decoded = extract_address(&b64).expect("should decode contract address");
    assert_eq!(decoded, contract_str);
}

#[test]
fn extract_address_returns_none_for_non_address_scval() {
    // Feed a U128 ScVal where Address is expected
    let b64 = encode_u128_scval(42);
    assert_eq!(extract_address(&b64), None);
}

// ── Symbol decoding (used by rpc.rs, but testable here) ──────────────────────

#[test]
fn symbol_decodes_correctly() {
    use stellar_xdr::curr::{ScSymbol, ScVal};

    let sym_str = "deposit_requested";
    let sym: StringM<32> = sym_str.try_into().unwrap();
    let b64 = ScVal::Symbol(ScSymbol(sym))
        .to_xdr_base64(Limits::none())
        .unwrap();

    let decoded = ScVal::from_xdr_base64(&b64, Limits::none()).unwrap();
    match decoded {
        ScVal::Symbol(s) => assert_eq!(s.0.to_utf8_string_lossy(), sym_str),
        _ => panic!("expected Symbol ScVal"),
    }
}
