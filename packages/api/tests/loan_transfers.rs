//! Unit tests for the per-loan capital-transfers payload validation (#1027).
//! Exercise `validate_loan_transfers` directly — pure, no HTTP/DB layer involved.
//!
//! Lives under `packages/api/tests/` to match the project-wide convention (all
//! tests in `tests/`, feature-named, no inline `#[cfg(test)]` modules in `src/`).

use bigdecimal::BigDecimal;

use pipeline_api::routes::loan_transfers::{validate_loan_transfers, UpsertLoanTransfersRequest};

fn valid_request() -> UpsertLoanTransfersRequest {
    UpsertLoanTransfersRequest {
        is_loan_deployed: true,
        on_ramp_transferred: "50000".to_owned(),
        off_ramp_transferred: "50000.00".to_owned(),
        trust_account_deposit: "1200.50".to_owned(),
        trust_account_withdrawal: "0".to_owned(),
    }
}

#[test]
fn valid_payload_parses_all_amounts() {
    let values = validate_loan_transfers(&valid_request()).expect("payload should validate");
    assert!(values.is_loan_deployed);
    assert_eq!(values.on_ramp_transferred, BigDecimal::from(50_000));
    assert_eq!(values.off_ramp_transferred, BigDecimal::from(50_000));
    assert_eq!(
        values.trust_account_deposit,
        "1200.50".parse::<BigDecimal>().unwrap()
    );
    assert_eq!(values.trust_account_withdrawal, BigDecimal::from(0));
}

#[test]
fn zero_amounts_are_valid() {
    let req = UpsertLoanTransfersRequest {
        is_loan_deployed: false,
        on_ramp_transferred: "0".to_owned(),
        off_ramp_transferred: "0".to_owned(),
        trust_account_deposit: "0".to_owned(),
        trust_account_withdrawal: "0".to_owned(),
    };
    assert!(validate_loan_transfers(&req).is_ok());
}

// Each of the four amount fields must reject a non-decimal value, and the error
// must name the offending field.

#[test]
fn non_decimal_on_ramp_is_rejected() {
    let req = UpsertLoanTransfersRequest {
        on_ramp_transferred: "fifty".to_owned(),
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("on_ramp_transferred"), "got: {err}");
}

#[test]
fn non_decimal_off_ramp_is_rejected() {
    let req = UpsertLoanTransfersRequest {
        off_ramp_transferred: String::new(),
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("off_ramp_transferred"), "got: {err}");
}

#[test]
fn non_decimal_trust_deposit_is_rejected() {
    let req = UpsertLoanTransfersRequest {
        trust_account_deposit: "12,000".to_owned(),
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("trust_account_deposit"), "got: {err}");
}

#[test]
fn non_decimal_trust_withdrawal_is_rejected() {
    let req = UpsertLoanTransfersRequest {
        trust_account_withdrawal: "$40".to_owned(),
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("trust_account_withdrawal"), "got: {err}");
}

// Individual amounts are non-negative — sign is implied by the field name
// (derived buckets may go negative, entries may not).

#[test]
fn negative_on_ramp_is_rejected() {
    let req = UpsertLoanTransfersRequest {
        on_ramp_transferred: "-1".to_owned(),
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("must be >= 0"), "got: {err}");
}

#[test]
fn negative_trust_withdrawal_is_rejected() {
    let req = UpsertLoanTransfersRequest {
        trust_account_withdrawal: "-0.01".to_owned(),
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("must be >= 0"), "got: {err}");
}

// Magnitude and scale are bounded so out-of-range entries fail as 400s instead
// of surfacing as INSERT-time Postgres NUMERIC overflows (500) or absurd stored
// values that break the Trustee dashboard's float parsing.

#[test]
fn amount_above_magnitude_bound_is_rejected() {
    // 1e131000 parses as a valid BigDecimal but must not pass validation.
    let req = UpsertLoanTransfersRequest {
        on_ramp_transferred: "1e131000".to_owned(),
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("must be <="), "got: {err}");
}

#[test]
fn amount_at_magnitude_bound_is_accepted() {
    let req = UpsertLoanTransfersRequest {
        on_ramp_transferred: "1000000000000000".to_owned(), // exactly 10^15
        ..valid_request()
    };
    assert!(validate_loan_transfers(&req).is_ok());
}

#[test]
fn amount_with_excessive_scale_is_rejected() {
    // A pathological scale (would overflow NUMERIC's scale limit at INSERT time).
    let req = UpsertLoanTransfersRequest {
        trust_account_deposit: "1e-131000".to_owned(),
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("decimal places"), "got: {err}");

    let req = UpsertLoanTransfersRequest {
        trust_account_deposit: "0.1234567".to_owned(), // 7 dp
        ..valid_request()
    };
    let err = validate_loan_transfers(&req).unwrap_err();
    assert!(err.contains("decimal places"), "got: {err}");
}

#[test]
fn trailing_zeros_do_not_count_toward_scale() {
    // "1.500000000" normalizes to 1.5 — trailing zeros must not trip the bound.
    let req = UpsertLoanTransfersRequest {
        trust_account_deposit: "1.500000000".to_owned(),
        ..valid_request()
    };
    assert!(validate_loan_transfers(&req).is_ok());
}
