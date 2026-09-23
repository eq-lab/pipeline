//! Email/password credential primitives for LP self-serve signup.
//!
//! See `docs/product-specs/api-authorization.md`. Pure functions only — the
//! unit tests in `packages/api/tests/auth_password.rs` exercise them directly.

use std::sync::OnceLock;

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

/// Minimum password length, matching the frontend policy added by #1281
/// (`useAuthCredentialsForm`, `passwordRule: "policy"`).
pub const MIN_PASSWORD_LEN: usize = 8;

/// Validate a candidate password against the policy the create-account form
/// advertises: **at least 8 characters, including one digit and one special
/// character**. Mirrors `meetsPasswordPolicy` in the frontend's
/// `useAuthCredentialsForm` rule-for-rule — length in UTF-16 code units, `\d`
/// as ASCII 0-9, and "special" as anything outside `[A-Za-z0-9]` — so the
/// server never rejects what the form accepted.
pub fn validate_password_policy(password: &str) -> Result<(), String> {
    // UTF-16 code units, matching the browser's `password.length`. Counting
    // `char`s instead makes the server stricter than the form for anything
    // outside the BMP, so a password the user was just told was valid comes
    // back rejected.
    if password.encode_utf16().count() < MIN_PASSWORD_LEN {
        return Err(format!(
            "password must be at least {MIN_PASSWORD_LEN} characters"
        ));
    }
    if !password.chars().any(|c| c.is_ascii_digit()) {
        return Err("password must contain a digit".to_owned());
    }
    if !password.chars().any(|c| !c.is_ascii_alphanumeric()) {
        return Err("password must contain a special character".to_owned());
    }
    Ok(())
}

/// Hash `password` with Argon2id, returning a self-describing PHC string
/// (algorithm, parameters, and a fresh random salt all encoded inline).
pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("failed to hash password: {e}"))
}

/// Whether `password` matches the stored PHC `hash`. A malformed or unparseable
/// hash verifies as `false` rather than erroring — callers must not be able to
/// distinguish "bad password" from "corrupt row".
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// A stable hash of a fixed throwaway secret, verified against when the supplied
/// email has no account so that login costs the same either way. Without it,
/// response timing reveals which corporate emails are registered — the same leak
/// the unconditional `202` on signup exists to close.
pub fn dummy_password_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        hash_password("pipeline-login-timing-equalizer")
            .expect("hashing a fixed literal cannot fail")
    })
}
