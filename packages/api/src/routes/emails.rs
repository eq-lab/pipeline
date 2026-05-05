use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use utoipa::{OpenApi, ToSchema};

use crate::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", post(create_email))
}

#[derive(Deserialize, ToSchema)]
pub struct CreateEmailRequest {
    pub email: String,
}

#[derive(OpenApi)]
#[openapi(
    paths(create_email),
    components(schemas(CreateEmailRequest)),
    tags(
        (name = "Emails", description = "Waitlist email collection")
    )
)]
pub struct EmailsDoc;

fn is_valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty() && domain.contains('.') && domain.len() >= 3
}

#[utoipa::path(
    post,
    path = "/v1/emails",
    request_body = CreateEmailRequest,
    responses(
        (status = 201, description = "Email saved"),
        (status = 400, description = "Invalid email format"),
    ),
    tag = "Emails"
)]
async fn create_email(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateEmailRequest>,
) -> impl IntoResponse {
    let email = req.email.trim().to_lowercase();

    if !is_valid_email(&email) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid email format"})),
        )
            .into_response();
    }

    match sqlx::query("INSERT INTO emails (email) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(&email)
        .execute(&state.pool)
        .await
    {
        Ok(_) => StatusCode::CREATED.into_response(),
        Err(e) => {
            tracing::error!("failed to insert email: {e:?}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}
