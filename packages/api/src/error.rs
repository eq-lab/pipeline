//! Global error type for axum handlers.
//!
//! Handlers return `Result<Json<T>, ApiError>` (or `Result<impl IntoResponse, ApiError>`)
//! and use `?` to convert anyhow / sqlx errors into the `Internal` variant. `BadRequest`
//! is constructed explicitly with a human-readable message.
//!
//! Used by `routes::portfolio` and `routes::stats`. Other routes still have ad-hoc
//! `match { Err => 500 }` patterns and should be migrated incrementally — there's no
//! behavioural difference, just less boilerplate at the call site.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

pub enum ApiError {
    /// 400 Bad Request. The String is the user-visible error message.
    BadRequest(String),
    /// 500 Internal Server Error. The wrapped `anyhow::Error` is logged but never
    /// returned to the caller — the response body is a generic `"internal error"`.
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e)
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self::Internal(anyhow::Error::from(e))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            Self::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response(),
            Self::Internal(e) => {
                tracing::error!(error = %e, "api internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal error"})),
                )
                    .into_response()
            }
        }
    }
}
