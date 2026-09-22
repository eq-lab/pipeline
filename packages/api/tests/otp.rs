//! Unit tests for the signup email-verification passcode primitives.
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests —
//! no `DATABASE_URL` / Postgres connection, no network.
//!
//! Covers generation and hashing only. Expiry, single-use, and the attempt cap
//! moved into single SQL statements in `shared::otp_repo` (a Rust-side
//! read-check-then-write lost the race under concurrent verification), so they
//! are no longer reachable from a pure test and are exercised against a real
//! Postgres instead.

use uuid::Uuid;

use pipeline_api::otp::{generate_code, hash_code, OTP_LEN};

// ── Fixtures ───────────────────────────────────────────────────────────────────

fn account() -> Uuid {
    Uuid::parse_str("11111111-2222-3333-4444-555555555555").unwrap()
}

// ── Code generation ────────────────────────────────────────────────────────────

#[test]
fn generates_a_six_digit_numeric_code() {
    for _ in 0..200 {
        let code = generate_code();
        assert_eq!(code.chars().count(), OTP_LEN, "wrong length: {code}");
        assert!(
            code.chars().all(|c| c.is_ascii_digit()),
            "non-digit in code: {code}"
        );
    }
}

#[test]
fn generates_varying_codes() {
    let first = generate_code();
    let differs = (0..50).any(|_| generate_code() != first);
    assert!(differs, "generate_code returned a constant value");
}

// ── Code hashing ───────────────────────────────────────────────────────────────

#[test]
fn hashes_the_same_code_differently_for_different_accounts() {
    let other = Uuid::parse_str("99999999-8888-7777-6666-555555555555").unwrap();
    assert_ne!(hash_code(account(), "123456"), hash_code(other, "123456"));
}

#[test]
fn hashes_the_same_code_and_account_reproducibly() {
    assert_eq!(
        hash_code(account(), "123456"),
        hash_code(account(), "123456")
    );
}

#[test]
fn does_not_store_the_code_in_the_clear() {
    assert!(!hash_code(account(), "123456").contains("123456"));
}
