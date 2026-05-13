use alloy::primitives::{Address, PrimitiveSignature};
use anyhow::{bail, Context, Result};

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
        _ => bail!("invalid signature v byte: {}", v),
    };
    let sig = PrimitiveSignature::from_bytes_and_parity(&sig_bytes[..64], parity);

    let recovered = sig
        .recover_address_from_prehash(&hash)
        .context("failed to recover address from signature")?;

    let expected: Address = expected_address
        .parse()
        .context("invalid expected address")?;

    if recovered != expected {
        bail!(
            "signature mismatch: recovered {} but expected {}",
            recovered,
            expected
        );
    }

    Ok(())
}
