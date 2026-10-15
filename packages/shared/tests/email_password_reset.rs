// spec: docs/product-specs/api-authorization-password-reset.md

use shared::email::{render_password_changed_email, render_password_reset_email};

const TO: &str = "owner@acme.example";
const LINK: &str = "https://app.pipeline.one/reset-password#token=abc123";

#[test]
fn reset_email_goes_to_the_requester_and_carries_the_link_on_its_own_line() {
    let email = render_password_reset_email(TO, LINK, 30);
    assert_eq!(email.to, TO);
    assert!(!email.subject.is_empty());
    assert!(
        email.body.contains(&format!("\n\n{LINK}\n\n")),
        "got {:?}",
        email.body
    );
}

#[test]
fn reset_email_states_the_configured_lifetime() {
    let email = render_password_reset_email(TO, LINK, 45);
    assert!(email.body.contains("45 minutes"), "got {:?}", email.body);
}

#[test]
fn reset_email_says_minute_not_minutes_for_a_one_minute_link() {
    let email = render_password_reset_email(TO, LINK, 1);
    assert!(email.body.contains("1 minute "), "got {:?}", email.body);
    assert!(!email.body.contains("1 minutes"), "got {:?}", email.body);
}

#[test]
fn reset_email_reassures_someone_who_did_not_ask() {
    let email = render_password_reset_email(TO, LINK, 30);
    assert!(
        email.body.contains("your password has not changed"),
        "got {:?}",
        email.body
    );
}

#[test]
fn changed_email_goes_to_the_owner_and_says_sessions_ended() {
    let email = render_password_changed_email(TO);
    assert_eq!(email.to, TO);
    assert!(!email.subject.is_empty());
    assert!(email.body.contains("signed out"), "got {:?}", email.body);
}

#[test]
fn changed_email_carries_no_link() {
    let email = render_password_changed_email(TO);
    assert!(!email.body.contains("http"), "got {:?}", email.body);
}
