//! Unit tests for `POST /v1/lp-ledger/deposits`' payload validation. Exercise
//! `validate_record_deposit` directly — pure, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`).

use bigdecimal::BigDecimal;

use pipeline_api::routes::lp_ledger::{validate_record_deposit, RecordDepositRequest};

fn valid_request() -> RecordDepositRequest {
    RecordDepositRequest {
        lp_id: 1,
        amount: "50000.00".to_owned(),
        payment_reference: Some("WIRE-REF-1".to_owned()),
        occurred_at: 1_790_000_000,
        dealing_date: 1_790_000_000,
        idempotency_key: "3fa85f64-5717-4562-b3fc-2c963f66afa6".to_owned(),
    }
}

#[test]
fn valid_payload_parses_everything() {
    let values = validate_record_deposit(&valid_request()).expect("payload should validate");
    assert_eq!(values.lp_id, 1);
    assert_eq!(values.amount, "50000.00".parse::<BigDecimal>().unwrap());
    assert_eq!(values.payment_reference.as_deref(), Some("WIRE-REF-1"));
}

#[test]
fn empty_payment_reference_becomes_none() {
    let req = RecordDepositRequest {
        payment_reference: Some("   ".to_owned()),
        ..valid_request()
    };
    let values = validate_record_deposit(&req).expect("payload should validate");
    assert_eq!(values.payment_reference, None);
}

#[test]
fn missing_payment_reference_is_valid() {
    let req = RecordDepositRequest {
        payment_reference: None,
        ..valid_request()
    };
    assert!(validate_record_deposit(&req).is_ok());
}

#[test]
fn non_decimal_amount_is_rejected() {
    let req = RecordDepositRequest {
        amount: "fifty thousand".to_owned(),
        ..valid_request()
    };
    let err = validate_record_deposit(&req).unwrap_err();
    assert!(err.contains("amount"), "got: {err}");
}

#[test]
fn zero_amount_is_rejected() {
    let req = RecordDepositRequest {
        amount: "0".to_owned(),
        ..valid_request()
    };
    let err = validate_record_deposit(&req).unwrap_err();
    assert!(err.contains("must be > 0"), "got: {err}");
}

#[test]
fn negative_amount_is_rejected() {
    let req = RecordDepositRequest {
        amount: "-1".to_owned(),
        ..valid_request()
    };
    let err = validate_record_deposit(&req).unwrap_err();
    assert!(err.contains("must be > 0"), "got: {err}");
}

#[test]
fn amount_above_magnitude_bound_is_rejected() {
    let req = RecordDepositRequest {
        amount: "10000000000000000".to_owned(),
        ..valid_request()
    };
    let err = validate_record_deposit(&req).unwrap_err();
    assert!(err.contains("must be <="), "got: {err}");
}

#[test]
fn amount_with_more_than_two_decimal_places_is_rejected() {
    // lp_ledger.delta is NUMERIC(20,2); a third decimal place would round
    // differently there than in bank_transactions.amount (unscaled NUMERIC).
    let req = RecordDepositRequest {
        amount: "50000.001".to_owned(),
        ..valid_request()
    };
    let err = validate_record_deposit(&req).unwrap_err();
    assert!(err.contains("decimal places"), "got: {err}");
}

#[test]
fn amount_with_exactly_two_decimal_places_is_valid() {
    let req = RecordDepositRequest {
        amount: "1200.50".to_owned(),
        ..valid_request()
    };
    assert!(validate_record_deposit(&req).is_ok());
}

#[test]
fn whole_dollar_amount_is_valid() {
    let req = RecordDepositRequest {
        amount: "50000".to_owned(),
        ..valid_request()
    };
    assert!(validate_record_deposit(&req).is_ok());
}

#[test]
fn malformed_idempotency_key_is_rejected() {
    let req = RecordDepositRequest {
        idempotency_key: "not-a-uuid".to_owned(),
        ..valid_request()
    };
    let err = validate_record_deposit(&req).unwrap_err();
    assert!(err.contains("idempotency_key"), "got: {err}");
}
