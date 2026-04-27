use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::middleware::webhook_auth::validate_webhook;
use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/applicants", post(create_applicant))
        .route("/token", post(create_token))
        .route("/status/{wallet_address}", get(get_status))
        .route("/callback", post(webhook_callback))
}

#[derive(Deserialize, ToSchema)]
pub struct CreateApplicantRequest {
    pub wallet_address: String,
}

#[derive(Serialize, ToSchema)]
pub struct CreateApplicantResponse {
    pub applicant_id: String,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateTokenRequest {
    pub wallet_address: String,
}

#[derive(Serialize, ToSchema)]
pub struct CreateTokenResponse {
    pub token: String,
    pub expires_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct KycStatusResponse {
    pub kyc_status: i16,
    pub kyc_review_status: i16,
}

#[derive(OpenApi)]
#[openapi(
    paths(create_applicant, create_token, get_status, webhook_callback),
    components(schemas(
        CreateApplicantRequest,
        CreateApplicantResponse,
        CreateTokenRequest,
        CreateTokenResponse,
        KycStatusResponse,
    )),
    tags(
        (name = "KYC", description = "Sumsub KYC/KYB verification endpoints")
    )
)]
pub struct ApiDoc;

#[utoipa::path(
    post,
    path = "/v1/kyc/applicants",
    request_body = CreateApplicantRequest,
    responses(
        (status = 200, description = "Applicant created or already exists", body = CreateApplicantResponse),
        (status = 502, description = "Sumsub unavailable"),
    ),
    tag = "KYC"
)]
async fn create_applicant(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateApplicantRequest>,
) -> impl IntoResponse {
    let profile = state.kyc_repo.get_lp_profile(&req.wallet_address).await;
    let profile = match profile {
        Ok(Some(p)) => p,
        Ok(None) => match state.kyc_repo.create_lp_profile(&req.wallet_address).await {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("failed to create lp_profile: {e:?}");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal error"})),
                )
                    .into_response();
            }
        },
        Err(e) => {
            tracing::error!("failed to get lp_profile: {e:?}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    };

    if let Some(ref applicant_id) = profile.sumsub_applicant_id {
        return Json(CreateApplicantResponse {
            applicant_id: applicant_id.clone(),
        })
        .into_response();
    }

    match state
        .sumsub_client
        .create_applicant(&req.wallet_address)
        .await
    {
        Ok(resp) => {
            if let Err(e) = state
                .kyc_repo
                .set_applicant_id(&req.wallet_address, &resp.id)
                .await
            {
                tracing::error!("failed to store applicant_id: {e:?}");
            }
            Json(CreateApplicantResponse {
                applicant_id: resp.id,
            })
            .into_response()
        }
        Err(e) => {
            tracing::error!("Sumsub create_applicant failed: {e:?}");
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "verification service unavailable"})),
            )
                .into_response()
        }
    }
}

#[utoipa::path(
    post,
    path = "/v1/kyc/token",
    request_body = CreateTokenRequest,
    responses(
        (status = 200, description = "Access token generated", body = CreateTokenResponse),
        (status = 502, description = "Sumsub unavailable"),
    ),
    tag = "KYC"
)]
async fn create_token(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTokenRequest>,
) -> impl IntoResponse {
    match state
        .sumsub_client
        .generate_access_token(&req.wallet_address)
        .await
    {
        Ok(resp) => {
            let expires_at = chrono::Utc::now()
                + chrono::Duration::seconds(state.sumsub_settings.token_ttl_secs as i64);

            match resp.token {
                Some(token) => Json(CreateTokenResponse {
                    token,
                    expires_at: expires_at.to_rfc3339(),
                })
                .into_response(),
                None => (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({"error": "no token returned"})),
                )
                    .into_response(),
            }
        }
        Err(e) => {
            tracing::error!("Sumsub generate_access_token failed: {e:?}");
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "verification service unavailable"})),
            )
                .into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/v1/kyc/status/{wallet_address}",
    params(
        ("wallet_address" = String, Path, description = "Wallet address of the LP")
    ),
    responses(
        (status = 200, description = "KYC status retrieved", body = KycStatusResponse),
        (status = 404, description = "Profile not found"),
    ),
    tag = "KYC"
)]
async fn get_status(
    State(state): State<Arc<AppState>>,
    Path(wallet_address): Path<String>,
) -> impl IntoResponse {
    match state.kyc_repo.get_lp_profile(&wallet_address).await {
        Ok(Some(profile)) => Json(KycStatusResponse {
            kyc_status: profile.kyc_status,
            kyc_review_status: profile.kyc_review_status,
        })
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not found"})),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("failed to get lp_profile: {e:?}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

#[utoipa::path(
    post,
    path = "/v1/kyc/callback",
    responses(
        (status = 200, description = "Webhook processed successfully"),
        (status = 400, description = "Invalid payload or signature"),
        (status = 500, description = "Internal error"),
    ),
    tag = "KYC"
)]
async fn webhook_callback(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if let Err(rejection) =
        validate_webhook(&headers, &body, &state.sumsub_settings.webhook_secret_key)
    {
        return rejection.into_response();
    }

    let payload: shared::sumsub::models::WebhookPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("failed to parse webhook payload: {e:?}");
            return (StatusCode::BAD_REQUEST, "invalid payload").into_response();
        }
    };

    if payload.sandbox_mode != Some(state.sumsub_settings.sandbox) {
        tracing::warn!("webhook sandbox_mode mismatch");
        return (StatusCode::BAD_REQUEST, "sandbox mode mismatch").into_response();
    }

    let wallet_address = match &payload.external_user_id {
        Some(id) if !id.is_empty() => id.clone(),
        _ => {
            tracing::warn!("webhook missing external_user_id");
            return (StatusCode::BAD_REQUEST, "missing external_user_id").into_response();
        }
    };

    match state.kyc_repo.get_lp_profile(&wallet_address).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            tracing::warn!(wallet = wallet_address, "webhook for unknown wallet");
            return (StatusCode::NOT_FOUND, "applicant not found").into_response();
        }
        Err(e) => {
            tracing::error!("failed to look up lp_profile: {e:?}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    }

    let review_status = payload
        .parsed_review_status()
        .unwrap_or(shared::sumsub::models::KycReviewStatus::Pending);
    let kyc_status = payload.parsed_kyc_status();

    if let Err(e) = state
        .kyc_repo
        .update_kyc_status(&wallet_address, kyc_status, review_status)
        .await
    {
        tracing::error!("failed to update kyc status: {e:?}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
    }

    if let Err(e) = state
        .kyc_repo
        .insert_outbox(&wallet_address, review_status, kyc_status)
        .await
    {
        tracing::error!("failed to insert kyc outbox: {e:?}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
    }

    tracing::info!(
        wallet = wallet_address,
        review_status = ?review_status,
        kyc_status = ?kyc_status,
        "processed Sumsub webhook"
    );

    StatusCode::OK.into_response()
}
