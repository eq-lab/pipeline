//! SEP-0053 message signer — produces a signature the API's `/v1/auth/verify`
//! accepts. `stellar-cli` cannot do this (it only signs transaction envelopes).
//!
//! The seed is read from the SEED env var so it never lands in shell history:
//!
//!   SEED=S… cargo run -q -p shared --example sep53sign -- "<message>"
//!
//! Prints the G… address and the base64 signature, then re-verifies the pair
//! through the production verifier before printing, so a PASS line means the
//! backend will accept it.

use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};

fn main() {
    let message = match std::env::args().nth(1) {
        Some(m) => m,
        None => {
            eprintln!("usage: SEED=S… cargo run -p shared --example sep53sign -- <message>");
            std::process::exit(2);
        }
    };
    let seed = std::env::var("SEED").unwrap_or_else(|_| {
        eprintln!("SEED env var is required (the S… secret seed)");
        std::process::exit(2);
    });

    let sk_strkey =
        stellar_strkey::ed25519::PrivateKey::from_string(seed.trim()).unwrap_or_else(|e| {
            eprintln!("not a valid Stellar S… secret seed: {e}");
            std::process::exit(1);
        });
    let signing_key = SigningKey::from_bytes(&sk_strkey.0);
    let address =
        stellar_strkey::ed25519::PublicKey(signing_key.verifying_key().to_bytes()).to_string();

    // SEP-0053 signing base: SHA256("Stellar Signed Message:\n" || message).
    let mut hasher = Sha256::new();
    hasher.update(b"Stellar Signed Message:\n");
    hasher.update(message.as_bytes());
    let hash: [u8; 32] = hasher.finalize().into();

    let sig = signing_key.sign(&hash);
    let b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());

    match shared::signature::verify_stellar_personal_sign(&message, &b64, &address) {
        Ok(()) => {}
        Err(e) => {
            eprintln!("self-check FAILED — not emitting: {e}");
            std::process::exit(1);
        }
    }

    println!("address   : {address}");
    println!("signature : {b64}");
    println!("hex       : {}", hex::encode(sig.to_bytes()));
    println!("self-check: PASS (production verifier accepts this pair)");
}
