//! Unit tests for Stellar Strkey validators in `shared::chains`.
//!
//! No env vars, no DB — pure input validation.

use shared::chains::{validate_contract_id, validate_stellar_address};

const CONTRACT_C: &str = "CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO";
const ACCOUNT_G: &str = "GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD";

#[test]
fn stellar_address_accepts_contract() {
    let out = validate_stellar_address("KEY", CONTRACT_C.to_owned()).expect("C… should validate");
    assert_eq!(out, CONTRACT_C);
}

#[test]
fn stellar_address_accepts_account() {
    let out = validate_stellar_address("KEY", ACCOUNT_G.to_owned()).expect("G… should validate");
    assert_eq!(out, ACCOUNT_G);
}

#[test]
fn stellar_address_uppercases_input() {
    let out = validate_stellar_address("KEY", ACCOUNT_G.to_lowercase())
        .expect("lowercase should normalize");
    assert_eq!(out, ACCOUNT_G);
}

#[test]
fn stellar_address_rejects_wrong_prefix() {
    // A valid-length base32 string that starts with neither G nor C.
    let bad = format!("M{}", &CONTRACT_C[1..]);
    let err = validate_stellar_address("KEY", bad).expect_err("M… should be rejected");
    assert!(format!("{err}").contains("'G' or 'C'"));
}

#[test]
fn stellar_address_rejects_wrong_length() {
    let err = validate_stellar_address("KEY", "CBTOOSHORT".to_owned()).expect_err("too short");
    assert!(format!("{err}").contains("56-char"));
}

#[test]
fn contract_id_still_rejects_account_prefix() {
    // validate_contract_id remains contract-only (C…), so a G… account is rejected.
    let err = validate_contract_id("KEY", ACCOUNT_G.to_owned()).expect_err("G… not a contract");
    assert!(format!("{err}").contains("'C'"));
}
