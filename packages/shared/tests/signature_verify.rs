//! Unit tests for EVM (EIP-191) and Stellar (SEP-0053) signature verification.
//!
//! Pure crypto round-trips — no database, no network, no env.

use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use shared::signature::{verify_personal_sign, verify_stellar_personal_sign};

const MESSAGE: &str = "Welcome to Pipeline!\n\nNonce: 1234-abcd";

// ── EVM (EIP-191 personal_sign) ────────────────────────────────────────────

fn evm_signer() -> PrivateKeySigner {
    // Well-known anvil test key.
    "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        .parse()
        .unwrap()
}

#[test]
fn evm_personal_sign_round_trip() {
    let signer = evm_signer();
    let address = format!("{}", signer.address());
    let sig = signer.sign_message_sync(MESSAGE.as_bytes()).unwrap();
    let sig_hex = hex::encode(sig.as_bytes());

    verify_personal_sign(MESSAGE, &sig_hex, &address).expect("valid EVM signature must verify");
}

#[test]
fn evm_rejects_wrong_address() {
    let signer = evm_signer();
    let sig = signer.sign_message_sync(MESSAGE.as_bytes()).unwrap();
    let sig_hex = hex::encode(sig.as_bytes());
    let other = "0x000000000000000000000000000000000000dEaD";

    assert!(verify_personal_sign(MESSAGE, &sig_hex, other).is_err());
}

#[test]
fn evm_rejects_tampered_message() {
    let signer = evm_signer();
    let address = format!("{}", signer.address());
    let sig = signer.sign_message_sync(MESSAGE.as_bytes()).unwrap();
    let sig_hex = hex::encode(sig.as_bytes());

    assert!(verify_personal_sign("a different message", &sig_hex, &address).is_err());
}

// ── Stellar (SEP-0053) ──────────────────────────────────────────────────────

/// Sign `message` exactly as a SEP-0053 wallet (e.g. Freighter) would:
/// ed25519 over `SHA256("Stellar Signed Message:\n" || message)`.
fn stellar_sign(signing_key: &SigningKey, message: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"Stellar Signed Message:\n");
    hasher.update(message.as_bytes());
    let hash: [u8; 32] = hasher.finalize().into();
    let sig = signing_key.sign(&hash);
    hex::encode(sig.to_bytes())
}

fn stellar_keypair(seed: [u8; 32]) -> (SigningKey, String) {
    let signing_key = SigningKey::from_bytes(&seed);
    let pubkey = signing_key.verifying_key().to_bytes();
    let g_address = format!("{}", stellar_strkey::ed25519::PublicKey(pubkey));
    (signing_key, g_address)
}

#[test]
fn stellar_sep0053_round_trip_hex() {
    let (signing_key, g_address) = stellar_keypair([7u8; 32]);
    let sig_hex = stellar_sign(&signing_key, MESSAGE);

    verify_stellar_personal_sign(MESSAGE, &sig_hex, &g_address)
        .expect("valid hex SEP-0053 signature must verify");
}

#[test]
fn stellar_sep0053_round_trip_base64() {
    // Stellar tooling (Freighter, SDKs) emits signatures as base64 — the verifier
    // must accept that form too.
    use base64::Engine;
    let (signing_key, g_address) = stellar_keypair([7u8; 32]);
    let sig_hex = stellar_sign(&signing_key, MESSAGE);
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(hex::decode(sig_hex).unwrap());

    verify_stellar_personal_sign(MESSAGE, &sig_b64, &g_address)
        .expect("valid base64 SEP-0053 signature must verify");
}

#[test]
fn stellar_rejects_wrong_key() {
    let (signing_key, _) = stellar_keypair([7u8; 32]);
    let (_, other_address) = stellar_keypair([8u8; 32]);
    let sig_hex = stellar_sign(&signing_key, MESSAGE);

    assert!(verify_stellar_personal_sign(MESSAGE, &sig_hex, &other_address).is_err());
}

#[test]
fn stellar_rejects_tampered_message() {
    let (signing_key, g_address) = stellar_keypair([7u8; 32]);
    let sig_hex = stellar_sign(&signing_key, MESSAGE);

    assert!(verify_stellar_personal_sign("tampered", &sig_hex, &g_address).is_err());
}

#[test]
fn stellar_rejects_signature_over_raw_message() {
    // A signature over the *un-prefixed* raw message must NOT verify — this guards
    // against accidentally accepting the non-SEP-0053 scheme.
    let (signing_key, g_address) = stellar_keypair([7u8; 32]);
    let raw_sig = signing_key.sign(MESSAGE.as_bytes());
    let sig_hex = hex::encode(raw_sig.to_bytes());

    assert!(verify_stellar_personal_sign(MESSAGE, &sig_hex, &g_address).is_err());
}

#[test]
fn stellar_rejects_bad_length_signature() {
    let (_, g_address) = stellar_keypair([7u8; 32]);
    assert!(verify_stellar_personal_sign(MESSAGE, "deadbeef", &g_address).is_err());
}
