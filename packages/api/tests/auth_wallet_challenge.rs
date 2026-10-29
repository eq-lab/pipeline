// spec: docs/product-specs/api-authorization.md
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use chrono::{DateTime, Duration, TimeZone, Utc};
use ed25519_dalek::{Signer, SigningKey};
use pipeline_api::routes::auth::wallet::{challenge_domain, challenge_message, CHALLENGE_TTL_SECS};
use sha2::{Digest, Sha256};
use shared::auth_user_repo::{
    CONSUME_NONCE_SQL, ISSUE_OR_REUSE_NONCE_SQL, NONCE_REUSE_MIN_REMAINING_SECS,
};
use shared::signature::{verify_personal_sign, verify_stellar_personal_sign};

fn t(secs: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(1_800_000_000 + secs, 0).unwrap()
}

fn message(expires_at: DateTime<Utc>) -> String {
    challenge_message("app.pipeline.one", "0xabc", 560_048, "n-1", expires_at)
}

#[test]
fn message_carries_every_siwe_field() {
    let m = message(t(300));
    assert!(m.starts_with("app.pipeline.one wants you to sign in with your wallet:\n0xabc\n"));
    assert!(m.contains("\nChain ID: 560048\n"));
    assert!(m.contains("\nNonce: n-1\n"));
    assert!(m.contains("\nIssued At: 2027-01-15T08:00:00Z\n"));
    assert!(m.ends_with("\nExpiration Time: 2027-01-15T08:05:00Z"));
}

#[test]
fn issued_at_is_expiry_minus_ttl() {
    assert_eq!(CHALLENGE_TTL_SECS, 300);
    let expires = t(900);
    let issued = (expires - Duration::seconds(CHALLENGE_TTL_SECS)).to_rfc3339();
    assert!(message(expires).contains(&issued.replace("+00:00", "Z")));
}

#[test]
fn message_is_deterministic_for_the_same_stored_row() {
    assert_eq!(message(t(300)), message(t(300)));
    assert_ne!(message(t(300)), message(t(301)));
}

#[test]
fn message_changes_with_every_bound_field() {
    let base = message(t(300));
    assert_ne!(
        base,
        challenge_message("other.example", "0xabc", 560_048, "n-1", t(300))
    );
    assert_ne!(
        base,
        challenge_message("app.pipeline.one", "0xabd", 560_048, "n-1", t(300))
    );
    assert_ne!(
        base,
        challenge_message("app.pipeline.one", "0xabc", 1, "n-1", t(300))
    );
    assert_ne!(
        base,
        challenge_message("app.pipeline.one", "0xabc", 560_048, "n-2", t(300))
    );
}

#[test]
fn domain_is_the_host_of_app_base_url() {
    assert_eq!(
        challenge_domain("https://app.pipeline.one"),
        "app.pipeline.one"
    );
    assert_eq!(challenge_domain("https://pipeline.one/app"), "pipeline.one");
    assert_eq!(challenge_domain("http://localhost:5173"), "localhost:5173");
}

fn squash(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn consume_is_one_atomic_update_guarded_by_nonce_and_expiry() {
    let sql = squash(CONSUME_NONCE_SQL);
    assert!(sql.starts_with("UPDATE auth_users SET nonce = NULL, nonce_expires_at = NULL"));
    assert!(sql.contains(
        "WHERE chain_id = $1 AND address = $2 AND nonce = $3 AND nonce_expires_at > now()"
    ));
    assert!(sql.contains("RETURNING chain_id, address, account_id, roles, nonce"));
}

#[test]
fn upsert_is_one_statement_on_the_db_clock_with_a_60s_reuse_threshold() {
    assert_eq!(NONCE_REUSE_MIN_REMAINING_SECS, 60);
    let sql = squash(ISSUE_OR_REUSE_NONCE_SQL);
    assert!(sql.starts_with("UPDATE auth_users SET nonce = CASE WHEN nonce IS NOT NULL"));
    let reuse = "nonce_expires_at > now() + make_interval(secs => $5::double precision)";
    assert_eq!(sql.matches(reuse).count(), 2);
    assert!(sql.contains("THEN nonce ELSE $3 END"));
    assert!(sql.contains(
        "THEN nonce_expires_at ELSE now() + make_interval(secs => $4::double precision) END"
    ));
    assert!(sql.contains("WHERE chain_id = $1 AND address = $2"));
    assert!(sql.ends_with("RETURNING nonce, nonce_expires_at"));
    assert!(!sql.contains("Utc"));
}

#[test]
fn evm_wallet_signature_over_the_new_message_verifies() {
    let signer: PrivateKeySigner =
        "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
            .parse()
            .unwrap();
    let address = format!("{}", signer.address()).to_lowercase();
    let m = challenge_message("app.pipeline.one", &address, 560_048, "n-1", t(300));
    let sig = hex::encode(signer.sign_message_sync(m.as_bytes()).unwrap().as_bytes());
    verify_personal_sign(&m, &sig, &address).unwrap();
    let rotated = challenge_message("app.pipeline.one", &address, 560_048, "n-2", t(300));
    assert!(verify_personal_sign(&rotated, &sig, &address).is_err());
}

#[test]
fn stellar_sep53_signature_over_the_new_multiline_message_verifies() {
    let key = SigningKey::from_bytes(&[7u8; 32]);
    let g = format!(
        "{}",
        stellar_strkey::ed25519::PublicKey(key.verifying_key().to_bytes())
    );
    let m = challenge_message("app.pipeline.one", &g, 99_000_001, "n-1", t(300));
    let mut h = Sha256::new();
    h.update(b"Stellar Signed Message:\n");
    h.update(m.as_bytes());
    let digest: [u8; 32] = h.finalize().into();
    let sig = hex::encode(key.sign(&digest).to_bytes());
    verify_stellar_personal_sign(&m, &sig, &g).unwrap();
}
