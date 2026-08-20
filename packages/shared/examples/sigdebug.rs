//! TEMPORARY diagnostic for auth signature-verification failures.
//!
//! Usage:
//!   cargo run -p shared --example sigdebug -- <address> <signature> <message>
//!
//! Prints why `shared::signature::verify_*` rejected the input and probes the
//! usual suspects (v-byte encoding, high-s malleability, base64url signatures,
//! wallets that sign the raw message instead of the SEP-53 hash, and message
//! byte-level drift such as JSON-escaped newlines).

use alloy::primitives::{keccak256, Address, PrimitiveSignature};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        eprintln!("usage: sigdebug <address> <signature> <message>");
        std::process::exit(2);
    }
    let (address, signature, message) = (args[0].trim(), args[1].trim(), args[2].as_str());

    println!("address   : {address}");
    println!("signature : {signature}");
    println!("message   : {message:?}");
    println!(
        "msg bytes : {} (chars: {})",
        message.len(),
        message.chars().count()
    );
    println!(
        "msg sha256: {}",
        hex::encode(Sha256::digest(message.as_bytes()))
    );
    println!();

    if address.starts_with("0x") || address.starts_with("0X") {
        evm(address, signature, message);
    } else if address.starts_with('G') {
        stellar(address, signature, message);
    } else {
        println!("!! unrecognized address format (expected EVM 0x… or Stellar G…)");
    }
}

// ── EVM ──────────────────────────────────────────────────────────────────────

fn evm(address: &str, signature: &str, message: &str) {
    let expected: Address = match address.parse() {
        Ok(a) => a,
        Err(e) => return println!("!! address does not parse as an EVM address: {e}"),
    };

    let raw = signature.strip_prefix("0x").unwrap_or(signature);
    let bytes = match hex::decode(raw) {
        Ok(b) => b,
        Err(e) => return println!("!! signature is not valid hex: {e}"),
    };
    println!("sig length: {} bytes", bytes.len());
    if bytes.len() != 65 {
        println!("!! production code requires exactly 65 bytes -> rejected here.");
        if bytes.len() > 65 {
            println!("   >65 bytes usually means an ERC-1271 / ERC-6492 smart-contract-wallet");
            println!("   signature (Safe, Coinbase Smart Wallet, Argent, ZeroDev, …).");
            println!(
                "   Those cannot be ecrecover'd; they need an on-chain isValidSignature call."
            );
        }
        return;
    }

    let v = bytes[64];
    let r = &bytes[0..32];
    let s = &bytes[32..64];
    println!("v byte    : {v} (0x{v:02x})");
    println!("r         : 0x{}", hex::encode(r));
    println!("s         : 0x{}", hex::encode(s));

    // secp256k1 n/2 — signatures with s above this are "high-s" (malleable form).
    const HALF_N: [u8; 32] = [
        0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b,
        0x20, 0xa0,
    ];
    if s > &HALF_N[..] {
        println!("!! high-s signature (s > n/2) — non-canonical; some libs reject it.");
    }

    let known_v = matches!(v, 0 | 1 | 27 | 28);
    if !known_v {
        println!("!! v is not 0/1/27/28 -> production code bails before recovery.");
        if v >= 35 {
            let chain = (v as u64 - 35) / 2;
            println!("   v>=35 looks EIP-155 encoded; implied chain id ≈ {chain}.");
        }
    }

    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
    let hash = keccak256(prefixed.as_bytes());
    println!("eip191 digest: 0x{}", hex::encode(hash));
    println!();

    println!("-- recovery against the exact message --");
    for parity in [false, true] {
        let sig = PrimitiveSignature::from_bytes_and_parity(&bytes[..64], parity);
        match sig.recover_address_from_prehash(&hash) {
            Ok(a) => println!(
                "   parity={parity:<5} -> {a}  {}",
                if a == expected { "*** MATCH ***" } else { "" }
            ),
            Err(e) => println!("   parity={parity:<5} -> recovery error: {e}"),
        }
    }

    println!();
    println!("-- recovery against message variants (byte-drift probes) --");
    for (label, cand) in message_variants(message) {
        if cand == message {
            continue; // identical to the exact-message probe above
        }
        let p = format!("\x19Ethereum Signed Message:\n{}{}", cand.len(), cand);
        let h = keccak256(p.as_bytes());
        for parity in [false, true] {
            let sig = PrimitiveSignature::from_bytes_and_parity(&bytes[..64], parity);
            if let Ok(a) = sig.recover_address_from_prehash(&h) {
                if a == expected {
                    println!("   *** MATCH *** variant={label} parity={parity}");
                }
            }
        }
    }

    // Raw (unprefixed) keccak — wallets using eth_sign / signTypedData paths.
    let raw_hash = keccak256(message.as_bytes());
    for parity in [false, true] {
        let sig = PrimitiveSignature::from_bytes_and_parity(&bytes[..64], parity);
        if let Ok(a) = sig.recover_address_from_prehash(&raw_hash) {
            if a == expected {
                println!(
                    "   *** MATCH *** raw keccak256(message), NO EIP-191 prefix, parity={parity}"
                );
            }
        }
    }
    println!("   (no further MATCH lines above => the signature is not from this EOA key)");
}

fn message_variants(m: &str) -> Vec<(String, String)> {
    let mut v = vec![
        ("trimmed".into(), m.trim().to_string()),
        ("trailing-newline".into(), format!("{m}\n")),
        ("crlf".into(), m.replace('\n', "\r\n")),
        ("json-escaped-newlines".into(), m.replace('\n', "\\n")),
        ("lowercased".into(), m.to_lowercase()),
        ("nbsp->space".into(), m.replace('\u{a0}', " ")),
        (
            "collapsed-spaces".into(),
            m.split_whitespace().collect::<Vec<_>>().join(" "),
        ),
    ];
    // Address inside the message re-cased: EVM checksum vs lowercase.
    if let Some(start) = m.find("0x") {
        let end = m[start..]
            .char_indices()
            .find(|(_, c)| !c.is_ascii_alphanumeric())
            .map(|(i, _)| start + i)
            .unwrap_or(m.len());
        let found = &m[start..end];
        if found.len() == 42 {
            if let Ok(a) = found.parse::<Address>() {
                v.push(("addr-checksummed".into(), m.replace(found, &a.to_string())));
                v.push((
                    "addr-lowercased".into(),
                    m.replace(found, &found.to_lowercase()),
                ));
            }
        }
    }
    v
}

// ── Stellar ──────────────────────────────────────────────────────────────────

fn stellar(address: &str, signature: &str, message: &str) {
    let pubkey = match stellar_strkey::ed25519::PublicKey::from_string(address) {
        Ok(p) => p,
        Err(e) => return println!("!! not a valid Stellar G… strkey: {e}"),
    };
    let vk = match VerifyingKey::from_bytes(&pubkey.0) {
        Ok(k) => k,
        Err(e) => return println!("!! not a valid ed25519 public key: {e}"),
    };
    println!("pubkey hex: {}", hex::encode(pubkey.0));

    let sig_bytes = decode_sig(signature);
    let Some((how, bytes)) = sig_bytes else {
        return println!("!! signature decodes as neither base64, base64url, nor hex to 64 bytes");
    };
    println!("sig decode: {how} ({} bytes)", bytes.len());
    if bytes.len() != 64 {
        return println!("!! ed25519 signatures must be 64 bytes -> rejected.");
    }
    let sig = Signature::from_bytes(&<[u8; 64]>::try_from(bytes.as_slice()).unwrap());
    let prod_ok = base64::engine::general_purpose::STANDARD
        .decode(signature.trim())
        .ok()
        .and_then(|b| <[u8; 64]>::try_from(b.as_slice()).ok())
        .is_some()
        || hex::decode(
            signature
                .trim()
                .strip_prefix("0x")
                .unwrap_or(signature.trim()),
        )
        .ok()
        .map(|b| b.len() == 64)
        .unwrap_or(false);
    if !prod_ok {
        println!("!! production decoder (STANDARD base64, then hex) would NOT accept this form.");
    }
    println!();

    println!("-- payload probes --");
    for (label, payload) in stellar_payloads(message) {
        let ok = vk.verify(&payload, &sig).is_ok();
        println!(
            "   {:<42} {}",
            label,
            if ok { "*** MATCH ***" } else { "no" }
        );
    }
    println!("   (production verifies only: sha256(\"Stellar Signed Message:\\n\" || msg))");
}

fn decode_sig(s: &str) -> Option<(&'static str, Vec<u8>)> {
    let t = s.trim();
    if let Ok(b) = base64::engine::general_purpose::STANDARD.decode(t) {
        if b.len() == 64 {
            return Some(("base64 standard", b));
        }
    }
    if let Ok(b) = base64::engine::general_purpose::URL_SAFE.decode(t) {
        if b.len() == 64 {
            return Some(("base64 URL-SAFE (production would reject!)", b));
        }
    }
    if let Ok(b) = base64::engine::general_purpose::STANDARD_NO_PAD.decode(t) {
        if b.len() == 64 {
            return Some(("base64 unpadded (production would reject!)", b));
        }
    }
    if let Ok(b) = hex::decode(t.strip_prefix("0x").unwrap_or(t)) {
        return Some(("hex", b));
    }
    None
}

fn stellar_payloads(m: &str) -> Vec<(String, Vec<u8>)> {
    let prefix = b"Stellar Signed Message:\n";
    let sha = |b: &[u8]| Sha256::digest(b).to_vec();
    let mut pre = prefix.to_vec();
    pre.extend_from_slice(m.as_bytes());

    let mut out = vec![
        (
            "sha256(prefix||msg)  [SEP-53, production]".to_string(),
            sha(&pre),
        ),
        ("raw prefix||msg (unhashed)".to_string(), pre.clone()),
        (
            "raw message bytes (no prefix, no hash)".to_string(),
            m.as_bytes().to_vec(),
        ),
        (
            "sha256(msg) (prefix omitted)".to_string(),
            sha(m.as_bytes()),
        ),
        (
            "sha256(sha256(prefix||msg)) (double hash)".to_string(),
            sha(&sha(&pre)),
        ),
    ];
    // base64-of-message variants: some wallets sign the base64 text they were handed.
    let b64 = base64::engine::general_purpose::STANDARD.encode(m.as_bytes());
    let mut pre_b64 = prefix.to_vec();
    pre_b64.extend_from_slice(b64.as_bytes());
    out.push(("sha256(prefix||base64(msg))".into(), sha(&pre_b64)));
    // whitespace drift
    for (label, cand) in [
        ("trimmed", m.trim().to_string()),
        ("trailing-newline", format!("{m}\n")),
    ] {
        let mut p = prefix.to_vec();
        p.extend_from_slice(cand.as_bytes());
        out.push((format!("sha256(prefix||msg) [{label}]"), sha(&p)));
    }
    out
}
