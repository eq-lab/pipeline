//! Unit tests for the loan-submission workflow: payload validation, review-request
//! resolution, status round-trip, and payload serde. Pure — no HTTP/DB layer
//! (matches the project-wide convention: all tests in `tests/`, no live Postgres).

use async_trait::async_trait;
use pipeline_api::routes::loan_book::{
    extract_documents, resolve_review, validate_metadata_uri, validate_submission, EconomicsInput,
    LoanDocumentDto, LocationInput, ReviewDecision, ReviewRequest, SubmitLoanRequest,
};
use shared::loan_metadata::{LoanMetadataFetcher, LoanMetadataJson};
use shared::submitted_loan_repo::SubmissionStatus;

fn valid_request() -> SubmitLoanRequest {
    SubmitLoanRequest {
        to: "GORIGINATOR".to_owned(),
        metadata_uri: "ipfs://Qm_doc".to_owned(),
        originator: "Open Mineral".to_owned(),
        borrower_id: "BRW-1".to_owned(),
        commodity: "Copper Concentrate".to_owned(),
        corridor: "PE-CN".to_owned(),
        governing_law: "EN".to_owned(),
        protection: "LC at sight".to_owned(),
        secondary_metadata_uri: None,
        documents: Vec::new(),
        economics: EconomicsInput {
            original_facility_size: "100000.000000".to_owned(),
            original_senior_tranche: "80000.000000".to_owned(),
            original_equity_tranche: "20000.000000".to_owned(),
            original_offtaker_price: "105000.000000".to_owned(),
            senior_interest_rate_bps: 1200,
            origination_date: 1_700_000_000,
            original_maturity_date: 1_715_000_000,
        },
        initial_ccr: 1_500_000,
        initial_location: LocationInput {
            location_type: "Warehouse".to_owned(),
            location_identifier: "WH-1".to_owned(),
            tracking_url: "https://track.example.com/WH-1".to_owned(),
            updated_at: 1_700_000_000,
        },
    }
}

// ── validate_submission ──────────────────────────────────────────────────────

#[test]
fn valid_submission_passes() {
    assert!(validate_submission(&valid_request()).is_ok());
}

#[test]
fn empty_to_is_rejected() {
    let mut r = valid_request();
    r.to = "  ".to_owned();
    assert!(validate_submission(&r).is_err());
}

#[test]
fn empty_metadata_uri_is_rejected() {
    let mut r = valid_request();
    r.metadata_uri = String::new();
    assert!(validate_submission(&r).is_err());
}

#[test]
fn tranches_must_sum_to_facility() {
    let mut r = valid_request();
    r.economics.original_equity_tranche = "19999.000000".to_owned();
    let err = validate_submission(&r).unwrap_err();
    assert!(err.contains("facility size"), "unexpected error: {err}");
}

#[test]
fn maturity_must_be_after_origination() {
    let mut r = valid_request();
    r.economics.original_maturity_date = r.economics.origination_date;
    let err = validate_submission(&r).unwrap_err();
    assert!(err.contains("maturity"), "unexpected error: {err}");
}

#[test]
fn offtaker_price_must_cover_facility() {
    let mut r = valid_request();
    r.economics.original_offtaker_price = "99999.000000".to_owned();
    let err = validate_submission(&r).unwrap_err();
    assert!(err.contains("offtaker_price"), "unexpected error: {err}");
}

#[test]
fn ccr_below_one_is_rejected() {
    let mut r = valid_request();
    r.initial_ccr = 999_999;
    let err = validate_submission(&r).unwrap_err();
    assert!(err.contains("initial_ccr"), "unexpected error: {err}");
}

#[test]
fn ccr_exactly_one_is_allowed() {
    let mut r = valid_request();
    r.initial_ccr = 1_000_000;
    assert!(validate_submission(&r).is_ok());
}

#[test]
fn unknown_location_type_is_rejected() {
    let mut r = valid_request();
    r.initial_location.location_type = "Moon".to_owned();
    let err = validate_submission(&r).unwrap_err();
    assert!(err.contains("location_type"), "unexpected error: {err}");
}

#[test]
fn non_decimal_amount_is_rejected() {
    let mut r = valid_request();
    r.economics.original_facility_size = "not-a-number".to_owned();
    assert!(validate_submission(&r).is_err());
}

// ── resolve_review ───────────────────────────────────────────────────────────

#[test]
fn reject_without_reason_is_rejected() {
    let req = ReviewRequest {
        decision: ReviewDecision::Rejected,
        reason: None,
    };
    assert!(resolve_review(&req).is_err());

    let req = ReviewRequest {
        decision: ReviewDecision::Rejected,
        reason: Some("   ".to_owned()),
    };
    assert!(resolve_review(&req).is_err());
}

#[test]
fn reject_with_reason_resolves_to_rejected() {
    let req = ReviewRequest {
        decision: ReviewDecision::Rejected,
        reason: Some("insufficient collateral".to_owned()),
    };
    let (status, reason) = resolve_review(&req).unwrap();
    assert_eq!(status, SubmissionStatus::Rejected);
    assert_eq!(reason, Some("insufficient collateral"));
}

#[test]
fn approve_without_reason_resolves_to_approved() {
    let req = ReviewRequest {
        decision: ReviewDecision::Approved,
        reason: None,
    };
    let (status, reason) = resolve_review(&req).unwrap();
    assert_eq!(status, SubmissionStatus::Approved);
    assert_eq!(reason, None);
}

#[test]
fn approve_with_reason_is_rejected() {
    let req = ReviewRequest {
        decision: ReviewDecision::Approved,
        reason: Some("looks good".to_owned()),
    };
    assert!(resolve_review(&req).is_err());
}

// ── SubmissionStatus round-trip ──────────────────────────────────────────────

#[test]
fn submission_status_round_trips() {
    for s in [
        SubmissionStatus::InReview,
        SubmissionStatus::Approved,
        SubmissionStatus::Rejected,
    ] {
        let parsed: SubmissionStatus = s.as_str().parse().unwrap();
        assert_eq!(parsed, s);
    }
}

#[test]
fn submission_status_rejects_unknown() {
    assert!("Pending".parse::<SubmissionStatus>().is_err());
    assert!("".parse::<SubmissionStatus>().is_err());
}

// ── payload serde ────────────────────────────────────────────────────────────

#[test]
fn submit_request_round_trips_through_json() {
    let req = valid_request();
    let value = serde_json::to_value(&req).expect("serialize");
    let back: SubmitLoanRequest = serde_json::from_value(value).expect("deserialize");
    // Spot-check a few representative fields across the nested structures.
    assert_eq!(back.to, req.to);
    assert_eq!(back.protection, "LC at sight");
    assert_eq!(
        back.economics.original_facility_size,
        req.economics.original_facility_size
    );
    assert_eq!(back.initial_ccr, req.initial_ccr);
    assert_eq!(
        back.initial_location.location_type,
        req.initial_location.location_type
    );
}

#[test]
fn submit_request_defaults_optional_fields() {
    // `protection` and `secondary_metadata_uri` are optional in the wire format.
    let json = serde_json::json!({
        "to": "GADDR",
        "metadata_uri": "ipfs://doc",
        "originator": "O",
        "borrower_id": "B",
        "commodity": "C",
        "corridor": "X-Y",
        "governing_law": "EN",
        "economics": {
            "original_facility_size": "100000.000000",
            "original_senior_tranche": "80000.000000",
            "original_equity_tranche": "20000.000000",
            "original_offtaker_price": "105000.000000",
            "senior_interest_rate_bps": 1200,
            "origination_date": 1_700_000_000_u64,
            "original_maturity_date": 1_715_000_000_u64
        },
        "initial_ccr": 1_500_000,
        "initial_location": {
            "location_type": "Vessel",
            "location_identifier": "V-1",
            "tracking_url": "https://track/V-1",
            "updated_at": 1_700_000_000_u64
        }
    });
    let req: SubmitLoanRequest = serde_json::from_value(json).expect("deserialize");
    assert_eq!(req.protection, "");
    assert_eq!(req.secondary_metadata_uri, None);
    assert!(req.documents.is_empty());
    assert!(validate_submission(&req).is_ok());
}

// ── documents: POST accepts, GET view lifts from the stored payload ───────────

#[test]
fn extract_documents_reads_populated_array() {
    let loan_data = serde_json::json!({
        "documents": [
            { "name": "Agreement", "uri": "ipfs://QmA" },
            { "name": "License", "uri": "ipfs://QmB" }
        ]
    });
    let docs = extract_documents(&loan_data);
    assert_eq!(docs.len(), 2);
    assert_eq!(docs[0].name, "Agreement");
    assert_eq!(docs[1].uri, "ipfs://QmB");
}

#[test]
fn extract_documents_defaults_empty_for_legacy_payload() {
    // A submission blob that predates the `documents` field.
    let loan_data = serde_json::json!({ "originator": "Open Mineral" });
    assert!(extract_documents(&loan_data).is_empty());
}

#[test]
fn documents_round_trip_from_submit_request_to_view() {
    // The POST handler stores `serde_json::to_value(&payload)` verbatim; the GET
    // view then lifts `documents` back out of that stored blob.
    let mut req = valid_request();
    req.documents = vec![LoanDocumentDto {
        name: "Agreement".to_owned(),
        uri: "ipfs://QmA".to_owned(),
    }];
    let loan_data = serde_json::to_value(&req).expect("serialize submission");
    let docs = extract_documents(&loan_data);
    assert_eq!(docs.len(), 1);
    assert_eq!(docs[0].name, "Agreement");
    assert_eq!(docs[0].uri, "ipfs://QmA");
}

// ── metadata_uri validation ──────────────────────────────────────────────────

/// Stand-in for the HTTP metadata fetch. `ok` returns a valid `LoanMetadataJson`;
/// otherwise it errors, simulating a 404 / non-JSON / unknown-field document.
struct MockFetcher {
    ok: bool,
}

#[async_trait]
impl LoanMetadataFetcher for MockFetcher {
    async fn fetch_metadata(&self, _uri: &str) -> anyhow::Result<LoanMetadataJson> {
        if self.ok {
            Ok(serde_json::from_value(serde_json::json!({
                "originator": "Open Mineral",
                "borrowerId": "BRW-1",
                "commodity": "Copper Concentrate",
                "corridor": "PE-CN",
                "governingLaw": "EN"
            }))
            .expect("valid LoanMetadataJson fixture"))
        } else {
            Err(anyhow::anyhow!("HTTP 404 from gateway"))
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn metadata_uri_resolving_to_valid_document_passes() {
    let fetcher = MockFetcher { ok: true };
    assert!(validate_metadata_uri(&fetcher, "ipfs://Qm_doc")
        .await
        .is_ok());
}

#[tokio::test(flavor = "current_thread")]
async fn metadata_uri_fetch_failure_is_rejected() {
    let fetcher = MockFetcher { ok: false };
    let err = validate_metadata_uri(&fetcher, "ipfs://Qm_bad")
        .await
        .unwrap_err();
    assert!(err.contains("metadata_uri"), "unexpected error: {err}");
}

// ── LoanMetadataJson contract (shared type the indexer parses) ────────────────

#[test]
fn loan_metadata_json_parses_indexer_shape() {
    // The full document shape the indexer accepts (camelCase keys, optional fields).
    let json = serde_json::json!({
        "originator": "Open Mineral",
        "borrowerId": "BRW-1",
        "commodity": "Copper Concentrate",
        "corridor": "PE-CN",
        "governingLaw": "EN",
        "protection": "LC at sight",
        "metadataURI": "ipfs://secondary",
        "documents": [{ "name": "Agreement", "uri": "ipfs://QmA" }]
    });
    let doc: LoanMetadataJson = serde_json::from_value(json).expect("parse");
    assert_eq!(doc.borrower_id, "BRW-1");
    assert_eq!(doc.governing_law, "EN");
    assert_eq!(doc.protection, "LC at sight");
    assert_eq!(doc.metadata_uri.as_deref(), Some("ipfs://secondary"));
    assert_eq!(doc.documents.len(), 1);
}

#[test]
fn loan_metadata_json_rejects_unknown_field() {
    // `deny_unknown_fields` — a document with an extra key must fail (this is exactly
    // the class of failure the submission-time check is meant to catch early).
    let json = serde_json::json!({
        "originator": "O",
        "borrowerId": "B",
        "commodity": "C",
        "corridor": "X-Y",
        "governingLaw": "EN",
        "surpriseField": "nope"
    });
    assert!(serde_json::from_value::<LoanMetadataJson>(json).is_err());
}
