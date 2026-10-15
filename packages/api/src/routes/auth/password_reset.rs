// spec: docs/product-specs/api-authorization-password-reset.md

use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use serde::Deserialize;
use utoipa::ToSchema;

use shared::email::{render_password_changed_email, render_password_reset_email};
use shared::login_attempt_repo::AttemptScope;

use super::password::{client_ip, normalize_email, verify_captcha};
use crate::error::ApiError;
use crate::password::{hash_password, validate_password_policy};
use crate::password_reset::{
    generate_reset_token, hash_reset_token, is_well_formed_reset_token, may_reset_password,
    within_reset_request_limit, PASSWORD_RESET_COOLDOWN_SECS, RESET_REQUEST_WINDOW_SECS,
};
use crate::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct ForgotPasswordRequest {
    pub email: String,
    pub captcha_token: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub password: String,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/forgot-password", post(forgot_password))
        .route("/auth/reset-password", post(reset_password))
}

#[utoipa::path(
    post,
    path = "/v1/auth/forgot-password",
    request_body = ForgotPasswordRequest,
    responses(
        (status = 202, description = "Accepted. Identical whether or not the address belongs to a verified, active account, and whether or not a link was actually sent — inside the 60s cooldown the send is skipped silently."),
        (status = 400, description = "Malformed email"),
        (status = 403, description = "Captcha rejected"),
        (status = 429, description = "Too many reset requests from this client address"),
        (status = 503, description = "Captcha provider unavailable — fails closed"),
    ),
    tag = "Auth"
)]
pub async fn forgot_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ForgotPasswordRequest>,
) -> Result<StatusCode, ApiError> {
    let email = normalize_email(&req.email).map_err(ApiError::BadRequest)?;
    verify_captcha(&state, &req.captcha_token, &headers).await?;

    if let Some(ip) = client_ip(&headers) {
        let requests = state
            .login_attempt_repo
            .record(AttemptScope::PasswordResetIp, &ip, RESET_REQUEST_WINDOW_SECS)
            .await?;
        if !within_reset_request_limit(requests) {
            return Err(ApiError::TooManyRequests(
                "too many reset requests — try again later".to_owned(),
            ));
        }
    }

    tokio::spawn(send_reset_link(state, email));
    Ok(StatusCode::ACCEPTED)
}

async fn send_reset_link(state: Arc<AppState>, email: String) {
    if let Err(e) = try_send_reset_link(&state, &email).await {
        tracing::error!(error = %e, "password reset link not sent");
    }
}

async fn try_send_reset_link(state: &AppState, email: &str) -> anyhow::Result<()> {
    let Some(account) = state.account_repo.find_by_email(email).await? else {
        return Ok(());
    };
    if !may_reset_password(&account) {
        return Ok(());
    }

    let token = generate_reset_token();
    let issued = state
        .otp_repo
        .issue_password_reset(
            account.id,
            &hash_reset_token(&token),
            state.password_reset.ttl_secs(),
            PASSWORD_RESET_COOLDOWN_SECS,
        )
        .await?;
    if issued {
        state
            .email_sender
            .send(&render_password_reset_email(
                email,
                &state.password_reset.link(&token),
                state.password_reset.ttl_minutes,
            ))
            .await?;
    }
    Ok(())
}

#[utoipa::path(
    post,
    path = "/v1/auth/reset-password",
    request_body = ResetPasswordRequest,
    responses(
        (status = 204, description = "Password replaced; every token issued before this moment is now rejected"),
        (status = 400, description = "Password failing the policy"),
        (status = 401, description = "Reset link unknown, expired, already used, or superseded — or the account is no longer verified and active"),
    ),
    tag = "Auth"
)]
pub async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<StatusCode, ApiError> {
    validate_password_policy(&req.password).map_err(ApiError::BadRequest)?;

    let rejected = || ApiError::Unauthorized("invalid or expired reset link".to_owned());
    let token = req.token.trim();
    if !is_well_formed_reset_token(token) {
        return Err(rejected());
    }
    let token_hash = hash_reset_token(token);
    if !state.otp_repo.is_live_password_reset(&token_hash).await? {
        return Err(rejected());
    }

    let password_hash = hash_password(&req.password).map_err(ApiError::Internal)?;
    let account = state
        .account_repo
        .reset_password_consuming_token(&token_hash, &password_hash, Utc::now())
        .await?
        .ok_or_else(rejected)?;

    if let Some(email) = account.email.as_deref() {
        if let Err(e) = state
            .email_sender
            .send(&render_password_changed_email(email))
            .await
        {
            tracing::warn!(account = %account.id, error = %e, "password-changed notice not sent");
        }
    }

    Ok(StatusCode::NO_CONTENT)
}
