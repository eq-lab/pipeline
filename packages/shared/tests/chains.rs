//! Unit tests for Stellar Strkey validators and USDC-scale normalization in
//! `shared::chains`.
//!
//! No env vars, no DB — pure input validation / pure arithmetic.

use bigdecimal::BigDecimal;
use shared::chains::{
    normalize_usdc_amount, validate_contract_id, validate_stellar_address, ChainKind,
};

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

// ── normalize_usdc_amount ───────────────────────────────────────────────────

#[test]
fn normalize_usdc_amount_evm_is_a_no_op() {
    let raw = BigDecimal::from(1_000_000_i64);
    assert_eq!(normalize_usdc_amount(ChainKind::Evm, &raw), raw);
}

#[test]
fn normalize_usdc_amount_stellar_divides_by_ten() {
    // Native 7-decimal Stellar scale -> canonical 6-decimal (see #901).
    let raw = BigDecimal::from(10_000_000_i64); // $1,000 at 7dp
    assert_eq!(
        normalize_usdc_amount(ChainKind::Stellar, &raw),
        BigDecimal::from(1_000_000_i64) // $1,000 at 6dp
    );
}

#[test]
fn normalize_usdc_amount_stellar_zero_stays_zero() {
    let raw = BigDecimal::from(0_i64);
    assert_eq!(
        normalize_usdc_amount(ChainKind::Stellar, &raw),
        BigDecimal::from(0_i64)
    );
}

#[test]
fn normalize_usdc_amount_stellar_truncates_not_rounds() {
    // Caught by code review: BigDecimal division does not floor on its own
    // (123456789 / 10 = 12345678.9, not 12345678) — every raw on-chain amount is
    // a whole integer at its native scale, so the normalized result must be too.
    let raw = BigDecimal::from(123_456_789_i64);
    let got = normalize_usdc_amount(ChainKind::Stellar, &raw);
    assert_eq!(got, BigDecimal::from(12_345_678_i64));
    assert_eq!(got.fractional_digit_count(), 0);
}
