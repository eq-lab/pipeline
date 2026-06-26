use alloy::primitives::{Address, PrimitiveSignature};
use anyhow::{bail, Context, Result};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

/// SEP-0053 domain-separation prefix. The signed payload is
/// `prefix || message`, hashed once with SHA-256; the resulting 32-byte digest
/// is what gets ed25519-signed. This is the scheme Freighter's `signMessage`
/// implements, so reproducing it byte-for-byte lets us verify wallet signatures.
const STELLAR_SIGNED_MESSAGE_PREFIX: &[u8] = b"Stellar Signed Message:\n";

/// Verifies an EIP-191 personal_sign signature.
///
/// Recovers the signer address from the message and signature,
/// then checks it matches the expected address (case-insensitive).
pub fn verify_personal_sign(
    message: &str,
    signature_hex: &str,
    expected_address: &str,
) -> Result<()> {
    let sig_bytes = hex::decode(signature_hex.strip_prefix("0x").unwrap_or(signature_hex))
        .context("invalid hex signature")?;

    if sig_bytes.len() != 65 {
        bail!("signature must be 65 bytes, got {}", sig_bytes.len());
    }

    // EIP-191: "\x19Ethereum Signed Message:\n" + len + message
    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
    let hash = alloy::primitives::keccak256(prefixed.as_bytes());

    // The recovery id (v) byte: 0/1 or 27/28 (legacy). Normalize to bool parity.
    let v = sig_bytes[64];
    let parity = match v {
        0 | 27 => false,
        1 | 28 => true,
        _ => bail!("invalid signature v byte: {v}"),
    };
    let sig = PrimitiveSignature::from_bytes_and_parity(&sig_bytes[..64], parity);

    let recovered = sig
        .recover_address_from_prehash(&hash)
        .context("failed to recover address from signature")?;

    let expected: Address = expected_address
        .parse()
        .context("invalid expected address")?;

    if recovered != expected {
        bail!("signature mismatch: recovered {recovered} but expected {expected}");
    }

    Ok(())
}

/// Compute the SEP-0053 message hash: `SHA256("Stellar Signed Message:\n" || message)`.
///
/// Single-round SHA-256 over the prefixed payload, matching the SEP-0053 spec and
/// Freighter's `signMessage`. The ed25519 signature is produced over (and verified
/// against) this 32-byte digest — not the raw message bytes.
fn stellar_message_hash(message: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(STELLAR_SIGNED_MESSAGE_PREFIX);
    hasher.update(message.as_bytes());
    hasher.finalize().into()
}

/// Decode a 64-byte ed25519 signature accepting either base64 (the Stellar-native
/// encoding — what Freighter / the SDKs emit) or hex (optional `0x` prefix).
///
/// base64 is tried first because it is what Stellar tooling produces; a hex string
/// is not valid standard base64 (its length and `0x`/odd-length forms fail to
/// decode to 64 bytes), so the hex fallback disambiguates cleanly.
fn decode_ed25519_signature(signature: &str) -> Result<[u8; 64]> {
    let trimmed = signature.trim();

    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(trimmed) {
        if let Ok(arr) = <[u8; 64]>::try_from(bytes.as_slice()) {
            return Ok(arr);
        }
    }

    let hex_bytes = hex::decode(trimmed.strip_prefix("0x").unwrap_or(trimmed))
        .context("signature is neither valid base64 nor hex")?;
    <[u8; 64]>::try_from(hex_bytes.as_slice())
        .map_err(|_| anyhow::anyhow!("signature must be 64 bytes, got {}", hex_bytes.len()))
}

/// Verifies a SEP-0053 message signature produced by a Stellar wallet
/// (e.g. Freighter's `signMessage`).
///
/// `g_address` is the signer's `G…` ed25519 public-key Strkey. `signature` is the
/// 64-byte ed25519 signature — **base64** (Stellar-native) or hex — over
/// `SHA256("Stellar Signed Message:\n" || message)`. Returns `Ok(())` iff the
/// signature is valid for `message` under `g_address`.
pub fn verify_stellar_personal_sign(message: &str, signature: &str, g_address: &str) -> Result<()> {
    let pubkey = stellar_strkey::ed25519::PublicKey::from_string(g_address)
        .map_err(|e| anyhow::anyhow!("invalid Stellar G… address: {e}"))?;
    let verifying_key =
        VerifyingKey::from_bytes(&pubkey.0).context("invalid ed25519 public key")?;

    let sig = Signature::from_bytes(&decode_ed25519_signature(signature)?);

    let hash = stellar_message_hash(message);
    verifying_key
        .verify(&hash, &sig)
        .context("Stellar signature verification failed")?;

    Ok(())
}
