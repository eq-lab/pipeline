//! Unit tests for the email/password credential primitives backing LP self-serve
//! signup (`POST /v1/auth/signup`, `POST /v1/auth/login`).
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests —
//! no `DATABASE_URL` / Postgres connection, no network.

use pipeline_api::password::{
    dummy_password_hash, hash_password, validate_password_policy, verify_password,
};

// ── Password policy ────────────────────────────────────────────────────────────

#[test]
fn rejects_a_password_shorter_than_the_minimum() {
    let err = validate_password_policy("P@ss1").unwrap_err();
    assert!(
        err.contains("8 characters"),
        "error should name the length rule, got: {err}"
    );
}

#[test]
fn rejects_a_long_password_with_no_digit() {
    let err = validate_password_policy("Abcdefgh!").unwrap_err();
    assert!(
        err.contains("digit"),
        "error should name the digit rule, got: {err}"
    );
}

#[test]
fn rejects_a_long_password_with_no_special_character() {
    let err = validate_password_policy("Abcdefg1").unwrap_err();
    assert!(
        err.contains("special"),
        "error should name the special-character rule, got: {err}"
    );
}

#[test]
fn accepts_a_password_meeting_every_rule() {
    assert!(validate_password_policy("P@ssw0rd!").is_ok());
}

#[test]
fn counts_length_the_way_the_browser_does() {
    // Four astral-plane characters plus a digit and a symbol. The form measures
    // `password.length`, which is UTF-16 code units, and sees 10 — so it enables
    // submit. Counting Rust `char`s instead sees 6 and rejects what the user was
    // just told was fine.
    let accepted_by_the_form = "\u{1D11E}\u{1D11E}\u{1D11E}\u{1D11E}1!";
    assert_eq!(accepted_by_the_form.encode_utf16().count(), 10);
    assert!(
        validate_password_policy(accepted_by_the_form).is_ok(),
        "server must not reject a password the form accepted"
    );
}

// ── Argon2id hashing ───────────────────────────────────────────────────────────

#[test]
fn verifies_a_password_against_its_own_hash() {
    let hash = hash_password("P@ssw0rd!").unwrap();
    assert!(verify_password("P@ssw0rd!", &hash));
}

#[test]
fn rejects_a_wrong_password_against_a_valid_hash() {
    let hash = hash_password("P@ssw0rd!").unwrap();
    assert!(!verify_password("P@ssw0rd?", &hash));
}

#[test]
fn salts_each_hash_independently() {
    let first = hash_password("P@ssw0rd!").unwrap();
    let second = hash_password("P@ssw0rd!").unwrap();
    assert_ne!(
        first, second,
        "identical passwords must not produce identical hashes"
    );
}

#[test]
fn stores_hashes_as_argon2id_phc_strings() {
    let hash = hash_password("P@ssw0rd!").unwrap();
    assert!(
        hash.starts_with("$argon2id$"),
        "expected an argon2id PHC string, got: {hash}"
    );
}

#[test]
fn verifies_a_malformed_hash_as_false_instead_of_erroring() {
    assert!(!verify_password("P@ssw0rd!", "not-a-phc-string"));
}

#[test]
fn rejects_every_password_against_the_dummy_hash() {
    assert!(!verify_password("P@ssw0rd!", dummy_password_hash()));
    assert!(!verify_password("", dummy_password_hash()));
}

#[test]
fn returns_a_stable_dummy_hash_across_calls() {
    assert_eq!(dummy_password_hash(), dummy_password_hash());
}
