use axum::http::{HeaderMap, StatusCode};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Validate Sumsub webhook headers against the request body.
///
/// SumSub signs webhooks with HMAC — the digest is in `x-payload-digest`
/// and the algorithm in `x-payload-digest-alg`.
pub fn validate_webhook(
    headers: &HeaderMap,
    body: &[u8],
    webhook_secret_key: &str,
) -> Result<(), (StatusCode, &'static str)> {
    let alg = headers
        .get("x-payload-digest-alg")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::BAD_REQUEST, "missing digest algorithm header"))?;

    if alg != "HMAC_SHA256_HEX" {
        return Err((StatusCode::BAD_REQUEST, "unsupported digest algorithm"));
    }

    let provided_digest = headers
        .get("x-payload-digest")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::BAD_REQUEST, "missing digest header"))?;

    let mut mac = HmacSha256::new_from_slice(webhook_secret_key.as_bytes())
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "hmac key error"))?;
    mac.update(body);
    let computed = hex::encode(mac.finalize().into_bytes());

    if computed != provided_digest {
        return Err((StatusCode::UNAUTHORIZED, "invalid digest"));
    }

    Ok(())
}
