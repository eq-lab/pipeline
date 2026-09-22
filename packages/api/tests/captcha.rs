//! Unit tests for the Turnstile captcha seam guarding `POST /v1/auth/signup` and
//! `POST /v1/auth/resend-otp`.
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests —
//! no `DATABASE_URL` / Postgres connection and no network: the HTTP call is split
//! from the decision so the decision can be exercised against fixture bodies.

use pipeline_api::captcha::{interpret_siteverify, CaptchaError, CaptchaVerifier, DisabledCaptcha};

#[test]
fn accepts_a_successful_siteverify_body() {
    let body =
        r#"{"success":true,"challenge_ts":"2026-09-22T12:00:00Z","hostname":"pipeline.test"}"#;
    assert!(interpret_siteverify(body).is_ok());
}

#[test]
fn rejects_a_failed_siteverify_body_and_keeps_its_error_codes() {
    let body = r#"{"success":false,"error-codes":["invalid-input-response"]}"#;
    match interpret_siteverify(body) {
        Err(CaptchaError::Rejected(codes)) => {
            assert_eq!(codes, vec!["invalid-input-response".to_owned()]);
        }
        other => panic!("expected Rejected with error codes, got {other:?}"),
    }
}

#[test]
fn rejects_a_failed_siteverify_body_that_omits_error_codes() {
    match interpret_siteverify(r#"{"success":false}"#) {
        Err(CaptchaError::Rejected(codes)) => assert!(codes.is_empty()),
        other => panic!("expected Rejected, got {other:?}"),
    }
}

#[test]
fn fails_closed_on_an_unparseable_siteverify_body() {
    match interpret_siteverify("<html>502 Bad Gateway</html>") {
        Err(CaptchaError::Unavailable(_)) => {}
        other => panic!("a garbled provider response must not pass, got {other:?}"),
    }
}

#[test]
fn fails_closed_on_a_body_missing_the_success_field() {
    match interpret_siteverify(r#"{"error-codes":["internal-error"]}"#) {
        Err(CaptchaError::Unavailable(_)) => {}
        other => panic!("a response without a verdict must not pass, got {other:?}"),
    }
}

#[tokio::test]
async fn the_disabled_verifier_accepts_any_token() {
    assert!(DisabledCaptcha.verify("anything", None).await.is_ok());
}
