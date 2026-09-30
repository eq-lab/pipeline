//! Compute-layer tests for the `/v1/lps` API group. Exercises the pure
//! functions directly against fixtures, no HTTP/DB layer involved. Mirrors
//! `packages/api/tests/ramp.rs`.

use axum::http::StatusCode;

use chrono::Utc;

use pipeline_api::config::KybLimits;
use pipeline_api::routes::lps::{
    check_document_cap, decide_upsert, decision_recipient, kyb_decision_email, pass_blockers,
    profile_is_unchanged, rejected_documents, resolve_document_review, resolve_kyb_decision,
    submit_blockers, upload_status, validate_profile, DocumentReviewDecision,
    DocumentReviewRequest, FileResult, KybDecision, KybDecisionRequest, LpsDoc, StoredProfile,
    UpsertLpRequest, UpsertOutcome, ValidatedProfile, MAX_CONTACT_EMAIL_LEN, MAX_COUNTRY_LEN,
    MAX_DECISION_REASON_LEN, MAX_LEGAL_NAME_LEN,
};
use shared::email::{
    render_kyb_changes_requested_email, render_kyb_failed_email, render_kyb_passed_email,
};
use shared::kyb_document_repo::{DocumentStatus, KybDocumentRow};
use shared::lp_repo::KybStatus;

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
        notify_on_review: None,
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

// ── Narrowed freeze (profile_is_unchanged / decide_upsert) ──────────────────

fn stored_profile<'a>(
    legal_name: &'a str,
    country: Option<&'a str>,
    contact_email: &'a str,
) -> StoredProfile<'a> {
    StoredProfile {
        legal_name,
        country,
        contact_email,
    }
}

fn submitted(form: &UpsertLpRequest) -> ValidatedProfile<'_> {
    validate_profile(form).expect("a valid profile")
}

#[test]
fn identical_values_are_unchanged() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    let f = form("Acme", Some("NL"), "ops@acme.example");
    assert!(profile_is_unchanged(s, &submitted(&f)));
}

#[test]
fn surrounding_whitespace_is_not_a_change() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    let f = form("  Acme  ", Some(" NL "), "  ops@acme.example  ");
    assert!(profile_is_unchanged(s, &submitted(&f)));
}

#[test]
fn a_frozen_lp_with_no_country_toggling_only_the_preference_is_unchanged() {
    let s = stored_profile("Acme", None, "ops@acme.example");
    let f = form("Acme", None, "ops@acme.example");
    assert!(profile_is_unchanged(s, &submitted(&f)));
}

#[test]
fn a_blank_submitted_country_against_a_stored_none_is_unchanged() {
    let s = stored_profile("Acme", None, "ops@acme.example");
    let f = form("Acme", Some("   "), "ops@acme.example");
    assert!(profile_is_unchanged(s, &submitted(&f)));
}

#[test]
fn a_stored_none_country_against_a_submitted_value_is_a_change() {
    let s = stored_profile("Acme", None, "ops@acme.example");
    let f = form("Acme", Some("NL"), "ops@acme.example");
    assert!(!profile_is_unchanged(s, &submitted(&f)));
}

#[test]
fn a_stored_country_against_an_omitted_one_is_a_change() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    let f = form("Acme", None, "ops@acme.example");
    assert!(!profile_is_unchanged(s, &submitted(&f)));
}

#[test]
fn legal_name_differing_only_in_case_is_a_change() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    let f = form("ACME", Some("NL"), "ops@acme.example");
    assert!(!profile_is_unchanged(s, &submitted(&f)));
}

#[test]
fn contact_email_differing_only_in_case_is_a_change() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    let f = form("Acme", Some("NL"), "OPS@ACME.EXAMPLE");
    assert!(!profile_is_unchanged(s, &submitted(&f)));
}

#[test]
fn each_field_differing_on_its_own_is_a_change() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    assert!(!profile_is_unchanged(
        s,
        &submitted(&form("Widgets Ltd", Some("NL"), "ops@acme.example"))
    ));
    assert!(!profile_is_unchanged(
        s,
        &submitted(&form("Acme", Some("DE"), "ops@acme.example"))
    ));
    assert!(!profile_is_unchanged(
        s,
        &submitted(&form("Acme", Some("NL"), "other@acme.example"))
    ));
}

#[test]
fn no_stored_lp_always_writes() {
    let f = form("Acme", Some("NL"), "ops@acme.example");
    assert_eq!(
        decide_upsert(None, false, &submitted(&f)),
        UpsertOutcome::Write
    );
    assert_eq!(
        decide_upsert(None, true, &submitted(&f)),
        UpsertOutcome::Write
    );
}

#[test]
fn a_writable_lp_always_writes_even_with_a_changed_profile() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    assert_eq!(
        decide_upsert(
            Some(s),
            true,
            &submitted(&form("Acme", Some("NL"), "ops@acme.example"))
        ),
        UpsertOutcome::Write
    );
    assert_eq!(
        decide_upsert(
            Some(s),
            true,
            &submitted(&form("New Name", Some("NL"), "ops@acme.example"))
        ),
        UpsertOutcome::Write
    );
}

#[test]
fn a_frozen_lp_with_an_identical_profile_writes_the_preference_only() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    let f = form("Acme", Some("NL"), "ops@acme.example");
    assert_eq!(
        decide_upsert(Some(s), false, &submitted(&f)),
        UpsertOutcome::PreferenceOnly
    );
}

#[test]
fn a_frozen_lp_with_a_changed_profile_is_refused() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    let f = form("New Name", Some("NL"), "ops@acme.example");
    assert_eq!(
        decide_upsert(Some(s), false, &submitted(&f)),
        UpsertOutcome::Refuse
    );
}

#[test]
fn refuse_is_reachable_only_when_not_writable() {
    let s = stored_profile("Acme", Some("NL"), "ops@acme.example");
    let changed = form("New Name", Some("NL"), "ops@acme.example");
    assert_ne!(
        decide_upsert(Some(s), true, &submitted(&changed)),
        UpsertOutcome::Refuse,
        "a writable LP can never be refused a profile edit by this rule"
    );
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
fn the_profile_request_exposes_notify_on_review_as_optional_boolean() {
    let doc = openapi_json();
    let schema = &doc["components"]["schemas"]["UpsertLpRequest"];
    assert!(
        has_type(&schema["properties"]["notify_on_review"], "boolean"),
        "notify_on_review must be a boolean field, got {}",
        schema["properties"]["notify_on_review"]
    );
    let required = schema["required"].as_array().cloned().unwrap_or_default();
    assert!(
        !required.iter().any(|f| f == "notify_on_review"),
        "notify_on_review must stay optional — absent means do not change"
    );
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

// ── Settlement address (Issue #1379) ─────────────────────────────────────────

#[test]
fn link_address_is_documented_with_every_response_status() {
    let doc = openapi_json();
    let responses = &doc["paths"]["/v1/lps/me/link-address"]["post"]["responses"];
    for status in ["200", "400", "401", "404", "409"] {
        assert!(
            responses.get(status).is_some(),
            "link-address must still document {status}, got {responses}"
        );
    }
}

#[test]
fn link_address_request_requires_a_stellar_address_string() {
    let doc = openapi_json();
    let schema = &doc["components"]["schemas"]["LinkAddressRequest"];
    assert!(
        has_type(&schema["properties"]["stellar_address"], "string"),
        "stellar_address must be a string field, got {}",
        schema["properties"]["stellar_address"]
    );
    let required = schema["required"].as_array().cloned().unwrap_or_default();
    assert!(
        required.iter().any(|f| f == "stellar_address"),
        "stellar_address must be required"
    );
}

#[test]
fn link_address_409_no_longer_requires_passed_kyb() {
    let doc = openapi_json();
    let description = doc["paths"]["/v1/lps/me/link-address"]["post"]["responses"]["409"]
        ["description"]
        .as_str()
        .expect("a 409 description")
        .to_owned();
    assert!(
        !description.contains("has not passed"),
        "the 409 description must not claim KYB must have passed first, got {description:?}"
    );
    assert!(
        description.contains("refused"),
        "the 409 description must mention the Failed refusal case, got {description:?}"
    );
}

#[test]
fn lp_response_stellar_address_no_longer_claims_passed_only() {
    let doc = openapi_json();
    let description = doc["components"]["schemas"]["LpResponse"]["properties"]["stellar_address"]
        ["description"]
        .as_str()
        .expect("a stellar_address description")
        .to_owned();
    assert!(
        !description.contains("Set only once"),
        "LpResponse.stellar_address is rendered into the public OpenAPI \
         document — it must not claim it is settable only once Passed, got \
         {description:?}"
    );
}

// ── KYB decision (Issue #1274) ───────────────────────────────────────────────

fn decision_req(decision: KybDecision, reason: Option<&str>) -> KybDecisionRequest {
    KybDecisionRequest {
        decision,
        reason: reason.map(str::to_owned),
    }
}

#[test]
fn each_decision_with_no_reason_succeeds_with_none() {
    for (decision, status) in [
        (KybDecision::Passed, KybStatus::Passed),
        (KybDecision::ChangesRequested, KybStatus::ChangesRequested),
        (KybDecision::Failed, KybStatus::Failed),
    ] {
        let req = decision_req(decision, None);
        let (resolved, reason) = resolve_kyb_decision(&req).unwrap();
        assert_eq!(resolved, status);
        assert_eq!(reason, None);
    }
}

#[test]
fn a_decision_with_a_reason_yields_the_trimmed_reason() {
    let req = decision_req(KybDecision::Failed, Some("  not enough proof  "));
    let (_, reason) = resolve_kyb_decision(&req).unwrap();
    assert_eq!(reason, Some("not enough proof"));
}

#[test]
fn a_whitespace_only_reason_collapses_to_none() {
    let req = decision_req(KybDecision::ChangesRequested, Some("   "));
    let (_, reason) = resolve_kyb_decision(&req).unwrap();
    assert_eq!(reason, None);
}

#[test]
fn an_over_long_reason_is_refused() {
    let long = "A".repeat(MAX_DECISION_REASON_LEN + 1);
    assert!(resolve_kyb_decision(&decision_req(KybDecision::Failed, Some(&long))).is_err());

    let at_limit = "A".repeat(MAX_DECISION_REASON_LEN);
    assert!(resolve_kyb_decision(&decision_req(KybDecision::Failed, Some(&at_limit))).is_ok());
}

#[test]
fn the_reason_length_limit_counts_characters_not_bytes() {
    let cyrillic = "Я".repeat(MAX_DECISION_REASON_LEN);
    assert!(
        cyrillic.len() > MAX_DECISION_REASON_LEN,
        "fixture must be multi-byte"
    );
    assert!(resolve_kyb_decision(&decision_req(KybDecision::Failed, Some(&cyrillic))).is_ok());

    let over = "Я".repeat(MAX_DECISION_REASON_LEN + 1);
    assert!(resolve_kyb_decision(&decision_req(KybDecision::Failed, Some(&over))).is_err());
}

#[test]
fn submit_blockers_refuses_an_lp_with_no_documents() {
    assert!(submit_blockers(&[]).is_err());
}

#[test]
fn submit_blockers_accepts_a_set_with_no_rejections() {
    assert!(submit_blockers(&[(1, DocumentStatus::Provided)]).is_ok());
    assert!(submit_blockers(&[(1, DocumentStatus::Verified)]).is_ok());
    assert!(submit_blockers(&[(1, DocumentStatus::NotProvided)]).is_ok());
}

#[test]
fn submit_blockers_names_every_rejected_id_ascending_and_no_others() {
    let err = submit_blockers(&[
        (5, DocumentStatus::Rejected),
        (2, DocumentStatus::Provided),
        (9, DocumentStatus::Rejected),
    ])
    .unwrap_err();
    assert!(err.contains('5'));
    assert!(err.contains('9'));
    assert!(!err.contains('2'));
    assert!(
        err.find('5') < err.find('9'),
        "ids must appear ascending: {err:?}"
    );
}

#[test]
fn pass_blockers_accepts_a_fully_verified_set() {
    assert!(pass_blockers(&[(1, DocumentStatus::Verified), (2, DocumentStatus::Verified)]).is_ok());
}

#[test]
fn pass_blockers_accepts_an_empty_set() {
    assert!(pass_blockers(&[]).is_ok());
}

#[test]
fn pass_blockers_names_every_unverified_id() {
    let err = pass_blockers(&[
        (1, DocumentStatus::Verified),
        (3, DocumentStatus::Provided),
        (7, DocumentStatus::Rejected),
    ])
    .unwrap_err();
    assert!(err.contains('3'));
    assert!(err.contains('7'));
    assert!(!err.contains('1'));
}

#[test]
fn submit_and_decide_kyb_routes_are_documented() {
    let doc = openapi_json();
    assert!(doc["paths"]["/v1/lps/me/submit"]["post"].is_object());
    assert!(doc["paths"]["/v1/lps/{id}/kyb"]["post"].is_object());
}

#[test]
fn the_kyb_decision_request_schema_requires_decision_not_reason() {
    let doc = openapi_json();
    let schema = &doc["components"]["schemas"]["KybDecisionRequest"];
    let required = schema["required"].as_array().cloned().unwrap_or_default();
    assert!(required.iter().any(|f| f == "decision"));
    assert!(!required.iter().any(|f| f == "reason"));
}

#[test]
fn the_kyb_decision_enum_excludes_under_review() {
    let doc = openapi_json();
    let variants = doc["components"]["schemas"]["KybDecision"]["enum"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let names: Vec<&str> = variants.iter().filter_map(|v| v.as_str()).collect();
    assert_eq!(names.len(), 3, "got {names:?}");
    for expected in ["Passed", "ChangesRequested", "Failed"] {
        assert!(
            names.contains(&expected),
            "missing {expected}, got {names:?}"
        );
    }
    assert!(
        !names.contains(&"UnderReview"),
        "a trustee cannot re-submit an LP, got {names:?}"
    );
}

#[test]
fn lp_response_exposes_the_review_lifecycle_fields() {
    let doc = openapi_json();
    let props = &doc["components"]["schemas"]["LpResponse"]["properties"];
    for field in ["kyb_submitted_at", "kyb_decided_at", "kyb_decision_reason"] {
        assert!(props.get(field).is_some(), "LpResponse missing {field}");
    }
    assert!(
        props.get("kyb_decided_by").is_none(),
        "kyb_decided_by must never be exposed to the LP owner"
    );

    let summary_props = &doc["components"]["schemas"]["LpSummary"]["properties"];
    for field in ["kyb_submitted_at", "kyb_decided_at"] {
        assert!(
            summary_props.get(field).is_some(),
            "LpSummary missing {field}"
        );
    }
}

#[test]
fn lp_response_exposes_notify_on_review_as_a_required_boolean() {
    let doc = openapi_json();
    let schema = &doc["components"]["schemas"]["LpResponse"];
    assert!(
        has_type(&schema["properties"]["notify_on_review"], "boolean"),
        "notify_on_review must be a boolean field, got {}",
        schema["properties"]["notify_on_review"]
    );
    let required = schema["required"].as_array().cloned().unwrap_or_default();
    assert!(
        required.iter().any(|f| f == "notify_on_review"),
        "notify_on_review is not an Option, so a reader never has to handle its absence"
    );
}

#[test]
fn kyb_status_schema_description_lists_changes_requested() {
    let doc = openapi_json();
    let description = doc["components"]["schemas"]["LpResponse"]["properties"]["kyb_status"]
        ["description"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    assert!(
        description.contains("ChangesRequested"),
        "got {description:?}"
    );
}

#[test]
fn document_review_409_names_the_not_under_review_cause() {
    let doc = openapi_json();
    let description = doc["paths"]["/v1/lps/{id}/documents/{doc}/review"]["post"]["responses"]
        ["409"]["description"]
        .as_str()
        .expect("a 409 description")
        .to_owned();
    assert!(
        description.to_lowercase().contains("underreview") || description.contains("under review"),
        "the 409 description must name the not-under-review cause, got {description:?}"
    );
}

// ── Decision email (Issue #1378) ─────────────────────────────────────────────

const LP_ID: i64 = 42;
const ACCOUNT_EMAIL: &str = "verified@account.example";
const CONTACT_EMAIL: &str = "ops@acme.example";
const LEGAL_NAME: &str = "Acme Capital Ltd";

fn kyb_doc(
    id: i64,
    filename: &str,
    status: DocumentStatus,
    reject_reason: Option<&str>,
) -> KybDocumentRow {
    KybDocumentRow {
        id,
        lp_id: LP_ID,
        file_ref: format!("lps/{LP_ID}/{id}.pdf"),
        original_filename: filename.to_owned(),
        size_bytes: 1_024,
        content_type: "application/pdf".to_owned(),
        status: status.as_str().to_owned(),
        reject_reason: reject_reason.map(str::to_owned),
        reviewed_by: None,
        reviewed_at: None,
        expires_at: None,
        created_at: Utc::now(),
    }
}

#[test]
fn rejected_documents_of_an_empty_set_is_empty() {
    assert!(rejected_documents(&[]).is_empty());
}

#[test]
fn rejected_documents_ignores_every_other_status() {
    let docs = [
        kyb_doc(1, "verified.pdf", DocumentStatus::Verified, None),
        kyb_doc(2, "provided.pdf", DocumentStatus::Provided, None),
        kyb_doc(3, "absent.pdf", DocumentStatus::NotProvided, None),
    ];
    assert!(rejected_documents(&docs).is_empty());
}

#[test]
fn rejected_documents_keeps_only_the_rejected_ones() {
    let docs = [
        kyb_doc(1, "provided.pdf", DocumentStatus::Provided, None),
        kyb_doc(2, "bad.pdf", DocumentStatus::Rejected, Some("unreadable")),
        kyb_doc(3, "verified.pdf", DocumentStatus::Verified, None),
        kyb_doc(4, "absent.pdf", DocumentStatus::NotProvided, None),
        kyb_doc(5, "stale.pdf", DocumentStatus::Rejected, Some("expired")),
    ];
    let rejected = rejected_documents(&docs);
    let names: Vec<&str> = rejected.iter().map(|d| d.filename).collect();
    assert_eq!(names, vec!["bad.pdf", "stale.pdf"]);
    for absent in ["provided.pdf", "verified.pdf", "absent.pdf"] {
        assert!(!names.contains(&absent), "{absent} must not be listed");
    }
}

#[test]
fn rejected_documents_reorders_newest_first_input_to_oldest_first() {
    let docs = [
        kyb_doc(9, "newest.pdf", DocumentStatus::Rejected, Some("c")),
        kyb_doc(5, "middle.pdf", DocumentStatus::Rejected, Some("b")),
        kyb_doc(1, "oldest.pdf", DocumentStatus::Rejected, Some("a")),
    ];
    let names: Vec<&str> = rejected_documents(&docs)
        .iter()
        .map(|d| d.filename)
        .collect();
    assert_eq!(names, vec!["oldest.pdf", "middle.pdf", "newest.pdf"]);
}

#[test]
fn a_rejected_document_with_no_stored_reason_carries_none() {
    let docs = [kyb_doc(1, "bad.pdf", DocumentStatus::Rejected, None)];
    assert_eq!(rejected_documents(&docs)[0].reason, None);
}

#[test]
fn a_rejected_documents_filename_is_the_stored_name_verbatim() {
    let docs = [
        kyb_doc(1, "board minutes.pdf", DocumentStatus::Rejected, Some("x")),
        kyb_doc(2, "устав.pdf", DocumentStatus::Rejected, Some("y")),
    ];
    let names: Vec<&str> = rejected_documents(&docs)
        .iter()
        .map(|d| d.filename)
        .collect();
    assert_eq!(names, vec!["board minutes.pdf", "устав.pdf"]);
}

#[test]
fn passed_selects_the_passed_renderer_and_ignores_the_rejected_documents() {
    let docs = [kyb_doc(1, "bad.pdf", DocumentStatus::Rejected, Some("x"))];
    let rejected = rejected_documents(&docs);
    let reason = Some("Registry filing matched.");
    let email = kyb_decision_email(
        ACCOUNT_EMAIL,
        LEGAL_NAME,
        KybDecision::Passed,
        reason,
        &rejected,
    );
    assert_eq!(
        email,
        render_kyb_passed_email(ACCOUNT_EMAIL, LEGAL_NAME, reason)
    );
    assert!(email.body.contains("Registry filing matched."));
    assert!(!email.body.contains("bad.pdf"));
}

#[test]
fn changes_requested_selects_the_changes_requested_renderer() {
    let docs = [kyb_doc(1, "bad.pdf", DocumentStatus::Rejected, Some("x"))];
    let rejected = rejected_documents(&docs);
    let reason = Some("Replace the certificate.");
    let email = kyb_decision_email(
        ACCOUNT_EMAIL,
        LEGAL_NAME,
        KybDecision::ChangesRequested,
        reason,
        &rejected,
    );
    assert_eq!(
        email,
        render_kyb_changes_requested_email(ACCOUNT_EMAIL, LEGAL_NAME, reason, &rejected)
    );
    assert!(email.body.contains("bad.pdf"));
}

#[test]
fn failed_selects_the_failed_renderer_and_ignores_the_rejected_documents() {
    let docs = [kyb_doc(1, "bad.pdf", DocumentStatus::Rejected, Some("x"))];
    let rejected = rejected_documents(&docs);
    let reason = Some("No registry entry.");
    let email = kyb_decision_email(
        ACCOUNT_EMAIL,
        LEGAL_NAME,
        KybDecision::Failed,
        reason,
        &rejected,
    );
    assert_eq!(
        email,
        render_kyb_failed_email(ACCOUNT_EMAIL, LEGAL_NAME, reason)
    );
    assert!(email.body.contains("No registry entry."));
    assert!(!email.body.contains("bad.pdf"));
}

#[test]
fn every_decision_renders_a_deliverable_email() {
    for decision in [
        KybDecision::Passed,
        KybDecision::ChangesRequested,
        KybDecision::Failed,
    ] {
        let email = kyb_decision_email(ACCOUNT_EMAIL, LEGAL_NAME, decision, None, &[]);
        assert!(!email.to.is_empty());
        assert!(!email.subject.is_empty());
        assert!(!email.body.is_empty());
    }
}

#[test]
fn the_verified_account_address_is_preferred_over_the_contact_address() {
    let to = decision_recipient(Some(ACCOUNT_EMAIL), CONTACT_EMAIL);
    assert_eq!(to, ACCOUNT_EMAIL);
    assert_ne!(to, CONTACT_EMAIL);
}

#[test]
fn a_wallet_registered_owner_with_no_account_address_falls_back_to_the_contact_address() {
    assert_eq!(decision_recipient(None, CONTACT_EMAIL), CONTACT_EMAIL);
}

#[test]
fn a_blank_account_address_is_treated_as_absent() {
    for blank in ["", "   ", "\t\n"] {
        assert_eq!(
            decision_recipient(Some(blank), CONTACT_EMAIL),
            CONTACT_EMAIL
        );
    }
}

#[test]
fn the_chosen_address_is_returned_unmodified() {
    let padded = "  Mixed.Case@Account.Example  ";
    assert_eq!(decision_recipient(Some(padded), CONTACT_EMAIL), padded);
    let contact = " Ops@Acme.Example ";
    assert_eq!(decision_recipient(None, contact), contact);
}

#[test]
fn the_chosen_address_reaches_the_rendered_email() {
    let email = kyb_decision_email(
        decision_recipient(None, CONTACT_EMAIL),
        LEGAL_NAME,
        KybDecision::Passed,
        None,
        &[],
    );
    assert_eq!(email.to, CONTACT_EMAIL);

    let email = kyb_decision_email(
        decision_recipient(Some(ACCOUNT_EMAIL), CONTACT_EMAIL),
        LEGAL_NAME,
        KybDecision::Failed,
        None,
        &[],
    );
    assert_eq!(email.to, ACCOUNT_EMAIL);
}
