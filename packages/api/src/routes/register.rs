use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/nonce", get(get_nonce))
        .route("/", post(register))
}

#[derive(Serialize, ToSchema)]
pub struct NonceResponse {
    pub nonce: String,
    pub message: String,
}

#[derive(Deserialize, ToSchema)]
pub struct RegisterRequest {
    pub wallet_address: String,
    pub signature: String,
    pub nonce: String,
}

#[derive(Serialize, ToSchema)]
pub struct RegisterResponse {
    pub wallet_address: String,
}

fn build_message(nonce: &str) -> String {
    format!("Register for Pipeline\nNonce: {nonce}")
}

#[derive(OpenApi)]
#[openapi(
    paths(get_nonce, register),
    components(schemas(NonceResponse, RegisterRequest, RegisterResponse)),
    tags(
        (name = "Registration", description = "Wallet registration via signature verification")
    )
)]
pub struct ApiDoc;

#[utoipa::path(
    get,
    path = "/v1/register/nonce",
    responses(
        (status = 200, description = "Nonce generated", body = NonceResponse),
    ),
    tag = "Registration"
)]
async fn get_nonce() -> impl IntoResponse {
    let nonce = uuid::Uuid::new_v4().to_string();
    let message = build_message(&nonce);
    Json(NonceResponse { nonce, message })
}

#[utoipa::path(
    post,
    path = "/v1/register",
    request_body = RegisterRequest,
    responses(
        (status = 200, description = "Wallet registered", body = RegisterResponse),
        (status = 400, description = "Invalid signature or address"),
    ),
    tag = "Registration"
)]
async fn register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    let message = build_message(&req.nonce);

    if let Err(e) =
        shared::signature::verify_personal_sign(&message, &req.signature, &req.wallet_address)
    {
        tracing::warn!(
            wallet = req.wallet_address,
            error = %e,
            "signature verification failed"
        );
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid signature"})),
        )
            .into_response();
    }

    let wallet_lower = req.wallet_address.to_lowercase();

    match state.kyc_repo.get_lp_profile(&wallet_lower).await {
        Ok(Some(_)) => {
            return Json(RegisterResponse {
                wallet_address: wallet_lower,
            })
            .into_response();
        }
        Ok(None) => {}
        Err(e) => {
            tracing::error!("failed to get lp_profile: {e:?}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    }

    match state.kyc_repo.create_lp_profile(&wallet_lower).await {
        Ok(_) => Json(RegisterResponse {
            wallet_address: wallet_lower,
        })
        .into_response(),
        Err(e) => {
            tracing::error!("failed to create lp_profile: {e:?}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}
