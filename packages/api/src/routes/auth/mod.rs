//! Authorization endpoints (`/v1/auth/*`).
//!
//! Two credentials, one principal. See `docs/product-specs/api-authorization.md`.
//!
//! * [`wallet`] — `GET /auth/challenge` + `POST /auth/verify`: an allow-listed
//!   `(chain_id, address)` signs a server-issued nonce.
//! * [`password`] — `POST /auth/signup`, `/auth/verify-otp`, `/auth/resend-otp`,
//!   `POST /auth/login`: LP self-serve email registration.
//! * [`password_reset`] — `POST /auth/forgot-password`, `/auth/reset-password`:
//!   recovery by a single-use emailed link.
//!
//! Both paths end at an `accounts` row and issue the same 24h ES256 JWT, which
//! carries `account_id`. Protected endpoints gate on the `AuthClaims` extractor
//! and authorize against that claim, never against the wallet pair.

pub mod password;
pub mod password_reset;
pub mod wallet;

use std::sync::Arc;

use axum::Router;
use utoipa::OpenApi;

use crate::auth::{Claims, SecurityAddon};
use crate::AppState;

/// OpenAPI doc bundle for the auth routes.
#[derive(OpenApi)]
#[openapi(
    paths(
        wallet::challenge,
        wallet::verify,
        password::signup,
        password::verify_otp,
        password::resend_otp,
        password::login,
        password_reset::forgot_password,
        password_reset::reset_password,
    ),
    components(schemas(
        wallet::ChallengeResponse,
        wallet::VerifyRequest,
        wallet::VerifyResponse,
        password::SignupRequest,
        password::VerifyOtpRequest,
        password::ResendOtpRequest,
        password::LoginRequest,
        password::TokenResponse,
        password_reset::ForgotPasswordRequest,
        password_reset::ResetPasswordRequest,
        Claims,
    )),
    modifiers(&SecurityAddon),
    tags((name = "Auth", description = "Wallet-signature and email/password authorization"))
)]
pub struct AuthDoc;

pub fn router() -> Router<Arc<AppState>> {
    wallet::router()
        .merge(password::router())
        .merge(password_reset::router())
}
