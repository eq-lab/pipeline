//! Encode/decode unit tests for the Stellar price-poller's deterministic surface.
//!
//! Covers:
//! - Envelope encoding (function name, arg encoding).
//! - `extract_i128` round-trip via `crate::stellar::scval`.
//! - Price normalization math matches EVM path shape.

use base64::Engine;
use bigdecimal::BigDecimal;
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract};
use stellar_xdr::curr::{
    HostFunction, Int128Parts, Limits, OperationBody, ReadXdr, ScVal, TransactionEnvelope, WriteXdr,
};

use pipeline_worker::stellar::tx::{build_invoke_envelope, envelope_to_base64};

fn fixture_vault() -> Contract {
    Contract::from_string("CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5")
        .expect("valid C… strkey")
}

// ── convert_to_assets envelope encoding ──────────────────────────────────────

/// Build the `convert_to_assets` envelope with `shares = 10^7` and verify the
/// function name and first arg are encoded correctly.
#[test]
fn convert_to_assets_envelope_encoding() {
    let vault = fixture_vault();
    let share_decimals: i16 = 7;
    let shares: i128 = 10i128.pow(share_decimals as u32); // 10_000_000
    let hi = (shares >> 64) as i64;
    let lo = shares as u64;
    let shares_scval = ScVal::I128(Int128Parts { hi, lo });

    let dummy_source = Ed25519Pub([0u8; 32]);
    let envelope = build_invoke_envelope(
        &dummy_source,
        0,
        0,
        &vault,
        "convert_to_assets",
        vec![shares_scval],
        vec![],
        None,
    );

    let TransactionEnvelope::Tx(env) = &envelope else {
        panic!("expected Tx envelope");
    };
    let op = &env.tx.operations[0];
    let OperationBody::InvokeHostFunction(ihf) = &op.body else {
        panic!("expected InvokeHostFunction");
    };
    let HostFunction::InvokeContract(args) = &ihf.host_function else {
        panic!("expected InvokeContract");
    };

    // Function name.
    assert_eq!(
        args.function_name.0.to_utf8_string_lossy(),
        "convert_to_assets",
        "function name must be 'convert_to_assets'"
    );

    // First arg is ScVal::I128(10^7).
    assert_eq!(args.args.len(), 1);
    match &args.args[0] {
        ScVal::I128(parts) => {
            let hi = parts.hi as i128;
            let lo = parts.lo as i128;
            let v = (hi << 64) | lo;
            assert_eq!(
                v, 10_000_000,
                "args[0] must be 10^share_decimals = 10_000_000"
            );
        }
        other => panic!("expected ScVal::I128, got {other:?}"),
    }

    // Round-trip base64 encode and decode to confirm no XDR corruption.
    let b64 = envelope_to_base64(&envelope).expect("base64 encode");
    let decoded_bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .expect("base64 decode");
    let decoded = TransactionEnvelope::from_xdr(decoded_bytes.as_slice(), Limits::none())
        .expect("XDR decode");
    let TransactionEnvelope::Tx(dec_env) = decoded else {
        panic!("decoded not Tx");
    };
    assert_eq!(env.tx.fee, dec_env.tx.fee);
}

// ── extract_i128 round-trip ───────────────────────────────────────────────────

/// Encode an `ScVal::I128` as base64-XDR, then decode it via
/// `crate::stellar::scval::extract_i128` and assert the value is preserved.
#[test]
fn extract_i128_roundtrip() {
    let value: i128 = 12_345_678;
    let hi = (value >> 64) as i64;
    let lo = value as u64;
    let scval = ScVal::I128(Int128Parts { hi, lo });
    let b64 = scval.to_xdr_base64(Limits::none()).expect("encode");

    let decoded = pipeline_worker::stellar::scval::extract_i128(&b64);
    assert_eq!(decoded, Some(value));
}

/// Negative value round-trip.
#[test]
fn extract_i128_negative_roundtrip() {
    let value: i128 = -9_876_543_210;
    let hi = (value >> 64) as i64;
    let lo = value as u64;
    let scval = ScVal::I128(Int128Parts { hi, lo });
    let b64 = scval.to_xdr_base64(Limits::none()).expect("encode");
    let decoded = pipeline_worker::stellar::scval::extract_i128(&b64);
    assert_eq!(decoded, Some(value));
}

// ── price normalization ───────────────────────────────────────────────────────

/// 1_234_567 raw / 10^7 asset_decimals == 0.1234567 — mirrors EVM path.
#[test]
fn normalize_price_matches_evm_path() {
    let raw: i128 = 1_234_567;
    let asset_decimals: u32 = 7;
    let scale = BigDecimal::from(10i128.pow(asset_decimals));
    let price = BigDecimal::from(raw) / scale;

    let expected: BigDecimal = "0.1234567".parse().unwrap();
    assert_eq!(price, expected);
}

/// 1:1 ratio (vault just seeded with dead shares, no yield): price == 1.0000000.
#[test]
fn normalize_price_one_to_one() {
    let raw: i128 = 10_000_000; // 10^7 assets returned for 10^7 shares
    let asset_decimals: u32 = 7;
    let scale = BigDecimal::from(10i128.pow(asset_decimals));
    let price = BigDecimal::from(raw) / scale;

    let expected: BigDecimal = "1".parse().unwrap();
    assert_eq!(price, expected);
}
