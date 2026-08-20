//! Hana-specific probe: does the wallet treat `message` as base64 and sign the
//! DECODED bytes? Node/browser `Buffer.from(s, "base64")` silently DROPS
//! characters outside the base64 alphabet rather than throwing, so a plain-text
//! challenge full of spaces, `!`, `:` and `-` decodes to arbitrary garbage
//! instead of erroring — and the wallet signs that garbage.
//!
//!   SEED=S… cargo run -q -p shared --example hanaprobe -- <wallet_sig_b64> <message>

use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};

/// Replicate Node's `Buffer.from(str, "base64")`: keep only base64-alphabet
/// characters (accepting the url-safe aliases), drop everything else, then
/// decode — discarding a trailing 1-char remainder group, as Node does.
fn lenient_base64(s: &str, url_safe_aliases: bool) -> Vec<u8> {
    let mut kept: String = s
        .chars()
        .filter_map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '+' | '/' => Some(c),
            '-' if url_safe_aliases => Some('+'),
            '_' if url_safe_aliases => Some('/'),
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

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let (target_s, msg) = (a[0].as_str(), a[1].as_str());
    let seed = std::env::var("SEED").expect("SEED env var required");
    let sk = stellar_strkey::ed25519::PrivateKey::from_string(seed.trim()).expect("bad seed");
    let key = SigningKey::from_bytes(&sk.0);
    let target = base64::engine::general_purpose::STANDARD
        .decode(target_s.trim())
        .unwrap();

    let blob_std = lenient_base64(msg, false);
    let blob_url = lenient_base64(msg, true);
    println!("lenient-base64 decode of the message:");
    println!(
        "  strict-alphabet : {} bytes -> {}",
        blob_std.len(),
        hex::encode(&blob_std)
    );
    println!(
        "  url-aliases     : {} bytes -> {}",
        blob_url.len(),
        hex::encode(&blob_url)
    );
    println!();

    let sha = |b: &[u8]| Sha256::digest(b).to_vec();
    let prefix = b"Stellar Signed Message:\n";
    let mut cands: Vec<(String, Vec<u8>)> = Vec::new();
    for (tag, blob) in [("std", &blob_std), ("url", &blob_url)] {
        cands.push((format!("raw lenient-b64 blob [{tag}]"), blob.clone()));
        cands.push((format!("sha256(blob) [{tag}]"), sha(blob)));
        let mut p = prefix.to_vec();
        p.extend_from_slice(blob);
        cands.push((format!("sha256(SEP53prefix || blob) [{tag}]"), sha(&p)));
        cands.push((format!("SEP53prefix || blob, unhashed [{tag}]"), p));
    }

    let mut hit = false;
    for (label, payload) in &cands {
        if key.sign(payload).to_bytes()[..] == target[..] {
            println!("*** EXACT MATCH: {label}");
            hit = true;
        }
    }
    if !hit {
        println!("no match among {} lenient-base64 candidates", cands.len());
    }
}
