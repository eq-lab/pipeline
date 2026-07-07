use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Sign an Elliptic request per the documented scheme:
/// `base64(HMAC_SHA256(base64_decode(secret), timestamp + METHOD + path.to_lowercase() + payload))`.
pub fn sign_request(
    secret_b64: &str,
    timestamp_ms: u64,
    method: &str,
    path: &str,
    payload: &str,
) -> Result<String> {
    let key = STANDARD
        .decode(secret_b64.trim())
        .context("ELLIPTIC_API_SECRET is not valid base64")?;

    let request_text = format!("{timestamp_ms}{method}{}{payload}", path.to_lowercase());

    let mut mac = HmacSha256::new_from_slice(&key).context("invalid HMAC key length")?;
    mac.update(request_text.as_bytes());
    Ok(STANDARD.encode(mac.finalize().into_bytes()))
}
