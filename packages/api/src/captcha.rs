//! Bot-defense seam for the unauthenticated auth endpoints.
//!
//! See `docs/product-specs/api-authorization.md`. The concrete implementation is
//! Cloudflare Turnstile; the trait exists so handlers stay testable without a
//! network round-trip, and so the provider is a one-impl swap.
//!
//! Verification **fails closed**: a provider outage rejects signups rather than
//! waving them through, since an attacker who can make the verify call fail would
//! otherwise have disabled the control.

use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;

/// Cloudflare's verification endpoint.
pub const TURNSTILE_VERIFY_URL: &str = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/// Why a captcha check did not pass.
#[derive(Debug)]
pub enum CaptchaError {
    /// The provider answered, and the answer was "no".
    Rejected(Vec<String>),
    /// The provider could not be reached, timed out, or answered unintelligibly.
    /// Callers surface this as `503` — never as a pass.
    Unavailable(String),
}

#[async_trait]
pub trait CaptchaVerifier: Send + Sync {
    async fn verify(&self, token: &str, remote_ip: Option<&str>) -> Result<(), CaptchaError>;
}

#[derive(Debug, Deserialize)]
struct SiteVerifyResponse {
    success: bool,
    #[serde(rename = "error-codes", default)]
    error_codes: Vec<String>,
}

/// Interpret a raw siteverify response body. Split out from the HTTP call so the
/// decision is unit-testable — see `packages/api/tests/captcha.rs`.
pub fn interpret_siteverify(body: &str) -> Result<(), CaptchaError> {
    let parsed: SiteVerifyResponse = serde_json::from_str(body).map_err(|e| {
        CaptchaError::Unavailable(format!("captcha provider returned an unreadable body: {e}"))
    })?;
    if parsed.success {
        Ok(())
    } else {
        Err(CaptchaError::Rejected(parsed.error_codes))
    }
}

/// Cloudflare Turnstile verifier.
pub struct TurnstileVerifier {
    secret: String,
    client: reqwest::Client,
}

impl TurnstileVerifier {
    /// Build a verifier from `TURNSTILE_SECRET_KEY`, mirroring how `JwtKeys` and
    /// the per-chain signers degrade: absent means the API still boots, with the
    /// check disabled. **Provisioning the secret is a production deploy
    /// requirement** — an unset key means open signup, not a safe default.
    pub fn from_env() -> Box<dyn CaptchaVerifier> {
        match std::env::var("TURNSTILE_SECRET_KEY") {
            Ok(secret) if !secret.trim().is_empty() => {
                tracing::info!("Turnstile secret loaded — captcha enforced on signup/resend");
                Box::new(Self {
                    secret,
                    client: reqwest::Client::new(),
                })
            }
            _ => {
                tracing::warn!(
                    "TURNSTILE_SECRET_KEY not set — captcha DISABLED; \
                     signup and resend-otp are unprotected"
                );
                Box::new(DisabledCaptcha)
            }
        }
    }
}

#[async_trait]
impl CaptchaVerifier for TurnstileVerifier {
    async fn verify(&self, token: &str, remote_ip: Option<&str>) -> Result<(), CaptchaError> {
        let mut form = vec![("secret", self.secret.as_str()), ("response", token)];
        if let Some(ip) = remote_ip {
            form.push(("remoteip", ip));
        }

        let response = self
            .client
            .post(TURNSTILE_VERIFY_URL)
            .timeout(Duration::from_secs(5))
            .form(&form)
            .send()
            .await
            .map_err(|e| CaptchaError::Unavailable(format!("captcha provider unreachable: {e}")))?;

        let body = response.text().await.map_err(|e| {
            CaptchaError::Unavailable(format!("captcha provider response unreadable: {e}"))
        })?;

        interpret_siteverify(&body)
    }
}

/// Verifier used when no secret is configured. Accepts everything, so it is only
/// ever appropriate in local development — `from_env` logs loudly when it is
/// selected.
pub struct DisabledCaptcha;

#[async_trait]
impl CaptchaVerifier for DisabledCaptcha {
    async fn verify(&self, _token: &str, _remote_ip: Option<&str>) -> Result<(), CaptchaError> {
        Ok(())
    }
}
