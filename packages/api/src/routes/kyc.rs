use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/applicants", post(create_applicant))
        .route("/token", post(create_token))
        .route("/status/{wallet_address}", get(get_status))
}

#[derive(Deserialize)]
pub struct CreateApplicantRequest {
    pub wallet_address: String,
}

#[derive(Serialize)]
pub struct CreateApplicantResponse {
    pub applicant_id: String,
}

#[derive(Deserialize)]
pub struct CreateTokenRequest {
    pub wallet_address: String,
}

#[derive(Serialize)]
pub struct CreateTokenResponse {
    pub token: String,
    pub expires_at: String,
}

#[derive(Serialize)]
pub struct KycStatusResponse {
    pub kyc_status: i16,
    pub kyc_review_status: i16,
}

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
