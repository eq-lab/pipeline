//! Encode/sign tests for the shared `worker::stellar::tx` helpers.
//!
//! Moved out of the inline `#[cfg(test)] mod tests` block in `src/stellar/tx.rs`
//! (originally inherited from #562's `relayer/stellar/tx.rs`) per the project
//! convention of keeping tests in external files under `tests/`.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use sha2::{Digest, Sha256};
use stellar_strkey::{ed25519::PublicKey as Ed25519Pub, Contract as ContractStrkey};
use stellar_xdr::curr::{Limits, ReadXdr, ScMap, ScVal, TransactionEnvelope, WriteXdr};

use pipeline_worker::stellar::tx::{
    build_invoke_envelope, build_set_authorized_operation_scval, envelope_to_base64, sign_envelope,
};

fn fixture_user() -> Ed25519Pub {
    Ed25519Pub::from_string("GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM")
        .expect("valid G… strkey")
}

fn fixture_plusd() -> ContractStrkey {
    ContractStrkey::from_string("CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO")
        .expect("valid C… strkey")
}

#[test]
fn operation_scval_alphabetical_order() {
    let salt = [7u8; 32];
    let val = build_set_authorized_operation_scval(&fixture_plusd(), &fixture_user(), salt);
    let ScVal::Map(Some(ScMap(entries))) = val else {
        panic!("expected ScVal::Map");
    };
    let keys: Vec<String> = entries
        .iter()
        .map(|e| match &e.key {
            ScVal::Symbol(s) => s.0.to_utf8_string_lossy(),
            _ => panic!("non-symbol key"),
        })
        .collect();
    assert_eq!(
        keys,
        vec!["args", "function", "predecessor", "salt", "target"]
    );
}

#[test]
fn operation_scval_deterministic() {
    let salt = [1u8; 32];
    let a = build_set_authorized_operation_scval(&fixture_plusd(), &fixture_user(), salt);
    let b = build_set_authorized_operation_scval(&fixture_plusd(), &fixture_user(), salt);
    let a_bytes = a.to_xdr(Limits::none()).expect("xdr");
    let b_bytes = b.to_xdr(Limits::none()).expect("xdr");
    assert_eq!(a_bytes, b_bytes);
}

#[test]
fn operation_hash_changes_with_salt() {
    let user = fixture_user();
    let sac = fixture_plusd();
    let op_a = build_set_authorized_operation_scval(&sac, &user, [1u8; 32]);
    let op_b = build_set_authorized_operation_scval(&sac, &user, [2u8; 32]);
    let a_hash: [u8; 32] =
        Sha256::digest(op_a.to_xdr(Limits::none()).expect("xdr").as_slice()).into();
    let b_hash: [u8; 32] =
        Sha256::digest(op_b.to_xdr(Limits::none()).expect("xdr").as_slice()).into();
    assert_ne!(a_hash, b_hash);
}

#[test]
fn signature_round_trip() {
    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();
    let source = Ed25519Pub(pubkey_bytes);

    let user = fixture_user();
    let sac = fixture_plusd();
    let op = build_set_authorized_operation_scval(&sac, &user, [42u8; 32]);
    let mut envelope = build_invoke_envelope(
        &source,
        42,
        10_000,
        &sac,
        "is_authorized",
        vec![op],
        vec![],
        None,
    );
    sign_envelope(
        &mut envelope,
        &signing_key,
        "Test SDF Network ; September 2015",
    )
    .expect("sign");

    let TransactionEnvelope::Tx(env) = &envelope else {
        panic!("not Tx variant");
    };
    assert_eq!(env.signatures.len(), 1);
    let sig0 = &env.signatures[0];
    assert_eq!(sig0.hint.0, pubkey_bytes[28..32]);

    // Verify the signature round-trips via base64 → XDR.
    let b64 = envelope_to_base64(&envelope).expect("base64");
    let bytes = STANDARD.decode(b64.as_bytes()).expect("decode");
    let decoded =
        TransactionEnvelope::from_xdr(bytes.as_slice(), Limits::none()).expect("from_xdr");
    let TransactionEnvelope::Tx(decoded_env) = decoded else {
        panic!("decoded not Tx");
    };
    assert_eq!(decoded_env.signatures.len(), 1);
}
