//! LP self-serve email/password registration and login.
//!
//! Flow (see `docs/product-specs/api-authorization.md`):
//!   1. `POST /v1/auth/signup` — captcha-gated. **Always answers `202`**, whether
//!      the address was free, unverified, or already taken: a response that
//!      varied would turn the endpoint into an oracle for enumerating Pipeline's
//!      LP customer list. The three cases differ only in what is emailed.
//!   2. `POST /v1/auth/verify-otp` — consume the passcode, mark the address
//!      verified, and issue the JWT.
//!   3. `POST /v1/auth/resend-otp` — captcha-gated, cooldown-limited re-issue.
//!      Also always `202`, for the same reason as signup.
//!   4. `POST /v1/auth/login` — email + password for a verified account,
//!      throttled to 3 failed attempts per minute per address and per client.
//!
//! Signup grants no roles. `trustee` and `originator` remain manually assigned in
//! `auth_users`; nothing self-serve may grant them.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use shared::account_repo::Account;
use shared::email::{render_duplicate_signup_email, render_verification_email};
use shared::login_attempt_repo::AttemptScope;

use crate::auth::TOKEN_TTL_SECS;
use crate::captcha::CaptchaError;
use crate::error::ApiError;
use crate::otp::{
    generate_code, hash_code, MAX_OTP_ATTEMPTS, OTP_RESEND_COOLDOWN_SECS, OTP_TTL_SECS,
};
use crate::password::{
    dummy_password_hash, hash_password, validate_password_policy, verify_password,
};
use crate::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    /// Turnstile client token. Verified server-side before anything is written.
    pub captcha_token: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct VerifyOtpRequest {
    pub email: String,
    /// The six-digit passcode from the verification email.
    pub code: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResendOtpRequest {
    pub email: String,
    pub captcha_token: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

/// Issued session token. Same shape as the wallet path's `VerifyResponse`.
#[derive(Debug, Serialize, ToSchema)]
pub struct TokenResponse {
    pub token: String,
    pub expires_in: i64,
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/verify-otp", post(verify_otp))
        .route("/auth/resend-otp", post(resend_otp))
        .route("/auth/login", post(login))
}

// ── Compute (pure) ───────────────────────────────────────────────────────────

/// What signup should do about the address it was handed. Public so the unit
/// tests in `packages/api/tests/auth_signup.rs` can exercise it without the
/// HTTP/DB layers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignupOutcome {
    /// No account holds this address — create one and mail a passcode.
    Create,
    /// An account holds it but never verified — re-issue its passcode. This is
    /// the resume path for someone who closed the tab on the OTP screen.
    ReissuePasscode,
    /// A verified account holds it — change nothing and tell its owner.
    NotifyExistingOwner,
}

/// Trim, lowercase, and validate an address. The rule mirrors the frontend's
/// `EMAIL_PATTERN` exactly, so the server never rejects what the form accepted.
pub fn normalize_email(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let malformed = || Err("enter a valid email address".to_owned());

    // Mirrors /^[^\s@]+@[^\s@]+\.[^\s@]+$/: exactly one `@`, no whitespace on
    // either side, and a dot inside the domain with something on both sides.
    let Some((local, domain)) = trimmed.split_once('@') else {
        return malformed();
    };
    let no_at_or_space = |s: &str| !s.is_empty() && !s.contains(['@', ' ', '\t', '\n', '\r']);
    if !no_at_or_space(local) || !no_at_or_space(domain) {
        return malformed();
    }
    let Some((host, tld)) = domain.rsplit_once('.') else {
        return malformed();
    };
    if host.is_empty() || tld.is_empty() {
        return malformed();
    }

    Ok(trimmed.to_lowercase())
}

pub fn classify_signup(existing: Option<&Account>) -> SignupOutcome {
    match existing {
        None => SignupOutcome::Create,
        Some(account) if account.is_email_verified() => SignupOutcome::NotifyExistingOwner,
        Some(_) => SignupOutcome::ReissuePasscode,
    }
}

/// Failed sign-in attempts allowed per address, and per client address, before
/// further attempts are refused for the rest of the window.
pub const MAX_LOGIN_ATTEMPTS: i32 = 3;

/// The window those attempts are counted over.
pub const LOGIN_ATTEMPT_WINDOW_SECS: i32 = 60;

/// Whether an attempt is allowed, given how many have been recorded in the
/// current window **including this one**.
pub fn within_login_limit(attempts_including_this: i32) -> bool {
    attempts_including_this <= MAX_LOGIN_ATTEMPTS
}

/// Why an account may not be handed a token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenRefusal {
    Suspended,
    EmailNotVerified,
}

/// Gate an account before issuing a token. `require_verified_email` is `false`
/// on the verify-otp path, which is itself the step that performs verification;
/// suspension is checked on both paths.
pub fn gate_token_issue(account: &Account, require_verified_email: bool) -> Option<TokenRefusal> {
    if !account.is_active() {
        return Some(TokenRefusal::Suspended);
    }
    if require_verified_email && !account.is_email_verified() {
        return Some(TokenRefusal::EmailNotVerified);
    }
    None
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/v1/auth/signup",
    request_body = SignupRequest,
    responses(
        (status = 202, description = "Accepted. If the address can receive an account, a passcode has been emailed. Deliberately identical whether or not the address was already registered."),
        (status = 400, description = "Malformed email or a password failing the policy"),
        (status = 403, description = "Captcha rejected"),
        (status = 503, description = "Captcha provider unavailable — fails closed"),
    ),
    tag = "Auth"
)]
pub async fn signup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<SignupRequest>,
) -> Result<StatusCode, ApiError> {
    let email = normalize_email(&req.email).map_err(ApiError::BadRequest)?;
    validate_password_policy(&req.password).map_err(ApiError::BadRequest)?;
    verify_captcha(&state, &req.captcha_token, &headers).await?;

    // Hashed before the branch, not inside it. Argon2id costs tens of
    // milliseconds and only two of the three outcomes below would otherwise pay
    // it, so the response time alone would separate "this address is already
    // registered" from "this address is free" — the exact question the
    // unconditional 202 refuses to answer.
    let pending_hash = hash_password(&req.password).map_err(ApiError::Internal)?;

    let existing = state.account_repo.find_by_email(&email).await?;
    match classify_signup(existing.as_ref()) {
        SignupOutcome::Create => {
            // `None` means the address was claimed between the lookup and the
            // insert. The response is identical either way, so the race resolves
            // to "somebody else got there first" and nothing more is owed.
            if let Some(account_id) = state.account_repo.insert_unverified_account(&email).await? {
                issue_and_send_passcode(&state, account_id, &email, &pending_hash).await?;
            }
        }
        SignupOutcome::ReissuePasscode => {
            let account = existing.expect("classified from an existing account");
            // The password rides on the new code and is installed only if that
            // code is the one verified — it is never written to the account here.
            // Writing it here is an account takeover: a stranger re-submits this
            // address with their own password, the real owner's already-mailed
            // code stays live, and the owner's own verification hands over an
            // account whose password the stranger chose.
            //
            // The cooldown inside `issue` also stops signup from being the way
            // around `resend-otp`'s limit. Refusal is silent: a 429 here could
            // only ever fire for an address holding an unverified account, which
            // is the enumeration signal the 202 exists to suppress.
            issue_and_send_passcode(&state, account.id, &email, &pending_hash).await?;
        }
        SignupOutcome::NotifyExistingOwner => {
            let account = existing.expect("classified from an existing account");
            // Throttled like a passcode. Unthrottled, this arm is an open relay
            // for mailing any address Pipeline already has on file.
            if state
                .account_repo
                .claim_duplicate_notice(account.id, OTP_RESEND_COOLDOWN_SECS)
                .await?
            {
                state
                    .email_sender
                    .send(&render_duplicate_signup_email(&email))
                    .await?;
            }
        }
    }

    Ok(StatusCode::ACCEPTED)
}

#[utoipa::path(
    post,
    path = "/v1/auth/verify-otp",
    request_body = VerifyOtpRequest,
    responses(
        (status = 200, description = "Address verified; JWT issued", body = TokenResponse),
        (status = 400, description = "Malformed email"),
        (status = 401, description = "No outstanding passcode, or the passcode is wrong, expired, used, or out of attempts"),
    ),
    tag = "Auth"
)]
pub async fn verify_otp(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyOtpRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let email = normalize_email(&req.email).map_err(ApiError::BadRequest)?;

    // One message for every failure below: which of them occurred is exactly the
    // information an attacker probing addresses would want.
    let rejected = || ApiError::Unauthorized("invalid or expired code".to_owned());

    let account = state
        .account_repo
        .find_by_email(&email)
        .await?
        .ok_or_else(rejected)?;

    // Spending the attempt and checking the cap are one statement. Split, N
    // parallel guesses all read the same count and all pass a cap of 5 — and
    // this endpoint carries no captcha and no per-IP limit to fall back on.
    // `None` covers no code, already consumed, expired, and cap reached alike.
    let stored = state
        .otp_repo
        .claim_attempt(account.id, MAX_OTP_ATTEMPTS)
        .await?
        .ok_or_else(rejected)?;

    if hash_code(account.id, req.code.trim()) != stored.code_hash {
        // One guess per code. The attempt budget already refuses any further
        // try; burning the row as well keeps the table honest about it.
        state.otp_repo.invalidate(stored.id).await?;
        return Err(rejected());
    }
    if gate_token_issue(&account, false).is_some() {
        return Err(rejected());
    }

    state
        .account_repo
        .verify_email_consuming_code(
            account.id,
            stored.id,
            stored.pending_password_hash.as_deref(),
        )
        .await?;

    Ok(Json(issue_token(&state, account.id, Vec::new())?))
}

#[utoipa::path(
    post,
    path = "/v1/auth/resend-otp",
    request_body = ResendOtpRequest,
    responses(
        (status = 202, description = "Accepted. Identical whether or not the address has an unverified account, and whether or not a passcode was actually sent — inside the 60s cooldown the send is skipped silently."),
        (status = 400, description = "Malformed email"),
        (status = 403, description = "Captcha rejected"),
        (status = 503, description = "Captcha provider unavailable — fails closed"),
    ),
    tag = "Auth"
)]
pub async fn resend_otp(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ResendOtpRequest>,
) -> Result<StatusCode, ApiError> {
    let email = normalize_email(&req.email).map_err(ApiError::BadRequest)?;
    verify_captcha(&state, &req.captcha_token, &headers).await?;

    let Some(account) = state.account_repo.find_by_email(&email).await? else {
        return Ok(StatusCode::ACCEPTED);
    };
    if account.is_email_verified() {
        return Ok(StatusCode::ACCEPTED);
    }

    // A resend re-issues the passcode but cannot change the password: the new
    // code carries whatever the account's outstanding one carried, so this
    // endpoint can never be used to install a credential.
    let Some(pending) = state
        .otp_repo
        .latest_pending_password_hash(account.id)
        .await?
    else {
        return Ok(StatusCode::ACCEPTED);
    };

    // The cooldown is enforced inside `issue`, under a row lock. Skipping is
    // silent: a `429` could only ever fire for an address holding an unverified
    // account, which is the enumeration signal the `202` exists to suppress. The
    // outstanding code stays live for its full TTL, so "check your inbox"
    // remains true either way.
    issue_and_send_passcode(&state, account.id, &email, &pending).await?;
    Ok(StatusCode::ACCEPTED)
}

#[utoipa::path(
    post,
    path = "/v1/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Credentials accepted; JWT issued", body = TokenResponse),
        (status = 400, description = "Malformed email"),
        (status = 401, description = "Unknown address or wrong password"),
        (status = 403, description = "Address not yet verified, or the account is suspended"),
    ),
    tag = "Auth"
)]
pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let email = normalize_email(&req.email).map_err(ApiError::BadRequest)?;

    // Counted before the address is looked up, so an unknown address is
    // throttled exactly like a known one and the 429 reveals nothing about
    // which addresses exist. Both scopes are needed: per-address alone does
    // nothing against credential stuffing, per-client alone nothing against a
    // distributed attack on one account.
    let client_ip = client_ip(&headers);
    let mut refused = !within_login_limit(
        state
            .login_attempt_repo
            .record(AttemptScope::Email, &email, LOGIN_ATTEMPT_WINDOW_SECS)
            .await?,
    );
    if let Some(ip) = client_ip.as_deref() {
        refused |= !within_login_limit(
            state
                .login_attempt_repo
                .record(AttemptScope::Ip, ip, LOGIN_ATTEMPT_WINDOW_SECS)
                .await?,
        );
    }
    if refused {
        return Err(ApiError::TooManyRequests(
            "too many sign-in attempts — try again shortly".to_owned(),
        ));
    }
    let account = state.account_repo.find_by_email(&email).await?;

    // Verify against a throwaway hash when the address is unknown so both paths
    // cost the same Argon2 work. Skipping it would let an attacker read the
    // customer list off the response latency.
    // An account that has not verified yet holds no password — it rides on the
    // outstanding passcode until then. Check against that pending hash so a
    // caller who really did sign up is recognised and can be told to verify,
    // rather than being told their own password is wrong. It stays safe because
    // the caller still has to know the password: nobody learns an address is
    // registered without already holding its credential.
    let stored_hash = match account.as_ref() {
        Some(a) if a.password_hash.is_some() => a.password_hash.clone(),
        Some(a) => state.otp_repo.latest_pending_password_hash(a.id).await?,
        None => None,
    };
    let password_ok = match stored_hash.as_deref() {
        Some(hash) => verify_password(&req.password, hash),
        None => verify_password(&req.password, dummy_password_hash()),
    };

    let Some(account) = account else {
        return Err(ApiError::Unauthorized("invalid credentials".to_owned()));
    };
    if !password_ok {
        return Err(ApiError::Unauthorized("invalid credentials".to_owned()));
    }
    // A distinct `email_not_verified` code is not a leak: the caller proved the
    // password, so it reveals nothing they do not already know — and the
    // frontend needs it to route back into the OTP screen.
    match gate_token_issue(&account, true) {
        None => {}
        Some(TokenRefusal::Suspended) => {
            return Err(ApiError::Forbidden("account is suspended".to_owned()))
        }
        Some(TokenRefusal::EmailNotVerified) => {
            return Err(ApiError::Forbidden("email_not_verified".to_owned()))
        }
    }

    // Only failures should accumulate: a caller who mistypes twice and then
    // succeeds must not be left one attempt from a lockout.
    state
        .login_attempt_repo
        .clear(AttemptScope::Email, &email)
        .await?;
    if let Some(ip) = client_ip.as_deref() {
        state.login_attempt_repo.clear(AttemptScope::Ip, ip).await?;
    }

    Ok(Json(issue_token(&state, account.id, Vec::new())?))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// The client's address as reported by the fronting proxy. Turnstile treats
/// `remoteip` as optional, so an absent or unparseable header simply omits it
/// rather than failing the check — and the socket peer is deliberately not used
/// as a fallback, since behind a proxy that is the proxy's own address.
fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

async fn verify_captcha(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    let ip = client_ip(headers);
    match state.captcha.verify(token, ip.as_deref()).await {
        Ok(()) => Ok(()),
        Err(CaptchaError::Rejected(codes)) => {
            tracing::warn!(?codes, "captcha rejected");
            Err(ApiError::Forbidden(
                "captcha verification failed".to_owned(),
            ))
        }
        Err(CaptchaError::Unavailable(detail)) => {
            tracing::error!(%detail, "captcha provider unavailable — failing closed");
            Err(ApiError::ServiceUnavailable(
                "captcha verification is unavailable".to_owned(),
            ))
        }
    }
}

/// Issue a passcode and mail it, unless the cooldown says otherwise. The mail is
/// sent only when a code was actually issued, so a throttled call is a no-op
/// rather than a second email carrying a stale code.
async fn issue_and_send_passcode(
    state: &AppState,
    account_id: uuid::Uuid,
    email: &str,
    pending_password_hash: &str,
) -> Result<(), ApiError> {
    let code = generate_code();
    let issued = state
        .otp_repo
        .issue(
            account_id,
            &hash_code(account_id, &code),
            pending_password_hash,
            OTP_TTL_SECS,
            OTP_RESEND_COOLDOWN_SECS,
        )
        .await?;
    if issued {
        state
            .email_sender
            .send(&render_verification_email(email, &code))
            .await?;
    }
    Ok(())
}

fn issue_token(
    state: &AppState,
    account_id: uuid::Uuid,
    roles: Vec<String>,
) -> Result<TokenResponse, ApiError> {
    let keys = state
        .jwt_keys
        .as_ref()
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("JWT keys not configured")))?;
    let token = keys
        .issue_email_token(account_id, roles)
        .map_err(ApiError::Internal)?;
    Ok(TokenResponse {
        token,
        expires_in: TOKEN_TTL_SECS,
    })
}
