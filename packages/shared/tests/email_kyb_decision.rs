// spec: docs/product-specs/kyb-lp-verification.md#review-notifications

use shared::email::{
    render_kyb_changes_requested_email, render_kyb_failed_email, render_kyb_passed_email,
    OutboundEmail, RejectedDocument,
};

const TO: &str = "owner@acme.example";
const LEGAL_NAME: &str = "Acme Capital Ltd";

fn doc<'a>(filename: &'a str, reason: Option<&'a str>) -> RejectedDocument<'a> {
    RejectedDocument { filename, reason }
}

fn assert_no_dangling_paragraph(email: &OutboundEmail) {
    let body = &email.body;
    assert!(
        !body.contains("\n\n\n"),
        "blank paragraph in body: {body:?}"
    );
    assert!(
        !body.starts_with('\n') && !body.ends_with('\n'),
        "body starts or ends with a blank line: {body:?}"
    );
    assert_eq!(body.trim(), body.as_str(), "untrimmed body: {body:?}");
}

fn position(body: &str, needle: &str) -> usize {
    body.find(needle)
        .unwrap_or_else(|| panic!("{needle:?} missing from {body:?}"))
}

// ── Passed ──────────────────────────────────────────────────────────────────

#[test]
fn passed_email_echoes_the_recipient_and_names_the_entity() {
    let email = render_kyb_passed_email(TO, LEGAL_NAME, None);
    assert_eq!(email.to, TO);
    assert!(!email.subject.is_empty());
    assert!(email.body.contains(LEGAL_NAME), "got {:?}", email.body);
}

#[test]
fn passed_email_carries_the_trustee_reason() {
    let reason = "Registry filing matched the uploaded certificate.";
    let email = render_kyb_passed_email(TO, LEGAL_NAME, Some(reason));
    assert!(email.body.contains(reason), "got {:?}", email.body);
    assert!(
        email.body.contains("has been approved"),
        "got {:?}",
        email.body
    );
    assert!(
        email.body.contains("Nothing further is needed from you."),
        "got {:?}",
        email.body
    );
    assert_no_dangling_paragraph(&email);
}

#[test]
fn passed_email_places_the_reason_before_the_closing_line() {
    let reason = "Registry filing matched the uploaded certificate.";
    let email = render_kyb_passed_email(TO, LEGAL_NAME, Some(reason));
    assert!(
        position(&email.body, reason)
            < position(&email.body, "Nothing further is needed from you."),
        "got {:?}",
        email.body
    );
}

#[test]
fn passed_email_without_a_reason_reads_as_finished_prose() {
    let email = render_kyb_passed_email(TO, LEGAL_NAME, None);
    assert!(
        email.body.contains("has been approved"),
        "got {:?}",
        email.body
    );
    assert!(
        email.body.contains("Nothing further is needed from you."),
        "got {:?}",
        email.body
    );
    assert_no_dangling_paragraph(&email);
}

#[test]
fn passed_email_treats_a_whitespace_only_reason_as_absent() {
    assert_eq!(
        render_kyb_passed_email(TO, LEGAL_NAME, Some("   \n\t ")),
        render_kyb_passed_email(TO, LEGAL_NAME, None)
    );
}

// ── ChangesRequested ────────────────────────────────────────────────────────

#[test]
fn changes_requested_email_carries_the_reason_and_the_rejected_document() {
    let rejected = [doc("certificate.pdf", Some("the scan is unreadable"))];
    let email = render_kyb_changes_requested_email(
        TO,
        LEGAL_NAME,
        Some("Two documents need replacing."),
        &rejected,
    );
    assert!(
        email.body.contains("Two documents need replacing."),
        "got {:?}",
        email.body
    );
    assert!(
        email.body.contains("certificate.pdf"),
        "got {:?}",
        email.body
    );
    assert!(
        email.body.contains("the scan is unreadable"),
        "got {:?}",
        email.body
    );
    assert_no_dangling_paragraph(&email);
}

#[test]
fn changes_requested_email_without_a_reason_still_lists_every_document() {
    let rejected = [
        doc("certificate.pdf", Some("the scan is unreadable")),
        doc("register.pdf", Some("issued more than a year ago")),
    ];
    let email = render_kyb_changes_requested_email(TO, LEGAL_NAME, None, &rejected);
    for entry in &rejected {
        assert!(email.body.contains(entry.filename), "got {:?}", email.body);
        assert!(
            email.body.contains(entry.reason.expect("a reason")),
            "got {:?}",
            email.body
        );
    }
    assert_no_dangling_paragraph(&email);
}

#[test]
fn changes_requested_email_with_no_documents_omits_the_replacement_list() {
    let email =
        render_kyb_changes_requested_email(TO, LEGAL_NAME, Some("Resubmit the profile."), &[]);
    assert!(
        email.body.contains("Resubmit the profile."),
        "got {:?}",
        email.body
    );
    assert!(
        !email.body.contains("need to be replaced"),
        "got {:?}",
        email.body
    );
    assert_no_dangling_paragraph(&email);
}

#[test]
fn changes_requested_email_with_neither_a_reason_nor_a_document_is_not_empty() {
    let email = render_kyb_changes_requested_email(TO, LEGAL_NAME, None, &[]);
    assert!(
        email
            .body
            .contains("Sign in to review your submission and send it back for review."),
        "got {:?}",
        email.body
    );
    assert!(email.body.contains(LEGAL_NAME), "got {:?}", email.body);
    assert!(
        !email.body.contains("\n\n"),
        "the fallback body is one paragraph, got {:?}",
        email.body
    );
    assert_no_dangling_paragraph(&email);
}

#[test]
fn changes_requested_email_treats_a_whitespace_only_reason_as_absent() {
    let rejected = [doc("certificate.pdf", Some("the scan is unreadable"))];
    assert_eq!(
        render_kyb_changes_requested_email(TO, LEGAL_NAME, Some("  \t "), &rejected),
        render_kyb_changes_requested_email(TO, LEGAL_NAME, None, &rejected)
    );
    assert_eq!(
        render_kyb_changes_requested_email(TO, LEGAL_NAME, Some("  \t "), &[]),
        render_kyb_changes_requested_email(TO, LEGAL_NAME, None, &[])
    );
}

#[test]
fn changes_requested_email_lists_documents_in_the_order_given() {
    let rejected = [
        doc("first.pdf", Some("first reason")),
        doc("second.pdf", Some("second reason")),
        doc("third.pdf", Some("third reason")),
    ];
    let email = render_kyb_changes_requested_email(TO, LEGAL_NAME, None, &rejected);
    let positions: Vec<usize> = rejected
        .iter()
        .map(|entry| position(&email.body, entry.filename))
        .collect();
    assert!(
        positions.windows(2).all(|pair| pair[0] < pair[1]),
        "filenames out of order in {:?}",
        email.body
    );
    for entry in &rejected {
        assert!(
            email.body.contains(entry.reason.expect("a reason")),
            "got {:?}",
            email.body
        );
    }
}

#[test]
fn changes_requested_email_says_a_reason_was_not_recorded_rather_than_printing_none() {
    let rejected = [doc("certificate.pdf", None)];
    let email = render_kyb_changes_requested_email(TO, LEGAL_NAME, None, &rejected);
    assert!(
        email.body.contains("certificate.pdf"),
        "got {:?}",
        email.body
    );
    assert!(
        email.body.contains("no reason was recorded"),
        "got {:?}",
        email.body
    );
    assert!(!email.body.contains("None"), "got {:?}", email.body);
}

#[test]
fn changes_requested_email_treats_a_blank_document_reason_as_unrecorded() {
    assert_eq!(
        render_kyb_changes_requested_email(TO, LEGAL_NAME, None, &[doc("c.pdf", Some("  "))]),
        render_kyb_changes_requested_email(TO, LEGAL_NAME, None, &[doc("c.pdf", None)])
    );
}

// ── Failed ──────────────────────────────────────────────────────────────────

#[test]
fn failed_email_carries_the_reason_and_states_the_decision_is_final() {
    let reason = "The filing could not be matched to any registry entry.";
    let email = render_kyb_failed_email(TO, LEGAL_NAME, Some(reason));
    assert!(email.body.contains(reason), "got {:?}", email.body);
    assert!(
        email.body.contains("This decision is final."),
        "got {:?}",
        email.body
    );
    assert_no_dangling_paragraph(&email);
}

#[test]
fn failed_email_without_a_reason_is_still_coherent() {
    let email = render_kyb_failed_email(TO, LEGAL_NAME, None);
    assert!(
        email.body.contains("was not approved"),
        "got {:?}",
        email.body
    );
    assert!(
        email.body.contains("This decision is final."),
        "got {:?}",
        email.body
    );
    assert_no_dangling_paragraph(&email);
}

#[test]
fn failed_email_never_claims_the_account_is_suspended() {
    let reason = "The filing could not be matched to any registry entry.";
    for email in [
        render_kyb_failed_email(TO, LEGAL_NAME, Some(reason)),
        render_kyb_failed_email(TO, LEGAL_NAME, None),
    ] {
        let body = email.body.to_lowercase();
        for forbidden in ["suspend", "account"] {
            assert!(
                !body.contains(forbidden),
                "the Failed email must not claim anything about the owning account: \
                 `accounts.status = 'Suspended'` is written but gates nothing until #1380, \
                 so the claim would be false of every behaviour the LP can observe \
                 (spec § Security Considerations). Found {forbidden:?} in {body:?}"
            );
        }
    }
}

// ── Cross-cutting ───────────────────────────────────────────────────────────

fn all_three() -> Vec<OutboundEmail> {
    let rejected = [doc("certificate.pdf", Some("the scan is unreadable"))];
    let reason = Some("A recorded reason.");
    vec![
        render_kyb_passed_email(TO, LEGAL_NAME, reason),
        render_kyb_changes_requested_email(TO, LEGAL_NAME, reason, &rejected),
        render_kyb_failed_email(TO, LEGAL_NAME, reason),
    ]
}

#[test]
fn every_decision_email_echoes_the_recipient_verbatim() {
    for email in all_three() {
        assert_eq!(email.to, TO);
        assert!(!email.subject.is_empty());
        assert!(!email.body.is_empty());
    }
}

#[test]
fn every_decision_email_has_a_distinct_subject() {
    let mut subjects: Vec<String> = all_three().into_iter().map(|e| e.subject).collect();
    subjects.sort();
    let distinct = subjects.len();
    subjects.dedup();
    assert_eq!(
        subjects.len(),
        distinct,
        "a recipient must tell the outcome from the inbox list alone, got {subjects:?}"
    );
}

#[test]
fn no_decision_email_leaks_a_format_placeholder() {
    let mut emails = all_three();
    emails.push(render_kyb_passed_email(TO, LEGAL_NAME, None));
    emails.push(render_kyb_changes_requested_email(
        TO,
        LEGAL_NAME,
        None,
        &[],
    ));
    emails.push(render_kyb_failed_email(TO, LEGAL_NAME, None));
    for email in emails {
        assert!(
            !email.body.contains('{') && !email.body.contains('}'),
            "got {:?}",
            email.body
        );
        assert!(
            !email.subject.contains('{') && !email.subject.contains('}'),
            "got {:?}",
            email.subject
        );
    }
}
