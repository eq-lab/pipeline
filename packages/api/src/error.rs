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

#[derive(Debug)]
pub enum ApiError {
    /// 400 Bad Request. The String is the user-visible error message.
    BadRequest(String),
    /// 401 Unauthorized. The String is the user-visible error message. Used by the
    /// auth routes and the `AuthClaims` extractor when authentication fails or is
    /// not configured.
    Unauthorized(String),
    /// 403 Forbidden. The caller is authenticated but lacks the required role.
    Forbidden(String),
    /// 404 Not Found. The requested resource does not exist.
    NotFound(String),
    /// 409 Conflict. The request conflicts with the resource's current state
    /// (e.g. reviewing a submission that has already been decided).
    Conflict(String),
    /// 422 Unprocessable Entity. The request is well-formed, but the server-side data it
    /// references cannot be processed — e.g. a repayment whose loan carries a corrupt
    /// economics epoch (see `routes::waterfall`). The String is the user-visible message.
    UnprocessableEntity(String),
    /// 413 Payload Too Large. The request carries more than an endpoint's own
    /// ceiling allows — used by the KYB upload route, whose per-file and
    /// per-request file-count limits are tighter than the body limit that
    /// admitted the request.
    PayloadTooLarge(String),
    /// 429 Too Many Requests. The caller is rate-limited. No handler returns it
    /// yet — the auth endpoints deliberately answer `202` and skip the work
    /// instead, so that a refusal cannot be used to probe which addresses exist.
    /// Reserved for the per-IP limiting in TD-81, which has no such constraint.
    TooManyRequests(String),
    /// 500 Internal Server Error. The wrapped `anyhow::Error` is logged but never
    /// returned to the caller — the response body is a generic `"internal error"`.
    Internal(anyhow::Error),
    /// 503 Service Unavailable. A dependency the request cannot proceed without
    /// is down. Used by the captcha check, which fails closed rather than waving
    /// callers through when the provider cannot be reached.
    ServiceUnavailable(String),
}

/// Whether a database error is a unique-constraint violation (SQLSTATE 23505).
/// Lets a handler answer `409` for a collision the caller can act on, instead of
/// letting it fall through `From<sqlx::Error>` into an opaque `500`.
pub fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"))
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
            Self::Unauthorized(msg) => (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response(),
            Self::Forbidden(msg) => (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response(),
            Self::NotFound(msg) => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response(),
            Self::Conflict(msg) => (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response(),
            Self::UnprocessableEntity(msg) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response(),
            Self::PayloadTooLarge(msg) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response(),
            Self::TooManyRequests(msg) => (
                StatusCode::TOO_MANY_REQUESTS,
                Json(serde_json::json!({"error": msg})),
            )
                .into_response(),
            Self::ServiceUnavailable(msg) => (
                StatusCode::SERVICE_UNAVAILABLE,
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
