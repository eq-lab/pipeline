//! Unit tests for the loan-submission workflow: payload validation, review-request
//! resolution, status round-trip, and payload serde. Pure — no HTTP/DB layer
//! (matches the project-wide convention: all tests in `tests/`, no live Postgres).

use pipeline_api::routes::loan_book::{
    resolve_review, validate_submission, EconomicsInput, LocationInput, ReviewDecision,
    ReviewRequest, SubmitLoanRequest,
};
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
    assert!(validate_submission(&req).is_ok());
}
