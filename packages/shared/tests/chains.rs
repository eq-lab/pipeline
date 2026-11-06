//! Unit tests for Stellar Strkey validators and USDC-scale normalization in
//! `shared::chains`.
//!
//! No env vars, no DB — pure input validation / pure arithmetic.

use bigdecimal::BigDecimal;
use shared::chains::{
    normalize_usdc_amount, validate_contract_id, validate_evm_address, validate_stellar_account,
    validate_stellar_address, validate_stellar_settlement_address, ChainKind,
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

// ── Settlement-address validators (#1824) ────────────────────────────────────

const EIP55: &str = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

fn account() -> String {
    format!("{}", stellar_strkey::ed25519::PublicKey([7; 32]))
}

fn contract() -> String {
    format!("{}", stellar_strkey::Contract([9; 32]))
}

fn corrupt_last(s: &str) -> String {
    let mut chars: Vec<char> = s.chars().collect();
    let last = chars.len() - 1;
    chars[last] = if chars[last] == 'A' { 'B' } else { 'A' };
    chars.into_iter().collect()
}

#[test]
fn evm_all_lower_and_all_upper_pass() {
    let lower = EIP55.to_ascii_lowercase();
    assert_eq!(validate_evm_address("address", &lower).unwrap(), lower);
    let upper = format!("0x{}", EIP55[2..].to_ascii_uppercase());
    assert_eq!(validate_evm_address("address", &upper).unwrap(), lower);
}

#[test]
fn evm_valid_eip55_passes_and_comes_back_lowercase() {
    assert_eq!(
        validate_evm_address("address", EIP55).unwrap(),
        EIP55.to_ascii_lowercase()
    );
}

#[test]
fn evm_a_flipped_case_letter_fails_the_checksum() {
    let flipped: String = EIP55
        .char_indices()
        .map(|(i, c)| match (i, c) {
            (3, 'a') => 'A',
            (3, 'A') => 'a',
            _ => c,
        })
        .collect();
    assert_ne!(flipped, EIP55);
    let err = validate_evm_address("address", &flipped)
        .unwrap_err()
        .to_string();
    assert_eq!(err, "address is not a valid EIP-55 checksum");
}

#[test]
fn evm_malformed_inputs_fail() {
    let hex40 = "5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
    for bad in [
        hex40.to_owned(),
        format!("0x{}", &hex40[..39]),
        format!("0x{hex40}0"),
        format!("0x{}g", &hex40[..39]),
        String::new(),
    ] {
        let err = validate_evm_address("signer_address", &bad)
            .unwrap_err()
            .to_string();
        assert_eq!(
            err, "signer_address must be a 0x-prefixed 20-byte hex EVM address",
            "{bad}"
        );
    }
}

#[test]
fn stellar_account_accepts_a_real_g_address_and_uppercases() {
    let g = account();
    assert_eq!(validate_stellar_account("signer_address", &g).unwrap(), g);
    assert_eq!(
        validate_stellar_account("signer_address", &g.to_ascii_lowercase()).unwrap(),
        g
    );
}

#[test]
fn stellar_account_rejects_a_contract_and_a_bad_checksum() {
    let msg = "signer_address must be a Stellar account (G…) Strkey with a valid checksum";
    let err = validate_stellar_account("signer_address", &contract()).unwrap_err();
    assert_eq!(err.to_string(), msg);
    let err = validate_stellar_account("signer_address", &corrupt_last(&account())).unwrap_err();
    assert_eq!(err.to_string(), msg);
}

#[test]
fn stellar_settlement_address_accepts_g_and_c_and_rejects_the_rest() {
    assert_eq!(
        validate_stellar_settlement_address("address", &account()).unwrap(),
        account()
    );
    assert_eq!(
        validate_stellar_settlement_address("address", &contract()).unwrap(),
        contract()
    );
    let msg =
        "address must be a Stellar account (G…) or contract (C…) Strkey with a valid checksum";
    for bad in [
        corrupt_last(&account()),
        corrupt_last(&contract()),
        format!(
            "{}",
            stellar_strkey::ed25519::MuxedAccount {
                ed25519: [7; 32],
                id: 1,
            }
        ),
    ] {
        let err = validate_stellar_settlement_address("address", &bad).unwrap_err();
        assert_eq!(err.to_string(), msg, "{bad}");
    }
}

#[test]
fn chain_kind_label_is_the_display_name() {
    assert_eq!(ChainKind::Evm.label(), "EVM");
    assert_eq!(ChainKind::Stellar.label(), "Stellar");
}
