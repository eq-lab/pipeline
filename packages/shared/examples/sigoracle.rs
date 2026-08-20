//! Determinism oracle: RFC-8032 ed25519 is deterministic, so for a given key the
//! signature is a pure function of the signed payload. Given the secret seed and
//! a wallet-produced signature, sign a large space of candidate payloads and look
//! for an exact byte match — which identifies precisely what the wallet signed.
//!
//!   SEED=S… cargo run -q -p shared --example sigoracle -- <wallet_sig_b64> <message>

use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let (target_s, msg) = (a[0].as_str(), a[1].as_str());
    let seed = std::env::var("SEED").expect("SEED env var required");

    let sk = stellar_strkey::ed25519::PrivateKey::from_string(seed.trim()).expect("bad S… seed");
    let key = SigningKey::from_bytes(&sk.0);
    let target = base64::engine::general_purpose::STANDARD
        .decode(target_s.trim())
        .expect("signature is not base64");

    let b64 = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
    let sha = |b: &[u8]| Sha256::digest(b).to_vec();

    let mut renders: Vec<(String, Vec<u8>)> = vec![
        ("utf8".into(), msg.as_bytes().to_vec()),
        ("utf8-trimmed".into(), msg.trim().as_bytes().to_vec()),
        ("utf8+nl".into(), format!("{msg}\n").into_bytes()),
        ("utf8+crlf".into(), format!("{msg}\r\n").into_bytes()),
        ("utf8+nul".into(), {
            let mut v = msg.as_bytes().to_vec();
            v.push(0);
            v
        }),
        ("base64(utf8)".into(), b64(msg.as_bytes()).into_bytes()),
        (
            "base64url(utf8)".into(),
            base64::engine::general_purpose::URL_SAFE
                .encode(msg.as_bytes())
                .into_bytes(),
        ),
        ("hex(utf8)".into(), hex::encode(msg.as_bytes()).into_bytes()),
        ("json-quoted".into(), format!("{msg:?}").into_bytes()),
        ("sha256(utf8)".into(), sha(msg.as_bytes())),
        (
            "hex(sha256(utf8))".into(),
            hex::encode(sha(msg.as_bytes())).into_bytes(),
        ),
        (
            "base64(sha256(utf8))".into(),
            b64(&sha(msg.as_bytes())).into_bytes(),
        ),
        (
            "utf16le(utf8)".into(),
            msg.encode_utf16().flat_map(u16::to_le_bytes).collect(),
        ),
    ];
    // Message fields on their own — a wallet might sign only part of what it was shown.
    for (label, needle) in [("nonce-only", "Nonce: "), ("address-only", "Address: ")] {
        if let Some(i) = msg.find(needle) {
            let rest = &msg[i + needle.len()..];
            let val = rest.split(' ').next().unwrap_or(rest);
            renders.push((label.into(), val.as_bytes().to_vec()));
        }
    }

    let prefixes: Vec<(&str, &[u8])> = vec![
        ("none", b""),
        ("SEP53", b"Stellar Signed Message:\n"),
        ("SEP53-no-nl", b"Stellar Signed Message:"),
        ("SEP53-space", b"Stellar Signed Message: "),
        ("SEP53-lower", b"stellar signed message:\n"),
        ("SEP53-nocolon", b"Stellar Signed Message\n"),
        ("SEP53-2nl", b"Stellar Signed Message:\n\n"),
        ("eth-19", b"\x19Stellar Signed Message:\n"),
        ("eth-proper", b"\x19Ethereum Signed Message:\n"),
        ("lobstr", b"Lobstr Signed Message:\n"),
        ("freighter", b"Freighter Signed Message:\n"),
    ];

    let transforms: Vec<(&str, fn(&[u8]) -> Vec<u8>)> = vec![
        ("raw", |b| b.to_vec()),
        ("sha256", |b| Sha256::digest(b).to_vec()),
        ("sha256x2", |b| Sha256::digest(Sha256::digest(b)).to_vec()),
    ];

    // Stellar transaction/auth signing bases: sha256(networkId || envelopeType || body).
    let net_id = Sha256::digest(b"Test SDF Network ; September 2015").to_vec();

    let mut tried = 0usize;
    let mut hit = false;
    let mut probe = |label: String, payload: &[u8], tried: &mut usize, hit: &mut bool| {
        *tried += 1;
        if key.sign(payload).to_bytes()[..] == target[..] {
            println!("*** EXACT MATCH: {label}");
            *hit = true;
        }
    };

    for (rn, rb) in &renders {
        for (pn, pb) in &prefixes {
            let mut plain = pb.to_vec();
            plain.extend_from_slice(rb);
            let mut lenpfx = pb.to_vec();
            lenpfx.extend_from_slice(rb.len().to_string().as_bytes());
            lenpfx.extend_from_slice(rb);
            for (cn, cand) in [("", &plain), ("+len", &lenpfx)] {
                for (tn, tf) in &transforms {
                    probe(
                        format!("{tn}( {pn}{cn} || {rn} )"),
                        &tf(cand),
                        &mut tried,
                        &mut hit,
                    );
                }
                // network-scoped variants (tx/auth-entry style signing bases)
                for (en, etype) in [("tx", 2u32), ("auth", 9u32)] {
                    let mut v = net_id.clone();
                    v.extend_from_slice(&etype.to_be_bytes());
                    v.extend_from_slice(cand);
                    probe(
                        format!("sha256( netId || {en} || {pn}{cn} || {rn} )"),
                        &Sha256::digest(&v),
                        &mut tried,
                        &mut hit,
                    );
                }
            }
        }
    }

    println!(
        "tried {tried} candidate payloads — {}",
        if hit { "see matches above" } else { "NO MATCH" }
    );
    if !hit {
        println!();
        println!("Since ed25519 (RFC 8032) is deterministic, a no-match means one of:");
        println!("  a) the wallet signed with a DIFFERENT key than this seed, or");
        println!("  b) the wallet signed a payload outside this search space, or");
        println!("  c) the wallet uses randomized/hedged nonces (non-RFC-8032), in which");
        println!("     case R differs every time and only verification can decide.");
        println!();
        println!("Distinguish (c): sign the SAME message twice in the wallet. Identical");
        println!("output => deterministic => (a) or (b). Differing output => (c).");
    }
}
