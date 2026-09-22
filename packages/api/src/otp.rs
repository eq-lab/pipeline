//! One-time passcode primitives for email verification at signup.
//!
//! See `docs/product-specs/api-authorization.md`. Code generation and hashing
//! only — the unit tests in `packages/api/tests/otp.rs` exercise them directly.
//!
//! Deciding whether a passcode may be *accepted* deliberately does not live
//! here. Expiry, single-use, and the attempt cap are enforced by
//! `shared::otp_repo` in single SQL statements, because a Rust-side
//! read-check-then-write loses the race each control exists to stop.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Digits in a passcode. Matches `OTP_LENGTH` in the frontend's `useOtpModal`.
pub const OTP_LEN: usize = 6;

/// How long an issued passcode stays usable.
pub const OTP_TTL_MINUTES: i32 = 10;

/// Verification attempts allowed against a single passcode before it is burned.
/// The real brute-force control: a 6-digit space is trivially searchable, so the
/// attempt cap and the TTL — not the stored hash — are what protect the code.
pub const MAX_OTP_ATTEMPTS: i32 = 5;

/// Minimum gap between sends to one address. The frontend's 59-second countdown
/// is an affordance; this is the control, enforced server-side from the stored
/// `created_at` so it survives a client that simply does not wait.
pub const OTP_RESEND_COOLDOWN_SECS: i32 = 60;

/// Generate a fresh zero-padded passcode of [`OTP_LEN`] digits.
pub fn generate_code() -> String {
    // Rejection-sample so every code is equally likely: taking `next_u32() % 1e6`
    // outright would over-represent the low codes, shrinking the search space.
    const CODE_SPACE: u32 = 1_000_000;
    const LIMIT: u32 = u32::MAX - (u32::MAX % CODE_SPACE);
    let value = loop {
        let candidate = OsRng.next_u32();
        if candidate < LIMIT {
            break candidate % CODE_SPACE;
        }
    };
    let width = OTP_LEN;
    format!("{value:0width$}")
}

/// Hash a passcode for storage. Salted with the owning account id so the same
/// code issued to two accounts does not collide, and so a stolen hash cannot be
/// replayed against a different account.
pub fn hash_code(account_id: Uuid, code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(account_id.as_bytes());
    hasher.update(b":");
    hasher.update(code.as_bytes());
    hex::encode(hasher.finalize())
}
