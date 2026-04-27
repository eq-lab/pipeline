use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[test]
fn hmac_signature_matches_expected() {
    let secret = "test-secret-key";
    let ts = 1714000000u64;
    let method = "POST";
    let path = "/resources/applicants?levelName=basic-kyc";
    let body = r#"{"externalUserId":"0xABCDEF"}"#;

    let data = format!("{ts}{method}{path}{body}");

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(data.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());

    assert_eq!(signature.len(), 64);
    assert!(signature.chars().all(|c| c.is_ascii_hexdigit()));

    let mut mac2 = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac2.update(data.as_bytes());
    let signature2 = hex::encode(mac2.finalize().into_bytes());
    assert_eq!(signature, signature2);
}

#[test]
fn hmac_signature_differs_with_different_secret() {
    let data = "1714000000POST/resources/applicants";

    let mut mac1 = HmacSha256::new_from_slice(b"secret-a").unwrap();
    mac1.update(data.as_bytes());
    let sig1 = hex::encode(mac1.finalize().into_bytes());

    let mut mac2 = HmacSha256::new_from_slice(b"secret-b").unwrap();
    mac2.update(data.as_bytes());
    let sig2 = hex::encode(mac2.finalize().into_bytes());

    assert_ne!(sig1, sig2);
}
