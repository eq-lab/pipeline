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
