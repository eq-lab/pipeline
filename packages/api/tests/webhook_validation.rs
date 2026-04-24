use axum::http::HeaderMap;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

fn validate_webhook(
    headers: &HeaderMap,
    body: &[u8],
    webhook_secret_key: &str,
    webhook_basic_token: &str,
) -> Result<(), &'static str> {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing authorization")?;

    if auth != format!("Basic {webhook_basic_token}") {
        return Err("invalid auth token");
    }

    let alg = headers
        .get("x-payload-digest-alg")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing alg")?;

    if alg != "HMAC_SHA256_HEX" {
        return Err("bad alg");
    }

    let provided = headers
        .get("x-payload-digest")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing digest")?;

    let mut mac =
        HmacSha256::new_from_slice(webhook_secret_key.as_bytes()).map_err(|_| "key error")?;
    mac.update(body);
    let computed = hex::encode(mac.finalize().into_bytes());

    if computed != provided {
        return Err("digest mismatch");
    }

    Ok(())
}

fn make_valid_headers(body: &[u8], secret: &str, token: &str) -> HeaderMap {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    let digest = hex::encode(mac.finalize().into_bytes());

    let mut headers = HeaderMap::new();
    headers.insert("authorization", format!("Basic {token}").parse().unwrap());
    headers.insert("x-payload-digest-alg", "HMAC_SHA256_HEX".parse().unwrap());
    headers.insert("x-payload-digest", digest.parse().unwrap());
    headers
}

#[test]
fn valid_webhook_passes() {
    let body = b"test payload";
    let secret = "webhook-secret";
    let token = "basic-token";
    let headers = make_valid_headers(body, secret, token);
    assert!(validate_webhook(&headers, body, secret, token).is_ok());
}

#[test]
fn wrong_basic_token_fails() {
    let body = b"test payload";
    let secret = "webhook-secret";
    let headers = make_valid_headers(body, secret, "correct-token");
    assert!(validate_webhook(&headers, body, secret, "wrong-token").is_err());
}

#[test]
fn tampered_body_fails() {
    let body = b"original payload";
    let secret = "webhook-secret";
    let token = "basic-token";
    let headers = make_valid_headers(body, secret, token);
    assert!(validate_webhook(&headers, b"tampered payload", secret, token).is_err());
}

#[test]
fn missing_headers_fail() {
    let headers = HeaderMap::new();
    assert!(validate_webhook(&headers, b"body", "secret", "token").is_err());
}
