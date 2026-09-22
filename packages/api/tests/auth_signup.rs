//! Unit tests for the pure decisions behind LP self-serve signup
//! (`POST /v1/auth/signup`, `/verify-otp`, `/resend-otp`, `/login`).
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests —
//! no `DATABASE_URL` / Postgres connection, no network. Account rows are built as
//! fixtures and times supplied explicitly, so nothing here touches the wall clock.

use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use pipeline_api::routes::auth::password::{
    classify_signup, gate_token_issue, normalize_email, within_login_limit, SignupOutcome,
    TokenRefusal, LOGIN_ATTEMPT_WINDOW_SECS, MAX_LOGIN_ATTEMPTS,
};
use shared::account_repo::Account;

// ── Fixtures ───────────────────────────────────────────────────────────────────

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 22, 12, 0, 0).unwrap()
}

fn account(email_verified_at: Option<DateTime<Utc>>) -> Account {
    Account {
        id: Uuid::parse_str("11111111-2222-3333-4444-555555555555").unwrap(),
        email: Some("lp@corp.test".to_owned()),
        password_hash: Some("$argon2id$fixture".to_owned()),
        email_verified_at,
        last_duplicate_notice_at: None,
        status: "Active".to_owned(),
        created_at: now(),
        updated_at: now(),
    }
}

fn suspended(email_verified_at: Option<DateTime<Utc>>) -> Account {
    Account {
        status: "Suspended".to_owned(),
        ..account(email_verified_at)
    }
}

// ── Email normalization ────────────────────────────────────────────────────────

#[test]
fn lowercases_and_trims_an_email() {
    assert_eq!(
        normalize_email("  LP@Corp.Test \n").unwrap(),
        "lp@corp.test"
    );
}

#[test]
fn rejects_an_email_with_no_at_sign() {
    assert!(normalize_email("lpcorp.test").is_err());
}

#[test]
fn rejects_an_email_whose_domain_has_no_dot() {
    assert!(normalize_email("lp@corp").is_err());
}

#[test]
fn rejects_an_email_containing_whitespace() {
    assert!(normalize_email("l p@corp.test").is_err());
}

#[test]
fn rejects_an_empty_email() {
    assert!(normalize_email("   ").is_err());
}

#[test]
fn rejects_an_email_with_two_at_signs() {
    assert!(normalize_email("lp@corp@test.com").is_err());
}

// ── Signup classification ──────────────────────────────────────────────────────

#[test]
fn an_unknown_address_creates_an_account() {
    assert_eq!(classify_signup(None), SignupOutcome::Create);
}

#[test]
fn an_unverified_address_gets_a_fresh_passcode_rather_than_a_second_account() {
    assert_eq!(
        classify_signup(Some(&account(None))),
        SignupOutcome::ReissuePasscode
    );
}

#[test]
fn a_verified_address_notifies_its_owner_and_creates_nothing() {
    assert_eq!(
        classify_signup(Some(&account(Some(now())))),
        SignupOutcome::NotifyExistingOwner
    );
}

// ── Token-issue gate ───────────────────────────────────────────────────────────

#[test]
fn issues_a_token_to_an_active_verified_account() {
    assert_eq!(gate_token_issue(&account(Some(now())), true), None);
}

#[test]
fn refuses_a_token_to_a_suspended_account_on_login() {
    assert_eq!(
        gate_token_issue(&suspended(Some(now())), true),
        Some(TokenRefusal::Suspended)
    );
}

#[test]
fn refuses_a_token_to_a_suspended_account_on_otp_verification() {
    assert_eq!(
        gate_token_issue(&suspended(None), false),
        Some(TokenRefusal::Suspended),
        "verifying a passcode must not hand a token to a suspended account"
    );
}

#[test]
fn refuses_a_token_to_an_unverified_account_on_login() {
    assert_eq!(
        gate_token_issue(&account(None), true),
        Some(TokenRefusal::EmailNotVerified)
    );
}

#[test]
fn allows_an_unverified_account_through_the_otp_path_that_verifies_it() {
    assert_eq!(gate_token_issue(&account(None), false), None);
}

// ── Login rate limit ───────────────────────────────────────────────────────────

#[test]
fn allows_three_login_attempts_per_window() {
    assert_eq!(MAX_LOGIN_ATTEMPTS, 3);
    assert_eq!(LOGIN_ATTEMPT_WINDOW_SECS, 60);
    for nth in 1..=3 {
        assert!(
            within_login_limit(nth),
            "attempt {nth} of 3 must be allowed"
        );
    }
}

#[test]
fn refuses_the_fourth_login_attempt_in_a_window() {
    assert!(!within_login_limit(4));
    assert!(!within_login_limit(99));
}
