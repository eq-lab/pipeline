// spec: docs/product-specs/api-authorization-password-reset.md

use std::collections::HashMap;

use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use pipeline_api::password_reset::{
    generate_reset_token, hash_reset_token, is_well_formed_reset_token, may_reset_password,
    within_reset_request_limit, PasswordResetConfig, DEFAULT_PASSWORD_RESET_TTL_MINUTES,
    DEV_APP_BASE_URL, MAX_PASSWORD_RESET_TTL_MINUTES, MAX_RESET_REQUESTS_PER_IP,
    PASSWORD_RESET_COOLDOWN_SECS, RESET_TOKEN_BYTES,
};
use shared::account_repo::Account;

// ── Fixtures ───────────────────────────────────────────────────────────────────

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 14, 12, 0, 0).unwrap()
}

fn account() -> Account {
    Account {
        id: Uuid::parse_str("11111111-2222-3333-4444-555555555555").unwrap(),
        email: Some("lp@corp.test".to_owned()),
        password_hash: Some("$argon2id$fixture".to_owned()),
        email_verified_at: Some(now()),
        last_duplicate_notice_at: None,
        status: "Active".to_owned(),
        created_at: now(),
        updated_at: now(),
    }
}

fn config(vars: &[(&str, &str)], dev_log: bool) -> anyhow::Result<PasswordResetConfig> {
    let vars: HashMap<String, String> = vars
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect();
    PasswordResetConfig::from_lookup(|key| vars.get(key).cloned(), dev_log)
}

// ── Token ──────────────────────────────────────────────────────────────────────

#[test]
fn a_token_is_32_random_bytes_as_lowercase_hex() {
    let token = generate_reset_token();
    assert_eq!(token.len(), RESET_TOKEN_BYTES * 2);
    assert!(token
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    assert!(is_well_formed_reset_token(&token));
}

#[test]
fn two_tokens_differ() {
    assert_ne!(generate_reset_token(), generate_reset_token());
}

#[test]
fn the_stored_hash_is_sha256_of_the_token_and_never_the_token_itself() {
    let token = "00".repeat(RESET_TOKEN_BYTES);
    let hash = hash_reset_token(&token);
    assert_eq!(hash, hash_reset_token(&token));
    assert_ne!(hash, token);
    assert_eq!(
        hash_reset_token("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn malformed_tokens_are_rejected_before_any_lookup() {
    for token in [
        "",
        "abc",
        &"0".repeat(RESET_TOKEN_BYTES * 2 - 1),
        &"0".repeat(RESET_TOKEN_BYTES * 2 + 1),
        &format!("{}g", "0".repeat(RESET_TOKEN_BYTES * 2 - 1)),
    ] {
        assert!(!is_well_formed_reset_token(token), "{token:?} accepted");
    }
}

// ── Eligibility ────────────────────────────────────────────────────────────────

#[test]
fn a_verified_active_account_may_reset() {
    assert!(may_reset_password(&account()));
}

#[test]
fn an_unverified_account_may_not_reset() {
    let unverified = Account {
        email_verified_at: None,
        ..account()
    };
    assert!(!may_reset_password(&unverified));
}

#[test]
fn a_suspended_account_may_not_reset() {
    let suspended = Account {
        status: "Suspended".to_owned(),
        ..account()
    };
    assert!(!may_reset_password(&suspended));
}

#[test]
fn a_wallet_only_account_may_not_reset() {
    let wallet_only = Account {
        email: None,
        password_hash: None,
        ..account()
    };
    assert!(!may_reset_password(&wallet_only));
}

// ── Per-client limit ───────────────────────────────────────────────────────────

#[test]
fn requests_up_to_the_per_client_limit_are_allowed() {
    assert!(within_reset_request_limit(1));
    assert!(within_reset_request_limit(MAX_RESET_REQUESTS_PER_IP));
}

#[test]
fn the_request_past_the_per_client_limit_is_refused() {
    assert!(!within_reset_request_limit(MAX_RESET_REQUESTS_PER_IP + 1));
}

// ── Config ─────────────────────────────────────────────────────────────────────

#[test]
fn app_base_url_is_required_when_email_is_really_sent() {
    let err = config(&[], false).unwrap_err().to_string();
    assert!(err.contains("APP_BASE_URL"), "got {err}");
}

#[test]
fn a_blank_app_base_url_counts_as_unset() {
    assert!(config(&[("APP_BASE_URL", "  ")], false).is_err());
}

#[test]
fn dev_log_mode_falls_back_to_the_local_frontend() {
    let cfg = config(&[], true).unwrap();
    assert_eq!(cfg.app_base_url, DEV_APP_BASE_URL);
}

#[test]
fn an_explicit_app_base_url_wins_in_dev_log_mode() {
    let cfg = config(&[("APP_BASE_URL", "https://staging.pipeline.one")], true).unwrap();
    assert_eq!(cfg.app_base_url, "https://staging.pipeline.one");
}

#[test]
fn trailing_slashes_and_whitespace_are_trimmed_from_the_base_url() {
    let cfg = config(&[("APP_BASE_URL", " https://app.pipeline.one/ ")], false).unwrap();
    assert_eq!(cfg.app_base_url, "https://app.pipeline.one");
}

#[test]
fn a_base_url_with_a_path_prefix_is_kept() {
    let cfg = config(&[("APP_BASE_URL", "https://pipeline.one/app/")], false).unwrap();
    assert_eq!(
        cfg.link("t0ken"),
        "https://pipeline.one/app/reset-password#token=t0ken"
    );
}

#[test]
fn a_base_url_that_is_not_http_is_rejected() {
    for raw in ["app.pipeline.one", "ftp://app.pipeline.one", "javascript:alert(1)"] {
        assert!(
            config(&[("APP_BASE_URL", raw)], false).is_err(),
            "{raw} accepted"
        );
    }
}

#[test]
fn a_base_url_carrying_a_query_or_fragment_is_rejected() {
    for raw in ["https://app.pipeline.one/?x=1", "https://app.pipeline.one/#x"] {
        assert!(
            config(&[("APP_BASE_URL", raw)], false).is_err(),
            "{raw} accepted"
        );
    }
}

#[test]
fn the_link_carries_the_token_in_the_fragment() {
    let cfg = config(&[("APP_BASE_URL", "https://app.pipeline.one")], false).unwrap();
    assert_eq!(
        cfg.link("abc123"),
        "https://app.pipeline.one/reset-password#token=abc123"
    );
}

#[test]
fn ttl_defaults_to_thirty_minutes() {
    let cfg = config(&[], true).unwrap();
    assert_eq!(cfg.ttl_minutes, DEFAULT_PASSWORD_RESET_TTL_MINUTES);
    assert_eq!(DEFAULT_PASSWORD_RESET_TTL_MINUTES, 30);
    assert_eq!(cfg.ttl_secs(), 30 * 60);
}

#[test]
fn ttl_is_read_from_the_environment() {
    let cfg = config(&[("PASSWORD_RESET_TTL_MINUTES", " 15 ")], true).unwrap();
    assert_eq!(cfg.ttl_minutes, 15);
    assert_eq!(cfg.ttl_secs(), 15 * 60);
}

#[test]
fn a_blank_ttl_falls_back_to_the_default() {
    let cfg = config(&[("PASSWORD_RESET_TTL_MINUTES", "")], true).unwrap();
    assert_eq!(cfg.ttl_minutes, DEFAULT_PASSWORD_RESET_TTL_MINUTES);
}

#[test]
fn a_ttl_outside_the_allowed_range_is_rejected() {
    let too_long = (MAX_PASSWORD_RESET_TTL_MINUTES + 1).to_string();
    for raw in ["0", too_long.as_str(), "-5", "thirty", "1.5"] {
        assert!(
            config(&[("PASSWORD_RESET_TTL_MINUTES", raw)], true).is_err(),
            "{raw} accepted"
        );
    }
}

#[test]
fn the_shortest_allowed_ttl_still_outlives_the_resend_cooldown() {
    let cfg = config(&[("PASSWORD_RESET_TTL_MINUTES", "1")], true).unwrap();
    assert!(cfg.ttl_secs() >= PASSWORD_RESET_COOLDOWN_SECS);
}
