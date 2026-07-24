//! Unit tests for the bank-transaction submission validator
//! (`validate_bank_transaction`). Pure — no HTTP/DB layer (matches the project-wide
//! convention: all tests in `tests/`, no live Postgres).

use pipeline_api::routes::bank_transactions::{
    validate_bank_transaction, SubmitBankTransactionRequest,
};

fn valid_request() -> SubmitBankTransactionRequest {
    SubmitBankTransactionRequest {
        transaction_type: "Deposit".to_owned(),
        amount: "50000.00".to_owned(),
        payment_reference: Some("WIRE-2026-0042".to_owned()),
        occurred_at: 1_784_851_200,
    }
}

#[test]
fn valid_deposit_passes() {
    assert!(validate_bank_transaction(&valid_request()).is_ok());
}

#[test]
fn valid_withdrawal_passes() {
    let mut r = valid_request();
    r.transaction_type = "Withdrawal".to_owned();
    assert!(validate_bank_transaction(&r).is_ok());
}

#[test]
fn valid_fee_passes() {
    let mut r = valid_request();
    r.transaction_type = "Fee".to_owned();
    assert!(validate_bank_transaction(&r).is_ok());
}

#[test]
fn unknown_transaction_type_is_rejected() {
    let mut r = valid_request();
    r.transaction_type = "Transfer".to_owned();
    let err = validate_bank_transaction(&r).unwrap_err();
    assert!(err.contains("transaction_type"), "unexpected error: {err}");
}

#[test]
fn negative_amount_is_rejected() {
    let mut r = valid_request();
    r.amount = "-1".to_owned();
    let err = validate_bank_transaction(&r).unwrap_err();
    assert!(err.contains("amount"), "unexpected error: {err}");
}

#[test]
fn zero_amount_is_allowed() {
    let mut r = valid_request();
    r.amount = "0".to_owned();
    assert!(validate_bank_transaction(&r).is_ok());
}

#[test]
fn non_decimal_amount_is_rejected() {
    let mut r = valid_request();
    r.amount = "not-a-number".to_owned();
    assert!(validate_bank_transaction(&r).is_err());
}

#[test]
fn blank_payment_reference_is_rejected() {
    let mut r = valid_request();
    r.payment_reference = Some("   ".to_owned());
    let err = validate_bank_transaction(&r).unwrap_err();
    assert!(err.contains("payment_reference"), "unexpected error: {err}");
}

#[test]
fn missing_payment_reference_is_allowed() {
    let mut r = valid_request();
    r.payment_reference = None;
    assert!(validate_bank_transaction(&r).is_ok());
}
