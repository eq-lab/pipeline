//! Compute-layer tests for the `/v1/lps` API group. Exercises the pure
//! functions directly against fixtures, no HTTP/DB layer involved. Mirrors
//! `packages/api/tests/ramp.rs`.

use axum::http::StatusCode;

use pipeline_api::routes::lps::{
    check_document_cap, resolve_document_review, upsert_status, validate_profile,
    DocumentReviewDecision, DocumentReviewRequest, FileResult, LpProfileForm,
};
use shared::kyb_document_repo::DocumentStatus;

// ── Document review ──────────────────────────────────────────────────────────

#[test]
fn reject_requires_a_non_empty_reason() {
    let req = DocumentReviewRequest {
        decision: DocumentReviewDecision::Rejected,
        reason: None,
    };
    assert!(resolve_document_review(&req).is_err());

    let req = DocumentReviewRequest {
        decision: DocumentReviewDecision::Rejected,
        reason: Some("   ".to_owned()),
    };
    assert!(resolve_document_review(&req).is_err());
}

#[test]
fn reject_with_a_reason_succeeds() {
    let req = DocumentReviewRequest {
        decision: DocumentReviewDecision::Rejected,
        reason: Some("certificate is expired".to_owned()),
    };
    let (status, reason) = resolve_document_review(&req).unwrap();
    assert_eq!(status, DocumentStatus::Rejected);
    assert_eq!(reason, Some("certificate is expired"));
}

#[test]
fn verify_must_not_carry_a_reason() {
    let req = DocumentReviewRequest {
        decision: DocumentReviewDecision::Verified,
        reason: Some("shouldn't be here".to_owned()),
    };
    assert!(resolve_document_review(&req).is_err());
}

#[test]
fn verify_without_a_reason_succeeds() {
    let req = DocumentReviewRequest {
        decision: DocumentReviewDecision::Verified,
        reason: None,
    };
    let (status, reason) = resolve_document_review(&req).unwrap();
    assert_eq!(status, DocumentStatus::Verified);
    assert_eq!(reason, None);
}

// ── Profile validation ───────────────────────────────────────────────────────

fn form(legal_name: &str, country: Option<&str>, contact_email: &str) -> LpProfileForm {
    LpProfileForm {
        legal_name: legal_name.to_owned(),
        country: country.map(str::to_owned),
        contact_email: contact_email.to_owned(),
    }
}

#[test]
fn a_complete_profile_is_trimmed_and_accepted() {
    let submitted = form("  Acme Trading Ltd  ", Some(" NL "), " ops@acme.example ");
    let profile = validate_profile(&submitted).expect("a valid profile");
    assert_eq!(profile.legal_name, "Acme Trading Ltd");
    assert_eq!(profile.country, Some("NL"));
    assert_eq!(profile.contact_email, "ops@acme.example");
}

#[test]
fn legal_name_and_contact_email_are_required() {
    assert!(validate_profile(&form("", None, "ops@acme.example")).is_err());
    assert!(validate_profile(&form("   ", None, "ops@acme.example")).is_err());
    assert!(validate_profile(&form("Acme", None, "")).is_err());
    assert!(validate_profile(&form("Acme", None, "  ")).is_err());
}

#[test]
fn a_blank_country_clears_the_column_rather_than_storing_empty_text() {
    let blank = form("Acme", Some("   "), "ops@acme.example");
    assert_eq!(validate_profile(&blank).unwrap().country, None);

    let absent = form("Acme", None, "ops@acme.example");
    assert_eq!(validate_profile(&absent).unwrap().country, None);
}

// ── Document cap ─────────────────────────────────────────────────────────────

#[test]
fn an_upload_that_fits_is_allowed() {
    assert!(check_document_cap(0, 10, 20).is_ok());
    assert!(check_document_cap(18, 2, 20).is_ok());
    assert!(check_document_cap(20, 0, 20).is_ok());
}

#[test]
fn the_cap_counts_the_whole_batch_not_each_file() {
    // 19 held and 2 incoming is refused outright, rather than storing one and
    // rejecting the other — an LP is never left with a half-applied upload.
    assert!(check_document_cap(19, 2, 20).is_err());
    assert!(check_document_cap(0, 21, 20).is_err());
}

#[test]
fn an_lp_already_at_the_cap_cannot_add_more() {
    assert!(check_document_cap(20, 1, 20).is_err());
}

#[test]
fn the_cap_does_not_overflow_on_absurd_input() {
    assert!(check_document_cap(i64::MAX, usize::MAX, 20).is_err());
}

// ── Upsert status ────────────────────────────────────────────────────────────

fn stored(filename: &str) -> FileResult {
    FileResult {
        filename: filename.to_owned(),
        status: StatusCode::CREATED.as_u16(),
        id: Some(1),
        error: None,
    }
}

fn refused(filename: &str) -> FileResult {
    FileResult {
        filename: filename.to_owned(),
        status: StatusCode::BAD_REQUEST.as_u16(),
        id: None,
        error: Some("unsupported file type".to_owned()),
    }
}

#[test]
fn a_clean_registration_is_created() {
    assert_eq!(upsert_status(true, &[]), StatusCode::CREATED);
    assert_eq!(
        upsert_status(true, &[stored("cert.pdf"), stored("registry.pdf")]),
        StatusCode::CREATED
    );
}

#[test]
fn a_clean_edit_is_ok() {
    assert_eq!(upsert_status(false, &[]), StatusCode::OK);
    assert_eq!(upsert_status(false, &[stored("cert.pdf")]), StatusCode::OK);
}

#[test]
fn any_refused_file_downgrades_the_response_to_multi_status() {
    assert_eq!(
        upsert_status(true, &[stored("cert.pdf"), refused("virus.exe")]),
        StatusCode::MULTI_STATUS
    );
    assert_eq!(
        upsert_status(false, &[refused("virus.exe")]),
        StatusCode::MULTI_STATUS
    );
}
