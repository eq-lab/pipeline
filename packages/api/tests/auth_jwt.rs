//! Unit tests for JWT issuance/verification.
//!
//! Pure crypto round-trips — no database, no network. A fixed ES256 test keypair
//! (PKCS#8 / SPKI PEM) drives the real `issue_token` → `decode_token` path via
//! `JwtKeys::from_pem`, avoiding any env mutation (which would race across the
//! parallel test threads in this binary). No real key material is involved.

use jsonwebtoken::{Algorithm, EncodingKey, Header};
use pipeline_api::auth::{Claims, JwtKeys, TOKEN_TTL_SECS};

const PRIVATE_PEM: &str = "-----BEGIN PRIVATE KEY-----\n\
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgi0+E/b6oW/STTwTb\n\
jb04zaaghgOSZwTMzEXQXtuPl12hRANCAAQULPAIPMi2yrYG3Rkc62xSYgZqLxjQ\n\
6HMgpgmI/dCxiqLLt7FaychCTbvEC31F2jniTmN/1l8EhPA2d/Dc/3Yy\n\
-----END PRIVATE KEY-----\n";

const PUBLIC_PEM: &str = "-----BEGIN PUBLIC KEY-----\n\
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEFCzwCDzItsq2Bt0ZHOtsUmIGai8Y\n\
0OhzIKYJiP3QsYqiy7exWsnIQk27xAt9Rdo54k5jf9ZfBITwNnfw3P92Mg==\n\
-----END PUBLIC KEY-----\n";

fn test_keys() -> JwtKeys {
    JwtKeys::from_pem(PRIVATE_PEM, PUBLIC_PEM).expect("test keys parse")
}

#[test]
fn issue_then_decode_round_trip() {
    let keys = test_keys();
    let roles = vec!["admin".to_owned(), "operator".to_owned()];
    let token = keys
        .issue_token("0xabc", 1, roles.clone())
        .expect("issue token");

    let claims = keys.decode_token(&token).expect("decode token");
    assert_eq!(claims.sub, "0xabc");
    assert_eq!(claims.chain_id, 1);
    assert_eq!(claims.roles, roles);
    assert_eq!(claims.exp as i64 - claims.iat as i64, TOKEN_TTL_SECS);
}

#[test]
fn decode_rejects_expired_token() {
    let keys = test_keys();
    // Hand-craft a token whose exp is in the past, signed with the same key.
    let encoding = EncodingKey::from_ec_pem(PRIVATE_PEM.as_bytes()).unwrap();
    let claims = Claims {
        sub: "0xabc".to_owned(),
        chain_id: 1,
        roles: vec![],
        iat: 1_000,
        exp: 2_000, // long in the past (1970)
    };
    let token = jsonwebtoken::encode(&Header::new(Algorithm::ES256), &claims, &encoding).unwrap();

    assert!(keys.decode_token(&token).is_err());
}

#[test]
fn decode_rejects_tampered_token() {
    let keys = test_keys();
    let token = keys.issue_token("0xabc", 1, vec![]).expect("issue token");
    // Flip a character in the signature segment.
    let mut bad = token.clone();
    let last = bad.pop().unwrap();
    bad.push(if last == 'a' { 'b' } else { 'a' });

    assert!(keys.decode_token(&bad).is_err());
}

#[test]
fn from_pem_rejects_garbage() {
    assert!(JwtKeys::from_pem("not a pem", PUBLIC_PEM).is_err());
    assert!(JwtKeys::from_pem(PRIVATE_PEM, "not a pem").is_err());
}
