// spec: docs/product-specs/api-authorization.md
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use chrono::{DateTime, Duration, TimeZone, Utc};
use ed25519_dalek::{Signer, SigningKey};
use pipeline_api::routes::auth::wallet::{
    challenge_domain, challenge_message, reuse_or_rotate, within_challenge_limit, NonceDecision,
    CHALLENGE_TTL_SECS, MAX_CHALLENGES_PER_IP,
};
use sha2::{Digest, Sha256};
use shared::auth_user_repo::{CONSUME_NONCE_SQL, ISSUE_NONCE_SQL};
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

#[test]
fn live_nonce_is_reused() {
    assert_eq!(
        reuse_or_rotate(Some("n"), Some(t(60)), t(0)),
        NonceDecision::Reuse {
            nonce: "n".to_owned(),
            expires_at: t(60)
        }
    );
}

#[test]
fn expired_missing_or_legacy_nonce_rotates() {
    assert_eq!(
        reuse_or_rotate(Some("n"), Some(t(0)), t(0)),
        NonceDecision::Rotate
    );
    assert_eq!(
        reuse_or_rotate(Some("n"), Some(t(-1)), t(0)),
        NonceDecision::Rotate
    );
    assert_eq!(reuse_or_rotate(None, None, t(0)), NonceDecision::Rotate);
    assert_eq!(
        reuse_or_rotate(Some("n"), None, t(0)),
        NonceDecision::Rotate
    );
    assert_eq!(
        reuse_or_rotate(None, Some(t(60)), t(0)),
        NonceDecision::Rotate
    );
}

#[test]
fn challenge_limit_is_inclusive() {
    assert!(within_challenge_limit(MAX_CHALLENGES_PER_IP));
    assert!(!within_challenge_limit(MAX_CHALLENGES_PER_IP + 1));
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
fn issue_only_overwrites_a_dead_nonce() {
    let sql = squash(ISSUE_NONCE_SQL);
    assert!(
        sql.contains("(nonce IS NULL OR nonce_expires_at IS NULL OR nonce_expires_at <= now())")
    );
    assert!(sql.contains("RETURNING nonce_expires_at"));
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
