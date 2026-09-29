// spec: docs/product-specs/api-authorization-email.md#email-delivery, Issue #1368

use std::collections::HashMap;

use mockito::{Matcher, Server};

use shared::email::{
    render_duplicate_signup_email, render_verification_email, EmailConfig, SendGridEmailSender,
};

fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |key: &str| map.get(key).cloned()
}

#[test]
fn verification_payload_carries_recipient_sender_subject_and_body_verbatim() {
    let sender = SendGridEmailSender::new(
        "https://api.sendgrid.com",
        "test-key".to_owned(),
        "no-reply@pipeline.one".to_owned(),
    );
    let email = render_verification_email("lp@example.com", "482913");
    let payload = sender.payload(&email);

    assert_eq!(
        payload["personalizations"],
        serde_json::json!([{ "to": [{ "email": "lp@example.com" }] }])
    );
    assert_eq!(payload["from"]["email"], "no-reply@pipeline.one");
    assert_eq!(payload["subject"], email.subject);
    let content = payload["content"].as_array().expect("content array");
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"], "text/plain");
    assert_eq!(content[0]["value"], email.body);
    assert!(content[0]["value"].as_str().unwrap().contains("482913"));
}

#[test]
fn duplicate_signup_payload_has_the_same_envelope_shape() {
    let sender = SendGridEmailSender::new(
        "https://api.sendgrid.com",
        "test-key".to_owned(),
        "no-reply@pipeline.one".to_owned(),
    );
    let email = render_duplicate_signup_email("owner@example.com");
    let payload = sender.payload(&email);

    assert_eq!(
        payload["personalizations"],
        serde_json::json!([{ "to": [{ "email": "owner@example.com" }] }])
    );
    assert_eq!(payload["from"]["email"], "no-reply@pipeline.one");
    assert_eq!(payload["subject"], email.subject);
    let content = payload["content"].as_array().expect("content array");
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"], "text/plain");
    assert_eq!(content[0]["value"], email.body);
}

#[tokio::test]
async fn happy_path_sends_once_with_bearer_auth_and_json_content_type() {
    use shared::email::EmailSender;

    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/v3/mail/send")
        .match_header(
            "authorization",
            Matcher::Exact("Bearer test-key".to_owned()),
        )
        .match_header(
            "content-type",
            Matcher::Exact("application/json".to_owned()),
        )
        .with_status(202)
        .expect(1)
        .create_async()
        .await;

    let sender = SendGridEmailSender::new(
        &server.url(),
        "test-key".to_owned(),
        "no-reply@pipeline.one".to_owned(),
    );
    let email = render_verification_email("lp@example.com", "123456");
    sender
        .send(&email)
        .await
        .expect("send should succeed on 202");

    m.assert_async().await;
}

#[tokio::test]
async fn non_2xx_errors_without_leaking_the_passcode_or_the_api_key() {
    use shared::email::EmailSender;

    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/v3/mail/send")
        .with_status(403)
        .with_header("content-type", "application/json")
        .with_body(r#"{"errors":[{"message":"does not match a verified Sender Identity","field":"from","help":null}]}"#)
        .expect(1)
        .create_async()
        .await;

    let sender = SendGridEmailSender::new(
        &server.url(),
        "super-secret-key".to_owned(),
        "no-reply@pipeline.one".to_owned(),
    );
    let email = render_verification_email("lp@example.com", "999999");
    let err = sender.send(&email).await.expect_err("non-2xx must error");
    let text = format!("{err:#}");

    assert!(text.contains("403"));
    assert!(
        !text.contains("999999"),
        "error must not leak the passcode: {text}"
    );
    assert!(
        !text.contains(&email.body),
        "error must not leak the message body: {text}"
    );
    assert!(
        !text.contains("super-secret-key"),
        "error must not leak the API key: {text}"
    );

    m.assert_async().await;
}

#[tokio::test]
async fn base_url_with_trailing_slash_does_not_double_the_slash() {
    use shared::email::EmailSender;

    let mut server = Server::new_async().await;
    let m = server
        .mock("POST", "/v3/mail/send")
        .with_status(202)
        .expect(1)
        .create_async()
        .await;

    let base_url_with_slash = format!("{}/", server.url());
    let sender = SendGridEmailSender::new(
        &base_url_with_slash,
        "test-key".to_owned(),
        "no-reply@pipeline.one".to_owned(),
    );
    let email = render_verification_email("lp@example.com", "111222");
    sender
        .send(&email)
        .await
        .expect("send should succeed on 202");

    m.assert_async().await;
}

#[test]
fn dev_log_true_selects_dev_log_and_requires_no_sendgrid_var() {
    let get = lookup(&[("EMAIL_DEV_LOG", "true")]);
    assert!(matches!(
        EmailConfig::from_lookup(get).unwrap(),
        EmailConfig::DevLog
    ));

    let get = lookup(&[("EMAIL_DEV_LOG", "1")]);
    assert!(matches!(
        EmailConfig::from_lookup(get).unwrap(),
        EmailConfig::DevLog
    ));

    let get = lookup(&[("EMAIL_DEV_LOG", "YES")]);
    assert!(matches!(
        EmailConfig::from_lookup(get).unwrap(),
        EmailConfig::DevLog
    ));
}

#[test]
fn dev_log_false_does_not_select_dev_log() {
    let get = lookup(&[("EMAIL_DEV_LOG", "false")]);
    let err = EmailConfig::from_lookup(get).expect_err("false must fall through to required vars");
    assert!(format!("{err}").contains("SENDGRID_API_KEY"));
}

#[test]
fn missing_api_key_and_missing_dev_log_is_a_boot_error() {
    let get = lookup(&[]);
    let err = EmailConfig::from_lookup(get).expect_err("missing everything must error");
    assert!(format!("{err}").contains("SENDGRID_API_KEY"));
}

#[test]
fn blank_api_key_is_a_boot_error() {
    let get = lookup(&[
        ("SENDGRID_API_KEY", "   "),
        ("SENDGRID_FROM", "no-reply@pipeline.one"),
    ]);
    let err = EmailConfig::from_lookup(get).expect_err("whitespace-only key must error");
    assert!(format!("{err}").contains("SENDGRID_API_KEY"));
}

#[test]
fn missing_sendgrid_from_is_a_boot_error() {
    let get = lookup(&[("SENDGRID_API_KEY", "sg-key")]);
    let err = EmailConfig::from_lookup(get).expect_err("missing SENDGRID_FROM must error");
    assert!(format!("{err}").contains("SENDGRID_FROM"));
}

#[test]
fn key_and_from_with_no_base_url_defaults_to_the_public_sendgrid_endpoint() {
    let get = lookup(&[
        ("SENDGRID_API_KEY", "sg-key"),
        ("SENDGRID_FROM", "no-reply@pipeline.one"),
    ]);
    match EmailConfig::from_lookup(get).unwrap() {
        EmailConfig::SendGrid {
            api_key,
            from,
            base_url,
        } => {
            assert_eq!(api_key, "sg-key");
            assert_eq!(from, "no-reply@pipeline.one");
            assert_eq!(base_url, "https://api.sendgrid.com");
        }
        EmailConfig::DevLog => panic!("expected SendGrid config"),
    }
}

#[test]
fn explicit_base_url_is_honored_verbatim_for_eu_residency() {
    let get = lookup(&[
        ("SENDGRID_API_KEY", "sg-key"),
        ("SENDGRID_FROM", "no-reply@pipeline.one"),
        ("SENDGRID_BASE_URL", "https://api.eu.sendgrid.com"),
    ]);
    match EmailConfig::from_lookup(get).unwrap() {
        EmailConfig::SendGrid { base_url, .. } => {
            assert_eq!(base_url, "https://api.eu.sendgrid.com");
        }
        EmailConfig::DevLog => panic!("expected SendGrid config"),
    }
}

#[test]
fn surrounding_whitespace_is_stripped_from_every_value() {
    let get = lookup(&[
        ("SENDGRID_API_KEY", " SG.pasted-with-a-space\n"),
        ("SENDGRID_FROM", " no-reply@pipeline.one "),
        ("SENDGRID_BASE_URL", " https://api.eu.sendgrid.com/ "),
    ]);
    match EmailConfig::from_lookup(get).unwrap() {
        EmailConfig::SendGrid {
            api_key,
            from,
            base_url,
        } => {
            assert_eq!(api_key, "SG.pasted-with-a-space");
            assert_eq!(from, "no-reply@pipeline.one");
            assert_eq!(base_url, "https://api.eu.sendgrid.com");
        }
        EmailConfig::DevLog => panic!("expected SendGrid config"),
    }
}

#[test]
fn debug_formatting_redacts_the_api_key() {
    let get = lookup(&[
        ("SENDGRID_API_KEY", "SG.super-secret-key"),
        ("SENDGRID_FROM", "no-reply@pipeline.one"),
    ]);
    let rendered = format!("{:?}", EmailConfig::from_lookup(get).unwrap());
    assert!(
        !rendered.contains("SG.super-secret-key"),
        "Debug must not expose the API key: {rendered}"
    );
    assert!(rendered.contains("<redacted>"));
    assert!(rendered.contains("no-reply@pipeline.one"));
}
