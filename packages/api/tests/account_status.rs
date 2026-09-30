// spec: docs/product-specs/api-authorization.md#security

use axum::http::StatusCode;
use axum::response::IntoResponse;
use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use pipeline_api::account_status::{
    gate_request, gate_token_issue, RequestRefusal, TokenRefusal, ACCOUNT_SUSPENDED,
};
use pipeline_api::auth::TRUSTEE_ROLE;
use pipeline_api::error::ApiError;
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

// ── gate_request (the extractor's decision) ─────────────────────────────────────

#[test]
fn an_active_account_may_act() {
    assert_eq!(gate_request(Some("Active")), None);
}

#[test]
fn a_suspended_account_is_refused() {
    assert_eq!(
        gate_request(Some("Suspended")),
        Some(RequestRefusal::Suspended)
    );
}

#[test]
fn an_unrecognised_status_is_refused() {
    for status in ["Frozen", "active", ""] {
        assert_eq!(
            gate_request(Some(status)),
            Some(RequestRefusal::Suspended),
            "status {status:?} must fail closed"
        );
    }
}

#[test]
fn a_token_naming_no_account_is_refused() {
    assert_eq!(gate_request(None), Some(RequestRefusal::UnknownAccount));
}

// ── gate_token_issue (both mint paths) ───────────────────────────────────────────

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
        Some(TokenRefusal::Suspended)
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

// ── Refusal → HTTP mapping ───────────────────────────────────────────────────────

#[test]
fn a_suspended_request_is_a_403() {
    match ApiError::from(RequestRefusal::Suspended) {
        ApiError::Forbidden(msg) => assert_eq!(msg, ACCOUNT_SUSPENDED),
        other => panic!("expected Forbidden, got {other:?}"),
    }
    let response = ApiError::from(RequestRefusal::Suspended).into_response();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[test]
fn an_unknown_account_is_a_401() {
    match ApiError::from(RequestRefusal::UnknownAccount) {
        ApiError::Unauthorized(_) => {}
        other => panic!("expected Unauthorized, got {other:?}"),
    }
    let response = ApiError::from(RequestRefusal::UnknownAccount).into_response();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[test]
fn suspension_is_distinguishable_from_a_role_refusal() {
    let role_refusal =
        ApiError::Forbidden(format!("this endpoint requires the `{TRUSTEE_ROLE}` role"));
    let suspension = ApiError::from(RequestRefusal::Suspended);
    let (ApiError::Forbidden(role_msg), ApiError::Forbidden(suspension_msg)) =
        (role_refusal, suspension)
    else {
        panic!("expected both refusals to be Forbidden");
    };
    assert_ne!(role_msg, suspension_msg);
    assert_eq!(suspension_msg, ACCOUNT_SUSPENDED);
}

#[test]
fn the_suspended_code_is_the_stable_wire_contract() {
    assert_eq!(ACCOUNT_SUSPENDED, "account_suspended");
}
