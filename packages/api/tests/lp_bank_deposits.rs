// spec: Issue #1413, epic #1269

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};

use pipeline_api::config::KybLimits;
use pipeline_api::routes::lp_bank_deposits::{
    router, validate_record_bank_deposit, LpBankDepositsDoc, RecordBankDepositRequest,
};

const LANDED: &str = "2026-10-05T15:41:00Z";
const LANDED_IN_MOSCOW: &str = "2026-10-05T18:41:00+03:00";

fn valid_request() -> RecordBankDepositRequest {
    RecordBankDepositRequest {
        amount: "50000.00".to_owned(),
        payment_reference: "WIRE-REF-1".to_owned(),
        occurred_at: LANDED.to_owned(),
    }
}

fn landed() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(LANDED)
        .expect("a representable timestamp")
        .with_timezone(&Utc)
}

// ── Validation ───────────────────────────────────────────────────────────────

#[test]
fn valid_payload_parses_everything() {
    let values = validate_record_bank_deposit(&valid_request()).expect("payload should validate");
    assert_eq!(values.amount, "50000.00".parse::<BigDecimal>().unwrap());
    assert_eq!(values.payment_reference, "WIRE-REF-1");
    assert_eq!(values.occurred_at, landed());
}

#[test]
fn an_offset_timestamp_is_normalised_to_utc() {
    let request = RecordBankDepositRequest {
        occurred_at: LANDED_IN_MOSCOW.to_owned(),
        ..valid_request()
    };
    let values = validate_record_bank_deposit(&request).expect("payload should validate");
    assert_eq!(values.occurred_at, landed());
}

#[test]
fn a_surrounding_whitespace_timestamp_still_validates() {
    let request = RecordBankDepositRequest {
        occurred_at: format!("  {LANDED}  "),
        ..valid_request()
    };
    let values = validate_record_bank_deposit(&request).expect("payload should validate");
    assert_eq!(values.occurred_at, landed());
}

#[test]
fn an_unparseable_amount_is_rejected() {
    let request = RecordBankDepositRequest {
        amount: "fifty thousand".to_owned(),
        ..valid_request()
    };
    let error = validate_record_bank_deposit(&request).expect_err("should not validate");
    assert!(error.contains("amount"), "got {error}");
}

#[test]
fn a_zero_or_negative_amount_is_rejected() {
    for amount in ["0", "0.00", "-1", "-50000.00"] {
        let request = RecordBankDepositRequest {
            amount: amount.to_owned(),
            ..valid_request()
        };
        let error = validate_record_bank_deposit(&request)
            .expect_err(&format!("{amount} should not validate"));
        assert!(error.contains("> 0"), "got {error}");
    }
}

#[test]
fn an_amount_finer_than_cents_is_rejected() {
    let request = RecordBankDepositRequest {
        amount: "50000.001".to_owned(),
        ..valid_request()
    };
    let error = validate_record_bank_deposit(&request).expect_err("should not validate");
    assert!(error.contains("decimal places"), "got {error}");
}

#[test]
fn a_trailing_zero_past_cents_still_validates() {
    let request = RecordBankDepositRequest {
        amount: "50000.000".to_owned(),
        ..valid_request()
    };
    let values = validate_record_bank_deposit(&request).expect("50000.000 is still cents");
    assert_eq!(values.amount, "50000".parse::<BigDecimal>().unwrap());
}

#[test]
fn an_absurd_amount_is_rejected() {
    let request = RecordBankDepositRequest {
        amount: "1000000000000001".to_owned(),
        ..valid_request()
    };
    let error = validate_record_bank_deposit(&request).expect_err("should not validate");
    assert!(error.contains("must be <="), "got {error}");
}

#[test]
fn a_blank_payment_reference_is_rejected() {
    for reference in ["", "   ", "\t"] {
        let request = RecordBankDepositRequest {
            payment_reference: reference.to_owned(),
            ..valid_request()
        };
        let error = validate_record_bank_deposit(&request)
            .expect_err(&format!("{reference:?} should not validate"));
        assert!(error.contains("payment_reference"), "got {error}");
    }
}

#[test]
fn a_whole_dollar_amount_is_valid() {
    let request = RecordBankDepositRequest {
        amount: "50000".to_owned(),
        ..valid_request()
    };
    let values = validate_record_bank_deposit(&request).expect("payload should validate");
    assert_eq!(values.amount, "50000".parse::<BigDecimal>().unwrap());
}

#[test]
fn a_payment_reference_is_trimmed() {
    let request = RecordBankDepositRequest {
        payment_reference: "  WIRE-REF-2  ".to_owned(),
        ..valid_request()
    };
    let values = validate_record_bank_deposit(&request).expect("payload should validate");
    assert_eq!(values.payment_reference, "WIRE-REF-2");
}

// ── ref_hash (the minter's `BytesN<32>`) ─────────────────────────────────────

#[test]
fn the_ref_hash_is_sha256_of_the_reference() {
    let values = validate_record_bank_deposit(&valid_request()).expect("payload should validate");
    assert_eq!(
        hex::encode(values.ref_hash),
        // $ printf 'WIRE-REF-1' | shasum -a 256
        "72c162575adea091c5fc1bed0ec9321fda14c9706338e043ff9d01aeb652a6ce"
    );
}

#[test]
fn the_ref_hash_is_taken_over_the_trimmed_reference() {
    let padded = RecordBankDepositRequest {
        payment_reference: format!("  {}  ", valid_request().payment_reference),
        ..valid_request()
    };
    let from_padded =
        validate_record_bank_deposit(&padded).expect("padded payload should validate");
    let from_clean = validate_record_bank_deposit(&valid_request()).expect("should validate");
    assert_eq!(from_padded.ref_hash, from_clean.ref_hash);
}

#[test]
fn the_ref_hash_is_never_the_zero_hash_the_contract_refuses() {
    let values = validate_record_bank_deposit(&valid_request()).expect("payload should validate");
    assert_ne!(values.ref_hash, [0u8; 32]);
}

#[test]
fn a_different_reference_hashes_differently() {
    let other = RecordBankDepositRequest {
        payment_reference: "WIRE-REF-2".to_owned(),
        ..valid_request()
    };
    let a = validate_record_bank_deposit(&valid_request()).expect("should validate");
    let b = validate_record_bank_deposit(&other).expect("should validate");
    assert_ne!(a.ref_hash, b.ref_hash);
}

#[test]
fn a_timestamp_that_is_not_iso8601_is_rejected() {
    for raw in [
        "yesterday",
        "1790000000",
        "2026-10-05",
        "2026-10-05T15:41:00",
        "2026-13-05T15:41:00Z",
        "",
    ] {
        let request = RecordBankDepositRequest {
            occurred_at: raw.to_owned(),
            ..valid_request()
        };
        let error = validate_record_bank_deposit(&request)
            .expect_err(&format!("`{raw}` should not validate"));
        assert!(error.contains("occurred_at"), "got {error}");
    }
}

// ── OpenAPI document ─────────────────────────────────────────────────────────

fn openapi_json() -> serde_json::Value {
    serde_json::to_value(<LpBankDepositsDoc as utoipa::OpenApi>::openapi())
        .expect("a serializable document")
}

const PATH: &str = "/v1/lps/{id}/bank-deposits";

#[test]
fn both_halves_of_the_resource_are_documented_under_the_lp() {
    let doc = openapi_json();
    assert!(doc["paths"][PATH]["get"].is_object(), "GET {PATH} missing");
    assert!(
        doc["paths"][PATH]["post"].is_object(),
        "POST {PATH} missing"
    );
}

#[test]
fn the_deposit_body_is_json_and_carries_no_lp_id() {
    let doc = openapi_json();
    let content = &doc["paths"][PATH]["post"]["requestBody"]["content"];
    assert!(
        content.get("application/json").is_some(),
        "the deposit entry must be plain JSON, got {content}"
    );

    let properties = &doc["components"]["schemas"]["RecordBankDepositRequest"]["properties"];
    assert!(
        properties.get("lp_id").is_none(),
        "lp_id comes from the path, not the body, got {properties}"
    );
    assert!(
        properties.get("recorded_by").is_none(),
        "recorded_by comes from the JWT, not the body, got {properties}"
    );
    assert!(
        properties.get("dealing_date").is_none(),
        "the paired ledger row is priced at occurred_at, got {properties}"
    );
    assert_eq!(
        properties["occurred_at"]["type"], "string",
        "occurred_at is an ISO-8601 string, got {properties}"
    );
    for derived in ["ref_hash", "is_minted"] {
        assert!(
            properties.get(derived).is_none(),
            "{derived} is derived server-side, not supplied, got {properties}"
        );
    }
    let required = doc["components"]["schemas"]["RecordBankDepositRequest"]["required"].to_string();
    assert!(
        required.contains("payment_reference"),
        "payment_reference must be required, got {required}"
    );

    let response = &doc["components"]["schemas"]["BankDepositResponse"]["properties"];
    for gone in ["dealing_date", "lp_ledger_id", "stellar_tx_hash"] {
        assert!(
            response.get(gone).is_none(),
            "the response no longer carries {gone}, got {response}"
        );
    }
    for present in ["ref_hash", "is_minted", "payment_reference"] {
        assert!(
            response.get(present).is_some(),
            "the response must carry {present}, got {response}"
        );
    }
}

#[test]
fn recording_a_deposit_answers_created_and_documents_its_refusals() {
    let doc = openapi_json();
    let responses = &doc["paths"][PATH]["post"]["responses"];
    for status in ["201", "400", "401", "403", "404", "409"] {
        assert!(
            responses.get(status).is_some(),
            "POST must document {status}, got {responses}"
        );
    }
}

#[test]
fn listing_deposits_documents_its_refusals() {
    let doc = openapi_json();
    let responses = &doc["paths"][PATH]["get"]["responses"];
    for status in ["200", "401", "403", "404"] {
        assert!(
            responses.get(status).is_some(),
            "GET must document {status}, got {responses}"
        );
    }
}

#[test]
fn both_halves_are_bearer_gated() {
    let doc = openapi_json();
    for method in ["get", "post"] {
        let security = &doc["paths"][PATH][method]["security"];
        assert!(
            security.to_string().contains("bearer_auth"),
            "{method} must require the bearer token, got {security}"
        );
    }
}

// ── Router construction ──────────────────────────────────────────────────────

#[test]
fn the_deposit_routes_merge_under_v1_beside_the_lp_routes() {
    let limits = KybLimits {
        max_document_bytes: 1,
        max_files_per_request: 1,
        max_documents_per_lp: 1,
    };
    let _ = axum::Router::new()
        .nest("/v1", pipeline_api::routes::lps::router(limits))
        .nest("/v1", pipeline_api::routes::lp_ledger::router())
        .nest("/v1", router());
}
