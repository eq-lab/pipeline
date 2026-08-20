//! Confirms the Hana model and tests the client-side workaround.
//!
//! Model: Hana's `signMessage({message})` does `Buffer.from(message, "base64")`
//! — which accepts BOTH base64 alphabets and silently drops every character
//! outside them — then ed25519-signs the raw decoded blob. No SEP-53 prefix,
//! no SHA-256.
//!
//! Consequence: feeding it base64(sha256("Stellar Signed Message:\n" || msg))
//! makes it decode back to exactly the SEP-53 signing base, so it emits a
//! spec-correct signature the backend already accepts, unmodified.

use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};

fn lenient_base64(s: &str) -> Vec<u8> {
    let mut kept: String = s
        .chars()
        .filter_map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '+' | '/' => Some(c),
            '-' => Some('+'),
            '_' => Some('/'),
            _ => None,
        })
        .collect();
    while kept.len() % 4 == 1 {
        kept.pop();
    }
    base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(kept)
        .unwrap_or_default()
}

/// What Hana does with whatever string it is handed.
fn hana_sign(key: &SigningKey, input: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(key.sign(&lenient_base64(input)).to_bytes())
}

fn sep53_base(msg: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"Stellar Signed Message:\n");
    h.update(msg.as_bytes());
    h.finalize().into()
}

fn main() {
    let msg = std::env::args().nth(1).expect("usage: … <message>");
    let observed = std::env::args()
        .nth(2)
        .expect("usage: … <message> <observed_sig>");
    let seed = std::env::var("SEED").expect("SEED required");
    let sk = stellar_strkey::ed25519::PrivateKey::from_string(seed.trim()).unwrap();
    let key = SigningKey::from_bytes(&sk.0);
    let address = stellar_strkey::ed25519::PublicKey(key.verifying_key().to_bytes()).to_string();

    // 1. Reproduce the wallet's actual output from the model alone.
    let modelled = hana_sign(&key, &msg);
    println!("model reproduces wallet output : {}", modelled == observed);

    // 2. Today's call: backend rejects it.
    println!(
        "current flow verifies            : {}",
        shared::signature::verify_stellar_personal_sign(&msg, &observed, &address).is_ok()
    );

    // 3. Workaround: hand Hana the base64 of the SEP-53 signing base instead.
    let shim_input = base64::engine::general_purpose::STANDARD.encode(sep53_base(&msg));
    let shim_sig = hana_sign(&key, &shim_input);
    println!(
        "workaround verifies (unmodified) : {}",
        shared::signature::verify_stellar_personal_sign(&msg, &shim_sig, &address).is_ok()
    );
    println!();
    println!("what Hana would be handed: {shim_input}");
}
