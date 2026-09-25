//! Compute-layer tests for the `/v1/lps` API group. Exercises the pure
//! functions directly against fixtures, no HTTP/DB layer involved. Mirrors
//! `packages/api/tests/ramp.rs`.

use axum::http::StatusCode;

use pipeline_api::config::KybLimits;
use pipeline_api::routes::lps::{
    check_document_cap, resolve_document_review, upload_status, validate_profile,
    DocumentReviewDecision, DocumentReviewRequest, FileResult, LpsDoc, UpsertLpRequest,
    MAX_CONTACT_EMAIL_LEN, MAX_COUNTRY_LEN, MAX_LEGAL_NAME_LEN,
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

fn form(legal_name: &str, country: Option<&str>, contact_email: &str) -> UpsertLpRequest {
    UpsertLpRequest {
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
fn a_refused_file_does_not_consume_cap_headroom() {
    // An LP holding 19 of 20 posts one valid PDF and one unsupported file.
    // Only the PDF would ever be stored, so the request fits — counting the
    // refused file too would 409 the whole request and write neither the
    // valid document nor the profile edit carrying it.
    assert!(check_document_cap(19, 1, 20).is_ok());
}

#[test]
fn an_lp_already_at_the_cap_cannot_add_more() {
    assert!(check_document_cap(20, 1, 20).is_err());
}

#[test]
fn the_cap_does_not_overflow_on_absurd_input() {
    // `held = 0` is the case that actually exercises the conversion: with
    // `incoming as i64`, usize::MAX wraps to -1 and the request is waved
    // through. A large `held` would saturate and mask the bug.
    assert!(check_document_cap(0, usize::MAX, 20).is_err());
    assert!(check_document_cap(i64::MAX, usize::MAX, 20).is_err());
    assert!(check_document_cap(i64::MAX, 1, 20).is_err());
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
fn an_upload_where_every_file_stored_is_created() {
    assert_eq!(upload_status(&[]), StatusCode::CREATED);
    assert_eq!(
        upload_status(&[stored("cert.pdf"), stored("registry.pdf")]),
        StatusCode::CREATED
    );
}

#[test]
fn a_partial_upload_is_multi_status() {
    assert_eq!(
        upload_status(&[stored("cert.pdf"), refused("virus.exe")]),
        StatusCode::MULTI_STATUS
    );
}

#[test]
fn an_upload_where_nothing_stored_is_a_plain_failure() {
    // Nothing changed, so 207 would overstate it. This is the case the old
    // combined endpoint could not answer honestly, because a profile write
    // always survived alongside the files.
    assert_eq!(
        upload_status(&[refused("virus.exe")]),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        upload_status(&[refused("a.exe"), refused("b.exe")]),
        StatusCode::BAD_REQUEST
    );
}

// ── OpenAPI document ─────────────────────────────────────────────────────────

fn openapi_json() -> serde_json::Value {
    serde_json::to_value(<LpsDoc as utoipa::OpenApi>::openapi()).expect("a serializable document")
}

#[test]
fn the_upload_body_is_documented_as_multipart_form_data() {
    let doc = openapi_json();
    let body = &doc["paths"]["/v1/lps/me/documents"]["post"]["requestBody"]["content"];
    assert!(
        body.get("multipart/form-data").is_some(),
        "the upload must advertise multipart/form-data, got {body}"
    );
}

/// An optional field is nullable, which utoipa renders as OpenAPI 3.1's
/// `type: ["string", "null"]` rather than a bare `"string"` — so accept either
/// spelling when asking what kind of input a field is.
fn has_type(schema: &serde_json::Value, wanted: &str) -> bool {
    match &schema["type"] {
        serde_json::Value::String(t) => t == wanted,
        serde_json::Value::Array(ts) => ts.iter().any(|t| t == wanted),
        _ => false,
    }
}

#[test]
fn the_profile_endpoint_takes_json_not_multipart() {
    let doc = openapi_json();
    let content = &doc["paths"]["/v1/lps/me"]["post"]["requestBody"]["content"];
    assert!(
        content.get("application/json").is_some(),
        "the profile endpoint must be plain JSON, got {content}"
    );
    assert!(
        content.get("multipart/form-data").is_none(),
        "the profile endpoint must not accept files — uploading rewrote the \
         profile when it did"
    );
}

#[test]
fn the_profile_request_exposes_the_entity_fields() {
    let doc = openapi_json();
    let props = &doc["components"]["schemas"]["UpsertLpRequest"]["properties"];
    for field in ["legal_name", "country", "contact_email"] {
        assert!(
            has_type(&props[field], "string"),
            "{field} must be an editable text field, got {}",
            props[field]
        );
    }
}

#[test]
fn the_upload_form_exposes_a_multi_file_picker() {
    let doc = openapi_json();
    let files = &doc["components"]["schemas"]["UploadDocumentsForm"]["properties"]["files"];
    // The plain string form, not 3.1's ["array","null"] union: Swagger UI keys
    // its file-picker rendering off this, and does not reliably handle the
    // union. A text box here instead of a Browse button is the failure.
    assert_eq!(
        files["type"], "array",
        "files must be a plain array type, got {}",
        files["type"]
    );
    assert_eq!(
        files["items"]["format"], "binary",
        "each file must be declared binary, or Swagger UI renders a text box \
         instead of a file picker — got {}",
        files["items"]
    );
}

#[test]
fn only_the_entity_fields_are_required() {
    let doc = openapi_json();
    let required = doc["components"]["schemas"]["UpsertLpRequest"]["required"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(required.iter().any(|f| f == "legal_name"));
    assert!(required.iter().any(|f| f == "contact_email"));
    assert!(
        !required.iter().any(|f| f == "country"),
        "country is optional — omitting it clears the column"
    );
    assert!(
        !required.iter().any(|f| f == "files"),
        "the profile request carries no files at all"
    );

    let upload_required = doc["components"]["schemas"]["UploadDocumentsForm"]["required"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(
        upload_required.iter().any(|f| f == "files"),
        "an upload with no files is a pointless request — files is required"
    );
}

// ── Profile field bounds ─────────────────────────────────────────────────────

#[test]
fn an_over_long_legal_name_is_refused() {
    // `lps.legal_name` is unbounded TEXT and this route's body limit is 100MB,
    // so without a cap a caller could push megabytes straight into the column.
    let long = "A".repeat(MAX_LEGAL_NAME_LEN + 1);
    assert!(validate_profile(&form(&long, None, "ops@acme.example")).is_err());

    let at_limit = "A".repeat(MAX_LEGAL_NAME_LEN);
    assert!(validate_profile(&form(&at_limit, None, "ops@acme.example")).is_ok());
}

#[test]
fn an_over_long_contact_email_is_refused() {
    let long = format!("{}@acme.example", "a".repeat(MAX_CONTACT_EMAIL_LEN));
    assert!(validate_profile(&form("Acme", None, &long)).is_err());
}

#[test]
fn an_over_long_country_is_refused() {
    let long = "A".repeat(MAX_COUNTRY_LEN + 1);
    assert!(validate_profile(&form("Acme", Some(&long), "ops@acme.example")).is_err());
}

// ── Body limit ───────────────────────────────────────────────────────────────

#[test]
fn the_body_limit_leaves_room_for_multipart_framing() {
    let limits = KybLimits {
        max_document_bytes: 10 * 1024 * 1024,
        max_files_per_request: 10,
        max_documents_per_lp: 20,
    };
    let raw_files = limits.max_document_bytes * limits.max_files_per_request;
    assert!(
        limits.max_request_bytes() > raw_files,
        "a maximal legitimate upload must still fit once boundaries and part \
         headers are counted, or ten files of exactly the per-file limit would \
         be refused"
    );
}

#[test]
fn the_length_limits_count_characters_not_bytes() {
    // Every character here is two bytes, so a byte-counted limit would refuse
    // this at half the advertised length — and the error message promises
    // characters.
    let cyrillic = "Я".repeat(MAX_LEGAL_NAME_LEN);
    assert!(
        cyrillic.len() > MAX_LEGAL_NAME_LEN,
        "fixture must be multi-byte"
    );
    assert!(
        validate_profile(&form(&cyrillic, None, "ops@acme.example")).is_ok(),
        "a non-Latin name of exactly the limit must be accepted"
    );

    let over = "Я".repeat(MAX_LEGAL_NAME_LEN + 1);
    assert!(validate_profile(&form(&over, None, "ops@acme.example")).is_err());
}
